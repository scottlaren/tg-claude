import type { Duplex } from 'node:stream'

// The browser tunnel: a connection the computer's local proxy takes in is made on the server, so sites see the
// server's address. Both ends run the same pipe over the device link. Pieces stay small, and at most a window of
// bytes is in flight each way: the side that reads pauses its socket until the far end has written them on
export const TUNNEL_CHUNK = 32 * 1024
export const TUNNEL_WINDOW = 512 * 1024

export type TunnelFrame =
  | { type: 'tunnel.data', sid: number, data: string }
  | { type: 'tunnel.ack', sid: number, bytes: number }
  | { type: 'tunnel.close', sid: number, error?: string }

export function pipeStream(sid: number, socket: Duplex, send: (f: TunnelFrame) => void, onDone: () => void) {
  let inFlight = 0
  // The close frame was sent or received: nothing more goes over the link for this stream
  let closed = false
  let done = false
  const tellClosed = (error?: string) => {
    if (closed) return
    closed = true
    send({ type: 'tunnel.close', sid, ...(error && { error }) })
  }

  socket.on('data', (buf: Buffer) => {
    if (closed) return
    for (let i = 0; i < buf.length; i += TUNNEL_CHUNK) {
      const part = buf.subarray(i, i + TUNNEL_CHUNK)
      inFlight += part.length
      send({ type: 'tunnel.data', sid, data: part.toString('base64') })
    }
    if (inFlight >= TUNNEL_WINDOW) socket.pause()
  })
  // This side finished: the far end finishes too, after writing out what it already has
  socket.on('end', () => {
    tellClosed()
    socket.end()
  })
  socket.on('error', e => {
    tellClosed(e.message)
    socket.destroy()
  })
  socket.on('close', () => {
    tellClosed()
    if (!done) {
      done = true
      onDone()
    }
  })

  return {
    frame(f: TunnelFrame) {
      if (f.type === 'tunnel.data') {
        if (closed) return
        const buf = Buffer.from(f.data, 'base64')
        socket.write(buf, err => {
          if (!err && !closed) send({ type: 'tunnel.ack', sid, bytes: buf.length })
        })
      } else if (f.type === 'tunnel.ack') {
        inFlight -= f.bytes
        if (inFlight < TUNNEL_WINDOW && socket.isPaused()) socket.resume()
      } else {
        // The far end closed: write out what is here, then finish
        closed = true
        if (f.error) socket.destroy()
        else socket.end()
      }
    },
    // The link dropped: nothing will come any more
    drop() {
      closed = true
      socket.destroy()
    },
  }
}

export type Pipe = ReturnType<typeof pipeStream>
