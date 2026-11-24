import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setLang } from '../src/i18n.ts'
import { usageWidgetHtml } from '../src/telegram/usage-widget.ts'
import { widgetProblem } from '../src/claude/widget-tools.ts'

setLang('ru')

const week = (name: (i: number) => string) => ({
  plan: 'Ultra',
  windows: [{ label: '5 часов', pct: 73.4, resetsAt: 1 }, { label: 'Неделя', pct: 41 }, { label: 'Opus', pct: 38 }, { label: 'Sonnet', pct: 2 }],
  days: Array.from({ length: 7 }, (_, i) => ({ day: `2026-11-0${i + 3}`, total: 100 * (i + 1), topics: [0, 1, 2].map(j => ({ name: name(i * 3 + j), place: 'Farm Game', units: 10 * (j + 1) })) })),
  week: [0, 1, 2].map(j => ({ name: name(j), place: 'Tiptoe', share: 0.3 - j / 10 })),
})

test("a week of long topic names fits Telegram's limits; days are named in the user's language", () => {
  const html = usageWidgetHtml(week(i => `Очень длинное название топика номер ${i} для проверки`))
  assert.equal(widgetProblem(html), null)
  assert.match(html, /"Лимиты"|>Лимиты</)
  assert.match(html, /"s":"вт","l":"вторник"/, '2026-11-03 is a Tuesday')
  assert.match(html, /\["5 часов",73,1\]/)
  assert.ok(!html.includes('"Sonnet"'), 'three rings at most')
})

test('a name cannot close the script it is carried in, and nothing joins a name with its group', () => {
  const html = usageWidgetHtml(week(() => '</script><b>x</b>'))
  assert.ok(!/<\/script><b>/.test(html))
  assert.ok(!html.includes(' · '))
})

test('with nothing spent there is no chart, only the rings', () => {
  const html = usageWidgetHtml({ ...week(() => 'x'), days: week(() => 'x').days.map(d => ({ ...d, total: 0, topics: [] })) })
  assert.ok(!html.includes('id=ch'))
})
