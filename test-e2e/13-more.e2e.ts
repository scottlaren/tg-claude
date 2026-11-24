import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { until, sleep, pairCodeIn, startStack, type Stack } from './support/stack.ts'
import { boot, setMode, openTopic } from './support/boot.ts'

// The rest: a topic with no project and the offer of one, topics writing to each other, the card for a neighbouring
// folder, an MCP server refused, files over the limits, a head deleted with its agents, the speech model that can't be
// fetched, a group without topics, Telegram's limit on a group

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

for (const language of ['en', 'ru'] as const) {
  describe(`more in ${language}`, () => {
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

    test('no project: a conversation with no hands; Claude offers a project with a button, the talk goes on there', async () => {
      let t = Date.now()
      s.send('/topic Chat')
      const picker = await until('a picker', () => s.tg.sent.find(m => m.touched >= t && m.thread && m.thread !== thread && m.buttons.flat().some(b => b.data === 'nop')))
      const chat = picker.thread!
      await s.tap(picker, 'nop')
      t = Date.now()
      s.send(`talk ${s.script([{ tool: 'mcp__topic__suggest_project', input: { reason: 'We need files E2E' } }, { text: 'see the button E2E' }])}`, { thread: chat })
      await s.reply(/see the button E2E/, { thread: chat, after: t })
      const turn = s.journal().filter(j => j.kind === 'turn').at(-1)!
      assert.ok(!turn.servers.includes('device'), 'no hands on a computer')
      assert.match(turn.model, /sonnet/, 'the chat model')
      const tool = s.journal().filter(j => j.kind === 'tool').at(-1)!
      assert.equal(tool.isError, false, tool.text)
      const offer = await until('the offer', () => s.tg.sent.find(m => m.touched >= t && m.thread === chat && m.buttons.flat().some(b => /^(spn|spp):/.test(b.data ?? ''))), 5000)
      await s.tap(offer, offer.buttons.flat().find(b => /^(spn|spp):/.test(b.data ?? ''))!.data!)
      await sleep(300)
    })

    test('topics write to each other: a folded message there, a turn under the stricter mode', async () => {
      await setMode(s, thread, 'read')
      const other = await openTopic(s, 'Target', 'beta')
      await setMode(s, other, 'all')
      await setMode(s, thread, 'read')
      const t = Date.now()
      s.send(`tell ${s.script([{ tool: 'mcp__topics__message_topic', input: { topic: 'Target', text: 'Please do it E2E' } }, { text: 'told E2E' }])}`, { thread })
      await s.reply(/told E2E/, { thread, after: t })
      await s.reply(/Please do it E2E/, { thread: other, after: t })
      await until('its turn', () => s.journal().some(j => j.kind === 'turn' && j.at >= t && /Please do it E2E/.test(j.prompt)), 8000)
      await setMode(s, thread, 'ask')
    })

    test('a neighbouring folder asks with a card, an MCP server that isn\'t pinned is refused without one', async () => {
      await setMode(s, thread, 'ask')
      let t = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__device__add_project_folder', input: { path: join(zone, 'beta').replace(/\\/g, '/') } }, { text: 'folder E2E' }])}`, { thread })
      const card = await until('the card', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && m.buttons.flat().some(b => /^ok:/.test(b.data ?? ''))))
      await s.tap(card, card.buttons.flat().find(b => /^ok:/.test(b.data ?? ''))!.data!)
      await s.reply(/folder E2E/, { thread, after: t })
      assert.match(s.journal().filter(j => j.kind === 'tool').at(-1)!.text, /Added/)

      t = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__device__add_mcp_server', input: { name: 'bad', command: 'npx', args: ['-y', 'some-mcp'] } }, { text: 'refused E2E' }])}`, { thread })
      await s.reply(/refused E2E/, { thread, after: t })
      assert.equal(s.journal().filter(j => j.kind === 'tool').at(-1)!.verdict, 'deny')
    })

    test('a picture too big for a photo, a file too big to send, a second picture that is fine: each said for itself', async () => {
      await setMode(s, thread, 'all')
      const dir = join(zone, 'alpha')
      writeFileSync(join(dir, 'fine.png'), PNG)
      // Over the 10 MB of a photo. Sparse-looking content is enough: it isn't sent
      writeFileSync(join(dir, 'huge.png'), Buffer.alloc(11 * 1024 * 1024, 1))
      writeFileSync(join(dir, 'over.bin'), Buffer.alloc(51 * 1024 * 1024, 1))
      const t = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__device__send_file', input: { path: 'over.bin' } }, { text: 'Pictures E2E\n\n![fine](fine.png)\n\n![huge](huge.png)' }])}`, { thread })
      const answer = await s.reply(/Pictures E2E/, { thread, after: t, ms: 30_000 })
      assert.equal(answer.media.length >= 1, true)
      assert.match(answer.text, /tg:\/\/photo\?id=m1/)
      assert.match(answer.text, /tg:\/\/document\?id=m2/, 'too big for a photo: it arrives as a file')
      const tool = s.journal().filter(j => j.kind === 'tool' && j.at >= t).at(-1)!
      assert.equal(tool.isError, true)
      assert.match(tool.text, /50 MB|50 МБ/)
    })

    test('a video with no ffmpeg on the server still reaches Claude', async () => {
      const t = Date.now()
      s.tg.media(s.user, s.CHAT, { video: { ...s.tg.file(Buffer.from('not really'), 'mp4'), width: 1, height: 1, duration: 1, file_name: 'a.mp4', mime_type: 'video/mp4' }, caption: 'the video E2E' }, thread)
      await s.reply(/echo:.*the video E2E/, { thread, after: t, ms: 10_000 })
    })

    test('long things: an agent\'s report, a command on its card, a question, a message between topics', async () => {
      const long = 'word '.repeat(2500).trim()
      const lead = await openTopic(s, 'Long', 'beta')
      await setMode(s, lead, 'ask')
      let t = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__device__run_command', input: { command: `echo ${long}` } }, { text: 'long card E2E' }])}`, { thread: lead })
      const card = await until('the card', () => s.tg.sent.find(m => m.touched >= t && m.thread === lead && m.buttons.flat().some(b => /^no:/.test(b.data ?? ''))))
      await s.tap(card, card.buttons.flat().find(b => /^no:/.test(b.data ?? ''))!.data!)
      await s.reply(/long card E2E/, { thread: lead, after: t })

      t = Date.now()
      s.send(`go ${s.script([{ tool: 'AskUserQuestion', input: { questions: [{ question: `${long} E2E?`, header: 'Q', multiSelect: false, options: [{ label: 'L'.repeat(200), description: long.slice(0, 500) }, { label: 'Short', description: 'x' }] }] } }, { text: 'long question E2E' }])}`, { thread: lead })
      const q = await until('the question', () => s.tg.sent.find(m => m.touched >= t && m.thread === lead && m.buttons.flat().some(b => /Short/.test(b.text))))
      await s.tap(q, /Short/)
      await s.reply(/long question E2E/, { thread: lead, after: t })

      await setMode(s, lead, 'all')
      const worker = s.script([{ text: `${long} report end E2E` }])
      t = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__team__start_agent', input: { name: 'Longer', task: `${long.slice(0, 6000)} ${worker}`, model: 'haiku', effort: 'low', project: 'beta' } }, { tool: 'mcp__topics__message_topic', input: { topic: 'Work', text: long } }, { text: 'long start E2E' }])}`, { thread: lead })
      await s.reply(/long start E2E/, { thread: lead, after: t })
      const report = await until('the report', () => s.tg.sent.find(m => m.at >= t && m.thread === lead && /Longer/.test(m.text) && /<blockquote/.test(m.text) && /word/.test(m.text)), 15_000)
      assert.ok(report)
      await sleep(3000)
      assert.deepEqual(s.tg.calls.filter(c => !c.ok && /too long/.test(c.error ?? '')).map(c => c.method), [])
    })

    test('a head deleted takes its agents with it', async () => {
      const head = await openTopic(s, 'Leader', 'beta')
      await setMode(s, head, 'all')
      const t = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__team__start_agent', input: { name: 'One', task: 'Say hi', model: 'haiku', effort: 'low', project: 'beta' } }, { text: 'agent up E2E' }])}`, { thread: head })
      await s.reply(/agent up E2E/, { thread: head, after: t })
      const topic = [...s.tg.topics.get(s.CHAT)!].find(([, x]) => x.name === '🤖 One')
      assert.ok(topic)
      await until('the report', () => s.tg.sent.some(m => m.at >= t && m.thread === head && /🤖/.test(m.text) && /One/.test(m.text) && /Say hi/.test(m.text)), 15_000)
      // Let the head read the report
      await sleep(3500)
      const t2 = Date.now()
      s.send('/delete', { thread: head })
      const ask = await until('the question', () => s.tg.sent.find(m => m.touched >= t2 && m.thread === head && m.buttons.flat().some(b => b.data === 'del:yes')), 8000)
      await s.tap(ask, 'del:yes')
      await until('both topics to go', () => !s.tg.topics.get(s.CHAT)!.has(head) && !s.tg.topics.get(s.CHAT)!.has(topic![0]), 8000)
    })

    test('nothing raw, nothing in the wrong language, nothing left the computer', () => {
      assert.deepEqual(s.tg.findings, [])
      assert.deepEqual(s.netViolations(), [])
    })
  })

  describe(`speech and groups in ${language}`, () => {
    let s: Stack
    let device = ''
    const GROUP = -1003000000099
    const tr = (en: RegExp, ru: RegExp) => (language === 'en' ? en : ru)

    before(async () => {
      s = await startStack({
        language,
        // Everything for speech but the model: any program stands in, nothing gets as far as running it
        env: { FFMPEG_BIN: process.execPath, FFPROBE_BIN: process.execPath, WHISPER_BIN: process.execPath, CLOUD_KEY: 'e2e-cloud-key' },
      })
      s.tg.setLang(language)
      await s.startServer()
      const t = Date.now()
      s.send('/pair')
      const m = await s.reply(/install\//, { after: t })
      device = (await s.pairAgent('E2E-PC', pairCodeIn(m)!, ['alpha'])).id
      await sleep(300)
    })
    after(() => s?.stop())

    test('a voice message with no speech model: an offer; a download that fails says so in words and the bot goes on', async () => {
      const thread = await openTopic(s, 'Voice', 'alpha')
      let t = Date.now()
      s.tg.media(s.user, s.CHAT, { voice: { ...s.tg.file(Buffer.from('OggS'), 'ogg'), duration: 1, mime_type: 'audio/ogg' } }, thread)
      const offer = await until('the offer', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && m.buttons.flat().some(b => b.data)), 10_000)
      t = Date.now()
      await s.tap(offer, offer.buttons.flat().find(b => b.data)!.data!)
      const failed = await until('the failure', () => s.tg.sent.find(m => m.touched >= t && tr(/didn't download/, /не скачалась/).test(m.text)), 20_000)
      assert.doesNotMatch(failed.text, /e2e guard|fetch failed/, 'in words')
      assert.ok(s.netViolations().length >= 1, 'it did try, and the guard caught it')
      t = Date.now()
      s.send('still here', { thread })
      await s.reply(/echo:.*still here/, { thread, after: t })
    })

    test('a group without topics, and with no rights: said what it lacks', async () => {
      const t = Date.now()
      const chat = { id: GROUP, type: 'supergroup', title: 'Plain group', is_forum: false }
      s.tg.chats.set(GROUP, chat)
      s.send('/workspace', { chat: GROUP })
      const said = await s.reply(tr(/Make me an admin of this group/, /Сделай меня админом этой группы/), { chat: GROUP, after: t, ms: 6000 })
      assert.ok(said)
    })

    test('Telegram\'s limit on a group: an answer arrives late, not never', async () => {
      const G = GROUP - 1
      let t = Date.now()
      s.tg.addGroup(s.user, G, 'Busy group')
      const card = await until('the card', () => s.tg.sent.find(m => m.at >= t && m.chat.id === G && m.buttons.flat().some(b => b.data === 'ws:dev')))
      void card
      t = Date.now()
      s.send('/topic Busy', { chat: G })
      const hello = await until('a topic', () => s.tg.sent.find(m => m.at >= t && m.chat.id === G && m.thread))
      const thread = hello.thread!
      await until('the choice', () => s.tg.sent.find(m => m.touched >= t && m.chat.id === G && m.thread === thread && m.buttons.flat().some(b => b.text === 'alpha')))
      await s.tap(s.tg.sent.find(m => m.touched >= t && m.chat.id === G && m.thread === thread && m.buttons.flat().some(b => b.text === 'alpha'))!, /^alpha$/)
      await sleep(300)
      t = Date.now()
      s.tg.rateLimit(G, 3)
      s.send(`go ${s.script([{ text: 'came late E2E' }])}`, { chat: G, thread })
      await s.reply(/came late E2E/, { chat: G, thread, after: t, ms: 30_000 })
      assert.ok(Date.now() - t >= 3000, 'it waited the block out')
      assert.ok(device)
    })

    test('every command of the group menu answers in a group topic, in that topic', async () => {
      const G = GROUP - 1
      const thread = [...s.tg.topics.get(G)!.keys()][0]
      const menu = s.tg.commands.findLast(c => c.scope?.type === 'all_group_chats')!.list.map(c => c.command).filter(c => c !== 'delete' && c !== 'topic')
      assert.ok(menu.length > 10)
      // The group's write limit is real here: only the answers are looked at
      await sleep(61_000)
      for (const command of menu) {
        const i = s.tg.sent.length
        s.send(`/${command}`, { chat: G, thread })
        const answer = await until(`an answer to /${command}`, () => s.tg.sent.slice(i).find(m => !m.deleted), 15_000)
        assert.equal(answer.chat.id, G, `/${command} answered elsewhere: ${answer.text.slice(0, 100)}`)
        assert.equal(answer.thread, thread, `/${command} answered outside its topic: ${answer.text.slice(0, 100)}`)
        await sleep(3100)
      }
    })

    test('the cloud: a project there moves to a computer, /github says where it stands', async () => {
      const t = Date.now()
      await s.startCloud()
      await s.online('cloud', 0)
      const open = Date.now()
      s.send('/topic Cloudy')
      const computers = await until('computers', () => s.tg.sent.find(m => m.touched >= open && m.thread && m.buttons.flat().some(b => b.data === 'pd:cloud')))
      await s.tap(computers, 'pd:cloud')
      const thread = computers.thread!
      await until('its projects', () => s.tg.sent.find(m => m.message_id === computers.message_id)!.buttons.flat().some(b => /^np:cloud/.test(b.data ?? '')))
      const t1 = Date.now()
      await s.tap(s.tg.sent.find(m => m.message_id === computers.message_id)!, 'np:cloud')
      await sleep(200)
      s.send('moved-one', { thread })
      await s.reply(/moved-one/, { thread, after: t1 })
      await until('the folder in the cloud', () => existsSync(join(s.cloudWorkspace(), 'moved-one')))
      writeFileSync(join(s.cloudWorkspace(), 'moved-one', 'carry.txt'), 'from the cloud')
      const t2 = Date.now()
      s.send('hello in the cloud', { thread })
      await s.reply(/echo:.*hello in the cloud/, { thread, after: t2 })
      const t3 = Date.now()
      s.send('/move', { thread })
      const card = await until('where to', () => s.tg.sent.find(m => m.touched >= t3 && m.buttons.flat().some(b => /^mv:/.test(b.data ?? ''))), 8000)
      await s.tap(card, card.buttons.flat().find(b => /^mv:/.test(b.data ?? ''))!.data!)
      await until('the project on the computer', () => existsSync(join(s.agents.get('E2E-PC')!.zone, 'moved-one', 'carry.txt')), 20_000)
      assert.equal(readFileSync(join(s.agents.get('E2E-PC')!.zone, 'moved-one', 'carry.txt'), 'utf8'), 'from the cloud')
      // Windows won't remove the folder a command runs in; the real cloud is Linux
      if (process.platform !== 'win32') await until('gone from the cloud', () => !existsSync(join(s.cloudWorkspace(), 'moved-one')), 8000)
      const t4 = Date.now()
      s.send('on the computer now', { thread })
      await s.reply(/echo:.*on the computer now/, { thread, after: t4 })
      assert.match(s.journal().filter(j => j.kind === 'turn').at(-1)!.appendText, /E2E-PC/)
      const t5 = Date.now()
      s.send('/github')
      await s.reply(/GitHub/, { after: t5, ms: 10_000 })
      void t
    })

    test('a cloud project an agent works in is not moved from under it', async () => {
      const open = Date.now()
      s.send('/topic Cloud head')
      const computers = await until('computers', () => s.tg.sent.find(m => m.touched >= open && m.thread && m.buttons.flat().some(b => b.data === 'pd:cloud')))
      await s.tap(computers, 'pd:cloud')
      const thread = computers.thread!
      await until('its projects', () => s.tg.sent.find(m => m.message_id === computers.message_id)!.buttons.flat().some(b => /^np:cloud/.test(b.data ?? '')))
      const t1 = Date.now()
      await s.tap(s.tg.sent.find(m => m.message_id === computers.message_id)!, 'np:cloud')
      await sleep(200)
      s.send('team-one', { thread })
      await s.reply(/team-one/, { thread, after: t1 })
      await until('the folder in the cloud', () => existsSync(join(s.cloudWorkspace(), 'team-one')))
      const t2 = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__team__start_agent', input: { name: 'Inside', task: `Stay. ${s.script([{ text: 'inside done' }])}`, model: 'haiku', effort: 'low' } }, { text: 'agent in the cloud E2E' }])}`, { thread })
      await s.reply(/agent in the cloud E2E/, { thread, after: t2 })
      const t3 = Date.now()
      s.send('/move', { thread })
      await s.reply(tr(/The agent «Inside» works in this project/, /В этом проекте работает агент «Inside»/), { thread, after: t3 })
      assert.ok(!s.tg.sent.some(m => m.touched >= t3 && m.buttons.flat().some(b => /^mv:/.test(b.data ?? ''))), 'no way to move it')
    })

    test('no raw errors', () => {
      assert.deepEqual(s.tg.findings, [])
    })
  })
}
