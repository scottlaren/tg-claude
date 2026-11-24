import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

// Chrome's file_upload runs inside the CLI, on the server: it uploads only what this session may read there, and a path
// on the user's computer is neither on the server nor readable. Such a file comes over from the computer into a folder
// under the session's own working folder first, and the upload is given that path instead
export const UPLOADS_DIR = 'browser-uploads'
const KEEP_MS = 24 * 3600_000

export type Pulled = { ok: true, name: string, data: Buffer } | { ok: false, error: string }

export async function stageUploads(paths: string[], { workDir, pull, now = Date.now }: {
  workDir: string
  // The file from the topic's computer, by the path Claude gave
  pull: (path: string) => Promise<Pulled>
  now?: () => number
}): Promise<{ ok: true, paths: string[] } | { ok: false, error: string }> {
  const root = join(workDir, UPLOADS_DIR)
  sweep(root, now())
  const out: string[] = []
  for (const p of paths) {
    // Already one the session may read here: left as it is
    if (isAbsolute(p) && insideOf(workDir, p) && existsSync(p)) {
      out.push(p)
      continue
    }
    const got = await pull(p)
    if (!got.ok) return { ok: false, error: `${p}: ${got.error}` }
    const dir = join(root, randomBytes(6).toString('hex'))
    mkdirSync(dir, { recursive: true })
    const file = join(dir, basename(got.name).replace(/[^\w.() -]/g, '_') || 'file')
    writeFileSync(file, got.data)
    out.push(file)
  }
  return { ok: true, paths: out }
}

const insideOf = (dir: string, p: string) => {
  const rel = relative(resolve(dir), resolve(p))
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

// What earlier uploads left: a day is long enough for any upload to have happened
function sweep(root: string, now: number) {
  let names: string[] = []
  try {
    names = readdirSync(root)
  } catch {
    return
  }
  for (const n of names) {
    const dir = join(root, n)
    try {
      if (now - statSync(dir).mtimeMs > KEEP_MS) rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
}
