import { connect } from 'node:net'
import { readFileSync } from 'node:fs'
import type { Log } from './log.ts'
import { tr } from './i18n.ts'

// The VPS keeps the containers off itself, its metadata service and private networks (tgcv-firewall). The
// server checks that from the inside: if the VPS answers, the rules are not there (a reboot before the unit ran,
// a failed unit) and web fetches from the server could be turned inward. SANDBOX=1 comes from deploy/compose.yml
export type SandboxState = { state: 'off' | 'ok' | 'open', reason?: string }

// Answered at all, a connection or a refusal (RST), means it is reachable; silence means the rules dropped it
export function reachable(host: string, port: number, ms = 1500): Promise<boolean> {
  return new Promise(resolve => {
    const s = connect({ host, port })
    const done = (v: boolean) => {
      s.destroy()
      resolve(v)
    }
    s.setTimeout(ms, () => done(false))
    s.once('connect', () => done(true))
    s.once('error', e => done((e as NodeJS.ErrnoException).code === 'ECONNREFUSED'))
  })
}

// The container's way out: the VPS on the Docker bridge
export function defaultGateway(routes: string): string | null {
  for (const line of routes.split('\n').slice(1)) {
    const [, dest, gw] = line.trim().split(/\s+/)
    if (dest !== '00000000' || !gw) continue
    const n = parseInt(gw, 16)
    return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255].join('.')
  }
  return null
}

export function watchSandbox({ log, enabled = process.env.SANDBOX === '1', every = 60_000, onChange }: {
  log: Log, enabled?: boolean, every?: number, onChange?: (s: SandboxState) => void,
}) {
  // Until the first check is done the sandbox counts as open: web reading waits those two seconds.
  // The reason is worded when it is read: the bot's language may change in between
  type Current = { state: SandboxState['state'], reason?: () => string }
  let current: Current = { state: enabled ? 'open' : 'off', reason: enabled ? () => tr('not checked yet', 'ещё не проверена') : undefined }
  const worded = (s: Current): SandboxState => ({ state: s.state, reason: s.reason?.() })
  let checked = false
  async function check() {
    let gw: string | null = null
    try {
      gw = defaultGateway(readFileSync('/proc/net/route', 'utf8'))
    } catch {}
    const probes: [() => string, string, number][] = [
      [() => tr('the VPS itself', 'сам VPS'), gw ?? '', 22],
      [() => tr('the VPS metadata service', 'служебная страница VPS'), '169.254.169.254', 80],
    ]
    let reason: (() => string) | undefined
    let at = ''
    for (const [what, host, port] of probes) {
      if (host && await reachable(host, port)) {
        at = `${host}:${port}`
        reason = () => tr(`${what()} (${at}) is reachable from the container`, `${what()} (${at}) доступен из контейнера`)
        break
      }
    }
    const next: Current = reason ? { state: 'open', reason } : { state: 'ok' }
    // The first check only speaks up when something is wrong: a normal start sends no message
    if (next.state !== current.state && (checked || next.state === 'open')) {
      if (next.state === 'open') log.error('sandbox open', { reachable: at })
      else log.info('sandbox ok')
      onChange?.(worded(next))
    }
    current = next
    checked = true
  }
  if (enabled) {
    check().catch(e => log.warn('sandbox check', (e as Error).message))
    setInterval(() => check().catch(e => log.warn('sandbox check', (e as Error).message)), every).unref()
  }
  return { state: () => worded(current) }
}

export type Sandbox = ReturnType<typeof watchSandbox>
