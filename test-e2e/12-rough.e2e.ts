import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { until, sleep, type Stack } from './support/stack.ts'
import { boot, setMode, openTopic } from './support/boot.ts'

// The rough journeys: restarts that find cards and surveys on the screen, a computer that doesn't come back, a task that
// keeps being cut off, Telegram away for a moment, commands in a busy topic, deleted prompts

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

for (const language of ['en', 'ru'] as const) {
  describe(`rough in ${language}`, () => {
    let s: Stack
    let thread = 0
    let zone = ''
    let id = ''
    let seq = 0
    const tr = (en: RegExp, ru: RegExp) => (language === 'en' ? en : ru)
    const flagName = (x: string) => `${x}-${language}-${++seq}`

    before(async () => {
      const b = await boot(language, ['alpha', 'beta', 'gone'], { config: { recoveryDeviceWaitMs: 2500 } })
      s = b.s
      thread = b.thread
      zone = b.agent.zone
      id = b.agent.id
    })
    after(() => s?.stop())

    const write = (file: string) => ({ tool: 'mcp__device__write_file', input: { path: file, content: 'x' } })
    const updated = (mid: number) => s.tg.sent.find(m => m.message_id === mid)!

    async function restart(how: 'kill' | 'term' = 'kill') {
      const online = s.onlineCount(id)
      await (how === 'kill' ? s.killServer() : s.termServer())
      await s.startServer()
      await s.online(id, online)
    }

    test('a permission card on the screen when the server restarts: its buttons answer, no action is taken, the task goes on', async () => {
      await setMode(s, thread, 'ask')
      const t = Date.now()
      s.send(`go ${s.script([write('never.txt'), { text: 'after the card E2E' }])}`, { thread })
      const card = await until('the card', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && m.buttons.flat().some(b => /^ok:/.test(b.data ?? ''))))
      await restart()
      const old = await s.tap(card, card.buttons.flat().find(b => /^ok:/.test(b.data ?? ''))!.data!)
      assert.ok(old, 'the old button is answered')
      await sleep(600)
      assert.equal(existsSync(join(zone, 'alpha', 'never.txt')), false, 'a card from before the restart does nothing')
      await s.reply(/after the card E2E/, { thread, after: t, ms: 15_000 })
    })

    test('a question on the screen when the server restarts: the old buttons answer, typed text is a new message', async () => {
      const t = Date.now()
      s.send(`go ${s.script([{ tool: 'AskUserQuestion', input: { questions: [{ question: 'Before the restart E2E?', header: 'Q', multiSelect: false, options: [{ label: 'Aaa', description: 'x' }, { label: 'Bbb', description: 'y' }] }] } }, { text: 'after the question E2E' }])}`, { thread })
      const card = await s.reply(/Before the restart E2E/, { thread, after: t })
      await restart()
      await s.tap(card, /Aaa/)
      await s.reply(/after the question E2E/, { thread, after: t, ms: 15_000 })
    })

    test('a survey with a picture survives a restart: ticks still work and the picture stays', async () => {
      writeFileSync(join(zone, 'alpha', 'pic.png'), PNG)
      const t = Date.now()
      s.send(`survey ${s.script([{ tool: 'mcp__survey__ask_survey', input: { title: 'Kept E2E', questions: [{ question: 'Kept question E2E?', image: 'pic.png', multiple: true, options: [{ label: 'Aaa' }, { label: 'Bbb' }] }] } }, { text: 'survey started E2E' }])}`, { thread })
      const first = await s.reply(/Kept question E2E/, { thread, after: t })
      await s.reply(/survey started E2E/, { thread, after: t })
      await restart('term')
      await s.tap(updated(first.message_id), /Aaa/)
      await until('the tick', () => updated(first.message_id).buttons.flat().some(b => /☑️ Aaa/.test(b.text)))
      assert.equal(updated(first.message_id).media.length, 1, 'the picture stays')
      assert.deepEqual(s.tg.findings.filter(f => /picture/.test(f.why)), [])
      const t2 = Date.now()
      await s.tap(updated(first.message_id), language === 'en' ? /Done/ : /Готово/)
      await until('the answers to reach Claude', () => s.journal().some(j => j.kind === 'turn' && j.at >= t2 && /Aaa/.test(j.prompt)), 10_000)
      await sleep(300)
    })

    test('the computer stays away after a restart: the topic waits, says so, goes on without it', async () => {
      await setMode(s, thread, 'all')
      const name = `slow${++seq}.cjs`
      writeFileSync(join(zone, 'alpha', name), "setTimeout(()=>{},4000)")
      const t = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__device__run_command', input: { command: `node ${name}` } }, { text: 'without it E2E' }])}`, { thread })
      await until('the op', () => /run_command/.test(s.serverLogText()) && s.tg.sent.length > 0)
      await sleep(600)
      await s.killServer()
      await s.killAgent('E2E-PC')
      await s.startServer()
      await s.reply(tr(/did not come back in time/, /не вернулся вовремя/), { thread, after: t, ms: 15_000 })
      await until('the continuation', () => s.journal().some(j => j.kind === 'turn' && j.at >= t && /did not come back online/.test(j.prompt)), 10_000)
      const online = s.onlineCount(id)
      await s.startAgent('E2E-PC')
      await s.online(id, online)
      await sleep(1000)
    })

    test('a task cut off again and again stops continuing by itself and says so', async () => {
      const go = flagName('loop')
      const t = Date.now()
      s.send(`go ${s.script([{ mark: `${go}-1` }, { sleep: 1 }, { wait: `${go}-a` }, { wait: `${go}-b` }, { wait: `${go}-c` }, { wait: `${go}-d` }, { text: 'never E2E' }])}`, { thread })
      await until('the first turn', () => s.flagged(`${go}-1`))
      for (let i = 0; i < 4; i++) {
        const seen = s.journal().filter(j => j.kind === 'turn' && j.at >= t).length
        await until('the turn to run', () => s.journal().filter(j => j.kind === 'turn' && j.at >= t).length > (i ? seen - 1 : 0), 10_000)
        await sleep(300)
        await restart()
        if (i < 3) await until('its continuation', () => s.journal().filter(j => j.kind === 'turn' && j.at >= t).length > seen, 10_000)
      }
      await s.reply(tr(/keeps restarting/, /снова перезапустился/), { thread, after: t, ms: 10_000 })
      const turns = s.journal().filter(j => j.kind === 'turn' && j.at >= t)
      assert.equal(turns.length, 4, 'the turn and its 3 continuations')
    })

    for (const how of ['term', 'kill'] as const) test(`${how === 'kill' ? 'killed' : 'SIGTERM'} between the note that it continues and the turn that does: the task is not lost, and runs once`, async () => {
      const name = `slow${++seq}.cjs`
      writeFileSync(join(zone, 'alpha', name), `const fs=require('fs');fs.appendFileSync(${JSON.stringify(join(zone, 'alpha', `${name}.runs`))},'run\\n');setTimeout(()=>console.log('finished the slow one'),800)`)
      const t = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__device__run_command', input: { command: `node ${name}` } }, { text: 'not lost E2E' }])}`, { thread })
      await until('the command to start', () => existsSync(join(zone, 'alpha', `${name}.runs`)))
      await s.killServer()
      await s.startServer()
      // The note says it continues; the turn comes 1.5 s after it
      await until('the note', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && tr(/Continuing it/, /Продолжаю её/).test(m.text)), 15_000)
      assert.equal(s.journal().filter(j => j.kind === 'turn' && j.at >= t).length, 1, 'its turn has not begun')
      await (how === 'kill' ? s.killServer() : s.termServer())
      await s.startServer()
      await s.reply(/not lost E2E/, { thread, after: t, ms: 20_000 })
      // Its saved queue comes back 15 s after a start: nothing must run a second time then
      if (how === 'term') await sleep(16_000)
      const later = s.journal().filter(j => j.kind === 'turn' && j.at >= t)
      assert.equal(later.length, 2, 'the turn, and one continuation')
      assert.match(later[1].prompt, /finished the slow one/, 'with the result the first run learned')
      assert.equal(readFileSync(join(zone, 'alpha', `${name}.runs`), 'utf8').trim().split('\n').length, 1)
    })

    test('stopped between the note and the turn, then killed: it stays stopped', async () => {
      const t = Date.now()
      s.send(`go ${s.script([{ mark: `stayed-${language}` }, { wait: `stayed-go-${language}` }, { text: 'never E2E' }])}`, { thread })
      await until('the turn', () => s.flagged(`stayed-${language}`))
      await s.killServer()
      await s.startServer()
      await until('the note', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && tr(/Continuing it/, /Продолжаю её/).test(m.text)), 15_000)
      s.send('/stop', { thread })
      await sleep(200)
      await s.killServer()
      await s.startServer()
      await sleep(2500)
      assert.equal(s.journal().filter(j => j.kind === 'turn' && j.at >= t).length, 1, 'no continuation after /stop')
    })

    test('Telegram away for a moment: polling comes back, an answer that met a failed send still arrives', async () => {
      const t = Date.now()
      s.tg.dropConnections(['sendRichMessage'], 1)
      s.send('during a blip', { thread })
      await s.reply(/echo:.*during a blip/, { thread, after: t, ms: 15_000 })
      s.tg.dropPolling(true)
      await sleep(2500)
      s.tg.dropPolling(false)
      const t2 = Date.now()
      s.send('after the outage', { thread })
      await s.reply(/echo:.*after the outage/, { thread, after: t2, ms: 25_000 })
      assert.equal(s.isServerUp(), true, 'the process stayed up')
    })

    test('the stop button of a draft; /status, /mode and /project while a turn runs', async () => {
      const go = flagName('busy')
      const t = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__device__list_files', input: {} }, { mark: go }, { wait: `${go}-never` }, { text: 'never E2E' }])}`, { thread })
      await until('the turn', () => s.flagged(go))
      const status = Date.now()
      s.send('/status', { thread })
      await s.reply(tr(/working/, /работает/), { thread, after: status })
      const project = Date.now()
      s.send('/project', { thread })
      const picker = await s.reply(tr(/choose a project/, /выбери проект/), { thread, after: project })
      const refused = await s.tap(picker, /^beta$/)
      assert.match(refused.text ?? '', tr(/finish first/, /дождись конца/))
      const draft = s.tg.drafts().filter(d => d.thread === thread && d.at >= t).at(-1)!
      assert.ok(draft, 'a draft while it works')
      s.tg.stopDraft(s.user, s.CHAT, thread, draft.draft)
      await s.reply(/⏹/, { thread, after: t })
      await sleep(300)
      await s.tap(updated(picker.message_id), /^beta$/)
      await sleep(200)
      const t2 = Date.now()
      s.send('in beta now', { thread })
      await s.reply(/echo:.*in beta now/, { thread, after: t2 })
      assert.match(s.journal().filter(j => j.kind === 'turn').at(-1)!.appendText, /beta/)
    })

    test('a message deleted while it is answered takes the answer back', async () => {
      const go = flagName('deleted')
      const t = Date.now()
      const msg = s.send(`go ${s.script([{ mark: go }, { wait: `${go}-never` }, { text: 'never said E2E' }])}`, { thread })
      await until('the turn', () => s.flagged(go))
      s.tg.userMessageOf(s.CHAT, msg.message_id).deleted = true
      await until('the turn to stop', () => /prompt deleted during its turn/.test(s.serverLogText()), 10_000)
      await sleep(800)
      assert.ok(!s.tg.sent.some(m => m.at >= t && /never said E2E/.test(m.text)))
      const t2 = Date.now()
      s.send('next one', { thread })
      await s.reply(/echo:.*next one/, { thread, after: t2 })
    })

    test('a project gone from the computer: said in words, /project picks another', async () => {
      const other = await openTopic(s, 'Gone', 'gone')
      rmSync(join(zone, 'gone'), { recursive: true })
      const t = Date.now()
      s.send(`look ${s.script([{ tool: 'mcp__device__list_files', input: {} }, { text: 'told about it E2E' }])}`, { thread: other })
      await s.reply(/told about it E2E/, { thread: other, after: t, ms: 8000 })
      const tool = s.journal().filter(j => j.kind === 'tool' && j.at >= t).at(-1)!
      assert.equal(tool.isError, true)
      assert.match(tool.text, /not_found/)
    })

    test('someone else tapping or reacting gets nothing and breaks nothing', async () => {
      const stranger = { id: 42, is_bot: false, first_name: 'Stranger' }
      const t = Date.now()
      s.send('/mode', { thread })
      const card = await until('the mode card', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && m.buttons.flat().some(b => b.data === 'm:read')))
      const a = s.tg.tap(stranger, card, 'm:read')
      await until('the tap answered', () => s.tg.wasAnswered(a), 4000)
      await sleep(200)
      const t2 = Date.now()
      s.send('/status', { thread })
      const st = await s.reply(tr(/Permissions/, /Разрешения/), { thread, after: t2 })
      assert.doesNotMatch(st.text, tr(/Read only/, /Только просмотр/), 'a stranger changed nothing')
      s.tg.react(stranger, s.CHAT, card.message_id, ['👎'])
      await sleep(200)
    })

    test('a working folder picked from the bot: the browser of folders opens, a choice applies', async () => {
      const t = Date.now()
      s.send('/devices')
      const list = await until('the card', () => s.tg.sent.find(m => m.touched >= t && m.buttons.flat().some(b => /^dv:/.test(b.data ?? ''))))
      await s.tap(list, list.buttons.flat().find(b => /^dv:/.test(b.data ?? ''))!.data!)
      const one = await until('the computer', () => s.tg.sent.find(m => m.touched >= t && m.buttons.flat().some(b => /^zo:/.test(b.data ?? ''))))
      const t2 = Date.now()
      await s.tap(one, one.buttons.flat().find(b => /^zo:/.test(b.data ?? ''))!.data!)
      const zones = await until('the working folders', () => s.tg.sent.find(m => m.touched >= t2 && /zone/.test(m.text) && m.buttons.flat().some(b => /^z/.test(b.data ?? ''))), 6000)
      assert.ok(zones)
    })

    test('nothing raw, nothing in the wrong language, nothing left the computer', () => {
      assert.deepEqual(s.tg.findings, [])
      assert.deepEqual(s.netViolations(), [])
    })
  })
}
