import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChromePolicy, policyValues } from '../src/chrome-policy.ts'

// A key of its own, which no Chrome reads: the real policy key is never touched by the tests. Per process: two checkouts
// tested at once on one computer would otherwise take it from each other
const KEY = `HKCU\\Software\\tgcv-test-policy-${process.pid}`
const reg = (...args: string[]) => {
  try {
    return execFileSync('reg', args, { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

test('Chrome through the server: on sets the policy, off puts back what the user had and removes the rest', { skip: process.platform !== 'win32' }, async () => {
  reg('delete', KEY, '/f')
  try {
    // The user had a value of their own for one of the settings
    reg('add', KEY, '/v', 'QuicAllowed', '/t', 'REG_DWORD', '/d', '1', '/f')
    const p = createChromePolicy({ port: 1089, stateFile: join(mkdtempSync(join(tmpdir(), 'tgcv-pol-')), 'state.json'), key: KEY, chromeStart: async () => null })
    assert.deepEqual(await p.status(), { supported: true, on: false, port: 1089, pending: false, relaunch: false })

    assert.equal((await p.on()).on, true)
    // A second «on» keeps the first backup: off must still restore the user's 1, not our 0
    await p.on()
    const now = reg('query', KEY)
    assert.match(now, /ProxyServer\s+REG_SZ\s+socks5:\/\/127\.0\.0\.1:1089/)
    assert.match(now, /WebRtcIPHandling\s+REG_SZ\s+disable_non_proxied_udp/)
    assert.match(now, /QuicAllowed\s+REG_DWORD\s+0x0/)

    assert.equal((await p.off()).on, false)
    const after = reg('query', KEY)
    assert.match(after, /QuicAllowed\s+REG_DWORD\s+0x1/)
    for (const name of Object.keys(policyValues(1089)).filter(n => n !== 'QuicAllowed')) assert.doesNotMatch(after, new RegExp(name))
  } finally {
    reg('delete', KEY, '/f')
  }
})

test('nowhere to do it: other systems, or the proxy turned off, say so instead of half-working', async () => {
  const mac = createChromePolicy({ port: 1089, stateFile: 'x', platform: 'darwin' })
  assert.deepEqual(await mac.status(), { supported: false, on: false, port: 1089, pending: false, relaunch: false, why: 'not available on this system yet' })
  await assert.rejects(mac.on(), /Windows/)
  await assert.rejects(createChromePolicy({ port: 0, stateFile: 'x', platform: 'win32' }).on(), /browserProxyPort/)
})

test('a switch waits for Chrome to restart: one started before it still goes the old way', { skip: process.platform !== 'win32' }, async () => {
  reg('delete', KEY, '/f')
  try {
    let started: number | null = Date.now() - 60_000
    const p = createChromePolicy({ port: 1089, stateFile: join(mkdtempSync(join(tmpdir(), 'tgcv-pol-')), 'state.json'), key: KEY, chromeStart: async () => started })
    // Nothing switched yet: whatever Chrome runs is as it should be
    assert.equal((await p.status()).pending, false)
    assert.deepEqual(await p.on(), { supported: true, on: true, port: 1089, pending: true, relaunch: false })
    // Restarted after the switch, or not running at all
    started = Date.now() + 1000
    assert.equal((await p.status()).pending, false)
    started = null
    assert.equal((await p.status()).pending, false)
    // «On» again changes nothing, so the restarted Chrome stays fine
    started = Date.now()
    await new Promise(r => setTimeout(r, 5))
    await p.on()
    assert.equal((await p.status()).pending, false)
    // «Off» is a switch too
    assert.deepEqual(await p.off(), { supported: true, on: false, port: 1089, pending: true, relaunch: false })
  } finally {
    reg('delete', KEY, '/f')
  }
})

// Stands in for HKLM: a machine policy outranks the user's, and the tests never write to HKLM
const MACHINE = `HKCU\\Software\\tgcv-test-machine-${process.pid}`

test('the user\'s own ProxySettings outranks ProxyMode/ProxyServer: on takes it over, off gives it back', { skip: process.platform !== 'win32' }, async () => {
  reg('delete', KEY, '/f')
  try {
    reg('add', KEY, '/v', 'ProxySettings', '/t', 'REG_SZ', '/d', '{"ProxyMode":"direct"}', '/f')
    const p = createChromePolicy({ port: 1089, stateFile: join(mkdtempSync(join(tmpdir(), 'tgcv-pol-')), 'state.json'), key: KEY, machineKey: MACHINE, chromeStart: async () => null })
    // ProxyServer alone would say «on» while Chrome goes straight
    reg('add', KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', 'socks5://127.0.0.1:1089', '/f')
    assert.equal((await p.status()).on, false)
    assert.equal((await p.on()).on, true)
    assert.match(reg('query', KEY, '/v', 'ProxySettings'), /socks5:\/\/127\.0\.0\.1:1089/)
    await p.off()
    assert.match(reg('query', KEY, '/v', 'ProxySettings'), /"direct"/)
  } finally {
    reg('delete', KEY, '/f')
  }
})

test('a machine proxy or WebRTC policy outranks the user\'s: it says so and doesn\'t pretend', { skip: process.platform !== 'win32' }, async () => {
  reg('delete', KEY, '/f')
  reg('delete', MACHINE, '/f')
  try {
    reg('add', MACHINE, '/v', 'ProxyMode', '/t', 'REG_SZ', '/d', 'direct', '/f')
    const p = createChromePolicy({ port: 1089, stateFile: join(mkdtempSync(join(tmpdir(), 'tgcv-pol-')), 'state.json'), key: KEY, machineKey: MACHINE, chromeStart: async () => null })
    const s = await p.status()
    assert.equal(s.supported, false)
    assert.match(s.why!, /machine policy/)
    await assert.rejects(p.on(), /machine policy/)
    assert.equal(reg('query', KEY), '')
  } finally {
    reg('delete', KEY, '/f')
    reg('delete', MACHINE, '/f')
  }
})

test('a second «off» leaves alone what the first one put back', { skip: process.platform !== 'win32' }, async () => {
  reg('delete', KEY, '/f')
  try {
    reg('add', KEY, '/v', 'QuicAllowed', '/t', 'REG_DWORD', '/d', '1', '/f')
    const p = createChromePolicy({ port: 1089, stateFile: join(mkdtempSync(join(tmpdir(), 'tgcv-pol-')), 'state.json'), key: KEY, machineKey: MACHINE, chromeStart: async () => null })
    await p.on()
    await p.off()
    await p.off()
    assert.match(reg('query', KEY), /QuicAllowed\s+REG_DWORD\s+0x1/)
  } finally {
    reg('delete', KEY, '/f')
  }
})

test("Claude's Chrome: the user's own, with no page, and a running one is left as it is", async () => {
  const { startOwnChrome } = await import('../src/chrome.ts')
  const chrome = [{ id: 'chrome', name: 'Google Chrome', exe: 'C:/chrome.exe' }] as never
  const calls: unknown[] = []
  const start = (exe: string, args: string[]) => void calls.push([exe, args])
  assert.deepEqual(await startOwnChrome(chrome, () => true, start, async () => false, 'win32'), { started: true })
  assert.deepEqual(calls.at(-1), ['C:/chrome.exe', []])
  assert.deepEqual(await startOwnChrome(chrome, () => true, start, async () => false, 'darwin'), { started: true })
  assert.deepEqual(calls.at(-1), ['open', ['-a', 'Google Chrome']])
  calls.length = 0
  assert.deepEqual(await startOwnChrome(chrome, () => true, start, async () => true, 'win32'), { started: false })
  assert.deepEqual(calls, [])
  await assert.rejects(startOwnChrome(chrome, () => false, start, async () => false, 'win32'), /No Chrome/)
})
