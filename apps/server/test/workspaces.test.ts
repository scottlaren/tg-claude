import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceStore, inherited } from '../src/workspaces.ts'
import { addLink, groupLink, workspaceCard, workspaceProblem } from '../src/telegram/workspace-menu.ts'
import { createGroupLimit, createStatusBubble, limitTransformer, quietMark } from '../src/telegram/group-limit.ts'
import { statusMarkdown, draftMarkdown } from '../src/telegram/render.ts'
import { setLang } from '../src/i18n.ts'

const GROUP = -1003555000111

test('a workspace survives a restart and goes when removed', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tgcv-workspaces-')), 'workspaces.json')
  const a = createWorkspaceStore(file)
  a.add(GROUP, { title: 'Roblox', addedBy: 1 })
  a.update(GROUP, { deviceId: 'pc', mode: 'all' })
  assert.deepEqual(createWorkspaceStore(file).get(GROUP), { title: 'Roblox', addedBy: 1, deviceId: 'pc', mode: 'all' })
  assert.deepEqual(createWorkspaceStore(file).list().map(w => w.chatId), [GROUP])
  // An update can't bring a group back into being
  a.update(-1, { title: 'x' })
  assert.equal(a.get(-1), undefined)
  a.remove(GROUP)
  assert.equal(createWorkspaceStore(file).get(GROUP), undefined)
})

test('a new topic takes the settings it has none of', () => {
  const w = { title: 't', addedBy: 1, mode: 'all' as const, model: 'm' }
  assert.deepEqual(inherited(w, {}), { mode: 'all', model: 'm' })
  assert.deepEqual(inherited(w, { mode: 'read' }), { model: 'm' })
  assert.deepEqual(inherited({ title: 't', addedBy: 1 }, {}), {})
})

test('a group becomes a workspace only with topics on and the rights the bot needs', () => {
  setLang('ru')
  const admin = { status: 'administrator', can_manage_topics: true, can_delete_messages: true }
  assert.equal(workspaceProblem({ type: 'supergroup', is_forum: true }, admin), null)
  // No topics: being an admin is enough, the rights for topics mean nothing there
  assert.equal(workspaceProblem({ type: 'group' }, { status: 'administrator' }), null)
  assert.equal(workspaceProblem({ type: 'supergroup', is_forum: false }, { status: 'creator' }), null)
  assert.match(workspaceProblem({ type: 'group' }, { status: 'member' })!, /админом этой группы/)
  assert.match(workspaceProblem({ type: 'supergroup', is_forum: true }, { status: 'member' })!, /админом/)
  assert.match(workspaceProblem({ type: 'supergroup', is_forum: true }, { status: 'administrator', can_manage_topics: true })!, /админом/)
})

test('the links bring the bot in with its rights, and open the group', () => {
  assert.equal(addLink('example_bot'), 'https://t.me/example_bot?startgroup=ws&admin=manage_topics+delete_messages+change_info')
  assert.equal(groupLink(GROUP), 'https://t.me/c/3555000111/1')
})

test('the card says what new topics get, and warns when others read along', () => {
  setLang('ru')
  const { md, rows } = workspaceCard({ title: 'Roblox', addedBy: 1, mode: 'all' }, { device: 'PC' })
  assert.match(md, /Компьютер: \*\*PC\*\*/)
  assert.match(md, /Проект: \*\*выбирается в топике\*\*/)
  assert.doesNotMatch(md, /участники группы/)
  assert.deepEqual(rows.flat().map(b => b.data), ['ws:dev', 'ws:prj', 'ws:mod', 'ws:mdl'])
  assert.match(workspaceCard({ title: 't', addedBy: 1 }, {}, 3).md, /участники группы \(3\)/)
})

test('statuses leave room for answers, and share it between working topics', () => {
  let t = 0
  const limit = createGroupLimit(() => t)
  assert.equal(limit.gap(GROUP), 5000)
  limit.enter(GROUP)
  limit.enter(GROUP)
  assert.equal(limit.gap(GROUP), 10000)
  limit.leave(GROUP)
  limit.leave(GROUP)
  limit.leave(GROUP)
  assert.equal(limit.gap(GROUP), 5000)
  for (let i = 0; i < 11; i++) limit.wrote(GROUP)
  assert.equal(limit.room(GROUP), true)
  limit.wrote(GROUP)
  assert.equal(limit.room(GROUP), false)
  t += 60_000
  assert.equal(limit.room(GROUP), true)
  limit.blocked(GROUP, 37)
  assert.equal(limit.room(GROUP), false)
  t += 37_000
  assert.equal(limit.room(GROUP), true)
})

