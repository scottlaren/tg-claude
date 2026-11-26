import { redact } from './redact.ts'
import type { DeviceTool } from '@tgcv/protocol'
import { isDeviceTool, deviceToolOf } from '../claude/device-tools.ts'
import type { OpOutcome } from '../gateway.ts'
import { tr, count } from '../i18n.ts'
import { claudeEmoji, thinkingStatus } from './emoji.ts'

// Telegram rich message limit is 32768 chars; keep headroom for the steps block
export const RICH_LIMIT = 30000
export const PLAIN_LIMIT = 4000

type Input = Record<string, unknown>

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))
const code = (s: string) => '`' + s.replace(/`/g, "'").replace(/\s+/g, ' ').trim() + '`'
import { trunc } from './text.ts'
const commandLine = (i: Input) => str(i.command) || [str(i.program), ...((i.args as string[]) ?? [])].join(' ')

const STEP_ICON: Record<DeviceTool, string> = {
  list_files: '🗂', read_file: '📖', write_file: '📝', edit_file: '✏️', run_command: '⚙️',
  list_apps: '🖥', open_app: '🚀', close_app: '🛑', add_project_folder: '📂', add_mcp_server: '🧩', remove_mcp_server: '🧩', send_file: '📤', save_attachment: '📥', view_image: '👁',
}

// Russian: 1 шаг, 3 шага, 5 шагов
export function plural(n: number, one: string, few: string, many: string) {
  const tens = Math.abs(n) % 100
  const last = tens % 10
  return tens > 10 && tens < 20 ? many : last === 1 ? one : last > 1 && last < 5 ? few : many
}
const stepsWord = (n: number) => count(n, ['step', 'steps'], ['шаг', 'шага', 'шагов'])

// A head's own steps read as what it does with its agents
function teamStep(tool: string, input: Input) {
  const who = str(input.agent) || str(input.name)
  if (tool === 'start_agent') return `🤖 ${tr('agent', 'агент')} ${who} · ${str(input.model) || 'sonnet'} ${str(input.effort) || 'medium'}`
  if (tool === 'message_agent') return `🧭 → ${who}`
  if (tool === 'set_agent_model') return `🧠 ${who}: ${[str(input.model), str(input.effort)].filter(Boolean).join(' ')}`
  if (tool === 'team_status') return tr('🤖 agents status', '🤖 состояние агентов')
  if (tool === 'stop_agent') return `⏹ ${who}`
  if (tool === 'remove_agent') return `👋 ${who}`
  return null
}

// One line per tool call in the live draft and in the folded steps list
export function toolStep(name: string, input: Input = {}) {
  if (isDeviceTool(name)) {
    const t = deviceToolOf(name)
    if (t === 'list_apps') return `${STEP_ICON[t]} ${tr('apps', 'приложения')}`
    const arg = t === 'run_command' ? trunc(commandLine(input), 70)
      : t === 'open_app' || t === 'close_app' ? [str(input.app), str(input.file)].filter(Boolean).join(' ')
        : t === 'save_attachment' ? `${str(input.id)} → ${str(input.path) || '.'}`
          : t === 'add_mcp_server' || t === 'remove_mcp_server' ? str(input.name)
            : str(input.path) || '.'
    return `${STEP_ICON[t]} ${code(arg)}`
  }
  if (name === 'WebSearch') return `🔍 ${trunc(str(input.query), 60)}`
  if (name === 'ToolSearch') return `🧰 ${code(trunc(str(input.query), 50))}`
  if (name === 'WebFetch') {
    let host = str(input.url)
    try { host = new URL(host).host } catch {}
    return `🌐 ${host}`
  }
  if (name === 'mcp__topics__message_topic') return `✉️ → ${trunc(str(input.topic), 60)}`
  if (name === 'mcp__later__defer_task') return `📌 ${trunc(str(input.title ?? input.task), 60)}`
  if (name === 'AskUserQuestion') return `❓ ${trunc(str((input.questions as { question?: unknown }[] | undefined)?.[0]?.question), 60)}`
  if (name === 'mcp__workspace_memory__record_decision') return `📌 ${trunc(str(input.text), 60)}`
  if (name === 'mcp__schedule__schedule_task') return `⏰ ${trunc(str(input.name), 60)}`
  if (name === 'mcp__topic_name__rename_topic') return `✏️ ${trunc(str(input.name), 60)}`
  if (name === 'mcp__survey__ask_survey') return `📋 ${(input.questions as unknown[] | undefined)?.length ?? 0} ${tr('questions', 'вопр.')}`
  if (name === 'mcp__computer__copy_files') return `📦 ${code(trunc(str(input.path), 50))} ${input.direction === 'fetch' ? '←' : '→'} ${str(input.computer)}`
  if (name.startsWith('mcp__team__')) {
    const step = teamStep(name.slice('mcp__team__'.length), input)
    if (step) return step
  }
  if (name.startsWith('mcp__')) return `🔌 ${name.split('__').slice(1).join(' · ')}`
  return `🔧 ${name}`
}

export function formatDuration(ms: number) {
  const s = Math.round(ms / 1000)
  return s < 60 ? tr(`${s}s`, `${s} с`) : tr(`${Math.floor(s / 60)}m ${s % 60}s`, `${Math.floor(s / 60)} мин ${s % 60} с`)
}

// Two columns of plain facts. Telegram draws an empty header as an empty row, so the first fact stands in its place
export const plainTable = (rows: string[]) => [rows[0], '|:--|:--|', ...rows.slice(1)].join('\n')

// A streamed chunk can end inside ``` — close it so the draft still renders
export function closeOpenFence(text: string) {
  const fences = text.match(/^\s*```/gm)?.length ?? 0
  return fences % 2 ? text + '\n```' : text
}

const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/

// Claude often writes a table right under a line of text. Telegram then reads the whole table as part
// of that paragraph and shows it as one line, so a table always gets blank lines around it
export function separateTables(md: string) {
  const lines = md.split('\n')
  const out: string[] = []
  let fence = false
  let table = false
  for (const [i, line] of lines.entries()) {
    if (/^\s*```/.test(line)) fence = !fence
    if (!fence && !table && line.includes('|') && TABLE_DELIMITER.test(lines[i + 1] ?? '')) {
      table = true
      if (out.length && out.at(-1)!.trim()) out.push('')
    } else if (table && !line.trim().startsWith('|')) {
      table = false
      if (line.trim()) out.push('')
    }
    out.push(line)
  }
  return out.join('\n')
}

// Telegram draws paragraphs with almost no gap, so "**What works:**" sections ran together.
// A bold line on its own is a section title: as a heading it gets its own size and spacing
export function sectionTitles(md: string) {
  let fence = false
  return md.split('\n').map(line => {
    if (/^\s*```/.test(line)) fence = !fence
    const title = fence ? null : line.match(/^\*\*([^*]+?):?\*\*:?\s*$/)
    return title ? `### ${title[1].trim()}` : line
  }).join('\n')
}

// Lines that start their own block or belong to one: a break next to them means nothing, or breaks the markup
const NOT_PROSE = /^\s*$|^\s*(```|[-*+] |\d+[.)] |#|>|\||<|!\[)|^ {4}|^\s*:?-+:?\s*(\||$)/

// Telegram glues lines of a paragraph into one, as markdown does, so a list of plain lines turned into a run-on
// sentence. Claude means a break when it writes one: two trailing spaces keep it
export function keepLineBreaks(md: string) {
  const lines = md.split('\n')
  let fence = false
  return lines.map((line, i) => {
    if (/^\s*```/.test(line)) fence = !fence
    const next = lines[i + 1]
    return fence || next === undefined || NOT_PROSE.test(line) || NOT_PROSE.test(next) ? line : `${line.trimEnd()}  `
  }).join('\n')
}

