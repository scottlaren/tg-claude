import { InlineKeyboard, type Bot } from 'grammy'
import { randomBytes } from 'node:crypto'
import type { FolderList, OpTool, ZonesState } from '@tgcv/protocol'
import type { Gateway } from '../gateway.ts'
import type { Log } from '../log.ts'
import { pageRow } from './pages.ts'
import { tr, count } from '../i18n.ts'

// A computer's working folders from the bot: what they are, where else projects seem to live, a folder browser
// to pick another, and the offer right after pairing. Every folder inside a working folder is a project

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const where = (topicId?: number) => (topicId ? { message_thread_id: topicId } : {})
const HTML = { parse_mode: 'HTML' } as const
const PAGE = 12
// Menus are kept by a short token in the buttons (Telegram's 64 bytes hold no paths); the oldest go first
const KEEP = 100

type View = { text: string, kb?: InlineKeyboard }
type Menu = { deviceId: string, state: ZonesState, list?: FolderList, page: number, picked?: string }

// A path as the user reads it: ~ for the home folder
export function tilde(path: string, home: string) {
  if (path === home) return '~'
  return path.startsWith(home) && /^[\\/]/.test(path.slice(home.length)) ? '~' + path.slice(home.length) : path
}

const projectsLabel = (n: number) => count(n, ['project', 'projects'], ['проект', 'проекта', 'проектов'])

export function zonesView(tok: string, deviceName: string, s: ZonesState, note?: string): View {
  const code = (p: string) => `<code>${esc(tilde(p, s.home))}</code>`
  const lines = [...(note ? [note, ''] : []), `📁 <b>${tr('Working folders', 'Рабочие папки')} · ${esc(deviceName)}</b>`]
  lines.push(s.zones.length
    ? s.zones.map(z => `• ${code(z.path)} — ${projectsLabel(z.projects)}`).join('\n')
    : tr('None: without a working folder the computer has no projects.', 'Ни одной: без рабочей папки у компьютера нет проектов.'))
  if (s.suggestions.length) lines.push('', tr('Found more folders with projects:', 'Нашёл ещё папки с проектами:'), ...s.suggestions.map(z => `• ${code(z.path)} — ${projectsLabel(z.projects)}`))
  lines.push('', tr('<i>Every folder inside a working folder is a project in /project.</i>', '<i>Каждая папка внутри рабочей — проект в /project.</i>'))
  const kb = new InlineKeyboard()
  s.suggestions.forEach((z, i) => kb.text(`📁 ${trunc(tilde(z.path, s.home), 40)}`, `zf:${tok}:sg:${i}`).row())
  kb.text(tr('📂 Choose another folder', '📂 Выбрать другую папку'), `zf:${tok}:br`).row()
  if (s.zones.length > 1) s.zones.forEach((z, i) => kb.text(`✖ ${tr('Remove', 'Убрать')} ${trunc(tilde(z.path, s.home), 34)}`, `zf:${tok}:rm:${i}`).row())
  kb.text(tr('✅ Done', '✅ Готово'), `zf:${tok}:ok`)
  return { text: lines.join('\n'), kb }
}

// The menu closed: just the list, no buttons
export function zonesSummary(deviceName: string, s: ZonesState): View {
  const list = s.zones.map(z => `• <code>${esc(tilde(z.path, s.home))}</code> — ${projectsLabel(z.projects)}`).join('\n')
  return { text: `📁 <b>${tr('Working folders', 'Рабочие папки')} · ${esc(deviceName)}</b>\n${list || tr('None.', 'Ни одной.')}\n${tr('To change: /devices → “📁 Folders”.', 'Поменять — /devices → «📁 Папки».')}` }
}

