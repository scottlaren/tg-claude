import { readFile, writeFile, appendFile, rename, rm, mkdir, readdir, stat, link, copyFile, constants, open } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { dirname, basename, join, extname } from 'node:path'
import { FILE_GET_MAX_BYTES, type ToolInput, type ToolResult, type FileEntry, type FilePut, type FileChunk } from '@tgcv/protocol'
import { resolveInRoot, toPosix, ToolError, type Roots } from './paths.ts'

const MAX_ENTRIES = 1000
const DEFAULT_LINES = 2000
// Listed but never descended into: huge and rarely what Claude is after
const SKIP_DIRS = new Set(['.git', 'node_modules'])

export const hashOf = (buf: Buffer) => createHash('sha256').update(buf).digest('hex').slice(0, 16)

const isBinary = (buf: Buffer) => buf.subarray(0, 8192).includes(0)

async function readText(file: string) {
  const buf = await readFile(file).catch(e => {
    throw new ToolError(e.code === 'ENOENT' ? 'not_found' : 'failed', `Cannot read: ${e.message}`)
  })
  if (isBinary(buf)) throw new ToolError('binary', 'Binary file: text operations do not apply to it')
  const raw = buf.toString('utf8')
  // Claude works with \n; the file keeps its own line endings on write
  return { buf, text: raw.replace(/\r\n/g, '\n'), eol: raw.includes('\r\n') ? '\r\n' : '\n' }
}

function checkHash(actual: string, expected: string | undefined, path: string) {
  if (expected !== actual) {
    throw new ToolError('conflict', `File ${path} changed after it was read (hash ${actual}). Read it again and retry`)
  }
}

// Temp file + rename in the same folder, so a crash never leaves half a file
async function atomicWrite(file: string, data: string) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = join(dirname(file), `.${basename(file)}.${randomBytes(4).toString('hex')}.tmp`)
  try {
    await writeFile(tmp, data)
    await rename(tmp, file)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
  return hashOf(Buffer.from(data))
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.log': 'text/plain', '.json': 'application/json', '.zip': 'application/zip',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.svg': 'image/svg+xml',
}

const sha256Of = async (file: string) => {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk)
  return h.digest('hex')
}

// One piece of a file on its way to Telegram (§15); the first piece also carries the hash of the whole file
export async function readChunk(root: string | Roots, input: { path: string, offset: number, length: number }): Promise<FileChunk> {
  const file = await resolveInRoot(root, input.path)
  const st = await stat(file).catch(() => null)
  if (!st?.isFile()) throw new ToolError('not_found', `No such file: ${input.path}`)
  if (st.size > FILE_GET_MAX_BYTES) {
    throw new ToolError('bad_request', `${basename(file)}: ${(st.size / 1048576).toFixed(1)} MB, over 1 GB: a file this big is not sent from the computer`)
  }
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(Math.max(0, Math.min(input.length, st.size - input.offset)))
    await fh.read(buf, 0, buf.length, input.offset)
    return {
      name: basename(file), size: st.size, mime: MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', mtime: st.mtimeMs,
      ...(input.offset === 0 && { sha256: await sha256Of(file) }),
      data: buf.toString('base64'),
    }
  } finally {
    await fh.close()
  }
}

export async function listFiles(root: string | Roots, input: ToolInput<'list_files'>): Promise<ToolResult['list_files']> {
  const start = await resolveInRoot(root, input.path)
  const entries: FileEntry[] = []
  let truncated = false
  async function walk(dir: string, level: number) {
    const items = await readdir(dir, { withFileTypes: true }).catch(e => {
      throw new ToolError(e.code === 'ENOENT' ? 'not_found' : 'failed', `Cannot read the folder: ${e.message}`)
    })
    items.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const it of items) {
      if (entries.length >= MAX_ENTRIES) {
        truncated = true
        return
      }
      const full = join(dir, it.name)
      if (it.isDirectory()) {
        entries.push({ path: toPosix(root, full), type: 'dir' })
        if (level < input.depth && !SKIP_DIRS.has(it.name)) await walk(full, level + 1)
      } else if (it.isFile()) {
        const size = await stat(full).then(s => s.size, () => undefined)
        entries.push({ path: toPosix(root, full), type: 'file', size })
      }
    }
  }
  await walk(start, 1)
  return { entries, truncated }
}

export async function readTextFile(root: string | Roots, input: ToolInput<'read_file'>): Promise<ToolResult['read_file']> {
  const file = await resolveInRoot(root, input.path)
  const { buf, text } = await readText(file)
  const all = text.split('\n')
  const offset = input.offset ?? 1
  return {
    lines: all.slice(offset - 1, offset - 1 + (input.limit ?? DEFAULT_LINES)),
    offset,
    totalLines: all.length,
    hash: hashOf(buf),
  }
}

// Changes to one file go one at a time: two edits made from the same read would both pass the hash check and the
// later write would silently undo the earlier one. In turn, the second sees the file has changed
const queues = new Map<string, Promise<unknown>>()
async function oneAtATime<T>(file: string, work: () => Promise<T>): Promise<T> {
  const key = process.platform === 'win32' ? file.toLowerCase() : file
  const turn = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work)
  queues.set(key, turn)
  try {
    return await turn
  } finally {
    if (queues.get(key) === turn) queues.delete(key)
  }
}

