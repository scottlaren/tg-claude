// Claude can call several tools in one go, and their results come back one by one: only when the last is in does the
// model get them. Until then the turn waits on a tool, however long it runs, not on the API
export function createToolTracker() {
  const open = new Set<string>()
  const blocks = (content: unknown) => (Array.isArray(content) ? content as { type?: string, id?: string, tool_use_id?: string }[] : [])
  return {
    called(content: unknown) {
      for (const b of blocks(content)) if (b.type === 'tool_use' && b.id) open.add(b.id)
    },
    // True when nothing is left running: the model is who the turn waits for now
    answered(content: unknown) {
      for (const b of blocks(content)) if (b.type === 'tool_result' && b.tool_use_id) open.delete(b.tool_use_id)
      return open.size === 0
    },
  }
}

// How long a turn has been waiting on the Anthropic API (not on tools or on the user),
// so a dead network fails fast instead of retrying silently for minutes
export function createNetWatch({ timeoutMs, now = Date.now }: { timeoutMs: number, now?: () => number }) {
  let since: number | null = null
  let retries = 0
  return {
    waiting() {
      if (since === null) since = now()
    },
    progress() {
      since = null
      retries = 0
    },
    retry() {
      retries++
      if (since === null) since = now()
    },
    get retries() { return retries },
    stalledFor: () => (since === null ? 0 : now() - since),
    isStalled: () => since !== null && now() - since > timeoutMs,
  }
}
