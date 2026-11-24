// A computer coming back is worth a push when it was really away. A laptop asleep wakes for under a minute every few
// minutes and an update restarts the agent in a second: neither says anything. A computer that stays counts as back
const STABLE_MS = 60_000
const AWAY_MS = 5 * 60_000
// After a restart of the server every computer connects again, and none of them went anywhere
const BOOT_GRACE_MS = 60_000

type Timer = ReturnType<typeof setTimeout>

export function createPresence({ notify, now = Date.now, stableMs = STABLE_MS, awayMs = AWAY_MS, bootGraceMs = BOOT_GRACE_MS }: {
  notify: (id: string) => void, now?: () => number, stableMs?: number, awayMs?: number, bootGraceMs?: number,
}) {
  const started = now()
  // up: it has stayed. awaySince: when it last left a stay; none for a computer not seen since the server started
  const seen = new Map<string, { up: boolean, awaySince?: number, timer?: Timer }>()
  return {
    online(id: string) {
      const known = seen.get(id)
      const s = known ?? { up: false, ...(now() - started < bootGraceMs ? { awaySince: now() } : {}) }
      seen.set(id, s)
      if (s.timer) clearTimeout(s.timer)
      if (s.up) return
      s.timer = setTimeout(() => {
        s.timer = undefined
        s.up = true
        // Not seen since the server started and not there at its start: it was off
        if (s.awaySince === undefined || now() - s.awaySince >= awayMs) notify(id)
        s.awaySince = undefined
      }, stableMs)
      s.timer.unref?.()
    },
    offline(id: string) {
      const s = seen.get(id)
      if (!s) return
      if (s.timer) clearTimeout(s.timer)
      s.timer = undefined
      // A short wake in between doesn't restart the count: it stays away from when it last stayed
      if (s.up) s.awaySince = now()
      s.up = false
    },
  }
}
