import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { GROUP_AVATAR_FILE } from '../src/telegram/avatar.ts'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpEvent, OpTool, Project } from '@tgcv/protocol'
import { createExecutor } from '../../agent/src/executor.ts'
import { createWorkspace } from '../../agent/src/workspace.ts'
import { createBot } from '../src/telegram/bot.ts'
import { createTopicStore } from '../src/store.ts'
import { createWorkspaceStore } from '../src/workspaces.ts'
import { createOwners } from '../src/owners.ts'
import { createDeviceRegistry } from '../src/devices.ts'
import { setLang } from '../src/i18n.ts'

// The bot through its front door: real updates, real stores, real agents on temporary folders, and Telegram replaced by
// a list of what was asked of it. Nothing here may reach Claude: only topics without a computer take messages

setLang('en')
const OWNER = 5550001234
const STRANGER = 111
const GROUP = -1003555000111
const STRANGERS_GROUP = -1001111111111

function computer(id: string, name: string, projects: string[]) {
  const base = mkdtempSync(join(tmpdir(), `tgcv-flow-${id}-`))
  const zone = join(base, 'zone')
  mkdirSync(zone)
  for (const p of projects) mkdirSync(join(zone, p))
  const workspace = createWorkspace({ projects: [], zones: [{ path: zone }], stateFile: join(base, 'state.json'), selfDir: join(base, 'agent') })
  const executor = createExecutor({ workspace, shell: 'bash', log: () => {}, openChrome: async () => ({ started: true }) })
  return { id, name, os: 'windows', zone, executor, workspace, shell: 'bash', apps: [], projects: workspace.list() as Project[] }
}

type Call = { method: string, payload: Record<string, unknown> }

function harness(devices: ReturnType<typeof computer>[] = [], dir = mkdtempSync(join(tmpdir(), 'tgcv-flow-')), maxParallel = 0) {
  const topics = createTopicStore(join(dir, 'topics.json'))
  const workspaces = createWorkspaceStore(join(dir, 'workspaces.json'))
  const owners = createOwners(join(dir, 'owners.json'), [OWNER])
  let n = 0
  const device = (id: string) => devices.find(d => d.id === id)
  const gateway = {
    events: new EventEmitter(),
    device,
    devices: () => [...devices],
    tunnels: { size: 0 },
    rename(id: string, name: string) {
      if (!registry.rename(id, name)) return false
      const d = device(id)
      if (d) d.name = name
      return true
    },
    refreshProjects: async (id: string) => {
      const d = device(id)!
      d.projects = d.workspace.list(true) as Project[]
      return d.projects
    },
    request: async (id: string, op: { projectId: string, bindingVersion: number, tool: OpTool, params: Record<string, unknown> }) => {
      const events: OpEvent[] = []
      await device(id)!.executor.handle({ type: 'op.request', opId: `op-${n++}`, ...op, deadline: Date.now() + 120_000 } as never, (e: OpEvent) => events.push(e))
      const last = events.at(-1)!
      return last.error ? { ok: false, error: last.error } : { ok: true, result: last.result }
    },
  }
  const quiet = () => {}
  const updates: Record<string, unknown> = {}
  const registry = createDeviceRegistry(join(dir, 'devices.json'))
  const made = createBot({
    cfg: { token: '1:test', ownerIds: [OWNER], dataDir: dir, workDir: dir, profileDir: dir, topicTtlDays: 0, maxParallel, deferredSettleMs: 60, chromeConnectMs: 1, model: 'opus', chatModel: 'sonnet', effort: 'medium', apiTimeoutSec: 180, remoteMcp: {} } as never,
    topics,
    workspaces,
    gateway: gateway as never,
    registry: registry as never,
    pairing: {} as never,
    log: { info: quiet, warn: quiet, error: quiet, debug: quiet } as never,
    workDir: dir,
    inbox: {} as never,
    media: { ffmpeg: null } as never,
    browsers: { get: () => undefined, list: () => [] } as never,
    profiles: { list: () => [{ name: 'main' }], defaultName: 'main', env: () => ({}), status: async () => ({ loggedIn: true }), carry: () => false, nameOf: () => 'main', removeSession: () => {} } as never,
    owners,
    updates: updates as never,
  })
  const { bot } = made
  bot.botInfo = { id: 999, is_bot: true, first_name: 'Clauder', username: 'example_bot', can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false } as never

  const calls: Call[] = []
  let members = 2
  const chats: Record<string, unknown> = {
    [GROUP]: { id: GROUP, type: 'supergroup', title: 'Roblox', is_forum: true },
    [STRANGERS_GROUP]: { id: STRANGERS_GROUP, type: 'supergroup', title: 'Theirs', is_forum: true },
  }
  let botMember: Record<string, unknown> = { status: 'administrator', can_manage_topics: true, can_delete_messages: true }
  let thread = 100
  const deleted = new Set<number>()
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> })
    if (method === 'setMessageReaction' && deleted.has((payload as { message_id: number }).message_id)) {
      return { ok: false, error_code: 400, description: 'Bad Request: message to react not found' } as never
    }
    const results: Record<string, unknown> = {
      getChat: chats[String((payload as { chat_id: number }).chat_id)] ?? { id: 1, type: 'private' },
      getChatMember: botMember,
      getChatMemberCount: members,
      createForumTopic: { message_thread_id: ++thread, name: (payload as { name?: string }).name },
      sendMessage: { message_id: 500 + calls.length, chat: { id: 1, type: 'private' }, date: 1 },
      sendRichMessage: {
        message_id: 500 + calls.length,
        rich_message: { blocks: ((payload as { rich_message?: { media?: unknown[] } }).rich_message?.media ?? []).map((_, i) => ({ type: 'photo', photo: [{ file_id: `kept${i}` }] })) },
        chat: { id: 1, type: 'private' },
        date: 1,
      },
    }
    return { ok: true, result: (method in results ? results[method] : true) } as never
  })

  let update = 1
  // What runs beside the queue counts too: the test looks at the outcome
  const send = async (u: unknown) => {
    await bot.handleUpdate(u as never)
    await made.idle()
  }
  const from = (id: number) => ({ id, is_bot: false, first_name: 'x' })
  const chatOf = (id: number) => (id > 0 ? { id, type: 'private', first_name: 'x' } : { id, type: 'supergroup', title: 't', is_forum: true })
  const entities = (text: string) => {
    const m = text.match(/^\/[\w@]+/)
    return m ? [{ type: 'bot_command', offset: 0, length: m[0].length }] : undefined
  }
  return {
    ...made,
    updates,
    deleted,
    online: (d: unknown) => gateway.events.emit('online', d),
    dir,
    registry,
    topics,
    workspaces,
    owners,
    calls,
    setMembers: (x: number) => { members = x },
    setChat: (id: number, c: Record<string, unknown>) => { chats[id] = { id, ...c } },
    setBotMember: (m: Record<string, unknown>) => { botMember = m },
    // What the bot said or did, without the answers to taps
    said: () => calls.filter(c => !['answerCallbackQuery', 'getChat', 'getChatMember', 'getChatMemberCount', 'setMyCommands', 'setChatPhoto'].includes(c.method)),
    reset: () => { calls.length = 0 },
    text: (chat: number, user: number, text: string, topic?: number, extra: Record<string, unknown> = {}) => send({
      update_id: update++,
      message: {
        message_id: update, date: 1, chat: chatOf(chat), from: from(user), text, entities: entities(text),
        ...(topic && { is_topic_message: true, message_thread_id: topic }), ...extra,
      },
    }),
    tap: (chat: number, user: number, data: string, topic?: number) => send({
      update_id: update++,
      callback_query: {
        id: String(update), from: from(user), chat_instance: 'x', data,
        message: { message_id: 77, date: 1, chat: chatOf(chat), text: 'x', from: { id: 999, is_bot: true, first_name: 'b' }, ...(topic && { is_topic_message: true, message_thread_id: topic }) },
      },
    }),
    membership: (chat: number, user: number, status: string) => send({
      update_id: update++,
      my_chat_member: {
        chat: chatOf(chat), from: from(user), date: 1,
        old_chat_member: { status: 'left', user: { id: 999, is_bot: true, first_name: 'b' } },
        new_chat_member: { status, user: { id: 999, is_bot: true, first_name: 'b' } },
      },
    }),
    topicCreated: (chat: number, user: number, topic: number) => send({
      update_id: update++,
      message: { message_id: update, date: 1, chat: chatOf(chat), from: from(user), is_topic_message: true, message_thread_id: topic, forum_topic_created: { name: 'New', icon_color: 1 } },
    }),
  }
}

const open: ReturnType<typeof harness>[] = []
const start = (devices: ReturnType<typeof computer>[] = [], dir?: string, maxParallel?: number) => {
  const h = harness(devices, dir, maxParallel)
  open.push(h)
  return h
}
after(() => {
  // Timers of a bot that never polled: nothing else keeps this file alive
  setTimeout(() => process.exit(0), 100).unref()
  for (const h of open) h.stop().catch(() => {})
})
const textOf = (c: Call) => String(c.payload.text ?? (c.payload.rich_message as { markdown?: string } | undefined)?.markdown ?? '')

test('a stranger in a workspace moves nothing: no message, no tap, no button of anyone else', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  h.topics.bind(`${GROUP}:5`, 'pc', 'game')
  const before = JSON.stringify(h.topics.get(`${GROUP}:5`))
  for (const text of ['delete everything', '/delete', '/stop', '/new', '/mode', '/workspace', '/computer', '/users']) await h.text(GROUP, STRANGER, text, 5)
  for (const data of ['del:yes', 'cs:go:pc', 'cs:new:pc', 'cs:copy:pc', 'ws:dev:pc', 'ws:mod:all', 'ok:1', 'forever:1', 'wm:-1003555000111', 'stg:1', 'cp:go', 'show:aaaaaaaaaaaa', 'upd:go:9.9.9', 'updw:cancel', 'usr:rm:1']) {
    await h.tap(GROUP, STRANGER, data, 5)
  }
  assert.deepEqual(h.said(), [], 'the bot did and said nothing')
  assert.equal(JSON.stringify(h.topics.get(`${GROUP}:5`)), before)
  assert.equal(h.workspaces.get(GROUP)!.mode, undefined)
})

test('a card that hides part of a command as a secret says so and offers the whole of it; a clean one says nothing', async () => {
  const h = start()
  const key = `${OWNER}:5`
  void h.permissionFor(key, 'mcp__device__run_command', { command: 'TOKEN=abcdef123456 curl https://example.com/x' })
  await new Promise(r => setTimeout(r, 20))
  const card = h.said().find(c => c.method === 'sendRichMessage')!
  assert.match(textOf(card), /hidden as a secret/)
  assert.doesNotMatch(textOf(card), /abcdef123456/)
  const buttons = (card.payload.reply_markup as { inline_keyboard: { callback_data?: string }[][] }).inline_keyboard.flat().map(b => b.callback_data)
  assert.ok(buttons.some(d => d?.startsWith('show:')), 'the whole of it is a tap away')
  assert.ok(buttons.some(d => d?.startsWith('ok:')))
  h.reset()
  void h.permissionFor(key, 'mcp__device__run_command', { command: 'npm test' })
  await new Promise(r => setTimeout(r, 20))
  assert.doesNotMatch(textOf(h.said().find(c => c.method === 'sendRichMessage')!), /hidden as a secret/)
})

test('a stranger in the private chat is ignored too', async () => {
  const h = start()
  await h.text(STRANGER, STRANGER, '/workspace')
  await h.text(STRANGER, STRANGER, '/users')
  await h.tap(STRANGER, STRANGER, 'upd:go:9.9.9')
  assert.deepEqual(h.said(), [])
})

