// Throttled live preview: at most one draft per `minGap`, and a resend before Telegram's
// 30 s draft expiry even when nothing changed (long tool runs)
export function createDrafter(
  build: () => string,
  send: (md: string) => Promise<unknown>,
  { minGap = 900, heartbeat = 15000, onError }: { minGap?: number | (() => number), heartbeat?: number, onError?: (e: unknown) => void } = {},
) {
  let timer: NodeJS.Timeout | null = null
  let last = 0
  let stopped = false
  let inflight: Promise<void> | null = null
  let dirty = false
  let failed = false

  async function deliver() {
    try {
      await send(build())
    } catch (e) {
      const retry = (e as { parameters?: { retry_after?: number } })?.parameters?.retry_after
      if (retry) last = Date.now() + retry * 1000
      else {
        failed = true
        onError?.(e)
      }
    }
  }

  async function flush() {
    timer = null
    if (stopped || failed) return
    if (inflight) {
      dirty = true
      return
    }
    dirty = false
    last = Date.now()
    inflight = deliver()
    await inflight
    inflight = null
    if (dirty) kick()
  }

  function kick() {
    if (stopped || failed || timer) return
    const gap = typeof minGap === 'function' ? minGap() : minGap
    timer = setTimeout(flush, Math.max(0, gap - (Date.now() - last)))
  }

  const hb = setInterval(() => {
    if (Date.now() - last > heartbeat) kick()
  }, 1000)

  return {
    kick,
    get failed() { return failed },
    // Resolves once a draft already on its way is delivered: the final message must come after it,
    // or Telegram may show the stale draft below the answer
    stop(): Promise<void> {
      stopped = true
      if (timer) clearTimeout(timer)
      clearInterval(hb)
      return inflight ?? Promise.resolve()
    },
  }
}
export type Drafter = ReturnType<typeof createDrafter>
