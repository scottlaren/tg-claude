// A local Bot API over HTTP, strict where the real one is: unknown thread, deleted message, unchanged edit, long
// callback data and so on all fail with Telegram's own words. A test drives it like a user and reads what came back.
// Telegram's Markdown parser isn't available: lint() checks balance and the shape of tags, and every finding is kept
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import type { AddressInfo } from 'node:net'

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Button = { text: string, data?: string, url?: string, copy?: string }
export type Sent = {
  message_id: number, chat: { id: number }, thread?: number, method: string,
  text: string, html: boolean, rich: boolean, buttons: Button[][], reply_to?: number,
  media: { kind: string, name?: string, bytes?: number, url?: string }[],
  deleted: boolean, edits: number, reactions: string[], at: number, touched: number,
  fromBot: boolean, raw: any,
}
export type Call = { method: string, payload: any, at: number, ok: boolean, error?: string }
export type Finding = { why: string, method: string, sample: string }

const HTML_TAGS = new Set(['b', 'tg-time', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'span', 'tg-spoiler', 'a', 'tg-emoji', 'code', 'pre', 'blockquote'])
const REACTIONS = new Set(['👍', '👎', '❤', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱', '🤬', '😢', '🎉', '🤩', '🤮', '💩', '🙏', '👌', '🕊', '🤡', '🥱', '🥴', '😍', '🐳', '❤‍🔥', '🌚', '🌭', '💯', '🤣', '⚡', '🍌', '🏆', '💔', '🤨', '😐', '🍓', '🍾', '💋', '🖕', '😈', '😴', '😭', '🤓', '👻', '👨‍💻', '👀', '🎃', '🙈', '😇', '😨', '🤝', '✍', '🤗', '🫡', '🎅', '🎄', '☃', '💅', '🤪', '🗿', '🆒', '💘', '🙉', '🦄', '😘', '💊', '🙊', '😎', '👾', '🤷‍♂', '🤷', '🤷‍♀', '😡'])
// Raw errors, leaked internals: what must never reach a chat as it is
const RAW = /\b(TypeError|ReferenceError|RangeError|SyntaxError|GrammyError|ENOENT|EADDRINUSE|ECONNREFUSED|ECONNRESET|EPIPE|EACCES|Call to '\w+' failed|Cannot read propert|is not a function|\[object Object\]|node:internal|stack trace)\b|\bundefined\b|\bnull\b(?! ?[,:}\]])|\bNaN\b|at \w+ \(.*\.ts:\d+/

export function lintHtml(s: string): string | null {
  const stack: string[] = []
  for (const m of s.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^<>]*)>|<|>|&(?![a-zA-Z]+;|#\d+;)/g)) {
    if (!m[2]) {
      if (m[0] === '&') return 'a bare & in HTML'
      return `a bare ${m[0]} in HTML`
    }
    const tag = m[2].toLowerCase()
    if (!HTML_TAGS.has(tag)) return `tag <${tag}> Telegram does not support`
    if (m[1]) {
      if (stack.pop() !== tag) return `unbalanced </${tag}>`
    } else stack.push(tag)
  }
  return stack.length ? `unclosed <${stack.at(-1)}>` : null
}

export function lintMarkdown(s: string): string | null {
  const body = s.split('\n').filter(l => !/^<tg-button-row>.*<\/tg-button-row>$/.test(l)).join('\n')
  const fences = body.split('\n').filter(l => /^\s*```/.test(l)).length
  if (fences % 2) return 'an unclosed code fence'
  const noCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  for (const line of noCode.split('\n')) {
    if ((line.match(/`/g) ?? []).length % 2) return `an unclosed code span: ${line.slice(0, 60)}`
    const bold = (line.match(/\*\*/g) ?? []).length
    if (bold % 2) return `unbalanced **: ${line.slice(0, 60)}`
  }
  if (/<\/?tg-button/.test(noCode)) return 'a button tag outside its row'
  for (const tag of ['details', 'summary', 'blockquote']) {
    const open = (noCode.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length
    const close = (noCode.match(new RegExp(`</${tag}>`, 'g')) ?? []).length
    if (open !== close) return `unbalanced <${tag}>`
  }
  for (const m of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
    if (!/^(tg:\/\/(photo|video|document|animation|audio)\?id=|https?:)/.test(m[1])) return `an image link Telegram can't fetch: ${m[1]}`
  }
  return null
}

