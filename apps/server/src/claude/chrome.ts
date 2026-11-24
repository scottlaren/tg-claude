import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import { query, type HookCallbackMatcher, type HookEvent } from '@anthropic-ai/claude-agent-sdk'

// Claude in Chrome (§10.6): the server's Claude reaches the user's browsers through their claude.ai
// account, whichever computer they run on. The CLI's own permission checks never see these calls, so
// every one passes a PreToolUse hook: the topic's own browser only, one browser at a time across topics
export const CHROME_SERVER = 'claude-in-chrome'
export const CHROME_PREFIX = `mcp__${CHROME_SERVER}__`
export const isChromeTool = (tool: string) => tool.startsWith(CHROME_PREFIX)
const LIST = `${CHROME_PREFIX}list_connected_browsers`

// profile: the Claude profile whose account the extension is signed in to, as far as the bot knows (the profile of the
// topic that chose it)
export type Browser = { deviceId: string, name: string, osPlatform?: string, connectedAt?: number, profile?: string }

// Only look at the page: no question to the user once the topic's browser is picked
// Its own tabs too: Claude can only open empty ones and close those it opened, and nobody should have to approve that
const READS = new Set(['tabs_context_mcp', 'tabs_create_mcp', 'tabs_close_mcp', 'read_page', 'get_page_text', 'find', 'read_console_messages', 'read_network_requests', 'shortcuts_list'])
const LOOKING = new Set(['screenshot', 'zoom', 'wait'])

// Chrome already goes through the server, for certain: there is nothing to ask about the way it goes online. Not when
// it was switched and hasn't restarted: then it may still be going directly
export const surelyThroughServer = (s: { supported: boolean, on: boolean, pending: boolean } | null) => !!s && s.supported && s.on && !s.pending

export type ChromeCall = 'free' | 'select' | 'read' | 'act' | { deny: string }

// What one call is, for a topic bound to `bound` that has (or has not yet) picked it in this turn
export function classifyChrome(tool: string, input: Record<string, unknown>, { bound, device, selected }: { bound: Browser, device: string, selected: boolean }): ChromeCall {
  const name = tool.slice(CHROME_PREFIX.length)
  // Not by its name: the extension's names change, and a stale one reads like another computer's browser
  const own = `${bound.osPlatform ? `(${bound.osPlatform}) ` : ''}on the computer ${device}`
  if (name === 'list_connected_browsers') return 'free'
  // It asks every browser on the account to connect, other computers' included
  if (name === 'switch_browser') return { deny: `switch_browser is not used: this topic works only with the browser ${own}; pick it with select_browser and deviceId ${bound.deviceId}.` }
  if (name === 'select_browser') {
    return input.deviceId === bound.deviceId ? 'select' : { deny: `This topic works only with the browser ${own} (deviceId ${bound.deviceId}). Other browsers belong to other computers.` }
  }
  // Until the topic's browser is picked in this turn, the CLI may be pointed at any browser on the account
  if (!selected) return { deny: `First select_browser with deviceId ${bound.deviceId}: that is the browser ${own}.` }
  if (READS.has(name)) return 'read'
  if (name === 'computer' && LOOKING.has(String(input.action))) return 'read'
  return 'act'
}

// The CLI keeps one chosen browser for the whole profile (one lock per profile): topics on the same browser share
// it, a topic on another browser waits until they are done (§10.6)
export function createBrowserLock() {
  let current: { browser: string, holders: Set<string> } | null = null
  let waiters: (() => void)[] = []
  return {
    busyFor: (browser: string) => !!current && current.browser !== browser,
    // The browser a holder has, if any
    holds: (holder: string) => (current?.holders.has(holder) ? current.browser : undefined),
    async acquire(browser: string, holder: string, signal: AbortSignal) {
      while (current && current.browser !== browser) {
        if (signal.aborted) throw new Error('Stopped by the user.')
        await new Promise<void>(resolve => {
          waiters.push(resolve)
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      }
      current ??= { browser, holders: new Set() }
      current.holders.add(holder)
    },
    release(holder: string) {
      if (!current?.holders.delete(holder) || current.holders.size) return
      current = null
      const w = waiters
      waiters = []
      for (const wake of w) wake()
    },
  }
}

// The list tool answers with MCP content: a text block holding the JSON array
export function parseBrowsers(response: unknown): Browser[] {
  const content = Array.isArray(response) ? response : (response as { content?: unknown })?.content
  const texts = Array.isArray(content) ? content.map(c => (c as { text?: string })?.text).filter(Boolean) as string[] : [String(response ?? '')]
  for (const t of texts) {
    try {
      const v = JSON.parse(t)
      if (Array.isArray(v)) return v.filter(b => typeof b?.deviceId === 'string')
    } catch {}
  }
  return []
}

const allow = { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'allow' as const } }
const deny = (reason: string) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: reason } })

