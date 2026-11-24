import { readFileSync } from 'node:fs'
import { isDeviceTool, deviceToolOf } from '../claude/device-tools.ts'
import { isTeamTool } from '../claude/team-tools.ts'
import { CHROME_SERVER } from '../claude/chrome.ts'
import { tr } from '../i18n.ts'

// The animated Claude of t.me/addemoji/ClaudeCodes. The plain emoji is what Telegram shows where a custom one can't
// appear, such as notifications
export const CLAUDE_EMOJI = {
  thinking: ['💬', '5314708706640831714'],
  reading: ['🔎', '5314447271981525430'],
  editing: ['✍️', '5314488611041747370'],
  running: ['🏋️', '5312331777249944187'],
  writing: ['💬', '5314280532761162873'],
  agents: ['🏎️', '5314629674947620080'],
  done: ['🏁', '5314317147357355396'],
  party: ['🎉', '5314646700197979068'],
} as const
export type ClaudeState = keyof typeof CLAUDE_EMOJI

// The HTML tag, not Markdown's ![…](tg://emoji…): inside <tg-thinking> Telegram doesn't read Markdown and shows the link as it is
export const claudeEmoji = (state: ClaudeState) => `<tg-emoji emoji-id="${CLAUDE_EMOJI[state][1]}">${CLAUDE_EMOJI[state][0]}</tg-emoji>`

// Service icons, from t.me/addemoji/ApplicationEmoji. The pack labels all of them 📱, so the plain emoji is ours:
// what a notification shows instead
export const APP_EMOJI = {
  github: ['🐙', '5346181118884331907'],
  afterEffects: ['🎬', '5357394595594388140'],
  figma: ['🎨', '5357286671656176924'],
  blender: ['🧊', '5364290083983736876'],
  chrome: ['🌐', '5359758030198031389'],
  windows: ['🖥', '5370857634440170316'],
  apple: ['💻', '5334955749409834455'],
} as const
export const appEmoji = (app: keyof typeof APP_EMOJI) => `<tg-emoji emoji-id="${APP_EMOJI[app][1]}">${APP_EMOJI[app][0]}</tg-emoji>`

