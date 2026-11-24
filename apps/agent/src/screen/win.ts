import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import type { Backend, El, Shot, Win } from './index.ts'

// The Windows side: one PowerShell running win-helper.ps1, asked one line at a time. It starts with the first action,
// compiling its C# takes a moment, and goes after a while unused
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'win-helper.ps1')
const IDLE_MS = 10 * 60_000
const CALL_MS = 30_000

// A promise or the error, and no timer left behind either way
function within<T>(p: Promise<T>, why: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([p, new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error(why)), CALL_MS) })]).finally(() => clearTimeout(timer))
}

export function winBackend({ script = SCRIPT, spawnHelper = () => spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true }) }: { script?: string, spawnHelper?: () => ChildProcessWithoutNullStreams } = {}): Backend {
  let proc: ChildProcessWithoutNullStreams | null = null
  let lines: AsyncIterator<string> | null = null
  let idle: NodeJS.Timeout | undefined
  let chain = Promise.resolve() as Promise<unknown>

  async function start() {
    const p = spawnHelper()
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
      const a = JSON.parse(r.value) as T & { error?: string }
      if (a.error) throw new Error(/handle is invalid|Неверный дескриптор/i.test(a.error) ? 'the screen is locked or asleep: nothing to see or click until someone unlocks it' : a.error)
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

  return {
    size: () => call<{ size: [number, number] }>({ op: 'screen' }).then(r => r.size),
    cursor: () => call<{ cursor: [number, number] }>({ op: 'cursor' }).then(r => r.cursor),
    windows: () => call<{ windows: Win[] }>({ op: 'windows' }).then(r => r.windows ?? []),
    rect: id => call<{ rect: [number, number, number, number] }>({ op: 'rect', id }).then(r => r.rect),
    focus: id => call<{ ok: boolean }>({ op: 'focus', id }).then(r => r.ok),
    capture: (id, x, y, w, h, maxW, maxH) => call<Shot>({ op: 'capture', id, x, y, w, h, maxW, maxH, quality: 72 }),
    fingerprint: (id, x, y, w, h) => call<{ fp: string }>({ op: 'fingerprint', id, x, y, w, h }).then(r => r.fp),
    idle: () => call<{ idle: number }>({ op: 'idle' }).then(r => r.idle),
    foreground: () => call<{ id: number }>({ op: 'foreground' }).then(r => r.id),
    act: (index, kind, text, open) => call<{ failed?: string }>({ op: 'act', index, kind, text: text ?? '', open: open ?? true }).then(r => r.failed ?? null),
    scrollEl: (index, dx, dy) => call<{ ok: boolean }>({ op: 'scrollEl', index, dx, dy }).then(r => r.ok),
    monitor: () => call<{ monitor: number[] | null }>({ op: 'monitor' }).then(r => r.monitor),
    park: (id, x, y, w, h) => call<{ was: number[] }>({ op: 'park', id, x, y, w, h }).then(r => r.was),
    unpark: (id, was) => call({ op: 'unpark', id, was }).then(() => {}),
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
