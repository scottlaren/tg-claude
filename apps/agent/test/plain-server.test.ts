import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, plainServerProblem } from '../src/config.ts'

test('the computer\'s key never crosses a network in the open: wss anywhere, plain ws on this computer only', () => {
  for (const ok of ['wss://vps.example/device', 'wss://1-2-3-4.sslip.io/device', 'ws://127.0.0.1:8787/device', 'ws://localhost:8787/device', 'ws://127.5.6.7/device', 'ws://[::1]:8787/device']) {
    assert.equal(plainServerProblem(ok), null, ok)
  }
  for (const bad of ['ws://vps.example/device', 'ws://192.168.1.80:8787/device', 'ws://10.0.0.5/device', 'ws://localhost.evil.example/device', 'ws://127.0.0.1.evil.example/device', 'ws://server:8787/device']) {
    assert.match(plainServerProblem(bad) ?? '', /is not encrypted: this computer's key would cross the network in the open/, bad)
  }
  assert.match(plainServerProblem('http://vps.example/device') ?? '', /must start with wss:\/\//)
  assert.match(plainServerProblem('vps.example') ?? '', /is not an address/)
  // The cloud container talks to the server inside the VPS; a network of one's own is one's own decision
  assert.equal(plainServerProblem('ws://server:8787/device', { cloud: true }), null)
  assert.equal(plainServerProblem('ws://192.168.1.80:8787/device', { allowed: true }), null)
})

test('a config with a plain address elsewhere does not load, and says how to mend it; the cloud\'s and an allowed one do', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-plain-'))
  try {
    const file = join(dir, 'agent.config.json')
    const save = (o: object) => writeFileSync(file, JSON.stringify({ deviceKey: 'k', mcpFromClaude: false, ...o }))
    save({ serverUrl: 'ws://vps.example/device', deviceId: 'pc' })
    assert.throws(() => loadConfig(file, dir), /not encrypted.*wss:\/\/.*"plainServer": true/)
    save({ serverUrl: 'ws://vps.example/device', deviceId: 'pc', plainServer: true })
    assert.equal(loadConfig(file, dir).serverUrl, 'ws://vps.example/device')
    save({ serverUrl: 'ws://server:8787/device', deviceId: 'cloud' })
    assert.equal(loadConfig(file, dir).deviceId, 'cloud')
    save({ serverUrl: 'wss://vps.example/device', deviceId: 'pc' })
    assert.equal(loadConfig(file, dir).serverUrl, 'wss://vps.example/device')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