test('the owner in a group that is no workspace is not answered, until they ask for it', async () => {
  const h = start()
  await h.text(GROUP, OWNER, 'hello', 5)
  await h.text(GROUP, OWNER, '/status', 5)
  assert.deepEqual(h.said(), [])
  assert.equal(h.workspaces.get(GROUP), undefined)
  await h.text(GROUP, OWNER, '/workspace', 5)
  assert.equal(h.workspaces.get(GROUP)?.addedBy, OWNER)
  assert.match(textOf(h.said()[0]), /Roblox/)
  assert.equal(h.said()[0].payload.message_thread_id, 5)
})

test('a forum without the rights is told what it lacks, and does not become a workspace', async () => {
  const h = start()
  h.setChat(GROUP, { type: 'supergroup', title: 'Forum', is_forum: true })
  h.setBotMember({ status: 'member' })
  await h.text(GROUP, OWNER, '/workspace')
  assert.match(textOf(h.said()[0]), /Make me an admin/)
  assert.equal(h.workspaces.get(GROUP), undefined)
})

test('the bot joins only at the hand of its owner, and stops everything when it is removed', async () => {
  const h = start()
  await h.membership(STRANGERS_GROUP, STRANGER, 'administrator')
  assert.deepEqual(h.said().map(c => c.method), ['leaveChat'])
  assert.equal(h.workspaces.get(STRANGERS_GROUP), undefined)
  h.reset()

  await h.membership(GROUP, OWNER, 'administrator')
  assert.ok(h.workspaces.get(GROUP))
  assert.match(textOf(h.said()[0]), /Roblox/)
  h.reset()
  // A later change of rights doesn't show the card again; a stranger can't take the group over by it
  await h.membership(GROUP, STRANGER, 'administrator')
  assert.deepEqual(h.said(), [])
  assert.ok(h.workspaces.get(GROUP))

  await h.membership(GROUP, OWNER, 'kicked')
  assert.equal(h.workspaces.get(GROUP), undefined)
  h.reset()
  await h.text(GROUP, OWNER, 'hello', 5)
  assert.deepEqual(h.said(), [], 'and the group is closed again')
})

test('an anonymous admin hears why once, and gets nowhere', async () => {
  const h = start()
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  const anonymous = { sender_chat: { id: GROUP, type: 'supergroup', title: 't' } }
  await h.text(GROUP, 1087968824, 'hello', 5, anonymous)
  await h.text(GROUP, 1087968824, 'again', 5, anonymous)
  assert.equal(h.said().length, 1)
  assert.match(textOf(h.said()[0]), /anonymous admin/)
  assert.equal(h.topics.get(`${GROUP}:5`).deviceId, undefined)
})

test('what shows accounts or pairing codes works only in private', async () => {
  const h = start()
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  for (const command of ['users', 'devices', 'pair', 'github', 'tools', 'profile', 'profiles', 'diag', 'update', 'cleanup']) {
    h.reset()
    await h.text(GROUP, OWNER, `/${command}`, 5)
    assert.equal(h.said().length, 1, command)
    assert.match(textOf(h.said()[0]), /only in the private chat/, command)
  }
})

test('a button with a sign-in or a pairing code does nothing in a group', async () => {
  const h = start()
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  for (const data of ['pairnew', 'lg:main', 'ghcode', 'ghc:pc', 'ghout', 'mcl:figma', 'mcw:figma', 'dvs', 'dv:pc', 'zo:pc', 'rv:pc', 'rvok:pc', 'usr:yes:1', 'usr:drop:1']) await h.tap(GROUP, OWNER, data, 5)
  assert.deepEqual(h.said(), [])
  assert.equal(h.owners.has(1), false)
})

test('access is never given or taken by data on a button alone', async () => {
  const h = start()
  await h.tap(OWNER, OWNER, 'usr:yes:222', 5)
  assert.equal(h.owners.has(222), false, 'nobody asked')
  h.owners.add(333)
  await h.tap(OWNER, OWNER, 'usr:drop:333', 5)
  assert.equal(h.owners.has(333), true, 'nobody asked')
})

test('commands for another bot and what the add link leaves behind get no answer', async () => {
  const h = start()
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  await h.text(GROUP, OWNER, '/status@other_bot', 5)
  await h.bot.handleUpdate({ update_id: 90_001, message: { message_id: 1, date: 1, chat: { id: GROUP, type: 'supergroup', title: 't' }, from: { id: OWNER, is_bot: false, first_name: 'x' }, text: '/start@example_bot', is_topic_message: true, message_thread_id: 5 } } as never)
  await h.text(GROUP, OWNER, '/start@example_bot ws', 5)
  assert.deepEqual(h.said(), [])
})

test('a new topic of a workspace starts from its settings, and asks only what they leave open', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER, deviceId: 'pc', projectId: 'game', mode: 'all', model: 'opus' })
  await h.topicCreated(GROUP, OWNER, 7)
  const t = h.topics.get(`${GROUP}:7`)
  assert.equal(t.deviceId, 'pc')
  assert.equal(t.projectId, 'game')
  assert.equal(t.mode, 'all')
  assert.equal(t.model, 'opus')
  assert.deepEqual(h.said(), [], 'no picker')

  // With only a computer: straight to its projects, though another is online
  const mac = computer('mac', 'Mac', ['other'])
  const two = start([pc, mac])
  two.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER, deviceId: 'mac' })
  await two.topicCreated(GROUP, OWNER, 8)
  assert.equal(two.topics.get(`${GROUP}:8`).deviceId, undefined)
  assert.match(textOf(two.said()[0]), /Mac/)
  assert.match(JSON.stringify(two.said()[0].payload.reply_markup), /b:mac:other/)

  // Outside a workspace a topic never inherits anything
  const none = start([pc])
  await none.topicCreated(OWNER, OWNER, 9)
  assert.equal(none.topics.get(`${OWNER}:9`).deviceId, undefined)
})

test('/status in General or an older topic of a workspace shows its settings, before any task', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER, deviceId: 'pc', projectId: 'game', mode: 'all' })
  await h.text(GROUP, OWNER, '/status')
  const md = textOf(h.said()[0])
  assert.match(md, /PC/)
  assert.match(md, /game/)
  assert.doesNotMatch(md, /\| \| \|/, 'no empty row on top')
  assert.equal(h.topics.get(`${GROUP}:0`).mode, 'all')
  // A topic the user took off the project stays so
  h.topics.unbind(`${GROUP}:9`)
  await h.text(GROUP, OWNER, '/status', 9)
  assert.equal(h.topics.get(`${GROUP}:9`).deviceId, undefined)
})

test('the card changes the settings, and a computer change clears the project', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const mac = computer('mac', 'Mac', [])
  const h = start([pc, mac])
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER, deviceId: 'pc', projectId: 'game' })
  await h.tap(GROUP, OWNER, 'ws:mod:read')
  assert.equal(h.workspaces.get(GROUP)!.mode, 'read')
  await h.tap(GROUP, OWNER, 'ws:mod:nonsense')
  assert.equal(h.workspaces.get(GROUP)!.mode, 'read')
  // Buttons carry the model itself, so an old menu can't pick another one when the list changes
  await h.tap(GROUP, OWNER, 'ws:mdl:0')
  assert.equal(h.workspaces.get(GROUP)!.model, undefined, 'no model by a place in the list')
  await h.tap(GROUP, OWNER, 'ws:mdl:claude-fable-5-2')
  assert.equal(h.workspaces.get(GROUP)!.model, 'claude-fable-5-2')
  await h.tap(GROUP, OWNER, 'ws:mdl:-')
  assert.equal(h.workspaces.get(GROUP)!.model, undefined)
  await h.tap(GROUP, OWNER, 'ws:dev:mac')
  assert.equal(h.workspaces.get(GROUP)!.deviceId, 'mac')
  assert.equal(h.workspaces.get(GROUP)!.projectId, undefined)
  h.reset()
  await h.tap(GROUP, OWNER, 'ws:dev')
  assert.match(textOf(h.said()[0]), /ws:dev:pc/)
})

test('/computer: the same folder elsewhere, the conversation goes with it and Chrome stays behind', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const mac = computer('mac', 'Mac', ['game'])
  const h = start([pc, mac])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  h.topics.set(key, { sessionId: 's1', browser: true, browserAuto: true })
  await h.text(OWNER, OWNER, '/computer', 5)
  assert.match(textOf(h.said()[0]), /cs:go:mac/)
  assert.doesNotMatch(textOf(h.said()[0]), /cs:go:pc/)
  await h.tap(OWNER, OWNER, 'cs:go:mac', 5)
  const t = h.topics.get(key)
  assert.equal(t.deviceId, 'mac')
  assert.equal(t.sessionId, 's1')
  assert.equal(t.envChanged, true, 'Claude hears its earlier reads are stale')
  assert.equal(t.envCame, undefined, 'the folder was already there')
  assert.equal(t.browser, false)
  // A second tap on the old button changes nothing
  const version = t.bindingVersion
  await h.tap(OWNER, OWNER, 'cs:go:mac', 5)
  assert.equal(h.topics.get(key).bindingVersion, version)
})

test('/computer: no folder there, the user chooses, and the copy is real', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const mac = computer('mac', 'Mac', [])
  writeFileSync(join(pc.zone, 'game', 'scene.txt'), 'scene')
  const h = start([pc, mac])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  h.topics.set(key, { sessionId: 's1' })

  await h.tap(OWNER, OWNER, 'cs:go:mac', 5)
  assert.equal(h.topics.get(key).deviceId, 'pc', 'nothing happens before the choice')
  const offer = textOf(h.said().at(-1)!)
  assert.match(offer, /has no folder/)
  assert.match(offer, /cs:copy:mac/)
  assert.match(offer, /cs:new:mac/)
  assert.doesNotMatch(offer, /cs:git:mac/, 'no remote: nothing to clone')

  await h.tap(OWNER, OWNER, 'cs:copy:mac', 5)
  await h.idle()
  assert.match(String(h.topics.get(`${OWNER}:5`).envCame), /copied here from/, 'Claude hears the files came along')
  assert.equal(readFileSync(join(mac.zone, 'game', 'scene.txt'), 'utf8'), 'scene')
  const t = h.topics.get(key)
  assert.equal(t.deviceId, 'mac')
  assert.equal(t.sessionId, 's1')
  assert.match(textOf(h.said().at(-1)!), /goes on here/)
})

test('/computer: an empty folder, a refusal while working, a topic that cannot go', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const mac = computer('mac', 'Mac', [])
  const h = start([pc, mac])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  await h.tap(OWNER, OWNER, 'cs:new:mac', 5)
  assert.equal(h.topics.get(key).deviceId, 'mac')
  assert.ok(existsSync(join(mac.zone, 'game')))

  h.reset()
  await h.text(OWNER, OWNER, '/computer', 6)
  assert.match(textOf(h.said()[0]), /Choose a project first/)
  h.topics.bind(`${OWNER}:8`, 'pc', 'game')
  h.topics.set(`${OWNER}:8`, { worktree: { repo: 'r', folder: 'f', branch: 'b' } })
  h.reset()
  await h.text(OWNER, OWNER, '/computer', 8)
  assert.match(textOf(h.said()[0]), /branch of its own/)
  await h.tap(OWNER, OWNER, 'cs:go:mac', 8)
  assert.equal(h.topics.get(`${OWNER}:8`).deviceId, 'pc')
  // An unknown or offline computer
  await h.tap(OWNER, OWNER, 'cs:new:gone', 5)
  assert.equal(h.topics.get(key).deviceId, 'mac')
})

