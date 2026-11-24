import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBot } from '../src/telegram/bot.ts'
import { createTopicStore } from '../src/store.ts'
import { createWorkspaceStore } from '../src/workspaces.ts'
import { createOwners } from '../src/owners.ts'
import { createDeviceRegistry } from '../src/devices.ts'
import { setLang } from '../src/i18n.ts'
import type { OpOutcome } from '../src/gateway.ts'
import { MAX_CONTINUATIONS } from '../src/telegram/recovery.ts'
import { createFlightStore } from '../src/telegram/flights.ts'

// A server starting up with a turn left on disk, through the bot's front door. Telegram is a list of what was asked of
// it, computers are a fake gateway, and nothing may reach Claude: the tests look at the queue and empty it before the
// turn would start, or let a turn fail on a project that isn't there

setLang('en')
const OWNER = 5550001234
const GROUP = -1003555000111
const KEY = `${GROUP}:5`
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const until = async (ok: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; !ok() && Date.now() < end;) await sleep(10)
  assert.ok(ok(), 'timed out')
}
const built: OpOutcome = { ok: true, result: { exitCode: 0, signal: null, timedOut: false, cancelled: false, stdout: 'build ok', stderr: '', truncated: false, durationMs: 90_000 } }

function harness({ here = true, cfg = {} }: { here?: boolean, cfg?: Record<string, unknown> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-recovery-'))
  const topics = createTopicStore(join(dir, 'topics.json'))
  const owners = createOwners(join(dir, 'owners.json'), [OWNER])
  const workspaces = createWorkspaceStore(join(dir, 'workspaces.json'))
  workspaces.add(GROUP, { title: 'Team', addedBy: OWNER })
  const registry = createDeviceRegistry(join(dir, 'devices.json'))
  registry.register('PC', 'windows')
  const pc = { id: 'pc', name: 'PC', os: 'windows', shell: 'bash', projects: [], apps: [], mcp: [], shared: [], connectedAt: 1 }
  let online = here
  const asks: { deviceId: string, opId: string, tool: string, signal?: AbortSignal, answer: (o: OpOutcome) => void }[] = []
  // What is on disk at the moment the next turn looks for its project: a real record, before it would reach Claude
  let recordInTurn: unknown
  const gateway = {
    events: new EventEmitter(),
    device: (id: string) => (online && id === 'pc' ? pc : undefined),
    devices: () => (online ? [pc] : []),
    refreshProjects: async () => {
      recordInTurn = JSON.parse(readFileSync(join(dir, 'in-flight.json'), 'utf8'))
      return []
    },
    askOp: (deviceId: string, opId: string, tool: string, o: { signal?: AbortSignal }) => new Promise<OpOutcome>(resolve => {
      asks.push({ deviceId, opId, tool, signal: o.signal, answer: resolve })
      o.signal?.addEventListener('abort', () => resolve({ ok: false, error: { code: 'unknown', message: 'cancelled' } }))
    }),
  }
  const quiet = () => {}
  const updates: Record<string, unknown> = {}
  const made = createBot({
    cfg: { token: '1:test', ownerIds: [OWNER], dataDir: dir, workDir: dir, profileDir: dir, topicTtlDays: 0, maxParallel: 2, deferredSettleMs: 60, chromeConnectMs: 1, model: 'opus', chatModel: 'sonnet', effort: 'medium', apiTimeoutSec: 180, remoteMcp: {}, recoveryDeviceWaitMs: 5000, recoveryNoteMs: 10, ...cfg } as never,
    topics, workspaces, owners, updates: updates as never,
    gateway: gateway as never,
    registry: registry as never,
    pairing: {} as never,
    log: { info: quiet, warn: quiet, error: quiet, debug: quiet } as never,
    workDir: dir,
    inbox: {} as never,
    media: { ffmpeg: null } as never,
    browsers: { get: () => undefined, list: () => [] } as never,
    profiles: { list: () => [{ name: 'main' }], defaultName: 'main', env: () => ({}), status: async () => ({ loggedIn: true }), carry: () => false, nameOf: () => 'main', removeSession: () => {} } as never,
  })
  const { bot } = made
  bot.botInfo = { id: 999, is_bot: true, first_name: 'Clauder', username: 'example_bot', can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false } as never
  // No polling in a test: the failed update below would otherwise start it again
  bot.start = (async () => {}) as never
  const calls: { method: string, payload: Record<string, unknown> }[] = []
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> })
    const results: Record<string, unknown> = {
      getChat: { id: GROUP, type: 'supergroup', title: 'Team', is_forum: true },
      getChatMember: { status: 'administrator', can_manage_topics: true, can_delete_messages: true },
      getChatMemberCount: 2,
      sendMessage: { message_id: 500 + calls.length, chat: { id: GROUP, type: 'supergroup' }, date: 1 },
      sendRichMessage: { message_id: 500 + calls.length, rich_message: { blocks: [] }, chat: { id: GROUP, type: 'supergroup' }, date: 1 },
    }
    return { ok: true, result: (method in results ? results[method] : true) } as never
  })
  let update = 1
  const text = async (t: string) => {
    await bot.handleUpdate({
      update_id: update++,
      message: {
        message_id: 1000 + update, date: 1, chat: { id: GROUP, type: 'supergroup', title: 't', is_forum: true }, from: { id: OWNER, is_bot: false, first_name: 'x' }, text: t,
        is_topic_message: true, message_thread_id: 5, ...(t.startsWith('/') && { entities: [{ type: 'bot_command', offset: 0, length: t.length }] }),
      },
    } as never)
    await made.idle()
  }
  topics.bind(KEY, 'pc', 'game')
  topics.set(KEY, { sessionId: 'sess-1' })
  const record = (over: object = {}) => writeFileSync(join(dir, 'in-flight.json'), JSON.stringify([{
    key: KEY, sessionId: 'sess-1', replyTo: 4242, fromUser: true, msgIds: [4242], prompt: 'build the game', continuations: 0, deviceId: 'pc',
    ops: [{ opId: 'op-1', deviceId: 'pc', tool: 'run_command', step: '💻 `npm run build`' }], bubbles: [900], at: Date.now(), ...over,
  }]))
  return {
    ...made, dir, topics, updates, calls, asks, text, record, gateway, pc,
    recordInTurn: () => recordInTurn,
    setOnline(on: boolean) {
      online = on
      if (on) gateway.events.emit('online', pc)
    },
    onDisk: () => existsSync(join(dir, 'in-flight.json')),
    notes: () => calls.filter(c => ['sendMessage', 'sendRichMessage', 'editMessageText'].includes(c.method)).map(c => String(c.payload.text ?? (c.payload.rich_message as { markdown?: string } | undefined)?.markdown)),
  }
}

