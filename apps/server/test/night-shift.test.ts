import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setLang } from '../src/i18n.ts'
import { createShifts, morningAfter, shiftCard, shiftRule, morningPing } from '../src/telegram/night-shift.ts'

setLang('ru')

function stand() {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-shift-'))
  let t = Date.UTC(2026, 10, 2, 20, 0)
  const make = () => createShifts(join(dir, 'shifts.json'), () => t)
  return { make, at: (x: number) => { t = x }, done: () => rmSync(dir, { recursive: true, force: true }) }
}
const tasks = { tasks: ['Собрать сцену', 'Проверить цены'], sleep: true, release: false }

test('the morning is the next 9:00 in the user\'s time zone', () => {
  const evening = Date.UTC(2026, 10, 2, 19, 0) // 23:00 at UTC+4
  assert.equal(morningAfter(evening, 'Etc/GMT-4'), Date.UTC(2026, 10, 3, 5, 0))
  const early = Date.UTC(2026, 10, 2, 2, 0) // 6:00 at UTC+4: still this morning
  assert.equal(morningAfter(early, 'Etc/GMT-4'), Date.UTC(2026, 10, 2, 5, 0))
})

test('offered, started, ended: one running per topic, and it lives through a restart', () => {
  const s = stand()
  try {
    const shifts = s.make()
    const first = shifts.offer('1:2', tasks)
    const second = shifts.offer('1:2', tasks)
    assert.equal(shifts.get(first.id), undefined, 'an offer not taken is replaced')
    assert.equal(shifts.running('1:2'), undefined)
    shifts.start(second.id, { morningAt: 123, before: { mode: 'ask', night: false } })
    assert.equal(s.make().running('1:2')?.id, second.id)
    assert.equal(s.make().inChat(1), true)
    assert.equal(s.make().inChat(11), false, 'one chat\'s id is not the start of another\'s')
    shifts.end(second.id, true)
    assert.equal(s.make().running('1:2'), undefined)
    assert.equal(s.make().get(second.id)?.done, true)
  } finally {
    s.done()
  }
})

test('the card says what is allowed; the rules follow the choice of release', () => {
  const card = shiftCard({ id: 'a', key: 'k', state: 'offered', ...tasks }, x => x)
  assert.match(card, /1\. Собрать сцену/)
  assert.match(card, /Только свои ветки/)
  assert.match(card, /Компьютеры уснут/)
  const branches = shiftRule({ id: 'a', key: 'k', state: 'running', ...tasks })
  assert.match(branches, /Own branches only/)
  assert.match(branches, /convene 2–3 reviewers/)
  assert.match(branches, /Never ask the user/)
  assert.match(shiftRule({ id: 'a', key: 'k', state: 'running', ...tasks, release: true }), /Merging and releasing are allowed/)
})

test('the morning push says whether all of it got done', () => {
  const end = Date.UTC(2026, 10, 2, 23, 40)
  assert.match(morningPing({ id: 'a', key: 'k', state: 'ended', ...tasks, done: true, endedAt: end }, 'Etc/GMT-4'), /закончилась в 03:40/)
  assert.match(morningPing({ id: 'a', key: 'k', state: 'ended', ...tasks, done: false, endedAt: end }, 'Etc/GMT-4'), /сделала не всё/)
})

test('a computer another shift asked to turn off is kept with the shift record', () => {
  const s = stand()
  try {
    const shifts = s.make()
    const a = shifts.offer('1:2', tasks)
    shifts.start(a.id, { morningAt: 1, before: { night: false } })
    shifts.change(a.id, { offAfter: ['pc'] })
    assert.deepEqual(s.make().running('1:2')?.offAfter, ['pc'])
  } finally {
    s.done()
  }
})

test('a shift saved before sleep existed, with shutdown, sleeps; tidying is said on the card', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-shift-old-'))
  try {
    const file = join(dir, 'shifts.json')
    writeFileSync(file, JSON.stringify([{ id: 'aaaa0001', key: '1:2', tasks: ['x'], release: false, shutdown: true, state: 'running' }]))
    const s = createShifts(file).running('1:2')!
    assert.equal(s.sleep, true)
    assert.ok(!('shutdown' in s))
    assert.match(shiftCard({ ...s, tidy: true }, t => t), /открытые окна закроются/)
    assert.match(shiftCard({ ...s, tidy: false }, t => t), /Открытые окна останутся как есть/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
