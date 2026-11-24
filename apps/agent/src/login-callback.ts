import { createServer } from 'node:http'

// A sign-in page sends the browser back to localhost when it is done, a port the CLI on the server listens on, far
// from here. So the answer is caught on this computer and handed to the server, and nothing has to be copied by hand.
// Only the first /callback, only on loopback, and for as long as a sign-in lasts
const PAGE = '<!doctype html><meta charset="utf-8"><title>Done</title><p style="font:16px system-ui;margin:3em;text-align:center">✅ Done: you can close this window and go back to Telegram.</p>'

export function waitLoginCallback(port: number, timeoutMs = 10 * 60_000): Promise<{ path: string | null }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const path = req.url ?? '/'
      if (!/^\/callback(\?|$)/.test(path)) return void res.writeHead(404).end()
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' }).end(PAGE)
      finish(path)
    })
    const finish = (path: string | null) => {
      clearTimeout(timer)
      server.close()
      resolve({ path })
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    server.on('error', e => {
      clearTimeout(timer)
      reject(new Error(`Port ${port} on this computer is taken: ${e.message}`))
    })
    server.listen(port, '127.0.0.1')
  })
}
