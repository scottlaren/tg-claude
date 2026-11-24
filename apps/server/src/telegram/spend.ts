import { readJson, writeJson } from '../store.ts'

// Tokens of each topic by day, weighed by what they cost next to one another: rereading the history (cache reads) is a
// tenth of a fresh prompt, writing it a quarter more, an answer five times; Sonnet and Haiku less than Opus. The plan's
// limits are not published, so this says where the tokens go; the share of the week is an estimate
export type Usage = { input?: number, output?: number, cacheRead?: number, cacheWrite?: number }

const modelWeight = (model: string) => (/haiku/i.test(model) ? 0.2 : /sonnet/i.test(model) ? 0.6 : 1)
export const weigh = (u: Usage, model: string) =>
  modelWeight(model) * ((u.input ?? 0) + 1.25 * (u.cacheWrite ?? 0) + 0.1 * (u.cacheRead ?? 0) + 5 * (u.output ?? 0))

// What a weekly limit held in Opus units, measured: four days of 2026-11 spent about 670M and the week ran out in
// three and a half. Only for saying «about this much of the week»
export const WEEK_ESTIMATE = 600_000_000
// A topic past this share of the week in one day is told so, once a day
export const WARN_SHARE = 0.1
const DAYS_KEPT = 8

type Data = Record<string, Record<string, number>>
// Names are kept with the tokens: an agent's topic is deleted with the agent, and its share would read as a bare key
type Saved = { days: Data, names: Record<string, string> }

export function createSpend(file: string, { now = Date.now, week = WEEK_ESTIMATE }: { now?: () => number, week?: number } = {}) {
  const raw = readJson<Saved | Data>(file, {})
  // Before names were kept the file held the days alone
  const saved: Saved = 'days' in raw && 'names' in raw ? raw as Saved : { days: raw as Data, names: {} }
  const data = saved.days
  const day = (t = now()) => new Date(t).toISOString().slice(0, 10)
  const warned = new Map<string, string>()

  return {
    // Units it adds; true when this topic has just gone past the day's share and wasn't told today
    add(key: string, model: string, usage: Usage, name?: string): { units: number, warn: boolean } {
      const d = day()
      const units = weigh(usage, model)
      const today = (data[d] ??= {})
      today[key] = (today[key] ?? 0) + units
      if (name) saved.names[key] = name
      for (const old of Object.keys(data).sort().slice(0, -DAYS_KEPT)) delete data[old]
      const kept = new Set(Object.values(data).flatMap(Object.keys))
      for (const k of Object.keys(saved.names)) if (!kept.has(k)) delete saved.names[k]
      writeJson(file, saved)
      const warn = today[key] >= WARN_SHARE * week && warned.get(key) !== d
      if (warn) warned.set(key, d)
      return { units, warn }
    },
    shareOfWeek: (key: string) => (data[day()]?.[key] ?? 0) / week,
    // The last seven days, the costliest topics first
    week() {
      const from = day(now() - 6 * 86400_000)
      const sums = new Map<string, number>()
      for (const [d, keys] of Object.entries(data)) {
        if (d < from) continue
        for (const [k, v] of Object.entries(keys)) sums.set(k, (sums.get(k) ?? 0) + v)
      }
      const total = [...sums.values()].reduce((a, b) => a + b, 0)
      return { total, topics: [...sums.entries()].sort((a, b) => b[1] - a[1]).map(([key, units]) => ({ key, units, share: total ? units / total : 0, name: saved.names[key] as string | undefined })) }
    },
    // The last seven days one by one, the oldest first, each with its costliest topics: a chart by day
    days(top = 3) {
      return Array.from({ length: 7 }, (_, i) => {
        const d = day(now() - (6 - i) * 86400_000)
        const keys = Object.entries(data[d] ?? {})
        const total = keys.reduce((a, [, v]) => a + v, 0)
        const topics = keys.sort((a, b) => b[1] - a[1]).slice(0, top).map(([key, units]) => ({ key, units, name: saved.names[key] as string | undefined }))
        return { day: d, total, topics }
      })
    },
  }
}
