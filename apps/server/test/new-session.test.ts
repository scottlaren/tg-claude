import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setLang } from '../src/i18n.ts'
import { createNewSessionOffers, NEW_SESSION_AT } from '../src/telegram/new-session.ts'
import { createNewSessionServer } from '../src/claude/session-tools.ts'

setLang('ru')

function offers() {
  const sent: { key: string, md: string, rows: { text: string, data: string }[][] }[] = []
  const edits: string[] = []
  const resets: string[] = []
  const runs: { key: string, text: string, images: unknown[], shownId?: number }[] = []
  const o = createNewSessionOffers({
    send: async (key, md, rows) => (sent.push({ key, md, rows }), 77),
    edit: async (_key, _id, md) => void edits.push(md),
    reset: key => void resets.push(key),
    run: (key, text, images, shownId) => void runs.push({ key, text, images, shownId }),
    mdText: s => s.replace(/\*/g, '\\*'),
  })
  return { o, sent, edits, resets, runs }
}
const long = { sessionId: 's1', context: { total: 350_000 } }

test('asked only in the user\'s own topic, on their own words, with a long conversation', () => {
  const { o } = offers()
  assert.equal(o.wanted('k', long, true), true)
  assert.equal(o.wanted('k', long, false), false, 'a report or a scheduled run')
  assert.equal(o.wanted('k', { ...long, head: 'h' }, true), false, 'agents compact by themselves')
  assert.equal(o.wanted('k', { ...long, context: { total: NEW_SESSION_AT - 1 } }, true), false)
  assert.equal(o.wanted('k', { context: long.context }, true), false, 'no session yet')
})

test('a new session: the card, then the same message, pictures too, in a fresh session', async () => {
  const { o, sent, edits, resets, runs } = offers()
  const said = await o.offer('k', long, 'сделай *экспорт*', [{ mime: 'image/png', data: 'x' }], 'экспорт *в* PDF')
  assert.match(said, /Don't start the task/)
  assert.match(sent[0].md, /новая задача: экспорт \\\*в\\\* PDF/)
  assert.match(sent[0].md, /350k токенов/)
  const id = sent[0].rows[0][0].data.split(':')[2]
  assert.deepEqual(sent[0].rows[0].map(r => r.data), [`nss:new:${id}`, `nss:keep:${id}`])
  assert.equal(o.choose(id, 'new', 's1', 77), true)
  assert.deepEqual(resets, ['k'])
  assert.deepEqual(runs, [{ key: 'k', text: 'сделай *экспорт*', images: [{ mime: 'image/png', data: 'x' }], shownId: 77 }])
  assert.match(edits[0], /Новая сессия/)
  assert.equal(o.choose(id, 'new', 's1', 77), false, 'one tap')
})

test('a session already started over is not thrown away again', async () => {
  const { o, sent, resets, runs } = offers()
  await o.offer('k', long, 'task', [], 'другое')
  assert.equal(o.choose(sent[0].rows[0][0].data.split(':')[2], 'new', 's2'), true)
  assert.deepEqual(resets, [])
  assert.equal(runs.length, 1)
})

test('going on here: the task goes on, and that turn doesn\'t ask again; the next one may', async () => {
  const { o, sent, resets, runs } = offers()
  await o.offer('k', long, 'task', [], 'другое')
  o.choose(sent[0].rows[0][0].data.split(':')[2], 'keep', 's1', 77)
  assert.deepEqual(resets, [])
  assert.match(runs[0].text, /in this conversation/)
  assert.equal(o.wanted('k', long, true), false)
  assert.equal(o.wanted('k', long, true), true)
})

test('the tool tells Claude how long the conversation is and when not to ask', () => {
  const s = createNewSessionServer(350, async () => 'ok')
  const tools = (s.instance as unknown as { _registeredTools: Record<string, { description: string }> })._registeredTools
  assert.match(tools.offer_new_session.description, /about 350k tokens/)
  assert.match(tools.offer_new_session.description, /Not when the message continues/)
})
