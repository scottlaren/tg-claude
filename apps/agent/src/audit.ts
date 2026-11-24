import { appendFileSync, renameSync, statSync } from 'node:fs'
import type { OpRequest, OpTool } from '@tgcv/protocol'

// A record on the computer of what the server asked it to do: without one, nobody can tell what a stolen account or a
// server taken over did here. Written before the operation runs, so one that kills the agent is still in it. One thing
// it can't be is proof against the same user: a command can delete it, which is why /lock is the next step, not this

const MAX_BYTES = 20 * 1024 * 1024
const MAX_ENTRY = 64 * 1024
// Asked for every turn or every few seconds, and they change nothing
const QUIET: ReadonlySet<OpTool> = new Set(['project_context', 'list_projects', 'github_status', 'zones', 'folders', 'login_callback'])
// What was written matters less than where, and a file's contents or a token must not start living here too
const BULKY = new Set(['content', 'newString', 'oldString', 'data', 'token'])

const SECRETS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key]'],
  [/\b(?:sk-ant-[\w-]{20,}|sk-(?:proj-)?[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{30,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{35})/g, '[key]'],
  [/(?<!\d)\d{8,10}:[A-Za-z0-9_-]{35}(?![\w-])/g, '[bot token]'],
  [/\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}\b/g, '[token]'],
  [/\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi, '$1 [token]'],
  [/\b([\w-]*(?:password|passwd|secret|token|api[_-]?key)[\w-]*)(=|:\s*)[^\s"'&]+/gi, '$1$2[hidden]'],
]
export const scrub = (text: string) => SECRETS.reduce((s, [re, to]) => s.replace(re, to), text)

// Values stay out of env too: its names say what a server was given, its values are often the keys themselves
const shown = (params: unknown) => JSON.stringify(params, (k, v) => {
  if (BULKY.has(k)) return `[${String(v).length} chars]`
  if (k === 'env' && v && typeof v === 'object') return Object.keys(v)
  return v
})

// One operation, one line. Null: nothing worth a line (a later piece of a file already on record)
export function auditLine(req: Pick<OpRequest, 'tool' | 'projectId' | 'params'>, refused: boolean, now = new Date()) {
  if (QUIET.has(req.tool)) return null
  if ((req.tool === 'file_put' || req.tool === 'file_get') && Number(req.params.offset ?? 0) > 0) return null
  const text = scrub(shown(req.params))
  const cut = text.length > MAX_ENTRY ? `${text.slice(0, MAX_ENTRY)}…[cut, ${text.length} chars]` : text
  return `${now.toISOString()}\t${req.tool}\t${req.projectId || '-'}\t${refused ? 'REFUSED\t' : ''}${cut}\n`
}

export function createAudit(file: string, log: (...a: unknown[]) => void, maxBytes = MAX_BYTES) {
  let complained = false
  return (req: Pick<OpRequest, 'tool' | 'projectId' | 'params'>, refused: boolean) => {
    const line = auditLine(req, refused)
    if (!line) return
    // A full disk is no reason to stop the work: said once, in the log that is still there
    try {
      if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > maxBytes) renameSync(file, `${file}.1`)
      appendFileSync(file, line, { mode: 0o600 })
    } catch (e) {
      if (!complained) log('the command journal cannot be written:', (e as Error).message)
      complained = true
    }
  }
}
