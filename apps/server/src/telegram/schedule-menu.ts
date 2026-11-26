import { InlineKeyboard, type Bot, type Context } from 'grammy'
import { randomBytes } from 'node:crypto'
import type { Log } from '../log.ts'
import type { Gateway } from '../gateway.ts'
import type { Profiles } from '../profiles.ts'
import { topicKey, type Mode, type TopicStore } from '../store.ts'
import { nextRun, oftenerThanHourly, parseAt, parseCron, parseTimeZone, skipReason, MAX_TASKS, type Schedule, type ScheduledTask, type SkipReason } from '../schedule.ts'
import type { ScheduleProposal } from '../claude/schedule-tools.ts'
import { epochMs, inTime, timeTag } from './usage.ts'
import { hashtag } from './emoji.ts'
import { keepLoud } from './quiet.ts'
import { topicWay, botUserOf } from './overview.ts'
import { fenced } from './incoming.ts'
import { richButtons, type RichButton } from './render.ts'
import type { Choice } from './bot.ts'
import { lang, tr } from '../i18n.ts'

// /schedule and everything around it: the proposal Claude makes, the owner's confirmation, the runs themselves

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const where = (topicId?: number) => (topicId ? { message_thread_id: topicId } : {})
const HTML = { parse_mode: 'HTML' } as const
import { trunc } from './text.ts'
const TICK_MS = 30_000

const parseKey = (key: string) => {
  const [chat, thread] = key.split(':').map(Number)
  return { chatId: chat, topicId: thread || undefined }
}

export const whenLabel = (t: number, timeZone: string) => (Number.isFinite(t)
  ? new Intl.DateTimeFormat(lang() === 'ru' ? 'ru-RU' : 'en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(t)
  : tr('never', 'никогда'))

// A cron as people say it: «every day at 11:00 and 22:00». Null when it is anything rarer: the cron itself is shown
export function cronLabel(cron: string): string | null {
  const f = cron.trim().split(/\s+/)
  if (f.length !== 5) return null
  const [min, hour, dom, mon, dow] = f
  if (!/^\d+$/.test(min) || mon !== '*') return null
  const and = (list: string[]) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} ${tr('and', 'и')} ${list.at(-1)}`)
  const mm = min.padStart(2, '0')
  let at: string
  if (hour === '*') at = tr(`every hour at :${mm}`, `каждый час в :${mm}`)
  else if (/^\d+(,\d+)*$/.test(hour)) at = `${tr('at', 'в')} ${and(hour.split(',').map(h => `${h.padStart(2, '0')}:${mm}`))}`
  else return null
  const days = lang() === 'ru' ? ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  if (dom === '*' && dow === '*') return hour === '*' ? at : `${tr('every day', 'каждый день')} ${at}`
  if (dom === '*' && dow === '1-5') return `${tr('on weekdays', 'по будням')} ${at}`
  if (dom === '*' && /^[0-7](,[0-7])*$/.test(dow)) return `${tr('on', 'по')} ${and(dow.split(',').map(d => days[Number(d) % 7]))} ${at}`
  if (/^\d+$/.test(dom) && dow === '*') return `${tr(`on day ${dom} of every month`, `${dom}-го числа каждого месяца`)} ${at}`
  return null
}

// «today at 22:00», «tomorrow at 15:00», otherwise the day: in the owner's time zone, without seconds
export function nextLabel(t: number, timeZone: string, now = Date.now()) {
  if (!Number.isFinite(t)) return tr('never', 'никогда')
  const day = (x: number) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(x)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(t)
  if (day(t) === day(now)) return tr(`today at ${time}`, `сегодня в ${time}`)
  if (day(t) === day(now + 86400_000)) return tr(`tomorrow at ${time}`, `завтра в ${time}`)
  const date = new Intl.DateTimeFormat(lang() === 'ru' ? 'ru-RU' : 'en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(t)
  return tr(`${date} at ${time}`, `${date} в ${time}`)
}

// «Etc/GMT-4» means UTC+4 (the sign is the other way round): people see the offset
export function zoneLabel(timeZone: string) {
  const offset = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(0).find(p => p.type === 'timeZoneName')?.value.replace('GMT', 'UTC') ?? ''
  const utc = offset === 'UTC' || offset === 'UTC+0' ? 'UTC' : offset
  return /^(Etc\/|UTC$|GMT$)/.test(timeZone) ? utc : `${timeZone} (${utc})`
}

// A moment in a message, read in whatever time zone the reader is in; the owner's is only the fallback
export const whenTag = (t: number, timeZone: string) => (Number.isFinite(t) ? timeTag(t, 'wDT', esc(whenLabel(t, timeZone))) : esc(whenLabel(t, timeZone)))

export function skipText(reason: Exclude<SkipReason, 'running'>) {
  switch (reason) {
    case 'late': return tr('the server was off at that time', 'в это время сервер был выключен')
    case 'unbound': return tr('the topic has no project now', 'у топика сейчас нет проекта')
    case 'offline': return tr('the computer is offline', 'компьютер не в сети')
    case 'limit': return tr("the profile's limit is spent", 'лимит профиля исчерпан')
  }
}

// What the user sees when Claude proposes a task. The prompt goes in whole and in a code block, never shortened or
// read as formatting: this is what will run unattended. The tool's limit of 2000 characters leaves room for it
export const mdText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/[\\*_~`|=$[\]]/g, '\\$&')

