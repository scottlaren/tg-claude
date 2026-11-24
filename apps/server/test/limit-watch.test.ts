import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLimitWatch, nearFromUsage, nearFromLast, limitWarning } from '../src/telegram/limit-watch.ts'
import type { ProfileUsage, LastLimit } from '../src/profiles.ts'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const HOUR = 3600_000
const at = (ms: number) => new Date(ms).toISOString()
const usage = (fiveHour: number | null, sevenDay = 10): ProfileUsage => ({
  plan: 'max',
  fiveHour: { utilization: fiveHour, resetsAt: at(NOW + HOUR) },
  sevenDay: { utilization: sevenDay, resetsAt: at(NOW + 72 * HOUR) },
  models: [],
})

function setup(values: (ProfileUsage | null)[], last?: LastLimit) {
  const file = join(mkdtempSync(join(tmpdir(), 'tgcv-limits-')), 'warned.json')
  const clock = { t: NOW }
  const calls = { n: 0 }
  const make = () => createLimitWatch({
    file,
    usage: async () => values[Math.min(calls.n++, values.length - 1)],
    last: () => last,
    now: () => clock.t,
  })
  return { watch: make(), make, clock, calls }
}

test('a window is reported from 80%, not below', () => {
  assert.deepEqual(nearFromUsage(usage(79)), [])
  assert.deepEqual(nearFromUsage(usage(80)).map(n => [n.id, n.pct]), [['five_hour', 80]])
  assert.deepEqual(nearFromUsage(usage(null)), [])
  const models = { ...usage(1), models: [{ name: 'Opus', utilization: 91, resetsAt: null }] }
  assert.deepEqual(nearFromUsage(models).map(n => [n.label, n.pct, n.resetsAt]), [['Opus, week', 91, undefined]])
})

test('each window warns once until it resets, a restart included', async () => {
  const { watch, make, clock } = setup([usage(85)])
  assert.equal((await watch.check('main')).length, 1)
  clock.t += 11 * 60_000
  assert.deepEqual(await watch.check('main'), [])
  clock.t += 11 * 60_000
  assert.deepEqual(await make().check('main'), [], 'the restarted bot remembers')
  clock.t = NOW + HOUR + 1
  assert.equal((await watch.check('main')).length, 1, 'a new window warns again')
})

test('a window coming close later is reported on its own; profiles are apart', async () => {
  const { watch, clock } = setup([usage(85), usage(85, 90)])
  assert.deepEqual((await watch.check('main')).map(n => n.id), ['five_hour'])
  clock.t += 11 * 60_000
  assert.deepEqual((await watch.check('main')).map(n => n.id), ['seven_day'])
  assert.deepEqual((await watch.check('work')).map(n => n.id), ['five_hour', 'seven_day'])
})

test('the numbers are asked for at most once in 10 minutes per profile', async () => {
  const { watch, clock, calls } = setup([usage(1)])
  await watch.check('main')
  await watch.check('main')
  assert.equal(calls.n, 1)
  clock.t += 10 * 60_000
  await watch.check('main')
  assert.equal(calls.n, 2)
})

test('without live numbers the warning of the last turn counts', async () => {
  const last: LastLimit = { status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.83, resetsAt: (NOW + HOUR) / 1000, at: NOW }
  for (const none of [null, { plan: 'max', models: [] }]) {
    const { watch } = setup([none], last)
    assert.deepEqual((await watch.check('main')).map(n => [n.id, n.pct, n.resetsAt]), [['seven_day', 83, NOW + HOUR]])
  }
})

test('the last turn says nothing when fine, rejected or already reset', () => {
  const base = { at: NOW, resetsAt: (NOW + HOUR) / 1000 }
  assert.deepEqual(nearFromLast(undefined, NOW), [])
  assert.deepEqual(nearFromLast({ ...base, status: 'allowed', utilization: 0.5 }, NOW), [])
  assert.deepEqual(nearFromLast({ ...base, status: 'allowed' }, NOW), [])
  assert.deepEqual(nearFromLast({ ...base, status: 'rejected', utilization: 1 }, NOW), [])
  assert.deepEqual(nearFromLast({ status: 'allowed_warning', at: NOW, resetsAt: (NOW - HOUR) / 1000 }, NOW), [])
  assert.equal(nearFromLast({ ...base, status: 'allowed', utilization: 85 }, NOW)[0].pct, 85)
})