// A button in a rich message is only markup, Telegram takes it anywhere in the text, and its data could be anything the
// bot answers to: "del:yes" under the label "Show details". Closing tags go first, so what they held apart can't join up
// into a tag, then an invisible space makes every opening one plain text. Claude's text comes partly from files and pages
export const defuseButtons = (md: string) => md
  .replace(/<\/tg-button(-row)?\s*>/gi, '')
  .replace(/<(?=\/?tg-button)/gi, '<\u200b')

const OWN_BUTTONS = /^<tg-button-row>.*<\/tg-button-row>$/

// The last line of defence, on everything that goes to Telegram. The bot's own buttons are always the last lines of a
// message: nothing else may be a button, whichever way it got in (a step, a name, a caption, an error)
export function keepOwnButtons(md: string) {
  const lines = md.split('\n')
  let end = lines.length
  while (end > 0 && (!lines[end - 1].trim() || OWN_BUTTONS.test(lines[end - 1]))) end--
  return [defuseButtons(lines.slice(0, end).join('\n')), ...lines.slice(end)].join('\n')
}

// What Claude wrote, adjusted to how Telegram draws it
const tidy = (md: string) => keepLineBreaks(separateTables(sectionTitles(defuseButtons(md))))

// Replies Claude suggests to its own answer, as its last line: [[replies: Yes | No]], or with the question they answer:
// [[replies: Ship it? :: Yes | No]]. They become buttons that send exactly what they say, so a suggestion can't hide
// what the tap will do; the question stands right above them, so the user needn't look for it in the text
const REPLIES_MARK = '[[replies:'
const REPLIES_MAX = 3
const REPLY_MAX_CHARS = 40
const QUESTION_MAX_CHARS = 120
const lastLine = (s: string) => s.slice(s.lastIndexOf('\n') + 1).trim()

