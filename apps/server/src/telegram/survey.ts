import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tr } from '../i18n.ts'
import { defuseButtons, type RichButton, type SentMedia } from './render.ts'
import { redact } from './redact.ts'

// A long questionnaire from Claude. Its turn is over by the time it is answered, which may take days and an update of
// the bot: the survey lives here, on disk, and what was answered goes back to Claude as a message when it ends
export type SurveyQuestion = {
  question: string
  options: { label: string, description?: string }[]
  multiple?: boolean
  // The options Claude advises
  recommended?: number[]
  // A picture on the computer, from the project
  image?: string
}
export type SurveyAnswer = { chosen: number[], text?: string, skipped?: boolean }
export type Survey = {
  id: string
  title?: string
  questions: SurveyQuestion[]
  index: number
  answers: Record<number, SurveyAnswer>
  // Ticked on the question at hand, not answered yet
  selected: number[]
  messageId?: number
  // The card as sent, when it carries a picture: an edit has to name it again
  media?: SentMedia[]
  // …and its link in the text, without which the edit drops the picture
  picture?: string
}
export type SurveyEnd = 'complete' | 'ended' | 'stopped'

export const newSurvey = (questions: SurveyQuestion[], title?: string): Survey => ({
  id: randomBytes(4).toString('hex'), title, questions, index: 0, answers: {}, selected: [],
})

const answered = (a: SurveyAnswer | undefined) => !!a && !a.skipped && (a.chosen.length > 0 || !!a.text)
export const answeredCount = (s: Survey) => s.questions.filter((_, i) => answered(s.answers[i])).length

export function surveyMarkdown(s: Survey) {
  const q = s.questions[s.index]
  const had = s.answers[s.index]
  const head = `**📋 ${s.title ? `${s.title} · ` : ''}${s.index + 1}/${s.questions.length}**`
  const star = (i: number) => (q.recommended?.includes(i) ? '⭐ ' : '')
  const options = q.options.filter(o => o.description).length
    ? q.options.map((o, i) => `- **${star(i)}${o.label}**${o.description ? ` — ${o.description}` : ''}`).join('\n')
    : ''
  const earlier = had?.text ? `${tr('Your answer', 'Твой ответ')}: ${had.text}` : ''
  const hint = !q.options.length ? tr('_Answer with a message or a voice message._', '_Ответь сообщением или голосовым._')
    : q.multiple ? tr('_Tick the options and press “Done”, or answer with a message._', '_Отметь варианты и нажми «Готово» или ответь сообщением._')
      : tr('_Pick an option or answer with a message._', '_Выбери вариант или ответь сообщением._')
  return defuseButtons([head, q.question, options, earlier, hint].filter(Boolean).join('\n\n'))
}

export function surveyRows(s: Survey): RichButton[][] {
  const q = s.questions[s.index]
  // With its question: the card is redrawn in place, so a second tap on a slow phone lands on the next question's button
  const data = (choice: number | string) => `sv:${s.id}:${s.index}:${choice}`
  const had = s.answers[s.index]
  const rows: RichButton[][] = q.options.map((o, i) => {
    const mark = q.multiple ? (s.selected.includes(i) ? '☑️ ' : '⬜ ') : had?.chosen.includes(i) ? '✅ ' : ''
    return [{ text: `${mark}${q.recommended?.includes(i) ? '⭐ ' : ''}${redact(o.label).text}`, data: data(i) }]
  })
  // The one blue button: the only one that sends what was ticked
  if (q.multiple && q.options.length) rows.push([{ text: tr('Done', 'Готово'), data: data('done'), style: 'primary' }])
  rows.push([...(s.index > 0 ? [{ text: tr('← Back', '← Назад'), data: data('back') }] : []), { text: tr('Skip', 'Пропустить'), data: data('skip') }])
  rows.push([{ text: tr('🏁 Finish', '🏁 Закончить'), data: data('end') }])
  return rows
}

// A step of the survey: what the tap or the message did. 'next' moved on, 'end' ran out of questions
export type SurveyStep = 'next' | 'end' | 'toggled' | 'nothing'

function advance(s: Survey, by: number): SurveyStep {
  s.index = Math.max(0, s.index + by)
  if (s.index >= s.questions.length) return 'end'
  s.selected = [...(s.answers[s.index]?.chosen ?? [])]
  return 'next'
}

export function surveyTap(s: Survey, choice: string): SurveyStep {
  const q = s.questions[s.index]
  if (choice === 'back') return s.index > 0 ? advance(s, -1) : 'nothing'
  if (choice === 'skip') {
    // Skipping past a question answered earlier leaves that answer alone
    s.answers[s.index] ??= { chosen: [], skipped: true }
    return advance(s, 1)
  }
  if (choice === 'done') {
    if (!s.selected.length) return 'nothing'
    s.answers[s.index] = { chosen: [...s.selected].sort((a, b) => a - b) }
    return advance(s, 1)
  }
  const i = Number(choice)
  if (!Number.isInteger(i) || !q.options[i]) return 'nothing'
  if (q.multiple) {
    s.selected = s.selected.includes(i) ? s.selected.filter(x => x !== i) : [...s.selected, i]
    return 'toggled'
  }
  s.answers[s.index] = { chosen: [i] }
  return advance(s, 1)
}

// A message answers the question at hand, along with whatever was ticked
export function surveyText(s: Survey, text: string): SurveyStep {
  s.answers[s.index] = { chosen: [...s.selected].sort((a, b) => a - b), text }
  return advance(s, 1)
}

const END_WORDS: Record<SurveyEnd, string> = {
  complete: 'is finished',
  ended: 'was ended early by the user',
  stopped: 'was stopped by the user with /stop',
}

// What Claude gets back: every question with what became of it
export function surveyResult(s: Survey, end: SurveyEnd) {
  const lines = s.questions.map((q, i) => {
    const a = s.answers[i]
    const said = !a ? '(not reached)' : a.skipped ? '(skipped)'
      : [a.chosen.map(n => q.options[n]?.label).filter(Boolean).join(', '), a.text].filter(Boolean).join(' · ')
    return `${i + 1}. ${q.question}\n→ ${said}`
  })
  return [
    `[The survey${s.title ? ` «${s.title}»` : ''} ${END_WORDS[end]}: ${answeredCount(s)} of ${s.questions.length} answered. The answers are the user's own.]`,
    lines.join('\n\n'),
    '[If these answers decide how the project goes, save them in a file in the project and say where. If they were only context, don\'t. Then go on with the task.]',
  ].join('\n\n')
}

// One survey per topic. Written on every change: nothing here is worth answering twice
export function createSurveyStore(file: string) {
  let all: Record<string, Survey> = {}
  try {
    all = JSON.parse(readFileSync(file, 'utf8'))
  } catch {}
  const save = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify(all))
    renameSync(`${file}.tmp`, file)
  }
  return {
    get: (key: string): Survey | undefined => all[key],
    set(key: string, s: Survey) {
      all[key] = s
      save()
    },
    drop(key: string) {
      if (!all[key]) return
      delete all[key]
      save()
    },
    keys: () => Object.keys(all),
  }
}
