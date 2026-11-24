import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { createServer, connect } from 'node:net'
import { PROTOCOL_VERSION, type OpRequest } from '@tgcv/protocol'
import { createGateway } from '../src/gateway.ts'
import { createDeviceRegistry, createPairing } from '../src/devices.ts'
import { createExecutor } from '../../agent/src/executor.ts'
import { startClient } from '../../agent/src/client.ts'
import { setLang } from '../src/i18n.ts'

const quiet = { info() {}, warn() {}, error() {}, debug() {} }
const nolog = () => {}

async function setup({ cancelWaitMs = 500 } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-gw-')))
  writeFileSync(join(root, 'hello.txt'), 'hi from device\n')
  const registry = createDeviceRegistry(join(root, 'devices.json'), new Map([['pc', 'secret']]))
  const pairing = createPairing()
  const gateway = createGateway({ port: 0, host: '127.0.0.1', registry, pairing, log: quiet, cancelWaitMs, linkGraceMs: 50 })
  const port = await gateway.ready
  return { root, gateway, registry, pairing, url: `ws://127.0.0.1:${port}/device` }
}

const online = (gw: ReturnType<typeof createGateway>) => new Promise(r => gw.events.once('online', r))

// One message out, the first message back
async function exchange(url: string, msg: object) {
  const ws = new WebSocket(url)
  await new Promise(r => ws.once('open', r))
  ws.send(JSON.stringify(msg))
  const reply = JSON.parse(String(await new Promise(r => ws.once('message', r))))
  return { ws, reply }
}
const hello = (deviceId: string, key: string) =>
  ({ type: 'hello', protocol: PROTOCOL_VERSION, deviceId, deviceName: deviceId, key, os: 'macos', shell: 'zsh', projects: [] })

test('a new computer pairs with a one-time code, then connects with its own key', async () => {
  const { gateway, pairing, url } = await setup()
  const { code } = pairing.create(42)
  const paired = new Promise(r => gateway.events.once('paired', r))
  const { reply } = await exchange(url, { type: 'pair', protocol: PROTOCOL_VERSION, code: code.toLowerCase(), deviceName: 'MacBook Pro', os: 'macos' })
  assert.equal(reply.type, 'paired')
  assert.equal(reply.deviceId, 'macbook-pro')
  assert.deepEqual(await paired, { id: 'macbook-pro', name: 'MacBook Pro', os: 'macos', chatId: 42, topicId: undefined })

  // Single use
  const again = await exchange(url, { type: 'pair', protocol: PROTOCOL_VERSION, code, deviceName: 'Intruder', os: 'linux' })
  assert.equal(again.reply.type, 'reject')

  const { ws, reply: welcome } = await exchange(url, hello(reply.deviceId, reply.key))
  assert.equal(welcome.type, 'welcome')
  ws.terminate()
  gateway.close()
})

test('the name given in the bot outlives what the computer calls itself, and goes when it is unlinked', async () => {
  const { gateway, pairing, registry, url } = await setup()
  const { code } = pairing.create(42)
  const { reply } = await exchange(url, { type: 'pair', protocol: PROTOCOL_VERSION, code, deviceName: 'MacBook-Pro-Scott', os: 'macos' })
  const first = await exchange(url, hello(reply.deviceId, reply.key))
  assert.equal(gateway.device(reply.deviceId)?.name, reply.deviceId, 'its own name so far')

  assert.equal(gateway.rename(reply.deviceId, 'Mac'), true)
  assert.equal(gateway.device(reply.deviceId)?.name, 'Mac', 'online, at once')
  assert.equal(registry.list().find(r => r.id === reply.deviceId)?.name, 'Mac', 'and while offline')
  first.ws.terminate()

  const back = await exchange(url, hello(reply.deviceId, reply.key))
  assert.equal(back.reply.type, 'welcome')
  assert.equal(gateway.device(reply.deviceId)?.name, 'Mac', 'its hello does not overwrite it')
  assert.equal(gateway.rename('nobody', 'x'), false)

  gateway.revoke(reply.deviceId)
  assert.equal(registry.nameOf(reply.deviceId), undefined)
  gateway.close()
})

