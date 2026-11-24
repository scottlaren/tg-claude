import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSchedule, nextRun, oftenerThanHourly, parseAt, parseCron, parseTimeZone, skipReason, MAX_TASKS } from '../src/schedule.ts'
import { proposalMarkdown as proposalText, runPrompt, whenLabel, whenTag } from '../src/telegram/schedule-menu.ts'

const utc = (s: string) => Date.parse(`${s}Z`)
const next = (expr: string, after: string, zone = 'UTC') => {
  const t = nextRun(parseCron(expr)!, utc(after), zone)
  return t === null ? null : new Date(t).toISOString().slice(0, 16)
}

test('only five fields of numbers in range make a cron', () => {
  for (const bad of ['', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '* * * * 8', 'a * * * *', '5-1 * * * *', '*/0 * * * *', '0 9 * * MON']) {
    assert.equal(parseCron(bad), null, bad)
  }
  const c = parseCron('0,30 9-11 */10 1 7')!
  assert.deepEqual([...c.minutes], [0, 30])
  assert.deepEqual([...c.hours], [9, 10, 11])
  assert.deepEqual([...c.days], [1, 11, 21, 31])
  assert.deepEqual([...c.weekdays], [0], '7 is Sunday too')
})

test('more often than hourly is told by the minute field', () => {
  assert.equal(oftenerThanHourly(parseCron('0 * * * *')!), false)
  assert.equal(oftenerThanHourly(parseCron('15 9,18 * * 1-5')!), false)
  assert.equal(oftenerThanHourly(parseCron('*/30 * * * *')!), true)
  assert.equal(oftenerThanHourly(parseCron('0,1 9 * * *')!), true)
})

test('the next run comes strictly after the given moment', () => {
  assert.equal(next('0 9 * * *', '2026-10-30T08:59'), '2026-10-30T09:00')
  assert.equal(next('0 9 * * *', '2026-10-30T09:00'), '2026-10-31T09:00')
  assert.equal(next('0 * * * *', '2026-10-30T23:30'), '2026-10-31T00:00')
})

test('weekdays and days of the month: both given means either', () => {
  assert.equal(next('0 9 * * 1', '2026-10-30T00:00'), '2026-11-02T09:00', 'the next Monday')
  assert.equal(next('0 9 15 * *', '2026-10-30T00:00'), '2026-11-15T09:00')
  assert.equal(next('0 9 15 * 1', '2026-10-30T00:00'), '2026-11-02T09:00')
  assert.equal(next('0 0 29 2 *', '2026-10-30T00:00'), '2028-02-29T00:00')
  assert.equal(next('0 0 31 2 *', '2026-10-30T00:00'), null)
})

test('times are read in the owner\'s time zone, daylight saving included', () => {
  assert.equal(next('0 9 * * *', '2026-07-01T00:00', 'Europe/Kyiv'), '2026-07-01T06:00', 'UTC+3 in summer')
  assert.equal(next('0 9 * * *', '2026-12-01T00:00', 'Europe/Kyiv'), '2026-12-01T07:00', 'UTC+2 in winter')
  assert.equal(next('0 9 * * *', '2026-10-24T07:00', 'Europe/Kyiv'), '2026-10-25T07:00', 'the night the clocks go back')
  assert.equal(next('30 9 * * *', '2026-01-01T00:00', 'Asia/Kolkata'), '2026-01-01T04:00', 'half-hour offsets')
  // 03:30 doesn't exist on the night the clocks go forward: the task waits for the next day, not for an error
  assert.equal(next('30 3 * * *', '2026-03-29T00:00', 'Europe/Kyiv'), '2026-03-30T00:30')
})

test('what the owner types as a time zone', () => {
  assert.equal(parseTimeZone('Europe/Kyiv'), 'Europe/Kyiv')
  assert.equal(parseTimeZone('europe/kyiv')?.toLowerCase(), 'europe/kyiv')
  assert.equal(parseTimeZone(' Kyiv '), 'Europe/Kyiv')
  assert.equal(parseTimeZone('new york'), 'America/New_York')
  assert.equal(parseTimeZone('UTC'), 'UTC')
  assert.equal(parseTimeZone('UTC+3'), 'Etc/GMT-3', 'the POSIX names have the sign turned round')
  assert.equal(parseTimeZone('GMT-5'), 'Etc/GMT+5')
  assert.equal(parseTimeZone('+3'), 'Etc/GMT-3')
  assert.equal(next('0 9 * * *', '2026-07-01T00:00', parseTimeZone('UTC+3')!), '2026-07-01T06:00')
  for (const bad of ['', 'Atlantis', 'UTC+99', 'UTC+5:30', 'Киев', '../etc/passwd', 'x'.repeat(65)]) assert.equal(parseTimeZone(bad), null, bad)
})

function setup(start = utc('2026-10-30T08:00')) {
  const file = join(mkdtempSync(join(tmpdir(), 'tgcv-schedule-')), 'schedule.json')
  const clock = { t: start }
  const now = () => clock.t
  return { file, clock, s: createSchedule(file, now), reopen: () => createSchedule(file, now) }
}
const task = { key: '1:2', name: 'Check', prompt: 'Check the build', cron: '0 9 * * *' }

