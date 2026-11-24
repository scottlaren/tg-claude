import { createServer, type Socket } from 'node:net'

// SOCKS5 for the browser on this computer: reachable only from this computer (127.0.0.1), no password (Chrome
// sends none), CONNECT only. Every connection is made on the server through the device link, so sites see the
// server's address; names are resolved there too (Chrome hands socks5 the name, not an address)
export type Connect = (socket: Socket, host: string, port: number) => Promise<void>

const REPLY = { ok: 0, fail: 1, notAllowed: 2, unreachable: 4, refused: 5, badCommand: 7, badAddress: 8 } as const

// What went wrong on the server, in SOCKS terms: Chrome shows a matching error page. The Russian alternatives are
// for servers on releases from before the texts went English: a computer may update before its server does
export function replyCodeOf(message: string) {
  if (/not public|\bport\b|disabled|не публичный|порт|выключен/i.test(message)) return REPLY.notAllowed
  if (/ECONNREFUSED/.test(message)) return REPLY.refused
  if (/ENOTFOUND|EAI_AGAIN|not found|did not respond|не найден|не ответил|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(message)) return REPLY.unreachable
  return REPLY.fail
}

const reply = (code: number) => Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0])

// Bytes as they arrive, handed out in the sizes the handshake asks for
function reader(socket: Socket) {
  let buf = Buffer.alloc(0)
  let want: { n: number, resolve: (b: Buffer) => void } | null = null
  const pump = () => {
    if (!want || buf.length < want.n) return
    const out = buf.subarray(0, want.n)
    buf = buf.subarray(want.n)
    const w = want
    want = null
    w.resolve(out)
  }
  const onData = (d: Buffer) => {
    buf = Buffer.concat([buf, d])
    pump()
  }
  socket.on('data', onData)
  const read = (n: number) => new Promise<Buffer>(resolve => {
    want = { n, resolve }
    pump()
  })
  return Object.assign(read, { stop: () => socket.off('data', onData) })
}

async function handshake(socket: Socket, connect: Connect) {
  const read = reader(socket)
  const [ver, methods] = await read(2)
  if (ver !== 5) return socket.destroy()
  if (!(await read(methods)).includes(0)) return socket.end(Buffer.from([5, 0xff]))
  socket.write(Buffer.from([5, 0]))
  const [, cmd, , atyp] = await read(4)
  let host: string
  if (atyp === 1) host = [...await read(4)].join('.')
  else if (atyp === 3) host = (await read((await read(1))[0])).toString('latin1')
  else if (atyp === 4) {
    const b = await read(16)
    host = Array.from({ length: 8 }, (_, i) => b.readUInt16BE(i * 2).toString(16)).join(':')
  } else return socket.end(reply(REPLY.badAddress))
  const port = (await read(2)).readUInt16BE(0)
  // From here the bytes belong to the site: the tunnel takes the socket over
  read.stop()
  socket.setTimeout(0)
  if (cmd !== 1) return socket.end(reply(REPLY.badCommand))
  try {
    await connect(socket, host, port)
    socket.write(reply(REPLY.ok))
  } catch (e) {
    socket.end(reply(replyCodeOf((e as Error).message)))
  }
}

export function startSocks({ port, connect, log }: { port: number, connect: Connect, log: (...a: unknown[]) => void }) {
  const server = createServer(socket => {
    socket.setNoDelay(true)
    // A handshake takes milliseconds: one that stalls is not a browser
    socket.setTimeout(10_000, () => socket.destroy())
    socket.on('error', () => {})
    handshake(socket, connect).catch(() => socket.destroy())
  })
  server.on('error', e => log(`the browser proxy failed to start on 127.0.0.1:${port}: ${e.message}`))
  server.listen(port, '127.0.0.1', () => log(`browser proxy: socks5://127.0.0.1:${port}, websites see the server address`))
  return { close: () => server.close(), ready: new Promise<number>(r => server.once('listening', () => r((server.address() as { port: number }).port))) }
}