test('a revoked computer is cut off and its key stops working', async () => {
  const { gateway, pairing, url } = await setup()
  const { reply } = await exchange(url, { type: 'pair', protocol: PROTOCOL_VERSION, code: pairing.create(1).code, deviceName: 'Mac', os: 'macos' })
  const { ws } = await exchange(url, hello(reply.deviceId, reply.key))
  const closed = new Promise(r => ws.once('close', r))
  assert.equal(gateway.revoke(reply.deviceId), true)
  await closed
  const after = await exchange(url, hello(reply.deviceId, reply.key))
  assert.equal(after.reply.type, 'reject')
  gateway.close()
})

test('two computers with the same name get different ids', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-reg-')))
  const reg = createDeviceRegistry(join(root, 'devices.json'), new Map([['macbook', 'k']]))
  assert.equal(reg.register('MacBook', 'macos').id, 'macbook-2')
  assert.equal(reg.register('MacBook', 'macos').id, 'macbook-3')
  assert.deepEqual(reg.list().map(d => d.id).sort(), ['macbook', 'macbook-2', 'macbook-3'])
})

test('wrong codes in a burst stop guessing for a while, but anyone online must not lock out a real code', () => {
  let t = 0
  const p = createPairing({ now: () => t })
  for (let i = 0; i < 10; i++) assert.equal(p.consume('WRONG-CODE'), null)
  assert.equal(p.consume('WRONG-CODE'), 'locked')
  assert.equal(p.valid('WRONG-CODE'), 'locked')
  const { code } = p.create(1)
  assert.equal(p.valid(code), true)
  assert.deepEqual(p.consume(code), { chatId: 1, topicId: undefined })
  assert.equal(p.consume(code), 'locked', 'spent, and still in the burst')
  t += 11 * 60_000
  assert.equal(p.consume(code), null)
})

test('device with a wrong key is rejected', async () => {
  const { gateway, url } = await setup()
  const ws = new WebSocket(url)
  await new Promise(r => ws.once('open', r))
  ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, deviceId: 'pc', deviceName: 'PC', key: 'wrong', os: 'windows', shell: 'bash', projects: [] }))
  const reply = JSON.parse(String(await new Promise(r => ws.once('message', r))))
  assert.equal(reply.type, 'reject')
  assert.equal(gateway.devices().length, 0)
  gateway.close()
})

test('a request is routed to the device and the result comes back', async () => {
  const { root, gateway, url } = await setup()
  const projects = [{ id: 'demo', name: 'Demo', path: root, extraRoots: [] }]
  const client = startClient(
    { serverUrl: url, deviceId: 'pc', deviceKey: 'secret', deviceName: 'PC', shell: 'bash', projects, mcpServers: {}, apps: {}, zones: [], shared: [], browserProxyPort: 0 },
    createExecutor({ projects, shell: 'bash', log: nolog }), nolog,
  )
  await online(gateway)
  const out = await gateway.request('pc', { projectId: 'demo', bindingVersion: 1, tool: 'read_file', params: { path: 'hello.txt' } })
  assert.ok(out.ok)
  assert.deepEqual((out.result as { lines: string[] }).lines, ['hi from device', ''])

  const bad = await gateway.request('pc', { projectId: 'nope', bindingVersion: 1, tool: 'read_file', params: { path: 'x' } })
  assert.equal(!bad.ok && bad.error.code, 'unknown_project')

  const off = await gateway.request('mac', { projectId: 'demo', bindingVersion: 1, tool: 'read_file', params: { path: 'x' } })
  assert.equal(!off.ok && off.error.code, 'offline')
  client.stop()
  gateway.close()
})

test('stop cancels the command on the device and reports what really happened', async () => {
  // Killing a process tree on a busy Windows takes its time: the result here is the computer's, not this wait running out
  const { root, gateway, url } = await setup({ cancelWaitMs: 30_000 })
  const projects = [{ id: 'demo', name: 'Demo', path: root, extraRoots: [] }]
  const client = startClient(
    { serverUrl: url, deviceId: 'pc', deviceKey: 'secret', deviceName: 'PC', shell: 'bash', projects, mcpServers: {}, apps: {}, zones: [], shared: [], browserProxyPort: 0 },
    createExecutor({ projects, shell: 'bash', log: nolog }), nolog,
  )
  await online(gateway)
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 300)
  const out = await gateway.request('pc', {
    projectId: 'demo', bindingVersion: 1, tool: 'run_command',
    params: { program: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'] },
  }, ac.signal)
  // The device's own final event, not a guess made on the server
  assert.ok(out.ok)
  assert.equal((out.result as { cancelled: boolean }).cancelled, true)
  client.stop()
  gateway.close()
})

