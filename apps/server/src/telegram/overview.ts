import type { Bot, Context } from 'grammy'
import { count, tr } from '../i18n.ts'
import { plainEmoji } from './emoji.ts'
import { formatDuration, richLines, type RichButton } from './render.ts'
import type { NowRow } from './now-widget.ts'

// /now: what runs and what waits for the user, and nothing else, each line a way straight to its topic

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export type WaitKind = 'permission' | 'mcp' | 'folder' | 'question' | 'survey' | 'browser' | 'route' | 'project' | 'computer' | 'delete' | 'schedule' | 'retry' | 'context' | 'rule' | 'skill' | 'speech' | 'picker' | 'projectName' | 'offline' | 'signIn'
export type Waiting = { key: string, kind: WaitKind, detail?: string, messageId?: number }
export type Running = { key: string, doing: string, since?: number }
export type Queued = { key: string, what: string }
type OfferKind = Extract<WaitKind, 'browser' | 'route' | 'project' | 'computer' | 'delete' | 'schedule' | 'retry' | 'context' | 'rule' | 'skill'>
type Offer = { key: string, kind: OfferKind, messageId?: number }

// Buttons left in a topic that nothing else keeps track of. They pass with a tap, or when the topic starts its next
// turn: the user went on without them, and their buttons block nothing any more
export function createOffers() {
  let open: Offer[] = []
  return {
    open(key: string, kind: OfferKind, messageId?: number) {
      open = [...open.filter(o => !(o.key === key && o.kind === kind)), { key, kind, messageId }]
    },
    close(key: string, kind: OfferKind) {
      open = open.filter(o => !(o.key === key && o.kind === kind))
    },
    // An offer that fell back to a plain keyboard has no id to know its tap by: any tap in the topic ends it
    tapped(key: string, messageId: number) {
      open = open.filter(o => !(o.key === key && (o.messageId === messageId || o.messageId === undefined)))
    },
    passed(key: string) {
      open = open.filter(o => o.key !== key)
    },
    list: () => [...open],
  }
}

// Topics of a group have links, to a message in them too. Telegram documents message links for groups and channels
// only (core.telegram.org/api/links): the private chat with the bot is topicWay's part
export function topicLink(chatId: number, topicId?: number, messageId?: number) {
  const id = String(chatId)
  if (!id.startsWith('-100')) return null
  const path = topicId ? [topicId, ...(messageId ? [messageId] : [])] : [messageId ?? 1]
  return `https://t.me/c/${id.slice(4)}/${path.join('/')}`
}

// The same, and for a topic in the private chat with the bot too: those have links since Bot API 10.4
// (t.me/<bot>/<topic>), to the topic only
export const topicWay = (chatId: number, topicId?: number, botUser?: string, messageId?: number) =>
  topicLink(chatId, topicId, messageId) ?? (chatId > 0 && topicId && botUser ? `https://t.me/${botUser}/${topicId}` : undefined)

// grammY throws on botInfo before the bot has started; a name then goes without its link
export const botUserOf = (bot: Pick<Bot, 'botInfo'>) => {
  try {
    return bot.botInfo?.username
  } catch {
    return undefined
  }
}

const LINES_MAX = 30

const toolName = (tool: string) => {
  const [, server, name] = tool.match(/^mcp__(.+?)__(.+)$/) ?? []
  return !name ? tool : server === 'device' ? name : `${server}: ${name}`
}
export function permissionKind(tool: string): 'mcp' | 'folder' | 'permission' {
  if (/__(add|remove)_mcp_server$/.test(tool)) return 'mcp'
  return tool.endsWith('__add_project_folder') ? 'folder' : 'permission'
}

const waitLabel = (w: Waiting) => {
  const labels: Record<WaitKind, string> = {
    permission: tr('asks permission', 'просит разрешение'),
    mcp: tr('asks to change an MCP server', 'просит изменить MCP-сервер'),
    folder: tr('asks for another folder', 'просит ещё одну папку'),
    question: tr('asks a question', 'задал вопрос'),
    survey: tr('survey open', 'открыт опрос'),
    browser: tr('asks for your Chrome', 'просит твой Chrome'),
    route: tr('Chrome needs your choice', 'Chrome ждёт твоего выбора'),
    project: tr('needs a project', 'нужен проект'),
    computer: tr('offers another computer', 'предлагает другой компьютер'),
    delete: tr('delete topics?', 'удалить топики?'),
    schedule: tr('proposes a schedule', 'предлагает расписание'),
    retry: tr('stopped: a button to go on', 'остановилось: продолжить кнопкой'),
    context: tr('a new CLAUDE.md: use it?', 'новый CLAUDE.md: использовать?'),
    rule: tr('make a correction a rule?', 'сделать замечание правилом?'),
    skill: tr('a skill: install or remove?', 'скилл: установить или удалить?'),
    speech: tr('speech model: download?', 'модель речи: скачать?'),
    picker: tr('choose where to work', 'выбери, где работать'),
    projectName: tr("waits for the project's name", 'ждёт название проекта'),
    offline: tr('computer offline, a message waits', 'компьютер не в сети, сообщение ждёт'),
    signIn: tr('waits for your sign-in', 'ждёт твоего входа'),
  }
  return w.detail ? `${labels[w.kind]}: ${w.detail}` : labels[w.kind]
}
const runLabel = (r: Running, now: number) => (r.since ? `${r.doing} · ${formatDuration(now - r.since)}` : r.doing)

