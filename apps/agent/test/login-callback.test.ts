import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { waitLoginCallback } from '../src/login-callback.ts'
import { isSignInPage, openInOwnChrome, ownChromeWillDo, type SignInBrowser } from '../src/chrome.ts'

const freePort = () => new Promise<number>(resolve => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address() as { port: number }
    s.close(() => resolve(port))
  })
})

test('the browser\'s way back is caught once, with its code, and the port is free again', async () => {
  const port = await freePort()
  const waiting = waitLoginCallback(port)
  await new Promise(r => setTimeout(r, 50))
  assert.equal((await fetch(`http://127.0.0.1:${port}/favicon.ico`)).status, 404)
  const res = await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=s`)
  assert.equal(res.status, 200)
  assert.match(await res.text(), /Done/)
  assert.deepEqual(await waiting, { path: '/callback?code=abc&state=s' })
  const again = waitLoginCallback(port, 20)
  assert.deepEqual(await again, { path: null }, 'and nobody coming back just ends it')
})

test('a taken port says so instead of hanging', async () => {
  const port = await freePort()
  const s = createServer().listen(port, '127.0.0.1')
  await new Promise(r => s.once('listening', r))
  await assert.rejects(waitLoginCallback(port, 1000), /is taken/)
  await new Promise(r => s.close(r))
})

test('a computer opens only the sign-in pages it knows: the server can\'t send it elsewhere', () => {
  const back = 'redirect_uri=http%3A%2F%2Flocalhost%3A60668%2Fcallback'
  assert.equal(isSignInPage(`https://www.figma.com/oauth/mcp?response_type=code&client_id=x&${back}`), true)
  assert.equal(isSignInPage(`https://mcp.notion.com/authorize?response_type=code&${back}`), true, 'any remote MCP server')
  assert.equal(isSignInPage('https://claude.com/cai/oauth/authorize?code=true'), true)
  for (const bad of [`http://www.figma.com/oauth/mcp?response_type=code&${back}`, 'https://www.figma.com/file/abc', 'https://evil.io/oauth/mcp', `https://evil.io/x?${back}`, 'https://evil.io/x?response_type=code&redirect_uri=https%3A%2F%2Fevil.io%2Fcb', 'https://evil.io/x?response_type=code&redirect_uri=nonsense']) {
    assert.equal(isSignInPage(bad), false, bad)
  }
})

test('a sign-in goes to the user\'s own Chrome only once that Chrome surely goes through the server', () => {
  assert.equal(ownChromeWillDo({ on: true, pending: false }), true)
  assert.equal(ownChromeWillDo({ on: true, pending: true }), false, 'not restarted yet: it may still go directly')
  assert.equal(ownChromeWillDo({ on: false, pending: false }), false)
  assert.equal(ownChromeWillDo(null), false, 'unknown is not through the server')
})

const browsers: SignInBrowser[] = [{ id: 'chrome', name: 'Chrome', exe: 'chrome.exe', kind: 'chromium' }, { id: 'edge', name: 'Edge', exe: 'msedge.exe', kind: 'chromium' }]
const PAGE = 'https://www.figma.com/oauth/mcp?response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A60668%2Fcallback'

test('the own Chrome gets a plain tab: no separate profile, no flags', () => {
  const started: [string, string[]][] = []
  const start = (exe: string, args: string[]) => void started.push([exe, args])
  assert.deepEqual(openInOwnChrome(PAGE, browsers, () => true, start, 'win32'), { browser: 'Chrome', own: true })
  assert.deepEqual(started, [['chrome.exe', [PAGE]]])
  started.length = 0
  openInOwnChrome(PAGE, browsers, () => true, start, 'darwin')
  assert.deepEqual(started, [['open', ['-a', 'Google Chrome', PAGE]]], 'a Mac hands it to the running one')
})

test('the own Chrome opens only sign-in pages, and only Chrome stands in for it', () => {
  const start = () => assert.fail('nothing may start')
  assert.throws(() => openInOwnChrome('https://evil.io/', browsers, () => true, start, 'win32'), /not a page this computer opens/)
  assert.throws(() => openInOwnChrome(PAGE, browsers, p => p === 'msedge.exe', start, 'win32'), /No Chrome/)
})
