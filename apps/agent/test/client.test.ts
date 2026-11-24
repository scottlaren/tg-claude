import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { WebSocketServer } from 'ws'
import { startClient } from '../src/client.ts'

const cfg = (port: number) => ({ serverUrl: `ws://127.0.0.1:${port}`, deviceId: 'mac', deviceName: 'Mac', deviceKey: 'k', shell: 'bash', projects: [] }) as never
const until = async (ok: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; !ok() && Date.now() < end;) await new Promise(r => setTimeout(r, 20))
  return ok()
}

test('a connection that never answers is given up on, as after falling asleep in the middle of connecting', async () => {
  let connections = 0
  const sockets = new Set<import('node:net').Socket>()
  const server = createServer(s => {
    connections++
    sockets.add(s)
    s.on('error', () => {})
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as { port: number }
  const client = startClient(cfg(port), {} as never, () => {}, undefined, undefined, undefined, undefined, { handshakeMs: 150 })
  assert.ok(await until(() => connections >= 2), 'it tried again')
  client.stop()
  for (const s of sockets) s.destroy()
  server.close()
})

test('a refusal is tried again later, not never', async () => {
  let hellos = 0
  const refusals: string[] = []
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise(r => wss.once('listening', r))
  wss.on('connection', ws => ws.on('message', () => {
    hellos++
    ws.send(JSON.stringify({ type: 'reject', reason: 'the server is restarting' }))
  }))
  const { port } = wss.address() as { port: number }
  const client = startClient(cfg(port), {} as never, () => {}, undefined, undefined, undefined, r => void refusals.push(r), { rejectRetryMs: 100 })
  assert.ok(await until(() => hellos >= 2), 'it came back')
  assert.ok(refusals.length >= 1)
  client.stop()
  // Stopping stays stopping
  const seen = hellos
  await new Promise(r => setTimeout(r, 300))
  assert.equal(hellos, seen)
  wss.close()
})

test('the server hears of the lock in the hello, and of a change in a new one', async () => {
  const hellos: boolean[] = []
  const wss = new WebSocketServer({ port: 0 })
  wss.on('connection', ws => ws.on('message', raw => {
    const m = JSON.parse(String(raw))
    if (m.type === 'hello') hellos.push(m.locked)
  }))
  await new Promise(r => wss.once('listening', r))
  let locked = true
  const client = startClient(cfg((wss.address() as { port: number }).port), {} as never, () => {}, undefined, undefined, undefined, undefined, { locked: () => locked, lockWatchMs: 20 })
  try {
    assert.ok(await until(() => hellos.length === 1))
    assert.equal(hellos[0], true)
    await new Promise(r => setTimeout(r, 100))
    assert.equal(hellos.length, 1, 'no change, no new hello')
    locked = false
    assert.ok(await until(() => hellos.length === 2))
    assert.equal(hellos[1], false)
  } finally {
    client.stop()
    wss.close()
  }
})

test('the hello is small: the apps\' tools go after the welcome', async () => {
  const got: { type: string, mcp?: unknown, servers?: unknown[] }[] = []
  const wss = new WebSocketServer({ port: 0 })
  wss.on('connection', ws => ws.on('message', raw => {
    const m = JSON.parse(String(raw))
    got.push(m)
    if (m.type === 'hello') ws.send(JSON.stringify({ type: 'welcome', protocol: 4 }))
  }))
  await new Promise(r => wss.once('listening', r))
  const tools = [{ name: 'after-effects', status: 'connected', tools: [{ name: 'render', inputSchema: {} }] }] as never
  const client = startClient(cfg((wss.address() as { port: number }).port), {} as never, () => {}, () => tools)
  try {
    assert.ok(await until(() => got.length === 2))
    assert.equal(got[0].type, 'hello')
    assert.deepEqual(got[0].mcp, [])
    assert.equal(got[1].type, 'mcp.update')
    assert.equal(got[1].servers!.length, 1)
  } finally {
    client.stop()
    wss.close()
  }
})
