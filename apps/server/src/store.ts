import type { StartAgent } from './claude/team-tools.ts'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import type { InlineKeyboardButton } from 'grammy/types'
import type { SentMedia } from './telegram/render.ts'
import { dirname } from 'node:path'
import { tr } from './i18n.ts'

// One topic = one binding to device, project and Claude session (§5.1, §16).
// JSON for the prototype; SQLite with migrations comes in stage B
// §13 permission rules for a topic, changed only by the user explicitly (/mode or a prompt button).
// Getters: a label is worded when it is read, in the bot's language at that moment
export type Mode = 'ask' | 'edits' | 'all' | 'read'
export const MODES: Readonly<Record<Mode, string>> = {
  get ask() { return tr('🔐 Ask first', '🔐 Спрашивать') },
  get edits() { return tr('✏️ Edit files without asking', '✏️ Файлы без вопросов') },
  get all() { return tr('⚡ Everything without asking', '⚡ Всё без вопросов') },
  get read() { return tr('👀 Read only', '👀 Только просмотр') },
}

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

// Replies Claude offered under its last answer. md, media, keyboard: the sent message, for taking its buttons away;
// absent when it can't be sent again
export type Suggestion = { id: number, replies: string[], messageId?: number, md?: string, media?: SentMedia[], keyboard?: InlineKeyboardButton[][] }

export type Topic = {
  mode?: Mode
  // “Stop asking in this topic”, said under a question about a file for a group that others read: files go there
  // unasked while the topic stays in “everything without asking”
  filesFree?: boolean
  // Per-topic model choice; unset means the server's defaults (CLAUDE_MODEL / CLAUDE_EFFORT)
  model?: string
  effort?: Effort
  // Long, detailed answers instead of the default economical ones
  verbose?: boolean
  deviceId?: string
  projectId?: string
  sessionId?: string | null
  // How full the session was after its last turn (tokens against the model's window), and the session the bot
  // already offered to compact: once per session, not after every turn
  context?: { total: number, max: number }
  compactOffered?: string
  // The address the project can be cloned from, read while its computer was on, for the day it is off: /computer offers it
  // for the cloud. `for` is the computer and project it was read from; null: it has none worth cloning
  remote?: { for: string, url: string | null }
  // Tasks Claude put off while the topic's computer was away: they start by themselves when it is back
  deferred?: string[]
  deferredTitles?: string[]
  // Here and not in memory: an update restarts the bot right after an answer that offers "Updated"
  suggested?: Suggestion
  // Bumped on every device/project change: operations of an older binding are refused (§12)
  bindingVersion: number
  // The next turn must tell Claude its earlier reads are stale (§12)
  envChanged?: boolean
  // How the folder got to the new computer, for that same word to Claude: without it, it can't know the files came along
  envCame?: string
  nameImplicit?: boolean
  // Telegram tells a bot a topic's name only when it changes: kept for moving it to a workspace
  title?: string
  // Claude in Chrome on for this topic (/browser): costs ~3k tokens a call, so off unless asked
  browser?: boolean
  // Turned on by the user's yes to Claude's question, so it goes off by itself when no longer used. /browser stays on
  browserAuto?: boolean
  // The last turn that really worked in it
  browserUsedAt?: number
  // The screen of the topic's computer is Claude's (the user's yes to its card), and when it last used it
  screen?: boolean
  screenUsedAt?: number
  // Claude profile (§7); unset means the server's default one
  profile?: string
  // Picked for this topic itself (/profile, an agent started on one, the bot's move at a spent limit): it doesn't follow
  // its computer's profile
  profileOwn?: boolean
  // Moved by the bot at a spent limit, by day: once the limit of the profile it left has reset (at), the topic goes back
  // to it, with profileOwn as it was
  profileBack?: { to: string, at: number, own: boolean }
  // What this conversation was last told of the parts of its instructions that change (told.ts). toldFresh: its next
  // request renders the instructions anew (it was just compacted), so what is current then is what it knows
  told?: Record<string, { h: string, t: string }>
  toldFresh?: boolean
  // "No project": a conversation with no computer; Claude may offer to open a project later
  noProject?: boolean
  // The icon that says the topic needs the owner, when it has one
  icon?: 'waiting' | 'error'
  // The user's last message or tap in the topic, and when the bot warned that the quiet topic will go
  usedAt?: number
  warnedAt?: number
  // Never deleted for being quiet: the user keeps it for a month from now, or for good
  pinned?: boolean
  // A team: the head topic lists its workers, each worker points back at its head (one level, no chains)
  workers?: string[]
  // The head's pinned board of its agents, kept up to date
  boardId?: number
  // Agents of this head that start when another of them has finished
  waitingAgents?: (StartAgent & { after: string })[]
  head?: string
  workerName?: string
  // What the head says this agent works on, a few words for the team's board
  workerDoing?: string
  // An agent on a branch of its own: the git worktree the bot made for it, its folder absolute (a bare name next to the repository in older ones)
  worktree?: { repo: string, folder: string, branch: string }
}

