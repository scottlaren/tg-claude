import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, realpathSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { putFileChunk } from '../src/files.ts'

const root = () => realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-put-')))
const code = (code: string) => (e: unknown) => (e as { code: string }).code === code
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

// Splits data the way the server does and sends every piece
async function put(dir: string, path: string, data: Buffer, size = 4, upload = 'u1') {
  let last
  for (let offset = 0; ; offset += size) {
    const chunk = data.subarray(offset, offset + size)
    const done = offset + chunk.length >= data.length
    last = await putFileChunk(dir, { path, upload, offset, data: chunk.toString('base64'), done, size: data.length, sha256: sha(data) })
    if (done) return last
  }
}

test('pieces come together into the file, nothing left behind', async () => {
  const dir = root()
  const data = Buffer.from('0123456789abcdef-zip-bytes')
  assert.deepEqual(await put(dir, 'assets/in/pack.zip', data), { path: 'assets/in/pack.zip', size: data.length })
  assert.deepEqual(readFileSync(join(dir, 'assets/in/pack.zip')), data)
  assert.deepEqual(readdirSync(join(dir, 'assets/in')), ['pack.zip'])
})

test('an empty file is one final piece', async () => {
  const dir = root()
  assert.deepEqual(await put(dir, 'empty.txt', Buffer.alloc(0)), { path: 'empty.txt', size: 0 })
  assert.equal(readFileSync(join(dir, 'empty.txt')).length, 0)
})

test('never overwrites an existing file', async () => {
  const dir = root()
  writeFileSync(join(dir, 'a.png'), 'mine')
  await assert.rejects(put(dir, 'a.png', Buffer.from('theirs')), code('exists'))
  assert.equal(readFileSync(join(dir, 'a.png'), 'utf8'), 'mine')
})

test('a name taken while the upload ran is not overwritten either', async () => {
  const dir = root()
  const data = Buffer.from('12345678')
  const sum = sha(data)
  await putFileChunk(dir, { path: 'b.bin', upload: 'u2', offset: 0, data: data.subarray(0, 4).toString('base64'), done: false, size: 8, sha256: sum })
  writeFileSync(join(dir, 'b.bin'), 'meanwhile')
  await assert.rejects(putFileChunk(dir, { path: 'b.bin', upload: 'u2', offset: 4, data: data.subarray(4).toString('base64'), done: true, size: 8, sha256: sum }), code('exists'))
  assert.equal(readFileSync(join(dir, 'b.bin'), 'utf8'), 'meanwhile')
  assert.deepEqual(readdirSync(dir), ['b.bin'])
})

test('a lost piece or a wrong hash leaves no file', async () => {
  const dir = root()
  const data = Buffer.from('abcdefgh')
  const sum = sha(data)
  await putFileChunk(dir, { path: 'c.bin', upload: 'u3', offset: 0, data: data.subarray(0, 4).toString('base64'), done: false, size: 8, sha256: sum })
  await assert.rejects(putFileChunk(dir, { path: 'c.bin', upload: 'u3', offset: 6, data: 'AA==', done: true, size: 8, sha256: sum }), code('conflict'))
  assert.deepEqual(readdirSync(dir), [])

  await assert.rejects(put(dir, 'd.bin', data, 4, 'u4').then(() => putFileChunk(dir, {
    path: 'e.bin', upload: 'u5', offset: 0, data: data.toString('base64'), done: true, size: 8, sha256: sha(Buffer.from('other')),
  })), code('failed'))
  assert.equal(existsSync(join(dir, 'e.bin')), false)
  assert.deepEqual(readdirSync(dir), ['d.bin'])
})

test('stays inside the project and away from secrets', async () => {
  const dir = root()
  await assert.rejects(put(dir, '../escape.zip', Buffer.from('x')), code('outside_root'))
  await assert.rejects(put(dir, '.env', Buffer.from('x')), code('outside_root'))
})

test('pieces of an upload nobody finished do not stay in the project for good', async t => {
  t.mock.timers.enable({ apis: ['Date'] })
  const dir = root()
  const parts = () => readdirSync(dir).filter(f => f.endsWith('.part'))
  const piece = (path: string, upload: string) => putFileChunk(dir, { path, upload, offset: 0, data: Buffer.from('half').toString('base64'), done: false, size: 8, sha256: 'x' })
  await piece('lost.zip', 'a')
  t.mock.timers.tick(30 * 60_000)
  await piece('going.zip', 'b')
  assert.equal(parts().length, 2, 'one that may still go on stays')
  t.mock.timers.tick(31 * 60_000)
  await put(dir, 'other.txt', Buffer.from('hello'))
  assert.deepEqual(parts(), ['.going.zip.b.part'], 'the one left for over an hour is gone')
})
