import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gunzipSync, gzipSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { setLang } from '../src/i18n.ts'
import { prepareSticker } from '../src/telegram/sticker.ts'
import { findDeviceMedia, isInMessage, isSticker, stripDeviceMedia } from '../src/telegram/render.ts'

setLang('en')

const lottie = (over: object = {}) => ({ v: '5.5.2', w: 512, h: 512, fr: 60, ip: 0, op: 120, layers: [{ ty: 4 }], ...over })
const json = (over?: object) => Buffer.from(JSON.stringify(lottie(over)))
const tgs = (over?: object) => gzipSync(json(over))
const whyOf = (r: ReturnType<typeof prepareSticker>) => (r.ok ? assert.fail('it should not fit') : r.why)

test('a Lottie is gzipped to TGS, a TGS goes as it is', () => {
  const a = prepareSticker('wave.json', json())
  assert.ok(a.ok)
  assert.equal(a.name, 'wave.tgs')
  assert.deepEqual(JSON.parse(gunzipSync(a.tgs).toString()), lottie())
  const file = tgs()
  const b = prepareSticker('wave.tgs', file)
  assert.ok(b.ok)
  assert.equal(b.tgs, file, 'byte for byte')
  assert.ok(prepareSticker('x.json', json({ fr: 30, op: 90 })).ok, '30 fps, exactly 3 s')
})

test('what breaks a rule says which, in words', () => {
  assert.match(whyOf(prepareSticker('a.json', json({ w: 800, h: 600 }))), /800×600.*512×512/)
  assert.match(whyOf(prepareSticker('a.json', json({ fr: 24, op: 24 }))), /24 fps.*30 or 60/)
  assert.match(whyOf(prepareSticker('a.json', json({ op: 240 }))), /lasts 4 s.*up to 3 s/)
  assert.match(whyOf(prepareSticker('a.json', json({ op: 0 }))), /lasts 0 s/)
  assert.match(whyOf(prepareSticker('a.tgs', tgs({ w: 100, op: 600 }))), /100×512.*; .*lasts 10 s/, 'all of them at once')
})

test('what a sticker cannot draw is named, in the layers and the assets', () => {
  assert.match(whyOf(prepareSticker('a.json', json({ layers: [{ ty: 2 }] }))), /images/)
  assert.match(whyOf(prepareSticker('a.json', json({ layers: [{ ty: 5 }, { ty: 1 }] }))), /solids, text layers/)
  assert.match(whyOf(prepareSticker('a.json', json({ ddd: 1 }))), /3D/)
  assert.match(whyOf(prepareSticker('a.json', json({ assets: [{ layers: [{ ty: 4, hasMask: true }] }] }))), /masks/)
})

test('too big once gzipped: the size is measured on what would be sent', () => {
  const noise = randomBytes(70 * 1024).toString('base64')
  assert.match(whyOf(prepareSticker('a.json', json({ nm: noise }))), /\d+ KB gzipped.*up to 64 KB/)
  assert.match(whyOf(prepareSticker('a.tgs', tgs({ nm: noise }))), /up to 64 KB/)
  assert.ok(prepareSticker('a.json', json({ nm: 'a'.repeat(200 * 1024) })).ok, 'a big file that packs well fits')
})

test('what is no animation says so', () => {
  assert.match(whyOf(prepareSticker('a.json', Buffer.from('{"name":"package"}'))), /isn't a Lottie/)
  assert.match(whyOf(prepareSticker('a.json', Buffer.from('not json'))), /isn't a Lottie/)
  assert.match(whyOf(prepareSticker('a.tgs', Buffer.from('not gzip'))), /valid TGS/)
  assert.match(whyOf(prepareSticker('a.tgs', gzipSync('not json'))), /valid TGS/)
  assert.match(whyOf(prepareSticker('a.json', Buffer.alloc(17 * 1024 * 1024))), /too big/)
})

test('an answer: stickers are told from pictures, from the computer only, never when only talked about', () => {
  const refs = findDeviceMedia('![Hi](a/wave.tgs)\n![](b.JSON)\n![pic](c.png)\n`![code](d.tgs)`\n![web](https://e.com/e.tgs)')
  assert.deepEqual(refs.filter(isSticker).map(r => r.path), ['a/wave.tgs', 'b.JSON'])
  assert.deepEqual(refs.filter(isInMessage).map(r => r.path), ['c.png'])
  assert.equal(stripDeviceMedia('![Hi](a/wave.tgs)'), '_🖼 Hi_', 'a draft shows a placeholder')
})
