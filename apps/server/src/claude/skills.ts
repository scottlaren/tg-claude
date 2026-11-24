import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { randomBytes } from 'node:crypto'
import { skillHeader, type DeviceSkill } from '@tgcv/protocol'
import { isZip, safeEntryPath, unzip, type ZipEntry } from '../zip.ts'

// Skills on the server, for every topic. Not Claude Code's own skills: those would come with its Skill tool and its
// shell, on the server. Here Claude reads a skill through the bot like any text, and does what it says on the computer.
// A skill is someone else's instructions in every topic from then on, so only the user's tap installs one
export const SKILLS_SERVER = 'skills'
export const READ_SKILL = `mcp__${SKILLS_SERVER}__read_skill`
export const INSTALL_SKILL = `mcp__${SKILLS_SERVER}__install_skill`
export const REMOVE_SKILL = `mcp__${SKILLS_SERVER}__remove_skill`
export const isSkillTool = (t: string) => t === READ_SKILL || t === INSTALL_SKILL || t === REMOVE_SKILL

export const SKILL_LIMITS = { files: 500, bytes: 20 * 1024 * 1024 }
const DOWNLOAD_MAX = 50 * 1024 * 1024
const READ_CAP = 100_000
const FOUND_MAX = 20
const DESCRIPTION_CAP = 400
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/

export type Skill = { name: string, description: string }
// Where a skill lives: on the server for every topic, in the user's folder on one computer, or in one project
export type SkillScope = 'everywhere' | 'computer' | 'project'
export type FoundSkill = Skill & { files: ZipEntry[] }

// Every folder with a SKILL.md, not inside another; under `under` only when given (a folder of a repository)
export function findSkills(entries: ZipEntry[], under = ''): FoundSkill[] {
  const prefix = under ? `${under.replace(/^\/+|\/+$/g, '')}/` : ''
  const files = prefix ? entries.filter(e => e.path.startsWith(prefix)).map(e => ({ ...e, path: e.path.slice(prefix.length) })) : entries
  const dirs = files.filter(e => posix.basename(e.path) === 'SKILL.md').map(e => posix.dirname(e.path)).sort((a, b) => a.length - b.length)
  const tops: string[] = []
  for (const d of dirs) if (!tops.some(t => t === '.' || d.startsWith(`${t}/`))) tops.push(d)
  const out: FoundSkill[] = []
  for (const d of tops.slice(0, FOUND_MAX)) {
    const inside = d === '.' ? files : files.filter(e => e.path.startsWith(`${d}/`)).map(e => ({ ...e, path: e.path.slice(d.length + 1) }))
    const head = skillHeader(inside.find(e => e.path === 'SKILL.md')!.data.toString('utf8'))
    const folder = d === '.' ? posix.basename(prefix.replace(/\/$/, '')) : posix.basename(d)
    const name = (head.name ?? folder).trim().toLowerCase().replace(/\s+/g, '-')
    if (!NAME.test(name)) throw new Error(`a skill's name must be Latin letters, digits and dashes: «${head.name ?? folder}»`)
    if (!head.description) throw new Error(`the skill «${name}» says nothing of what it is for (no description in its SKILL.md)`)
    out.push({ name, description: head.description.slice(0, DESCRIPTION_CAP), files: inside.filter(e => !e.path.split('/').includes('.git')) })
  }
  return out
}

// github.com/<owner>/<repo>[/tree|blob/<ref>/<path>]: a ref with a slash in it can't be told from the path, so the
// first part is taken for the ref
export function parseGitHub(url: string): { owner: string, repo: string, ref?: string, path?: string } | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/?#]+)(?:\/([^?#]*))?)?\/?(?:[?#].*)?$/.exec(url.trim())
  if (!m) return null
  const path = m[4]?.replace(/\/+$/, '').replace(/(^|\/)SKILL\.md$/, '')
  return { owner: m[1], repo: m[2], ...(m[3] && { ref: m[3] }), ...(path && { path }) }
}

