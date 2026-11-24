import { InlineKeyboard, type Bot, type Context } from 'grammy'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import type { Message } from 'grammy/types'
import type { Log } from '../log.ts'
import type { Decision, DecisionStore } from '../decisions.ts'
import { MAX_DECISIONS } from '../decisions.ts'
import { createDecisionServer, decisionsBlock, DECISION_SERVER } from '../claude/decision-tools.ts'
import type { WorkspaceStore } from '../workspaces.ts'
import { topicKey } from '../store.ts'
import { pageRow } from './pages.ts'
import { mdText } from './schedule-menu.ts'
import { tr } from '../i18n.ts'

// /decisions and record_decision: the list a workspace shares. The owner sees all of it and removes what is wrong

const PAGE_SIZE = 6
const topicOf = (m?: Message) => (m?.is_topic_message ? m.message_thread_id : undefined)

export const decisionsAbout = () => tr(
  '📌 **Decisions** are a list shared by all topics of a workspace: what you decided, Claude keeps in mind in every topic there. A workspace is a group with topics: /workspace. There is no such list in a private chat.',
  '📌 **Решения** — это общий список всех топиков воркспейса: что ты решил, Claude помнит в каждом его топике. Воркспейс — это группа с топиками: /workspace. В личном чате такого списка нет.',
)

// Newest first: the last pages are what got old. Numbers count from the top of the whole list and change as it does,
// so buttons carry the id
export function decisionsPage(all: Decision[], title: string, wanted: number) {
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE))
  const page = Math.min(Math.max(wanted, 0), pages - 1)
  const newest = [...all].reverse()
  const shown = newest.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const number = (i: number) => page * PAGE_SIZE + i + 1
  const md = [
    `### 📌 ${tr('Decisions', 'Решения')}: ${mdText(title)}`,
    all.length
      ? shown.map((d, i) => `${number(i)}. ${d.date} · ${mdText(d.text)}`).join('\n')
      : tr('None yet. When you decide something in a topic here, Claude writes it down and every topic reads it.', 'Пока пусто. Когда ты что-то решаешь в одном из топиков, Claude записывает это, и это читают все топики.'),
    ...(all.length ? [tr('All topics of this workspace read this list. 🗑 and a number removes one.', 'Этот список читают все топики воркспейса. 🗑 с номером убирает решение.')] : []),
  ].join('\n\n')
  // Numbers on the buttons, never the text: only the text of a message gets masked
  const kb = new InlineKeyboard()
  shown.forEach((d, i) => {
    kb.text(`🗑 ${number(i)}`, `dec:ask:${d.id}:${page}`)
    if (i % 3 === 2) kb.row()
  })
  kb.row()
  for (const p of pageRow(page, pages)) kb.text(p.label, `dec:pg:${p.page}`)
  // An empty list has no buttons at all, not an empty row
  return { md, kb: new InlineKeyboard(kb.inline_keyboard.filter(r => r.length)), page }
}

