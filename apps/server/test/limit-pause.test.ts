import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPauses, resumePrompt, untilOf, UNKNOWN_RESET_MS } from '../src/telegram/limit-pause.ts'

function stand() {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-pause-'))
  let t = 1000
  const make = () => createPauses(join(dir, 'paused.json'), { now: () => t })
  return { make, at: (x: number) => { t = x }, done: () => rmSync(dir, { recursive: true, force: true }) }
}
const base = { key: '1:2', until: 5000, profile: 'main', text: 'do it', attempts: 1 }

test('what the limit cut off holds its topic and survives a restart, without its pictures', () => {
  const s = stand()
  try {
    const first = s.make()
    first.add({ ...base, images: [{ data: 'x' }] })
    assert.equal(first.holding('1:2')?.text, 'do it')
    const after = s.make()
    assert.equal(after.holding('1:2')?.text, 'do it')
    assert.equal(after.holding('1:2')?.images, undefined)
    assert.equal(after.holding('1:3'), undefined)
  } finally {
    s.done()
  }
})

test('a task put off with /fresh leaves its topic free, and several can wait', () => {
  const s = stand()
  try {
    const p = s.make()
    p.add({ ...base, fresh: true })
    p.add({ ...base, fresh: true, text: 'second' })
    assert.equal(p.holding('1:2'), undefined)
    assert.equal(p.list().length, 2)
    p.add(base)
    assert.ok(p.holding('1:2'))
    assert.equal(p.list().length, 3)
  } finally {
    s.done()
  }
})

test('a topic has one turn that was cut off: the new one takes its place', () => {
  const s = stand()
  try {
    const p = s.make()
    p.add({ ...base, text: 'old' })
    p.add({ ...base, text: 'new' })
    assert.equal(p.list().length, 1)
    assert.equal(p.holding('1:2')?.text, 'new')
  } finally {
    s.done()
  }
})

test('each goes on once, when it is due and not before', () => {
  const s = stand()
  try {
    const p = s.make()
    p.add(base)
    p.add({ ...base, key: '1:3', until: 9000 })
    assert.deepEqual(p.due(), [])
    s.at(5000)
    assert.deepEqual(p.due(60), [])
    s.at(5060)
    assert.deepEqual(p.due(60).map(x => x.key), ['1:2'])
    assert.deepEqual(p.due(60), [])
    assert.equal(s.make().list().length, 1)
  } finally {
    s.done()
  }
})

test('dropping by topic and by chat: one chat\'s id isn\'t mistaken for the start of another\'s', () => {
  const s = stand()
  try {
    const p = s.make()
    p.add({ ...base, key: '-100:1' })
    p.add({ ...base, key: '-100:2', fresh: true })
    p.add({ ...base, key: '-1001:1' })
    assert.equal(p.dropTopic('-100:2').length, 1)
    assert.equal(p.dropChat(-100).length, 1)
    assert.deepEqual(p.list().map(x => x.key), ['-1001:1'])
  } finally {
    s.done()
  }
})

test('the words to go on with don\'t pile up when the limit stops it again', () => {
  const once = resumePrompt('do it')
  assert.match(once, /usage limit ran out/)
  assert.match(once, /do it$/)
  assert.equal(resumePrompt(once), once)
})

test('a reset in the past or not known means a look in half an hour', () => {
  assert.equal(untilOf(5000, 1000), 5000)
  assert.equal(untilOf(500, 1000), 1000 + UNKNOWN_RESET_MS)
  assert.equal(untilOf(undefined, 1000), 1000 + UNKNOWN_RESET_MS)
})
