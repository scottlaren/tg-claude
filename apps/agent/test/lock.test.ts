import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpEvent, OpRequest, OpTool } from '@tgcv/protocol'
import { createExecutor } from '../src/executor.ts'
import { createLock } from '../src/lock.ts'
import { createAudit } from '../src/audit.ts'

const nolog = () => {}
const request = (tool: OpTool, params: Record<string, unknown> = {}, projectId = ''): OpRequest => ({
  type: 'op.request', opId: `${tool}-${Math.random()}`, projectId, bindingVersion: 0, tool, params, deadline: Date.now() + 60_000,
})
const outcome = async (ex: ReturnType<typeof createExecutor>, req: OpRequest) => {
  const events: OpEvent[] = []
  await ex.handle(req, e => void events.push(e))
  return events.at(-1)!
}
function stand() {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-lock-'))
  const lock = createLock(join(dir, 'agent.locked'))
  const updates: string[] = []
  const executor = createExecutor({
    shell: 'bash', log: nolog, lock, audit: createAudit(join(dir, 'audit.log'), nolog),
    projects: [{ id: 'p', name: 'p', path: dir, extraRoots: [] }],
    selfUpdate: async tag => {
      updates.push(tag)
      return { ok: true, from: '1', to: '2' }
    },
  })
  return { dir, lock, updates, executor, done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('locked: nothing the server can ask for runs, an update and the file that would undo it least of all', async () => {
  const s = stand()
  try {
    assert.equal((await outcome(s.executor, request('lock'))).state, 'done')
    assert.ok(existsSync(s.lock.file))
    for (const req of [
      request('run_command', { command: 'echo hi' }, 'p'),
      request('write_file', { path: 'x.txt', content: 'x' }, 'p'),
      request('list_projects'),
      request('github_token'),
      request('self_update', { tag: 'v9.9.9' }),
    ]) {
      const last = await outcome(s.executor, req)
      assert.equal(last.state, 'error', req.tool)
      assert.equal(last.error?.code, 'locked', req.tool)
    }
    assert.deepEqual(s.updates, [])
    assert.equal(existsSync(join(s.dir, 'x.txt')), false)
    assert.ok(existsSync(s.lock.file), 'the lock is still there')
  } finally {
    s.done()
  }
})

test('deleting the file at the computer is all it takes to unlock', async () => {
  const s = stand()
  try {
    await outcome(s.executor, request('lock'))
    assert.equal((await outcome(s.executor, request('list_projects'))).error?.code, 'locked')
    rmSync(s.lock.file)
    assert.equal((await outcome(s.executor, request('list_projects'))).state, 'done')
  } finally {
    s.done()
  }
})

test('locking again is fine, and a repeat of a request from before the lock replays instead of running', async () => {
  const s = stand()
  try {
    const before = request('list_projects')
    assert.equal((await outcome(s.executor, before)).state, 'done')
    assert.equal((await outcome(s.executor, request('lock'))).state, 'done')
    assert.equal((await outcome(s.executor, request('lock'))).state, 'done')
    assert.equal((await outcome(s.executor, before)).state, 'done')
  } finally {
    s.done()
  }
})

test('what is running when the lock comes is stopped', async () => {
  const s = stand()
  try {
    const events: OpEvent[] = []
    const running = s.executor.handle(request('run_command', { command: 'sleep 30', timeoutSec: 60 }, 'p'), e => void events.push(e))
    await new Promise(r => setTimeout(r, 300))
    assert.equal((await outcome(s.executor, request('lock'))).state, 'done')
    const started = Date.now()
    await running
    assert.ok(Date.now() - started < 15_000, 'stopped well before its own end')
    assert.equal(s.executor.running(), 0)
  } finally {
    s.done()
  }
})

test('what is refused goes into the journal too, marked', async () => {
  const s = stand()
  try {
    await outcome(s.executor, request('run_command', { command: 'echo before' }, 'p'))
    await outcome(s.executor, request('lock'))
    await outcome(s.executor, request('run_command', { command: 'echo after' }, 'p'))
    const lines = readFileSync(join(s.dir, 'audit.log'), 'utf8').trim().split('\n')
    assert.match(lines[0], /\trun_command\tp\t.*echo before/)
    assert.doesNotMatch(lines[0], /REFUSED/)
    assert.match(lines[1], /\tlock\t-\t/)
    assert.match(lines[2], /\trun_command\tp\tREFUSED\t.*echo after/)
  } finally {
    s.done()
  }
})