export async function writeTextFile(root: string | Roots, input: ToolInput<'write_file'>): Promise<ToolResult['write_file']> {
  const file = await resolveInRoot(root, input.path, { write: true })
  return oneAtATime(file, () => writeChecked(file, input))
}

async function writeChecked(file: string, input: ToolInput<'write_file'>): Promise<ToolResult['write_file']> {
  const current = await readFile(file).catch(e => (e.code === 'ENOENT' ? null : Promise.reject(e)))
  if (current === null) {
    if (input.expectedHash) throw new ToolError('conflict', `File ${input.path} was deleted after it was read`)
    return { hash: await atomicWrite(file, input.content), created: true }
  }
  // Never overwrite silently: the caller must have seen the current version
  if (!input.expectedHash) {
    throw new ToolError('exists', `File ${input.path} already exists: read it and pass expectedHash`)
  }
  if (isBinary(current)) throw new ToolError('binary', 'Binary file: text operations do not apply to it')
  checkHash(hashOf(current), input.expectedHash, input.path)
  const eol = current.toString('utf8').includes('\r\n') ? '\r\n' : '\n'
  return { hash: await atomicWrite(file, input.content.replace(/\r?\n/g, eol)), created: false }
}

export async function editTextFile(root: string | Roots, input: ToolInput<'edit_file'>): Promise<ToolResult['edit_file']> {
  const file = await resolveInRoot(root, input.path, { write: true })
  return oneAtATime(file, () => editChecked(file, input))
}

async function editChecked(file: string, input: ToolInput<'edit_file'>): Promise<ToolResult['edit_file']> {
  const { buf, text, eol } = await readText(file)
  checkHash(hashOf(buf), input.expectedHash, input.path)
  const oldStr = input.oldString.replace(/\r\n/g, '\n')
  const newStr = input.newString.replace(/\r\n/g, '\n')
  const count = text.split(oldStr).length - 1
  if (count === 0) throw new ToolError('no_match', 'oldString not found in the file')
  if (count > 1 && !input.replaceAll) {
    throw new ToolError('not_unique', `oldString occurs ${count} times: add context or use replaceAll`)
  }
  // split/join instead of String.replace: no special meaning for $& and friends
  const next = input.replaceAll
    ? text.split(oldStr).join(newStr)
    : text.slice(0, text.indexOf(oldStr)) + newStr + text.slice(text.indexOf(oldStr) + oldStr.length)
  return { hash: await atomicWrite(file, next.replace(/\n/g, eol)), replacements: input.replaceAll ? count : 1 }
}

// A file from the server in pieces (attachments from Telegram, §15): collected in a hidden .part next
// to the target, checked against size and hash, then put in place. An existing file is never replaced
// A restart of the server or a Stop in the middle leaves its pieces in the user's project, where git status shows them
const UPLOAD_IDLE_MS = 3600_000
const uploads = new Map<string, number>()
async function dropAbandoned() {
  for (const [part, at] of uploads) {
    if (Date.now() - at <= UPLOAD_IDLE_MS) continue
    uploads.delete(part)
    await rm(part, { force: true })
  }
}

export async function putFileChunk(root: string | Roots, p: FilePut): Promise<ToolResult['save_attachment'] | { received: number }> {
  const file = await resolveInRoot(root, p.path, { write: true })
  const part = join(dirname(file), `.${basename(file)}.${p.upload}.part`)
  await dropAbandoned()
  uploads.set(part, Date.now())
  const taken = () => new ToolError('exists', `${toPosix(root, file)} already exists: pick another name`)
  const data = Buffer.from(p.data, 'base64')
  if (p.offset === 0) {
    if (await stat(file).then(() => true, () => false)) throw taken()
    await mkdir(dirname(file), { recursive: true })
    await writeFile(part, data)
  } else {
    // Pieces arrive in order; a gap means a piece was lost and the upload starts over
    const have = (await stat(part).catch(() => null))?.size
    if (have !== p.offset) {
      await rm(part, { force: true })
      throw new ToolError('conflict', `The transfer broke off at ${have ?? 0} of ${p.size} bytes: start over`)
    }
    await appendFile(part, data)
  }
  if (!p.done) return { received: p.offset + data.length }
  try {
    const all = await readFile(part)
    if (all.length !== p.size || createHash('sha256').update(all).digest('hex') !== p.sha256) {
      throw new ToolError('failed', 'The file arrived damaged: the size or hash did not match')
    }
    // link fails if the name got taken meanwhile; copy with EXCL where hard links are not supported
    await link(part, file).catch(async e => {
      if (e.code === 'EEXIST') throw taken()
      await copyFile(part, file, constants.COPYFILE_EXCL).catch(e2 => {
        throw e2.code === 'EEXIST' ? taken() : e2
      })
    })
    return { path: toPosix(root, file), size: all.length }
  } finally {
    uploads.delete(part)
    await rm(part, { force: true })
  }
}
