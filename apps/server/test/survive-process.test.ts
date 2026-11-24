import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { connect, createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ToolResult } from '@tgcv/protocol'
import { createGateway } from '../src/gateway.ts'
import { createDeviceRegistry, createPairing } from '../src/devices.ts'

// The real agent, as a process of its own, on a temporary config with no apps and no MCP servers, and a real command. The
// link runs through a little proxy here that can be cut, and pointed at another gateway, as a restarted server would be

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const quiet = { info() {}, warn() {}, error() {}, debug() {} }
const base = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-survive-')))
const zone = join(base, 'zone')
mkdirSync(join(zone, 'game'), { recursive: true })
const registryFile = join(base, 'devices.json')
const keys = new Map([['survivor', 'secret']])

const until = async (ok: () => boolean, ms = 15_000) => {
  for (const end = Date.now() + ms; !ok() && Date.now() < end;) await new Promise(r => setTimeout(r, 20))
  assert.ok(ok(), 'timed out')
}

const makeGateway = async () => {
  const gateway = createGateway({ port: 0, host: '127.0.0.1', registry: createDeviceRegistry(registryFile, keys), pairing: createPairing(), log: quiet })
  return { gateway, port: await gateway.ready }
}

function proxy(firstUpstream: number) {
  let upstream = firstUpstream
  let up = true
  const open = new Set<Socket>()
  const server = createServer(client => {
    if (!up) return client.destroy()
    const remote = connect(upstream, '127.0.0.1')
    for (const s of [client, remote]) {
      open.add(s)
      s.on('error', () => {})
      s.on('close', () => {
        open.delete(s)
        client.destroy()
        remote.destroy()
      })
    }
    client.pipe(remote)
    remote.pipe(client)
  })
  return {
    listen: () => new Promise<number>(r => server.listen(0, '127.0.0.1', () => r((server.address() as { port: number }).port))),
    cut() {
      up = false
      for (const s of open) s.destroy()
    },
    restore(to = upstream) {
      upstream = to
      up = true
    },
    close() {
      for (const s of open) s.destroy()
      server.close()
    },
  }
}

// Writes a line when it starts and another when it ends, so a test sees when it ran and how many times
function command(name: string, ms: number) {
  const runs = join(base, `${name}.runs`)
  const done = join(base, `${name}.done`)
  const script = `const fs=require('fs');fs.appendFileSync(${JSON.stringify(runs)},'run\\n');setTimeout(()=>{fs.writeFileSync(${JSON.stringify(done)},'x');console.log('finished ${name}')},${ms})`
  return {
    params: { program: process.execPath, args: ['-e', script], cwd: '.', timeoutSec: 60 },
    started: () => existsSync(runs),
    finished: () => existsSync(done),
    runs: () => readFileSync(runs, 'utf8').trim().split('\n').length,
  }
}

const first = await makeGateway()
const link = proxy(first.port)
const linkPort = await link.listen()
const config = join(base, 'agent.config.json')
writeFileSync(config, JSON.stringify({
  serverUrl: `ws://127.0.0.1:${linkPort}/device`, deviceId: 'survivor', deviceKey: 'secret', deviceName: 'Survivor',
  mcpFromClaude: false, mcpServers: {}, apps: {}, zones: [{ path: zone }], shared: [], projects: [], browserProxyPort: 0, shell: 'bash',
}))
const agent = spawn(process.execPath, [join(ROOT, 'apps/agent/src/main.ts'), 'run'], {
  cwd: ROOT,
  env: { ...process.env, AGENT_CONFIG: config, AGENT_STATE: join(base, 'agent.state.json') },
  stdio: 'ignore',
  windowsHide: true,
})

after(() => {
  agent.kill()
  link.close()
  // Nothing else keeps this file's process from ending: gateways close with their tests
  setTimeout(() => process.exit(0), 200).unref()
})

const run = (gateway: typeof first.gateway, params: Record<string, unknown>, opId?: string) =>
  gateway.request('survivor', { projectId: 'game', bindingVersion: 1, tool: 'run_command', params }, undefined, opId)
const pendingStill = (p: Promise<unknown>) => Promise.race([p.then(() => false), new Promise<boolean>(r => setTimeout(() => r(true), 50))])

test('a command that finishes while the link is down is delivered once, after it comes back', { timeout: 60_000 }, async () => {
  await until(() => !!first.gateway.device('survivor'))
  const c = command('away', 1200)
  const out = run(first.gateway, c.params)
  await until(c.started)
  const gone = new Promise(r => first.gateway.events.once('offline', r))
  link.cut()
  await gone
  await until(c.finished)
  assert.equal(await pendingStill(out), true, 'it finished, and nobody has heard yet')

  link.restore()
  const end = await out
  assert.equal(end.ok, true, JSON.stringify(end))
  const r = (end as { result: ToolResult['run_command'] }).result
  assert.equal(r.exitCode, 0)
  assert.match(r.stdout, /finished away/)
  assert.equal(c.runs(), 1, 'it ran once')
})

test('a command still running when the link comes back reports by itself', { timeout: 60_000 }, async () => {
  await until(() => !!first.gateway.device('survivor'))
  const c = command('back', 2500)
  const out = run(first.gateway, c.params)
  await until(c.started)
  const gone = new Promise(r => first.gateway.events.once('offline', r))
  link.cut()
  await gone
  const back = new Promise(r => first.gateway.events.once('online', r))
  link.restore()
  await back
  assert.equal(c.finished(), false, 'the link came back first')
  const end = await out
  assert.equal(end.ok, true, JSON.stringify(end))
  assert.match((end as { result: ToolResult['run_command'] }).result.stdout, /finished back/)
  assert.equal(c.runs(), 1)
})

test('a server that restarts mid-command asks the computer, which never ran it twice', { timeout: 60_000 }, async () => {
  await until(() => !!first.gateway.device('survivor'))
  const finishedAway = command('restart-finished', 300)
  const stillRunning = command('restart-running', 4000)
  run(first.gateway, finishedAway.params, 'op-finished')
  run(first.gateway, stillRunning.params, 'op-running')
  await until(() => finishedAway.started() && stillRunning.started())

  // All the old server leaves behind is the operation ids
  link.cut()
  first.gateway.close()
  await until(finishedAway.finished)
  const second = await makeGateway()
  const back = new Promise(r => second.gateway.events.once('online', r))
  link.restore(second.port)
  await back

  const done = await second.gateway.askOp('survivor', 'op-finished', 'run_command', { limitMs: 20_000 })
  assert.equal(done.ok, true, JSON.stringify(done))
  assert.match((done as { result: ToolResult['run_command'] }).result.stdout, /finished restart-finished/)

  const running = second.gateway.askOp('survivor', 'op-running', 'run_command', { limitMs: 20_000 })
  assert.equal(await pendingStill(running), true, 'it goes on waiting for what still runs')
  const end = await running
  assert.equal(end.ok, true, JSON.stringify(end))
  assert.match((end as { result: ToolResult['run_command'] }).result.stdout, /finished restart-running/)
  assert.equal(finishedAway.runs(), 1)
  assert.equal(stillRunning.runs(), 1)

  const never = await second.gateway.askOp('survivor', 'op-never-seen', 'run_command', { limitMs: 20_000 })
  assert.equal(!never.ok && never.error.code, 'unknown')
  second.gateway.close()
})
