import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import type { McpServerInfo } from '@tgcv/protocol'
import { createMcpHub } from '../src/mcp.ts'

const fixture = fileURLToPath(new URL('./fixtures/echo-mcp.ts', import.meta.url))
const nolog = () => {}
const signal = () => new AbortController().signal

async function hubWith(servers: Parameters<typeof createMcpHub>[0]) {
  let resolveReady: () => void
  const ready = new Promise<void>(r => (resolveReady = r))
  const hub = createMcpHub(servers, {
    log: nolog,
    onChange: () => {
      if (hub?.snapshot().every(s => s.status !== 'starting')) resolveReady()
    },
  })
  await ready
  return hub
}

const byName = (list: McpServerInfo[], name: string) => list.find(s => s.name === name)!

test('a broken app does not take the others down', async () => {
  const hub = await hubWith({
    app: { command: process.execPath, args: [fixture] },
    broken: { command: 'definitely-not-a-command-tgcv' },
  })
  const s = hub.snapshot()
  assert.equal(byName(s, 'app').status, 'connected')
  assert.equal(byName(s, 'app').version, '1.2.3')
  assert.equal(byName(s, 'broken').status, 'failed')
  assert.equal(byName(s, 'app').tools.find(t => t.name === 'echo')?.annotations?.readOnlyHint, true)

  const r = await hub.call('app', 'echo', { text: 'hi' }, signal())
  assert.deepEqual(r.content, [{ type: 'text', text: 'echo: hi' }])
  await assert.rejects(hub.call('broken', 'echo', {}, signal()), (e: { code: string }) => e.code === 'unavailable')
  await assert.rejects(hub.call('nope', 'echo', {}, signal()), (e: { code: string }) => e.code === 'not_found')
  await hub.close()
})

test('a hanging server restarted by the user: the hung call fails, the next one works, from a new process', async () => {
  const hub = await hubWith({ app: { command: process.execPath, args: [fixture] } })
  const pid = (await hub.call('app', 'pid', {}, signal())).content
  const hung = hub.call('app', 'hang', {}, signal())
  await new Promise(r => setTimeout(r, 200))
  assert.deepEqual(await hub.restart('app'), { restarted: true })
  await assert.rejects(hung)
  for (let i = 0; i < 100 && hub.info('app')?.status !== 'connected'; i++) await new Promise(r => setTimeout(r, 100))
  assert.notDeepEqual((await hub.call('app', 'pid', {}, signal())).content, pid)
  assert.deepEqual(await hub.restart('nope'), { restarted: false, error: 'No MCP server «nope» on this computer' })
  await hub.close()
})

test('calls to one app run one after another', async () => {
  const hub = await hubWith({ app: { command: process.execPath, args: [fixture] } })
  const [a, b] = await Promise.all([
    hub.call('app', 'slow', { tag: 'a' }, signal()),
    hub.call('app', 'slow', { tag: 'b' }, signal()),
  ])
  const ra = JSON.parse((a.content[0] as { text: string }).text)
  const rb = JSON.parse((b.content[0] as { text: string }).text)
  assert.ok(rb.start >= ra.end, 'second call started before the first ended')
  await hub.close()
})

test('a perTopic server gets its own process per topic, and keeps it', async () => {
  const hub = await hubWith({ studio: { command: process.execPath, args: [fixture], perTopic: true } })
  const pid = async (lane?: string) => (await hub.call('studio', 'pid', {}, signal(), lane)).content
    .map(c => (c as { text: string }).text).join('')
  const base = await pid()
  const a1 = await pid('chat:1')
  const b = await pid('chat:2')
  const a2 = await pid('chat:1')
  assert.equal(a1, a2)
  assert.notEqual(a1, b)
  assert.notEqual(a1, base)
  assert.equal(hub.lanes().length, 2)
  // The announced tool list stays the base instance's
  assert.equal(hub.snapshot().length, 1)
  await hub.close()
})

test("an app's own error comes back as its result, not as a transport failure", async () => {
  const hub = await hubWith({ app: { command: process.execPath, args: [fixture] } })
  const r = await hub.call('app', 'fail', {}, signal())
  assert.equal(r.isError, true)
  assert.deepEqual(r.content, [{ type: 'text', text: 'composition not found' }])
  await hub.close()
})

test('a server added from Telegram runs at once and outlasts a restart; removed, it is gone and stays gone', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createMcpManager } = await import('../src/mcp-manager.ts')
  const file = join(mkdtempSync(join(tmpdir(), 'tgcv-mcp-')), 'agent.mcp.json')
  let changes = 0
  const hub = createMcpHub({}, { log: nolog, onChange: () => changes++ })
  const manager = createMcpManager({ file, hub })
  const server = { name: 'echo', command: process.execPath, args: [fixture], env: { SECRET_THING: 'value' } }

  const added = await manager.add(server)
  assert.equal(added.status, 'connected')
  assert.ok(added.tools > 0)
  assert.ok(changes > 0, 'the server hears about it')
  assert.ok(hub.snapshot().some(s => s.name === 'echo'))
  const saved = () => JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(saved().mcpServers.echo, { command: process.execPath, args: [fixture], env: { SECRET_THING: 'value' } })

  await assert.rejects(manager.add(server), /already on this computer/)
  await assert.rejects(manager.add({ ...server, name: 'other', command: 'npx', args: ['-y', 'some-mcp@latest'] }), /exact version/)
  assert.ok(!saved().mcpServers.other, 'refused means not written')

  assert.deepEqual(await manager.remove({ name: 'echo' }), { removed: true })
  assert.deepEqual(hub.snapshot(), [])
  assert.ok(!saved().mcpServers.echo)
  assert.ok(saved().imported.includes('echo'), 'and it is not pulled in again')
  await assert.rejects(manager.remove({ name: 'echo' }), /No MCP server/)
  await hub.close()
})