export function browseView(tok: string, s: ZonesState, list: FolderList, page: number): View {
  const pages = Math.max(1, Math.ceil(list.folders.length / PAGE))
  const at = Math.min(page, pages - 1)
  const lines = [`📂 <code>${esc(tilde(list.path, s.home))}</code>`]
  lines.push(list.folders.length ? tr('Tap a folder to go into it, or choose this one.', 'Нажми на папку, чтобы зайти в неё, или выбери эту.') : tr('No folders inside.', 'Внутри папок нет.'))
  if (list.more) lines.push(tr(`<i>Showing the first ${list.folders.length}; ${list.more} more didn't fit.</i>`, `<i>Показаны первые ${list.folders.length}, ещё ${list.more} не поместились.</i>`))
  const kb = new InlineKeyboard()
  const shown = list.folders.slice(at * PAGE, at * PAGE + PAGE)
  shown.forEach((f, i) => {
    kb.text(`📁 ${trunc(f.name, 26)}`, `zf:${tok}:o:${at * PAGE + i}`)
    if (i % 2 || i === shown.length - 1) kb.row()
  })
  const pagesRow = pageRow(at, pages)
  if (pagesRow.length) {
    for (const p of pagesRow) kb.text(p.label, `zf:${tok}:pg:${p.page}`)
    kb.row()
  }
  // Two to a row: on a phone four buttons in a row are cut down to a letter or two
  if (list.parent) kb.text(tr('⬆️ Up', '⬆️ Выше'), `zf:${tok}:up`)
  kb.text(tr('🏠 Home', '🏠 Домой'), `zf:${tok}:rt:0`).row()
  s.roots.slice(1, 5).forEach((r, i) => {
    kb.text(`💽 ${trunc(r.name, 18)}`, `zf:${tok}:rt:${i + 1}`)
    if (i % 2) kb.row()
  })
  kb.row()
  // A drive's root can't be a working folder: every folder on it would be a project
  if (list.parent) kb.text(tr('✅ Choose this folder', '✅ Выбрать эту папку'), `zf:${tok}:pk`).row()
  kb.text(tr('← Back', '← Назад'), `zf:${tok}:back`)
  return { text: lines.join('\n'), kb }
}

export function pickView(tok: string, s: ZonesState, picked: string): View {
  const short = (p: string) => trunc(tilde(p, s.home), 30)
  const kb = new InlineKeyboard()
  if (!s.zones.length) kb.text(tr('✅ Make it the working folder', '✅ Сделать рабочей'), `zf:${tok}:rep`).row()
  else {
    kb.text(s.zones.length === 1 ? tr(`Instead of ${short(s.zones[0].path)}`, `Вместо ${short(s.zones[0].path)}`) : tr(`Instead of all (${s.zones.length})`, `Вместо всех (${s.zones.length})`), `zf:${tok}:rep`).row()
    kb.text(s.zones.length === 1 ? tr(`Along with ${short(s.zones[0].path)}`, `Вместе с ${short(s.zones[0].path)}`) : tr('Add to them', 'Добавить к ним'), `zf:${tok}:add`).row()
  }
  kb.text(tr('← Back', '← Назад'), `zf:${tok}:back`)
  return {
    text: tr(
      `📁 Make <code>${esc(tilde(picked, s.home))}</code> a working folder?\n<i>Folders on the disk stay as they are: only the bot's list of projects changes.</i>`,
      `📁 Сделать рабочей <code>${esc(tilde(picked, s.home))}</code>?\n<i>Папки на диске остаются как есть: меняется только список проектов в боте.</i>`,
    ),
    kb,
  }
}

