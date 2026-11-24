import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setLang } from '../src/i18n.ts'
import { createLocks, lockQuestion, lockReport, type LockResult } from '../src/telegram/lock-menu.ts'
import type { Device, OpOutcome, OpSpec } from '../src/gateway.ts'

const log = { info() {}, warn() {}, error() {} } as never
const dev = (id: string, locked = false) => ({ id, name: id, locked }) as unknown as Device

function stand(answer: (id: string, op: OpSpec) => OpOutcome) {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-locks-'))
  const asked: string[] = []
  const heard: string[] = []
  const events = new EventEmitter()
  const file = join(dir, 'locks.json')
  const gateway = {
    events: events as never,
    request: async (id: string, op: OpSpec) => {
      asked.push(`${id}:${op.tool}`)
      return answer(id, op)
    },
  }
  const make = () => createLocks({ file, gateway, log, heard: d => void heard.push(d.id) })
  return { asked, heard, events, file, make, done: () => rmSync(dir, { recursive: true, force: true }) }
}
const yes = (): OpOutcome => ({ ok: true, result: { file: '/home/me/agent.locked' } })
const offline = (): OpOutcome => ({ ok: false, error: { code: 'offline', message: 'offline' } })
const settle = () => new Promise(r => setTimeout(r, 20))

test('every computer gets asked; each answer says what became of it', async () => {
  const s = stand((id, op) => {
    assert.equal(op.tool, 'lock')
    if (id === 'off') return offline()
    if (id === 'old') return { ok: false, error: { code: 'unknown', message: 'no answer' } }
    return yes()
  })
  try {
    const results = await s.make().all(['pc', 'off', 'old'])
    assert.deepEqual(results.map(r => [r.id, r.state]), [['pc', 'locked'], ['off', 'owed'], ['old', 'failed']])
    assert.equal(results[0].file, '/home/me/agent.locked')
  } finally {
    s.done()
  }
})

test('a computer that was off gets the lock when it connects, even after the server restarted', async () => {
  let online = false
  const s = stand(() => (online ? yes() : offline()))
  try {
    const first = s.make()
    await first.all(['mac'])
    assert.equal(first.owed('mac'), true)
    assert.deepEqual(JSON.parse(readFileSync(s.file, 'utf8')), ['mac'])

    s.events.removeAllListeners()
    const second = s.make()
    assert.equal(second.owed('mac'), true)
    online = true
    s.events.emit('online', dev('mac'))
    await settle()
    assert.deepEqual(s.heard, ['mac'])
    assert.equal(second.owed('mac'), false)
    assert.deepEqual(JSON.parse(readFileSync(s.file, 'utf8')), [])

    // Unlocked at the computer: the next connection is not locked again
    const asked = s.asked.length
    s.events.emit('online', dev('mac'))
    await settle()
    assert.equal(s.asked.length, asked)
  } finally {
    s.done()
  }
})

test('one that says it is already locked needs no asking', async () => {
  const s = stand(offline)
  try {
    const locks = s.make()
    await locks.all(['mac'])
    const asked = s.asked.length
    s.events.emit('online', dev('mac', true))
    await settle()
    assert.equal(s.asked.length, asked)
    assert.equal(locks.owed('mac'), false)
  } finally {
    s.done()
  }
})

test('the report names where to unlock, says plainly what did not lock, and what the lock does not reach', () => {
  setLang('ru')
  const results: LockResult[] = [
    { id: 'pc', state: 'locked', file: 'C:\\Users\\me\\agent.locked' },
    { id: 'mac', state: 'owed' },
    { id: 'old', state: 'failed', error: 'нет ответа' },
    { id: 'cloud', state: 'locked', file: '/home/node/.tgcv/agent.locked' },
  ]
  const md = lockReport(results, id => id.toUpperCase(), id => id === 'cloud')
  assert.ok(md.includes('**PC:** заблокирован'))
  assert.ok(md.includes('`C:\\Users\\me\\agent.locked`'))
  assert.ok(md.includes('**MAC:** не в сети'))
  assert.ok(md.includes('⚠️ не заблокирован'))
  assert.ok(md.includes('docker compose exec cloud rm /home/node/.tgcv/agent.locked'))
  assert.ok(md.includes('панели хостинга'))
  assert.ok(md.includes('Claude в Chrome'))
  assert.ok(lockQuestion().includes('только за самим компьютером'))
  assert.equal(existsSync('locks.json'), false)
})