const open: ReturnType<typeof harness>[] = []
const start = (o?: Parameters<typeof harness>[0]) => {
  const h = harness(o)
  open.push(h)
  return h
}
after(() => {
  setTimeout(() => process.exit(0), 100).unref()
  for (const h of open) h.stop().catch(() => {})
})
// The turn itself would reach Claude
const emptied = (h: ReturnType<typeof harness>) => {
  const l = h.liveOf(KEY)
  const queue = [...l.queue]
  l.queue.length = 0
  return queue
}

test('a turn cut off mid-command: its leftovers go, the command is waited for and not run again, and the task goes on under the original message', async () => {
  const h = start()
  h.record()
  const done = h.recoverTurns()
  await until(() => h.asks.length === 1)
  const [ask] = h.asks
  assert.deepEqual([ask.deviceId, ask.opId, ask.tool], ['pc', 'op-1', 'run_command'])
  assert.ok(h.calls.some(c => c.method === 'deleteMessage' && c.payload.message_id === 900), 'the old status message is removed')
  assert.ok(h.calls.some(c => c.method === 'setMessageReaction' && c.payload.message_id === 4242), 'the old mark is removed')

  // The topic says it is waiting, under the message it is about
  await until(() => h.notes().some(n => /Still running on/.test(n)))
  const note = h.calls.find(c => c.method === 'sendMessage')!
  assert.equal(note.payload.message_thread_id, 5)
  assert.deepEqual(note.payload.reply_parameters, { message_id: 4242, allow_sending_without_reply: true })
  assert.doesNotMatch(String(note.payload.text), /npm run build/, 'what happens, not which command')
  assert.match(String(note.payload.text), /<b>PC<\/b>: 1 command/)
  assert.match(String(note.payload.text), /won't run twice/)
  assert.equal(h.onDisk(), true, 'another restart now finds it again')

  // A message meanwhile waits its turn
  assert.equal(h.liveOf(KEY).busy, true)
  await h.text('how is it going?')
  assert.equal(h.liveOf(KEY).queue.length, 1)

  ask.answer(built)
  await done
  const [continuation, waiting] = emptied(h).sort((a, b) => a.seq - b.seq)
  assert.equal(continuation.msgId, 4242, 'the answer goes under the original message')
  assert.deepEqual(continuation.continuation, { n: 1, asked: 'build the game' })
  assert.match(continuation.text, /server was restarted/)
  assert.match(continuation.text, /npm run build/)
  assert.match(continuation.text, /build ok/)
  assert.match(continuation.text, /> build the game/)
  assert.equal(waiting.text, 'how is it going?', 'after it')
  assert.equal(h.liveOf(KEY).busy, false)
  assert.equal(h.topics.get(KEY).sessionId, 'sess-1', 'the same session')
  assert.match(JSON.parse(readFileSync(join(h.dir, 'in-flight.json'), 'utf8'))[0].next, /server was restarted/, 'until its turn begins, another restart picks it up')
  assert.match(h.notes().at(-1)!, /Continuing it/)
})

test('on the way out nothing is stopped and the record stays: a Stop would kill the commands on the computers', async () => {
  const h = start()
  const abort = new AbortController()
  Object.assign(h.liveOf(KEY), { busy: true, abort, queue: [{ seq: 0, text: 'waiting', images: [] }] })
  h.flights.begin(KEY, { sessionId: 'sess-1', replyTo: 4242, fromUser: true, msgIds: [4242], prompt: 'build the game', continuations: 0, deviceId: 'pc' })
  h.flights.opStart(KEY, { opId: 'op-1', deviceId: 'pc', tool: 'run_command', step: 'npm run build' })
  await h.stop()
  assert.equal(abort.signal.aborted, false)
  // Whatever becomes of the turn from here
  h.flights.opEnd(KEY, 'op-1')
  h.flights.end(KEY)
  const [saved] = JSON.parse(readFileSync(join(h.dir, 'in-flight.json'), 'utf8'))
  assert.deepEqual(saved.ops.map((o: { opId: string }) => o.opId), ['op-1'])
  assert.ok(existsSync(join(h.dir, 'queues.json')), 'what waited in the topic is kept as before')
  Object.assign(h.liveOf(KEY), { busy: false, abort: null })
})

test('the session a crash lost from the topic store comes back from the record', async () => {
  const h = start()
  h.topics.set(KEY, { sessionId: null })
  h.record({ ops: [] })
  await h.recoverTurns()
  assert.equal(h.topics.get(KEY).sessionId, 'sess-1')
  emptied(h)
})

test('a computer that comes back is asked; the topic says it waits for it meanwhile', async () => {
  const h = start({ here: false })
  h.record()
  const done = h.recoverTurns()
  await until(() => h.notes().some(n => /Waiting for <b>PC<\/b> to connect/.test(n)))
  h.setOnline(true)
  await until(() => h.asks.length > 0)
  h.asks[0].answer(built)
  await done
  assert.match(emptied(h)[0].text, /build ok/)
})

test('a computer that stays away past the limit: it goes on anyway and says so', async () => {
  const h = start({ here: false, cfg: { recoveryDeviceWaitMs: 30 } })
  h.record()
  await h.recoverTurns()
  const [continuation] = emptied(h)
  assert.match(continuation.text, /unknown, the computer did not come back/)
  assert.match(continuation.text, /PC did not come back online in time/)
  assert.match(h.notes().at(-1)!, /did not come back in time/)
  assert.match(JSON.parse(readFileSync(join(h.dir, 'in-flight.json'), 'utf8'))[0].next, /server was restarted/, 'until its turn begins, another restart picks it up')
})

test('a topic with nothing open on the computer waits for it all the same, then goes on', async () => {
  const h = start({ here: false })
  h.record({ ops: [] })
  const done = h.recoverTurns()
  await sleep(50)
  assert.equal(h.liveOf(KEY).queue.length, 0)
  h.setOnline(true)
  await done
  const [continuation] = emptied(h)
  assert.match(continuation.text, /server was restarted/)
  assert.doesNotMatch(continuation.text, /Commands that were running/)
})

test('/stop during the wait cancels the command and drops the continuation', async () => {
  const h = start()
  h.record()
  const done = h.recoverTurns()
  await until(() => h.asks.length === 1)
  await h.text('/stop')
  assert.equal(h.asks[0].signal?.aborted, true, 'the cancel goes to the computer')
  await done
  assert.equal(h.liveOf(KEY).queue.length, 0)
  assert.equal(h.onDisk(), false)
  assert.equal(h.liveOf(KEY).busy, false)
  assert.match(h.notes().at(-1)!, /Stopped/)
})

test('/new during the wait: the old task is over', async () => {
  const h = start()
  h.record()
  const done = h.recoverTurns()
  await until(() => h.asks.length === 1)
  await h.text('/new')
  h.asks[0].answer(built)
  await done
  assert.equal(h.liveOf(KEY).queue.length, 0)
  assert.equal(h.onDisk(), false)
})

test('never a loop: past the limit the task stops and the user hears it', async () => {
  const h = start()
  h.record({ continuations: MAX_CONTINUATIONS })
  await h.recoverTurns()
  assert.equal(h.asks.length, 0)
  assert.equal(h.liveOf(KEY).queue.length, 0)
  assert.equal(h.onDisk(), false)
  const note = h.calls.find(c => c.method === 'sendMessage')!
  assert.match(String(note.payload.text), /keeps restarting/)
  assert.deepEqual(note.payload.reply_parameters, { message_id: 4242, allow_sending_without_reply: true })
  assert.ok(h.calls.some(c => c.method === 'deleteMessage'), 'its leftovers still go')
})

test('a record from long ago is no reason to start working', async () => {
  const h = start()
  h.record({ at: Date.now() - 13 * 3600_000 })
  await h.recoverTurns()
  assert.equal(h.liveOf(KEY).queue.length, 0)
  assert.match(h.notes().at(-1)!, /down for a long time/)
})

test('a topic deleted while the server was down is not worked on', async () => {
  const h = start()
  h.bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === 'sendMessage') return { ok: false, error_code: 400, description: 'Bad Request: message thread not found' } as never
    return prev(method, payload, signal)
  })
  h.record({ ops: [] })
  await h.recoverTurns()
  assert.equal(h.liveOf(KEY).queue.length, 0)
  assert.equal(h.onDisk(), false)
})

