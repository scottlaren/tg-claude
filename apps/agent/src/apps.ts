import { spawn, execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'
import type { AppState, ToolInput, ToolResult } from '@tgcv/protocol'
import { resolveInRoot, ToolError, type Roots } from './paths.ts'
import type { McpHub } from './mcp.ts'

export type AppConfig = {
  name?: string
  // A `*` folder picks the newest match: Roblox Studio moves to a new version folder on every update
  exe: string
  args?: string[]
  // Process image name used to see whether it runs and to close it; defaults to the exe name
  process?: string
  // MCP server that talks to this app, and the call that proves the app is ready for it
  mcp?: string
  ready?: { tool: string, args?: Record<string, unknown>, expect?: string }
  startTimeoutSec?: number
}

const POLL_MS = 3000
const CLOSE_WAIT_MS = 20_000

// Expands `*` path segments (C:\Program Files\Roblox\Versions\*\RobloxStudioBeta.exe), newest first
export function resolveExe(pattern: string): string | null {
  const parts = pattern.split(/[\\/]/)
  let candidates = [parts[0] || sep]
  for (const part of parts.slice(1)) {
    if (!part.includes('*')) {
      candidates = candidates.map(c => join(c, part))
      continue
    }
    const re = new RegExp('^' + part.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')
    candidates = candidates.flatMap(c => {
      try {
        return readdirSync(c).filter(n => re.test(n)).map(n => join(c, n))
      } catch {
        return []
      }
    })
  }
  const found = candidates.filter(c => existsSync(c))
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return found[0] ?? null
}

const run = (bin: string, args: string[]) => new Promise<string>(resolve => {
  execFile(bin, args, { windowsHide: true, timeout: 15000 }, (_err, stdout) => resolve(String(stdout ?? '')))
})

const processName = (cfg: AppConfig) => cfg.process ?? basename(cfg.exe)

export async function isRunning(name: string) {
  if (process.platform === 'win32') {
    const out = await run('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'])
    return out.toLowerCase().includes(`"${name.toLowerCase()}"`)
  }
  const out = await run('pgrep', ['-x', name.replace(/\.app$/, '')])
  return out.trim().length > 0
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const t = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
})

// An MCP server alone doesn't drive these: a part of it runs inside the app, and only the user can turn that on
const INSIDE_APP: Record<string, string> = {
  'after-effects': 'After Effects also needs the MCP bridge script running in it: ask the user to check.',
  blender: 'Blender also needs its MCP add-on turned on: ask the user to check.',
}

