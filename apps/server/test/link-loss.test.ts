import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { PROTOCOL_VERSION } from '@tgcv/protocol'
import { createGateway, whenOnline } from '../src/gateway.ts'
import { createDeviceRegistry, createPairing } from '../src/devices.ts'
import { setLang } from '../src/i18n.ts'

setLang('en')
const quiet = { info() {}, warn() {}, error() {}, debug() {} }

async function setup(opts: { linkGraceMs?: number, cancelWaitMs?: number, acceptTimeoutMs?: number } = {}) {
  const registry = createDeviceRegistry(join(mkdtempSync(join(tmpdir(), 'tgcv-link-')), 'devices.json'), new Map([['pc', 'secret']]))
  const gateway = createGateway({ port: 0, host: '127.0.0.1', registry, pairing: createPairing(), log: quiet, ...opts })
  const url = `ws://127.0.0.1:${await gateway.ready}/device`
  return { gateway, url, registry }
}

type Wire = { type: string, opId: string, deadline: number, tool: string }

// A device as the wire sees it, the way every agent installed so far behaves
async function device(gateway: ReturnType<typeof createGateway>, url: string, onMessage: (m: Wire, ws: WebSocket) => void = () => {}, { id = 'pc', key = 'secret' } = {}) {
  const ws = new WebSocket(url)
  ws.on('message', raw => {
    const m = JSON.parse(String(raw))
    if (m.type !== 'welcome') onMessage(m, ws)
  })
  await new Promise(r => ws.once('open', r))
  const online = new Promise(r => gateway.events.once('online', r))
  ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, deviceId: id, deviceName: 'PC', key, os: 'windows', shell: 'bash', projects: [] }))
  await online
  return ws
}
const event = (opId: string, state: string, extra: object = {}) => JSON.stringify({ type: 'op.event', opId, seq: 1, state, ...extra })
const command = { projectId: 'p', bindingVersion: 1, tool: 'run_command' as const, params: { command: 'sleep 100' } }
const offline = (gateway: ReturnType<typeof createGateway>) => new Promise(r => gateway.events.once('offline', r))
const settled = (p: Promise<unknown>) => Promise.race([p.then(() => true), new Promise(r => setTimeout(() => r(false), 30))])

test('a command under way waits through a lost link and is asked about on the new one', async () => {
  const { gateway, url } = await setup()
  let opId = ''
  const first = await device(gateway, url, (m, ws) => {
    opId = m.opId
    ws.send(event(m.opId, 'accepted'))
  })
  const out = gateway.request('pc', command)
  while (!opId) await new Promise(r => setTimeout(r, 5))
  const gone = offline(gateway)
  first.terminate()
  await gone
  assert.equal(await settled(out), false, 'it does not fail with the link')

  // How an agent answers: the same id comes again, and it replays what happened
  const asked: Wire[] = []
  const second = await device(gateway, url, (m, ws) => {
    asked.push(m)
    ws.send(event(m.opId, 'accepted'))
    ws.send(event(m.opId, 'done', { result: 'finished while away' }))
    ws.send(event(m.opId, 'done', { result: 'a second time' }))
  })
  assert.deepEqual(await out, { ok: true, result: 'finished while away' })
  assert.equal(asked[0].opId, opId)
  assert.equal(asked[0].tool, 'run_command')
  assert.ok(asked[0].deadline < Date.now(), 'a deadline long gone: nothing can start from this')
  second.terminate()
  gateway.close()
})

test('a computer that does not come back within the grace period leaves the outcome unknown', async () => {
  const { gateway, url } = await setup({ linkGraceMs: 30 })
  const first = await device(gateway, url, (m, ws) => {
    ws.send(event(m.opId, 'accepted'))
    setTimeout(() => ws.terminate(), 5)
  })
  const out = await gateway.request('pc', command)
  assert.equal(!out.ok && out.error.code, 'unknown')
  first.terminate()
  gateway.close()
})

test('a command with a longer limit of its own is waited for longer', async () => {
  const { gateway, url } = await setup({ linkGraceMs: 10 })
  await device(gateway, url, (m, ws) => {
    ws.send(event(m.opId, 'accepted'))
    setTimeout(() => ws.terminate(), 5)
  })
  const out = gateway.request('pc', { ...command, params: { command: 'sleep 100', timeoutSec: 60 } })
  await new Promise(r => setTimeout(r, 60))
  assert.equal(await settled(out), false, 'its 60 seconds are not up')
  gateway.close()
})

test('what the bot asks by itself fails with the link, as before: someone is looking at it', async () => {
  const { gateway, url } = await setup()
  await device(gateway, url, (_m, ws) => ws.terminate())
  const out = await gateway.request('pc', { projectId: '', bindingVersion: 0, tool: 'zones', params: {} })
  assert.equal(!out.ok && out.error.code, 'unknown')
  gateway.close()
})