export function splitReplies(answer: string): { text: string, replies: string[], question?: string } {
  const body = answer.trimEnd()
  const last = lastLine(body)
  if (!last.startsWith(REPLIES_MARK) || !last.endsWith(']]')) return { text: answer, replies: [] }
  const inside = last.slice(REPLIES_MARK.length, -2)
  const cut = inside.indexOf('::')
  const asked = cut < 0 ? '' : inside.slice(0, cut).trim()
  const said = (cut < 0 ? inside : inside.slice(cut + 2)).split('|').map(r => r.trim()).filter(r => r && r.length <= REPLY_MAX_CHARS)
  const replies = [...new Set(said)].slice(0, REPLIES_MAX)
  const question = asked && asked.length <= QUESTION_MAX_CHARS && replies.length ? asked : ''
  return { text: body.slice(0, body.lastIndexOf('\n') + 1).trimEnd(), replies, ...(question && { question }) }
}

// The question the buttons answer, as the last block above them
export const replyQuestion = (question: string) => `> ❓ **${question.replace(/\*\*/g, '')}**`

// While the answer streams, the line is still being written: it never flashes in the draft
function hideReplies(text: string) {
  const last = lastLine(text)
  if (!last || !(last.startsWith(REPLIES_MARK) || REPLIES_MARK.startsWith(last))) return text
  return text.slice(0, text.lastIndexOf('\n') + 1).trimEnd()
}

const BUTTON_ROW = /^<tg-button-row>.*<\/tg-button-row>$/gm
export const withoutButtons = (md: string) => md.replace(BUTTON_ROW, '').trimEnd()

const buttonLabel = (r: string) => r.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\*_~`|=$[\]]/g, '\\$&')

export type RichButton = { text: string, data: string, style?: 'primary' | 'success' | 'danger' }

// Buttons inside a rich message, one row of the markup per row of buttons: a line each, so a long message never
// splits a row, and the fallback to plain text can take them out whole
// A rich message joins lines into one paragraph unless a line ends in two spaces
export const richLines = (s: string) => s.replace(/([^\n])\n(?!\n)/g, '$1  \n')

export const richButtons = (rows: RichButton[][]) => rows
  .map(r => `<tg-button-row>${r.map(b => `<tg-button type="callback_data"${b.style ? ` style="${b.style}"` : ''} data="${b.data}">${buttonLabel(b.text)}</tg-button>`).join('')}</tg-button-row>`)
  .join('\n')

export type SentMedia = { id: string, media: { type: string, media: string } }

// The files of a sent rich message, for sending it again: an edit can't upload anything, but it can point at what
// Telegram already keeps. Null when the blocks don't line up with what was uploaded: better no edit than the wrong file
export function reusableMedia(blocks: unknown[], uploads: { id: string, kind: string }[]): SentMedia[] | null {
  const files = (blocks as Record<string, unknown>[]).flatMap(b => {
    const file = b[String(b.type)]
    const found = Array.isArray(file) ? file.at(-1) : file
    const id = found && typeof found === 'object' ? (found as { file_id?: string }).file_id : undefined
    return id ? [id] : []
  })
  if (files.length !== uploads.length) return null
  return uploads.map((u, i) => ({ id: u.id, media: { type: u.kind, media: files[i] } }))
}

// A quote that folds behind an arrow when long. HTML for a plain message: inside a rich one Telegram accepts the same
// tag but the apps show it unfolded. Plain messages have no code blocks: fence marks go, their lines stay
export function foldedQuote(text: string, max = 3000) {
  const t = text.trim()
  const cut = t.length > max ? `${t.slice(0, max - 1)}…` : t
  const lines = cut.split(/\r?\n/).filter(l => !/^\s*```/.test(l))
  return `<blockquote expandable>${lines.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</blockquote>`
}

