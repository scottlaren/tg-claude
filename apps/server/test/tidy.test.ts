import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setLang } from '../src/i18n.ts'
import { tidyCommand, parseTidy, tidyLine } from '../src/telegram/tidy.ts'

setLang('ru')
const esc = (s: string) => s.replace(/</g, '&lt;')

test('Windows gets one encoded PowerShell script; dry closes nothing; a Mac quits apps with no Apple events', () => {
  const win = tidyCommand('windows')!
  assert.equal(win.program, 'powershell')
  const script = Buffer.from(win.args.at(-1)!, 'base64').toString('utf16le')
  assert.match(script, /\$dry = \$false/)
  assert.match(script, /PostMessage\(new IntPtr\(id\), 0x10/, 'a close, as the cross asks: never a kill')
  assert.doesNotMatch(script, /Stop-Process|taskkill|Kill\(/)
  assert.match(Buffer.from(tidyCommand('windows', true)!.args.at(-1)!, 'base64').toString('utf16le'), /\$dry = \$true/)
  const mac = tidyCommand('macos')!
  assert.deepEqual(mac.args.slice(0, 3), ['-l', 'JavaScript', '-e'])
  assert.match(mac.args[3], /a\.terminate/)
  assert.doesNotMatch(mac.args[3], /forceTerminate|kill -9|tell application/)
  assert.equal(tidyCommand('linux'), null)
})

test('the answer is read even behind PowerShell\'s progress records, and one window left is a list too', () => {
  assert.deepEqual(parseTidy('#< CLIXML\n<Objs>…</Objs>TIDY {"closed":5,"left":{"app":"AfterFX","title":"scene.aep"}}\r\n'), { closed: 5, left: [{ app: 'AfterFX', title: 'scene.aep' }] })
  assert.deepEqual(parseTidy('TIDY {"closed":2,"left":[]}'), { closed: 2, left: [] })
  assert.equal(parseTidy('nothing here'), null)
  assert.equal(parseTidy('TIDY {broken'), null)
})

test('by force: what a polite close left open is ended, the system\'s own windows aside; none of that is in the polite script', () => {
  const ps = (c: { args: string[] }) => Buffer.from(c.args.at(-1)!, 'base64').toString('utf16le')
  const polite = ps(tidyCommand('windows')!)
  assert.doesNotMatch(polite, /Stop-Process|__KILL__|__WAIT__/)
  assert.match(polite, /Start-Sleep -Seconds 20/)
  const force = ps(tidyCommand('windows', false, true)!)
  assert.match(force, /Stop-Process -Id \$id -Force/)
  assert.match(force, /\$system = 'explorer'/, 'never the shell')
  assert.match(force, /Start-Sleep -Seconds 8/, 'a shorter wait: what asks to save is ended anyway')
  assert.doesNotMatch(force, /__KILL__|__WAIT__/)
  const mac = tidyCommand('macos', false, true)!.args[3]
  assert.match(mac, /a\.forceTerminate/)
  assert.doesNotMatch(mac, /__KILL__|__WAIT__/)
  assert.doesNotMatch(tidyCommand('macos')!.args[3], /forceTerminate|__KILL__|__WAIT__/)
  // A dry run lists and ends nothing, whatever else is asked
  assert.match(ps(tidyCommand('windows', true, true)!), /\$dry = \$true/)
  assert.deepEqual(parseTidy('TIDY {"closed":6,"left":[],"killed":["RobloxStudioBeta","RobloxStudioBeta","AfterFX"]}'), { closed: 6, left: [], killed: ['RobloxStudioBeta', 'RobloxStudioBeta', 'AfterFX'] })
  assert.deepEqual(parseTidy('TIDY {"closed":2,"left":[],"killed":[]}'), { closed: 2, left: [] })
  assert.equal(tidyLine('PC', { closed: 6, left: [], killed: ['RobloxStudioBeta', 'RobloxStudioBeta', 'AfterFX'] }, esc),
    '🧹 <b>PC</b> убран: 6 окон закрыто. Закрыты принудительно, несохранённое в них пропало: RobloxStudioBeta ×2, AfterFX. Рабочий стол пустой.')
  assert.match(tidyLine('PC', { closed: 1, left: [{ app: 'explorer', title: 'Docs' }], killed: ['Notepad'] }, esc), /Notepad\. Остались открыты: explorer\.$/)
})

test('the line says what closed and what waits to be saved', () => {
  assert.equal(tidyLine('PC', { closed: 14, left: [] }, esc), '🧹 <b>PC</b> убран: 14 окон закрыто, рабочий стол пустой.')
  assert.match(tidyLine('PC', { closed: 1, left: [{ app: 'AfterFX', title: 'a' }, { app: 'AfterFX', title: 'b' }, { app: '', title: 'Без имени — Блокнот' }] }, esc),
    /1 окно закрыто\. Остались открыты, скорее всего ждут сохранения: AfterFX, Без имени — Блокнот\./)
  assert.match(tidyLine('PC', null, esc), /не получилось убрать/)
})