export type Names = {
  place: (chatId: number) => string
  topic: (key: string) => string
  where: (key: string) => { chatId: number, topicId?: number }
  // Everything shown goes through this, like every other text of the bot
  masked: (key: string, text: string) => string
}

// Grouped by workspace in the style of the update card. What waits comes first, in each group and among the groups:
// that is where a tap is needed. A long card loses running lines before it loses waiting ones
export function overviewHtml(view: { running: Running[], waiting: Waiting[], queued?: Queued[] }, names: Names, here: number, now = Date.now(), botUser?: string) {
  const line = (key: string, icon: string, what: string, messageId?: number) => {
    const { chatId, topicId } = names.where(key)
    const name = esc(names.masked(key, names.topic(key)))
    const url = topicWay(chatId, topicId, botUser, messageId)
    return { chatId, waits: icon === '🔔', html: `${icon} ${url ? `<a href="${url}">${name}</a>` : name} — ${esc(names.masked(key, what))}` }
  }
  const all = [
    ...view.waiting.map(w => line(w.key, '🔔', waitLabel(w), w.messageId)),
    ...view.running.map(r => line(r.key, '⚙️', runLabel(r, now))),
    ...(view.queued ?? []).map(q => line(q.key, '⏳', q.what)),
  ]
  if (!all.length) return tr('Nothing is running and nothing waits for you.', 'Ничего не идёт, и ничего не ждёт тебя.')
  const groups = new Map<number, typeof all>()
  for (const l of all.slice(0, LINES_MAX)) groups.set(l.chatId, [...(groups.get(l.chatId) ?? []), l])
  const rank = ([chatId, lines]: [number, typeof all]) => (lines.some(l => l.waits) ? 0 : 2) + (chatId === here ? 0 : 1)
  const shown = [...groups].sort((a, b) => rank(a) - rank(b)).map(([chatId, lines]) =>
    [`<b>${esc(names.masked(`${chatId}`, names.place(chatId)))}</b>`, ...lines.map(l => l.html)].join('\n'))
  return [...shown, ...(all.length > LINES_MAX ? [`… +${all.length - LINES_MAX}`] : [])].join('\n\n')
}

// The same view as rows for the widget: what it is, then where, each with the way to its topic
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
export function nowRowsOf(view: { running: Running[], waiting: Waiting[], queued?: Queued[] }, names: Names, botUser?: string): NowRow[] {
  const at = (key: string, messageId?: number) => {
    const { chatId, topicId } = names.where(key)
    const name = names.masked(key, names.topic(key))
    const link = topicWay(chatId, topicId, botUser, messageId)
    return { topic: chatId < 0 ? tr(`${name} in ${names.place(chatId)}`, `${name} в ${names.place(chatId)}`) : name, link }
  }
  return [
    // A question reads as itself: the line under it says where
    ...view.waiting.map(w => ({ kind: 'wait' as const, what: names.masked(w.key, w.kind === 'question' && w.detail ? w.detail : capital(waitLabel(w))), ...at(w.key, w.messageId) })),
    ...view.running.map(r => ({ kind: 'run' as const, what: names.masked(r.key, capital(r.doing)), since: r.since, ...at(r.key) })),
    ...(view.queued ?? []).map(q => ({ kind: 'queue' as const, what: names.masked(q.key, capital(q.what)), ...at(q.key) })),
  ]
}

type LiveState = {
  busy: boolean, preparing: number, queue: unknown[], waitingDevice: boolean, newProjectOn: string | null
  now?: { since: number, status: () => string }
}

export type OverviewSource = {
  live: Map<string, LiveState>
  pending: Map<number, { key: string, tool: string, choice?: { messageId: number } }>
  asking: Map<number, { key: string, q: { question: string }, choice?: { messageId: number } }>
  surveys: { keys: () => string[], get: (key: string) => { title?: string, messageId?: number } | undefined }
  offers: { list: () => Offer[] }
  signIns: () => string[]
  speechOffer: () => { key: string, messageId: number } | null
  slotWaiters: string[]
  unbound: (key: string) => boolean
  computerOf: (key: string) => string
  chatOf: (key: string) => number
  // Tasks put off until a computer connects
  deferred: () => { key: string, computer: string, title: string }[]
}

