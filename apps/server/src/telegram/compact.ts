import { InlineKeyboard } from 'grammy'
import { tr } from '../i18n.ts'
import { bar } from './usage.ts'
import type { RichButton } from './render.ts'

// How full a topic's conversation is, and the offer to compact it: by /compact, or by itself once a turn leaves
// the history past OFFER_AT. Every request rereads the whole history, and that was most of the tokens spent (four days
// measured: 80% went on rereading histories of 450–500k). So the window Claude compacts by itself at is smaller than the
// model's: a topic is offered compacting at OFFER_AT and compacts near TOPIC_WINDOW; an agent, whom nobody watches,
// isn't asked and compacts near AGENT_WINDOW

export const OFFER_AT = 500_000
export const TOPIC_WINDOW = 700_000
export const AGENT_WINDOW = 500_000
// A model whose window is smaller still is offered at this share of it
const OFFER_SHARE = 0.7

// Tokens as people read them: 42k, 965k, 1M
export function tokens(n: number) {
  if (n >= 1_000_000) {
    const m = Math.round(n / 100_000) / 10
    return tr(`${m}M`, `${String(m).replace('.', ',')} млн`)
  }
  return tr(`${Math.round(n / 1000)}k`, `${Math.round(n / 1000)} тыс.`)
}

export type ContextSize = { total: number, max: number }

export const shouldOffer = (c: ContextSize | undefined) => !!c && c.max > 0 && c.total >= (c.max < TOPIC_WINDOW ? c.max * OFFER_SHARE : OFFER_AT)

export function compactView(c?: ContextSize, auto = false) {
  const pct = c && c.max ? Math.round((c.total / c.max) * 100) : null
  const lines = c && pct !== null
    ? [tr(`🧠 **Conversation history:** ${tokens(c.total)} of ${tokens(c.max)} tokens (${pct}%)`, `🧠 **История топика:** ${tokens(c.total)} из ${tokens(c.max)} токенов (${pct}%)`), bar(pct)]
    : [tr('🧠 **Conversation history:** size not known yet; it shows after the next answer.', '🧠 **История топика:** размер пока неизвестен, он появится после следующего ответа.')]
  if (auto) {
    lines.push(tr(`It is getting big: every step of Claude rereads all of it, so answers get slower and dearer. Near ${tokens(c?.max ?? TOPIC_WINDOW)} Claude compacts it anyway, in the middle of a task.`,
      `Она разрастается: каждый шаг Claude перечитывает её целиком, ответы медленнее и дороже. Около ${tokens(c?.max ?? TOPIC_WINDOW)} Claude всё равно сожмёт её сам, посреди задачи.`))
  }
  lines.push(tr('Compacting leaves a short retelling of the conversation: later answers are faster and cheaper, but Claude no longer remembers the details of old messages.',
    'Сжатие оставит краткий пересказ разговора: следующие ответы быстрее и дешевле, но подробности старых сообщений Claude помнить не будет.'))
  const yes = tr('🗜 Compact', '🗜 Сжать')
  const no = tr('Leave as is', 'Оставить как есть')
  const rows: RichButton[][] = [[{ text: yes, data: 'cp:go', style: 'success' }, { text: no, data: 'cp:no' }]]
  return { md: lines.join('\n\n'), rows, kb: new InlineKeyboard().text(yes, 'cp:go').text(no, 'cp:no') }
}

export const compactingText = () => tr('🗜 Compacting the history… a big one takes a couple of minutes.', '🗜 Сжимаю историю… большая сжимается пару минут.')

export function compactedText(pre?: number, post?: number) {
  return pre && post
    ? tr(`✅ **History compacted:** ${tokens(pre)} → ${tokens(post)} tokens.`, `✅ **История сжата:** ${tokens(pre)} → ${tokens(post)} токенов.`)
    : tr('✅ **History compacted.**', '✅ **История сжата.**')
}
