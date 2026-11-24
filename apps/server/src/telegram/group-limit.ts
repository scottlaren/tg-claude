import type { Transformer } from 'grammy'

// Telegram lets a bot make about 20 writes a minute in one group, shared by all its topics, and past that blocks it
// there for half a minute. Answers must get through, so live statuses only use what is left, and less of it the more
// topics are working. Private chats have no such limit and none of this touches them
const WINDOW_MS = 60_000
const STATUS_ROOM = 12
const STATUS_GAP_MS = 5000
const RETRIES = 3

export const isGroupChat = (chatId: number) => chatId < 0

// Everything that shows up in the chat counts. Typing doesn't
const WRITE = /^(send(?!ChatAction)|edit|delete|copy|forward|pin|unpin|createForumTopic|setMessageReaction)/

export function createGroupLimit(now = Date.now) {
  const groups = new Map<number, { writes: number[], until: number, working: number }>()
  const statuses = new Set<string>()
  const of = (chatId: number) => {
    let g = groups.get(chatId)
    if (!g) groups.set(chatId, g = { writes: [], until: 0, working: 0 })
    g.writes = g.writes.filter(at => now() - at < WINDOW_MS)
    return g
  }
  return {
    wrote: (chatId: number) => void of(chatId).writes.push(now()),
    blocked: (chatId: number, seconds: number) => void (of(chatId).until = now() + seconds * 1000),
    // Whether a status may be drawn now
    room(chatId: number) {
      const g = of(chatId)
      return now() >= g.until && g.writes.length < STATUS_ROOM
    },
    // How often each working topic may redraw its status
    gap: (chatId: number) => STATUS_GAP_MS * Math.max(1, of(chatId).working),
    enter: (chatId: number) => void of(chatId).working++,
    leave: (chatId: number) => void (of(chatId).working = Math.max(0, of(chatId).working - 1)),
    markStatus: (chatId: number, id: number) => void statuses.add(`${chatId}:${id}`),
    unmarkStatus: (chatId: number, id: number) => void statuses.delete(`${chatId}:${id}`),
    isStatus: (chatId: number, id: unknown) => statuses.has(`${chatId}:${id}`),
  }
}

export type GroupLimit = ReturnType<typeof createGroupLimit>

// A turn starting with no room for its status would look dead: the last message it answers shows that it was taken
export const quietMark = <T extends { msgId?: number, shownId?: number }>(items: T[], room: boolean) =>
  (room ? undefined : items.findLast(i => i.msgId ?? i.shownId))

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Counts writes in groups and waits out a block, so an answer arrives late rather than never. A status is not worth
// waiting for: the next one replaces it
export function limitTransformer(limit: GroupLimit, wait = pause): Transformer {
  return async (prev, method, payload, signal) => {
    const { chat_id: chatId, message_id: messageId } = payload as { chat_id?: unknown, message_id?: unknown }
    if (typeof chatId !== 'number' || !isGroupChat(chatId) || !WRITE.test(method)) return prev(method, payload, signal)
    for (let attempt = 0; ; attempt++) {
      limit.wrote(chatId)
      const res = await prev(method, payload, signal)
      const after = !res.ok && res.error_code === 429 ? res.parameters?.retry_after : undefined
      if (!after) return res
      limit.blocked(chatId, after)
      if (attempt >= RETRIES || limit.isStatus(chatId, messageId)) return res
      await wait(after * 1000)
    }
  }
}

// A group has no drafts: the live view is an ordinary message, redrawn while Claude works and gone before the answer
export function createStatusBubble({ limit, chatId, send, edit, remove }: {
  limit: GroupLimit
  chatId: number
  send: (md: string) => Promise<number>
  edit: (id: number, md: string) => Promise<unknown>
  remove: (id: number) => Promise<unknown>
}) {
  let id: number | undefined
  let shown = ''
  let ended = false
  limit.enter(chatId)
  return {
    gap: () => limit.gap(chatId),
    async show(md: string) {
      if (ended || md === shown || !limit.room(chatId)) return
      if (id === undefined) {
        id = await send(md)
        limit.markStatus(chatId, id)
      } else await edit(id, md)
      shown = md
    },
    async end() {
      if (ended) return
      ended = true
      limit.leave(chatId)
      if (id === undefined) return
      limit.unmarkStatus(chatId, id)
      await remove(id).catch(() => {})
    },
  }
}
