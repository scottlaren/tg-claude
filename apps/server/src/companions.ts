import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from './store.ts'
import { cut } from './telegram/text.ts'

// A companion chat is an ordinary group where the bot only talks: it answers whoever addresses it and has no computer,
// project or tool behind it. It is kept apart from workspaces on purpose: nothing that looks a chat up as a workspace
// finds one of these, so no path built for the owner's work opens there by accident.
// key: what the settings card names the chat by, a chat id in a button gets masked as a card number
// daily: answers a day for the whole chat, 0 for no limit
// search: the web, a search and the reading of pages
// advice: a word of unasked-for advice to one person of the chat each morning
// voices: short voice messages are heard as they come, so that the talk is followed whole
// pictures: the same for photos: each is looked at once, and what it shows is kept as a line of text
export type Companion = {
  key: string, title: string, owner: number, on: boolean, introduced?: boolean,
  model: string, profile?: string, daily: number, search: boolean, advice?: boolean, voices?: boolean, pictures?: boolean, addedAt: number,
}

export type ChatMsg = {
  id: number, at: number, from: number, name: string, username?: string, text: string,
  kind?: 'voice' | 'photo' | 'video' | 'file' | 'sticker', replyTo?: number, thread?: number,
  // The bot's own answer
  own?: true,
  // A voice message whose text is what it said
  heard?: true,
  // A photo: the file Telegram keeps it as, the album it came in, and what it shows once somebody has looked
  photo?: string,
  group?: string,
  shows?: string,
}

export type Reminder = { id: string, at: number, by: number, name: string, username?: string, text: string, thread?: number }

// Someone the bot stopped answering, until the owner says otherwise
export type Blocked = { at: number, name: string, username?: string, asked: number, minutes: number }

type ChatData = {
  messages: ChatMsg[], notes: string, day: string, used: Record<string, number>, reminders: Reminder[],
  // Seconds of voice heard today without being asked
  voiceSec?: number
  // Pictures looked at today without being asked
  pictureN?: number
  // The day the morning's advice was last thought about, and who got it if anyone did
  advice?: { day: string, last?: number }
  blocked?: Record<string, Blocked>
}

// The last messages go to Claude whole; older ones are folded into the notebook, half a window at a time
export const KEEP_MESSAGES = 300
export const FOLD_MESSAGES = 150
export const TEXT_MAX = 2000
export const NOTES_MAX = 8000
export const REMINDERS_EACH = 5
export const REMINDER_TEXT_MAX = 300
// A notebook that can't be written must not let the chat grow without end
const HARD_MAX = KEEP_MESSAGES + 2 * FOLD_MESSAGES

const empty = (): ChatData => ({ messages: [], notes: '', day: '', used: {}, reminders: [] })

