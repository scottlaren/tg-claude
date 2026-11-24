import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { resolveInRoot } from '../src/paths.ts'
import { readTextFile, writeTextFile, editTextFile, listFiles, readChunk } from '../src/files.ts'

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-')))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/a.txt'), 'one\ntwo\nthree\n')
  return root
}

const code = (code: string) => (e: unknown) => (e as { code: string }).code === code

test('resolveInRoot keeps paths inside the project', async () => {
  const root = project()
  assert.equal(await resolveInRoot(root, 'src/a.txt'), join(root, 'src', 'a.txt'))
  assert.equal(await resolveInRoot(root, 'src/new/deep.txt'), join(root, 'src', 'new', 'deep.txt'))
  await assert.rejects(resolveInRoot(root, '../outside.txt'), code('outside_root'))
  await assert.rejects(resolveInRoot(root, 'src/../../x'), code('outside_root'))
  await assert.rejects(resolveInRoot(root, tmpdir()), code('outside_root'))
})

test('resolveInRoot refuses a link that leads out of the project', async () => {
  const root = project()
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-out-')))
  // Junction on Windows works without admin rights, a plain dir symlink elsewhere
  symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(resolveInRoot(root, 'escape/secret.txt'), code('outside_root'))
})

test('read returns numbered slice and a hash', async () => {
  const root = project()
  const r = await readTextFile(root, { path: 'src/a.txt', offset: 2, limit: 1 })
  assert.deepEqual(r.lines, ['two'])
  assert.equal(r.totalLines, 4)
  assert.match(r.hash, /^[0-9a-f]{16}$/)
})

test('write never overwrites a file the caller has not read', async () => {
  const root = project()
  assert.equal((await writeTextFile(root, { path: 'src/new.txt', content: 'x' })).created, true)
  await assert.rejects(writeTextFile(root, { path: 'src/a.txt', content: 'x' }), code('exists'))
  await assert.rejects(writeTextFile(root, { path: 'src/a.txt', content: 'x', expectedHash: 'deadbeefdeadbeef' }), code('conflict'))
  const { hash } = await readTextFile(root, { path: 'src/a.txt' })
  await writeTextFile(root, { path: 'src/a.txt', content: 'fresh', expectedHash: hash })
  assert.equal(readFileSync(join(root, 'src/a.txt'), 'utf8'), 'fresh')
})

test('edit needs a unique match and the current hash', async () => {
  const root = project()
  writeFileSync(join(root, 'dup.txt'), 'a\na\n')
  const dup = await readTextFile(root, { path: 'dup.txt' })
  await assert.rejects(editTextFile(root, { path: 'dup.txt', oldString: 'a', newString: 'b', expectedHash: dup.hash, replaceAll: false }), code('not_unique'))
  await assert.rejects(editTextFile(root, { path: 'dup.txt', oldString: 'zzz', newString: 'b', expectedHash: dup.hash, replaceAll: false }), code('no_match'))
  const all = await editTextFile(root, { path: 'dup.txt', oldString: 'a', newString: '$&', expectedHash: dup.hash, replaceAll: true })
  assert.equal(all.replacements, 2)
  assert.equal(readFileSync(join(root, 'dup.txt'), 'utf8'), '$&\n$&\n')
  // The old hash is stale now
  await assert.rejects(editTextFile(root, { path: 'dup.txt', oldString: '$&', newString: 'c', expectedHash: dup.hash, replaceAll: true }), code('conflict'))
})

test('edit keeps CRLF line endings', async () => {
  const root = project()
  writeFileSync(join(root, 'win.txt'), 'first\r\nsecond\r\n')
  const { hash } = await readTextFile(root, { path: 'win.txt' })
  await editTextFile(root, { path: 'win.txt', oldString: 'first\nsecond', newString: 'one\ntwo', expectedHash: hash, replaceAll: false })
  assert.equal(readFileSync(join(root, 'win.txt'), 'utf8'), 'one\r\ntwo\r\n')
})

test('binary files are refused', async () => {
  const root = project()
  writeFileSync(join(root, 'img.bin'), Buffer.from([0x89, 0x50, 0x00, 0x01]))
  await assert.rejects(readTextFile(root, { path: 'img.bin' }), code('binary'))
})

test('a file to send comes in pieces with its type, the first one with the hash; secret ones are refused', async () => {
  const root = project()
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
  writeFileSync(join(root, 'shot.png'), png)
  const first = await readChunk(root, { path: 'shot.png', offset: 0, length: 4 })
  assert.deepEqual([first.name, first.mime, first.size, Buffer.from(first.data, 'base64')], ['shot.png', 'image/png', 6, png.subarray(0, 4)])
  assert.equal(first.sha256, createHash('sha256').update(png).digest('hex'))
  const rest = await readChunk(root, { path: 'shot.png', offset: 4, length: 4 })
  assert.deepEqual([Buffer.from(rest.data, 'base64'), rest.sha256, rest.mtime], [png.subarray(4), undefined, first.mtime])
  writeFileSync(join(root, '.env'), 'TOKEN=x')
  await assert.rejects(readChunk(root, { path: '.env', offset: 0, length: 4 }), code('outside_root'))
})

test('list skips the inside of node_modules', async () => {
  const root = project()
  mkdirSync(join(root, 'node_modules/pkg'), { recursive: true })
  const r = await listFiles(root, { path: '.', depth: 3 })
  const paths = r.entries.map(e => e.path)
  assert.ok(paths.includes('node_modules'))
  assert.ok(!paths.includes('node_modules/pkg'))
  assert.ok(paths.includes('src/a.txt'))
})

test('two edits made at once from the same read: one lands, the other is told the file changed', async () => {
  const root = project()
  const { hash } = await readTextFile(root, { path: 'src/a.txt' })
  const edit = (to: string) => editTextFile(root, { path: 'src/a.txt', oldString: 'two', newString: to, expectedHash: hash, replaceAll: false })
  const results = await Promise.allSettled([edit('TWO-A'), edit('TWO-B')])
  const ok = results.filter(r => r.status === 'fulfilled')
  const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
  assert.equal(ok.length, 1)
  assert.equal(failed.length, 1)
  assert.ok(code('conflict')(failed[0].reason))
  // Nothing was lost silently: the file holds exactly the edit that was reported as done
  const content = readFileSync(join(root, 'src/a.txt'), 'utf8')
  assert.ok(content === 'one\nTWO-A\nthree\n' || content === 'one\nTWO-B\nthree\n')
})

test('a file bigger than Telegram takes still goes over in pieces (moving a project), the server decides the limit', async () => {
  const root = project()
  writeFileSync(join(root, 'big.tar.gz'), Buffer.alloc(51 * 1024 * 1024, 7))
  const c = await readChunk(root, { path: 'big.tar.gz', offset: 0, length: 3 * 1024 * 1024 })
  assert.equal(c.size, 51 * 1024 * 1024)
  assert.ok(c.sha256)
})
