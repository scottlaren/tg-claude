import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// The bot speaks English or Russian: one language for the whole bot (it has one owner, or a few). /language
// switches it; until then the owner's Telegram language decides, once. The project itself is English: docs,
// logs and whatever the computers print stay English, whichever language the bot speaks
export type Lang = 'en' | 'ru'
export const LANGS: readonly Lang[] = ['en', 'ru']

let current: Lang = 'en'
let file: string | undefined
let chosen = false
let heard: (l: Lang) => void = () => {}

export const lang = () => current

// Text in the bot's language: English first, Russian second, side by side where it is used
export const tr = (en: string, ru: string) => (current === 'ru' ? ru : en)

// A number with its noun: English has one and many, Russian one, few and many
export function count(n: number, en: [string, string], ru: [string, string, string]) {
  if (current !== 'ru') return `${n} ${n === 1 ? en[0] : en[1]}`
  const m10 = n % 10
  const m100 = n % 100
  const word = m10 === 1 && m100 !== 11 ? ru[0] : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? ru[1] : ru[2]
  return `${n} ${word}`
}

export function loadLang(path: string) {
  file = path
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    if (LANGS.includes(saved.lang)) {
      current = saved.lang
      chosen = true
    }
  } catch {}
}

// For what speaks the bot's language from outside it. Told at once, and at every change
export function followLang(fn: (l: Lang) => void) {
  heard = fn
  fn(current)
}

// Without a file (tests) the choice only lives in memory
export function setLang(l: Lang) {
  current = l
  chosen = true
  heard(l)
  if (!file) return
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file + '.tmp', JSON.stringify({ lang: l }, null, 2) + '\n')
  renameSync(file + '.tmp', file)
}

// An owner's message before any choice: Russian for a Russian Telegram, English otherwise. True when it decided
export function guessLang(telegramCode?: string) {
  if (chosen || !telegramCode) return false
  setLang(/^ru\b/i.test(telegramCode) ? 'ru' : 'en')
  return true
}
