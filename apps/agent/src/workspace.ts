import { readdirSync, statSync, existsSync, realpathSync, readFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseWorktreeSkip, sparseLeftOut, type Project } from '@tgcv/protocol'
import { isInside, ToolError, writeAtomic } from './paths.ts'
import { memoryDirOf } from './context.ts'

// A folder approved once on this computer: every folder inside it can be picked as a project from
// Telegram, and only folders inside it can be added to a project from there (§9.1)
export type Zone = { path: string, exclude?: string[] }

const CACHE_MS = 3000

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}
const latin = (c: string) => {
  const l = CYRILLIC[c.toLowerCase()]
  return l === undefined ? c : c === c.toLowerCase() ? l : l.charAt(0).toUpperCase() + l.slice(1)
}

// Ids go into button data and logs: Latin and readable, "Тест облака" → Test-oblaka. Letters with no
// Latin form would vanish and two such folders would share an id: a short hash of the real name keeps them apart
export function idOf(name: string) {
  const translit = [...name].map(latin).join('')
  const id = translit.replace(/[^\w-]+/g, '-').slice(0, 40)
  return /[^\x00-\x7f]/.test(translit) ? `${id.slice(0, 33)}-${createHash('sha1').update(name).digest('hex').slice(0, 6)}` : id
}

// In a worktree .git is a file pointing into the main repository. Read directly: this runs for every folder, on every
// listing, and starting git that many times would be felt
export function worktreeInfo(path: string): { mainPath: string, gitDir: string, branch?: string } | null {
  try {
    const m = readFileSync(join(path, '.git'), 'utf8').match(/^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/]([^\\/\r\n]+)\s*$/m)
    if (!m) return null
    const gitDir = join(m[1], '.git', 'worktrees', m[2])
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').match(/^ref: refs\/heads\/(.+?)\s*$/m)
    return { mainPath: m[1], gitDir, branch: head?.[1] }
  } catch {
    return null
  }
}

const readOr = (file: string) => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

// Folders the repository wants its worktrees made without: .worktree-skip in its root
export const worktreeSkip = (path: string) => parseWorktreeSkip(readOr(join(path, '.worktree-skip')))

// Folders a worktree was made without: its own sparse-checkout, while that is on
export function worktreeLeftOut(gitDir: string): string[] {
  if (!/^\s*sparseCheckout\s*=\s*true\s*$/im.test(readOr(join(gitDir, 'config.worktree')))) return []
  return sparseLeftOut(readOr(join(gitDir, 'info', 'sparse-checkout')))
}

const samePath = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

// A repository's worktrees live together in a folder next to it: mfm-wt/<short>
const WORKTREES_FOLDER = /-wt$/i

// From git's own list rather than from that folder: it can hold far more than is alive
function keptWorktrees(repo: string): string[] {
  const dir = join(repo, '.git', 'worktrees')
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.flatMap(name => {
    try {
      const path = dirname(resolve(dir, name, readFileSync(join(dir, name, 'gitdir'), 'utf8').trim()))
      return WORKTREES_FOLDER.test(basename(dirname(path))) && existsSync(path) ? [path] : []
    } catch {
      return []
    }
  })
}

