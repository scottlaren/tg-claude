import { InlineKeyboard, type Bot, type Context } from 'grammy'
import type { Message } from 'grammy/types'
import type { Log } from '../log.ts'
import type { Gateway } from '../gateway.ts'
import type { Owners } from '../owners.ts'
import { MODES, type Mode } from '../store.ts'
import type { ModelCatalog } from '../models.ts'
import { groupProjects } from './computers.ts'
import { setGroupAvatar } from './avatar.ts'
import type { Workspace, WorkspaceStore } from '../workspaces.ts'
import { richButtons, type RichButton } from './render.ts'
import type { Choice } from './bot.ts'
import { mdText } from './schedule-menu.ts'
import { quietLabel } from './quiet.ts'
import { tr } from '../i18n.ts'

// /workspace: in a private chat the list and a button to add a group, in a group its settings. A bot can't create a
// group or turn topics on, so those two steps stay the user's; the button brings the bot in with its rights set

const where = (topicId?: number) => (topicId ? { message_thread_id: topicId } : {})
const topicOf = (m?: Message) => (m?.is_topic_message ? m.message_thread_id : undefined)
const ANONYMOUS_HINT_MS = 3600_000
const LEAVING_GRACE_MS = 15_000
const PROJECTS_SHOWN = 16
const NONE = '-'
export const WORKSPACE_START = 'ws'
export const WORKSPACE_NEW = 'ws:new'
// The same as in companion.ts, which this file can't import without a circle
const COMPANION_NEW = 'cmp:new'

export const isPlainGroup = (chat: { type: string, is_forum?: boolean }) => chat.type !== 'supergroup' || !chat.is_forum

export function workspaceProblem(chat: { type: string, is_forum?: boolean }, me: { status: string, can_manage_topics?: boolean, can_delete_messages?: boolean }) {
  // Only an admin bot gets a group's ordinary messages, and with no topics there is nothing else it needs
  if (isPlainGroup(chat)) {
    if (me.status === 'creator' || me.status === 'administrator') return null
    return tr('Make me an admin of this group: without that I only see commands. Then send /workspace here.', 'Сделай меня админом этой группы: иначе я вижу только команды. Потом отправь здесь /workspace.')
  }
  const admin = me.status === 'creator' || (me.status === 'administrator' && me.can_manage_topics && me.can_delete_messages)
  return admin ? null : tr('Make me an admin who can manage topics and delete messages. Then send /workspace here.', 'Сделай меня админом с правами на управление топиками и удаление сообщений. Потом отправь здесь /workspace.')
}

export function addLink(username: string) {
  return `https://t.me/${username}?startgroup=${WORKSPACE_START}&admin=manage_topics+delete_messages+change_info`
}

// A supergroup's id is its public number with -100 in front
export const groupLink = (chatId: number) => `https://t.me/c/${String(chatId).replace(/^-100/, '')}/1`
// A basic group has no links at all
const groupLine = (w: { chatId: number, title: string }) => (String(w.chatId).startsWith('-100') ? `[${mdText(w.title)}](${groupLink(w.chatId)})` : mdText(w.title))

