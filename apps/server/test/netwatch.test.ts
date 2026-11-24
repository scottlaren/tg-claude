import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createToolTracker } from '../src/claude/netwatch.ts'

test('a quick tool done beside a long one: the turn still waits on the long one, not on the API', () => {
  const tools = createToolTracker()
  tools.called([{ type: 'text', text: 'x' }, { type: 'tool_use', id: 'quick' }, { type: 'tool_use', id: 'long' }])
  assert.equal(tools.answered([{ type: 'tool_result', tool_use_id: 'quick' }]), false)
  assert.equal(tools.answered([{ type: 'tool_result', tool_use_id: 'long' }]), true)
  // One at a time, as most are; a message that carries no results says nothing about the one still running
  tools.called([{ type: 'tool_use', id: 'one' }])
  assert.equal(tools.answered('plain text'), false)
  assert.equal(tools.answered([{ type: 'tool_result', tool_use_id: 'one' }]), true)
})
