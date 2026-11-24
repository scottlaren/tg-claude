import type { ScreenAction, ScreenRequest, ScreenResult } from '@tgcv/protocol'

// Claude's hands on the desktop. A helper process of the system (win.ts) does the pixels and input; here are the
// rules: which window, where a coordinate of a screenshot lands on the screen, which control a ref names, waiting for
// the screen to settle, and sharing the computer with the user. Looking and the element actions (press, set, select,
// expand, scroll by ref) leave the user's mouse and keyboard alone and go on while they work; the mouse and the
// keyboard are Claude's only once the user has stepped away, and the moment they come back they are theirs again

export type Win = { id: number, title: string, app: string, x: number, y: number, w: number, h: number, minimized: boolean, focused: boolean }
export type El = { role: string, name: string, value?: string | null, x: number, y: number, w: number, h: number, enabled: boolean }
export type Shot = { data: string, w: number, h: number, scale: number }
export type ElementAction = 'press' | 'set' | 'select' | 'expand'

// What a system's helper does, in screen pixels. A window id of 0 is the screen itself
export type Backend = {
  size(): Promise<[number, number]>
  cursor(): Promise<[number, number]>
  // Milliseconds since anyone's last input, Claude's own included
  idle(): Promise<number>
  windows(): Promise<Win[]>
  foreground(): Promise<number>
  rect(id: number): Promise<[number, number, number, number]>
  focus(id: number): Promise<boolean>
  // Of a window: what it draws itself, even under other windows
  capture(id: number, x: number, y: number, w: number, h: number, maxW: number, maxH: number): Promise<Shot>
  fingerprint(id: number, x: number, y: number, w: number, h: number): Promise<string>
  move(x: number, y: number): Promise<void>
  click(x: number, y: number, button: 'left' | 'right' | 'middle', count: number): Promise<void>
  drag(x: number, y: number, x2: number, y2: number): Promise<void>
  scroll(x: number, y: number, dx: number, dy: number): Promise<void>
  type(text: string): Promise<void>
  paste(text: string): Promise<void>
  keys(combo: string): Promise<void>
  elements(id: number, max: number): Promise<El[]>
  // On the index-th element of the last list: null when done, else why not
  act(index: number, kind: ElementAction, text?: string, open?: boolean): Promise<string | null>
  scrollEl(index: number, dx: number, dy: number): Promise<boolean>
  // A virtual display: null with none, [0] while off, [1, x, y, w, h] on
  monitor(): Promise<number[] | null>
  park(id: number, x: number, y: number, w: number, h: number): Promise<number[]>
  unpark(id: number, was: number[]): Promise<void>
  close(): void
}

// A screenshot Claude reads well: about the size it was trained on
const MAX_W = 1280
const MAX_H = 800
const ZOOM_W = 1280
const ZOOM_H = 1280
// Further than this from where Claude left it: the user has the mouse
const HANDS_OFF_PX = 12
// No input of the user's for this long: they have stepped away, and the mouse can be Claude's
export const AWAY_MS = 60_000
// Input this soon after Claude's own is Claude's
const OWN_MS = 400
// Long text goes through the clipboard: typed, it takes a second per hundred characters
const PASTE_FROM = 200
const ELEMENTS_MAX = 150

const BACK = 'The user came back to the computer: the actions stopped here. Looking and the element actions (press, set, select, expand, scroll by ref) go on while they work; the rest waits until they step away again.'

type View = { x: number, y: number, w: number, h: number, scale: number }
class Wait {
  idle: number
  constructor(idle: number) { this.idle = idle }
}
class Back {}

