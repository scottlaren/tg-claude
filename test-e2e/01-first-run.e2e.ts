import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { controlPath } from '../apps/agent/src/control.ts'
import { startStack, pairCodeIn, until, sleep, OWNER_ID, type Stack } from './support/stack.ts'

// First run: the owner claims the bot through the installer's link, pairs a computer, picks a project and works

const CLAIM = 'e2e-claim-code'

for (const language of ['en', 'ru'] as const) {
describe(`first run in ${language}`, () => {
const tr = (en: RegExp, ru: RegExp) => (language === 'en' ? en : ru)
let s: Stack
before(async () => {
  s = await startStack({ owner: false, claim: CLAIM, language })
  s.tg.setLang(language)
  await s.startServer()
})
after(() => s?.stop())

test('a stranger gets nothing before the claim, /start with the code makes the owner', async () => {
  s.send('hello')
  await sleep(500)
  assert.equal(s.tg.sent.length, 0, 'an unclaimed bot stays silent')
  s.send(`/start ${CLAIM}`)
  const m = await s.reply(tr(/The bot is yours now/, /Бот теперь твой/))
  assert.match(m.text, tr(/Connect a computer/, /Подключи компьютер/))
  assert.ok(m.buttons.flat().some(b => tr(/Connect a computer/, /Подключить компьютер/).test(b.text)), 'the button to connect a computer')
})

test('/start shows the help, the menu has commands in both scopes', async () => {
  s.send('/start')
  const m = await s.reply(tr(/Claude on your computers/, /Claude на твоих компьютерах/))
  assert.match(m.text, /\/status/)
  assert.ok(s.tg.commands.length >= 2)
  assert.ok(s.tg.commands.some(c => c.scope?.type === 'all_group_chats'))
})

let agentId = ''
test('pairing: /pair gives one code, the real agent pairs with it and connects over the real WebSocket', async () => {
  const after = Date.now()
  s.send('/pair')
  const m = await s.reply(tr(/Connect a computer/, /Подключить компьютер/), { after })
  const code = pairCodeIn(m)
  assert.ok(code, `a code in: ${m.text}`)
  assert.ok(m.buttons.flat().every(b => b.copy), 'copy buttons with the lines')
  const a = await s.pairAgent('E2E-PC', code!, ['alpha', 'beta'])
  agentId = a.id
  const joined = await s.reply(tr(/Connected/, /Подключён/), { after })
  assert.match(joined.text, /E2E-PC/)
})

let thread = 0
test('/topic makes a topic with a picker, a project binds it, a message gets an answer in that topic', async () => {
  const after = Date.now()
  s.send('/topic Work')
  const picker = await until('a topic', () => s.tg.sent.find(m => m.at >= after && m.thread && tr(/choose a project/, /выбери проект/).test(m.text)))
  thread = picker.thread!
  assert.ok(s.tg.topics.get(OWNER_ID)?.has(thread))
  await s.tap(picker, /^alpha$/)
  const t2 = Date.now()
  s.send('just saying hi', { thread })
  const answer = await s.reply(/echo:.*just saying hi/, { thread, after: t2 })
  assert.equal(answer.reply_to !== undefined, true, 'the answer replies to the message')
  const turn = s.journal().find(j => j.kind === 'turn')!
  assert.ok(turn.servers.includes('device'), 'Claude got the device tools')
  assert.match(turn.appendText, /alpha/, 'the prompt names the project')
})

test('send_file and a picture in the answer come from the real computer', async () => {
  const zone = s.agents.get('E2E-PC')!.zone
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  writeFileSync(join(zone, 'alpha', 'shot.png'), png)
  writeFileSync(join(zone, 'alpha', 'notes.txt'), 'hello from the computer')
  const script = s.script([
    { tool: 'mcp__device__send_file', input: { path: 'notes.txt', caption: 'the notes' } },
    { text: 'Here it is:\n\n![a shot](shot.png)\n\nAll done.' },
  ])
  const t = Date.now()
  s.send(`show it ${script}`, { thread })
  const doc = await until('the document', () => s.tg.sent.find(m => m.at >= t && m.method === 'sendDocument' && m.thread === thread))
  assert.equal(doc.media[0].kind, 'document')
  assert.equal(doc.media[0].bytes, 'hello from the computer'.length)
  const answer = await s.reply(/All done/, { thread, after: t })
  assert.match(answer.text, /tg:\/\/photo\?id=m1/, `the picture block in: ${answer.text}`)
  assert.equal(answer.media.length, 1)
  assert.equal(answer.media[0].bytes, png.length, 'the picture as it is on the computer')
})

test('an answer with a picture that is not there says so in words', async () => {
  const script = s.script([{ text: 'See ![gone](missing.png) here' }])
  const t = Date.now()
  s.send(`next ${script}`, { thread })
  const answer = await s.reply(/See/, { thread, after: t })
  assert.match(answer.text, tr(/Could not attach/, /Не удалось приложить/))
})

test('photo, document and a voice message without whisper', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  const photo = s.tg.file(png, 'jpg')
  let t = Date.now()
  s.tg.media(s.user, s.CHAT, { photo: [{ ...photo, width: 1, height: 1 }], caption: 'look at this' }, thread)
  await s.reply(/echo:.*look at this/, { thread, after: t })
  assert.equal(s.journal().filter(j => j.kind === 'turn').at(-1)!.images, 1, 'Claude sees the photo')

  const doc = s.tg.file(Buffer.from('some text inside'), 'txt')
  t = Date.now()
  s.tg.media(s.user, s.CHAT, { document: { ...doc, file_name: 'a.txt', mime_type: 'text/plain' }, caption: 'read this' }, thread)
  await s.reply(/echo:.*some text inside/, { thread, after: t })

  // A saved attachment goes through the real save_attachment to the computer
  const prompt = s.journal().filter(j => j.kind === 'turn').at(-1)!.prompt as string
  const id = prompt.match(/id ([0-9a-f]{8})/)![1]
  const script = s.script([{ tool: 'mcp__device__save_attachment', input: { id, path: 'saved/' } }, { text: 'saved E2E' }])
  t = Date.now()
  s.send(`save ${script}`, { thread })
  const card = await until('a card', () => s.tg.sent.find(m => m.at >= t && m.thread === thread && m.buttons.flat().some(b => /^ok:/.test(b.data ?? ''))))
  await s.tap(card, card.buttons.flat().find(b => /^ok:/.test(b.data ?? ''))!.data!)
  await s.reply(/saved E2E/, { thread, after: t })
  assert.equal(readFileSync(join(s.agents.get('E2E-PC')!.zone, 'alpha/saved/a.txt'), 'utf8'), 'some text inside')

  const voice = s.tg.file(Buffer.from('OggS not really'), 'ogg')
  t = Date.now()
  s.tg.media(s.user, s.CHAT, { voice: { ...voice, duration: 2, mime_type: 'audio/ogg' } }, thread)
  const said = await s.reply(tr(/transcribe|whisper|ffmpeg/i, /расшифровать|whisper|ffmpeg/i), { thread, after: t })
  assert.doesNotMatch(said.text, /Error:|undefined/)
})

test('/project on a bound topic, a new project by name', async () => {
  let t = Date.now()
  s.send('/project', { thread })
  const picker = await s.reply(tr(/choose a project/, /выбери проект/), { thread, after: t })
  t = Date.now()
  await s.tap(picker, tr(/New project/, /Новый проект/))
  await s.reply(tr(/what should the new project be called/, /как назвать новый проект/), { thread, after: t })
  t = Date.now()
  s.send('fresh-one', { thread })
  await s.reply(/fresh-one/, { thread, after: t })
  await until('the folder on the computer', () => existsSync(join(s.agents.get('E2E-PC')!.zone, 'fresh-one')))
  t = Date.now()
  s.send('/status', { thread })
  const status = await s.reply(/fresh-one/, { thread, after: t })
  assert.match(status.text, /E2E-PC/)
})

test('the stand keeps off the real install: its own pipe, its own home, no browser proxy port', async () => {
  const a = s.agents.get('E2E-PC')!
  assert.notEqual(controlPath('agent', a.config), controlPath('agent', join(homedir(), '.tg-claude-vps', 'agent', 'agent.config.json')))
  assert.ok(a.config.startsWith(s.base), 'the config is in the temporary folder')
  const cfg = JSON.parse(readFileSync(a.config, 'utf8'))
  assert.equal(cfg.browserProxyPort, 0)
  assert.deepEqual(cfg.apps, {})
  assert.deepEqual(cfg.mcpServers, {})
  assert.ok(cfg.serverUrl.startsWith('ws://127.0.0.1:'))
})

test('nothing left the computer and every message was well-formed', () => {
  assert.deepEqual(s.netViolations(), [])
  assert.deepEqual(s.tg.findings, [])
  assert.ok(agentId)
  void mkdirSync
})
})
}
