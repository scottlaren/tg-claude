import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { createHealth, POLL_STALE_MS } from '../src/health.ts'

const open: Server[] = []
after(() => { for (const s of open) s.close() })

async function serve(health: ReturnType<typeof createHealth>) {
  const server = createServer((req, res) => {
    if (!health.route(req, res)) res.writeHead(404).end()
  })
  open.push(server)
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
const poll = (h: ReturnType<typeof createHealth>, method = 'getUpdates', ok = true) =>
  (h.watch as unknown as (p: () => Promise<{ ok: boolean }>, m: string, x: unknown) => Promise<unknown>)(async () => ({ ok }), method, {})

test('200 while the bot polls, 503 after two minutes without, and back', async () => {
  let at = 1000
  const h = createHealth(() => at)
  const url = await serve(h)
  const status = async () => (await fetch(`${url}/health`)).status
  assert.equal(await status(), 200, 'just started')
  at += POLL_STALE_MS - 1
  assert.equal(await status(), 200)
  at += 1
  assert.equal(await status(), 503)
  await poll(h, 'sendMessage')
  assert.equal(await status(), 503, 'a sent message is not a poll')
  await poll(h, 'getUpdates', false)
  assert.equal(await status(), 503, 'nor is a poll that failed')
  await poll(h)
  assert.equal(await status(), 200)
})

test('it says only yes or no, and takes GET and HEAD at that one address', async () => {
  let at = 0
  const h = createHealth(() => at)
  const url = await serve(h)
  const ok = await fetch(`${url}/health?x=1`)
  assert.equal(await ok.text(), 'ok\n')
  assert.equal(ok.headers.get('cache-control'), 'no-store')
  const head = await fetch(`${url}/health`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  assert.equal((await fetch(`${url}/health`, { method: 'POST' })).status, 404)
  assert.equal((await fetch(`${url}/healthy`)).status, 404)
  at += POLL_STALE_MS
  const down = await fetch(`${url}/health`)
  assert.equal(down.status, 503)
  assert.equal(await down.text(), 'not polling\n')
  assert.equal((await fetch(`${url}/health`, { method: 'HEAD' })).status, 503)
})

test('Caddy passes every path to the server, /health among them', () => {
  const site = readFileSync(new URL('../../../deploy/Caddyfile', import.meta.url), 'utf8').split('{$DOMAIN} {')[1]
  assert.match(site, /^\s*reverse_proxy server:8787 \{/, 'the first thing in the site, with no matcher')
  assert.doesNotMatch(site, /\b(handle|route|respond|path)\b/)
})
