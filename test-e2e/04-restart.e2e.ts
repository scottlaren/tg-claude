import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startStack, pairCodeIn, until, sleep, type Stack } from './support/stack.ts'

// A real restart of the server process during a real running command, both ways it dies: the command finishes once,
// the task goes on in the same session, the answer replies to the original message

for (const language of ['en', 'ru'] as const) {
  describe(`restart in ${language}`, () => {
    let s: Stack
    let thread = 0
    let zone = ''
    let n = 0

    before(async () => {
      s = await startStack({ language })
      s.tg.setLang(language)
      await s.startServer()
      const t = Date.now()
      s.send('/pair')
      const m = await s.reply(/install\//, { after: t })
      const a = await s.pairAgent('E2E-PC', pairCodeIn(m)!, ['alpha'])
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

    // Writes a line when it starts and a mark when it ends, so the test sees when it ran and how many times
    function slowCommand(ms: number) {
      const id = `slow${++n}`
      writeFileSync(join(zone, `${id}.cjs`), `const fs=require('fs');fs.appendFileSync(${JSON.stringify(join(zone, `${id}.runs`))},'run\\n');setTimeout(()=>{fs.writeFileSync(${JSON.stringify(join(zone, `${id}.done`))},'x');console.log('finished ${id}')},${ms})`)
      return {
        id,
        step: { tool: 'mcp__device__run_command', input: { command: `node ${id}.cjs` } },
        started: () => existsSync(join(zone, `${id}.runs`)),
        done: () => existsSync(join(zone, `${id}.done`)),
        runs: () => readFileSync(join(zone, `${id}.runs`), 'utf8').trim().split('\n').length,
      }
    }

    const answers = (marker: RegExp) => s.tg.sent.filter(m => m.thread === thread && !m.deleted && marker.test(m.text))

    async function restartDuringCommand(down: () => Promise<void>, label: string, gapMs = 300) {
      const c = slowCommand(4000)
      const marker = `answer ${label} E2E`
      const t = Date.now()
      const msg = s.send(`go ${s.script([c.step, { text: marker }])}`, { thread })
      await until('the command to start', () => c.started())
      await sleep(200)
      const flights = readFileSync(join(s.dataDir, 'in-flight.json'), 'utf8')
      assert.match(flights, /run_command/, 'what is under way is on disk')
      const online = s.onlineCount(s.agents.get('E2E-PC')!.id)
      await down()
      assert.equal(c.done(), false, 'the command outlives the server')
      await sleep(gapMs)
      await s.startServer()
      await s.online(s.agents.get('E2E-PC')!.id, online)
      const answer = await s.reply(new RegExp(marker), { thread, after: t, ms: 25_000 })
      assert.equal(answer.reply_to, msg.message_id, 'the answer replies to the original message')
      assert.equal(c.runs(), 1, 'the command ran once')
      assert.ok(c.done())
      const turns = s.journal().filter(j => j.kind === 'turn' && j.at >= t)
      assert.equal(turns.length, 2, 'the turn, and its one continuation')
      assert.equal(turns[1].session, turns[0].session, 'the same session')
      assert.equal(turns[1].resumed, true)
      assert.match(turns[1].prompt, /The server was restarted/)
      assert.match(turns[1].prompt, new RegExp(`finished ${c.id}`), 'Claude reads how the command ended')
      assert.match(turns[1].prompt, /Nothing was run again/)
      await sleep(300)
      assert.equal(answers(new RegExp(marker)).length, 1, 'one answer')
      const note = s.tg.sent.find(m => m.at >= t && m.thread === thread && /🔄/.test(m.text))
      assert.ok(note, 'the topic says what happened')
      assert.equal(note!.reply_to, msg.message_id)
    }

    test('SIGTERM: the handler Docker runs', () => restartDuringCommand(() => s.termServer(), 'term'))
    test('kill -9', () => restartDuringCommand(() => s.killServer(), 'kill'))

    test('a message sent while the server is down waits and is answered', async () => {
      await s.termServer()
      const t = Date.now()
      s.send('while you were away', { thread })
      await sleep(200)
      await s.startServer()
      await s.reply(/echo:.*while you were away/, { thread, after: t })
    })

    test('a message waiting behind a running task survives the restart', async () => {
      const c = slowCommand(2500)
      const t = Date.now()
      s.send(`go ${s.script([c.step, { text: 'first of two E2E' }])}`, { thread })
      await until('the command to start', () => c.started())
      const waiting = s.send('the second one', { thread })
      await until('👀 on the waiting message', () => s.tg.reactionsOf(s.CHAT, waiting.message_id).includes('👀'))
      await s.termServer()
      await sleep(200)
      await s.startServer()
      await s.reply(/first of two E2E/, { thread, after: t, ms: 25_000 })
      await s.reply(/echo:.*the second one/, { thread, after: t, ms: 30_000 })
      await until('👀 to go', () => !s.tg.reactionsOf(s.CHAT, waiting.message_id).includes('👀'), 5000)
    })

    test('/stop while the restarted task waits for its command calls it off', async () => {
      const c = slowCommand(6000)
      const t = Date.now()
      s.send(`go ${s.script([c.step, { text: 'never said E2E' }])}`, { thread })
      await until('the command to start', () => c.started())
      await s.killServer()
      await s.startServer()
      await until('the note about the command', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && /🔄/.test(m.text) && /1 command|1 команда/.test(m.text)), 20_000)
      s.send('/stop', { thread })
      await until('the task to be called off', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && /⏹/.test(m.text)), 15_000)
      await sleep(1500)
      assert.equal(answers(/never said E2E/).length, 0)
      await sleep(5000)
      assert.equal(c.done(), false, '/stop reached the command on the computer')
    })

    test('nothing raw, nothing in the wrong language, nothing left the computer', () => {
      assert.deepEqual(s.tg.findings, [])
      assert.deepEqual(s.netViolations(), [])
    })
  })
}
