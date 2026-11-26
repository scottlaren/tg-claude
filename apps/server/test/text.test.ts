import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cut, trunc, wellFormed } from '../src/telegram/text.ts'
import { toolStep } from '../src/telegram/render.ts'

const BRAIN = String.fromCodePoint(0x1f9e0)

test('a cut never leaves half a character', () => {
  const s = `abc${BRAIN}def`
  assert.equal(cut(s, 3), 'abc')
  assert.equal(cut(s, 4), 'abc', 'the emoji takes two places: one of them is none')
  assert.equal(cut(s, 5), `abc${BRAIN}`)
  assert.equal(cut(s, 100), s)
  assert.equal(cut(s, 0), '')
  assert.equal(trunc(s, 5), 'abc…')
  assert.equal(trunc(s, 8), s)
  for (let n = 0; n < 12; n++) assert.ok(cut(BRAIN.repeat(5), n).isWellFormed() && trunc(BRAIN.repeat(5), n).isWellFormed(), String(n))
})

// The answer that was lost: its list of steps had this command, shortened to 70 places, the emoji at the 69th
test('a step of an answer is whole whatever its command has at the cut', () => {
  const command = `git checkout -q -b feature/0.19.1 && cd apps/server && grep -n "tr('${BRAIN} Model'\\|Search off" src/telegram/companion.ts`
  assert.equal(command.indexOf(BRAIN), 68)
  const step = toolStep('mcp__device__run_command', { command })
  assert.ok(step.isWellFormed(), step)
  assert.match(step, /tr\('…/)
})

test('what leaves for Telegram is made whole, and what is not text is left alone', () => {
  const half = BRAIN[0]
  const file = new Uint8Array([1, 2])
  class Upload { name = `x${half}` }
  const upload = new Upload()
  const out = wellFormed({ chat_id: 5, text: `a${half}`, rich_message: { markdown: `b${half}c`, media: [{ id: `m${half}`, media: file }] }, upload, none: null })
  assert.ok(JSON.stringify(out).isWellFormed())
  assert.deepEqual([out.text, out.rich_message.markdown, out.rich_message.media[0].id], ['a�', 'b�c', 'm�'])
  assert.equal(out.rich_message.media[0].media, file)
  assert.equal(out.upload, upload, 'a file to upload is not taken apart')
  assert.equal(out.chat_id, 5)
  const whole = { text: `fine ${BRAIN}` }
  assert.deepEqual(wellFormed(whole), whole)
})
