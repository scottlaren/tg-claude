import { query, type CanUseTool, type McpSdkServerConfigWithInstance, type SDKRateLimitInfo, type SDKAssistantMessageError, type SDKUserMessage, type Query, type HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'
import { isDeviceTool, DEVICE_SERVER } from './device-tools.ts'
import { createToolTracker } from './netwatch.ts'
import { appToolPrefix } from './app-tools.ts'
import { remotePrefix, type RemoteServers } from './remote.ts'
import { isChromeTool, type chromeHooks } from './chrome.ts'

export type TurnResult = {
  text: string, isError?: boolean, aborted?: boolean, durationMs?: number, sessionId?: string,
  // The stored session id points at nothing Claude knows (§6): the caller offers a new session
  resumeFailed?: boolean
  // Whole turn, all model calls: what the turn cost against the plan's limits
  usage?: { input: number, output: number, cacheRead: number, cacheWrite: number }
  // Why the API refused, when it did: a spent plan limit or a profile that has to sign in again (§7)
  errorKind?: SDKAssistantMessageError
  // How full the conversation is after the turn, against the model's window
  context?: ContextSize
}

export type ContextSize = { total: number, max: number }

// Built-ins allowed on the server: none touch its disk or shell. AskUserQuestion is answered in
// Telegram, WebSearch runs at Anthropic, WebFetch only reads pages (private addresses refused by the bot),
// ToolSearch only searches tool definitions: app MCP tools stay behind it until needed (67k → 5k tokens a call)
export const HOST_TOOLS = new Set(['AskUserQuestion', 'WebSearch', 'WebFetch', 'ToolSearch'])
const RESUME_MISSING = /No conversation found with session ID/
// Chrome's file_upload takes only files the session may read, and the CLI counts none as such without its Read tool.
// So with the browser on Read is there, and a hook turns down every call of it: it would read the server, never the
// computer, and the upload's own check doesn't go through hooks
export const SERVER_READ = 'Read'
export const serverReadGuard: HookCallbackMatcher = {
  hooks: [async i => (i.hook_event_name === 'PreToolUse' && i.tool_name === SERVER_READ
    ? { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: 'Read here would read the server, not the user\'s computer: use mcp__device__read_file.' } }
    : {})],
}

// readOnly: for tools of remote servers, the server's own annotation (undefined when it gives none)
export type TurnCanUseTool = (tool: string, input: Record<string, unknown>, opts: Parameters<CanUseTool>[2] & { readOnly?: boolean }) => ReturnType<CanUseTool>
export type RemoteStatus = { name: string, status: string }

export type PromptImage = { mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: string }

// A message the user sends into a turn under way. id: what the CLI confirms reading it by
export type HandIn = { id: string, text: string, images?: PromptImage[] }

export type TurnOptions = {
  prompt: string
  // Photos, album pictures and video frames from Telegram: Claude sees them directly, no device needed
  images?: PromptImage[]
  cwd: string
  sessionId?: string | null
  model?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  // Claude compacts the history by itself a little before this many tokens, instead of near the model's own window
  compactWindow?: number
  env: Record<string, string | undefined>
  append: string
  // None in a topic without a project: then Claude has no hands on any computer
  deviceServer?: McpSdkServerConfigWithInstance
  // In-process servers of the bot itself (suggest_project), keyed by name
  botServers?: Record<string, McpSdkServerConfigWithInstance>
  // App MCP servers of the bound device, keyed by their name on the device
  appServers?: Record<string, McpSdkServerConfigWithInstance>
  // Remote MCP servers the server itself connects to, name → URL (Figma)
  remote?: RemoteServers
  canUseTool: TurnCanUseTool
  onRemoteStatus?: (servers: RemoteStatus[]) => void
  onRateLimit?: (info: SDKRateLimitInfo) => void
  // Claude in Chrome for this turn: every browser call goes through these hooks (§10.6)
  chrome?: ReturnType<typeof chromeHooks>
  // What the user sent in meanwhile: asked for after each batch of tools, confirmed once the CLI has read it
  handIn?: { take: () => Promise<HandIn | null>, landed: (id: string) => void }
  abortController: AbortController
  onSession?: (id: string) => void
  onStep?: (name: string, input: Record<string, unknown>) => void
  onText?: (text: string) => void
  onApiWait?: (waiting: boolean) => void
  onRetry?: (m: { attempt?: number, error_status?: number | null }) => void
  // Claude Code compacts a long conversation before answering: minutes with no word from the API that are
  // no lost connection
  onCompacting?: (on: boolean) => void
  onCompacted?: (tokens: { pre: number, post?: number }) => void
  onStderr?: (s: string) => void
}

