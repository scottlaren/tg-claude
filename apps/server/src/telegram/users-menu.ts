import { InlineKeyboard, type Bot, type Context } from 'grammy'
import type { Message } from 'grammy/types'
import type { Log } from '../log.ts'
import type { Owners } from '../owners.ts'
import type { RichButton } from './render.ts'
import type { Choice } from './bot.ts'
import { mdText } from './schedule-menu.ts'
import { tr } from '../i18n.ts'

// /users: which Telegram accounts the bot answers. Only the main account manages the list, and every account on it
// has the run of the computers, so adding one is always confirmed. A bot can't look a person up or write first: an
// account goes on the list by its id and has access from its first message

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const where = (topicId?: number) => (topicId ? { message_thread_id: topicId } : {})
const topicOf = (m?: Message) => (m?.is_topic_message ? m.message_thread_id : undefined)
const HTML = { parse_mode: 'HTML' } as const
const WAIT_MS = 10 * 60_000

// What the owner can send for an account: its numeric id. An @name can't work: a bot can't look people up by it
export const parseUserId = (text: string) => (/^\d{5,15}$/.test(text.trim()) ? Number(text.trim()) : null)

export type Account = { id: number, name?: string, username?: string, isMain: boolean, fromEnv: boolean }

const accountName = (a: Pick<Account, 'id' | 'name' | 'username'>) => [a.name, a.username && `@${a.username}`].filter(Boolean).join(' ') || String(a.id)

export function usersText(accounts: Account[]) {
  const rows = accounts.map(a => {
    const tags = [a.isMain && tr('main', 'главный'), a.fromEnv && !a.isMain && tr('from .env', 'из .env'), !a.name && tr("hasn't written yet", 'ещё не писал')].filter(Boolean).join(', ')
    return `${a.isMain ? '👑' : '👤'} <b>${esc(accountName(a))}</b> · <code>${a.id}</code>${tags ? ` · ${tags}` : ''}`
  })
  return [
    `<b>${tr('Who the bot answers', 'Кому отвечает бот')}</b>`,
    rows.join('\n'),
    `<i>${tr('Every account here has the run of your computers and projects and spends your Claude limits.', 'У каждого аккаунта в списке полный доступ к твоим компьютерам и проектам, и он тратит твои лимиты Claude.')}</i>`,
  ].join('\n\n')
}

export function usersKeyboard(accounts: Account[]) {
  const kb = new InlineKeyboard()
  for (const a of accounts) if (!a.isMain && !a.fromEnv) kb.text(`🗑 ${accountName(a).slice(0, 30)}`, `usr:rm:${a.id}`).row()
  return kb.text(tr('➕ Add an account', '➕ Добавить аккаунт'), 'usr:add')
}

