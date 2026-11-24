import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createScreen, AWAY_MS, type Backend, type Win, type El } from '../src/screen/index.ts'

// A desktop of 2560×1440 with one window, which records what was done to it. The user's last input was long ago
// unless they touch something (touch); Claude's own input counts as input too, as on a real computer
function desk({ elements = [] as El[], monitor = [1, 3000, 0, 1920, 1080] as number[] | null, acts = {} as Record<string, string> } = {}) {
  const calls: string[] = []
  let cursor: [number, number] = [0, 0]
  let clock = 1_000_000
  let lastInput = 0
  const input = () => { lastInput = clock }
  const win: Win = { id: 7, title: 'Калькулятор', app: 'ApplicationFrameHost', x: 1000, y: 200, w: 640, h: 1000, minimized: false, focused: false }
  const b: Backend = {
    size: async () => [2560, 1440],
    cursor: async () => cursor,
    idle: async () => clock - lastInput,
    windows: async () => [win, { ...win, id: 8, title: 'Telegram', app: 'Telegram', focused: true }],
    foreground: async () => 8,
    rect: async () => [win.x, win.y, win.w, win.h],
    focus: async id => (calls.push(`focus ${id}`), true),
    // Scaled to fit 1280×800, as the helper does
    capture: async (id, x, y, w, h, maxW, maxH) => {
      const scale = Math.min(1, maxW / w, maxH / h)
      calls.push(`capture ${id} ${x},${y} ${w}×${h}`)
      return { data: 'jpeg', w: Math.round(w * scale), h: Math.round(h * scale), scale }
    },
    fingerprint: async () => 'same',
    move: async (x, y) => { cursor = [x, y]; calls.push(`move ${x},${y}`) },
    click: async (x, y, button, count) => { input(); cursor = [x, y]; calls.push(`click ${x},${y} ${button} ${count}`) },
    drag: async (x, y, x2, y2) => { input(); cursor = [x2, y2]; calls.push(`drag ${x},${y} ${x2},${y2}`) },
    scroll: async (x, y, dx, dy) => { input(); cursor = [x, y]; calls.push(`scroll ${x},${y} ${dx},${dy}`) },
    type: async t => { input(); calls.push(`type ${t.length}`) },
    paste: async t => { input(); calls.push(`paste ${t.length}`) },
    keys: async k => { input(); calls.push(`keys ${k}`) },
    elements: async () => elements,
    act: async (i, kind, text) => (calls.push(`act ${i} ${kind}${text ? ` ${text}` : ''}`), acts[kind] ?? null),
    scrollEl: async (i, dx, dy) => (calls.push(`scrollEl ${i} ${dx},${dy}`), i === 0),
    monitor: async () => monitor,
    park: async (id, x, y) => (calls.push(`park ${id} ${x},${y}`), [1, 10, 10, 650, 1010]),
    unpark: async (id, was) => void calls.push(`unpark ${id} ${was.join(',')}`),
    close: () => {},
  }
  return {
    b, calls, win,
    now: () => clock,
    tick: (ms: number) => { clock += ms },
    // The user's own hand: input now, and the mouse somewhere else
    touch: (p?: [number, number]) => { input(); if (p) cursor = p },
  }
}
const quick = { sleep: async () => {}, settleMs: 0 }

test('a window named is looked at by itself, in place; the mouse brings it to the front only once needed', async () => {
  const { b, calls, now } = desk()
  const s = createScreen(b, { ...quick, now })
  const r = await s.run({ window: 'кальк', actions: [{ do: 'screenshot' }, { do: 'click', at: [100, 400] }] })
  assert.equal(calls[0], 'capture 7 1000,200 640×1000', 'the window draws itself: whatever is on top of it stays out')
  assert.equal(calls[1], 'focus 7')
  // 640×1000 fits 1280×800 at 0.8: a point of the screenshot is 1/0.8 of it on the screen, from the window's corner
  assert.ok(calls.includes('click 1125,700 left 1'), calls.join(' | '))
  assert.equal(r.image?.w, 512)
  assert.match(r.log[0], /window «Калькулятор»/)
  // Then the user's cursor and window go back where they were
  assert.deepEqual(calls.slice(-3, -1), ['move 0,0', 'focus 8'])
})

