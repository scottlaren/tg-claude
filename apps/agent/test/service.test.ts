import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { controlPath, listenControl, ask, AlreadyRunning } from '../src/control.ts'
import { runKeyCommand, launchAgentPlist, systemdUnit, LABEL } from '../src/service.ts'

const someConfig = () => join(tmpdir(), `agent-${randomBytes(4).toString('hex')}.json`)

test('one agent per config: a second one is refused, a stopped one frees the place', async () => {
  const path = controlPath('agent', someConfig())
  const first = await listenControl(path, cmd => (cmd === 'ping' ? 'pong 1 0' : 'unknown'))
  await assert.rejects(listenControl(path, () => ''), AlreadyRunning)
  assert.equal(await ask(path, 'ping'), 'pong 1 0')
  assert.equal(await ask(path, 'what'), 'unknown')
  await new Promise(r => first.close(r))
  assert.equal(await ask(path, 'ping', 500), null)
  const again = await listenControl(path, () => 'ok')
  await new Promise(r => again.close(r))
})

test('different configs and roles get different sockets; the same config always the same one', () => {
  const cfg = someConfig()
  assert.equal(controlPath('agent', cfg), controlPath('agent', cfg.toUpperCase()))
  assert.notEqual(controlPath('agent', cfg), controlPath('supervisor', cfg))
  assert.notEqual(controlPath('agent', cfg), controlPath('agent', someConfig()))
})

test('the login entry quotes paths with spaces', () => {
  assert.equal(runKeyCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\My Code\\main.ts'), '"C:\\Program Files\\nodejs\\node.exe" "C:\\My Code\\main.ts" start')
})

test('the LaunchAgent keeps the agent alive with the user PATH and escapes paths', () => {
  const xml = launchAgentPlist({ node: '/opt/node', main: '/Users/s/R&D/main.ts', cwd: '/Users/s/R&D', log: '/Users/s/R&D/agent.log', path: '/opt/homebrew/bin:/usr/bin' })
  assert.ok(xml.includes(`<string>${LABEL}</string>`))
  assert.ok(xml.includes('<string>/Users/s/R&amp;D/main.ts</string><string>run</string><string>--wait</string>'))
  assert.ok(xml.includes('<key>PATH</key><string>/opt/homebrew/bin:/usr/bin</string>'))
  assert.ok(xml.includes('<key>SuccessfulExit</key><false/>'))
  assert.ok(!xml.includes('R&D'))
})

test('the systemd unit: the agent with its own node, restarted after a crash, at once after an update', () => {
  const unit = systemdUnit({ node: '/home/me/.tg-claude-vps/agent/node/bin/node', main: '/home/me/a b/main.ts', cwd: '/home/me/.tg-claude-vps/agent', log: '/home/me/agent.log', path: '/usr/bin:/bin' })
  assert.match(unit, /^ExecStart="\/home\/me\/\.tg-claude-vps\/agent\/node\/bin\/node" "\/home\/me\/a b\/main\.ts" run --wait$/m)
  assert.match(unit, /^Restart=on-failure$/m)
  assert.match(unit, /^RestartForceExitStatus=75$/m)
  assert.match(unit, /^Environment="PATH=\/usr\/bin:\/bin"$/m)
  assert.match(unit, /^StandardOutput=append:\/home\/me\/agent\.log$/m)
  assert.match(unit, /^WantedBy=default\.target$/m)
})
