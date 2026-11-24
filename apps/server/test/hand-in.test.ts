import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBot } from '../src/telegram/bot.ts'
import { createTopicStore } from '../src/store.ts'
import { createWorkspaceStore } from '../src/workspaces.ts'
import { createOwners } from '../src/owners.ts'
import { createDeviceRegistry } from '../src/devices.ts'
import { setLang } from '../src/i18n.ts'
import { createTurnInput, handInHook } from '../src/claude/runner.ts'
import { handInBlock, handInMark, handInNote, handInPrompt, justHandedIn } from '../src/telegram/hand-in.ts'
import { collectOverview, createOffers, overviewHtml, permissionKind, topicLink } from '../src/telegram/overview.ts'

// ⚡ and /now through the bot's front door, with Telegram replaced by a list of what was asked of it. Nothing here reaches
// Claude: a turn under way is a busy topic, and the runner's side is asked directly

setLang('en')
const OWNER = 5550001234
const OTHER_OWNER = 222
const STRANGER = 111
const GROUP = -1003555000111
const THEIR_GROUP = -1002222222222

type Call = { method: string, payload: Record<string, unknown> }

// Widgets off by default: the text card is what most tests here read
function harness({ widgets = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-now-'))
  const topics = createTopicStore(join(dir, 'topics.json'))
  const workspaces = createWorkspaceStore(join(dir, 'workspaces.json'))
  const owners = createOwners(join(dir, 'owners.json'), [OWNER, OTHER_OWNER])
  const quiet = () => {}
  const made = createBot({
    cfg: { token: '1:test', ownerIds: [OWNER], dataDir: dir, workDir: dir, profileDir: dir, topicTtlDays: 0, maxParallel: 0, deferredSettleMs: 60, chromeConnectMs: 1, model: 'opus', chatModel: 'sonnet', effort: 'medium', apiTimeoutSec: 180, remoteMcp: {} } as never,
    topics,
    workspaces,
    gateway: { events: new EventEmitter(), device: () => undefined, devices: () => [], tunnels: { size: 0 } } as never,
    registry: createDeviceRegistry(join(dir, 'devices.json')) as never,
    pairing: {} as never,
    log: { info: quiet, warn: quiet, error: quiet, debug: quiet } as never,
    workDir: dir,
    inbox: {} as never,
    media: { ffmpeg: null } as never,
    browsers: { get: () => undefined, list: () => [] } as never,
    profiles: { list: () => [{ name: 'main' }], defaultName: 'main', env: () => ({}), status: async () => ({ loggedIn: true }), carry: () => false, nameOf: () => 'main', removeSession: () => {} } as never,
    owners,
    updates: {} as never,
  })
  const { bot } = made
  bot.botInfo = { id: 999, is_bot: true, first_name: 'Clauder', username: 'example_bot', can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false } as never
  const calls: Call[] = []
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> })
    if ((method as string) === 'sendWidget' && !widgets) return { ok: false, error_code: 400, description: 'Bad Request: no widgets here' } as never
    const results: Record<string, unknown> = {
      sendMessage: { message_id: 500 + calls.length, chat: { id: 1, type: 'private' }, date: 1 },
      sendRichMessage: { message_id: 500 + calls.length, rich_message: { blocks: [] }, chat: { id: 1, type: 'private' }, date: 1 },
    }
    return { ok: true, result: (method in results ? results[method] : true) } as never
  })
  let update = 1
  const send = async (u: unknown) => {
    await bot.handleUpdate(u as never)
    await made.idle()
  }
  const from = (id: number) => ({ id, is_bot: false, first_name: 'x' })
  const chatOf = (id: number) => (id > 0 ? { id, type: 'private', first_name: 'x' } : { id, type: 'supergroup', title: 't', is_forum: true })
  return {
    ...made,
    dir,
    topics,
    workspaces,
    calls,
    reset: () => { calls.length = 0 },
    message: (chat: number, user: number, id: number, text: string, topic?: number) => send({
      update_id: update++,
      message: {
        message_id: id, date: 1, chat: chatOf(chat), from: from(user), text,
        ...(/^\//.test(text) && { entities: [{ type: 'bot_command', offset: 0, length: text.length }] }),
        ...(topic && { is_topic_message: true, message_thread_id: topic }),
      },
    }),
    react: (chat: number, user: number | null, id: number, after: string[], before: string[] = []) => send({
      update_id: update++,
      message_reaction: {
        chat: chatOf(chat), message_id: id, date: 1, ...(user ? { user: from(user) } : { actor_chat: chatOf(chat) }),
        old_reaction: before.map(emoji => ({ type: 'emoji', emoji })), new_reaction: after.map(emoji => ({ type: 'emoji', emoji })),
      },
    }),
    tap: (chat: number, user: number, data: string, messageId = 77, topic?: number) => send({
      update_id: update++,
      callback_query: {
        id: String(update), from: from(user), chat_instance: 'x', data,
        message: { message_id: messageId, date: 1, chat: chatOf(chat), text: 'x', from: { id: 999, is_bot: true, first_name: 'b' }, ...(topic && { is_topic_message: true, message_thread_id: topic }) },
      },
    }),
    reactions: (id: number) => calls.filter(c => c.method === 'setMessageReaction' && c.payload.message_id === id).map(c => (c.payload.reaction as { emoji: string }[])[0]?.emoji ?? null),
    cards: () => calls.filter(c => c.method === 'sendMessage' || c.method === 'sendRichMessage' || c.method === 'editMessageText'),
  }
}

