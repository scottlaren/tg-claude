import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { startStack, pairCodeIn, until, sleep, type Stack } from './support/stack.ts'

// A spent limit doesn't end the work: it waits, on disk, and goes on by itself. The limit's clock is the script's

describe('a spent limit', () => {
  let s: Stack
  let thread = 0
  const inTopic = () => ({ thread })
  const spent = (inMs: number) => ({ limit: { status: 'rejected', resetsAt: Math.floor((Date.now() + inMs) / 1000), rateLimitType: 'five_hour' } })
  const stop = { errorKind: 'rate_limit', text: 'limit' }

  before(async () => {
    s = await startStack({ language: 'en', config: { limitGraceMs: 0, limitTickMs: 200, freshOfferPct: 0 } })
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

  test('the task goes on by itself after the reset, ahead of what was written meanwhile', async () => {
    const t = Date.now()
    s.send(`big task ${s.script([spent(4000), stop, { text: 'went on after the limit E2E' }])}`, inTopic())
    const card = await s.reply(/I'll go on by myself after it resets/, { thread, after: t })
    assert.ok(card.buttons.flat().some(b => b.data === 'lmt:off'))

    const w = Date.now()
    s.send(`written meanwhile ${s.script([{ text: 'the one that waited E2E' }])}`, inTopic())
    await s.reply(/This waits until the limit resets/, { thread, after: w })
    assert.ok(!s.tg.sent.some(m => m.touched >= w && /the one that waited E2E/.test(m.text)), 'it waits')

    await s.reply(/The limit has reset/, { thread, after: t, ms: 15_000 })
    await s.reply(/went on after the limit E2E/, { thread, after: t, ms: 15_000 })
  })

  test('"Don\'t go on": it stays stopped, and what waited runs at once', async () => {
    const t = Date.now()
    s.send(`again ${s.script([spent(3_600_000), stop])}`, inTopic())
    const card = await s.reply(/I'll go on by myself after it resets/, { thread, after: t })
    s.send(`meanwhile ${s.script([{ text: 'ran once released E2E' }])}`, inTopic())
    await sleep(500)
    await s.tap(card, 'lmt:off')
    await s.reply(/ran once released E2E/, { thread, after: t })
  })

  test('/stop drops it too, and it never comes back', async () => {
    const t = Date.now()
    s.send(`once more ${s.script([spent(1500), stop, { text: 'must not come back E2E' }])}`, inTopic())
    await s.reply(/I'll go on by myself after it resets/, { thread, after: t })
    s.send('/stop', inTopic())
    await s.reply(/Queue cleared/, { thread, after: t })
    await sleep(3000)
    assert.ok(!s.tg.sent.some(m => m.touched >= t && /must not come back E2E/.test(m.text)))
  })

  test('a big task with little limit left: Claude asks, it waits for the reset and leaves the topic free; a tap starts it now', async () => {
    let t = Date.now()
    s.send(`big rebuild ${s.script([{ tool: 'mcp__fresh_limit__offer_fresh_limit', input: { why: 'all the scenes' } }, { text: 'asked about the limit E2E' }])}`, inTopic())
    const card = await s.reply(/of the limit is used/, { thread, after: t })
    assert.match(card.text, /Week/)
    await s.reply(/asked about the limit E2E/, { thread, after: t })
    await s.tap(card, /Wait for the reset/)
    await until('put off', () => /Put off for a fresh limit/.test(s.tg.sent.find(m => m.message_id === card.message_id)!.text))
    t = Date.now()
    s.send(`in the meantime ${s.script([{ text: 'free to talk E2E' }])}`, inTopic())
    await s.reply(/free to talk E2E/, { thread, after: t })
    // Started now, the same task runs again from its words: here that is the same question once more
    t = Date.now()
    await s.tap(s.tg.sent.find(m => m.message_id === card.message_id)!, /Start now/)
    await s.reply(/asked about the limit E2E/, { thread, after: t })
  })

  test('the offer is made to Claude once the limit is past the threshold', async () => {
    const turns = s.journal().filter(j => j.kind === 'turn')
    assert.ok(turns.some(j => (j.servers as string[]).includes('fresh_limit')), 'offered with the threshold at 0')
  })

  test('the reset comes with the computer off: one message, and the task starts when it connects', async () => {
    let t = Date.now()
    s.send(`off soon ${s.script([spent(3000), { errorKind: 'rate_limit', text: 'limit' }, { text: 'after the computer came back E2E' }])}`, inTopic())
    await s.reply(/I'll go on by myself after it resets/, { thread, after: t })
    await s.killAgent('E2E-PC')
    t = Date.now()
    await s.reply(/The limit has reset\. The task starts when .*E2E-PC.* connects/, { thread, after: t, ms: 15_000 })
    await sleep(1500)
    assert.ok(!s.tg.sent.some(m => m.touched >= t && /The message waits until it connects/.test(m.text)), 'no second message')
    await s.startAgent('E2E-PC')
    await s.reply(/after the computer came back E2E/, { thread, after: t, ms: 30_000 })
  })

  test('it holds through a restart of the server', async () => {
    const t = Date.now()
    s.send(`long one ${s.script([spent(5000), stop, { text: 'after the restart too E2E' }])}`, inTopic())
    await s.reply(/I'll go on by myself after it resets/, { thread, after: t })
    await s.termServer()
    await s.startServer()
    await s.reply(/after the restart too E2E/, { thread, after: t, ms: 20_000 })
  })
})
