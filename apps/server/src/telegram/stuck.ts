// An agent going round in circles costs the limit and tells nobody. This looks at its steps, and says so once per reason
// and turn: the head decides what to do about it. Waiting for the user is never being stuck, and neither is a long command
// by itself: the limits for it are much further out

export const SAME_ERROR_MAX = 3
export const SAME_STEP_MAX = 5
export const QUIET_MS = 30 * 60_000
export const QUIET_COMMAND_MS = 2 * 3600_000

export type StuckReason = { kind: 'error', times: number, detail: string } | { kind: 'loop', times: number, detail: string } | { kind: 'quiet', minutes: number, running: boolean }

export function createStuckWatch({ now = Date.now } = {}) {
  let lastActivity = now()
  let step = ''
  let steps = 0
  let error = ''
  let errors = 0
  const said = new Set<string>()
  const once = (kind: string, reason: StuckReason) => {
    if (said.has(kind)) return null
    said.add(kind)
    return reason
  }

  return {
    // Claude wrote something: it isn't quiet, though it may well be going round
    activity() {
      lastActivity = now()
    },
    step(name: string, input: unknown): StuckReason | null {
      lastActivity = now()
      const same = `${name} ${JSON.stringify(input)}`
      steps = same === step ? steps + 1 : 1
      step = same
      return steps >= SAME_STEP_MAX ? once('loop', { kind: 'loop', times: steps, detail: name }) : null
    },
    // What came of a step: another outcome ends a run of the same error
    outcome(failure: string | null): StuckReason | null {
      lastActivity = now()
      if (!failure) {
        errors = 0
        error = ''
        return null
      }
      errors = failure === error ? errors + 1 : 1
      error = failure
      return errors >= SAME_ERROR_MAX ? once('error', { kind: 'error', times: errors, detail: failure.slice(0, 200) }) : null
    },
    // waiting: the user has a card or a question to answer. running: a command is under way on a computer
    quiet({ waiting, running }: { waiting: boolean, running: boolean }): StuckReason | null {
      if (waiting) {
        lastActivity = now()
        return null
      }
      const quiet = now() - lastActivity
      if (quiet < (running ? QUIET_COMMAND_MS : QUIET_MS)) return null
      return once('quiet', { kind: 'quiet', minutes: Math.round(quiet / 60_000), running })
    },
  }
}

// What a failed step comes down to. A command that ran and failed is an ok operation with a bad exit code
export function failureOf(tool: string, out: { ok: boolean, error?: { message: string }, result?: unknown }) {
  if (!out.ok) return `${tool}: ${out.error?.message ?? 'failed'}`
  const r = out.result as { exitCode?: number | null, stderr?: string } | undefined
  if (tool === 'run_command' && r?.exitCode) return `${tool}: exit ${r.exitCode}: ${(r.stderr ?? '').trim().slice(-200)}`
  return null
}

export function stuckForClaude(name: string, r: StuckReason) {
  const what = r.kind === 'error'
    ? `the same error ${r.times} times in a row: ${r.detail}`
    : r.kind === 'loop'
      ? `the same step ${r.times} times in a row (${r.detail})`
      : r.running
        ? `a command has been running for ${r.minutes} minutes with no sign of progress`
        : `no sign of progress for ${r.minutes} minutes`
  return `[Agent “${name}” may be stuck: ${what}. It is still running. Look into it: send it a message, stop it or remove it. If it is fine, do nothing.]`
}
