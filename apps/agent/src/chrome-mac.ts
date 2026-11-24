import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { proxyFlags } from './chrome.ts'
import type { ProxyState, ChromeProxy } from './chrome-policy.ts'

const exec = promisify(execFile)

// The user's own Chrome through the server on a Mac. Without a management profile Chrome takes no proxy policy
// there, so the switch is how Chrome is started: quit and opened again on the same profile and tabs, with the
// proxy flags or without. Which way it goes is read from the running Chrome's own command line, so it is
// always known: a Chrome opened from the Dock afterwards goes straight, and shows as such
const BUNDLE = 'com.google.Chrome'
const APP = 'Google Chrome.app'
const MAIN = /\/Google Chrome\.app\/Contents\/MacOS\/Google Chrome(?: |$)/
const STEP_MS = 250
const WAIT_STEPS = 60 // 15 seconds to quit, and again to start

export type Run = (cmd: string, args: string[]) => Promise<string>
const runCmd: Run = async (cmd, args) => (await exec(cmd, args, { timeout: 20_000 })).stdout

// The browser process of the user's Chrome: not a helper (--type=), not Chrome for Claude (its own --user-data-dir)
export function mainChrome(ps: string): { pid: number, args: string } | null {
  for (const line of ps.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/)
    if (m && MAIN.test(m[2]) && !/\s--type=/.test(m[2]) && !/\s--user-data-dir=/.test(m[2])) return { pid: Number(m[1]), args: m[2] }
  }
  return null
}

export function createChromeMac({
  port,
  run = runCmd,
  wait = ms => new Promise(r => setTimeout(r, ms)),
  installed = () => ['/Applications', join(homedir(), 'Applications')].some(d => existsSync(join(d, APP))),
  user = userInfo().username,
}: {
  port: number, run?: Run, wait?: (ms: number) => Promise<unknown>, installed?: () => boolean, user?: string,
}): ChromeProxy {
  const flags = proxyFlags(port)
  const ps = async () => mainChrome(await run('ps', ['-axww', '-o', 'pid=,args=']))

  // A company's own proxy policy for Chrome outranks any flag: then this can't work, and says so
  async function companyProxy() {
    for (const domain of ['/Library/Managed Preferences/com.google.Chrome', `/Library/Managed Preferences/${user}/com.google.Chrome`]) {
      try {
        if (/\bProxy(Mode|Server|Settings|PacUrl)\b/.test(await run('defaults', ['read', domain]))) return true
      } catch {}
    }
    return false
  }

  async function state() {
    const base = { on: false, port, pending: false, relaunch: true }
    const no = (why: string) => ({ s: { ...base, supported: false, why } as ProxyState, chrome: null })
    if (!port) return no('turned off in the agent settings (browserProxyPort: 0)')
    if (!installed()) return no('Google Chrome is not installed')
    if (await companyProxy()) return no('the Chrome proxy is set by a company policy')
    const chrome = await ps()
    const on = !!chrome && flags.every(f => chrome.args.includes(f))
    return { s: { ...base, supported: true, on, running: !!chrome } as ProxyState, chrome }
  }

  // Asked to quit the way the system asks (Chrome saves its session), then waited for
  async function quit(pid: number) {
    await run('kill', ['-TERM', String(pid)])
    for (let i = 0; i < WAIT_STEPS; i++) {
      await wait(STEP_MS)
      if (!(await ps())) return
    }
    throw new Error('Chrome did not close within 15 seconds: quit it yourself (⌘Q) and try again')
  }

  // The tabs come back whatever Chrome's own startup setting is
  async function launch(proxy: boolean, restore: boolean) {
    await run('open', ['-b', BUNDLE, '--args', ...(restore ? ['--restore-last-session'] : []), ...(proxy ? flags : [])])
    for (let i = 0; i < WAIT_STEPS; i++) {
      await wait(STEP_MS)
      if (await ps()) return
    }
    throw new Error('Chrome did not start within 15 seconds')
  }

  const status = async () => (await state()).s

  async function on() {
    const { s, chrome } = await state()
    if (!s.supported) throw new Error(`Chrome cannot go through the server on this Mac: ${s.why}`)
    if (s.on) return s
    if (chrome) await quit(chrome.pid)
    await launch(true, !!chrome)
    return status()
  }

  async function off() {
    const { s, chrome } = await state()
    if (!s.on || !chrome) return s
    await quit(chrome.pid)
    await launch(false, true)
    return status()
  }

  return { status, on, off }
}
