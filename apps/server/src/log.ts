import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, readdirSync, rmSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'

export type Log = ReturnType<typeof createLogger>

const fmt = (a: unknown) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))
const dayOf = (t: number | Date) => new Date(t).toISOString().slice(0, 10)

// §16: technical logs are kept 14 days. The current day goes to `file`; at the first line of a new day
// it becomes <name>-YYYY-MM-DD.log, and dated files past the limit are deleted
// Node ends the process over a promise nobody waited on: every turn on the server, for what is at worst one lost message
export const surviveRejections = (log: Pick<Log, 'error'>) => void process.on('unhandledRejection', e => log.error('unhandled rejection', e))

export function createLogger(file: string, { keepDays = 14, now = () => new Date() } = {}) {
  mkdirSync(dirname(file), { recursive: true })
  const stem = basename(file, '.log')
  let day = existsSync(file) ? dayOf(statSync(file).mtime) : dayOf(now())

  function rotate(today: string) {
    if (existsSync(file)) renameSync(file, join(dirname(file), `${stem}-${day}.log`))
    day = today
    const oldest = dayOf(now().getTime() - keepDays * 86_400_000)
    for (const f of readdirSync(dirname(file))) {
      const m = f.match(new RegExp(`^${stem}-(\\d{4}-\\d{2}-\\d{2})\\.log$`))
      if (m && m[1] < oldest) rmSync(join(dirname(file), f), { force: true })
    }
  }

  const write = (level: string, args: unknown[]) => {
    const t = now()
    const line = `${t.toISOString()} ${level} ${args.map(fmt).join(' ')}`
    // Logging happens in catch blocks and timers: on a full disk a throw from here would bring the server down, and with
    // it /cleanup, the way to free that disk
    try {
      if (dayOf(t) !== day) rotate(dayOf(t))
      appendFileSync(file, line + '\n')
    } catch {}
    console.log(line)
  }
  return {
    info: (...a: unknown[]) => write('INFO', a),
    warn: (...a: unknown[]) => write('WARN', a),
    error: (...a: unknown[]) => write('ERROR', a),
    debug: (...a: unknown[]) => process.env.DEBUG && write('DEBUG', a),
  }
}
