import os from 'node:os'
import { readFileSync } from 'node:fs'

// What a computer has and how busy it is: the server tells Claude, who decides where heavy work runs. And what a
// command cost in processor time, so that the next time it is known before it starts

const readOr = (file: string) => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

// A container is given a part of its host (the cloud: 4 of 6 processors): its own share and its own use count, the
// host's numbers would say the wrong thing about both. Null outside a container with a limit
export function cgroup(root = '/sys/fs/cgroup', read = readOr) {
  const m = /^(\d+) (\d+)/.exec(read(`${root}/cpu.max`))
  if (!m || !Number(m[2])) return null
  const mem = Number(read(`${root}/memory.max`).trim())
  return {
    cores: Number(m[1]) / Number(m[2]),
    memBytes: Number.isFinite(mem) && mem > 0 ? mem : undefined,
    busySec: () => Number(/^usage_usec (\d+)/m.exec(read(`${root}/cpu.stat`))?.[1] ?? 0) / 1e6,
  }
}

export type Load = ReturnType<typeof createLoad>

export function createLoad({ box = process.platform === 'linux' ? cgroup() : null, cpus = () => os.cpus(), totalmem = () => os.totalmem(), now = Date.now }: {
  box?: ReturnType<typeof cgroup>
  cpus?: () => { times: { user: number, nice: number, sys: number, irq: number } }[]
  totalmem?: () => number
  now?: () => number
} = {}) {
  const cores = box?.cores ?? cpus().length
  // Processor-seconds spent so far, by everything on the computer (or in the container)
  const busySec = box ? box.busySec : () => cpus().reduce((s, c) => s + c.times.user + c.times.nice + c.times.sys + c.times.irq, 0) / 1000
  let seen = { at: now(), busy: busySec() }

  // Commands running at the same moment share what was spent in it equally: nothing tells whose it was, and a rough
  // figure is all the choice between computers needs
  const running = new Set<{ coreSec: number }>()
  let settled = busySec()
  const settle = () => {
    const at = busySec()
    const spent = Math.max(0, at - settled)
    settled = at
    for (const m of running) m.coreSec += spent / running.size
  }

  return {
    capacity: { cores: Math.round(cores * 10) / 10, memGb: Math.max(1, Math.round((box?.memBytes ?? totalmem()) / 1024 ** 3)) },
    // How busy since the last look, 0 to 100 of all its processors
    busy() {
      const at = { at: now(), busy: busySec() }
      const sec = (at.at - seen.at) / 1000
      const pct = sec > 0 ? (at.busy - seen.busy) / (sec * cores) * 100 : 0
      seen = at
      return Math.max(0, Math.min(100, Math.round(pct)))
    },
    // One command: call the answer when it ends, for the processor-seconds that were its share
    meter() {
      settle()
      const m = { coreSec: 0 }
      running.add(m)
      return () => {
        settle()
        running.delete(m)
        return Math.round(m.coreSec)
      }
    },
  }
}

// What the server hears: only a change worth knowing, and a word every few minutes that it still holds
export function watchLoad(load: Pick<Load, 'busy'>, send: (m: { busy: number, idleSec?: number }) => void, { every = 30_000, idleSec = async () => undefined as number | undefined, repeatMs = 5 * 60_000, now = Date.now } = {}) {
  // At it, stepped away, gone: the edges are what matters to where work goes, not the seconds
  const presence = (s?: number) => (s === undefined ? 'unknown' : s < 120 ? 'here' : s < 600 ? 'near' : 'away')
  let said: { busy: number, presence: string, at: number } | undefined
  const timer = setInterval(async () => {
    const busy = load.busy()
    const idle = await idleSec().catch(() => undefined)
    if (said && Math.abs(busy - said.busy) < 10 && presence(idle) === said.presence && now() - said.at < repeatMs) return
    said = { busy, presence: presence(idle), at: now() }
    send({ busy, ...(idle !== undefined && { idleSec: Math.round(idle) }) })
  }, every)
  timer.unref()
  return () => clearInterval(timer)
}
