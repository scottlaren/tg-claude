// E2E_DUMP=<path>: what the bot sent in a whole run, one entry per distinct text, for replaying against the real Telegram.
// Off by default. Each stand adds to the file when it stops, so remove the file before a run that should start clean.
// What only says where this run happened (temporary folders, this computer's home, system, disk) is replaced here
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir, hostname, platform, release, userInfo } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Outgoing = { method: string, payload: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
export type DumpEntry = { method: string, text?: string, parse_mode?: string, rich_message?: { markdown: string }, reply_markup?: unknown, hasMedia?: boolean }

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const MEDIA_LINK = /tg:\/\/(photo|video|document|animation|audio)\?id=/
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// A path as it may appear: with either slash, doubled backslashes included
const pathRe = (p: string) => new RegExp(p.replace(/[\\/]+$/, '').split(/[\\/]+/).map(escapeRe).join('[\\\\/]+'), 'gi')

export function scrub(text: string) {
  return text
    .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s`<"']+[\\/]+AppData[\\/]+Local[\\/]+Temp[\\/]+tgcv-e2e-\w+/g, '/tmp/tgcv-e2e')
    .replace(pathRe(ROOT), '/repo')
    .replace(pathRe(homedir()), '/home/e2e')
    .replace(new RegExp(`\\b${escapeRe(hostname())}\\b`, 'gi'), 'e2e-host')
    .replace(new RegExp(`${escapeRe(platform())} ${escapeRe(release())}`, 'g'), 'linux 6.8.0')
    // /diag: the disk and memory of this computer
    .replace(/(process|процесс) [\d.]+ \S+,/g, '$1 100 MB,')
    .replace(/[\d.]+ (?:GB|MB|ГБ|МБ) free of [\d.]+ (?:GB|MB|ГБ|МБ)/g, '8.0 GB free of 16.0 GB')
    .replace(/свободно [\d.]+ (?:GB|MB|ГБ|МБ) из [\d.]+ (?:GB|MB|ГБ|МБ)/g, 'свободно 8.0 ГБ из 16.0 ГБ')
    // A pairing code is new every time
    .replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, 'AAAA-0000')
}

const scrubAll = <T>(v: T): T => JSON.parse(scrub(JSON.stringify(v)))

// Digits, ids of sessions and files, commits and script names change from run to run and say nothing about the format
const dedupeKey = (e: DumpEntry) => [e.parse_mode ?? (e.rich_message ? 'rich' : 'plain'), e.text ?? e.rich_message?.markdown ?? '']
  .join(' ')
  .replace(/SCRIPT:[\w-]+/g, 'SCRIPT')
  .replace(/\b[0-9a-f]{6,}\b/gi, 'h')
  .replace(/\d+/g, '0')

function entryOf({ method, payload: p }: Outgoing): DumpEntry | null {
  const markdown: string | undefined = p.rich_message?.markdown
  if (p.text === undefined && markdown === undefined) return null
  const hasMedia = !!p.rich_message?.media?.length || MEDIA_LINK.test(markdown ?? '')
  return scrubAll({
    method,
    ...(p.text !== undefined && { text: p.text }),
    ...(p.parse_mode && { parse_mode: p.parse_mode }),
    ...(markdown !== undefined && { rich_message: { markdown } }),
    ...(p.reply_markup && { reply_markup: p.reply_markup }),
    ...(hasMedia && { hasMedia: true }),
  })
}

// Applies the current rules to a file already written
export function rescrub(file: string) {
  const path = resolve(file)
  writeFileSync(path, JSON.stringify(JSON.parse(readFileSync(path, 'utf8')).map(scrubAll), null, 1))
}

export function addToDump(file: string, sent: Outgoing[]) {
  const path = resolve(file)
  const entries: DumpEntry[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []
  const seen = new Set(entries.map(dedupeKey))
  for (const o of sent) {
    const e = entryOf(o)
    if (!e || seen.has(dedupeKey(e))) continue
    seen.add(dedupeKey(e))
    entries.push(e)
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(`${path}.tmp`, JSON.stringify(entries, null, 1))
  renameSync(`${path}.tmp`, path)
  return entries.length
}

// What must not be in the file. node test-e2e/support/dump.ts <file> prints the count and anything it finds
export function leaks(raw: string) {
  // The user's name only as part of a path: on its own it can be an ordinary word
  const user = userInfo().username
  const words = [homedir(), ROOT, hostname(), `Users\\${user}`, `Users/${user}`, `/home/${user}`, 'AppData', 'Desktop', 'tg-claude-vps-wt', 'Program Files', 'tgcv-e2e-', process.env.COMPUTERNAME ?? '', '123456:E2E']
  const found: string[] = []
  const flat = raw.replace(/\\\\/g, '\\')
  for (const w of new Set(words.filter(Boolean))) {
    const at = flat.toLowerCase().indexOf(w.replace(/\\\\/g, '\\').toLowerCase())
    if (at >= 0) found.push(`${w}: …${flat.slice(Math.max(0, at - 50), at + 70)}…`)
  }
  // The size of this computer's disk or memory, in either word order
  const size = flat.match(/[\d.]+ (?:GB|ГБ) free of [\d.]+ (?:GB|ГБ)|свободно [\d.]+ (?:GB|ГБ) из [\d.]+ (?:GB|ГБ)/g)?.filter(m => !/8\.0 (GB|ГБ)\D+16\.0/.test(m)) ?? []
  if (size.length) found.push(`disk or memory: ${size[0]}`)
  return found
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raw = readFileSync(process.argv[2], 'utf8')
  const list = JSON.parse(raw) as DumpEntry[]
  const by = (f: (e: DumpEntry) => boolean) => list.filter(f).length
  console.log(`${list.length} messages: ${by(e => e.method === 'sendMessage')} sendMessage, ${by(e => e.method === 'editMessageText')} editMessageText, ${by(e => e.method === 'sendRichMessage')} sendRichMessage, ${by(e => !!e.hasMedia)} with media, ${by(e => /[А-Яа-яЁё]/.test(e.text ?? e.rich_message?.markdown ?? ''))} in Russian`)
  const found = leaks(raw)
  console.log(found.length ? `FOUND:\n${found.join('\n')}` : 'nothing from this computer')
  process.exitCode = found.length ? 1 : 0
}
