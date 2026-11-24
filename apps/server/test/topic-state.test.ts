import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTopicState, turnState, type TopicState } from '../src/telegram/topic-state.ts'

function setup({ failIcons = 0, failEdits = 0 } = {}) {
  const edits: string[] = []
  const counts = { icons: 0 }
  const saved = new Map<string, Exclude<TopicState, 'idle'> | undefined>()
  const api = {
    getForumTopicIconStickers: async () => {
      if (counts.icons++ < failIcons) throw new Error('no icons')
      return [{ emoji: '❓', custom_emoji_id: 'ask' }, { emoji: '❗️', custom_emoji_id: 'alert' }]
    },
    editForumTopic: async (_chat: number, _topic: number, o: { icon_custom_emoji_id?: string }) => {
      if (failEdits-- > 0) throw new Error('flood')
      edits.push(o.icon_custom_emoji_id!)
      return true
    },
  }
  const make = () => createTopicState({ api: api as never, log: { debug() {} }, load: k => saved.get(k), save: (k, s) => { saved.set(k, s) } })
  return { t: make(), make, edits, counts, saved }
}

test('a normal turn touches nothing: no icon, no bubble', async () => {
  const { t, edits, counts } = setup()
  await t.set('1:2', 1, 2, 'idle')
  await t.set('1:2', 1, 2, turnState({}))
  assert.deepEqual(edits, [])
  assert.equal(counts.icons, 0)
})

test('the icon appears when the owner is needed and goes after, whatever the variation selector', async () => {
  const { t, edits } = setup()
  t.set('1:2', 1, 2, 'waiting')
  await t.set('1:2', 1, 2, 'idle')
  await t.set('1:2', 1, 2, 'error')
  await t.set('1:2', 1, 2, 'idle')
  assert.deepEqual(edits, ['ask', '', 'alert', ''])
})

test('no edit when nothing changed, none in the general chat; topics are apart', async () => {
  const { t, edits } = setup()
  await t.set('1:0', 1, undefined, 'waiting')
  assert.deepEqual(edits, [])
  await t.set('1:2', 1, 2, 'waiting')
  await t.set('1:2', 1, 2, 'waiting')
  await t.set('1:3', 1, 3, 'waiting')
  assert.deepEqual(edits, ['ask', 'ask'])
})

test('after a restart the bot knows which topics have an icon, and leaves the others alone', async () => {
  const { t, make, edits } = setup()
  await t.set('1:2', 1, 2, 'waiting')
  const again = make()
  await again.set('1:3', 1, 3, 'idle')
  assert.deepEqual(edits, ['ask'])
  await again.set('1:2', 1, 2, 'idle')
  assert.deepEqual(edits, ['ask', ''])
})

test('a failed edit breaks nothing, and the next one tries again', async () => {
  const { t, edits, saved } = setup({ failIcons: 1, failEdits: 1 })
  await t.set('1:2', 1, 2, 'waiting')
  assert.deepEqual(edits, [])
  assert.equal(saved.get('1:2'), undefined, 'not there, so not remembered')
  await t.set('1:2', 1, 2, 'waiting')
  assert.deepEqual(edits, [], 'the edit itself failed this time')
  await t.set('1:2', 1, 2, 'waiting')
  assert.deepEqual(edits, ['ask'])
})

test('a turn stopped by the user needs nothing from them; a failure does', () => {
  assert.equal(turnState({}), 'idle')
  assert.equal(turnState({ note: null }), 'idle')
  assert.equal(turnState({ note: '⏹ Stopped', stopped: true }), 'idle')
  assert.equal(turnState({ note: '⚠️ failed' }), 'error')
})
