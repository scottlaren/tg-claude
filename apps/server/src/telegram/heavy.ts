import { readFileSync, writeFileSync, renameSync } from 'node:fs'

// Commands that cost a lot of processor time, as measured when they ran: Claude sees them with what they would take on
// each computer before it starts one again, and can send the long ones nobody waits for where there is room.
// Nothing here is exact. A command's share of a busy computer is a guess, and a core of one computer is not a core of
// another: the figures tell minutes from hours, which is what the choice needs

export type Heavy = { cmd: string, wallSec: number, coreSec: number, device: string, cores: number, at: number, runs: number }

const HEAVY_CORE_SEC = 300
const HEAVY_WALL_SEC = 30
const KEEP = 12
const TTL_MS = 30 * 86400_000

// The same command with other numbers is the same command: a seed, a count, a port
export function commandKey(p: { command?: string, program?: string, args?: string[] }) {
  const text = (p.command ?? [p.program, ...(p.args ?? [])].join(' ')).replace(/\s+/g, ' ').trim()
  return text.replace(/\d+/g, '#').slice(0, 120)
}

export const isHeavy = (r: { durationMs: number, coreSec?: number }) => (r.coreSec ?? 0) >= HEAVY_CORE_SEC && r.durationMs >= HEAVY_WALL_SEC * 1000

// How long it would take with that many cores: it can't use more of them than it did, and with fewer the same work
// takes as much longer
export function wouldTake(h: Pick<Heavy, 'wallSec' | 'coreSec'>, cores: number) {
  const used = Math.max(1, h.coreSec / Math.max(1, h.wallSec))
  return Math.round(h.coreSec / Math.min(used, Math.max(0.1, cores)))
}

export function createHeavyStore(file: string, now = Date.now) {
  let all: Record<string, Heavy[]> = {}
  try {
    all = JSON.parse(readFileSync(file, 'utf8'))
  } catch {}
  const save = () => {
    try {
      writeFileSync(file + '.tmp', JSON.stringify(all))
      renameSync(file + '.tmp', file)
    } catch {}
  }
  return {
    // repo: the repository on its computer. True when it was heavy and is remembered
    note(repo: string, device: { name: string, cores?: number }, params: { command?: string, program?: string, args?: string[] }, r: { durationMs: number, coreSec?: number, cancelled?: boolean, timedOut?: boolean }) {
      if (!isHeavy(r) || r.cancelled || r.timedOut || !device.cores) return false
      const cmd = commandKey(params)
      const list = (all[repo] ?? []).filter(h => now() - h.at < TTL_MS)
      const was = list.find(h => h.cmd === cmd)
      const entry: Heavy = { cmd, wallSec: Math.round(r.durationMs / 1000), coreSec: r.coreSec!, device: device.name, cores: device.cores, at: now(), runs: (was?.runs ?? 0) + 1 }
      all[repo] = [entry, ...list.filter(h => h !== was)].sort((a, b) => b.coreSec - a.coreSec).slice(0, KEEP)
      save()
      return true
    },
    top: (repo: string, n = 4) => (all[repo] ?? []).filter(h => now() - h.at < TTL_MS).slice(0, n),
  }
}
