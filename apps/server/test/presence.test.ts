import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPresence } from '../src/telegram/presence.ts'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Real timers at a tiny scale: stays count from 20 ms, away from 100 ms
function setup(bootGraceMs = 0) {
  const told: string[] = []
  let clock = 1000
  const p = createPresence({ notify: id => told.push(id), now: () => clock, stableMs: 20, awayMs: 100, bootGraceMs })
  return { p, told, pass: (ms: number) => { clock += ms } }
}

test('a computer that was off says so once it has stayed', async () => {
  const { p, told } = setup()
  p.online('mac')
  assert.deepEqual(told, [], 'not at the first moment')
  await sleep(40)
  assert.deepEqual(told, ['mac'])
})

test('a laptop waking for a moment says nothing, however often', async () => {
  const { p, told } = setup()
  for (let i = 0; i < 3; i++) {
    p.online('mac')
    await sleep(5)
    p.offline('mac')
  }
  await sleep(40)
  assert.deepEqual(told, [])
})

test('after a run of short wakes the stay that follows does say so', async () => {
  const { p, told, pass } = setup()
  p.online('mac')
  await sleep(40)
  told.length = 0
  p.offline('mac')
  pass(60)
  p.online('mac')
  await sleep(5)
  p.offline('mac')
  pass(60)
  p.online('mac')
  await sleep(40)
  assert.deepEqual(told, ['mac'], 'away from the moment it last stayed')
})

test('a short absence is no news: an update restarts the agent in a second', async () => {
  const { p, told, pass } = setup()
  p.online('pc')
  await sleep(40)
  told.length = 0
  p.offline('pc')
  pass(10)
  p.online('pc')
  await sleep(40)
  assert.deepEqual(told, [])
})

test('computers connecting again right after the server started are no news either', async () => {
  const { p, told, pass } = setup(1000)
  p.online('pc')
  await sleep(40)
  assert.deepEqual(told, [])
  // The next absence counts as usual
  p.offline('pc')
  pass(200)
  p.online('pc')
  await sleep(40)
  assert.deepEqual(told, ['pc'])
})
