import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, connect, type Socket } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGateway } from '../src/gateway.ts'
import { createDeviceRegistry, createPairing } from '../src/devices.ts'
import { dialOut } from '../src/egress.ts'
import { createExecutor } from '../../agent/src/executor.ts'
import { startClient } from '../../agent/src/client.ts'
import { startSocks, replyCodeOf } from '../../agent/src/socks.ts'

const quiet = { info() {}, warn() {}, error() {}, debug() {} }
const nolog = () => {}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

// A site on this machine: it answers a download of N bytes, or sends back the hash of what was uploaded
function site() {
  const server = createServer(s => {
    let got = Buffer.alloc(0)
    s.on('data', d => {
      got = Buffer.concat([got, d])
      const head = got.indexOf('\r\n\r\n')
      if (head < 0) return
      const [line, ...headers] = got.subarray(0, head).toString().split('\r\n')
      const length = Number(headers.find(h => /^content-length:/i.test(h))?.split(':')[1] ?? 0)
      const body = got.subarray(head + 4)
      if (body.length < length) return
      const n = Number(line.match(/GET \/(\d+)/)?.[1] ?? 0)
      const reply = n ? randomBytes(n) : Buffer.from(sha(body))
      s.end(Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\ncontent-length: ${reply.length}\r\nx-sha: ${sha(reply)}\r\n\r\n`), reply]))
    })
  })
  return new Promise<{ port: number, close: () => void }>(r => server.listen(0, '127.0.0.1', () => r({ port: (server.address() as { port: number }).port, close: () => server.close() })))
}

// Chrome's side of SOCKS5: hello, CONNECT by name, then a raw HTTP exchange through the tunnel
async function viaSocks(socksPort: number, host: string, port: number, request: Buffer): Promise<{ code: number, response: Buffer }> {
  const s = connect(socksPort, '127.0.0.1')
  await new Promise(r => s.once('connect', r))
  let buf = Buffer.alloc(0)
  const need = (n: number) => new Promise<Buffer>(resolve => {
    const check = () => {
      if (buf.length < n) return
      s.off('data', onData)
      const out = buf.subarray(0, n)
      buf = buf.subarray(n)
      resolve(out)
    }
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      check()
    }
    s.on('data', onData)
    check()
  })
  s.write(Buffer.from([5, 1, 0]))
  assert.deepEqual([...await need(2)], [5, 0])
  const name = Buffer.from(host)
  const p = Buffer.alloc(2)
  p.writeUInt16BE(port)
  s.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, p]))
  const code = (await need(10))[1]
  if (code !== 0) {
    s.destroy()
    return { code, response: Buffer.alloc(0) }
  }
  s.write(request)
  const chunks: Buffer[] = [buf]
  s.on('data', d => chunks.push(d))
  await new Promise(r => s.once('close', r))
  return { code, response: Buffer.concat(chunks) }
}

async function setup(dial?: (h: string, p: number) => Promise<Socket>) {
  const root = mkdtempSync(join(tmpdir(), 'tgcv-tunnel-'))
  const registry = createDeviceRegistry(join(root, 'devices.json'), new Map([['pc', 'secret']]))
  const gateway = createGateway({ port: 0, host: '127.0.0.1', registry, pairing: createPairing(), log: quiet, tunnel: dial ? { dial } : {} })
  const port = await gateway.ready
  const client = startClient(
    { serverUrl: `ws://127.0.0.1:${port}/device`, deviceId: 'pc', deviceKey: 'secret', deviceName: 'PC', shell: 'bash', projects: [], mcpServers: {}, apps: {}, zones: [], shared: [], browserProxyPort: 0 },
    createExecutor({ projects: [], shell: 'bash', log: nolog }), nolog,
  )
  await new Promise(r => gateway.events.once('online', r))
  const socks = startSocks({ port: 0, connect: (s, h, p) => client.tunnel(s, h, p), log: nolog })
  return { gateway, client, socks, socksPort: await socks.ready }
}

// Tests reach a site on 127.0.0.1, which the real egress refuses: same dial, private addresses let through
const localDial = (h: string, p: number) => new Promise<Socket>((resolve, reject) => {
  const s = connect(p, h === 'site.test' ? '127.0.0.1' : h)
  s.once('connect', () => resolve(s))
  s.once('error', reject)
})

test('the browser tunnel carries a download and an upload whole, both ways at once, and closes cleanly', async () => {
  const web = await site()
  const { gateway, client, socks, socksPort } = await setup(localDial)
  try {
    const n = 6 * 1024 * 1024
    const upload = randomBytes(4 * 1024 * 1024)
    const [down, up] = await Promise.all([
      viaSocks(socksPort, 'site.test', web.port, Buffer.from(`GET /${n} HTTP/1.1\r\nhost: site.test\r\n\r\n`)),
      viaSocks(socksPort, 'site.test', web.port, Buffer.concat([Buffer.from(`POST / HTTP/1.1\r\nhost: site.test\r\ncontent-length: ${upload.length}\r\n\r\n`), upload])),
    ])
    const split = (r: Buffer) => [r.subarray(0, r.indexOf('\r\n\r\n')).toString(), r.subarray(r.indexOf('\r\n\r\n') + 4)] as const
    const [dh, db] = split(down.response)
    assert.equal(db.length, n)
    assert.equal(sha(db), dh.match(/x-sha: (\w+)/)![1])
    assert.equal(split(up.response)[1].toString(), sha(upload))
    // Everything finished: nothing stays open on the server
    await new Promise(r => setTimeout(r, 200))
    assert.deepEqual(gateway.tunnels(), { open: 0, total: 2 })
  } finally {
    socks.close()
    client.stop()
    gateway.close()
    web.close()
  }
})

test('the server leaves only for the public web: other ports, private addresses and container names are refused', async () => {
  await assert.rejects(dialOut('example.com', 22, { lookup: async () => [{ address: '93.184.215.14' }] }), /port 22/)
  await assert.rejects(dialOut('example.com', 25, { lookup: async () => [{ address: '93.184.215.14' }] }), /port 25/)
  await assert.rejects(dialOut('rebind.test', 443, { lookup: async () => [{ address: '169.254.169.254' }] }), /not public/)
  await assert.rejects(dialOut('10.0.0.5', 443), /not public/)
  await assert.rejects(dialOut('server', 443), /not public/)
  await assert.rejects(dialOut('[::1]', 443), /not public/)
})

test('through the real server side a site inside is refused, and the browser gets «not allowed»', async () => {
  const web = await site()
  const { gateway, client, socks, socksPort } = await setup()
  try {
    const r = await viaSocks(socksPort, '127.0.0.1', 443, Buffer.from('GET / HTTP/1.1\r\n\r\n'))
    assert.equal(r.code, 2)
    assert.deepEqual(gateway.tunnels(), { open: 0, total: 0 })
  } finally {
    socks.close()
    client.stop()
    gateway.close()
    web.close()
  }
})

test('server errors become the SOCKS replies a browser understands', () => {
  assert.equal(replyCodeOf('address is not public'), 2)
  assert.equal(replyCodeOf('port 22 is closed: the browser only goes to web ports'), 2)
  assert.equal(replyCodeOf('the browser tunnel is disabled on the server'), 2)
  assert.equal(replyCodeOf('connect ECONNREFUSED 1.2.3.4:443'), 5)
  assert.equal(replyCodeOf('getaddrinfo ENOTFOUND nope.example'), 4)
  assert.equal(replyCodeOf('the site did not respond'), 4)
  assert.equal(replyCodeOf('no connection to the server'), 1)
  // A server on an older release still words them in Russian
  assert.equal(replyCodeOf('адрес не публичный'), 2)
  assert.equal(replyCodeOf('порт 22 закрыт'), 2)
})
