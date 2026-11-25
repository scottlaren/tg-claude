import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  PROTOCOL_VERSION, CLOUD_DEVICE_ID, DEVICE_OPS, DeviceMessage, decode, pipeStream,
  type Hello, type ServerMessage, type Pair, type OpEvent, type OpError, type OpTool, type Project, type McpServerInfo, type TunnelOpen, type Pipe,
} from '@tgcv/protocol'
import type { Socket } from 'node:net'
import { dialOut } from './egress.ts'
import type { Log } from './log.ts'
import type { DeviceRegistry, Pairing } from './devices.ts'
import { tr } from './i18n.ts'

const HEARTBEAT_MS = 15_000
// A laptop asleep on battery wakes every few seconds, and now and then sleeps a second longer than one interval: it
// was cut off 266 times in a day for that. One ping without an answer is not a dead link, two in a row are: a dead
// device is noticed within three intervals (§8.2: ≤ 60 s)
const MISSED_PINGS = 2
// One beat for one computer: ping it again, or give it up
export function heartbeatStep(c: { alive: boolean, missed: number }): 'ping' | 'drop' {
  if (c.alive) c.missed = 0
  else if (++c.missed >= MISSED_PINGS) return 'drop'
  c.alive = false
  return 'ping'
}
// Long enough for a hello on a link busy with everything that starts with Windows: at 10 s a computer just switched on
// was cut off over and over, and each time the cut came as it was announced online
const HELLO_TIMEOUT_MS = 60_000
// The device refuses a request older than DEADLINE, but by its own clock, and its «accepted» can sit behind
// browser-tunnel data on the same link: no confirmation by ACCEPT_TIMEOUT means the outcome is unknown
const DEADLINE_MS = 15_000
const ACCEPT_TIMEOUT_MS = 20_000
const CANCEL_WAIT_MS = 5_000
// A lost link doesn't stop a command on the computer: Claude's call waits this long for the computer to come back
// and say how it went. Past it, or for a command with a longer limit of its own past that, the outcome is unknown
const LINK_GRACE_MS = 10 * 60_000
const COMMAND_SLACK_MS = 30_000
const REFUSAL_LOG_MS = 60_000

// What the bot asks by itself is answered in a moment and someone is looking at it: a lost link fails those at once
const outlivesLink = (tool: OpTool) => tool !== 'project_context' && !(DEVICE_OPS as readonly string[]).includes(tool)

export type Device = {
  id: string
  name: string
  os: Hello['os']
  shell: string
  projects: Project[]
  // App MCP servers running on the device, refreshed by mcp.update
  mcp: McpServerInfo[]
  apps: { id: string, name: string, mcp?: string }[]
  connectedAt: number
  version?: string
  // Its release; absent on agents too old to update themselves
  release?: string
  // Its /lock is on: it refuses every operation until someone at the computer takes it off
  locked?: boolean
  // Kept from sleeping while a task runs; absent where there is no such switch
  keepAwake?: boolean
  // It can see and drive its screen for Claude
  screen?: boolean
  shared: string[]
  // What it has to work with, and how busy it is: where heavy work goes is chosen by these. idleSec: for how long
  // nobody has touched it; absent when not known
  cores?: number
  memGb?: number
  load?: { busy: number, idleSec?: number, at: number }
}

export type OpOutcome = { ok: true, result: unknown } | { ok: false, error: OpError }

export type OpSpec = {
  projectId: string
  bindingVersion: number
  tool: OpTool
  params: Record<string, unknown>
  sessionId?: string
}

// lost: why the server itself ended the link, for the log
type Conn = Device & { ws: WebSocket, alive: boolean, missed: number, lost?: string }
type Pending = {
  deviceId: string, tool: OpTool, projectId: string, sentAt: number, accepted: boolean, cancelling?: boolean, timer?: NodeJS.Timeout, resolve: (o: OpOutcome) => void,
  // run_command's own time limit
  ownMs: number
  // Asked again on a new link: «expired» then means the computer has no record of it, not that it came too late
  asked?: boolean
  // An operation of an earlier run of the server: bound by this alone, whatever happens to the link
  limit?: NodeJS.Timeout
}

