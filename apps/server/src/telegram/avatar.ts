import { InputFile, type Api } from 'grammy'
import { fileURLToPath } from 'node:url'
import type { Log } from '../log.ts'

export const AVATAR_FILE = fileURLToPath(new URL('../../assets/avatar.jpg', import.meta.url))
export const GROUP_AVATAR_FILE = fileURLToPath(new URL('../../assets/group-avatar.jpg', import.meta.url))

// The bot's picture, when its first owner claims it, and only if it has none: one the owner set in BotFather stays.
// Not worth stopping the setup over, so a failure only goes to the log
export async function setBotAvatar(api: Pick<Api, 'getMe' | 'getUserProfilePhotos' | 'setMyProfilePhoto'>, log: Pick<Log, 'info' | 'warn'>, file = AVATAR_FILE) {
  try {
    const me = await api.getMe()
    const { total_count: photos } = await api.getUserProfilePhotos(me.id, { limit: 1 })
    if (photos > 0) return log.info('bot avatar kept: it already has one')
    await api.setMyProfilePhoto({ type: 'static', photo: new InputFile(file) })
    log.info('bot avatar set')
  } catch (e) {
    log.warn('bot avatar', (e as Error).message)
  }
}

// The same for a group that becomes a workspace: only if it has no picture, and it takes a right the bot may not have
export async function setGroupAvatar(api: Pick<Api, 'setChatPhoto'>, log: Pick<Log, 'info' | 'warn'>, chat: { id: number, photo?: unknown }, file = GROUP_AVATAR_FILE) {
  if (chat.photo) return log.info('group avatar kept: it already has one', { chatId: chat.id })
  try {
    await api.setChatPhoto(chat.id, new InputFile(file))
    log.info('group avatar set', { chatId: chat.id })
  } catch (e) {
    log.warn('group avatar', (e as Error).message)
  }
}
