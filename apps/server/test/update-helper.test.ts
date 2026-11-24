import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, symlinkSync, rmSync, lstatSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../../../deploy/tgcv-update.sh', import.meta.url))
const hasBash = (() => {
  try {
    return /Linux|Darwin|MINGW|MSYS/.test(execFileSync('bash', ['-c', 'uname -s'], { encoding: 'utf8' }))
  } catch {
    return false
  }
})()
const sh = (p: string) => p.replace(/\\/g, '/')
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim()

// The VPS in miniature: GitHub with v0.1.2 and v0.2.0, the server's checkout at v0.1.2, and a stand-in for docker
// that «starts» the code by writing what it would say when alive (or nothing, for a version that won't start)
function setup(newStarts: boolean, failingPrune = false) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-helper-')))
  const origin = join(base, 'origin')
  execFileSync('git', ['init', '-q', '-b', 'main', origin])
  mkdirSync(join(origin, 'deploy'))
  const release = (version: string) => {
    writeFileSync(join(origin, 'package.json'), `{\n  "name": "x",\n  "version": "${version}",\n  "private": true\n}\n`)
    writeFileSync(join(origin, 'deploy', 'tgcv-update.sh'), `# the helper of ${version}\n`)
    git(origin, 'add', '.')
    git(origin, 'commit', '-q', '-m', version)
    git(origin, 'tag', '-a', `v${version}`, '-m', version)
  }
  writeFileSync(join(origin, 'deploy', '.gitkeep'), '')
  release('0.1.2')
  const src = join(base, 'src')
  execFileSync('git', ['clone', '-q', origin, src])
  writeFileSync(join(src, 'deploy', '.env'), 'TG_TOKEN=x\nTGCV_VERSION=old\n')
  release('0.2.0')
  const dir = join(base, 'update')
  mkdirSync(dir)
  const docker = join(base, 'docker')
  writeFileSync(docker, `#!/usr/bin/env bash
v="$(sed -n 's/^ *"version" *: *"\\([^"]*\\)".*/\\1/p' ../package.json)"
echo "$*" >> "${sh(join(base, 'calls'))}"
if [ "$1" = builder ]; then ${failingPrune ? '[ "$4" = --reserved-space ] && exit 1' : 'true'}; exit 0; fi
echo "$v" >> "${sh(join(base, 'started'))}"
if [ "$v" = "0.1.2" ] || [ "${newStarts ? '1' : ''}" = 1 ]; then echo "$v" > "${sh(dir)}/alive"; fi
`)
  const run = (tag: string) => {
    writeFileSync(join(dir, 'request'), JSON.stringify({ tag, at: 1 }))
    execFileSync('bash', [sh(SCRIPT)], {
      env: { ...process.env, TGCV_SRC: sh(src), TGCV_UPDATE_DIR: sh(dir), TGCV_DOCKER: `bash ${sh(docker)}`, TGCV_UPDATE_WAIT: '3', TGCV_SELF: sh(self) },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    return JSON.parse(readFileSync(join(dir, 'result'), 'utf8'))
  }
  // Where root keeps its copy of the helper
  const self = join(base, 'installed-helper')
  return {
    src, dir, base, run, self,
    started: () => readFileSync(join(base, 'started'), 'utf8').trim().split('\n'),
    prunes: () => readFileSync(join(base, 'calls'), 'utf8').trim().split('\n').filter(c => c.startsWith('builder')),
  }
}

test('the helper moves the server to the release once the new version says it is alive', { skip: !hasBash }, () => {
  const { src, dir, run, started, self } = setup(true)
  assert.deepEqual(run('v0.2.0'), { ok: true, from: '0.1.2', to: '0.2.0' })
  assert.match(readFileSync(join(src, 'package.json'), 'utf8'), /"0\.2\.0"/)
  assert.match(readFileSync(join(src, 'deploy', '.env'), 'utf8'), /^TGCV_VERSION=[0-9a-f]{7,}$/m)
  assert.deepEqual(started(), ['0.2.0'])
  assert.equal(existsSync(join(dir, 'request')), false)
  // The release brings its own helper for the next time
  assert.match(readFileSync(self, 'utf8'), /helper of 0\.2\.0/)
})

test('after a good update the build cache is cut down to what it needs; a failure there changes nothing', { skip: !hasBash }, () => {
  const good = setup(true)
  assert.equal(good.run('v0.2.0').ok, true)
  assert.deepEqual(good.prunes(), ['builder prune -af --reserved-space 5GB'])
  // An older docker doesn't know the option
  const old = setup(true, true)
  assert.equal(old.run('v0.2.0').ok, true)
  assert.deepEqual(old.prunes(), ['builder prune -af --reserved-space 5GB', 'builder prune -af --keep-storage 5GB'])
})

test('a version that never comes up is rolled back, and the outcome is there for the old one to read', { skip: !hasBash }, () => {
  const { src, run, started, self, prunes } = setup(false)
  const r = run('v0.2.0')
  assert.equal(r.ok, false)
  assert.match(r.error, /did not come up.*rolled back to 0\.1\.2/)
  assert.match(readFileSync(join(src, 'package.json'), 'utf8'), /"0\.1\.2"/)
  assert.deepEqual(started(), ['0.2.0', '0.1.2'])
  assert.deepEqual(prunes(), [], 'what rolled back may be needed again')
  // A release that didn't come up doesn't get to replace the helper
  assert.equal(existsSync(self), false)
})

test('only a newer official tag is taken: older, the same, junk, or one GitHub lacks', { skip: !hasBash }, () => {
  const { run, base } = setup(true)
  assert.match(run('v0.1.0').error, /is not newer than/)
  assert.match(run('v0.1.2').error, /is not newer than/)
  assert.match(run('v9.9.9').error, /GitHub has no version v9\.9\.9/)
  assert.match(run('v0.2.0; rm -rf /').error, /has no version number/)
  assert.equal(existsSync(join(base, 'started')), false)
})

test('with no request the helper only checks: the tags GitHub has are left for the bot to read', { skip: !hasBash }, () => {
  const { dir, src, base } = setup(true)
  writeFileSync(join(dir, 'check'), '1')
  execFileSync('bash', [sh(SCRIPT)], { env: { ...process.env, TGCV_SRC: sh(src), TGCV_UPDATE_DIR: sh(dir), TGCV_TOKEN_FILE: sh(join(base, 'no-token')) }, stdio: 'ignore' })
  const tags = readFileSync(join(dir, 'tags.txt'), 'utf8')
  assert.match(tags, /refs\/tags\/v0\.1\.2/)
  assert.match(tags, /refs\/tags\/v0\.2\.0/)
  assert.equal(existsSync(join(dir, 'check')), false)
  // Not a GitHub origin here: no release notes to fetch, and none left over
  assert.equal(existsSync(join(dir, 'release.json')), false)
  assert.equal(existsSync(join(base, 'started')), false)
})

// The folder is the container's and the helper runs as root: a server taken over could leave a link there and have root
// write through it, or hand the target over to itself, anywhere on the VPS
const canLink = (dir: string) => {
  try {
    symlinkSync(join(dir, 'nothing'), join(dir, 'probe'), 'file')
    rmSync(join(dir, 'probe'))
    return true
  } catch {
    return false
  }
}
const SHARED = ['tags.tmp', 'release.tmp', 'result.tmp', 'tags.txt', 'release.json', 'result']

test('a link left in the shared folder sends no write of the helper anywhere', { skip: !hasBash }, t => {
  const { dir, src, base, run } = setup(true)
  if (!canLink(dir)) return t.skip('no links here')
  const victim = join(base, 'victim')
  writeFileSync(victim, 'untouched\n')
  const plant = () => {
    for (const name of SHARED) {
      rmSync(join(dir, name), { force: true })
      symlinkSync(victim, join(dir, name), 'file')
    }
  }
  plant()
  writeFileSync(join(dir, 'check'), '1')
  execFileSync('bash', [sh(SCRIPT)], { env: { ...process.env, TGCV_SRC: sh(src), TGCV_UPDATE_DIR: sh(dir), TGCV_TOKEN_FILE: sh(join(base, 'no-token')) }, stdio: 'ignore' })
  assert.equal(readFileSync(victim, 'utf8'), 'untouched\n', 'a look for releases')
  assert.match(readFileSync(join(dir, 'tags.txt'), 'utf8'), /refs\/tags\/v0\.2\.0/)
  assert.equal(lstatSync(join(dir, 'tags.txt')).isSymbolicLink(), false, 'the link itself is gone')
  plant()
  assert.equal(run('v0.1.0').ok, false)
  assert.equal(readFileSync(victim, 'utf8'), 'untouched\n', 'an answer to a request')
  assert.equal(lstatSync(join(dir, 'result')).isSymbolicLink(), false)
  plant()
  assert.equal(run('v0.2.0').ok, true)
  assert.equal(readFileSync(victim, 'utf8'), 'untouched\n', 'a whole update')
})

test('a folder left in the way of an answer does not swallow it', { skip: !hasBash }, () => {
  const { dir, run } = setup(true)
  mkdirSync(join(dir, 'result'))
  writeFileSync(join(dir, 'result', 'x'), 'x')
  assert.equal(run('v0.1.0').ok, false)
})

test('the helper leaves nothing of its own behind next to the shared folder', { skip: !hasBash }, () => {
  const { base, run } = setup(true)
  assert.equal(run('v0.2.0').ok, true)
  assert.deepEqual(readdirSync(base).filter(n => n.startsWith('.tgcv')), [])
})