// If interrupt() doesn't end the turn by then, the process is killed
const HARD_STOP_MS = 3000
// Compacting a conversation of a million tokens takes minutes; past this something is wrong
const COMPACT_MAX_MS = 20 * 60_000

// A control request on the open session; a turn never waits on it for long
async function contextOf(q: Query): Promise<ContextSize | null> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<null>(r => (timer = setTimeout(() => r(null), 5000)))
  try {
    const u = await Promise.race([q.getContextUsage(), late])
    return u && u.maxTokens ? { total: u.totalTokens, max: u.maxTokens } : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// /compact on a stored session, apart from any turn: the same cwd and profile as its turns, no tools, and
// slash commands on (turns take prompts as written, so they can't run it). The result: tokens before and after,
// and the session id to keep using
export async function compactSession(o: { cwd: string, sessionId: string, model?: string, env: Record<string, string | undefined>, onStderr?: (s: string) => void }) {
  let release!: () => void
  const finished = new Promise<void>(r => (release = r))
  async function* input() {
    yield { type: 'user' as const, message: { role: 'user' as const, content: '/compact' }, parent_tool_use_id: null, session_id: '' }
    await finished
  }
  const hardStop = new AbortController()
  const timer = setTimeout(() => hardStop.abort(), COMPACT_MAX_MS)
  const q = query({
    prompt: input(),
    options: {
      cwd: o.cwd, resume: o.sessionId, model: o.model || undefined, env: o.env, tools: [], settingSources: [], strictMcpConfig: true,
      verbatimPrompts: false, // fixed prompt: the only message is the literal /compact, nothing the user wrote
      mcpServers: {}, permissionMode: 'default', canUseTool: async () => ({ behavior: 'deny', message: 'Only compacting here' }),
      abortController: hardStop, stderr: o.onStderr,
    },
  })
  const out: { sessionId: string, pre?: number, post?: number, context?: ContextSize } = { sessionId: o.sessionId }
  let failed = ''
  try {
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'compact_boundary') {
        out.pre = m.compact_metadata.pre_tokens
        out.post = m.compact_metadata.post_tokens
      } else if (m.type === 'system' && m.subtype === 'status' && m.compact_result === 'failed') {
        // The reason comes in the result that follows ("Not enough messages to compact")
        failed = m.compact_error || 'compaction failed'
      } else if (m.type === 'result') {
        const said = m.subtype === 'success' ? m.result : m.errors?.join('\n')
        if (m.is_error || failed) throw new Error(said || failed || 'compaction failed')
        out.sessionId = m.session_id
        out.context = (await contextOf(q)) ?? undefined
        break
      }
    }
  } catch (e) {
    if (hardStop.signal.aborted) throw new Error('compaction took over 20 minutes')
    throw e
  } finally {
    clearTimeout(timer)
    release()
  }
  return out
}

const promptContent = (text: string, images?: PromptImage[]) => (images?.length
  ? [...images.map(i => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mime, data: i.data } })), { type: 'text' as const, text }]
  : text)

// The session's input: the prompt, then what is handed in during the turn. send() resolves once the SDK has written the
// message and come back for the next one, or the turn is over and it never will
export function createTurnInput(first: SDKUserMessage, finished: Promise<void>) {
  const waiting: { m: SDKUserMessage, written: () => void }[] = []
  let writing: (() => void) | undefined
  let wake = () => {}
  let over = false
  finished.then(() => {
    over = true
    writing?.()
    for (const w of waiting.splice(0)) w.written()
    wake()
  })
  return {
    send: (m: SDKUserMessage) => new Promise<void>(written => {
      if (over) return written()
      waiting.push({ m, written })
      wake()
    }),
    async* stream() {
      yield first
      while (!over) {
        const next = waiting.shift()
        if (next) {
          writing = next.written
          yield next.m
          next.written()
        } else await new Promise<void>(r => (wake = r))
      }
    },
  }
}

