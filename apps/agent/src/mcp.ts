import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ToolListChangedNotificationSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import type { McpServerInfo, McpCallResult, McpTool } from '@tgcv/protocol'
import { readFileSync, writeFileSync } from 'node:fs'
import { ToolError } from './paths.ts'
import { closeIfSame, describeProcess, directCommand, type StartedProcess } from './processes.ts'

export type McpServerConfig = {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  // Renders and long scripts: the default is generous, progress notifications extend it
  callTimeoutSec?: number
  // A separate server process per topic: for servers that keep a per-connection choice, like the
  // Roblox Studio MCP's active Studio — each local Claude Code chat gets its own process too
  perTopic?: boolean
}

type Entry = {
  name: string
  cfg: McpServerConfig
  // Set for a per-topic instance; the base instance (no lane) is the one whose tools are announced
  lane?: string
  client: Client | null
  info: McpServerInfo
  ready: Promise<void>
  // One call at a time per app instance: most app bridges are not safe to drive in parallel (§10.1)
  queue: Promise<unknown>
  attempt: number
  retry?: NodeJS.Timeout
  stderrTail: string
  lastUsed: number
  // The process the agent started for it, once it runs
  proc?: StartedProcess
}

const CONNECT_TIMEOUT_MS = 30_000
const MAX_RESTART_MS = 5 * 60_000
const LANE_IDLE_MS = 30 * 60_000
const MAX_LANES = 6

const toInfoTool = (t: Tool): McpTool => ({
  name: t.name,
  title: t.title,
  description: t.description,
  inputSchema: t.inputSchema as Record<string, unknown>,
  annotations: t.annotations && {
    title: t.annotations.title,
    readOnlyHint: t.annotations.readOnlyHint,
    destructiveHint: t.annotations.destructiveHint,
  },
})