test('a clone address with a password in it is never offered', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const mac = computer('mac', 'Mac', [])
  const h = start([pc, mac])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  const root = join(pc.zone, 'game')
  mkdirSync(join(root, '.git', 'refs'), { recursive: true })
  mkdirSync(join(root, '.git', 'objects'))
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  writeFileSync(join(root, '.git', 'config'), '[remote "origin"]\n\turl = https://user:secret@github.com/a/b.git\n')
  await h.tap(OWNER, OWNER, 'cs:go:mac', 5)
  const offer = textOf(h.said().at(-1)!)
  assert.match(offer, /has no folder/)
  assert.doesNotMatch(offer, /cs:git:mac/)
  assert.doesNotMatch(offer, /secret/)

  writeFileSync(join(root, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/a/b.git\n')
  await h.tap(OWNER, OWNER, 'cs:go:mac', 5)
  assert.match(textOf(h.said().at(-1)!), /cs:git:mac/)
})

test('a topic moves to a workspace with its conversation and tasks, and the old one holds nothing', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  h.topics.set(key, { sessionId: 's1', mode: 'all', model: 'opus', suggested: { id: 1, replies: ['x'] } })

  await h.text(OWNER, OWNER, '/workspace', 5)
  assert.match(JSON.stringify(h.said()[0].payload.reply_markup), /wm:-1003555000111/)
  h.reset()
  await h.tap(OWNER, OWNER, `wm:${GROUP}`, 5)
  assert.equal(h.calls.find(c => c.method === 'createForumTopic')?.payload.name, 'game')
  const moved = h.topics.entries().find(([k]) => k.startsWith(`${GROUP}:`))!
  assert.equal(moved[1].sessionId, 's1')
  assert.equal(moved[1].deviceId, 'pc')
  assert.equal(moved[1].mode, 'all')
  assert.equal(moved[1].suggested, undefined, 'buttons of the old topic stay behind')
  assert.equal(h.topics.get(key).sessionId, undefined)
  assert.equal(h.topics.get(key).deviceId, undefined)

  h.reset()
  await h.tap(OWNER, OWNER, `wm:${GROUP}`, 5)
  assert.equal(h.calls.filter(c => c.method === 'createForumTopic').length, 0, 'an old button can not move it twice')
})

test('after moving, the old topic offers to go at one tap, or stays to read', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  const lastEdit = () => textOf(h.calls.filter(c => c.method === 'editMessageText').at(-1)!)

  h.topics.bind(`${OWNER}:5`, 'pc', 'game')
  await h.tap(OWNER, OWNER, `wm:${GROUP}`, 5)
  const offer = lastEdit()
  assert.match(offer, /Moved to \[Roblox\]\(https:\/\/t\.me\/c\/3555000111\/\d+\)/)
  assert.match(offer, /data="del:yes"/)
  const keep = offer.match(/wmk:-\d+:\d+/)![0]
  assert.deepEqual(h.calls.filter(c => c.method === 'deleteForumTopic'), [], 'nothing goes by itself')

  await h.tap(OWNER, OWNER, keep, 5)
  assert.match(lastEdit(), /Moved to \[Roblox\]/)
  assert.doesNotMatch(lastEdit(), /tg-button/)
  assert.deepEqual(h.calls.filter(c => c.method === 'deleteForumTopic'), [])

  await h.tap(OWNER, OWNER, 'del:yes', 5)
  assert.deepEqual(h.calls.filter(c => c.method === 'deleteForumTopic').map(c => c.payload.message_thread_id), [5])
  assert.ok(h.topics.entries().some(([k, t]) => k.startsWith(`${GROUP}:`) && t.deviceId === 'pc'), 'the moved conversation is not touched')
})

test('a team stays where it is, and only known workspaces can receive a topic', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  h.topics.bind(`${OWNER}:5`, 'pc', 'game')
  h.topics.set(`${OWNER}:5`, { workers: [`${OWNER}:6`] })
  h.topics.bind(`${OWNER}:6`, 'pc', 'game')
  h.topics.set(`${OWNER}:6`, { head: `${OWNER}:5` })
  await h.tap(OWNER, OWNER, `wm:${GROUP}`, 5)
  await h.tap(OWNER, OWNER, `wm:${GROUP}`, 6)
  assert.equal(h.calls.filter(c => c.method === 'createForumTopic').length, 0)
  h.topics.bind(`${OWNER}:7`, 'pc', 'game')
  await h.tap(OWNER, OWNER, `wm:${STRANGERS_GROUP}`, 7)
  assert.equal(h.calls.filter(c => c.method === 'createForumTopic').length, 0)
  assert.equal(h.topics.get(`${OWNER}:7`).deviceId, 'pc')
})

test('"Show for a minute" is offered only where no one else would read the secret', async () => {
  const alone = start()
  alone.setChat(GROUP, { type: 'supergroup', title: 'a.person@example.com', is_forum: true })
  await alone.text(GROUP, OWNER, '/workspace', 5)
  const shown = alone.said().at(-1)!
  assert.doesNotMatch(textOf(shown), /a\.person/, 'masked')
  assert.match(JSON.stringify(shown.payload.reply_markup), /show:/)

  const company = start()
  company.setMembers(3)
  company.setChat(GROUP, { type: 'supergroup', title: 'a.person@example.com', is_forum: true })
  await company.text(GROUP, OWNER, '/workspace', 5)
  const hidden = company.said().at(-1)!
  assert.doesNotMatch(textOf(hidden), /a\.person/, 'masked')
  assert.doesNotMatch(JSON.stringify(hidden.payload.reply_markup ?? ''), /show:/)
  assert.match(textOf(hidden), /Everyone in this group \(3\)/)
})

test('the menu lists every command, and a group\'s all that work there: typing relies on its suggestions', async () => {
  const h = start()
  await h.tap(OWNER, OWNER, 'lang:en', 5)
  const menus = h.calls.filter(c => c.method === 'setMyCommands').map(c => ({ names: (c.payload.commands as { command: string }[]).map(x => x.command), group: !!c.payload.scope }))
  const own = menus.find(m => !m.group)!.names
  const group = menus.find(m => m.group)!.names
  for (const name of ['proxy', 'usage', 'cleanup', 'computer', 'workspace']) assert.ok(own.includes(name), name)
  for (const name of ['proxy', 'usage', 'computer', 'workspace']) assert.ok(group.includes(name), name)
  for (const name of ['users', 'devices', 'pair', 'cleanup']) assert.ok(!group.includes(name), name)
})

test('a topic keeps its name when it moves', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  await h.topicCreated(OWNER, OWNER, 5)
  assert.equal(h.topics.get(`${OWNER}:5`).title, 'New')
  await h.bot.handleUpdate({ update_id: 90_100, message: { message_id: 1, date: 1, chat: { id: OWNER, type: 'private', first_name: 'x' }, from: { id: OWNER, is_bot: false, first_name: 'x' }, is_topic_message: true, message_thread_id: 5, forum_topic_edited: { name: 'TikTok' } } } as never)
  h.topics.bind(`${OWNER}:5`, 'pc', 'game')
  await h.tap(OWNER, OWNER, `wm:${GROUP}`, 5)
  assert.equal(h.calls.find(c => c.method === 'createForumTopic')?.payload.name, 'TikTok')
})

test('Claude only offers to delete topics: what goes is listed, and goes at the tap', async () => {
  const h = start()
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  const key = (n: number) => `${GROUP}:${n}`
  h.topics.set(key(5), { title: 'Test' })
  h.topics.set(key(6), { title: 'Head', workers: [key(7)] })
  h.topics.set(key(7), { title: 'Worker', head: key(6) })
  h.topics.set(`${OWNER}:9`, { title: 'Private one' })

  assert.match(await h.offerDeleteTopics(`${GROUP}:0`, { which: 'this' }), /can't be deleted/)
  assert.match(await h.offerDeleteTopics(key(5), { which: 'named', names: ['nope'] }), /No such topics/)

  h.reset()
  await h.offerDeleteTopics(`${GROUP}:0`, { which: 'all' })
  const offer = textOf(h.said()[0])
  assert.match(offer, /- \[Test\]\(https:\/\/t\.me\/c\/3555000111\/5\)/, 'each a link to its topic')
  assert.match(offer, /- \[Head\]\(https:\/\/t\.me\/c\/3555000111\/6\)/)
  assert.doesNotMatch(offer, /Worker|Private one/, 'an agent goes with its head; another chat is not touched')
  assert.deepEqual(h.calls.filter(c => c.method === 'deleteForumTopic'), [], 'nothing before the tap')
  assert.equal(h.topics.get(key(5)).title, 'Test')

  const data = offer.match(/dlt:yes:[0-9a-f]{8}/)![0]
  await h.tap(GROUP, STRANGER, data)
  assert.equal(h.topics.get(key(5)).title, 'Test', 'a stranger taps in vain')
  await h.tap(GROUP, OWNER, data)
  assert.deepEqual(h.calls.filter(c => c.method === 'deleteForumTopic').map(c => c.payload.message_thread_id).sort(), [5, 6, 7])
  assert.equal(h.topics.get(key(5)).title, undefined)
  assert.equal(h.topics.get(key(7)).title, undefined)
  assert.equal(h.topics.get(`${OWNER}:9`).title, 'Private one')
  assert.match(textOf(h.calls.filter(c => c.method === 'editMessageText').at(-1)!), /Deleted: 2/)

  h.reset()
  await h.tap(GROUP, OWNER, data)
  assert.deepEqual(h.calls.filter(c => c.method === 'deleteForumTopic'), [], 'one tap, one deletion')
})

test('Cancelling an offer to delete leaves everything', async () => {
  const h = start()
  h.topics.set(`${OWNER}:5`, { title: 'Test' })
  await h.offerDeleteTopics(`${OWNER}:5`, { which: 'this' })
  const data = textOf(h.said()[0]).match(/dlt:no:[0-9a-f]{8}/)![0]
  await h.tap(OWNER, OWNER, data, 5)
  assert.equal(h.topics.get(`${OWNER}:5`).title, 'Test')
  assert.deepEqual(h.calls.filter(c => c.method === 'deleteForumTopic'), [])
})

test('a computer gets a new name from the next message, and only a clean, free one', async () => {
  const h = start()
  const { id } = h.registry.register('MacBook-Pro-Scott', 'macos')
  const pc = h.registry.register('PC', 'windows').id
  await h.text(OWNER, OWNER, '/devices', 5)
  assert.match(textOf(h.said()[0]), new RegExp(`dv:${id}`))
  h.reset()
  await h.tap(OWNER, OWNER, `dv:${id}`, 5)
  assert.match(textOf(h.said()[0]), new RegExp(`rn:${id}`))

  h.reset()
  await h.tap(OWNER, OWNER, `rn:${id}`, 5)
  assert.match(textOf(h.said()[0]), /MacBook-Pro-Scott/)

  h.reset()
  await h.text(OWNER, OWNER, '**<b>bad</b>**', 5)
  assert.match(textOf(h.said()[0]), /Up to 40 characters/)
  assert.equal(h.registry.nameOf(id), undefined)
  h.reset()
  await h.text(OWNER, OWNER, 'pc', 5)
  assert.match(textOf(h.said()[0]), /Another computer has this name/)
  assert.equal(h.registry.nameOf(id), undefined)

  h.reset()
  await h.text(OWNER, OWNER, 'Mac Mini', 5)
  assert.match(textOf(h.said()[0]), /Mac Mini/)
  assert.equal(h.registry.nameOf(id), 'Mac Mini')

  // It was the name, not a task; and it is over now
  h.reset()
  await h.tap(OWNER, OWNER, `rn:${pc}`, 5)
  await h.text(OWNER, OWNER, '/status', 5)
  await h.text(OWNER, OWNER, 'Windows box', 5)
  assert.equal(h.registry.nameOf(pc), undefined, 'a command cancels')

  h.reset()
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  await h.tap(GROUP, OWNER, `rn:${id}`, 5)
  assert.deepEqual(h.said(), [], 'not from a group')
})

test('messages waiting in a topic outlive a restart, in order, and only once', async () => {
  const before = start()
  await before.text(OWNER, OWNER, 'first', 5)
  await before.text(OWNER, OWNER, 'second', 5)
  await before.stop()

  const after = start([], before.dir)
  after.restoreQueues()
  after.reset()
  await after.text(OWNER, OWNER, '/stop', 5)
  assert.match(textOf(after.said()[0]), /Queue cleared: <b>2<\/b>/)
  // Read once: a second start finds nothing
  await after.stop()
  const third = start([], before.dir)
  third.restoreQueues()
  third.reset()
  await third.text(OWNER, OWNER, '/stop', 5)
  assert.match(textOf(third.said()[0]), /Nothing is running/)
})

test('/devices is a list with a card for each computer, and unlinking takes two taps', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  const mac = h.registry.register('Mac', 'macos').id
  await h.text(OWNER, OWNER, '/devices', 5)
  const list = textOf(h.said()[0])
  assert.match(list, new RegExp(`dv:${mac}`))
  assert.match(list, /pairnew/)
  assert.doesNotMatch(list, /rv:|rn:|zo:/, 'actions are on the card')

  const lastEdit = () => textOf(h.calls.filter(c => c.method === 'editMessageText').at(-1)!)
  await h.tap(OWNER, OWNER, `dv:${mac}`, 5)
  const card = lastEdit()
  assert.match(card, new RegExp(`rn:${mac}`))
  assert.match(card, new RegExp(`rv:${mac}`))
  assert.doesNotMatch(card, /zo:/, 'no folders while offline')
  assert.match(card, /data="dvs"/)

  await h.tap(OWNER, OWNER, `rv:${mac}`, 5)
  assert.match(lastEdit(), new RegExp(`rvok:${mac}`))
  assert.ok(h.registry.list().some(r => r.id === mac), 'not yet')
  await h.tap(OWNER, OWNER, `dv:${mac}`, 5)
  assert.match(lastEdit(), new RegExp(`rn:${mac}`), 'cancelled, back on the card')
  assert.ok(h.registry.list().some(r => r.id === mac))
  await h.tap(OWNER, OWNER, 'dvs', 5)
  assert.match(lastEdit(), /pairnew/)
})

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const until = async (ok: () => boolean) => {
  for (const end = Date.now() + 3000; !ok() && Date.now() < end;) await sleep(2)
  assert.ok(ok(), 'in time')
}

