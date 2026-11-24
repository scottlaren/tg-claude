import { GrammyError } from 'grammy'
import { tr } from '../i18n.ts'

// What a failure is called in a chat: grammY's “Call to 'sendMessage' failed!” and fetch's “fetch failed” stay in the log
export function failureText(e: unknown) {
  if (e instanceof GrammyError) return e.description
  const message = (e as Error).message
  return message === 'fetch failed' ? tr('no connection', 'нет связи') : message
}
