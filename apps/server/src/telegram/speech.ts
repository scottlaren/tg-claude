import { failureText } from './failure.ts'
import { InlineKeyboard, type Bot } from 'grammy'
import { MODEL, downloadModel, onlyModelMissing, type MediaConfig } from '../media.ts'
import type { Log } from '../log.ts'
import { tr } from '../i18n.ts'

// The speech model is not in the image: the first voice message or round video that needs it brings an offer to
// download it with a button. Whatever arrives meanwhile waits and is handled once the model is in place

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const where = (topicId?: number) => (topicId ? { message_thread_id: topicId } : {})
const HTML = { parse_mode: 'HTML' } as const
const mb = (bytes: number) => Math.round(bytes / 1_048_576)
// Messages that wait for the model; past this many the oldest are let go
const WAIT_MAX = 20
const PROGRESS_EVERY_MS = 3000

export const offerText = () => tr(
  `🎙 <b>Voice messages need the speech model</b>\nAbout ${mb(MODEL.size)} MB, downloaded once to the server.\nThen voice messages and round videos are transcribed right there: nothing leaves the server.`,
  `🎙 <b>Для голосовых нужна модель распознавания речи</b>\nОколо ${mb(MODEL.size)} МБ, скачивается на сервер один раз.\nДальше голосовые и кружки расшифровываются прямо там: наружу ничего не уходит.`,
)
export const progressText = (done: number) => tr(
  `⬇️ Downloading the speech model: ${mb(done)} of ${mb(MODEL.size)} MB…`,
  `⬇️ Скачиваю модель распознавания речи: ${mb(done)} из ${mb(MODEL.size)} МБ…`,
)

export function createSpeechSetup({ bot, media, log }: { bot: Bot, media: MediaConfig, log: Log }) {
  const api = bot.api
  const waiting: (() => void)[] = []
  let offered: { chatId: number, topicId?: number, messageId: number } | null = null
  let downloading = false

  const offerKeyboard = () => new InlineKeyboard().text(tr(`⬇️ Download and turn on (${mb(MODEL.size)} MB)`, `⬇️ Скачать и включить (${mb(MODEL.size)} МБ)`), 'sp:get')

  // True when this message waits for the model: then the caller does nothing more with it now
  async function holdFor(chatId: number, topicId: number | undefined, then?: () => void) {
    if (!onlyModelMissing(media)) return false
    if (then) {
      waiting.push(then)
      if (waiting.length > WAIT_MAX) waiting.shift()
    }
    if (offered || downloading) {
      if (then) {
        await api.sendMessage(chatId, downloading
          ? tr("⏳ The speech model is downloading: I'll handle this one once it's in place.", '⏳ Модель распознавания речи скачивается: обработаю, когда она будет на месте.')
          : tr("🎙 I'll handle this one once the speech model is downloaded: the button is above.", '🎙 Обработаю, когда скачаешь модель распознавания речи: кнопка выше.'), where(topicId)).catch(() => {})
      }
      return !!then
    }
    const msg = await api.sendMessage(chatId, offerText(), { ...where(topicId), ...HTML, reply_markup: offerKeyboard() }).catch(() => null)
    if (msg) offered = { chatId, topicId, messageId: msg.message_id }
    return !!then
  }

  bot.callbackQuery('sp:get', async ctx => {
    if (downloading) return ctx.answerCallbackQuery(tr('Already downloading', 'Уже скачиваю'))
    if (!onlyModelMissing(media)) {
      await ctx.answerCallbackQuery(tr('Already on', 'Уже включено'))
      return ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {})
    }
    downloading = true
    await ctx.answerCallbackQuery()
    const edit = (text: string, kb?: InlineKeyboard) => ctx.editMessageText(text, { ...HTML, ...(kb && { reply_markup: kb }) }).catch(() => {})
    await edit(progressText(0))
    let shown = Date.now()
    try {
      await downloadModel(media, {
        onProgress: done => {
          if (Date.now() - shown < PROGRESS_EVERY_MS) return
          shown = Date.now()
          void edit(progressText(done))
        },
      })
      log.info('speech model downloaded', { path: media.model })
      offered = null
      await edit(tr('✅ <b>Speech recognition is on.</b> Voice messages and round videos are transcribed on the server.', '✅ <b>Распознавание речи включено.</b> Голосовые и кружки расшифровываются на сервере.'))
      for (const then of waiting.splice(0)) then()
    } catch (e) {
      log.warn('speech model download failed', (e as Error).message)
      await edit(tr(`⚠️ <b>The speech model didn't download:</b> ${esc(failureText(e))}`, `⚠️ <b>Модель распознавания речи не скачалась:</b> ${esc(failureText(e))}`),
        new InlineKeyboard().text(tr('🔁 Try again', '🔁 Ещё раз'), 'sp:get'))
    } finally {
      downloading = false
    }
  })

  return { holdFor, offer: () => offered }
}