export function createCompanionStore(dir: string) {
  const file = join(dir, 'companions.json')
  const chats = readJson<Record<string, Companion>>(file, {})
  const save = () => writeJson(file, chats)
  const dataFile = (chatId: number) => join(dir, 'companion', `${chatId}.json`)
  const loaded = new Map<number, ChatData>()
  const data = (chatId: number) => {
    let d = loaded.get(chatId)
    if (!d) {
      d = { ...empty(), ...readJson<Partial<ChatData>>(dataFile(chatId), {}) }
      loaded.set(chatId, d)
    }
    return d
  }
  const keep = (chatId: number) => writeJson(dataFile(chatId), data(chatId))
  const forget = (chatId: number) => {
    loaded.delete(chatId)
    rmSync(dataFile(chatId), { force: true })
  }
  const today = (chatId: number, day: string) => {
    const d = data(chatId)
    if (d.day !== day) {
      d.day = day
      d.used = {}
      d.voiceSec = 0
      d.pictureN = 0
    }
    return d
  }

  return {
    get: (chatId: number): Companion | undefined => chats[chatId],
    byKey(key: string) {
      const found = Object.entries(chats).find(([, c]) => c.key === key)
      return found ? { chatId: Number(found[0]), ...found[1] } : undefined
    },
    list: () => Object.entries(chats).map(([id, c]) => ({ chatId: Number(id), ...c })),
    add(chatId: number, c: Omit<Companion, 'key' | 'addedAt'>, now = Date.now()) {
      chats[chatId] = { ...c, key: randomBytes(4).toString('hex'), addedAt: now }
      save()
      return chats[chatId]
    },
    update(chatId: number, patch: Partial<Omit<Companion, 'key'>>) {
      if (!chats[chatId]) return
      chats[chatId] = { ...chats[chatId], ...patch }
      save()
    },
    // The chat is over: what was heard in it goes with it
    remove(chatId: number) {
      delete chats[chatId]
      save()
      forget(chatId)
    },
    // A basic group became a supergroup: the same chat under a new id
    move(from: number, to: number) {
      if (!chats[from] || chats[to]) return false
      chats[to] = chats[from]
      delete chats[from]
      save()
      loaded.set(to, data(from))
      keep(to)
      forget(from)
      return true
    },

    // A message of the chat, or the same one again after an edit
    heard(chatId: number, m: ChatMsg) {
      const d = data(chatId)
      const msg = { ...m, text: cut(m.text, TEXT_MAX) }
      const at = d.messages.findIndex(x => x.id === m.id)
      if (at >= 0) d.messages[at] = { ...d.messages[at], text: msg.text }
      else d.messages.push(msg)
      if (d.messages.length > HARD_MAX) d.messages.splice(0, d.messages.length - KEEP_MESSAGES)
      keep(chatId)
    },
    // What a voice message said, once somebody asked about it
    transcribed(chatId: number, id: number, text: string) {
      const m = data(chatId).messages.find(x => x.id === id)
      if (!m) return
      m.text = cut(text, TEXT_MAX)
      m.heard = true
      keep(chatId)
    },
    // What a picture shows, in a line
    described(chatId: number, id: number, shows: string) {
      const m = data(chatId).messages.find(x => x.id === id)
      if (!m) return
      m.shows = cut(shows, 600)
      keep(chatId)
    },
    picturesUsed: (chatId: number, day: string) => today(chatId, day).pictureN ?? 0,
    pictureSpent(chatId: number, day: string) {
      const d = today(chatId, day)
      d.pictureN = (d.pictureN ?? 0) + 1
      keep(chatId)
    },
    // Voice heard today in the background, in seconds of what was said
    voiceUsed: (chatId: number, day: string) => today(chatId, day).voiceSec ?? 0,
    voiceSpent(chatId: number, day: string, sec: number) {
      const d = today(chatId, day)
      d.voiceSec = (d.voiceSec ?? 0) + sec
      keep(chatId)
    },
    messages: (chatId: number): readonly ChatMsg[] => data(chatId).messages,
    notes: (chatId: number) => data(chatId).notes,
    // The oldest messages, once there are enough of them to fold into the notebook
    foldable(chatId: number): ChatMsg[] | null {
      const m = data(chatId).messages
      return m.length >= KEEP_MESSAGES + FOLD_MESSAGES ? m.slice(0, FOLD_MESSAGES) : null
    },
    // They are in the notebook now, or it could not take them: either way they leave the window
    folded(chatId: number, ids: number[], notes?: string) {
      const d = data(chatId)
      const gone = new Set(ids)
      d.messages = d.messages.filter(m => !gone.has(m.id))
      if (notes !== undefined) d.notes = cut(notes, NOTES_MAX)
      keep(chatId)
    },
    wipe(chatId: number) {
      const d = data(chatId)
      d.messages = []
      d.notes = ''
      keep(chatId)
    },

    // Answers given today, by the owner's calendar: the whole chat's and one person's
    used(chatId: number, day: string, userId?: number) {
      const u = today(chatId, day).used
      return userId === undefined ? Object.values(u).reduce((a, b) => a + b, 0) : u[userId] ?? 0
    },
    spend(chatId: number, day: string, userId: number) {
      const d = today(chatId, day)
      d.used[userId] = (d.used[userId] ?? 0) + 1
      keep(chatId)
    },

    adviceOf: (chatId: number) => data(chatId).advice ?? { day: '' },
    // The morning is done with: with a person when one was given advice, so that the next morning's is someone else
    advised(chatId: number, day: string, userId?: number) {
      data(chatId).advice = { day, ...(userId !== undefined && { last: userId }) }
      keep(chatId)
    },

    blocked: (chatId: number): Readonly<Record<string, Blocked>> => data(chatId).blocked ?? {},
    block(chatId: number, userId: number, b: Blocked) {
      const d = data(chatId)
      d.blocked = { ...d.blocked, [userId]: b }
      keep(chatId)
    },
    unblock(chatId: number, userId: number) {
      const d = data(chatId)
      if (!d.blocked?.[userId]) return false
      delete d.blocked[userId]
      keep(chatId)
      return true
    },

    reminders: (chatId: number): readonly Reminder[] => data(chatId).reminders,
    remind(chatId: number, r: Omit<Reminder, 'id'>): Reminder | null {
      const d = data(chatId)
      if (d.reminders.filter(x => x.by === r.by).length >= REMINDERS_EACH) return null
      const made = { ...r, text: cut(r.text, REMINDER_TEXT_MAX), id: randomBytes(3).toString('hex') }
      d.reminders.push(made)
      keep(chatId)
      return made
    },
    unremind(chatId: number, id: string) {
      const d = data(chatId)
      const at = d.reminders.findIndex(r => r.id === id)
      if (at < 0) return undefined
      const [r] = d.reminders.splice(at, 1)
      keep(chatId)
      return r
    },
    // Every reminder whose time has come, taken out as it is handed over
    due(now: number) {
      const out: { chatId: number, r: Reminder }[] = []
      for (const id of Object.keys(chats)) {
        const chatId = Number(id)
        const d = data(chatId)
        const ready = d.reminders.filter(r => r.at <= now)
        if (!ready.length) continue
        d.reminders = d.reminders.filter(r => r.at > now)
        keep(chatId)
        for (const r of ready) out.push({ chatId, r })
      }
      return out
    },
  }
}

export type CompanionStore = ReturnType<typeof createCompanionStore>