// One line of Markdown as Telegram's HTML. Code goes aside first, so nothing inside it counts as formatting; each pair
// opens and closes within the line, so the tags stay balanced wherever the text was cut
function inlineHtml(line: string) {
  const code: string[] = []
  const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escape(line)
    .replace(/`([^`]+)`/g, (_m, c) => `\0${code.push(c) - 1}\0`)
    .replace(/!?\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, name, url) => (/^https?:\/\//.test(url) ? `<a href="${url.replace(/"/g, '&quot;')}">${name}</a>` : name))
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/(^|[\s(])\*([^\s*](?:[^*]*[^\s*])?)\*(?=$|[\s).,:;!?])/g, '$1<i>$2</i>')
    .replace(/\0(\d+)\0/g, (_m, n) => `<code>${code[Number(n)]}</code>`)
}

const tableCells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

// What a report or a letter says, inside a quote that folds: a plain message's HTML has no Markdown, no headings and no
// tables, so headings turn bold and a table turns into lines. Not for a voice transcript: asterisks there are just speech
export function markdownQuote(text: string, max = 3000) {
  const t = text.trim()
  const lines = (t.length > max ? `${t.slice(0, max - 1)}…` : t).split(/\r?\n/)
  const out: string[] = []
  let code: string[] | null = null
  const flush = () => {
    // Line by line, not <pre>: the apps draw a code block outside the quote, in sight under the fold
    if (code) out.push(...code.map(l => (l.trim() ? `<code>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>` : '')))
    code = null
  }
  for (const [i, line] of lines.entries()) {
    if (/^\s*```/.test(line)) {
      if (code) flush()
      else code = []
    } else if (code) code.push(line)
    else if (TABLE_DELIMITER.test(line) && lines[i - 1]?.includes('|')) continue
    else if (line.includes('|') && (TABLE_DELIMITER.test(lines[i + 1] ?? '') || (out.length && /^\s*\|.*\|\s*$/.test(line)))) {
      const cells = tableCells(line).map(inlineHtml)
      const row = cells.length === 2 ? cells.join(': ') : cells.join(' · ')
      out.push(TABLE_DELIMITER.test(lines[i + 1] ?? '') ? `<b>${row}</b>` : row)
    } else {
      const heading = line.match(/^\s*#{1,6}\s+(.*)$/)
      const item = line.match(/^(\s*)[-*+]\s+(.*)$/)
      if (heading) out.push(`<b>${inlineHtml(heading[1].replace(/\*\*/g, ''))}</b>`)
      else if (item) out.push(`${item[1]}• ${inlineHtml(item[2])}`)
      else out.push(inlineHtml(line.replace(/^\s*>\s?/, '')))
    }
  }
  flush()
  return `<blockquote expandable>${out.join('\n').replace(/\n{3,}/g, '\n\n')}</blockquote>`
}

// The message once its suggestions are over: the buttons go, and the reply tapped stays in their place
export const settledMarkdown = (md: string, choice?: string) => {
  const text = withoutButtons(md)
  // Bold ends with its line: an answer in several lines would leave the marks open
  return choice ? `${text}\n\n> 👉 **${buttonLabel(trunc(choice.replace(/\s+/g, ' ').trim(), 120))}**` : text
}

// In letters too: these go through the masking of secrets with the rest of the message, and an id of 13 digits can
// pass for a card number, which would break the button without a word
export const suggestionData = (id: number, i: number) => `sug:${id.toString(36)}:${i}`
export const suggestionId = (data: string) => parseInt(data, 36)

// Inside the message, after its text. Short ones share a row, longer ones get one each so a phone doesn't cut them
// One row when they are short; of three, the first two side by side when they fit and the last across; otherwise one each
export function replyButtons(replies: string[], data: (i: number) => string) {
  const buttons = replies.map((text, i): RichButton => ({ text, data: data(i), ...(!i && { style: 'primary' as const }) }))
  if (replies.join('').length <= 30) return richButtons([buttons])
  if (buttons.length === 3 && replies[0].length + replies[1].length <= 30) return richButtons([buttons.slice(0, 2), [buttons[2]]])
  return richButtons(buttons.map(b => [b]))
}

export const STATUS_TIME_STEP_MS = 30_000

// The plan at the very top, where the eye lands first, and then fewer of the latest steps: the plan says where it is
function recentSteps(steps: string[], plan?: string) {
  const parts: string[] = plan ? [plan] : []
  const tail = steps.slice(plan ? -3 : -6)
  if (steps.length > tail.length) parts.push(`_…${tr('and', 'ещё')} ${stepsWord(steps.length - tail.length)}${tr(' more', '')}_`)
  if (tail.length) parts.push(tail.map(s => `- ${s}`).join('\n'))
  return parts
}

// The same in a group, as an ordinary message: no text being written, and <tg-thinking> only works in a draft
export function statusMarkdown({ steps, status, elapsedMs = 0, plan }: { steps: string[], status: string, elapsedMs?: number, plan?: string }) {
  // A long step changes nothing on screen: the time shows it isn't frozen. In coarse steps, each one is a write
  const time = elapsedMs >= STATUS_TIME_STEP_MS ? ` · ${formatDuration(Math.floor(elapsedMs / STATUS_TIME_STEP_MS) * STATUS_TIME_STEP_MS)}` : ''
  return [...recentSteps(steps, plan), `${status || thinkingStatus()}${time}`].join('\n\n')
}

// Live preview while Claude works: recent steps, streamed text, status line
export function draftMarkdown({ steps, text, status, plan }: { steps: string[], text: string, status: string, plan?: string }) {
  const parts = recentSteps(steps, plan)
  if (text) {
    const t = stripDeviceMedia(hideReplies(text.length > RICH_LIMIT - 2000 ? '…' + text.slice(-(RICH_LIMIT - 2000)) : text))
    parts.push(tidy(closeOpenFence(t)))
  }
  parts.push(`<tg-thinking>${status || thinkingStatus()}</tg-thinking>`)
  return parts.join('\n\n')
}

export function stepsBlock(steps: string[], durationMs?: number, finished = true, cost?: string) {
  if (!steps.length) return ''
  const shown = steps.slice(0, 80)
  const more = steps.length - shown.length
  const list = shown.map(s => `- ${s}`).join('\n') + (more > 0 ? `\n- …${tr(`${more} more`, `и ещё ${more}`)}` : '')
  const meta = [stepsWord(steps.length), durationMs ? formatDuration(durationMs) : null, cost].filter(Boolean).join(' · ')
  return `<details><summary>${finished ? claudeEmoji('done') : '🔧'} ${meta}</summary>\n\n${list}\n\n</details>`
}

export function finalMarkdown({ text, steps, durationMs, note, cost, plan }: { text?: string, steps: string[], durationMs?: number, note?: string | null, cost?: string, plan?: string }) {
  return [plan, stepsBlock(steps, durationMs, !note, cost), tidy(closeOpenFence(text?.trim() ?? '')) || tr('_(empty answer)_', '_(пустой ответ)_'), note ? `<footer>${note}</footer>` : '']
    .filter(Boolean)
    .join('\n\n')
}

// Split long markdown on line boundaries, reopening a code fence that was cut in half
export function splitMarkdown(md: string, limit = RICH_LIMIT): string[] {
  if (md.length <= limit) return [md]
  const chunks: string[] = []
  let cur = ''
  let fence: string | null = null
  for (const line of md.split('\n')) {
    const fenceMatch = line.match(/^\s*```(\S*)/)
    // Reserve room for the closing ``` this chunk may need
    const reserve = fence !== null ? 4 : 0
    if (cur.length + line.length + 1 + reserve > limit && cur) {
      chunks.push(fence !== null ? cur + '\n```' : cur)
      cur = fence !== null ? '```' + fence : ''
    }
    cur += (cur ? '\n' : '') + line
    if (fenceMatch) fence = fence === null ? fenceMatch[1] : null
  }
  if (cur) chunks.push(cur)
  // A single line longer than the limit still has to be hard-cut
  return chunks.flatMap(c => (c.length <= limit ? [c] : c.match(new RegExp(`[\\s\\S]{1,${limit}}`, 'g'))!))
}

