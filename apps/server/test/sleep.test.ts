import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sleepCommand, offCommand, powerCommand } from '../src/telegram/sleep.ts'

const script = (args: string[]) => {
  const inner = /'-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(args.at(-1)!)
  return Buffer.from(inner ? inner[1] : args.at(-1)!, 'base64').toString('utf16le')
}

test('Windows sleeps from a process of its own, a minute later, with the shutdown privilege switched on: off is never asked', () => {
  const c = sleepCommand('windows')!
  assert.equal(c.program, 'powershell')
  assert.match(c.args.at(-1)!, /^Start-Process powershell -WindowStyle Hidden/)
  const s = script(c.args)
  assert.match(s, /^Start-Sleep 60/)
  assert.match(s, /AdjustTokenPrivileges/)
  assert.match(s, /SeShutdownPrivilege/)
  assert.match(s, /SetSuspendState\(false, false, false\)/, 'sleep, not hibernation')
  assert.match(s, /\[Nap\]::Go\(\$false\)/)
  assert.doesNotMatch(s, /ExitWindows|InitiateSystemShutdown|Stop-Computer/)
  const dry = script(sleepCommand('windows', true)!.args)
  assert.match(dry, /\[Nap\]::Go\(\$true\)/)
  assert.doesNotMatch(dry, /Start-Sleep 60/)
})

test('off, when the user chose it: a minute later too, closing what is open; sleep stays what it was', () => {
  assert.deepEqual(offCommand('windows'), { program: 'shutdown', args: ['/s', '/f', '/t', '60'] })
  assert.match(offCommand('macos')!.args[1], /sleep 60; osascript -e 'tell application \\"System Events\\" to shut down'/)
  assert.match(offCommand('linux')!.args[1], /sleep 60; systemctl poweroff/)
  assert.deepEqual(powerCommand('windows', 'off'), offCommand('windows'))
  assert.deepEqual(powerCommand('linux', 'sleep'), sleepCommand('linux'))
})

test('a Mac and Linux sleep too, a minute later, in the background', () => {
  assert.match(sleepCommand('macos')!.args[1], /sleep 60; pmset sleepnow/)
  assert.match(sleepCommand('linux')!.args[1], /sleep 60; systemctl suspend/)
})
