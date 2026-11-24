import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpEvent, OpRequest } from '@tgcv/protocol'
import { createExecutor } from '../src/executor.ts'
import { createWorkspace } from '../src/workspace.ts'

// A real repository with real worktrees: what counts as the same repository comes from git's own files
function stand() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-wtget-')))
  const zone = join(base, 'zone')
  mkdirSync(join(zone, 'repo'), { recursive: true })
  mkdirSync(join(zone, 'stranger'))
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: join(zone, 'repo'), stdio: 'ignore' })
  git('init', '-q')
  git('commit', '-q', '--allow-empty', '-m', 'init')
  git('worktree', 'add', '-q', '-b', 'one', join(zone, 'repo-wt', 'one'))
  git('worktree', 'add', '-q', '-b', 'two', join(zone, 'repo-wt', 'two'))
  const workspace = createWorkspace({ projects: [], zones: [{ path: zone }], stateFile: join(base, 'state.json'), selfDir: join(base, 'self') })
  const executor = createExecutor({ shell: 'bash', log: () => {}, workspace })
  const idOf = (name: string) => workspace.list(true).find(p => p.name === name)!.id
  const get = async (project: string, path: string) => {
    const req: OpRequest = { type: 'op.request', opId: `get-${Math.random()}`, projectId: idOf(project), bindingVersion: 0, tool: 'file_get', params: { path, offset: 0, length: 1000 }, deadline: Date.now() + 60_000 }
    const events: OpEvent[] = []
    await executor.handle(req, e => void events.push(e))
    const last = events.at(-1)!
    return { error: last.error?.code, text: last.state === 'done' ? Buffer.from((last.result as { data: string }).data, 'base64').toString() : undefined }
  }
  return { zone, get, done: () => rmSync(base, { recursive: true, force: true }) }
}

test('a file only in a worktree arrives when asked from the repository, by a relative path or its own', async () => {
  const s = stand()
  try {
    mkdirSync(join(s.zone, 'repo-wt', 'one', 'docs'))
    writeFileSync(join(s.zone, 'repo-wt', 'one', 'docs', 'pic.txt'), 'from one')
    assert.equal((await s.get('repo', 'docs/pic.txt')).text, 'from one')
    assert.equal((await s.get('repo', join(s.zone, 'repo-wt', 'one', 'docs', 'pic.txt'))).text, 'from one')
    // And the other way round, from a worktree
    assert.equal((await s.get('two', 'docs/pic.txt')).text, 'from one')
  } finally {
    s.done()
  }
})

test('a full path into the wrong worktree finds the file at the same place in another', async () => {
  const s = stand()
  try {
    mkdirSync(join(s.zone, 'repo-wt', 'two', 'docs'))
    writeFileSync(join(s.zone, 'repo-wt', 'two', 'docs', 'pic.txt'), 'from two')
    const wrong = join(s.zone, 'repo-wt', 'one', 'docs', 'pic.txt')
    assert.equal((await s.get('repo', wrong)).text, 'from two')
    assert.equal((await s.get('one', wrong)).text, 'from two')
    assert.equal((await s.get('one', join(s.zone, 'repo-wt', 'one', 'docs', 'none.txt'))).error, 'not_found')
  } finally {
    s.done()
  }
})

test('the project\'s own file comes first; among worktrees, the newest', async () => {
  const s = stand()
  try {
    for (const name of ['one', 'two']) mkdirSync(join(s.zone, 'repo-wt', name, 'docs'))
    const [one, two] = ['one', 'two'].map(name => join(s.zone, 'repo-wt', name, 'docs', 'pic.txt'))
    writeFileSync(one, 'older')
    writeFileSync(two, 'newer')
    utimesSync(one, new Date(2020, 0, 1), new Date(2020, 0, 1))
    assert.equal((await s.get('repo', 'docs/pic.txt')).text, 'newer')

    mkdirSync(join(s.zone, 'repo', 'docs'))
    writeFileSync(join(s.zone, 'repo', 'docs', 'pic.txt'), 'own')
    utimesSync(join(s.zone, 'repo', 'docs', 'pic.txt'), new Date(2019, 0, 1), new Date(2019, 0, 1))
    assert.equal((await s.get('repo', 'docs/pic.txt')).text, 'own')
  } finally {
    s.done()
  }
})

test('nothing past the repository: not another project, not a way out, not a secrets file', async () => {
  const s = stand()
  try {
    writeFileSync(join(s.zone, 'stranger', 'pic.txt'), 'not yours')
    assert.equal((await s.get('repo', 'pic.txt')).error, 'not_found')
    assert.equal((await s.get('repo', join(s.zone, 'stranger', 'pic.txt'))).error, 'outside_root')
    assert.equal((await s.get('repo', '../stranger/pic.txt')).error, 'outside_root')
    assert.equal((await s.get('stranger', 'nothing.txt')).error, 'not_found')

    writeFileSync(join(s.zone, 'repo-wt', 'one', '.env'), 'KEY=1')
    assert.equal((await s.get('repo', '.env')).text, undefined)
    assert.equal((await s.get('repo', join(s.zone, 'repo-wt', 'one', '.env'))).text, undefined)
  } finally {
    s.done()
  }
})