test('the share of the 5-hour window shows for a while after a check', async () => {
  const { watch, clock } = setup([usage(41)])
  assert.equal(watch.fiveHour('main'), undefined, 'nothing seen yet')
  await watch.check('main')
  assert.equal(watch.fiveHour('main'), 41)
  assert.equal(watch.fiveHour('work'), undefined)
  clock.t += 15 * 60_000
  assert.equal(watch.fiveHour('main'), undefined, 'too old to show')
})

test('the warning names the profile, the window, the share and the reset', () => {
  const md = limitWarning('main', [{ id: 'five_hour', label: '5 hours', pct: 82, resetsAt: NOW + HOUR }, { id: 'limit', label: 'Plan limit' }], NOW)
  assert.match(md, /\*\*main\*\*/)
  assert.match(md, /- 5 hours: ==82%==, resets <tg-time unix="\d+" format="r">in 1 h<\/tg-time>/)
  assert.match(md, /- Plan limit: close to the limit/)
  assert.match(md, /\/usage\. #limit$/)
})

test('which window a big task is asked about: 5 hours from 80%, a week from 90%, the week first when both', async () => {
  const { limitToOffer } = await import('../src/telegram/limit-watch.ts')
  const now = Date.UTC(2026, 10, 2)
  const later = (h: number) => new Date(now + h * 3600_000).toISOString()
  const w = (utilization: number, h: number) => ({ utilization, resetsAt: later(h) })
  const plan = (o: object) => ({ plan: 'max', models: [], ...o })
  assert.equal(limitToOffer(plan({ fiveHour: w(79, 2), sevenDay: w(50, 50) }), now), undefined)
  assert.equal(limitToOffer(plan({ fiveHour: w(80, 2), sevenDay: w(50, 50) }), now)?.pct, 80)
  assert.equal(limitToOffer(plan({ sevenDay: w(89, 50) }), now), undefined, 'no 5-hour window: the week at 89% is not yet')
  assert.equal(limitToOffer(plan({ sevenDay: w(90, 50) }), now)?.pct, 90)
  assert.equal(limitToOffer(plan({ fiveHour: w(0, 2), sevenDay: w(90, 50) }), now)?.pct, 90, 'the 5 hours untouched, the week nearly spent')
  assert.equal(limitToOffer(plan({ fiveHour: w(95, 2), sevenDay: w(92, 50) }), now)?.resetsAt, Date.parse(later(50)), 'both: the week')
  assert.equal(limitToOffer(plan({ models: [{ name: 'Opus', ...w(91, 50) }] }), now)?.pct, 91, 'a model\'s week counts as a week')
  assert.equal(limitToOffer(plan({ sevenDay: w(99, -1) }), now), undefined, 'a reset in the past says nothing')
})

test('the numbers are looked up before a big task when they are old, and a slow answer doesn\'t hold the task up', async () => {
  const { createLimitWatch } = await import('../src/telegram/limit-watch.ts')
  let t = Date.UTC(2026, 10, 2)
  let calls = 0
  let slow = false
  const week = (p: number) => ({ plan: 'max', models: [], sevenDay: { utilization: p, resetsAt: new Date(t + 86400_000).toISOString() } })
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-offer-'))
  const watch = createLimitWatch({
    file: join(dir, 'w.json'), last: () => undefined, now: () => t,
    usage: async () => {
      calls++
      if (slow) await new Promise(r => setTimeout(r, 200))
      return week(95)
    },
  })
  assert.equal((await watch.offerWindow('main'))?.pct, 95)
  assert.equal(calls, 1)
  await watch.offerWindow('main')
  assert.equal(calls, 1, 'fresh enough: not asked again')
  t += 11 * 60_000
  slow = true
  const started = Date.now()
  await watch.offerWindow('main', 50)
  assert.ok(Date.now() - started < 150, 'did not wait for the slow answer')
})