export function createScreen(backend: Backend, { sleep = (ms: number) => new Promise(r => setTimeout(r, ms)), settleMs = 1500, now = Date.now }: { sleep?: (ms: number) => Promise<unknown>, settleMs?: number, now?: () => number } = {}) {
  let target: Win | null = null
  let view: View | null = null
  let refs = new Map<string, { at: [number, number], i: number }>()
  const parked = new Map<number, { was: number[], title: string }>()
  // When Claude's own input last went, and the user's
  let ownAt = 0
  let userAt = 0
  // The mouse and keyboard while Claude has them: where the user's cursor and window were, to give them back
  let held: { cursor: [number, number], fg: number, keep: boolean } | null = null
  let placed: [number, number] | null = null
  let right = false

  const region = async (): Promise<[number, number, number, number]> => {
    if (target) {
      const r = await backend.rect(target.id)
      if (r[2] > 0 && r[3] > 0 && r[0] > -30_000) return r
      throw new Error(`«${target.title}» is minimized: park it to work on it in the background, or focus it`)
    }
    const [w, h] = await backend.size()
    return [0, 0, w, h]
  }

  async function shoot() {
    const [x, y, w, h] = await region()
    const s = await backend.capture(target?.id ?? 0, x, y, w, h, MAX_W, MAX_H)
    view = { x, y, w: s.w, h: s.h, scale: s.scale }
    return s
  }

  const ref = (name: string) => {
    const r = refs.get(name)
    if (!r) throw new Error(`no ${name} in the last elements list: list them again`)
    return r
  }

  // A point of the last screenshot, or a ref of the last list, on the screen
  async function point(a: { at?: [number, number], ref?: string }): Promise<[number, number]> {
    if (a.ref) return ref(a.ref).at
    if (!a.at) throw new Error('give at [x, y] or ref')
    if (!view) await shoot()
    return [Math.round(view!.x + a.at[0] / view!.scale), Math.round(view!.y + a.at[1] / view!.scale)]
  }
  const inView = (p: [number, number]): [number, number] => (view ? [Math.round((p[0] - view.x) * view.scale), Math.round((p[1] - view.y) * view.scale)] : p)

  // The screen settled: the same picture twice in a row, or the time is up
  async function settle(ms: number) {
    const [x, y, w, h] = await region()
    let last = ''
    for (const end = Date.now() + ms; Date.now() < end;) {
      const fp = await backend.fingerprint(target?.id ?? 0, x, y, w, h)
      if (fp === last) return
      last = fp
      await sleep(150)
    }
  }

  async function find(name: string) {
    const all = await backend.windows()
    const q = name.toLowerCase()
    const w = all.find(w => w.title.toLowerCase() === q) ?? all.find(w => w.title.toLowerCase().includes(q)) ?? all.find(w => w.app.toLowerCase().includes(q))
    if (!w) throw new Error(`no window like «${name}»: list them with windows`)
    return w
  }

  // The window Claude works in, without bringing it forward: only the mouse and the keyboard need it in front
  async function pick(name: string) {
    const w = await find(name)
    const changed = target?.id !== w.id
    if (changed) {
      refs = new Map()
      view = null
    }
    target = w
    return changed
  }

  // How long the user has left the computer alone: Claude's own input doesn't count
  async function userIdle() {
    const at = now() - await backend.idle()
    if (at > ownAt + OWN_MS) userAt = at
    return now() - userAt
  }

  // The mouse and the keyboard, for an action that needs them: only once the user has stepped away (or said not to
  // wait), and not a moment longer than they stay away
  async function grab(front = true) {
    if (held) {
      const [cx, cy] = await backend.cursor()
      if ((placed && Math.hypot(cx - placed[0], cy - placed[1]) > HANDS_OFF_PX) || now() - await backend.idle() > ownAt + OWN_MS) throw new Back()
      return
    }
    if (!right) {
      const idle = await userIdle()
      if (idle < AWAY_MS) throw new Wait(idle)
    }
    held = { cursor: await backend.cursor(), fg: await backend.foreground(), keep: false }
    placed = held.cursor
    ownAt = now()
    if (front && target) await bringForward(target)
  }
  async function bringForward(w: Win) {
    if (!await backend.focus(w.id)) throw new Error(`«${w.title}» didn't come to the front: no clicks or keys sent`)
  }
  const own = async () => {
    ownAt = now()
    placed = await backend.cursor()
  }

  // The user's cursor and window back where they were, unless they have taken them themselves
  async function release(back: boolean) {
    const h = held
    held = null
    placed = null
    if (!h || back) return
    await backend.move(h.cursor[0], h.cursor[1])
    if (!h.keep && h.fg && h.fg !== target?.id) await backend.focus(h.fg)
    ownAt = now()
  }

  async function element(a: { ref: string }, kind: ElementAction, instead: string, extra: { text?: string, open?: boolean } = {}) {
    const why = await backend.act(ref(a.ref).i, kind, extra.text, extra.open)
    if (why) throw new Error(`${a.ref}: ${why}; ${instead}`)
  }

  async function act(a: ScreenAction, out: { log: string[], image?: ScreenResult['image'] }): Promise<boolean> {
    switch (a.do) {
      case 'screenshot': {
        const s = await shoot()
        out.image = { data: s.data, mime: 'image/jpeg', w: s.w, h: s.h }
        out.log.push(`screenshot ${s.w}×${s.h}${target ? ` of «${target.title}»` : ' of the screen'}`)
        return false
      }
      case 'zoom': {
        if (!view) await shoot()
        const [x, y] = await point({ at: [a.region[0], a.region[1]] })
        const w = Math.max(1, Math.round(a.region[2] / view!.scale)), h = Math.max(1, Math.round(a.region[3] / view!.scale))
        const s = await backend.capture(target?.id ?? 0, x, y, w, h, ZOOM_W, ZOOM_H)
        out.image = { data: s.data, mime: 'image/jpeg', w: s.w, h: s.h }
        out.log.push(`zoom on [${a.region.join(', ')}] at ${s.w}×${s.h}; coordinates stay those of the last screenshot`)
        return false
      }
      case 'windows': {
        const list = await backend.windows()
        out.log.push(`windows:\n${list.map(w => `- «${w.title}» (${w.app}) ${w.minimized ? 'minimized' : `${w.w}×${w.h}`}${w.focused ? ', in front' : ''}${parked.has(w.id) ? ', parked' : ''}${target?.id === w.id ? ', the target' : ''}`).join('\n')}`)
        return false
      }
      case 'focus': {
        await grab(false)
        await pick(a.window)
        await bringForward(target!)
        held!.keep = true
        out.log.push(`brought «${target!.title}» (${target!.app}) to the front`)
        return true
      }
      case 'elements': {
        if (!target) target = (await backend.windows()).find(w => w.focused) ?? null
        if (!target) throw new Error('no window to list: name one')
        if (!view) await shoot()
        const [rx, ry, rw, rh] = await region()
        const q = a.filter?.toLowerCase()
        const seen = (await backend.elements(target.id, ELEMENTS_MAX * 2))
          .map((e, i) => ({ ...e, i }))
          // Only what is on screen in this window: a scrolled-away list reports its whole length
          .filter(e => e.x + e.w > rx && e.y + e.h > ry && e.x < rx + rw && e.y < ry + rh)
          .filter(e => !q || `${e.role} ${e.name} ${e.value ?? ''}`.toLowerCase().includes(q))
          .slice(0, ELEMENTS_MAX)
        refs = new Map(seen.map((e, n) => [`ref_${n + 1}`, { at: [Math.round(e.x + e.w / 2), Math.round(e.y + e.h / 2)] as [number, number], i: e.i }]))
        out.log.push(seen.length
          ? `elements of «${target.title}» (refs for press/set/select/expand, or click; at = their centre in the last screenshot):\n${seen.map((e, n) => {
            const c = inView(refs.get(`ref_${n + 1}`)!.at)
            return `ref_${n + 1} ${e.role} «${e.name.replace(/\s+/g, ' ')}»${e.value ? ` = «${e.value.replace(/\s+/g, ' ')}»` : ''}${e.enabled ? '' : ' (disabled)'} at [${c[0]}, ${c[1]}]`
          }).join('\n')}`
          : `no elements${q ? ` matching «${a.filter}»` : ''} in «${target.title}»: this app doesn't describe its controls, go by the screenshot`)
        return false
      }
      case 'press':
        await element(a, 'press', 'click it instead')
        out.log.push(`pressed ${a.ref}`)
        return true
      case 'set':
        await element(a, 'set', 'click it and type instead', { text: a.text })
        out.log.push(`set ${a.ref} to ${a.text.length} characters`)
        return true
      case 'select':
        await element(a, 'select', 'click it instead')
        out.log.push(`selected ${a.ref}`)
        return true
      case 'expand':
        await element(a, 'expand', 'click it instead', { open: a.open ?? true })
        out.log.push(`${a.open === false ? 'collapsed' : 'expanded'} ${a.ref}`)
        return true
      case 'park': {
        if (!target) throw new Error('name the window to park (window)')
        const m = await backend.monitor()
        if (!m) throw new Error('this computer has no virtual monitor: work with looking and the element actions while the user is here')
        if (!m[0]) throw new Error('the virtual monitor is off: the user can turn it on (Virtual Display Driver) to keep your windows out of their sight')
        const was = await backend.park(target.id, m[1], m[2], m[3], m[4])
        if (!parked.has(target.id)) parked.set(target.id, { was, title: target.title })
        view = null
        out.log.push(`parked «${target.title}» on the virtual monitor, out of the user's sight`)
        return true
      }
      case 'unpark': {
        if (!parked.size) {
          out.log.push('nothing parked')
          return false
        }
        const back: string[] = []
        for (const [id, p] of parked) {
          // A window closed since then has nothing to go back to
          try {
            await backend.unpark(id, p.was)
            back.push(`«${p.title}»`)
          } catch {}
        }
        parked.clear()
        view = null
        out.log.push(back.length ? `back on the user's screen: ${back.join(', ')}` : 'the parked windows are closed')
        return back.length > 0
      }
      case 'click': {
        await grab()
        const p = await point(a)
        await backend.click(p[0], p[1], a.button ?? 'left', a.count ?? 1)
        await own()
        out.log.push(`${a.count === 2 ? 'double-' : a.count === 3 ? 'triple-' : ''}${a.button && a.button !== 'left' ? `${a.button} ` : ''}click at ${a.ref ?? `[${a.at!.join(', ')}]`}`)
        return true
      }
      case 'move': {
        await grab()
        const p = await point(a)
        await backend.move(p[0], p[1])
        await own()
        out.log.push(`moved to ${a.ref ?? `[${a.at!.join(', ')}]`}`)
        return true
      }
      case 'drag': {
        await grab()
        const p = await point({ at: a.from }), q = await point({ at: a.to })
        await backend.drag(p[0], p[1], q[0], q[1])
        await own()
        out.log.push(`dragged [${a.from.join(', ')}] → [${a.to.join(', ')}]`)
        return true
      }
      case 'scroll': {
        const how = `${a.dy ? `${Math.abs(a.dy)} ${a.dy > 0 ? 'down' : 'up'}` : ''}${a.dx ? ` ${Math.abs(a.dx)} ${a.dx > 0 ? 'right' : 'left'}` : ''}`.trim()
        // A list or page that scrolls itself needs no wheel
        if (a.ref && await backend.scrollEl(ref(a.ref).i, a.dx ?? 0, a.dy ?? 0)) {
          out.log.push(`scrolled ${a.ref} ${how}`)
          return true
        }
        await grab()
        const p = a.at || a.ref ? await point(a) : await (async () => {
          const [x, y, w, h] = await region()
          return [x + Math.round(w / 2), y + Math.round(h / 2)] as [number, number]
        })()
        await backend.scroll(p[0], p[1], a.dx ?? 0, a.dy ?? 0)
        await own()
        out.log.push(`scrolled ${how}`)
        return true
      }
      case 'type':
        await grab()
        if (a.text.length >= PASTE_FROM) await backend.paste(a.text)
        else await backend.type(a.text)
        await own()
        out.log.push(`typed ${a.text.length} characters`)
        return true
      case 'key':
        await grab()
        await backend.keys(a.keys)
        await own()
        out.log.push(`pressed ${a.keys}`)
        return true
      case 'wait':
        await settle(a.ms ?? 3000)
        out.log.push(a.ms ? `waited up to ${a.ms} ms for the screen to settle` : 'waited for the screen to settle')
        return false
    }
  }

  return {
    async run(p: ScreenRequest): Promise<ScreenResult> {
      const out: ScreenResult = { log: [] }
      let changed = false
      let back = false
      let i = 0
      right = !!p.now
      try {
        if (p.window && await pick(p.window)) out.log.push(`window «${target!.title}» (${target!.app})${target!.minimized ? ', minimized' : ''}`)
        for (; i < p.actions.length; i++) {
          if (await act(p.actions[i], out)) {
            changed = true
            await settle(settleMs)
          }
        }
      } catch (e) {
        if (e instanceof Wait) out.waiting = { done: i, idleMs: e.idle }
        else if (e instanceof Back) {
          back = true
          out.stopped = BACK
        } else out.log.push(`failed: ${(e as Error).message}`)
      }
      try {
        await release(back)
      } catch {}
      // A batch that changed something ends with a look, unless asked not to or it already ended with one
      const last = p.actions.at(-1)?.do
      if ((p.look ?? changed) && last !== 'screenshot' && last !== 'zoom' && !out.stopped && !out.waiting) {
        try {
          const s = await shoot()
          out.image = { data: s.data, mime: 'image/jpeg', w: s.w, h: s.h }
          out.log.push(`screenshot ${s.w}×${s.h}`)
        } catch (e) {
          out.log.push(`no screenshot: ${(e as Error).message}`)
        }
      }
      return out
    },
    close: () => backend.close(),
  }
}
export type Screen = ReturnType<typeof createScreen>
