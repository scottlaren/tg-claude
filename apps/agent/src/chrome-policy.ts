import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { writeAtomic } from './paths.ts'

const exec = promisify(execFile)

// The user's own Chrome, with all its sign-ins, sent out through the browser tunnel: a Chrome policy for this
// Windows user. Policies hold whichever way Chrome is started (taskbar, links, after a reboot), unlike flags.
// The values this sets are remembered first and put back when it is turned off; nothing else in the key is touched
export const CHROME_POLICY_KEY = 'HKCU\\Software\\Policies\\Google\\Chrome'
// A machine policy outranks the user's, so it is only read: one about the proxy or WebRTC and this can't decide
export const CHROME_MACHINE_KEY = 'HKLM\\Software\\Policies\\Google\\Chrome'
const MACHINE_PROXY = ['ProxySettings', 'ProxyMode', 'ProxyServer', 'ProxyPacUrl', 'ProxyServerMode', 'ProxyBypassList']

type Value = { type: 'REG_SZ' | 'REG_DWORD', data: string }
// pending: Chrome was already running when the policy last changed. Chrome reads policies at start and
// rechecks them now and then, so until it restarts which way it goes is not known.
// relaunch: switching quits and opens Chrome itself (a Mac); otherwise the user restarts it.
// why: what stands in the way when it is not supported
export type ProxyState = { supported: boolean, on: boolean, port: number, pending: boolean, relaunch: boolean, running?: boolean, why?: string }
export type ChromeProxy = { status(): Promise<ProxyState>, on(): Promise<ProxyState>, off(): Promise<ProxyState> }

// Everything that would otherwise go around the proxy: WebRTC's UDP, preloading on the computer's own DNS, QUIC.
// ProxySettings outranks the single proxy policies (and a stray ProxyBypassList or ProxyPacUrl), so it is set too
export const policyValues = (port: number): Record<string, Value> => ({
  ProxySettings: { type: 'REG_SZ', data: JSON.stringify({ ProxyMode: 'fixed_servers', ProxyServer: `socks5://127.0.0.1:${port}` }) },
  ProxyMode: { type: 'REG_SZ', data: 'fixed_servers' },
  ProxyServer: { type: 'REG_SZ', data: `socks5://127.0.0.1:${port}` },
  WebRtcIPHandling: { type: 'REG_SZ', data: 'disable_non_proxied_udp' },
  NetworkPredictionOptions: { type: 'REG_DWORD', data: '2' },
  QuicAllowed: { type: 'REG_DWORD', data: '0' },
})
// The ones that decide which way Chrome goes: all ours, or it isn't through the server
const ROUTE = ['ProxySettings', 'ProxyMode', 'ProxyServer', 'WebRtcIPHandling']
const same = (a: Value | null | undefined, b: Value) => !!a && a.type === b.type && a.data === b.data

async function query(key: string, name: string): Promise<Value | null> {
  try {
    const { stdout } = await exec('reg', ['query', key, '/v', name], { windowsHide: true })
    const m = stdout.match(new RegExp(`^\\s*${name}\\s+(REG_SZ|REG_DWORD)\\s+(.*)$`, 'm'))
    if (!m) return null
    const type = m[1] as Value['type']
    // reg prints a DWORD as 0x2
    return { type, data: type === 'REG_DWORD' ? String(parseInt(m[2].trim(), 16)) : m[2].trim() }
  } catch {
    return null
  }
}

// When the oldest Chrome process started (the browser itself), or null when Chrome isn't running.
// Processes Windows won't tell the start of (another user's) are left out
async function chromeStartedAt(): Promise<number | null> {
  const script = '$p = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.StartTime } | Sort-Object StartTime | Select-Object -First 1; '
    + 'if ($p) { ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds() }'
  try {
    const { stdout } = await exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15_000 })
    const ms = Number(stdout.trim())
    return stdout.trim() && Number.isFinite(ms) ? ms : null
  } catch {
    return null
  }
}

// Every value in a key, of any type, by name
async function names(key: string): Promise<Map<string, string>> {
  try {
    const { stdout } = await exec('reg', ['query', key], { windowsHide: true })
    return new Map([...stdout.matchAll(/^\s{4}(\S+)\s+REG_\w+\s+(.*)$/gm)].map(m => [m[1], m[2].trim()]))
  } catch {
    return new Map()
  }
}

