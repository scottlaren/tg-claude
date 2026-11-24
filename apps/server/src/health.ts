import type { IncomingMessage, ServerResponse } from 'node:http'

// For an outside monitor, which can see what the owner can't when the whole server is the problem. The address is open
// to the internet, so it says only yes or no. What it asks is the thing that can stop without anything crashing: is the
// bot still hearing from Telegram. A long poll returns at least every 30 s
export const POLL_STALE_MS = 2 * 60_000

export function createHealth(now = Date.now, staleMs = POLL_STALE_MS) {
  // From the start, so that a restart doesn't read as an outage; a bot that never gets through does, two minutes on
  let lastPoll = now()
  return {
    // An api transformer: every poll that came back, with updates or without
    watch: (async (prev: (m: string, p: unknown, s?: AbortSignal) => Promise<{ ok: boolean }>, method: string, payload: unknown, signal?: AbortSignal) => {
      const res = await prev(method, payload, signal)
      if (method === 'getUpdates' && res.ok) lastPoll = now()
      return res
    }) as never,
    // true when the request was this one. HEAD too: it is what UptimeRobot sends by default
    route(req: IncomingMessage, res: ServerResponse) {
      if ((req.url ?? '').split('?')[0] !== '/health' || (req.method !== 'GET' && req.method !== 'HEAD')) return false
      const fresh = now() - lastPoll < staleMs
      res.writeHead(fresh ? 200 : 503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end(req.method === 'HEAD' ? undefined : fresh ? 'ok\n' : 'not polling\n')
      return true
    },
  }
}