// --- images from the computer inside the answer -------------------------------------------------
// Claude writes ![caption](path on the computer); the bot fetches each file from the device and
// embeds it in the rich message with a tg://photo|video|document link (Bot API rich messages)

export type MediaKind = 'photo' | 'video' | 'document'
// web: an http(s) URL the server downloads itself; otherwise a path on the computer
export type MediaRef<K = MediaKind | 'sticker'> = { match: string, alt: string, path: string, title?: string, kind: K, web: boolean }
export const isSticker = (r: MediaRef): r is MediaRef<'sticker'> => r.kind === 'sticker'
export const isInMessage = (r: MediaRef): r is MediaRef<MediaKind> => r.kind !== 'sticker'

const MEDIA_KIND: Record<string, MediaKind> = {
  '.png': 'photo', '.jpg': 'photo', '.jpeg': 'photo', '.webp': 'photo',
  '.mp4': 'video', '.mov': 'video', '.webm': 'video',
  // Rich messages have no animation link: a GIF goes as a document, which Telegram still plays
  '.gif': 'document', '.pdf': 'document',
}
// Animations go as stickers of their own, after the text: a rich message can't hold one. Only from the computer: Telegram takes no sticker from a link either
const STICKER_EXT = new Set(['.tgs', '.json'])
export const MEDIA_MAX = 50

