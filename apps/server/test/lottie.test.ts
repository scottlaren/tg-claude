import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { lottieToSvg, svgName } from '../src/lottie.ts'
import { zip, unzip } from '../src/zip.ts'
import { customEmojiNote } from '../src/telegram/incoming.ts'
import { lottieSummary } from '../src/lottie-file.ts'

// A square that moves right over 60 frames: enough to tell one frame from another
const lottie = {
  v: '5.5.2', fr: 60, ip: 0, op: 60, w: 512, h: 512, ddd: 0, assets: [],
  layers: [{
    ddd: 0, ind: 1, ty: 4, nm: 'box', sr: 1, ip: 0, op: 60, st: 0, bm: 0,
    ks: {
      o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] },
      p: { a: 1, k: [{ t: 0, s: [100, 256, 0], i: { x: [1], y: [1] }, o: { x: [0], y: [0] } }, { t: 59, s: [400, 256, 0] }] },
    },
    shapes: [{ ty: 'gr', nm: 'g', it: [
      { ty: 'rc', d: 1, s: { a: 0, k: [100, 100] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 }, nm: 'r' },
      { ty: 'fl', c: { a: 0, k: [1, 0.2, 0.4, 1] }, o: { a: 0, k: 100 }, r: 1, nm: 'f' },
      { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
    ] }],
  }],
}
const tgs = gzipSync(JSON.stringify(lottie))
const x = (svg: string) => Number(/matrix\(1,0,0,1,([\d.]+),256\)/.exec(svg)?.[1])

