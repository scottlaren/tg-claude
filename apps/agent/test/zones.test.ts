import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { listFolders, suggestZones, checkZone, createZones, isSystemVolume, deniedMessage, saveZones } from '../src/zones.ts'
import { createWorkspace } from '../src/workspace.ts'
import { loadConfig } from '../src/config.ts'
import { createExecutor } from '../src/executor.ts'
import type { FolderList, OpEvent, OpTool, ZonesState } from '@tgcv/protocol'

const tree = (paths: string[]) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-zones-')))
  for (const p of paths) {
    if (p.endsWith('/')) mkdirSync(join(root, p), { recursive: true })
    else {
      mkdirSync(join(root, p, '..'), { recursive: true })
      writeFileSync(join(root, p), '')
    }
  }
  return root
}

test('browsing shows folders only, by name, no hidden ones, with the way up', () => {
  const root = tree(['b/', 'A/', 'c10/', 'c9/', '.git/', 'notes.txt'])
  const list = listFolders(root)
  assert.deepEqual(list.folders.map(f => f.name), ['A', 'b', 'c9', 'c10'])
  assert.equal(list.folders[0].path, join(root, 'A'))
  assert.equal(list.parent, join(root, '..'))
  assert.equal(list.more, 0)
  assert.equal(listFolders(parse(root).root).parent, null)
  assert.throws(() => listFolders(join(root, 'nope')), /No such folder/)
})

test('suggestions: folders in home that hold git projects, the fullest first, none already taken', () => {
  const home = tree([
    'code/one/.git/', 'code/two/.git/',
    'Documents/GitHub/a/.git/', 'Documents/GitHub/b/.git/', 'Documents/GitHub/c/.git/',
    'Desktop/work/x/.git/', 'Desktop/work/plain/',
    'Library/Caches/repo/.git/',
    'single/.git/', 'single/sub/.git/',
    'empty/',
  ])
  const found = suggestZones(home, [join(home, 'code')], join(home, '.tg-claude-vps', 'agent'))
  assert.deepEqual(found, [
    { path: join(home, 'Documents', 'GitHub'), projects: 3 },
    { path: join(home, 'Desktop', 'work'), projects: 1 },
  ])
})

test('a working folder must exist, and be neither a drive root nor the agent itself', () => {
  const root = tree(['agent/apps/', 'work/'])
  const self = join(root, 'agent')
  assert.equal(checkZone(join(root, 'work'), self), join(root, 'work'))
  assert.throws(() => checkZone(parse(root).root, self), /drive root/)
  assert.throws(() => checkZone(join(self, 'apps'), self), /agent's own folder/)
  assert.throws(() => checkZone(join(root, 'gone'), self), /No such folder/)
})

test('changing working folders applies at once and keeps the rest of the config as written', () => {
  const root = tree(['code/old-project/', 'GitHub/new-project/', 'GitHub/other/'])
  const file = join(root, 'agent.config.json')
  writeFileSync(file, JSON.stringify({ serverUrl: 'wss://x', deviceId: 'pc', deviceKey: 'k', zones: [{ path: join(root, 'code'), exclude: ['tmp'] }], apps: { ae: {} } }))
  const workspace = createWorkspace({ projects: [], zones: [{ path: join(root, 'code'), exclude: ['tmp'] }], stateFile: join(root, 'state.json'), selfDir: join(root, 'agent') })
  const zones = createZones({ workspace, file, selfDir: join(root, 'agent'), home: root })
  assert.deepEqual(zones.state().zones, [{ path: join(root, 'code'), projects: 1 }])

  // Added next to it: the folder that stays keeps what it excluded
  assert.deepEqual(zones.set([join(root, 'code'), join(root, 'GitHub')]).zones.map(z => z.projects), [1, 2])
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).zones, [{ path: join(root, 'code'), exclude: ['tmp'] }, { path: join(root, 'GitHub'), exclude: [] }])

  const replaced = zones.set([join(root, 'GitHub')])
  assert.deepEqual(replaced.zones, [{ path: join(root, 'GitHub'), projects: 2 }])
  assert.deepEqual(workspace.list().map(p => p.name).sort(), ['new-project', 'other'])
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(saved.zones, [{ path: join(root, 'GitHub'), exclude: [] }])
  assert.deepEqual(saved.apps, { ae: {} })
  assert.equal(saved.deviceKey, 'k')
  assert.throws(() => zones.set([join(root, 'missing')]), /No such folder/)
})

