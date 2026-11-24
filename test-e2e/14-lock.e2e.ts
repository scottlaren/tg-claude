import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { startStack, pairCodeIn, until, sleep, type Stack } from './support/stack.ts'

// /lock with the real server and agent: the agent itself refuses, the server can't take it back, the file at the computer can

describe('/lock', () => {
  let s: Stack
  let thread = 0

  before(async () => {
    s = await startStack({ language: 'en' })
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
    const c = Date.now()
    s.send('/mode', { thread })
    const card = await until('the mode card', () => s.tg.sent.find(x => x.touched >= c && x.thread === thread && x.buttons.flat().some(b => b.data === 'm:all')))
    await s.tap(card, 'm:all')
  })
  after(() => s?.stop())

  test('locked: a command is refused by the computer and the bot says so; a deleted file brings it back', async () => {
    let t = Date.now()
    s.send(`before ${s.script([{ tool: 'mcp__device__run_command', input: { command: 'echo journal-before' } }, { text: 'done before E2E' }])}`, { thread })
    await s.reply(/done before E2E/, { thread, after: t })

    t = Date.now()
    s.send('/lock')
    const card = await s.reply(/Lock all computers/, { after: t })
    await s.tap(card, /🔒 Lock/)
    const report = await until('the report', () => s.tg.sent.find(m => m.touched >= t && /delete this file/.test(m.text)))
    const file = /`?([^\s`]*agent\.locked)`?/.exec(report.text)![1]
    assert.ok(existsSync(file), 'the lock is on the computer')

    // The agent says so in its next hello
    t = Date.now()
    await sleep(4500)
    s.send(`after ${s.script([{ text: 'must not run E2E' }])}`, { thread })
    await s.reply(/is locked, so this will not run/, { thread, after: t })
    assert.ok(!s.tg.sent.some(m => m.touched >= t && /must not run E2E/.test(m.text.replace(/^after.*/, ''))))

    rmSync(file)
    await sleep(4500)
    t = Date.now()
    s.send(`again ${s.script([{ tool: 'mcp__device__run_command', input: { command: 'echo journal-after' } }, { text: 'done after E2E' }])}`, { thread })
    await s.reply(/done after E2E/, { thread, after: t })

    const journal = readFileSync(file.replace('agent.locked', 'agent.audit.log'), 'utf8')
    assert.match(journal, /journal-before/)
    assert.match(journal, /\tlock\t/)
    assert.match(journal, /journal-after/)
  })

  test('/lock asks first: Cancel leaves the computer as it was', async () => {
    const t = Date.now()
    s.send('/lock')
    const card = await s.reply(/Lock all computers/, { after: t })
    await s.tap(card, /Cancel/)
    await until('the card changed', () => s.tg.sent.find(m => m.touched >= t && /Not locked/.test(m.text)))
    const ran = Date.now()
    s.send(`check ${s.script([{ text: 'still open E2E' }])}`, { thread })
    await s.reply(/still open E2E/, { thread, after: ran })
  })
})