const open: ReturnType<typeof harness>[] = []
const start = (o?: Parameters<typeof harness>[0]) => {
  const h = harness(o)
  open.push(h)
  return h
}
after(() => {
  // Timers of a bot that never polled: nothing else keeps this file alive
  setTimeout(() => process.exit(0), 100).unref()
  for (const h of open) h.stop().catch(() => {})
})

// A topic with a turn under way and one message of the user's waiting
async function waiting(h: ReturnType<typeof harness>, chat = OWNER, topic = 5, id = 40) {
  const key = `${chat}:${topic}`
  const l = h.liveOf(key)
  l.busy = true
  await h.message(chat, chat > 0 ? chat : OWNER, id, 'actually use blue', topic)
  return { key, l }
}

test('⚡ on a waiting message: it stays queued until the tools end, then Claude has it once and 🫡 says so', async () => {
  const h = start()
  const { key, l } = await waiting(h)
  assert.deepEqual(h.reactions(40), ['👀'])
  await h.react(OWNER, OWNER, 40, ['⚡'])
  assert.equal(l.queue.length, 1, 'nothing leaves the queue before it can go in')
  assert.equal(l.queue[0].rush, true)
  h.reset()
  const turn = h.handInFor(key)
  const given = await turn.take()
  assert.match(given!.text, /a correction that takes priority/)
  assert.match(given!.text, /actually use blue/)
  assert.ok(given!.text.startsWith(`⟦${handInMark('1:test', key)}⟧`), 'the mark Claude knows it by')
  assert.equal(l.queue.length, 0, 'it will not be answered as a new turn too')
  assert.equal(await turn.take(), null, 'and it goes in once')
  assert.deepEqual(h.reactions(40).filter(Boolean), [], 'no 🫡 before the CLI has read it')
  turn.landed(given!.id)
  assert.equal(h.reactions(40).at(-1), '🫡')
  h.settleHandIn(key)
  assert.equal(l.queue.length, 0, 'delivered: not back in the queue')
})

test('a turn that ended before any tool did: the message is simply the next turn, still waiting', async () => {
  const h = start()
  const { key, l } = await waiting(h)
  await h.react(OWNER, OWNER, 40, ['⚡'])
  h.settleHandIn(key)
  assert.equal(l.queue.length, 1)
  assert.equal(l.queue[0].rush, false, 'a later turn does not hand it in by itself')
  assert.equal(handInNote(l), null)
})

test('sent in but never confirmed: it goes back to the front of the queue and looks like waiting again', async () => {
  const h = start()
  const { key, l } = await waiting(h)
  await h.message(OWNER, OWNER, 41, 'and another thing', 5)
  await h.react(OWNER, OWNER, 41, ['⚡'])
  const given = await h.handInFor(key).take()
  assert.match(given!.text, /another thing/)
  assert.deepEqual(l.queue.map(i => i.msgId), [40])
  h.reset()
  h.settleHandIn(key)
  assert.deepEqual(l.queue.map(i => i.msgId), [41, 40])
  assert.deepEqual(h.reactions(41), ['👀'])
})

test('a stranger, an anonymous admin, another emoji, a ⚡ already there: nothing happens', async () => {
  const h = start()
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  const { l } = await waiting(h, GROUP)
  h.reset()
  await h.react(GROUP, STRANGER, 40, ['⚡'])
  await h.react(GROUP, null, 40, ['⚡'])
  await h.react(GROUP, OWNER, 40, ['🔥'])
  await h.react(GROUP, OWNER, 40, ['⚡', '🔥'], ['⚡'])
  assert.equal(l.queue[0].rush, undefined)
  assert.deepEqual(h.calls.filter(c => c.method !== 'setMyCommands'), [], 'not a word, not a reaction')
})

