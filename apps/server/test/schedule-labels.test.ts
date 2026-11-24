import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cronLabel, nextLabel, zoneLabel } from '../src/telegram/schedule-menu.ts'
import { setLang } from '../src/i18n.ts'

test('a cron reads as people say it, and anything rarer stays a cron', () => {
  setLang('ru')
  assert.equal(cronLabel('0 11,22 * * *'), 'каждый день в 11:00 и 22:00')
  assert.equal(cronLabel('30 9 * * 1-5'), 'по будням в 09:30')
  assert.equal(cronLabel('0 9 * * 1,3'), 'по пн и ср в 09:00')
  assert.equal(cronLabel('15 * * * *'), 'каждый час в :15')
  assert.equal(cronLabel('0 10 1 * *'), '1-го числа каждого месяца в 10:00')
  assert.equal(cronLabel('0 8,12,18 * * *'), 'каждый день в 08:00, 12:00 и 18:00')
  assert.equal(cronLabel('*/5 * * * *'), null)
  assert.equal(cronLabel('0 9 * 1 *'), null)
  setLang('en')
  assert.equal(cronLabel('0 11,22 * * *'), 'every day at 11:00 and 22:00')
  assert.equal(cronLabel('0 9 * * 0'), 'on Sun at 09:00')
})

test('the next run says today or tomorrow, in the owner\'s time zone and without seconds', () => {
  setLang('ru')
  const now = Date.parse('2026-11-05T08:06:00Z') // 12:06 at UTC+4
  assert.equal(nextLabel(Date.parse('2026-11-05T18:00:00Z'), 'Etc/GMT-4', now), 'сегодня в 22:00')
  assert.equal(nextLabel(Date.parse('2026-11-05T21:00:00Z'), 'Etc/GMT-4', now), 'завтра в 01:00')
  assert.match(nextLabel(Date.parse('2026-11-09T07:00:00Z'), 'Etc/GMT-4', now), /^пн, 9 нояб\.? в 11:00$/)
  assert.equal(nextLabel(Infinity, 'UTC', now), 'никогда')
})

test('a time zone shows its offset the right way round', () => {
  assert.equal(zoneLabel('Etc/GMT-4'), 'UTC+4')
  assert.equal(zoneLabel('UTC'), 'UTC')
  assert.match(zoneLabel('Europe/Kyiv'), /^Europe\/Kyiv \(UTC\+[23]\)$/)
})
