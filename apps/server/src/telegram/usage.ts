import type { ProfileStatus, ProfileUsage, LastLimit, Window } from '../profiles.ts'
import { tr } from '../i18n.ts'

// Relative, so the answer is right whatever time zone the server runs in
export function inTime(ms: number) {
  if (ms <= 0) return tr('now', 'уже')
  const min = Math.round(ms / 60_000)
  if (min < 60) return tr(`in ${min} min`, `через ${min} мин`)
  const h = Math.floor(min / 60)
  if (h < 48) return tr(`in ${h} h${min % 60 ? ` ${min % 60} min` : ''}`, `через ${h} ч${min % 60 ? ` ${min % 60} мин` : ''}`)
  return tr(`in ${Math.round(h / 24)} days`, `через ${Math.round(h / 24)} дн`)
}

// Telegram shows these in the reader's own time zone and language, and keeps a relative one up to date. The text
// inside is for where it can't: older apps, a fallback to plain text
export const timeTag = (ms: number, format: 'wDT' | 'r', fallback: string) => `<tg-time unix="${Math.floor(ms / 1000)}" format="${format}">${fallback}</tg-time>`
export const resetTag = (ms: number, now = Date.now()) => timeTag(ms, 'r', inTime(ms - now))

const shortCount = (n: number) => (n < 1000 ? String(n) : n < 10_000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`)

// What a turn cost, for the line above its steps. Tokens are this turn's own, without what it read from cache,
// which counts for little. The share of the 5-hour window is where the profile stands: other topics move it too
export function costLabel(u?: { input: number, output: number, cacheWrite: number }, fiveHour?: number) {
  const tokens = u ? u.input + u.output + u.cacheWrite : 0
  return [
    tokens ? tr(`${shortCount(tokens)} tokens`, `${shortCount(tokens)} токенов`) : null,
    fiveHour === undefined ? null : `${tr('5 h', '5 ч')}: ${Math.round(fiveHour)}%`,
  ].filter(Boolean).join(' · ')
}

export function bar(pct: number, width = 10) {
  const full = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return '▓'.repeat(full) + '░'.repeat(width - full)
}

const PLAN: Record<string, string> = { free: 'Free', pro: 'Pro', max: 'Max', ultra: 'Ultra', team: 'Team', enterprise: 'Enterprise' }
// The account says "Claude Ultra", the CLI "max"
export const planLabel = (p?: string | null) => {
  const name = p?.replace(/^Claude\s+/i, '')
  return name ? PLAN[name.toLowerCase()] ?? name : tr('plan unknown', 'тариф неизвестен')
}

// Masked: enough to tell accounts apart, not enough to be a contact
export const maskEmail = (e?: string) => (e ? e.replace(/^(.)[^@]*(@.).*(\.[^.]+)$/, '$1…$2…$3') : '')

// One table row: Telegram glues single line breaks into one paragraph, a table keeps each window apart
function row(label: string, w: Window | undefined, now: number) {
  if (!w || w.utilization === null) return null
  return `| ${label} | ${bar(w.utilization)} ${Math.round(w.utilization)}% | ${w.resetsAt ? resetTag(Date.parse(w.resetsAt), now) : '—'} |`
}

// Seconds or milliseconds: the CLI reports reset times as Unix seconds
export const epochMs = (t?: number) => (t === undefined ? undefined : t < 1e12 ? t * 1000 : t)

// One profile in /usage: live numbers when the CLI gives them, else what the last turn saw, else "no data"
export function usageMarkdown(name: string, { status, usage, last, isDefault, now = Date.now() }: {
  status: ProfileStatus, usage: ProfileUsage | null, last?: LastLimit, isDefault: boolean, now?: number,
}) {
  const head = `### ${name}${isDefault ? tr(' · default', ' · по умолчанию') : ''}\n\n${planLabel(usage?.plan ?? status.plan)}${status.email ? ` · ${maskEmail(status.email)}` : ''}`
  if (!status.loggedIn) return `${head}\n\n${tr('🔑 not signed in: on the server', '🔑 вход не выполнен: на сервере')} \`npm run login -- --profile ${name}\``
  const rows = usage
    ? [row(tr('5 hours', '5 часов'), usage.fiveHour, now), row(tr('Week', 'Неделя'), usage.sevenDay, now), ...usage.models.map(m => row(`${m.name}, ${tr('week', 'неделя')}`, m, now))].filter(Boolean)
    : []
  if (rows.length) return [head, [tr('| | Used | Resets |', '| | Использовано | Сброс |'), '|:--|:--|:--|', ...rows].join('\n')].join('\n\n')
  if (last) {
    const reset = epochMs(last.resetsAt)
    const state = last.status === 'rejected' ? tr('⛔ limit reached', '⛔ лимит исчерпан') : last.status === 'allowed_warning' ? tr('⚠️ close to the limit', '⚠️ близко к лимиту') : tr('✅ within the limit', '✅ в пределах лимита')
    const pct = last.utilization !== undefined ? `, ${Math.round(last.utilization * (last.utilization <= 1 ? 100 : 1))}%` : ''
    return `${head}\n\n${state}${pct}${reset ? ` · ${tr('resets', 'сброс')} ${resetTag(reset, now)}` : ''} ${tr('_(as of the last task)_', '_(по последней задаче)_')}`
  }
  return `${head}\n\n${tr('no data', 'нет данных')}`
}
