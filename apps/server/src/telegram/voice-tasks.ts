import { randomBytes } from 'node:crypto'
import { InlineKeyboard, type Bot, type Context } from 'grammy'
import type { Message } from 'grammy/types'
import type { Log } from '../log.ts'
import { readJson, writeJson } from '../store.ts'
import { tr } from '../i18n.ts'
import { keepLoud } from './quiet.ts'
import { redact } from './redact.ts'
import { richButtons, type RichButton } from './render.ts'
import { mdText } from './schedule-menu.ts'

// A long voice message often holds several tasks. The list comes first: the owner may want only some of them, and a
// transcript is the one kind of message they can't reread before sending. But they often dictate and go to another
// chat: a card left alone for a minute goes as it was said, and one they started ticking waits for them

// Shorter than this is one thought: no call to the model
export const SPLIT_MIN_CHARS = 200
// Up to three tasks are read at a glance and go as they were said: a card for them only held the owner up
const TASKS_MIN = 4
// More than this is a dictated text rather than a list, and buttons would bury the chat
const TASKS_MAX = 12
const CARDS_KEPT = 20
const LABEL_MAX = 44
export const AUTO_SEND_MS = 60_000
// After a long downtime a card is no longer what the owner is waiting on: it stays for them to decide
const AUTO_STALE_MS = 10 * 60_000

type Card = {
  id: string, tasks: string[], selected: number[], text: string, context: string, msgId: number, shownId?: number, choice?: { messageId: number, md: string }
  chatId?: number, topicId?: number, at?: number, touched?: boolean
}

export const isList = (tasks: string[] | null): tasks is string[] => !!tasks && tasks.length >= TASKS_MIN && tasks.length <= TASKS_MAX

const short = (s: string) => (s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s)

export function cardMarkdown(tasks: string[]) {
  return [
    tr('### 🎙 Several tasks in this voice message', '### 🎙 В этом голосовом несколько задач'),
    tasks.map((t, i) => `${i + 1}. ${mdText(redact(t).text).replace(/\s+/g, ' ')}`).join('\n'),
    tr('_Untick what should wait. Untouched for a minute, it goes as it was said._', '_Сними галочки с того, что подождёт. Не тронешь минуту — отправлю как сказано._'),
  ].join('\n\n')
}

export function cardRows(c: Pick<Card, 'id' | 'tasks' | 'selected'>): RichButton[][] {
  return [
    ...c.tasks.map((t, i): RichButton[] => [{ text: `${c.selected.includes(i) ? '☑️' : '⬜'} ${i + 1}. ${short(redact(t).text)}`, data: `vt:t:${c.id}:${i}` }]),
    [{ text: tr(`▶️ Run selected: ${c.selected.length}`, `▶️ Запустить выбранные: ${c.selected.length}`), data: `vt:go:${c.id}`, style: 'primary' }],
    [{ text: tr('🎙 Send as it was said', '🎙 Отправить как сказано'), data: `vt:raw:${c.id}` }, { text: tr('Cancel', 'Отмена'), data: `vt:no:${c.id}` }],
  ]
}

// What Claude gets for the chosen ones. Left out means left out: the transcript doesn't come along. The note goes in
// brackets, which a topic's name leaves out
export function chosenPrompt(tasks: string[], selected: number[]) {
  const chosen = [...selected].sort((a, b) => a - b).map(i => tasks[i])
  const left = tasks.length - chosen.length
  const note = left
    ? `(From one voice message, which held ${tasks.length} tasks. The user chose these to do now and left the others out on purpose. Recognition errors happen: read for meaning.)`
    : '(From one voice message, split into these tasks. Recognition errors happen: read for meaning.)'
  const list = chosen.length === 1 ? chosen[0] : chosen.map((t, i) => `${i + 1}. ${t}`).join('\n')
  return `🎙 ${list}\n\n${note}`
}

const keyboardOf = (rows: RichButton[][]) => {
  const kb = new InlineKeyboard()
  for (const row of rows) {
    for (const b of row) kb.text(b.text, b.data)
    kb.row()
  }
  return kb
}

