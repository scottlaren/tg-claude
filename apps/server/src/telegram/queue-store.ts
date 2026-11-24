import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

// Messages waiting in topics outlive a restart: an update, or the server going down. Written only on the way out, read
// once on the way in. A file left from long ago, by a version that never came up, is about a moment that has passed
const MAX_AGE_MS = 2 * 3600_000

export function createQueueStore<T>(file: string, now = Date.now) {
  return {
    save(queues: Record<string, T[]>) {
      if (!Object.keys(queues).length) return rmSync(file, { force: true })
      writeFileSync(`${file}.tmp`, JSON.stringify({ at: now(), queues }))
      renameSync(`${file}.tmp`, file)
    },
    clear: () => rmSync(file, { force: true }),
    // Gone once read: a crash on the way back must not repeat what it was doing
    take(): Record<string, T[]> {
      try {
        const { at, queues } = JSON.parse(readFileSync(file, 'utf8')) as { at: number, queues: Record<string, T[]> }
        rmSync(file, { force: true })
        return now() - at > MAX_AGE_MS ? {} : queues
      } catch {
        return {}
      }
    },
  }
}