// Browsers connected to the account right now, for the binding buttons: one short Haiku turn that may
// call nothing but the list tool
export async function listBrowsers({ cwd, env }: { cwd: string, env: Record<string, string | undefined> }): Promise<Browser[]> {
  let found: Browser[] = []
  const q = query({
    prompt: 'Call mcp__claude-in-chrome__list_connected_browsers once, then reply with the single word done.',
    options: {
      cwd, env, model: 'haiku', tools: ['ToolSearch'], settingSources: [], strictMcpConfig: true, maxTurns: 4, verbatimPrompts: true,
      extraArgs: { chrome: null },
      hooks: {
        PreToolUse: [{ hooks: [async i => (i.hook_event_name === 'PreToolUse' && (i.tool_name === 'ToolSearch' || i.tool_name === LIST) ? allow : deny('Only the list of browsers'))] }],
        PostToolUse: [{ hooks: [async i => {
          if (i.hook_event_name === 'PostToolUse' && i.tool_name === LIST) found = parseBrowsers(i.tool_response)
          return {}
        }] }],
      },
    },
  })
  for await (const m of q) if (m.type === 'result') break
  return found
}

// The hooks a turn with the browser on gets: every Chrome call is decided by `gate` before it runs (and may run with
// an input of its own);
// `picked` learns whether select_browser really switched (a browser that is offline leaves the old one);
// `listed` sees what the list tool said, and may answer with a note for Claude next to it
export function chromeHooks(
  gate: (tool: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<true | string | { input: Record<string, unknown> }>,
  picked: (ok: boolean) => void,
  listed: (browsers: Browser[]) => string | undefined = () => undefined,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const SELECT = `${CHROME_PREFIX}select_browser`
  return {
    // A permission question in Telegram may wait up to 30 minutes
    PreToolUse: [{ timeout: 3600, hooks: [async (i, _id, { signal }) => {
      if (i.hook_event_name !== 'PreToolUse' || !isChromeTool(i.tool_name)) return {}
      const d = await gate(i.tool_name, i.tool_input as Record<string, unknown>, signal)
      if (d === true) return allow
      return typeof d === 'string' ? deny(d) : { hookSpecificOutput: { ...allow.hookSpecificOutput, updatedInput: d.input } }
    }] }],
    PostToolUse: [{ hooks: [async i => {
      if (i.hook_event_name === 'PostToolUse' && i.tool_name === LIST) {
        const note = listed(parseBrowsers(i.tool_response))
        return note ? { hookSpecificOutput: { hookEventName: 'PostToolUse' as const, additionalContext: note } } : {}
      }
      if (i.hook_event_name === 'PostToolUse' && i.tool_name === SELECT) picked(!/error|not (found|connected)|fail|unavailable/i.test(JSON.stringify(i.tool_response)))
      return {}
    }] }],
    PostToolUseFailure: [{ hooks: [async i => {
      if (i.hook_event_name === 'PostToolUseFailure' && i.tool_name === SELECT) picked(false)
      return {}
    }] }],
  }
}

// Loose match of the extension's OS name to ours: a Mac browser can't be a Windows computer's
export function sameOs(osPlatform: string | undefined, os: 'windows' | 'macos' | 'linux') {
  if (!osPlatform) return true
  const p = osPlatform.toLowerCase()
  return os === 'windows' ? p.includes('win') : os === 'macos' ? p.includes('mac') : p.includes('linux')
}

// Screenshots the Chrome integration saves (save_to_disk) land in the temp folder of the server's Claude,
// not on the computer: the bot reads them from there, and from nowhere else on the server
export function chromeScreenshot(path: string, tmp = tmpdir()): string | null {
  const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)
  const file = resolve(path)
  const rel = relative(norm(resolve(tmp)), norm(file))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  const parts = rel.split(sep)
  const ok = parts.length === 2 && /^claude-chrome-screenshots-[\w-]+$/.test(parts[0]) && /^[\w.-]+\.(jpe?g|png|webp)$/.test(parts[1])
  return ok && existsSync(file) ? file : null
}
