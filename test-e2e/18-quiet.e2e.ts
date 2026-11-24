import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { startStack, pairCodeIn, until, sleep, type Stack } from './support/stack.ts'

// /quiet with the real server: what the fake Telegram received says which message makes a sound

describe('/quiet', () => {
  let s: Stack
  let thread = 0
  const silent = (m: { raw: { disable_notification?: boolean } }) => m.raw.disable_notification === true

  before(async () => {
    s = await startStack({ language: 'en' })
    await s.startServer()
    const t = Date.now()
    s.send('/pair')
    const m = await s.reply(/install\//, { after: t })
    await s.pairAgent('E2E-PC', pairCodeIn(m)!, ['alpha', 'beta'])
    await sleep(500)
    s.send('/topic Work')
    const picker = await until('a picker', () => s.tg.sent.find(x => x.thread && x.buttons.flat().some(b => b.text === 'alpha')))
    thread = picker.thread!
    await s.tap(picker, /^alpha$/)
    await s.reply(/alpha/, { thread })
  })
  after(() => s?.stop())

  test('off by default: nothing is silenced', async () => {
    const t = Date.now()
    s.send(`hello ${s.script([{ text: 'loud as ever E2E' }])}`, { thread })
    const answer = await s.reply(/loud as ever E2E/, { thread, after: t })
    assert.equal(silent(answer), false)
  })

  test('on: the switch answers, /status says so, ordinary messages go silent; a permission and the final answer ring', async () => {
    let t = Date.now()
    s.send('/quiet', { thread })
    const card = await s.reply(/Quiet mode: off/, { thread, after: t })
    await s.tap(card, /Turn on/)
    await s.reply(/Quiet mode: on/, { thread, after: t })

    t = Date.now()
    s.send('/status', { thread })
    const status = await s.reply(/Quiet mode \| on/, { thread, after: t })
    assert.equal(silent(status), true, 'a card nobody has to act on')

    t = Date.now()
    s.send(`go ${s.script([{ tool: 'mcp__device__run_command', input: { command: 'echo quiet-check' } }, { text: 'finished quietly E2E' }])}`, { thread })
    const ask = await s.reply(/echo quiet-check/, { thread, after: t })
    assert.equal(silent(ask), false, 'a permission is a decision')
    await s.tap(ask, /Allow/)
    const answer = await s.reply(/finished quietly E2E/, { thread, after: t })
    assert.equal(silent(answer), false, 'the final answer says it is over')
  })

  test("Claude's question rings", async () => {
    const t = Date.now()
    s.send(`ask ${s.script([{ tool: 'AskUserQuestion', input: { questions: [{ question: 'Which one E2E?', header: 'Pick', multiSelect: false, options: [{ label: 'First', description: 'a' }, { label: 'Second', description: 'b' }] }] } }, { text: 'answered E2E' }])}`, { thread })
    const q = await s.reply(/Which one E2E\?/, { thread, after: t })
    assert.equal(silent(q), false)
    await s.tap(q, /First/)
    await s.reply(/answered E2E/, { thread, after: t })
  })

  test('a survey rings', async () => {
    const t = Date.now()
    s.send(`survey ${s.script([{ tool: 'mcp__survey__ask_survey', input: { questions: [{ question: 'Colour E2E?', options: [{ label: 'Red' }, { label: 'Blue' }] }] } }, { text: 'survey asked E2E' }])}`, { thread })
    const q = await s.reply(/Colour E2E\?/, { thread, after: t })
    assert.equal(silent(q), false)
    await s.tap(q, /Red/)
    await s.reply(/all done/, { thread, after: t })
  })

  test("an agent's answer and its report in the head stay silent, the head's own answer rings", async () => {
    const t = Date.now()
    const worker = s.script([{ text: 'agent answer E2E' }])
    s.send('/mode', { thread })
    const mode = await until('the mode card', () => s.tg.sent.find(x => x.touched >= t && x.thread === thread && x.buttons.flat().some(b => b.data === 'm:all')))
    await s.tap(mode, 'm:all')
    s.send(`team ${s.script([{ tool: 'mcp__team__start_agent', input: { name: 'Hush', task: `Work. ${worker}`, model: 'haiku', effort: 'low', project: 'beta' } }, { text: 'head started E2E' }])}`, { thread })
    const report = await s.reply(/Report from agent/, { thread, after: t, ms: 40_000 })
    assert.equal(silent(report), true, 'the report')
    const answer = await until('the answer in the agent topic', () => s.tg.sent.find(m => m.touched >= t && m.thread !== thread && /agent answer E2E/.test(m.text) && m.method === 'sendRichMessage'))
    assert.equal(silent(answer), true, "the agent's final answer")
    const head = await s.reply(/head started E2E/, { thread, after: t })
    assert.equal(silent(head), false, "the head's own answer")
  })
})