test('a device that never confirms the cancel leaves the outcome unknown', async () => {
  const { gateway, url } = await setup()
  const ws = new WebSocket(url)
  await new Promise(r => ws.once('open', r))
  ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, deviceId: 'pc', deviceName: 'PC', key: 'secret', os: 'windows', shell: 'bash', projects: [] }))
  await online(gateway)
  ws.on('message', raw => {
    const m = JSON.parse(String(raw))
    if (m.type === 'op.request') ws.send(JSON.stringify({ type: 'op.event', opId: m.opId, seq: 1, state: 'accepted' }))
  })
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 100)
  const out = await gateway.request('pc', { projectId: 'demo', bindingVersion: 1, tool: 'run_command', params: { command: 'sleep 60' } }, ac.signal)
  assert.equal(!out.ok && out.error.code, 'unknown')
  ws.terminate()
  gateway.close()
})

test('the executor replays a repeated operation instead of running it twice', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-dup-')))
  const projects = [{ id: 'demo', name: 'Demo', path: root, extraRoots: [] }]
  const ex = createExecutor({ projects, shell: 'bash', log: nolog })
  const req: OpRequest = {
    type: 'op.request', opId: 'op-1', projectId: 'demo', bindingVersion: 1, tool: 'write_file',
    params: { path: 'once.txt', content: 'x' }, deadline: Date.now() + 10000,
  }
  const first: unknown[] = []
  await ex.handle(req, e => first.push(e))
  const second: unknown[] = []
  await ex.handle(req, e => second.push(e))
  // A second real write would fail with "exists"; the replay returns the original success
  assert.deepEqual(second, first)
  assert.equal((first.at(-1) as { state: string }).state, 'done')
})

test('an expired request is not executed', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-exp-')))
  const ex = createExecutor({ projects: [{ id: 'demo', name: 'Demo', path: root, extraRoots: [] }], shell: 'bash', log: nolog })
  const events: { state: string, error?: { code: string } }[] = []
  await ex.handle({
    type: 'op.request', opId: 'old', projectId: 'demo', bindingVersion: 1, tool: 'write_file',
    params: { path: 'late.txt', content: 'x' }, deadline: Date.now() - 1,
  }, e => events.push(e))
  assert.equal(events[0].error?.code, 'expired')
})

test('a connection lost mid-operation gives an unknown result, not a retry', async () => {
  const { gateway, url } = await setup()
  const ws = new WebSocket(url)
  await new Promise(r => ws.once('open', r))
  ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, deviceId: 'pc', deviceName: 'PC', key: 'secret', os: 'windows', shell: 'bash', projects: [] }))
  await online(gateway)
  // Fake device: confirms the operation, then drops off
  ws.on('message', raw => {
    const m = JSON.parse(String(raw))
    if (m.type !== 'op.request') return
    ws.send(JSON.stringify({ type: 'op.event', opId: m.opId, seq: 1, state: 'accepted' }))
    setTimeout(() => ws.terminate(), 50)
  })
  const out = await gateway.request('pc', { projectId: 'demo', bindingVersion: 1, tool: 'run_command', params: { command: 'sleep 5' } })
  assert.equal(!out.ok && out.error.code, 'unknown')
  gateway.close()
})

test('a request the device may have got before the link dropped is unknown, never «not done»', async () => {
  const { gateway, url } = await setup()
  const ws = new WebSocket(url)
  await new Promise(r => ws.once('open', r))
  ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, deviceId: 'pc', deviceName: 'PC', key: 'secret', os: 'windows', shell: 'bash', projects: [], mcp: [], apps: [], shared: [] }))
  await new Promise(r => ws.once('message', r)) // welcome
  // The device gets the request and the link drops before its «accepted» reaches the server
  ws.once('message', () => ws.terminate())
  try {
    const out = await gateway.request('pc', { projectId: 'demo', bindingVersion: 1, tool: 'write_file', params: { path: 'x.txt', content: 'x' } })
    assert.equal(!out.ok && out.error.code, 'unknown')
  } finally {
    gateway.close()
  }
})

