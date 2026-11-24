import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startStack, pairCodeIn, until, sleep, ROOT, type Stack } from './support/stack.ts'

// An update with the helper faked as far as the folder it shares with the server: the card, the wait for tasks (3 minutes
// made short here), update now, cancel, a helper that fails and queues that go on, a restart into the new version

const NEXT = '9.9.9'
const CURRENT: string = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

for (const language of ['en', 'ru'] as const) {
  describe(`update in ${language}`, () => {
    let s: Stack
    let thread = 0
    let other = 0
    const tr = (en: RegExp, ru: RegExp) => (language === 'en' ? en : ru)
    let seq = 0

    before(async () => {
      s = await startStack({ language, config: { updateWaitMs: 4000 } })
      s.tg.setLang(language)
      s.helper.tags = [`v${NEXT}`]
      s.helper.release = { tag_name: `v${NEXT}`, body: `**The new thing.** It is new, E2E.\n\n### Русский\n\n**Новая штука.** Она новая, E2E.`, html_url: `https://github.com/x/y/releases/tag/v${NEXT}` }
      await s.startServer()
      const t = Date.now()
      s.send('/pair')
      const m = await s.reply(/install\//, { after: t })
      await s.pairAgent('E2E-PC', pairCodeIn(m)!, ['alpha', 'beta'])
      await sleep(300)
      for (const [name, project] of [['Work', 'alpha'], ['Other', 'beta']]) {
        const c = Date.now()
        s.send(`/topic ${name}`)
        const picker = await until('a picker', () => s.tg.sent.find(x => x.at >= c && x.thread && x.buttons.flat().some(b => b.text === project)))
        if (name === 'Work') thread = picker.thread!
        else other = picker.thread!
        await s.tap(picker, new RegExp(`^${project}$`))
        await s.reply(new RegExp(project), { thread: picker.thread, after: c })
      }
    })
    after(() => s?.stop())

    const card = async () => {
      const t = Date.now()
      s.send('/update')
      return s.reply(new RegExp(NEXT), { after: t, ms: 10_000 })
    }
    const go = async () => {
      const c = await card()
      assert.match(c.text, tr(/The new thing/, /Новая штука/), 'the notes in the language of the bot')
      assert.doesNotMatch(c.text, tr(/Новая штука/, /The new thing/))
      const t = Date.now()
      await s.tap(c, /⬆️/)
      return t
    }
    const busyTask = () => {
      const go = `task-go-${language}-${++seq}`
      const started = `task-started-${language}-${seq}`
      return { go, started, script: s.script([{ mark: started }, { wait: go }, { text: `task ${seq} done E2E` }]), n: seq }
    }
    const requested = (n: number) => until('the request to the helper', () => s.helper.requests.length > n, 10_000)

    test('/update shows the card; remind me tomorrow and skip answer and take their buttons away', async () => {
      const c = await card()
      await s.tap(c, tr(/Remind/, /Напомнить/))
      await until('the buttons to go', () => !s.tg.sent.find(m => m.message_id === c.message_id)!.buttons.flat().some(b => b.data?.startsWith('upd:')))
      const d = await card()
      await s.tap(d, tr(/Skip/, /Пропустить/))
      await until('the buttons to go', () => !s.tg.sent.find(m => m.message_id === d.message_id)!.buttons.flat().some(b => b.data?.startsWith('upd:')))
    })

    test('a helper that fails: the text says so, polling comes back, queued messages go on', async () => {
      const n = s.helper.requests.length
      const t = await go()
      await requested(n)
      assert.match(s.helper.requests[n], new RegExp(`v${NEXT}`))
      // Telegram holds this one: the bot isn't polling while the helper works
      const held = s.send('held while updating', { thread })
      await sleep(300)
      writeFileSync(join(s.updateDir, 'result'), JSON.stringify({ ok: false, from: CURRENT, to: NEXT, error: 'the build of the new version failed, rolled back' }))
      const said = await s.reply(tr(/Didn't update/, /Не обновился/), { after: t, ms: 10_000 })
      assert.match(said.text, /the build of the new version failed/)
      await s.reply(/echo:.*held while updating/, { thread, after: t, ms: 10_000 })
      void held
    })

    test('with a task running: the card waits, a new message gets 👀 and a note, cancel lets everything go on', async () => {
      const task = busyTask()
      const t0 = Date.now()
      s.send(`go ${task.script}`, { thread })
      await until('the task to start', () => s.flagged(task.started))
      const n = s.helper.requests.length
      const t = await go()
      const wait = await until('the waiting card', () => s.tg.sent.find(m => m.touched >= t && m.buttons.flat().some(b => b.data === 'updw:cancel')))
      // A new message in another topic
      const waiting = s.send('a new task meanwhile', { thread: other })
      await until('👀', () => s.tg.reactionsOf(s.CHAT, waiting.message_id).includes('👀'), 6000)
      await s.reply(tr(/updating to/, /обновляется до/), { thread: other, after: t })
      await s.tap(s.tg.sent.find(m => m.message_id === wait.message_id)!, 'updw:cancel')
      await s.reply(tr(/cancelled/, /отменено/), { after: t, ms: 8000 })
      assert.equal(s.helper.requests.length, n, 'the helper was never asked')
      await s.reply(/echo:.*a new task meanwhile/, { thread: other, after: t, ms: 8000 })
      s.flag(task.go)
      await s.reply(new RegExp(`task ${task.n} done E2E`), { thread, after: t0 })
    })

    test('a failed helper resumes the task and the queue', async () => {
      const task = busyTask()
      const t0 = Date.now()
      s.send(`go ${task.script}`, { thread })
      await until('the task to start', () => s.flagged(task.started))
      const n = s.helper.requests.length
      const t = await go()
      await requested(n)
      writeFileSync(join(s.updateDir, 'result'), JSON.stringify({ ok: false, from: CURRENT, to: NEXT, error: 'could not fetch from GitHub' }))
      await s.reply(tr(/Didn't update/, /Не обновился/), { after: t, ms: 10_000 })
      s.flag(task.go)
      await s.reply(new RegExp(`task ${task.n} done E2E`), { thread, after: t0 })
    })

    test('the wait runs out, the server restarts into the new version: the card becomes the outcome, the task and messages go on', async () => {
      const task = busyTask()
      const t0 = Date.now()
      const asked = s.send(`go ${task.script}`, { thread })
      await until('the task to start', () => s.flagged(task.started))
      const n = s.helper.requests.length
      const t = await go()
      await requested(n)
      // What the helper does: checks out, builds, and the new containers replace the old
      const held = s.send('sent during the switch', { thread: other })
      await s.killServer()
      writeFileSync(join(s.updateDir, 'result'), JSON.stringify({ ok: true, from: CURRENT, to: NEXT }))
      s.flag(task.go)
      await s.startServer()
      const outcome = await until('the outcome', () => s.tg.sent.find(m => m.touched >= t && tr(/Server updated/, /Сервер обновлён/).test(m.text)), 15_000)
      assert.match(outcome.text, new RegExp(NEXT))
      assert.ok(outcome.edits >= 1, 'the message that said an update is on turned into the outcome')
      const answer = await s.reply(new RegExp(`task ${task.n} done E2E`), { thread, after: t0, ms: 25_000 })
      assert.equal(answer.reply_to, asked.message_id)
      await s.reply(/echo:.*sent during the switch/, { thread: other, after: t, ms: 25_000 })
      void held
    })

    test('nothing raw, nothing in the wrong language, nothing left the computer', () => {
      assert.deepEqual(s.tg.findings, [])
      assert.deepEqual(s.netViolations(), [])
    })
  })
}
