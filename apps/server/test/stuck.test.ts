import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStuckWatch, failureOf, stuckForClaude, QUIET_MS, QUIET_COMMAND_MS, SAME_ERROR_MAX, SAME_STEP_MAX } from '../src/telegram/stuck.ts'

function stand() {
  let t = 0
  return { watch: createStuckWatch({ now: () => t }), pass: (ms: number) => { t += ms } }
}

test('the same error in a row says so once; another outcome starts the count again', () => {
  const { watch } = stand()
  for (let i = 1; i < SAME_ERROR_MAX; i++) assert.equal(watch.outcome('boom'), null)
  watch.outcome(null)
  for (let i = 1; i < SAME_ERROR_MAX; i++) assert.equal(watch.outcome('boom'), null)
  const r = watch.outcome('boom')
  assert.equal(r?.kind, 'error')
  assert.equal(watch.outcome('boom'), null, 'once')
})

test('different errors are working through something, not stuck', () => {
  const { watch } = stand()
  for (let i = 0; i < 10; i++) assert.equal(watch.outcome(`error ${i}`), null)
})

test('the same step with the same input says so; with another input it doesn\'t', () => {
  const { watch } = stand()
  for (let i = 0; i < 20; i++) assert.equal(watch.step('read_file', { path: `f${i}` }), null)
  for (let i = 1; i < SAME_STEP_MAX; i++) assert.equal(watch.step('read_file', { path: 'a' }), null)
  assert.equal(watch.step('read_file', { path: 'a' })?.kind, 'loop')
})

test('quiet: waiting for the user doesn\'t count, and a running command gets far longer', () => {
  const { watch, pass } = stand()
  pass(QUIET_MS + 1)
  assert.equal(watch.quiet({ waiting: true, running: false }), null)
  pass(QUIET_MS - 1000)
  assert.equal(watch.quiet({ waiting: false, running: false }), null, 'the clock started again after the wait')
  pass(1001)
  assert.equal(watch.quiet({ waiting: false, running: true }), null)
  assert.equal(watch.quiet({ waiting: false, running: false })?.kind, 'quiet')
  assert.equal(watch.quiet({ waiting: false, running: false }), null, 'once')
})

test('a command long past its limit says so too', () => {
  const { watch, pass } = stand()
  pass(QUIET_COMMAND_MS)
  const r = watch.quiet({ waiting: false, running: true })
  assert.equal(r?.kind, 'quiet')
  assert.match(stuckForClaude('A', r!), /a command has been running for 120 minutes/)
})

test('activity keeps it from being quiet, and writing doesn\'t break a run of errors', () => {
  const { watch, pass } = stand()
  pass(QUIET_MS - 1)
  watch.activity()
  pass(QUIET_MS - 1)
  assert.equal(watch.quiet({ waiting: false, running: false }), null)
  watch.outcome('x')
  watch.activity()
  watch.outcome('x')
  watch.activity()
  assert.equal(watch.outcome('x')?.kind, 'error')
})

test('what a failed step comes down to', () => {
  assert.equal(failureOf('read_file', { ok: true, result: {} }), null)
  assert.equal(failureOf('run_command', { ok: true, result: { exitCode: 0, stderr: 'noise' } }), null)
  assert.match(failureOf('run_command', { ok: true, result: { exitCode: 2, stderr: 'no such file' } })!, /exit 2: no such file/)
  assert.match(failureOf('write_file', { ok: false, error: { message: 'denied' } })!, /denied/)
})

test('the words for the head name the agent and don\'t order it about', () => {
  const text = stuckForClaude('Decor', { kind: 'error', times: 3, detail: 'boom' })
  assert.match(text, /“Decor” may be stuck/)
  assert.match(text, /If it is fine, do nothing/)
})
