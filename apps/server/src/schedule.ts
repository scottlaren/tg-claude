import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'

// Tasks that run by themselves in a topic. Cron with five fields, read in the owner's time zone: the server's own
// clock says nothing about where its owner lives

export type Cron = { minutes: Set<number>, hours: Set<number>, days: Set<number>, months: Set<number>, weekdays: Set<number>, anyDay: boolean, anyWeekday: boolean }

const FIELDS = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]] as const

function parseField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const m = part.match(/^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/)
    if (!m) return null
    const step = m[4] === undefined ? 1 : Number(m[4])
    const from = m[1] ? min : Number(m[2])
    // «5/10» counts from 5 up to the end, as in every cron
    const to = m[1] || m[4] !== undefined && m[3] === undefined ? max : m[3] === undefined ? from : Number(m[3])
    if (!step || from < min || to > max || from > to) return null
    for (let v = from; v <= to; v += step) out.add(v)
  }
  return out
}

export function parseCron(expr: string): Cron | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const sets = parts.map((p, i) => parseField(p, FIELDS[i][0], FIELDS[i][1]))
  if (sets.some(s => !s)) return null
  const [minutes, hours, days, months, week] = sets as Set<number>[]
  return { minutes, hours, days, months, weekdays: new Set([...week].map(d => d % 7)), anyDay: parts[2] === '*', anyWeekday: parts[4] === '*' }
}

// One minute value means at most one run an hour, whatever the other fields say
export const oftenerThanHourly = (c: Cron) => c.minutes.size > 1

const formats = new Map<string, Intl.DateTimeFormat>()
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function localParts(t: number, timeZone: string) {
  let f = formats.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' })
    formats.set(timeZone, f)
  }
  const p = Object.fromEntries(f.formatToParts(t).map(x => [x.type, x.value]))
  return { month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute), weekday: WEEKDAYS.indexOf(p.weekday) }
}

const MINUTE = 60_000
// A 29 February comes within this; a 31 February never does
const HORIZON_MS = 5 * 366 * 24 * 3600_000

// The first run after this moment, or null when the date never comes. Goes by the hour until the hour fits, so a
// day that gains or loses an hour to daylight saving needs no special care
export function nextRun(c: Cron, after: number, timeZone: string): number | null {
  let t = Math.floor(after / MINUTE) * MINUTE + MINUTE
  const end = after + HORIZON_MS
  while (t < end) {
    const p = localParts(t, timeZone)
    const dayOk = c.anyDay && c.anyWeekday ? true
      // Both given: either will do, as in every cron
      : c.anyDay ? c.weekdays.has(p.weekday) : c.anyWeekday ? c.days.has(p.day) : c.days.has(p.day) || c.weekdays.has(p.weekday)
    if (!c.months.has(p.month) || !dayOk || !c.hours.has(p.hour)) t += (60 - p.minute) * MINUTE
    else if (!c.minutes.has(p.minute)) t += MINUTE
    else return t
  }
  return null
}

// A moment given in the owner's local time, 2026-10-31T10:00, or null when the calendar has no such moment:
// a 31 February, or an hour skipped when the clocks go forward
export function parseAt(at: string, timeZone: string): number | null {
  const m = at.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/)
  if (!m) return null
  const [year, month, day, hour, minute] = m.slice(1).map(Number)
  const c = parseCron(`${minute} ${hour} ${day} ${month} *`)
  if (!c) return null
  const yearOf = (t: number) => Number(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(t))
  let t = nextRun(c, Date.UTC(year - 1, 11, 29), timeZone)
  while (t !== null && yearOf(t) < year) t = nextRun(c, t, timeZone)
  return t !== null && yearOf(t) === year ? t : null
}

const validZone = (name: string) => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: name }) && name
  } catch {
    return null
  }
}
const REGIONS = ['Europe', 'Asia', 'America', 'Africa', 'Australia', 'Pacific', 'Atlantic', 'Indian']

