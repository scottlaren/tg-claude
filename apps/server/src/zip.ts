import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

// Just enough of zip to take a skill apart and to pack files for the chat: stored and deflated files, no zip64, no encryption. What a user sends
// is someone else's archive, so names that climb out, links and sizes past the limits are refused, never written
export type ZipEntry = { path: string, data: Buffer }
export type ZipLimits = { files: number, bytes: number }

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const S_IFMT = 0o170000
const S_IFLNK = 0o120000

export const isZip = (b: Buffer) => b.length >= 4 && b.readUInt32LE(0) === LOCAL

// A path inside the archive, made safe to join to a folder, or null for one that isn't
export function safeEntryPath(name: string) {
  const parts = name.replace(/\\/g, '/').split('/').filter(p => p && p !== '.')
  if (!parts.length || /^[a-zA-Z]:/.test(parts[0]) || name.startsWith('/') || parts.some(p => p === '..')) return null
  return parts.join('/')
}

export function unzip(b: Buffer, limits: ZipLimits): ZipEntry[] {
  let end = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (b.readUInt32LE(i) === EOCD) { end = i; break }
  }
  if (end < 0) throw new Error('not a zip archive')
  const count = b.readUInt16LE(end + 10)
  if (count > limits.files) throw new Error(`more than ${limits.files} files`)
  let at = b.readUInt32LE(end + 16)
  let total = 0
  const out: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (at + 46 > b.length || b.readUInt32LE(at) !== CENTRAL) throw new Error('damaged zip archive')
    const flags = b.readUInt16LE(at + 8)
    const method = b.readUInt16LE(at + 10)
    const packed = b.readUInt32LE(at + 20)
    const size = b.readUInt32LE(at + 24)
    const nameLen = b.readUInt16LE(at + 28)
    const extraLen = b.readUInt16LE(at + 30)
    const commentLen = b.readUInt16LE(at + 32)
    const mode = b.readUInt32LE(at + 38) >>> 16
    const local = b.readUInt32LE(at + 42)
    const name = b.subarray(at + 46, at + 46 + nameLen).toString('utf8')
    at += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/') || (mode & S_IFMT) === S_IFLNK) continue
    const path = safeEntryPath(name)
    if (!path) throw new Error(`unsafe path in the archive: ${name}`)
    if (flags & 1) throw new Error('the archive is encrypted')
    total += size
    if (total > limits.bytes) throw new Error(`more than ${Math.round(limits.bytes / 1048576)} MB unpacked`)
    if (local + 30 > b.length || b.readUInt32LE(local) !== LOCAL) throw new Error('damaged zip archive')
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28)
    const raw = b.subarray(start, start + packed)
    const data = method === 0 ? Buffer.from(raw)
      : method === 8 ? inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) })
        : null
    if (!data) throw new Error(`unsupported compression in ${name}`)
    out.push({ path, data })
  }
  return out
}

// Files into one archive, deflated, UTF-8 names
export function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.path, 'utf8')
    const packed = deflateRawSync(e.data)
    const crc = crc32(e.data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(LOCAL, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x0800, 6)
    head.writeUInt16LE(8, 8)
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(packed.length, 18)
    head.writeUInt32LE(e.data.length, 22)
    head.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(e.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(head, name, packed)
    centrals.push(central, name)
    offset += 30 + name.length + packed.length
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(EOCD, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}
