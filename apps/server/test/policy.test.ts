import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide } from '../src/claude/policy.ts'

const call = (o: Partial<Parameters<typeof decide>[0]>) =>
  decide({ mode: 'ask', readOnly: false, fileEdit: false, allowAllForTask: false, ...o })

test('reads pass in every mode', () => {
  for (const mode of ['ask', 'edits', 'all', 'read'] as const) assert.equal(call({ mode, readOnly: true }), 'allow')
})

test('ask mode asks for every change unless ⚡ was given for this task', () => {
  assert.equal(call({ fileEdit: true }), 'ask')
  assert.equal(call({}), 'ask')
  assert.equal(call({ allowAllForTask: true }), 'allow')
})

test('edits mode lets file edits through but still asks for commands and app actions', () => {
  assert.equal(call({ mode: 'edits', fileEdit: true }), 'allow')
  assert.equal(call({ mode: 'edits' }), 'ask')
})

test('all mode never asks; read mode never changes anything, ⚡ included', () => {
  assert.equal(call({ mode: 'all' }), 'allow')
  assert.equal(call({ mode: 'read', fileEdit: true }), 'deny')
  assert.equal(call({ mode: 'read', allowAllForTask: true }), 'deny')
})
