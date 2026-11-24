import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createBackup, restoreBackup, pruneBackups, listBackups, parseKey } from '../src/backup.ts'

function serverData() {
  const data = mkdtempSync(join(tmpdir(), 'tgcv-data-'))
  writeFileSync(join(data, 'topics.json'), '{"1:2":{"profile":"work"}}')
  writeFileSync(join(data, 'devices.json'), '{"pc":{}}')
  writeFileSync(join(data, 'owners.json'), '{"ids":[42],"claimed":true}')
  mkdirSync(join(data, 'profiles', 'main', 'projects', 'cwd'), { recursive: true })
  mkdirSync(join(data, 'profiles', 'main', 'cache'), { recursive: true })
  writeFileSync(join(data, 'profiles', 'main', '.credentials.json'), '{"secret":1}')
  writeFileSync(join(data, 'profiles', 'main', 'projects', 'cwd', 's1.jsonl'), '{"type":"user"}\n')
  writeFileSync(join(data, 'profiles', 'main', 'cache', 'big.bin'), 'x')
  mkdirSync(join(data, 'inbox'))
  writeFileSync(join(data, 'inbox', 'a.zip'), 'temp')
  return data
}

test('a copy restores to a clean folder byte for byte, without temporary files', async () => {
  const data = serverData()
  const out = mkdtempSync(join(tmpdir(), 'tgcv-bk-'))
  const key = randomBytes(32)
  const b = await createBackup({ dataDir: data, outDir: out, key })
  // Encrypted: no secret in the clear
  assert.ok(!readFileSync(b.file).includes('secret'))
  const to = join(mkdtempSync(join(tmpdir(), 'tgcv-rs-')), 'restored')
  await restoreBackup(b.file, key, to)
  assert.equal(readFileSync(join(to, 'topics.json'), 'utf8'), '{"1:2":{"profile":"work"}}')
  assert.equal(readFileSync(join(to, 'profiles', 'main', '.credentials.json'), 'utf8'), '{"secret":1}')
  assert.equal(readFileSync(join(to, 'profiles', 'main', 'projects', 'cwd', 's1.jsonl'), 'utf8'), '{"type":"user"}\n')
  assert.equal(existsSync(join(to, 'inbox')), false)
  assert.equal(existsSync(join(to, 'profiles', 'main', 'cache')), false)
  // The owner too: without it a restored server is ownerless and the install's claim link works again
  assert.equal(readFileSync(join(to, 'owners.json'), 'utf8'), '{"ids":[42],"claimed":true}')
  assert.deepEqual(readdirSync(to).sort(), ['devices.json', 'owners.json', 'profiles', 'topics.json'])
})

test('a wrong key restores nothing; a non-empty target is refused', async () => {
  const data = serverData()
  const out = mkdtempSync(join(tmpdir(), 'tgcv-bk-'))
  const b = await createBackup({ dataDir: data, outDir: out, key: randomBytes(32) })
  const to = join(mkdtempSync(join(tmpdir(), 'tgcv-rs-')), 'restored')
  await assert.rejects(restoreBackup(b.file, randomBytes(32), to), /wrong key/)
  assert.equal(existsSync(to), false)
  await assert.rejects(restoreBackup(b.file, randomBytes(32), data), /not empty/)
})

test('seven days are kept, and always the newest copy', () => {
  const out = mkdtempSync(join(tmpdir(), 'tgcv-bk-'))
  for (const d of ['2026-10-01', '2026-10-21', '2026-10-28']) writeFileSync(join(out, `backup-${d}-0400.tgcv`), 'x')
  pruneBackups(out, new Date('2026-10-29T12:00:00Z'))
  assert.deepEqual(listBackups(out).map(b => basename(b.file)), ['backup-2026-10-28-0400.tgcv'])
  // Only old copies left: the newest survives anyway
  const lonely = mkdtempSync(join(tmpdir(), 'tgcv-bk-'))
  writeFileSync(join(lonely, 'backup-2026-09-01-0400.tgcv'), 'x')
  pruneBackups(lonely, new Date('2026-10-29T12:00:00Z'))
  assert.equal(listBackups(lonely).length, 1)
})

test('the key must be 32 bytes', () => {
  assert.equal(parseKey(undefined), undefined)
  assert.equal(parseKey(randomBytes(32).toString('base64'))!.length, 32)
  assert.throws(() => parseKey('c2hvcnQ='), /32 bytes/)
})

test('a restored server still knows its workspaces, its language and the surveys under way', async () => {
  const data = serverData()
  for (const f of ['workspaces.json', 'language.json', 'surveys.json']) writeFileSync(join(data, f), '{}')
  const out = mkdtempSync(join(tmpdir(), 'tgcv-bk-'))
  const key = randomBytes(32)
  const b = await createBackup({ dataDir: data, outDir: out, key })
  const to = join(mkdtempSync(join(tmpdir(), 'tgcv-rs-')), 'new')
  await restoreBackup(b.file, key, to)
  for (const f of ['workspaces.json', 'language.json', 'surveys.json']) assert.ok(existsSync(join(to, f)), f)
})