export function createUsersMenu({ bot, owners, log, dropChat, sendChoice, editRich }: {
  bot: Bot
  owners: Owners
  log: Log
  // The account is out: nothing of it may go on running
  dropChat: (chatId: number) => void
  sendChoice: (chatId: number, topicId: number | undefined, md: string, rows: RichButton[][], keyboard: InlineKeyboard) => Promise<Choice | null>
  editRich: (chatId: number, messageId: number, md: string) => Promise<boolean>
}) {
  const { api } = bot
  // The main account's chat, while an account to add is expected: from its next message there, or from the account
  // itself writing to the bot. Outside these minutes strangers are ignored, and never bother the owner
  const waits = new Map<number, { since: number, topicId?: number }>()
  const asked = new Map<string, Choice>()
  // What the owner was actually asked: access is never given or taken by data on a button alone
  const offered = new Set<string>()

  const isMain = (ctx: Context) => !!ctx.from && owners.isMain(ctx.from.id)
  async function accounts(): Promise<Account[]> {
    return Promise.all(owners.ids().map(async id => {
      // Telegram only tells a bot about those who have written to it
      const chat = await api.getChat(id).catch(() => null)
      const c = chat as { first_name?: string, last_name?: string, username?: string } | null
      return { id, name: [c?.first_name, c?.last_name].filter(Boolean).join(' ') || undefined, username: c?.username, isMain: owners.isMain(id), fromEnv: owners.isFromEnv(id) }
    }))
  }
  async function showList(chatId: number, topicId: number | undefined) {
    const list = await accounts()
    return api.sendMessage(chatId, usersText(list), { ...where(topicId), ...HTML, reply_markup: usersKeyboard(list) })
  }

  bot.command('users', ctx => {
    if (!isMain(ctx)) return ctx.reply(tr('Only the main account manages this list.', 'Этим списком управляет только главный аккаунт.'), where(topicOf(ctx.msg)))
    return showList(ctx.chat.id, topicOf(ctx.msg))
  })

  bot.callbackQuery('usr:add', async ctx => {
    if (!isMain(ctx)) return ctx.answerCallbackQuery()
    const topicId = topicOf(ctx.callbackQuery.message as Message | undefined)
    waits.set(ctx.chat!.id, { since: Date.now(), topicId })
    await ctx.answerCallbackQuery()
    await api.sendMessage(ctx.chat!.id, tr(
      'Write anything to this bot from that account in the next 10 minutes, and I\'ll ask you here. Or send its numeric <b>Telegram ID</b> or a message forwarded from it.',
      'Напиши что угодно этому боту с нужного аккаунта в ближайшие 10 минут, и я спрошу тебя здесь. Или пришли его числовой <b>Telegram ID</b> либо пересланное от него сообщение.',
    ), { ...where(topicId), ...HTML, reply_markup: new InlineKeyboard().text(tr('Cancel', 'Отмена'), 'usr:cancel') })
  })

  bot.callbackQuery('usr:cancel', async ctx => {
    waits.delete(ctx.chat!.id)
    await ctx.answerCallbackQuery(tr('Cancelled', 'Отменено'))
    await ctx.editMessageText(tr('Nothing changed.', 'Ничего не изменилось.')).catch(() => {})
  })

  async function confirmAdd(chatId: number, topicId: number | undefined, id: number, name?: string) {
    waits.delete(chatId)
    if (owners.has(id)) return api.sendMessage(chatId, tr('This account is already on the list.', 'Этот аккаунт уже в списке.'), where(topicId))
    offered.add(`add:${id}`)
    const yes = tr('Give access', 'Дать доступ')
    const no = tr('Cancel', 'Отмена')
    const who = mdText(name ?? String(id))
    const md = tr(
      `**Give ${who} access?** ID \`${id}\`. This account will have the run of your computers and projects and spend your Claude limits.`,
      `**Дать доступ: ${who}?** ID \`${id}\`. У этого аккаунта будет полный доступ к твоим компьютерам и проектам, и он будет тратить твои лимиты Claude.`,
    )
    const choice = await sendChoice(chatId, topicId, md, [[{ text: yes, data: `usr:yes:${id}`, style: 'primary' }, { text: no, data: `usr:no:${id}` }]], new InlineKeyboard().text(yes, `usr:yes:${id}`).text(no, `usr:no:${id}`))
    if (choice) asked.set(`add:${id}`, choice)
  }

  const settle = async (ctx: Context, key: string, note: string) => {
    const c = asked.get(key)
    asked.delete(key)
    if (c) return editRich(ctx.chat!.id, c.messageId, `${c.md}\n\n> ${note}`)
    return ctx.editMessageText(note).catch(() => {})
  }

  bot.callbackQuery(/^usr:yes:(\d+)$/, async ctx => {
    if (!isMain(ctx)) return ctx.answerCallbackQuery()
    const id = Number(ctx.match[1])
    if (!offered.delete(`add:${id}`)) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    owners.add(id)
    log.info('account added', { id })
    await ctx.answerCallbackQuery(tr('Added', 'Добавлен'))
    await settle(ctx, `add:${id}`, tr(`✅ **Added.** It has access from its first message: t.me/${ctx.me.username}. The list: /users.`, `✅ **Добавлен.** Доступ заработает с первого сообщения: t.me/${ctx.me.username}. Список: /users.`))
  })

  bot.callbackQuery(/^usr:no:(\d+)$/, async ctx => {
    offered.delete(`add:${ctx.match[1]}`)
    await ctx.answerCallbackQuery(tr('Cancelled', 'Отменено'))
    await settle(ctx, `add:${ctx.match[1]}`, tr('Nothing changed.', 'Ничего не изменилось.'))
  })

  bot.callbackQuery(/^usr:rm:(\d+)$/, async ctx => {
    if (!isMain(ctx)) return ctx.answerCallbackQuery()
    const id = Number(ctx.match[1])
    if (!owners.removable(id)) return ctx.answerCallbackQuery(tr("This account can't be removed here", 'Этот аккаунт здесь убрать нельзя'))
    await ctx.answerCallbackQuery()
    const topicId = topicOf(ctx.callbackQuery.message as Message | undefined)
    offered.add(`rm:${id}`)
    const yes = tr('🗑 Yes, remove', '🗑 Да, убрать')
    const no = tr('Cancel', 'Отмена')
    const md = tr(
      `**Remove the account \`${id}\`?** The bot stops answering it at once, its running task stops and its scheduled tasks are deleted. Its topics stay, and the bot leaves the groups this account added.`,
      `**Убрать аккаунт \`${id}\`?** Бот сразу перестанет ему отвечать, идущая задача остановится, а задачи по расписанию удалятся. Бот выйдет из групп, которые этот аккаунт добавил. Его топики останутся.`,
    )
    const choice = await sendChoice(ctx.chat!.id, topicId, md, [[{ text: yes, data: `usr:drop:${id}`, style: 'danger' }, { text: no, data: `usr:keep:${id}` }]], new InlineKeyboard().text(yes, `usr:drop:${id}`).text(no, `usr:keep:${id}`))
    if (choice) asked.set(`rm:${id}`, choice)
  })

  bot.callbackQuery(/^usr:drop:(\d+)$/, async ctx => {
    if (!isMain(ctx)) return ctx.answerCallbackQuery()
    const id = Number(ctx.match[1])
    if (!offered.delete(`rm:${id}`)) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    if (!owners.remove(id)) return ctx.answerCallbackQuery(tr("This account can't be removed here", 'Этот аккаунт здесь убрать нельзя'))
    dropChat(id)
    log.info('account removed', { id })
    await ctx.answerCallbackQuery(tr('Removed', 'Убран'))
    await settle(ctx, `rm:${id}`, tr('**Removed.** The list: /users.', '**Убран.** Список: /users.'))
  })

  bot.callbackQuery(/^usr:keep:(\d+)$/, async ctx => {
    await ctx.answerCallbackQuery(tr('Cancelled', 'Отменено'))
    await settle(ctx, `rm:${ctx.match[1]}`, tr('Nothing changed.', 'Ничего не изменилось.'))
  })

  return {
    // The main account's next text, after “Add”; a command calls it off
    waiting(chatId: number) {
      const wait = waits.get(chatId)
      if (!wait) return false
      if (Date.now() - wait.since <= WAIT_MS) return true
      waits.delete(chatId)
      return false
    },
    // Someone not on the list wrote to the bot: while the owner expects an account, they are asked about this one
    async stranger(u: { id: number, first_name?: string, last_name?: string, username?: string }) {
      for (const chatId of [...waits.keys()]) {
        if (!owners.isMain(chatId) || !this.waiting(chatId)) continue
        const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username
        return confirmAdd(chatId, waits.get(chatId)?.topicId, u.id, name)
      }
    },
    cancel: (chatId: number) => waits.delete(chatId),
    async receive(chatId: number, topicId: number | undefined, m: Message.TextMessage) {
      const origin = m.forward_origin
      if (origin?.type === 'user') return confirmAdd(chatId, topicId, origin.sender_user.id, [origin.sender_user.first_name, origin.sender_user.last_name].filter(Boolean).join(' '))
      if (origin?.type === 'hidden_user') {
        await api.sendMessage(chatId, tr('This account hides its ID in forwarded messages: write to the bot from it, or send the ID.', 'Этот аккаунт скрывает ID в пересланных сообщениях: напиши боту с него или пришли ID.'), where(topicId))
        return
      }
      const id = parseUserId(m.text)
      if (id) return confirmAdd(chatId, topicId, id)
      await api.sendMessage(chatId, tr("A bot can't look people up by @name: write to the bot from that account, or send its numeric ID.", 'По @имени бот искать не умеет: напиши боту с этого аккаунта или пришли числовой ID.'), where(topicId))
    },
  }
}
