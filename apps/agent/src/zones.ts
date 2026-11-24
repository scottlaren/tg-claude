import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import type { FolderEntry, FolderList, ZoneInfo, ZonesState } from '@tgcv/protocol'
import { ToolError, isInside } from './paths.ts'
import { writeConfigFile } from './config.ts'
import type { Workspace, Zone } from './workspace.ts'

// Working folders from the bot: browsing this computer's folders (names only, never files), suggesting where
// projects live, and changing the list. Only the bot asks, at the user's taps: none of it is a tool of Claude's

// Where nobody keeps projects: skipped when looking for them, still reachable by browsing
const NOT_PROJECTS = new Set(['Library', 'Applications', 'AppData', 'Application Data', 'Local Settings', 'Pictures', 'Music', 'Movies', 'Videos', 'Public', 'node_modules'])
// Telegram shows a folder a page at a time; past this many the user is better off going deeper
const LIST_MAX = 300

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

// Visible subfolders: no dot folders, nothing Windows keeps at a drive's root
function readSubfolders(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => !/^[.$]/.test(e.name) && e.name !== 'System Volume Information')
    .filter(e => e.isDirectory() || (e.isSymbolicLink() && isDir(join(dir, e.name))))
    .map(e => e.name)
}
// When looking around, a folder that can't be read just has nothing to offer
function subfolders(dir: string): string[] {
  try {
    return readSubfolders(dir)
  } catch {
    return []
  }
}

// A folder the agent may not read is not an empty one: on a Mac it is macOS's privacy settings (Documents,
// Desktop, Downloads, other volumes) that the user can open up
export function deniedMessage(path: string, platform = process.platform) {
  return platform === 'darwin'
    ? `macOS doesn't let the agent read ${path}: allow "node" in System Settings → Privacy & Security → Files and Folders (or Full Disk Access)`
    : `No access to ${path}`
}

// macOS mounts its own helper volumes under /Volumes too; nobody keeps projects there
export const isSystemVolume = (name: string) => /^(Recovery|Preboot|VM|Update|xarts|iSCPreboot|Hardware)$/i.test(name) || name.startsWith('com.apple.')

function existingDir(path: string) {
  if (!isDir(path)) throw new ToolError('not_found', `No such folder: ${path}`)
  return realpathSync(path)
}

export function listFolders(path: string): FolderList {
  const real = existingDir(path)
  let found: string[]
  try {
    found = readSubfolders(real)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    throw new ToolError(code === 'EPERM' || code === 'EACCES' ? 'unavailable' : 'failed', code === 'EPERM' || code === 'EACCES' ? deniedMessage(real) : (e as Error).message)
  }
  const names = found.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
  return {
    path: real,
    parent: dirname(real) === real ? null : dirname(real),
    folders: names.slice(0, LIST_MAX).map(name => ({ name, path: join(real, name) })),
    more: Math.max(0, names.length - LIST_MAX),
  }
}

// Where browsing can start: home, then the other drives (Windows) or volumes (Mac)
export function folderRoots(home = homedir(), platform = process.platform): FolderEntry[] {
  const roots = [{ name: 'home', path: home }]
  if (platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const path = `${letter}:\\`
      if (existsSync(path)) roots.push({ name: `${letter}:`, path })
    }
  } else if (platform === 'darwin') {
    // The startup disk is in /Volumes too, as a link to /
    for (const name of subfolders('/Volumes')) {
      const path = join('/Volumes', name)
      try {
        if (!isSystemVolume(name) && realpathSync(path) !== '/') roots.push({ name, path })
      } catch {}
    }
  }
  return roots
}

// Folders with git projects right inside them
const gitProjects = (dir: string) => subfolders(dir).filter(n => existsSync(join(dir, n, '.git'))).length

// Folders in home, two levels down, that hold git projects and aren't working folders yet, the fullest first.
// A folder that is a project itself is not where projects live
export function suggestZones(home: string, taken: string[], selfDir: string, max = 3): ZoneInfo[] {
  const out: ZoneInfo[] = []
  const consider = (dir: string) => {
    if (taken.some(z => isInside(z, dir) || isInside(dir, z)) || isInside(selfDir, dir) || existsSync(join(dir, '.git'))) return
    const projects = gitProjects(dir)
    if (projects) out.push({ path: dir, projects })
  }
  for (const a of subfolders(home)) {
    if (NOT_PROJECTS.has(a)) continue
    const top = join(home, a)
    consider(top)
    for (const b of subfolders(top)) if (!NOT_PROJECTS.has(b)) consider(join(top, b))
  }
  return out.sort((x, y) => y.projects - x.projects).slice(0, max)
}

// A working folder must be there; not a drive's root (every folder on it a project), not the agent's own folder
export function checkZone(path: string, selfDir: string) {
  const real = existingDir(path)
  if (parse(real).root === real) throw new ToolError('bad_request', `${real} is a drive root: pick a folder inside it`)
  if (isInside(selfDir, real)) throw new ToolError('bad_request', `${real} is the agent's own folder, there are no projects in it`)
  return real
}

// The config is the user's file: only zones change in it, the rest stays as written
export function saveZones(file: string, zones: Zone[]) {
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  raw.zones = zones
  writeConfigFile(file, raw)
}

export function createZones({ workspace, file, selfDir, home = homedir() }: {
  workspace: Workspace, file: string, selfDir: string, home?: string,
}) {
  function state(): ZonesState {
    const projects = workspace.list(true)
    const zones = workspace.zones()
    return {
      home,
      zones: zones.map(z => ({ path: z.path, projects: projects.filter(p => dirname(p.path) === z.path).length })),
      suggestions: suggestZones(home, zones.map(z => z.path), selfDir),
      roots: folderRoots(home),
    }
  }

  return {
    state,
    folders: (path?: string) => listFolders(path || home),
    // Applied at once, no restart; a folder that stays keeps what it excluded
    set(paths: string[]): ZonesState {
      const real = [...new Set(paths.map(p => checkZone(p, selfDir)))]
      const old = workspace.zones()
      const zones = real.map(path => ({ path, exclude: old.find(z => z.path === path)?.exclude ?? [] }))
      saveZones(file, zones)
      workspace.setZones(zones)
      return state()
    },
  }
}

export type Zones = ReturnType<typeof createZones>
