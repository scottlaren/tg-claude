// Preloaded into every process of the stand: nothing here may reach anything outside this computer. A connection to
// another host is refused and written down; the test reads the list and fails on it. Pipes are not limited: their names
// are derived from the temporary config's path
import { appendFileSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'

const dir = process.env.E2E_DIR
if (!dir) throw new Error('E2E_DIR is not set: this file belongs to the end-to-end stand')

const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1'])
const connect = net.Socket.prototype.connect
const patched = function (this: net.Socket, ...args: unknown[]) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  const o = (first && typeof first === 'object' ? first : {}) as { host?: string, port?: number, path?: string }
  const host = typeof first === 'number' ? (typeof args[1] === 'string' ? args[1] : 'localhost') : o.path ? 'localhost' : o.host ?? 'localhost'
  if (!LOCAL.has(host)) {
    appendFileSync(join(dir, 'net-violations.log'), `${process.argv[1]} → ${host}:${o.port}\n`)
    setImmediate(() => this.destroy(new Error(`e2e guard: no connections to ${host}`)))
    return this
  }
  return (connect as (...a: unknown[]) => net.Socket).apply(this, args)
}
net.Socket.prototype.connect = patched as typeof connect
