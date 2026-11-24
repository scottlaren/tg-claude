import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSpend, weigh } from '../src/telegram/spend.ts'

test('tokens weigh by what they cost: rereading least, answers most, Opus above Sonnet', () => {
  assert.equal(weigh({ cacheRead: 1000 }, 'claude-opus-5-5'), 100)
  assert.equal(weigh({ output: 10 }, 'claude-opus-5-5'), 50)
  assert.equal(weigh({ input: 100, cacheWrite: 100 }, 'claude-opus-5-5'), 225)
  assert.equal(weigh({ input: 100 }, 'claude-sonnet-5-5'), 60)
})

test('the week by topic, costliest first; a topic past a tenth of the week in a day is told once that day', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-spend-'))
  try {
    let now = Date.parse('2026-11-06T10:00:00Z')
    const s = createSpend(join(dir, 'spend.json'), { now: () => now, week: 1000 })
    assert.equal(s.add('a', 'opus', { input: 50 }).warn, false)
    assert.equal(s.add('a', 'opus', { input: 60 }).warn, true, 'past 100 of 1000')
    assert.equal(s.add('a', 'opus', { input: 60 }).warn, false, 'once a day')
    s.add('b', 'opus', { input: 30 })
    now += 86400_000
    assert.equal(s.add('a', 'opus', { input: 200 }).warn, true, 'a new day')
    const w = s.week()
    assert.deepEqual(w.topics.map(x => x.key), ['a', 'b'])
    assert.equal(Math.round(w.topics[1].share * 1000), Math.round((30 / 400) * 1000))
    now += 8 * 86400_000
    assert.equal(s.week().total, 0, 'only the last seven days')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a topic keeps its name in the week after it is deleted; an old file without names still reads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-spend-'))
  try {
    const file = join(dir, 'spend.json')
    writeFileSync(file, JSON.stringify({ '2026-11-06': { old: 5 } }))
    const now = Date.parse('2026-11-06T10:00:00Z')
    const s = createSpend(file, { now: () => now })
    s.add('agent', 'opus', { input: 50 }, '🤖 Audit')
    assert.deepEqual(s.week().topics.map(x => [x.key, x.name]), [['agent', '🤖 Audit'], ['old', undefined]])
    assert.equal(createSpend(file, { now: () => now }).week().topics[0].name, '🤖 Audit', 'saved')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the week day by day, the oldest first, each with its costliest topics', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-spend-'))
  try {
    let now = Date.parse('2026-11-06T10:00:00Z')
    const s = createSpend(join(dir, 'spend.json'), { now: () => now })
    s.add('a', 'opus', { input: 10 }, 'A')
    s.add('b', 'opus', { input: 30 })
    now += 2 * 86400_000
    s.add('a', 'opus', { input: 5 })
    const d = s.days(1)
    assert.equal(d.length, 7)
    assert.deepEqual(d.map(x => x.total), [0, 0, 0, 0, 40, 0, 5])
    assert.deepEqual(d[4].topics, [{ key: 'b', units: 30, name: undefined }])
    assert.equal(d[6].day, '2026-11-08')
    assert.equal(d[6].topics[0].name, 'A')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
