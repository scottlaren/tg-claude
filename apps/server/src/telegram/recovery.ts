import type { Api } from 'grammy'
import type { McpCallResult, OpTool, ToolResult } from '@tgcv/protocol'
import type { Gateway, OpOutcome } from '../gateway.ts'
import type { Log } from '../log.ts'
import { count, tr } from '../i18n.ts'
import type { Flight, FlightOp, FlightStore } from './flights.ts'

// A restart kills Claude's process, not what it started on the computers. The next run of the server finds out how
// those ended, without running anything again, and hands Claude the results in the same session. Tested with a process
// killed mid-tool, SIGKILL and SIGTERM alike: the session resumes, and the CLI itself answers the open tool call with
// «interrupted, outcome unknown», so the API never sees a tool_use without a result

// More than this and something is wrong with the task or the server, and it is the user's to decide
export const MAX_CONTINUATIONS = 3
// The agents reconnect within 30 s of a server coming back; past this the computer is really off
const DEVICE_WAIT_MS = 5 * 60_000
// run_command has 30 minutes at most, an app's MCP call its own limit, 10 minutes unless the computer says otherwise
const OP_WAIT_MS = 60 * 60_000
// Down for longer than this, and what the task was about has passed
const MAX_AGE_MS = 12 * 3600_000
const FIRST_NOTE_MS = 2000
const OP_CHARS = 8000
const ALL_OPS_CHARS = 24_000
const ASKED_CHARS = 1500

// The start and the end: errors usually live at the end
function clip(s: string, max: number) {
  if (s.length <= max) return s
  const head = Math.floor(max / 4)
  return `${s.slice(0, head)}\n…[${s.length - max} characters cut]…\n${s.slice(s.length - (max - head))}`
}

const secs = (ms: number) => `${Math.round(ms / 1000)} s`

// A result as Claude would read it, within its share of the prompt
export function describeOutcome(tool: string, out: OpOutcome, max = OP_CHARS): string {
  if (!out.ok) return `${out.error.code}: ${out.error.message}`
  if (tool === 'run_command') {
    const r = out.result as ToolResult['run_command']
    const end = r.timedOut ? 'hit its time limit and was killed' : r.cancelled ? 'was cancelled' : r.signal ? `was killed by ${r.signal}` : `finished, exit code ${r.exitCode}`
    const streams = ([['stdout', r.stdout], ['stderr', r.stderr]] as const).filter(([, s]) => s)
    return [`${end}, ${secs(r.durationMs)}`, ...streams.map(([name, s]) => `${name}:\n${clip(s, Math.floor(max / streams.length))}`)].join('\n')
  }
  if (tool === 'mcp_call') {
    const r = out.result as McpCallResult
    const parts = (r.content ?? []) as { type?: string, text?: string }[]
    const texts = parts.filter(p => p.type === 'text' && p.text).map(p => p.text!)
    const other = parts.length - texts.length
    return [`${r.isError ? 'ended with an error' : 'finished'}${other ? `, ${other} parts that are not text left out` : ''}`, ...(texts.length ? [clip(texts.join('\n'), max)] : [])].join('\n')
  }
  return `finished: ${clip(JSON.stringify(out.result) ?? '', max)}`
}

// out: null when the computer never came back to say
export type OpReport = { op: FlightOp, out: OpOutcome | null }

const quoted = (s: string) => s.split('\n').map(l => `> ${l}`).join('\n')