test('elements become refs: only what is on screen in the window, its centre given in the screenshot\'s pixels', async () => {
  const { b, calls, now } = desk({ elements: [
    { role: 'button', name: 'Равно', x: 1500, y: 1100, w: 100, h: 60, enabled: true },
    { role: 'listitem', name: 'scrolled away', x: 1000, y: -9000, w: 600, h: 80, enabled: true },
    { role: 'edit', name: 'Поиск', value: 'abc', x: 1010, y: 210, w: 200, h: 30, enabled: false },
  ] })
  const s = createScreen(b, { ...quick, now })
  const r = await s.run({ window: 'Калькулятор', actions: [{ do: 'elements' }] })
  const text = r.log.join('\n')
  assert.match(text, /ref_1 button «Равно» at \[440, 744\]/)
  assert.match(text, /ref_2 edit «Поиск» = «abc» \(disabled\)/)
  assert.doesNotMatch(text, /scrolled away/)
  assert.equal(r.image, undefined, 'only looked: no screenshot')
  await s.run({ actions: [{ do: 'click', ref: 'ref_1', count: 2 }] })
  assert.ok(calls.includes('click 1550,1130 left 2'))
  // A ref names its element in the helper's own list, where the scrolled-away one still counts
  await s.run({ actions: [{ do: 'set', ref: 'ref_2', text: 'да' }] })
  assert.ok(calls.includes('act 2 set да'), calls.join(' | '))
  const bad = await s.run({ actions: [{ do: 'click', ref: 'ref_9' }] })
  assert.match(bad.log.join(' '), /no ref_9 in the last elements list/)
})

test('while the user works, element actions go on and the mouse waits: the server is told where to pick up', async () => {
  const { b, calls, now, touch } = desk({ elements: [{ role: 'button', name: 'OK', x: 1100, y: 300, w: 80, h: 30, enabled: true }] })
  const s = createScreen(b, { ...quick, now })
  await s.run({ window: 'Калькулятор', actions: [{ do: 'elements' }] })
  touch()
  const r = await s.run({ actions: [{ do: 'press', ref: 'ref_1' }, { do: 'scroll', ref: 'ref_1', dy: 3 }, { do: 'key', keys: 'enter' }, { do: 'press', ref: 'ref_1' }] })
  assert.deepEqual(r.waiting, { done: 2, idleMs: 0 })
  assert.deepEqual(calls.filter(c => /^(act|scrollEl|keys|focus|scroll )/.test(c)), ['act 0 press', 'scrollEl 0 0,3'], 'nothing touched the mouse or the keyboard')
  assert.equal(r.image, undefined)
  // Told not to wait (the user said so), the rest goes
  const go = await s.run({ actions: [{ do: 'key', keys: 'enter' }], now: true })
  assert.equal(go.waiting, undefined)
  assert.ok(calls.includes('keys enter'))
})

test('Claude\'s own input is not the user\'s: a minute after they left, one batch after another has the mouse', async () => {
  const { b, now, tick, touch } = desk()
  const s = createScreen(b, { ...quick, now })
  touch()
  tick(AWAY_MS - 1000)
  assert.ok((await s.run({ window: 'Калькулятор', actions: [{ do: 'click', at: [1, 1] }] })).waiting, 'not yet a minute')
  tick(2000)
  assert.equal((await s.run({ actions: [{ do: 'click', at: [1, 1] }, { do: 'type', text: 'x' }] })).waiting, undefined)
  tick(100)
  assert.equal((await s.run({ actions: [{ do: 'key', keys: 'enter' }] })).waiting, undefined, 'its own clicks a moment ago are not the user coming back')
})

