import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newer, releaseOf } from '../src/index.ts'
import { fileURLToPath } from 'node:url'

test('releases compare by number, with or without the v; anything else is never newer', () => {
  assert.equal(newer('0.2.0', '0.1.9'), true)
  assert.equal(newer('v0.10.0', '0.9.9'), true)
  assert.equal(newer('1.0.0', 'v0.99.99'), true)
  assert.equal(newer('0.1.2', '0.1.2'), false)
  assert.equal(newer('0.1.1', '0.1.2'), false)
  assert.equal(newer('x', '0.1.0'), false)
  assert.equal(newer('0.2.0', 'unknown'), false)
  assert.equal(newer('v0.2.0-beta', '0.1.0'), false)
})

test('the release of a checkout is its root package.json version', () => {
  assert.match(releaseOf(fileURLToPath(new URL('../../..', import.meta.url))), /^\d+\.\d+\.\d+$/)
  assert.equal(releaseOf('/no/such/dir'), 'unknown')
})
