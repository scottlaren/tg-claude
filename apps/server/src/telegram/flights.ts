import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

export type FlightOp = { opId: string, deviceId: string, tool: string, step: string }

// A Claude turn under way, on disk so that a restart can carry it on: Claude's process dies with the server, what it
// was doing on the computers doesn't. Written when the turn starts and on every tool, so a crash is covered as well
export type Flight = {
  key: string
  sessionId: string | null
  // The message the answer goes under. fromUser: it is one of the user's, not one the bot showed for another session
  replyTo?: number
  fromUser: boolean
  // Everything the turn answers: marks on them are left over from before the restart
  msgIds: number[]
  // What was asked: a restart in the first moments comes before Claude has written it into the session
  prompt: string
  // Automatic continuations this turn is already on
  continuations: number
  modeCap?: string
  // Whether the turn answers the owner's own words. Absent in a record from before it was kept
  ownerSpoke?: boolean
  // The topic's computer, which the turn needs back even with nothing open on it
  deviceId?: string
  // Open operations that change something; a read interrupted by the restart is simply read again
  ops: FlightOp[]
  // Status messages in a group, which nothing else would ever take away
  bubbles: number[]
  // How it ended is known and written here, and the turn that goes on from it hasn't begun: a restart in between takes
  // this as it is, the computers have nothing more to say about it
  next?: string
  at: number
}

const PROMPT_MAX = 2000
const STEP_MAX = 300

export function createFlightStore(file: string, { now = Date.now, warn = (_m: string) => {} } = {}) {
  const flights = new Map<string, Flight>()
  // The process is on its way out: what is on disk is what the next run has to pick up, however turns end from here
  let frozen = false

  function write() {
    try {
      if (!flights.size) return rmSync(file, { force: true })
      writeFileSync(`${file}.tmp`, JSON.stringify([...flights.values()]))
      renameSync(`${file}.tmp`, file)
    } catch (e) {
      // No turn fails over its record: the worst of this is one that isn't continued after a restart
      warn((e as Error).message)
    }
  }
  const change = (key: string, what: (f: Flight) => void) => {
    const f = flights.get(key)
    if (!f) return
    what(f)
    f.at = now()
    write()
  }

  return {
    begin(key: string, f: Omit<Flight, 'key' | 'ops' | 'bubbles' | 'at'>) {
      flights.set(key, { ...f, key, prompt: f.prompt.slice(0, PROMPT_MAX), ops: [], bubbles: [], at: now() })
      write()
    },
    session: (key: string, sessionId: string | null) => change(key, f => { f.sessionId = sessionId }),
    // A message handed in changes what the turn may do and whose words it answers
    handedIn: (key: string, o: Pick<Flight, 'modeCap' | 'ownerSpoke'>) => change(key, f => { Object.assign(f, o) }),
    opStart: (key: string, op: FlightOp) => change(key, f => { f.ops.push({ ...op, step: op.step.slice(0, STEP_MAX) }) }),
    opEnd: (key: string, opId: string) => {
      if (!frozen) change(key, f => { f.ops = f.ops.filter(o => o.opId !== opId) })
    },
    bubble: (key: string, id: number) => change(key, f => { f.bubbles.push(id) }),
    bubbleGone: (key: string, id: number) => {
      if (!frozen) change(key, f => { f.bubbles = f.bubbles.filter(b => b !== id) })
    },
    settled: (key: string, next: string) => change(key, f => {
      f.next = next
      f.ops = []
      f.bubbles = []
    }),
    end(key: string) {
      if (frozen || !flights.delete(key)) return
      write()
    },
    freeze() {
      frozen = true
    },
    // What the previous run left. It stays on disk until each is dealt with: another restart meanwhile finds it again
    load(): Flight[] {
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as Flight[]
        for (const f of saved) flights.set(f.key, f)
        return saved
      } catch {
        return []
      }
    },
  }
}

export type FlightStore = ReturnType<typeof createFlightStore>