// ![alt](path) or ![alt](<path with spaces> "title"); a path on the computer or an http(s) image URL.
// Other schemes (tg://…) are left alone
const IMAGE = /!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"([^"]*)")?\)/g
const isUrl = (p: string) => /^[a-z][a-z0-9+.-]+:\/\//i.test(p)
const isWeb = (p: string) => /^https?:\/\//i.test(p)
const extOf = (p: string) => (p.match(/\.[^./\\]+$/)?.[0] ?? '').toLowerCase()
const baseOf = (p: string) => p.split(/[\\/]/).pop() ?? p

// A URL's kind comes from its path (query strings are common on CDNs)
function kindOf(path: string): MediaKind | 'sticker' | undefined {
  if (!isWeb(path)) return isUrl(path) ? undefined : STICKER_EXT.has(extOf(path)) ? 'sticker' : MEDIA_KIND[extOf(path)]
  try {
    return MEDIA_KIND[extOf(new URL(path).pathname)]
  } catch {
    return undefined
  }
}

export function findDeviceMedia(md: string): MediaRef[] {
  const refs: MediaRef[] = []
  // Quoted as code it is only being talked about, and fetching it would be wrong even when it worked
  const outsideCode = md.replace(/```[\s\S]*?(?:```|$)|`[^`\n]*`/g, m => ' '.repeat(m.length))
  for (const m of outsideCode.matchAll(IMAGE)) {
    const path = m[2] ?? m[3]
    const kind = kindOf(path)
    if (!kind || refs.length >= MEDIA_MAX) continue
    refs.push({ match: m[0], alt: m[1], path, title: m[4], kind, web: isWeb(path) })
  }
  return refs
}

// Each ref becomes its own block with a tg:// link, or a visible note when the file could not be fetched
export function embedDeviceMedia(md: string, refs: MediaRef[], fetched: ({ id: string, kind?: MediaKind } | { error: string })[]) {
  let out = md
  refs.forEach((r, i) => {
    const f = fetched[i]
    const caption = (r.title || r.alt || baseOf(r.path.split("?")[0])).replace(/"/g, "'")
    const block = 'id' in f
      ? `\n\n![](tg://${f.kind ?? r.kind}?id=${f.id} "${caption}")\n\n`
      // No italics around it: Telegram leaves _…_ literal when a code span sits inside
      : `\n\n⚠️ ${tr('Could not attach', 'Не удалось приложить')} ${code(baseOf(r.path.split('?')[0]))}: ${f.error}\n\n`
    out = out.replace(r.match, block)
  })
  return out.replace(/\n{3,}/g, '\n\n')
}

// A rich message refused over its files goes as plain text with the files after it: their links mean nothing there, and
// what they said under the picture goes with the file
const UPLOAD_LINK = /!\[[^\]]*\]\(tg:\/\/\w+\?id=(\w+)(?: "([^"]*)")?\)/g
export const withoutUploads = (md: string) => md.replace(UPLOAD_LINK, '').replace(/\n{3,}/g, '\n\n').trim()
// A sticker has no caption of its own, so what was said under it stays in the text
export const stickerCaption = (r: Pick<MediaRef, 'title' | 'alt'>) => r.title || r.alt || ''
export const stickerNote = (r: Pick<MediaRef, 'path'>, error: string) => `\n\n⚠️ ${tr('Could not attach', 'Не удалось приложить')} ${code(baseOf(r.path))}: ${error}\n\n`
export const uploadCaption = (md: string, id: string) => [...md.matchAll(UPLOAD_LINK)].find(m => m[1] === id)?.[2]

// Drafts can't carry uploads: show a placeholder until the final message arrives
export const stripDeviceMedia = (md: string) =>
  md.replace(IMAGE, (all, alt: string, angled?: string, plain?: string) => {
    const path = angled ?? plain ?? ''
    return kindOf(path) ? `_🖼 ${alt || baseOf(path.split('?')[0])}_` : all
  })