test('the next turn carries the count and the question on, so the limit holds across restarts', async () => {
  const h = start()
  h.record({ continuations: 1, ops: [] })
  await h.recoverTurns()
  // This turn goes as far as looking for a project that isn't there, and no further
  await until(() => !!h.recordInTurn())
  const [saved] = h.recordInTurn() as { continuations: number, prompt: string, replyTo: number, fromUser: boolean, key: string }[]
  assert.equal(saved.continuations, 2)
  assert.equal(saved.prompt, 'build the game')
  assert.equal(saved.replyTo, 4242)
  assert.equal(saved.fromUser, true)
  assert.equal(saved.key, KEY)
  await h.idle()
  await until(() => !h.onDisk())
})

test('a turn from another session is answered under what the bot showed for it, and keeps its limits', async () => {
  const h = start()
  h.record({ replyTo: 77, fromUser: false, msgIds: [], ops: [], modeCap: 'read' })
  await h.recoverTurns()
  const [continuation] = emptied(h)
  assert.equal(continuation.shownId, 77)
  assert.equal(continuation.msgId, undefined)
  assert.equal(continuation.fromMode, 'read')
})

test('an update waits 3 minutes at most, says plainly what happens to tasks, and goes without asking', async () => {
  const h = start({ cfg: { updateWaitMs: 40 } })
  let asked = ''
  Object.assign(h.updates, { current: '0.0.1', helper: () => true, noteMessage() {}, clearResult() {}, request: (tag: string) => { asked = tag }, result: () => null })
  const l = h.liveOf(`${OWNER}:5`)
  const abort = new AbortController()
  Object.assign(l, { preparing: 1, busy: true, abort })
  await h.bot.handleUpdate({
    update_id: 9000,
    callback_query: { id: '1', from: { id: OWNER, is_bot: false, first_name: 'x' }, chat_instance: 'x', data: 'upd:go:9.9.9', message: { message_id: 77, date: 1, chat: { id: OWNER, type: 'private', first_name: 'x' }, text: 'x', from: { id: 999, is_bot: true, first_name: 'b' } } },
  } as never)
  await until(() => asked === 'v9.9.9')
  assert.equal(abort.signal.aborted, false, 'nothing was stopped')
  assert.ok(h.notes().some(n => /Nothing is lost: they go on after the restart|Ничего не потеряется/.test(n)))
  Object.assign(l, { preparing: 0, busy: false, abort: null })
})