test('a TGS frame comes out as a standalone SVG of the sticker\'s size, the frame asked for', async () => {
  const [first, middle, last, n, past] = await Promise.all(['first', 'middle', 'last', 10, 999].map(f => lottieToSvg([{ name: 'box.tgs', data: tgs }], f as never).then(r => r[0])))
  for (const r of [first, middle, last, n, past]) assert.ok('svg' in r, JSON.stringify(r))
  const f = first as Extract<typeof first, { svg: string }>
  assert.match(f.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.equal((f.svg.match(/xmlns="/g) ?? []).length, 1)
  assert.match(f.svg, /width="512" height="512"/)
  assert.doesNotMatch(f.svg.slice(0, 300), /style="width/, 'not the player\'s box styles')
  assert.deepEqual([first, middle, last, n, past].map(r => 'svg' in r && r.frame), [0, 30, 59, 10, 59])
  assert.equal(f.frames, 60)
  assert.ok(x(f.svg) < x((middle as typeof f).svg) && x((middle as typeof f).svg) < x((last as typeof f).svg), 'the square moved')
})

// A 1×1 PNG, for an image the archive carries
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const withImage = {
  ...lottie,
  assets: [{ id: 'img_0', w: 1, h: 1, u: '/images/', p: 'img_0.png', e: 0 }],
  layers: [{ ddd: 0, ind: 1, ty: 2, nm: 'pic', refId: 'img_0', sr: 1, ip: 0, op: 60, st: 0, bm: 0, ks: lottie.layers[0].ks }],
}

test('every Lottie: TGS, JSON with or without a BOM, dotLottie v1 and v2, the name of each kept', async () => {
  const json = Buffer.from(JSON.stringify(lottie))
  const v1 = zip([{ path: 'manifest.json', data: Buffer.from('{"version":"1.0.0","animations":[{"id":"main"}]}') }, { path: 'animations/main.json', data: json }])
  const v2 = zip([{ path: 'manifest.json', data: Buffer.from('{"version":"2","animations":[{"id":"a1"},{"id":"a2"}]}') }, { path: 'a/a1.json', data: json }, { path: 'a/a2.json', data: json }])
  const out = await lottieToSvg([
    { name: 'sticker.tgs', data: tgs },
    { name: 'anim.json', data: json },
    { name: 'bom.json', data: Buffer.concat([Buffer.from('﻿'), json]) },
    { name: 'russia.lottie.json', data: json },
    { name: 'one.lottie', data: v1 },
    { name: 'two.lottie', data: v2 },
  ])
  assert.deepEqual(out.map(o => [o.name, 'svg' in o]), [['sticker', true], ['anim', true], ['bom', true], ['russia', true], ['one', true], ['two-a1', true], ['two-a2', true]])
})

test('images a .lottie carries are drawn from inside it; ones a JSON points outside to are named as left out', async () => {
  const pack = (dir: string) => zip([{ path: 'manifest.json', data: Buffer.from('{"animations":[{"id":"x"}]}') }, { path: `${dir === 'i' ? 'a' : 'animations'}/x.json`, data: Buffer.from(JSON.stringify(withImage)) }, { path: `${dir}/img_0.png`, data: PNG }])
  const [v1, v2, outside] = await lottieToSvg([{ name: 'v1.lottie', data: pack('images') }, { name: 'v2.lottie', data: pack('i') }, { name: 'out.json', data: Buffer.from(JSON.stringify(withImage)) }])
  for (const r of [v1, v2]) {
    assert.ok('svg' in r && r.svg.includes(`data:image/png;base64,${PNG.toString('base64')}`), JSON.stringify(r).slice(0, 200))
    assert.equal('svg' in r && r.note, undefined)
  }
  assert.ok('svg' in outside)
  assert.equal('svg' in outside && outside.note, '1 image(s) live outside the file and are left out')
})

test('a Lottie file sent to the chat is told in one line, not pasted in as JSON', () => {
  assert.equal(lottieSummary('anim.json', Buffer.from(JSON.stringify(lottie))), '[A Lottie animation: 512×512, 60 frames at 60 fps. lottie_to_svg turns its frames into SVG files.]')
  assert.equal(lottieSummary('sticker.tgs', tgs), '[A Lottie animation: 512×512, 60 frames at 60 fps. lottie_to_svg turns its frames into SVG files.]')
  assert.equal(lottieSummary('package.json', Buffer.from('{"name":"x"}')), null, 'other JSON stays as it was')
  assert.equal(lottieSummary('notes.txt', Buffer.from('hello')), null)
})

test('what is not a Lottie says so, and the rest of the batch still comes out', async () => {
  const out = await lottieToSvg([
    { name: 'plain.txt', data: Buffer.from('hello') },
    { name: 'json.tgs', data: gzipSync('{"a":1}') },
    { name: 'ok.tgs', data: tgs },
  ])
  assert.deepEqual(out.map(o => ('error' in o ? o.error : 'ok')), ['not a Lottie file (TGS, JSON or .lottie)', 'not a Lottie animation', 'ok'])
  assert.equal(typeof (globalThis as { window?: unknown }).window, 'undefined', 'the DOM stays in its thread')
})

test('file names: the sticker\'s own, made safe, as .svg', () => {
  assert.equal(svgName('fire.tgs'), 'fire.svg')
  assert.equal(svgName('emoji-5368324170671202286'), 'emoji-5368324170671202286.svg')
  assert.equal(svgName('../a:b*c.TGS'), '.._a_b_c.svg')
})

test('a zip of the files opens again as they were', () => {
  const files = [{ path: 'a.svg', data: Buffer.from('<svg/>') }, { path: 'папка/б.svg', data: Buffer.alloc(5000, 65) }]
  assert.deepEqual(unzip(zip(files), { files: 10, bytes: 1e6 }), files)
})

test('custom emoji in a message reach Claude with their ids; plain text adds nothing', () => {
  const text = 'вот 🔥 и 😀'
  assert.equal(customEmojiNote(text, [{ type: 'custom_emoji', offset: 4, length: 2, custom_emoji_id: '5368324170671202286' }, { type: 'bold', offset: 0, length: 3 }]),
    '[Custom emoji in this message, by their Telegram ids (lottie_to_svg takes them): 🔥 5368324170671202286]')
  assert.equal(customEmojiNote(text, [{ type: 'bold', offset: 0, length: 3 }]), '')
  assert.equal(customEmojiNote(text), '')
})