export type PairedDevice = { id: string, name: string, os: Hello['os'], chatId: number, topicId?: number }

// The browser tunnel: connections a computer's local proxy hands over, made from here (egress.ts decides where to)
export type TunnelOptions = { enabled?: boolean, dial?: (host: string, port: number) => Promise<Socket>, maxStreams?: number }

// Resolves true once the computer is here, false when it stayed away that long or the task was stopped
export function whenOnline(gateway: Pick<Gateway, 'device' | 'events'>, id: string, ms: number, signal?: AbortSignal) {
  if (gateway.device(id)) return Promise.resolve(true)
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise<boolean>(resolve => {
    const end = (back: boolean) => {
      clearTimeout(timer)
      gateway.events.off('online', arrived)
      signal?.removeEventListener('abort', stopped)
      resolve(back)
    }
    const arrived = (d: Device) => { if (d.id === id) end(true) }
    const stopped = () => end(false)
    const timer = setTimeout(() => end(false), ms)
    gateway.events.on('online', arrived)
    signal?.addEventListener('abort', stopped, { once: true })
  })
}

export function createGateway({ port, host, registry, pairing, log, cancelWaitMs = CANCEL_WAIT_MS, acceptTimeoutMs = ACCEPT_TIMEOUT_MS, helloTimeoutMs = HELLO_TIMEOUT_MS, linkGraceMs = LINK_GRACE_MS, tunnel = {}, release, http }: {
  port: number, host: string, registry: DeviceRegistry, pairing: Pairing, log: Log, cancelWaitMs?: number, acceptTimeoutMs?: number, helloTimeoutMs?: number, linkGraceMs?: number, tunnel?: TunnelOptions,
  // The server's release: told to a computer it turns away, which may then catch up by itself
  release?: string,
  // Plain downloads on the same port (install.ts): true when the request was one of them
  http?: (req: IncomingMessage, res: ServerResponse) => boolean,
}) {
  const { enabled: tunnelOn = true, dial = (h: string, p: number) => dialOut(h, p), maxStreams = 128 } = tunnel
  // Live tunnelled connections of all devices, and how many were made since the start: /diag shows both
  let tunnelsOpen = 0
  let tunnelsTotal = 0
  // One port for the computers' link and the few downloads that come before it (the installer, the agent)
  const server = createServer((req, res) => {
    // Open to the whole internet: whatever goes wrong with one request must not take the server down with it
    try {
      if (http?.(req, res)) return
    } catch (e) {
      log.warn('http request failed', (e as Error).message)
      if (!res.headersSent) res.writeHead(500)
      res.end()
      return
    }
    res.writeHead(404).end()
  })
  server.on('error', e => log.error('gateway', (e as Error).message))
  const wss = new WebSocketServer({ server, path: '/device', maxPayload: 8 * 1024 * 1024 })
  server.listen(port, host)
  const devices = new Map<string, Conn>()
  const pending = new Map<string, Pending>()
  // A Stop the computer couldn't hear because the link was down: it goes out when the computer is back
  const owedCancels = new Map<string, Set<string>>()
  const events = new EventEmitter<{ online: [Device], offline: [string], paired: [PairedDevice] }>()
  // Every tool call of every topic waiting for a computer listens here for a moment
  events.setMaxListeners(0)

  const send = (ws: WebSocket, m: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
  }

  const protocolMismatch = (v: number) =>
    v !== PROTOCOL_VERSION ? `Protocol v${v}, the server expects v${PROTOCOL_VERSION}: update the app` : null

  // The port is open to the whole internet, and the log is kept for days with no limit on its size: a refusal is worth a
  // line, a stream of them isn't worth a full disk
  let refusalLogged = 0
  let refusalsSince = 0
  const refused = (what: string, details: object) => {
    if (Date.now() - refusalLogged < REFUSAL_LOG_MS) return void refusalsSince++
    log.warn(what, { ...details, ...(refusalsSince && { alsoRefused: refusalsSince }) })
    refusalLogged = Date.now()
    refusalsSince = 0
  }

  // Reasons a computer is turned away go to the computer, which prints them: English, whatever the bot speaks
  function checkHello(h: Hello) {
    const mismatch = protocolMismatch(h.protocol)
    if (mismatch) return mismatch
    if (!registry.verify(h.deviceId, h.key)) return `Computer ${h.deviceId} is not connected to the bot or was disconnected from it: connect it again with /pair`
    return null
  }

  // One attempt per connection: answer, then close; the device reconnects with hello.
  // No IP addresses are read or kept anywhere: a server taken over must not learn where the computers are
  function onPair(ws: WebSocket, m: Pair) {
    const mismatch = protocolMismatch(m.protocol)
    const grant = mismatch ? null : pairing.consume(m.code)
    if (mismatch || !grant || grant === 'locked') {
      const reason = mismatch ?? (grant === 'locked' ? 'Too many wrong codes: try again in 10 minutes' : 'The code is wrong or expired: get a new one with /pair')
      refused('pairing refused', { name: m.deviceName, reason })
      send(ws, { type: 'reject', reason })
      return ws.close()
    }
    const { id, key } = registry.register(m.deviceName, m.os)
    send(ws, { type: 'paired', deviceId: id, key, deviceName: m.deviceName })
    log.info('device paired', { id, name: m.deviceName, os: m.os })
    events.emit('paired', { id, name: m.deviceName, os: m.os, ...grant })
    ws.close()
  }

  // Where a site is, is never written down: only whether the connection was made
  // A connection still being opened holds its slot and its number: a burst can't get past the limit
  async function openTunnel(c: Conn, streams: Map<number, Pipe>, opening: Set<number>, m: TunnelOpen) {
    const reply = (ok: boolean, error?: string) => send(c.ws, { type: 'tunnel.opened', sid: m.sid, ok, ...(error && { error: error.slice(0, 300) }) })
    if (!tunnelOn) return reply(false, 'the browser tunnel is disabled on the server')
    if (streams.has(m.sid) || opening.has(m.sid)) return reply(false, 'connection number already in use')
    if (streams.size + opening.size >= maxStreams) return reply(false, 'too many connections at once')
    opening.add(m.sid)
    let socket: Socket
    try {
      socket = await dial(m.host, m.port)
    } catch (e) {
      return reply(false, (e as Error).message)
    } finally {
      opening.delete(m.sid)
    }
    if (c.ws.readyState !== WebSocket.OPEN) return socket.destroy()
    tunnelsOpen++
    tunnelsTotal++
    streams.set(m.sid, pipeStream(m.sid, socket, f => send(c.ws, f), () => {
      streams.delete(m.sid)
      tunnelsOpen--
    }))
    reply(true)
  }

  function finish(opId: string, outcome: OpOutcome) {
    const p = pending.get(opId)
    if (!p) return
    clearTimeout(p.timer)
    clearTimeout(p.limit)
    pending.delete(opId)
    p.resolve(outcome)
  }

  const unknown = (message: string): OpOutcome => ({ ok: false, error: { code: 'unknown', message } })

  function onEvent(deviceId: string, ev: OpEvent) {
    const p = pending.get(ev.opId)
    if (!p || p.deviceId !== deviceId) return
    if (ev.state === 'accepted') {
      p.accepted = true
      // Keep a cancel-wait timer running; only the accept timeout is done
      if (!p.cancelling) clearTimeout(p.timer)
    } else if (ev.state === 'done') finish(ev.opId, { ok: true, result: ev.result })
    else if (ev.state === 'error') {
      if (p.asked && ev.error?.code === 'expired') {
        return finish(ev.opId, unknown(tr(
          'The computer has no record of this operation: it restarted, or never got it. Unknown whether it ran — check before retrying',
          'На компьютере нет записи об этой операции: он перезапускался или не получил её. Неизвестно, выполнилась ли она — проверь, прежде чем повторять')))
      }
      finish(ev.opId, { ok: false, error: ev.error ?? { code: 'failed', message: tr('Error with no description', 'Ошибка без описания') } })
    }
  }

  // The agent keeps every operation by its id and replays what happened when the same id comes again, and it refuses
  // anything new past its deadline. So a request for the same id with a deadline long gone is a question: how did this
  // end? It can never run a command, and every agent ever installed answers it, so no capability is needed
  function askAgain(opId: string, p: Pending, ws: WebSocket) {
    p.asked = true
    clearTimeout(p.timer)
    p.timer = setTimeout(() => finish(opId, unknown(tr(
      'The computer did not say how the operation ended: unknown whether it ran — check before retrying',
      'Компьютер не сказал, чем закончилась операция: неизвестно, выполнилась ли она — проверь, прежде чем повторять'))), acceptTimeoutMs)
    send(ws, { type: 'op.request', opId, projectId: p.projectId, bindingVersion: 0, tool: p.tool, params: {}, deadline: 0 })
  }

  // Stop = ask the device to cancel and report what really happened (§14): the operation
  // may have finished anyway, been cut short, or not answered at all
  function cancelOnAbort(opId: string, p: Pending, signal?: AbortSignal) {
    signal?.addEventListener('abort', () => {
      const c = devices.get(p.deviceId)
      if (c) send(c.ws, { type: 'op.cancel', opId })
      else owedCancels.set(p.deviceId, (owedCancels.get(p.deviceId) ?? new Set()).add(opId))
      p.cancelling = true
      clearTimeout(p.timer)
      p.timer = setTimeout(() => finish(opId, unknown(tr('Cancel sent, but the computer did not confirm how the operation ended', 'Отмена отправлена, но компьютер не подтвердил итог операции'))), cancelWaitMs)
    }, { once: true })
  }

  // The computer is back: what it couldn't hear goes out first, then it is asked about everything still open
  function catchUp(c: Conn) {
    for (const opId of owedCancels.get(c.id) ?? []) send(c.ws, { type: 'op.cancel', opId })
    owedCancels.delete(c.id)
    for (const [opId, p] of pending) if (p.deviceId === c.id && !p.cancelling) askAgain(opId, p, c.ws)
  }

  function linkLost(deviceId: string) {
    for (const [opId, p] of pending) {
      if (p.deviceId !== deviceId) continue
      if (p.limit) {
        clearTimeout(p.timer)
        continue
      }
      if (p.cancelling) owedCancels.set(deviceId, (owedCancels.get(deviceId) ?? new Set()).add(opId))
      // Sent is sent: the computer may have got it and done it before its «accepted» was lost with the link.
      // Only a request that never left the server is «not done» (request() answers that itself)
      const lost = () => finish(opId, unknown(p.accepted
        ? tr('The link to the computer dropped during the operation: the outcome is unknown — check before retrying',
          'Связь с компьютером оборвалась во время операции: результат неизвестен — проверь, прежде чем повторять')
        : tr('The link to the computer dropped right after sending: unknown whether it ran the operation — check before retrying',
          'Связь с компьютером оборвалась сразу после отправки: неизвестно, успел ли он выполнить операцию — проверь, прежде чем повторять')))
      if (p.cancelling || !outlivesLink(p.tool)) {
        lost()
        continue
      }
      clearTimeout(p.timer)
      p.timer = setTimeout(lost, Math.max(linkGraceMs, p.ownMs && p.sentAt + p.ownMs + COMMAND_SLACK_MS - Date.now()))
    }
  }

  const sizeOf = (raw: WebSocket.RawData) => (Array.isArray(raw) ? raw.reduce((n, b) => n + b.length, 0) : raw.byteLength)

  wss.on('connection', (ws, req) => {
    let conn: Conn | null = null
    const streams = new Map<number, Pipe>()
    const opening = new Set<number>()
    const helloTimer = setTimeout(() => ws.close(), helloTimeoutMs)

    // A frame over the size limit or a broken socket ends this connection only, never the server (an error
    // with no listener would bring the whole process down, and it can come before hello)
    ws.on('error', e => {
      log.warn('device socket', { id: conn?.id, error: e.message })
      ws.terminate()
    })

    ws.on('message', raw => {
      const m = decode(DeviceMessage, raw)
      if (!m) return
      if (!conn) {
        // A hello that comes in as the socket is closing is too late: taken, it put a computer online for an instant
        // and started its put-off tasks on a link already gone
        if (ws.readyState !== WebSocket.OPEN) return
        clearTimeout(helloTimer)
        if (m.type === 'pair') return onPair(ws, m)
        if (m.type !== 'hello') return ws.close()
        const reason = checkHello(m)
        if (reason) {
          refused('device rejected', { id: m.deviceId, reason })
          send(ws, { type: 'reject', reason, ...(release && { serverRelease: release }) })
          return ws.close()
        }
        // A fresh connection from the same device replaces the old one; its in-flight
        // operations keep running and report over the new socket
        devices.get(m.deviceId)?.ws.terminate()
        conn = {
          id: m.deviceId, name: registry.nameOf(m.deviceId) ?? m.deviceName, os: m.os, shell: m.shell, projects: m.projects, mcp: m.mcp, apps: m.apps,
          connectedAt: Date.now(), version: m.version, release: m.release, locked: m.locked, keepAwake: m.keepAwake, screen: m.screen, shared: m.shared, cores: m.cores, memGb: m.memGb, ws, alive: true, missed: 0,
        }
        // The cloud goes by its name in the bot's language, whatever its agent calls itself
        if (conn.id === CLOUD_DEVICE_ID) Object.defineProperty(conn, 'name', { get: () => tr('Cloud', 'Облако'), enumerable: true })
        devices.set(conn.id, conn)
        registry.touch(conn.id, { name: conn.name, os: conn.os, lastSeen: Date.now() })
        send(ws, { type: 'welcome', protocol: PROTOCOL_VERSION })
        log.info('device online', { id: conn.id, os: conn.os, hello: sizeOf(raw), projects: conn.projects.map(p => p.id) })
        // Before anyone hears it is online: what they send then is new, not something to ask about
        catchUp(conn)
        events.emit('online', conn)
        return
      }
      if (m.type === 'op.event') onEvent(conn.id, m)
      else if (m.type === 'tunnel.open') openTunnel(conn, streams, opening, m)
      else if (m.type === 'tunnel.data' || m.type === 'tunnel.ack' || m.type === 'tunnel.close') streams.get(m.sid)?.frame(m)
      else if (m.type === 'load') conn.load = { busy: m.busy, idleSec: m.idleSec, at: Date.now() }
      else if (m.type === 'mcp.update') {
        conn.mcp = m.servers
        log.info('device mcp', { id: conn.id, servers: m.servers.map(s => `${s.name}:${s.status}${s.status === 'connected' ? '/' + s.tools.length : ''}`) })
      }
    })

    ws.on('pong', () => {
      if (conn) conn.alive = true
    })

    ws.on('close', code => {
      clearTimeout(helloTimer)
      // Tunnelled connections live only as long as the link they came through
      for (const p of streams.values()) p.drop()
      streams.clear()
      if (!conn || devices.get(conn.id)?.ws !== ws) return
      devices.delete(conn.id)
      // What was in flight goes on over there: never resent blindly (§14), the computer is asked when it is back
      linkLost(conn.id)
      registry.touch(conn.id, { lastSeen: Date.now() })
      // Who ended it and after how long: a computer that drops many times a day is told apart from one that sleeps
      log.info('device offline', { id: conn.id, why: conn.lost ?? `closed from its side (${code})`, upSec: Math.round((Date.now() - conn.connectedAt) / 1000) })
      events.emit('offline', conn.id)
    })
  })

  const heartbeat = setInterval(() => {
    for (const c of devices.values()) {
      if (heartbeatStep(c) === 'drop') {
        c.lost = `no answer to ${MISSED_PINGS} pings, ${MISSED_PINGS * HEARTBEAT_MS / 1000} s`
        c.ws.terminate()
        continue
      }
      c.ws.ping()
    }
  }, HEARTBEAT_MS)

  // opId: the caller's, when it has to remember the operation across a restart of this server
  function request(deviceId: string, op: OpSpec, signal?: AbortSignal, opId: string = randomUUID()): Promise<OpOutcome> {
    const conn = devices.get(deviceId)
    if (!conn) return Promise.resolve({ ok: false, error: { code: 'offline', message: tr(`Computer ${deviceId} is offline`, `Компьютер ${deviceId} не в сети`) } })
    if (signal?.aborted) return Promise.resolve({ ok: false, error: { code: 'cancelled', message: tr('Stopped', 'Остановлено') } })
    return new Promise(resolve => {
      const timer = setTimeout(() => finish(opId, unknown(tr(
        'The computer did not confirm it got the request: unknown whether it ran the operation — check before retrying',
        'Компьютер не подтвердил получение: неизвестно, выполнил ли он операцию — проверь, прежде чем повторять'))), acceptTimeoutMs)
      const ownMs = op.tool === 'run_command' ? Number(op.params.timeoutSec ?? 0) * 1000 : 0
      const p: Pending = { deviceId, tool: op.tool, projectId: op.projectId, sentAt: Date.now(), ownMs, accepted: false, timer, resolve }
      pending.set(opId, p)
      cancelOnAbort(opId, p, signal)
      send(conn.ws, { type: 'op.request', opId, ...op, deadline: Date.now() + DEADLINE_MS })
    })
  }

  // An operation an earlier run of this server sent, before it restarted: the computer says how it ended, or finishes
  // it and says so then. Waits for the computer if it isn't here yet
  function askOp(deviceId: string, opId: string, tool: OpTool, { signal, limitMs }: { signal?: AbortSignal, limitMs: number }): Promise<OpOutcome> {
    return new Promise(resolve => {
      const p: Pending = { deviceId, tool, projectId: '', sentAt: Date.now(), ownMs: 0, accepted: false, asked: true, resolve }
      p.limit = setTimeout(() => finish(opId, unknown(tr('No result from the computer in the time it was waited for', 'Компьютер не дал результата за время ожидания'))), limitMs)
      pending.set(opId, p)
      cancelOnAbort(opId, p, signal)
      const c = devices.get(deviceId)
      if (c) askAgain(opId, p, c.ws)
    })
  }

  return {
    events,
    request,
    askOp,
    // The device's project list changes while it runs (new folders in the workspace, granted folders)
    async refreshProjects(deviceId: string): Promise<Project[]> {
      const out = await request(deviceId, { projectId: '', bindingVersion: 0, tool: 'list_projects', params: {} })
      const c = devices.get(deviceId)
      if (out.ok && c) c.projects = out.result as Project[]
      return c?.projects ?? []
    },
    updateProject(deviceId: string, project: Project) {
      const c = devices.get(deviceId)
      if (c) c.projects = c.projects.map(p => (p.id === project.id ? project : p))
    },
    ready: new Promise<number>(r => server.once('listening', () => r((server.address() as { port: number }).port))),
    device: (id: string): Device | undefined => devices.get(id),
    // Its key stops working at once; if it is online, it is cut off (§8.2, acceptance 19)
    rename(id: string, name: string) {
      if (id === CLOUD_DEVICE_ID || !registry.rename(id, name)) return false
      const c = devices.get(id)
      if (c) c.name = name
      log.info('device renamed', { id, name })
      return true
    },
    revoke(id: string) {
      const ok = registry.revoke(id)
      const c = devices.get(id)
      // It won't be back: nothing waits for it
      if (ok) for (const [opId, p] of pending) if (p.deviceId === id) finish(opId, unknown(tr('The computer was disconnected from the bot', 'Компьютер отключён от бота')))
      if (ok && c) {
        send(c.ws, { type: 'reject', reason: 'This computer was disconnected from the bot: connect it again with /pair' })
        c.ws.close()
      }
      if (ok) log.info('device revoked', { id })
      return ok
    },
    devices: (): Device[] => [...devices.values()],
    tunnels: () => ({ open: tunnelsOpen, total: tunnelsTotal }),
    close() {
      clearInterval(heartbeat)
      for (const opId of [...pending.keys()]) finish(opId, unknown(tr('The server is shutting down', 'Сервер останавливается')))
      for (const c of devices.values()) c.ws.terminate()
      wss.close()
      server.close()
    },
  }
}

export type Gateway = ReturnType<typeof createGateway>
