import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createInterface } from 'node:readline'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { helperBinary, macBackend, macScreenMissing, permissionHolder } from '../src/screen/mac.ts'
import { createScreen } from '../src/screen/index.ts'

// A helper that answers each request line with what `answer` makes of it, and records them
function fakeHelper(answer: (q: Record<string, unknown>) => object) {
  const asked: Record<string, unknown>[] = []
  const spawnHelper = () => {
    const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough()
    const p = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: () => p.emit('exit') })
    stdout.write('{"ready":true,"screen":true,"ax":false}\n')
    createInterface({ input: stdin }).on('line', l => {
      const q = JSON.parse(l)
      asked.push(q)
      stdout.write(`${JSON.stringify(answer(q))}\n`)
    })
    return p as unknown as ChildProcessWithoutNullStreams
  }
  return { asked, backend: macBackend({ cacheDir: '/nowhere', binary: async () => '/nowhere/mac-helper', spawnHelper, holder: () => "the agent's node (/opt/node)" }) }
}

test('no Swift compiler, no screen: the reason says how to get one, and xcrun is never asked without the tools', () => {
  const ran: string[] = []
  assert.match(macScreenMissing(cmd => { ran.push(cmd); throw new Error('no developer path') })!, /xcode-select --install/)
  assert.deepEqual(ran, ['xcode-select'])
  assert.equal(macScreenMissing(() => Buffer.from('')), null)
})

test('the helper is compiled once per source, under a temporary name, and older builds go', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-mac-'))
  try {
    const source = join(dir, 'helper.swift'), cache = join(dir, 'cache')
    let builds = 0
    const compile = async (_src: string, out: string) => { builds++; assert.match(out, /\.tmp$/); writeFileSync(out, 'bin') }
    writeFileSync(source, 'print(1)')
    const a = await helperBinary(cache, { source, compile })
    assert.equal(await helperBinary(cache, { source, compile }), a)
    assert.equal(builds, 1)
    writeFileSync(source, 'print(2)')
    const b = await helperBinary(cache, { source, compile })
    assert.notEqual(b, a)
    assert.deepEqual(readdirSync(cache), [basename(b)])
    writeFileSync(source, 'print(3)')
    await assert.rejects(helperBinary(cache, { source, compile: async (_s, out) => { writeFileSync(out, 'half'); throw new Error('error: bad') } }), /didn't compile: error: bad/)
    assert.deepEqual(readdirSync(cache), [basename(b)])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing permission names it, where to turn it on and for which app', async () => {
  const { backend } = fakeHelper(q => (q.op === 'elements' ? { need: 'ax' } : q.op === 'capture' ? { need: 'screen' } : { idle: 5 }))
  await assert.rejects(backend.elements(1, 10), /Accessibility is off for the agent's node \(\/opt\/node\).*Privacy & Security → Accessibility/)
  await assert.rejects(backend.capture(1, 0, 0, 10, 10, 100, 100), /Screen Recording is off.*Screen & System Audio Recording/)
  // The helper is still there for what needs no permission
  assert.equal(await backend.idle(), 5)
  backend.close()
})

test('the permission goes to what launchd started: the terminal app the agent runs in, else node', () => {
  const tree = (procs: Record<number, string>) => (pid: number) => procs[pid] ?? ''
  assert.equal(permissionHolder(tree({ 40: '30 /no/node', 30: '20 -zsh', 20: '1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal' }), 40),
    'Terminal (/System/Applications/Utilities/Terminal.app)')
  assert.equal(permissionHolder(tree({ 40: '30 /no/node', 30: '1 /no/agent/node/bin/node' }), 40), 'node (/no/agent/node/bin/node)')
})

test('one request per line in screen points; no virtual monitor, so nothing is parked', async () => {
  const win = { id: 3, title: 'Calculator', app: 'Calculator', x: 0, y: 0, w: 230, h: 400, minimized: false, focused: false }
  const { asked, backend } = fakeHelper(q => (q.op === 'windows' ? { windows: [win] } : { ok: true }))
  await backend.click(10, 20, 'left', 2)
  await backend.keys('cmd+s')
  assert.deepEqual(asked, [{ op: 'click', x: 10, y: 20, button: 'left', count: 2 }, { op: 'keys', keys: 'cmd+s' }])
  const r = await createScreen(backend).run({ window: 'calc', actions: [{ do: 'park' }], look: false })
  assert.match(r.log.join('\n'), /no virtual monitor/)
  assert.equal(asked.filter(q => q.op === 'monitor').length, 0)
  backend.close()
})
