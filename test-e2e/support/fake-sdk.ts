// The narrowest stand-in for Claude: the real SDK's createSdkMcpServer and tool, and a query() that plays a script instead
// of talking to a model. A step calling a tool goes the way the real CLI takes it: the message that names it, the bot's
// canUseTool, the real handler of the real in-process server, the result back in the stream.
//
// A message holding SCRIPT:<name> plays <E2E_DIR>/scripts/<name>.json. Any other message gets an echo. Sessions are files, so
// a turn cut off by a restart goes on with the step after the one it was in, as Claude would after reading the
// continuation prompt. Everything Claude "saw" goes to <E2E_DIR>/journal.jsonl
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.env.E2E_DIR!
const real = await import(new URL('../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs', import.meta.url).href)
export const { createSdkMcpServer, tool } = real

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Step =
  | { text: string }
  // deny: what a test expects of the permission; result lands in the journal either way
  | { tool: string, input?: Record<string, unknown> }
  | { sleep: number }
  // Waits for a file a test writes; mark writes one a test waits for
  | { wait: string }
  | { mark: string }
  | { errorKind: string, text?: string }
  | { throw: string }
  | { limit: Record<string, unknown> }
  | { compacting: true }

const journal = (e: Record<string, unknown>) => appendFileSync(join(dir, 'journal.jsonl'), JSON.stringify({ at: Date.now(), ...e }) + '\n')
const sessionFile = (id: string) => join(dir, 'sessions', `${id}.json`)
const flag = (name: string) => join(dir, 'flags', name)
mkdirSync(join(dir, 'sessions'), { recursive: true })
mkdirSync(join(dir, 'flags'), { recursive: true })

type Session = { script?: string, next: number }
const readSession = (id: string): Session | null => {
  try {
    return JSON.parse(readFileSync(sessionFile(id), 'utf8'))
  } catch {
    return null
  }
}
const saveSession = (id: string, s: Session) => writeFileSync(sessionFile(id), JSON.stringify(s))

const textOf = (content: unknown): string => (typeof content === 'string' ? content : (content as { type: string, text?: string }[]).filter(b => b.type === 'text').map(b => b.text).join('\n'))
const imagesOf = (content: unknown) => (typeof content === 'string' ? 0 : (content as { type: string }[]).filter(b => b.type === 'image').length)

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// MCP tool name → its server and the handler registered there
function findTool(mcpServers: Record<string, any>, name: string) {
  const m = name.match(/^mcp__([\w-]+)__(.+)$/)
  if (!m) return null
  const server = mcpServers[m[1]]
  const t = server?.instance?._registeredTools?.[m[2]]
  return t ? { server: m[1], tool: t } : null
}

const toolNames = (mcpServers: Record<string, any>) => [
  ...Object.entries(mcpServers).flatMap(([s, cfg]) => Object.keys(cfg?.instance?._registeredTools ?? {}).map(t => `mcp__${s}__${t}`)),
]

