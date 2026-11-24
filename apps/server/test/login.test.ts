import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startLogin, startMcpLogin } from '../src/login.ts'
import { PROFILE_NAME } from '../src/profiles.ts'

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude-login.mjs', import.meta.url))
const run = (env: NodeJS.ProcessEnv = {}) =>
  startLogin({ dir: mkdtempSync(join(tmpdir(), 'tgcv-login-')), env: { ...process.env, ...env }, command: [process.execPath, FAKE] })

test('the sign-in link comes out of the CLI, and the code the user brings back signs the profile in', async () => {
  const r = await run()
  // The CLI ran with the profile's own folder for its credentials
  assert.match(r.url, /^https:\/\/claude\.com\/cai\/oauth\/authorize\?.*state=dir$/)
  assert.deepEqual(await r.submit('  good-code#state \n'), { ok: true, message: 'Login successful.' })
})

test('a code the CLI refuses comes back as a plain reason', async () => {
  const r = await run()
  const out = await r.submit('old-code#x')
  assert.equal(out.ok, false)
  assert.match(out.message, /^That code wasn't accepted/)
})

test('a CLI that fails before giving a link says why, instead of hanging', async () => {
  await assert.rejects(run({ FAKE_LOGIN: 'broken' }), /local listener/)
})

test('profile names: letters, digits, - and _, up to 32', () => {
  for (const ok of ['main', 'work', 'my_profile-2', 'A'.repeat(32)]) assert.equal(PROFILE_NAME.test(ok), true, ok)
  for (const bad of ['', 'with space', '../up', 'a'.repeat(33), 'имя']) assert.equal(PROFILE_NAME.test(bad), false, bad)
})

const FAKE_MCP = fileURLToPath(new URL('./fixtures/fake-mcp-login.mjs', import.meta.url))
const mcp = (env: NodeJS.ProcessEnv = {}) =>
  startMcpLogin({ dir: mkdtempSync(join(tmpdir(), 'tgcv-mcp-login-')), name: 'figma', env: { ...process.env, ...env }, command: [process.execPath, FAKE_MCP] })

test('an MCP sign-in gives its link and port, and the way back finishes it', async () => {
  const r = await mcp()
  assert.match(r.url, /^https:\/\/www\.figma\.com\/oauth\/mcp\?/, 'no terminal colours stuck to it')
  assert.ok(r.url.endsWith('state=s'))
  assert.equal(r.port, 60668)
  const out = await r.submit(' http://localhost:60668/callback?code=good&state=s \n')
  assert.equal(out.ok, true)
  assert.match(out.message, /successful/)
})

test('a way back the CLI refuses comes back as a plain reason', async () => {
  const r = await mcp()
  const out = await r.submit('http://localhost:60668/callback?code=bad')
  assert.equal(out.ok, false)
  assert.match(out.message, /not accepted/)
})

test('a way back from another sign-in is refused at once, not after a minute of waiting', async () => {
  const r = await mcp()
  const started = Date.now()
  const out = await r.submit('http://localhost:60668/callback?code=x&state=wrong')
  assert.equal(out.ok, false)
  assert.match(out.message, /look like a redirect/)
  assert.ok(Date.now() - started < 5000)
})

test('an MCP sign-in that can\'t start says why; a strange name never gets as far as a shell', async () => {
  await assert.rejects(mcp({ FAKE_LOGIN: 'broken' }), /not found/)
  await assert.rejects(startMcpLogin({ dir: tmpdir(), name: "x'; rm -rf /", command: [process.execPath, FAKE_MCP] }), /Not a name/)
})