// After a batch of tools the CLI reads what came on its input before the next model request, as a real user message that
// can carry pictures. Context added by a hook was seen and refused as an injection. Sent any earlier, a message may wait
// for the end of the turn and start a second one
export function handInHook(handIn: NonNullable<TurnOptions['handIn']>, send: (m: SDKUserMessage) => Promise<void>, sent: Set<string>) {
  return async () => {
    const m = await handIn.take()
    if (m) {
      sent.add(m.id)
      await send({ type: 'user', uuid: m.id as SDKUserMessage['uuid'], message: { role: 'user', content: promptContent(m.text, m.images) }, parent_tool_use_id: null, session_id: '', priority: 'next' })
    }
    return {}
  }
}

// One user turn against Claude Code with every built-in tool that could touch the server switched off (§9.4)
export async function runTurn(o: TurnOptions): Promise<TurnResult> {
  // Streaming input keeps the control channel open: only there does interrupt() exist, and it
  // stops the turn at once. The SDK's abortController alone lets the model keep going for
  // seconds after Stop — long enough to answer or even call another tool
  let release!: () => void
  const finished = new Promise<void>(r => (release = r))
  const input = createTurnInput({ type: 'user', message: { role: 'user', content: promptContent(o.prompt, o.images) }, parent_tool_use_id: null, session_id: '' }, finished)
  const handedIn = new Set<string>()
  const hardStop = new AbortController()
  const remote = o.remote ?? {}
  const remoteServers = Object.fromEntries(Object.entries(remote).map(([name, url]) => [name, { type: 'http' as const, url }]))
  const remoteOf = (tool: string) => Object.keys(remote).find(n => tool.startsWith(remotePrefix(n)))

  // Read-only flags of remote tools, as their servers annotate them (Figma marks its 24 reading tools);
  // looked up when Claude first calls one, by then the server is connected
  const readOnly = new Map<string, boolean>()
  async function readOnlyOf(tool: string) {
    if (!readOnly.has(tool)) {
      for (const s of await q.mcpServerStatus().catch(() => [])) {
        if (!(s.name in remote)) continue
        for (const t of s.tools ?? []) readOnly.set(remotePrefix(s.name) + t.name, t.annotations?.readOnly === true)
      }
    }
    return readOnly.get(tool)
  }

  const q = query({
    prompt: input.stream(),
    options: {
      cwd: o.cwd,
      resume: o.sessionId || undefined,
      // Prompts come from Telegram, files, transcripts and other Claude sessions: the CLI must take them as
      // written. Otherwise an «@/path» anywhere in them pulls that file of the server into the conversation
      verbatimPrompts: true,
      model: o.model || undefined,
      effort: o.effort,
      env: o.env,
      ...(o.compactWindow && { settings: { autoCompactWindow: o.compactWindow } }),
      tools: [...HOST_TOOLS, ...(o.chrome ? [SERVER_READ] : [])],
      // Nothing from ~/.claude or project files on the server: no settings, hooks or MCP servers of its own
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: { ...remoteServers, ...o.appServers, ...o.botServers, ...(o.deviceServer && { [DEVICE_SERVER]: o.deviceServer }) },
      permissionMode: 'default',
      // The CLI echoes a user message when it takes it up: the one sign that a message handed in has reached Claude
      extraArgs: { ...(o.chrome && { chrome: null }), ...(o.handIn && { 'replay-user-messages': null }) },
      hooks: { ...o.chrome, ...(o.chrome && { PreToolUse: [serverReadGuard, ...(o.chrome.PreToolUse ?? [])] }), ...(o.handIn && { PostToolBatch: [{ hooks: [handInHook(o.handIn, input.send, handedIn)] }] }) },
      canUseTool: async (tool, input, opts) => o.canUseTool(tool, input, { ...opts, readOnly: remoteOf(tool) ? await readOnlyOf(tool) : undefined }),
      abortController: hardStop,
      includePartialMessages: true,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: o.append },
      stderr: o.onStderr,
    },
  })

  let streaming = ''
  let lastText = ''
  let result: TurnResult | null = null
  let guard: Error | null = null
  let errorKind: SDKAssistantMessageError | undefined
  let stopped = false
  let hardTimer: NodeJS.Timeout | undefined
  const onStop = () => {
    stopped = true
    q.interrupt().catch(() => {})
    hardTimer = setTimeout(() => hardStop.abort(), HARD_STOP_MS)
  }
  if (o.abortController.signal.aborted) onStop()
  else o.abortController.signal.addEventListener('abort', onStop, { once: true })

  o.onApiWait?.(true)
  const tools = createToolTracker()
  try {
    for await (const m of q) {
      if (m.type === 'user' && 'isReplay' in m) {
        if (m.uuid && handedIn.delete(m.uuid)) o.handIn?.landed(m.uuid)
        continue
      }
      // After Stop nothing more reaches the user: whatever the CLI still emits is not their answer
      if (stopped) {
        if (m.type === 'result') break
        continue
      }
      if (m.type === 'system' && m.subtype === 'init') {
        // Enforced in code, not in the prompt: any tool besides the device ones means the
        // server could act on itself, so the turn stops before the model sees it (§9.4)
        const appPrefixes = [...Object.keys(o.appServers ?? {}), ...Object.keys(o.botServers ?? {})].map(appToolPrefix)
        const foreign = m.tools.filter(t => !isDeviceTool(t) && !HOST_TOOLS.has(t) && !appPrefixes.some(p => t.startsWith(p)) && !remoteOf(t) && !(o.chrome && (isChromeTool(t) || t === SERVER_READ)))
        if (foreign.length) {
          guard = new Error(`Tools of the server itself turned out to be available (${foreign.join(', ')}): the turn was stopped`)
          hardStop.abort()
          break
        }
        o.onSession?.(m.session_id)
        o.onRemoteStatus?.(m.mcp_servers.filter(s => s.name in remote))
      } else if (m.type === 'rate_limit_event') {
        o.onRateLimit?.(m.rate_limit_info)
      } else if (m.type === 'system' && m.subtype === 'api_retry') {
        o.onRetry?.(m)
      } else if (m.type === 'system' && m.subtype === 'status') {
        o.onCompacting?.(m.status === 'compacting')
      } else if (m.type === 'system' && m.subtype === 'compact_boundary') {
        o.onCompacted?.({ pre: m.compact_metadata.pre_tokens, post: m.compact_metadata.post_tokens })
      } else if (m.type === 'user' && !m.parent_tool_use_id) {
        // Tool results went back to the model: waiting on the API again
        if (tools.answered(m.message.content)) o.onApiWait?.(true)
      } else if (m.type === 'stream_event' && !m.parent_tool_use_id) {
        o.onApiWait?.(false)
        const e = m.event
        if (e.type === 'message_start') streaming = ''
        if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') {
          streaming += e.delta.text
          o.onText?.(streaming)
        }
      } else if (m.type === 'assistant' && !m.parent_tool_use_id) {
        if (m.error) errorKind = m.error
        tools.called(m.message.content)
        for (const b of m.message.content) {
          if (b.type === 'tool_use') o.onStep?.(b.name, b.input as Record<string, unknown>)
        }
        const t = m.message.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('')
        if (t) lastText = t
      } else if (m.type === 'result') {
        const text = (m.subtype === 'success' ? m.result : m.errors?.join('\n')) || lastText
        const resumeFailed = m.is_error && !!o.sessionId && RESUME_MISSING.test(text)
        // A failed resume reports a throwaway id; storing it would hide the real problem
        if (!resumeFailed) o.onSession?.(m.session_id)
        const u = m.usage
        const usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 }
        result = { isError: m.is_error, text, durationMs: m.duration_ms, sessionId: m.session_id, resumeFailed, usage, errorKind }
        // While the session is still open: how full it is now, for the offer to compact it
        if (!m.is_error) result.context = (await contextOf(q)) ?? undefined
        // Streaming input keeps the session open for more prompts; one turn is all we need
        break
      }
    }
  } catch (e) {
    // The SDK throws after an error result; the result itself is the better message
    if (!result && !stopped && !guard) throw e
  } finally {
    clearTimeout(hardTimer)
    o.abortController.signal.removeEventListener('abort', onStop)
    release()
  }
  if (guard) throw guard
  if (stopped) return { aborted: true, text: lastText || streaming }
  return result ?? { aborted: true, text: lastText || streaming }
}