export function proposalMarkdown(p: { name: string, cron?: string, inMinutes?: number, prompt: string, browser?: boolean }, timeZone: string, zoneChosen: boolean, runs: number[], mode: Mode) {
  const modeNote = mode === 'ask'
    ? tr('In this topic actions ask for permission: a run waits up to 30 minutes for your button. /mode changes that.', 'В этом топике действия спрашивают разрешение: запуск будет ждать твою кнопку до 30 минут. Поменять — /mode.')
    : mode === 'read' ? tr('This topic is read-only: runs can look, not change anything. /mode changes that.', 'Этот топик только для просмотра: запуски смогут смотреть, но не менять. Поменять — /mode.') : ''
  return [
    `**⏰ ${tr('Claude proposes a schedule', 'Claude предлагает расписание')}: ${mdText(p.name)}**`,
    `${p.cron ? `\`${p.cron}\`` : tr('once', 'один раз')} · ${mdText(timeZone)}${zoneChosen ? '' : tr(' (time zone not chosen yet: /schedule)', ' (часовой пояс ещё не задан: /schedule)')}`,
    p.inMinutes !== undefined
      ? `${tr('Runs', 'Запуск')}: ${inTime(p.inMinutes * 60_000)} ${tr('after you tap Create', 'после нажатия «Создать»')}`
      : `${p.cron ? tr('Next runs', 'Ближайшие запуски') : tr('Runs', 'Запуск')}: ${runs.map(t => whenTag(t, timeZone)).join(' · ')}`,
    fenced(p.prompt),
    p.browser ? tr('🌐 **With your Chrome:** it turns on in this topic for each run only, and off after it.', '🌐 **С твоим Chrome:** он включается в этом топике только на время запуска и потом выключается.') : '',
    modeNote,
  ].filter(Boolean).join('\n\n')
}

export const runPrompt = (t: Pick<ScheduledTask, 'name' | 'prompt'>) =>
  `[Scheduled task "${t.name}". It runs by itself: the user set it up earlier and may not be watching. Decide what you can on your own and report briefly.]\n\n${t.prompt}`

// A run missed because the computer was off: what it says, and the offer to run it when the computer is back
export function skippedOfflineMarkdown(name: string, once: boolean, next: string | null) {
  return [
    tr(`### ⏰ ${mdText(name)}: skipped`, `### ⏰ ${mdText(name)}: пропущено`),
    tr('The computer was offline at that time.', 'В это время компьютер был не в сети.'),
    `<footer>${once ? tr('A one-time task: without a tap it won\'t run again', 'Задача разовая: без нажатия она больше не запустится') : tr(`The schedule stays. Next: ${next}`, `Расписание остаётся. Следующий запуск: ${next}`)}</footer>`,
  ].join('\n\n')
}

