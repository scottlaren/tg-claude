import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pickLatest, parseModelId, createModelCatalog, FALLBACK_MODELS, type ModelRow } from '../src/models.ts'

const all = ['low', 'medium', 'high', 'xhigh', 'max']
// What the account's Claude Code listed on 2026-11-10, the day after Fable 5.2 came out
const LISTED: ModelRow[] = [
  { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', supportedEffortLevels: all },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', supportedEffortLevels: all },
  { value: 'claude-fable-5-2', resolvedModel: 'claude-fable-5-2', displayName: 'Fable 5.2', supportedEffortLevels: all },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', supportedEffortLevels: all },
  { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5', supportedEffortLevels: all },
  { value: 'fable', resolvedModel: 'claude-fable-5-1', displayName: 'Fable 5.1', supportedEffortLevels: all },
  { value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
  { value: 'claude-sonnet-5', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet 5', supportedEffortLevels: all },
  { value: 'claude-opus-5', resolvedModel: 'claude-opus-5', displayName: 'Opus 5', supportedEffortLevels: all },
  { value: 'claude-fable-5', resolvedModel: 'claude-fable-5', displayName: 'Fable 5', supportedEffortLevels: all },
  { value: 'claude-opus-4-8', resolvedModel: 'claude-opus-4-8', displayName: 'Opus 4.8', supportedEffortLevels: all },
  { value: 'claude-opus-4-6', resolvedModel: 'claude-opus-4-6', displayName: 'Opus 4.6', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
]

test('ids: family and version, with a date or a context suffix', () => {
  assert.deepEqual(parseModelId('claude-opus-5-5'), { family: 'opus', version: [5, 5] })
  assert.deepEqual(parseModelId('claude-fable-5'), { family: 'fable', version: [5] })
  assert.deepEqual(parseModelId('claude-haiku-4-5-20251001'), { family: 'haiku', version: [4, 5] })
  assert.deepEqual(parseModelId('claude-fable-5-1[1m]'), { family: 'fable', version: [5, 1] })
  assert.equal(parseModelId('opus'), undefined)
})

test('the menu: the newest of each family, an alias only when it points there, the old ones out', () => {
  assert.deepEqual(pickLatest(LISTED).map(m => [m.value, m.label]), [
    ['opus', 'Opus 5.5'],
    ['sonnet', 'Sonnet 5.5'],
    ['haiku', 'Haiku 5.5'],
    ['claude-fable-5-2', 'Fable 5.2'],
  ])
})

test('a family never seen before gets its own button, after the known ones', () => {
  const rows = [...LISTED, { value: 'claude-mythos-5-2', resolvedModel: 'claude-mythos-5-2', displayName: 'Mythos 5.2', supportedEffortLevels: ['low', 'high'] }]
  const m = pickLatest(rows).at(-1)!
  assert.deepEqual([m.value, m.label, m.family, m.efforts], ['claude-mythos-5-2', 'Mythos 5.2', 'mythos', ['low', 'high']])
})

function catalog(rows: ModelRow[] | null | (() => never)) {
  const file = join(mkdtempSync(join(tmpdir(), 'tgcv-models-')), 'models.json')
  let changed = 0
  const t = { now: 1_000_000 }
  const c = createModelCatalog({ file, fetch: async () => (typeof rows === 'function' ? rows() : rows), now: () => t.now, onChange: () => changed++ })
  return { c, file, t, changed: () => changed }
}

test('before the account is asked, and when asking fails: the list this was written with', async () => {
  const { c, changed } = catalog(() => { throw new Error('signed out') })
  assert.deepEqual(c.list(), FALLBACK_MODELS)
  assert.equal(await c.refresh(), false)
  assert.deepEqual(c.list(), FALLBACK_MODELS)
  assert.equal(changed(), 0)
})

test('asked: the menu follows the account, is kept on disk, and a new model is a change', async () => {
  const rows = [...LISTED]
  const { c, file, changed } = catalog(rows)
  assert.equal(await c.refresh(), true)
  assert.ok(existsSync(file))
  assert.equal(c.list().find(m => m.family === 'fable')!.value, 'claude-fable-5-2')
  assert.equal(changed(), 0, 'what it had already')
  rows.push({ value: 'claude-sonnet-5-6', resolvedModel: 'claude-sonnet-5-6', displayName: 'Sonnet 5.6' })
  await c.refresh()
  await c.refresh()
  assert.equal(changed(), 1, 'the same list again is no change')
  assert.equal(c.list().find(m => m.family === 'sonnet')!.label, 'Sonnet 5.6')
  const again = createModelCatalog({ file, fetch: async () => null })
  assert.deepEqual(again.list(), c.list(), 'a restart starts from the kept list')
})

test('an older version of a family moves to its newest; aliases and the newest stay', async () => {
  const { c } = catalog(LISTED)
  await c.refresh()
  assert.equal(c.upgrade('claude-fable-5-1[1m]'), 'claude-fable-5-2')
  assert.equal(c.upgrade('fable'), 'claude-fable-5-2', 'the alias still meant 5.1')
  assert.equal(c.upgrade('claude-opus-4-8'), 'opus')
  assert.equal(c.upgrade('opus'), undefined)
  assert.equal(c.upgrade('claude-fable-5-2'), undefined)
  assert.equal(c.upgrade('something-else'), undefined)
})

test('names and effort levels: of the menu, and of a model it no longer shows', async () => {
  const { c, t } = catalog(LISTED)
  await c.refresh()
  assert.equal(c.label('claude-opus-5-5'), 'Opus 5.5', 'an id finds its alias row')
  assert.equal(c.label('claude-opus-4-8'), 'Opus 4.8')
  assert.equal(c.label('custom-model'), 'custom-model')
  assert.equal(c.label(undefined), undefined)
  assert.deepEqual(c.efforts('opus'), all)
  assert.equal(c.stale(), false)
  t.now += 2 * 3600_000
  assert.equal(c.stale(), true)
})
