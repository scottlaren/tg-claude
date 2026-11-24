import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTextFile, writeTextFile, listFiles, readChunk, putFileChunk } from '../src/files.ts'
import { rootsOf } from '../src/executor.ts'
import { projectContext, claudeProjectDir, memoryDirOf, skillsDirOf, skillsIn, putSkill, removeSkill } from '../src/context.ts'

const code = (c: string) => (e: unknown) => (e as { code: string }).code === c

// code/repo + code/mfm-wt beside it + ~/.claude/projects/<repo>/memory
function layout() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-roots-')))
  const repo = join(base, 'code', 'repo')
  const wt = join(base, 'code', 'mfm-wt')
  const home = join(base, 'home')
  mkdirSync(repo, { recursive: true })
  mkdirSync(join(wt, 'chat-a'), { recursive: true })
  writeFileSync(join(repo, 'AGENTS.md'), '# Rules\nUse studio-open.ps1')
  writeFileSync(join(wt, 'studio-open.ps1'), 'Write-Host hi')
  writeFileSync(join(base, 'code', 'secret.env'), 'TOKEN=x')
  const memory = join(claudeProjectDir(repo, home), 'memory')
  mkdirSync(memory, { recursive: true })
  writeFileSync(join(memory, 'MEMORY.md'), '- [codex](codex-cli-images.md)')
  writeFileSync(join(memory, 'codex-cli-images.md'), 'codex exec ...')
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), 'Respond in Russian')
  const project = { id: 'mfm', name: 'MFM', path: repo, extraRoots: [wt], memoryDir: memoryDirOf(repo, home) }
  return { base, repo, wt, home, memory, project, roots: rootsOf(project) }
}

test('an extra root is reachable by absolute path, a sibling folder that is not one is not', async () => {
  const { base, wt, roots } = layout()
  const r = await readTextFile(roots, { path: join(wt, 'studio-open.ps1') })
  assert.deepEqual(r.lines, ['Write-Host hi'])
  await writeTextFile(roots, { path: join(wt, 'chat-a', 'build.luau'), content: 'x' })
  await assert.rejects(readTextFile(roots, { path: join(base, 'code', 'secret.env') }), code('outside_root'))
  await assert.rejects(readTextFile(roots, { path: '../secret.env' }), code('outside_root'))
})

test('memory can be read but not written', async () => {
  const { project, roots } = layout()
  const r = await readTextFile(roots, { path: join(project.memoryDir!, 'codex-cli-images.md') })
  assert.deepEqual(r.lines, ['codex exec ...'])
  await assert.rejects(writeTextFile(roots, { path: join(project.memoryDir!, 'new.md'), content: 'x' }), code('read_only'))
})

test('listing an extra root shows absolute paths, the project relative ones', async () => {
  const { wt, roots } = layout()
  const inWt = await listFiles(roots, { path: wt, depth: 1 })
  assert.ok(inWt.entries.some(e => e.path === `${wt.replace(/\\/g, '/')}/studio-open.ps1`))
  const inRepo = await listFiles(roots, { path: '.', depth: 1 })
  assert.ok(inRepo.entries.some(e => e.path === 'AGENTS.md'))
})

test('project context brings global CLAUDE.md, AGENTS.md and the memory index, nothing else', async () => {
  const { project, home } = layout()
  const ctx = await projectContext(project, home)
  assert.deepEqual(ctx.files.map(f => f.label), [
    'Global instructions (~/.tg-claude-vps/CLAUDE.md)', 'Project AGENTS.md', 'Memory index (MEMORY.md)',
  ])
  assert.match(ctx.files[1].content, /studio-open\.ps1/)
})

test("Claude Code's project folder name replaces every non-alphanumeric character", () => {
  assert.match(claudeProjectDir('C:\\Users\\admin\\Desktop\\code\\rbx-farm-game', 'H'), /C--Users-admin-Desktop-code-rbx-farm-game$/)
})

test('a shared folder (Downloads) is readable from any project, never writable, secrets stay closed', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-shared-')))
  const project = join(base, 'code', 'game')
  const downloads = join(base, 'Downloads')
  mkdirSync(project, { recursive: true })
  mkdirSync(downloads)
  writeFileSync(join(downloads, 'report.pdf.txt'), 'quarterly report\n')
  writeFileSync(join(downloads, '.env'), 'TOKEN=x')
  const roots = rootsOf({ id: 'game', name: 'game', path: project, extraRoots: [] }, [downloads])
  const r = await readTextFile(roots, { path: join(downloads, 'report.pdf.txt') })
  assert.deepEqual(r.lines, ['quarterly report', ''])
  const listed = await listFiles(roots, { path: downloads, depth: 1 })
  assert.ok(listed.entries.some(e => e.path.endsWith('/Downloads/report.pdf.txt')))
  await assert.rejects(writeTextFile(roots, { path: join(downloads, 'new.txt'), content: 'x' }), code('read_only'))
  await assert.rejects(putFileChunk(roots, { path: join(downloads, 'a.zip'), upload: 'u1', offset: 0, data: 'eA==', done: true, size: 1, sha256: '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881' }), code('read_only'))
  await assert.rejects(readChunk(roots, { path: join(downloads, '.env'), offset: 0, length: 10 }), code('outside_root'))
  const chunk = await readChunk(roots, { path: join(downloads, 'report.pdf.txt'), offset: 0, length: 100 })
  assert.equal(Buffer.from(chunk.data, 'base64').toString(), 'quarterly report\n')
})

