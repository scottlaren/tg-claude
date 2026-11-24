import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { InlineKeyboard, type Bot, type Context } from 'grammy'
import type { Message } from 'grammy/types'
import type { Device, OpOutcome, OpSpec } from '../gateway.ts'
import type { Log } from '../log.ts'
import type { RichButton } from './render.ts'
import { mdText } from './schedule-menu.ts'
import { tr } from '../i18n.ts'

// /lock: the button for a stolen account or a server under suspicion. The lock itself lives on each computer (agent's
// lock.ts): this only asks for it, and remembers to ask a computer that is off the moment it connects

type LockGateway = {
  request: (deviceId: string, op: OpSpec) => Promise<OpOutcome>
  events: { on: (event: 'online', listener: (dev: Device) => void) => unknown }
}
export type LockResult = { id: string, state: 'locked' | 'owed' | 'failed', file?: string, error?: string }

const topicOf = (m?: Message) => (m?.is_topic_message ? m.message_thread_id : undefined)

export function createLocks({ file, gateway, log, heard }: {
  file: string
  gateway: LockGateway
  log: Log
  // A computer that was off has now got the lock
  heard: (dev: Device, file?: string) => void
}) {
  const owed = new Set<string>()
  try {
    for (const id of JSON.parse(readFileSync(file, 'utf8'))) owed.add(id)
  } catch {}
  const save = () => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify([...owed]))
    renameSync(`${file}.tmp`, file)
  }

  // Only the computer's own answer counts: until then the lock is still owed
  async function deliver(id: string): Promise<LockResult> {
    const out = await gateway.request(id, { projectId: '', bindingVersion: 0, tool: 'lock', params: {} })
    if (!out.ok) {
      log.warn('lock not delivered', { id, code: out.error.code })
      return out.error.code === 'offline' ? { id, state: 'owed' } : { id, state: 'failed', error: out.error.message }
    }
    owed.delete(id)
    save()
    log.info('computer locked', { id })
    return { id, state: 'locked', file: (out.result as { file?: string } | null)?.file }
  }

  gateway.events.on('online', dev => {
    if (!owed.has(dev.id)) return
    if (dev.locked) {
      owed.delete(dev.id)
      return save()
    }
    deliver(dev.id).then(r => {
      if (r.state === 'locked') heard(dev, r.file)
    }, e => log.warn('lock not delivered', (e as Error).message))
  })

  return {
    all(ids: string[]) {
      for (const id of ids) owed.add(id)
      save()
      return Promise.all(ids.map(deliver))
    },
    owed: (id: string) => owed.has(id),
  }
}

export const lockQuestion = () => [
  tr('### 🔒 Lock all computers?', '### 🔒 Заблокировать все компьютеры?'),
  tr('Everything running stops, and the agents refuse every command, updates included.', 'Всё, что идёт, остановится, а агенты будут отказывать в любых командах, включая обновления.'),
  tr('**Only someone at the computer can unlock it.** The bot cannot.', '**Снять блокировку можно только за самим компьютером.** Из бота нельзя.'),
].join('\n\n')

export function lockReport(results: LockResult[], nameOf: (id: string) => string, isCloud: (id: string) => boolean) {
  const row = (r: LockResult) => {
    const name = `**${mdText(nameOf(r.id))}:**`
    if (r.state === 'owed') return tr(`- ${name} offline, locks as soon as it connects`, `- ${name} не в сети, заблокируется при подключении`)
    if (r.state === 'failed') return tr(`- ${name} ⚠️ not locked: ${mdText(r.error ?? 'no answer')}. Turn it off or disconnect it from the network`, `- ${name} ⚠️ не заблокирован: ${mdText(r.error ?? 'нет ответа')}. Выключи его или отключи от сети`)
    if (isCloud(r.id)) return tr(`- ${name} locked. To unlock, on the VPS: \`docker compose exec cloud rm ${r.file}\``, `- ${name} заблокировано. Снять на VPS: \`docker compose exec cloud rm ${r.file}\``)
    return tr(`- ${name} locked. To unlock, delete this file on it: \`${r.file}\``, `- ${name} заблокирован. Чтобы снять, удали на нём файл: \`${r.file}\``)
  }
  return [
    tr('### 🔒 Locked', '### 🔒 Заблокировано'),
    results.length ? results.map(row).join('\n') : tr('No computers are linked.', 'Нет привязанных компьютеров.'),
    tr('**Server under suspicion?** The lock may not get through: power the VPS off in the hosting panel.', '**Подозрение на взлом сервера?** Блокировка может не дойти: выключи VPS в панели хостинга.'),
    tr('**Claude in Chrome** works through your claude.ai account, not the agent: if the account is at risk, turn the extension off in the browser.', '**Claude в Chrome** работает через аккаунт claude.ai, а не через агента: если аккаунт под угрозой, выключи расширение в браузере.'),
  ].join('\n\n')
}

export function createLockMenu({ bot, locks, ids, nameOf, isCloud, stopAll, sendChoice, editRich, keyboardOf, log }: {
  bot: Bot
  locks: Pick<ReturnType<typeof createLocks>, 'all'>
  ids: () => string[]
  nameOf: (id: string) => string
  isCloud: (id: string) => boolean
  stopAll: () => Promise<unknown>
  sendChoice: (chatId: number, topicId: number | undefined, md: string, rows: RichButton[][], keyboard: InlineKeyboard) => Promise<unknown>
  editRich: (chatId: number, messageId: number, md: string) => Promise<boolean>
  keyboardOf: (rows: RichButton[][]) => InlineKeyboard
  log: Log
}) {
  const rows = (): RichButton[][] => [[
    { text: tr('🔒 Lock', '🔒 Заблокировать'), data: 'lck:go' },
    { text: tr('Cancel', 'Отмена'), data: 'lck:no' },
  ]]
  bot.command('lock', ctx => sendChoice(ctx.chat.id, topicOf(ctx.msg), lockQuestion(), rows(), keyboardOf(rows())))

  const edit = (ctx: Context, md: string) => {
    const id = ctx.callbackQuery?.message?.message_id
    return id ? editRich(ctx.chat!.id, id, md) : Promise.resolve(false)
  }
  bot.callbackQuery('lck:no', async ctx => {
    await ctx.answerCallbackQuery()
    await edit(ctx, tr('🔓 Not locked.', '🔓 Не заблокировано.'))
  })
  bot.callbackQuery('lck:go', async ctx => {
    await ctx.answerCallbackQuery(tr('🔒 Locking…', '🔒 Блокирую…'))
    log.warn('lock requested', { by: ctx.from?.id })
    await edit(ctx, tr('🔒 Locking…', '🔒 Блокирую…'))
    // Side by side: a computer that doesn't answer can take a while, and the turns must stop now. One that fails to stop
    // changes nothing about the locks
    const [results] = await Promise.all([locks.all(ids()), stopAll().catch(e => log.warn('lock: stopping turns', (e as Error).message))])
    await edit(ctx, lockReport(results, nameOf, isCloud))
  })
}
