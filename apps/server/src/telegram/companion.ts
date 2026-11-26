import { InlineKeyboard, InputFile, type Bot, type Context } from 'grammy'
import type { Message } from 'grammy/types'
import type { Log } from '../log.ts'
import type { Owners } from '../owners.ts'
import type { ModelCatalog } from '../models.ts'
import type { Profiles } from '../profiles.ts'
import { REMINDERS_EACH, KEEP_MESSAGES, type ChatMsg, type Companion, type CompanionStore, type Reminder } from '../companions.ts'
import { COMPANION_READ, COMPANION_SEARCH, FIND_PICTURE, REMIND, type companionTurn, type RemindArgs } from '../claude/companion.ts'
import type { PromptImage } from '../claude/runner.ts'
import { advicePrompt, adviceSystem, companionPrompt, companionSystem, notebookPrompt, NOTEBOOK_SYSTEM, PICTURE_SYSTEM, stamp, type Speaker } from '../claude/companion-prompt.ts'
import { createLeakGuard, type Secret } from './leak.ts'
import { carriesData } from '../net.ts'
import { cut } from './text.ts'
import { richPlain } from './incoming.ts'
import { COMMONS_FILES } from '../commons.ts'
import { parseAt } from '../schedule.ts'
import { redact } from './redact.ts'
import { richButtons, type RichButton } from './render.ts'
import { mdText } from './schedule-menu.ts'
import type { Choice } from './bot.ts'
import { tr } from '../i18n.ts'

// A companion chat: an ordinary group where the bot answers whoever addresses it, and does nothing else. Every update
// of such a chat comes here and nowhere further, the owner's too: commands, buttons, permissions, computers and projects
// do not exist in it. Its settings are a card in the owner's private chat

const where = (thread?: number) => (thread ? { message_thread_id: thread } : {})
// Fable is the owner's for their own work: a chat of other people never spends it
const FAMILIES = ['haiku', 'sonnet', 'opus']
export const DAILY_CHOICES = [30, 100, 300, 0]
const DEFAULT_DAILY = 100
// Asked while an answer is being written: these wait their turn, each for an answer of its own; more are turned away
const QUEUE_MAX = 10
const OWNER_CHECK_MS = 10 * 60_000
const SWEEP_MS = 3600_000
const VOICE_MAX_SEC = 300
// Heard without being asked: only short ones, so much a day for a chat, and no more waiting than this. Hearing is the
// server's own processors at work, the same that hear the owner
const VOICE_QUIET_MAX_SEC = 120
const VOICE_QUIET_DAILY_SEC = 30 * 60
const VOICE_QUIET_QUEUE = 20
// Pictures looked at without being asked: so many a day for a chat. Each is a request to the cheap model
const PICTURE_QUIET_DAILY = 40
const PICTURE_QUIET_QUEUE = 20
// Pictures of one album that go to Claude together
const ALBUM_MAX = 6
// An album arrives as messages of its own, one after another: this long for the rest of it to come
const ALBUM_WAIT_MS = 1500
const PHOTO_MAX_BYTES = Math.floor(3.75 * 1024 * 1024)
const NOTICE_GAP_MS = 10 * 60_000
const COMMAND_GAP_MS = 3000
const USAGE_KEPT_MS = 5 * 60_000
const LEAVING_GRACE_MS = 15_000
const PICTURES_MAX = 3
// Two messages of Telegram's size: asked for a novel, the chat still gets an answer and not a flood
const ANSWER_MAX = 7000
const YEAR_MS = 366 * 86400_000
// Someone who addresses the bot more often than a person talking does is no longer answered, until the owner looks
const SPAM_BURST = 8
const SPAM_BURST_MS = 2 * 60_000
const SPAM_HOUR = 30
const SPAM_HOUR_MS = 3600_000
// The morning's advice: said in these hours of the owner's clock, to someone who said at least this much yesterday
const ADVICE_FROM_HOUR = 9
const ADVICE_UNTIL_HOUR = 12
const ADVICE_MIN_CHARS = 60
const DAY_MS = 86400_000
export const COMPANION_NEW = 'cmp:new'

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// @bot_name or @claude as a word of its own: not an e-mail address, not @claude_fan
export const mentions = (text: string, username: string) => new RegExp(`(^|[^\\w@.])@(${escapeRe(username)}|claude)(?!\\w)`, 'i').test(text)

// The message a reply points at. In a topic every message "replies" to the one that opened the topic: that is no reply.
// Only in a topic: an ordinary supergroup gives a reply the id of the message its thread began with as its thread, and
// for a reply to that very message the two are the same number
const repliedTo = (m: Message) => {
  const r = m.reply_to_message
  return r && !r.forum_topic_created && !(m.is_topic_message && r.message_id === m.message_thread_id) ? r : undefined
}

export function addressed(m: Message, me: { id: number, username: string }) {
  if (repliedTo(m)?.from?.id === me.id) return true
  return mentions(m.text ?? m.caption ?? '', me.username)
}

// Who wrote it. An anonymous admin and a linked channel write as a chat: they are told apart by its id, which is never
// the owner's
export function speakerOf(m: Message): Speaker | null {
  if (m.sender_chat) return { id: m.sender_chat.id, name: m.sender_chat.title ?? 'channel' }
  if (!m.from || m.from.is_bot) return null
  return { id: m.from.id, name: [m.from.first_name, m.from.last_name].filter(Boolean).join(' '), username: m.from.username }
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

// A message as the chat's memory keeps it. Files are a name and nothing more; contacts, locations and service messages
// are not kept at all
export function heardOf(m: Message, s: Speaker): ChatMsg | null {
  const base = {
    id: m.message_id, at: m.date * 1000, from: s.id, name: s.name, ...(s.username && { username: s.username }),
    ...(repliedTo(m) && { replyTo: repliedTo(m)!.message_id }), ...(m.is_topic_message && m.message_thread_id && { thread: m.message_thread_id }),
  }
  const forwarded = m.forward_origin ? '[forwarded] ' : ''
  const caption = m.caption ?? ''
  if (m.text) return { ...base, text: forwarded + m.text }
  // A table, a list, a formatted note: what it says, as plain words
  if (m.rich_message) return { ...base, text: forwarded + richPlain(m.rich_message.blocks) }
  if (m.voice) return { ...base, kind: 'voice', text: `(${clock(m.voice.duration)}, not listened to)` }
  if (m.video_note) return { ...base, kind: 'video', text: `(round video, ${clock(m.video_note.duration)})` }
  if (m.photo) {
    const best = [...m.photo].reverse().find(x => (x.file_size ?? 0) <= PHOTO_MAX_BYTES)
    return { ...base, kind: 'photo', text: forwarded + caption, ...(best && { photo: best.file_id }), ...(m.media_group_id && { group: m.media_group_id }) }
  }
  if (m.video || m.animation) return { ...base, kind: 'video', text: forwarded + caption }
  if (m.audio) return { ...base, kind: 'file', text: [m.audio.title ?? m.audio.file_name ?? 'audio', caption].filter(Boolean).join(': ') }
  if (m.document) return { ...base, kind: 'file', text: [m.document.file_name ?? 'file', caption].filter(Boolean).join(': ') }
  if (m.sticker) return { ...base, kind: 'sticker', text: m.sticker.emoji ?? '' }
  if (m.poll) return { ...base, text: `[poll] ${m.poll.question}: ${m.poll.options.map(o => o.text).join(' / ')}` }
  return null
}

const PICTURE = /!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"([^"]*)")?\)/g

// Pictures of an answer leave it: Telegram fetches each by its address. Only an https address that carries nothing is
// fetched at all; any other stays a link, and a path stays its caption
export function splitPictures(md: string, max = PICTURES_MAX) {
  const pictures: { url: string, caption: string }[] = []
  const text = md.replace(PICTURE, (_all, alt: string, a: string | undefined, b: string | undefined, title: string | undefined) => {
    const url = a ?? b ?? ''
    const caption = title || alt || ''
    if (/^https:\/\//i.test(url) && !carriesData(url) && pictures.length < max) {
      pictures.push({ url, caption })
      return ''
    }
    return /^https?:\/\//i.test(url) ? `[${caption || url}](${url})` : caption
  }).replace(/\n{3,}/g, '\n\n').trim()
  return { text, pictures }
}

