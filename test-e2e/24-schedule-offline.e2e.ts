import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { startStack, pairCodeIn, until, sleep, type Stack } from './support/stack.ts'

// A task on a schedule that comes while the computer is off: a button puts it off until the computer is back. The
// shortest schedule is a minute away, so this waits a minute

describe('a scheduled task while the computer is off', () => {
  let s: Stack
  let thread = 0

  before(async () => {
    s = await startStack({ language: 'en', config: { scheduleTickMs: 500, deferredSettleMs: 300 } })
    await s.startServer()
    const t = Date.now()
    s.send('/pair')
    const m = await s.reply(/install\//, { after: t })
    await s.pairAgent('E2E-PC', pairCodeIn(m)!, ['alpha'])
    await sleep(500)
    s.send('/topic Work')
    const picker = await until('a picker', () => s.tg.sent.find(x => x.thread && x.buttons.flat().some(b => b.text === 'alpha')))
    thread = picker.thread!
    await s.tap(picker, /^alpha$/)
    await s.reply(/alpha/, { thread })
  })
  after(() => s?.stop())

  test('skipped: a card with a button; the tap puts it off, and it runs when the computer connects', async () => {
    let t = Date.now()
    s.send(`later ${s.script([{ tool: 'mcp__schedule__schedule_task', input: { name: 'Release E2E', inMinutes: 1, prompt: `Do it. ${s.script([{ text: 'scheduled run happened E2E' }])}` } }, { text: 'proposed E2E' }])}`, { thread })
    const card = await until('the proposal', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && m.buttons.flat().some(b => b.data?.startsWith('scy:'))))
    await s.tap(card, card.buttons.flat().find(b => b.data?.startsWith('scy:'))!.data!)
    await s.killAgent('E2E-PC')
    t = Date.now()
    const skipped = await until('the skip card', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && m.buttons.flat().some(b => b.data?.startsWith('sko:go:'))), 90_000)
    assert.match(skipped.text, /Release E2E: skipped/)
    assert.match(skipped.text, /one-time task/)
    await s.tap(skipped, skipped.buttons.flat().find(b => b.data?.startsWith('sko:go:'))!.data!)
    await until('put off', () => /runs when the computer connects/.test(s.tg.sent.find(m => m.message_id === skipped.message_id)!.text))
    assert.ok(!s.tg.sent.some(m => m.touched >= t && /scheduled run happened E2E/.test(m.text)), 'not before the computer is back')
    await s.startAgent('E2E-PC')
    await s.reply(/scheduled run happened E2E/, { thread, after: t, ms: 30_000 })
  })
})
