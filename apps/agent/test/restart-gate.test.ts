import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRestartGate } from '../src/restart-gate.ts'
import { createExecutor } from '../src/executor.ts'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const nolog = () => {}

test('a restart waits for what is running, then goes', async () => {
  const restarts: string[] = []
  let busy = true
  const gate = createRestartGate({ restart: to => restarts.push(to), log: nolog, checkMs: 5, settleMs: 5 })
  gate.request('0.6.0', () => busy)
  await sleep(40)
  assert.deepEqual(restarts, [], 'a command is running')
  busy = false
  await sleep(40)
  assert.deepEqual(restarts, ['0.6.0'])
})

test('a command that never ends does not keep the computer on old code for ever', async () => {
  const restarts: string[] = []
  const lines: string[] = []
  const gate = createRestartGate({ restart: to => restarts.push(to), log: (...a) => lines.push(a.join(' ')), maxMs: 30, checkMs: 5, settleMs: 5 })
  gate.request('0.6.0', () => true)
  await sleep(80)
  assert.deepEqual(restarts, ['0.6.0'])
  assert.match(lines.at(-1)!, /still running/)
})

test('a second update while one waits does not restart twice', async () => {
  const restarts: string[] = []
  const gate = createRestartGate({ restart: to => restarts.push(to), log: nolog, checkMs: 5, settleMs: 5 })
  gate.request('0.6.0', () => false)
  gate.request('0.6.1', () => false)
  await sleep(40)
  assert.equal(restarts.length, 1)
})

test('the executor counts what a restart would cut off, and not the update that asks for it', async () => {
  let finish!: () => void
  const held = new Promise<void>(r => (finish = r))
  const executor = createExecutor({
    shell: 'bash', log: nolog,
    selfUpdate: async () => {
      await held
      return { ok: true, from: '1', to: '2' }
    },
    github: {
      status: async () => {
        await held
        return { installed: false, login: null, pending: false }
      },
    } as never,
  })
  const request = (opId: string, tool: string) => ({ type: 'op.request', opId, projectId: '', bindingVersion: 0, tool, params: { tag: 'v2.0.0' }, deadline: Date.now() + 5000 }) as never
  const update = executor.handle(request('update', 'self_update'), () => {})
  assert.equal(executor.running(), 0)
  // An operation that takes its time: the same wait
  const other = executor.handle(request('other', 'github_status'), () => {})
  assert.equal(executor.running(), 1)
  finish()
  await Promise.all([update, other])
  assert.equal(executor.running(), 0)
})

const req = (opId: string, deadline = Date.now() + 5000) => ({ type: 'op.request', opId, projectId: 'p', bindingVersion: 0, tool: 'read_file', params: { path: 'x' }, deadline }) as never

test('a question about an operation it has never seen runs nothing and says so', async () => {
  const executor = createExecutor({ shell: 'bash', log: nolog, projects: [] })
  const events: { state: string, error?: { code: string } }[] = []
  await executor.handle(req('never-seen', 0), e => events.push(e))
  assert.deepEqual(events.map(e => [e.state, e.error?.code]), [['error', 'expired']])
})

test('a finished operation is kept for the server to come back for, within limits on bytes and time', async () => {
  const executor = createExecutor({ shell: 'bash', log: nolog, projects: [], journalBytes: 600 })
  const asked = async (opId: string) => {
    const events: { error?: { code: string } }[] = []
    await executor.handle(req(opId, 0), e => events.push(e))
    return events.at(-1)!.error!.code
  }
  await executor.handle(req('a'), () => {})
  assert.equal(await asked('a'), 'unknown_project', 'replayed, not asked of the project again')
  // Each of these is about 150 bytes: the oldest goes first
  for (let i = 0; i < 6; i++) await executor.handle(req(`b${i}`), () => {})
  assert.equal(await asked('a'), 'expired', 'forgotten: the limit on bytes held')
  assert.equal(await asked('b5'), 'unknown_project')

  const short = createExecutor({ shell: 'bash', log: nolog, projects: [], journalTtlMs: 1 })
  await short.handle(req('old'), () => {})
  await sleep(10)
  await short.handle(req('new'), () => {})
  const events: { error?: { code: string } }[] = []
  await short.handle(req('old', 0), e => events.push(e))
  assert.equal(events.at(-1)!.error!.code, 'expired', 'forgotten: the limit on time held')
})