const kindLabel = (k: Secret['kind']) => ({ 'e-mail': tr("the account's e-mail", 'почта аккаунта'), system: tr("the server's system", 'система сервера'), folder: tr('a folder of the server', 'папка сервера') })[k]
// All the chat ever sees of an answer in the making: one short line, replaced as the work moves on and gone when the
// answer comes. Never a step, a tool's name, a search's words or an address: how the bot works is not the chat's to watch
const STATUS = {
  get voice() { return tr('🎙 Listening…', '🎙 Слушаю голосовое…') },
  get picture() { return tr('👀 Looking at the picture…', '👀 Смотрю картинку…') },
  get [COMPANION_SEARCH]() { return tr('🔎 Searching the web…', '🔎 Ищу в интернете…') },
  get [COMPANION_READ]() { return tr('🌐 Reading the page…', '🌐 Читаю страницу…') },
  get [FIND_PICTURE]() { return tr('🖼 Looking for a picture…', '🖼 Ищу картинку…') },
  get [REMIND]() { return tr('⏰ Setting a reminder…', '⏰ Ставлю напоминание…') },
} as Record<string, string>

const dailyLabel = (n: number) => (n ? String(n) : tr('no limit', 'без предела'))

export function companionCard(c: Companion, o: { model: string, profile?: string, usedToday: number, blocked?: number }) {
  const state = c.on ? tr('✅ working', '✅ работает') : c.introduced ? tr('⏸ paused', '⏸ на паузе') : tr('not switched on yet', 'ещё не включён')
  const md = [
    `### 💬 ${mdText(c.title)}`,
    tr('A companion: answers the people of this chat when they address it. No computers, files or commands there, for anyone.', 'Собеседник: отвечает участникам чата, когда к нему обращаются. Компьютеров, файлов и команд там нет ни для кого.'),
    [
      `- ${tr('State', 'Состояние')}: **${state}**`,
      `- 🧠 ${tr('Model', 'Модель')}: **${mdText(o.model)}**`,
      ...(o.profile ? [`- 👤 ${tr('Account', 'Аккаунт')}: **${mdText(o.profile)}**`] : []),
      `- 🔢 ${tr('Answers a day', 'Ответов в день')}: **${dailyLabel(c.daily)}** · ${tr('today', 'сегодня')} ${o.usedToday}`,
      `- 🌐 ${tr('The web (search, links)', 'Интернет (поиск, ссылки)')}: **${c.search ? tr('on', 'включён') : tr('off', 'выключен')}**`,
      `- 🌅 ${tr('Advice in the morning', 'Совет по утрам')}: **${c.advice ? tr('on', 'включён') : tr('off', 'выключен')}**`,
      `- 🎙 ${tr('Voice messages heard in the background', 'Голосовые в фоне')}: **${c.voices ? tr('on', 'включены') : tr('off', 'выключены')}**`,
      `- 🖼 ${tr('Pictures looked at in the background', 'Картинки в фоне')}: **${c.pictures ? tr('on', 'включены') : tr('off', 'выключены')}**`,
      ...(o.blocked ? [`- 🚫 ${tr('Not answered', 'Не отвечаю')}: **${o.blocked}**`] : []),
    ].join('\n'),
    ...(c.on ? [] : [tr('Nothing is read or answered there until you switch it on.', 'Пока не включишь, я там ничего не читаю и не отвечаю.')]),
  ].join('\n\n')
  const k = `cmp:${c.key}`
  // Two buttons share the width of a phone: a name longer than a dozen characters is cut. A switch is named by what
  // it switches, with a tick while it is on
  const sw = (on: boolean | undefined, name: string) => (on ? `${name} ✓` : name)
  const rows: RichButton[][] = [
    [{ text: tr('🧠 Model', '🧠 Модель'), data: `${k}:mdl` }, { text: tr('🔢 Daily limit', '🔢 Предел в день'), data: `${k}:lim` }],
    [...(o.profile ? [{ text: tr('👤 Account', '👤 Аккаунт'), data: `${k}:acc` }] : []), { text: sw(c.search, tr('🌐 The web', '🌐 Интернет')), data: `${k}:web` }],
    [{ text: sw(c.voices, tr('🎙 Voices', '🎙 Голосовые')), data: `${k}:vcs` }, { text: sw(c.pictures, tr('🖼 Pictures', '🖼 Картинки')), data: `${k}:pic` }],
    [{ text: sw(c.advice, tr('🌅 Advice', '🌅 Совет')), data: `${k}:adv` }],
    [...(o.blocked ? [{ text: tr('🚫 Block list', '🚫 Блок-лист'), data: `${k}:blk` }] : [])],
    [c.on ? { text: tr('⏸ Pause', '⏸ Пауза'), data: `${k}:off` } : { text: tr('✅ Switch on', '✅ Включить'), data: `${k}:on`, style: 'success' as const }],
    [{ text: tr('🧹 Erase', '🧹 Стереть'), data: `${k}:wipe` }, { text: tr('🚪 Leave', '🚪 Уйти из чата'), data: `${k}:quit` }],
  ].filter(row => row.length)
  return { md, rows }
}

const keyboardOf = (rows: RichButton[][]) => {
  const kb = new InlineKeyboard()
  for (const row of rows) {
    for (const b of row) kb.text(b.text, b.data)
    kb.row()
  }
  return kb
}