test('a working folder gone from the disk is skipped: the agent still starts', () => {
  const root = tree(['code/'])
  const file = join(root, 'agent.config.json')
  writeFileSync(file, JSON.stringify({
    serverUrl: 'wss://x', deviceId: 'pc', deviceKey: 'k', mcpFromClaude: false,
    zones: [{ path: join(root, 'gone') }, { path: join(root, 'code') }],
  }))
  const cfg = loadConfig(file)
  assert.deepEqual(cfg.zones, [{ path: join(root, 'code'), exclude: [] }])
  assert.deepEqual(cfg.missingZones, [join(root, 'gone')])
})

test('the agent has its own list of MCP servers, and a mistake in it does not stop the agent', () => {
  const root = tree(['code/'])
  const file = join(root, 'agent.config.json')
  writeFileSync(file, JSON.stringify({
    serverUrl: 'wss://x', deviceId: 'pc', deviceKey: 'k', mcpFromClaude: false,
    zones: [{ path: join(root, 'code') }],
    mcpServers: { both: { command: 'from-config' } },
  }))
  assert.deepEqual(Object.keys(loadConfig(file).mcpServers), ['both'], 'no file, nothing changes')

  writeFileSync(join(root, 'agent.mcp.json'), JSON.stringify({ mcpServers: {
    xcode: { command: 'npx', args: ['-y', 'x@1', 'mcp'], env: { A: '1' } },
    both: { command: 'from-file' },
    'no-command': { args: [] },
    device: { command: 'x' },
  } }))
  const { mcpServers } = loadConfig(file)
  assert.deepEqual(Object.keys(mcpServers).sort(), ['both', 'xcode'])
  assert.equal(mcpServers.xcode.command, 'npx')
  assert.deepEqual(mcpServers.xcode.args, ['-y', 'x@1', 'mcp'])
  assert.deepEqual(mcpServers.xcode.env, { A: '1' })
  assert.equal(mcpServers.both.command, 'from-config', 'the config has the last word')

  writeFileSync(join(root, 'agent.mcp.json'), '{ not json')
  assert.deepEqual(Object.keys(loadConfig(file).mcpServers), ['both'], 'broken, it is skipped')
})

test('what a computer has goes into the list once, and the list is what counts from then on', () => {
  const root = tree(['code/', 'home/.claude-keep/'])
  const home = join(root, 'home')
  const file = join(root, 'agent.config.json')
  writeFileSync(file, JSON.stringify({
    serverUrl: 'wss://x', deviceId: 'pc', deviceKey: 'k', mcpFromClaude: true,
    zones: [{ path: join(root, 'code') }],
    mcpServers: { blender: { perTopic: true } },
  }))
  const claudeList = (servers: object) => writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: servers }))
  const list = join(root, 'agent.mcp.json')
  const saved = () => JSON.parse(readFileSync(list, 'utf8'))
  claudeList({ blender: { command: 'b', env: { KEY: 'value' } }, remote: { url: 'https://x' } })

  const first = loadConfig(file, home).mcpServers
  assert.deepEqual(Object.keys(first), ['blender'], 'a remote one has no place here')
  assert.equal(first.blender.command, 'b')
  assert.equal(first.blender.perTopic, true, 'the config still adjusts it')
  assert.deepEqual(saved().imported, ['blender'])
  assert.equal(saved().mcpServers.blender.env.KEY, 'value')

  // Claude Code's file goes away: nothing changes
  rmSync(join(home, '.claude.json'))
  assert.deepEqual(Object.keys(loadConfig(file, home).mcpServers), ['blender'])

  // A new one comes over; one taken out of the list stays out; a later change on that side doesn't come over
  claudeList({ blender: { command: 'changed' }, fresh: { command: 'f' } })
  assert.deepEqual(Object.keys(loadConfig(file, home).mcpServers).sort(), ['blender', 'fresh'])
  assert.equal(saved().mcpServers.blender.command, 'b')
  const { fresh: _gone, ...rest } = saved().mcpServers
  writeFileSync(list, JSON.stringify({ ...saved(), mcpServers: rest }))
  assert.deepEqual(Object.keys(loadConfig(file, home).mcpServers), ['blender'])

  // A broken list is never written over
  writeFileSync(list, '{ broken')
  assert.deepEqual(Object.keys(loadConfig(file, home).mcpServers).sort(), ['blender', 'fresh'], 'this time from what it found')
  assert.equal(readFileSync(list, 'utf8'), '{ broken')
})

