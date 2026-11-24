import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selfUpdate } from '../src/self-update.ts'
import { UPDATE_UNREACHED } from '@tgcv/protocol'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim()

// GitHub: v0.1.0, then v0.2.0 with a new lockfile, then v0.2.1 with code only. The computer: a clone at v0.1.0
function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-upd-')))
  const origin = join(base, 'origin')
  execFileSync('git', ['init', '-q', '-b', 'main', origin])
  const release = (version: string, lock: string, code: string) => {
    writeFileSync(join(origin, 'package.json'), JSON.stringify({ version }))
    writeFileSync(join(origin, 'package-lock.json'), lock)
    writeFileSync(join(origin, 'code.ts'), code)
    git(origin, 'add', '.')
    git(origin, 'commit', '-q', '-m', version)
  }
  release('0.1.0', 'lock-1', 'a')
  git(origin, 'tag', '-a', 'v0.1.0', '-m', '0.1.0')
  const pc = join(base, 'pc')
  execFileSync('git', ['clone', '-q', origin, pc])
  release('0.2.0', 'lock-2', 'b')
  git(origin, 'tag', '-a', 'v0.2.0', '-m', '0.2.0')
  release('0.2.1', 'lock-2', 'c')
  git(origin, 'tag', '-a', 'v0.2.1', '-m', '0.2.1')
  const npmCalls: string[] = []
  const npm = async (root: string) => { npmCalls.push(root) }
  return { pc, npm, npmCalls }
}

test('a plain install on main moves to the release and stays on main; npm runs only when the lockfile changed', async () => {
  const { pc, npm, npmCalls } = setup()
  assert.deepEqual(await selfUpdate({ root: pc, tag: 'v0.2.0', npm }), { ok: true, from: '0.1.0', to: '0.2.0' })
  assert.equal(git(pc, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main')
  assert.equal(readFileSync(join(pc, 'code.ts'), 'utf8'), 'b')
  assert.equal(npmCalls.length, 1)
  // Same lockfile: no reinstall
  assert.equal((await selfUpdate({ root: pc, tag: 'v0.2.1', npm })).ok, true)
  assert.equal(npmCalls.length, 1)
})

test('a checkout sitting exactly on a release moves to the next one', async () => {
  const { pc, npm } = setup()
  git(pc, 'checkout', '-q', '--detach', 'v0.1.0')
  assert.equal((await selfUpdate({ root: pc, tag: 'v0.2.1', npm })).ok, true)
  assert.equal(readFileSync(join(pc, 'code.ts'), 'utf8'), 'c')
})

test('a developer\'s checkout is never touched: changes of its own, or another branch', async () => {
  const dirty = setup()
  writeFileSync(join(dirty.pc, 'code.ts'), 'mine')
  const a = await selfUpdate({ root: dirty.pc, tag: 'v0.2.0', npm: dirty.npm })
  assert.equal(a.ok, false)
  assert.equal(a.dev, true)
  assert.equal(readFileSync(join(dirty.pc, 'code.ts'), 'utf8'), 'mine')

  const branch = setup()
  git(branch.pc, 'checkout', '-q', '-b', 'feature')
  const b = await selfUpdate({ root: branch.pc, tag: 'v0.2.0', npm: branch.npm })
  assert.equal(b.dev, true)
  assert.match(b.error!, /feature/)
})

test('GitHub out of reach: tried three times, then said so in a way the server knows to try again later', async () => {
  const { pc, npm } = setup()
  const head = git(pc, 'rev-parse', 'HEAD')
  git(pc, 'remote', 'set-url', 'origin', join(pc, '..', 'gone'))
  const started = Date.now()
  const r = await selfUpdate({ root: pc, tag: 'v0.2.0', npm, fetchPauseMs: 100 })
  assert.equal(r.ok, false)
  assert.ok(r.error!.startsWith(UPDATE_UNREACHED), r.error)
  assert.doesNotMatch(r.error!, /sign-in/)
  assert.ok(Date.now() - started >= 300, 'paused between the tries')
  assert.equal(git(pc, 'rev-parse', 'HEAD'), head)
})

test('a version GitHub doesn\'t have, or a failed npm ci, leaves the old version in place', async () => {
  const { pc, npm } = setup()
  const head = git(pc, 'rev-parse', 'HEAD')
  const missing = await selfUpdate({ root: pc, tag: 'v9.9.9', npm })
  assert.equal(missing.ok, false)
  assert.equal(git(pc, 'rev-parse', 'HEAD'), head)

  let calls = 0
  const broken = await selfUpdate({ root: pc, tag: 'v0.2.0', npm: async () => { if (++calls === 1) throw new Error('npm ci exited with code 1') } })
  assert.equal(broken.ok, false)
  assert.match(broken.error!, /still on version 0\.1\.0/)
  assert.equal(git(pc, 'rev-parse', 'HEAD'), head)
  assert.equal(readFileSync(join(pc, 'code.ts'), 'utf8'), 'a')
  // Dependencies put back for the old version
  assert.equal(calls, 2)
})
