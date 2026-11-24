import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, utimesSync, realpathSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { pullFile, relayFile } from '../src/transfer.ts'
import { readChunk, putFileChunk } from '../../agent/src/files.ts'
import type { FilePut } from '@tgcv/protocol'
import type { OpOutcome } from '../src/gateway.ts'

const project = () => realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-pull-')))
// The device side as the executor runs it: errors become outcomes like on the wire
const device = (root: string) => async (p: { path: string, offset: number, length: number }): Promise<OpOutcome> => {
  try {
    return { ok: true, result: await readChunk(root, p) }
  } catch (e) {
    return { ok: false, error: { code: (e as { code: 'failed' }).code ?? 'failed', message: (e as Error).message } }
  }
}

test('a file bigger than one piece arrives whole, byte for byte', async () => {
  const root = project()
  const data = randomBytes(7 * 1024 * 1024 + 123) // three pieces of 3 MB
  writeFileSync(join(root, 'render.mp4'), data)
  let calls = 0
  const get = device(root)
  const r = await pullFile(p => (calls++, get(p)), 'render.mp4')
  assert.ok(r.ok)
  assert.equal(calls, 3)
  assert.deepEqual([r.file.name, r.file.mime, r.file.size], ['render.mp4', 'video/mp4', data.length])
  assert.ok(r.file.data.equals(data))
})

test('a lost piece is asked for again from the same place', async () => {
  const root = project()
  const data = randomBytes(4 * 1024 * 1024)
  writeFileSync(join(root, 'a.zip'), data)
  const get = device(root)
  let dropped = false
  const offsets: number[] = []
  const r = await pullFile(async p => {
    offsets.push(p.offset)
    if (p.offset > 0 && !dropped) {
      dropped = true
      return { ok: false, error: { code: 'offline', message: 'link dropped' } }
    }
    return get(p)
  }, 'a.zip', { pause: 1 })
  assert.ok(r.ok && r.file.data.equals(data))
  assert.deepEqual(offsets, [0, 3 * 1024 * 1024, 3 * 1024 * 1024])
})

test('a file that changes mid-way or comes damaged is refused, a missing one says so', async () => {
  const root = project()
  writeFileSync(join(root, 'log.txt'), randomBytes(4 * 1024 * 1024))
  const get = device(root)
  const changing = await pullFile(async p => {
    if (p.offset > 0) utimesSync(join(root, 'log.txt'), new Date(), new Date(Date.now() + 5000))
    return get(p)
  }, 'log.txt')
  assert.ok(!changing.ok && changing.error.code === 'conflict')

  // Same length, one byte flipped: only the hash can tell
  const damaged = await pullFile(async p => {
    const out = await get(p)
    if (out.ok && p.offset > 0) {
      const c = out.result as { data: string }
      const b = Buffer.from(c.data, 'base64')
      b[0] ^= 0xff
      c.data = b.toString('base64')
    }
    return out
  }, 'log.txt')
  assert.ok(!damaged.ok && /hash/.test(damaged.error.message))

  // A piece cut short is refused at once instead of crawling on
  const short = await pullFile(async p => {
    const out = await get(p)
    if (out.ok && p.offset > 0) (out.result as { data: string }).data = Buffer.alloc(10).toString('base64')
    return out
  }, 'log.txt')
  assert.ok(!short.ok && /broke off/.test(short.error.message))

  const missing = await pullFile(get, 'nope.png')
  assert.ok(!missing.ok && missing.error.code === 'not_found')
})

test('a project archive goes from the cloud to a computer piece by piece and arrives whole', async () => {
  const cloud = project()
  const pc = project()
  const data = randomBytes(7 * 1024 * 1024 + 5)
  writeFileSync(join(cloud, 'move.tar.gz'), data)
  const put = async (p: FilePut): Promise<OpOutcome> => {
    try {
      return { ok: true, result: await putFileChunk(pc, p) }
    } catch (e) {
      return { ok: false, error: { code: (e as { code: 'failed' }).code ?? 'failed', message: (e as Error).message } }
    }
  }
  const progress: number[] = []
  const r = await relayFile(device(cloud), put, 'move.tar.gz', 'move.tar.gz', { onProgress: sent => progress.push(sent) })
  assert.deepEqual(r, { ok: true, size: data.length })
  assert.ok(readFileSync(join(pc, 'move.tar.gz')).equals(data))
  assert.equal(progress.length, 3)

  writeFileSync(join(cloud, 'big.tar.gz'), randomBytes(1000))
  const big = await relayFile(device(cloud), put, 'big.tar.gz', 'big.tar.gz', { maxBytes: 999 })
  assert.equal(big.ok, false)
  assert.equal(existsSync(join(pc, 'big.tar.gz')), false)
})

test('a file too big for its use is refused on the first piece, before anything else is pulled', async () => {
  const root = project()
  writeFileSync(join(root, 'render.mp4'), randomBytes(7 * 1024 * 1024))
  let calls = 0
  const get = device(root)
  const r = await pullFile(p => (calls++, get(p)), 'render.mp4', { maxBytes: 5 * 1024 * 1024, tooBig: 'Telegram takes up to 50 MB from a bot' })
  assert.equal(r.ok, false)
  assert.match(!r.ok ? r.error.message : '', /render\.mp4: 7\.0 MB, the limit is 5\.0 MB\. Telegram/)
  assert.equal(calls, 1)
})
