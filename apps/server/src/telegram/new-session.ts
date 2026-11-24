import { randomBytes } from 'node:crypto'
import { tr } from '../i18n.ts'
import type { PromptImage } from '../claude/runner.ts'

// "New task, new session": a topic whose history is long rereads all of it at every step, and most of what it spends
// goes there. When the user starts something unrelated, Claude offers a fresh session on a card; the message then runs
// again in it, or goes on here. Agents compact by themselves and are never asked

export const NEW_SESSION_AT = 200_000

type Offer = { key: string, sessionId: string, text: string, images: PromptImage[] }
type Topic = { head?: string, sessionId?: string | null, context?: { total: number } }

export function createNewSessionOffers({ send, edit, reset, run, mdText }: {
  // The card; its message id, when it went out
  send: (key: string, md: string, rows: { text: string, data: string }[][]) => Promise<number | undefined>
  edit: (key: string, messageId: number, md: string) => Promise<unknown>
  // A fresh session in the topic, as /new
  reset: (key: string) => void
  // A message for Claude in the topic, as if just sent; shownId: the card it answers
  run: (key: string, text: string, images: PromptImage[], shownId?: number) => void
  // Claude's words in the card's markdown, as text
  mdText: (s: string) => string
}) {
  const offers = new Map<string, Offer>()
  // The user chose to go on here: the turn that goes on doesn't ask again
  const declined = new Set<string>()

  return {
    // Whether this turn may ask: the user's own words in a topic of the user's, with a long history
    wanted(key: string, t: Topic, ownerSpoke: boolean) {
      if (declined.delete(key)) return false
      return !t.head && !!t.sessionId && ownerSpoke && (t.context?.total ?? 0) >= NEW_SESSION_AT
    },
    async offer(key: string, t: Topic, text: string, images: PromptImage[], what: string) {
      const id = randomBytes(4).toString('hex')
      offers.set(id, { key, sessionId: t.sessionId!, text, images })
      const k = Math.round((t.context?.total ?? 0) / 1000)
      await send(key, [
        tr(`🧹 **Looks like a new task: ${mdText(what)}.**`, `🧹 **Похоже, это новая задача: ${mdText(what)}.**`),
        tr(`This topic's conversation is already ${k}k tokens, and Claude rereads all of it at every step. In a new session the task costs several times less: the same computer and project, but without this conversation.`,
          `Разговор в топике уже ${k}k токенов, и Claude перечитывает его целиком на каждом шаге. В новой сессии задача обойдётся в разы дешевле: компьютер и проект те же, но без этого разговора.`),
      ].join('\n\n'), [[
        { text: tr('🆕 New session', '🆕 Новая сессия'), data: `nss:new:${id}` },
        { text: tr('Go on here', 'Продолжить здесь'), data: `nss:keep:${id}` },
      ]])
      return 'The user chooses with a card: a new session for this task, or going on here. Don\'t start the task. End your turn with one short line; the task comes back to you in the session they chose.'
    },
    // false: the card is no longer relevant
    choose(id: string, how: 'new' | 'keep', currentSession: string | null | undefined, messageId?: number) {
      const o = offers.get(id)
      if (!o) return false
      offers.delete(id)
      if (how === 'new') {
        // Someone already started over here: the message goes to the session there is
        if (currentSession === o.sessionId) reset(o.key)
        if (messageId) void edit(o.key, messageId, tr('🆕 **New session.** The task starts in it.', '🆕 **Новая сессия.** Задача начинается в ней.'))
        run(o.key, o.text, o.images, messageId)
        return true
      }
      declined.add(o.key)
      if (messageId) void edit(o.key, messageId, tr('▶️ Going on in this conversation.', '▶️ Продолжаю в этом разговоре.'))
      run(o.key, '[The user wants this task done in this conversation. Go on with it.]', [], messageId)
      return true
    },
  }
}
export type NewSessionOffers = ReturnType<typeof createNewSessionOffers>
