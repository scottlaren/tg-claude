import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeIfSame, describeProcess, directCommand, sameProcess, type StartedProcess } from '../src/processes.ts'
import { createMcpHub } from '../src/mcp.ts'

const fixture = fileURLToPath(new URL('./fixtures/echo-mcp.ts', import.meta.url))
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const gone = async (pid: number) => {
  for (let i = 0; i < 50 && alive(pid); i++) await new Promise(r => setTimeout(r, 100))
  return !alive(pid)
}
const sleeper = () => {
  const p = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', windowsHide: true })
  p.unref()
  return p.pid!
}
const end = (pid: number) => { if (alive(pid)) process.kill(pid) }

const saved: StartedProcess = { pid: 500, name: 'StudioMCP.exe', started: 'morning' }

test('a process is closed only if it is still that very one', async () => {
  const killed: number[] = []
  const kill = (pid: number) => void killed.push(pid)
  const look = (over: Partial<StartedProcess> | null) => async () => (over ? { ...saved, ...over } : null)
  assert.equal(await closeIfSame(saved, look({}), kill), true)
  assert.deepEqual(killed, [500])
  killed.length = 0
  assert.equal(await closeIfSame(saved, look({ name: 'chrome.exe' }), kill), false, 'the number went to someone else')
  assert.equal(await closeIfSame(saved, look({ started: 'evening' }), kill), false, 'same name, a later process')
  assert.equal(await closeIfSame(saved, look(null), kill), false, 'already gone')
  for (const pid of [process.pid, 0, 4, -1, 1.5]) {
    assert.equal(await closeIfSame({ ...saved, pid }, async p => ({ ...saved, pid: p }), kill), false, `never ${pid}`)
  }
  assert.deepEqual(killed, [])
})

test('comparing processes looks at the number, the name and the start', () => {
  assert.equal(sameProcess(saved, { ...saved }), true)
  assert.equal(sameProcess(saved, null), false)
  assert.equal(sameProcess(saved, { ...saved, pid: 501 }), false)
})

test('a real process can be described and closed, and only it', async () => {
  const pid = sleeper()
  const other = sleeper()
  try {
    const me = await describeProcess(pid)
    assert.ok(me?.name && me.started)
    assert.equal(await closeIfSame({ ...me!, started: 'long ago' }), false)
    assert.ok(alive(pid), 'wrong start time: left alone')
    assert.equal(await closeIfSame(me!), true)
    assert.ok(await gone(pid))
    assert.ok(alive(other), 'nobody else was touched')
    assert.equal(await describeProcess(pid), null)
  } finally {
    end(pid)
    end(other)
  }
})

test('the bat of Roblox gives way to the exe it names', () => {
  const bat = '@echo off\nif exist "C:\\R\\v2\\StudioMCP.exe" ( "C:\\R\\v2\\StudioMCP.exe" %* ) else (\n"%%B/..\\StudioMCP.exe" %*\n)'
  const cfg = { command: 'cmd.exe', args: ['/c', '%LOCALAPPDATA%\\Roblox\\mcp.bat'] }
  const read = (p: string) => (p === 'C:\\L\\Roblox\\mcp.bat' ? bat : assert.fail(`read ${p}`))
  assert.deepEqual(directCommand(cfg, { LOCALAPPDATA: 'C:\\L' }, read, p => p === 'C:\\R\\v2\\StudioMCP.exe'), { command: 'C:\\R\\v2\\StudioMCP.exe', args: [] })
  assert.equal(directCommand(cfg, { LOCALAPPDATA: 'C:\\L' }, read, () => false), cfg, 'no such exe: as configured')
  assert.equal(directCommand(cfg, {}, () => { throw new Error('no file') }, () => true), cfg, 'no bat: as configured')
  const node = { command: 'node', args: ['server.js'] }
  assert.equal(directCommand(node), node)
  const noBat = { command: 'cmd', args: ['/c', 'run.cmd'] }
  assert.equal(directCommand(noBat), noBat)
})

test('the file remembers the server while it runs, and what the last run left goes at the start', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-mcp-left-'))
  const file = join(dir, 'pids.json')
  const left = sleeper()
  // On Linux a process changes its name right after it starts, when Node names its main thread
  await new Promise(r => setTimeout(r, 300))
  let hub: ReturnType<typeof createMcpHub> | undefined
  try {
    const me = await describeProcess(left)
    writeFileSync(file, JSON.stringify([me, { ...me, pid: process.pid }, { ...me, started: 'another run' }]))
    hub = createMcpHub({ app: { command: process.execPath, args: [fixture] } }, { log: () => {}, onChange: () => {}, pidsFile: file })
    await hub.swept
    assert.ok(await gone(left), 'the very process it left')
    assert.ok(alive(process.pid))
    await hub.call('app', 'echo', { text: 'x' }, new AbortController().signal)
    const running = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(running.length, 1)
    assert.notEqual(running[0].pid, process.pid)
    assert.ok(alive(running[0].pid))
    await hub.close()
    assert.ok(await gone(running[0].pid), 'closed with the hub')
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), [])
  } finally {
    end(left)
    // A failure above must not leave its server holding the test run open
    await hub?.close()
  }
})
