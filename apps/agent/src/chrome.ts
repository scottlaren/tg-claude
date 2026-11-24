import { isRunning } from './apps.ts'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join, posix, win32 } from 'node:path'

// Chrome for Claude: a Chrome of its own, apart from the user's, that reaches the web only through the browser
// tunnel, so sites see the server's address. Its own profile holds none of the user's sign-ins. WebRTC may not
// send around the proxy, and no name is looked up on this computer: if the tunnel is down, nothing loads at all
export function chromePath(): string | null {
  const env = process.env
  const candidates = process.platform === 'win32'
    ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).map(d => join(d!, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  return candidates.find(p => existsSync(p)) ?? null
}

export function profileDir() {
  const base = process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? homedir(), 'tg-claude-vps')
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'tg-claude-vps')
      : join(homedir(), '.config', 'tg-claude-vps')
  return join(base, 'chrome-claude')
}

// Out through the browser tunnel and nowhere else; the user's own Chrome on a Mac is started with these too
export const proxyFlags = (port: number) => [
  `--proxy-server=socks5://127.0.0.1:${port}`,
  // Every name goes to the proxy, none to this computer's DNS
  // but this computer's own: a sign-in page comes back to localhost
  '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost',
  // WebRTC would otherwise tell a page the real address in a way that skips the proxy
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
]

export function chromeArgs(port: number, dir: string, pages: string[] = []) {
  return [
    `--user-data-dir=${dir}`,
    ...proxyFlags(port),
    '--no-first-run',
    '--no-default-browser-check',
    ...pages,
  ]
}

// Whether the agent's proxy is up: without it this Chrome loads nothing (and leaks nothing)
export const proxyUp = (port: number) => new Promise<boolean>(resolve => {
  const s = connect(port, '127.0.0.1')
  s.setTimeout(1500, () => {
    s.destroy()
    resolve(false)
  })
  s.once('connect', () => {
    s.destroy()
    resolve(true)
  })
  s.once('error', () => resolve(false))
})

// The first start opens the pages to set it up: the Claude extension, and the address sites see
export const FIRST_PAGES = ['https://api.ipify.org/', 'https://chromewebstore.google.com/search/Claude']

export async function launchChrome(port: number, log: (...a: unknown[]) => void) {
  const exe = chromePath()
  if (!exe) throw new Error('Google Chrome not found: install it and try again')
  if (!port) throw new Error('The browser proxy is turned off (browserProxyPort: 0 in agent.config.json)')
  const dir = profileDir()
  const first = !existsSync(dir)
  mkdirSync(dir, { recursive: true })
  if (!(await proxyUp(port))) log(`⚠ The proxy on 127.0.0.1:${port} is not answering: start the agent (npm run agent), without it this Chrome opens nothing`)
  spawn(exe, chromeArgs(port, dir, first ? FIRST_PAGES : []), { detached: true, stdio: 'ignore', windowsHide: false }).unref()
  return { exe, dir, first }
}

// Browsers the sign-in window can open in, in this order: Chrome, Firefox, Edge, Brave, Yandex. The Chromium
// family takes the proxy as flags, Firefox as settings in a profile of its own; Edge comes with every Windows.
// Safari can't: it has no proxy but the Mac's
export type SignInBrowser = { id: string, name: string, exe: string, kind: 'chromium' | 'firefox' }

export function signInBrowsers(env: NodeJS.ProcessEnv = process.env, platform = process.platform, home = homedir()): SignInBrowser[] {
  const b = (id: string, name: string, kind: SignInBrowser['kind']) => (exe: string): SignInBrowser => ({ id, name, exe, kind })
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean) as string[]
    const at = (...p: string[]) => roots.map(r => win32.join(r, ...p))
    return [
      ...at('Google', 'Chrome', 'Application', 'chrome.exe').map(b('chrome', 'Chrome', 'chromium')),
      ...at('Mozilla Firefox', 'firefox.exe').map(b('firefox', 'Firefox', 'firefox')),
      ...at('Microsoft', 'Edge', 'Application', 'msedge.exe').map(b('edge', 'Edge', 'chromium')),
      ...at('BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe').map(b('brave', 'Brave', 'chromium')),
      ...at('Yandex', 'YandexBrowser', 'Application', 'browser.exe').map(b('yandex', 'Yandex Browser', 'chromium')),
    ]
  }
  if (platform === 'darwin') {
    const apps = ['/Applications', posix.join(home, 'Applications')]
    const app = (bundle: string, bin: string) => apps.map(a => posix.join(a, `${bundle}.app`, 'Contents', 'MacOS', bin))
    return [
      ...app('Google Chrome', 'Google Chrome').map(b('chrome', 'Chrome', 'chromium')),
      ...app('Firefox', 'firefox').map(b('firefox', 'Firefox', 'firefox')),
      ...app('Microsoft Edge', 'Microsoft Edge').map(b('edge', 'Edge', 'chromium')),
      ...app('Brave Browser', 'Brave Browser').map(b('brave', 'Brave', 'chromium')),
      ...app('Yandex', 'Yandex').map(b('yandex', 'Yandex Browser', 'chromium')),
    ]
  }
  return [
    ...['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].map(b('chrome', 'Chrome', 'chromium')),
    b('firefox', 'Firefox', 'firefox')('/usr/bin/firefox'),
    ...['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'].map(b('chromium', 'Chromium', 'chromium')),
  ]
}