export function createApps(apps: Record<string, AppConfig>, mcp: McpHub | undefined) {
  const get = (id: string) => {
    const cfg = apps[id]
    if (!cfg) throw new ToolError('not_found', `App ${id} is not set up on this device. Available: ${Object.keys(apps).join(', ') || 'none'}`)
    return cfg
  }

  // Ready = its MCP answers the readiness call; without a probe, a running process is enough
  async function probe(cfg: AppConfig, signal: AbortSignal): Promise<string | null> {
    if (!cfg.ready || !cfg.mcp || !mcp) return (await isRunning(processName(cfg))) ? null : 'the process has not appeared yet'
    try {
      const r = await mcp.call(cfg.mcp, cfg.ready.tool, cfg.ready.args ?? {}, AbortSignal.any([signal, AbortSignal.timeout(15000)]))
      const text = r.content.map(c => ((c as { type: string }).type === 'text' ? (c as { text: string }).text : '')).join(' ')
      if (r.isError) return text.slice(0, 200) || 'the app answered with an error'
      if (cfg.ready.expect && !text.includes(cfg.ready.expect)) return `the answer lacks "${cfg.ready.expect}"`
      return null
    } catch (e) {
      return (e as Error).message.slice(0, 200)
    }
  }

  return {
    names: () => Object.entries(apps).map(([id, cfg]) => ({ id, name: cfg.name ?? id, mcp: cfg.mcp })),

    async list(): Promise<ToolResult['list_apps']> {
      const out: AppState[] = []
      for (const [id, cfg] of Object.entries(apps)) {
        out.push({ id, name: cfg.name ?? id, running: await isRunning(processName(cfg)), mcp: cfg.mcp })
      }
      return { apps: out }
    },

    async open(root: string | Roots, input: ToolInput<'open_app'>, signal: AbortSignal): Promise<ToolResult['open_app']> {
      const cfg = get(input.app)
      const file = input.file ? await resolveInRoot(root, input.file) : null
      if (file && !existsSync(file)) throw new ToolError('not_found', `No such file: ${input.file}`)
      const started = Date.now()
      const alreadyRunning = await isRunning(processName(cfg))
      if (!alreadyRunning) {
        const exe = resolveExe(cfg.exe)
        if (!exe) throw new ToolError('not_found', `${cfg.exe} not found: check the path in agent.config.json`)
        const args = [...(cfg.args ?? []), ...(file ? [file] : [])]
        // Detached with no pipes: the app outlives the call, a later /stop or timeout never kills it
        const [bin, argv] = exe.endsWith('.app') ? ['open', ['-a', exe, ...(file ? [file] : []), '--args', ...(cfg.args ?? [])]] : [exe, args]
        const child = spawn(bin, argv, { detached: true, stdio: 'ignore', cwd: dirname(exe) })
        child.on('error', () => {})
        child.unref()
      } else if (file) {
        // Already open: hand it the file the way the OS would (Windows passes it to the running instance)
        const exe = resolveExe(cfg.exe)
        if (exe) spawn(exe.endsWith('.app') ? 'open' : exe, exe.endsWith('.app') ? ['-a', exe, file] : [file], { detached: true, stdio: 'ignore' }).unref()
      }

      const deadline = started + (cfg.startTimeoutSec ?? 180) * 1000
      let last: string | null = 'not checked'
      while (!signal.aborted && Date.now() < deadline) {
        last = await probe(cfg, signal)
        if (last === null) return { alreadyRunning, ready: true, waitedMs: Date.now() - started }
        await sleep(POLL_MS, signal)
      }
      if (signal.aborted) throw new ToolError('cancelled', 'Stopped waiting; the app keeps starting')
      return {
        alreadyRunning,
        ready: false,
        waitedMs: Date.now() - started,
        note: `Started, but not ready to work within ${cfg.startTimeoutSec ?? 180} s: ${last}.${cfg.mcp && INSIDE_APP[cfg.mcp] ? ` ${INSIDE_APP[cfg.mcp]}` : ''}`,
      }
    },

    async close(input: ToolInput<'close_app'>, signal: AbortSignal): Promise<ToolResult['close_app']> {
      const cfg = get(input.app)
      const name = processName(cfg)
      if (!(await isRunning(name))) return { closed: true, forced: false, note: 'Was not running' }
      if (input.force) {
        if (process.platform === 'win32') await run('taskkill', ['/F', '/IM', name])
        else await run('pkill', ['-9', '-x', name.replace(/\.app$/, '')])
        return { closed: !(await isRunning(name)), forced: true }
      }
      // Polite close: the app may still ask "save changes?", which nobody is there to answer
      if (process.platform === 'win32') await run('taskkill', ['/IM', name])
      else await run('osascript', ['-e', `quit app "${(cfg.name ?? name).replace(/"/g, '')}"`])
      const until = Date.now() + CLOSE_WAIT_MS
      while (Date.now() < until && !signal.aborted) {
        if (!(await isRunning(name))) return { closed: true, forced: false }
        await sleep(1000, signal)
      }
      return {
        closed: false,
        forced: false,
        note: 'Did not close within 20 s: most likely it is waiting for an answer to "Save changes?". Save the project in the app and retry, or close with force (unsaved work will be lost)',
      }
    },
  }
}

export type Apps = ReturnType<typeof createApps>