export function createDecisionsMenu({ bot, store, workspaces, log, today, masked, sendRich, editRich, ownerSpoke }: {
  bot: Bot
  store: DecisionStore
  workspaces: WorkspaceStore
  log: Log
  today: () => string
  masked: (chatId: number, topicId: number | undefined, text: string) => string
  sendRich: (chatId: number, topicId: number | undefined, md: string, extra?: { reply_markup?: InlineKeyboard }) => Promise<unknown>
  editRich: (chatId: number, messageId: number, md: string, media?: undefined, keyboard?: InlineKeyboard['inline_keyboard']) => Promise<boolean>
  // Whether the messages this turn answers include the owner's own: a letter from another topic, a head's task or a
  // scheduled run has none of them
  ownerSpoke: (key: string) => boolean
}) {
  const titleOf = (chatId: number) => workspaces.get(chatId)?.title ?? ''

  bot.command('decisions', ctx => {
    const chatId = ctx.chat.id
    const topicId = topicOf(ctx.msg)
    if (!workspaces.get(chatId)) return sendRich(chatId, topicId, decisionsAbout())
    const { md, kb } = decisionsPage(store.list(chatId), titleOf(chatId), 0)
    return sendRich(chatId, topicId, md, { reply_markup: kb })
  })

  const redraw = (ctx: Context, chatId: number, page: number) => {
    const { md, kb } = decisionsPage(store.list(chatId), titleOf(chatId), page)
    return editRich(chatId, ctx.callbackQuery!.message!.message_id, masked(chatId, topicOf(ctx.callbackQuery!.message as Message), md), undefined, kb.inline_keyboard)
  }

  bot.callbackQuery(/^dec:(pg|ask|rm):(?:([0-9a-f]+):)?(\d+)$/, async ctx => {
    const chatId = ctx.chat!.id
    if (!workspaces.get(chatId) || !ctx.callbackQuery.message) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    const [, what, id, pageText] = ctx.match
    const page = Number(pageText)
    if (what === 'pg') {
      await ctx.answerCallbackQuery()
      return redraw(ctx, chatId, page)
    }
    if (what === 'rm') {
      const removed = !!id && store.remove(chatId, id)
      if (removed) log.info('decision removed', { chatId, id })
      await ctx.answerCallbackQuery(removed ? tr('Removed', 'Убрано') : tr('Already gone', 'Уже нет в списке'))
      return redraw(ctx, chatId, page)
    }
    const decision = store.list(chatId).find(d => d.id === id)
    if (!decision) {
      await ctx.answerCallbackQuery(tr('Already gone', 'Уже нет в списке'))
      return redraw(ctx, chatId, page)
    }
    await ctx.answerCallbackQuery()
    // A tap away from gone for every topic, and the buttons stand close together on a phone: one more tap
    const kb = new InlineKeyboard()
      .text(tr('🗑 Yes, remove', '🗑 Да, убрать'), `dec:rm:${decision.id}:${page}`)
      .text(tr('← Back', '← Назад'), `dec:pg:${page}`)
    const md = `**${tr('Remove this decision?', 'Убрать это решение?')}**\n\n${decision.date} · ${mdText(decision.text)}`
    return editRich(chatId, ctx.callbackQuery.message.message_id, masked(chatId, topicOf(ctx.callbackQuery.message as Message), md), undefined, kb.inline_keyboard)
  })

  async function record(chatId: number, topicId: number | undefined, text: string) {
    if (!workspaces.get(chatId)) return 'Not recorded: this topic is not in a workspace.'
    if (!ownerSpoke(topicKey(chatId, topicId))) return 'Not recorded: this turn answers another topic, a scheduled task or the bot, not the user\'s own words. A decision has to come from the user: ask them.'
    const r = store.add(chatId, text, today(), titleOf(chatId))
    if ('problem' in r) {
      if (r.problem === 'same') return 'Already recorded.'
      if (r.problem === 'full') return `Not recorded: the list holds ${MAX_DECISIONS} decisions, its limit. Tell the user to remove some with /decisions.`
      return 'Not recorded: the text is empty.'
    }
    log.info('decision recorded', { chatId, topicId, id: r.added.id })
    await sendRich(chatId, topicId, tr(`📌 **Decision recorded:** ${mdText(r.added.text)}\n\nAll of them: /decisions`, `📌 **Решение записано:** ${mdText(r.added.text)}\n\nВсе решения: /decisions`))
      .catch(e => log.warn('decision note', (e as Error).message))
    return 'Recorded. The topic shows the user what was recorded; every topic of this workspace reads it from its next turn.'
  }

  return {
    record,
    // Nothing outside a workspace: no list, no tool
    servers(chatId: number, topicId: number | undefined): Record<string, McpSdkServerConfigWithInstance> {
      return workspaces.get(chatId) ? { [DECISION_SERVER]: createDecisionServer(text => record(chatId, topicId, text)) } : {}
    },
    promptBlock: (chatId: number) => (workspaces.get(chatId) ? decisionsBlock(store.list(chatId)) : ''),
  }
}
