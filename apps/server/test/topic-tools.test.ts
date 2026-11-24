import { topicNames } from '../src/claude/topic-tools.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTopicNameServer, RENAME_TOPIC, TOPIC_NAME_SERVER } from '../src/claude/topic-tools.ts'

test('Claude renames its topic with a tool of the bot', () => {
  assert.equal(RENAME_TOPIC, `mcp__${TOPIC_NAME_SERVER}__rename_topic`)
  assert.equal(createTopicNameServer(async () => '').name, TOPIC_NAME_SERVER)
})

test('the list of topics in a tool stays short however many a chat has, the newest in it', () => {
  const few = ['a', 'b']
  assert.equal(topicNames(few), 'a, b')
  const many = Array.from({ length: 100 }, (_, i) => `topic ${i}`)
  const list = topicNames(many)
  assert.ok(list.length < 600, String(list.length))
  assert.match(list, /topic 99/)
  assert.doesNotMatch(list, /topic 0,/)
  assert.match(list, /60 older/)
})