export function createCompanion({ bot, store, owners, models, profiles, log, zone, turn, secrets, cwd, taken, say, sendChoice, editRich, hearVoice, hearQuietly, picture, findPictures, download, openable, background, now = () => Date.now(), random = Math.random, albumWaitMs = ALBUM_WAIT_MS }: {
  bot: Bot
  store: CompanionStore
  owners: Owners
  models: ModelCatalog
  profiles: Profiles
  log: Log
  zone: () => string
  turn: typeof companionTurn
  // What no answer may carry: asked for before every answer, the accounts can change
  secrets: (profile: string) => Promise<Secret[]>
  cwd: () => string
  // The chat is somebody's workspace already
  taken: (chatId: number) => boolean
  say: (chatId: number, thread: number | undefined, md: string, extra?: { reply_markup?: InlineKeyboard, reply_parameters?: { message_id: number, allow_sending_without_reply?: boolean } }) => Promise<{ ids: number[] }>
  sendChoice: (chatId: number, topicId: number | undefined, md: string, rows: RichButton[][], keyboard: InlineKeyboard) => Promise<Choice | null>
  editRich: (chatId: number, messageId: number, md: string, media?: undefined, keyboard?: InlineKeyboard['inline_keyboard']) => Promise<boolean>
  // What a voice message says; throws with a reason when the server can't tell
  hearVoice: (fileId: string, size?: number) => Promise<string>
  // The same when nobody asked: after everything that somebody waits for, and with less of the server
  hearQuietly: (fileId: string, size?: number) => Promise<string>
  picture: (fileId: string, size?: number) => Promise<PromptImage>
  // Pictures by what they show, from the one place the server asks for a chat
  findPictures: (query: string) => Promise<{ title: string, url: string }[]>
  // A file from that place, fetched by the server: Telegram is turned away there too often
  download: (url: string) => Promise<{ name: string, data: Buffer }>
  // Whether the server may read this address at all: null, or why not, in words for Claude
  openable: (url: string) => Promise<string | null>
  background: (work: Promise<unknown>) => void
  now?: () => number
  random?: () => number
  albumWaitMs?: number
}) {
  const { api } = bot
  const me = () => ({ id: bot.botInfo.id, username: bot.botInfo.username })
  const dayOf = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: zone() }).format(t)
  const hourOf = (t: number) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone(), hour: '2-digit', hourCycle: 'h23' }).format(t))
  const today = () => dayOf(now())
  // When each person addressed the bot lately, by chat and person
  const asks = new Map<string, number[]>()
  // ids: the messages that wait, in the order they will be answered
  const queues = new Map<number, { waiting: number, tail: Promise<unknown>, ids: number[] }>()
  const react = (chatId: number, id: number, emoji: '👀' | null) => api.setMessageReaction(chatId, id, emoji ? [{ type: 'emoji', emoji }] : []).catch(e => log.debug('companion reaction', (e as Error).message))
  const ownerSeen = new Map<number, number>()
  const noticed = new Map<string, number>()
  const saidOut = new Set<string>()
  const lastCommand = new Map<number, number>()
  const folding = new Set<number>()
  const leaving = new Map<number, NodeJS.Timeout>()
  const usageKept = new Map<string, { at: number, line: string }>()
  let swept = now()

  const allowedModels = () => models.list().filter(m => FAMILIES.includes(m.family))
  // The chat's model while it is still one a chat may use, else the middle one
  const modelOf = (c: Companion) => {
    const list = allowedModels()
    return (list.find(m => m.value === c.model) ?? list.find(m => m.family === 'sonnet') ?? list[0])?.value ?? 'sonnet'
  }
  const cheapModel = () => allowedModels().find(m => m.family === 'haiku')?.value ?? 'haiku'
  const profileOf = (c: Companion) => profiles.nameOf(c.profile)

  const commandList = () => [
    { command: 'help', description: tr('What I do in this chat', 'Что я умею в этом чате') },
    { command: 'usage', description: tr('Answers left today', 'Сколько ответов осталось сегодня') },
    { command: 'reminders', description: tr('Reminders set here', 'Напоминания этого чата') },
  ]
  const setCommands = (chatId: number) => api.setMyCommands(commandList(), { scope: { type: 'chat', chat_id: chatId } }).catch(e => log.warn('companion commands', (e as Error).message))
  const dropCommands = (chatId: number) => api.deleteMyCommands({ scope: { type: 'chat', chat_id: chatId } }).catch(() => {})

  // Said to the owner in private, the same thing no more than once in a while: a chat can ask the same question a hundred times
  async function notify(c: Companion, what: string, md: string) {
    if (!owners.has(c.owner)) return
    const key = `${c.key}:${what}`
    if (now() - (noticed.get(key) ?? -Infinity) < NOTICE_GAP_MS) return
    noticed.set(key, now())
    await say(c.owner, undefined, md).catch(e => log.warn('companion notice', (e as Error).message))
  }

  const helpLines = (c: Companion) => [
    tr(`- **To ask me**: @${me().username}, @claude, or a reply to my message.`, `- **Обратиться**: @${me().username}, @claude или ответом на моё сообщение.`),
    tr('- **A voice message or a picture**: reply to it addressing me, or send it in reply to me.', '- **Голосовое или картинка**: ответьте на них с обращением ко мне или пришлите ответом на моё сообщение.'),
    c.search
      ? tr('- **I can**: answer and explain, search the web and read links, retell what was discussed here, show pictures, set reminders.', '- **Умею**: отвечать и объяснять, искать в интернете и читать ссылки, пересказывать, что тут обсуждали, показывать картинки, ставить напоминания.')
      : tr('- **I can**: answer and explain, retell what was discussed here, set reminders.', '- **Умею**: отвечать и объяснять, пересказывать, что тут обсуждали, ставить напоминания.'),
    tr("- **I don't**: run commands, open files, reach anyone's devices. Here I only talk.", '- **Не делаю**: не выполняю команды, не открываю файлы, не захожу ни на чьи устройства. Здесь я только разговариваю.'),
    ...(c.voices ? [tr(`- **Voice messages** up to ${VOICE_QUIET_MAX_SEC / 60} minutes I hear as they come, silently, to follow the talk.`, `- **Голосовые** до ${VOICE_QUIET_MAX_SEC / 60} минут слушаю сразу и молча, чтобы понимать разговор.`)] : []),
    ...(c.pictures ? [tr('- **Pictures** I look at as they come, silently, and keep a line about what each shows.', '- **Картинки** смотрю сразу и молча и храню строчку о том, что на каждой.')] : []),
    ...(c.advice ? [tr('- **In the morning** one of those who wrote here yesterday gets a word of advice nobody asked for.', '- **По утрам** кто-то из писавших здесь вчера получает непрошеный совет.')] : []),
    tr(`- **What I see**: the messages of this chat while I am in it. I keep the last ${KEEP_MESSAGES} and short notes on what came before, to follow the conversation.`, `- **Что вижу**: сообщения этого чата, пока я в нём. Храню последние ${KEEP_MESSAGES} и короткие заметки о том, что было раньше, чтобы держать нить разговора.`),
    c.daily
      ? tr(`- **Limit**: ${c.daily} answers a day for everyone together. /usage shows what is left.`, `- **Предел**: ${c.daily} ответов в день на всех. Остаток: /usage.`)
      : tr('- /usage shows how many answers were given today.', '- /usage показывает, сколько ответов было сегодня.'),
  ].join('\n')

  // How the account's plan stands, in two numbers: no name of the plan, no address, nothing of the owner's other work
  async function planLine(profile: string) {
    const kept = usageKept.get(profile)
    if (kept && now() - kept.at < USAGE_KEPT_MS) return kept.line
    const u = await profiles.usage(profile).catch(() => null)
    const pct = (w?: { utilization: number | null }) => (w && w.utilization !== null ? `${Math.round(w.utilization)}%` : null)
    const parts = [
      pct(u?.fiveHour) && `${tr('5 hours', '5 часов')}: ${pct(u?.fiveHour)}`,
      pct(u?.sevenDay) && `${tr('week', 'неделя')}: ${pct(u?.sevenDay)}`,
    ].filter(Boolean)
    const line = parts.length ? `${tr('Subscription used', 'Подписка израсходована')}: ${parts.join(' · ')}` : ''
    usageKept.set(profile, { at: now(), line })
    return line
  }

  const reminderLine = (r: Reminder) => `⏰ ${stamp(r.at, zone())} · ${mdText(r.name)}: ${mdText(r.text)}`
  function remindersView(chatId: number) {
    const list = [...store.reminders(chatId)].sort((a, b) => a.at - b.at)
    const kb = new InlineKeyboard()
    list.forEach((r, i) => kb.text(`✖ ${i + 1}`, `cr:${r.id}`))
    const md = list.length
      ? [`**${tr('Reminders', 'Напоминания')}** (${zone()})`, list.map((r, i) => `${i + 1}. ${reminderLine(r)}`).join('\n'), tr('A reminder is cancelled by its author or the owner of the chat.', 'Отменить напоминание может его автор или владелец чата.')].join('\n\n')
      : tr('No reminders here. Ask me: “remind me tomorrow at 12 about the call”.', 'Напоминаний нет. Попросите меня: «напомни завтра в 12 про созвон».')
    return { md, kb: list.length ? kb : undefined }
  }

  async function command(chatId: number, c: Companion, m: Message, name: string, s: Speaker) {
    if (now() - (lastCommand.get(chatId) ?? -Infinity) < COMMAND_GAP_MS) return
    lastCommand.set(chatId, now())
    const thread = m.is_topic_message ? m.message_thread_id : undefined
    if (name === 'help' || name === 'start') return say(chatId, thread, [`### 💬 ${tr('Claude in this chat', 'Claude в этом чате')}`, helpLines(c)].join('\n\n'))
    if (name === 'usage') {
      const day = today()
      const used = store.used(chatId, day)
      const mine = store.used(chatId, day, s.id)
      const plan = await planLine(profileOf(c))
      return say(chatId, thread, [
        c.daily
          ? tr(`📊 Today: ${used} of ${c.daily} answers, ${Math.max(0, c.daily - used)} left. Yours: ${mine}.`, `📊 Сегодня: ${used} из ${c.daily} ответов, осталось ${Math.max(0, c.daily - used)}. Твоих: ${mine}.`)
          : tr(`📊 Today: ${used} answers, no daily limit. Yours: ${mine}.`, `📊 Сегодня: ${used} ответов, дневного предела нет. Твоих: ${mine}.`),
        ...(plan ? [plan] : []),
      ].join('\n\n'))
    }
    if (name === 'reminders') {
      const { md, kb } = remindersView(chatId)
      return say(chatId, thread, md, kb ? { reply_markup: kb } : {})
    }
    // Every other command is the owner's own work, and that has no place here
  }

  // ✖ under the list of reminders: the one tap a companion chat takes
  async function cancelReminder(ctx: Context, chatId: number, c: Companion, id: string) {
    const r = store.reminders(chatId).find(x => x.id === id)
    const from = ctx.from?.id
    if (!r) return ctx.answerCallbackQuery(tr('Already gone', 'Его уже нет'))
    if (from !== r.by && from !== c.owner) return ctx.answerCallbackQuery({ text: tr('Only its author or the owner of the chat cancels it', 'Отменить может только автор или владелец чата'), show_alert: true })
    store.unremind(chatId, id)
    await ctx.answerCallbackQuery(tr('Cancelled', 'Отменено'))
    const { md, kb } = remindersView(chatId)
    const messageId = ctx.callbackQuery?.message?.message_id
    if (messageId) await editRich(chatId, messageId, md, undefined, kb?.inline_keyboard ?? [])
  }

  // The owner is the reason the bot is in the chat: once they are out of it, or off the bot's list, so is the bot
  async function ownerHere(chatId: number, c: Companion) {
    if (!owners.has(c.owner)) return false
    if (now() - (ownerSeen.get(chatId) ?? -Infinity) < OWNER_CHECK_MS) return true
    try {
      const m = await api.getChatMember(chatId, c.owner)
      if (m.status === 'left' || m.status === 'kicked' || (m.status === 'restricted' && !m.is_member)) return false
      ownerSeen.set(chatId, now())
    } catch (e) {
      // Not knowing is no reason to walk out: Telegram says so itself when the owner leaves
      log.warn('companion owner check', (e as Error).message)
    }
    return true
  }

  async function quit(chatId: number, why: 'owner gone' | 'asked') {
    const c = store.get(chatId)
    if (!c) return
    // First, so that nothing more is taken from the chat even if leaving it fails
    store.remove(chatId)
    ownerSeen.delete(chatId)
    log.info('companion left', { chatId, why })
    await dropCommands(chatId)
    await api.leaveChat(chatId).catch(e => log.warn('companion leave', (e as Error).message))
    if (!owners.has(c.owner)) return
    const title = mdText(c.title)
    await say(c.owner, undefined, why === 'asked'
      ? tr(`🚪 I left “${title}”. What I kept from that chat is deleted.`, `🚪 Я вышел из «${title}». Всё, что я хранил из этого чата, удалено.`)
      : tr(`🚪 You are no longer in “${title}”, so I left it too. What I kept from that chat is deleted.`, `🚪 Тебя больше нет в «${title}», поэтому я тоже вышел. Всё, что я хранил из этого чата, удалено.`)).catch(() => {})
  }

  // The bot was removed: the chat is over
  function gone(chatId: number) {
    const c = store.get(chatId)
    if (!c) return
    store.remove(chatId)
    ownerSeen.delete(chatId)
    log.info('companion gone', { chatId })
    background(Promise.all([
      dropCommands(chatId),
      owners.has(c.owner) ? say(c.owner, undefined, tr(`I was removed from “${mdText(c.title)}”. What I kept from that chat is deleted.`, `Меня убрали из «${mdText(c.title)}». Всё, что я хранил из этого чата, удалено.`)) : null,
    ]))
  }

  async function post(chatId: number, md: string, replyTo?: number, thread?: number) {
    const { text, pictures } = splitPictures(md)
    const reply = replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}
    let first: number | undefined
    if (text) first = (await say(chatId, thread, text, reply)).ids[0]
    for (const [i, p] of pictures.entries()) {
      try {
        const caption = redact(p.caption).text.slice(0, 1000)
        // Any other address is Telegram's to fetch: it is not looked at the way a page to read is
        const ours = new URL(p.url).hostname === COMMONS_FILES ? await download(p.url).catch(() => null) : null
        const sent = await api.sendPhoto(chatId, ours ? new InputFile(ours.data, ours.name) : p.url, { ...(caption && { caption }), ...where(thread), ...(!text && !i ? reply : {}) })
        first ??= sent.message_id
      } catch (e) {
        log.warn('companion picture', (e as Error).message)
        await api.sendMessage(chatId, tr(`Telegram could not show the picture: ${p.url}`, `Telegram не смог показать картинку: ${p.url}`), where(thread)).catch(() => {})
      }
    }
    return first
  }

  // Sets a reminder for the person being answered. The words are for Claude
  function setReminder(chatId: number, s: Speaker, thread: number | undefined, guard: (t: string) => string[], r: RemindArgs) {
    if ((r.at === undefined) === (r.inMinutes === undefined)) return 'Not set: give exactly one of at, inMinutes.'
    const at = r.at !== undefined ? parseAt(r.at, zone()) : now() + r.inMinutes! * 60_000
    if (!at) return 'Not set: the time must be YYYY-MM-DDTHH:MM.'
    if (at <= now()) return `Not set: that time has passed. It is ${stamp(now(), zone())} now.`
    if (at - now() > YEAR_MS) return 'Not set: a reminder can be at most a year ahead.'
    if (guard(r.text).length) return 'Not set: this text cannot be posted to the chat.'
    const made = store.remind(chatId, { at, by: s.id, name: s.name, ...(s.username && { username: s.username }), text: r.text, ...(thread && { thread }) })
    if (!made) return `Not set: this person already has ${REMINDERS_EACH} reminders waiting. One has to pass or be cancelled first: /reminders shows them.`
    log.info('companion reminder', { chatId, by: s.id, at })
    return `Set for ${stamp(at, zone())} (${zone()}). Tell them so in one line.`
  }

  async function fold(chatId: number, guard: (t: string) => string[], env: Record<string, string | undefined>) {
    const batch = store.foldable(chatId)
    if (!batch || folding.has(chatId)) return
    folding.add(chatId)
    try {
      const res = await turn({ system: NOTEBOOK_SYSTEM, prompt: notebookPrompt(store.notes(chatId), batch, zone()), model: cheapModel(), env, cwd: cwd(), search: false })
      const notes = res.isError ? '' : res.text.trim()
      // A notebook that could not be written is tried again at the next answer; the store itself keeps the chat from growing
      if (!notes || guard(notes).length) return log.warn('companion notebook not written', { chatId, error: !!res.isError })
      store.folded(chatId, batch.map(m => m.id), notes)
      log.info('companion notebook', { chatId, folded: batch.length, chars: notes.length })
    } catch (e) {
      log.warn('companion notebook', (e as Error).message)
    } finally {
      folding.delete(chatId)
    }
  }

  async function answerNow(chatId: number, m: Message, s: Speaker, waiting: number[] = []) {
    const c = store.get(chatId)
    if (!c?.on) return
    if (!await ownerHere(chatId, c)) return quit(chatId, 'owner gone')
    const thread = m.is_topic_message ? m.message_thread_id : undefined
    const reply = (text: string) => api.sendMessage(chatId, text, { ...where(thread), reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } }).catch(e => log.warn('companion reply', (e as Error).message))
    const typing = () => api.sendChatAction(chatId, 'typing', where(thread)).catch(() => {})
    void typing()
    const typingTimer = setInterval(typing, 4500)
    // The status line: one message, there only when something takes time, and deleted before the answer
    let statusId: number | undefined
    let shown = ''
    let statusWork: Promise<unknown> = Promise.resolve()
    const status = (key: string) => {
      const text = STATUS[key]
      if (!text || text === shown) return
      shown = text
      statusWork = statusWork.then(async () => {
        if (statusId) return api.editMessageText(chatId, statusId, text)
        statusId = (await api.sendMessage(chatId, text, { ...where(thread), disable_notification: true, reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } })).message_id
      }).catch(e => log.debug('companion status', (e as Error).message))
    }
    const statusGone = async () => {
      await statusWork
      if (statusId) await api.deleteMessage(chatId, statusId).catch(() => {})
      statusId = undefined
    }
    try {
      const guard = createLeakGuard(await secrets(profileOf(c)))
      const ask = heardOf(m, s)
      if (!ask) return
      const attached: string[] = []
      const images: PromptImage[] = []
      const listen = async (v: { file_id: string, file_size?: number, duration: number }) => {
        if (v.duration > VOICE_MAX_SEC) return null
        status('voice')
        return hearVoice(v.file_id, v.file_size).catch(e => {
          log.warn('companion voice', (e as Error).message)
          return null
        })
      }
      const lookAt = async (fileId: string) => {
        status('picture')
        try {
          images.push(await picture(fileId))
          return true
        } catch (e) {
          log.warn('companion picture', (e as Error).message)
          return false
        }
      }
      const look = async (photo: NonNullable<Message['photo']>) => {
        const p = [...photo].reverse().find(x => (x.file_size ?? 0) <= PHOTO_MAX_BYTES)
        return p ? lookAt(p.file_id) : false
      }
      // The pictures of one album, as the chat's memory has them, and how many of them could be loaded
      const album = (group?: string) => (group ? store.messages(chatId).filter(x => x.group === group && x.photo).slice(0, ALBUM_MAX) : [])
      const lookAtAll = async (all: ChatMsg[]) => {
        let n = 0
        for (const x of all) if (await lookAt(x.photo!)) n++
        return n
      }
      if (m.voice) {
        const text = await listen(m.voice)
        if (!text) return void await reply(tr("I couldn't make out this voice message.", 'Не получилось разобрать это голосовое.'))
        store.transcribed(chatId, m.message_id, text)
        ask.text = text
      }
      if (m.photo) {
        if (m.media_group_id) await new Promise(r => setTimeout(r, albumWaitMs))
        const all = album(m.media_group_id)
        if (all.length > 1) {
          const n = await lookAtAll(all)
          if (n) attached.push(`The ${n} pictures attached to this request came with the message, as one album.`)
        } else if (await look(m.photo)) attached.push('The picture attached to this request came with the message.')
      }
      const target = repliedTo(m)
      if (target && target.from?.id !== me().id) {
        const author = speakerOf(target)
        const from = author ? `${author.name || 'someone'} (id ${author.id})` : 'someone'
        if (target.voice) {
          // Heard already, in the background or for someone who asked before
          const known = store.messages(chatId).find(x => x.id === target.message_id && x.heard)?.text
          const text = known ?? await listen(target.voice)
          if (text && !known) store.transcribed(chatId, target.message_id, text)
          attached.push(text ? `It replies to voice message #${target.message_id} from ${from}, which says: ${text.replace(/\s+/g, ' ')}` : `It replies to voice message #${target.message_id} from ${from}, which could not be made out.`)
        } else if (target.photo && album(target.media_group_id).length > 1) {
          const all = album(target.media_group_id)
          const n = await lookAtAll(all)
          attached.push(n ? `The ${n} pictures attached to this request are the album it replies to (messages ${all.map(x => `#${x.id}`).join(', ')}), from ${from}, in that order.` : `It replies to an album of pictures (#${target.message_id}) that could not be loaded.`)
        } else if (target.photo) {
          attached.push(await look(target.photo) ? `The picture attached to this request is message #${target.message_id} from ${from}, which it replies to.` : `It replies to a picture (#${target.message_id}) that could not be loaded.`)
        } else if (target.document || target.audio || target.video || target.animation || target.video_note) {
          attached.push(`It replies to a file or video (#${target.message_id}): those never reach you.`)
        } else if (!store.messages(chatId).some(x => x.id === target.message_id)) {
          const old = cut((target.text ?? target.caption ?? (target.rich_message ? richPlain(target.rich_message.blocks) : '')).replace(/\s+/g, ' '), 1500)
          if (old) attached.push(`It replies to an older message from ${from}: ${old}`)
        }
      }
      // Nothing asked in so many words: the conversation is the request
      const own = ask.text.replace(new RegExp(`@(${escapeRe(me().username)}|claude)(?!\\w)`, 'gi'), '').replace(/[\s\p{P}]/gu, '')
      if (!own && !m.voice) attached.push(`It is a bare mention with no request of its own: the request is the conversation above${target ? ' and what it replies to' : ''}. Join in with what helps there.`)
      const res = await turn({
        system: companionSystem({ botName: me().username, title: c.title, owner: c.owner, search: c.search, pictures: c.search, reminders: true, zone: zone() }),
        prompt: companionPrompt({ notes: store.notes(chatId), messages: store.messages(chatId), ask, owner: c.owner, zone: zone(), now: now(), attached, waiting }),
        images,
        model: modelOf(c),
        env: profiles.env(profileOf(c)),
        cwd: cwd(),
        search: c.search,
        onStep: status,
        mayAsk: q => !guard(q).length,
        mayOpen: async url => {
          let plain = url
          try {
            plain = decodeURIComponent(url)
          } catch {}
          if (guard(plain).length) return 'This address cannot be opened from here.'
          // What an address carries is how something read on one page would leave for another: only an address
          // somebody in the chat wrote themselves is opened with all it has
          const posted = [...store.messages(chatId), ask].some(x => !x.own && x.text.includes(url))
          if (carriesData(url) && !posted) return 'An address with parameters opens only when someone in the chat posted it exactly so. Say that, or find the page by a search.'
          return openable(url)
        },
        remind: async r => setReminder(chatId, s, thread, guard, r),
        ...(c.search && {
          findPicture: async (query: string) => {
            const found = await findPictures(query).catch(e => {
              log.warn('companion pictures', (e as Error).message)
              return null
            })
            if (!found) return 'The search did not work this time. Say so; do not make an address up.'
            return found.length ? found.map((p, i) => `${i + 1}. ${p.title}\n${p.url}`).join('\n') : 'Nothing found. Try other words, in English, or say there is no picture.'
          },
        }),
      })
      await statusGone()
      if (res.timedOut) return void await reply(tr('That took me too long. Ask again, maybe more simply.', 'Слишком долго думал и не успел. Спросите ещё раз, можно попроще.'))
      if (res.isError) {
        log.warn('companion answer failed', { chatId, kind: res.errorKind, text: res.text.slice(0, 200) })
        const title = mdText(c.title)
        if (res.errorKind === 'rate_limit') {
          await notify(c, 'limit', tr(`💬 “${title}”: the account's limit is spent, I can't answer there for now.`, `💬 «${title}»: лимит аккаунта исчерпан, пока не могу там отвечать.`))
          return void await reply(tr("I can't answer right now: the limit is spent. Try later.", 'Сейчас ответить не могу: лимит исчерпан. Попробуйте позже.'))
        }
        if (res.errorKind === 'authentication_failed') await notify(c, 'sign-in', tr(`💬 “${title}”: the account has to sign in again (/profiles), I can't answer there.`, `💬 «${title}»: аккаунту нужно войти заново (/profiles), я не могу там отвечать.`))
        return void await reply(tr("I couldn't answer this time. Try again a little later.", 'В этот раз ответить не получилось. Попробуйте чуть позже.'))
      }
      const whole = res.text.trim()
      if (!whole) return
      const text = whole.length > ANSWER_MAX ? `${cut(whole, ANSWER_MAX).trimEnd()}…` : whole
      const day = today()
      store.spend(chatId, day, s.id)
      const kinds = guard(text)
      if (kinds.length) {
        log.warn('companion answer held back', { chatId, kinds, by: s.id })
        await notify(c, 'leak', [
          tr(`🛡 “${mdText(c.title)}”: I did not send an answer, it carried something of the server or the account (${kinds.map(kindLabel).join(', ')}).`, `🛡 «${mdText(c.title)}»: я не отправил ответ, в нём оказались данные сервера или аккаунта (${kinds.map(kindLabel).join(', ')}).`),
          `${tr('Asked by', 'Спрашивал')}: ${mdText(s.name)}${s.username ? ` (@${mdText(s.username)})` : ''}`,
          `> ${mdText(ask.text.replace(/\s+/g, ' ').slice(0, 300))}`,
        ].join('\n\n'))
        return void await reply(tr("I don't share that.", 'Этим я не делюсь.'))
      }
      const sentId = await post(chatId, text, m.message_id, thread)
      if (sentId) store.heard(chatId, { id: sentId, at: now(), from: me().id, name: 'Claude', text, replyTo: m.message_id, own: true, ...(thread && { thread }) })
      log.info('companion answered', { chatId, by: s.id, model: modelOf(c), ...res.usage })
      await fold(chatId, guard, profiles.env(profileOf(c)))
    } catch (e) {
      log.warn('companion answer', (e as Error).message)
      await reply(tr("I couldn't answer this time. Try again a little later.", 'В этот раз ответить не получилось. Попробуйте чуть позже.'))
    } finally {
      clearInterval(typingTimer)
      await statusGone()
    }
  }

  // Voice messages nobody asked about, heard one at a time for all chats together. No sign of it in the chat: the
  // words simply are there when someone asks later
  const voices: { chatId: number, id: number, fileId: string, size?: number, sec: number }[] = []
  let hearing = false
  async function hearWaiting() {
    hearing = true
    try {
      for (let v = voices.shift(); v; v = voices.shift()) {
        const c = store.get(v.chatId)
        const day = today()
        if (!c?.on || !c.voices || store.voiceUsed(v.chatId, day) + v.sec > VOICE_QUIET_DAILY_SEC) continue
        store.voiceSpent(v.chatId, day, v.sec)
        const text = await hearQuietly(v.fileId, v.size).catch(e => {
          log.warn('companion voice', (e as Error).message)
          return ''
        })
        if (text && store.get(v.chatId)) store.transcribed(v.chatId, v.id, text)
      }
    } finally {
      hearing = false
    }
  }
  function hearLater(chatId: number, m: Message) {
    const v = m.voice
    if (!v || v.duration > VOICE_QUIET_MAX_SEC || voices.length >= VOICE_QUIET_QUEUE) return
    voices.push({ chatId, id: m.message_id, fileId: v.file_id, size: v.file_size, sec: v.duration })
    if (!hearing) background(hearWaiting())
  }

  // Pictures nobody asked about: each is looked at once by the cheap model, and a line about what it shows goes into
  // the chat's memory. One at a time for all chats, with no sign of it in the chat
  const unseen: { chatId: number, id: number, fileId: string, caption: string }[] = []
  let seeing = false
  async function seeWaiting() {
    seeing = true
    try {
      for (let p = unseen.shift(); p; p = unseen.shift()) {
        const c = store.get(p.chatId)
        const day = today()
        if (!c?.on || !c.pictures || store.picturesUsed(p.chatId, day) >= PICTURE_QUIET_DAILY) continue
        store.pictureSpent(p.chatId, day)
        try {
          const guard = createLeakGuard(await secrets(profileOf(c)))
          const res = await turn({
            system: PICTURE_SYSTEM, prompt: p.caption ? `Its caption: ${p.caption.replace(/\s+/g, ' ')}` : 'It has no caption.', images: [await picture(p.fileId)],
            model: cheapModel(), env: profiles.env(profileOf(c)), cwd: cwd(), search: false,
          })
          const shows = res.isError ? '' : res.text.trim().replace(/\s+/g, ' ')
          if (shows && !guard(shows).length && store.get(p.chatId)) store.described(p.chatId, p.id, shows)
        } catch (e) {
          log.warn('companion picture', (e as Error).message)
        }
      }
    } finally {
      seeing = false
    }
  }
  function seeLater(chatId: number, heard: ChatMsg) {
    if (!heard.photo || unseen.length >= PICTURE_QUIET_QUEUE) return
    unseen.push({ chatId, id: heard.id, fileId: heard.photo, caption: heard.text })
    if (!seeing) background(seeWaiting())
  }

  // The bot stops answering this person, tells the chat once and leaves the rest to the owner
  function block(chatId: number, c: Companion, m: Message, s: Speaker, asked: number, minutes: number) {
    store.block(chatId, s.id, { at: now(), name: s.name, ...(s.username && { username: s.username }), asked, minutes })
    log.warn('companion blocked', { chatId, user: s.id, asked, minutes })
    const thread = m.is_topic_message ? m.message_thread_id : undefined
    const who = s.name || tr('You', 'Вы')
    background(api.sendMessage(chatId, tr(`${who}, that is too many requests in a row. I stop answering you until the owner of this chat looks into it.`, `${who}, слишком много запросов подряд. Я перестаю вам отвечать, пока владелец чата не разберётся.`), { ...where(thread), reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } }).catch(() => {}))
    if (!owners.has(c.owner)) return
    const last = store.messages(chatId).filter(x => x.from === s.id && !x.own).slice(-3)
    background(say(c.owner, undefined, [
      tr(`🚫 “${mdText(c.title)}”: I stopped answering **${mdText(s.name)}**${s.username ? ` (@${mdText(s.username)})` : ''}: ${asked} requests in ${minutes} min.`, `🚫 «${mdText(c.title)}»: я перестал отвечать **${mdText(s.name)}**${s.username ? ` (@${mdText(s.username)})` : ''}: ${asked} запросов за ${minutes} мин.`),
      ...last.map(x => `> ${mdText(x.text.replace(/\s+/g, ' ').slice(0, 200))}`),
      tr('It stays so until you unblock them, here or in the card of the chat.', 'Так и останется, пока ты не разблокируешь: здесь или в карточке чата.'),
    ].join('\n\n'), { reply_markup: new InlineKeyboard().text(tr('✅ Unblock', '✅ Разблокировать'), `cmp:${c.key}:unb:${s.id}`) }).catch(e => log.warn('companion notice', (e as Error).message)))
  }

  // True when this request is one too many. The owner is never counted: the chat is theirs to switch off
  function flooding(chatId: number, c: Companion, m: Message, s: Speaker) {
    if (s.id === c.owner) return false
    const key = `${chatId}:${s.id}`
    const times = [...(asks.get(key) ?? []).filter(t => now() - t < SPAM_HOUR_MS), now()]
    asks.set(key, times)
    const burst = times.filter(t => now() - t < SPAM_BURST_MS).length
    if (burst <= SPAM_BURST && times.length <= SPAM_HOUR) return false
    asks.delete(key)
    block(chatId, c, m, s, burst > SPAM_BURST ? burst : times.length, burst > SPAM_BURST ? SPAM_BURST_MS / 60_000 : SPAM_HOUR_MS / 60_000)
    return true
  }

  // One person of the chat hears a word of advice nobody asked for, about what they said yesterday. Nobody who said
  // enough, the same person as the morning before, no answers left, an answer that is not fit to post: then nothing
  async function advise(chatId: number, c: Companion, at: number) {
    const day = dayOf(at)
    const was = store.adviceOf(chatId)
    if (was.day === day || hourOf(at) < ADVICE_FROM_HOUR || hourOf(at) >= ADVICE_UNTIL_HOUR) return
    // Once a morning, however it goes
    store.advised(chatId, day)
    if (c.daily && store.used(chatId, day) >= c.daily) return
    const yesterday = dayOf(at - DAY_MS)
    const blocked = store.blocked(chatId)
    const said = new Map<number, ChatMsg[]>()
    for (const m of store.messages(chatId)) {
      // People only: a channel or an anonymous admin is nobody to advise
      if (m.own || m.from <= 0 || blocked[m.from] || !m.text || m.kind === 'sticker' || dayOf(m.at) !== yesterday) continue
      said.set(m.from, [...(said.get(m.from) ?? []), m])
    }
    const fit = [...said].filter(([id, list]) => id !== was.last && list.reduce((n, m) => n + m.text.length, 0) >= ADVICE_MIN_CHARS)
    if (!fit.length) return
    const [id, list] = fit[Math.floor(random() * fit.length)]
    if (!await ownerHere(chatId, c)) return quit(chatId, 'owner gone')
    const person = { id, name: list.at(-1)!.name, username: list.at(-1)!.username }
    const guard = createLeakGuard(await secrets(profileOf(c)))
    const res = await turn({ system: adviceSystem({ botName: me().username, title: c.title }), prompt: advicePrompt(person, list, zone()), model: modelOf(c), env: profiles.env(profileOf(c)), cwd: cwd(), search: false })
    const text = res.isError ? '' : res.text.trim()
    if (!text || /^none\b/i.test(text) || text.length > 700 || guard(text).length) return log.info('companion advice kept back', { chatId, error: !!res.isError })
    const sentId = await post(chatId, text)
    if (sentId) store.heard(chatId, { id: sentId, at: now(), from: me().id, name: 'Claude', text, own: true })
    store.spend(chatId, day, me().id)
    store.advised(chatId, day, id)
    log.info('companion advice', { chatId, to: id })
  }

  function answer(chatId: number, c: Companion, m: Message, s: Speaker) {
    const thread = m.is_topic_message ? m.message_thread_id : undefined
    if (flooding(chatId, c, m, s)) return
    const quick = (key: string, text: string) => {
      // One line for a crowd, not one for each of them
      if (saidOut.has(`${chatId}:${key}`)) return
      if (saidOut.size > 1000) saidOut.clear()
      saidOut.add(`${chatId}:${key}`)
      background(api.sendMessage(chatId, text, { ...where(thread), reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } }).catch(() => {}))
    }
    const day = today()
    if (c.daily && store.used(chatId, day) >= c.daily) {
      return quick(`out:${day}`, tr(`That is all for today: ${c.daily} answers of ${c.daily}. See you tomorrow.`, `На сегодня всё: ${c.daily} ответов из ${c.daily}. До завтра.`))
    }
    const q = queues.get(chatId) ?? { waiting: 0, tail: Promise.resolve(), ids: [] }
    queues.set(chatId, q)
    if (q.waiting > QUEUE_MAX) return quick(`busy:${Math.floor(now() / 60_000)}`, tr('Too many questions at once. Ask again in a minute.', 'Слишком много вопросов сразу. Спросите ещё раз через минуту.'))
    // Behind another answer the message is marked as seen and waits. Nothing moves it up the line: every message is
    // answered in the order it came, by itself, with all that was said before it, the bot's own answers too
    const waits = q.waiting > 0
    if (waits) {
      q.ids.push(m.message_id)
      void react(chatId, m.message_id, '👀')
    }
    q.waiting++
    q.tail = q.tail.then(() => {
      if (waits) {
        q.ids.splice(q.ids.indexOf(m.message_id), 1)
        void react(chatId, m.message_id, null)
      }
      return answerNow(chatId, m, s, [...q.ids])
    }).catch(e => log.warn('companion', (e as Error).message)).finally(() => { q.waiting-- })
    background(q.tail)
  }

  async function onMessage(chatId: number, c: Companion, m: Message, edited: boolean) {
    // A basic group became a supergroup: Telegram says so in both, and whichever comes first moves the chat
    if (m.migrate_to_chat_id) return void moved(chatId, m.migrate_to_chat_id)
    if (m.left_chat_member?.id === c.owner) return quit(chatId, 'owner gone')
    if (!c.on) return
    const s = speakerOf(m)
    if (!s) return
    const text = m.text ?? ''
    // Someone the bot no longer answers: what they say to the chat is still part of it, what they throw at the bot is not
    const shut = !!store.blocked(chatId)[s.id]
    if (shut && addressed(m, me())) return
    const cmd = !edited && text.match(/^\/(\w+)(?:@(\w+))?(?:\s|$)/)
    if (cmd) {
      if (shut || (cmd[2] && cmd[2].toLowerCase() !== me().username.toLowerCase())) return
      return void await command(chatId, c, m, cmd[1].toLowerCase(), s)
    }
    const heard = heardOf(m, s)
    // An edit of something that has left the memory brings nothing back
    if (!heard || (edited && !store.messages(chatId).some(x => x.id === m.message_id))) return
    store.heard(chatId, heard)
    if (c.voices && !edited && !shut && !addressed(m, me())) hearLater(chatId, m)
    if (c.pictures && !edited && !shut) seeLater(chatId, heard)
    // A chat that talks for days without asking the bot anything fills up all the same: its oldest messages go to the
    // notebook then too, or they would be dropped with nothing kept of them. After an answer this happens by itself
    if (store.foldable(chatId) && !addressed(m, me())) {
      background(secrets(profileOf(c)).then(list => fold(chatId, createLeakGuard(list), profiles.env(profileOf(c)))).catch(e => log.warn('companion notebook', (e as Error).message)))
    }
    // An edit corrects what is remembered; it is not asked a second time
    if (edited || !addressed(m, me())) return
    // A sticker or a file in reply to the bot says nothing to answer
    if (!m.text && !m.caption && !m.voice && !m.photo) return
    answer(chatId, c, m, s)
  }

  function moved(from: number, to: number) {
    clearTimeout(leaving.get(from))
    leaving.delete(from)
    if (!store.move(from, to)) return
    log.info('companion moved', { from, to })
    background(Promise.all([dropCommands(from), setCommands(to)]))
  }

  const profileShown = (c: Companion) => (profiles.list().length > 1 ? profileOf(c) : undefined)
  const cardFor = (chatId: number, c: Companion) => companionCard(c, { model: models.label(modelOf(c)) ?? modelOf(c), profile: profileShown(c), usedToday: store.used(chatId, today()), blocked: Object.keys(store.blocked(chatId)).length })

  async function switchOn(chatId: number, c: Companion): Promise<string | null> {
    const member = await api.getChatMember(chatId, me().id).catch(() => null)
    if (!member || (member.status !== 'administrator' && member.status !== 'creator')) return tr("I'm not an admin of that chat: without that I see only commands. Make me one and tap again.", 'Я не админ в этом чате: без этого я вижу только команды. Сделай меня админом и нажми ещё раз.')
    ownerSeen.delete(chatId)
    if (!await ownerHere(chatId, c)) return tr('You are not in that chat yourself.', 'Тебя самого нет в этом чате.')
    store.update(chatId, { on: true })
    log.info('companion on', { chatId, model: c.model, daily: c.daily, search: c.search })
    if (!c.introduced) {
      await say(chatId, undefined, [tr('### 👋 I am Claude, and in this chat I am someone to talk to', '### 👋 Я Claude, в этом чате я собеседник'), helpLines(c)].join('\n\n'))
      store.update(chatId, { introduced: true })
    }
    return null
  }

  // The first step, in the group: the owner tapped «Companion» on the card the bot showed when it was added
  bot.callbackQuery(COMPANION_NEW, async ctx => {
    const chat = ctx.chat
    const messageId = ctx.callbackQuery.message?.message_id
    if (!chat || chat.type === 'private' || !owners.has(ctx.from.id)) return ctx.answerCallbackQuery()
    if (store.get(chat.id) || taken(chat.id)) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    const member = await api.getChatMember(chat.id, me().id)
    if (member.status !== 'administrator' && member.status !== 'creator') {
      return ctx.answerCallbackQuery({ text: tr('Make me an admin of this group first: without that I see only commands. Then tap again.', 'Сначала сделай меня админом этой группы: без этого я вижу только команды. Потом нажми ещё раз.'), show_alert: true })
    }
    const list = allowedModels()
    const c = store.add(chat.id, {
      title: ('title' in chat && chat.title) || tr('Chat', 'Чат'), owner: ctx.from.id, on: false, daily: DEFAULT_DAILY, search: true,
      model: (list.find(m => m.family === 'sonnet') ?? list[0])?.value ?? 'sonnet',
    }, now())
    log.info('companion added', { chatId: chat.id, by: ctx.from.id })
    await ctx.answerCallbackQuery()
    // At once: the list every group gets names commands of the owner's work, and none of them exists here
    await setCommands(chat.id)
    if (messageId) await editRich(chat.id, messageId, tr('💬 A companion, then. I stay silent here until the one who added me finishes the setup in their chat with me.', '💬 Значит, собеседник. Молчу здесь, пока тот, кто меня добавил, не закончит настройку в личном чате со мной.'))
    const { md, rows } = cardFor(chat.id, c)
    await sendChoice(ctx.from.id, undefined, md, rows, keyboardOf(rows))
  })

  // The card, in the owner's private chat: each tap redraws it
  bot.callbackQuery(/^cmp:([0-9a-f]{8}):(home|mdl|lim|acc|web|adv|vcs|pic|blk|unb|on|off|wipe|quit)(?::([\w.[\]-]+))?$/, async ctx => {
    const [, key, what, value] = ctx.match
    const found = store.byKey(key)
    const messageId = ctx.callbackQuery.message?.message_id
    if (!found || ctx.chat?.type !== 'private' || found.owner !== ctx.from.id || !messageId) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    const { chatId } = found
    const k = `cmp:${key}`
    const draw = (md: string, rows: RichButton[][]) => editRich(ctx.chat!.id, messageId, `${md}\n\n${richButtons(rows)}`)
    const home = () => {
      const { md, rows } = cardFor(chatId, store.get(chatId)!)
      return draw(md, rows)
    }
    const back = { text: tr('← Back', '← Назад'), data: `${k}:home` }
    const list = (title: string, options: RichButton[]) => draw(`**${title}**`, [...options.map(o => [o]), [back]])
    const set = (patch: Partial<Companion>) => {
      store.update(chatId, patch)
      log.info('companion settings', { chatId, ...patch })
    }

    if (what === 'on') {
      const problem = await switchOn(chatId, found)
      if (problem) return ctx.answerCallbackQuery({ text: problem, show_alert: true })
      await ctx.answerCallbackQuery(tr('Switched on', 'Включён'))
      return home()
    }
    await ctx.answerCallbackQuery()
    if (what === 'home') return home()
    if (what === 'off') set({ on: false })
    if (what === 'web') set({ search: !found.search })
    if (what === 'adv') set({ advice: !found.advice })
    if (what === 'vcs') set({ voices: !found.voices })
    if (what === 'pic') set({ pictures: !found.pictures })
    if (what === 'unb' && value && store.unblock(chatId, Number(value))) log.info('companion unblocked', { chatId, user: Number(value) })
    if (what === 'blk') {
      const list = Object.entries(store.blocked(chatId))
      if (list.length) {
        // An ordinary keyboard: a person's id in the text of a message could be masked as a card number
        const kb = new InlineKeyboard()
        for (const [id, b] of list) kb.text(`✅ ${b.name || id}`, `${k}:unb:${id}`).row()
        kb.text(back.text, back.data)
        return editRich(ctx.chat!.id, messageId, [
          `**${tr('Not answered until you say so', 'Не отвечаю, пока не скажешь')}**`,
          list.map(([, b]) => `- ${mdText(b.name)}${b.username ? ` (@${mdText(b.username)})` : ''}: ${b.asked} ${tr('requests in', 'запросов за')} ${b.minutes} ${tr('min', 'мин')}, ${stamp(b.at, zone())}`).join('\n'),
          tr('A tap unblocks.', 'Нажатие разблокирует.'),
        ].join('\n\n'), undefined, kb.inline_keyboard)
      }
    }
    if (what === 'mdl') {
      if (!value) return list(tr('Model for this chat', 'Модель для этого чата'), allowedModels().map(m => ({ text: m.label, data: `${k}:mdl:${m.value}` })))
      if (allowedModels().some(m => m.value === value)) set({ model: value })
    }
    if (what === 'lim') {
      if (!value) return list(tr('Answers a day, for the whole chat', 'Ответов в день на весь чат'), DAILY_CHOICES.map(n => ({ text: dailyLabel(n), data: `${k}:lim:${n}` })))
      if (DAILY_CHOICES.includes(Number(value))) set({ daily: Number(value) })
    }
    if (what === 'acc') {
      if (!value) return list(tr('Account that answers in this chat', 'Аккаунт, который отвечает в этом чате'), profiles.list().map(p => ({ text: p, data: `${k}:acc:${p}` })))
      if (profiles.list().includes(value)) set({ profile: value })
    }
    if (what === 'wipe') {
      if (value !== 'yes') {
        return draw(tr('**Erase what I remember of this chat?** The messages I keep and my notebook go; the chat itself is untouched.', '**Стереть всё, что я помню об этом чате?** Уйдут сообщения, которые я храню, и мои заметки; сам чат не изменится.'), [
          [{ text: tr('🧹 Yes, erase', '🧹 Да, стереть'), data: `${k}:wipe:yes`, style: 'danger' }], [back],
        ])
      }
      store.wipe(chatId)
      log.info('companion memory erased', { chatId })
    }
    if (what === 'quit') {
      if (value !== 'yes') {
        return draw(tr('**Leave this chat?** What I keep of it is deleted.', '**Уйти из этого чата?** Всё, что я из него храню, удалится.'), [
          [{ text: tr('🚪 Yes, leave', '🚪 Да, уйти'), data: `${k}:quit:yes`, style: 'danger' }], [back],
        ])
      }
      await editRich(ctx.chat!.id, messageId, tr(`💬 ${mdText(found.title)}: leaving.`, `💬 ${mdText(found.title)}: выхожу.`))
      return quit(chatId, 'asked')
    }
    return home()
  })

  return {
    owns: (chatId: number) => !!store.get(chatId),
    list: () => store.list(),
    moved,
    commandsFor: () => Promise.all(store.list().map(c => setCommands(c.chatId))),
    // The card again, from the list in the private chat
    async show(owner: number, key: string) {
      const found = store.byKey(key)
      if (!found || found.owner !== owner) return
      const { md, rows } = cardFor(found.chatId, found)
      await sendChoice(owner, undefined, md, rows, keyboardOf(rows))
    },
    // Everything that happens in a companion chat. Nothing here leads to a computer, a project or a setting
    async handle(ctx: Context) {
      const chatId = ctx.chat!.id
      const c = store.get(chatId)
      if (!c) return
      if (ctx.callbackQuery) {
        const id = ctx.callbackQuery.data?.match(/^cr:([0-9a-f]{6})$/)?.[1]
        if (id && c.on) return void await cancelReminder(ctx, chatId, c, id)
        return void await ctx.answerCallbackQuery().catch(() => {})
      }
      const m = ctx.message ?? ctx.editedMessage
      if (!m) return
      await onMessage(chatId, c, m as Message, !!ctx.editedMessage)
    },
    // Somebody joined or left. Only the owner's leaving matters
    async member(ctx: Context) {
      const u = ctx.chatMember
      const c = u && store.get(u.chat.id)
      if (!u || !c || u.new_chat_member.user.id !== c.owner) return
      const st = u.new_chat_member
      if (st.status === 'left' || st.status === 'kicked' || (st.status === 'restricted' && !st.is_member)) await quit(u.chat.id, 'owner gone')
    },
    // The bot's own place in the chat changed
    async membership(ctx: Context) {
      const u = ctx.myChatMember!
      const chatId = u.chat.id
      const c = store.get(chatId)
      if (!c) return
      const status = u.new_chat_member.status
      if (status === 'left' || status === 'kicked') {
        // A basic group leaving for its new id looks the same for a moment
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
      if (status !== 'administrator' && status !== 'creator' && c.on) {
        await notify(c, 'rights', tr(`💬 “${mdText(c.title)}”: I am no longer an admin there, so I see only commands and can't follow the conversation. Give the rights back, or remove me.`, `💬 «${mdText(c.title)}»: я там больше не админ, поэтому вижу только команды и не слежу за разговором. Верни права или убери меня.`))
      }
    },
    // Reminders whose time has come, and once an hour a look at whether each owner is still in their chat
    async tick(at = now()) {
      for (const { chatId, r } of store.due(at)) {
        // A pause stops answers, not what was already promised
        if (!store.get(chatId)) continue
        const to = r.username ? `@${r.username}` : r.name
        await api.sendMessage(chatId, redact(`⏰ ${to}: ${r.text}`).text, where(r.thread)).catch(e => log.warn('companion reminder', (e as Error).message))
      }
      for (const c of store.list()) {
        if (c.on && c.advice) await advise(c.chatId, c, at).catch(e => log.warn('companion advice', (e as Error).message))
      }
      if (at - swept < SWEEP_MS) return
      swept = at
      for (const c of store.list()) {
        ownerSeen.delete(c.chatId)
        if (!await ownerHere(c.chatId, c)) await quit(c.chatId, 'owner gone')
      }
    },
    stop() {
      for (const t of leaving.values()) clearTimeout(t)
    },
  }
}

export type CompanionChats = ReturnType<typeof createCompanion>
