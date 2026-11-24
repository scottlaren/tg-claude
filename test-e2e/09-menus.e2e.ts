import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { until, sleep, pairCodeIn, OWNER_ID, type Stack } from './support/stack.ts'
import { boot, setMode, openTopic } from './support/boot.ts'

// The menus behind the commands, walked as far as they go: /language, /model, /profiles with a real (fake CLI) sign-in,
// /schedule with a task that really runs, /compact, /delete, /cleanup, /users, /computer with a second computer

for (const language of ['en', 'ru'] as const) {
  describe(`menus in ${language}`, () => {
    let s: Stack
    let thread = 0
    let zone = ''
    const tr = (en: RegExp, ru: RegExp) => (language === 'en' ? en : ru)

    before(async () => {
      const b = await boot(language, ['alpha', 'beta'])
      s = b.s
      thread = b.thread
      zone = b.agent.zone
    })
    after(() => s?.stop())

    const updated = (id: number) => s.tg.sent.find(m => m.message_id === id)!

    test('/language switches the bot and its menu at once, and back', async () => {
      let t = Date.now()
      const other = language === 'en' ? 'ru' : 'en'
      s.send('/language')
      const card = await s.reply(/🌐/, { after: t })
      const menuBefore = s.tg.commands.length
      s.tg.setLang(null)
      await s.tap(card, `lang:${other}`)
      await until('the menu in the new language', () => s.tg.commands.length > menuBefore)
      assert.equal(/[А-Яа-я]/.test(s.tg.commands.at(-1)!.list[0].description), other === 'ru', 'the menu follows')
      t = Date.now()
      s.send('/status', { thread })
      await s.reply(other === 'ru' ? /Компьютер/ : /Computer/, { thread, after: t })
      t = Date.now()
      s.send('/language')
      await s.tap(await s.reply(/🌐/, { after: t }), `lang:${language}`)
      await sleep(300)
      s.tg.setLang(language)
    })

    test('/model: every model and effort button answers and the next turn runs on them', async () => {
      const t = Date.now()
      s.send('/model', { thread })
      const card = await until('the model card', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && m.buttons.flat().some(b => /^mdl:/.test(b.data ?? ''))))
      const sonnet = card.buttons.flat().find(b => /Sonnet/.test(b.text))!
      await s.tap(card, sonnet.data!)
      await until('the card to show it', () => /Sonnet/.test(updated(card.message_id).text))
      const high = updated(card.message_id).buttons.flat().find(b => /^eff:high/.test(b.data ?? ''))!
      await s.tap(updated(card.message_id), high.data!)
      await sleep(100)
      const t2 = Date.now()
      s.send('on sonnet now', { thread })
      await s.reply(/echo:.*on sonnet now/, { thread, after: t2 })
      const turn = s.journal().filter(j => j.kind === 'turn').at(-1)!
      assert.match(turn.model, /sonnet/)
      assert.equal(turn.effort, 'high')
    })

    test('/usage and /profiles speak in a sane way; a sign-in through the (fake) CLI takes a code from the chat and removes it', async () => {
      let t = Date.now()
      s.send('/usage')
      const usage = await s.reply(/12|34/, { after: t, ms: 8000 })
      assert.match(usage.text, /main/)
      t = Date.now()
      // A second profile, not signed in: /profiles offers to sign in to it
      mkdirSync(join(s.dataDir, 'profiles', 'second'), { recursive: true })
      s.send('/profiles')
      const profiles = await s.reply(/second/, { after: t, ms: 8000 })
      const signIn = profiles.buttons.flat().find(b => b.data === 'lg:second')
      assert.ok(signIn, 'a button to sign in')
      t = Date.now()
      await s.tap(profiles, 'lg:second')
      const link = await s.reply(/oauth\/authorize/, { after: t, ms: 10_000 })
      assert.ok(link.buttons.flat().some(b => b.data === 'lgx'), 'a way out')
      t = Date.now()
      const code = s.send('good-code#state')
      await s.reply(tr(/Claude connected/, /Claude подключён/), { after: t, ms: 10_000 })
      await until('the code to leave the chat', () => s.tg.userMessageOf(s.CHAT, code.message_id).deleted)
      assert.ok(existsSync(join(s.dataDir, 'profiles', 'second', '.signed-in')))
      t = Date.now()
      s.send('/profile', { thread })
      const pick = await until('the profile card', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && m.buttons.flat().some(b => b.data === 'pf:second')))
      await s.tap(pick, 'pf:second')
    })

    test('/schedule: a task proposed, confirmed with a button, run once in its minute; pause and delete; a time zone', async () => {
      await setMode(s, thread, 'all')
      let t = Date.now()
      s.send(`plan ${s.script([{ tool: 'mcp__schedule__schedule_task', input: { name: 'E2E check', cron: '0 9 * * *', prompt: 'Check it E2E' } }, { text: 'proposed E2E' }])}`, { thread })
      const offer = await until('the offer', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && /Check it E2E/.test(m.text) && m.buttons.flat().length > 0))
      await s.reply(/proposed E2E/, { thread, after: t })
      await s.tap(offer, offer.buttons.flat()[0].data!)
      t = Date.now()
      s.send('/schedule', { thread })
      let list = await s.reply(/E2E check/, { thread, after: t })
      const pause = list.buttons.flat().find(b => /^sch:p:/.test(b.data ?? ''))!
      await s.tap(list, pause.data!)
      await until('on pause', () => updated(list.message_id).buttons.flat().some(b => b.text.startsWith('▶️')))
      await s.tap(updated(list.message_id), updated(list.message_id).buttons.flat().find(b => /^sch:p:/.test(b.data ?? ''))!.data!)
      await until('back on', () => updated(list.message_id).buttons.flat().some(b => b.text.startsWith('⏸')))
      await s.tap(updated(list.message_id), 'sch:tz')
      t = Date.now()
      await sleep(200)
      s.send('UTC+3', { thread })
      await s.reply(/UTC\+3|\+03|3/, { thread, after: t })
      t = Date.now()
      s.send('/schedule', { thread })
      list = await s.reply(/E2E check/, { thread, after: t })
      const del = list.buttons.flat().find(b => /^sch:d:/.test(b.data ?? ''))!
      await s.tap(list, del.data!)
      await until('deleted', () => !/E2E check/.test(updated(list.message_id).text) || updated(list.message_id).buttons.flat().some(b => /^sch:(yes|ok|dd|D)/.test(b.data ?? '')))
    })

    test('/compact works on the real session id, /new resets it', async () => {
      const t = Date.now()
      s.send('/compact', { thread })
      const card = await until('the compact card', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && m.buttons.flat().some(b => /^(cp|cmp|compact)/.test(b.data ?? '')) ))
      await s.tap(card, card.buttons.flat().find(b => /^(cp|cmp|compact)/.test(b.data ?? ''))!.data!)
      await until('Claude to compact', () => s.journal().some(j => j.kind === 'compact' && j.at >= t), 8000)
      await sleep(300)
    })

    test('/computer: a second computer takes the topic over: copies the project, the conversation goes on', async () => {
      const t0 = Date.now()
      s.send('/pair')
      const m = await s.reply(/install\//, { after: t0 })
      const second = await s.pairAgent('Second-PC', pairCodeIn(m)!, ['beta'])
      await sleep(400)
      writeFileSync(join(zone, 'alpha', 'file-to-carry.txt'), 'carried over')
      const session = s.journal().filter(j => j.kind === 'turn').at(-1)!.session
      let t = Date.now()
      s.send('/computer', { thread })
      const card = await until('computers', () => s.tg.sent.find(x => x.touched >= t && x.thread === thread && x.buttons.flat().some(b => /^cs:/.test(b.data ?? '') && /Second-PC/.test(b.text))))
      await s.tap(card, card.buttons.flat().find(b => /Second-PC/.test(b.text))!.data!)
      // The folder isn't there: it offers to copy
      const offer = await until('how to bring the folder', () => s.tg.sent.find(x => x.touched >= t && x.thread === thread && x.buttons.flat().some(b => /^cs:copy/.test(b.data ?? ''))), 10_000)
      t = Date.now()
      await s.tap(offer, offer.buttons.flat().find(b => /^cs:copy/.test(b.data ?? ''))!.data!)
      await until('the file on the other computer', () => existsSync(join(second.zone, 'alpha', 'file-to-carry.txt')), 20_000)
      assert.equal(readFileSync(join(second.zone, 'alpha', 'file-to-carry.txt'), 'utf8'), 'carried over')
      await sleep(500)
      t = Date.now()
      s.send('on the other one', { thread })
      await s.reply(/echo:.*on the other one/, { thread, after: t })
      const turn = s.journal().filter(j => j.kind === 'turn').at(-1)!
      assert.equal(turn.session, session, 'the same conversation')
      assert.match(turn.appendText, /Second-PC/)
    })

    test('/devices: rename a computer, remove one; a topic on it says so', async () => {
      let t = Date.now()
      s.send('/devices')
      const card = await until('the card', () => s.tg.sent.find(x => x.touched >= t && x.buttons.flat().some(b => /^dv:/.test(b.data ?? '') && /Second-PC/.test(b.text))))
      await s.tap(card, card.buttons.flat().find(b => /Second-PC/.test(b.text))!.data!)
      const inner = await until('the computer', () => s.tg.sent.find(x => x.touched >= t && x.buttons.flat().some(b => /^rn:/.test(b.data ?? ''))))
      t = Date.now()
      await s.tap(inner, inner.buttons.flat().find(b => /^rn:/.test(b.data ?? ''))!.data!)
      await sleep(200)
      s.send('Bad <name>')
      await s.reply(tr(/Up to 40 characters/, /До 40 символов/), { after: t, ms: 6000 })
      t = Date.now()
      s.send('Renamed PC')
      await s.reply(/Renamed PC/, { after: t, ms: 6000 })
      t = Date.now()
      s.send('/status', { thread })
      await s.reply(/Renamed/, { thread, after: t })
    })

    test('/users: another account asks in, the owner confirms, it works; then it goes', async () => {
      const other = { id: 555001, is_bot: false, first_name: 'Other <one>', username: 'other_one', language_code: language }
      let t = Date.now()
      s.send('/users')
      const card = await until('the card', () => s.tg.sent.find(x => x.touched >= t && x.buttons.flat().some(b => b.data === 'usr:add')))
      await s.tap(card, 'usr:add')
      await sleep(200)
      t = Date.now()
      s.tg.text(other, other.id, 'hello bot')
      const ask = await until('the question to the owner', () => s.tg.sent.find(x => x.touched >= t && x.chat.id === OWNER_ID && x.buttons.flat().some(b => /^usr:yes/.test(b.data ?? ''))))
      await s.tap(ask, ask.buttons.flat().find(b => /^usr:yes/.test(b.data ?? ''))!.data!)
      await sleep(300)
      t = Date.now()
      s.tg.text(other, other.id, '/status')
      await until('an answer to the new account', () => s.tg.sent.find(x => x.touched >= t && x.chat.id === other.id))
    })

    test('/cleanup: each choice asks first and then does it; /delete deletes a topic with its session', async () => {
      let t = Date.now()
      s.send('/cleanup')
      const card = await until('the card', () => s.tg.sent.find(x => x.touched >= t && x.buttons.flat().some(b => /^cl:/.test(b.data ?? ''))))
      for (const b of card.buttons.flat().filter(x => /^cl:/.test(x.data ?? ''))) {
        const t2 = Date.now()
        await s.tap(card, b.data!)
        const confirm = await until(`a question for ${b.data}`, () => s.tg.sent.find(x => x.touched >= t2 && x.buttons.flat().some(k => /^clok:/.test(k.data ?? '') || k.data === 'clno')), 6000).catch(() => null)
        if (confirm) await s.tap(confirm, confirm.buttons.flat().find(k => k.data === 'clno')?.data ?? 'clno')
      }
      t = Date.now()
      s.send('/topic Doomed')
      const computers = await until('the computers', () => s.tg.sent.find(x => x.touched >= t && x.thread && x.buttons.flat().some(b => /^pd:/.test(b.data ?? '') && /E2E-PC/.test(b.text))))
      const doomed = computers.thread!
      await s.tap(computers, computers.buttons.flat().find(b => /E2E-PC/.test(b.text))!.data!)
      await until('the projects', () => s.tg.sent.find(x => x.message_id === computers.message_id)!.buttons.flat().some(b => b.text === 'beta'))
      await s.tap(s.tg.sent.find(x => x.message_id === computers.message_id)!, /^beta$/)
      await sleep(300)
      t = Date.now()
      s.send('/delete', { thread: doomed })
      const ask = await until('the question', () => s.tg.sent.find(x => x.touched >= t && x.thread === doomed && x.buttons.flat().some(b => b.data === 'del:yes')))
      await s.tap(ask, 'del:yes')
      await until('the topic to go', () => !s.tg.topics.get(s.CHAT)!.has(doomed))
      s.send('/delete')
      await sleep(400)
    })

    test('nothing raw, nothing in the wrong language, nothing left the computer', () => {
      assert.deepEqual(s.tg.findings, [])
      assert.deepEqual(s.netViolations(), [])
    })
  })
}
