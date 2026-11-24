import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAerender, renderStarted, readCommand, readOutput, createRenderWatch, renderAnswer, renderLine, renderWidgetHtml, RENDER_QUERY } from '../src/telegram/render-watch.ts'
import { widgetProblem } from '../src/claude/widget-tools.ts'

// As aerender 25 writes it on Windows, cut down
const head = [
  'aerender version 25.3.2x2', 'PROGRESS: Launching After Effects...',
  'PROGRESS:  09.11.2026 19:39:01: Starting composition "Main".', '',
  'PROGRESS:  Start: 00000', 'PROGRESS:  End: 00040', 'PROGRESS:  Duration: 00041', 'PROGRESS:  Frame Rate: 30,00 (comp)',
  'PROGRESS:  Output To: C:\\Users\\x\\out\\main.mp4', 'PROGRESS:  ',
].join('\r\n')
const frames = (n: number) => Array.from({ length: n }, (_, i) => `PROGRESS:  ${String(i).padStart(5, '0')} (${i + 1}): 0 Seconds`).join('\r\n')
const end = 'PROGRESS:  09.11.2026 19:39:04: Finished composition "Main".\r\n\r\n\r\nPROGRESS:  Total Time Elapsed: 2 Seconds'

test('the log: frames done, the span, the end, the file', () => {
  assert.deepEqual(parseAerender(`${head}\r\n${frames(12)}`), { frame: 12, total: 41, done: false, error: undefined, output: 'C:\\Users\\x\\out\\main.mp4' })
  assert.equal(parseAerender(`${head}\r\n${frames(41)}\r\n${end}`).done, true)
  assert.equal(parseAerender('PROGRESS: Launching After Effects...\naerender ERROR: No comp was found with the given name.').error, 'No comp was found with the given name.')
  // As it came from a real render into a folder that wasn't there
  assert.equal(parseAerender('PROGRESS: Adding specified comp to Render Queue\r\naerender Error: After Effects error: Error in output for render queue item 1, output module 1. Directory does not exist: C:\\x.\r\n').error,
    'Error in output for render queue item 1, output module 1. Directory does not exist: C:\\x.')
})

test('the log: a span as a timecode counts in frames at the comp rate', () => {
  const log = 'PROGRESS:  Duration: 0:00:10:00\nPROGRESS:  Frame Rate: 29.97 (comp)\nPROGRESS:  0:00:01:12 (43): 1 Seconds\n'
  assert.deepEqual([parseAerender(log).total, parseAerender(log).frame], [300, 43])
})

test('what render-aerender answers: a render started, or not one to follow', () => {
  assert.deepEqual(renderStarted(JSON.stringify({ status: 'started', pid: 42, comp: 'Main', output: 'C:\\o.mp4', logPath: 'C:\\t\\aerender-1.log' })),
    { pid: 42, log: 'C:\\t\\aerender-1.log', comp: 'Main', output: 'C:\\o.mp4' })
  assert.equal(renderStarted(JSON.stringify({ status: 'finished', pid: 42, logPath: 'x' })), undefined, 'waited for to the end: nothing to follow')
  assert.equal(renderStarted(JSON.stringify({ status: 'started', pid: -1, logPath: 'x' })), undefined)
  assert.equal(renderStarted('Error launching aerender: nope'), undefined)
})

test('reading on the computer: alive first, then the log, quoted', () => {
  const c = readCommand(42, "C:\\it's\\a.log")
  assert.match(c, /PID eq 42/)
  assert.match(c, /kill -0 42/)
  assert.ok(c.includes(`'C:\\it'\\''s\\a.log'`))
  assert.deepEqual(readOutput('A=1\r\nhead\n<<<tgcv-tail>>>\ntail'), { alive: true, log: 'head\n\ntail' })
  assert.equal(readOutput('A=0\nx').alive, false)
})

const watch = (reads: ({ alive: boolean, log: string } | null)[], t = { now: 1_000_000 }) => {
  const seen: string[] = []
  const w = createRenderWatch<{ chat: number }>({
    read: async () => reads.shift() ?? null,
    shown: j => seen.push(`shown ${j.state}`),
    changed: j => seen.push(`${j.state} ${j.frame}/${j.total ?? '?'}`),
    now: () => t.now,
    auto: false,
    giveUpMs: 60_000,
  })
  return { w, seen, t }
}

test('a render followed to its end, with the time left from its pace', async () => {
  const { w, seen, t } = watch([
    { alive: true, log: `${head}\n${frames(1)}` },
    { alive: true, log: `${head}\n${frames(11)}` },
    { alive: true, log: `${head}\n${frames(11)}` },
    { alive: false, log: `${head}\n${frames(41)}\n${end}` },
  ])
  const j = w.start({ pid: 1, log: 'l', comp: 'Main', output: 'o.mp4' }, { chat: 1 })
  await w.tick(j.id)
  t.now += 10_000
  await w.tick(j.id)
  assert.equal(j.end, t.now + 30_000, '10 frames in 10 s, 30 to go')
  await w.tick(j.id)
  assert.deepEqual(seen, ['shown run', 'run 1/41', 'run 11/41'], 'nothing new: nothing said')
  t.now += 5000
  await w.tick(j.id)
  assert.equal(j.state, 'done')
  assert.equal(j.frame, 41)
  assert.equal(j.endedAt, t.now)
  assert.equal(j.end, undefined)
})

test('a render whose process is gone without the end failed, with the error it wrote', async () => {
  const { w } = watch([{ alive: false, log: `${head}\n${frames(3)}\naerender ERROR: Unable to find the output module` }])
  const j = w.start({ pid: 1, log: 'l', comp: 'Main', output: 'o.mp4' }, { chat: 1 })
  await w.tick(j.id)
  assert.equal(j.state, 'fail')
  assert.equal(j.error, 'Unable to find the output module')
})

test('a computer that stops answering is waited for, then given up on', async () => {
  const { w, t } = watch([null, null])
  const j = w.start({ pid: 1, log: 'l', comp: 'Main', output: 'o.mp4' }, { chat: 1 })
  await w.tick(j.id)
  assert.equal(j.state, 'run')
  t.now += 61_000
  await w.tick(j.id)
  assert.equal(j.state, 'fail')
})

test('the widget: its own query, its numbers inside, within Telegram\'s limits', () => {
  const { w } = watch([])
  const j = w.start({ pid: 1, log: 'l', comp: 'Hero </script>', output: 'C:\\r\\hero.mp4' }, { chat: 1 })
  Object.assign(j, { frame: 312, total: 900 })
  const html = renderWidgetHtml(j)
  assert.ok(!widgetProblem(html))
  assert.ok(html.includes(JSON.stringify(RENDER_QUERY + j.id)))
  assert.ok(!html.includes('Hero </script>'), 'a name cannot close the script')
  assert.deepEqual(JSON.parse(renderAnswer(j)), { s: 'run', f: 312, n: 900, a: 1000, e: 0, z: 0, x: '', o: 'hero.mp4' })
  assert.match(renderLine(j), /34% \(312\/900\)/)
})