const DAY = 24 * 3600_000

// What a quiet topic is due for: a warning a day ahead, then deletion — never sooner than a day after
// the warning, so a server that was off for a while still warns first
export function expiryOf(t: Topic, now: number, ttlDays: number): 'warn' | 'delete' | null {
  if (!ttlDays || !t.usedAt || t.pinned) return null
  const quiet = now - t.usedAt
  if (t.warnedAt) return quiet >= ttlDays * DAY && now - t.warnedAt >= DAY ? 'delete' : null
  return quiet >= (ttlDays - 1) * DAY ? 'warn' : null
}

// Chrome adds to every request, so what Claude asked for lasts only while it is used. A turn that didn't touch it ends
// it. So does a long pause, before the next turn pays for it: that message is most likely about something else
// A browser Claude asked for stays on while the task goes on, also through turns spent elsewhere (files, a build):
// off after one turn without it, it was gone the moment Claude came back to the page
const BROWSER_IDLE_MS = 20 * 60_000
export const browserDone = (t: Pick<Topic, 'browser' | 'browserAuto' | 'browserUsedAt'>, usedInTurn: boolean, now: number) =>
  !!t.browser && !!t.browserAuto && !usedInTurn && now - (t.browserUsedAt ?? 0) > BROWSER_IDLE_MS
export const browserIdle = (t: Pick<Topic, 'browser' | 'browserAuto' | 'browserUsedAt'>, now: number) => !!t.browser && !!t.browserAuto && !!t.browserUsedAt && now - t.browserUsedAt > BROWSER_IDLE_MS

export const topicKey = (chatId: number, threadId?: number) => `${chatId}:${threadId ?? 0}`

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, file)
}

export function createTopicStore(file: string, { warn = (_m: string) => {} } = {}) {
  const data = readJson<Record<string, Topic>>(file, {})
  let timer: NodeJS.Timeout | undefined
  // In a timer a throw ends the process: on a full disk that is a server that can't be asked to clean up. The next change
  // writes it all again
  const write = () => {
    try {
      writeJson(file, data)
    } catch (e) {
      warn((e as Error).message)
    }
  }
  const save = () => {
    clearTimeout(timer)
    timer = setTimeout(write, 300)
  }
  return {
    get: (key: string): Topic => data[key] ?? { bindingVersion: 0 },
    set(key: string, patch: Partial<Topic>): Topic {
      data[key] = { ...(data[key] ?? { bindingVersion: 0 }), ...patch }
      save()
      return data[key]
    },
    bind(key: string, deviceId: string, projectId: string, { carry = false } = {}): Topic {
      const cur = data[key] ?? { bindingVersion: 0 }
      const sameProject = cur.projectId === projectId
      // Another device for the same project keeps the conversation (§3.3), and so does a conversation
      // without a project that now gets one, or a project carried to another computer; another project starts fresh
      const keep = sameProject || !!cur.noProject || carry
      return this.set(key, {
        deviceId,
        projectId,
        noProject: false,
        sessionId: keep ? cur.sessionId : null,
        envChanged: keep && (cur.deviceId !== deviceId || !!cur.noProject),
        bindingVersion: cur.bindingVersion + 1,
      })
    },
    // "No project": off any computer; the conversation goes on, device tools are gone
    unbind(key: string): Topic {
      const cur = data[key] ?? { bindingVersion: 0 }
      return this.set(key, { deviceId: undefined, projectId: undefined, noProject: true, browser: false, bindingVersion: cur.bindingVersion + 1 })
    },
    // Any message or tap: the topic is in use again, an earlier warning no longer stands
    touch(key: string, now = Date.now()) {
      return this.set(key, { usedAt: now, warnedAt: undefined })
    },
    remove(key: string) {
      delete data[key]
      save()
    },
    // The chat got a new id: the same conversation, under its new key
    rekey(from: string, to: string) {
      if (!data[from]) return
      data[to] = data[from]
      delete data[from]
      save()
    },
    entries: () => Object.entries(data),
    flush() {
      clearTimeout(timer)
      write()
    },
  }
}

export type TopicStore = ReturnType<typeof createTopicStore>