test('a computer with no record of it says so: unknown, never run again', async () => {
  const { gateway, url } = await setup()
  await device(gateway, url, (m, ws) => {
    ws.send(event(m.opId, 'accepted'))
    setTimeout(() => ws.terminate(), 5)
  })
  const out = gateway.request('pc', command)
  await offline(gateway)
  const second = await device(gateway, url, (m, ws) => ws.send(event(m.opId, 'error', { error: { code: 'expired', message: 'The request arrived after it expired' } })))
  const end = await out
  assert.equal(!end.ok && end.error.code, 'unknown')
  assert.match(!end.ok ? end.error.message : '', /no record/)
  second.terminate()
  gateway.close()
})

test('an agent that says nothing to the question leaves it unknown instead of waiting for ever', async () => {
  const { gateway, url } = await setup({ acceptTimeoutMs: 30 })
  await device(gateway, url, (m, ws) => {
    ws.send(event(m.opId, 'accepted'))
    setTimeout(() => ws.terminate(), 5)
  })
  const out = gateway.request('pc', command)
  await offline(gateway)
  const second = await device(gateway, url)
  const end = await out
  assert.equal(!end.ok && end.error.code, 'unknown')
  second.terminate()
  gateway.close()
})

test('Stop while the computer is away answers at once, and the cancel reaches it when it is back', async () => {
  const { gateway, url } = await setup({ cancelWaitMs: 20 })
  await device(gateway, url, (m, ws) => {
    ws.send(event(m.opId, 'accepted'))
    setTimeout(() => ws.terminate(), 5)
  })
  const abort = new AbortController()
  const out = gateway.request('pc', command, abort.signal)
  await offline(gateway)
  abort.abort()
  const end = await out
  assert.equal(!end.ok && end.error.code, 'unknown')

  const got: { type: string }[] = []
  const second = await device(gateway, url, m => got.push(m))
  await new Promise(r => setTimeout(r, 30))
  assert.deepEqual(got.map(m => m.type), ['op.cancel'])
  second.terminate()
  gateway.close()
})

test('a computer unlinked from the bot is not waited for', async () => {
  const { gateway, url, registry } = await setup()
  const { id, key } = registry.register('Mac', 'macos')
  await device(gateway, url, (m, ws) => ws.send(event(m.opId, 'accepted')), { id, key })
  const out = gateway.request(id, command)
  await new Promise(r => setTimeout(r, 20))
  gateway.revoke(id)
  const end = await out
  assert.equal(!end.ok && end.error.code, 'unknown')
  gateway.close()
})

test('after a restart of the server: what is running is asked about and awaited, a computer away is waited for', async () => {
  const { gateway, url } = await setup()
  const out = gateway.askOp('pc', 'op-from-before', 'run_command', { limitMs: 5000 })
  assert.equal(await settled(out), false, 'the computer is not here yet')
  let finish!: () => void
  const ws = await device(gateway, url, (m, sock) => {
    assert.equal(m.opId, 'op-from-before')
    sock.send(event(m.opId, 'accepted'))
    finish = () => sock.send(event(m.opId, 'done', { result: 'built' }))
  })
  await new Promise(r => setTimeout(r, 30))
  assert.equal(await settled(out), false, 'still running: it goes on waiting')
  finish()
  assert.deepEqual(await out, { ok: true, result: 'built' })
  ws.terminate()
  gateway.close()
})

test('after a restart, a limit holds whatever the computer does, and shutting down ends what is open', async () => {
  const { gateway, url } = await setup()
  const ws = await device(gateway, url, (m, sock) => sock.send(event(m.opId, 'accepted')))
  const limited = await gateway.askOp('pc', 'a', 'run_command', { limitMs: 20 })
  assert.equal(!limited.ok && limited.error.code, 'unknown')
  const open = gateway.askOp('pc', 'b', 'run_command', { limitMs: 60_000 })
  gateway.close()
  const end = await open
  assert.equal(!end.ok && end.error.code, 'unknown')
  ws.terminate()
})

test('a call waits a moment for a computer away, and gives up when it stays away or the task stops', async () => {
  const events = new EventEmitter<{ online: [{ id: string }] }>()
  let here = false
  const g = { device: () => here, events } as never
  here = true
  assert.equal(await whenOnline(g, 'pc', 10), true, 'here already')
  here = false
  assert.equal(await whenOnline(g, 'pc', 10), false, 'stayed away')
  const back = whenOnline(g, 'pc', 5000)
  events.emit('online', { id: 'mac' })
  events.emit('online', { id: 'pc' })
  assert.equal(await back, true)
  const stop = new AbortController()
  const stopped = whenOnline(g, 'pc', 5000, stop.signal)
  stop.abort()
  assert.equal(await stopped, false)
  assert.equal(events.listenerCount('online'), 0, 'nothing left listening')
})
