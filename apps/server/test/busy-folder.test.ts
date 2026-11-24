import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFolderRetry, isBusyFolder, rmdirCommand } from '../src/telegram/busy-folder.ts'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

test('a folder another program holds is told apart from other failures', () => {
  assert.ok(isBusyFolder("error: failed to delete 'C:/code/game-wt/place2': Permission denied"))
  assert.ok(isBusyFolder('rmdir: failed to remove: Device or resource busy'))
  assert.ok(isBusyFolder('The process cannot access the file because it is being used by another process.'))
  assert.ok(!isBusyFolder("fatal: 'x' contains modified or untracked files, use --force to delete it"))
})

test('only an empty folder is removed: no /s, no -r', () => {
  assert.deepEqual(rmdirCommand('windows', 'C:/code/game-wt/place2'), { program: 'cmd', args: ['/c', 'rmdir', 'C:\\code\\game-wt\\place2'] })
  assert.deepEqual(rmdirCommand('macos', '../game-wt/place2'), { program: 'rmdir', args: ['../game-wt/place2'] })
})

test('tried again until it goes, and not while the computer is off', async () => {
  const tries: string[] = []
  const ends: boolean[] = []
  let on = false
  let held = 2
  const r = createFolderRetry({
    remove: async (_d, _r, f) => (tries.push(f), held-- > 0 ? 'Device or resource busy' : null),
    online: () => on,
    done: (_d, _r, _f, removed) => ends.push(removed),
    everyMs: 5,
  })
  r.later('pc', 'repo', 'C:/code/game-wt/place2')
  await sleep(40)
  assert.equal(tries.length, 0, 'nothing while off')
  on = true
  await sleep(80)
  assert.equal(tries.length, 3)
  assert.deepEqual(ends, [true])
  assert.equal(r.waiting(), 0)
})

test('a folder already gone counts as done; after the day it stops trying', async () => {
  const ends: boolean[] = []
  let t = 0
  const gone = createFolderRetry({ remove: async () => 'The system cannot find the file specified.', online: () => true, done: (_d, _r, _f, ok) => ends.push(ok), everyMs: 5 })
  gone.later('pc', 'repo', 'a')
  const stuck = createFolderRetry({ remove: async () => (t += 100, 'Permission denied'), online: () => true, done: (_d, _r, _f, ok) => ends.push(ok), everyMs: 5, forMs: 250, now: () => t })
  stuck.later('pc', 'repo', 'b')
  await sleep(120)
  assert.deepEqual(ends.sort(), [false, true])
  assert.equal(stuck.waiting(), 0)
})
