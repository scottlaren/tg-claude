import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import type { Backend, El, Shot, Win } from './index.ts'

// The macOS side: one helper of our own, mac-helper.swift, asked one line at a time. It is compiled on first use
// into the agent's data folder (an update of the source compiles it again) and goes after a while unused
const SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'mac-helper.swift')
const IDLE_MS = 10 * 60_000
const CALL_MS = 30_000
const COMPILE_MS = 5 * 60_000

const PERMISSIONS = {
  screen: { name: 'Screen Recording', pane: 'Screen & System Audio Recording' },
  ax: { name: 'Accessibility', pane: 'Accessibility' },
} as const

// Why the screen can't be offered here, or null: the helper needs a Swift compiler
export function macScreenMissing(run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: 'ignore', timeout: 15_000 })): string | null {
  try {
    // Checked first: without the tools, xcrun would offer to install them on the user's screen
    run('xcode-select', ['-p'])
    run('xcrun', ['--find', 'swiftc'])
    return null
  } catch {
    return 'no Swift compiler: install the Xcode Command Line Tools (xcode-select --install) and restart the agent'
  }
}

// macOS gives a permission to the app a process belongs to: the one launchd started, up the process tree (the
// terminal the agent was started from, or node itself when it runs at login)
export function permissionHolder(ps = (pid: number) => execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 }), pid = process.pid) {
  let path = process.execPath
  try {
    for (let i = 0; i < 40; i++) {
      const m = ps(pid).trim().match(/^(\d+)\s+(.+)$/)
      if (!m) break
      path = m[2]
      if (+m[1] <= 1) break
      pid = +m[1]
    }
  } catch {}
  const app = path.match(/^(.*?\.app)\/Contents\//)?.[1]
  if (app) return `${basename(app, '.app')} (${app})`
  try { path = realpathSync(path) } catch {}
  return `${basename(path)} (${path})`
}

export const permissionMessage = (need: keyof typeof PERMISSIONS, holder: string) =>
  `${PERMISSIONS[need].name} is off for ${holder}: the user turns it on in System Settings → Privacy & Security → ${PERMISSIONS[need].pane} (if it isn't listed, add it with +), then you try again; if it still says so, the agent needs a restart`

const sh = (cmd: string, args: string[]) => new Promise<void>((ok, no) => {
  execFile(cmd, args, { timeout: COMPILE_MS, maxBuffer: 4 << 20 }, (e, _out, err) => (e ? no(new Error(`${String(err).trim().split('\n').find(l => /error/.test(l)) ?? e.message}`)) : ok()))
})

// The helper's binary for this source: built once, under a temporary name so a half-written one never runs
export async function helperBinary(cacheDir: string, { source = SOURCE, compile = (src: string, out: string) => sh('xcrun', ['swiftc', '-O', '-swift-version', '5', '-o', out, src]) } = {}) {
  const hash = createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 16)
  const bin = join(cacheDir, `mac-helper-${hash}`)
  if (existsSync(bin)) return bin
  mkdirSync(cacheDir, { recursive: true })
  const tmp = `${bin}.${process.pid}.tmp`
  try {
    await compile(source, tmp)
    renameSync(tmp, bin)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw new Error(`the screen helper didn't compile: ${(e as Error).message}`)
  }
  // The builds of older sources
  for (const f of readdirSync(cacheDir)) if (f.startsWith('mac-helper-') && f !== basename(bin)) rmSync(join(cacheDir, f), { force: true })
  return bin
}

// A promise or the error, and no timer left behind either way
function within<T>(p: Promise<T>, why: string, ms = CALL_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([p, new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error(why)), ms) })]).finally(() => clearTimeout(timer))
}