// MCP server → its icon and name
const SERVICES: Record<string, [keyof typeof APP_EMOJI, string]> = {
  figma: ['figma', 'Figma'],
  'after-effects': ['afterEffects', 'After Effects'],
  aeuxe: ['afterEffects', 'After Effects'],
  blender: ['blender', 'Blender'],
  [CHROME_SERVER]: ['chrome', 'Chrome'],
}
const GITHUB_COMMAND = /(?:^|[;&|(]\s*)(?:gh\s|git\s+(?:push|pull|fetch|clone)\b)/

const serviceStatus = (app: keyof typeof APP_EMOJI, name: string) => `${appEmoji(app)} ${tr(`Working in ${name}…`, `Работаю в ${name}…`)}`

export const thinkingStatus = () => `${claudeEmoji('thinking')} ${tr('Thinking…', 'Думаю…')}`
export const writingStatus = () => `${claudeEmoji('writing')} ${tr('Writing…', 'Пишу…')}`

const READING = new Set(['read_file', 'list_files', 'view_image'])
const EDITING = new Set(['write_file', 'edit_file', 'save_attachment'])

// What Claude is up to, by the tool it just called
export function toolStatus(tool: string, input: { command?: unknown, url?: unknown } = {}) {
  const device = isDeviceTool(tool) ? deviceToolOf(tool) : null
  const service = SERVICES[tool.split('__')[1]]
  if (tool.startsWith('mcp__') && service) return serviceStatus(...service)
  if (device === 'run_command' && GITHUB_COMMAND.test(String(input.command ?? '').trim())) return serviceStatus('github', 'GitHub')
  if (tool === 'WebFetch' && /^https?:\/\/([\w-]+\.)*github\.com\//.test(String(input.url ?? ''))) return serviceStatus('github', 'GitHub')
  if ((device && READING.has(device)) || tool === 'WebSearch' || tool === 'WebFetch') return `${claudeEmoji('reading')} ${tr('Reading…', 'Читаю…')}`
  if (device && EDITING.has(device)) return `${claudeEmoji('editing')} ${tr('Editing files…', 'Правлю файлы…')}`
  if (device === 'run_command') return `${claudeEmoji('running')} ${tr('Running a command…', 'Запускаю команду…')}`
  if (isTeamTool(tool)) return `${claudeEmoji('agents')} ${tr('Working with agents…', 'Работаю с агентами…')}`
  return `${claudeEmoji('running')} ${tr('Working…', 'Работаю…')}`
}

// For the fallback to a plain message, which would show the tags as they are
export const plainEmoji = (md: string) => md.replace(/<tg-(?:emoji|time) [^>]*>([^<]*)<\/tg-(?:emoji|time)>/g, '$1').replace(/<\/?(?:details|summary)>/g, '')

// Marks for what the owner may want to find later: a tap on one lists them all. Only these few, or they are noise.
// Never at the very start of a line in Markdown: there # is a heading
const HASHTAGS = {
  get schedule() { return tr('#schedule', '#расписание') },
  get error() { return tr('#error', '#ошибка') },
  get update() { return tr('#update', '#обновление') },
  get limit() { return tr('#limit', '#лимит') },
}
export const hashtag = (kind: keyof typeof HASHTAGS) => HASHTAGS[kind]

// The animated versions of ordinary emoji, from t.me/addemoji/RestrictedEmoji: emoji → custom emoji id. Emoji it
// doesn't have stay as they are, except these, which the bot itself leans on: a close one stands in
const ANIMATED: Record<string, string> = JSON.parse(readFileSync(new URL('./animated-emoji.json', import.meta.url), 'utf8'))
const STAND_INS: Record<string, string> = {
  '⚠': '❗', '🗑': '❌', '⏹': '✋', '🖥': '💻', '🌐': '🌍', '📡': '🛰', '🟢': '💚',
  '🕐': '⏰', '🔁': '🔄', '⬆': '🆙', '▶': '🚀', '⏸': '💤', '🎧': '🎵', '🔧': '🧰', '🔌': '🔗',
}
const ANIMATED_MAX = 50
// Left alone: code, whatever is already a tag or a link, and emoji on buttons, which only take text. The second
// emoji class: 🗑 and the like are often written without the variation selector RGI_Emoji requires
const TEXT_EMOJI = /```[\s\S]*?(?:```|$)|`[^`\n]*`|<(?<tag>code|pre|tg-emoji|tg-button)\b[^>]*>[\s\S]*?<\/\k<tag>>|!?\[[^\]]*\]\([^\)]*\)|<[^>]+>|(?<emoji>\p{RGI_Emoji}|\p{Extended_Pictographic})/gv

export function animateEmoji(text: string) {
  let left = ANIMATED_MAX
  return text.replace(TEXT_EMOJI, (...args) => {
    const { emoji } = args.at(-1) as { emoji?: string }
    const plain = emoji?.replace(/\uFE0F/g, '')
    const id = plain && left ? ANIMATED[STAND_INS[plain] ?? plain] : undefined
    if (!id) return args[0]
    left--
    // The emoji as written stays as the fallback: in a notification it still says what was meant
    return `<tg-emoji emoji-id="${id}">${emoji}</tg-emoji>`
  })
}

// Every outgoing text on its way to Telegram, so no message has to think of it. After masking on purpose: some of
// these ids pass for card numbers, and masking would break the tag
export function animatePayload(method: string, payload: Record<string, unknown>) {
  if ((method === 'sendMessage' || method === 'editMessageText') && payload.parse_mode === 'HTML' && typeof payload.text === 'string') {
    return { ...payload, text: animateEmoji(payload.text) }
  }
  const rich = payload.rich_message as { markdown?: string } | undefined
  if ((method === 'sendRichMessage' || method === 'sendRichMessageDraft' || method === 'editMessageText') && rich?.markdown) {
    return { ...payload, rich_message: { ...rich, markdown: animateEmoji(rich.markdown) } }
  }
  return payload
}
