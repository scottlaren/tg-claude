import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cgroup, createLoad, watchLoad } from '../src/load.ts'

// Two processors whose spent time the test moves by hand
function machine() {
  let spent = 0
  let at = 0
  const cpus = () => [0, 1].map(() => ({ times: { user: spent * 500, nice: 0, sys: 0, irq: 0 } }))
  return { cpus, now: () => at, spend: (coreSec: number, wallSec: number) => { spent += coreSec; at += wallSec * 1000 } }
}

test('a container counts its own share of processors and memory, and its own use', () => {
  const files: Record<string, string> = { '/cg/cpu.max': '400000 100000\n', '/cg/memory.max': String(6 * 1024 ** 3), '/cg/cpu.stat': 'usage_usec 12500000\nuser_usec 1\n' }
  const box = cgroup('/cg', f => files[f] ?? '')!
  assert.equal(box.cores, 4)
  assert.equal(box.memBytes, 6 * 1024 ** 3)
  assert.equal(box.busySec(), 12.5)
  assert.equal(cgroup('/cg', f => (f.endsWith('cpu.max') ? 'max 100000\n' : '')), null, 'no limit: the host\'s numbers are the truth')
  assert.equal(cgroup('/none', () => ''), null)
  const load = createLoad({ box, totalmem: () => 64 * 1024 ** 3 })
  assert.deepEqual(load.capacity, { cores: 4, memGb: 6 })
})

test('how busy: the share of all processors since the last look', () => {
  const m = machine()
  const load = createLoad({ box: null, cpus: m.cpus, totalmem: () => 32 * 1024 ** 3, now: m.now })
  assert.deepEqual(load.capacity, { cores: 2, memGb: 32 })
  m.spend(10, 10)
  assert.equal(load.busy(), 50)
  m.spend(0, 10)
  assert.equal(load.busy(), 0)
  m.spend(20, 10)
  assert.equal(load.busy(), 100)
})

test('what a command cost: commands running at the same moment share what was spent in it', () => {
  const m = machine()
  const load = createLoad({ box: null, cpus: m.cpus, totalmem: () => 1, now: m.now })
  const first = load.meter()
  m.spend(10, 5)
  const second = load.meter()
  m.spend(8, 4)
  assert.equal(first(), 14, 'ten alone, then half of eight')
  m.spend(6, 3)
  assert.equal(second(), 10, 'half of eight, then six alone')
  assert.equal(first(), 14, 'asked again: the same')
  m.spend(100, 50)
  assert.equal(load.meter()(), 0, 'what nobody ran is nobody\'s')
})

test('the server hears of a change worth knowing, not of every look', async () => {
  const sent: { busy: number, idleSec?: number }[] = []
  let busy = 20
  let idle: number | undefined = 30
  let at = 0
  const stop = watchLoad({ busy: () => busy }, m => void sent.push(m), { every: 5, idleSec: async () => idle, repeatMs: 1000, now: () => at })
  const tick = () => new Promise(r => setTimeout(r, 25))
  await tick()
  assert.deepEqual(sent, [{ busy: 20, idleSec: 30 }], 'the first look is said')
  busy = 26
  idle = 90
  await tick()
  assert.equal(sent.length, 1, 'a few points and a minute more at the keyboard change nothing')
  busy = 95
  await tick()
  assert.deepEqual(sent.at(-1), { busy: 95, idleSec: 90 })
  idle = 700
  await tick()
  assert.deepEqual(sent.at(-1), { busy: 95, idleSec: 700 }, 'the user left')
  idle = undefined
  await tick()
  assert.deepEqual(sent.at(-1), { busy: 95 }, 'not known is said as not known')
  const n = sent.length
  at = 2000
  await tick()
  assert.equal(sent.length, n + 1, 'and once in a while that it still holds')
  stop()
})
