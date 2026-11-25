import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { awakeCommand, awakeDefault, createKeepAwake, holdsAfterWake, watchWakes } from '../src/keep-awake.ts'

// A pretend process: nothing on this computer is asked to stay awake
function stand(o: { platform?: NodeJS.Platform, on?: boolean, graceMs?: number } = {}) {
  const started: { cmd: string, args: string[] }[] = []
  const live: (EventEmitter & { killed: boolean })[] = []
  const saved: boolean[] = []
  const spawn = (cmd: string, args: string[]) => {
    started.push({ cmd, args })
    const p = Object.assign(new EventEmitter(), { killed: false, kill() { p.killed = true; p.emit('exit') } })
    live.push(p)
    return p as unknown as ChildProcess
  }
  const awake = createKeepAwake({ platform: o.platform ?? 'darwin', on: o.on ?? true, spawn, log: () => {}, graceMs: o.graceMs ?? 30, save: on => void saved.push(on) })
  return { awake, started, live, saved }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

test('awake while something runs, and a while after; one process however many run', async () => {
  const { awake, started, live } = stand()
  awake.hold()
  awake.hold()
  awake.release()
  assert.equal(started.length, 1)
  assert.equal(awake.state().active, true)
  awake.release()
  assert.equal(live[0].killed, false, 'not at once: Claude thinks between commands')
  awake.hold()
  await sleep(60)
  assert.equal(live[0].killed, false, 'the next command came in time')
  awake.release()
  await sleep(80)
  assert.equal(live[0].killed, true)
  assert.equal(awake.state().active, false)
})

test('off: nothing is started; turned on while something runs, it starts then', () => {
  const { awake, started, saved } = stand({ on: false })
  awake.hold()
  assert.equal(started.length, 0)
  awake.set(true)
  assert.equal(started.length, 1)
  assert.deepEqual(saved, [true])
})

test('turned off: its own process goes at once', () => {
  const { awake, live } = stand()
  awake.hold()
  awake.set(false)
  assert.equal(live[0].killed, true)
  assert.equal(awake.state().on, false)
})

test('a system with nothing to ask says so, and starts nothing', () => {
  const { awake, started } = stand({ platform: 'freebsd' })
  awake.hold()
  assert.equal(started.length, 0)
  assert.equal(awake.state().supported, false)
})

test('what is asked on each system, and the defaults', () => {
  assert.deepEqual(awakeCommand('darwin', 4321), ['caffeinate', ['-i', '-w', '4321']], 'ends with the agent')
  assert.equal(awakeCommand('win32', 4321)![0], 'powershell.exe')
  assert.match(awakeCommand('win32', 4321)![1].at(-1)!, /SetThreadExecutionState\(\[uint32\]2147483649\)/)
  assert.match(awakeCommand('win32', 4321)![1].at(-1)!, /while \(Get-Process -Id 4321 /, 'ends with the agent')
  const linux = awakeCommand('linux', 4321)!
  assert.equal(linux[0], 'systemd-inhibit')
  assert.ok(linux[1].includes('--pid=4321'), 'ends with the agent')
  assert.equal(awakeCommand('freebsd', 4321), null)
  assert.equal(awakeDefault('linux'), false)
  assert.equal(awakeDefault('darwin'), true)
  assert.equal(awakeDefault('win32'), false)
})

test('just woken, the computer is held a while even with the switch off, and let go after', async () => {
  const { awake, started, live } = stand({ platform: 'win32', on: false })
  awake.hold()
  assert.equal(started.length, 0, 'off: a command alone holds nothing')
  awake.release()
  awake.woke(60)
  assert.equal(started.length, 1)
  awake.hold()
  awake.release()
  await sleep(30)
  assert.equal(live[0].killed, false, 'a command ending within the minute doesn\'t cut it short')
  await sleep(80)
  assert.equal(live[0].killed, true)
})

test('a jump of the clock is a sleep; time going as it should is not', async () => {
  let t = 0
  let wakes = 0
  const stop = watchWakes(() => void wakes++, { every: 5, gap: 1000, now: () => t })
  t += 10
  await sleep(20)
  assert.equal(wakes, 0)
  t += 5000
  await sleep(20)
  assert.equal(wakes, 1)
  stop()
})

test('asleep with the screen off: nothing is asked of the system whatever runs, and asked again once awake', () => {
  const { awake, started, live } = stand()
  awake.hold()
  assert.equal(started.length, 1)
  awake.rest(true)
  assert.equal(live[0].killed, true, 'the Mac is let go to sleep')
  awake.hold()
  awake.woke(60)
  assert.equal(started.length, 1, 'nothing new while it rests')
  awake.rest(false)
  assert.equal(started.length, 2, 'something still runs: held again')
  awake.release()
  awake.release()
  awake.rest(true)
  awake.rest(false)
  assert.equal(started.length, 2, 'nothing runs: nothing to hold')
  awake.close()
})

test('only Windows is held up after a wake', () => {
  assert.equal(holdsAfterWake('win32'), true)
  assert.equal(holdsAfterWake('darwin'), false)
  assert.equal(holdsAfterWake('linux'), false)
})
