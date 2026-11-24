import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs, { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, utimesSync, rmSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspace, idOf } from '../src/workspace.ts'
import { rootsOf } from '../src/executor.ts'
import { readTextFile } from '../src/files.ts'

const code = (c: string) => (e: unknown) => (e as { code: string }).code === c

// code/ is the approved zone; code/tg-claude is the agent itself; outside/ is not approved
function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-ws-')))
  const zone = join(base, 'code')
  for (const d of ['old-game', 'new-game', 'mfm-wt', 'tg-claude', '.hidden', 'private']) mkdirSync(join(zone, d), { recursive: true })
  mkdirSync(join(base, 'outside'))
  writeFileSync(join(zone, 'new-game', '.env'), 'TOKEN=x')
  writeFileSync(join(zone, 'new-game', '.env.example'), 'TOKEN=')
  const t = Date.now() / 1000
  utimesSync(join(zone, 'old-game'), t - 100, t - 100)
  utimesSync(join(zone, 'new-game'), t, t)
  const stateFile = join(base, 'agent.state.json')
  const ws = createWorkspace({
    projects: [], zones: [{ path: zone, exclude: ['private'] }], stateFile, selfDir: join(zone, 'tg-claude'),
  })
  return { base, zone, stateFile, ws }
}

test('every folder in the zone is a project, newest first; the agent, hidden and excluded ones are not', () => {
  const { ws } = setup()
  const ids = ws.list().map(p => p.id)
  assert.deepEqual(ids.filter(i => i !== 'mfm-wt'), ['new-game', 'old-game'])
  assert.ok(!ids.includes('tg-claude'))
  assert.ok(!ids.includes('private'))
})

test('a folder granted from Telegram must be inside the zone and is remembered', () => {
  const { base, zone, stateFile, ws } = setup()
  const p = ws.addFolder('new-game', join(zone, 'mfm-wt'))
  assert.deepEqual(p.extraRoots, [join(zone, 'mfm-wt')])
  assert.deepEqual(JSON.parse(readFileSync(stateFile, 'utf8')).extraRoots, { 'new-game': [join(zone, 'mfm-wt')] })
  assert.throws(() => ws.addFolder('new-game', join(base, 'outside')), code('outside_root'))
  assert.throws(() => ws.addFolder('new-game', join(zone, 'tg-claude')), code('outside_root'))
  assert.throws(() => ws.addFolder('new-game', join(zone, 'private')), code('outside_root'))
})

test('secret files are off-limits even inside the project, their examples are not', async () => {
  const { ws } = setup()
  const roots = rootsOf(ws.get('new-game')!)
  await assert.rejects(readTextFile(roots, { path: '.env' }), code('outside_root'))
  assert.deepEqual((await readTextFile(roots, { path: '.env.example' })).lines, ['TOKEN='])
  // A Claude sign-in and this project's own agent keys, wherever they lie in a project
  const dir = ws.get('new-game')!.path
  mkdirSync(join(dir, 'data', 'profiles', 'main'), { recursive: true })
  for (const f of ['data/profiles/main/.credentials.json', 'agent.config.json', 'agent.mcp.json', 'data/agent.config.local-server.json', '.netrc', '_netrc', '.git-credentials', '.pgpass', 'credentials.json', 'credentials', 'cert.p12', 'cert.pfx', 'release.keystore', 'release.jks', 'vault.kdbx']) {
    writeFileSync(join(dir, f), '{"secret":1}')
    await assert.rejects(readTextFile(roots, { path: f }), code('outside_root'), f)
  }
  // Ordinary JSON is still readable
  writeFileSync(join(dir, 'config.json'), '{}')
  assert.deepEqual((await readTextFile(roots, { path: 'config.json' })).lines, ['{}'])
})

