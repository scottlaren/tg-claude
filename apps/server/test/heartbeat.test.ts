import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heartbeatStep } from '../src/gateway.ts'

test('one ping without an answer is forgiven, two in a row end the link', () => {
  const c = { alive: true, missed: 0 }
  assert.equal(heartbeatStep(c), 'ping')
  // A laptop asleep for a second longer than the interval: nothing came back by the next beat
  assert.equal(heartbeatStep(c), 'ping')
  assert.equal(c.missed, 1)
  // It woke and answered both
  c.alive = true
  assert.equal(heartbeatStep(c), 'ping')
  assert.equal(c.missed, 0, 'a new count')
  assert.equal(heartbeatStep(c), 'ping')
  assert.equal(heartbeatStep(c), 'drop', 'silent for two beats: gone')
})
