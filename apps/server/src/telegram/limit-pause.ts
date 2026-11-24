import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

// Work put off until Claude's limit resets, on disk so that a restart in those hours loses none of it. Two kinds:
// a turn the limit cut off, which holds its topic until it goes on, and a task sent with /fresh, which leaves the topic free
export type Pause = {
  id: string
  key: string
  // When it goes on
  until: number
  profile: string
  text: string
  // How many times in a row the limit has stopped this
  attempts: number
  fresh?: boolean
  fromMode?: string
  // The user has been told that what they write waits for this
  told?: boolean
  // Kept in memory only: a restart in those hours goes on without them, and Claude has the session
  images?: unknown[]
}

export const MAX_LIMIT_ATTEMPTS = 6
// The reset isn't known, or it has passed and the limit still stands
export const UNKNOWN_RESET_MS = 30 * 60_000
const TEXT_MAX = 20_000

const RESUME = "[Claude's usage limit ran out during your last turn and has reset now. Go on from where you stopped, without redoing what is done. What was asked:]"
export const resumePrompt = (text: string) => (text.startsWith(RESUME) ? text : `${RESUME}\n${text}`)

// A reset in the past says nothing about when this will work
export const untilOf = (reset: number | undefined, now: number) => (reset && reset > now ? reset : now + UNKNOWN_RESET_MS)

export function createPauses(file: string, { now = Date.now, warn = (_m: string) => {} } = {}) {
  let list: Pause[] = []
  try {
    list = JSON.parse(readFileSync(file, 'utf8'))
  } catch {}
  const save = () => {
    // A turn must not fail over its record: the worst of this is a task a restart doesn't pick up
    try {
      writeFileSync(`${file}.tmp`, JSON.stringify(list.map(({ images: _images, ...p }) => p)))
      renameSync(`${file}.tmp`, file)
    } catch (e) {
      warn((e as Error).message)
    }
  }
  const without = (gone: (p: Pause) => boolean) => {
    const dropped = list.filter(gone)
    if (!dropped.length) return dropped
    list = list.filter(p => !gone(p))
    save()
    return dropped
  }

  return {
    add(p: Omit<Pause, 'id'>) {
      const made = { ...p, id: randomBytes(4).toString('hex'), text: p.text.slice(0, TEXT_MAX) }
      // A topic has one turn that was cut off
      if (!p.fresh) list = list.filter(x => x.key !== p.key || x.fresh)
      list.push(made)
      save()
      return made
    },
    // The turn the limit cut off, which what is written in the topic waits behind
    holding: (key: string) => list.find(p => p.key === key && !p.fresh),
    get: (id: string) => list.find(p => p.id === id),
    told(id: string) {
      const p = list.find(x => x.id === id)
      if (p) p.told = true
    },
    drop: (id: string) => without(p => p.id === id)[0],
    dropHolding: (key: string) => without(p => p.key === key && !p.fresh)[0],
    dropTopic: (key: string) => without(p => p.key === key),
    dropChat: (chatId: number) => without(p => p.key.startsWith(`${chatId}:`)),
    // What is due, taken off the list: each goes on once
    due: (graceMs = 0) => without(p => p.until + graceMs <= now()),
    list: () => [...list],
  }
}

export type Pauses = ReturnType<typeof createPauses>