export type Question = {
  question: string
  header?: string
  options: { label: string, description?: string }[]
  multiSelect?: boolean
}

// Claude's AskUserQuestion as a Telegram message; options become buttons, free text also answers
// What it advises says so in the label: a star, the one sign the user reads the same everywhere
export const starredLabel = (label: string) => {
  const plain = label.replace(/\s*\((recommended|рекомендую|рекомендуется)\)\s*$/i, '')
  return plain === label ? label : `⭐ ${plain}`
}
export function questionMarkdown(q: Question, index: number, total: number) {
  const head = `**❓ ${q.header || tr('Question', 'Вопрос')}**${total > 1 ? ` · ${index + 1}/${total}` : ''}`
  const options = q.options.map(o => `- **${starredLabel(o.label)}**${o.description ? ` — ${o.description}` : ''}`).join('\n')
  const hint = q.multiSelect
    ? tr('_Tick the options and press “Done”, or answer in your own words._', '_Отметь варианты и нажми «Готово» или ответь своим текстом._')
    : tr('_Pick an option or answer in your own words._', '_Выбери вариант или ответь своим текстом._')
  return defuseButtons([head, q.question, options, hint].join('\n\n'))
}

// One option per row: their labels can be long. The one blue button is “Done”: the only one that sends what was ticked
export function questionButtons(q: Question, selected: ReadonlySet<number>, data: (choice: number | 'done') => string): RichButton[][] {
  const options = q.options.map((o, i): RichButton[] => [{
    text: `${q.multiSelect ? (selected.has(i) ? '☑️ ' : '⬜ ') : ''}${redact(starredLabel(o.label)).text}`,
    data: data(i),
  }])
  return q.multiSelect ? [...options, [{ text: tr('Done', 'Готово'), data: data('done'), style: 'primary' }]] : options
}

// What became of device operations that were running when the user pressed Stop (§14)
export function interruptedSummary(ops: { step: string, out: OpOutcome }[]) {
  if (!ops.length) return ''
  const lines = ops.map(({ step, out }) => {
    if (out.ok) return `- ${step} — ${(out.result as { cancelled?: boolean })?.cancelled ? tr('interrupted', 'прервана') : tr('had finished', 'успела выполниться')}`
    // It had started: an app, say, goes on opening after the wait for it is cancelled
    if (out.error.code === 'cancelled') return `- ${step} — ${tr('interrupted', 'прервана')}`
    return `- ${step} — ${out.error.code === 'unknown' ? tr('outcome unknown: check on the computer', 'итог неизвестен: проверь на компьютере') : tr('did not run', 'не выполнялась')}`
  })
  return `**${tr('On the computer when you stopped:', 'На компьютере в момент остановки:')}**\n${lines.join('\n')}`
}

// What the button turns into after a decision: each choice must stay distinguishable afterwards
export const VERDICTS = ['ok', 'no', 'all', 'forever'] as const
export type Verdict = (typeof VERDICTS)[number]
export function verdictLabel(v: Verdict) {
  switch (v) {
    case 'ok': return tr('✅ Allowed', '✅ Разрешено')
    case 'no': return tr('🚫 Denied', '🚫 Запрещено')
    case 'all': return tr('⚡ Allowed until the task ends', '⚡ Разрешено до конца задачи')
    case 'forever': return tr('🔓 No more questions in this topic', '🔓 Больше не спрашиваю в этом топике')
  }
}

const CHANGES_WHAT_RUNS = /^(?:PATH|PATHEXT|COMSPEC|SHELL|HOME|USERPROFILE|APPDATA|NODE_OPTIONS|NODE_PATH|LD_\w+|DYLD_\w+|PYTHON\w*|PERL\w*|RUBY\w*|BASH_ENV|ENV|ZDOTDIR|NPM_CONFIG_\w+|PIP_\w+|UV_\w+|PNPM_\w+|YARN_\w+|BUN_\w+|PIPX_\w+|GIT_\w+|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|CLASSPATH|DOTNET_\w+|COR_\w+|CORECLR_\w+)$/i

const fenceSafe = (s: string) => s.replace(/```/g, 'ʼʼʼ')
const NOT_SHOWN = '⚠️ …'
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n${NOT_SHOWN} ${tr(`and ${s.length - n} more characters: the whole of it is in the file below`, `и ещё ${s.length - n} символов: целиком в файле ниже`)}` : s)
export const isClipped = (md: string) => md.includes(`\n${NOT_SHOWN} `)