export function createZonesMenu({ bot, gateway, log }: { bot: Bot, gateway: Gateway, log: Log }) {
  const menus = new Map<string, Menu>()
  const remember = (m: Menu) => {
    const tok = randomBytes(4).toString('hex')
    menus.set(tok, m)
    if (menus.size > KEEP) menus.delete(menus.keys().next().value!)
    return tok
  }
  const ask = async (deviceId: string, tool: OpTool, params: Record<string, unknown> = {}) => {
    const out = await gateway.request(deviceId, { projectId: '', bindingVersion: 0, tool, params })
    if (!out.ok) throw new Error(out.error.message)
    return out.result
  }
  const nameOf = (id: string) => gateway.device(id)?.name ?? id

  async function open(chatId: number, topicId: number | undefined, deviceId: string, note?: string) {
    let state: ZonesState
    try {
      state = await ask(deviceId, 'zones') as ZonesState
    } catch (e) {
      await bot.api.sendMessage(chatId, tr(`📁 Couldn't open the folders of ${esc(nameOf(deviceId))}: ${esc((e as Error).message)}`, `📁 Папки ${esc(nameOf(deviceId))} не открылись: ${esc((e as Error).message)}`), { ...where(topicId), ...HTML }).catch(() => {})
      return
    }
    const v = zonesView(remember({ deviceId, state, page: 0 }), nameOf(deviceId), state, note)
    await bot.api.sendMessage(chatId, v.text, { ...where(topicId), ...HTML, reply_markup: v.kb }).catch(e => log.warn('zones menu', (e as Error).message))
  }

  // From /devices
  bot.callbackQuery(/^zo:([\w-]+)$/, async ctx => {
    await ctx.answerCallbackQuery()
    const msg = ctx.callbackQuery.message
    await open(ctx.chat!.id, msg?.is_topic_message ? msg.message_thread_id : undefined, ctx.match[1])
  })

  bot.callbackQuery(/^zf:([0-9a-f]{8}):([a-z]+)(?::(\d+))?$/, async ctx => {
    const [, tok, action, num] = ctx.match
    const n = Number(num ?? 0)
    const m = menus.get(tok)
    if (!m) return ctx.answerCallbackQuery({ text: tr('This menu is out of date: open /devices again', 'Это меню устарело: открой /devices заново'), show_alert: true })
    const name = nameOf(m.deviceId)
    const show = async (v: View, toast?: string) => {
      await ctx.answerCallbackQuery(toast)
      await ctx.editMessageText(v.text, { ...HTML, ...(v.kb && { reply_markup: v.kb }) }).catch(() => {})
    }
    const pick = (path?: string) => {
      if (!path) return ctx.answerCallbackQuery()
      if (m.state.zones.some(z => z.path === path)) return ctx.answerCallbackQuery({ text: tr('This is already a working folder', 'Это уже рабочая папка'), show_alert: true })
      m.picked = path
      return show(pickView(tok, m.state, path))
    }
    try {
      switch (action) {
        case 'ok':
          menus.delete(tok)
          return show(zonesSummary(name, m.state))
        case 'back':
          m.list = undefined
          m.picked = undefined
          return show(zonesView(tok, name, m.state))
        case 'sg': return pick(m.state.suggestions[n]?.path)
        case 'pk': return pick(m.list?.path)
        case 'pg':
          if (!m.list) return ctx.answerCallbackQuery()
          m.page = n
          return show(browseView(tok, m.state, m.list, n))
        case 'br': case 'rt': case 'o': case 'up': {
          const path = action === 'br' ? m.state.home : action === 'rt' ? m.state.roots[n]?.path : action === 'o' ? m.list?.folders[n]?.path : m.list?.parent
          if (!path) return ctx.answerCallbackQuery()
          m.list = await ask(m.deviceId, 'folders', { path }) as FolderList
          m.page = 0
          return show(browseView(tok, m.state, m.list, 0))
        }
        case 'rep': case 'add': case 'rm': {
          const current = m.state.zones.map(z => z.path)
          if (action !== 'rm' && !m.picked) return ctx.answerCallbackQuery()
          const paths = action === 'rm' ? current.filter((_, i) => i !== n) : action === 'add' ? [...current, m.picked!] : [m.picked!]
          m.state = await ask(m.deviceId, 'set_zones', { paths }) as ZonesState
          m.list = undefined
          m.picked = undefined
          await gateway.refreshProjects(m.deviceId).catch(() => {})
          log.info('working folders changed', { device: m.deviceId, zones: m.state.zones.map(z => z.path) })
          return show(zonesView(tok, name, m.state, tr('✅ Done: the list of projects is updated.', '✅ Готово: список проектов обновлён.')), tr('Done', 'Готово'))
        }
      }
      return ctx.answerCallbackQuery()
    } catch (e) {
      return ctx.answerCallbackQuery({ text: trunc((e as Error).message, 190), show_alert: true }).catch(() => {})
    }
  })

  // Right after pairing, once the computer is online: where its projects are, and where else they seem to be.
  // A moment later than the «connected» message, so it comes second
  const afterPairing = new Map<string, { chatId: number, topicId?: number }>()
  gateway.events.on('paired', d => afterPairing.set(d.id, { chatId: d.chatId, topicId: d.topicId }))
  gateway.events.on('online', dev => {
    const at = afterPairing.get(dev.id)
    if (!at) return
    afterPairing.delete(dev.id)
    setTimeout(() => {
      open(at.chatId, at.topicId, dev.id, tr('Where are the projects on this computer? Keep the working folder or choose another.', 'Где на этом компьютере лежат проекты? Оставь рабочую папку или выбери другую.')).catch(() => {})
    }, 1500)
  })

  return { open }
}
