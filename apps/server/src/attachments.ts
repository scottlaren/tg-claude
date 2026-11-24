import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { tr } from './i18n.ts'

// Files from Telegram wait here until Claude saves them into a project on a computer (§15):
// removed after a successful save, otherwise after a day
export type Attachment = { id: string, key: string, name: string, mime: string, size: number, path: string, createdAt: number }

const TTL_MS = 24 * 60 * 60_000

// Keeps the name readable but never a path: no separators, no leading dots, bounded length
export function safeName(name: string) {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 100)
  return clean || 'file'
}

export function createInbox(dir: string, { now = Date.now }: { now?: () => number } = {}) {
  mkdirSync(dir, { recursive: true })
  const indexFile = join(dir, 'index.json')
  let index: Record<string, Attachment> = {}
  try {
    index = JSON.parse(readFileSync(indexFile, 'utf8'))
  } catch {}
  const save = () => {
    writeFileSync(indexFile + '.tmp', JSON.stringify(index, null, 2))
    renameSync(indexFile + '.tmp', indexFile)
  }

  function remove(id: string) {
    const a = index[id]
    if (!a) return
    rmSync(join(dir, id), { recursive: true, force: true })
    delete index[id]
    save()
  }

  function sweep() {
    for (const a of Object.values(index)) if (now() - a.createdAt > TTL_MS || !existsSync(a.path)) remove(a.id)
  }
  sweep()
  const timer = setInterval(sweep, 60 * 60_000)
  timer.unref()

  return {
    add(key: string, name: string, mime: string, data: Buffer): Attachment {
      const id = randomBytes(4).toString('hex')
      const folder = join(dir, id)
      mkdirSync(folder, { recursive: true })
      const path = join(folder, safeName(name))
      writeFileSync(path, data)
      const a = { id, key, name: safeName(name), mime, size: data.length, path, createdAt: now() }
      index[id] = a
      save()
      return a
    },
    get: (id: string): Attachment | undefined => index[id],
    remove,
    stats: () => Object.values(index).reduce((s, a) => ({ files: s.files + 1, bytes: s.bytes + a.size }), { files: 0, bytes: 0 }),
    // /cleanup: every file Telegram brought, saved to a computer or not
    clear() {
      const n = Object.keys(index).length
      for (const id of Object.keys(index)) remove(id)
      return n
    },
    sweep,
    close: () => clearInterval(timer),
  }
}

export type Inbox = ReturnType<typeof createInbox>

export const sizeLabel = (n: number) =>
  n < 1024 ? `${n} ${tr('B', 'Б')}` : n < 1024 * 1024 ? `${Math.round(n / 1024)} ${tr('KB', 'КБ')}` : `${(n / 1048576).toFixed(1)} ${tr('MB', 'МБ')}`
