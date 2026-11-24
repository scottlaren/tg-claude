import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTopicStore, expiryOf, browserDone, browserIdle } from '../src/store.ts'

test('suggested replies survive a restart, and are gone once used', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tgcv-topics-')), 'topics.json')
  const topics = createTopicStore(file)
  const suggested = { id: 7, replies: ['Обновился'], messageId: 5, md: 'x' }
  topics.set('1:2', { suggested })
  topics.flush()
  assert.deepEqual(createTopicStore(file).get('1:2').suggested, suggested)
  topics.set('1:2', { suggested: undefined })
  topics.flush()
  assert.equal(createTopicStore(file).get('1:2').suggested, undefined)
})

const store = () => createTopicStore(join(mkdtempSync(join(tmpdir(), 'tgcv-topics-')), 'topics.json'))

test('a conversation without a project keeps going once it gets one; another project starts fresh', () => {
  const s = store()
  s.unbind('1:2')
  s.set('1:2', { sessionId: 'chat-session' })
  assert.equal(s.get('1:2').noProject, true)
  const t = s.bind('1:2', 'pc', 'game')
  assert.deepEqual([t.noProject, t.sessionId, t.envChanged], [false, 'chat-session', true])
  const other = s.bind('1:2', 'pc', 'site')
  assert.deepEqual([other.sessionId, other.envChanged], [null, false])
})

test('leaving a project for «Без проекта» drops the computer, the browser and old operations', () => {
  const s = store()
  const before = s.bind('1:3', 'pc', 'game')
  s.set('1:3', { browser: true, sessionId: 'x' })
  const t = s.unbind('1:3')
  assert.deepEqual([t.deviceId, t.projectId, t.noProject, t.browser, t.sessionId], [undefined, undefined, true, false, 'x'])
  assert.ok(t.bindingVersion > before.bindingVersion)
})

test('a project carried from the cloud to a computer keeps the conversation and says the place changed', () => {
  const s = store()
  s.bind('1:4', 'cloud', 'site')
  s.set('1:4', { sessionId: 'cloud-session' })
  const t = s.bind('1:4', 'pc', 'site-cloud', { carry: true })
  assert.deepEqual([t.deviceId, t.projectId, t.sessionId, t.envChanged], ['pc', 'site-cloud', 'cloud-session', true])
})

test('a quiet topic is warned a day before its week runs out and deleted only a day after the warning', () => {
  const day = 24 * 3600_000
  const t0 = Date.UTC(2026, 9, 1)
  assert.equal(expiryOf({ bindingVersion: 0, usedAt: t0 }, t0 + 5.9 * day, 7), null)
  assert.equal(expiryOf({ bindingVersion: 0, usedAt: t0 }, t0 + 6 * day, 7), 'warn')
  assert.equal(expiryOf({ bindingVersion: 0, usedAt: t0, warnedAt: t0 + 6 * day }, t0 + 6.5 * day, 7), null)
  assert.equal(expiryOf({ bindingVersion: 0, usedAt: t0, warnedAt: t0 + 6 * day }, t0 + 7 * day, 7), 'delete')
  // The server was off: ten days quiet and no warning yet means a warning, not a deletion
  assert.equal(expiryOf({ bindingVersion: 0, usedAt: t0 }, t0 + 10 * day, 7), 'warn')
  assert.equal(expiryOf({ bindingVersion: 0, usedAt: t0, warnedAt: t0 + 10 * day }, t0 + 10.5 * day, 7), null)
  // Off, or a topic from before the clock existed
  assert.equal(expiryOf({ bindingVersion: 0, usedAt: t0 }, t0 + 30 * day, 0), null)
  assert.equal(expiryOf({ bindingVersion: 0 }, t0 + 30 * day, 7), null)
  // Kept for good by the user: never warned, never deleted
  assert.equal(expiryOf({ bindingVersion: 0, usedAt: t0, pinned: true }, t0 + 90 * day, 7), null)
  assert.equal(expiryOf({ bindingVersion: 0, usedAt: t0, warnedAt: t0 + 6 * day, pinned: true }, t0 + 8 * day, 7), null)

  const s = store()
  s.set('1:5', { usedAt: t0, warnedAt: t0 + 6 * day, sessionId: 'x' })
  assert.equal(s.touch('1:5', t0 + 6.2 * day).warnedAt, undefined)
  s.remove('1:5')
  assert.deepEqual(s.get('1:5'), { bindingVersion: 0 })
})

test('a browser Claude asked for goes off after 20 minutes without it, not after one turn spent elsewhere; one turned on by hand stays', () => {
  const now = Date.parse('2026-11-15T07:03:00Z')
  const asked = { browser: true, browserAuto: true, browserUsedAt: now - 5 * 60_000 }
  assert.equal(browserDone(asked, false, now), false, 'a turn on files in the middle of a task in Chrome')
  assert.equal(browserDone({ ...asked, browserUsedAt: now - 21 * 60_000 }, false, now), true)
  assert.equal(browserDone({ ...asked, browserUsedAt: undefined }, false, now), true, 'never used at all')
  assert.equal(browserDone({ ...asked, browserUsedAt: now - 3600_000 }, true, now), false, 'still at work')
  assert.equal(browserDone({ browser: true, browserAuto: false }, false, now), false, '/browser: until turned off by hand')
  assert.equal(browserDone({ browser: true }, false, now), false, 'turned on before this existed')
  assert.equal(browserDone({ browser: false, browserAuto: true }, false, now), false)
})

test('a long pause ends it before the next turn pays for it', () => {
  const now = Date.parse('2026-10-30T12:00:00Z')
  const asked = { browser: true, browserAuto: true }
  assert.equal(browserIdle({ ...asked, browserUsedAt: now - 19 * 60_000 }, now), false)
  assert.equal(browserIdle({ ...asked, browserUsedAt: now - 21 * 60_000 }, now), true)
  assert.equal(browserIdle({ browser: true, browserAuto: false, browserUsedAt: now - 3600_000 }, now), false, 'by hand')
  assert.equal(browserIdle({ ...asked }, now), false, 'no time yet: the next turn decides')
})

test('topics that cannot be written take the server down with them neither on a change nor on the way out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-store-'))
  writeFileSync(join(dir, 'file'), 'not a folder')
  const warned: string[] = []
  const store = createTopicStore(join(dir, 'file', 'topics.json'), { warn: m => warned.push(m) })
  store.set('1:2', { title: 'x' })
  // A throw in the store's timer would be an uncaught exception, and fail this test
  await new Promise(r => setTimeout(r, 400))
  assert.doesNotThrow(() => store.flush())
  assert.equal(store.get('1:2').title, 'x')
  assert.ok(warned.length >= 2)
})