export function createWorkspace({ projects, zones: initialZones, stateFile, selfDir }: {
  projects: Project[], zones: Zone[], stateFile: string, selfDir: string,
}) {
  // Changed from Telegram while the agent runs (set_zones): every lookup reads the current list
  let zones = initialZones
  // Folders granted to projects from Telegram, the id each folder was given, and the ids of folders that are
  // gone (id → its path), kept apart from the hand-written config
  type State = { extraRoots?: Record<string, string[]>, ids?: Record<string, string>, retired?: Record<string, string> }
  const read = (): State => {
    try {
      return JSON.parse(readFileSync(stateFile, 'utf8'))
    } catch {
      return {}
    }
  }
  let state = read()
  const keyOf = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path)

  // Topics are bound to ids, so an id must always mean the same folder. «My Project» and «My-Project» read the
  // same: the folder that had the id keeps it, one that appears later gets a short hash of its path. Ids are
  // remembered, so the order folders are found in or a restart never moves one. A folder that is gone keeps
  // its id: a topic may still be bound to it, and must find no project rather than another folder
  function assignIds(found: Project[]) {
    const known = { ...(state.ids ?? {}) }
    const retired = { ...(state.retired ?? {}) }
    const here = new Set(found.map(p => keyOf(p.path)))
    let changed = false
    for (const k of Object.keys(known)) {
      if (here.has(k)) continue
      retired[known[k]] = k
      delete known[k]
      changed = true
    }
    const taken = new Set([...projects.map(p => p.id), ...Object.values(known)])
    // New folders in a fixed order: two that appear together always come out the same
    for (const p of [...found].sort((a, b) => a.path.localeCompare(b.path))) {
      const k = keyOf(p.path)
      if (!known[k]) {
        const base = idOf(p.name)
        // The same folder back in the same place is the same project
        const back = Object.keys(retired).find(id => retired[id] === k && !taken.has(id))
        known[k] = back ?? (taken.has(base) || base in retired ? `${base.slice(0, 33)}-${createHash('sha1').update(k).digest('hex').slice(0, 6)}` : base)
        if (back) delete retired[back]
        taken.add(known[k])
        changed = true
      }
      p.id = known[k]
    }
    if (changed) {
      state = { ...state, ids: known, retired }
      // Unsaved, the ids still hold until the agent restarts: never a reason to stop listing projects
      try {
        writeAtomic(stateFile, JSON.stringify(state, null, 2) + '\n')
      } catch {}
    }
  }
  let cache: { at: number, list: Project[] } | null = null

  // The agent's own folder (its .env, keys, config) never becomes reachable through a zone
  const excluded = (p: string) => isInside(selfDir, p) ||
    zones.some(z => isInside(z.path, p) && (z.exclude ?? []).some(x => isInside(resolve(z.path, x), p)))

  function scan(): Project[] {
    const explicitPaths = new Set(projects.map(p => p.path.toLowerCase()))
    const found: { project: Project, mtime: number }[] = []
    for (const z of zones) {
      let names: string[] = []
      try {
        names = readdirSync(z.path)
      } catch {
        continue
      }
      for (const name of names) {
        if (name.startsWith('.')) continue
        const path = join(z.path, name)
        let st
        try {
          st = statSync(path)
        } catch {
          continue
        }
        if (!st.isDirectory() || excluded(path) || explicitPaths.has(path.toLowerCase())) continue
        found.push({ project: { id: idOf(name), name, path, extraRoots: [], memoryDir: memoryDirOf(path) }, mtime: st.mtimeMs })
      }
    }
    const seen = new Set([...explicitPaths, ...found.map(f => f.project.path.toLowerCase())])
    for (const repo of [...projects, ...found.map(f => f.project)]) {
      for (const path of keptWorktrees(repo.path)) {
        if (seen.has(path.toLowerCase()) || !zones.some(z => isInside(z.path, path)) || excluded(path)) continue
        seen.add(path.toLowerCase())
        try {
          found.push({ project: { id: idOf(basename(path)), name: basename(path), path, extraRoots: [], memoryDir: memoryDirOf(path) }, mtime: statSync(path).mtimeMs })
        } catch {}
      }
    }
    found.sort((a, b) => b.mtime - a.mtime)
    assignIds(found.map(f => f.project))
    const extra = state.extraRoots ?? {}
    const all = [...projects, ...found.map(f => f.project)]
    return all.map(p => {
      const wt = worktreeInfo(p.path)
      const main = wt && all.find(x => x !== p && samePath(x.path, wt.mainPath))
      const skip = worktreeSkip(p.path)
      const leftOut = wt ? worktreeLeftOut(wt.gitDir) : []
      return {
        ...p,
        extraRoots: [...new Set([...p.extraRoots, ...(extra[p.id] ?? [])])].filter(existsSync),
        // One whose main repository isn't among the projects stands on its own
        ...(main && { worktreeOf: main.id, ...(wt.branch && { branch: wt.branch }) }),
        ...(WORKTREES_FOLDER.test(p.name) && !projects.includes(p) && !existsSync(join(p.path, '.git')) && { hidden: true }),
        ...(skip.length && { worktreeSkip: skip }),
        ...(leftOut.length && { leftOut }),
      }
    })
  }

  // fresh: the server asks for the list right after a folder appeared (a worktree made by git, a clone):
  // the cache is only for the lookups of every operation
  const list = (fresh = false) => {
    if (fresh || !cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), list: scan() }
    return cache.list
  }

  return {
    list,
    get: (id: string) => list().find(p => p.id === id),
    zones: () => zones,
    setZones(next: Zone[]) {
      zones = next
      cache = null
    },

    // "New project" from Telegram: an empty folder in the first zone
    createProject(name: string): Project {
      const clean = name.trim()
      if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u.test(clean)) {
        throw new ToolError('bad_request', 'Name: letters, digits, space, dot, hyphen or _, up to 64 characters')
      }
      const zone = zones[0]
      if (!zone) throw new ToolError('unavailable', 'No working folder is set on this computer (zones in agent.config.json)')
      const path = join(zone.path, clean)
      if (existsSync(path)) throw new ToolError('exists', `Folder ${clean} already exists: pick it from the list or choose another name`)
      mkdirSync(path)
      cache = null
      return list().find(p => p.path === path)!
    },

    // Runs only after the user said yes in Telegram; still bounded by the working folders, which only the user
    // changes (here, or with the bot's buttons)
    addFolder(projectId: string, folder: string): Project {
      const project = list().find(p => p.id === projectId)
      if (!project) throw new ToolError('unknown_project', `Project ${projectId} not found`)
      if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new ToolError('not_found', `No such folder: ${folder}`)
      const real = realpathSync(folder)
      if (!zones.some(z => isInside(z.path, real))) {
        throw new ToolError('outside_root', `Folder ${real} is outside the working folders of this computer: only the user changes them (/devices → "📁 Folders")`)
      }
      if (excluded(real)) throw new ToolError('outside_root', `Folder ${real} is closed to projects`)
      if (isInside(project.path, real)) return project
      const extra = { ...(state.extraRoots ?? {}) }
      extra[projectId] = [...new Set([...(extra[projectId] ?? []), real])]
      state = { ...state, extraRoots: extra }
      writeAtomic(stateFile, JSON.stringify(state, null, 2) + '\n')
      cache = null
      return list().find(p => p.id === projectId)!
    },
  }
}

export type Workspace = ReturnType<typeof createWorkspace>
