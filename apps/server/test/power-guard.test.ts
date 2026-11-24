import { test } from 'node:test'
import assert from 'node:assert/strict'
import { powerDeny, powerRefusal } from '../src/claude/night-guard.ts'

const REFUSED: [string, string][] = [
  ['shutdown /s /f /t 60', 'shutdown'],
  ['shutdown /r /t 0', 'shutdown'],
  ['shutdown -s -t 0', 'shutdown'],
  ['shutdown /p', 'shutdown'],
  ['C:/Windows/System32/shutdown.exe /s', 'shutdown'],
  ['sudo shutdown -h now', 'shutdown'],
  ['shutdown -r +5', 'shutdown'],
  ['shutdown now', 'shutdown'],
  ['shutdown -hP now', 'shutdown'],
  ['powershell -NoProfile -Command "Stop-Computer -Force"', 'stop-computer'],
  ['Restart-Computer', 'restart-computer'],
  ['pwsh -c "Get-Date; Restart-Computer -Force"', 'restart-computer'],
  ['cmd /c shutdown /s', 'shutdown'],
  ['echo $(shutdown -h now)', 'shutdown'],
  ['sudo systemctl poweroff', 'systemctl poweroff'],
  ['systemctl reboot', 'systemctl reboot'],
  ['loginctl poweroff', 'loginctl poweroff'],
  ['halt', 'halt'],
  ['sudo poweroff', 'poweroff'],
  ['reboot', 'reboot'],
  ['init 0', 'init 0'],
  ['osascript -e \'tell app "System Events" to shut down\'', 'osascript shut down or restart'],
  ['osascript -e \'tell application "System Events" to restart\'', 'osascript shut down or restart'],
  ['sudo pmset schedule shutdown "11/24/26 03:00:00"', 'pmset scheduled shutdown'],
  ['rundll32.exe user32.dll,ExitWindowsEx', 'rundll32 ExitWindowsEx'],
  ['nohup sh -c "sleep 60; systemctl poweroff" >/dev/null 2>&1 &', 'systemctl poweroff'],
]

const ALLOWED = [
  'shutdown /a',
  'shutdown -c',
  'shutdown /h',
  'shutdown /l',
  'shutdown /?',
  'pmset sleepnow',
  'systemctl suspend',
  'systemctl status',
  'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
  'osascript -e \'tell app "System Events" to sleep\'',
  'osascript -e \'display notification "restarting the dev server"\'',
  'grep -r "shutdown /s" docs',
  'echo "Restart-Computer is refused"',
  'git commit -m "no reboot needed"',
  'npm run restart',
  'pm2 restart api',
  'docker restart web',
]

test('turning a computer off or restarting it is refused, in any shell, behind any wrapper', () => {
  for (const [command, op] of REFUSED) assert.equal(powerRefusal({ command }), op, command)
})

test('sleep, hibernation, cancelling a planned shutdown, logging out, and words that only mention it pass', () => {
  for (const command of ALLOWED) assert.equal(powerRefusal({ command }), null, command)
})

test('a program with its arguments is read the same way', () => {
  assert.equal(powerRefusal({ program: 'shutdown', args: ['/s', '/t', '0'] }), 'shutdown')
  assert.equal(powerRefusal({ program: 'powershell', args: ['-Command', 'Stop-Computer'] }), 'stop-computer')
  assert.equal(powerRefusal({ program: 'sh', args: ['-c', 'nohup sh -c "sleep 60; pmset sleepnow" >/dev/null 2>&1 &'] }), null)
  assert.match(powerDeny('shutdown'), /not allowed \(shutdown\).*offer_power.*sleep or off/)
})