// Firefox's own settings for the same as the Chromium flags: everything through the server's tunnel, names looked
// up there (no DNS here, no DNS over HTTPS), WebRTC only through the proxy, no HTTP/3 or prefetching around it,
// none of Firefox's own background checks, no welcome pages
export const firefoxPrefs = (port: number) => Object.entries({
  'network.proxy.type': 1,
  'network.proxy.socks': '127.0.0.1',
  'network.proxy.socks_port': port,
  'network.proxy.socks_version': 5,
  'network.proxy.socks_remote_dns': true,
  'network.proxy.socks5_remote_dns': true,
  'network.proxy.no_proxies_on': '',
  'network.trr.mode': 5,
  'media.peerconnection.ice.proxy_only': true,
  'media.peerconnection.ice.default_address_only': true,
  'network.http.http3.enable': false,
  'network.dns.disablePrefetch': true,
  'network.prefetch-next': false,
  'network.predictor.enabled': false,
  'network.http.speculative-parallel-limit': 0,
  'network.captive-portal-service.enabled': false,
  'network.connectivity-service.enabled': false,
  'browser.shell.checkDefaultBrowser': false,
  'browser.aboutwelcome.enabled': false,
  'datareporting.policy.dataSubmissionPolicyBypassNotification': true,
}).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n') + '\n'

// Only Claude's own sign-in page may be opened this way: the server can't send this computer anywhere else
export function isSignInPage(raw: string) {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    if (['claude.com', 'claude.ai'].includes(u.hostname) && /\/oauth\/authorize$/.test(u.pathname)) return true
    // A remote MCP server's sign-in, wherever it lives (Figma, Notion…): the shape of one that comes back to this computer
    const back = new URL(u.searchParams.get('redirect_uri') ?? 'about:blank')
    return u.searchParams.get('response_type') === 'code' && back.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(back.hostname)
  } catch {
    return false
  }
}

// And Claude's usage page, where the free limit resets are: the same account, seen from the same address as at sign-in
export const USAGE_PAGE = 'https://claude.ai/settings/usage'
export const isServerPage = (raw: string) => raw === USAGE_PAGE || isSignInPage(raw)

// With the user's own Chrome going through the server, a sign-in needs no window of its own: a new tab there already
// shows the server's address, and they are signed in to whatever they use. `pending`: Chrome hasn't restarted since
// the switch, so it may still be going directly
export const ownChromeWillDo = (s: { on: boolean, pending: boolean } | null | undefined) => !!s?.on && !s.pending

export function openInOwnChrome(url: string, browsers = signInBrowsers(), exists: (p: string) => boolean = existsSync,
  start: (exe: string, args: string[]) => void = (exe, args) => spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref(),
  platform = process.platform) {
  if (!isServerPage(url)) throw new Error('This is not a page this computer opens through the server')
  const chrome = browsers.find(b => b.id === 'chrome' && exists(b.exe))
  if (!chrome) throw new Error('No Chrome on this computer')
  // On a Mac the binary would start a second Chrome; `open` hands the page to the running one
  if (platform === 'darwin') start('open', ['-a', 'Google Chrome', url])
  else start(chrome.exe, [url])
  return { browser: chrome.name, own: true }
}

// The user's own Chrome, with no page: it takes a running one as it is. Only that: Claude asks for this through the bot
export async function startOwnChrome(browsers = signInBrowsers(), exists: (p: string) => boolean = existsSync,
  start: (exe: string, args: string[]) => void = (exe, args) => spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref(),
  running: (name: string) => Promise<boolean> = isRunning, platform = process.platform) {
  const chrome = browsers.find(b => b.id === 'chrome' && exists(b.exe))
  if (!chrome) throw new Error('No Chrome on this computer')
  if (await running(platform === 'win32' ? 'chrome.exe' : 'Google Chrome')) return { started: false }
  if (platform === 'darwin') start('open', ['-a', 'Google Chrome'])
  else start(chrome.exe, [])
  return { started: true }
}

// The Claude sign-in for the server, opened here in a window that goes out through the server: a browser with a
// profile of its own (the user's browsers and their sign-ins stay as they are), so claude.ai sees the server's
// address while signing in, whatever browser is the default
export async function openSignIn(url: string, port: number, browsers = signInBrowsers(), exists: (p: string) => boolean = existsSync,
  start: (exe: string, args: string[]) => void = (exe, args) => spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref(),
  home = homedir()) {
  if (!isServerPage(url)) throw new Error('This is not a page this computer opens through the server')
  if (!port) throw new Error('The browser proxy is turned off on this computer (browserProxyPort: 0)')
  if (!(await proxyUp(port))) throw new Error('The browser proxy is not answering: restart the agent')
  const browser = browsers.find(b => exists(b.exe))
  if (!browser) {
    throw new Error(process.platform === 'darwin'
      ? 'No Chrome, Firefox, Edge, Brave or Yandex Browser (Safari cannot go through the server: it only has the proxy of the whole Mac)'
      : 'No Chrome, Firefox, Edge, Brave or Yandex Browser')
  }
  const dir = join(home, '.tg-claude-vps', 'sign-in-browser', browser.id)
  mkdirSync(dir, { recursive: true })
  if (browser.kind === 'firefox') {
    // Rewritten every time: the port may have changed, and nothing of the user's lives in this profile
    writeFileSync(join(dir, 'user.js'), firefoxPrefs(port))
    start(browser.exe, ['-profile', dir, '-no-remote', '-new-instance', url])
  } else {
    start(browser.exe, [`--user-data-dir=${dir}`, ...proxyFlags(port), '--no-first-run', '--no-default-browser-check', '--new-window', url])
  }
  return { browser: browser.name }
}
