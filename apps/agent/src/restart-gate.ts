// An update moves the code on disk at once; the process takes it on a restart. A restart ends every command this agent
// runs and forgets the results the server hasn't collected yet, so it waits for them, within reason: a command that
// never ends must not keep a computer on old code for ever
export const RESTART_WAIT_MS = 3 * 3600_000
const CHECK_MS = 5000
// Long enough for what is on its way to the server to get there, as before this gate
const SETTLE_MS = 1500

export function createRestartGate({ restart, log, maxMs = RESTART_WAIT_MS, checkMs = CHECK_MS, settleMs = SETTLE_MS, now = Date.now }: {
  restart: (to: string) => void, log: (...a: unknown[]) => void, maxMs?: number, checkMs?: number, settleMs?: number, now?: () => number,
}) {
  let asked = false
  return {
    // Once: a second update while one waits only moves the code further, the same restart takes it
    request(to: string, busy: () => boolean) {
      if (asked) return
      asked = true
      const since = now()
      if (busy()) log(`restarting into ${to} once running commands finish, in ${Math.round(maxMs / 60_000)} minutes at most`)
      const check = () => {
        if (!busy()) return restart(to)
        if (now() - since < maxMs) return void setTimeout(check, checkMs)
        log(`commands are still running after ${Math.round(maxMs / 60_000)} minutes: restarting into ${to} anyway`)
        restart(to)
      }
      setTimeout(check, settleMs)
    },
  }
}
