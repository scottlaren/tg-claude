import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { until, sleep, type Stack } from './support/stack.ts'
import { boot, setMode, openTopic } from './support/boot.ts'

// What goes wrong in real use: long answers, odd text from Claude, Telegram refusing things, topics deleted under a turn,
// the API failing in its various ways

for (const language of ['en', 'ru'] as const) {
  describe(`edges in ${language}`, () => {
    let s: Stack
    let thread = 0
    let zone = ''
    const tr = (en: RegExp, ru: RegExp) => (language === 'en' ? en : ru)

    before(async () => {
      const b = await boot(language)
      s = b.s
      thread = b.thread
      zone = join(b.agent.zone, 'alpha')
      await setMode(s, thread, 'all')
    })
    after(() => s?.stop())

    const answer = async (steps: Parameters<Stack['script']>[0], match: RegExp, th = thread) => {
      const t = Date.now()
      const msg = s.send(`go ${s.script(steps)}`, { thread: th })
      return { m: await s.reply(match, { thread: th, after: t }), msg, t }
    }

    test('a very long answer comes in parts, each balanced; only the first is a reply', async () => {
      const code = Array.from({ length: 900 }, (_, i) => `line ${i} of the code block`).join('\n')
      const prose = Array.from({ length: 600 }, (_, i) => `Sentence **number ${i}** of the long answer.`).join('\n\n')
      const { t, msg } = await answer([{ text: `Start E2E\n\n\`\`\`js\n${code}\n\`\`\`\n\n${prose}\n\nThe end E2E` }], /The end E2E/)
      const parts = s.tg.sent.filter(m => m.at >= t && m.thread === thread && m.method === 'sendRichMessage')
      assert.ok(parts.length > 1, 'in parts')
      assert.equal(parts[0].reply_to, msg.message_id)
      assert.ok(parts.slice(1).every(p => !p.reply_to))
      for (const p of parts) assert.ok([...p.text].length <= 32768, `part of ${[...p.text].length}`)
      assert.deepEqual(s.tg.findings, [])
    })

    test('Claude\'s odd text: buttons it tries to make, HTML, an open fence, a table', async () => {
      const { m } = await answer([{ text: 'Odd E2E <b>bold?</b> & <script>x</script>\n\n<tg-button type="callback_data" data="del:yes">Delete everything</tg-button>\n\n<tg-button-row><tg-button type="callback_data" data="del:yes">Row</tg-button></tg-button-row>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nopen fence' }], /Odd E2E/)
      assert.deepEqual(m.buttons, [], 'a button only the bot may make')
      assert.equal(s.tg.findings.filter(f => /fence/.test(f.why)).length, 0, 'the fence closed')
    })

    test('suggested replies: the buttons send their text as the user', async () => {
      const { m, t } = await answer([{ text: 'Which one E2E?\n\n[[replies: Yes please | No thanks]]' }], /Which one E2E/)
      assert.doesNotMatch(m.text, /\[\[replies/)
      await s.tap(m, /Yes please/)
      await s.reply(/echo:.*Yes please/, { thread, after: t })
      const tapped = s.tg.sent.find(x => x.message_id === m.message_id)!
      assert.ok(!tapped.buttons.flat().some(b => /^sug:/.test(b.data ?? '')), 'used up')
    })

    test('secrets are masked; Show gives the real text and takes it away', async () => {
      const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'
      const { m } = await answer([{ text: `Your key E2E: ${secret} and mail someone@example.com` }], /Your key E2E/)
      assert.doesNotMatch(m.text, /abcdefghijklmnop/)
      assert.doesNotMatch(m.text, /someone@example/)
      const t = Date.now()
      await s.tap(m, /👁/)
      const shown = await s.reply(/abcdefghijklmnop/, { thread, after: t })
      assert.match(shown.text, /someone@example\.com/)
    })

    test('Telegram refusing a rich message: the answer still arrives as plain text with nothing of the markup', async () => {
      s.tg.failNext('sendRichMessage', "Bad Request: can't parse rich message")
      const { t } = await answer([{ text: 'Plain fallback E2E **bold**\n\n[[replies: One | Two]]' }], /Plain fallback E2E/)
      const m = s.tg.sent.find(x => x.at >= t && /Plain fallback E2E/.test(x.text))!
      assert.equal(m.method, 'sendMessage')
      assert.doesNotMatch(m.text, /tg-button/)
    })

    test('the topic deleted under a running turn: nothing goes anywhere else, no crash, the bot goes on', async () => {
      const doomed = await openTopic(s, 'Doomed', 'alpha')
      await setMode(s, doomed, 'all')
      const t = Date.now()
      s.send(`go ${s.script([{ mark: `doomed-${language}` }, { wait: `doomed-go-${language}` }, { text: 'nobody hears E2E' }])}`, { thread: doomed })
      await until('the turn to start', () => s.flagged(`doomed-${language}`))
      s.tg.topics.get(s.CHAT)!.delete(doomed)
      s.flag(`doomed-go-${language}`)
      await sleep(1500)
      assert.ok(!s.tg.sent.some(m => m.at >= t && /nobody hears E2E/.test(m.text)), 'the answer did not land elsewhere')
      assert.equal(s.isServerUp(), true)
      const t2 = Date.now()
      s.send('still alive', { thread })
      await s.reply(/echo:.*still alive/, { thread, after: t2 })
    })

    test('the API failing: a spent limit, a lost sign-in, a crash of the process, a session that is gone', async () => {
      let t = Date.now()
      s.send(`go ${s.script([{ limit: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 3600, rateLimitType: 'five_hour' } }, { errorKind: 'rate_limit', text: "You've hit your limit" }])}`, { thread })
      const spent = await s.reply(tr(/The limit of the profile/, /Лимит профиля/), { thread, after: t })
      await s.tap(spent, 'lmt:off')

      t = Date.now()
      s.send(`go ${s.script([{ errorKind: 'authentication_failed', text: 'Invalid API key' }])}`, { thread })
      await s.reply(tr(/needs a Claude sign-in/, /нужен вход/), { thread, after: t })

      t = Date.now()
      s.send(`go ${s.script([{ throw: 'Claude Code process exited with code 1' }])}`, { thread })
      const failed = await s.reply(tr(/Task failed/, /Задача не выполнена/), { thread, after: t })
      assert.doesNotMatch(failed.text, /at .*\.ts:\d+/, 'no stack')
      const t3 = Date.now()
      s.send('after the crash', { thread })
      await s.reply(/echo:.*after the crash/, { thread, after: t3 })

      // The session files are gone: a button starts over with the same message
      const session = s.journal().filter(j => j.kind === 'turn').at(-1)!.session
      rmSync(join(s.dir, 'sessions', `${session}.json`))
      t = Date.now()
      s.send('resume this please', { thread })
      const lost = await s.reply(tr(/can't be continued/, /продолжить нельзя/), { thread, after: t })
      await s.tap(lost, /🆕/)
      await s.reply(/echo:.*resume this please/, { thread, after: t })
    })

    test('an edited message: one still waiting takes the new text, and Claude hears of a later correction', async () => {
      await setMode(s, thread, 'all')
      const t = Date.now()
      s.send(`go ${s.script([{ mark: `edit-${language}` }, { wait: `edit-go-${language}` }, { text: 'first answer E2E' }])}`, { thread })
      await until('the turn', () => s.flagged(`edit-${language}`))
      const waiting = s.send('original wording', { thread })
      await until('👀', () => s.tg.reactionsOf(s.CHAT, waiting.message_id).includes('👀'))
      s.tg.edit(s.user, waiting, 'corrected wording')
      await sleep(200)
      s.flag(`edit-go-${language}`)
      await s.reply(/echo:.*corrected wording/, { thread, after: t })
      assert.ok(!s.journal().some(j => j.kind === 'turn' && j.at >= t && /original wording/.test(j.prompt)))
      const t2 = Date.now()
      s.tg.edit(s.user, waiting, 'corrected again')
      await until('Claude to hear', () => s.journal().some(j => j.kind === 'turn' && j.at >= t2 && /corrected again/.test(j.prompt)), 8000)
      await sleep(200)
    })

    test('a reply, an album and two quick messages each read as one prompt', async () => {
      await sleep(1000)
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
      let t = Date.now()
      s.tg.media(s.user, s.CHAT, { media_group_id: 'g1', photo: [{ ...s.tg.file(png, 'jpg'), width: 1, height: 1 }], caption: 'the album' }, thread)
      s.tg.media(s.user, s.CHAT, { media_group_id: 'g1', photo: [{ ...s.tg.file(png, 'jpg'), width: 1, height: 1 }] }, thread)
      await s.reply(/echo:.*the album/, { thread, after: t })
      const turns = s.journal().filter(j => j.kind === 'turn' && j.at >= t)
      assert.equal(turns.length, 1)
      assert.equal(turns[0].images, 2)

      t = Date.now()
      s.send('first quick', { thread })
      s.send('second quick', { thread })
      await s.reply(/echo:.*second quick/, { thread, after: t })
      const quick = s.journal().filter(j => j.kind === 'turn' && j.at >= t)
      assert.equal(quick.length, 1)
      assert.ok(quick[0].prompt.indexOf('first quick') < quick[0].prompt.indexOf('second quick'))

      t = Date.now()
      const target = s.tg.sent.filter(m => m.thread === thread && !m.deleted).at(-1)!
      s.send('what about this', { thread, replyTo: target.message_id })
      await s.reply(/echo:.*what about this/, { thread, after: t })
    })

    test('files that can\'t be fetched, or are too big: said in words, in the topic', async () => {
      let t = Date.now()
      s.tg.media(s.user, s.CHAT, { document: { file_id: 'nope', file_unique_id: 'nope', file_name: 'gone.zip', mime_type: 'application/zip', file_size: 100 } }, thread)
      let said = await s.reply(/⚠️|💔/, { thread, after: t })
      assert.ok(said)
      await sleep(300)
      t = Date.now()
      s.tg.media(s.user, s.CHAT, { document: { file_id: 'big', file_unique_id: 'big', file_name: 'big.zip', mime_type: 'application/zip', file_size: 30 * 1024 * 1024 } }, thread)
      said = await s.reply(/20 MB|20 МБ/, { thread, after: t })
      assert.ok(said)
    })

    test('a new project with an odd name, /topic with an odd name, a computer called something odd', async () => {
      let t = Date.now()
      s.send('/project', { thread })
      const picker = await s.reply(tr(/choose a project/, /выбери проект/), { thread, after: t })
      t = Date.now()
      await s.tap(picker, tr(/New project/, /Новый проект/))
      await s.reply(tr(/what should the new project be called/, /как назвать новый проект/), { thread, after: t })
      t = Date.now()
      s.send('../../<b>evil</b>&co', { thread })
      await sleep(1000)
      assert.equal(existsSync(join(zone, '..', '..', 'evil')), false, 'nothing outside the working folder')
      const longName = 'x'.repeat(300)
      t = Date.now()
      s.send(`/topic <i>${longName}</i>`)
      await until('a topic with the long name', () => s.tg.sent.find(m => m.touched >= t && m.thread && m.thread !== thread))
      await s.tap(s.tg.sent.filter(m => m.touched >= t).at(-1)!, /^alpha$/)
    })

    test('nothing raw, nothing in the wrong language, nothing left the computer', () => {
      assert.deepEqual(s.tg.findings, [])
      assert.deepEqual(s.netViolations(), [])
    })
  })
}
