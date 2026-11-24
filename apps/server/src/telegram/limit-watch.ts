import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import type { ProfileUsage, LastLimit } from '../profiles.ts'
import { tr } from '../i18n.ts'
import { resetTag, epochMs } from './usage.ts'
import { hashtag } from './emoji.ts'

// A heads-up before a plan limit runs out, once per window until it resets: a spent limit stops work in the
// middle of a task, a warning leaves time to wrap up or to switch profiles
const THRESHOLD = 80
// Each check starts a CLI process for a second: not after every turn
const CHECK_EVERY_MS = 10 * 60_000
// A window that doesn't say when it resets: don't repeat within a day
const UNKNOWN_RESET_MS = 24 * 3600_000
// How long the share of the 5-hour window seen in a check is still worth showing
const SHOWN_FOR_MS = 15 * 60_000

export type NearLimit = { id: string, label: string, pct?: number, resetsAt?: number }

const windowsOf = (u: ProfileUsage) => [
  { id: 'five_hour', label: tr('5 hours', '5 часов'), w: u.fiveHour },
  { id: 'seven_day', label: tr('Week', 'Неделя'), w: u.sevenDay },
  ...u.models.map(m => ({ id: `model_${m.name}`, label: `${m.name}, ${tr('week', 'неделя')}`, w: m })),
]

// When a big task is worth asking about: a 5-hour window comes back within hours, a week's takes days, so it gets closer
// to the end before anyone is asked to wait for it
export const OFFER_AT = { fiveHour: 80, week: 90 }

// The window that makes a big task worth asking about, of those a plan has (some have no 5-hour one). Past both, the
// week's: waiting out the 5 hours helps little when the week is nearly spent
export function limitToOffer(u: ProfileUsage, now: number, at = OFFER_AT): { pct: number, resetsAt: number, label: string } | undefined {
  return windowsOf(u)
    .flatMap(({ id, label, w }) => {
      if (!w || w.utilization === null || !w.resetsAt || Date.parse(w.resetsAt) <= now) return []
      const fiveHour = id === 'five_hour'
      return w.utilization >= (fiveHour ? at.fiveHour : at.week) ? [{ pct: w.utilization, resetsAt: Date.parse(w.resetsAt), label, fiveHour }] : []
    })
    .sort((a, b) => Number(a.fiveHour) - Number(b.fiveHour) || b.pct - a.pct)
    .map(({ fiveHour: _f, ...w }) => w)[0]
}

export function nearFromUsage(u: ProfileUsage): NearLimit[] {
  const windows = windowsOf(u)
  return windows.flatMap(({ id, label, w }) => (w && w.utilization !== null && w.utilization >= THRESHOLD
    ? [{ id, label, pct: Math.round(w.utilization), resetsAt: w.resetsAt ? Date.parse(w.resetsAt) : undefined }]
    : []))
}

const typeLabel = (type?: string) => {
  switch (type) {
    case 'five_hour': return tr('5 hours', '5 часов')
    case 'seven_day': return tr('Week', 'Неделя')
    case 'seven_day_opus': return tr('Opus, week', 'Opus, неделя')
    case 'seven_day_sonnet': return tr('Sonnet, week', 'Sonnet, неделя')
    default: return tr('Plan limit', 'Лимит тарифа')
  }
}

// Without live numbers: what the CLI said in the last turn. Its own warning may come at another percentage.
// A rejection has a message of its own, and a window that has reset since says nothing
export function nearFromLast(last: LastLimit | undefined, now: number): NearLimit[] {
  if (!last || last.status === 'rejected') return []
  const resetsAt = epochMs(last.resetsAt)
  if (resetsAt && resetsAt <= now) return []
  const pct = last.utilization === undefined ? undefined : Math.round(last.utilization * (last.utilization <= 1 ? 100 : 1))
  if (last.status !== 'allowed_warning' && (pct === undefined || pct < THRESHOLD)) return []
  return [{ id: last.rateLimitType ?? 'limit', label: typeLabel(last.rateLimitType), pct, resetsAt }]
}