// Every state in which a topic stands still until the user acts. Left out on purpose, since nothing stands still for
// them: the moment to call off put-off tasks, an expiring topic, an offer to move a project, an account asking for access
export function collectOverview(s: OverviewSource, mine: (chatId: number) => boolean) {
  const waiting: Waiting[] = [
    ...[...s.pending.values()].map(p => ({ key: p.key, kind: permissionKind(p.tool), detail: permissionKind(p.tool) === 'permission' ? toolName(p.tool) : undefined, messageId: p.choice?.messageId })),
    ...[...s.asking.values()].map(a => ({ key: a.key, kind: 'question' as const, detail: trunc(a.q.question, 60), messageId: a.choice?.messageId })),
    ...s.surveys.keys().flatMap(key => {
      const v = s.surveys.get(key)
      return v ? [{ key, kind: 'survey' as const, detail: v.title && trunc(v.title, 60), messageId: v.messageId }] : []
    }),
    ...s.offers.list(),
    ...s.signIns().map(key => ({ key, kind: 'signIn' as const })),
  ]
  const speech = s.speechOffer()
  if (speech) waiting.push({ key: speech.key, kind: 'speech', messageId: speech.messageId })
  for (const [key, l] of s.live) {
    if (l.newProjectOn) waiting.push({ key, kind: 'projectName' })
    if (l.waitingDevice) waiting.push({ key, kind: 'offline', detail: s.computerOf(key) })
    else if (l.queue.length && !l.busy && s.unbound(key)) waiting.push({ key, kind: 'picker' })
  }
  const stands = new Set(waiting.map(w => w.key))
  const running: Running[] = []
  for (const [key, l] of s.live) {
    if (stands.has(key)) continue
    if (l.now) running.push({ key, doing: plainEmoji(l.now.status()), since: l.now.since })
    else if (l.busy) running.push({ key, doing: tr('working', 'работает') })
    else if (l.preparing) running.push({ key, doing: tr('preparing files', 'готовит файлы') })
    else if (s.slotWaiters.includes(key)) running.push({ key, doing: tr('waits for a free slot on the server', 'ждёт свободного места на сервере') })
  }
  // A topic that stands still because of its queue already says so above
  const queued: Queued[] = [
    ...[...s.live].flatMap(([key, l]) => (l.queue.length && !stands.has(key) ? [{ key, what: tr(`${count(l.queue.length, ['message', 'messages'], ['сообщение', 'сообщения', 'сообщений'])} in the queue`, `${count(l.queue.length, ['message', 'messages'], ['сообщение', 'сообщения', 'сообщений'])} в очереди`) }] : [])),
    ...s.deferred().map(d => ({ key: d.key, what: tr(`waits for ${d.computer}: ${trunc(d.title, 60)}`, `ждёт ${d.computer}: ${trunc(d.title, 60)}`) })),
  ]
  return { running: running.filter(r => mine(s.chatOf(r.key))), waiting: waiting.filter(w => mine(s.chatOf(w.key))), queued: queued.filter(q => mine(s.chatOf(q.key))) }
}

// A group has other readers: there the card answers for that group alone. Everything the one asking owns, their private
// chat and the workspaces they added, shows only in their private chat. Nobody else's chats, though the bot serves
// several accounts
export const overviewScope = (chat: { id: number, type: string }, userId: number, addedBy: (chatId: number) => number | undefined) =>
  chat.type === 'private'
    ? (chatId: number) => chatId === userId || addedBy(chatId) === userId
    : (chatId: number) => chatId === chat.id

export function createOverview({ bot, source, names, addedBy, send, edit, sendWidget }: {
  bot: Bot, source: OverviewSource, names: Names, addedBy: (chatId: number) => number | undefined,
  send: (chatId: number, topicId: number | undefined, md: string, rows: RichButton[][]) => Promise<unknown>,
  edit: (chatId: number, messageId: number, md: string, rows: RichButton[][]) => Promise<unknown>,
  // The private chat gets a widget that keeps itself current; false when it couldn't be sent, and the card goes instead
  sendWidget?: (chatId: number, topicId: number | undefined, rows: NowRow[]) => Promise<boolean>,
}) {
  const card = (ctx: Context) => richLines(overviewHtml(collectOverview(source, overviewScope(ctx.chat!, ctx.from!.id, addedBy)), names, ctx.chat!.id, Date.now(), botUserOf(bot)))
  const rows = (): RichButton[][] => [[{ text: tr('🔄 Refresh', '🔄 Обновить'), data: 'now:r' }]]
  // What one account sees from its private chat: its own chats and the workspaces it added
  const nowRows = (userId: number) => nowRowsOf(collectOverview(source, overviewScope({ id: userId, type: 'private' }, userId, addedBy)), names, botUserOf(bot))
  bot.command('now', async ctx => {
    const topicId = ctx.msg.is_topic_message ? ctx.msg.message_thread_id : undefined
    if (ctx.chat.type === 'private' && sendWidget && await sendWidget(ctx.chat.id, topicId, nowRows(ctx.from!.id))) return
    return send(ctx.chat.id, topicId, card(ctx), rows())
  })
  bot.callbackQuery('now:r', async ctx => {
    await ctx.answerCallbackQuery(tr('Updated', 'Обновлено'))
    // The same text is an error to Telegram, and means the card is right as it is
    if (ctx.callbackQuery.message) await edit(ctx.chat!.id, ctx.callbackQuery.message.message_id, card(ctx), rows()).catch(() => {})
  })
  return { nowRows }
}
