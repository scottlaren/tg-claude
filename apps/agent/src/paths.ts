import { existsSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { resolve, relative, isAbsolute, dirname, basename, join, sep } from 'node:path'
import type { ErrorCode } from '@tgcv/protocol'

// A laptop can lose power in the middle of a write. The old file stays whole until the new one is complete, with its mode
export function writeAtomic(file: string, text: string) {
  const temp = `${file}.tmp`
  writeFileSync(temp, text, existsSync(file) ? { mode: statSync(file).mode & 0o777 } : {})
  renameSync(temp, file)
}

export class ToolError extends Error {
  code: ErrorCode
  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

// Folders a project may touch: the project itself first, then extra ones (worktrees next to the
// repo, §9.1) and read-only ones (Claude's memory for this project)
export type Root = { path: string, readOnly?: boolean }
export type Roots = Root[]
export const asRoots = (r: string | Roots): Roots => (typeof r === 'string' ? [{ path: r }] : r)

export function isInside(root: string, p: string) {
  const r = relative(root, p)
  return r === '' || (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r))
}

const exists = (p: string) => stat(p).then(() => true, () => false)

// Secrets stay off-limits to file tools in every root (the shell itself is not sandboxed, §9.4): keys, a Claude
// sign-in (.credentials.json) and this project's agent configs with their device keys, in any project
const SECRET = /^(\.env(\..+)?|.*\.(pem|key|p12|pfx|jks|keystore|kdbx)|id_(rsa|ed25519|ecdsa)(\.pub)?|\.npmrc|\.pypirc|[._]netrc|\.git-credentials|\.pgpass|\.?credentials(\.json)?|agent\.(config(\..+)?|state|chrome|mcp)\.json)$/i
const owner = (roots: Roots, p: string) => roots.find(r => isInside(r.path, p))

// Resolves a path (relative to the project, or absolute inside any of its roots) and proves it stays
// inside that root after following symlinks and junctions; a file that doesn't exist yet is checked
// through its nearest existing parent
export async function resolveInRoot(rootsOrRoot: string | Roots, path: string, { write = false } = {}) {
  const roots = asRoots(rootsOrRoot)
  const target = resolve(roots[0].path, path)
  const root = owner(roots, target)
  if (!root) throw new ToolError('outside_root', `Path outside the project: ${path}`)

  let existing = target
  const rest: string[] = []
  while (!(await exists(existing))) {
    rest.unshift(basename(existing))
    const parent = dirname(existing)
    if (parent === existing) break
    existing = parent
  }
  const real = join(await realpath(existing), ...rest)
  if (!isInside(root.path, real)) throw new ToolError('outside_root', `Path leads outside the project through a link: ${path}`)
  if (SECRET.test(basename(real)) && !/\.example$/i.test(real)) {
    throw new ToolError('outside_root', `${basename(real)} is a secrets file: the file tools do not touch it`)
  }
  if (write && root.readOnly) throw new ToolError('read_only', `Folder ${root.path} is read-only`)
  return real
}

// What Claude sees: relative to the project, absolute with forward slashes for the other roots
export function toPosix(rootsOrRoot: string | Roots, p: string) {
  const roots = asRoots(rootsOrRoot)
  if (isInside(roots[0].path, p)) return relative(roots[0].path, p).split(sep).join('/') || '.'
  return p.split(sep).join('/')
}
