import { AsyncLocalStorage } from 'node:async_hooks'
import { InlineKeyboard, type Bot } from 'grammy'
import type { Message } from 'grammy/types'
import type { Log } from '../log.ts'
import { readJson, writeJson } from '../store.ts'
import { tr } from '../i18n.ts'

// /quiet: one switch for a chat and all its topics. While it is on, everything the bot sends arrives without a push
// except what is marked here: a decision to make, a task that failed, the answer that says it is over. One place for it,
// so a message added later is silent by default instead of waking someone up

const loudness = new AsyncLocalStorage<boolean>()
// Whatever fn sends, however deep and however late, keeps its push
export const keepLoud = <T>(fn: () => T): T => loudness.run(true, fn)
// The same undone: the second of two messages that say one thing
export const keepSilent = <T>(fn: () => T): T => loudness.run(false, fn)

const SENDS = new Set(['sendMessage', 'sendRichMessage', 'sendPhoto', 'sendDocument', 'sendVideo', 'sendAnimation', 'sendAudio', 'sendVoice', 'sendVideoNote', 'sendSticker', 'sendMediaGroup', 'copyMessage', 'forwardMessage'])

type Prev = (method: string, payload: Record<string, unknown>, signal?: AbortSignal) => unknown

export function quietTransformer(on: (chatId: number) => boolean) {
  // Typed loosely like the other transformers here: grammY's own type is generic over every method
  return ((prev: Prev, method: string, payload: Record<string, unknown>, signal?: AbortSignal) => {
    const silent = SENDS.has(method) && !loudness.getStore() && typeof payload.chat_id === 'number' && on(payload.chat_id)
    return prev(method, silent ? { ...payload, disable_notification: true } : payload, signal)
  }) as never
}

// Only chats it is on for are kept, also across restarts
export function createQuietStore(file: string) {
  const data = readJson<Record<string, true>>(file, {})
  return {
    on: (chatId: number) => !!data[chatId],
    set(chatId: number, on: boolean) {
      if (on) data[chatId] = true
      else delete data[chatId]
      writeJson(file, data)
    },
  }
}

export type QuietStore = ReturnType<typeof createQuietStore>

const topicOf = (m?: Message) => (m?.is_topic_message ? m.message_thread_id : undefined)

export const quietLabel = (on: boolean) => (on ? tr('on', 'включён') : tr('off', 'выключен'))

export function quietCard(on: boolean) {
  const md = [
    tr(`### 🔕 Quiet mode: ${quietLabel(on)}`, `### 🔕 Тихий режим: ${quietLabel(on)}`),
    tr('A sound only when:\n- you are needed: a permission, a question, a survey\n- a task failed\n- a topic gives its final answer', 'Звук только когда:\n- нужен ты: разрешение, вопрос, опрос\n- задача упала\n- топик дал итоговый ответ'),
    `<footer>${tr("Everything else arrives without a push. An agent's answer and report are silent too: the head's answer tells you", 'Всё остальное приходит без звука. Ответ и отчёт агента тоже тихие: сообщит ответ хеда')}</footer>`,
  ].join('\n\n')
  const kb = new InlineKeyboard().text(on ? tr('🔔 Turn off', '🔔 Выключить') : tr('🔕 Turn on', '🔕 Включить'), `qt:${on ? 'off' : 'on'}`)
  return { md, kb }
}

export function createQuietMenu({ bot, quiet, log, sendRich, editRich }: {
  bot: Bot
  quiet: QuietStore
  log: Log
  sendRich: (chatId: number, topicId: number | undefined, md: string, extra?: { reply_markup?: InlineKeyboard }) => Promise<unknown>
  editRich: (chatId: number, messageId: number, md: string, media?: undefined, keyboard?: InlineKeyboard['inline_keyboard']) => Promise<boolean>
}) {
  bot.command('quiet', ctx => {
    const { md, kb } = quietCard(quiet.on(ctx.chat.id))
    return sendRich(ctx.chat.id, topicOf(ctx.msg), md, { reply_markup: kb })
  })

  // The button says which way, so a second tap on an old message changes nothing
  bot.callbackQuery(/^qt:(on|off)$/, async ctx => {
    const chatId = ctx.chat!.id
    const on = ctx.match[1] === 'on'
    quiet.set(chatId, on)
    log.info('quiet mode', { chatId, on })
    await ctx.answerCallbackQuery(on ? tr('🔕 Quiet mode on', '🔕 Тихий режим включён') : tr('🔔 Quiet mode off', '🔔 Тихий режим выключен'))
    const message = ctx.callbackQuery.message
    if (!message) return
    const { md, kb } = quietCard(on)
    await editRich(chatId, message.message_id, md, undefined, kb.inline_keyboard)
  })
}