test('memory and instructions are copied once to the agent\'s own folder, and Claude Code is no longer needed', async () => {
  const { repo, home, memory, project } = layout()
  const copy = project.memoryDir!
  assert.ok(copy.startsWith(join(home, '.tg-claude-vps')), copy)
  await projectContext(project, home)
  assert.ok(existsSync(join(memory, 'MEMORY.md')), 'the original stays')

  // What changes on Claude Code's side later doesn't come over
  writeFileSync(join(memory, 'MEMORY.md'), 'newer')
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), 'newer')
  assert.equal(memoryDirOf(repo, home), copy)
  assert.equal(readFileSync(join(copy, 'MEMORY.md'), 'utf8'), '- [codex](codex-cli-images.md)')

  // And its folder can go away
  rmSync(join(home, '.claude'), { recursive: true })
  assert.equal(memoryDirOf(repo, home), copy)
  const ctx = await projectContext(project, home)
  assert.deepEqual(ctx.files.map(f => f.content.slice(0, 7)), ['Respond', '# Rules', '- [code'])
  assert.equal(memoryDirOf(join(repo, 'other'), home), undefined, 'a project with no memory has none')
})

test("skills: the project's own and the user's on this computer, each by its SKILL.md; Claude Code's are not looked at", async () => {
  const { project, home, repo } = layout()
  const skill = (dir: string, text: string) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), text)
  }
  skill(join(repo, '.claude', 'skills', 'brand'), '---\nname: brand\ndescription: Our colors and fonts\n---\nUse #ff0')
  skill(join(repo, '.claude', 'skills', 'empty'), '# no front matter')
  skill(join(skillsDirOf(home), 'release'), '---\ndescription: How to release\n---\n')
  skill(join(home, '.claude', 'skills', 'theirs'), '---\nname: theirs\ndescription: Claude Code\'s own\n---\n')
  const ctx = await projectContext(project, home)
  assert.deepEqual(ctx.skills?.map(s => [s.name, s.scope, s.description]), [['brand', 'project', 'Our colors and fonts'], ['release', 'computer', 'How to release']])
  assert.match(ctx.skills![0].path, /\.claude\/skills\/brand\/SKILL\.md$/)
  assert.match(ctx.skills![0].content, /#ff0/)
  assert.deepEqual(await skillsIn(join(home, 'nowhere'), 'computer'), [])
})

test('a skill sent from the card goes whole into the project or the user\'s folder; a path out of it is refused', () => {
  const { project, home, repo } = layout()
  const b64 = (t: string) => Buffer.from(t).toString('base64')
  const mine = skillsDirOf(home)
  putSkill(project, { name: 'pdf', scope: 'project', files: [{ path: 'SKILL.md', data: b64('one') }, { path: 'scripts/fill.py', data: b64('print()') }] }, mine)
  assert.equal(readFileSync(join(repo, '.claude', 'skills', 'pdf', 'scripts', 'fill.py'), 'utf8'), 'print()')
  putSkill(project, { name: 'pdf', scope: 'project', files: [{ path: 'SKILL.md', data: b64('two') }] }, mine)
  assert.ok(!existsSync(join(repo, '.claude', 'skills', 'pdf', 'scripts')), 'a new version replaces the old one whole')
  putSkill(project, { name: 'release', scope: 'computer', files: [{ path: 'SKILL.md', data: b64('x') }] }, mine)
  assert.ok(existsSync(join(mine, 'release', 'SKILL.md')))
  assert.throws(() => putSkill(project, { name: 'bad', scope: 'project', files: [{ path: '../../evil.sh', data: b64('x') }] }, mine), /leaves its folder/)
  assert.throws(() => putSkill(project, { name: 'bad', scope: 'project', files: [{ path: '/etc/x', data: b64('x') }] }, mine), /leaves its folder/)
  assert.deepEqual(removeSkill(project, { name: 'release', scope: 'computer' }, mine), { removed: true })
  assert.deepEqual(removeSkill(project, { name: 'release', scope: 'computer' }, mine), { removed: false })
})