export function createScheduleMenu({ bot, schedule, topics, gateway, profiles, log, modeOf, isRunning, masked, enqueue, sendChoice, editRich, topicGone, offered, defer, browserFor = () => false, tickMs = TICK_MS }: {
  bot: Bot
  schedule: Schedule
  topics: TopicStore
  gateway: Gateway
  profiles: Profiles
  log: Log
  modeOf: (key: string) => Mode
  // A run of this task is queued or working in its topic
  isRunning: (key: string, id: string) => boolean
  masked: (chatId: number, topicId: number | undefined, text: string) => string
  enqueue: (chatId: number, topicId: number | undefined, text: string, o: { reply: false, msgId: number, scheduleId: string }) => void
  // Chrome on in the topic for the next run only; false when no browser is linked to its computer
  browserFor?: (key: string) => boolean
  sendChoice: (chatId: number, topicId: number | undefined, md: string, rows: RichButton[][], keyboard: InlineKeyboard) => Promise<Choice | null>
  editRich: (chatId: number, messageId: number, md: string) => Promise<boolean>
  // Claude proposed a task: its buttons now wait for the user
  offered?: (key: string, messageId?: number) => void
  topicGone: (key: string) => Promise<unknown>
  // Puts a task off until the topic's computer connects, as Claude's defer_task does
  defer: (key: string, task: string, title: string) => Promise<string>
  tickMs?: number
}) {
  const { api } = bot
  // moment: when a task for a set time runs. «In 2 hours» counts from the tap: the owner may read the offer much later
  const pending = new Map<string, ScheduleProposal & { key: string, moment?: number, choice?: Choice | null }>()
  const zoneWaits = new Set<string>()
  // Runs missed while the computer was off, waiting for the user's tap: in memory, a restart only loses the offer
  const missed = new Map<string, { key: string, name: string, prompt: string }>()

  const inChat = (t: ScheduledTask, chatId: number) => parseKey(t.key).chatId === chatId

  // Each task in a quote of its own, one fact per line: Telegram draws no gap between paragraphs, and tasks run together
  // otherwise. Numbered when there are several, so the buttons can say which one they act on
  function view(chatId: number) {
    const tasks = schedule.list().filter(t => inChat(t, chatId))
    const zone = schedule.zone()
    const n = (i: number) => (tasks.length > 1 ? ` · ${i + 1}` : '')
    const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)
    const blocks = tasks.map((t, i) => {
      const how = t.once ? tr('🔂 Once', '🔂 Один раз') : `🔁 ${cap(cronLabel(t.cron) ?? `\`${t.cron}\``)}`
      const when = t.paused ? tr('⏸ On pause', '⏸ На паузе') : `⏭ ${cap(nextLabel(t.nextAt, zone))}`
      const topic = topics.get(t.key).title
      const way = topicWay(parseKey(t.key).chatId, parseKey(t.key).topicId, botUserOf(bot))
      return [`**${tasks.length > 1 ? `${i + 1}. ` : ''}${mdText(t.name)}**`, how, when, ...(t.browser ? [tr('🌐 With Chrome', '🌐 С Chrome')] : []), ...(topic ? [`💬 ${way ? `[${mdText(topic)}](${way})` : mdText(topic)}`] : [])].map(l => `> ${l}`).join('  \n')
    })
    const rows: RichButton[][] = tasks.map((t, i) => [
      { text: t.paused ? `▶️ ${tr('Resume', 'Продолжить')}${n(i)}` : `⏸ ${tr('Pause', 'Пауза')}${n(i)}`, data: `sch:p:${t.id}` },
      { text: `🗑 ${tr('Delete', 'Удалить')}${n(i)}`, data: `sch:d:${t.id}` },
    ])
    rows.push([{ text: `🕐 ${tr('Time zone', 'Часовой пояс')}: ${zoneLabel(zone)}`, data: 'sch:tz' }])
    const md = [
      tr('### ⏰ Scheduled tasks', '### ⏰ Задачи по расписанию'),
      blocks.length ? blocks.join('\n\n') : tr('No tasks yet. Ask Claude in a topic, for example: “every morning at 9 check the build”.', 'Пока нет. Попроси Claude в топике, например: «каждое утро в 9 проверяй сборку».'),
      `<footer>${schedule.zoneChosen() ? tr(`Times are ${zoneLabel(zone)}. Claude adds tasks when you ask it in a topic.`, `Время по ${zoneLabel(zone)}. Задачи добавляет Claude, когда попросишь в топике.`) : tr('Time zone not chosen: times are read as UTC.', 'Часовой пояс не задан: время считается по UTC.')}</footer>`,
    ].join('\n\n')
    const kb = new InlineKeyboard()
    for (const row of rows) {
      for (const b of row) kb.text(b.text, b.data)
      kb.row()
    }
    return { md, rows, kb }
  }

  bot.command('schedule', ctx => {
    const v = view(ctx.chat.id)
    return sendChoice(ctx.chat.id, ctx.msg.is_topic_message ? ctx.msg.message_thread_id : undefined, v.md, v.rows, v.kb)
  })

  const redraw = async (ctx: Context) => {
    const v = view(ctx.chat!.id)
    const id = ctx.callbackQuery?.message?.message_id
    if (id && await editRich(ctx.chat!.id, id, `${v.md}\n\n${richButtons(v.rows)}`)) return
    await ctx.editMessageReplyMarkup({ reply_markup: v.kb }).catch(() => {})
  }

  bot.callbackQuery(/^sch:p:(\w+)$/, async ctx => {
    const t = schedule.get(ctx.match[1])
    if (!t || !inChat(t, ctx.chat!.id)) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    schedule.setPaused(t.id, !t.paused)
    log.info('schedule paused', { id: t.id, paused: !t.paused })
    await ctx.answerCallbackQuery(t.paused ? tr('Resumed', 'Продолжено') : tr('On pause', 'На паузе'))
    await redraw(ctx)
  })

  bot.callbackQuery(/^sch:d:(\w+)$/, async ctx => {
    const t = schedule.get(ctx.match[1])
    if (t && inChat(t, ctx.chat!.id)) schedule.remove(t.id)
    log.info('schedule removed', { id: ctx.match[1] })
    await ctx.answerCallbackQuery(tr('Deleted', 'Удалено'))
    await redraw(ctx)
  })

  bot.callbackQuery('sch:tz', async ctx => {
    const thread = ctx.callbackQuery.message?.is_topic_message ? ctx.callbackQuery.message.message_thread_id : undefined
    zoneWaits.add(topicKey(ctx.chat!.id, thread))
    await ctx.answerCallbackQuery()
    await ctx.reply(tr('🕐 Send your time zone as your next message: <code>Europe/Kyiv</code>, <code>UTC+3</code> or a city in English.', '🕐 Пришли часовой пояс следующим сообщением: <code>Europe/Kyiv</code>, <code>UTC+3</code> или город по-английски.'), { ...where(thread), ...HTML })
  })

  bot.callbackQuery(/^scy:(\w+)$/, async ctx => {
    const p = pending.get(ctx.match[1])
    if (!p) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    if (schedule.full()) return ctx.answerCallbackQuery({ text: tr(`No more than ${MAX_TASKS} tasks: delete one in /schedule`, `Не больше ${MAX_TASKS} задач: удали лишнюю в /schedule`), show_alert: true })
    if (p.moment !== undefined && p.moment <= Date.now()) return ctx.answerCallbackQuery({ text: tr('That time has passed: ask Claude again', 'Это время уже прошло: попроси Claude ещё раз'), show_alert: true })
    pending.delete(ctx.match[1])
    const zone = p.timeZone && parseTimeZone(p.timeZone)
    if (zone) schedule.setZone(zone)
    const t = schedule.add({ key: p.key, name: p.name, prompt: p.prompt, cron: p.cron ?? '', ...(p.browser && { browser: true }) }, p.inMinutes !== undefined ? Date.now() + p.inMinutes * 60_000 : p.moment)
    log.info('schedule added', { id: t.id, key: t.key, cron: t.cron })
    await ctx.answerCallbackQuery(tr('Scheduled', 'Запланировано'))
    if (p.choice) return editRich(ctx.chat!.id, p.choice.messageId, `${p.choice.md}\n\n> ✅ **${tr('Scheduled', 'Запланировано')}.** ${tr('Next', 'Следующий запуск')}: ${nextLabel(t.nextAt, schedule.zone())}. ${tr('Manage: /schedule.', 'Управление: /schedule.')}`)
    await ctx.editMessageText(`⏰ <b>${esc(t.name)}</b> ${tr('is scheduled', 'запланирована')}.\n${tr('Next', 'Следующий запуск')}: ${esc(nextLabel(t.nextAt, schedule.zone()))}. ${tr('Manage: /schedule.', 'Управление: /schedule.')}`, HTML).catch(() => {})
  })

  bot.callbackQuery(/^scn:(\w+)$/, async ctx => {
    const p = pending.get(ctx.match[1])
    pending.delete(ctx.match[1])
    await ctx.answerCallbackQuery(tr('Cancelled', 'Отменено'))
    if (p?.choice) return editRich(ctx.chat!.id, p.choice.messageId, `${p.choice.md}\n\n> ${tr('⏰ Not scheduled.', '⏰ Не запланировано.')}`)
    await ctx.editMessageText(tr('⏰ Not scheduled.', '⏰ Не запланировано.')).catch(() => {})
  })

  bot.callbackQuery(/^sko:(go|no):(\w+)$/, async ctx => {
    const m = missed.get(ctx.match[2])
    if (!m) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    missed.delete(ctx.match[2])
    const id = ctx.callbackQuery.message?.message_id
    if (ctx.match[1] === 'no') {
      await ctx.answerCallbackQuery()
      if (id) await editRich(ctx.chat!.id, id, tr(`⏰ **${mdText(m.name)}**: not run.`, `⏰ **${mdText(m.name)}**: не запускается.`))
      return
    }
    await ctx.answerCallbackQuery(tr('It runs when the computer connects', 'Запустится, когда компьютер подключится'))
    log.info('schedule run put off for the computer', { key: m.key })
    if (id) await editRich(ctx.chat!.id, id, tr(`⏰ **${mdText(m.name)}**: runs when the computer connects.`, `⏰ **${mdText(m.name)}**: запустится, когда компьютер подключится.`))
    await defer(m.key, m.prompt, m.name)
  })

  async function fire(t: ScheduledTask) {
    const { chatId, topicId } = parseKey(t.key)
    const topic = topics.get(t.key)
    const limit = profiles.lastLimit(profiles.nameOf(topic.profile))
    const reset = epochMs(limit?.resetsAt)
    const reason = skipReason({
      now: Date.now(),
      nextAt: t.nextAt,
      running: isRunning(t.key, t.id),
      unbound: !topic.noProject && (!topic.deviceId || !topic.projectId),
      offline: !topic.noProject && !!topic.deviceId && !gateway.device(topic.deviceId),
      limited: limit?.status === 'rejected' && !!reset && reset > Date.now(),
    })
    const noted = t.skipNoted
    // Before anything is sent: whatever happens next, this run is not repeated
    if (t.once) schedule.remove(t.id)
    else schedule.advance(t.id, reason && reason !== 'running' ? true : reason ? noted : false)
    try {
      if (reason === 'running') return log.info('schedule skipped: still running', { id: t.id })
      if (reason) {
        log.info('schedule skipped', { id: t.id, reason })
        if (noted) return
        const after = t.once
          ? tr('It was a one-time task, so it won\'t run again.', 'Задача была разовой, больше не запустится.')
          : `${tr('Next', 'Следующий запуск')}: ${whenTag(schedule.get(t.id)?.nextAt ?? Infinity, schedule.zone())}.`
        if (reason === 'offline') {
          const id = Math.random().toString(16).slice(2, 10).padEnd(8, '0')
          missed.set(id, { key: t.key, name: t.name, prompt: runPrompt(t) })
          const rows: RichButton[][] = [[{ text: tr('▶️ Run when it connects', '▶️ Запустить, когда подключится'), data: `sko:go:${id}` }, { text: tr('No need', 'Не нужно'), data: `sko:no:${id}` }]]
          const next = t.once ? null : whenTag(schedule.get(t.id)?.nextAt ?? Infinity, schedule.zone())
          await sendChoice(chatId, topicId, skippedOfflineMarkdown(masked(chatId, topicId, t.name), !!t.once, next), rows, new InlineKeyboard().text(rows[0][0].text, rows[0][0].data).text(rows[0][1].text, rows[0][1].data))
          return
        }
        await api.sendMessage(chatId, `⏰ <b>${esc(t.name)}</b>: ${tr('skipped', 'пропущено')}, ${skipText(reason)}. ${after} ${hashtag('schedule')}`, { ...where(topicId), ...HTML })
        return
      }
      const sent = await api.sendMessage(chatId, `⏰ <b>${esc(masked(chatId, topicId, t.name))}</b> ${hashtag('schedule')}`, { ...where(topicId), ...HTML })
      log.info('schedule run', { id: t.id, key: t.key, browser: !!t.browser })
      const noBrowser = t.browser && !browserFor(t.key)
      enqueue(chatId, topicId, runPrompt(t) + (noBrowser ? '\n\n[This task needs the user\'s Chrome, but no browser is linked to this computer: say so briefly in the report, and that /browser in this topic links one.]' : ''), { reply: false, msgId: sent.message_id, scheduleId: t.id })
    } catch (e) {
      const message = (e as Error).message
      log.warn('schedule run failed', { id: t.id, error: message })
      // Deleted in Telegram by hand: its schedule goes with it
      if (/thread not found|TOPIC_ID_INVALID|TOPIC_DELETED/i.test(message)) await topicGone(t.key)
    }
  }

  let ticking = false
  async function tick() {
    if (ticking) return
    ticking = true
    try {
      for (const t of schedule.due()) await fire(t)
    } finally {
      ticking = false
    }
  }
  let timer: NodeJS.Timeout | undefined

  return {
    start() {
      timer = setInterval(() => tick().catch(e => log.warn('schedule', (e as Error).message)), tickMs)
    },
    stop: () => clearInterval(timer),
    tick,

    // From Claude's tool: what it hears goes back to it, the buttons go to the user
    async propose(key: string, p: ScheduleProposal) {
      const { chatId, topicId } = parseKey(key)
      if ([p.cron, p.at, p.inMinutes].filter(v => v !== undefined).length !== 1) return 'Give exactly one of cron, at, inMinutes.'
      if (schedule.full()) return `The user already has ${MAX_TASKS} tasks on a schedule, the most allowed. Tell them to delete one in /schedule.`
      const named = p.timeZone ? parseTimeZone(p.timeZone) : null
      if (p.timeZone && !named) return `"${p.timeZone}" is not a time zone: use an IANA name such as Europe/Kyiv.`
      const zone = named ?? schedule.zone()
      const now = Date.now()
      let runs: number[]
      let moment: number | undefined
      if (p.cron !== undefined) {
        const cron = parseCron(p.cron)
        if (!cron) return `"${p.cron}" is not a cron expression this bot reads: five fields of numbers (minute hour day month weekday), with * , - / allowed. Fix it and call again.`
        if (oftenerThanHourly(cron)) return 'That runs more often than once an hour, and the bot doesn\'t allow it: the minute field must be one number. Tell the user, or fix it and call again.'
        const first = nextRun(cron, now, zone)
        if (first === null) return 'That date never comes. Fix the expression and call again.'
        const second = nextRun(cron, first, zone)
        runs = second === null ? [first] : [first, second]
      } else if (p.inMinutes !== undefined) {
        runs = []
      } else {
        moment = parseAt(p.at!, zone) ?? undefined
        if (moment === undefined) return `"${p.at}" is not a moment on the calendar in ${zone}: use YYYY-MM-DDTHH:MM. Fix it and call again.`
        if (moment <= now) return `${p.at} in ${zone} has already passed. If the date is unclear, ask the user; for anything relative use inMinutes.`
        runs = [moment]
      }
      const id = randomBytes(4).toString('hex')
      pending.set(id, { ...p, key, moment })
      const create = tr('✅ Create', '✅ Создать')
      const no = tr('❌ No', '❌ Не надо')
      const kb = new InlineKeyboard().text(create, `scy:${id}`).text(no, `scn:${id}`)
      const md = proposalMarkdown(p, zone, !!named || schedule.zoneChosen(), runs, modeOf(key))
      const choice = await keepLoud(() => sendChoice(chatId, topicId, md, [[{ text: create, data: `scy:${id}`, style: 'success' }, { text: no, data: `scn:${id}` }]], kb))
      const offer = pending.get(id)
      if (offer) offer.choice = choice
      offered?.(key, choice?.messageId)
      log.info('schedule proposed', { key, cron: p.cron, once: p.cron === undefined })
      return 'The confirmation with its buttons is already in the chat, just above your final reply. End your turn now with one short line (do not call them "below"). Nothing is scheduled until the user taps; do not do the task now unless they asked for that too.'
    },

    // The owner's next text after the time-zone button
    takesZone: (key: string) => zoneWaits.has(key),
    async setZone(chatId: number, topicId: number | undefined, text: string) {
      zoneWaits.delete(topicKey(chatId, topicId))
      const zone = parseTimeZone(text)
      if (!zone) return api.sendMessage(chatId, tr(`I don't know the time zone “${esc(trunc(text, 64))}”. Tap the button in /schedule and try <code>Europe/Kyiv</code> or <code>UTC+3</code>.`, `Не знаю часовой пояс «${esc(trunc(text, 64))}». Нажми кнопку в /schedule и попробуй <code>Europe/Kyiv</code> или <code>UTC+3</code>.`), { ...where(topicId), ...HTML })
      schedule.setZone(zone)
      log.info('schedule time zone', { zone })
      const v = view(chatId)
      return sendChoice(chatId, topicId, `🕐 **${tr('Time zone', 'Часовой пояс')}: ${mdText(zoneLabel(zone))}**\n\n${v.md}`, v.rows, v.kb)
    },
  }
}
