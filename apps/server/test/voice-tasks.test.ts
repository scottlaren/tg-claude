import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setLang } from '../src/i18n.ts'
import { parseTasks } from '../src/claude/split-tasks.ts'
import { cardMarkdown, cardRows, chosenPrompt, isList } from '../src/telegram/voice-tasks.ts'
import { topicName } from '../src/telegram/incoming.ts'

setLang('en')

test('the helper reply: JSON in any wrapping is a list, anything else is no list', () => {
  assert.deepEqual(parseTasks('{"tasks": ["a", " b "]}'), ['a', 'b'])
  assert.deepEqual(parseTasks('["a", "b"]'), ['a', 'b'])
  assert.deepEqual(parseTasks('Here you go:\n```json\n{"tasks":["a","b"]}\n```'), ['a', 'b'])
  for (const raw of ['', 'E2E title', '{"tasks": "a"}', '{"tasks": [1, 2]}', '{"tasks": []}', '{"tasks": [""]}', '{broken', '{}']) assert.equal(parseTasks(raw), null, raw)
})

test('four to twelve tasks make a list; up to three go as they were said', () => {
  assert.equal(isList(null), false)
  assert.equal(isList(['a']), false)
  assert.equal(isList(['a', 'b', 'c']), false)
  assert.equal(isList(['a', 'b', 'c', 'd']), true)
  assert.equal(isList(Array(12).fill('a')), true)
  assert.equal(isList(Array(13).fill('a')), false, 'a dictated text, not a list')
})

test('the card shows what was said, masked and safe for markup; long labels fit a button', () => {
  const md = cardMarkdown(['use *this* <b>', 'mail me at someone@example.com'])
  assert.match(md, /^1\. use \\\*this\\\* &lt;b>$/m)
  assert.doesNotMatch(md, /someone@example\.com/)
  const rows = cardRows({ id: 'aaaaaaaa', tasks: ['x'.repeat(100), 'y'], selected: [1] })
  assert.ok(rows[0][0].text.startsWith('⬜ 1.') && rows[0][0].text.length < 60)
  assert.ok(rows[1][0].text.startsWith('☑️ 2.'))
  assert.ok(rows.flat().every(b => Buffer.byteLength(b.data) <= 64))
  assert.match(rows[2][0].text, /selected: 1/)
})

test('the prompt holds the chosen tasks in their order; a topic is named after them, not the note', () => {
  const p = chosenPrompt(['a', 'b', 'c'], [2, 0])
  assert.match(p, /^🎙 1\. a\n2\. c\n\n\(/)
  assert.match(p, /left the others out on purpose/)
  assert.equal(topicName(p), '1. a 2. c')
  assert.match(chosenPrompt(['a', 'b'], [1]), /^🎙 b\n/)
  assert.doesNotMatch(chosenPrompt(['a', 'b'], [0, 1]), /left the others/)
})
