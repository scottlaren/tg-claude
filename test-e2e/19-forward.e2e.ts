import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { startStack, pairCodeIn, until, sleep, type Stack } from './support/stack.ts'

// Forwards with the real server: what Claude was told, from the journal

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

describe('forward as a task', () => {
  let s: Stack
  let thread = 0
  const origin = { type: 'hidden_user', sender_user_name: 'Anna', date: 1_790_000_000 }
  const lastPrompt = () => s.journal().filter(j => j.kind === 'turn').at(-1)!.prompt as string
  const turns = () => s.journal().filter(j => j.kind === 'turn').length

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
  })
  after(() => s?.stop())

  test('a text with no words of the user: a task, with its source, quoted', async () => {
    const before = turns()
    s.tg.media(s.user, s.CHAT, { text: `Please check the invoice ${s.script([{ text: 'forward done E2E' }])}`, forward_origin: origin }, thread)
    await s.reply(/forward done E2E/, { thread })
    assert.equal(turns(), before + 1)
    const p = lastPrompt()
    assert.match(p, /^↪️ The user forwarded a message from “Anna”, sent 2026-/)
    assert.match(p, /material from someone else/)
    assert.match(p, /^> Please check the invoice/m)
  })

  test('a forward that reads as a command is no command', async () => {
    const t = Date.now()
    s.tg.media(s.user, s.CHAT, { text: `/delete ${s.script([{ text: 'not deleted E2E' }])}`, entities: [{ type: 'bot_command', offset: 0, length: 7 }], forward_origin: origin }, thread)
    await s.reply(/not deleted E2E/, { thread, after: t })
    assert.ok(!s.tg.sent.some(m => m.touched >= t && /Delete this topic/i.test(m.text)), 'no delete card')
    assert.match(lastPrompt(), /^> \/delete/m)
  })

  test('a comment and a forward are one turn, the comment stays the user\'s', async () => {
    const before = turns()
    const t = Date.now()
    s.send('translate this please', { thread })
    s.tg.media(s.user, s.CHAT, { text: `Bonjour ${s.script([{ text: 'comment done E2E' }])}`, forward_origin: origin }, thread)
    await s.reply(/comment done E2E/, { thread, after: t })
    assert.equal(turns(), before + 1)
    assert.match(lastPrompt(), /^translate this please\n\n↪️ /)
  })

  test('an album: the source once, the caption quoted, all pictures seen', async () => {
    const t = Date.now()
    const pic = () => [{ ...s.tg.file(PNG, 'jpg'), width: 1, height: 1 }]
    const group = { media_group_id: 'album-1', forward_origin: origin }
    s.tg.media(s.user, s.CHAT, { photo: pic(), caption: `Look at these ${s.script([{ text: 'album done E2E' }])}`, ...group }, thread)
    s.tg.media(s.user, s.CHAT, { photo: pic(), ...group }, thread)
    s.tg.media(s.user, s.CHAT, { photo: pic(), ...group }, thread)
    await s.reply(/album done E2E/, { thread, after: t })
    const turn = s.journal().filter(j => j.kind === 'turn').at(-1)!
    assert.equal(turn.images, 3)
    assert.equal((turn.prompt as string).match(/↪️/g)!.length, 1)
    assert.match(turn.prompt as string, /^> Look at these/m)
  })

  test('a file: its caption is quoted under the source', async () => {
    const t = Date.now()
    s.tg.media(s.user, s.CHAT, { document: { ...s.tg.file(Buffer.from('hello'), 'txt'), file_name: 'note.txt', mime_type: 'text/plain' }, caption: `From accounting ${s.script([{ text: 'file done E2E' }])}`, forward_origin: { type: 'channel', chat: { id: -1009, type: 'channel', title: 'News', username: 'news' }, message_id: 5, date: 1_790_000_000 } }, thread)
    await s.reply(/file done E2E/, { thread, after: t })
    const p = lastPrompt()
    assert.match(p, /the channel “News” \(@news\).*https:\/\/t\.me\/news\/5/)
    assert.match(p, /^> From accounting/m)
    assert.match(p, /^📎 note\.txt/m)
  })

  test('a forward answers a question Claude is waiting on, with its source', async () => {
    const t = Date.now()
    s.send(`ask ${s.script([{ tool: 'AskUserQuestion', input: { questions: [{ question: 'Who wrote E2E?', header: 'x', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] }] } }, { text: 'asked done E2E' }])}`, { thread })
    await s.reply(/Who wrote E2E\?/, { thread, after: t })
    s.tg.media(s.user, s.CHAT, { text: 'It was me', forward_origin: origin }, thread)
    await s.reply(/asked done E2E/, { thread, after: t })
    const tool = s.journal().filter(j => j.kind === 'tool' && j.tool === 'AskUserQuestion').at(-1)!
    assert.match(JSON.stringify(tool), /It was me/)
    assert.match(JSON.stringify(tool), /↪️/)
  })

  test('findings: nothing the server would refuse', () => {
    assert.deepEqual(s.tg.findings, [])
  })
})
