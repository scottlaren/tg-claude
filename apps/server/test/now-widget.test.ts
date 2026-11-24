import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setLang } from '../src/i18n.ts'
import { nowAnswer, nowRows, nowWidgetHtml, NOW_QUERY, type NowRow } from '../src/telegram/now-widget.ts'
import { nowRowsOf, type Names } from '../src/telegram/overview.ts'
import { widgetProblem } from '../src/claude/widget-tools.ts'

setLang('ru')

const long = (i: number, kind: NowRow['kind']): NowRow => ({ kind, what: `Очень длинное описание того, что происходит, номер ${i}`, topic: `Топик с длинным названием ${i} в Farm Game`, link: `https://t.me/c/3555000222/${1000 + i}/${50000 + i}`, since: 1_800_000_000_000 })

test('what waits comes first, six rows at most and a count of the rest', () => {
  const rows = [...Array.from({ length: 5 }, (_, i) => long(i, 'run')), ...Array.from({ length: 4 }, (_, i) => long(i, 'wait'))]
  const d = nowRows(rows)
  assert.deepEqual(d.r.map(r => r[0]), [0, 0, 0, 0, 1, 1])
  assert.equal(d.more, 3)
})

test("the widget's own answer fits Telegram's 1024 bytes, however long the Cyrillic names", () => {
  const rows = Array.from({ length: 12 }, (_, i) => long(i, i % 2 ? 'run' : 'wait'))
  const a = nowAnswer(rows)
  assert.ok(Buffer.byteLength(a) <= 1024, `${Buffer.byteLength(a)} bytes`)
  const d = JSON.parse(a)
  assert.ok(d.r.length >= 3)
  assert.equal(d.r.length + d.more, 12)
})

test('the widget fits the limits, asks with its own query, and opens topics on a tap', () => {
  const html = nowWidgetHtml(Array.from({ length: 6 }, (_, i) => long(i, 'wait')))
  assert.equal(widgetProblem(html), null)
  assert.ok(html.includes(JSON.stringify(NOW_QUERY)))
  assert.match(html, /openTelegramLink/)
  assert.match(nowWidgetHtml([]), /Ничего не идёт/)
})

test('rows name a question by itself and link topics of the private chat through the bot', () => {
  const names: Names = { place: () => 'Farm Game', topic: key => (key === '-1001:10' ? 'Head' : 'tg-claude'), where: key => ({ chatId: Number(key.split(':')[0]), topicId: Number(key.split(':')[1]) }), masked: (_k, t) => t }
  const rows = nowRowsOf({ waiting: [{ key: '-1001:10', kind: 'question', detail: 'Какой вариант?', messageId: 5 }], running: [{ key: '42:7', doing: 'ищет в файлах', since: 1 }] }, names, 'example_bot')
  assert.deepEqual(rows.map(r => [r.what, r.topic, r.link]), [['Какой вариант?', 'Head в Farm Game', 'https://t.me/c/1/10/5'], ['Ищет в файлах', 'tg-claude', 'https://t.me/example_bot/7']])
})
