import { readJson, writeJson, EFFORTS, type Effort } from './store.ts'

// The models a topic can pick, as the account's Claude Code lists them (supportedModels), not as this code knows them:
// a new one shows up without a release. One per family, its newest version; the list is kept on disk for a restart

// What the SDK says of a model, the part this needs
export type ModelRow = { value: string, resolvedModel?: string, displayName: string, supportedEffortLevels?: string[] }
export type ModelChoice = { value: string, label: string, family: string, efforts: Effort[] }

const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable']

// Until the account has been asked once: what it offered when this was written
export const FALLBACK_MODELS: ModelChoice[] = [
  { value: 'opus', label: 'Opus 5.5', family: 'opus', efforts: [...EFFORTS] },
  { value: 'sonnet', label: 'Sonnet 5.5', family: 'sonnet', efforts: [...EFFORTS] },
  { value: 'haiku', label: 'Haiku 5.5', family: 'haiku', efforts: [...EFFORTS] },
  { value: 'claude-fable-5-2', label: 'Fable 5.2', family: 'fable', efforts: [...EFFORTS] },
]

// claude-opus-5-5, claude-fable-5, claude-haiku-4-5-20251001, claude-fable-5-1[1m] → family and version
export function parseModelId(id: string) {
  const m = /^claude-([a-z]+)-(\d+(?:-\d+)*)$/.exec(id.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, ''))
  return m ? { family: m[1], version: m[2].split('-').map(Number) } : undefined
}

const newer = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

const alias = (value: string) => !value.startsWith('claude-')

// One per family, its newest version. An alias the SDK takes is kept when it points at that version (opus → 5.5), never
// trusted on its own: fable still meant 5.1 the day 5.2 came out
export function pickLatest(rows: ModelRow[]): ModelChoice[] {
  const best = new Map<string, { row: ModelRow, version: number[] }>()
  for (const row of rows) {
    if (row.value === 'default') continue
    const id = parseModelId(row.resolvedModel ?? row.value)
    if (!id) continue
    const was = best.get(id.family)
    const same = was && !newer(id.version, was.version) && !newer(was.version, id.version)
    if (!was || newer(id.version, was.version) || (same && alias(row.value) && !alias(was.row.value))) best.set(id.family, { row, version: id.version })
  }
  const rank = (f: string) => (FAMILIES.includes(f) ? FAMILIES.indexOf(f) : FAMILIES.length)
  return [...best.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([family, { row }]) => ({
      value: row.value,
      label: row.displayName,
      family,
      // Absent: the SDK doesn't say, and the model is asked as before
      efforts: row.supportedEffortLevels ? EFFORTS.filter(e => row.supportedEffortLevels!.includes(e)) : [...EFFORTS],
    }))
}

export function createModelCatalog({ file, fetch, now = Date.now, staleMs = 3600_000, onChange }: {
  file: string
  // The account's list, or null when it couldn't be had
  fetch: () => Promise<ModelRow[] | null>
  now?: () => number
  staleMs?: number
  onChange?: () => void
}) {
  let saved = readJson<{ at: number, rows: ModelRow[] }>(file, { at: 0, rows: [] })
  let choices = saved.rows.length ? pickLatest(saved.rows) : FALLBACK_MODELS
  let running: Promise<boolean> | undefined

  // The id a value stands for: an alias by the list, an id as it is
  const resolve = (value: string) => saved.rows.find(r => r.value === value)?.resolvedModel ?? value
  const choiceOf = (value?: string) => (value ? choices.find(c => c.value === value || resolve(c.value) === resolve(value)) : undefined)

  async function refresh() {
    // Whatever goes wrong in asking, the menu keeps what it had
    const rows = await Promise.resolve().then(fetch).catch(() => null)
    if (!rows?.length) return false
    const before = JSON.stringify(choices)
    saved = { at: now(), rows: rows.map(r => ({ value: r.value, resolvedModel: r.resolvedModel, displayName: r.displayName, supportedEffortLevels: r.supportedEffortLevels })) }
    writeJson(file, saved)
    choices = pickLatest(saved.rows)
    if (!choices.length) choices = FALLBACK_MODELS
    if (JSON.stringify(choices) !== before) onChange?.()
    return true
  }

  return {
    list: () => choices,
    choice: choiceOf,
    // A model the menu no longer shows still has its name: the account's list knows it, or its id says it
    label(value?: string) {
      if (!value) return undefined
      return choiceOf(value)?.label ?? saved.rows.find(r => r.value === value)?.displayName ?? value
    },
    efforts: (value?: string) => choiceOf(value)?.efforts ?? [...EFFORTS],
    // The newest of the same family, when the value is an older version of it: Fable 5.1 → Fable 5.2
    upgrade(value: string) {
      const id = parseModelId(resolve(value))
      const latest = id && choices.find(c => c.family === id.family)
      const to = latest && parseModelId(resolve(latest.value))
      return latest && to && newer(to.version, id.version) ? latest.value : undefined
    },
    stale: () => now() - saved.at > staleMs,
    refresh: () => (running ??= refresh().finally(() => { running = undefined })),
  }
}
export type ModelCatalog = ReturnType<typeof createModelCatalog>