export function continuationPrompt(f: Pick<Flight, 'prompt'>, reports: OpReport[], absent: string[], name: (deviceId: string) => string = id => id) {
  const share = reports.length ? Math.min(OP_CHARS, Math.floor(ALL_OPS_CHARS / reports.length)) : OP_CHARS
  // What a command printed comes as quoted lines: this is a message of the bot's, not a tool result, and a line in the
  // output must not read like one of its own
  const lines = reports.map(({ op, out }) => {
    const where = name(op.deviceId)
    if (!out) return `- ${op.step} on ${where}: unknown, the computer did not come back to say`
    const [end, ...printed] = describeOutcome(op.tool, out, share).split('\n')
    return [`- ${op.step} on ${where}: ${end}`, ...(printed.length ? [quoted(printed.join('\n'))] : [])].join('\n')
  })
  return [
    '[The server was restarted while you were working, so your turn was cut off mid-way. This comes from the bot, not from the user: the conversation goes on by itself.]',
    f.prompt && `The message you were answering:\n${quoted(clip(f.prompt, ASKED_CHARS))}`,
    lines.length && `Commands that were running when the server went down. Nothing was run again, and a call that shows as interrupted may well have finished:\n${lines.join('\n')}`,
    absent.length && `${absent.map(name).join(', ')} did not come back online in time. Say so if it stands in the way.`,
    'Check what has already happened before repeating a step, then continue the task from where you stopped and answer as usual.',
  ].filter(Boolean).join('\n\n')
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const HTML = { parse_mode: 'HTML' } as const
const GONE = /thread not found|topic_deleted|topic_closed|chat not found|bot was kicked|bot is not a member|bot was blocked/i

export function createRecovery({ store, gateway, api, log, parseKey, live, session, deviceName, unmark, idle = () => {}, shown, continueWith, schedule, report, deviceWaitMs = DEVICE_WAIT_MS, opWaitMs = OP_WAIT_MS, noteMs = FIRST_NOTE_MS, now = Date.now }: {
  store: FlightStore
  gateway: Pick<Gateway, 'device' | 'events' | 'askOp'>
  api: Api
  log: Log
  parseKey: (key: string) => { chatId: number, topicId?: number }
  // What marks a topic as taken: messages that arrive wait, and /stop reaches the wait
  live: (key: string) => { busy: boolean, abort: AbortController | null, queue: unknown[] }
  session: { get: (key: string) => string | null | undefined, set: (key: string, id: string) => void }
  deviceName: (id: string) => string
  unmark: (chatId: number, ids: number[]) => void
  // A card waiting at the restart is gone, and the icon that said so must go with it
  idle?: (key: string) => void
  // Text on its way to Telegram, secrets masked
  shown: (key: string, text: string) => string
  continueWith: (f: Flight, text: string) => void
  schedule: (key: string) => void
  report: (key: string, note: string) => void
  deviceWaitMs?: number
  opWaitMs?: number
  noteMs?: number
  now?: () => number
}) {
  // One message that says where the topic stands; edits follow each other, never overtake
  function statusNote(key: string, f: Flight) {
    const { chatId, topicId } = parseKey(key)
    const extra = { ...(topicId && { message_thread_id: topicId }), ...HTML }
    const reply = f.replyTo ? { reply_parameters: { message_id: f.replyTo, allow_sending_without_reply: true } } : {}
    let id: number | undefined
    let last = ''
    let gone = false
    let chain: Promise<unknown> = Promise.resolve()
    const show = (html: string) => {
      if (html === last) return chain
      last = html
      chain = chain.then(async () => {
        if (id === undefined) {
          id = (await api.sendMessage(chatId, html, { ...extra, ...reply }).catch(e => {
            gone ||= GONE.test((e as Error).message)
            return null
          }))?.message_id
        } else await api.editMessageText(chatId, id, html, HTML).catch(() => {})
      })
      return chain
    }
    return { show, gone: () => gone }
  }

  // Resolves when the computer is here, or with false once it has been waited for long enough
  function arrives(deviceId: string, signal: AbortSignal) {
    if (gateway.device(deviceId)) return Promise.resolve(true)
    return new Promise<boolean>(resolve => {
      const done = (here: boolean) => {
        clearTimeout(timer)
        gateway.events.off('online', onOnline)
        signal.removeEventListener('abort', onAbort)
        resolve(here)
      }
      const onOnline = (d: { id: string }) => {
        if (d.id === deviceId) done(true)
      }
      const onAbort = () => done(false)
      const timer = setTimeout(() => done(false), deviceWaitMs)
      gateway.events.on('online', onOnline)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  // Every computer here or given up on, every open operation ended or given up on
  async function settle(f: Flight, signal: AbortSignal, refresh: (absent: string[], open: FlightOp[]) => void) {
    const devices = [...new Set([...f.ops.map(o => o.deviceId), ...(f.deviceId ? [f.deviceId] : [])])]
    const absent: string[] = []
    const open = new Set(f.ops)
    const says = () => refresh(absent, [...open])
    const here = new Map(devices.map(id => [id, arrives(id, signal).then(ok => {
      if (!ok && !signal.aborted) absent.push(id)
      says()
      return ok
    })]))
    const reports = await Promise.all(f.ops.map(async op => {
      // Asked at once even if it is away: a /stop meanwhile then reaches it when it comes back
      const asked = gateway.askOp(op.deviceId, op.opId, op.tool as OpTool, { signal, limitMs: opWaitMs })
      const out = await Promise.race([asked, here.get(op.deviceId)!.then(ok => (ok ? asked : null))])
      open.delete(op)
      says()
      return { op, out }
    }))
    await Promise.all(here.values())
    return { reports, absent }
  }

  async function one(f: Flight) {
    const { key } = f
    const { chatId } = parseKey(key)
    for (const id of f.bubbles) api.deleteMessage(chatId, id).catch(() => {})
    unmark(chatId, f.msgIds)
    idle(key)
    // Topics are written a moment after they change: a crash can lose what this says
    if (f.sessionId && session.get(key) !== f.sessionId) session.set(key, f.sessionId)
    const note = statusNote(key, f)
    const head = tr('🔄 <b>The server restarted during this task.</b>', '🔄 <b>Сервер перезапустился во время этой задачи.</b>')

    const tooOld = now() - f.at > MAX_AGE_MS
    if (tooOld || f.continuations >= MAX_CONTINUATIONS) {
      log.warn('turn not continued', { key, continuations: f.continuations, tooOld })
      store.end(key)
      await note.show(tooOld
        ? tr('🔄 <b>The server was down for a long time and this task was cut off.</b> It is not continuing by itself: write anything to pick it up.', '🔄 <b>Сервер долго не работал, и эта задача оборвалась.</b> Сама она не продолжится: напиши что-нибудь, чтобы взяться за неё снова.')
        : tr('🔄 <b>The server keeps restarting during this task,</b> so it is not continuing by itself again. Write anything to pick it up.', '🔄 <b>Сервер снова перезапустился во время этой задачи,</b> и сама она больше не продолжится. Напиши что-нибудь, чтобы взяться за неё снова.'))
      return report(key, tr('🔄 cut off by server restarts', '🔄 оборвана перезапусками сервера'))
    }

    log.info('turn recovering', { key, ops: f.ops.length, continuation: f.continuations + 1 })
    // Told how it ended by the previous run, which went down before the turn began
    if (f.next) {
      await note.show(`${head}\n${tr('Continuing it.', 'Продолжаю её.')}`)
      if (note.gone()) {
        log.info('turn not continued: its topic is gone', { key })
        return store.end(key)
      }
      return continueWith(f, f.next)
    }
    const l = live(key)
    // As it stood: /new also clears it in the record, which is this very object
    const { sessionId } = f
    const abort = new AbortController()
    l.busy = true
    l.abort = abort
    // Held to the last moment: telling the topic can take half a minute in a busy group, and a message or a /stop in that
    // time must find it still taken, or the message starts a turn of its own ahead of this one
    const free = () => {
      l.busy = false
      l.abort = null
    }
    // Answers come in a moment when the computer is right here: no message to edit for that
    let noting = false
    let latest: () => void = () => {}
    const refresh = (absent: string[], open: FlightOp[]) => {
      latest = () => {
        const away = [...new Set([...open.map(o => o.deviceId), ...(f.deviceId ? [f.deviceId] : [])])].filter(id => !gateway.device(id) && !absent.includes(id))
        if (away.length) {
          const names = away.map(id => `<b>${esc(deviceName(id))}</b>`).join(', ')
          note.show(`${head}\n${tr(`Waiting for ${names} to connect, then it continues by itself. /stop drops it.`, `Жду, пока подключится ${names}, потом она продолжится сама. /stop — отменить.`)}`)
        } else if (open.length) {
          // Not the command itself: it means nothing here, and /status shows what runs
          const where = [...new Set(open.map(o => deviceName(o.deviceId)))].map(n => `<b>${esc(n)}</b>`).join(', ')
          const running = count(open.length, ['command', 'commands'], ['команда', 'команды', 'команд'])
          note.show(`${head}\n${tr(`Still running on ${where}: ${running}. It won't run twice: the task continues by itself once it finishes. /stop cancels it.`, `На ${where} ещё идёт: ${running}. Второй раз не запустится: задача продолжится сама, когда закончится. /stop — отменить.`)}`)
        }
      }
      if (noting) latest()
    }
    const firstNote = setTimeout(() => {
      noting = true
      latest()
    }, noteMs)
    refresh([], f.ops)
    // A /stop or /new while it waited: the user has decided
    const decided = () => abort.signal.aborted || (!!sessionId && session.get(key) !== sessionId)
    const dropped = async () => {
      log.info('turn not continued: the user stopped it', { key })
      store.end(key)
      await note.show(`${head}\n${tr('⏹ Stopped: it does not continue.', '⏹ Остановлено: дальше она не пойдёт.')}`)
      report(key, tr('⏹ Stopped', '⏹ Остановлено'))
      free()
      if (l.queue.length) schedule(key)
    }
    const topicGone = () => {
      log.info('turn not continued: its topic is gone', { key })
      store.end(key)
    }
    try {
      const { reports, absent } = await settle(f, abort.signal, refresh)
      clearTimeout(firstNote)
      if (decided()) return await dropped()
      if (note.gone()) return topicGone()
      await note.show(absent.length
        ? `${head}\n${tr(`<b>${esc(absent.map(deviceName).join(', '))}</b> did not come back in time: going on without it.`, `<b>${esc(absent.map(deviceName).join(', '))}</b> не вернулся вовремя, продолжаю без него.`)}`
        : `${head}\n${tr('Continuing it.', 'Продолжаю её.')}`)
      if (decided()) return await dropped()
      if (note.gone()) return topicGone()
      // The next turn writes its own record over this one, with the count on it. Until then this is all that says the task
      // goes on: it may wait for a free slot, and a crash meanwhile must not lose it
      const next = continuationPrompt(f, reports, absent, deviceName)
      store.settled(key, next)
      free()
      continueWith(f, next)
    } finally {
      clearTimeout(firstNote)
      free()
    }
  }

  return {
    // Once, when the server starts. Doesn't wait for the rest of the start, and a command that takes an hour doesn't hold
    // up the other topics
    async run() {
      const saved = store.load()
      if (saved.length) log.info('turns cut off by a restart', { turns: saved.map(f => f.key) })
      await Promise.all(saved.map(f => one(f).catch(e => {
        log.warn('turn recovery failed', { key: f.key, error: (e as Error).message })
        store.end(f.key)
      })))
    },
  }
}
