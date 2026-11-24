import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { startStack, pairCodeIn, until, sleep, type Stack } from './support/stack.ts'

// Stickers with the real server and agent: the files are on the computer, and the fake Telegram checks what it gets

const lottie = (over: object = {}) => JSON.stringify({ v: '5.5.2', w: 512, h: 512, fr: 60, ip: 0, op: 120, layers: [{ ty: 4 }], ...over })

describe('TGS and Lottie as stickers', () => {
  let s: Stack
  let thread = 0
  const writes = (files: Record<string, Buffer | string>) => `node -e "${Object.entries(files).map(([n, d]) => `require('fs').writeFileSync('${n}', Buffer.from('${Buffer.from(d).toString('base64')}', 'base64'))`).join(';')}"`
  const write = (files: Record<string, Buffer | string>) => ({ tool: 'mcp__device__run_command', input: { command: writes(files) } })

  before(async () => {
    s = await startStack({ language: 'en' })
    await s.startServer()
    const t = Date.now()
    s.send('/pair')
    const m = await s.reply(/install\//, { after: t })
    await s.pairAgent('E2E-PC', pairCodeIn(m)!, ['alpha'])
    await sleep(500)
    s.send('/topic Work')
    const picker = await until('a picker', () => s.tg.sent.find(x => x.thread && x.buttons.flat().some(b => b.text === 'alpha')))
    thread = picker.thread!
    await s.tap(picker, /^alpha$/)
    await s.reply(/alpha/, { thread })
    const c = Date.now()
    s.send('/mode', { thread })
    const card = await until('the mode card', () => s.tg.sent.find(x => x.touched >= c && x.thread === thread && x.buttons.flat().some(b => b.data === 'm:all')))
    await s.tap(card, 'm:all')
  })
  after(() => s?.stop())

  const inTopic = (t: number) => s.tg.sent.filter(m => m.touched >= t && m.thread === thread)

  test('a TGS and a Lottie arrive as stickers after the text, whose caption stays', async () => {
    const t = Date.now()
    s.send(`go ${s.script([write({ 'wave.tgs': gzipSync(lottie()), 'hop.json': lottie({ fr: 30, op: 60 }) }), { text: 'Here they are E2E\n\n![Waving](wave.tgs)\n\n![](hop.json)' }])}`, { thread })
    const text = await s.reply(/Here they are E2E/, { thread, after: t })
    const stickers = await until('two stickers', () => { const x = inTopic(t).filter(m => m.method === 'sendSticker'); return x.length === 2 ? x : null })
    assert.ok(stickers.every(m => m.media[0].kind === 'sticker'))
    assert.ok(text.message_id < stickers[0].message_id, 'after the text')
    assert.match(text.text, /Waving/, 'the caption stays')
    assert.doesNotMatch(text.text, /!\[[^\]]*\]\([^)]*(wave\.tgs|hop\.json)/, 'the link does not')
    assert.ok(stickers.every(m => !m.reply_to))
  })

  test('what does not fit comes as a file with the reason in words', async () => {
    const t = Date.now()
    s.send(`go ${s.script([write({ 'big.json': lottie({ w: 800, h: 600 }), 'long.tgs': gzipSync(lottie({ op: 600 })), 'pkg.json': '{"name":"x"}' }), { text: 'Not these E2E\n\n![](big.json)\n\n![](long.tgs)\n\n![](pkg.json)' }])}`, { thread })
    await s.reply(/Not these E2E/, { thread, after: t })
    const files = await until('three files', () => { const x = inTopic(t).filter(m => m.method === 'sendDocument'); return x.length === 3 ? x : null })
    assert.match(files[0].text, /Sent as a file, not a sticker: it is 800×600/)
    assert.match(files[1].text, /lasts 10 s/)
    assert.match(files[2].text, /isn't a Lottie/)
    assert.equal(inTopic(t).filter(m => m.method === 'sendSticker').length, 0)
  })

  test('a sticker Telegram turns down goes as a file; a missing one is said in the text', async () => {
    let t = Date.now()
    s.tg.failNext('sendSticker', 'Bad Request: STICKER_TGS_NOTGS')
    s.send(`go ${s.script([{ text: 'Refused E2E\n\n![](wave.tgs)' }])}`, { thread })
    await s.reply(/Refused E2E/, { thread, after: t })
    const file = await until('the file', () => inTopic(t).find(m => m.method === 'sendDocument'))
    assert.match(file.text, /Telegram turned it down/)

    t = Date.now()
    s.send(`go ${s.script([{ text: 'Gone E2E\n\n![](missing.tgs)' }])}`, { thread })
    const gone = await s.reply(/Gone E2E/, { thread, after: t })
    assert.match(gone.text, /Could not attach/)
  })

  test('send_file stays a file', async () => {
    const t = Date.now()
    s.send(`go ${s.script([{ tool: 'mcp__device__send_file', input: { path: 'wave.tgs' } }, { text: 'as a file E2E' }])}`, { thread })
    await s.reply(/as a file E2E/, { thread, after: t })
    assert.ok(inTopic(t).some(m => m.method === 'sendDocument'))
    assert.equal(inTopic(t).filter(m => m.method === 'sendSticker').length, 0)
  })

  test('findings: nothing the server would refuse', () => {
    assert.deepEqual(s.tg.findings, [])
  })
})