test('project ids are Latin: Russian names are transliterated, other scripts get a hash, Latin names stay as they were', () => {
  assert.equal(idOf('Тест облака'), 'Test-oblaka')
  assert.equal(idOf('Щука и ёж'), 'Schuka-i-ezh')
  assert.equal(idOf('landing-vizitka'), 'landing-vizitka')
  assert.equal(idOf('My Project'), 'My-Project')
  const a = idOf('项目一')
  const b = idOf('项目二')
  assert.match(a, /^-?[\w-]*-[0-9a-f]{6}$/)
  assert.notEqual(a, b)
})

test('a folder made outside the bot (a git worktree) is in the list the server asks for at once', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-ws-fresh-')))
  mkdirSync(join(base, 'game'))
  const ws = createWorkspace({ projects: [], zones: [{ path: base }], stateFile: join(base, 'state.json'), selfDir: join(base, 'agent') })
  assert.deepEqual(ws.list().map(p => p.name), ['game'])
  mkdirSync(join(base, 'game.balance'))
  assert.equal(ws.list().length, 1) // the cached list for per-operation lookups
  assert.ok(ws.list(true).some(p => p.name === 'game.balance'))
})

test('folders whose names read the same never share an id, and an id once given stays with its folder', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-ws-ids-')))
  const zone = join(base, 'zone')
  mkdirSync(join(zone, 'My Project'), { recursive: true })
  const make = () => createWorkspace({ projects: [], zones: [{ path: zone }], stateFile: join(base, 'state.json'), selfDir: join(base, 'agent') })
  assert.deepEqual(make().list(true).map(p => p.id), ['My-Project'])
  // A new folder that reads the same appears later, and the agent restarts: the old one keeps its id
  mkdirSync(join(zone, 'My-Project'))
  const ids = Object.fromEntries(make().list(true).map(p => [p.name, p.id]))
  assert.equal(ids['My Project'], 'My-Project')
  assert.match(ids['My-Project'], /^My-Project-[0-9a-f]{6}$/)
  assert.equal(new Set(Object.values(ids)).size, 2)
})

test('a folder that is gone never hands its id to another one: a topic bound to it must not run in a stranger', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-ws-gone-')))
  const zone = join(base, 'zone')
  mkdirSync(join(zone, 'My Project'), { recursive: true })
  const make = () => createWorkspace({ projects: [], zones: [{ path: zone }], stateFile: join(base, 'state.json'), selfDir: join(base, 'agent') })
  assert.deepEqual(make().list(true).map(p => p.id), ['My-Project'])
  // Deleted (or moved away), then another folder that reads the same appears
  rmSync(join(zone, 'My Project'), { recursive: true })
  assert.deepEqual(make().list(true), [])
  mkdirSync(join(zone, 'My-Project'))
  assert.match(make().list(true)[0].id, /^My-Project-[0-9a-f]{6}$/)
  // The same folder back in the same place is the same project: its id comes back
  mkdirSync(join(zone, 'My Project'))
  const ids = Object.fromEntries(make().list(true).map(p => [p.name, p.id]))
  assert.equal(ids['My Project'], 'My-Project')
  assert.match(ids['My-Project'], /^My-Project-[0-9a-f]{6}$/)
})

