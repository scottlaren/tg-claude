import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { RELEASE_TAG, releaseOf, UPDATE_UNREACHED, type SelfUpdateResult } from '@tgcv/protocol'

const exec = promisify(execFile)

// The exit code that asks the service to start the agent again at once: the new code loads on that start
export const RESTART_CODE = 75

// Never a login prompt in the background (a window from Git Credential Manager would wait forever): the
// computer's own git sign-in works or the update fails and says so
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
const git = async (root: string, ...args: string[]) => (await exec('git', args, { cwd: root, windowsHide: true, timeout: 120_000, env: GIT_ENV })).stdout.trim()
const FETCH_TRIES = 3
// GitHub asking for credentials: trying again changes nothing
const SIGN_IN = /authentication|could not read username|permission denied|403/i
const why = (e: unknown) => ((e as { stderr?: string }).stderr?.trim() || (e as Error).message).split('\n')[0].slice(0, 200)

// Dependencies for the checkout as it is now; Windows runs npm.cmd only through the shell
export const npmCi = (root: string) => new Promise<void>((resolve, reject) => {
  const p = spawn('npm', ['ci', '--no-audit', '--no-fund'], { cwd: root, shell: process.platform === 'win32', windowsHide: true, stdio: 'ignore' })
  p.on('error', reject)
  p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`npm ci exited with code ${code}`))))
})