test('a request the computer never confirms is «unknown», not «not done»: it may have run, its clock or a busy link may lag', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-gw-acc-')))
  const registry = createDeviceRegistry(join(root, 'devices.json'), new Map([['pc', 'secret']]))
  const gateway = createGateway({ port: 0, host: '127.0.0.1', registry, pairing: createPairing(), log: quiet, acceptTimeoutMs: 200 })
  try {
    const url = `ws://127.0.0.1:${await gateway.ready}/device`
    // Connected, but it never says «accepted»
    const { ws } = await exchange(url, hello('pc', 'secret'))
    const out = await gateway.request('pc', { projectId: '', bindingVersion: 0, tool: 'list_projects', params: {} })
    assert.equal(!out.ok && out.error.code, 'unknown')
    assert.doesNotMatch(!out.ok ? out.error.message : '', /not (run|done|executed)/)
    ws.terminate()
  } finally {
    gateway.close()
  }
})

test('an oversized message, even before hello, closes only that connection and the server lives on', async () => {
  const { gateway, url } = await setup()
  try {
    const big = new WebSocket(url)
    await new Promise(r => big.once('open', r))
    const closed = new Promise(r => big.once('close', r))
    big.send(Buffer.alloc(8 * 1024 * 1024 + 1))
    await closed
    // Still serving: a computer connects fine afterwards
    const { reply, ws } = await exchange(url, hello('pc', 'secret'))
    assert.equal(reply.type, 'welcome')
    ws.terminate()
  } finally {
    gateway.close()
  }
})

test('the tunnel limit counts connections still being opened', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-gw-lim-')))
  const registry = createDeviceRegistry(join(root, 'devices.json'), new Map([['pc', 'secret']]))
  const site = createServer(s => s.end())
  await new Promise<void>(r => site.listen(0, '127.0.0.1', () => r()))
  const sitePort = (site.address() as { port: number }).port
  // Opening takes a while, so both requests arrive before either is through
  const dial = async () => {
    await new Promise(r => setTimeout(r, 100))
    const s = connect(sitePort, '127.0.0.1')
    await new Promise(r => s.once('connect', r))
    return s
  }
  const gateway = createGateway({ port: 0, host: '127.0.0.1', registry, pairing: createPairing(), log: quiet, tunnel: { dial, maxStreams: 1 } })
  try {
    const { ws } = await exchange(`ws://127.0.0.1:${await gateway.ready}/device`, hello('pc', 'secret'))
    const replies: { sid: number, ok: boolean }[] = []
    const both = new Promise<void>(resolve => ws.on('message', raw => {
      const m = JSON.parse(String(raw))
      if (m.type === 'tunnel.opened') replies.push(m)
      if (replies.length === 2) resolve()
    }))
    ws.send(JSON.stringify({ type: 'tunnel.open', sid: 1, host: 'example.com', port: 443 }))
    ws.send(JSON.stringify({ type: 'tunnel.open', sid: 2, host: 'example.com', port: 443 }))
    await both
    assert.equal(replies.filter(r => r.ok).length, 1)
    assert.equal(gateway.tunnels().open, 1)
    ws.terminate()
  } finally {
    gateway.close()
    site.close()
  }
})

test('the id of an unlinked computer is never given to a new one: old topics must not run on a stranger', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-reg-rv-')))
  const file = join(root, 'devices.json')
  const reg = createDeviceRegistry(file)
  assert.equal(reg.register('Laptop', 'windows').id, 'laptop')
  assert.equal(reg.revoke('laptop'), true)
  assert.equal(reg.register('Laptop', 'macos').id, 'laptop-2')
  // Remembered across a restart too
  assert.equal(createDeviceRegistry(file).register('Laptop', 'linux').id, 'laptop-3')
  assert.deepEqual(createDeviceRegistry(file).list().map(d => d.id).sort(), ['laptop-2', 'laptop-3'])
})