const set = (key: string, name: string, v: Value) => exec('reg', ['add', key, '/v', name, '/t', v.type, '/d', v.data, '/f'], { windowsHide: true })
const remove = (key: string, name: string) => exec('reg', ['delete', key, '/v', name, '/f'], { windowsHide: true }).catch(() => {})

export function createChromePolicy({ port, stateFile, key = CHROME_POLICY_KEY, machineKey = CHROME_MACHINE_KEY, platform = process.platform, chromeStart = chromeStartedAt }: {
  port: number, stateFile: string, key?: string, machineKey?: string, platform?: NodeJS.Platform, chromeStart?: () => Promise<number | null>,
}) {
  type State = { chromePolicyBackup?: Record<string, Value | null>, switchedAt?: number }
  const readState = (): State => {
    try {
      return JSON.parse(readFileSync(stateFile, 'utf8'))
    } catch {
      return {}
    }
  }
  const writeState = (s: State) => writeAtomic(stateFile, JSON.stringify(s, null, 2) + '\n')
  const supported = platform === 'win32' && port > 0
  const off_ = (): ProxyState => ({ supported, on: false, port, pending: false, relaunch: false, why: port ? 'not available on this system yet' : 'turned off in the agent settings (browserProxyPort: 0)' })

  const isOn = async () => {
    const want = policyValues(port)
    for (const name of ROUTE) if (!same(await query(key, name), want[name])) return false
    return true
  }

  async function machineConflict(): Promise<string | null> {
    const machine = await names(machineKey)
    if (MACHINE_PROXY.some(n => machine.has(n))) return 'the Chrome proxy is set by a machine policy (HKLM)'
    const rtc = machine.get('WebRtcIPHandling')
    if (rtc !== undefined && rtc !== policyValues(port).WebRtcIPHandling.data) return 'WebRTC in Chrome is set by a machine policy (HKLM)'
    return null
  }

  async function status(): Promise<ProxyState> {
    if (!supported) return off_()
    const conflict = await machineConflict()
    if (conflict) return { supported: false, on: false, port, pending: false, relaunch: false, why: conflict }
    const { switchedAt } = readState()
    const started = switchedAt ? await chromeStart() : null
    return { supported, on: await isOn(), port, pending: started !== null && started < switchedAt!, relaunch: false }
  }

  // Only a real change asks for a Chrome restart: «on» when it is on already leaves Chrome as it is
  const switched = () => writeState({ ...readState(), switchedAt: Date.now() })

  async function on(): Promise<ProxyState> {
    if (!supported) throw new Error(port ? 'Windows only for now' : 'The browser proxy is turned off (browserProxyPort: 0)')
    const conflict = await machineConflict()
    if (conflict) throw new Error(`Chrome cannot go through the server here: ${conflict}`)
    const wanted = policyValues(port)
    const was = await isOn()
    const state = readState()
    // What was there before the first «on»: a second «on» must not take our own values for the user's.
    // A setting this didn't manage yet then (added in an update) is remembered as it is now
    const backup = { ...(state.chromePolicyBackup ?? {}) }
    const missing = Object.keys(wanted).filter(name => !(name in backup))
    for (const name of missing) backup[name] = await query(key, name)
    if (missing.length) writeState({ ...state, chromePolicyBackup: backup })
    for (const [name, v] of Object.entries(wanted)) await set(key, name, v)
    if (!was) switched()
    return status()
  }

  async function off(): Promise<ProxyState> {
    if (!supported) return off_()
    const was = await isOn()
    const state = readState()
    const backup = state.chromePolicyBackup
    // Already off: what is there is the user's own (an earlier «off» put it back), not ours to remove
    if (!backup && !was) return status()
    for (const [name, v] of Object.entries(policyValues(port))) {
      // Changed by the user since «on»: theirs now, left as it is
      if (!same(await query(key, name), v)) continue
      const before = backup?.[name]
      if (before) await set(key, name, before)
      else await remove(key, name)
    }
    const { chromePolicyBackup: _, ...rest } = state
    writeState(was ? { ...rest, switchedAt: Date.now() } : rest)
    return status()
  }

  return { status, on, off }
}

export type ChromePolicy = ChromeProxy
