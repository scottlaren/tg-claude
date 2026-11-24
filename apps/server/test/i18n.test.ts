import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tr, count, lang, setLang, loadLang, guessLang } from '../src/i18n.ts'
import { verdictLabel, questionMarkdown, formatDuration } from '../src/telegram/render.ts'
import { inTime } from '../src/telegram/usage.ts'
import { zonesView } from '../src/telegram/zones.ts'

// One process per test file: the language set here stays here
test('English until told otherwise; the owner\'s Telegram language decides once; /language persists', () => {
  assert.equal(lang(), 'en')
  assert.equal(tr('Done', 'Готово'), 'Done')
  const file = join(mkdtempSync(join(tmpdir(), 'tgcv-lang-')), 'language.json')
  loadLang(file)
  assert.equal(guessLang(undefined), false)
  assert.equal(guessLang('ru-RU'), true)
  assert.equal(lang(), 'ru')
  assert.equal(tr('Done', 'Готово'), 'Готово')
  // Decided: a later message in another language changes nothing
  assert.equal(guessLang('en'), false)
  assert.equal(lang(), 'ru')
  setLang('en')
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { lang: 'en' })
  setLang('ru')
  loadLang(file)
  assert.equal(lang(), 'ru')
  setLang('en')
})

test('counts in both languages', () => {
  setLang('en')
  assert.equal(count(1, ['project', 'projects'], ['проект', 'проекта', 'проектов']), '1 project')
  assert.equal(count(5, ['project', 'projects'], ['проект', 'проекта', 'проектов']), '5 projects')
  setLang('ru')
  const ru = (n: number) => count(n, ['project', 'projects'], ['проект', 'проекта', 'проектов'])
  assert.deepEqual([1, 3, 5, 11, 21, 22, 112].map(ru), ['1 проект', '3 проекта', '5 проектов', '11 проектов', '21 проект', '22 проекта', '112 проектов'])
  setLang('en')
})

test('the bot\'s texts in English', () => {
  setLang('en')
  assert.equal(verdictLabel('all'), '⚡ Allowed until the task ends')
  assert.match(questionMarkdown({ question: 'Which?', options: [{ label: 'A' }] }, 0, 1), /Pick an option or answer in your own words/)
  assert.equal(formatDuration(75_000), '1m 15s')
  assert.equal(inTime(3 * 86_400_000), 'in 3 days')
  const v = zonesView('abcd1234', 'Mac', {
    home: '/Users/s', zones: [{ path: '/Users/s/code', projects: 1 }], suggestions: [], roots: [{ name: 'home', path: '/Users/s' }],
  })
  assert.match(v.text, /Working folders · Mac/)
  assert.match(v.text, /~\/code<\/code> — 1 project\b/)
  assert.deepEqual(v.kb!.inline_keyboard.flat().map(b => b.text), ['📂 Choose another folder', '✅ Done'])
})