test('a stranger reacting in the private chat gets no offer of an account', async () => {
  const h = start()
  await h.react(STRANGER, STRANGER, 3, ['⚡'])
  assert.deepEqual(h.calls.filter(c => c.method !== 'setMyCommands'), [])
})

test('⚡ on a message that is in no queue does nothing, here or in another chat', async () => {
  const h = start()
  const { l } = await waiting(h)
  h.reset()
  await h.react(OWNER, OWNER, 999, ['⚡'])
  await h.react(OTHER_OWNER, OTHER_OWNER, 40, ['⚡'])
  assert.equal(l.queue[0].rush, undefined, 'the same id in another chat is another message')
  assert.deepEqual(h.calls.filter(c => c.method !== 'setMyCommands'), [])
})

test('the topic is found by the message: the update names none', async () => {
  const h = start()
  await waiting(h, OWNER, 5, 40)
  const second = await waiting(h, OWNER, 6, 41)
  await h.react(OWNER, OWNER, 41, ['⚡'])
  assert.equal(second.l.queue[0].rush, true)
  assert.equal(h.liveOf(`${OWNER}:5`).queue[0].rush, undefined)
})

test('a report waiting for a busy head goes in the same way, and is not called the user\'s', async () => {
  const h = start()
  const key = `${OWNER}:5`
  const l = h.liveOf(key)
  l.busy = true
  l.queue.push({ seq: 1, text: '[Report from agent “a”]\nall done', images: [], shownId: 70, waitMark: true })
  await h.react(OWNER, OWNER, 70, ['⚡'])
  const turn = h.handInFor(key)
  const given = await turn.take()
  assert.match(given!.text, /Report from agent/)
  assert.doesNotMatch(given!.text, /From the user/)
  h.reset()
  turn.landed(given!.id)
  assert.deepEqual(h.reactions(70), ['🫡'])
})

test('a message from a topic of lower rights holds the rest of the turn to them', async () => {
  const h = start()
  const key = `${OWNER}:5`
  const l = h.liveOf(key)
  l.busy = true
  l.allowAll = true
  l.modeCap = 'edits'
  l.queue.push({ seq: 1, text: '[A message from the topic «x»]', images: [], shownId: 70, fromMode: 'read', waitMark: true })
  await h.react(OWNER, OWNER, 70, ['⚡'])
  assert.equal(l.modeCap, 'edits', 'nothing changes until it goes in')
  await h.handInFor(key).take()
  assert.equal(l.modeCap, 'read')
  assert.equal(l.allowAll, false, '"allow until the task ends" was given before this came in')
})

test('a turn held to less by a message handed in stays held to it after a restart', async () => {
  const h = start()
  const key = `${OWNER}:5`
  const l = h.liveOf(key)
  l.busy = true
  h.flights.begin(key, { sessionId: 's', fromUser: true, msgIds: [1], prompt: 'do it', continuations: 0 })
  l.queue.push({ seq: 1, text: '[A message from the topic «x»]', images: [], shownId: 70, fromMode: 'read', waitMark: true })
  await h.react(OWNER, OWNER, 70, ['⚡'])
  await h.handInFor(key).take()
  assert.equal(JSON.parse(readFileSync(join(h.dir, 'in-flight.json'), 'utf8'))[0].modeCap, 'read')
})

test('repeating a turn that was held to less holds it to the same', async () => {
  const h = start()
  const key = `${OWNER}:5`
  h.retries.set(901, { key, prompt: 'from another topic', images: [], fromMode: 'read' })
  await h.tap(OWNER, OWNER, 'again:901', 77, 5)
  assert.equal(h.liveOf(key).queue[0].fromMode, 'read')
})

test('a message from a topic of higher rights does not widen a cap', async () => {
  const h = start()
  const key = `${OWNER}:5`
  const l = h.liveOf(key)
  l.busy = true
  l.modeCap = 'read'
  l.queue.push({ seq: 1, text: 'x', images: [], shownId: 70, fromMode: 'all' })
  await h.react(OWNER, OWNER, 70, ['⚡'])
  await h.handInFor(key).take()
  assert.equal(l.modeCap, 'read')
})

test('a scheduled run is no message to hand in', async () => {
  const h = start()
  const l = h.liveOf(`${OWNER}:5`)
  l.busy = true
  l.queue.push({ seq: 1, text: 'x', images: [], msgId: 70, scheduleId: 's1' })
  await h.react(OWNER, OWNER, 70, ['⚡'])
  assert.equal(l.queue[0].rush, undefined)
})

test('no turn under way: ⚡ changes nothing, the message goes by itself', async () => {
  const h = start()
  const l = h.liveOf(`${OWNER}:5`)
  l.queue.push({ seq: 1, text: 'x', images: [], msgId: 70 })
  await h.react(OWNER, OWNER, 70, ['⚡'])
  assert.equal(l.queue[0].rush, undefined)
})

