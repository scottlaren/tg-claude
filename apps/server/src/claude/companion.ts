import { query, createSdkMcpServer, tool, type SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { PromptImage } from './runner.ts'

// One answer in a companion chat. A session of its own kind: its own instructions instead of Claude Code's, no device,
// no app and no remote server, no stored conversation. What it may call is fixed here and checked three times: in what
// the session is started with, in what it reports having, and at every call

export const CHAT_SERVER = 'chat'
export const REMIND = `mcp__${CHAT_SERVER}__remind`
export const FIND_PICTURE = `mcp__${CHAT_SERVER}__find_picture`
// Runs at Anthropic: the server asks no site for anything
export const COMPANION_SEARCH = 'WebSearch'
// Reads a page from the server: the site sees where the server is, which the owner has accepted for the people of a
// chat. Every address is asked about first
export const COMPANION_READ = 'WebFetch'
const WEB = [COMPANION_SEARCH, COMPANION_READ]

export type RemindArgs = { at?: string, inMinutes?: number, text: string }

export type CompanionOptions = {
  system: string
  prompt: string
  images?: PromptImage[]
  model: string
  // How hard the model thinks; its own default when left out
  effort?: 'low' | 'medium' | 'high'
  env: Record<string, string | undefined>
  // An empty folder that is nobody's project
  cwd: string
  search: boolean
  // What a search may be asked for: not something only the session itself knows
  mayAsk?: (query: string) => boolean
  // Whether a page may be read: null, or why not, in words for Claude. Without it no page is
  mayOpen?: (url: string) => Promise<string | null>
  // Sets a reminder and says how it went, in words for Claude
  remind?: (r: RemindArgs) => Promise<string>
  // Looks pictures up where they are free to show, and lists their addresses
  findPicture?: (query: string) => Promise<string>
  // A tool was called: its name and nothing of what it was called with
  onStep?: (tool: string) => void
  timeoutMs?: number
  onStderr?: (s: string) => void
}

export type CompanionResult = {
  text: string, isError?: boolean, errorKind?: SDKAssistantMessageError, timedOut?: boolean,
  usage?: { input: number, output: number, cacheRead: number, cacheWrite: number }
}

export const COMPANION_TIMEOUT_MS = 180_000
// A search or two and the answer; a session that keeps calling tools is not answering a chat message
const MAX_TURNS = 8

const chatServer = (o: Pick<CompanionOptions, 'remind' | 'findPicture'>) => createSdkMcpServer({
  name: CHAT_SERVER,
  tools: [...(o.findPicture ? [tool(
    'find_picture',
    'Look for pictures on Wikimedia Commons, which are free to show. Returns a few titles with the address of each file. To show one, put its address on a line of its own as ![caption](address); use an address exactly as returned.',
    { query: z.string().min(1).max(120).describe('What the picture shows, in English, a few words: "fireplace", "Mount Elbrus sunrise"') },
    async args => ({ content: [{ type: 'text' as const, text: await o.findPicture!(args.query) }] }),
  )] : []), ...(o.remind ? [tool(
    'remind',
    'Set a reminder for the person you are answering: at that time the bot posts it to this chat with their name. Give exactly one of at, inMinutes. The result says whether it was set; a person can have only a few at once.',
    {
      at: z.string().max(20).optional().describe("A set time: local time in the chat's time zone as YYYY-MM-DDTHH:MM, e.g. 2026-10-31T12:00"),
      inMinutes: z.number().int().min(1).max(525600).optional().describe('After a while: "in 2 hours" is 120'),
      text: z.string().min(1).max(300).describe('What to remind of, in the language of the person, as it should be read then'),
    },
    async args => ({ content: [{ type: 'text' as const, text: await o.remind!(args) }] }),
  )] : [])],
  alwaysLoad: true,
})

export const companionTools = (o: Pick<CompanionOptions, 'search' | 'remind' | 'findPicture'>) => [...(o.search ? WEB : []), ...(o.findPicture ? [FIND_PICTURE] : []), ...(o.remind ? [REMIND] : [])]

export async function companionTurn(o: CompanionOptions): Promise<CompanionResult> {
  const allowed = new Set(companionTools(o))
  const own = !!(o.remind || o.findPicture)
  const stop = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    stop.abort()
  }, o.timeoutMs ?? COMPANION_TIMEOUT_MS)
  const content = o.images?.length
    ? [...o.images.map(i => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mime, data: i.data } })), { type: 'text' as const, text: o.prompt }]
    : o.prompt
  // The input stays open until the answer is there: the questions about tools come over the same channel
  let release!: () => void
  const finished = new Promise<void>(r => (release = r))
  async function* input() {
    yield { type: 'user' as const, message: { role: 'user' as const, content }, parent_tool_use_id: null, session_id: '' }
    await finished
  }
  const q = query({
    prompt: input(),
    options: {
      cwd: o.cwd,
      // What people write goes in as written: an «@/path» in a message must not pull a file of the server in
      verbatimPrompts: true,
      model: o.model,
      effort: o.effort,
      env: o.env,
      tools: o.search ? WEB : [],
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: own ? { [CHAT_SERVER]: chatServer(o) } : {},
      permissionMode: 'default',
      maxTurns: MAX_TURNS,
      // Nothing is resumed: every request carries what it needs, and nothing of the chat stays in the account's folder
      persistSession: false,
      canUseTool: async (name, args, { mcpServer }) => {
        if (name === COMPANION_SEARCH && o.search && !mcpServer) {
          if (o.mayAsk && !o.mayAsk(JSON.stringify(args))) return { behavior: 'deny', message: 'This search is not allowed here.' }
          // The thorough kind of search costs several times more: a chat gets the ordinary one
          return { behavior: 'allow', updatedInput: 'mode' in args ? { ...args, mode: 'standard' } : args }
        }
        if (name === COMPANION_READ && o.search && !mcpServer) {
          const refused = o.mayOpen ? await o.mayOpen(String(args.url ?? '')) : 'Pages are not read here.'
          return refused ? { behavior: 'deny', message: refused } : { behavior: 'allow', updatedInput: args }
        }
        const ours = mcpServer?.source === 'sdk' && mcpServer.name === CHAT_SERVER
        if (name === REMIND && o.remind && ours) return { behavior: 'allow', updatedInput: args }
        if (name === FIND_PICTURE && o.findPicture && ours) {
          if (o.mayAsk && !o.mayAsk(JSON.stringify(args))) return { behavior: 'deny', message: 'This search is not allowed here.' }
          return { behavior: 'allow', updatedInput: args }
        }
        return { behavior: 'deny', message: 'In this chat you only talk: there is nothing to run, open or read here.' }
      },
      abortController: stop,
      systemPrompt: { type: 'custom', prompt: o.system },
      stderr: o.onStderr,
    },
  })

  let lastText = ''
  let errorKind: SDKAssistantMessageError | undefined
  let result: CompanionResult | null = null
  let guard: Error | null = null
  try {
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') {
        // Enforced in code, not in the instructions: with anything else at hand the session is not let to begin
        const foreign = m.tools.filter(t => !allowed.has(t))
        const servers = m.mcp_servers.map(s => s.name).filter(n => !(own && n === CHAT_SERVER))
        if (foreign.length || servers.length) {
          guard = new Error(`A companion session came up with more than it may have (${[...foreign, ...servers].join(', ')}): it was stopped`)
          stop.abort()
          break
        }
      } else if (m.type === 'assistant' && !m.parent_tool_use_id) {
        if (m.error) errorKind = m.error
        for (const b of m.message.content) if (b.type === 'tool_use') o.onStep?.(b.name)
        const t = m.message.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('')
        if (t) lastText = t
      } else if (m.type === 'result') {
        const u = m.usage
        result = {
          isError: m.is_error, errorKind,
          text: (m.subtype === 'success' ? m.result : m.errors?.join('\n')) || lastText,
          usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
        }
        break
      }
    }
  } catch (e) {
    // The SDK throws after an error result; the result itself says more
    if (!result && !guard && !timedOut) throw e
  } finally {
    clearTimeout(timer)
    release()
  }
  if (guard) throw guard
  if (timedOut) return { text: '', isError: true, timedOut: true }
  return result ?? { text: lastText, isError: true }
}