test('the server asks a computer to update itself, and a computer it turns away hears the server\'s release', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-gw-upd-')))
  const registry = createDeviceRegistry(join(root, 'devices.json'), new Map([['pc', 'secret']]))
  const gateway = createGateway({ port: 0, host: '127.0.0.1', registry, pairing: createPairing(), log: quiet, release: '0.3.0' })
  const url = `ws://127.0.0.1:${await gateway.ready}/device`
  const asked: string[] = []
  const executor = createExecutor({ shell: 'bash', log: nolog, selfUpdate: async tag => (asked.push(tag), { ok: true, from: '0.2.0', to: tag.slice(1) }) })
  const base = { serverUrl: url, deviceId: 'pc', deviceKey: 'secret', deviceName: 'PC', shell: 'bash', projects: [], mcpServers: {}, apps: {}, zones: [], shared: [], browserProxyPort: 0 }
  const client = startClient(base, executor, nolog)
  try {
    const dev = await online(gateway) as { release?: string }
    assert.match(dev.release ?? '', /^\d+\.\d+\.\d+$/)
    const out = await gateway.request('pc', { projectId: '', bindingVersion: 0, tool: 'self_update', params: { tag: 'v0.3.0' } })
    assert.deepEqual(out, { ok: true, result: { ok: true, from: '0.2.0', to: '0.3.0' } })
    assert.deepEqual(asked, ['v0.3.0'])
    // A wrong key: turned away, told which release the server runs
    const rejected = new Promise<string | undefined>(resolve => startClient({ ...base, deviceKey: 'wrong' }, executor, nolog, undefined, undefined, undefined, (_r, release) => resolve(release)))
    assert.equal(await rejected, '0.3.0')
  } finally {
    client.stop()
    gateway.close()
  }
})

test('the cloud goes by its name in the bot\'s language, whatever its agent calls itself', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-cloud-')))
  const registry = createDeviceRegistry(join(root, 'devices.json'), new Map([['cloud', 'ck']]))
  const gateway = createGateway({ port: 0, host: '127.0.0.1', registry, pairing: createPairing(), log: quiet })
  const url = `ws://127.0.0.1:${await gateway.ready}/device`
  const up = online(gateway)
  const { ws } = await exchange(url, { ...hello('cloud', 'ck'), deviceName: 'Cloud', os: 'linux', shell: 'bash' })
  await up
  try {
    assert.equal(gateway.device('cloud')?.name, 'Cloud')
    setLang('ru')
    assert.equal(gateway.device('cloud')?.name, 'Облако')
    assert.equal(gateway.devices()[0].name, 'Облако')
  } finally {
    setLang('en')
    ws.close()
    gateway.close()
  }
})

test('a stream of refusals leaves one line in the log, not one each', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-gw-')))
  const lines: unknown[][] = []
  const registry = createDeviceRegistry(join(root, 'devices.json'))
  const gateway = createGateway({ port: 0, host: '127.0.0.1', registry, pairing: createPairing(), log: { ...quiet, warn: (...a: unknown[]) => lines.push(a) } as never })
  const url = `ws://127.0.0.1:${await gateway.ready}/device`
  for (let i = 0; i < 5; i++) {
    const { ws, reply } = await exchange(url, hello('nobody', 'wrong'))
    assert.equal(reply.type, 'reject', 'each is still told')
    ws.close()
  }
  const { ws, reply } = await exchange(url, { type: 'pair', protocol: PROTOCOL_VERSION, code: 'WRONGWRONG', deviceName: 'x', os: 'macos' })
  assert.equal(reply.type, 'reject')
  ws.close()
  assert.equal(lines.length, 1)
  gateway.close()
})

test('a hello that comes as the link is closing is too late: the computer never shows online on it', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-gw-')))
  const registry = createDeviceRegistry(join(root, 'devices.json'), new Map([['pc', 'secret']]))
  const gateway = createGateway({ port: 0, host: '127.0.0.1', registry, pairing: createPairing(), log: quiet, helloTimeoutMs: 50 })
  const port = await gateway.ready
  let online = 0
  gateway.events.on('online', () => online++)
  const ws = new WebSocket(`ws://127.0.0.1:${port}/device`)
  await new Promise(r => ws.once('open', r))
  // Deaf to the server's close for now, as a computer whose hello is still on its way: it lands while the server closes
  const sock = (ws as unknown as { _socket: import('node:net').Socket })._socket
  sock.pause()
  await new Promise(r => setTimeout(r, 120))
  ws.send(JSON.stringify(hello('pc', 'secret')))
  await new Promise(r => setTimeout(r, 80))
  sock.resume()
  await Promise.race([new Promise(r => ws.once('close', r)), new Promise(r => setTimeout(r, 2000))])
  ws.terminate()
  assert.equal(online, 0)
  assert.equal(gateway.device('pc'), undefined)
  // In time, the same hello is taken
  const { ws: again, reply } = await exchange(`ws://127.0.0.1:${port}/device`, hello('pc', 'secret'))
  assert.equal(reply.type, 'welcome')
  assert.equal(online, 1)
  again.terminate()
  gateway.close()
})
