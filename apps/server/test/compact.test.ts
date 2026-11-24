import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokens, compactView, compactedText, shouldOffer, OFFER_AT, TOPIC_WINDOW, AGENT_WINDOW } from '../src/telegram/compact.ts'
import { setLang } from '../src/i18n.ts'

const buttons = (kb: ReturnType<typeof compactView>['kb']) => kb.inline_keyboard.flat().map(b => ({ text: b.text, data: (b as { callback_data: string }).callback_data }))

test('token counts read like people say them', () => {
  setLang('en')
  assert.deepEqual([42_400, 965_000, 1_000_000, 1_250_000].map(tokens), ['42k', '965k', '1M', '1.3M'])
  setLang('ru')
  assert.deepEqual([965_000, 1_000_000, 1_250_000].map(tokens), ['965 тыс.', '1 млн', '1,3 млн'])
})

test('/compact shows how full the history is first, and compacts only on a tap', () => {
  setLang('ru')
  const v = compactView({ total: 965_000, max: 1_000_000 })
  assert.match(v.md, /965 тыс\. из 1 млн токенов \(97%\)/)
  assert.match(v.md, /▓{10}/)
  assert.doesNotMatch(v.md, /разрастается/)
  assert.deepEqual(buttons(v.kb), [
    { text: '🗜 Сжать', data: 'cp:go' },
    { text: 'Оставить как есть', data: 'cp:no' },
  ])
  // Rich buttons, as in /delete; the keyboard is only what's left if Telegram refuses them
  assert.deepEqual(v.rows.flat().map(b => b.data), ['cp:go', 'cp:no'])
  // Offered by itself after a turn: it also says why
  assert.match(compactView({ total: 750_000, max: 1_000_000 }, true).md, /разрастается/)
  assert.match(compactView().md, /размер пока неизвестен/)
  setLang('en')
  assert.match(compactedText(965_000, 42_000), /965k → 42k tokens/)
  assert.match(compactedText(), /History compacted/)
})

test('the bot offers to compact at half a million tokens, and Claude compacts by itself at 700k, an agent at 500k', () => {
  assert.deepEqual([OFFER_AT, TOPIC_WINDOW, AGENT_WINDOW], [500_000, 700_000, 500_000])
  assert.equal(shouldOffer(undefined), false)
  assert.equal(shouldOffer({ total: 490_000, max: TOPIC_WINDOW }), false)
  assert.equal(shouldOffer({ total: 500_000, max: TOPIC_WINDOW }), true)
  assert.equal(shouldOffer({ total: 500_000, max: 1_000_000 }), true)
  // A model with a small window: at 70% of it
  assert.equal(shouldOffer({ total: 130_000, max: 200_000 }), false)
  assert.equal(shouldOffer({ total: 140_000, max: 200_000 }), true)
  assert.equal(shouldOffer({ total: 5, max: 0 }), false)
  setLang('ru')
  assert.match(compactView({ total: 520_000, max: TOPIC_WINDOW }, true).md, /520 тыс. из 700 тыс.[\s\S]*Около 700 тыс. Claude всё равно сожмёт/)
})