test('a config older than the flag pulls them in too; turned off, or in the cloud, it does not', () => {
  const root = tree(['code/', 'home/'])
  const home = join(root, 'home')
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { aeuxe: { command: 'node' } } }))
  const names = (extra: object, folder: string) => {
    const dir = join(root, folder)
    mkdirSync(dir)
    const file = join(dir, 'agent.config.json')
    writeFileSync(file, JSON.stringify({ serverUrl: 'wss://x', deviceId: 'pc', deviceKey: 'k', zones: [{ path: join(root, 'code') }], ...extra }))
    return Object.keys(loadConfig(file, home).mcpServers)
  }
  assert.deepEqual(names({}, 'old'), ['aeuxe'])
  assert.deepEqual(names({ mcpFromClaude: false }, 'off'), [])
  assert.deepEqual(names({ deviceId: 'cloud' }, 'cloud'), [])
})

test('a computer with no Claude Code still gets the app servers found on its disk', () => {
  const root = tree(['code/', 'home/'])
  const home = join(root, 'home')
  const script = join(home, '.codex', 'mcp', 'after-effects-mcp-modal-safe', 'build')
  mkdirSync(script, { recursive: true })
  writeFileSync(join(script, 'index.js'), '')
  const file = join(root, 'agent.config.json')
  writeFileSync(file, JSON.stringify({ serverUrl: 'wss://x', deviceId: 'pc', deviceKey: 'k', mcpFromClaude: true, zones: [{ path: join(root, 'code') }] }))
  const { mcpServers } = loadConfig(file, home)
  assert.deepEqual(Object.keys(mcpServers), ['after-effects'])
  assert.deepEqual(mcpServers['after-effects'].args, [join(script, 'index.js')])
})

test('the bot reaches folders through the executor; a device with fixed folders (the cloud) says no', async () => {
  const root = tree(['code/p/', 'GitHub/q/'])
  const file = join(root, 'agent.config.json')
  writeFileSync(file, JSON.stringify({ zones: [{ path: join(root, 'code') }] }))
  const workspace = createWorkspace({ projects: [], zones: [{ path: join(root, 'code') }], stateFile: join(root, 'state.json'), selfDir: join(root, 'agent') })
  const ex = createExecutor({ workspace, zones: createZones({ workspace, file, selfDir: join(root, 'agent'), home: root }), shell: 'bash', log: () => {} })
  let n = 0
  const call = async (e: ReturnType<typeof createExecutor>, tool: OpTool, params: Record<string, unknown>) => {
    const events: OpEvent[] = []
    await e.handle({ type: 'op.request', opId: `op-${n++}`, projectId: '', bindingVersion: 0, tool, params, deadline: Date.now() + 10_000 }, ev => events.push(ev))
    return events.at(-1)!
  }
  const listed = await call(ex, 'folders', { path: root })
  assert.deepEqual((listed.result as FolderList).folders.map(f => f.name), ['code', 'GitHub'])
  const set = await call(ex, 'set_zones', { paths: [join(root, 'GitHub')] })
  assert.deepEqual((set.result as ZonesState).zones, [{ path: join(root, 'GitHub'), projects: 1 }])
  assert.equal((await call(ex, 'set_zones', { paths: [] })).error?.code, 'bad_request')
  const cloud = createExecutor({ workspace, shell: 'bash', log: () => {} })
  assert.equal((await call(cloud, 'zones', {})).error?.code, 'unavailable')
})

test("macOS's own volumes aren't offered; a folder macOS keeps closed says how to open it", () => {
  assert.deepEqual(['Recovery', 'Preboot', 'com.apple.TimeMachine.localsnapshots', 'Backup', 'Media'].filter(n => !isSystemVolume(n)), ['Backup', 'Media'])
  assert.match(deniedMessage('/Users/s/Documents', 'darwin'), /Privacy & Security/)
  assert.equal(deniedMessage('D:/work', 'win32'), 'No access to D:/work')
})

test('the config, with this computer\'s key in it, stays readable by its user alone after a change', { skip: process.platform === 'win32' }, () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-zones-mode-')))
  const file = join(dir, 'agent.config.json')
  writeFileSync(file, JSON.stringify({ deviceKey: 'k', zones: [] }), { mode: 0o644 })
  saveZones(file, [{ path: dir }])
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).deviceKey, 'k', 'the rest of the file stays')
})
