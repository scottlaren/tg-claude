import type { Api } from 'grammy'
import type { Log } from '../log.ts'

// A topic that needs the owner, as its icon in the list of topics. Only then: every change of icon leaves a bubble
// in the topic for about a second before the bot can remove it, and Telegram has no way around that, so a normal
// turn changes nothing. Icons come from Telegram's own fixed set: a bot can't give a topic any other
export type TopicState = 'idle' | 'waiting' | 'error'
const ICONS: Record<Exclude<TopicState, 'idle'>, string> = { waiting: '❓', error: '❗' }

export const turnState = (o: { note?: string | null, stopped?: boolean }): TopicState => (o.note && !o.stopped ? 'error' : 'idle')

export function createTopicState({ api, log, load, save }: {
  api: Pick<Api, 'getForumTopicIconStickers' | 'editForumTopic'>
  log: Pick<Log, 'debug'>
  // Kept with the topic: after a restart the bot must know which icon is there, or it would touch every topic again
  load: (key: string) => Exclude<TopicState, 'idle'> | undefined
  save: (key: string, state: Exclude<TopicState, 'idle'> | undefined) => void
}) {
  let icons: Promise<Map<string, string>> | null = null
  const iconsOf = () => (icons ??= api.getForumTopicIconStickers().then(list => {
    const found = new Map<string, string>()
    for (const s of list) if (s.emoji && s.custom_emoji_id) found.set(s.emoji.replace(/️/g, ''), s.custom_emoji_id)
    return found
  }).catch(e => {
    // Worth another try on the next change
    icons = null
    throw e
  }))
  // One at a time per topic: a quick answer must not end up showing the state before it
  const chains = new Map<string, Promise<void>>()

  return {
    // Never worth failing a task over. The general chat has no icon
    set(key: string, chatId: number, topicId: number | undefined, state: TopicState) {
      const before = load(key) ?? 'idle'
      if (!topicId || before === state) return Promise.resolve()
      save(key, state === 'idle' ? undefined : state)
      const next = (chains.get(key) ?? Promise.resolve()).then(async () => {
        // An empty id takes the icon away
        const id = state === 'idle' ? '' : (await iconsOf()).get(ICONS[state])
        if (id !== undefined) await api.editForumTopic(chatId, topicId, { icon_custom_emoji_id: id })
      }).catch(e => {
        if ((load(key) ?? 'idle') === state) save(key, before === 'idle' ? undefined : before)
        log.debug('topic icon', (e as Error).message)
      })
      chains.set(key, next)
      return next
    },
  }
}