export function workspaceCard(w: Workspace, names: { device?: string, project?: string, model?: string }, members = 2, _shift = false, quiet = false) {
  const inTopic = w.plain ? tr('asked at the first message', 'спрошу при первом сообщении') : tr('chosen in each topic', 'выбирается в топике')
  const md = [
    `### 🗂 ${mdText(w.title)}`,
    [
      `- 💻 ${tr('Computer', 'Компьютер')}: **${names.device ?? inTopic}**`,
      `- 📁 ${tr('Project', 'Проект')}: **${names.project ?? inTopic}**`,
      `- 🔐 ${tr('Permissions', 'Разрешения')}: **${w.mode ? MODES[w.mode] : tr('ask', 'спрашивать')}**`,
      `- 🧠 ${tr('Model', 'Модель')}: **${names.model ?? tr('default', 'по умолчанию')}**`,
      `- 🔕 ${tr('Quiet mode', 'Тихий режим')}: **${quietLabel(quiet)}** · /quiet`,
    ].join('\n'),
    w.plain
      ? tr('The whole group is one conversation: just write here. Turn on Topics in its settings to get topics and agents.', 'Вся группа — один разговор: просто пиши здесь. Включишь в настройках «Темы» — появятся топики и агенты.')
      : tr('New topics start with these settings: just write in one.', 'Новые топики сразу берут эти настройки: просто напиши в новом.'),
    ...(members > 2 ? [tr(`⚠️ Everyone in this group (${members}) reads what Claude writes here, though only accounts from /users can give it tasks.`, `⚠️ Всё, что пишет здесь Claude, читают все участники группы (${members}), хотя задачи ему дают только аккаунты из /users.`)] : []),
  ].join('\n\n')
  const rows: RichButton[][] = [
    [{ text: tr('💻 Computer', '💻 Компьютер'), data: 'ws:dev' }, { text: tr('📁 Project', '📁 Проект'), data: 'ws:prj' }],
    [{ text: tr('🔐 Permissions', '🔐 Разрешения'), data: 'ws:mod' }, { text: tr('🧠 Model', '🧠 Модель'), data: 'ws:mdl' }],
  ]
  return { md, rows }
}

// The same buttons for when Telegram refuses rich ones
const keyboardOf = (rows: RichButton[][]) => {
  const kb = new InlineKeyboard()
  for (const row of rows) {
    for (const b of row) kb.text(b.text, b.data)
    kb.row()
  }
  return kb
}