const hasNumbers = (u: ProfileUsage) => [u.fiveHour, u.sevenDay, ...u.models].some(w => w && w.utilization !== null)

export function createLimitWatch({ file, usage, last, now = Date.now, offerAt = OFFER_AT }: {
  file: string
  usage: (profile: string) => Promise<ProfileUsage | null>
  last: (profile: string) => LastLimit | undefined
  now?: () => number
  offerAt?: typeof OFFER_AT
}) {
  // Survives a restart, so an update doesn't warn again: `profile:window` → until when it is settled
  let warned: Record<string, number> = {}
  try {
    warned = JSON.parse(readFileSync(file, 'utf8'))
  } catch {}
  const checkedAt = new Map<string, number>()
  const fiveHour = new Map<string, { pct: number, at: number }>()
  // The numbers as last seen, for the question before a big task. Kept apart from the warnings: looking doesn't warn
  const seen = new Map<string, { u: ProfileUsage | null, at: number }>()
  const keep = (profile: string, u: ProfileUsage | null, t: number) => {
    seen.set(profile, { u, at: t })
    if (u?.fiveHour && u.fiveHour.utilization !== null) fiveHour.set(profile, { pct: u.fiveHour.utilization, at: t })
  }

  function save(t: number) {
    warned = Object.fromEntries(Object.entries(warned).filter(([, until]) => until > t))
    writeFileSync(file + '.tmp', JSON.stringify(warned, null, 2))
    renameSync(file + '.tmp', file)
  }

  return {
    // Where the 5-hour window stood at the last check, if that was recent
    fiveHour(profile: string) {
      const seen = fiveHour.get(profile)
      return seen && now() - seen.at < SHOWN_FOR_MS ? seen.pct : undefined
    },
    // The window a big task should be asked about now, if any. Numbers older than a check's interval are looked up
    // again first, within waitMs: the first message after a quiet hour is the one most likely to start something big
    async offerWindow(profile: string, waitMs = 3000) {
      let got = seen.get(profile)
      if (!got || now() - got.at >= CHECK_EVERY_MS) {
        const t = now()
        const u = await Promise.race([usage(profile).catch(() => null), new Promise<undefined>(r => setTimeout(r, waitMs))])
        // Too slow this time: the answer still counts for the next one
        if (u !== undefined) keep(profile, u, t)
        got = seen.get(profile)
      }
      return got && now() - got.at < SHOWN_FOR_MS && got.u ? limitToOffer(got.u, now(), offerAt) : undefined
    },
    // What this profile has newly come close to: each window is reported once
    async check(profile: string): Promise<NearLimit[]> {
      const t = now()
      if (t - (checkedAt.get(profile) ?? -Infinity) < CHECK_EVERY_MS) return []
      checkedAt.set(profile, t)
      const u = await usage(profile)
      keep(profile, u, t)
      const near = u && hasNumbers(u) ? nearFromUsage(u) : nearFromLast(last(profile), t)
      const fresh = near.filter(n => (warned[`${profile}:${n.id}`] ?? 0) <= t)
      if (!fresh.length) return []
      for (const n of fresh) warned[`${profile}:${n.id}`] = n.resetsAt && n.resetsAt > t ? n.resetsAt : t + UNKNOWN_RESET_MS
      save(t)
      return fresh
    },
  }
}

export function limitWarning(profile: string, near: NearLimit[], now = Date.now()) {
  const rows = near.map(n => {
    const reset = n.resetsAt ? `${tr('resets', 'сброс')} ${resetTag(n.resetsAt, now)}` : ''
    return `- ${n.label}: ${[n.pct === undefined ? tr('close to the limit', 'близко к лимиту') : `==${n.pct}%==`, reset].filter(Boolean).join(', ')}`
  })
  return [
    tr(`⚠️ The profile **${profile}** is close to its limit:`, `⚠️ Профиль **${profile}** близок к лимиту:`),
    rows.join('\n'),
    `${tr('More: /usage.', 'Подробнее — /usage.')} ${hashtag('limit')}`,
  ].join('\n\n')
}
