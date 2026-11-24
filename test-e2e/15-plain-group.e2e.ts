import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { startStack, pairCodeIn, until, sleep, type Stack } from './support/stack.ts'

// A group with no topics: one conversation, set up by adding the bot. Telegram's move to a supergroup with a new id is the
// part that loses everything if it goes wrong, so it runs here against the real server: the fake only says what Telegram says

const BASIC = -5000000001
const SUPER = -1005000000001

describe('a group with no topics', () => {
  let s: Stack
  const here = { chat: BASIC }
  const there = { chat: SUPER }

  before(async () => {
    s = await startStack({ language: 'en' })
    await s.startServer()
    const t = Date.now()
    s.send('/pair')
    const m = await s.reply(/install\//, { after: t })
    await s.pairAgent('E2E-PC', pairCodeIn(m)!, ['alpha', 'beta'])
    await sleep(500)
  })
  after(() => s?.stop())

  const cardOf = (id: number) => s.tg.sent.find(m => m.message_id === id)!

  test('adding the bot brings the card at once; what it picks is the conversation\'s own, and a message just works', async () => {
    const t = Date.now()
    s.tg.addPlainGroup(s.user, BASIC, 'Light project')
    const card = await until('the card', () => s.tg.sent.find(m => m.at >= t && m.chat.id === BASIC && m.buttons.flat().some(b => b.data === 'ws:dev')))
    assert.match(card.text, /one conversation/)
    assert.doesNotMatch(card.text, /New topics start/)

    await s.tap(card, 'ws:dev')
    const device = await until('the computers', () => cardOf(card.message_id).buttons.flat().find(b => /^ws:dev:(?!-)/.test(b.data ?? '')))
    await s.tap(cardOf(card.message_id), device.data!)
    await until('back on the card', () => cardOf(card.message_id).buttons.flat().some(b => b.data === 'ws:prj'))
    await s.tap(cardOf(card.message_id), 'ws:prj')
    const alpha = await until('the projects', () => cardOf(card.message_id).buttons.flat().find(b => b.text === 'alpha'))
    await s.tap(cardOf(card.message_id), alpha.data!)
    await until('the project on the card', () => /alpha/.test(cardOf(card.message_id).text))
    await until('back on the card', () => cardOf(card.message_id).buttons.flat().some(b => b.data === 'ws:mod'))
    await s.tap(cardOf(card.message_id), 'ws:mod')
    await until('modes', () => cardOf(card.message_id).buttons.flat().some(b => b.data === 'ws:mod:all'))
    await s.tap(cardOf(card.message_id), 'ws:mod:all')
    await until('back on the card', () => cardOf(card.message_id).buttons.flat().some(b => b.data === 'ws:mod'))

    const asked = Date.now()
    s.send(`hello ${s.script([{ tool: 'mcp__device__run_command', input: { command: 'echo plain-group' } }, { text: 'answered in the group E2E' }])}`, here)
    await s.reply(/answered in the group E2E/, { ...here, after: asked })
  })

  test('no topics, no agents: the commands say why, and this group\'s menu leaves them out', async () => {
    let t = Date.now()
    s.send('/topic New', here)
    await s.reply(/no topics/i, { ...here, after: t })
    t = Date.now()
    s.send('/team', here)
    await s.reply(/no topics/i, { ...here, after: t })
    assert.ok(s.tg.calls.some(c => c.method === 'setMyCommands' && c.payload?.scope?.chat_id === BASIC && !c.payload.commands.some((x: { command: string }) => x.command === 'topic')))
  })

  test('the move to a new id keeps all of it; the old membership ending doesn\'t count as being removed', async () => {
    s.tg.migrateGroup(s.user, BASIC, SUPER)
    await sleep(800)
    const t = Date.now()
    s.send(`again ${s.script([{ text: 'still the same conversation E2E' }])}`, there)
    await s.reply(/still the same conversation E2E/, { ...there, after: t })
    const card = Date.now()
    s.send('/workspace', there)
    const shown = await s.reply(/Light project/, { ...there, after: card })
    assert.match(shown.text, /alpha/)
  })

  test('Topics turned on: the same conversation goes on, and topics work', async () => {
    s.tg.chats.set(SUPER, { ...s.tg.chats.get(SUPER), is_forum: true })
    let t = Date.now()
    s.send(`again ${s.script([{ text: 'in general now E2E' }])}`, there)
    await s.reply(/in general now E2E/, { ...there, after: t })
    assert.ok(s.tg.calls.some(c => c.method === 'deleteMyCommands' && c.payload?.scope?.chat_id === SUPER))
    t = Date.now()
    s.send('/topic Fresh', there)
    const made = await until('a new topic', () => s.tg.sent.find(m => m.touched >= t && m.chat.id === SUPER && m.thread))
    assert.ok(made.thread)
  })
})