// A folder of a downloaded repository as entries, within the same limits as an archive, links left out
export function readTree(root: string, limits = SKILL_LIMITS): ZipEntry[] {
  const out: ZipEntry[] = []
  let bytes = 0
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const full = join(dir, e.name)
      const path = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(full, path)
      else if (e.isFile()) {
        bytes += lstatSync(full).size
        if (out.length >= limits.files) throw new Error(`more than ${limits.files} files`)
        if (bytes > limits.bytes) throw new Error(`more than ${Math.round(limits.bytes / 1048576)} MB`)
        out.push({ path, data: readFileSync(full) })
      }
    }
  }
  walk(root, '')
  return out
}

const run = promisify(execFile)
type GitHubPlace = NonNullable<ReturnType<typeof parseGitHub>>

// GitHub's answer to a repository it doesn't show: none, or a private one
export class NotPublic extends Error {}

export async function fromGitHub(g: GitHubPlace, get: typeof fetch = fetch): Promise<FoundSkill[]> {
  const res = await get(`https://codeload.github.com/${g.owner}/${g.repo}/tar.gz/${g.ref ?? 'HEAD'}`, { redirect: 'follow', signal: AbortSignal.timeout(90_000) })
  if (res.status === 404) throw new NotPublic('GitHub has no such public repository or branch')
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  const data = Buffer.from(await res.arrayBuffer())
  if (data.length > DOWNLOAD_MAX) throw new Error('the repository is too big to download')
  return fromTarball(data, g, true)
}

