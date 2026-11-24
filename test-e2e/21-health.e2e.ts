import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { startStack, until, type Stack } from './support/stack.ts'

// The address a monitor checks, on the real server: on the port the computers use, and fed by the bot's own polling.
// Staleness is shortened here, from the two minutes it takes in real life

describe('/health', () => {
  let s: Stack
  let url = ''

  before(async () => {
    s = await startStack({ language: 'en', config: { healthStaleMs: 6000 } })
    await s.startServer()
    url = `http://127.0.0.1:${s.wsPort}`
  })
  after(() => s?.stop())

  test('200 with a short body: no version, id or token', async () => {
    const r = await until('the server', () => fetch(`${url}/health`).catch(() => null))
    assert.equal(r.status, 200)
    const body = await r.text()
    assert.equal(body, 'ok\n')
    assert.deepEqual([...r.headers.keys()].filter(k => /version|server|powered/i.test(k)), [])
  })

  test('HEAD works, and other addresses are as they were', async () => {
    assert.equal((await fetch(`${url}/health`, { method: 'HEAD' })).status, 200)
    assert.equal((await fetch(`${url}/nothing`)).status, 404)
    assert.equal((await fetch(`${url}/install/AAAA-AAAA/macos`)).status, 404)
  })

  test('polls that stop bring a 503, and polls that return bring the 200 back', async () => {
    const status = () => fetch(`${url}/health`).then(r => r.status)
    s.tg.dropPolling(true)
    await until('a 503', async () => (await status()) === 503, 15_000, 200)
    s.tg.dropPolling(false)
    await until('the 200 again', async () => (await status()) === 200, 20_000, 200)
  })

  test('the bot answers as usual beside it', async () => {
    const t = Date.now()
    s.send('/status')
    await s.reply(/Quiet mode/, { after: t })
  })
})