export function createVoiceTasks({ bot, file, log, sendChoice, editRich, enqueue, autoMs = AUTO_SEND_MS, now = Date.now }: {
  bot: Bot
  file: string
  log: Log
  sendChoice: (chatId: number, topicId: number | undefined, md: string, rows: RichButton[][], keyboard: InlineKeyboard) => Promise<{ messageId: number, md: string } | null>
  editRich: (chatId: number, messageId: number, md: string) => Promise<boolean>
  enqueue: (chatId: number, topicId: number | undefined, text: string, o: { reply: false, context: string, msgId: number, shownId?: number }) => unknown
  autoMs?: number
  now?: () => number
}) {
  // On disk: a list can wait for the morning, and a restart must not lose what was said in it
  const cards = readJson<Record<string, Card>>(file, {})
  const save = () => writeJson(file, cards)
  const topicOf = (m?: Message | Context['msg']) => (m?.is_topic_message ? m.message_thread_id : undefined)
  const timers = new Map<string, NodeJS.Timeout>()
  const disarm = (id: string) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
  }
  const outcomeMd = (c: Card, outcome: string) => `${c.choice!.md.split('\n\n').slice(0, -1).join('\n\n')}\n\n${outcome}`
  const under = (c: Card) => ({ reply: false, context: c.context, msgId: c.msgId, shownId: c.shownId } as const)

  function arm(c: Card, delay = autoMs) {
    disarm(c.id)
    const timer = setTimeout(() => {
      timers.delete(c.id)
      if (cards[c.id] !== c || c.touched || c.chatId === undefined) return
      delete cards[c.id]
      save()
      log.info('voice list sent as said, untouched', { chatId: c.chatId })
      enqueue(c.chatId, c.topicId, `🎙 ${c.text}`, under(c))
      if (c.choice) editRich(c.chatId, c.choice.messageId, outcomeMd(c, tr('🎙 Sent as it was said: no choice in a minute', '🎙 Отправлено как сказано: за минуту выбора не было'))).catch(() => {})
    }, delay)
    timer.unref?.()
    timers.set(c.id, timer)
  }
  for (const c of Object.values(cards)) {
    if (c.touched || c.at === undefined || now() - c.at > AUTO_STALE_MS) continue
    arm(c, Math.max(0, c.at + autoMs - now()))
  }

  async function offer(chatId: number, topicId: number | undefined, a: Pick<Card, 'tasks' | 'text' | 'context' | 'msgId' | 'shownId'>) {
    const c: Card = { ...a, id: randomBytes(4).toString('hex'), selected: a.tasks.map((_, i) => i), chatId, topicId, at: now() }
    const rows = cardRows(c)
    c.choice = await keepLoud(() => sendChoice(chatId, topicId, cardMarkdown(c.tasks), rows, keyboardOf(rows))) ?? undefined
    cards[c.id] = c
    const ids = Object.keys(cards)
    for (const old of ids.slice(0, Math.max(0, ids.length - CARDS_KEPT))) delete cards[old]
    save()
    arm(c)
    log.info('voice message offered as a list', { chatId, tasks: c.tasks.length })
  }

  const redraw = (ctx: Context, c: Card) => {
    const rows = cardRows(c)
    return c.choice
      ? editRich(ctx.chat!.id, c.choice.messageId, `${c.choice.md}\n\n${richButtons(rows)}`)
      : ctx.editMessageReplyMarkup({ reply_markup: keyboardOf(rows) })
  }

  // The card keeps the list and says what became of it, with no buttons left to press twice
  const settle = (ctx: Context, c: Card, outcome: string) => {
    if (c.choice) return editRich(ctx.chat!.id, c.choice.messageId, outcomeMd(c, outcome))
    return ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(outcome, 'noop') })
  }

  bot.callbackQuery(/^vt:(t|go|raw|no):([0-9a-f]{8})(?::(\d+))?$/, async ctx => {
    const c = cards[ctx.match[2]]
    if (!c) {
      await ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
      return ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(tr('⌛ No longer relevant', '⌛ Неактуально'), 'noop') }).catch(() => {})
    }
    const chatId = ctx.chat!.id
    const topicId = topicOf(ctx.callbackQuery.message)
    const action = ctx.match[1]
    if (action === 't') {
      const i = Number(ctx.match[3])
      if (!c.tasks[i]) return ctx.answerCallbackQuery()
      c.selected = c.selected.includes(i) ? c.selected.filter(x => x !== i) : [...c.selected, i]
      // Choosing: no longer sent by itself
      c.touched = true
      disarm(c.id)
      save()
      await ctx.answerCallbackQuery()
      return redraw(ctx, c)
    }
    if (action === 'go' && !c.selected.length) return ctx.answerCallbackQuery(tr('Tick at least one task', 'Отметь хотя бы одну задачу'))
    delete cards[c.id]
    disarm(c.id)
    save()
    if (action === 'no') {
      await ctx.answerCallbackQuery()
      return settle(ctx, c, tr('❌ Cancelled', '❌ Отменено'))
    }
    log.info('voice list chosen', { chatId, action, of: c.tasks.length, chosen: c.selected.length })
    await ctx.answerCallbackQuery()
    enqueue(chatId, topicId, action === 'raw' ? `🎙 ${c.text}` : chosenPrompt(c.tasks, c.selected), under(c))
    return settle(ctx, c, action === 'raw'
      ? tr('🎙 Sent as it was said', '🎙 Отправлено как сказано')
      : tr(`▶️ Running ${c.selected.length} of ${c.tasks.length}`, `▶️ Запущено: ${c.selected.length} из ${c.tasks.length}`))
  })

  return { offer, stop: () => { for (const id of [...timers.keys()]) disarm(id) } }
}
