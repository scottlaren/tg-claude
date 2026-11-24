import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeMcp, machineName } from '../src/config.ts'
import { defaultConfig } from '../src/init.ts'
import { createWorkspace } from '../src/workspace.ts'

const imported = {
  Roblox_Studio: { command: 'cmd.exe', args: ['/c', 'mcp.bat'] },
  blender: { command: 'blender-mcp' },
  aeuxe: { command: 'node', args: ['aeuxe.mjs'] },
}

test("Claude Code's MCP list is the base; the config adjusts, adds and drops", () => {
  const m = mergeMcp({
    mcpFromClaude: true,
    mcpServers: { Roblox_Studio: { perTopic: true }, extra: { command: 'x' } },
    mcpExclude: ['aeuxe'],
  }, imported)
  assert.deepEqual(Object.keys(m).sort(), ['Roblox_Studio', 'blender', 'extra'])
  assert.deepEqual(m.Roblox_Studio, { command: 'cmd.exe', args: ['/c', 'mcp.bat'], perTopic: true })
  // Without mcpFromClaude only explicit, complete entries count
  assert.deepEqual(Object.keys(mergeMcp({ mcpServers: { Roblox_Studio: { perTopic: true }, extra: { command: 'x' } } }, imported)), ['extra'])
})

test('a Mac goes by its name without «.local»', () => {
  assert.equal(machineName('MacBook-Pro-Scott.local'), 'MacBook-Pro-Scott')
  assert.equal(machineName('MacBook-Pro-Scott.LOCAL'), 'MacBook-Pro-Scott')
  assert.equal(machineName('DESKTOP-ABC'), 'DESKTOP-ABC')
  assert.equal(machineName('my.local.box'), 'my.local.box')
})

test('init guesses the workspace and marks the Roblox MCP per topic', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-home-')))
  mkdirSync(join(home, 'Desktop', 'code'), { recursive: true })
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: imported }))
  const cfg = defaultConfig({ os: 'macos', serverUrl: 'wss://vps.example/device', name: 'MacBook Air', home })
  assert.equal(cfg.deviceName, 'MacBook Air')
  assert.deepEqual(cfg.zones, [{ path: join(home, 'Desktop', 'code'), exclude: [] }])
  assert.equal(cfg.mcpFromClaude, true)
  assert.deepEqual(cfg.mcpServers, { Roblox_Studio: { perTopic: true } })
  assert.equal(cfg.serverUrl, 'wss://vps.example/device')
})

test('a new project is a fresh folder in the first zone; bad names and existing folders are refused', () => {
  const zone = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-new-')))
  mkdirSync(join(zone, 'taken'))
  const ws = createWorkspace({ projects: [], zones: [{ path: zone }], stateFile: join(zone, '..', 'tgcv-new-state.json'), selfDir: join(zone, 'nope') })
  const p = ws.createProject('Ферма 2')
  assert.equal(p.path, join(zone, 'Ферма 2'))
  assert.ok(existsSync(p.path))
  assert.ok(ws.list().some(x => x.id === p.id))
  const code = (c: string) => (e: unknown) => (e as { code: string }).code === c
  assert.throws(() => ws.createProject('taken'), code('exists'))
  assert.throws(() => ws.createProject('../escape'), code('bad_request'))
  assert.throws(() => ws.createProject(''), code('bad_request'))
})