test('tasks put off for a computer are listed, and start by themselves when it stays online', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const devices = [pc]
  const h = start(devices)
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  devices.length = 0

  assert.match(await h.deferTask(key, 'сверстать экран'), /starts by itself/)
  await h.deferTask(key, 'прогнать тесты')
  assert.deepEqual(h.topics.get(key).deferred, ['сверстать экран', 'прогнать тесты'])
  assert.match(textOf(h.said()[0]), /Waits for pc:\*\* сверстать экран/)
  await h.text(OWNER, OWNER, '/status', 5)
  assert.match(textOf(h.said().at(-1)!), /Put off \| 2/)

  h.reset()
  devices.push(pc)
  h.online(pc)
  assert.deepEqual(h.said(), [], 'not at once: it may only be waking for a moment')
  await until(() => h.said().some(c => /is online/.test(textOf(c))))
  const announced = h.said().find(c => /is online/.test(textOf(c)))!
  assert.match(textOf(announced), /сверстать экран/)
  assert.match(textOf(announced), /data="dfc"/)
  assert.deepEqual(h.topics.get(key).deferred, ['сверстать экран', 'прогнать тесты'], 'not before the moment to call them off')
  await until(() => !h.topics.get(key).deferred)
  await h.idle()
  // No slots in this test: it reached the queue, and goes no further than Claude
  await h.text(OWNER, OWNER, '/stop', 5)
  assert.match(textOf(h.said().at(-1)!), /Queue cleared: <b>1<\/b>/)
})

test('a computer that only wakes for a moment starts nothing', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const devices = [pc]
  const h = start(devices)
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  h.topics.set(key, { deferred: ['задача'] })
  h.reset()
  h.online(pc)
  devices.length = 0
  await sleep(150)
  await h.idle()
  assert.deepEqual(h.said(), [])
  assert.deepEqual(h.topics.get(key).deferred, ['задача'], 'and keeps them for next time')
})

test('tasks put off can be called off: by the button, or by /stop', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  h.topics.set(key, { deferred: ['задача'] })
  h.reset()
  h.online(pc)
  await until(() => h.said().some(c => /is online/.test(textOf(c))))
  await h.tap(OWNER, OWNER, 'dfc', 5)
  assert.equal(h.topics.get(key).deferred, undefined)
  await sleep(150)
  await h.idle()
  h.reset()
  await h.text(OWNER, OWNER, '/stop', 5)
  assert.match(textOf(h.said()[0]), /Nothing is running/, 'nothing reached the queue')

  h.topics.set(key, { deferred: ['а', 'б'] })
  h.reset()
  await h.text(OWNER, OWNER, '/stop', 5)
  assert.match(textOf(h.said()[0]), /Queue cleared: <b>2<\/b>/)
  assert.equal(h.topics.get(key).deferred, undefined)
})

test('the list is limited, and a stranger has no say over it', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([])
  const key = `${GROUP}:5`
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  h.topics.bind(key, 'pc', 'game')
  for (let i = 0; i < 20; i++) await h.deferTask(key, `задача ${i}`)
  assert.match(await h.deferTask(key, 'лишняя'), /already put off/)
  assert.equal(h.topics.get(key).deferred?.length, 20)
  await h.tap(GROUP, STRANGER, 'dfc', 5)
  assert.equal(h.topics.get(key).deferred?.length, 20)
  assert.ok(pc)
})

test('a topic made by /topic without a name gets one from its first task; a named one keeps it', async () => {
  const h = start()
  await h.text(OWNER, OWNER, '/topic')
  const [unnamed] = h.topics.entries().filter(([k]) => k.startsWith(`${OWNER}:`))
  assert.equal(unnamed[1].nameImplicit, true)
  assert.equal(unnamed[1].title, 'New chat')

  const named = start()
  await named.text(OWNER, OWNER, '/topic TikTok')
  const [kept] = named.topics.entries().filter(([k]) => k.startsWith(`${OWNER}:`))
  assert.equal(kept[1].nameImplicit, false)
  assert.equal(kept[1].title, 'TikTok')
})

test('opening Chrome goes to the computer by its id in the bot, not the browser\'s id', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  assert.match(await h.openChrome('pc'), /Chrome has started/)
  // What a real connection would answer for an id the gateway doesn't know
  await assert.rejects(h.openChrome('ee89483c-ef69-4114-a2'))
})

test('a message deleted before its turn gets no answer and starts nothing', async () => {
  const pc = computer('pc', 'PC', ['game'])
  // With a free slot: only the deletion keeps this from reaching Claude
  const h = start([pc], undefined, 1)
  h.topics.bind(`${OWNER}:5`, 'pc', 'game')
  h.reset()
  // The harness numbers messages by update: the next one is known
  for (let id = 1; id < 200; id++) h.deleted.add(id)
  await h.text(OWNER, OWNER, 'удали этот проект', 5)
  await sleep(1700)
  await h.idle()
  assert.deepEqual(h.said().filter(c => c.method !== 'setMessageReaction'), [], 'not a word')
  assert.ok(!h.topics.get(`${OWNER}:5`).sessionId)
  await h.text(OWNER, OWNER, '/status', 5)
  assert.doesNotMatch(textOf(h.said().at(-1)!), /working/, 'and the topic is free again')
})

const replyOf = (c: Call | undefined) => c?.payload.reply_parameters as { message_id: number, allow_sending_without_reply?: boolean } | undefined

