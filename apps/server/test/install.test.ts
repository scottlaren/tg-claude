import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGateway } from '../src/gateway.ts'
import { createDeviceRegistry, createPairing } from '../src/devices.ts'
import { createInstallRoutes, installLines } from '../src/install.ts'

const quiet = { info() {}, warn() {}, error() {}, debug() {} }

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tgcv-install-'))
  const registry = createDeviceRegistry(join(root, 'devices.json'), new Map([['pc', 'secret']]))
  const pairing = createPairing()
  const bundle = { data: Buffer.from('fake bundle'), sha256: 'abc123' }
  const http = createInstallRoutes({ pairing, registry, publicUrl: 'wss://bot.example/device', bundles: async () => bundle, nodeVersion: 'v24.1.0' })
  const gateway = createGateway({ port: 0, host: '127.0.0.1', registry, pairing, log: quiet, http })
  const base = `http://127.0.0.1:${await gateway.ready}`
  return { gateway, pairing, base, code: pairing.create(1).code }
}

test('/pair gives one line per system, pointing at this server', () => {
  assert.deepEqual(installLines('wss://bot.example/device', 'ABCD-EFGH'), {
    windows: 'irm https://bot.example/install/ABCD-EFGH/windows | iex',
    macos: 'curl -fsSL https://bot.example/install/ABCD-EFGH/macos | bash',
  })
})

test('a live code gets the script with this server, the code and the Node version in it, and the agent', async () => {
  const { gateway, base, code, pairing } = await setup()
  try {
    const win = await (await fetch(`${base}/install/${code}/windows`)).text()
    assert.match(win, /\$Server = 'https:\/\/bot\.example'/)
    assert.match(win, /\$Wss = 'wss:\/\/bot\.example\/device'/)
    assert.match(win, new RegExp(`\\$Code = '${code}'`))
    assert.match(win, /\$NodeVersion = 'v24\.1\.0'/)
    const mac = await (await fetch(`${base}/install/${code.toLowerCase()}/macos`)).text()
    assert.match(mac, new RegExp(`CODE='${code}'`))
    const agent = await fetch(`${base}/install/${code}/agent.tar.gz`)
    assert.equal(agent.headers.get('x-sha256'), 'abc123')
    assert.equal(Buffer.from(await agent.arrayBuffer()).toString(), 'fake bundle')
    // Downloading doesn't spend the code: the pairing at the end does
    assert.deepEqual(pairing.consume(code), { chatId: 1, topicId: undefined })
  } finally {
    gateway.close()
  }
})

// The Mac's bash 3.2 takes a byte of «…» or a Cyrillic letter right after $NAME for part of the name, PowerShell a
// letter: `${NAME}…` there, never `$NAME…`
test('no variable in the scripts runs straight into a non-ASCII character', () => {
  for (const f of ['install-agent.sh', 'install-agent.ps1']) {
    const text = readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8')
    const bad = text.split('\n').map((l, i) => [i + 1, l] as const).filter(([, l]) => /\$[A-Za-z_]\w*[^\x00-\x7F]/.test(l))
    assert.deepEqual(bad, [], f)
  }
})

test('a wrong code gets a script that only says why, and counts toward the lock; junk never reaches a script', async () => {
  const { gateway, base } = await setup()
  try {
    const r = await fetch(`${base}/install/ZZZZ-ZZZZ/windows`)
    assert.equal(r.status, 404)
    assert.match(await r.text(), /^Write-Host '.*\/pair' -ForegroundColor Red$/)
    assert.equal((await fetch(`${base}/install/ZZZZ-ZZZZ/agent.tar.gz`)).status, 404)
    const junk = await fetch(`${base}/install/${encodeURIComponent("x'; rm -rf ~; '")}/macos`)
    assert.equal(junk.status, 404)
    assert.doesNotMatch(await junk.text(), /rm -rf/)
    for (let i = 0; i < 10; i++) await fetch(`${base}/install/YYYY-YYYY/agent.tar.gz`)
    assert.match(await (await fetch(`${base}/install/YYYY-YYYY/agent.tar.gz`)).text(), /Too many wrong codes/)
  } finally {
    gateway.close()
  }
})

test('updates are for paired computers only: their own key opens /agent/bundle', async () => {
  const { gateway, base } = await setup()
  try {
    assert.equal((await fetch(`${base}/agent/bundle`)).status, 403)
    assert.equal((await fetch(`${base}/agent/bundle`, { headers: { 'x-tgcv-device': 'pc', 'x-tgcv-key': 'wrong' } })).status, 403)
    const ok = await fetch(`${base}/agent/bundle`, { headers: { 'x-tgcv-device': 'pc', 'x-tgcv-key': 'secret' } })
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('x-sha256'), 'abc123')
    // Anything else on this port is not there
    assert.equal((await fetch(`${base}/`)).status, 404)
  } finally {
    gateway.close()
  }
})

test('a malformed address gets a refusal and the server stays up', async () => {
  const { gateway, base } = await setup()
  for (const bad of ['/install/%FF/windows', '/install/%E0%A4%A/macos', '/install/%/agent.tar.gz']) {
    assert.equal((await fetch(base + bad)).status, 404, bad)
  }
  assert.equal((await fetch(`${base}/agent/bundle`)).status, 403, 'still answering')
  gateway.close()
})