// What the owner types: Europe/Kyiv, UTC+3, Kyiv, New York. Whole-hour offsets only: other ones have a city
export function parseTimeZone(input: string): string | null {
  const s = input.trim()
  if (!s || s.length > 64) return null
  const offset = s.match(/^(?:UTC|GMT)?\s*([+-])\s*(\d{1,2})(?::00)?$/i)
  // POSIX has the sign of these names the other way round: UTC+3 is Etc/GMT-3
  if (offset) return Number(offset[2]) <= 14 ? validZone(`Etc/GMT${offset[1] === '+' ? '-' : '+'}${Number(offset[2])}`) : null
  if (/^(utc|gmt)$/i.test(s)) return 'UTC'
  if (!/^[\p{L} _/+-]+$/u.test(s)) return null
  if (s.includes('/')) return validZone(s.replace(/ /g, '_'))
  const city = s.toLowerCase().split(/[ _]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('_')
  for (const region of REGIONS) {
    const zone = validZone(`${region}/${city}`)
    if (zone) return zone
  }
  return null
}

export type ScheduledTask = {
  id: string
  // The topic it runs in
  key: string
  name: string
  prompt: string
  // Empty for a one-time task
  cron: string
  // Runs once, at nextAt, and is gone: a moment the owner confirmed, which a new time zone doesn't move
  once?: boolean
  paused: boolean
  nextAt: number
  // The owner has heard this one is being skipped: once, not every hour while a laptop is closed
  skipNoted?: boolean
  // Each run gets the user's Chrome, for that run only: nobody is there to grant it
  browser?: boolean
}
type Saved = { timeZone: string | null, tasks: ScheduledTask[] }

export const MAX_TASKS = 20

export function createSchedule(file: string, now = Date.now) {
  let data: Saved = { timeZone: null, tasks: [] }
  try {
    const read = JSON.parse(readFileSync(file, 'utf8'))
    data = { timeZone: read.timeZone ?? null, tasks: Array.isArray(read.tasks) ? read.tasks : [] }
  } catch {}

  function save() {
    writeFileSync(file + '.tmp', JSON.stringify(data, null, 2))
    renameSync(file + '.tmp', file)
  }
  const zone = () => data.timeZone ?? 'UTC'
  const next = (t: ScheduledTask, after: number) => {
    if (t.once) return t.nextAt
    const c = parseCron(t.cron)
    return (c && nextRun(c, after, zone())) ?? Infinity
  }
  const find = (id: string) => data.tasks.find(t => t.id === id)

  return {
    zone,
    zoneChosen: () => data.timeZone !== null,
    setZone(timeZone: string) {
      data.timeZone = timeZone
      for (const t of data.tasks) t.nextAt = next(t, now())
      save()
    },
    list: () => [...data.tasks],
    get: find,
    full: () => data.tasks.length >= MAX_TASKS,
    // at: the moment of a one-time task; without it, the cron says when
    add(p: Pick<ScheduledTask, 'key' | 'name' | 'prompt' | 'cron' | 'browser'>, at?: number): ScheduledTask {
      const t: ScheduledTask = { ...p, id: randomBytes(4).toString('hex'), paused: false, nextAt: at ?? 0, ...(at !== undefined && { once: true }) }
      t.nextAt = next(t, now())
      data.tasks.push(t)
      save()
      return t
    },
    remove(id: string) {
      data.tasks = data.tasks.filter(t => t.id !== id)
      save()
    },
    // The topic moved: its tasks go with it
    moveTopic(from: string, to: string) {
      if (!data.tasks.some(t => t.key === from)) return
      for (const t of data.tasks) if (t.key === from) t.key = to
      save()
    },
    removeTopic(key: string) {
      if (!data.tasks.some(t => t.key === key)) return
      data.tasks = data.tasks.filter(t => t.key !== key)
      save()
    },
    removeChat(chatId: number) {
      if (!data.tasks.some(t => Number(t.key.split(':')[0]) === chatId)) return
      data.tasks = data.tasks.filter(t => Number(t.key.split(':')[0]) !== chatId)
      save()
    },
    setPaused(id: string, paused: boolean) {
      const t = find(id)
      if (!t) return
      t.paused = paused
      // What came due during the pause is gone, not owed
      if (!paused) t.nextAt = next(t, now())
      save()
    },
    // Called before the run starts: a crash right after it must not run the task again
    advance(id: string, skipNoted?: boolean) {
      const t = find(id)
      if (!t) return
      t.nextAt = next(t, now())
      t.skipNoted = skipNoted
      save()
    },
    due: () => data.tasks.filter(t => !t.paused && t.nextAt <= now()),
    // A quiet topic with a live schedule is not an abandoned one
    activeIn: (key: string) => data.tasks.some(t => t.key === key && !t.paused),
  }
}

export type Schedule = ReturnType<typeof createSchedule>

export type SkipReason = 'late' | 'running' | 'unbound' | 'offline' | 'limit'
const LATE_MS = 3600_000

// Why a task that came due doesn't run now, or null when it does. A run is never owed: missed ones don't pile up
export function skipReason(o: { now: number, nextAt: number, running: boolean, unbound: boolean, offline: boolean, limited: boolean }): SkipReason | null {
  if (o.now - o.nextAt > LATE_MS) return 'late'
  if (o.running) return 'running'
  if (o.unbound) return 'unbound'
  if (o.offline) return 'offline'
  if (o.limited) return 'limit'
  return null
}
