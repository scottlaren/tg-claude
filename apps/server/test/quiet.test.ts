import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setLang } from '../src/i18n.ts'
import { createQuietStore, keepLoud, keepSilent, quietCard, quietTransformer } from '../src/telegram/quiet.ts'

setLang('en')

const CHAT = 5
function through(on: (id: number) => boolean) {
  const seen: { method: string, payload: Record<string, unknown> }[] = []
  const prev = (method: string, payload: Record<string, unknown>) => {
    seen.push({ method, payload })
    return Promise.resolve({ ok: true })
  }
  const use = quietTransformer(on) as unknown as (p: typeof prev, m: string, payload: Record<string, unknown>) => Promise<unknown>
  return { seen, send: (method: string, payload: Record<string, unknown> = { chat_id: CHAT }) => use(prev, method, payload) }
}

test('in a quiet chat every kind of send goes silent; another chat and what is no send are left alone', async () => {
  const { seen, send } = through(id => id === CHAT)
  for (const m of ['sendMessage', 'sendRichMessage', 'sendPhoto', 'sendDocument', 'sendVideo', 'sendAnimation', 'sendSticker']) await send(m)
  assert.ok(seen.every(c => c.payload.disable_notification === true), 'all silent')
  seen.length = 0
  await send('sendMessage', { chat_id: 6 })
  await send('editMessageText')
  await send('sendRichMessageDraft')
  await send('getUpdates', {})
  assert.ok(seen.every(c => !('disable_notification' in c.payload)))
})

test('what is marked keeps its push through awaits and timers, and nothing else catches it', async () => {
  const { seen, send } = through(() => true)
  const silent = () => seen.at(-1)!.payload.disable_notification === true
  await keepLoud(async () => {
    await send('sendMessage')
    assert.equal(silent(), false)
    await new Promise(r => setTimeout(r, 1))
    await send('sendRichMessage')
    assert.equal(silent(), false)
    await keepSilent(() => send('sendSticker'))
    assert.equal(silent(), true, 'the second of two')
  })
  await send('sendMessage')
  assert.equal(silent(), true, 'after the mark it is silent again')
  const later = keepLoud(() => Promise.resolve())
  await later.then(() => send('sendMessage'))
  assert.equal(silent(), true, 'a then outside the mark is outside it')
})

test('the switch outlives a restart and is per chat; the card offers the other way', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tgcv-quiet-')), 'quiet.json')
  const a = createQuietStore(file)
  assert.equal(a.on(CHAT), false, 'off by default')
  a.set(CHAT, true)
  assert.equal(createQuietStore(file).on(CHAT), true)
  assert.equal(createQuietStore(file).on(6), false)
  const data = (on: boolean) => JSON.stringify(quietCard(on).kb.inline_keyboard)
  assert.match(data(true), /qt:off/)
  assert.match(data(false), /qt:on/)
})
