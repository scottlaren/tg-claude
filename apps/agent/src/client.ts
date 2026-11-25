import WebSocket from 'ws'
import { PROTOCOL_VERSION, codeVersion, releaseOf, ServerMessage, decode, pipeStream, type DeviceMessage, type McpServerInfo, type Project, type Pipe } from '@tgcv/protocol'
import type { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { deviceOs, type AgentConfig } from './config.ts'
import type { createExecutor } from './executor.ts'

// The commit this agent runs from: /diag on the server shows a computer left on old code
// Its release: a server on a newer one asks it to update itself
const AGENT_RELEASE = releaseOf(fileURLToPath(new URL('../../..', import.meta.url)))
// The commit /diag shows; an install from /pair has none, its release stands in
const AGENT_VERSION = ((v: string) => (v === 'unknown' ? `v${AGENT_RELEASE}` : v))(codeVersion(fileURLToPath(new URL('../../..', import.meta.url))))

// The server pings every 15 s; silence for this long means the link is dead even if TCP hasn't noticed
const SILENCE_MS = 45_000
const MAX_BACKOFF_MS = 30_000
// A laptop can fall asleep in the middle of connecting. That socket never fails and never opens, and nothing would ever
// look at it again: the computer stays offline after it wakes, until someone restarts the agent
const HANDSHAKE_MS = 20_000
// A refusal is not for ever: the key can't heal by itself, but a server that has just restarted or updated can
const REJECT_RETRY_MS = 10 * 60_000
// The lock goes by deleting a file, with no process to say so
const LOCK_WATCH_MS = 3000


// Outbound only: the device dials the server, no open port at home (§8.2)
export function startClient(
  cfg: AgentConfig, executor: ReturnType<typeof createExecutor>, log: (...a: unknown[]) => void,
  mcp: () => McpServerInfo[] = () => [],
  apps: { id: string, name: string, mcp?: string }[] = [],
  projects: () => Project[] = () => cfg.projects,
  // A server on a newer release that turned this agent away: the agent may update itself to it
  onReject: (reason: string, serverRelease?: string) => void = () => {},
  { handshakeMs = HANDSHAKE_MS, silenceMs = SILENCE_MS, rejectRetryMs = REJECT_RETRY_MS, locked = () => false as boolean, lockWatchMs = LOCK_WATCH_MS, keepAwake = () => undefined as boolean | undefined, screen = false } = {},
) {
  let ws: WebSocket | null = null
  let welcomed = false
  let welcomedAt = 0
  let attempt = 0
  let stopped = false
  let refused = false
  // Asleep with the screen off (nap.ts): no link, and no trying for one, until the computer wakes for real
  let resting = false
  let saidLocked = false
  let silence: NodeJS.Timeout | undefined
  let retry: NodeJS.Timeout | undefined
  // The browser tunnel: connections of the local proxy, made on the server and piped over this link
  const streams = new Map<number, Pipe>()
  const opening = new Map<number, { done: (error?: string) => void, timer: NodeJS.Timeout }>()
  let nextSid = 1
  const dropTunnels = (why: string) => {
    for (const p of streams.values()) p.drop()
    streams.clear()
    for (const o of opening.values()) {
      clearTimeout(o.timer)
      o.done(why)
    }
    opening.clear()
  }

  const send = (m: DeviceMessage) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
  }

  const alive = () => {
    clearTimeout(silence)
    silence = setTimeout(() => {
      log('the server is silent, reconnecting')
      ws?.terminate()
    }, silenceMs)
  }

  function connect() {
    const sock = new WebSocket(cfg.serverUrl, { maxPayload: 8 * 1024 * 1024, handshakeTimeout: handshakeMs })
    ws = sock
    welcomed = false
    sock.on('open', () => {
      alive()
      saidLocked = locked()
      // The apps' tools go right after the welcome, not in here: with a hundred of them the hello grew to hundreds of KB,
      // and on a link busy with everything that starts with Windows it didn't reach the server in time
      send({
        locked: saidLocked,
        keepAwake: keepAwake(),
        screen: screen || undefined,
        mcp: [],
        apps,
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        version: AGENT_VERSION,
        release: AGENT_RELEASE,
        shared: cfg.shared,
        deviceId: cfg.deviceId,
        deviceName: cfg.deviceName,
        key: cfg.deviceKey,
        os: deviceOs(),
        shell: cfg.shell,
        projects: projects(),
      })
    })
    sock.on('ping', alive)
    sock.on('message', raw => {
      alive()
      const m = decode(ServerMessage, raw)
      if (!m) return log('unrecognized message from the server')
      switch (m.type) {
        case 'welcome':
          attempt = 0
          welcomed = true
          welcomedAt = Date.now()
          log(`connected to ${cfg.serverUrl} as ${cfg.deviceId}, projects: ${projects().length}`)
          // An app may have come up between hello and welcome
          send({ type: 'mcp.update', servers: mcp() })
          break
        case 'reject':
          // Wrong key or protocol: retrying soon won't help, a human may have to fix the config or update the app
          log(`the server refused: ${m.reason}`)
          refused = true
          sock.close()
          onReject(m.reason, m.serverRelease)
          break
        case 'op.request':
          executor.handle(m, send)
          break
        case 'op.cancel':
          executor.cancel(m.opId)
          break
        case 'tunnel.opened': {
          const o = opening.get(m.sid)
          // Too late, the proxy gave up on it: free the server's side
          if (!o) {
            if (m.ok) send({ type: 'tunnel.close', sid: m.sid })
            break
          }
          opening.delete(m.sid)
          clearTimeout(o.timer)
          o.done(m.ok ? undefined : m.error ?? 'the server refused')
          break
        }
        case 'tunnel.data':
        case 'tunnel.ack':
        case 'tunnel.close':
          streams.get(m.sid)?.frame(m)
          break
      }
    })
    sock.on('error', e => log('connection error:', e.message))
    sock.on('close', () => {
      clearTimeout(silence)
      if (ws === sock) ws = null
      dropTunnels('the connection to the server dropped')
      if (stopped || resting) return
      // Exponential backoff with jitter; sleep/wake and network changes end up here too
      const delay = refused ? rejectRetryMs : Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++) * (0.75 + Math.random() / 2)
      refused = false
      // Waiting is no reason to keep a process alive: the agent's own control socket does that
      retry = setTimeout(connect, delay).unref()
    })
  }

  // The server hears of a change the way it hears everything about a computer: in a new hello
  const lockWatch = setInterval(() => {
    if (!ws || locked() === saidLocked) return
    log(saidLocked ? '🔓 unlocked: operations run again' : '🔒 locked')
    ws.terminate()
  }, lockWatchMs).unref()

  connect()
  return {
    // The server then takes the computer for what it is, offline, and its pings no longer wake it
    rest(on: boolean) {
      if (resting === on || stopped) return
      resting = on
      clearTimeout(retry)
      if (on) return ws?.terminate()
      attempt = 0
      // A link still closing schedules its own way back as it ends
      if (!ws) connect()
    },
    // How long the server has had this computer on the current link; 0 with no link. A server that just came back asks
    // about what it left open in its first moments here
    linkedFor: () => (ws && welcomed ? Date.now() - welcomedAt : 0),
    // One connection of the local proxy, made on the server: resolves once it is open there, then the bytes flow
    tunnel(socket: Duplex, host: string, port: number): Promise<void> {
      if (!welcomed) return Promise.reject(new Error('no connection to the server'))
      const sid = nextSid++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          opening.delete(sid)
          reject(new Error('the server did not respond'))
        }, 20_000)
        opening.set(sid, {
          timer,
          done: error => {
            if (error) return reject(new Error(error))
            streams.set(sid, pipeStream(sid, socket, send, () => streams.delete(sid)))
            resolve()
          },
        })
        send({ type: 'tunnel.open', sid, host, port })
      })
    },
    // Apps come and go: the server must not offer tools that are gone (§6, §10.1)
    mcpChanged() {
      if (welcomed) send({ type: 'mcp.update', servers: mcp() })
    },
    stop() {
      stopped = true
      clearInterval(lockWatch)
      clearTimeout(retry)
      clearTimeout(silence)
      ws?.close()
    },
  }
}
