import { createServer, connect, type Server } from 'node:net'
import { createHash } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// A local socket per agent config: whoever listens on it is the one running agent (a second one can't
// listen), and `restart` / `uninstall` stop it through it. The socket dies with its process, so a crash
// or a power cut never leaves a stale lock behind, unlike a pid file whose pid Windows soon reuses
export function controlPath(role: 'agent' | 'supervisor', configFile: string) {
  const id = createHash('sha1').update(resolve(configFile).toLowerCase()).digest('hex').slice(0, 8)
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\tg-claude-vps-${role}-${id}`
    : join(tmpdir(), `tg-claude-vps-${role}-${id}.sock`)
}

export class AlreadyRunning extends Error {}

// One line out, one line back; null when nobody listens
export function ask(path: string, cmd: string, timeoutMs = 3000): Promise<string | null> {
  return new Promise(done => {
    let buf = ''
    let settled = false
    const sock = connect(path)
    const finish = (v: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      sock.destroy()
      done(v)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    sock.on('connect', () => sock.write(cmd + '\n'))
    sock.on('data', d => {
      buf += d
      if (buf.includes('\n')) finish(buf.trim())
    })
    sock.on('error', () => finish(null))
    sock.on('close', () => finish(buf.trim() || null))
  })
}

export async function listenControl(path: string, handle: (cmd: string) => string): Promise<Server> {
  // On macOS/Linux a crashed process leaves its socket file: if nobody answers on it, it is stale
  if (process.platform !== 'win32' && existsSync(path) && (await ask(path, 'ping', 1000)) === null) rmSync(path, { force: true })
  return new Promise((done, fail) => {
    const server = createServer(sock => {
      let buf = ''
      sock.on('data', d => {
        buf += d
        const i = buf.indexOf('\n')
        if (i >= 0) sock.end(handle(buf.slice(0, i).trim()) + '\n')
      })
      sock.on('error', () => {})
    })
    server.once('error', e => fail((e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? new AlreadyRunning() : e))
    server.listen(path, () => done(server))
  })
}
