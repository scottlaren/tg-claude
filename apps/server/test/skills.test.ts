import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { skillHeader } from '@tgcv/protocol'
import { unzip } from '../src/zip.ts'
import { createSkills, findSkills, fromFile, fromGitHub, fromGitHubVia, parseGitHub, skillsBlock, NotPublic } from '../src/claude/skills.ts'

// A zip as an archiver writes it, CRCs aside (nothing here checks them)
function zip(files: { name: string, data?: string, deflate?: boolean, link?: boolean }[]) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const raw = Buffer.from(f.data ?? '')
    const body = f.deflate ? deflateRawSync(raw) : raw
    const name = Buffer.from(f.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(f.deflate ? 8 : 0, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(f.deflate ? 8 : 0, 10)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(((f.link ? 0o120777 : 0o100644) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    centrals.push(central, name)
    offset += 30 + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

const SKILL = (name: string, description = 'Fill in PDF forms') => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nRun scripts/fill.py on the computer.\n`

test('a zip unpacks stored and deflated files; a path that climbs out is refused and a link is left out', () => {
  const files = unzip(zip([{ name: 'pdf/' }, { name: 'pdf/SKILL.md', data: SKILL('pdf'), deflate: true }, { name: 'pdf/a.txt', data: 'plain' }, { name: 'pdf/link', data: '/etc/passwd', link: true }]), { files: 10, bytes: 1e6 })
  assert.deepEqual(files.map(f => f.path), ['pdf/SKILL.md', 'pdf/a.txt'])
  assert.match(files[0].data.toString(), /Fill in PDF forms/)
  assert.throws(() => unzip(zip([{ name: '../evil.sh', data: 'x' }]), { files: 10, bytes: 1e6 }), /unsafe path/)
  assert.throws(() => unzip(zip([{ name: 'big', data: 'x'.repeat(100) }]), { files: 10, bytes: 50 }), /MB unpacked/)
  assert.throws(() => unzip(zip([{ name: 'a' }, { name: 'b' }]), { files: 1, bytes: 1e6 }), /more than 1 files/)
})

test('a skill front matter: plain, quoted and folded descriptions', () => {
  assert.deepEqual(skillHeader('---\nname: pdf\ndescription: "Fill forms"\n---\nbody'), { name: 'pdf', description: 'Fill forms' })
  assert.deepEqual(skillHeader('---\nname: x\ndescription: >\n  First line\n  second line\nlicense: MIT\n---\n'), { name: 'x', description: 'First line second line' })
  assert.deepEqual(skillHeader('# no front matter'), {})
})

test('skills are found by their SKILL.md: a repository of several, a folder of one, a bad name or none said for', () => {
  const e = (path: string, text: string) => ({ path, data: Buffer.from(text) })
  const repo = [e('skills/pdf/SKILL.md', SKILL('pdf')), e('skills/pdf/scripts/fill.py', 'print()'), e('skills/pdf/inner/SKILL.md', SKILL('inner')), e('skills/docx/SKILL.md', SKILL('docx', 'Word files')), e('README.md', 'hi')]
  const all = findSkills(repo)
  assert.deepEqual(all.map(s => s.name).sort(), ['docx', 'pdf'], 'a SKILL.md inside a skill belongs to it')
  assert.deepEqual(all.find(s => s.name === 'pdf')!.files.map(f => f.path).sort(), ['SKILL.md', 'inner/SKILL.md', 'scripts/fill.py'])
  assert.deepEqual(findSkills(repo, 'skills/docx').map(s => s.name), ['docx'])
  assert.throws(() => findSkills([e('a/SKILL.md', SKILL('Bad Name!'))]), /Latin letters/)
  assert.throws(() => findSkills([e('a/SKILL.md', '---\nname: a\n---\n')]), /says nothing/)
})

test('GitHub links: a repository, a folder on a branch, a SKILL.md itself; anything else is not one', () => {
  assert.deepEqual(parseGitHub('https://github.com/anthropics/skills'), { owner: 'anthropics', repo: 'skills' })
  assert.deepEqual(parseGitHub('https://github.com/anthropics/skills/tree/main/skills/pdf'), { owner: 'anthropics', repo: 'skills', ref: 'main', path: 'skills/pdf' })
  assert.deepEqual(parseGitHub('github.com/a/b/blob/dev/x/SKILL.md'), { owner: 'a', repo: 'b', ref: 'dev', path: 'x' })
  assert.equal(parseGitHub('https://gitlab.com/a/b'), null)
})

test('a missing repository says so without downloading anything else', async () => {
  const get = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
  await assert.rejects(fromGitHub({ owner: 'a', repo: 'b' }, get), /no such public repository/)
})

test('a sent file: an archive or a lone SKILL.md; anything else is turned down', () => {
  assert.deepEqual(fromFile('pdf.skill', zip([{ name: 'pdf/SKILL.md', data: SKILL('pdf') }])).map(s => s.name), ['pdf'])
  assert.deepEqual(fromFile('SKILL.md', Buffer.from(SKILL('notes'))).map(s => s.name), ['notes'])
  assert.throws(() => fromFile('photo.jpg', Buffer.from([0xff, 0xd8, 0xff])), /zip or .skill archive/)
})

test('installed only once confirmed; read inside the skill only; removed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-skills-'))
  try {
    const s = createSkills(dir)
    const id = s.stage(fromFile('pdf.zip', zip([{ name: 'pdf/SKILL.md', data: SKILL('pdf') }, { name: 'pdf/ref/forms.md', data: 'Forms' }])))
    assert.deepEqual(s.list(), [], 'nothing before the tap')
    assert.deepEqual(s.commit(id), ['pdf'])
    assert.deepEqual(s.list(), [{ name: 'pdf', description: 'Fill in PDF forms' }])
    assert.match(s.read('pdf'), /Other files of this skill.*ref\/forms\.md/s)
    assert.equal(s.read('pdf', 'ref/forms.md'), 'Forms')
    writeFileSync(join(dir, 'secret.txt'), 'no')
    assert.throws(() => s.read('pdf', '../secret.txt'), /No file/)
    assert.throws(() => s.read('../pdf'), /No skill/)
    mkdirSync(join(dir, 'outside'))
    writeFileSync(join(dir, 'outside', 'x.md'), 'no')
    try {
      symlinkSync(join(dir, 'outside', 'x.md'), join(dir, 'pdf', 'link.md'))
      assert.throws(() => s.read('pdf', 'link.md'), /No file/)
    } catch (e) {
      // Windows without the right to make links: nothing to check there
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e
    }
    const dropped = s.stage(fromFile('x.md', Buffer.from(SKILL('other'))))
    s.drop(dropped)
    assert.deepEqual(s.commit(dropped), [])
    assert.ok(s.remove('pdf'))
    assert.ok(!existsSync(join(dir, 'pdf')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the prompt names skills by what they are for, and where each is read from', () => {
  assert.equal(skillsBlock([], []), '')
  const block = skillsBlock([{ name: 'pdf', description: 'Fill in\nPDF forms' }], [{ name: 'brand', description: 'Our colors', path: 'C:/p/.claude/skills/brand/SKILL.md' }])
  assert.match(block, /read_skill\):\n- pdf: Fill in PDF forms/)
  assert.match(block, /read_file at the path\):\n- brand: Our colors \(C:\/p\/\.claude\/skills\/brand\/SKILL\.md\)/)
})

test('a repository GitHub doesn\'t show is told apart, for the computer to try', async () => {
  const get = (async () => new Response('', { status: 404 })) as unknown as typeof fetch
  await assert.rejects(fromGitHub({ owner: 'a', repo: 'b' }, get), (e: Error) => e instanceof NotPublic)
})

// The computer, pretended: what it was asked to run, and what it answers
function computer(shell: string, answer: { code: number, out: string } = { code: 0, out: '' }) {
  const ran: string[] = []
  const pulled: string[] = []
  return {
    ran, pulled,
    via: {
      shell,
      run: async (c: string) => (ran.push(c), ran.length === 1 ? answer : { code: 0, out: '' }),
      pull: async (p: string) => { pulled.push(p); throw new Error('no such file') },
    },
  }
}

test('a private repository is cloned on the computer with no sign-in window, packed, and cleared away whatever happens', async () => {
  const c = computer('/bin/zsh')
  await assert.rejects(fromGitHubVia({ owner: 'scottlaren', repo: 'private-skill', ref: 'dev' }, c.via), /no such file/)
  const [clone, cleanup] = c.ran
  assert.match(clone, /^GIT_TERMINAL_PROMPT=0 git -c credential\.interactive=never clone --quiet --depth 1 --branch dev -- https:\/\/github\.com\/scottlaren\/private-skill\.git (\.tgcv-skill-[0-9a-f]{8}) && tar -czf \1\.tgz --exclude=\.git -C \1 \.; c=\$\?; rm -rf \1; exit \$c$/)
  const dir = /(\.tgcv-skill-[0-9a-f]{8})/.exec(clone)![1]
  assert.deepEqual(c.pulled, [`${dir}.tgz`])
  assert.equal(cleanup, `rm -f ${dir}.tgz`)
  const ps = computer('powershell.exe')
  await assert.rejects(fromGitHubVia({ owner: 'a', repo: 'b' }, ps.via))
  assert.match(ps.ran[0], /^\$env:GIT_TERMINAL_PROMPT = '0'; git .*; if \(\$LASTEXITCODE -eq 0\) \{ tar .* \}; .*Remove-Item -Recurse -Force/)
  assert.match(ps.ran[1], /^Remove-Item -Force \.tgcv-skill-[0-9a-f]{8}\.tgz/)
})

test('no access on the computer either says what to do; a branch that isn\'t plain is not run at all', async () => {
  const c = computer('bash', { code: 128, out: 'remote: Repository not found.\nfatal: repository \'https://github.com/a/b.git/\' not found' })
  await assert.rejects(fromGitHubVia({ owner: 'a', repo: 'b' }, c.via), /no access to a\/b either: sign in to GitHub on it/)
  const odd = computer('bash')
  await assert.rejects(fromGitHubVia({ owner: 'a', repo: 'b', ref: 'x;rm' }, odd.via), /can't be cloned/)
  assert.deepEqual(odd.ran, [])
})