test('the user coming back stops the batch before the next action, and their cursor is left where they put it', async () => {
  const { b, calls, touch, now, tick } = desk()
  let n = 0
  // Their hand on the mouse a moment after Claude's first click, while the screen settles
  b.fingerprint = async () => {
    if (++n === 1) {
      tick(1000)
      touch([5, 5])
    }
    return 'same'
  }
  const s = createScreen(b, { ...quick, settleMs: 1000, now })
  const r = await s.run({ window: 'Калькулятор', actions: [{ do: 'click', at: [10, 10] }, { do: 'click', at: [20, 20] }, { do: 'key', keys: 'enter' }] })
  assert.match(r.stopped ?? '', /The user came back/)
  assert.ok(!calls.some(c => c.startsWith('keys')))
  assert.equal(calls.filter(c => c.startsWith('click')).length, 1)
  assert.ok(!calls.includes('move 0,0'), 'no tug of war over the cursor')
  assert.equal(r.image, undefined, 'no look at a screen the user has')
})

test('a window parks on the virtual monitor and comes back where it was', async () => {
  const { b, calls, now } = desk()
  const s = createScreen(b, { ...quick, now })
  const r = await s.run({ window: 'Калькулятор', actions: [{ do: 'park' }, { do: 'windows' }] })
  assert.ok(calls.includes('park 7 3000,0'))
  assert.match(r.log.join('\n'), /«Калькулятор».*, parked/)
  const back = await s.run({ actions: [{ do: 'unpark' }], look: false })
  assert.ok(calls.includes('unpark 7 1,10,10,650,1010'))
  assert.match(back.log[0], /back on the user's screen: «Калькулятор»/)
  assert.equal((await s.run({ actions: [{ do: 'unpark' }] })).log[0], 'nothing parked')
  const off = createScreen(desk({ monitor: [0] }).b, quick)
  assert.match((await off.run({ window: 'Калькулятор', actions: [{ do: 'park' }] })).log.join(' '), /virtual monitor is off/)
})

test('a batch that changes something ends with a look; long text goes through the clipboard', async () => {
  const { b, calls, now } = desk()
  const s = createScreen(b, { ...quick, now })
  const r = await s.run({ window: 'Калькулятор', actions: [{ do: 'type', text: 'привет' }, { do: 'type', text: 'x'.repeat(500) }, { do: 'key', keys: 'ctrl+s' }] })
  assert.deepEqual(calls.filter(c => /^(type|paste|keys)/.test(c)), ['type 6', 'paste 500', 'keys ctrl+s'])
  assert.ok(r.image)
  const quiet = await s.run({ actions: [{ do: 'key', keys: 'enter' }], look: false })
  assert.equal(quiet.image, undefined)
})

test('a window that isn\'t there, or an element that can\'t do it, says so and stops the batch', async () => {
  const { b, calls, now } = desk()
  const s = createScreen(b, { ...quick, now })
  const r = await s.run({ window: 'Photoshop', actions: [{ do: 'click', at: [1, 1] }] })
  assert.match(r.log.join(' '), /no window like «Photoshop»/)
  assert.ok(!calls.some(c => c.startsWith('click')))
  const d = desk({ elements: [{ role: 'text', name: 'Hi', x: 1100, y: 300, w: 80, h: 30, enabled: true }], acts: { press: 'it has no action of its own to press' } })
  const s2 = createScreen(d.b, { ...quick, now: d.now })
  const p = await s2.run({ window: 'Калькулятор', actions: [{ do: 'elements' }, { do: 'press', ref: 'ref_1' }, { do: 'key', keys: 'enter' }] })
  assert.match(p.log.join(' '), /ref_1: it has no action of its own to press; click it instead/)
  assert.ok(!d.calls.some(c => c.startsWith('keys')))
})

test('a window that doesn\'t come to the front gets no click or key: they would land in whatever is there', async () => {
  const { b, calls, now } = desk()
  b.focus = async id => (calls.push(`focus ${id}`), false)
  const s = createScreen(b, { ...quick, now })
  const r = await s.run({ window: 'Калькулятор', actions: [{ do: 'click', at: [1, 1] }, { do: 'key', keys: 'enter' }] })
  assert.match(r.log.join(' '), /«Калькулятор» didn't come to the front: no clicks or keys sent/)
  assert.ok(!calls.some(c => /^(click|keys)/.test(c)))
})
