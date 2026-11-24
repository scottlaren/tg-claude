import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setLang } from '../src/i18n.ts'
import { nightWidgetHtml } from '../src/telegram/night-widget.ts'
import { widgetProblem } from '../src/claude/widget-tools.ts'

setLang('ru')

const from = Date.UTC(2026, 10, 9, 19, 10), to = Date.UTC(2026, 10, 10, 0, 40)

test('the morning card: the night in the user\'s clock, the count, the cost of the week, both lists', () => {
  const html = nightWidgetHtml({ from, to, zone: 'Etc/GMT-4', finished: ['a', 'b', 'c'], left: ['d'], weekPoints: 12.4, power: 'sleep' })
  assert.ok(!widgetProblem(html))
  assert.match(html, /23:10–04:40/)
  assert.match(html, /<b>3\/4<\/b>/)
  assert.match(html, /5 ч 30 мин/)
  assert.match(html, /\+12%/)
  assert.match(html, /id=sg/, 'done and left: a switch between them')
})

test('the morning card: all of it done needs no switch; without the week\'s numbers it says whether the computers sleep', () => {
  const html = nightWidgetHtml({ from, to, zone: 'Etc/GMT-4', finished: ['a'], left: [], power: 'on' })
  assert.doesNotMatch(html, /id=sg/)
  assert.match(html, /<div class=sec>Сделано<\/div>/)
  assert.match(html, /включены/)
  assert.doesNotMatch(html, /Лимит недели/)
})

test('the morning card of a night that went on on another profile: the week of each one it ran on', () => {
  const html = nightWidgetHtml({ from, to, zone: 'Etc/GMT-4', finished: ['a'], left: ['b'], weekPoints: 4, byProfile: [{ name: 'main', points: 22.4 }, { name: 'work', points: 9 }], power: 'sleep' })
  assert.match(html, /<span>Неделя, main<\/span><b>\+22%<\/b>/)
  assert.match(html, /<span>Неделя, work<\/span><b>\+9%<\/b>/)
  assert.doesNotMatch(html, /Лимит недели/)
})

test('the morning card: an item cannot close the script, and twelve long ones still fit Telegram\'s limits', () => {
  const long = Array.from({ length: 12 }, (_, i) => `${i} </script><b>${'x'.repeat(70)}`)
  const html = nightWidgetHtml({ from, to, zone: 'UTC', finished: long, left: long, power: 'sleep' })
  assert.ok(!html.includes('</script><b>'))
  assert.ok(!widgetProblem(html))
})
