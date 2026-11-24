import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createQueueStore } from '../src/telegram/queue-store.ts'

const file = () => join(mkdtempSync(join(tmpdir(), 'tgcv-queues-')), 'queues.json')

test('queues come back once, and an empty save leaves nothing behind', () => {
  const f = file()
  const store = createQueueStore<{ text: string }>(f)
  store.save({ 'a:1': [{ text: 'x' }] })
  assert.deepEqual(createQueueStore(f).take(), { 'a:1': [{ text: 'x' }] })
  assert.deepEqual(createQueueStore(f).take(), {})
  assert.equal(existsSync(f), false)
  store.save({ 'a:1': [{ text: 'x' }] })
  store.save({})
  assert.equal(existsSync(f), false)
})

test('a file from long ago is about a moment that has passed', () => {
  const f = file()
  let t = 0
  const store = createQueueStore<string>(f, () => t)
  store.save({ k: ['old'] })
  t = 3 * 3600_000
  assert.deepEqual(store.take(), {})
  assert.equal(existsSync(f), false)
})

test('nothing to read is nothing to do', () => {
  assert.deepEqual(createQueueStore(file()).take(), {})
})
