import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startStack, pairCodeIn, until, sleep, type Stack } from './support/stack.ts'

// The link and the agent: dropped and restored during a command, the agent restarted while idle, a computer that is off
// (the conversation goes on, the work waits), ⚡ on a waiting message

for (const language of ['en', 'ru'] as const) {
  describe(`agent in ${language}`, () => {
    let s: Stack
    let thread = 0
    let zone = ''
    let n = 0
    let id = ''
    const tr = (en: RegExp, ru: RegExp) => (language === 'en' ? en : ru)

    before(async () => {
      s = await startStack({ language })
      s.tg.setLang(language)
      await s.startServer()
      const t = Date.now()
      s.send('/pair')
      const m = await s.reply(/install\//, { after: t })
      const a = await s.pairAgent('E2E-PC', pairCodeIn(m)!, ['alpha'])
      id = a.id
      zone = join(a.zone, 'alpha')
      await sleep(300)
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

    function slowCommand(ms: number) {
      const name = `slow${++n}`
      writeFileSync(join(zone, `${name}.cjs`), `const fs=require('fs');fs.appendFileSync(${JSON.stringify(join(zone, `${name}.runs`))},'run\\n');setTimeout(()=>{fs.writeFileSync(${JSON.stringify(join(zone, `${name}.done`))},'x');console.log('finished ${name}')},${ms})`)
      return {
        name,
        step: { tool: 'mcp__device__run_command', input: { command: `node ${name}.cjs` } },
        started: () => existsSync(join(zone, `${name}.runs`)),
        done: () => existsSync(join(zone, `${name}.done`)),
        runs: () => readFileSync(join(zone, `${name}.runs`), 'utf8').trim().split('\n').length,
      }
    }

    test('the link dropped and restored during a command: it runs once, Claude gets its result', async () => {
      const c = slowCommand(5000)
      const t = Date.now()
      const msg = s.send(`go ${s.script([c.step, { text: 'after the drop E2E' }])}`, { thread })
      await until('the command to start', () => c.started())
      await sleep(300)
      const online = s.onlineCount(id)
      s.link.cut()
      await sleep(2000)
      s.link.restore()
      await s.online(id, online)
      const answer = await s.reply(/after the drop E2E/, { thread, after: t, ms: 25_000 })
      assert.equal(answer.reply_to, msg.message_id)
      assert.equal(c.runs(), 1, 'it ran once')
      const tool = s.journal().filter(j => j.kind === 'tool' && j.at >= t).at(-1)!
      assert.match(tool.text, new RegExp(`finished ${c.name}`))
      assert.equal(tool.isError, false)
    })

    test('the agent killed during a command: the call ends with words, nothing raw, the next task works once it is back', async () => {
      const c = slowCommand(12_000)
      const t = Date.now()
      s.send(`go ${s.script([c.step, { text: 'after the kill E2E' }])}`, { thread })
      await until('the command to start', () => c.started())
      const online = s.onlineCount(id)
      await sleep(300)
      await s.killAgent('E2E-PC')
      await sleep(500)
      await s.startAgent('E2E-PC')
      await s.online(id, online)
      const answer = await s.reply(/after the kill E2E/, { thread, after: t, ms: 30_000 })
      assert.ok(answer)
      const tool = s.journal().filter(j => j.kind === 'tool' && j.at >= t).at(-1)!
      assert.equal(tool.isError, true, tool.text)
      const t2 = Date.now()
      s.send('are you there', { thread })
      await s.reply(/echo:.*are you there/, { thread, after: t2 })
    })

    test('the agent restarted while idle: the next message just works', async () => {
      const online = s.onlineCount(id)
      await s.killAgent('E2E-PC')
      await s.startAgent('E2E-PC')
      await s.online(id, online)
      const t = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__device__list_files', input: {} }, { text: 'after idle restart E2E' }])}`, { thread })
      await s.reply(/after idle restart E2E/, { thread, after: t })
    })

    test('a computer that is off: the topic talks, defer_task puts work off, it starts once the computer is back, /status counts it', async () => {
      await s.killAgent('E2E-PC')
      await until('the server to notice', () => /device offline/.test(s.serverLogText()), 10_000)
      await sleep(300)
      const t = Date.now()
      const script = s.script([
        { tool: 'mcp__later__defer_task', input: { title: 'Build it', task: 'Build it E2E' } },
        { text: 'put it off E2E' },
      ])
      s.send(`later ${script}`, { thread })
      const answer = await s.reply(/put it off E2E/, { thread, after: t })
      assert.ok(answer)
      const turn = s.journal().filter(j => j.kind === 'turn' && j.at >= t)[0]
      assert.ok(!turn.servers.includes('device'), 'no hands on a computer that is off')
      assert.ok(turn.servers.includes('later'))
      await s.reply(/Build it E2E/, { thread, after: t })
      const t1 = Date.now()
      s.send('/status', { thread })
      const status = await s.reply(/E2E-PC/, { thread, after: t1 })
      assert.doesNotMatch(status.text, /e2e-pc/, 'the name of the computer, not its id')
      const online = s.onlineCount(id)
      const t2 = Date.now()
      await s.startAgent('E2E-PC')
      await s.online(id, online)
      const note = await until('the task announced with a button to call it off', () => s.tg.sent.find(m => m.touched >= t2 && m.thread === thread && m.buttons.flat().some(b => b.data === 'dfc')), 10_000)
      assert.match(note.text, /Build it E2E|E2E-PC/)
      await until('the deferred task to run', () => s.journal().some(j => j.kind === 'turn' && j.at >= t2 && /Build it E2E/.test(j.prompt)), 20_000)
      await s.reply(/echo:.*Build it E2E/, { thread, after: t2 })
    })

    test('⚡ on a waiting message hands it in: Claude gets it after the current step, 🫡 says so; it is not answered twice', async () => {
      const c = slowCommand(1200)
      const t = Date.now()
      s.send(`go ${s.script([c.step, { wait: `handed-${language}` }, { tool: 'mcp__device__list_files', input: {} }, { text: 'handed answer E2E' }])}`, { thread })
      await until('the command to start', () => c.started())
      const extra = s.send('also do this', { thread })
      await until('👀', () => s.tg.reactionsOf(s.CHAT, extra.message_id).includes('👀'))
      s.tg.react(s.user, s.CHAT, extra.message_id, ['⚡'], ['👀'])
      await until('Claude to get it', () => s.journal().some(j => j.kind === 'handin' && j.at >= t && /also do this/.test(j.prompt)), 15_000)
      await until('🫡', () => s.tg.reactionsOf(s.CHAT, extra.message_id).includes('🫡'), 8000)
      s.flag(`handed-${language}`)
      await s.reply(/handed answer E2E/, { thread, after: t })
      await sleep(2500)
      assert.ok(!s.journal().some(j => j.kind === 'turn' && j.at >= t && /also do this/.test(j.prompt)), 'no second turn for it')
    })

    test('⚡ on a message of nobody: nothing breaks; 👎 on an answer makes Claude look again', async () => {
      let t = Date.now()
      s.send('hello there', { thread })
      const answer = await s.reply(/echo:.*hello there/, { thread, after: t })
      t = Date.now()
      s.tg.react(s.user, s.CHAT, answer.message_id, ['⚡'])
      await sleep(400)
      s.tg.react(s.user, s.CHAT, answer.message_id, ['👎'], ['⚡'])
      await until('a second look', () => s.journal().some(j => j.kind === 'turn' && j.at >= t), 8000)
      await sleep(1600)
    })

    test('/new and /stop: a new session, a running task stopped with its command killed', async () => {
      const c = slowCommand(30_000)
      let t = Date.now()
      s.send(`go ${s.script([c.step, { text: 'never said E2E' }])}`, { thread })
      await until('the command to start', () => c.started())
      await sleep(200)
      s.send('/stop', { thread })
      await s.reply(/⏹/, { thread, after: t })
      await sleep(1200)
      assert.ok(!s.tg.sent.some(m => !m.deleted && /never said E2E/.test(m.text)))
      const before = s.journal().filter(j => j.kind === 'turn').at(-1)!.session
      t = Date.now()
      s.send('/new', { thread })
      await s.reply(tr(/session/i, /сесси/i), { thread, after: t })
      t = Date.now()
      s.send('a fresh start', { thread })
      await s.reply(/echo:.*a fresh start/, { thread, after: t })
      const turn = s.journal().filter(j => j.kind === 'turn').at(-1)!
      assert.notEqual(turn.session, before)
      assert.equal(turn.resumed, false)
    })

    test('nothing raw, nothing in the wrong language, nothing left the computer', () => {
      assert.deepEqual(s.tg.findings, [])
      assert.deepEqual(s.netViolations(), [])
    })
  })
}