const blockedOnce = () => {
  const calls: string[] = []
  const prev = async (method: string) => {
    calls.push(method)
    return calls.length === 1
      ? { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 37 } }
      : { ok: true, result: true }
  }
  return { calls, prev: prev as never }
}

test('an answer waits out a block and arrives; a status does not wait', async () => {
  const limit = createGroupLimit()
  const waits: number[] = []
  const transform = limitTransformer(limit, async ms => void waits.push(ms))

  const answer = blockedOnce()
  const sent = await transform(answer.prev, 'sendRichMessage' as never, { chat_id: GROUP } as never, undefined)
  assert.equal(sent.ok, true)
  assert.deepEqual(answer.calls, ['sendRichMessage', 'sendRichMessage'])
  assert.deepEqual(waits, [37_000])

  limit.markStatus(GROUP, 5)
  const status = blockedOnce()
  const edited = await transform(status.prev, 'editMessageText' as never, { chat_id: GROUP, message_id: 5 } as never, undefined)
  assert.equal(edited.ok, false)
  assert.deepEqual(status.calls, ['editMessageText'])
  assert.equal(limit.room(GROUP), false)
})

test('a private chat and typing never count against a group, and a block there is not waited out', async () => {
  const limit = createGroupLimit()
  const waits: number[] = []
  const transform = limitTransformer(limit, async ms => void waits.push(ms))
  const chat = blockedOnce()
  const r = await transform(chat.prev, 'sendRichMessage' as never, { chat_id: 5550001234 } as never, undefined)
  assert.equal(r.ok, false)
  assert.deepEqual(waits, [])
  const typing = blockedOnce()
  await transform(typing.prev, 'sendChatAction' as never, { chat_id: GROUP } as never, undefined)
  for (let i = 0; i < 11; i++) limit.wrote(GROUP)
  assert.equal(limit.room(GROUP), true)
})

test('a status bubble appears once, is redrawn only when it changed, and goes at the end', async () => {
  const limit = createGroupLimit()
  const log: string[] = []
  const bubble = createStatusBubble({
    limit,
    chatId: GROUP,
    send: async md => (log.push(`send ${md}`), 7),
    edit: async (id, md) => log.push(`edit ${id} ${md}`),
    remove: async id => log.push(`remove ${id}`),
  })
  assert.equal(limit.gap(GROUP), 5000)
  await bubble.show('a')
  await bubble.show('a')
  await bubble.show('b')
  assert.equal(limit.isStatus(GROUP, 7), true)
  await bubble.end()
  await bubble.end()
  await bubble.show('c')
  assert.deepEqual(log, ['send a', 'edit 7 b', 'remove 7'])
  assert.equal(limit.isStatus(GROUP, 7), false)
})

test('no status is drawn while the group is out of room, and an empty one leaves nothing to remove', async () => {
  const limit = createGroupLimit()
  const log: string[] = []
  const bubble = createStatusBubble({
    limit,
    chatId: GROUP,
    send: async () => (log.push('send'), 7),
    edit: async () => log.push('edit'),
    remove: async () => log.push('remove'),
  })
  limit.blocked(GROUP, 30)
  await bubble.show('a')
  await bubble.end()
  assert.deepEqual(log, [])
})

test('a turn with no room for its status marks the last message it answers', () => {
  const items = [{ msgId: 1 }, { shownId: 2 }, { text: 'from the bot itself' }] as { msgId?: number, shownId?: number }[]
  assert.equal(quietMark(items, true), undefined, 'a status will show')
  assert.equal(quietMark(items, false), items[1])
  assert.equal(quietMark([{}], false), undefined, 'nothing of the user to mark')
})

test('a group status is a plain message: tg-thinking only works in a draft', () => {
  const md = statusMarkdown({ steps: ['a', 'b'], status: 'working' })
  assert.equal(md, '- a\n- b\n\nworking')
  // The time only from half a minute, and in half minutes: every redraw is a write
  assert.equal(statusMarkdown({ steps: [], status: 'x', elapsedMs: 29_000 }), 'x')
  setLang('en')
  assert.equal(statusMarkdown({ steps: [], status: 'x', elapsedMs: 100_000 }), 'x · 1m 30s')
  assert.doesNotMatch(statusMarkdown({ steps: [], status: '' }), /tg-thinking/)
  assert.match(draftMarkdown({ steps: [], text: '', status: 'x' }), /<tg-thinking>x<\/tg-thinking>/)
})