// The checkout the agent runs from, moved to a release tag. Only a plain install is touched: on main or exactly
// on a release, with no changes of its own. Dependencies are reinstalled only when the lockfile changed; any
// failure puts the checkout back where it was, so the agent keeps working on the old version
export async function selfUpdate({ root, tag, npm = npmCi, fetchPauseMs = 5000 }: { root: string, tag: string, npm?: (root: string) => Promise<void>, fetchPauseMs?: number }): Promise<SelfUpdateResult> {
  const from = releaseOf(root)
  const to = tag.replace(/^v/, '')
  const fail = (error: string, dev = false): SelfUpdateResult => ({ ok: false, from, to, error, ...(dev && { dev: true }) })
  if (!RELEASE_TAG.test(tag)) return fail(`not a version number: ${tag}`)

  let head: string
  try {
    head = await git(root, 'rev-parse', 'HEAD')
  } catch {
    return fail('the agent folder is not a git checkout: update it by hand')
  }
  if (await git(root, 'status', '--porcelain', '--untracked-files=no')) return fail('the agent folder has local changes: update it yourself', true)
  const branch = await git(root, 'rev-parse', '--abbrev-ref', 'HEAD')
  const onRelease = await git(root, 'describe', '--tags', '--exact-match', 'HEAD').then(t => RELEASE_TAG.test(t), () => false)
  if (branch !== 'main' && !(branch === 'HEAD' && onRelease)) return fail(`the agent is on branch ${branch}: update it yourself`, true)

  // A dropped connection («schannel: failed to receive handshake») is tried again; a sign-in GitHub asks for is not
  for (let attempt = 1; ; attempt++) {
    try {
      await git(root, 'fetch', '--quiet', '--tags', 'origin')
      break
    } catch (e) {
      const reason = why(e)
      if (SIGN_IN.test(reason)) return fail(`cannot download from GitHub: it asks for a git sign-in on this computer: ${reason}`)
      if (attempt >= FETCH_TRIES) return fail(`${UPDATE_UNREACHED}, the connection dropped: ${reason}`)
      await new Promise(r => setTimeout(r, fetchPauseMs * attempt))
    }
  }
  const target = await git(root, 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`).catch(() => '')
  if (!target) return fail(`GitHub has no version ${tag}`)
  const lockChanged = await git(root, 'diff', '--quiet', head, target, '--', 'package-lock.json').then(() => false, () => true)

  try {
    // On main it stays on main (the release is on it); a release checkout moves to the new release
    if (branch === 'main') await git(root, 'merge', '--quiet', '--ff-only', target)
    else await git(root, 'checkout', '--quiet', '--detach', target)
    if (lockChanged) await npm(root)
    return { ok: true, from, to }
  } catch (e) {
    if (branch === 'main') await git(root, 'reset', '--quiet', '--hard', head).catch(() => {})
    else await git(root, 'checkout', '--quiet', '--detach', head).catch(() => {})
    // A half-done npm ci leaves node_modules broken for the old version too
    if (lockChanged) await npm(root).catch(() => {})
    return fail(`${why(e)}; still on version ${from}`)
  }
}

// A computer set up by the one line from /pair has no git: its updates come from the server as the same archive
// the installer downloaded, opened by its own key and checked against the checksum the server sent with the
// request. The new code goes in beside the old and is swapped in whole; anything wrong puts the old one back
const SWAP = ['apps', 'packages', 'node_modules', 'package.json']
const tarBin = () => (process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar')

export async function bundleUpdate({ root, tag, sha256, serverUrl, deviceId, key, get = fetch }: {
  root: string, tag: string, sha256?: string, serverUrl: string, deviceId: string, key: string, get?: typeof fetch,
}): Promise<SelfUpdateResult> {
  const from = releaseOf(root)
  const to = tag.replace(/^v/, '')
  const fail = (error: string): SelfUpdateResult => ({ ok: false, from, to, error })
  if (!RELEASE_TAG.test(tag)) return fail(`not a version number: ${tag}`)
  const url = serverUrl.replace(/^ws/, 'http').replace(/\/device\/?$/, '') + '/agent/bundle'
  let data: Buffer
  try {
    const res = await get(url, { headers: { 'x-tgcv-device': deviceId, 'x-tgcv-key': key }, signal: AbortSignal.timeout(5 * 60_000) })
    if (!res.ok) return fail(`the server did not hand over the agent (HTTP ${res.status})`)
    data = Buffer.from(await res.arrayBuffer())
  } catch (e) {
    return fail(`cannot download from the server: ${why(e)}`)
  }
  if (sha256 && createHash('sha256').update(data).digest('hex') !== sha256) return fail('the archive from the server is damaged (checksum mismatch)')

  const fresh = join(root, '.update')
  const old = join(root, '.old')
  rmSync(fresh, { recursive: true, force: true })
  rmSync(old, { recursive: true, force: true })
  mkdirSync(fresh, { recursive: true })
  mkdirSync(old, { recursive: true })
  const moved: string[] = []
  try {
    writeFileSync(join(fresh, 'agent.tar.gz'), data)
    await exec(tarBin(), ['-xzf', 'agent.tar.gz'], { cwd: fresh, windowsHide: true, timeout: 5 * 60_000 })
    rmSync(join(fresh, 'agent.tar.gz'))
    if (releaseOf(fresh) !== to) return fail(`the server sent version ${releaseOf(fresh)}, not ${to}`)
    for (const name of SWAP) {
      if (existsSync(join(root, name))) renameSync(join(root, name), join(old, name))
      moved.push(name)
      renameSync(join(fresh, name), join(root, name))
    }
    linkProtocol(root)
    return { ok: true, from, to }
  } catch (e) {
    // Back to the old code, whatever got as far as it did
    for (const name of moved.reverse()) {
      rmSync(join(root, name), { recursive: true, force: true })
      if (existsSync(join(old, name))) renameSync(join(old, name), join(root, name))
    }
    return fail(`${why(e)}; still on version ${from}`)
  } finally {
    rmSync(fresh, { recursive: true, force: true })
    rmSync(old, { recursive: true, force: true })
  }
}

// The protocol package lives in packages/ and is linked into node_modules: a junction on Windows needs no admin
export function linkProtocol(root: string) {
  const link = join(root, 'node_modules', '@tgcv', 'protocol')
  mkdirSync(dirname(link), { recursive: true })
  rmSync(link, { recursive: true, force: true })
  symlinkSync(join(root, 'packages', 'protocol'), link, 'junction')
}
