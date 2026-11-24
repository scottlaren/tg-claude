import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, realpathSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCapture, fromPath, runCommand } from '../src/command.ts'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-cmd-')))
const node = process.execPath
const base = { args: [], cwd: '.', timeoutSec: 30, background: false }

test('capture keeps head and tail of long output', () => {
  const c = createCapture(100)
  c.push('H'.repeat(30))
  c.push('x'.repeat(500))
  c.push('TAIL')
  assert.ok(c.truncated)
  assert.ok(c.text().startsWith('H'.repeat(25)))
  assert.ok(c.text().endsWith('TAIL'))
})

test('in the background: it returns at once and runs on, its output in the log it names', async () => {
  const started = Date.now()
  const r = await runCommand(root, 'unused', {
    ...base, background: true, program: node, args: ['-e', 'setTimeout(() => { console.log("long run done"); console.error("and its errors") }, 800)'],
  }, new AbortController().signal)
  assert.ok(Date.now() - started < 700, 'not waited for')
  assert.ok(r.background && r.background.pid > 0)
  assert.match(r.stdout, /Started in the background/)
  for (let i = 0; i < 50 && !/errors/.test(readFileSync(r.background!.log, 'utf8')); i++) await new Promise(res => setTimeout(res, 100))
  assert.match(readFileSync(r.background!.log, 'utf8'), /long run done[\s\S]*and its errors/)
  rmSync(r.background!.log, { force: true })
})

test('program + args run without a shell and report streams separately', async () => {
  const r = await runCommand(root, 'unused', {
    ...base, program: node, args: ['-e', 'console.log("out; echo injected"); console.error("err"); process.exit(3)'],
  }, new AbortController().signal)
  assert.equal(r.exitCode, 3)
  assert.equal(r.stdout.trim(), 'out; echo injected')
  assert.equal(r.stderr.trim(), 'err')
})

test('timeout kills the process', async () => {
  const r = await runCommand(root, 'unused', {
    ...base, program: node, args: ['-e', 'setTimeout(() => {}, 60000)'], timeoutSec: 1,
  }, new AbortController().signal)
  assert.equal(r.timedOut, true)
  assert.ok(r.durationMs < 10000)
})

test('cancel stops a running command', async () => {
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 300)
  const r = await runCommand(root, 'unused', { ...base, program: node, args: ['-e', 'setTimeout(() => {}, 60000)'] }, ac.signal)
  assert.equal(r.cancelled, true)
})

test('cwd outside the project is refused', async () => {
  await assert.rejects(
    runCommand(root, 'unused', { ...base, program: node, cwd: '..' }, new AbortController().signal),
    (e: unknown) => (e as { code: string }).code === 'outside_root',
  )
})

test('a command that leaves an app running returns when it exits, and the app keeps running', async () => {
  // Like `cmd //c start "" place.rbxl`: the launched app inherits the output pipe and holds it open
  const launcher = `const c = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { stdio: 'inherit', detached: true }); c.unref(); console.log(c.pid)`
  const t0 = Date.now()
  const r = await runCommand(root, 'unused', { ...base, program: node, args: ['-e', launcher] }, new AbortController().signal)
  assert.ok(Date.now() - t0 < 4000, `returned after ${Date.now() - t0} ms`)
  assert.equal(r.exitCode, 0)
  const pid = Number(r.stdout.trim())
  assert.doesNotThrow(() => process.kill(pid, 0), 'the app was killed with the command')
  process.kill(pid)
})

test('a command stopped while its folder is still being checked never starts', async () => {
  const ac = new AbortController()
  const marker = join(root, `started-${Date.now()}`)
  // Stopped before the checks are through: the same as a Stop that lands right after «accepted»
  ac.abort()
  const r = await runCommand(root, 'unused', { ...base, program: node, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, '1')`] }, ac.signal)
  assert.equal(r.cancelled, true)
  assert.equal(r.exitCode, null)
  assert.equal(existsSync(marker), false)
})

test('a bare program name comes from PATH, never from the working folder', () => {
  const on = (...files: string[]) => (p: string) => files.includes(p)
  assert.equal(fromPath('git', 'C:\\Git\\cmd;C:\\Windows', on('C:\\Git\\cmd\\git.exe')), 'C:\\Git\\cmd\\git.exe')
  assert.equal(fromPath('tool.exe', 'C:\\Tools', on('C:\\Tools\\tool.exe')), 'C:\\Tools\\tool.exe')
  assert.equal(fromPath('git', 'C:\\First;C:\\Second', on('C:\\First\\git.com', 'C:\\Second\\git.exe')), 'C:\\First\\git.com')
  // No PATH entry that means «here», and a path is what it says
  assert.equal(fromPath('git', '.;relative', on('.\\git.exe', 'relative\\git.exe')), null)
  assert.equal(fromPath('git', 'C:\\Empty', on()), null)
  assert.equal(fromPath('./git.exe', '', on()), './git.exe')
  assert.equal(fromPath('C:\\x\\git.exe', '', on()), 'C:\\x\\git.exe')
})

test('a git.exe in the project does not run in place of git', { skip: process.platform !== 'win32' }, async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-cmd-path-')))
  copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), join(project, 'git.exe'))
  const r = await runCommand(project, 'unused', { ...base, program: 'git', args: ['--version'] }, new AbortController().signal)
  assert.equal(r.exitCode, 0)
  assert.match(r.stdout, /^git version/)
  // Named by its path, it is what was asked for
  const own = await runCommand(project, 'unused', { ...base, program: './git.exe', args: [] }, new AbortController().signal)
  assert.doesNotMatch(own.stdout, /^git version/)
  await assert.rejects(runCommand(project, 'unused', { ...base, program: 'no-such-program-at-all', args: [] }, new AbortController().signal), /not on PATH/)
})