test('/stop before the tools end: dropped with the queue, and no longer marked as waiting', async () => {
  const h = start()
  const { key, l } = await waiting(h)
  await h.react(OWNER, OWNER, 40, ['⚡'])
  h.reset()
  await h.message(OWNER, OWNER, 42, '/stop', 5)
  assert.equal(l.queue.length, 0)
  assert.equal(await h.handInFor(key).take(), null)
  assert.deepEqual(h.reactions(40), [null])
})

test('/stop after it was sent in, before the CLI confirmed: it does not come back', async () => {
  const h = start()
  const { key, l } = await waiting(h)
  await h.react(OWNER, OWNER, 40, ['⚡'])
  const turn = h.handInFor(key)
  const given = await turn.take()
  await h.message(OWNER, OWNER, 42, '/stop', 5)
  turn.landed(given!.id)
  h.settleHandIn(key)
  assert.equal(l.queue.length, 0)
})

test('a stopped turn takes nothing in', async () => {
  const h = start()
  const { key, l } = await waiting(h)
  await h.react(OWNER, OWNER, 40, ['⚡'])
  l.abort = new AbortController()
  l.abort.abort()
  assert.equal(await h.handInFor(key).take(), null)
  assert.equal(l.queue.length, 1)
})

test('deleted after the ⚡: it goes nowhere', async () => {
  const h = start()
  const { key, l } = await waiting(h)
  await h.react(OWNER, OWNER, 40, ['⚡'])
  h.bot.api.config.use(async (prev, method, payload, signal) => (method === 'setMessageReaction'
    ? { ok: false, error_code: 400, description: 'Bad Request: message to react not found' } as never
    : prev(method, payload, signal)))
  assert.equal(await h.handInFor(key).take(), null)
  assert.equal(l.queue.length, 0)
})

test('an update saves what was sent in and not yet read', async () => {
  const h = start()
  const { key } = await waiting(h)
  await h.react(OWNER, OWNER, 40, ['⚡'])
  await h.handInFor(key).take()
  await h.stop()
  const { queues } = JSON.parse(readFileSync(join(h.dir, 'queues.json'), 'utf8'))
  assert.deepEqual(queues[key].map((i: { msgId: number }) => i.msgId), [40])
})

test('how to use it is said once per chat, on the first message that waits, and in /help', async () => {
  const h = start()
  await waiting(h)
  const said = () => h.calls.filter(c => c.method === 'sendMessage' && /Put ⚡/.test(String(c.payload.text)))
  assert.equal(said().length, 1)
  await h.message(OWNER, OWNER, 41, 'more', 5)
  assert.equal(said().length, 1)
  h.reset()
  await h.message(OWNER, OWNER, 43, '/help')
  const help = h.calls.find(c => c.method === 'sendRichMessage')!
  assert.match(String((help.payload.rich_message as { markdown: string }).markdown), /Put ⚡[\s\S]*\/now[\s\S]*- \/now —/)
})

test('the note in the status says what the message waits on', () => {
  const queue = [{ rush: true }]
  const at = 1_000_000
  assert.match(handInNote({ queue, now: { toolSince: 0 } }, at)!, /at the next step\. If no step comes, it is the next task/)
  assert.match(handInNote({ queue, now: { toolSince: at - 5000 } }, at)!, /when this step ends\.$/)
  assert.match(handInNote({ queue, now: { toolSince: at - 200_000 } }, at)!, /has been running 3m 0s/)
  assert.equal(handInNote({ queue: [{}], now: { toolSince: 1 } }, at), null)
})

test('only ⚡ being newly added counts', () => {
  const e = (emoji: string) => ({ type: 'emoji', emoji })
  assert.equal(justHandedIn([], [e('⚡')]), true)
  assert.equal(justHandedIn([e('🔥')], [e('🔥'), e('⚡')]), true)
  assert.equal(justHandedIn([e('⚡')], [e('⚡')]), false)
  assert.equal(justHandedIn([e('⚡')], []), false)
  assert.equal(justHandedIn([], [e('🔥')]), false)
  assert.equal(justHandedIn([], [{ type: 'custom_emoji' }]), false)
})