test('a task comes due at its time, moves on after a run and survives a restart', () => {
  const { s, clock, reopen } = setup()
  const t = s.add(task)
  assert.equal(t.nextAt, utc('2026-10-30T09:00'))
  assert.deepEqual(s.due(), [])
  clock.t = utc('2026-10-30T09:00')
  assert.deepEqual(s.due().map(x => x.id), [t.id])
  s.advance(t.id, false)
  assert.deepEqual(s.due(), [], 'the same run never comes twice')
  assert.equal(reopen().get(t.id)?.nextAt, utc('2026-10-31T09:00'))
})

test('a paused task owes nothing when it resumes', () => {
  const { s, clock } = setup()
  const t = s.add(task)
  s.setPaused(t.id, true)
  clock.t = utc('2026-11-02T12:00')
  assert.deepEqual(s.due(), [])
  assert.equal(s.activeIn(task.key), false, 'a paused schedule does not keep a quiet topic alive')
  s.setPaused(t.id, false)
  assert.deepEqual(s.due(), [])
  assert.equal(s.get(t.id)?.nextAt, utc('2026-11-03T09:00'))
  assert.equal(s.activeIn(task.key), true)
})

test('a new time zone moves every task; a deleted topic takes its tasks along', () => {
  const { s } = setup()
  assert.equal(s.zoneChosen(), false)
  assert.equal(s.zone(), 'UTC')
  const t = s.add(task)
  const other = s.add({ ...task, key: '1:3' })
  s.setZone('Europe/Kyiv')
  assert.equal(s.zoneChosen(), true)
  assert.equal(s.get(t.id)?.nextAt, utc('2026-10-31T07:00'))
  s.moveTopic('1:2', '-5:7')
  assert.ok(s.list().some(t => t.key === '-5:7'))
  assert.ok(!s.list().some(t => t.key === '1:2'))
  s.moveTopic('-5:7', '1:2')
  s.removeTopic('1:2')
  assert.deepEqual(s.list().map(x => x.id), [other.id])
  s.remove(other.id)
  assert.deepEqual(s.list(), [])
})

test('tasks have a ceiling', () => {
  const { s } = setup()
  for (let i = 0; i < MAX_TASKS; i++) {
    assert.equal(s.full(), false)
    s.add(task)
  }
  assert.equal(s.full(), true)
})

test('nothing is written until something changes, and a broken file starts empty', () => {
  const { file, s, reopen } = setup()
  assert.deepEqual(s.list(), [])
  assert.equal(existsSync(file), false)
  writeFileSync(file, '{ not json')
  assert.deepEqual(reopen().list(), [])
  assert.equal(reopen().zoneChosen(), false)
})

test('a moment in local time, or none when the calendar has no such moment', () => {
  const at = (s: string, zone = 'UTC') => {
    const t = parseAt(s, zone)
    return t === null ? null : new Date(t).toISOString().slice(0, 16)
  }
  assert.equal(at('2026-10-31T10:00'), '2026-10-31T10:00')
  assert.equal(at('2026-10-31 10:00'), '2026-10-31T10:00')
  assert.equal(at('2026-10-31T10:00', 'Europe/Kyiv'), '2026-10-31T08:00')
  assert.equal(at('2026-07-01T10:00', 'Europe/Kyiv'), '2026-07-01T07:00')
  assert.equal(at('2027-12-31T23:00'), '2027-12-31T23:00', 'the last hour of a year two ahead')
  assert.equal(at('2027-12-31T23:00', 'Pacific/Pago_Pago'), '2028-01-01T10:00')
  assert.equal(at('2027-01-01T00:00', 'Asia/Tokyo'), '2026-12-31T15:00')
  assert.equal(at('2028-02-29T12:00'), '2028-02-29T12:00')
  for (const none of ['2027-02-29T12:00', '2026-02-31T12:00', '2026-13-01T12:00', '2026-10-31T25:00', 'tomorrow', '2026-10-31', '2026-10-31T10:00:00']) assert.equal(at(none), null, none)
  assert.equal(at('2026-03-29T03:30', 'Europe/Kyiv'), null, 'the hour skipped when the clocks go forward')
})

test('a one-time task comes due at its moment, whatever the time zone says later', () => {
  const { s, clock, reopen } = setup()
  const at = utc('2026-10-30T10:30')
  const t = s.add({ ...task, cron: '' }, at)
  assert.equal(t.once, true)
  assert.equal(t.nextAt, at)
  s.setZone('Asia/Tokyo')
  assert.equal(s.get(t.id)?.nextAt, at, 'the owner confirmed this very moment')
  assert.equal(reopen().get(t.id)?.once, true)
  clock.t = at
  assert.deepEqual(s.due().map(x => x.id), [t.id])
})