export function createWorkspaceMenu({ bot, owners, workspaces, models, gateway, log, sendChoice, editRich, sendRich, dropChat, canMove, nightOn, quietOn, applied, topicsChanged, companions = () => [] }: {
  // Groups where the bot only talks: listed next to the workspaces, each owner seeing their own
  companions?: () => { chatId: number, key: string, title: string, owner: number, on: boolean }[]
  bot: Bot
  owners: Owners
  workspaces: WorkspaceStore
  models: ModelCatalog
  gateway: Gateway
  log: Log
  sendChoice: (chatId: number, topicId: number | undefined, md: string, rows: RichButton[][], keyboard: InlineKeyboard) => Promise<Choice | null>
  editRich: (chatId: number, messageId: number, md: string) => Promise<boolean>
  sendRich: (chatId: number, topicId: number | undefined, md: string, extra?: { reply_markup?: InlineKeyboard }) => Promise<unknown>
  dropChat: (chatId: number) => void
  canMove: (chatId: number, topicId: number) => boolean
  nightOn: (chatId: number) => boolean
  quietOn: (chatId: number) => boolean
  // The card changed: a group with no topics has one conversation for it to apply to
  applied: (chatId: number) => void
  topicsChanged: (chatId: number, plain: boolean) => void
}) {
  const { api } = bot
  const hinted = new Map<number, number>()
  // A basic group that left for its new id can look as if the bot was removed. The move, which says so, comes right behind
  const leaving = new Map<number, NodeJS.Timeout>()
  const gone = (chatId: number) => {
    if (workspaces.get(chatId)) log.info('workspace gone', { chatId })
    // Its tasks would go on working on the computers with nowhere to report
    dropChat(chatId)
    workspaces.remove(chatId)
  }

  const names = (w: Workspace) => {
    const device = w.deviceId ? gateway.device(w.deviceId) : undefined
    return {
      device: w.deviceId ? device?.name ?? w.deviceId : undefined,
      project: w.projectId ? device?.projects.find(p => p.id === w.projectId)?.name ?? w.projectId : undefined,
      model: w.model ? models.label(w.model) : undefined,
    }
  }
  const card = async (chatId: number, w: Workspace) => workspaceCard(w, names(w), await api.getChatMemberCount(chatId).catch(() => 2), nightOn(chatId), quietOn(chatId))

  // Sets the group up, or says what it still lacks. Asked by the user, it also shows the settings of a group already set up
  async function setup(chatId: number, topicId: number | undefined, from: number, asked: boolean) {
    const [chat, me] = await Promise.all([api.getChat(chatId), api.getChatMember(chatId, bot.botInfo.id)])
    const problem = workspaceProblem(chat, me as Parameters<typeof workspaceProblem>[1])
    if (problem) return api.sendMessage(chatId, problem, where(topicId))
    const title = chat.title ?? tr('Workspace', 'Воркспейс')
    const known = workspaces.get(chatId)
    if (known && !asked) return
    const plain = isPlainGroup(chat)
    if (known) workspaces.update(chatId, { title, plain })
    else {
      workspaces.add(chatId, { title, addedBy: from, plain })
      log.info('workspace added', { chatId, by: from, plain })
    }
    if (!!known?.plain !== plain) topicsChanged(chatId, plain)
    const { md, rows } = await card(chatId, workspaces.get(chatId)!)
    const sent = await sendChoice(chatId, topicId, md, rows, keyboardOf(rows))
    if (!known) await setGroupAvatar(api, log, chat)
    return sent
  }

  // Added to a group, the bot asks what it is there for before it becomes anything: a chat of other people is no place
  // for the owner's projects, and a card about computers and permissions would be the first thing they all see
  function offer(chatId: number) {
    const rows: RichButton[][] = [[{ text: tr('🗂 Workspace', '🗂 Воркспейс'), data: WORKSPACE_NEW }], [{ text: tr('💬 Companion', '💬 Собеседник'), data: COMPANION_NEW }]]
    return sendChoice(chatId, undefined, [
      tr('### 👋 What am I here for?', '### 👋 Зачем я здесь?'),
      [
        tr('- 🗂 **Workspace**: your projects and agents. Only you give me tasks.', '- 🗂 **Воркспейс**: твои проекты и агенты. Задачи даёшь только ты.'),
        tr('- 💬 **Companion**: I answer everyone in the chat when they address me. No computers, files or commands: I only talk.', '- 💬 **Собеседник**: отвечаю всем в чате, когда ко мне обращаются. Без компьютеров, файлов и команд: только разговор.'),
      ].join('\n'),
      tr('The one who added me chooses.', 'Выбирает тот, кто меня добавил.'),
    ].join('\n\n'), rows, keyboardOf(rows))
  }

  bot.callbackQuery(WORKSPACE_NEW, async ctx => {
    const chat = ctx.chat
    if (!chat || chat.type === 'private' || !owners.has(ctx.from.id)) return ctx.answerCallbackQuery()
    if (workspaces.get(chat.id) || companions().some(c => c.chatId === chat.id)) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    await ctx.answerCallbackQuery()
    const asked = ctx.callbackQuery.message
    if (asked) await api.deleteMessage(chat.id, asked.message_id).catch(() => {})
    await setup(chat.id, topicOf(asked as Message | undefined), ctx.from.id, true)
  })

  function showList(ctx: Context) {
    const list = workspaces.list()
    const chats = ctx.chat!.type === 'private' ? companions().filter(c => c.owner === ctx.from?.id) : []
    const topicId = topicOf(ctx.msg as Message | undefined)
    // A topic needs a group with topics to move to
    const targets = list.filter(w => !w.plain)
    const movable = !!topicId && targets.length > 0 && canMove(ctx.chat!.id, topicId)
    const kb = new InlineKeyboard()
    // An ordinary keyboard: a group's id can pass for a card number, and only the text of a message gets masked
    if (movable) for (const w of targets) kb.text(tr(`➡️ Move this topic to ${w.title}`, `➡️ Перенести этот топик в ${w.title}`), `wm:${w.chatId}`).row()
    for (const c of chats) kb.text(`💬 ${c.title}${c.on ? '' : tr(' · off', ' · выключен')}`, `cmp:${c.key}:home`).row()
    kb.url(tr('➕ Add a group', '➕ Добавить группу'), addLink(bot.botInfo.username))
    return sendRich(ctx.chat!.id, topicId, [
      tr('### 🗂 Workspaces', '### 🗂 Воркспейсы'),
      tr('A workspace is a group: its projects and agents live apart from everything else. With no topics, the whole group is one conversation.', 'Воркспейс — это группа: её проекты и агенты живут отдельно от всего остального. Без тем вся группа — один разговор.'),
      list.length ? list.map(w => `- ${groupLine(w)}${nightOn(w.chatId) ? ' 🌙' : ''}`).join('\n') : tr('None yet.', 'Пока нет ни одного.'),
      `🔕 ${tr('Quiet mode in this chat', 'Тихий режим в этом чате')}: **${quietLabel(quietOn(ctx.chat!.id))}** · /quiet`,
      `**${tr('To add one', 'Как добавить')}**`,
      [
        tr('1. Create a group. For several conversations and agents, turn on Topics in its settings.', '1. Создай группу. Для нескольких разговоров и агентов включи в её настройках «Темы».'),
        tr('2. Tap the button and choose that group: I join with the rights I need.', '2. Нажми кнопку и выбери эту группу: я войду с нужными правами.'),
        tr('3. In the group I ask what I am there for. A chat with other people is a 💬 companion: I answer everyone who addresses me, and have no computer, file or command there.', '3. В группе я спрошу, зачем я здесь. Чат с другими людьми — это 💬 собеседник: отвечаю всем, кто ко мне обращается, без компьютеров, файлов и команд.'),
      ].join('\n'),
      ...(chats.length ? [tr('💬 The buttons below open the settings of your companion chats.', '💬 Кнопки ниже открывают настройки твоих чатов-собеседников.')] : []),
      ...(movable ? [tr('Moving carries the conversation over: Claude remembers it, but the messages stay here.', 'При переносе разговор переезжает: Claude его помнит, а сообщения остаются здесь.')] : []),
      tr('Answers in a group appear whole, with a live status while Claude works: Telegram has no drafts there.', 'В группе ответ приходит целиком, а пока Claude работает, виден живой статус: черновиков там у Telegram нет.'),
    ].join('\n\n'), { reply_markup: kb })
  }

  bot.command('workspace', ctx => {
    if (ctx.chat.type === 'private') return showList(ctx)
    return setup(ctx.chat.id, topicOf(ctx.msg), ctx.from!.id, true)
  })

  // One message: each tap redraws it, and a choice goes back to the card
  bot.callbackQuery(/^ws:(home|dev|prj|mod|mdl)(?::([\w.[\]-]+))?$/, async ctx => {
    const chatId = ctx.chat!.id
    const w = workspaces.get(chatId)
    const messageId = ctx.callbackQuery.message?.message_id
    if (!w || !messageId) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    const [, what, value] = ctx.match
    const draw = (md: string, rows: RichButton[][]) => editRich(chatId, messageId, `${md}\n\n${richButtons(rows)}`)
    const home = async () => {
      const { md, rows } = await card(chatId, workspaces.get(chatId)!)
      return draw(md, rows)
    }
    const list = (title: string, options: RichButton[]) => draw(`**${title}**`, [
      ...options.map(o => [o]),
      [{ text: tr('← Back', '← Назад'), data: 'ws:home' }],
    ])
    const set = (patch: Partial<Workspace>) => {
      workspaces.update(chatId, patch)
      log.info('workspace settings', { chatId, ...patch })
      applied(chatId)
    }
    const inTopic = (kind: string) => ({ text: w.plain ? tr('Ask at the first message', 'Спросить при первом сообщении') : tr('Choose in each topic', 'Выбирать в топике'), data: `ws:${kind}:${NONE}` })
    // What the list is for, in a group with no topics to be new
    const forWhat = (forTopics: [string, string], forGroup: [string, string]) => tr(...(w.plain ? forGroup : forTopics))

    if (what === 'home') {
      await ctx.answerCallbackQuery()
      return home()
    }
    if (what === 'dev') {
      await ctx.answerCallbackQuery()
      if (!value) return list(forWhat(['Computer for new topics', 'Компьютер для новых топиков'], ['Computer for this group', 'Компьютер для этой группы']), [...gateway.devices().map(d => ({ text: d.name, data: `ws:dev:${d.id}` })).filter(o => Buffer.byteLength(o.data) <= 64), inTopic('dev')])
      // A project belongs to its computer
      set({ deviceId: value === NONE ? undefined : value, projectId: undefined })
      return home()
    }
    if (what === 'prj') {
      if (value) {
        await ctx.answerCallbackQuery()
        set({ projectId: value === NONE ? undefined : value })
        return home()
      }
      if (!w.deviceId) return ctx.answerCallbackQuery({ text: tr('Choose a computer first', 'Сначала выбери компьютер'), show_alert: true })
      if (!gateway.device(w.deviceId)) return ctx.answerCallbackQuery({ text: tr('This computer is offline now', 'Этот компьютер сейчас не в сети'), show_alert: true })
      await ctx.answerCallbackQuery()
      const projects = groupProjects(await gateway.refreshProjects(w.deviceId)).map(g => g.root)
      return list(forWhat(['Project for new topics', 'Проект для новых топиков'], ['Project for this group', 'Проект для этой группы']), [...projects.slice(0, PROJECTS_SHOWN).map(p => ({ text: p.name, data: `ws:prj:${p.id}` })).filter(o => Buffer.byteLength(o.data) <= 64), inTopic('prj')])
    }
    if (what === 'mod') {
      await ctx.answerCallbackQuery()
      if (!value) return list(forWhat(['Permissions in new topics', 'Разрешения в новых топиках'], ['Permissions in this group', 'Разрешения в этой группе']), (Object.keys(MODES) as Mode[]).map(m => ({ text: MODES[m], data: `ws:mod:${m}` })))
      if (value in MODES) set({ mode: value as Mode })
      return home()
    }
    await ctx.answerCallbackQuery()
    if (!value) return list(forWhat(['Model in new topics', 'Модель в новых топиках'], ['Model in this group', 'Модель в этой группе']), [...models.list().map(m => ({ text: m.label, data: `ws:mdl:${m.value}` })), { text: tr('Default', 'По умолчанию'), data: `ws:mdl:${NONE}` }])
    if (value === NONE || models.list().some(m => m.value === value)) set({ model: value === NONE ? undefined : value })
    return home()
  })

  return {
    // The group got a new id: it has not gone anywhere
    moved(chatId: number) {
      clearTimeout(leaving.get(chatId))
      leaving.delete(chatId)
    },
    // Topics were turned on. Going the other way is only believed when the bot asks: an update that leaves the flag out
    // must not take a working group's topics and agents away
    topicsOn(chatId: number) {
      workspaces.update(chatId, { plain: false })
      log.info('workspace got topics', { chatId })
      topicsChanged(chatId, false)
    },
    // The bot joined or left a group. Only an account from /users can bring it in: it would answer in that group
    async membership(ctx: Context) {
      const u = ctx.myChatMember!
      if (u.chat.type !== 'group' && u.chat.type !== 'supergroup') return
      const chatId = u.chat.id
      const status = u.new_chat_member.status
      if (status === 'left' || status === 'kicked') {
        if (u.chat.type !== 'group') return gone(chatId)
        clearTimeout(leaving.get(chatId))
        leaving.set(chatId, setTimeout(() => {
          leaving.delete(chatId)
          gone(chatId)
        }, LEAVING_GRACE_MS).unref())
        return
      }
      clearTimeout(leaving.get(chatId))
      leaving.delete(chatId)
      if (workspaces.get(chatId)) return
      if (!owners.has(u.from.id)) {
        log.warn('left a group', { chatId, by: u.from.id })
        return void await api.leaveChat(chatId).catch(() => {})
      }
      // Asked once, when the bot comes in: a change of its rights later is not a second question
      const joined = u.old_chat_member.status === 'left' || u.old_chat_member.status === 'kicked'
      if (joined) await offer(chatId).catch(e => log.warn('workspace offer', (e as Error).message))
    },
    // Telegram hides who an anonymous admin is, so the bot can't tell them from anyone else
    async anonymous(chatId: number, topicId?: number) {
      if (Date.now() - (hinted.get(chatId) ?? 0) < ANONYMOUS_HINT_MS) return
      hinted.set(chatId, Date.now())
      await api.sendMessage(chatId, tr("You're writing as an anonymous admin, so I can't tell it's you. Turn off “Remain anonymous” for yourself in the group's admin settings.", 'Ты пишешь как анонимный админ, и я не вижу, что это ты. Отключи себе «Анонимность» в настройках администраторов группы.'), where(topicId)).catch(() => {})
    },
  }
}