export function macBackend({ cacheDir, binary = () => helperBinary(cacheDir), spawnHelper = (bin: string) => spawn(bin, [], { stdio: 'pipe' }), holder = permissionHolder }: {
  cacheDir: string, binary?: () => Promise<string>, spawnHelper?: (bin: string) => ChildProcessWithoutNullStreams, holder?: () => string,
}): Backend {
  let proc: ChildProcessWithoutNullStreams | null = null
  let lines: AsyncIterator<string> | null = null
  let idle: NodeJS.Timeout | undefined
  let chain = Promise.resolve() as Promise<unknown>

  async function start() {
    const p = spawnHelper(await within(binary(), "the screen helper didn't compile in time", COMPILE_MS))
    let err = ''
    p.stderr.on('data', d => { err = (err + d).slice(-2000) })
    p.on('exit', () => {
      if (proc === p) { proc = null; lines = null }
    })
    const it = createInterface({ input: p.stdout })[Symbol.asyncIterator]()
    const first = await within(it.next(), "the screen helper didn't start").catch(e => {
      p.kill()
      throw new Error(`${(e as Error).message}: ${err.trim().split('\n')[0] ?? ''}`)
    })
    if (first.done || !JSON.parse(first.value).ready) throw new Error(`the screen helper didn't start: ${err.trim().split('\n')[0] ?? ''}`)
    proc = p
    lines = it
  }

  function call<T>(q: Record<string, unknown>): Promise<T> {
    const run = async () => {
      if (!proc) await start()
      clearTimeout(idle)
      idle = setTimeout(close, IDLE_MS).unref()
      proc!.stdin.write(`${JSON.stringify(q)}\n`)
      const r = await within(lines!.next(), 'the screen helper stopped answering')
      if (r.done) throw new Error('the screen helper ended')
      const a = JSON.parse(r.value) as T & { error?: string, need?: keyof typeof PERMISSIONS }
      if (a.need) throw new Error(permissionMessage(a.need, holder()))
      if (a.error) throw new Error(a.error)
      return a
    }
    const p = chain.then(run, run)
    chain = p.catch(() => {})
    return p
  }

  function close() {
    clearTimeout(idle)
    proc?.kill()
    proc = null
    lines = null
  }

  const none = () => Promise.reject(new Error('this computer has no virtual monitor'))
  return {
    size: () => call<{ size: [number, number] }>({ op: 'screen' }).then(r => r.size),
    cursor: () => call<{ cursor: [number, number] }>({ op: 'cursor' }).then(r => r.cursor),
    windows: () => call<{ windows: Win[] }>({ op: 'windows' }).then(r => r.windows ?? []),
    rect: id => call<{ rect: [number, number, number, number] }>({ op: 'rect', id }).then(r => r.rect),
    // Not in front, the keys and clicks would go to whatever is: better to stop there
    focus: id => call<{ ok: boolean }>({ op: 'focus', id }).then(r => {
      if (!r.ok) throw new Error("the window didn't come to the front: no clicks or keys sent")
      return true
    }),
    capture: (id, x, y, w, h, maxW, maxH) => call<Shot>({ op: 'capture', id, x, y, w, h, maxW, maxH, quality: 0.72 }),
    fingerprint: (id, x, y, w, h) => call<{ fp: string }>({ op: 'fingerprint', id, x, y, w, h }).then(r => r.fp),
    idle: () => call<{ idle: number }>({ op: 'idle' }).then(r => r.idle),
    foreground: () => call<{ id: number }>({ op: 'foreground' }).then(r => r.id),
    act: (index, kind, text, open) => call<{ failed?: string }>({ op: 'act', index, kind, text: text ?? '', open: open ?? true }).then(r => r.failed ?? null),
    scrollEl: (index, dx, dy) => call<{ ok: boolean }>({ op: 'scrollEl', index, dx, dy }).then(r => r.ok),
    // No virtual display on a Mac: parking is never offered
    monitor: async () => null,
    park: none,
    unpark: none,
    move: (x, y) => call({ op: 'move', x, y }).then(() => {}),
    click: (x, y, button, count) => call({ op: 'click', x, y, button, count }).then(() => {}),
    drag: (x, y, x2, y2) => call({ op: 'drag', x, y, x2, y2 }).then(() => {}),
    scroll: (x, y, dx, dy) => call({ op: 'scroll', x, y, dx, dy }).then(() => {}),
    type: text => call({ op: 'type', text }).then(() => {}),
    paste: text => call({ op: 'paste', text }).then(() => {}),
    keys: keys => call({ op: 'keys', keys }).then(() => {}),
    elements: (id, max) => call<{ elements: El[] }>({ op: 'elements', id, max, budget: 4000 }).then(r => r.elements ?? []),
    close,
  }
}
