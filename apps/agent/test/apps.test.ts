import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { resolveExe, isRunning, createApps } from '../src/apps.ts'

test('a * folder in the exe path picks the newest version', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-exe-')))
  for (const [v, age] of [['version-old', 100], ['version-new', 10]] as const) {
    mkdirSync(join(root, 'Versions', v), { recursive: true })
    const exe = join(root, 'Versions', v, 'Studio.exe')
    writeFileSync(exe, '')
    const t = Date.now() / 1000 - age
    utimesSync(exe, t, t)
  }
  assert.equal(resolveExe(join(root, 'Versions', '*', 'Studio.exe')), join(root, 'Versions', 'version-new', 'Studio.exe'))
  assert.equal(resolveExe(join(root, 'Versions', '*', 'Missing.exe')), null)
})

// On Linux Node 24 names its main thread: pgrep -x node finds nothing there, and apps are only opened on Windows and Mac
test('the current node process is seen as running, a made-up one is not', { skip: process.platform === 'linux' }, async () => {
  assert.equal(await isRunning(basename(process.execPath)), true)
  assert.equal(await isRunning('definitely-not-running-tgcv.exe'), false)
})

test('apps outside the config are refused with the list of known ones', async () => {
  // A process name nothing has: with the real one, this close reaches a Blender open on the computer running the tests
  const apps = createApps({ blender: { exe: 'C:\\nope\\blender.exe', process: 'tgcv-no-such-app.exe' } }, undefined)
  await assert.rejects(apps.open(tmpdir(), { app: 'maya' }, new AbortController().signal),
    (e: { code: string, message: string }) => e.code === 'not_found' && e.message.includes('blender'))
  // Not running + no probe: closing is a no-op that says so
  const r = await apps.close({ app: 'blender', force: false }, new AbortController().signal)
  assert.deepEqual(r, { closed: true, forced: false, note: 'Was not running' })
})

test('a file to open must be inside the project', async () => {
  const apps = createApps({ blender: { exe: 'C:\\nope\\blender.exe' } }, undefined)
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-app-')))
  await assert.rejects(apps.open(root, { app: 'blender', file: '../scene.blend' }, new AbortController().signal),
    (e: { code: string }) => e.code === 'outside_root')
})
