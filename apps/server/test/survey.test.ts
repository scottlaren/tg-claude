import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setLang } from '../src/i18n.ts'
import { answeredCount, createSurveyStore, newSurvey, surveyMarkdown, surveyResult, surveyRows, surveyTap, surveyText } from '../src/telegram/survey.ts'

setLang('en')
const questions = () => [
  { question: 'Genre?', options: [{ label: 'Farm', description: 'slow' }, { label: 'Shop' }], recommended: [1] },
  { question: 'First version?', options: [{ label: 'Shop' }, { label: 'Pets' }, { label: 'Quests' }], multiple: true },
  { question: 'Anything else?', options: [] },
]

test('the card: a count, a star on what Claude advises, and one blue button, only where it sends something', () => {
  const s = newSurvey(questions(), 'Game')
  assert.match(surveyMarkdown(s), /Game · 1\/3/)
  assert.match(surveyMarkdown(s), /\*\*Farm\*\* — slow/)
  const first = surveyRows(s)
  assert.deepEqual(first.flat().map(b => b.text), ['Farm', '⭐ Shop', 'Skip', '🏁 Finish'], 'no Back on the first one')
  assert.ok(first.flat().every(b => !b.style), 'one tap sends it: nothing to single out')

  s.index = 1
  const many = surveyRows(s).flat()
  assert.deepEqual(many.map(b => b.text), ['⬜ Shop', '⬜ Pets', '⬜ Quests', 'Done', '← Back', 'Skip', '🏁 Finish'])
  assert.deepEqual(many.filter(b => b.style).map(b => b.text), ['Done'])

  s.index = 2
  assert.deepEqual(surveyRows(s).flat().map(b => b.text), ['← Back', 'Skip', '🏁 Finish'], 'words only')
  assert.match(surveyMarkdown(s), /Answer with a message/)
})

test('walking through it: one tap answers, ticks wait for Done, Back shows what was said, Skip leaves an answer alone', () => {
  const s = newSurvey(questions())
  assert.equal(surveyTap(s, '1'), 'next')
  assert.deepEqual(s.answers[0], { chosen: [1] })
  assert.equal(s.index, 1)

  assert.equal(surveyTap(s, 'done'), 'nothing', 'nothing ticked yet')
  assert.equal(surveyTap(s, '2'), 'toggled')
  assert.equal(surveyTap(s, '0'), 'toggled')
  assert.equal(surveyTap(s, '2'), 'toggled')
  assert.equal(surveyTap(s, '1'), 'toggled')
  assert.equal(s.index, 1, 'ticking moves nowhere')
  assert.equal(surveyTap(s, 'done'), 'next')
  assert.deepEqual(s.answers[1], { chosen: [0, 1] })

  assert.equal(surveyTap(s, 'back'), 'next')
  assert.equal(s.index, 1)
  assert.deepEqual(s.selected, [0, 1], 'its ticks are back')
  assert.equal(surveyTap(s, 'skip'), 'next')
  assert.deepEqual(s.answers[1], { chosen: [0, 1] }, 'skipping past an answer keeps it')

  assert.equal(surveyTap(s, 'skip'), 'end')
  assert.equal(answeredCount(s), 2)
  assert.equal(surveyTap(newSurvey(questions()), 'back'), 'nothing')
  assert.equal(surveyTap(newSurvey(questions()), '9'), 'nothing')
})

test('Back marks the option chosen before, and answering again replaces it', () => {
  const s = newSurvey(questions())
  surveyTap(s, '0')
  surveyTap(s, 'back')
  assert.equal(surveyRows(s)[0][0].text, '✅ Farm')
  surveyTap(s, '1')
  assert.deepEqual(s.answers[0], { chosen: [1] })
})

test('a message answers the question at hand, along with what was ticked', () => {
  const s = newSurvey(questions())
  surveyTap(s, '0')
  surveyTap(s, '2')
  assert.equal(surveyText(s, 'and a dragon'), 'next')
  assert.deepEqual(s.answers[1], { chosen: [2], text: 'and a dragon' })
  assert.equal(surveyText(s, 'no'), 'end')
})

test('what Claude gets: every question with what became of it, and what to do with it', () => {
  const s = newSurvey(questions(), 'Game')
  surveyTap(s, '1')
  surveyTap(s, 'skip')
  const r = surveyResult(s, 'stopped')
  assert.match(r, /survey «Game» was stopped by the user with \/stop: 1 of 3 answered/)
  assert.match(r, /1\. Genre\?\n→ Shop/)
  assert.match(r, /2\. First version\?\n→ \(skipped\)/)
  assert.match(r, /3\. Anything else\?\n→ \(not reached\)/)
  assert.match(r, /save them in a file/)
})

test('a survey outlives the process, and one that ended is gone', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tgcv-survey-')), 'surveys.json')
  const store = createSurveyStore(file)
  const s = newSurvey(questions())
  surveyTap(s, '1')
  store.set('k', s)
  const again = createSurveyStore(file).get('k')!
  assert.equal(again.id, s.id)
  assert.deepEqual(again.answers[0], { chosen: [1] })
  store.drop('k')
  assert.equal(createSurveyStore(file).get('k'), undefined)
  assert.deepEqual(createSurveyStore(join(file, 'nowhere')).keys(), [], 'no file, nothing open')
})