test('a one-time task paused past its moment comes due when it resumes, and the run decides what is late', () => {
  const { s, clock } = setup()
  const at = utc('2026-10-30T10:30')
  const t = s.add({ ...task, cron: '' }, at)
  s.setPaused(t.id, true)
  clock.t = at + 2 * 3600_000
  assert.deepEqual(s.due(), [])
  s.setPaused(t.id, false)
  assert.deepEqual(s.due().map(x => x.id), [t.id])
  assert.equal(skipReason({ now: clock.t, nextAt: s.get(t.id)!.nextAt, running: false, unbound: false, offline: false, limited: false }), 'late')
})

test('why a run that came due does not happen', () => {
  const now = utc('2026-10-30T09:00')
  const ok = { now, nextAt: now, running: false, unbound: false, offline: false, limited: false }
  assert.equal(skipReason(ok), null)
  assert.equal(skipReason({ ...ok, nextAt: now - 3600_000 }), null, 'less than an hour late still runs')
  assert.equal(skipReason({ ...ok, nextAt: now - 3600_001 }), 'late')
  assert.equal(skipReason({ ...ok, running: true }), 'running')
  assert.equal(skipReason({ ...ok, unbound: true }), 'unbound')
  assert.equal(skipReason({ ...ok, offline: true }), 'offline')
  assert.equal(skipReason({ ...ok, limited: true }), 'limit')
  assert.equal(skipReason({ ...ok, nextAt: now - 7200_000, offline: true }), 'late', 'a long gap is told as what it was')
})

test('the confirmation shows the very text that will run, and what the topic\'s mode means for it', () => {
  const p = { name: 'Check <b>', cron: '0 9 * * *', prompt: 'Delete <everything>' }
  const runs = [utc('2026-10-31T07:00'), utc('2026-11-01T07:00')]
  const text = proposalText(p, 'Europe/Kyiv', true, runs, 'ask')
  assert.match(text, /Check &lt;b>/)
  assert.ok(text.includes('```\nDelete <everything>\n```'), 'in a code block: exactly what will run, never read as formatting')
  assert.match(text, /Europe\/Kyiv/)
  assert.match(text, /30 minutes/)
  assert.match(text, /31 Oct/)
  assert.doesNotMatch(proposalText(p, 'Europe/Kyiv', true, runs, 'all'), /30 minutes/)
  assert.match(proposalText(p, 'Europe/Kyiv', true, runs, 'read'), /read-only/)
  assert.match(proposalText(p, 'UTC', false, runs, 'all'), /not chosen/)
  const once = proposalText({ ...p, cron: undefined }, 'UTC', true, runs.slice(0, 1), 'all')
  assert.match(once, /once · UTC/)
  assert.match(once, /Runs: /)
  const relative = proposalText({ ...p, cron: undefined, inMinutes: 120 }, 'UTC', false, [], 'all')
  assert.match(relative, /Runs: in 2 h after you tap Create/, 'counted from the tap, not from the offer')
})

test('a run tells Claude nobody may be watching, then gives the task', () => {
  const text = runPrompt({ name: 'Check', prompt: 'Check the build' })
  assert.match(text, /^\[Scheduled task "Check"/)
  assert.ok(text.endsWith('\n\nCheck the build'))
})

test('a moment shows in the reader\'s time zone, with the owner\'s as the fallback', () => {
  assert.equal(whenTag(utc('2026-10-31T07:00'), 'UTC'), `<tg-time unix="${utc('2026-10-31T07:00') / 1000}" format="wDT">${whenLabel(utc('2026-10-31T07:00'), 'UTC')}</tg-time>`)
  assert.equal(whenTag(Infinity, 'UTC'), 'never')
})

test('a time with no date to come reads as never', () => {
  assert.equal(whenLabel(Infinity, 'UTC'), 'never')
})

test('the confirmation shows a long task to its last word', () => {
  const prompt = 'x'.repeat(1990) + 'THE END'
  const text = proposalText({ name: 'n', cron: '0 9 * * *', prompt }, 'UTC', true, [utc('2026-10-31T09:00')], 'all')
  assert.ok(text.includes('THE END'))
  assert.ok(text.length < 4096, 'and it fits a message')
})

test('an account taken off the list takes all its chat\'s tasks along, and no one else\'s', () => {
  const { s } = setup()
  s.add({ ...task, key: '10:1' })
  s.add({ ...task, key: '10:2' })
  const other = s.add({ ...task, key: '100:1' })
  s.removeChat(10)
  assert.deepEqual(s.list().map(t => t.id), [other.id])
})

test('the card of a run missed while the computer was off says what it means for a one-time and a recurring task', async () => {
  const { skippedOfflineMarkdown } = await import('../src/telegram/schedule-menu.ts')
  const once = skippedOfflineMarkdown('Release', true, null)
  assert.match(once, /Release: skipped/)
  assert.match(once, /one-time task: without a tap it won't run again/)
  const daily = skippedOfflineMarkdown('Morning check', false, 'tomorrow 09:00')
  assert.match(daily, /The schedule stays\. Next: tomorrow 09:00/)
})