test('when the helper fails, what waited goes on', { timeout: 15_000 }, async () => {
  const h = start({ cfg: { updateWaitMs: 1 } })
  let result: unknown = null
  Object.assign(h.updates, { current: '0.0.1', helper: () => true, noteMessage() {}, clearResult() { result = null }, request() { result = { ok: false, error: 'no space left' } }, result: () => result })
  const l = h.liveOf(KEY)
  await h.bot.handleUpdate({
    update_id: 9001,
    callback_query: { id: '2', from: { id: OWNER, is_bot: false, first_name: 'x' }, chat_instance: 'x', data: 'upd:go:9.9.9', message: { message_id: 78, date: 1, chat: { id: OWNER, type: 'private', first_name: 'x' }, text: 'x', from: { id: 999, is_bot: true, first_name: 'b' } } },
  } as never)
  await until(() => h.notes().some(n => /Didn't update to 9\.9\.9/.test(n)), 8000)
  assert.ok(h.notes().some(n => /no space left/.test(n)))
  // A message now starts as usual instead of being told the server is updating
  const before = h.notes().length
  await h.text('hello again')
  await sleep(1700)
  assert.ok(!h.notes().slice(before).some(n => /is updating/.test(n)))
  l.queue.length = 0
})

test('a turn the computers have settled stays on disk until the next one writes its own record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-settled-'))
  const file = join(dir, 'in-flight.json')
  const store = createFlightStore(file)
  store.begin('k', { sessionId: 's', fromUser: true, msgIds: [1], prompt: 'p', continuations: 0 })
  store.opStart('k', { opId: 'o', deviceId: 'pc', tool: 'run_command', step: 'x' })
  store.settled('k', 'what Claude is told')
  const left = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(left[0].next, 'what Claude is told')
  assert.deepEqual(left[0].ops, [], 'nothing left to ask the computer')
  store.begin('k', { sessionId: 's', fromUser: true, msgIds: [1], prompt: 'p', continuations: 1 })
  const now = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(now[0].next, undefined, 'the next turn takes over')
  assert.equal(now[0].continuations, 1)
})