// "Allow this?" body: device, project, tool and the parameters that matter (§13)
export function permissionMarkdown(name: string, input: Input, where: { device: string, project: string, icon?: string }) {
  const head = (title: string) => `**${title}** · ${where.icon ?? '🖥'} ${where.device} · 📁 ${where.project}`
  if (!isDeviceTool(name)) {
    // App MCP tool: mcp__blender__execute_blender_code → 🔌 blender · execute_blender_code
    const title = name.startsWith('mcp__') ? `🔌 ${name.split('__').slice(1).join(' · ')}` : `🔧 ${name}`
    return `${head(title)}\n\n` + '```json\n' + clip(fenceSafe(JSON.stringify(input, null, 2)), 1500) + '\n```'
  }
  const path = code(str(input.path))
  switch (deviceToolOf(name)) {
    case 'run_command': {
      const cwd = str(input.cwd) && input.cwd !== '.' ? `\n\n${tr('Folder', 'Папка')}: ${code(str(input.cwd))}` : ''
      return `${head(tr('⚙️ Command', '⚙️ Команда'))}${cwd}\n\n` + '```bash\n' + clip(fenceSafe(commandLine(input)), 1500) + '\n```'
    }
    case 'edit_file': {
      const diff = [
        ...str(input.oldString).split('\n').map(l => '- ' + l),
        ...str(input.newString).split('\n').map(l => '+ ' + l),
      ].join('\n')
      return `${head(tr('✏️ Edit', '✏️ Правка'))}\n\n${path}\n\n` + '```diff\n' + clip(fenceSafe(diff), 2500) + '\n```'
    }
    case 'write_file': {
      const kind = input.expectedHash ? tr('Overwrite', 'Перезапись') : tr('New file', 'Новый файл')
      return `${head(`📝 ${kind}`)}\n\n${path}\n\n` + '```\n' + clip(fenceSafe(str(input.content)), 1500) + '\n```'
    }
    case 'add_project_folder':
      return `${head(tr('📂 Folder access', '📂 Доступ к папке'))}\n\n${tr(`Let the project also work with the folder ${path}? This is a lasting permission for the project on this computer.`, `Разрешить проекту работать ещё и с папкой ${path}? Это постоянное разрешение для проекта на этом компьютере.`)}`
    case 'add_mcp_server': {
      // The names of its variables only, a value can be a key. Unless the variable decides what runs: NODE_OPTIONS can load
      // a script into the most trusted of programs, NPM_CONFIG_REGISTRY swap the package behind an exact version
      const vars = (input.env as Record<string, unknown> | undefined) ?? {}
      const env = Object.keys(vars).map(name => code(CHANGES_WHAT_RUNS.test(name) ? `${name}=${str(vars[name])}` : name))
      return [
        head(tr('🧩 Connect an MCP server', '🧩 Подключить MCP-сервер')),
        `**${str(input.name)}**`,
        '```\n' + clip(fenceSafe(commandLine({ program: input.command, args: input.args })), 1500) + '\n```',
        ...(env.length ? [`${tr('Variables', 'Переменные')}: ${env.join(', ')}`] : []),
        tr('⚠️ This program gets access to the computer. It starts now and at every start of the agent, for every topic on this computer. Nothing here checks the program itself.', '⚠️ Эта программа получит доступ к компьютеру. Она запустится сейчас и при каждом запуске агента, для всех топиков на этом компьютере. Саму программу здесь никто не проверяет.'),
      ].join('\n\n')
    }
    case 'remove_mcp_server':
      return `${head(tr('🧩 Remove an MCP server', '🧩 Удалить MCP-сервер'))}\n\n**${str(input.name)}**`
    case 'save_attachment':
      return `${head(tr('📥 Save attachment', '📥 Сохранить вложение'))} ${code(str(input.id))} → ${input.path ? path : tr('to the project root', 'в корень проекта')}`
    case 'open_app':
    case 'close_app':
      return `${head(`${STEP_ICON[deviceToolOf(name)]} ${deviceToolOf(name) === 'open_app' ? tr('Open', 'Открыть') : input.force ? tr('Force quit', 'Закрыть принудительно') : tr('Close', 'Закрыть')}`)} ${code(str(input.app))}${input.file ? ` · ${code(str(input.file))}` : ''}`
    default:
      return `${head(`${STEP_ICON[deviceToolOf(name)]} ${deviceToolOf(name)}`)} ${path}`
  }
}
