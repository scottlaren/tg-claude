import { readFile, readdir } from 'node:fs/promises'
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { skillHeader, DEVICE_SKILL_BYTES, type ContextFile, type DeviceSkill, type Project, type ProjectContext, type SkillPut } from '@tgcv/protocol'
import { ToolError } from './paths.ts'

const FILE_CAP = 40_000
// Each skill costs a line of Claude's prompt in every turn
const SKILLS_MAX = 40
const DESCRIPTION_CAP = 400

// Claude Code keeps per-project data in ~/.claude/projects/<path with every non-alphanumeric as '-'>
export const claudeProjectDir = (projectPath: string, home = homedir()) =>
  join(home, '.claude', 'projects', projectPath.replace(/[^a-zA-Z0-9]/g, '-'))

// The agent's own copies, outside its checkout so that an update leaves them alone. Claude Code's are taken once,
// never changed, and from then on nothing depends on them
const ownDir = (home: string) => join(home, '.tg-claude-vps')
function copyOnce(from: string, to: string) {
  if (existsSync(to)) return true
  if (!existsSync(from)) return false
  const temp = `${to}.tmp-${process.pid}`
  try {
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, temp, { recursive: true })
    renameSync(temp, to)
    return true
  } catch {
    rmSync(temp, { recursive: true, force: true })
    return false
  }
}

// The user's own skills on this computer, for every project: Claude reads them there, read-only
export const skillsDirOf = (home = homedir()) => join(ownDir(home), 'skills')

// Each folder with a SKILL.md that says what it is for
export async function skillsIn(dir: string, scope: DeviceSkill['scope']): Promise<DeviceSkill[]> {
  const names = await readdir(dir, { withFileTypes: true }).then(l => l.filter(e => e.isDirectory()).map(e => e.name).sort(), () => [])
  const out: DeviceSkill[] = []
  for (const folder of names) {
    if (out.length >= SKILLS_MAX) break
    const path = join(dir, folder, 'SKILL.md')
    const content = await readFile(path, 'utf8').catch(() => null)
    if (!content) continue
    const head = skillHeader(content)
    if (!head.description) continue
    out.push({ name: head.name ?? folder, description: head.description.slice(0, DESCRIPTION_CAP), path: path.replace(/\\/g, '/'), scope, content: content.slice(0, FILE_CAP), modified: statSync(path).mtimeMs })
  }
  return out
}

// skillsDir: the user's own skills on this computer (skillsDirOf)
const skillFolder = (project: Project, scope: DeviceSkill['scope'], name: string, skillsDir: string) =>
  scope === 'project' ? join(project.path, '.claude', 'skills', name) : join(skillsDir, name)

// Only at the user's tap on the server's card. Written aside and then swapped in: a skill is never half there
export function putSkill(project: Project, p: SkillPut, skillsDir = skillsDirOf()) {
  const files = p.files.map(f => ({ raw: f.path, parts: f.path.replace(/\\/g, '/').split('/').filter(x => x && x !== '.'), data: Buffer.from(f.data, 'base64') }))
  if (files.some(f => !f.parts.length || f.parts.includes('..') || /^[a-zA-Z]:/.test(f.parts[0]) || /^[\\/]/.test(f.raw))) throw new ToolError('bad_request', 'A path in the skill leaves its folder')
  if (files.reduce((n, f) => n + f.data.length, 0) > DEVICE_SKILL_BYTES) throw new ToolError('bad_request', 'The skill is too big to send to a computer')
  const dir = skillFolder(project, p.scope, p.name, skillsDir)
  const temp = `${dir}.tmp-${process.pid}`
  rmSync(temp, { recursive: true, force: true })
  try {
    for (const f of files) {
      const to = join(temp, ...f.parts)
      mkdirSync(dirname(to), { recursive: true })
      writeFileSync(to, f.data)
    }
    rmSync(dir, { recursive: true, force: true })
    renameSync(temp, dir)
  } catch (e) {
    rmSync(temp, { recursive: true, force: true })
    throw e
  }
  return { path: dir.replace(/\\/g, '/'), files: files.length }
}

export function removeSkill(project: Project, p: { name: string, scope: DeviceSkill['scope'] }, skillsDir = skillsDirOf()) {
  const dir = skillFolder(project, p.scope, p.name, skillsDir)
  if (!existsSync(join(dir, 'SKILL.md'))) return { removed: false }
  rmSync(dir, { recursive: true, force: true })
  return { removed: true }
}

export function memoryDirOf(projectPath: string, home = homedir()) {
  const own = join(ownDir(home), 'memory', projectPath.replace(/[^a-zA-Z0-9]/g, '-'))
  return copyOnce(join(claudeProjectDir(projectPath, home), 'memory'), own) ? own : undefined
}

// What Claude gets on its own: the user's global instructions, the project's
// CLAUDE.md / AGENTS.md, and the index of its memory; memory topic files are read on demand
export async function projectContext(project: Project, home = homedir()): Promise<ProjectContext> {
  const instructions = join(ownDir(home), 'CLAUDE.md')
  copyOnce(join(home, '.claude', 'CLAUDE.md'), instructions)
  const candidates: [string, string][] = [
    ['Global instructions (~/.tg-claude-vps/CLAUDE.md)', instructions],
    ['Project CLAUDE.md', join(project.path, 'CLAUDE.md')],
    ['Project .claude/CLAUDE.md', join(project.path, '.claude', 'CLAUDE.md')],
    ['Project CLAUDE.local.md', join(project.path, 'CLAUDE.local.md')],
    ['Project AGENTS.md', join(project.path, 'AGENTS.md')],
  ]
  if (project.memoryDir) candidates.push(['Memory index (MEMORY.md)', join(project.memoryDir, 'MEMORY.md')])

  const files: ContextFile[] = []
  for (const [label, path] of candidates) {
    const text = await readFile(path, 'utf8').catch(() => null)
    if (text === null || !text.trim()) continue
    const truncated = text.length > FILE_CAP
    files.push({ label, path: path.replace(/\\/g, '/'), content: truncated ? text.slice(0, FILE_CAP) : text, truncated, modified: statSync(path).mtimeMs })
  }
  const skills = [...await skillsIn(join(project.path, '.claude', 'skills'), 'project'), ...await skillsIn(skillsDirOf(home), 'computer')]
  return { files, project, skills }
}
