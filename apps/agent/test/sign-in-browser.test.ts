import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { signInBrowsers, isSignInPage as isClaudeSignIn, isServerPage, USAGE_PAGE, openSignIn, proxyFlags, firefoxPrefs, type SignInBrowser } from '../src/chrome.ts'

const URL_OK = 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=y'

test('only Claude\'s own sign-in page is opened: the server can\'t send the computer elsewhere', () => {
  assert.equal(isClaudeSignIn(URL_OK), true)
  assert.equal(isClaudeSignIn('https://claude.ai/oauth/authorize?x=1'), true)
  for (const bad of ['http://claude.com/cai/oauth/authorize', 'https://claude.com.evil.io/cai/oauth/authorize', 'https://evil.io/?u=https://claude.com/cai/oauth/authorize',
    'https://claude.com/download', 'javascript:alert(1)', 'file:///C:/x']) assert.equal(isClaudeSignIn(bad), false, bad)
})

test('Chrome, then Firefox, then Edge, Brave, Yandex; Windows always has Edge', () => {
  const win = signInBrowsers({ PROGRAMFILES: 'C:\\PF', 'PROGRAMFILES(X86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\L' }, 'win32')
  assert.deepEqual([...new Set(win.map(b => b.id))], ['chrome', 'firefox', 'edge', 'brave', 'yandex'])
  assert.ok(win.some(b => /msedge\.exe$/.test(b.exe)))
  assert.ok(win.some(b => b.exe === 'C:\\PF\\Mozilla Firefox\\firefox.exe' && b.kind === 'firefox'))
  const mac = signInBrowsers({}, 'darwin', '/Users/me')
  assert.ok(mac.some(b => b.exe === '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'))
  assert.ok(mac.some(b => b.exe === '/Applications/Firefox.app/Contents/MacOS/firefox'))
})

test('Firefox gets the same as the Chromium flags, as its own settings', () => {
  const prefs = firefoxPrefs(1089)
  assert.match(prefs, /user_pref\("network\.proxy\.type", 1\);/)
  assert.match(prefs, /user_pref\("network\.proxy\.socks_port", 1089\);/)
  assert.match(prefs, /user_pref\("network\.proxy\.socks_remote_dns", true\);/)
  assert.match(prefs, /user_pref\("network\.trr\.mode", 5\);/)
  assert.match(prefs, /user_pref\("media\.peerconnection\.ice\.proxy_only", true\);/)
  assert.match(prefs, /user_pref\("network\.http\.http3\.enable", false\);/)
})

test('the window opens with a profile of its own and the proxy, or the reason why not', async () => {
  // The agent's proxy, listening
  const socks = createServer(s => s.end())
  await new Promise<void>(r => socks.listen(0, '127.0.0.1', () => r()))
  const port = (socks.address() as { port: number }).port
  const home = mkdtempSync(join(tmpdir(), 'tgcv-signin-'))
  try {
    const started: { exe: string, args: string[] }[] = []
    const start = (exe: string, args: string[]) => { started.push({ exe, args }) }
    const browsers: SignInBrowser[] = [
      { id: 'chrome', name: 'Chrome', exe: 'C:/no/chrome.exe', kind: 'chromium' },
      { id: 'edge', name: 'Edge', exe: 'C:/edge/msedge.exe', kind: 'chromium' },
      { id: 'firefox', name: 'Firefox', exe: 'C:/ff/firefox.exe', kind: 'firefox' },
    ]
    assert.deepEqual(await openSignIn(URL_OK, port, browsers, p => p.includes('edge'), start, home), { browser: 'Edge' })
    assert.equal(started[0].exe, 'C:/edge/msedge.exe')
    assert.ok(started[0].args.includes(`--user-data-dir=${join(home, '.tg-claude-vps', 'sign-in-browser', 'edge')}`))
    for (const f of proxyFlags(port)) assert.ok(started[0].args.includes(f), f)
    assert.equal(started[0].args.at(-1), URL_OK)

    // Only Firefox: its own profile with the proxy settings written into it
    assert.deepEqual(await openSignIn(URL_OK, port, browsers, p => p.includes('ff'), start, home), { browser: 'Firefox' })
    const profile = join(home, '.tg-claude-vps', 'sign-in-browser', 'firefox')
    assert.deepEqual(started[1].args, ['-profile', profile, '-no-remote', '-new-instance', URL_OK])
    assert.equal(readFileSync(join(profile, 'user.js'), 'utf8'), firefoxPrefs(port))

    await assert.rejects(openSignIn('https://evil.io/', port, browsers, () => true, start, home), /not a page this computer opens/)
    await assert.rejects(openSignIn(URL_OK, port, browsers, () => false, start, home), /No Chrome, Firefox, Edge/)
    await assert.rejects(openSignIn(URL_OK, 0, browsers, () => true, start, home), /turned off/)
  } finally {
    socks.close()
  }
})

test('claude.ai\'s usage page opens through the server too, and nothing that only looks like it', () => {
  assert.equal(isServerPage(USAGE_PAGE), true)
  assert.equal(isServerPage(URL_OK), true)
  for (const bad of ['https://claude.ai/settings/usage?next=https://evil.io', 'http://claude.ai/settings/usage', 'https://claude.ai.evil.io/settings/usage', 'https://claude.ai/settings/billing']) {
    assert.equal(isServerPage(bad), false, bad)
  }
})