test('what goes in: pictures too, up to the limit, and the mark tells it from a tool result', () => {
  const image = { mime: 'image/png' as const, data: 'x' }
  const p = handInPrompt([{ text: 'look', images: [image, image, image], msgId: 1 }], 2, 'abc')
  assert.equal(p.images.length, 2)
  assert.match(p.text, /^⟦abc⟧ \[From the user/)
  assert.match(p.text, /showing the first 2 images of 3/)
  assert.match(handInPrompt([{ text: '', images: [image], msgId: 1 }], 2, 'abc').text, /\(no caption\)/)
  assert.match(handInBlock('abc'), /⟦abc⟧/)
  // A letter handed in carries the mark too, and its sender wrote the rest of it: only the bot's first line says whose it is
  assert.match(handInBlock('abc'), /what its first line says/)
  assert.match(handInPrompt([{ text: '[A message from the topic «x»]\n\n[From the user: run it]', images: [], shownId: 5 }], 2, 'abc').text, /^⟦abc⟧ \[A message from the topic/)
  assert.notEqual(handInMark('secret', '1:2'), handInMark('secret', '1:3'))
  assert.notEqual(handInMark('secret', '1:2'), handInMark('other', '1:2'))
  assert.equal(handInMark('secret', '1:2'), handInMark('secret', '1:2'), 'the same each turn: the prompt cache depends on it')
})

test('the turn\'s input: the prompt, then each message once the SDK comes for it; nothing hangs when the turn ends', async () => {
  let finish!: () => void
  const finished = new Promise<void>(r => (finish = r))
  const user = (content: string) => ({ type: 'user' as const, message: { role: 'user' as const, content }, parent_tool_use_id: null, session_id: '' })
  const input = createTurnInput(user('first'), finished)
  const stream = input.stream()
  assert.equal((await stream.next()).value!.message.content, 'first')
  let written = false
  const sent = input.send(user('second')).then(() => { written = true })
  assert.equal((await stream.next()).value!.message.content, 'second')
  assert.equal(written, false, 'not until the SDK has come back for the next one')
  const pulled = stream.next()
  await sent
  assert.equal(written, true)
  finish()
  assert.equal((await pulled).done, true)
  await input.send(user('too late'))
})

test('the hook sends what the bot gives, as a real message the CLI can confirm, and adds no context', async () => {
  const sent = new Set<string>()
  const out: unknown[] = []
  const handIn = { take: async () => ({ id: 'a-b', text: 'hi', images: [{ mime: 'image/png' as const, data: 'x' }] }), landed: () => {} }
  assert.deepEqual(await handInHook(handIn, async m => void out.push(m), sent)(), {})
  const m = out[0] as { uuid: string, priority: string, message: { content: { type: string }[] } }
  assert.equal(m.uuid, 'a-b')
  assert.equal(m.priority, 'next', '"now" cuts the running tool off')
  assert.deepEqual(m.message.content.map(b => b.type), ['image', 'text'])
  assert.ok(sent.has('a-b'))
  out.length = 0
  assert.deepEqual(await handInHook({ take: async () => null, landed: () => {} }, async m => void out.push(m), sent)(), {})
  assert.equal(out.length, 0)
})

// --- /now -----------------------------------------------------------------------------------------------------------

const card = (h: ReturnType<typeof harness>) => {
  const p = h.cards().at(-1)!.payload as { text?: string, rich_message?: { markdown: string } }
  return String(p.text ?? p.rich_message!.markdown).replace(/\n\n<tg-button-row>[\s\S]*$/, '').replace(/ {2}\n/g, '\n')
}

test('/now with nothing going on: one short line and a way to refresh', async () => {
  const h = start()
  await h.message(OWNER, OWNER, 1, '/now')
  assert.equal(card(h), 'Nothing is running and nothing waits for you.')
  assert.match(JSON.stringify(h.cards().at(-1)!.payload), /now:r/)
})

test('/now in the private chat is a widget that asks for fresh rows, and the text card when it fails', async () => {
  const h = start({ widgets: true })
  await h.message(OWNER, OWNER, 1, '/now')
  const w = h.calls.find(c => c.method === 'sendWidget')!
  assert.equal(w.payload.allow_queries, true)
  assert.match(String(w.payload.html), /tgcv:now/)
  assert.deepEqual(h.cards(), [])
  const off = start()
  await off.message(OWNER, OWNER, 1, '/now')
  assert.equal(card(off), 'Nothing is running and nothing waits for you.')
})

test('/now is in the command list', async () => {
  const h = start()
  await h.message(OWNER, OWNER, 1, '/help')
  const help = h.calls.find(c => c.method === 'sendRichMessage')!
  assert.match(String((help.payload.rich_message as { markdown: string }).markdown), /\/now/)
  h.reset()
  await h.message(GROUP, STRANGER, 1, '/now')
  assert.deepEqual(h.cards(), [])
})

test('/now: groups by workspace, links in a group, a name without a link in the private chat', async () => {
  const h = start()
  h.workspaces.add(GROUP, { title: 'Roblox <3', addedBy: OWNER })
  h.topics.set(`${GROUP}:7`, { title: 'Map' })
  h.topics.set(`${OWNER}:5`, { title: 'Bot' })
  h.liveOf(`${GROUP}:7`).busy = true
  h.liveOf(`${OWNER}:5`).busy = true
  h.liveOf(`${OWNER}:5`).now = { since: Date.now() - 65_000, status: () => '<tg-emoji emoji-id="1">🤔</tg-emoji> Reading…', kick: () => {}, toolSince: 0 }
  await h.message(OWNER, OWNER, 1, '/now')
  const text = card(h)
  assert.match(text, /<b>Roblox &lt;3<\/b>\n⚙️ <a href="https:\/\/t\.me\/c\/3555000111\/7">Map<\/a> — working/)
  assert.match(text, /<b>Private chat<\/b>\n⚙️ Bot — 🤔 Reading… · 1m 5s/)
  assert.match(text, /\n\n/, 'a blank line between groups')
  assert.ok(text.indexOf('Private chat') < text.indexOf('Roblox'), 'where they are asking comes first')
  assert.doesNotMatch(text, /<a [^>]*>Bot/)
})

test('/now: each state that waits on a tap, with a link to the message when it is known', async () => {
  const h = start()
  h.workspaces.add(GROUP, { title: 'W', addedBy: OWNER })
  const k = (n: number) => `${GROUP}:${n}`
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) h.topics.set(k(n), { title: `T${n}`, noProject: n !== 8 })
  // Real ones, as the bot makes them
  const asked = h.permissionFor(k(1), 'mcp__device__run_command', { command: 'ls' })
  const mcp = h.permissionFor(k(2), 'mcp__device__add_mcp_server', { name: 'x', command: 'y' })
  const question = h.permissionFor(k(3), 'AskUserQuestion', { questions: [{ question: 'Red or blue?', options: [{ label: 'Red' }, { label: 'Blue' }] }] })
  await h.startSurvey(k(4), { title: 'Brief', questions: [{ question: 'Name?' }] } as never)
  await h.idle()
  h.offers.open(k(5), 'browser', 900)
  h.offers.open(k(6), 'computer')
  h.offers.open(k(7), 'schedule', 901)
  h.liveOf(k(8)).queue.push({ seq: 1, text: 'x', images: [] })
  h.liveOf(k(9)).newProjectOn = 'pc'
  h.liveOf(k(10)).waitingDevice = true
  h.offers.open(k(11), 'project', 902)
  h.offers.open(k(12), 'retry')
  await new Promise(r => setTimeout(r, 20))
  await h.message(OWNER, OWNER, 1, '/now')
  const text = card(h)
  const line = (n: number) => text.split('\n').find(l => l.includes(`>T${n}<`)) ?? ''
  assert.match(line(1), /🔔 <a href="https:\/\/t\.me\/c\/3555000111\/1\/\d+">T1<\/a> — asks permission: run_command/)
  assert.match(line(2), /asks to change an MCP server/)
  assert.match(line(3), /\/3\/\d+">T3<\/a> — asks a question: Red or blue\?/)
  assert.match(line(4), /survey open: Brief/)
  assert.match(line(5), /\/5\/900">T5<\/a> — asks for your Chrome/)
  assert.match(line(6), /\/6">T6<\/a> — offers another computer/)
  assert.match(line(7), /\/7\/901">T7<\/a> — proposes a schedule/)
  assert.match(line(8), /choose where to work/)
  assert.match(line(9), /waits for the project's name/)
  assert.match(line(10), /computer offline/)
  assert.match(line(11), /needs a project/)
  assert.match(line(12), /a button to go on/)
  void asked; void mcp; void question
})

test('/now masks what it shows', async () => {
  const h = start()
  h.topics.set(`${OWNER}:5`, { title: 'mail me: someone.real@example.com' })
  h.liveOf(`${OWNER}:5`).busy = true
  await h.message(OWNER, OWNER, 1, '/now')
  assert.doesNotMatch(card(h), /someone\.real@example\.com/)
})

test('/now: the private chat shows everything of theirs, and nobody else\'s', async () => {
  const h = start()
  h.workspaces.add(GROUP, { title: 'Mine', addedBy: OWNER })
  h.workspaces.add(THEIR_GROUP, { title: 'Theirs', addedBy: OTHER_OWNER })
  for (const [chat, name] of [[OWNER, 'my chat'], [OTHER_OWNER, 'their chat'], [GROUP, 'my group'], [THEIR_GROUP, 'their group']] as const) {
    h.topics.set(`${chat}:5`, { title: name })
    h.liveOf(`${chat}:5`).busy = true
  }
  await h.message(OWNER, OWNER, 1, '/now')
  assert.match(card(h), /my chat[\s\S]*my group/)
  assert.doesNotMatch(card(h), /their/)
  await h.message(OTHER_OWNER, OTHER_OWNER, 3, '/now')
  assert.match(card(h), /their chat[\s\S]*their group/)
  assert.doesNotMatch(card(h), /my /)
})

test('/now: a group sees its own topics and no others, by the command and by the refresh button', async () => {
  const h = start()
  const OTHER_GROUP = -1003333333333
  h.workspaces.add(GROUP, { title: 'This group', addedBy: OWNER })
  h.workspaces.add(OTHER_GROUP, { title: 'Other group', addedBy: OWNER })
  h.workspaces.add(THEIR_GROUP, { title: 'Theirs', addedBy: OTHER_OWNER })
  for (const [chat, name] of [[OWNER, 'private topic'], [GROUP, 'here topic'], [OTHER_GROUP, 'elsewhere topic'], [THEIR_GROUP, 'their topic']] as const) {
    h.topics.set(`${chat}:5`, { title: name })
    h.liveOf(`${chat}:5`).busy = true
  }
  // Waiting on a tap, which comes first in the card: it stays out too
  h.offers.open(`${OTHER_GROUP}:5`, 'computer')
  h.offers.open(`${OWNER}:5`, 'browser')
  await h.message(GROUP, OWNER, 2, '/now', 5)
  assert.match(card(h), /here topic/)
  assert.doesNotMatch(card(h), /private topic|elsewhere topic|their topic|Private chat|Other group|Theirs/)
  assert.equal(h.cards().at(-1)!.payload.message_thread_id, 5, 'the card comes where they asked')
  h.reset()
  await h.tap(GROUP, OWNER, 'now:r', 55, 5)
  assert.match(card(h), /here topic/)
  assert.doesNotMatch(card(h), /private topic|elsewhere topic|their topic|Private chat|Other group|Theirs/)
  // In a group someone else added it is the same: what is theirs elsewhere doesn't follow them there
  await h.message(THEIR_GROUP, OWNER, 4, '/now', 5)
  assert.match(card(h), /their topic/)
  assert.doesNotMatch(card(h), /private topic|here topic|elsewhere topic/)
})

test('/now: a stranger gets nothing, not even by the refresh button', async () => {
  const h = start()
  h.topics.set(`${OWNER}:5`, { title: 'secret' })
  h.liveOf(`${OWNER}:5`).busy = true
  h.reset()
  await h.message(STRANGER, STRANGER, 1, '/now')
  await h.tap(STRANGER, STRANGER, 'now:r')
  assert.deepEqual(h.calls.filter(c => /secret/.test(JSON.stringify(c.payload))), [])
  assert.deepEqual(h.cards().filter(c => c.method === 'editMessageText'), [])
})

test('refresh redraws the card in place', async () => {
  const h = start()
  await h.message(OWNER, OWNER, 1, '/now')
  h.topics.set(`${OWNER}:5`, { title: 'Now busy' })
  h.liveOf(`${OWNER}:5`).busy = true
  h.reset()
  await h.tap(OWNER, OWNER, 'now:r', 55)
  const edit = h.calls.find(c => c.method === 'editMessageText')!
  assert.equal(edit.payload.message_id, 55)
  assert.match(String((edit.payload.rich_message as { markdown: string }).markdown), /Now busy/)
  assert.equal(h.calls.filter(c => c.method === 'sendMessage').length, 0)
})

test('an offer passes with its tap or with the next turn, and stays through an unrelated tap', async () => {
  const h = start()
  const key = `${OWNER}:5`
  h.offers.open(key, 'browser', 900)
  await h.tap(OWNER, OWNER, 'noop', 77, 5)
  assert.equal(h.offers.list().length, 1)
  await h.tap(OWNER, OWNER, 'noop', 900, 5)
  assert.equal(h.offers.list().length, 0)
  const offers = createOffers()
  offers.open(key, 'project')
  offers.tapped(key, 1)
  assert.equal(offers.list().length, 0, 'with no id to know its tap by, any tap in the topic ends it')
  offers.open(key, 'retry', 2)
  offers.open('other', 'retry', 2)
  offers.passed(key)
  assert.deepEqual(offers.list().map(o => o.key), ['other'])
})

test('links: a group has them, General and a message too; a private chat has none', () => {
  assert.equal(topicLink(-1003555000111, 7), 'https://t.me/c/3555000111/7')
  assert.equal(topicLink(-1003555000111, 7, 9), 'https://t.me/c/3555000111/7/9')
  assert.equal(topicLink(-1003555000111), 'https://t.me/c/3555000111/1')
  assert.equal(topicLink(-1003555000111, undefined, 9), 'https://t.me/c/3555000111/9')
  assert.equal(topicLink(5550001234, 7, 9), null)
})

test('a long card keeps what waits and says how many more', () => {
  const names = { place: () => 'P', topic: (k: string) => k, where: (k: string) => ({ chatId: Number(k.split(':')[0]), topicId: Number(k.split(':')[1]) }), masked: (_: string, t: string) => t }
  const waiting = Array.from({ length: 5 }, (_, i) => ({ key: `-100:w${i}`, kind: 'question' as const }))
  const running = Array.from({ length: 40 }, (_, i) => ({ key: `-100:r${i}`, doing: 'x' }))
  const text = overviewHtml({ running, waiting }, names, 1)
  assert.equal(text.match(/🔔/g)!.length, 5)
  assert.equal(text.match(/⚙️/g)!.length, 25)
  assert.match(text, /… \+15$/)
})

test('a topic that stands waiting is not also listed as running; a slot and files in preparation count as running', () => {
  const live = new Map([
    ['1:1', { busy: true, preparing: 0, queue: [], waitingDevice: false, newProjectOn: null }],
    ['1:2', { busy: true, preparing: 0, queue: [], waitingDevice: false, newProjectOn: null }],
    ['1:3', { busy: false, preparing: 2, queue: [], waitingDevice: false, newProjectOn: null }],
    ['1:4', { busy: false, preparing: 0, queue: [{}], waitingDevice: false, newProjectOn: null }],
    ['1:5', { busy: false, preparing: 0, queue: [], waitingDevice: false, newProjectOn: null }],
  ])
  const view = collectOverview({
    live, pending: new Map([[1, { key: '1:1', tool: 'mcp__blender__run' }]]), asking: new Map(), surveys: { keys: () => [], get: () => undefined }, offers: { list: () => [] },
    signIns: () => [], speechOffer: () => null, slotWaiters: ['1:4'], deferred: () => [], unbound: () => false, computerOf: () => '', chatOf: () => 1,
  }, () => true)
  assert.deepEqual(view.waiting.map(w => [w.key, w.detail]), [['1:1', 'blender: run']])
  assert.deepEqual(view.running.map(r => r.key), ['1:2', '1:3', '1:4'])
  assert.equal(permissionKind('mcp__device__add_project_folder'), 'folder')
  assert.equal(permissionKind('mcp__device__remove_mcp_server'), 'mcp')
})

test('/now lists what waits in line, after what runs', () => {
  const names = { place: () => 'Farm', topic: (k: string) => k, where: () => ({ chatId: -1001, topicId: 5 }), masked: (_k: string, t: string) => t }
  const html = overviewHtml({ running: [{ key: 'Head', doing: 'работает' }], waiting: [], queued: [{ key: 'Head', what: 'ждёт PC: правка' }] }, names, -1001)
  assert.ok(html.indexOf('⚙️') < html.indexOf('⏳'))
  assert.match(html, /⏳ <a href="[^"]+">Head<\/a> — ждёт PC: правка/)
  assert.match(overviewHtml({ running: [], waiting: [], queued: [{ key: 'Head', what: 'x' }] }, names, -1001), /⏳/, 'alone it is still something to show')
  assert.doesNotMatch(overviewHtml({ running: [], waiting: [] }, names, -1001), /⏳/)
})

test('/now counts a queue and put-off tasks, unless the topic already stands waiting for its queue', () => {
  const live = (o: object) => ({ busy: false, preparing: 0, queue: [], waitingDevice: false, newProjectOn: null, ...o })
  const view = collectOverview({
    live: new Map([['1:1', live({ busy: true, queue: [{}, {}] })], ['1:2', live({ waitingDevice: true, queue: [{}] })], ['2:1', live({ busy: true, queue: [{}] })]]),
    pending: new Map(), asking: new Map(), surveys: { keys: () => [], get: () => undefined }, offers: { list: () => [] },
    signIns: () => [], speechOffer: () => null, slotWaiters: [], unbound: () => false, computerOf: () => 'PC', chatOf: k => Number(k.split(':')[0]),
    deferred: () => [{ key: '1:3', computer: 'PC', title: 'правка' }, { key: '2:2', computer: 'PC', title: 'чужое' }],
  }, chatId => chatId === 1)
  assert.deepEqual(view.queued.map(q => q.key), ['1:1', '1:3'], 'and only of the chats it may show')
  assert.match(view.queued[0].what, /2/)
  assert.match(view.queued[1].what, /PC.*правка/)
})
