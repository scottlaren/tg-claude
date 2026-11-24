import { createHash, randomBytes } from 'node:crypto'
import { FILE_CHUNK_BYTES, type FileChunk, type FilePut, type OpError } from '@tgcv/protocol'
import type { OpOutcome } from './gateway.ts'
import { tr } from './i18n.ts'

export type Pulled = { name: string, size: number, mime: string, data: Buffer }
type Get = (params: { path: string, offset: number, length: number }) => Promise<OpOutcome>
type Put = (params: FilePut) => Promise<OpOutcome>
type Failed = { ok: false, error: OpError }

// The link dropped or the device is reconnecting: the same piece is asked for again (§15)
const TRANSIENT = new Set(['offline', 'unknown', 'expired'])

// One piece at offset. Every piece must come from the same version of the file as the first (size and
// time) and be exactly the asked length, shorter only at the end: a short one would crawl or loop.
// Nothing is retried blindly: reading is safe to repeat, so a lost piece is simply read again
async function piece(get: Get, path: string, offset: number, first: FileChunk | undefined, { attempts = 5, pause = 2000 } = {}):
  Promise<{ ok: true, chunk: FileChunk, data: Buffer } | Failed> {
  let out: OpOutcome | undefined
  for (let i = 0; i < attempts; i++) {
    out = await get({ path, offset, length: FILE_CHUNK_BYTES })
    if (out.ok || !TRANSIENT.has(out.error.code)) break
    await new Promise(r => setTimeout(r, pause))
  }
  if (!out!.ok) return out as Failed
  const chunk = out!.result as FileChunk
  const ref = first ?? chunk
  if (chunk.size !== ref.size || chunk.mtime !== ref.mtime) {
    return { ok: false, error: { code: 'conflict', message: tr(
      `${ref.name} changed during the transfer: wait until it is fully written and send it again`,
      `${ref.name} изменился во время передачи: дождись, пока он допишется, и отправь снова`) } }
  }
  const data = Buffer.from(chunk.data, 'base64')
  if (data.length !== Math.min(FILE_CHUNK_BYTES, ref.size - offset)) {
    return { ok: false, error: { code: 'failed', message: tr(`${ref.name}: the transfer broke off at ${offset} of ${ref.size} bytes`, `${ref.name}: передача оборвалась на ${offset} из ${ref.size} байт`) } }
  }
  return { ok: true, chunk, data }
}

// A file from the computer, piece by piece (§15); the whole must match the hash the first piece brought
// maxBytes is checked on the first piece, before anything big is pulled; tooBig says what to do instead
export async function pullFile(get: Get, path: string, { maxBytes = Infinity, tooBig, ...opts }: { attempts?: number, pause?: number, maxBytes?: number, tooBig?: string } = {}): Promise<{ ok: true, file: Pulled } | Failed> {
  const parts: Buffer[] = []
  let first: FileChunk | undefined
  let received = 0
  do {
    const p = await piece(get, path, received, first, opts)
    if (!p.ok) return p
    first ??= p.chunk
    // Known from the first piece: a file too big for the purpose is not pulled at all
    if (first.size > maxBytes) {
      const mb = (n: number) => (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)
      return { ok: false, error: { code: 'bad_request', message: tr(`${first.name}: ${mb(first.size)} MB, the limit is ${mb(maxBytes)} MB.`, `${first.name}: ${mb(first.size)} МБ, предел ${mb(maxBytes)} МБ.`) + (tooBig ? ` ${tooBig}` : '') } }
    }
    parts.push(p.data)
    received += p.data.length
  } while (received < first.size)
  const data = Buffer.concat(parts)
  if (createHash('sha256').update(data).digest('hex') !== first.sha256) {
    return { ok: false, error: { code: 'failed', message: tr(`${first.name} arrived damaged: the hash did not match`, `${first.name} пришёл повреждённым: хеш не совпал`) } }
  }
  return { ok: true, file: { name: first.name, size: first.size, mime: first.mime, data } }
}

// A file from one device straight to another through the server, piece by piece: the server never holds
// it whole, the receiver checks size and hash before the file appears (§15)
export async function relayFile(get: Get, put: Put, from: string, to: string, {
  onProgress, maxBytes = Infinity, signal, ...opts
}: { onProgress?: (sent: number, size: number) => void, maxBytes?: number, signal?: AbortSignal, attempts?: number, pause?: number } = {}): Promise<{ ok: true, size: number } | Failed> {
  const upload = randomBytes(6).toString('hex')
  let first: FileChunk | undefined
  let sent = 0
  do {
    if (signal?.aborted) return { ok: false, error: { code: 'cancelled', message: tr('Stopped by the user', 'Остановлено') } }
    const p = await piece(get, from, sent, first, opts)
    if (!p.ok) return p
    first ??= p.chunk
    if (first.size > maxBytes) return { ok: false, error: { code: 'bad_request', message: tr(`${first.name}: ${first.size} bytes, over the limit of ${maxBytes}`, `${first.name}: ${first.size} байт, больше предела ${maxBytes}`) } }
    const done = sent + p.data.length >= first.size
    const out = await put({ path: to, upload, offset: sent, data: p.chunk.data, done, size: first.size, sha256: first.sha256! })
    if (!out.ok) return out as Failed
    sent += p.data.length
    onProgress?.(sent, first.size)
  } while (sent < first.size)
  return { ok: true, size: first.size }
}