export function buttonsIn(md: string): Button[][] {
  return md.split('\n').filter(l => /^<tg-button-row>.*<\/tg-button-row>$/.test(l)).map(l =>
    [...l.matchAll(/<tg-button\s([^>]*)>(.*?)<\/tg-button>/g)].map(m => ({
      text: m[2].replace(/\\(.)/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
      data: m[1].match(/data="([^"]*)"/)?.[1],
    })))
}

const entitiesFor = (text: string) => {
  const m = text.match(/^\/\w+(@\w+)?/)
  return m ? [{ type: 'bot_command', offset: 0, length: m[0].length }] : undefined
}

export function createFakeTelegram({ token, botId = 900001, username = 'e2e_bot' }: { token: string, botId?: number, username?: string }) {
  const calls: Call[] = []
  const outgoing: { method: string, payload: any }[] = []
  const findings: Finding[] = []
  const sent: Sent[] = []
  const files = new Map<string, { path: string, data: Buffer }>()
  const topics = new Map<number, Map<number, { name: string, icon?: string, closed?: boolean }>>()
  const chats = new Map<number, any>()
  const members = new Map<string, any>()
  const reactions = new Map<string, string[]>()
  const reactionLog: { chat: number, id: number, emoji: string[], at: number }[] = []
  let answered: { id: string, text?: string, show_alert?: boolean, at: number }[] = []
  let drafts: { chat: number, thread?: number, draft: number, md: string, at: number }[] = []
  const commands: { scope?: any, list: any[] }[] = []
  let nextMessage = 1000
  let nextThread = 50_000
  let nextUpdate = 1
  let nextFile = 1
  let nextCallback = 1
  let lang: 'en' | 'ru' | null = null
  // A test can make a method fail once with these words, to see what the bot does
  const failNext = new Map<string, string[]>()
  const queue: any[] = []
  let polling: { res: ServerResponse, timer: NodeJS.Timeout } | null = null
  let lastPollAt = 0
  let pollConnections = 0
  // A network that fails: these methods lose their connection this many times, polling while it is on
  const dropping = new Map<string, number>()
  let pollingDown = false
  const blocks = new Map<number, number>()

  const finding = (why: string, method: string, sample: string) => findings.push({ why, method, sample: sample.slice(0, 200) })

  function flush() {
    if (!polling || !queue.length) return
    const { res, timer } = polling
    polling = null
    clearTimeout(timer)
    res.end(JSON.stringify({ ok: true, result: queue.splice(0) }))
  }
  const push = (u: any) => {
    queue.push({ update_id: nextUpdate++, ...u })
    flush()
  }

  const threadsOf = (chat: number) => {
    let t = topics.get(chat)
    if (!t) topics.set(chat, (t = new Map()))
    return t
  }
  const find = (chat: number, id: number) => sent.find(m => m.chat.id === chat && m.message_id === id)

  function lint(method: string, s: Sent) {
    const text = s.text
    if (s.html) {
      const p = lintHtml(text)
      if (p) finding(`HTML: ${p}`, method, text)
    }
    if (s.rich) {
      const p = lintMarkdown(text)
      if (p) finding(`Markdown: ${p}`, method, text)
    }
    // A file path, a code span or a tool's output may well say null: only the words around them are checked
    const words = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '').replace(/<code>[\s\S]*?<\/code>/g, '').replace(/<pre>[\s\S]*?<\/pre>/g, '')
    const raw = words.match(RAW)
    if (raw && !/SCRIPT:|echo:|E2E/.test(words)) finding(`raw text "${raw[0]}"`, method, text)
    if (lang) {
      const visible = words.replace(/<[^>]+>/g, ' ').replace(/https?:\S+/g, ' ')
      const cyr = /[А-Яа-яЁё]/.test(visible)
      const latin = visible.match(/[A-Za-z]{2,}(\s+[A-Za-z]{2,}){2,}/)
      if (!/SCRIPT:|echo:|E2E|e2e/.test(visible)) {
        if (lang === 'en' && cyr) finding('Russian in English mode', method, text)
        if (lang === 'ru' && !cyr && latin) finding('English in Russian mode', method, text)
      }
    }
    for (const row of s.buttons) {
      for (const b of row) {
        if (!b.text) finding('a button with no text', method, JSON.stringify(b))
        if (b.data && Buffer.byteLength(b.data) > 64) finding('callback data over 64 bytes', method, b.data)
        if (lang === 'en' && /[А-Яа-яЁё]/.test(b.text) && !/e2e|🇷🇺/i.test(b.text)) finding('Russian button in English mode', method, b.text)
        if (lang === 'ru' && !/[А-Яа-яЁё]/.test(b.text) && /[A-Za-z]{2,}\s+[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(b.text) && !/e2e/i.test(b.text)) finding('English button in Russian mode', method, b.text)
      }
    }
  }

  const keyboardOf = (p: any): Button[][] => (p.reply_markup?.inline_keyboard ?? []).map((r: any[]) => r.map(b => ({
    text: b.text, data: b.callback_data, url: b.url, copy: b.copy_text?.text,
  })))

  function record(method: string, p: any, content: { text: string, html: boolean, rich: boolean, media?: Sent['media'], buttons?: Button[][] }): Sent {
    const chat = Number(p.chat_id)
    const s: Sent = {
      message_id: nextMessage++, chat: { id: chat }, thread: p.message_thread_id, method,
      text: content.text, html: content.html, rich: content.rich,
      buttons: [...keyboardOf(p), ...(content.buttons ?? [])], reply_to: p.reply_parameters?.message_id,
      media: content.media ?? [], deleted: false, edits: 0, reactions: [], at: Date.now(), touched: Date.now(), fromBot: true, raw: p,
    }
    sent.push(s)
    lint(method, s)
    return s
  }

  const asMessage = (s: Sent) => ({
    message_id: s.message_id,
    date: Math.floor(s.at / 1000),
    from: { id: botId, is_bot: true, first_name: 'E2E', username },
    chat: chats.get(s.chat.id) ?? { id: s.chat.id, type: s.chat.id < 0 ? 'supergroup' : 'private' },
    ...(s.thread && { message_thread_id: s.thread, is_topic_message: true }),
    ...(s.rich ? { rich_message: { blocks: s.media.map((m, i) => ({ type: m.kind, [m.kind]: m.kind === 'photo' ? [{ file_id: `sent-${s.message_id}-${i}` }] : { file_id: `sent-${s.message_id}-${i}` } })) } } : { text: s.text }),
    ...(s.buttons.length && !s.rich && { reply_markup: { inline_keyboard: s.raw.reply_markup?.inline_keyboard } }),
  })

  class ApiError extends Error {
    code: number
    constructor(code: number, message: string) {
      super(message)
      this.code = code
    }
  }
  const bad = (m: string) => new ApiError(400, `Bad Request: ${m}`)

  function checkTarget(p: any) {
    const chat = Number(p.chat_id)
    if (p.message_thread_id !== undefined && !threadsOf(chat).has(p.message_thread_id)) throw bad('message thread not found')
    if (p.reply_parameters?.message_id && !p.reply_parameters.allow_sending_without_reply) {
      const r = allMessages.get(`${chat}:${p.reply_parameters.message_id}`) ?? find(chat, p.reply_parameters.message_id)
      if (!r || r.deleted) throw bad('message to be replied not found')
    }
  }

  const allMessages = new Map<string, any>()

  const richContent = (p: any, rm: any, files: Map<string, Buffer>) => {
    const md: string = rm.markdown
    const media: Sent['media'] = []
    for (const e of rm.media ?? []) {
      const ref = e.media?.media
      const name = typeof ref === 'string' && ref.startsWith('attach://') ? ref.slice(9) : undefined
      media.push({ kind: e.media?.type, name, bytes: name ? files.get(name)?.length : undefined, url: typeof ref === 'string' ? ref : undefined })
      if (!md.includes(`?id=${e.id}`)) finding('uploaded media no block points to', 'rich', md)
      if (md.includes(`tg://`) && !new RegExp(`tg://${e.media?.type}\\?id=${e.id}\\b`).test(md)) finding(`a block whose link is not a ${e.media?.type}`, 'rich', md)
      if (e.media?.type === 'photo' && name && (files.get(name)?.length ?? 0) > 10 * 1024 * 1024) finding('a photo over 10 MB', 'rich', md)
    }
    for (const m of md.matchAll(/tg:\/\/\w+\?id=(\w+)/g)) if (!(rm.media ?? []).some((e: any) => e.id === m[1])) finding(`a block points to media not sent: ${m[1]}`, 'rich', md)
    return { text: md, html: false, rich: true, media, buttons: buttonsIn(md) }
  }

  function call(method: string, p: any, uploads: Map<string, Buffer>): any {
    switch (method) {
      case 'getMe': return { id: botId, is_bot: true, first_name: 'E2E', username, can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false, has_topics_enabled: true }
      case 'deleteWebhook': case 'setMyProfilePhoto': case 'setChatPhoto': return true
      case 'setMyCommands': {
        for (const c of p.commands) if (!/^[a-z0-9_]{1,32}$/.test(c.command) || !c.description || c.description.length > 256) finding('a bad command in the menu', method, JSON.stringify(c))
        commands.push({ scope: p.scope, list: p.commands })
        return true
      }
      case 'sendChatAction': checkTarget(p); return true
      case 'sendMessage': {
        checkTarget(p)
        if (!p.text?.trim()) throw bad('message text is empty')
        if (p.parse_mode === 'HTML') {
          const problem = lintHtml(p.text)
          if (problem) {
            finding(`HTML the server would refuse: ${problem}`, method, p.text)
            throw bad(`can't parse entities: ${problem}`)
          }
        }
        // Telegram counts what is left after parsing
        const visible = p.parse_mode === 'HTML' ? p.text.replace(/<[^>]+>/g, '').replace(/&\w+;/g, ' ') : p.text
        if ([...visible].length > 4096) {
          finding('longer than 4096 characters', method, p.text)
          throw bad('message is too long')
        }
        return asMessage(record(method, p, { text: p.text, html: p.parse_mode === 'HTML', rich: false }))
      }
      case 'sendRichMessage': {
        checkTarget(p)
        const rm = p.rich_message
        if (!rm?.markdown?.trim()) throw bad('message text is empty')
        return asMessage(record(method, p, richContent(p, rm, uploads)))
      }
      case 'sendRichMessageDraft': {
        if (Number(p.chat_id) < 0) throw bad('TEXTDRAFT_PEER_INVALID')
        checkTarget(p)
        if (p.rich_message?.media?.length) finding('a draft with an upload', method, JSON.stringify(p.rich_message.media))
        const md = p.rich_message?.markdown ?? ''
        const problem = lintMarkdown(md)
        if (problem) finding(`draft Markdown: ${problem}`, method, md)
        drafts.push({ chat: Number(p.chat_id), thread: p.message_thread_id, draft: p.draft_id, md, at: Date.now() })
        return true
      }
      case 'sendDocument': case 'sendPhoto': case 'sendVideo': case 'sendAnimation': {
        checkTarget(p)
        const kind = method.slice(4).toLowerCase()
        const ref = p[kind]
        const name = typeof ref === 'string' && ref.startsWith('attach://') ? ref.slice(9) : undefined
        const s = record(method, p, { text: p.caption ?? '', html: p.parse_mode === 'HTML', rich: false, media: [{ kind, name, bytes: name ? uploads.get(name)?.length : undefined }] })
        return asMessage(s)
      }
      case 'sendSticker': {
        checkTarget(p)
        const name = typeof p.sticker === 'string' && p.sticker.startsWith('attach://') ? p.sticker.slice(9) : undefined
        const data = name ? uploads.get(name) : undefined
        if (!data) throw bad('wrong remote file identifier specified')
        try {
          const l = JSON.parse(gunzipSync(data).toString())
          if (l.w !== 512 || l.h !== 512 || data.length > 64 * 1024) throw new Error('rules')
        } catch {
          finding('a sticker Telegram would refuse', method, String(p.sticker))
          throw bad('STICKER_TGS_NOTGS')
        }
        return asMessage(record(method, p, { text: '', html: false, rich: false, media: [{ kind: 'sticker', name, bytes: data.length }] }))
      }
      case 'editMessageText': {
        const s = find(Number(p.chat_id), p.message_id)
        if (!s || s.deleted) throw bad('message to edit not found')
        const content = p.rich_message ? richContent(p, p.rich_message, uploads) : { text: p.text, html: p.parse_mode === 'HTML', rich: false, media: [] as Sent['media'], buttons: [] as Button[][] }
        const buttons = [...keyboardOf(p), ...content.buttons]
        if (p.parse_mode === 'HTML') {
          const problem = lintHtml(p.text)
          if (problem) {
            finding(`HTML the server would refuse: ${problem}`, method, p.text)
            throw bad(`can't parse entities: ${problem}`)
          }
        }
        if (s.text === content.text && JSON.stringify(s.buttons) === JSON.stringify(buttons)) throw bad('message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message')
        // An edit that drops a picture the message had: the bug fixed in 0.5.3
        if (s.media.length && !content.media.length) finding('an edit dropped the picture of the message', method, content.text)
        Object.assign(s, { text: content.text, html: content.html, rich: content.rich, buttons, media: content.media.length ? content.media : s.media, edits: s.edits + 1, touched: Date.now() })
        lint(method, s)
        return asMessage(s)
      }
      case 'editMessageReplyMarkup': {
        const s = find(Number(p.chat_id), p.message_id)
        if (!s || s.deleted) throw bad('message to edit not found')
        const buttons = keyboardOf(p)
        if (JSON.stringify(s.buttons) === JSON.stringify(buttons)) throw bad('message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message')
        s.buttons = buttons
        s.raw = { ...s.raw, reply_markup: p.reply_markup }
        s.edits++
        lint(method, s)
        return asMessage(s)
      }
      case 'deleteMessage': {
        const s = find(Number(p.chat_id), p.message_id)
        const u = allMessages.get(`${p.chat_id}:${p.message_id}`)
        if (u && !u.deleted) {
          u.deleted = true
          return true
        }
        if (!s || s.deleted) throw bad('message to delete not found')
        s.deleted = true
        return true
      }
      case 'setMessageReaction': {
        const key = `${p.chat_id}:${p.message_id}`
        const exists = (allMessages.get(key) && !allMessages.get(key).deleted) || (find(Number(p.chat_id), p.message_id) && !find(Number(p.chat_id), p.message_id)!.deleted)
        if (!exists) throw bad('message to react not found')
        const list = (p.reaction ?? []).map((r: any) => r.emoji)
        for (const e of list) if (!REACTIONS.has(e)) finding(`a reaction Telegram refuses: ${e}`, method, e)
        reactions.set(key, list)
        reactionLog.push({ chat: Number(p.chat_id), id: p.message_id, emoji: list, at: Date.now() })
        return true
      }
      case 'answerCallbackQuery': {
        if (p.text && [...p.text].length > 200) finding('a callback answer over 200 characters', method, p.text)
        if (p.text) lintPlain(method, p.text)
        answered.push({ id: p.callback_query_id, text: p.text, show_alert: p.show_alert, at: Date.now() })
        return true
      }
      case 'createForumTopic': {
        if (!p.name || [...p.name].length > 128) throw bad('TOPIC_NAME_INVALID')
        const id = nextThread++
        threadsOf(Number(p.chat_id)).set(id, { name: p.name, icon: p.icon_custom_emoji_id })
        return { message_thread_id: id, name: p.name, icon_color: 0, icon_custom_emoji_id: p.icon_custom_emoji_id }
      }
      case 'editForumTopic': {
        const t = threadsOf(Number(p.chat_id)).get(p.message_thread_id)
        if (!t) throw bad('message thread not found')
        if (p.name !== undefined && (!p.name || [...p.name].length > 128)) throw bad('TOPIC_NAME_INVALID')
        if (p.name !== undefined && p.name === t.name && p.icon_custom_emoji_id === undefined) throw bad('TOPIC_NOT_MODIFIED')
        Object.assign(t, { ...(p.name !== undefined && { name: p.name }), ...(p.icon_custom_emoji_id !== undefined && { icon: p.icon_custom_emoji_id }) })
        return true
      }
      case 'deleteForumTopic': {
        if (!threadsOf(Number(p.chat_id)).delete(p.message_thread_id)) throw bad('message thread not found')
        return true
      }
      case 'getForumTopicIconStickers': return ['❓', '❗', '🤖', '🔵'].map((e, i) => ({ emoji: e, custom_emoji_id: `icon-${i}`, file_id: `s${i}`, file_unique_id: `s${i}`, type: 'custom_emoji', width: 1, height: 1, is_animated: false, is_video: false }))
      case 'getChat': {
        const c = chats.get(Number(p.chat_id))
        if (!c) throw bad('chat not found')
        return { ...c, accent_color_id: 0, max_reaction_count: 1, accepted_gift_types: {} }
      }
      case 'getChatMember': {
        const c = members.get(`${p.chat_id}:${p.user_id}`)
        return c ?? { status: 'member', user: { id: p.user_id, is_bot: p.user_id === botId, first_name: 'x' } }
      }
      case 'getChatMemberCount': return 2
      case 'getUserProfilePhotos': return { total_count: 0, photos: [] }
      case 'leaveChat': chats.delete(Number(p.chat_id)); return true
      // A head's team board is pinned in its topic
      case 'pinChatMessage':
      case 'unpinChatMessage': return true
      case 'getFile': {
        const f = files.get(p.file_id)
        if (!f) throw bad('wrong file_id or the file is temporarily unavailable')
        return { file_id: p.file_id, file_unique_id: p.file_id, file_size: f.data.length, file_path: f.path }
      }
      default:
        finding('a method the fake does not know', method, JSON.stringify(p))
        throw new ApiError(404, 'Not Found: method not found')
    }
  }

  function lintPlain(method: string, text: string) {
    if (lang === 'en' && /[А-Яа-яЁё]/.test(text)) finding('Russian in English mode', method, text)
    if (lang === 'ru' && !/[А-Яа-яЁё]/.test(text) && /[A-Za-z]{2,}\s+[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(text) && !/e2e/i.test(text)) finding('English in Russian mode', method, text)
  }

  async function parseBody(req: IncomingMessage, url: URL) {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = Buffer.concat(chunks)
    const type = req.headers['content-type'] ?? ''
    const uploads = new Map<string, Buffer>()
    if (type.includes('json')) return { p: body.length ? JSON.parse(body.toString()) : {}, uploads }
    if (type.includes('multipart')) {
      const form = await new Response(body, { headers: { 'content-type': type } }).formData()
      const p: any = {}
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') {
          try {
            p[k] = /^[{["\d-]|^true$|^false$/.test(v) ? JSON.parse(v) : v
          } catch {
            p[k] = v
          }
        } else uploads.set(k, Buffer.from(await (v as File).arrayBuffer()))
      }
      return { p, uploads }
    }
    return { p: Object.fromEntries(url.searchParams), uploads }
  }

  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json')
    const url = new URL(req.url!, 'http://x')
    const fileRoute = url.pathname.match(/^\/file\/bot([^/]+)\/(.+)$/)
    if (fileRoute) {
      if (fileRoute[1] !== token) return void res.writeHead(401).end()
      const f = [...files.values()].find(x => x.path === fileRoute[2])
      if (!f) return void res.writeHead(404).end()
      return void res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(f.data)
    }
    const m = url.pathname.match(/^\/bot([^/]+)\/(\w+)$/)
    if (!m || m[1] !== token) return void res.writeHead(401).end(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }))
    const method = m[2]
    if (dropping.get(method)) {
      dropping.set(method, dropping.get(method)! - 1)
      return void req.socket.destroy()
    }
    if (method === 'getUpdates' && pollingDown) return void req.socket.destroy()
    let parsed
    try {
      parsed = await parseBody(req, url)
    } catch (e) {
      finding(`a body that can't be read: ${(e as Error).message}`, method, '')
      return void res.writeHead(400).end(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request' }))
    }
    if (method === 'getUpdates') {
      // A second long poll at once is Telegram's 409: two copies of the bot
      lastPollAt = Date.now()
      if (polling) {
        clearTimeout(polling.timer)
        polling.res.end(JSON.stringify({ ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' }))
        polling = null
        pollConnections++
      }
      if (parsed.p.offset) while (queue.length && queue[0].update_id < Number(parsed.p.offset)) queue.shift()
      if (queue.length) return void res.end(JSON.stringify({ ok: true, result: queue.splice(0) }))
      const timer = setTimeout(() => {
        if (polling?.res === res) polling = null
        res.end(JSON.stringify({ ok: true, result: [] }))
      }, Math.min(Number(parsed.p.timeout ?? 1), 2) * 1000)
      polling = { res, timer }
      res.on('close', () => {
        if (polling?.res === res) {
          clearTimeout(timer)
          polling = null
        }
      })
      return
    }
    const entry: Call = { method, payload: parsed.p, at: Date.now(), ok: true }
    if (method === 'sendMessage' || method === 'editMessageText' || method === 'sendRichMessage') outgoing.push({ method, payload: parsed.p })
    calls.push(entry)
    const forced = failNext.get(method)?.shift()
    try {
      if (forced) throw new ApiError(400, forced)
      const blockedUntil = blocks.get(Number(parsed.p.chat_id))
      if (blockedUntil && blockedUntil > Date.now() && /^(send(?!ChatAction)|edit|delete|createForumTopic|setMessageReaction)/.test(method)) {
        entry.ok = false
        entry.error = '429'
        return void res.writeHead(429).end(JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests: retry later', parameters: { retry_after: Math.ceil((blockedUntil - Date.now()) / 1000) } }))
      }
      const result = call(method, parsed.p, parsed.uploads)
      res.end(JSON.stringify({ ok: true, result }))
    } catch (e) {
      if (!(e instanceof ApiError)) throw e
      entry.ok = false
      entry.error = e.message
      res.writeHead(e.code).end(JSON.stringify({ ok: false, error_code: e.code, description: e.message }))
    }
  })

  const addMessage = (m: any) => {
    allMessages.set(`${m.chat.id}:${m.message_id}`, m)
    return m
  }

  const userMessage = (from: any, chatId: number, thread: number | undefined, extra: any) => {
    const chat = chats.get(chatId) ?? { id: chatId, type: 'private', first_name: from.first_name, has_topics_enabled: true }
    chats.set(chatId, chat)
    return addMessage({
      message_id: nextMessage++, date: Math.floor(Date.now() / 1000), from, chat,
      ...(thread && { message_thread_id: thread, is_topic_message: true }),
      ...extra,
    })
  }

  return {
    calls, sent, findings, topics, chats, members, outgoing,
    drafts: () => drafts,
    answered: () => answered,
    commands,
    reactionLog,
    reactionsOf: (chat: number, id: number) => reactions.get(`${chat}:${id}`) ?? [],
    userMessageOf: (chat: number, id: number) => allMessages.get(`${chat}:${id}`),
    dropConnections: (methods: string[], times: number) => { for (const m of methods) dropping.set(m, times) },
    rateLimit: (chat: number, seconds: number) => blocks.set(chat, Date.now() + seconds * 1000),
    dropPolling: (down: boolean) => {
      pollingDown = down
      if (down && polling) {
        clearTimeout(polling.timer)
        polling.res.socket?.destroy()
        polling = null
      }
    },
    failNext: (method: string, description: string) => failNext.set(method, [...(failNext.get(method) ?? []), description]),
    setLang: (l: 'en' | 'ru' | null) => { lang = l },
    listen: () => new Promise<number>(r => server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port))),
    close: () => new Promise<void>(r => {
      if (polling) {
        clearTimeout(polling.timer)
        polling.res.end(JSON.stringify({ ok: true, result: [] }))
      }
      server.closeAllConnections()
      server.close(() => r())
    }),
    lastPollAt: () => lastPollAt,
    pollConflicts: () => pollConnections,

    // What a user does
    text(from: any, chatId: number, text: string, o: { thread?: number, replyTo?: number } = {}) {
      const reply = o.replyTo ? { reply_to_message: allMessages.get(`${chatId}:${o.replyTo}`) ?? { message_id: o.replyTo, chat: { id: chatId }, date: 0 } } : {}
      const m = userMessage(from, chatId, o.thread, { text, entities: entitiesFor(text), ...reply })
      push({ message: m })
      return m
    },
    edit(from: any, m: any, text: string) {
      m.text = text
      push({ edited_message: { ...m, text, edit_date: Math.floor(Date.now() / 1000), from } })
    },
    file(data: Buffer, ext: string) {
      const id = `file-${nextFile++}-${randomBytes(3).toString('hex')}`
      files.set(id, { path: `files/${id}.${ext}`, data })
      return { file_id: id, file_unique_id: id, file_size: data.length }
    },
    media(from: any, chatId: number, extra: any, thread?: number) {
      const m = userMessage(from, chatId, thread, extra)
      push({ message: m })
      return m
    },
    tap(from: any, s: Sent, data: string) {
      const id = String(nextCallback++)
      push({
        callback_query: {
          id, from, chat_instance: 'x', data,
          message: asMessage(s),
        },
      })
      return id
    },
    wasAnswered: (id: string) => answered.find(a => a.id === id),
    react(from: any, chat: number, id: number, emoji: string[], before: string[] = []) {
      push({
        message_reaction: {
          chat: chats.get(chat) ?? { id: chat, type: 'private' }, message_id: id, user: from, date: Math.floor(Date.now() / 1000),
          old_reaction: before.map(e => ({ type: 'emoji', emoji: e })), new_reaction: emoji.map(e => ({ type: 'emoji', emoji: e })),
        },
      })
    },
    stopDraft(from: any, chat: number, thread: number | undefined, draft: number) {
      push({ stopped_message_generation: { chat: chats.get(chat), message_thread_id: thread, draft_id: draft, from } })
    },
    // Bot added to a group: membership update, as Telegram sends it
    addGroup(from: any, id: number, title: string) {
      const chat = { id, type: 'supergroup', title, is_forum: true }
      chats.set(id, chat)
      members.set(`${id}:${botId}`, { status: 'administrator', user: { id: botId, is_bot: true, first_name: 'E2E', username }, can_manage_topics: true, can_delete_messages: true, can_pin_messages: true, can_change_info: true })
      push({ my_chat_member: { chat, from, date: Math.floor(Date.now() / 1000), old_chat_member: { status: 'left', user: { id: botId, is_bot: true, first_name: 'E2E' } }, new_chat_member: members.get(`${id}:${botId}`) } })
      return chat
    },
    // A basic group, as the bot sees it when it is added as an admin
    addPlainGroup(from: any, id: number, title: string) {
      const chat = { id, type: 'group', title }
      chats.set(id, chat)
      members.set(`${id}:${botId}`, { status: 'administrator', user: { id: botId, is_bot: true, first_name: 'E2E', username } })
      push({ my_chat_member: { chat, from, date: Math.floor(Date.now() / 1000), old_chat_member: { status: 'left', user: { id: botId, is_bot: true, first_name: 'E2E' } }, new_chat_member: members.get(`${id}:${botId}`) } })
      return chat
    },
    // Telegram turns it into a supergroup: a new id, said in both chats, the old membership ended first, as it may be
    migrateGroup(from: any, id: number, to: number, forum = false) {
      const old = chats.get(id)
      const chat = { id: to, type: 'supergroup', title: old.title, ...(forum && { is_forum: true }) }
      chats.set(to, chat)
      members.set(`${to}:${botId}`, members.get(`${id}:${botId}`))
      push({ my_chat_member: { chat: old, from, date: Math.floor(Date.now() / 1000), old_chat_member: members.get(`${id}:${botId}`), new_chat_member: { status: 'left', user: { id: botId, is_bot: true, first_name: 'E2E' } } } })
      push({ message: userMessage(from, id, undefined, { migrate_to_chat_id: to }) })
      push({ message: userMessage(from, to, undefined, { migrate_from_chat_id: id }) })
      return chat
    },
    userTopic(chatId: number, name: string) {
      const id = nextThread++
      threadsOf(chatId).set(id, { name })
      return id
    },
    topicCreated(from: any, chatId: number, thread: number, name: string) {
      const m = userMessage(from, chatId, thread, { forum_topic_created: { name, icon_color: 0 } })
      push({ message: m })
      return m
    },
  }
}

export type FakeTelegram = ReturnType<typeof createFakeTelegram>