test('a folder of worktrees: not offered itself, only what is alive in it is listed, under its repository', async () => {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, mkdirSync, realpathSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-wt-')))
  const zone = join(base, 'zone')
  mkdirSync(join(zone, 'repo'), { recursive: true })
  mkdirSync(join(zone, 'repo-wt', 'leftover'), { recursive: true })
  mkdirSync(join(zone, 'empty-wt'))
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: join(zone, 'repo'), stdio: 'ignore' })
  git('init', '-q')
  git('commit', '-q', '--allow-empty', '-m', 'init')
  git('worktree', 'add', '-q', '-b', 'feature/x', join(zone, 'repo-wt', 'x'))
  git('worktree', 'add', '-q', '-b', 'gone', join(zone, 'repo-wt', 'gone'))
  // Claude Code's own worktrees inside the repository stay out of the list
  git('worktree', 'add', '-q', '-b', 'inner', join(zone, 'repo', '.inner', 'y'))
  // A repository that happens to be called so is a project as usual
  mkdirSync(join(zone, 'real-wt', '.git'), { recursive: true })
  // Outside the zone, even in a folder with the right name
  git('worktree', 'add', '-q', '-b', 'far', join(base, 'away-wt', 'far'))
  execFileSync('git', ['worktree', 'remove', '--force', join(zone, 'repo-wt', 'gone')], { cwd: join(zone, 'repo'), stdio: 'ignore' })

  const ws = createWorkspace({ projects: [], zones: [{ path: zone }], stateFile: join(base, 'state.json'), selfDir: join(base, 'agent') })
  const of = (name: string) => ws.list().find(p => p.name === name)
  assert.equal(of('x')!.worktreeOf, of('repo')!.id)
  assert.equal(of('x')!.branch, 'feature/x')
  assert.equal(ws.get(of('x')!.id)!.path, join(zone, 'repo-wt', 'x'), 'a project like any other')
  assert.equal(of('repo-wt')!.hidden, true)
  assert.ok(ws.get(of('repo-wt')!.id), 'a topic bound to it still finds it')
  assert.equal(of('empty-wt')!.hidden, true)
  assert.equal(of('real-wt')!.hidden, undefined)
  for (const name of ['leftover', 'gone', 'y', 'far']) assert.equal(of(name), undefined, name)
})

test('a real git worktree is reported with its repository and branch; a plain folder and a lone worktree are not', async () => {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, mkdirSync, realpathSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-wt-')))
  const zone = join(base, 'zone')
  mkdirSync(join(zone, 'repo'), { recursive: true })
  mkdirSync(join(zone, 'plain'))
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: join(zone, 'repo'), stdio: 'ignore' })
  git('init', '-q')
  git('commit', '-q', '--allow-empty', '-m', 'init')
  git('worktree', 'add', '-q', '-b', 'feature/x', join(zone, 'repo-x'))
  git('worktree', 'add', '-q', '--detach', join(zone, 'repo-old'))
  // Outside the zone: nothing to group it under when listed alone
  git('worktree', 'add', '-q', '-b', 'lone', join(base, 'away'))

  const ws = createWorkspace({ projects: [], zones: [{ path: zone }], stateFile: join(base, 'state.json'), selfDir: join(base, 'agent') })
  const of = (name: string) => ws.list().find(p => p.name === name)!
  assert.equal(of('repo-x').worktreeOf, of('repo').id)
  assert.equal(of('repo-x').branch, 'feature/x')
  assert.equal(of('repo-old').worktreeOf, of('repo').id)
  assert.equal(of('repo-old').branch, undefined, 'detached')
  assert.equal(of('repo').worktreeOf, undefined)
  assert.equal(of('plain').worktreeOf, undefined)

  const other = createWorkspace({ projects: [], zones: [{ path: base }], stateFile: join(base, 'state2.json'), selfDir: join(base, 'agent') })
  assert.equal(other.list().find(p => p.name === 'away')!.worktreeOf, undefined, 'its repository is not among the projects')
})

test('a write cut off half way leaves what was granted whole', () => {
  const { zone, stateFile, ws } = setup()
  ws.addFolder('new-game', join(zone, 'mfm-wt'))
  const real = fs.writeFileSync
  fs.writeFileSync = ((file: string, data: string) => {
    real(file, String(data).slice(0, 5))
    throw new Error('power cut')
  }) as typeof fs.writeFileSync
  syncBuiltinESMExports()
  try {
    assert.throws(() => ws.addFolder('old-game', join(zone, 'mfm-wt')), /power cut/)
  } finally {
    fs.writeFileSync = real
    syncBuiltinESMExports()
  }
  assert.ok(JSON.parse(readFileSync(stateFile, 'utf8')).extraRoots['new-game'])
})