test('a notice that a message waits answers that message', async () => {
  const pc = computer('pc', 'PC', ['game'])
  // No free slot: the server's limit
  const full = start([pc])
  full.topics.bind(`${OWNER}:5`, 'pc', 'game')
  full.reset()
  await full.text(OWNER, OWNER, 'сделай это', 5, { message_id: 4242 })
  await sleep(1700)
  await full.idle()
  const limit = replyOf(full.said().find(c => /предел сервера|server's limit/.test(textOf(c))))
  assert.deepEqual(limit, { message_id: 4242, allow_sending_without_reply: true })

  // The server is updating
  const h = start([pc], undefined, 1)
  h.topics.bind(`${OWNER}:5`, 'pc', 'game')
  Object.assign(h.updates, { current: '0.0.1', helper: () => true, noteMessage() {}, clearResult() {}, request() {}, result: () => null })
  await h.tap(OWNER, OWNER, 'upd:go:9.9.9', 5)
  await sleep(50)
  h.reset()
  await h.text(OWNER, OWNER, 'как тебе?', 5, { message_id: 4343 })
  await sleep(1700)
  await h.idle()
  const updating = h.said().find(c => /9\.9\.9/.test(textOf(c)))
  assert.deepEqual(replyOf(updating), { message_id: 4343, allow_sending_without_reply: true })
})

test('a notice about a message from another topic answers the bot\'s own showing of it', async () => {
  const h = start([computer('pc', 'PC', ['game'])])
  h.topics.set(`${OWNER}:5`, { title: 'tg-claude' })
  h.topics.bind(`${OWNER}:6`, 'pc', 'game')
  h.topics.set(`${OWNER}:6`, { title: 'mywallet-motions' })
  assert.match(await h.messageTopic(`${OWNER}:5`, { topic: 'mywallet-motions', text: 'подключи' }), /^Delivered/)
  const shownId = 500 + h.calls.length
  await sleep(1700)
  await h.idle()
  const notice = h.said().find(c => /предел сервера|server's limit/.test(textOf(c)))
  assert.deepEqual(replyOf(notice), { message_id: shownId, allow_sending_without_reply: true })
})

test('the wait of an update can be called off, and the queue goes on', async () => {
  const h = start([computer('pc', 'PC', ['game'])])
  let asked = ''
  Object.assign(h.updates, { current: '0.0.1', helper: () => true, noteMessage() {}, clearResult() {}, request: (tag: string) => { asked = tag }, result: () => null })
  h.liveOf(`${OWNER}:5`).preparing = 1
  await h.tap(OWNER, OWNER, 'upd:go:9.9.9', 5)
  await sleep(50)
  const card = h.said().find(c => /Жду|Waiting for/.test(textOf(c)))!
  assert.match(textOf(card), /### ⏳/, 'a card in rich text, with a heading')
  assert.equal(card.method, 'sendRichMessage')
  assert.match(textOf(card), /updw:cancel/)
  assert.doesNotMatch(textOf(card), /updw:ask/, 'nothing to hurry: it goes by itself within 3 minutes')

  h.reset()
  await h.tap(OWNER, OWNER, 'updw:ask', 5)
  assert.match(JSON.stringify(h.calls.at(-1)!.payload), /no longer waiting/, 'a button from a card of an older version does nothing')
  await h.tap(OWNER, OWNER, 'updw:cancel', 5)
  await sleep(1200)
  assert.equal(asked, '', 'the helper was never asked')
  const end = h.said().find(c => /cancelled|отменено/.test(textOf(c)))!
  assert.match(textOf(end), /upd:go:9\.9\.9/, 'it can be tried again')
  h.liveOf(`${OWNER}:5`).preparing = 0

  h.reset()
  await h.tap(OWNER, OWNER, 'updw:cancel', 5)
  assert.match(JSON.stringify(h.calls.at(-1)!.payload), /no longer waiting|уже не ждёт/, 'a late tap only says so')
})

test('an agent writing to its own head is told to put it in the report', async () => {
  const h = start()
  const key = (n: number) => `${OWNER}:${n}`
  h.topics.set(key(5), { title: 'Head' })
  h.topics.set(key(6), { title: 'Worker', head: key(5) })
  h.topics.set(key(7), { title: 'Other', head: key(5) })
  h.reset()
  assert.match(await h.messageTopic(key(6), { topic: 'Head', text: 'итог' }), /^Not delivered: that topic is your head/)
  assert.deepEqual(h.said(), [], 'nothing shown')
  assert.match(await h.messageTopic(key(6), { topic: 'Other', text: 'привет' }), /^Delivered/)
})

test('topics of one chat write to each other: shown there, queued there, and only there', async () => {
  const h = start()
  const key = (n: number) => `${OWNER}:${n}`
  h.topics.set(key(5), { title: 'tg-claude' })
  h.topics.set(key(6), { title: 'mywallet-motions' })
  h.topics.set(`${GROUP}:7`, { title: 'Другой чат' })

  assert.match(await h.messageTopic(key(5), { topic: 'MyWallet-Motions', text: 'подключи XcodeBuildMCP' }), /^Delivered/)
  const shown = h.said().at(-1)!
  assert.equal(shown.payload.message_thread_id, 6)
  assert.match(textOf(shown), /From the topic <a href="https:\/\/t\.me\/example_bot\/5">tg-claude<\/a>/, 'the name is the way back to that topic')
  assert.match(textOf(shown), /подключи XcodeBuildMCP/)
  await h.text(OWNER, OWNER, '/stop', 6)
  assert.match(textOf(h.said().at(-1)!), /Queue cleared: <b>1<\/b>/, 'it reached that topic')

  assert.match(await h.messageTopic(key(5), { topic: 'Другой чат', text: 'x' }), /no topic «Другой чат».*Topics here: mywallet-motions/, 'not across chats')
  assert.match(await h.messageTopic(key(5), { topic: 'tg-claude', text: 'x' }), /no topic/, 'not to itself')
  assert.equal(h.calls.some(c => c.payload.chat_id === GROUP), false)
})

test('a topic whose name the bot doesn\'t know is still found: by its number or its project', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  const key = (n: number) => `${OWNER}:${n}`
  h.topics.set(key(5), { title: 'tg-claude' })
  h.topics.bind(key(6), 'pc', 'game')
  assert.match(await h.messageTopic(key(5), { topic: '#6', text: 'x' }), /^Delivered to «game»/, 'listed by number while its computer was away')
  assert.match(await h.messageTopic(key(5), { topic: 'game', text: 'x' }), /^Delivered/)
  h.topics.set(key(6), { title: 'игра' })
  assert.match(await h.messageTopic(key(5), { topic: 'game', text: 'x' }), /^Delivered to «игра»/, 'and by the project once it has a name')
})

test('an agent\'s topic goes by the agent\'s name, not by the project it shares with another topic', async () => {
  const h = start([computer('pc', 'PC', ['game'])])
  const key = (n: number) => `${OWNER}:${n}`
  h.topics.set(key(5), { title: 'tg-claude' })
  h.topics.bind(key(6), 'pc', 'game')
  h.topics.bind(key(7), 'pc', 'game')
  h.topics.set(key(7), { workerName: 'Xcode' })
  assert.match(await h.messageTopic(key(5), { topic: 'game', text: 'x' }), /^Delivered to «game»/, 'by project: the one that goes by it')
  assert.match(await h.messageTopic(key(5), { topic: 'Xcode', text: 'x' }), /^Delivered to «Xcode»/)
})

test('a computer\'s card says which version it is on', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  const { id } = h.registry.register('PC', 'windows')
  Object.assign(pc, { id, release: '1.2.3' })
  await h.tap(OWNER, OWNER, `dv:${id}`, 5)
  assert.match(JSON.stringify(h.said().at(-1)!.payload), /v1\.2\.3/)
})

test('naming a topic what it is already called teaches the bot the name; a real refusal does not', async () => {
  const h = start()
  let description = 'Bad Request: TOPIC_NOT_MODIFIED'
  h.bot.api.config.use(async (prev, method, payload) => (method === 'editForumTopic' ? { ok: false, error_code: 400, description } as never : prev(method, payload)))
  assert.equal(await h.renameTopic(OWNER, 5, 'tg-claude'), 'Renamed.')
  assert.equal(h.topics.get(`${OWNER}:5`).title, 'tg-claude')
  description = 'Bad Request: not enough rights'
  assert.match(await h.renameTopic(OWNER, 5, 'другое'), /^Telegram refused/)
  assert.equal(h.topics.get(`${OWNER}:5`).title, 'tg-claude')
})

test('topics can not go on writing to each other for ever: the user\'s word opens it again', async () => {
  const h = start()
  const key = (n: number) => `${OWNER}:${n}`
  h.topics.set(key(5), { title: 'a' })
  h.topics.set(key(6), { title: 'b' })
  for (let i = 0; i < 10; i++) assert.match(await h.messageTopic(key(i % 2 ? 6 : 5), { topic: i % 2 ? 'a' : 'b', text: `${i}` }), /^Delivered/)
  h.reset()
  assert.match(await h.messageTopic(key(5), { topic: 'b', text: 'ещё' }), /Not delivered: .*too many/)
  assert.match(textOf(h.said()[0]), /10 messages in a row/)
  assert.match(await h.messageTopic(key(5), { topic: 'b', text: 'ещё' }), /Not delivered/)
  assert.equal(h.said().length, 1, 'said once')
  await h.text(OWNER, OWNER, '/status', 5)
  assert.match(await h.messageTopic(key(5), { topic: 'b', text: 'теперь можно' }), /^Delivered/)
})

test('a message to a topic that is gone or not unique is not delivered, and says so', async () => {
  const h = start()
  const key = (n: number) => `${OWNER}:${n}`
  h.topics.set(key(5), { title: 'a' })
  h.topics.set(key(6), { title: 'b' })
  h.topics.set(key(7), { title: 'b' })
  assert.match(await h.messageTopic(key(5), { topic: 'b', text: 'x' }), /several topics/)
})

test('the picker keeps a repository behind one button, and its branches can still be chosen', async () => {
  const pc = computer('pc', 'PC', ['repo', 'repo-x', 'plain'])
  const h = start([pc])
  pc.workspace.list = (() => [
    { id: 'repo-x', name: 'repo-x', path: 'x', extraRoots: [], worktreeOf: 'repo', branch: 'feature/x' },
    { id: 'repo', name: 'repo', path: 'r', extraRoots: [] },
    { id: 'plain', name: 'plain', path: 'p', extraRoots: [] },
  ]) as never
  await h.text(OWNER, OWNER, '/project', 5)
  const list = JSON.stringify(h.said()[0].payload.reply_markup)
  assert.match(list, /repo · 2 branches/)
  assert.match(list, /pg:pc:repo/)
  assert.match(list, /b:pc:plain/)
  assert.doesNotMatch(list, /b:pc:repo-x/)

  h.reset()
  await h.tap(OWNER, OWNER, 'pg:pc:repo', 5)
  const branches = JSON.stringify(h.calls.find(c => c.method === 'editMessageReplyMarkup')!.payload.reply_markup)
  assert.match(branches, /b:pc:repo"/)
  assert.match(branches, /repo-x · feature\/x/)
  assert.match(branches, /b:pc:repo-x/)
  assert.match(branches, /pp:pc:0/)

  await h.tap(OWNER, OWNER, 'b:pc:repo-x', 5)
  assert.equal(h.topics.get(`${OWNER}:5`).projectId, 'repo-x', 'still a project of its own')
})

test('a folder of worktrees is not offered, and a long list of branches goes in pages', async () => {
  const pc = computer('pc', 'PC', ['repo'])
  const h = start([pc])
  const branches = Array.from({ length: 11 }, (_, i) => ({ id: `w${i}`, name: `w${i}`, path: `w${i}`, extraRoots: [], worktreeOf: 'repo' }))
  pc.workspace.list = (() => [
    { id: 'repo', name: 'repo', path: 'r', extraRoots: [] },
    { id: 'repo-wt', name: 'repo-wt', path: 'f', extraRoots: [], hidden: true },
    ...branches,
  ]) as never
  await h.text(OWNER, OWNER, '/project', 5)
  const list = JSON.stringify(h.said()[0].payload.reply_markup)
  assert.match(list, /repo · 12 branches/)
  assert.doesNotMatch(list, /repo-wt/)

  const shown = async (data: string) => {
    h.reset()
    await h.tap(OWNER, OWNER, data, 5)
    return JSON.stringify(h.calls.find(c => c.method === 'editMessageReplyMarkup')!.payload.reply_markup)
  }
  const first = await shown('pg:pc:repo')
  assert.match(first, /b:pc:repo"/)
  assert.match(first, /b:pc:w6"/)
  assert.doesNotMatch(first, /b:pc:w7"/)
  assert.match(first, /pg:pc:repo:1"/)
  assert.match(first, /pp:pc:0"/)
  const second = await shown('pg:pc:repo:1')
  assert.match(second, /b:pc:w7"/)
  assert.match(second, /b:pc:w10"/)
  assert.doesNotMatch(second, /b:pc:repo"/)
  assert.match(second, /pg:pc:repo:0"/)
})

test('an agent\'s branch is made in the repository\'s worktrees folder, and removed from there', async () => {
  const { execFileSync } = await import('node:child_process')
  const pc = computer('pc', 'PC', ['repo'])
  const h = start([pc])
  const repoPath = join(pc.zone, 'repo')
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repoPath, stdio: 'ignore' })
  git('init', '-q')
  git('commit', '-q', '--allow-empty', '-m', 'init')
  const repo = pc.workspace.list().find(p => p.name === 'repo')!
  const made = await h.makeWorktree('pc', repo, 'balance')
  assert.ok(typeof made !== 'string', String(made))
  assert.equal(made.project.name, 'balance')
  assert.equal(made.project.worktreeOf, repo.id)
  assert.equal(made.project.branch, 'agent/balance')
  assert.ok(existsSync(join(pc.zone, 'repo-wt', 'balance', '.git')))
  assert.equal(pc.workspace.list().find(p => p.name === 'repo-wt')!.hidden, true)

  h.topics.bind(`${OWNER}:5`, 'pc', made.project.id)
  h.topics.set(`${OWNER}:5`, { worktree: made.worktree })
  assert.equal(await h.dropWorktree(h.topics.get(`${OWNER}:5`)), null)
  assert.ok(!existsSync(join(pc.zone, 'repo-wt', 'balance')))
})

test('a group that becomes a workspace gets a picture, unless it has one; a refusal stops nothing', async () => {
  const photos = (h: ReturnType<typeof start>) => h.calls.filter(c => c.method === 'setChatPhoto')
  const plain = start()
  await plain.membership(GROUP, OWNER, 'administrator')
  assert.equal(photos(plain).length, 1)
  assert.equal(photos(plain)[0].payload.chat_id, GROUP)
  assert.ok(existsSync(GROUP_AVATAR_FILE))
  plain.reset()
  await plain.membership(GROUP, OWNER, 'administrator')
  assert.equal(photos(plain).length, 0, 'once')

  const pictured = start()
  pictured.bot.api.config.use(async (prev, method, payload) => (method === 'getChat'
    ? { ok: true, result: { id: GROUP, type: 'supergroup', title: 'Roblox', is_forum: true, photo: { small_file_id: 'a', small_file_unique_id: 'b', big_file_id: 'c', big_file_unique_id: 'd' } } } as never
    : prev(method, payload)))
  await pictured.membership(GROUP, OWNER, 'administrator')
  assert.equal(photos(pictured).length, 0, 'the group keeps its own')
  assert.ok(pictured.workspaces.get(GROUP))

  const refused = start()
  refused.bot.api.config.use(async (prev, method, payload) => (method === 'setChatPhoto'
    ? { ok: false, error_code: 400, description: 'Bad Request: not enough rights to change chat photo' } as never
    : prev(method, payload)))
  await refused.membership(GROUP, OWNER, 'administrator')
  assert.ok(refused.workspaces.get(GROUP), 'still a workspace')
  assert.ok(refused.said().some(c => /Project|Проект/.test(textOf(c))), 'and its card is there')
})

test('connecting an MCP server always takes the user\'s yes, and the card hides what its variables hold', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  const tool = 'mcp__device__add_mcp_server'
  const input = { name: 'xcode', command: 'npx', args: ['-y', 'xcodebuildmcp@2.7.0', 'mcp'], env: { API_KEY: 'supersecretvalue' } }

  h.topics.set(key, { mode: 'all' })
  h.reset()
  const asked = h.permissionFor(key, tool, input)
  await sleep(50)
  const card = h.said().find(c => JSON.stringify(c.payload).includes('xcodebuildmcp'))!
  const shown = JSON.stringify(card.payload)
  assert.match(shown, /xcodebuildmcp@2\.7\.0/, 'the exact command')
  assert.match(shown, /API_KEY/)
  assert.doesNotMatch(shown, /supersecretvalue/)
  assert.doesNotMatch(shown, /all:|forever:/, 'one yes at a time, even in the mode that never asks')
  const id = shown.match(/ok:(\d+)/)![1]
  await h.tap(OWNER, OWNER, `ok:${id}`, 5)
  assert.equal((await asked)!.behavior, 'allow')

  const denied = async (i: Record<string, unknown>) => {
    h.reset()
    const r = await h.permissionFor(key, tool, i)
    assert.equal(r!.behavior, 'deny')
    assert.deepEqual(h.said().filter(c => /ok:/.test(JSON.stringify(c.payload))), [], 'nothing to tap')
    return (r as { message: string }).message
  }
  assert.match(await denied({ ...input, args: ['-y', 'xcodebuildmcp@latest', 'mcp'] }), /exact version/)
  h.topics.set(key, { mode: 'read' })
  assert.match(await denied(input), /Read only/)
})

test('where files change without a question, a write into .git still asks: a hook there runs with nothing on a card', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  h.topics.set(key, { mode: 'edits' })
  const tool = 'mcp__device__write_file'
  for (const path of ['.git/hooks/pre-commit', 'sub/.git/config', '.GIT\\hooks\\post-merge', 'C:/work/game/.git/hooks/x', '.git./hooks/x', '.git::$INDEX_ALLOCATION/hooks/x', '.husky/pre-commit', '.githooks/pre-push']) {
    const asked = await Promise.race([h.permissionFor(key, tool, { path, content: 'x' }), sleep(30).then(() => 'asked')])
    assert.equal(asked, 'asked', path)
  }
  for (const path of ['.gitignore', '.gitattributes', '.github/workflows/ci.yml', 'src/git/a.ts', 'my.git/a.ts']) {
    assert.equal((await h.permissionFor(key, tool, { path, content: 'x' }))!.behavior, 'allow', path)
  }
  // The other modes as they were: one that never asks doesn't start to
  h.topics.set(key, { mode: 'all' })
  assert.equal((await h.permissionFor(key, tool, { path: '.git/hooks/pre-commit', content: 'x' }))!.behavior, 'allow')
})

test('a survey shows no secret, on its first card or on an edit, and neither does a topic\'s new name', async () => {
  const h = start()
  const key = `${OWNER}:5`
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
  await h.startSurvey(key, { title: 'Check', questions: [{ question: 'First?', options: [{ label: 'Yes' }] }, { question: `Is ${secret} right?`, options: [{ label: secret }, { label: 'No' }] }] } as never)
  await h.idle()
  await h.tap(OWNER, OWNER, `sv:${h.surveys.get(key)!.id}:0`, 5)
  assert.ok(h.said().some(c => c.method === 'editMessageText'), 'the second question is an edit')
  assert.doesNotMatch(JSON.stringify(h.said()), /abcdefghijklmnop/)
  assert.equal(await h.renameTopic(OWNER, 5, 'mail someone.real@example.com'), 'Renamed.')
  assert.doesNotMatch(JSON.stringify(h.said().filter(c => c.method === 'editForumTopic')), /someone\.real/)
  assert.doesNotMatch(String(h.topics.get(key).title), /someone\.real/)
})

test('/usage stays out of a group others read', async () => {
  const h = start()
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  h.setMembers(3)
  await h.text(GROUP, OWNER, '/usage', 5)
  assert.match(textOf(h.said().at(-1)!), /private chat/)
  assert.doesNotMatch(JSON.stringify(h.said()), /Checking the limits/)
})

test('a refusal says whose read-only mode it is: this topic\'s, or the one that wrote here', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  const key = (n: number) => `${OWNER}:${n}`
  h.topics.bind(key(6), 'pc', 'game')
  h.topics.set(key(5), { title: 'sender', mode: 'read' })
  h.topics.set(key(6), { title: 'target' })
  const write = { path: 'a.txt', content: 'x' }

  h.topics.set(key(6), { mode: 'read' })
  const own = await h.permissionFor(key(6), 'mcp__device__write_file', write)
  assert.match((own as { message: string }).message, /switch the mode with \/mode/)

  h.topics.set(key(6), { mode: 'all' })
  await h.messageTopic(key(5), { topic: 'target', text: 'создай файл' })
  await h.capTurn(key(6))
  const capped = await h.permissionFor(key(6), 'mcp__device__write_file', write)
  assert.equal(capped!.behavior, 'deny')
  assert.match((capped as { message: string }).message, /another topic.*\/mode here would not help/s)
})

const surveyInput = () => ({
  title: 'Игра',
  questions: [
    { question: 'Жанр?', options: [{ label: 'Ферма' }, { label: 'Магазин' }], recommended: [1] },
    { question: 'Что в первой версии?', options: [{ label: 'Лавка' }, { label: 'Питомцы' }], multiple: true },
    { question: 'Что ещё?', options: [] },
  ],
})
const cardOf = (c: Call) => JSON.stringify(c.payload)

test('a survey: one message walked through, a typed answer counts, and the answers reach Claude at the end', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  h.reset()
  assert.match(await h.startSurvey(key, surveyInput()), /End your turn/)
  const first = h.said().find(c => /sv:/.test(cardOf(c)))!
  assert.match(cardOf(first), /Игра · 1\/3/)
  assert.match(cardOf(first), /⭐ Магазин/)
  assert.doesNotMatch(cardOf(first), /style/, 'nothing blue on a one-tap question')
  const id = h.surveys.get(key)!.id
  assert.match(await h.startSurvey(key, surveyInput()), /Not started/, 'one at a time')

  // A tap moves on in the same message
  h.reset()
  await h.tap(OWNER, OWNER, `sv:${id}:1`, 5)
  assert.equal(h.surveys.get(key)!.index, 1)
  const edited = h.calls.find(c => c.method === 'editMessageText')!
  assert.match(cardOf(edited), /2\/3/)
  assert.ok(!h.calls.some(c => c.method === 'sendRichMessage'), 'no new message')

  // Nothing else starts meanwhile, and nothing says it is queued
  await h.messageTopic(`${OWNER}:6`, { topic: `#5`, text: 'x' }).catch(() => {})
  await sleep(1700)
  assert.ok(!h.said().some(c => /server's limit/.test(textOf(c))), 'the topic holds still')

  await h.tap(OWNER, OWNER, `sv:${id}:0`, 5)
  await h.tap(OWNER, OWNER, `sv:${id}:done`, 5)
  assert.deepEqual(h.surveys.get(key)!.answers[1], { chosen: [0] })

  // A message answers, and the card comes back below it
  h.reset()
  await h.text(OWNER, OWNER, 'дракон', 5)
  await sleep(50)
  await h.idle()
  assert.equal(h.surveys.get(key), undefined, 'that was the last one')
  await h.text(OWNER, OWNER, '/stop', 5)
  assert.match(textOf(h.said().at(-1)!), /Queue cleared/, 'the answers wait for Claude as a message')

  // An old card is just old
  h.reset()
  await h.tap(OWNER, OWNER, `sv:${id}:0`, 5)
  assert.ok(h.calls.some(c => c.method === 'answerCallbackQuery' && /No longer relevant/.test(cardOf(c))))
})

test('a typed answer brings the next question below it; the old card goes', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  await h.startSurvey(key, surveyInput())
  h.reset()
  await h.text(OWNER, OWNER, 'своё', 5)
  await sleep(50)
  await h.idle()
  assert.deepEqual(h.surveys.get(key)!.answers[0], { chosen: [], text: 'своё' })
  assert.ok(h.calls.some(c => c.method === 'deleteMessage'))
  assert.match(cardOf(h.calls.find(c => /sv:/.test(cardOf(c)) && c.method === 'sendRichMessage')!), /2\/3/)
})

test('/stop ends a survey and keeps what was answered; /new drops it; a restart keeps it', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  await h.startSurvey(key, surveyInput())
  const { id } = h.surveys.get(key)!
  await h.tap(OWNER, OWNER, `sv:${id}:0`, 5)

  const again = harness([pc], h.dir)
  open.push(again)
  assert.equal(again.surveys.get(key)!.index, 1, 'the same place after a restart')
  await again.tap(OWNER, OWNER, `sv:${id}:1`, 5)
  assert.deepEqual(again.surveys.get(key)!.selected, [1], 'and its buttons work')

  again.reset()
  await again.text(OWNER, OWNER, '/stop', 5)
  await again.idle()
  assert.equal(again.surveys.get(key), undefined)
  assert.ok(again.said().some(c => /finished early/.test(textOf(c))))
  await again.text(OWNER, OWNER, '/stop', 5)
  assert.match(textOf(again.said().at(-1)!), /Queue cleared/, 'what was answered waits for Claude')

  await again.startSurvey(key, surveyInput())
  await again.text(OWNER, OWNER, '/new', 5)
  assert.equal(again.surveys.get(key), undefined, 'a new conversation never asked')
  await again.text(OWNER, OWNER, '/stop', 5)
  assert.match(textOf(again.said().at(-1)!), /Nothing is running/)
})

test('a picture comes with its question from the computer, and is gone from the next one', async () => {
  const pc = computer('pc', 'PC', ['game'])
  writeFileSync(join(pc.zone, 'game', 'map.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
  const h = start([pc])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  h.reset()
  await h.startSurvey(key, {
    questions: [
      { question: 'Какая карта?', options: [{ label: 'Эта' }, { label: 'Другая' }], image: 'map.png' },
      { question: 'Сколько уровней?', options: [{ label: 'Пять' }, { label: 'Десять' }] },
    ],
  })
  const sent = h.calls.find(c => c.method === 'sendRichMessage')!
  const rich = sent.payload.rich_message as { markdown: string, media?: unknown[] }
  assert.equal(rich.media?.length, 1, 'the file itself went along')
  assert.match(rich.markdown, /sv:/, 'with the buttons')

  const { id } = h.surveys.get(key)!
  h.reset()
  await h.tap(OWNER, OWNER, `sv:${id}:0`, 5)
  const next = h.calls.find(c => /sv:/.test(cardOf(c)))!
  assert.match(cardOf(next), /2\/2/)
  assert.doesNotMatch(cardOf(next), /"media"/)
})

test('ticking a box keeps the picture of the question', async () => {
  const pc = computer('pc', 'PC', ['game'])
  writeFileSync(join(pc.zone, 'game', 'map.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
  const h = start([pc])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  await h.startSurvey(key, { questions: [{ question: 'Какие карты?', options: [{ label: 'Эта' }, { label: 'Другая' }], multiple: true, image: 'map.png' }] })

  const { id } = h.surveys.get(key)!
  h.reset()
  await h.tap(OWNER, OWNER, `sv:${id}:0`, 5)
  const edit = h.calls.find(c => c.method === 'editMessageText')!
  const rich = edit.payload.rich_message as { markdown: string, media: { media: { media: string } }[] }
  assert.match(rich.markdown, /^!\[\]\(tg:\/\/photo\?id=m1 /, 'the picture stays in the text')
  assert.equal(rich.media[0].media.media, 'kept0', 'the file Telegram already keeps')
  assert.ok(!h.calls.some(c => c.method === 'sendRichMessage' || c.method === 'deleteMessage'), 'the same message')
})

test('a survey that ended is what comes next answers: the notice about it points at its card', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  await h.startSurvey(key, { questions: [{ question: 'Да?', options: [{ label: 'Да' }] }] })
  const { id, messageId } = h.surveys.get(key)!
  h.reset()
  await h.tap(OWNER, OWNER, `sv:${id}:0`, 5)
  await sleep(1700)
  await h.idle()
  const notice = h.said().find(c => /server's limit/.test(textOf(c)))
  assert.deepEqual(replyOf(notice), { message_id: messageId, allow_sending_without_reply: true })
})

test('a stranger can\'t answer a survey', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  const key = `${GROUP}:5`
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  h.topics.bind(key, 'pc', 'game')
  await h.startSurvey(key, surveyInput())
  const { id } = h.surveys.get(key)!
  await h.tap(GROUP, STRANGER, `sv:${id}:0`, 5)
  assert.equal(h.surveys.get(key)!.index, 0)
})

test('the private chat still gets its picker and its commands', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  await h.text(OWNER, OWNER, 'hello', 5)
  await new Promise(r => setTimeout(r, 1700))
  assert.match(JSON.stringify(h.said().map(c => c.payload.reply_markup)), /b:pc:game/, 'the message waits for a project')
  h.reset()
  await h.text(OWNER, OWNER, '/help', 5)
  const help = textOf(h.said()[0])
  assert.match(help, /\/users/)
  assert.match(help, /\/workspace/)
})

const GENERAL_KEY = `${GROUP}:5`
const inWorkspace = () => {
  const h = start()
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  return h
}
const lastText = (h: ReturnType<typeof start>) => textOf(h.said().at(-1)!)
const buttonsOf = (c: Call) => ((c.payload.reply_markup as { inline_keyboard?: { callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat().map(b => b.callback_data)

test('/decisions in a private chat says what it is for, and the tool and the prompt stay away', async () => {
  const h = start()
  await h.text(OWNER, OWNER, '/decisions')
  assert.match(lastText(h), /shared by all topics of a workspace/)
  assert.deepEqual(h.decisions.servers(OWNER, undefined), {})
  assert.equal(h.decisions.promptBlock(OWNER), '')
  assert.match(await h.decisions.record(OWNER, undefined, 'x'), /not in a workspace/)
})

test('a workspace gets the tool and the block, a decision shows in its topic, masked, and reaches the other topics', async () => {
  const h = inWorkspace()
  assert.ok('workspace_memory' in h.decisions.servers(GROUP, 5))
  h.liveOf(GENERAL_KEY).ownerSpoke = true
  h.reset()
  assert.match(await h.decisions.record(GROUP, 5, 'Launch on Friday, ask someone@example.com'), /Recorded/)
  const note = h.said().at(-1)!
  assert.equal(note.payload.message_thread_id, 5)
  assert.match(textOf(note), /Decision recorded/)
  assert.doesNotMatch(textOf(note), /someone@example\.com/)
  assert.match(h.decisions.promptBlock(GROUP), /Launch on Friday/)
  assert.match(await h.decisions.record(GROUP, 5, 'Launch on Friday, ask someone@example.com'), /Already recorded/)
})

test('a turn without the owner\'s words records nothing: another topic\'s letter does not become a decision', async () => {
  const h = inWorkspace()
  h.reset()
  assert.match(await h.decisions.record(GROUP, 5, 'Planted by a page'), /Not recorded/)
  assert.equal(h.said().length, 0)
  assert.doesNotMatch(h.decisions.promptBlock(GROUP), /Planted/)
})

test('recording needs no card in any mode, and only through the bot\'s own server', async () => {
  const h = inWorkspace()
  h.topics.set(GENERAL_KEY, { mode: 'read' })
  const tool = 'mcp__workspace_memory__record_decision'
  h.reset()
  assert.equal((await h.permissionFor(GENERAL_KEY, tool, { text: 'x' }, undefined, 'workspace_memory'))!.behavior, 'allow')
  assert.deepEqual(h.said(), [])
  assert.equal((await h.permissionFor(GENERAL_KEY, tool, { text: 'x' }, undefined, 'something_else'))!.behavior, 'deny')
})

test('/decisions lists, pages and removes with a confirming tap; a stranger gets nothing', async () => {
  const h = inWorkspace()
  h.liveOf(GENERAL_KEY).ownerSpoke = true
  for (let i = 1; i <= 8; i++) await h.decisions.record(GROUP, 5, `Decision ${i}`)
  h.reset()
  await h.text(GROUP, STRANGER, '/decisions', 5)
  await h.tap(GROUP, STRANGER, 'dec:pg:1', 5)
  assert.deepEqual(h.said(), [])

  await h.text(GROUP, OWNER, '/decisions', 5)
  const list = h.said().at(-1)!
  assert.match(textOf(list), /Decision 8/)
  assert.doesNotMatch(textOf(list), /Decision 1\b/)
  const ask = buttonsOf(list)[0]!
  assert.match(ask, /^dec:ask:[0-9a-f]+:0$/)
  assert.ok(buttonsOf(list).includes('dec:pg:1'))

  h.reset()
  await h.tap(GROUP, STRANGER, ask.replace('ask', 'rm'), 5)
  assert.match(h.decisions.promptBlock(GROUP), /Decision 8/)
  assert.deepEqual(h.said(), [])

  await h.tap(GROUP, OWNER, ask, 5)
  assert.match(JSON.stringify(h.said().at(-1)!.payload), /Remove this decision\?.*Decision 8/)
  assert.match(h.decisions.promptBlock(GROUP), /Decision 8/)
  await h.tap(GROUP, OWNER, ask.replace('ask', 'rm'), 5)
  assert.doesNotMatch(h.decisions.promptBlock(GROUP), /Decision 8/)
  await h.tap(GROUP, OWNER, 'dec:pg:1', 5)
  assert.match(JSON.stringify(h.said().at(-1)!.payload), /Decision 1\b/)
})

test('a group that leaves and comes back finds its decisions', async () => {
  const h = inWorkspace()
  h.liveOf(GENERAL_KEY).ownerSpoke = true
  await h.decisions.record(GROUP, 5, 'Kept')
  await h.membership(GROUP, OWNER, 'left')
  assert.equal(h.workspaces.get(GROUP), undefined)
  assert.equal(h.decisions.promptBlock(GROUP), '')
  await h.membership(GROUP, OWNER, 'administrator')
  assert.ok(h.workspaces.get(GROUP))
  assert.match(h.decisions.promptBlock(GROUP), /Kept/)
})

test('night mode refuses a push in every permission mode, in all topics of the chat, and only there', async () => {
  const h = inWorkspace()
  const tool = 'mcp__device__run_command'
  const push = { command: 'cd x && git -C y push origin main' }
  h.night.set(GROUP, true)
  for (const mode of ['ask', 'edits', 'all', 'read'] as const) {
    h.topics.set(GENERAL_KEY, { mode })
    h.reset()
    const r = await h.permissionFor(GENERAL_KEY, tool, push) as unknown as { behavior: string, message?: string }
    assert.equal(r.behavior, 'deny', mode)
    assert.match(r.message!, /Night mode is on.*git push.*morning.*button/s)
    assert.deepEqual(h.said(), [], 'no card to tap it through')
  }
  h.topics.set(`${GROUP}:6`, { mode: 'all' })
  assert.equal((await h.permissionFor(`${GROUP}:6`, tool, push))!.behavior, 'deny')
  // Allowed work goes on as the mode says
  assert.equal((await h.permissionFor(`${GROUP}:6`, tool, { command: 'git commit -m x' }))!.behavior, 'allow')
  // Another chat, and the same chat once it is off
  h.topics.set(`${OWNER}:0`, { mode: 'all' })
  assert.equal((await h.permissionFor(`${OWNER}:0`, tool, push))!.behavior, 'allow')
  h.night.set(GROUP, false)
  assert.equal((await h.permissionFor(`${GROUP}:6`, tool, push))!.behavior, 'allow')
})

test('/help carries both commands, in a group too', async () => {
  const h = inWorkspace()
  await h.text(GROUP, OWNER, '/help', 5)
  assert.match(lastText(h), /\/decisions/)
  assert.doesNotMatch(lastText(h), /\/night/, 'no such command any more')
})

// Every command and every button there is, read from the code: one added later without a sample fails here
const TELEGRAM_SOURCES = ['bot', 'overview', 'lock-menu', 'quiet', 'voice-tasks', 'decisions-menu', 'schedule-menu', 'users-menu', 'workspace-menu', 'zones', 'speech']
const BUTTON_SAMPLES = [
  'stg:1', 'scr:yes:1', 'scs:stop', 'scs:now', 'rst:go', 'rst:d:x', 'pairnew', 'lang:en', 'mdl:0', 'm:all', 'bb:x', 'bra:yes:1', 'brx', 'brr', 'pf:x', 'pfc:x', 'pfr:x:1', 'pfd', 'dvp:x', 'dvps:x:y', 'cl:all', 'del:yes', 'dlt:yes:aaaaaaaa', 'ttl:keep', 'ttl:pin', 'ttl:unpin', 'clno', 'clok:all',
  'show:aaaaaaaaaaaa', 'pd:x', 'pg:x:y', 'pp:x:1', 'pdl', 'np:x', 'dvs', 'dv:x', 'rn:x', 'rv:x', 'rvok:x', 'ghc:x', 'ghout', 'ghcode', 'lg:x', 'lgx', 'lgw:x', 'mcl:x', 'mcw:x', 'bpx:on:x', 'bpr:1:server',
  'upd:go:9.9.9', 'updw:cancel', 'mv:x', 'mvlater', 'b:x:y', 'nop', 'cs:go:x', 'spn:x:aaaaaaaa', 'spp:aaaaaaaa', 'ok:1', 'noop', 'sug:a:1', 'again:1', 'qa:1:0', 'sv:a:1', 'dfc', 'cp:go', 'wmk:-1:1', 'wm:-1',
  'ctxt:y:0123456789abcdef', 'apr:aaaaaaaa', 'csn:go', 'lmt:off', 'nsh:go:aaaaaaaa', 'pwr:off:aaaaaaaa', 'sko:go:aaaaaaaa', 'sko:no:aaaaaaaa', 'nsh:allow:aaaaaaaa', 'stk:stop', 'frl:later:aaaaaaaa', 'frl:now:aaaaaaaa', 'nss:new:aaaaaaaa', 'nss:keep:aaaaaaaa', 'wtc:del:aaaaaaaa', 'stm:x:y', 'stma:x:y:z', 'stmr:x:y', 'kaw:on:x', 'rul:y:aaaaaaaa', 'rul:n:aaaaaaaa', 'skl:a:aaaaaaaa', 'skr:n:aaaaaaaa', 'frs:now:aaaa', 'frs:no:aaaa', 'lck:go', 'lck:no', 'dec:rm:aa:0', 'ngt:off', 'qt:on', 'vt:go:aaaaaaaa', 'now:r', 'sch:p:a', 'sch:d:a', 'sch:tz', 'scy:a', 'scn:a', 'sp:get', 'usr:add', 'usr:cancel', 'usr:yes:1', 'usr:no:1', 'usr:rm:1', 'usr:drop:1', 'usr:keep:1', 'ws:home', 'zo:x', 'zf:aaaaaaaa:ok',
]

test('every command and every button: a stranger moves nothing, in the private chat or in a workspace', async () => {
  const code = TELEGRAM_SOURCES.map(f => readFileSync(new URL(`../src/telegram/${f}.ts`, import.meta.url), 'utf8')).join('\n')
  const buttons = [...code.matchAll(/\.callbackQuery\((\/.*?\/|'[^']+'), /g)].map(m => m[1])
  const commands = [...code.matchAll(/bot\.command\((?:'(\w+)'|\[([^\]]+)\])/g)].flatMap(m => (m[1] ? [m[1]] : [...m[2].matchAll(/'(\w+)'/g)].map(n => n[1])))
  assert.ok(buttons.length > 70 && commands.length > 25, `${buttons.length} buttons, ${commands.length} commands found`)
  for (const b of buttons) {
    const matches = b.startsWith('/') ? (s: string) => new RegExp(b.slice(1, -1)).test(s) : (s: string) => s === b.slice(1, -1)
    assert.ok(BUTTON_SAMPLES.some(matches), `no sample for the button ${b}`)
  }

  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc])
  h.workspaces.add(GROUP, { title: 'Roblox', addedBy: OWNER })
  h.topics.bind(`${GROUP}:5`, 'pc', 'game')
  h.night.set(GROUP, true)
  const before = JSON.stringify(h.topics.get(`${GROUP}:5`))
  for (const [chat, topic] of [[STRANGER, undefined], [GROUP, 5]] as const) {
    for (const c of commands) await h.text(chat, STRANGER, `/${c}`, topic)
    for (const data of BUTTON_SAMPLES) await h.tap(chat, STRANGER, data, topic)
  }
  assert.deepEqual(h.said(), [], 'the bot did and said nothing')
  assert.equal(JSON.stringify(h.topics.get(`${GROUP}:5`)), before)
  assert.equal(h.night.on(GROUP), true, 'night mode is only the owner\'s to turn off')
})

const cloudOf = (projects: string[]) => computer('cloud', 'Cloud', projects)
const gitRemote = (pc: ReturnType<typeof computer>, url: string) => {
  const root = join(pc.zone, 'game')
  mkdirSync(join(root, '.git', 'refs'), { recursive: true })
  mkdirSync(join(root, '.git', 'objects'))
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  writeFileSync(join(root, '.git', 'config'), `[remote "origin"]\n\turl = ${url}\n`)
}

test('/computer offers the cloud like a computer while it is online, and only then', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const cloud = cloudOf([])
  const h = start([pc, cloud])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  await h.text(OWNER, OWNER, '/computer', 5)
  assert.match(textOf(h.said()[0]), /cs:go:cloud/)
  assert.match(textOf(h.said()[0]), /☁️/)

  const alone = start([computer('pc', 'PC', ['game'])])
  alone.topics.bind(key, 'pc', 'game')
  await alone.text(OWNER, OWNER, '/computer', 5)
  assert.match(textOf(alone.said()[0]), /No other computer is online/, 'the cloud offline: nothing to offer')
  await alone.tap(OWNER, OWNER, 'cs:go:cloud', 5)
  assert.equal(alone.topics.get(key).deviceId, 'pc')
  assert.match(JSON.stringify(alone.calls.at(-1)), /offline now/)
})

test('/computer: a project of the same name in the cloud takes the topic at once, with its conversation', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc, cloudOf(['game', 'other'])])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  h.topics.set(key, { sessionId: 's1' })
  await h.tap(OWNER, OWNER, 'cs:go:cloud', 5)
  const t = h.topics.get(key)
  assert.equal(t.deviceId, 'cloud')
  assert.equal(t.projectId, 'game')
  assert.equal(t.sessionId, 's1')
  // The cloud is not a place to leave: /computer says what to use
  h.reset()
  await h.text(OWNER, OWNER, '/computer', 5)
  assert.match(textOf(h.said()[0]), /\/move/)
})

test('/computer: no such project in the cloud, the user picks one there; nothing is copied, and no copy is offered', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const cloud = cloudOf(['alpha', 'beta'])
  writeFileSync(join(pc.zone, 'game', 'scene.txt'), 'scene')
  const h = start([pc, cloud])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  h.topics.set(key, { sessionId: 's1' })
  await h.tap(OWNER, OWNER, 'cs:go:cloud', 5)
  const offer = textOf(h.said().at(-1)!)
  assert.match(offer, /has no folder/)
  assert.match(offer, /cs:pick:cloud/)
  assert.match(offer, /cs:new:cloud/)
  assert.doesNotMatch(offer, /cs:copy:cloud/, 'files do not go to the cloud on a tap in this menu')
  assert.doesNotMatch(offer, /cs:git:cloud/, 'no remote: nothing to clone')
  assert.equal(h.topics.get(key).deviceId, 'pc', 'nothing happens before the choice')
  assert.ok(!existsSync(join(cloud.zone, 'game')), 'nothing was created')

  await h.tap(OWNER, OWNER, 'cs:pick:cloud', 5)
  const list = textOf(h.calls.findLast(c => c.method === 'editMessageText')!)
  assert.match(list, /cs:use:cloud:alpha/)
  assert.match(list, /cs:use:cloud:beta/)
  assert.equal(h.topics.get(key).deviceId, 'pc', 'a list is no choice either')

  await h.tap(OWNER, OWNER, 'cs:use:cloud:gone', 5)
  assert.equal(h.topics.get(key).deviceId, 'pc', 'a project that is gone moves nothing')
  await h.tap(OWNER, OWNER, 'cs:use:cloud:beta', 5)
  await h.idle()
  const t = h.topics.get(key)
  assert.equal(t.deviceId, 'cloud')
  assert.equal(t.projectId, 'beta')
  assert.equal(t.sessionId, 's1')
  assert.match(String(t.envCame), /different one, picked by the user/)
  assert.ok(!existsSync(join(cloud.zone, 'beta', 'scene.txt')), 'nothing was copied')
})

test('/computer: an empty cloud has nothing to pick, only an empty folder; a clone address is offered for a repository', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc, cloudOf([])])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  await h.tap(OWNER, OWNER, 'cs:go:cloud', 5)
  const bare = textOf(h.said().at(-1)!)
  assert.doesNotMatch(bare, /cs:pick/)
  assert.match(bare, /cs:new:cloud/)

  gitRemote(pc, 'https://github.com/a/b.git')
  await h.tap(OWNER, OWNER, 'cs:go:cloud', 5)
  assert.match(textOf(h.said().at(-1)!), /cs:git:cloud/)
  assert.equal(h.topics.get(key).deviceId, 'pc')
  assert.deepEqual(h.topics.get(key).remote, { for: 'pc:game', url: 'https://github.com/a/b.git' }, 'remembered for the day the computer is off')
  await h.tap(OWNER, OWNER, 'cs:new:cloud', 5)
  assert.equal(h.topics.get(key).deviceId, 'cloud')
})

test("/computer: with the computer off the cloud still offers the clone it read while the computer was on", async () => {
  const pc = computer('pc', 'PC', ['game'])
  const devices = [pc, cloudOf(['other'])]
  const h = start(devices)
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  gitRemote(pc, 'https://github.com/a/b.git')
  await h.tap(OWNER, OWNER, 'cs:go:cloud', 5)
  devices.shift()

  h.reset()
  await h.text(OWNER, OWNER, '/computer', 5)
  assert.match(textOf(h.said()[0]), /cs:go:cloud/, 'the cloud for a topic whose computer is away')
  await h.tap(OWNER, OWNER, 'cs:go:cloud', 5)
  const offer = textOf(h.said().at(-1)!)
  assert.match(offer, /cs:git:cloud/)
  assert.match(offer, /cs:pick:cloud/)
  assert.doesNotMatch(offer, /cs:copy/, 'the source is off')
  assert.equal(h.topics.get(key).deviceId, 'pc')

  // A repository that was never read has no address to offer
  const fresh = start([cloudOf([])])
  fresh.topics.bind(`${OWNER}:6`, 'pc', 'game')
  await fresh.tap(OWNER, OWNER, 'cs:go:cloud', 6)
  assert.doesNotMatch(textOf(fresh.said().at(-1)!), /cs:git/)
})

test('/computer: a clone that fails leaves the topic where it was, and says so', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const h = start([pc, cloudOf([])])
  const key = `${OWNER}:5`
  h.topics.bind(key, 'pc', 'game')
  gitRemote(pc, 'https://nothing.invalid/a/b.git')
  await h.tap(OWNER, OWNER, 'cs:go:cloud', 5)
  await h.tap(OWNER, OWNER, 'cs:git:cloud', 5)
  await h.idle()
  assert.equal(h.topics.get(key).deviceId, 'pc')
  assert.match(JSON.stringify(h.calls.findLast(c => c.method === 'editMessageText')), /Didn't switch|git didn't fill/)
})

test('/model offers what the account lists, the newest of each family, and a topic on an older version moves to it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-flow-'))
  // As the account listed them the day after Fable 5.2 came out, kept by an earlier run
  const efforts = ['low', 'medium', 'high', 'max']
  writeFileSync(join(dir, 'models.json'), JSON.stringify({ at: Date.now(), rows: [
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', supportedEffortLevels: efforts },
    { value: 'claude-fable-5-2', resolvedModel: 'claude-fable-5-2', displayName: 'Fable 5.2', supportedEffortLevels: efforts },
    { value: 'fable', resolvedModel: 'claude-fable-5-1', displayName: 'Fable 5.1', supportedEffortLevels: efforts },
  ] }))
  const seeded = createTopicStore(join(dir, 'topics.json'))
  seeded.set(`${OWNER}:0`, { model: 'claude-fable-5-1[1m]' })
  seeded.flush()
  const h = harness([], dir)
  assert.equal(h.topics.get(`${OWNER}:0`).model, 'claude-fable-5-2', 'Fable 5.1 became Fable 5.2')
  await h.text(OWNER, OWNER, '/model')
  const menu = JSON.stringify(h.said().at(-1)!.payload)
  assert.match(menu, /• Fable 5\.2/)
  assert.match(menu, /mdl:opus/)
  assert.doesNotMatch(menu, /Fable 5\.1|eff:xhigh/, 'old versions and levels the models lack stay out')
  assert.doesNotMatch(menu, /\*\*/, 'no stars printed as they are')
  await h.tap(OWNER, OWNER, 'mdl:opus')
  assert.equal(h.topics.get(`${OWNER}:0`).model, 'opus')
  await h.tap(OWNER, OWNER, 'mdl:claude-fable-5-1')
  assert.equal(h.topics.get(`${OWNER}:0`).model, 'opus', 'not in the menu: not taken')
})

test('limit resets: the claude.ai page opens on a computer through the server, and straight only with a warning', async () => {
  const pc = computer('pc', 'PC', ['site'])
  const mac = computer('mac', 'Mac', ['site'])
  const h = harness([pc, mac])
  const last = () => JSON.stringify(h.said().at(-1)!.payload)
  // No computer bound and two online: which one
  await h.tap(OWNER, OWNER, 'rst:go')
  assert.match(last(), /Where to open the limits page/)
  assert.match(last(), /rst:d:pc/)
  assert.match(last(), /claude\.ai\/settings\/usage/, 'straight from the phone is there too')
  // This test's computers can't open windows: the reason, and the way straight with its warning
  await h.tap(OWNER, OWNER, 'rst:d:pc')
  assert.match(last(), /Didn't open on PC:<\/b> A sign-in window cannot be opened/)
  assert.match(last(), /claude\.ai sees your own address/)
  assert.match(last(), /Open without the server/)
  // None online
  const none = harness([])
  await none.tap(OWNER, OWNER, 'rst:go')
  assert.match(JSON.stringify(none.said().at(-1)!.payload), /No computer is online.*your own address/)
  // A stranger opens nothing
  const before = h.said().length
  await h.tap(OWNER, 999, 'rst:d:pc')
  assert.equal(h.said().length, before)
})
