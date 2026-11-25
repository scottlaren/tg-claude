import { test } from 'node:test'
import assert from 'node:assert/strict'
import { darkWake, watchNaps } from '../src/nap.ts'

// As pmset printed them on a MacBook, 2026-11-25
const AWAKE = 'Current System Capabilities are: CPU Graphics Audio Network \nCurrent Power State: 4\n'
const DARK = 'Current System Capabilities are: CPU Network \nCurrent Power State: 4\n'
const FALLING = 'Current System Capabilities are: CPU Network \nCurrent Power State: 4\nDesired State: 2\nSystem State is changing to Sleep\n'
const RISING = 'Current System Capabilities are: CPU Network \nCurrent Power State: 2\nDesired State: 4\n'

test('a wake with no screen is told from a real one; what can\'t be read is not a sleep', () => {
  assert.equal(darkWake(AWAKE), false)
  for (const s of [DARK, FALLING, RISING]) assert.equal(darkWake(s), true)
  assert.equal(darkWake(''), false)
  assert.equal(darkWake('pmset: command not found'), false)
  assert.equal(darkWake('Graphics'), false)
})

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const until = async (ok: () => boolean) => {
  for (const end = Date.now() + 3000; !ok() && Date.now() < end;) await sleep(5)
  assert.ok(ok(), 'in time')
}

test('the lid closes: resting after two looks that agree, and awake again the same way', async () => {
  let now = AWAKE
  const said: boolean[] = []
  const stop = watchNaps(r => void said.push(r), { platform: 'darwin', every: 10, restingEvery: 5, read: async () => now })
  await sleep(60)
  assert.deepEqual(said, [], 'awake: nothing to say')
  now = DARK
  await until(() => said.length === 1)
  assert.deepEqual(said, [true])
  now = RISING
  await sleep(40)
  assert.deepEqual(said, [true], 'waking is not awake yet')
  now = AWAKE
  await until(() => said.length === 2)
  assert.deepEqual(said, [true, false])
  stop()
})

test('one odd look changes nothing, and neither does a pmset that fails', async () => {
  const looks = [AWAKE, DARK, AWAKE, AWAKE, 'fail', DARK, 'fail', AWAKE, AWAKE]
  let i = 0
  const said: boolean[] = []
  const stop = watchNaps(r => void said.push(r), {
    platform: 'darwin', every: 5, restingEvery: 5,
    read: async () => {
      const s = looks[Math.min(i++, looks.length - 1)]
      if (s === 'fail') throw new Error('pmset timed out')
      return s
    },
  })
  await until(() => i >= looks.length + 2)
  assert.deepEqual(said, [])
  stop()
})

test('only a Mac is watched', async () => {
  let reads = 0
  const stop = watchNaps(() => {}, { platform: 'win32', every: 5, read: async () => { reads++; return DARK } })
  await sleep(40)
  assert.equal(reads, 0)
  stop()
})