// Keeps the device's app MCP servers running; a broken one never takes the others down
export function createMcpHub(servers: Record<string, McpServerConfig>, { log, onChange, pidsFile }: {
  log: (...a: unknown[]) => void, onChange: () => void,
  // Survives the agent being killed or updated: what it left running is found at the next start
  pidsFile?: string,
}) {
  const entries = new Map<string, Entry>()
  const lanes = new Map<string, Entry>()
  let closed = false

  const label = (e: Entry) => (e.lane ? `${e.name}[${e.lane}]` : e.name)

  function savePids() {
    if (!pidsFile) return
    try {
      const running = [...entries.values(), ...lanes.values()].flatMap(e => (e.proc ? [e.proc] : []))
      writeFileSync(pidsFile, JSON.stringify(running))
    } catch (err) {
      log(`mcp: could not remember its processes: ${(err as Error).message}`)
    }
  }

  // Before anything starts: an update or a crash may have left a server of the last run holding on to the app
  async function sweepLeftovers() {
    if (!pidsFile) return
    let saved: StartedProcess[] = []
    try {
      saved = JSON.parse(readFileSync(pidsFile, 'utf8'))
    } catch {
      return
    }
    let closed = 0
    for (const p of saved) if (await closeIfSame(p)) closed++
    if (closed) log(`mcp: closed ${closed} left from the last run`)
    savePids()
  }
  const swept = sweepLeftovers().catch(err => log(`mcp: ${(err as Error).message}`))

  function fail(e: Entry, message: string) {
    const tail = e.stderrTail.trim().split('\n').slice(-3).join(' | ')
    e.info = { name: e.name, status: 'failed', error: tail ? `${message} (${tail})` : message, tools: [] }
    log(`mcp ${label(e)}: ${e.info.error}`)
    if (e.lane) {
      // A topic's own instance is simply started again on its next call
      lanes.delete(`${e.name}\0${e.lane}`)
      return
    }
    onChange()
    if (closed) return
    const delay = Math.min(MAX_RESTART_MS, 5000 * 2 ** e.attempt++)
    e.retry = setTimeout(() => { e.ready = start(e) }, delay)
  }

  async function refresh(e: Entry, client: Client) {
    const tools: McpTool[] = []
    let cursor: string | undefined
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined)
      tools.push(...page.tools.map(toInfoTool))
      cursor = page.nextCursor
    } while (cursor)
    e.info = { name: e.name, status: 'connected', version: client.getServerVersion()?.version, tools }
    if (!e.lane) onChange()
  }

  async function start(e: Entry) {
    e.info = { name: e.name, status: 'starting', tools: [] }
    e.stderrTail = ''
    const client = new Client({ name: 'tg-claude-agent', version: '0.1' })
    const launch = directCommand(e.cfg)
    const transport = new StdioClientTransport({
      command: launch.command,
      args: launch.args ?? [],
      env: { ...process.env, ...e.cfg.env } as Record<string, string>,
      cwd: e.cfg.cwd,
      stderr: 'pipe',
    })
    // Last lines of the server's stderr explain most start-up failures
    transport.stderr?.on('data', (b: Buffer) => { e.stderrTail = (e.stderrTail + b.toString()).slice(-2000) })
    client.onclose = () => {
      if (e.client !== client || closed) return
      e.client = null
      e.proc = undefined
      savePids()
      fail(e, 'the MCP process exited')
    }
    try {
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => setTimeout(() => reject(new Error('did not answer the connection within 30 s')), CONNECT_TIMEOUT_MS)),
      ])
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        refresh(e, client).catch(err => log(`mcp ${label(e)}: tools/list ${err.message}`))
      })
      await refresh(e, client)
      // Removed while it was starting
      if (!e.lane && entries.get(e.name) !== e) {
        client.onclose = undefined
        await client.close().catch(() => {})
        return
      }
      e.client = client
      e.attempt = 0
      if (pidsFile && transport.pid) {
        e.proc = await describeProcess(transport.pid) ?? undefined
        savePids()
      }
      log(`mcp ${label(e)}: ${e.info.tools.length} tools${e.info.version ? `, v${e.info.version}` : ''}`)
    } catch (err) {
      client.onclose = undefined
      await client.close().catch(() => {})
      fail(e, `failed to start: ${(err as Error).message}`)
    }
  }

  const newEntry = (name: string, cfg: McpServerConfig, lane?: string): Entry => ({
    name, cfg, lane, client: null, info: { name, status: 'starting', tools: [] },
    ready: Promise.resolve(), queue: Promise.resolve(), attempt: 0, stderrTail: '', lastUsed: Date.now(),
  })

  for (const [name, cfg] of Object.entries(servers)) {
    const e = newEntry(name, cfg)
    entries.set(name, e)
    e.ready = swept.then(() => start(e))
  }

  async function closeLane(key: string) {
    const e = lanes.get(key)
    lanes.delete(key)
    if (e?.client) {
      e.client.onclose = undefined
      await e.client.close().catch(() => {})
      e.proc = undefined
      savePids()
      log(`mcp ${label(e)}: closed`)
    }
  }

  // The topic's own instance, started on first use and closed after a quiet half hour
  function laneOf(base: Entry, lane: string) {
    const key = `${base.name}\0${lane}`
    let e = lanes.get(key)
    if (!e) {
      const same = [...lanes.entries()].filter(([, x]) => x.name === base.name)
      if (same.length >= MAX_LANES) {
        const [oldest] = same.sort(([, a], [, b]) => a.lastUsed - b.lastUsed)[0]
        closeLane(oldest)
      }
      const made = newEntry(base.name, base.cfg, lane)
      lanes.set(key, made)
      made.ready = swept.then(() => start(made))
      e = made
    }
    return e
  }

  const sweep = setInterval(() => {
    for (const [key, e] of lanes) if (Date.now() - e.lastUsed > LANE_IDLE_MS) closeLane(key)
  }, 5 * 60_000)
  sweep.unref()

  async function call(server: string, tool: string, args: Record<string, unknown>, signal: AbortSignal, lane?: string): Promise<McpCallResult> {
    const base = entries.get(server)
    if (!base) throw new ToolError('not_found', `MCP server ${server} is not set up on this device`)
    const e = base.cfg.perTopic && lane ? laneOf(base, lane) : base
    e.lastUsed = Date.now()
    await e.ready
    const run = e.queue.then(async () => {
      const client = e.client
      if (!client) throw new ToolError('unavailable', `${server} is unavailable right now${e.info.error ? `: ${e.info.error}` : ''}`)
      if (signal.aborted) throw new ToolError('cancelled', 'Stopped before starting')
      try {
        const r = await client.callTool({ name: tool, arguments: args }, undefined, {
          signal,
          timeout: (e.cfg.callTimeoutSec ?? 600) * 1000,
          resetTimeoutOnProgress: true,
        })
        return { content: (r.content as unknown[]) ?? [], structuredContent: r.structuredContent, isError: r.isError as boolean | undefined }
      } catch (err) {
        if (signal.aborted) throw new ToolError('cancelled', 'Stopped by the user')
        throw new ToolError('failed', `${server}.${tool}: ${(err as Error).message}`)
      } finally {
        e.lastUsed = Date.now()
      }
    })
    e.queue = run.catch(() => {})
    return run
  }

  return {
    swept,
    call,
    snapshot: (): McpServerInfo[] => [...entries.values()].map(e => e.info),
    info: (name: string) => entries.get(name)?.info,
    add(name: string, cfg: McpServerConfig) {
      const e = newEntry(name, cfg)
      entries.set(name, e)
      onChange()
      e.ready = swept.then(() => start(e))
    },
    async remove(name: string) {
      const e = entries.get(name)
      if (!e) return
      clearTimeout(e.retry)
      entries.delete(name)
      for (const [key, lane] of [...lanes]) if (lane.name === name) await closeLane(key)
      if (e.client) {
        e.client.onclose = undefined
        await e.client.close().catch(() => {})
      }
      e.proc = undefined
      savePids()
      onChange()
      log(`mcp ${name}: removed`)
    },
    lanes: () => [...lanes.values()].map(e => ({ server: e.name, lane: e.lane!, status: e.info.status })),
    // The user's tap when an app's server hangs on a call (a bridge still waiting for an app that was restarted): its
    // process goes, the call that hung fails with that, and the server starts again by itself in a few seconds
    async restart(name: string) {
      const e = entries.get(name)
      if (!e) return { restarted: false, error: `No MCP server «${name}» on this computer` }
      for (const [key, lane] of [...lanes]) if (lane.name === name) await closeLane(key)
      log(`mcp ${name}: restarted by the user`)
      if (e.client) await e.client.close().catch(() => {})
      return { restarted: true }
    },
    async close() {
      closed = true
      clearInterval(sweep)
      for (const key of [...lanes.keys()]) await closeLane(key)
      for (const e of entries.values()) {
        clearTimeout(e.retry)
        await e.client?.close().catch(() => {})
        e.proc = undefined
        savePids()
      }
    },
  }
}

export type McpHub = ReturnType<typeof createMcpHub>