// A repository packed as .tar.gz: GitHub's own, with the repository in a folder, or one the computer made, without
async function fromTarball(data: Buffer, g: GitHubPlace, wrapped: boolean): Promise<FoundSkill[]> {
  const tmp = mkdtempSync(join(tmpdir(), 'tgcv-skill-'))
  try {
    writeFileSync(join(tmp, 'repo.tgz'), data)
    mkdirSync(join(tmp, 'out'))
    await run('tar', ['-xzf', join(tmp, 'repo.tgz'), '-C', join(tmp, 'out'), '--no-same-owner', '--no-same-permissions'])
    const [top] = readdirSync(join(tmp, 'out'))
    if (!top) throw new Error('the download was empty')
    const root = join(tmp, 'out', ...(wrapped ? [top] : []), ...(g.path ? g.path.split('/') : []))
    if (!existsSync(root) || !lstatSync(root).isDirectory()) throw new Error(`no folder ${g.path} in ${g.owner}/${g.repo}`)
    let tree: ZipEntry[]
    try {
      tree = readTree(root)
    } catch (e) {
      throw new Error(`${(e as Error).message} there: give the link to one skill's folder`)
    }
    return findSkills(tree)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// A file the user sent: an archive (.zip, .skill) or a lone SKILL.md
// The user's computer, for what the server can't reach: it runs a command in the project and hands over a file of it
export type Via = { shell: string, run: (command: string) => Promise<{ code: number, out: string }>, pull: (path: string) => Promise<Buffer> }

// A private repository, cloned on the user's computer with its own sign-in to GitHub, packed and brought over. Never a
// window asking to sign in: there is nobody at it to answer. The clone and the pack go the moment they are read
export async function fromGitHubVia(g: GitHubPlace, via: Via): Promise<FoundSkill[]> {
  if (g.ref && !/^[\w./-]+$/.test(g.ref)) throw new Error(`the branch «${g.ref}» can't be cloned from here`)
  const dir = `.tgcv-skill-${randomBytes(4).toString('hex')}`
  const ps = /powershell|pwsh/i.test(via.shell)
  const clone = `git -c credential.interactive=never clone --quiet --depth 1${g.ref ? ` --branch ${g.ref}` : ''} -- https://github.com/${g.owner}/${g.repo}.git ${dir}`
  const pack = `tar -czf ${dir}.tgz --exclude=.git -C ${dir} .`
  const command = ps
    ? `$env:GIT_TERMINAL_PROMPT = '0'; ${clone}; if ($LASTEXITCODE -eq 0) { ${pack} }; $c = $LASTEXITCODE; Remove-Item -Recurse -Force ${dir} -ErrorAction SilentlyContinue; exit $c`
    : `GIT_TERMINAL_PROMPT=0 ${clone} && ${pack}; c=$?; rm -rf ${dir}; exit $c`
  try {
    const r = await via.run(command)
    if (r.code !== 0) {
      if (/not found|could not read|authentication|denied|terminal prompts disabled|403|401/i.test(r.out)) throw new Error(`the computer has no access to ${g.owner}/${g.repo} either: sign in to GitHub on it (gh auth login, or Git Credential Manager), or check the link`)
      throw new Error(`cloning on the computer failed: ${r.out.trim().split('\n').filter(Boolean).at(-1) ?? `code ${r.code}`}`)
    }
    return await fromTarball(await via.pull(`${dir}.tgz`), g, false)
  } finally {
    await via.run(ps ? `Remove-Item -Force ${dir}.tgz -ErrorAction SilentlyContinue` : `rm -f ${dir}.tgz`).catch(() => {})
  }
}

export function fromFile(name: string, data: Buffer): FoundSkill[] {
  if (isZip(data)) return findSkills(unzip(data, SKILL_LIMITS))
  if (/\.md$/i.test(name) || data.subarray(0, 4).toString('utf8').replace(/^﻿/, '').startsWith('---')) {
    const folder = /^skill\.md$/i.test(name) ? '' : name.replace(/\.md$/i, '')
    return findSkills([{ path: folder ? `${folder}/SKILL.md` : 'SKILL.md', data }])
  }
  throw new Error('send the skill as a .zip or .skill archive, or as its SKILL.md')
}

export function createSkills(dir: string) {
  mkdirSync(dir, { recursive: true })
  const staging = join(dir, '.staging')
  // What was never confirmed before a restart goes
  rmSync(staging, { recursive: true, force: true })
  const skillDir = (name: string) => (NAME.test(name) ? join(dir, name) : null)

  function list(): Skill[] {
    return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).flatMap(e => {
      const md = join(dir, e.name, 'SKILL.md')
      if (!existsSync(md)) return []
      return [{ name: e.name, description: skillHeader(readFileSync(md, 'utf8')).description?.slice(0, DESCRIPTION_CAP) ?? '' }]
    })
  }

  function filesOf(name: string) {
    const d = skillDir(name)
    return d && existsSync(d) ? readTree(d).map(e => e.path).sort() : []
  }

  return {
    list,
    has: (name: string) => !!skillDir(name) && existsSync(join(dir, name, 'SKILL.md')),
    // Written aside until the user's tap: nothing of it is a skill yet
    stage(found: FoundSkill[]) {
      const id = randomBytes(4).toString('hex')
      for (const s of found) {
        for (const f of s.files) {
          const path = safeEntryPath(f.path)
          if (!path) continue
          const to = join(staging, id, s.name, ...path.split('/'))
          mkdirSync(dirname(to), { recursive: true })
          writeFileSync(to, f.data)
        }
      }
      return id
    },
    commit(id: string): string[] {
      const from = join(staging, id)
      if (!/^[0-9a-f]{8}$/.test(id) || !existsSync(from)) return []
      const names = readdirSync(from)
      for (const name of names) {
        rmSync(join(dir, name), { recursive: true, force: true })
        renameSync(join(from, name), join(dir, name))
      }
      rmSync(from, { recursive: true, force: true })
      return names
    },
    // What the user is about to send to a computer instead
    staged(id: string) {
      const from = join(staging, id)
      if (!/^[0-9a-f]{8}$/.test(id) || !existsSync(from)) return []
      return readdirSync(from).map(name => ({ name, files: readTree(join(from, name)) }))
    },
    drop: (id: string) => /^[0-9a-f]{8}$/.test(id) && rmSync(join(staging, id), { recursive: true, force: true }),
    remove(name: string) {
      const d = skillDir(name)
      if (!d || !existsSync(d)) return false
      rmSync(d, { recursive: true, force: true })
      return true
    },
    // A file of a skill as text, never anything outside it
    read(name: string, file = 'SKILL.md'): string {
      const d = skillDir(name)
      if (!d || !existsSync(join(d, 'SKILL.md'))) throw new Error(`No skill «${name}» on the server. Installed: ${list().map(s => s.name).join(', ') || 'none'}.`)
      const path = safeEntryPath(file)
      const full = path && join(d, ...path.split('/'))
      if (!full || !existsSync(full) || !lstatSync(full).isFile()) throw new Error(`No file ${file} in the skill «${name}». Its files: ${filesOf(name).join(', ')}.`)
      const data = readFileSync(full)
      if (data.subarray(0, 8000).includes(0)) throw new Error(`${file} is not a text file.`)
      const text = data.toString('utf8')
      const body = text.length > READ_CAP ? `${text.slice(0, READ_CAP)}\n\n[cut at ${READ_CAP} characters]` : text
      if (path !== 'SKILL.md') return body
      const others = filesOf(name).filter(f => f !== 'SKILL.md')
      return others.length ? `${body}\n\n---\nOther files of this skill (read them with read_skill and file): ${others.join(', ')}` : body
    },
  }
}
export type Skills = ReturnType<typeof createSkills>

const reply = (text: string) => ({ content: [{ type: 'text' as const, text }] })

export function createSkillsServer(h: { read: (name: string, file?: string) => string, install: (source: string) => Promise<string>, remove: (name: string, where?: SkillScope) => Promise<string> }) {
  return createSdkMcpServer({
    name: SKILLS_SERVER,
    tools: [
      tool('read_skill', 'Read a skill installed on the server: its SKILL.md, or another of its files by its path inside the skill.',
        { name: z.string().min(1).max(64), file: z.string().max(300).optional().describe('Path inside the skill, e.g. reference/forms.md; default SKILL.md') },
        async a => {
          try { return reply(h.read(a.name, a.file)) } catch (e) { return { ...reply((e as Error).message), isError: true } }
        }),
      tool('install_skill', 'Install a skill: only when the user asks for it. The source is the id of a file the user sent (a .zip or .skill archive, or a SKILL.md), a GitHub link to a skill\'s folder or to a repository of skills (a private one is cloned on this topic\'s computer, with its sign-in to GitHub), or the path of such a file on the computer. Give the link as it is: don\'t clone or pack it yourself. The user sees what it is and picks where it goes with a button: everywhere (every topic and computer), this computer (all its projects) or this project. Nothing is installed until then; don\'t ask where yourself.',
        { source: z.string().min(1).max(500).describe('📎 attachment id (8 hex characters), https://github.com/… link, or a file\'s path on the computer') },
        async a => reply(await h.install(a.source))),
      tool('remove_skill', 'Remove an installed skill. The user confirms with a button.',
        { name: z.string().min(1).max(64), where: z.enum(['everywhere', 'computer', 'project']).optional().describe('Only when it is installed in more than one place') },
        async a => reply(await h.remove(a.name, a.where))),
    ],
    alwaysLoad: true,
  })
}

// Named in the prompt by what they are for: Claude reads one when a task fits it
export function skillsBlock(server: Skill[], device: Pick<DeviceSkill, 'name' | 'description' | 'path'>[]) {
  if (!server.length && !device.length) return ''
  const line = (s: Skill, where = '') => `- ${s.name}: ${s.description.replace(/\s+/g, ' ')}${where}`
  return `

# Skills
Instructions for particular kinds of work, installed by the user. When a task fits one, read it before you start and follow it.${server.length ? `
Everywhere (read with read_skill):
${server.map(s => line(s)).join('\n')}` : ''}${device.length ? `
On this computer and in this project (read with read_file at the path):
${device.map(s => line(s, ` (${s.path})`)).join('\n')}` : ''}
A skill's scripts and commands run on the computer, like everything else: the files of a skill read with read_skill go there with write_file first.`
}