export function query({ prompt, options = {} }: { prompt: string | AsyncIterable<any>, options?: any }) {
  let interrupted = false
  let wake = () => {}
  const stopped = new Promise<void>(r => (wake = r))
  const hard: AbortController | undefined = options.abortController
  const halted = () => interrupted || !!hard?.signal.aborted

  // Sleeps and waits give way to Stop, and tools do too: a real interrupt doesn't wait for a command
  const orStop = async <T>(work: Promise<T>): Promise<T | undefined> => Promise.race([work, stopped.then(() => undefined)])
  const sleep = (ms: number) => orStop(new Promise<void>(r => {
    const t = setTimeout(r, ms)
    t.unref?.()
  }))

  async function* play(): AsyncGenerator<any> {
    const started = Date.now()
    const sessionId: string = options.resume ?? randomUUID()
    // Helpers with a fixed text prompt: the topic's title, the list of browsers
    if (typeof prompt === 'string') {
      journal({ kind: 'helper', model: options.model, prompt: prompt.slice(0, 200) })
      yield { type: 'system', subtype: 'init', session_id: sessionId, tools: [], mcp_servers: [] }
      yield { type: 'result', subtype: 'success', is_error: false, result: 'E2E title', session_id: sessionId, usage, duration_ms: 1 }
      return
    }
    const input = prompt[Symbol.asyncIterator]()
    const first = await input.next()
    if (first.done) return
    const content = first.value.message.content
    const said = textOf(content)

    if (said === '/compact') {
      journal({ kind: 'compact', session: sessionId })
      yield { type: 'system', subtype: 'compact_boundary', compact_metadata: { pre_tokens: 1000, post_tokens: 100, trigger: 'manual' }, session_id: sessionId }
      yield { type: 'result', subtype: 'success', is_error: false, result: '', session_id: sessionId, usage, duration_ms: 1 }
      return
    }

    // The CLI refuses a session it doesn't know, before anything else
    if (options.resume && !existsSync(sessionFile(options.resume))) {
      journal({ kind: 'resume-missing', session: options.resume })
      yield { type: 'result', subtype: 'error_during_execution', is_error: true, errors: [`No conversation found with session ID: ${options.resume}`], session_id: randomUUID(), usage, duration_ms: 1 }
      return
    }

    const mcpServers = options.mcpServers ?? {}
    const tools = [...(options.tools ?? []), ...toolNames(mcpServers)]
    journal({
      kind: 'turn', session: sessionId, resumed: !!options.resume, model: options.model, effort: options.effort, cwd: options.cwd,
      prompt: said, images: imagesOf(content), append: options.systemPrompt?.append?.length, servers: Object.keys(mcpServers),
      remoteServers: Object.entries(mcpServers).filter(([, c]: any) => c?.type === 'http').map(([n]) => n),
      appendText: options.systemPrompt?.append,
    })
    yield { type: 'system', subtype: 'init', session_id: sessionId, tools, mcp_servers: [] }

    // What the user hands in during the turn: read as the CLI reads it, once a batch of tools is over
    const handedIn: any[] = []
    const writer = (async () => {
      for (;;) {
        const next = await input.next()
        if (next.done) return
        handedIn.push(next.value)
      }
    })()
    void writer

    const continuing = /^\[(The server was restarted|Claude's usage limit ran out)/.test(said)
    const named = continuing ? null : [...said.matchAll(/SCRIPT:([\w-]+)/g)].at(-1)?.[1]
    let session: Session = readSession(sessionId) ?? { next: 0 }
    if (named) session = { script: named, next: 0 }
    const steps: Step[] = (named || continuing) && session.script ? JSON.parse(readFileSync(join(dir, 'scripts', `${session.script}.json`), 'utf8')) : []
    if (!named && !continuing) session = { next: 0 }
    saveSession(sessionId, session)

    let finalText: string = named || continuing ? '' : `echo: ${said.slice(-300).replace(/\s+/g, ' ')}`
    let errorKind: string | undefined
    let errorResult: string | undefined

    for (let i = session.next; i < steps.length && !halted(); i++) {
      const step = steps[i]
      saveSession(sessionId, { ...session, next: i + 1 })
      if ('errorKind' in step) {
        errorKind = step.errorKind
        errorResult = step.text ?? 'API Error'
        yield { type: 'assistant', error: step.errorKind, message: { content: [{ type: 'text', text: errorResult }] }, parent_tool_use_id: null, session_id: sessionId }
        break
      } else if ('text' in step) {
        finalText = step.text ?? ''
        yield { type: 'stream_event', event: { type: 'message_start' }, parent_tool_use_id: null, session_id: sessionId }
        yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: finalText } }, parent_tool_use_id: null, session_id: sessionId }
        yield { type: 'assistant', message: { content: [{ type: 'text', text: finalText }] }, parent_tool_use_id: null, session_id: sessionId }
      } else if ('sleep' in step) {
        await sleep(step.sleep)
      } else if ('wait' in step) {
        while (!existsSync(flag(step.wait)) && !halted()) await sleep(30)
      } else if ('mark' in step) {
        writeFileSync(flag(step.mark), '1')
      } else if ('throw' in step) {
        throw new Error(step.throw)
      } else if ('limit' in step) {
        yield { type: 'rate_limit_event', rate_limit_info: step.limit, session_id: sessionId }
      } else if ('compacting' in step) {
        yield { type: 'system', subtype: 'status', status: 'compacting', session_id: sessionId }
        yield { type: 'system', subtype: 'status', status: null, session_id: sessionId }
      } else {
        const toolInput = step.input ?? {}
        const id = `toolu_${randomUUID().slice(0, 8)}`
        yield { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: step.tool, input: toolInput }] }, parent_tool_use_id: null, session_id: sessionId }
        const found = findTool(mcpServers, step.tool)
        const verdict: any = await orStop(options.canUseTool(step.tool, toolInput, {
          signal: hard?.signal ?? new AbortController().signal,
          toolUseID: id,
          ...(found && { mcpServer: { source: 'sdk', name: found.server } }),
        }))
        if (verdict === undefined) break
        let result: { text: string, isError: boolean }
        if (verdict.behavior !== 'allow') {
          result = { text: verdict.message ?? 'denied', isError: true }
        } else if (step.tool === 'AskUserQuestion') {
          result = { text: JSON.stringify(verdict.updatedInput?.answers ?? {}), isError: false }
        } else if (!found) {
          result = { text: `No such tool: ${step.tool}`, isError: true }
        } else {
          const schema = found.tool.inputSchema
          const parsed = schema?.safeParse ? schema.safeParse(verdict.updatedInput ?? toolInput) : { success: true, data: verdict.updatedInput ?? toolInput }
          if (!parsed.success) result = { text: `Invalid input: ${parsed.error.message}`, isError: true }
          else {
            try {
              const r = await orStop<any>(found.tool.handler(parsed.data, { signal: hard?.signal }))
              if (r === undefined) break
              result = { text: r.content.map((c: any) => c.text ?? `[${c.type}]`).join('\n'), isError: !!r.isError }
            } catch (e) {
              result = { text: `Tool threw: ${(e as Error).message}`, isError: true }
            }
          }
        }
        journal({ kind: 'tool', session: sessionId, tool: step.tool, verdict: verdict.behavior, ...result })
        yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: result.text, is_error: result.isError }] }, parent_tool_use_id: null, session_id: sessionId }
        for (const h of options.hooks?.PostToolBatch ?? []) for (const fn of h.hooks) await fn({ hook_event_name: 'PostToolBatch' })
        await new Promise(r => setTimeout(r, 20))
        for (const m of handedIn.splice(0)) {
          journal({ kind: 'handin', session: sessionId, prompt: textOf(m.message.content), images: imagesOf(m.message.content) })
          yield { type: 'user', isReplay: true, uuid: m.uuid, message: m.message, session_id: sessionId, parent_tool_use_id: null }
        }
      }
    }

    if (hard?.signal.aborted) throw new Error('Claude Code process aborted by user')
    const duration_ms = Date.now() - started
    if (interrupted) {
      yield { type: 'result', subtype: 'error_during_execution', is_error: true, errors: [], session_id: sessionId, usage, duration_ms }
      return
    }
    if (errorResult) {
      yield { type: 'result', subtype: 'success', is_error: true, result: errorResult, session_id: sessionId, usage, duration_ms }
      void errorKind
      return
    }
    journal({ kind: 'answer', session: sessionId, text: finalText })
    if (!steps.length || !continuing) {
      yield { type: 'stream_event', event: { type: 'message_start' }, parent_tool_use_id: null, session_id: sessionId }
    }
    yield { type: 'result', subtype: 'success', is_error: false, result: finalText, session_id: sessionId, usage, duration_ms }
  }

  const gen = play()
  return Object.assign(gen, {
    interrupt: async () => {
      interrupted = true
      wake()
    },
    getContextUsage: async () => ({ totalTokens: 1000, maxTokens: 200_000 }),
    mcpServerStatus: async () => [],
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 12, resets_at: new Date(Date.now() + 3600_000).toISOString() },
        seven_day: { utilization: 34, resets_at: new Date(Date.now() + 86400_000).toISOString() },
      },
    }),
    close: () => {},
  })
}
