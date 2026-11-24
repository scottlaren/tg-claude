import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs, { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { notesIn, createUpdates, repoOf } from '../src/updates.ts'

// GitHub's answers by path; anything else is a 404
const github = (answers: Record<string, unknown>) => (async (url: string) => {
  const path = String(url).replace('https://api.github.com/repos/scottlaren/tg-claude/', '')
  return path in answers ? new Response(JSON.stringify(answers[path]), { status: 200 }) : new Response('{}', { status: 404 })
}) as typeof fetch

function setup(answers: Record<string, unknown>, current = '0.1.2') {
  const base = mkdtempSync(join(tmpdir(), 'tgcv-updates-'))
  let t = 1_000_000
  const u = createUpdates({ repo: 'scottlaren/tg-claude', current, stateFile: join(base, 'updates.json'), dir: join(base, 'update'), fetch: github(answers), now: () => t })
  return { u, base, tick: (ms: number) => { t += ms } }
}

test('the repo name comes from the address the installer clones', () => {
  assert.equal(repoOf('https://github.com/scottlaren/tg-claude.git'), 'scottlaren/tg-claude')
  assert.equal(repoOf('git@github.com:someone/fork'), 'someone/fork')
  assert.equal(repoOf('https://example.com/x.git'), null)
})

test('release notes come in the language of the bot, each cut on its own', () => {
  const both = '- **New.** Text.\n\n### Русский\n\n- **Новое.** Текст.\n'
  assert.equal(notesIn(both, 'en'), '- **New.** Text.')
  assert.equal(notesIn(both, 'ru'), '- **Новое.** Текст.')
  // A release from before the split: its one text in any language
  assert.equal(notesIn('- Old', 'ru'), '- Old')
  assert.equal(notesIn('- Old', 'en'), '- Old')
  const long = `${'- line\n'.repeat(1000)}### Русский\n\n- Новое`
  assert.equal(notesIn(long, 'ru'), '- Новое')
  assert.ok(notesIn(long, 'en').endsWith('…') && notesIn(long, 'en').length <= 1200)
})

test('the newest release comes with its notes; without releases, the highest version tag', async () => {
  const withRelease = setup({ 'releases/latest': { tag_name: 'v0.2.0', body: '- Обновления\n- Ещё', html_url: 'https://github.com/r/v0.2.0' } })
  assert.deepEqual(await withRelease.u.latest(), { version: '0.2.0', tag: 'v0.2.0', notes: '- Обновления\n- Ещё', url: 'https://github.com/r/v0.2.0' })
  const tagsOnly = setup({ 'tags?per_page=100': [{ name: 'v0.9.0' }, { name: 'v0.10.0' }, { name: 'nightly' }] })
  assert.equal((await tagsOnly.u.latest())?.tag, 'v0.10.0')
  // GitHub down or rate-limited: nothing to say, nothing thrown
  assert.equal(await setup({}).u.latest(), null)
  const down = createUpdates({ repo: 'a/b', current: '0.1.2', stateFile: join(mkdtempSync(join(tmpdir(), 'tgcv-u-')), 's.json'), fetch: (async () => { throw new Error('offline') }) as typeof fetch })
  assert.equal(await down.latest(), null)
})

test('the owners hear of a release once; «tomorrow» brings it back a day later; a skipped one never', async () => {
  const { u, tick } = setup({})
  const r = { version: '0.2.0', tag: 'v0.2.0', notes: '', url: '' }
  assert.equal(u.due({ ...r, version: '0.1.2' }), false)
  assert.equal(u.due(r), true)
  u.notified('0.2.0')
  assert.equal(u.due(r), false)
  u.remindLater()
  tick(23 * 3600_000)
  assert.equal(u.due(r), false)
  tick(2 * 3600_000)
  assert.equal(u.due(r), true)
  u.skip('0.2.0')
  assert.equal(u.due(r), false)
  // A newer one after a skipped one is news again
  assert.equal(u.due({ ...r, version: '0.2.1' }), true)
})

test('the helper\'s folder: a request carries only the tag, the result is read once, alive names this version', () => {
  const { u, base } = setup({})
  const dir = join(base, 'update')
  assert.equal(u.helper(), false)
  mkdirSync(dir)
  writeFileSync(join(dir, 'ready'), '1')
  assert.equal(u.helper(), true)
  u.request('v0.2.0')
  assert.equal(JSON.parse(readFileSync(join(dir, 'request'), 'utf8')).tag, 'v0.2.0')
  assert.equal(u.result(), null)
  writeFileSync(join(dir, 'result'), JSON.stringify({ ok: true, from: '0.1.2', to: '0.2.0' }))
  assert.deepEqual(u.result(), { ok: true, from: '0.1.2', to: '0.2.0' })
  u.clearResult()
  assert.equal(existsSync(join(dir, 'result')), false)
  u.alive()
  assert.equal(readFileSync(join(dir, 'alive'), 'utf8'), '0.1.2')
})

test('each computer is asked once per release', () => {
  const { u } = setup({})
  assert.equal(u.agentTried('pc', '0.2.0'), false)
  u.markAgent('pc', '0.2.0')
  assert.equal(u.agentTried('pc', '0.2.0'), true)
  assert.equal(u.agentTried('mac', '0.2.0'), false)
  assert.equal(u.agentTried('pc', '0.2.1'), false)
})

test('on the VPS releases come from the helper\'s files, never from GitHub directly: the container has no token', async () => {
  let asked = 0
  const base = mkdtempSync(join(tmpdir(), 'tgcv-updates-h-'))
  const dir = join(base, 'update')
  mkdirSync(dir)
  writeFileSync(join(dir, 'ready'), '1')
  const u = createUpdates({ repo: 'scottlaren/tg-claude', current: '0.1.2', stateFile: join(base, 's.json'), dir, fetch: (async () => { asked++; return new Response('{}') }) as typeof fetch })
  assert.equal(await u.latest(), null)
  // git ls-remote --tags, as the helper leaves it
  writeFileSync(join(dir, 'tags.txt'), 'aaa\trefs/tags/v0.1.2\nbbb\trefs/tags/v0.1.2^{}\nccc\trefs/tags/v0.10.0\nddd\trefs/tags/v0.10.0^{}\neee\trefs/tags/nightly\n')
  assert.equal((await u.latest())?.tag, 'v0.10.0')
  // A GitHub Release, when there is one, brings its notes
  writeFileSync(join(dir, 'release.json'), JSON.stringify({ tag_name: 'v0.10.0', body: 'Что нового', html_url: 'https://github.com/x' }))
  assert.equal((await u.latest())?.notes, 'Что нового')
  assert.equal(asked, 0)
  // A fresh look: the helper is asked, and the wait ends once it has answered
  setTimeout(() => writeFileSync(join(dir, 'tags.txt'), 'fff\trefs/tags/v0.11.0\n'), 200)
  await u.refresh(5000)
  assert.equal(existsSync(join(dir, 'check')), true)
  // A tag newer than the last Release wins, without notes
  assert.deepEqual(await u.latest(), { version: '0.11.0', tag: 'v0.11.0', notes: '', url: 'https://github.com/scottlaren/tg-claude/releases/tag/v0.11.0' })
  rmSync(join(dir, 'tags.txt'))
  assert.equal((await u.latest())?.tag, 'v0.10.0')
})

test('a fresh look waits for the release notes too, not only the tags: an older helper writes them a moment later', async () => {
  const base = mkdtempSync(join(tmpdir(), 'tgcv-updates-r-'))
  const dir = join(base, 'update')
  mkdirSync(dir)
  writeFileSync(join(dir, 'ready'), '1')
  // What the last look left: 0.2.0 with its notes
  writeFileSync(join(dir, 'tags.txt'), 'a\trefs/tags/v0.2.0\n')
  writeFileSync(join(dir, 'release.json'), JSON.stringify({ tag_name: 'v0.2.0', body: 'старое' }))
  const u = createUpdates({ repo: 'scottlaren/tg-claude', current: '0.2.0', stateFile: join(base, 's.json'), dir })
  // The helper answers: tags first, notes 400 ms later
  setTimeout(() => writeFileSync(join(dir, 'tags.txt'), 'a\trefs/tags/v0.2.0\nb\trefs/tags/v0.2.1\n'), 200)
  setTimeout(() => writeFileSync(join(dir, 'release.json'), JSON.stringify({ tag_name: 'v0.2.1', body: 'Вход кнопкой' })), 600)
  await u.refresh(5000)
  assert.equal((await u.latest())?.notes, 'Вход кнопкой')
})

test('the message about an update outlives the restart, and is handed over once', () => {
  const stateFile = join(mkdtempSync(join(tmpdir(), 'tgcv-update-note-')), 'updates.json')
  const make = () => createUpdates({ repo: 'o/r', current: '1.0.0', stateFile })
  const before = make()
  assert.equal(before.takeMessage(), null)
  before.noteMessage({ chatId: 5, messageId: 77 })
  const after = make()
  assert.deepEqual(after.takeMessage(), { chatId: 5, messageId: 77 })
  assert.equal(after.takeMessage(), null)
  assert.equal(make().takeMessage(), null)
})

// The power goes in the middle of a write: what reached the disk is half of it
function cutOffDuring(work: () => void) {
  const real = fs.writeFileSync
  fs.writeFileSync = ((file: string, data: string) => {
    real(file, String(data).slice(0, 5))
    throw new Error('power cut')
  }) as typeof fs.writeFileSync
  syncBuiltinESMExports()
  try {
    assert.throws(work, /power cut/)
  } finally {
    fs.writeFileSync = real
    syncBuiltinESMExports()
  }
}

test('a write cut off half way leaves the last state whole, and asks the helper for nothing', () => {
  const base = mkdtempSync(join(tmpdir(), 'tgcv-u-'))
  const stateFile = join(base, 'updates.json')
  const dir = join(base, 'update')
  mkdirSync(dir)
  const u = createUpdates({ repo: 'a/b', current: '0.1.0', stateFile, dir })
  u.notified('0.2.0')
  cutOffDuring(() => u.skip('0.2.0'))
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).notified, '0.2.0')
  cutOffDuring(() => u.request('v0.2.0'))
  assert.equal(existsSync(join(dir, 'request')), false, 'the helper starts as soon as this file exists')
  u.request('v0.2.0')
  assert.equal(JSON.parse(readFileSync(join(dir, 'request'), 'utf8')).tag, 'v0.2.0')
})
