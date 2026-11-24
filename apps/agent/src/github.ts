import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitHubLogin, GitHubStatus, GitHubToken } from '@tgcv/protocol'
import { ToolError } from './paths.ts'

const exec = promisify(execFile)
const gh = (args: string[]) => exec('gh', args, { timeout: 20_000, windowsHide: true }).then(r => r.stdout.trim())
// Tokens go through stdin, never arguments: a process list would show those
const feed = (cmd: string, args: string[], input: string, env = process.env) => new Promise<string>((resolve, reject) => {
  const p = execFile(cmd, args, { timeout: 20_000, windowsHide: true, env }, (e, stdout, stderr) => (e ? reject(Object.assign(e, { stderr })) : resolve(stdout)))
  p.stdin?.end(input)
})
const TOKEN = /^[\w-]{20,255}$/

const CODE = /one-time code: ([A-Z0-9]{4}-[A-Z0-9]{4})/
const URL_RE = /https:\/\/github\.com\/login\/device\S*/
// GitHub's device codes live 15 minutes; a little less, so a code shown again is never already dead
const CODE_TTL_MS = 14 * 60_000

// GitHub for the cloud workspace. It signs in either with the access a computer of the user already has
// (handed over through the server) or with a one-time code the user types on github.com (device flow);
// then the official CLI serves git as its credential helper. Only the cloud's own sign-in ever changes here
export function createGitHub(log: (...a: unknown[]) => void, { cloud = false } = {}) {
  let pending: { code: string, url: string, at: number, proc: ChildProcess } | null = null
  const cloudOnly = () => {
    if (!cloud) throw new ToolError('bad_request', 'The GitHub sign-in is changed only in the cloud')
  }

  // The access this computer already has, for the cloud: gh's own, else what git keeps for github.com.
  // Nothing may prompt or open a browser on a computer nobody is looking at
  async function token(): Promise<GitHubToken> {
    const fromGh = await gh(['auth', 'token']).catch(() => '')
    if (TOKEN.test(fromGh)) return { token: fromGh }
    const quiet = { ...process.env, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' }
    const out = await feed('git', ['credential', 'fill'], 'protocol=https\nhost=github.com\n\n', quiet).catch(() => '')
    const password = out.match(/^password=(.+)$/m)?.[1]?.trim()
    if (!password || !TOKEN.test(password)) throw new ToolError('not_found', 'There is no saved GitHub sign-in on this computer')
    return { token: password }
  }

  async function importToken(value: string): Promise<GitHubStatus> {
    cloudOnly()
    if (!TOKEN.test(value)) throw new ToolError('bad_request', 'This does not look like GitHub access')
    pending?.proc.kill()
    try {
      await feed('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--with-token'], value + '\n')
    } catch (e) {
      throw new ToolError('failed', `GitHub did not accept this access: ${String((e as { stderr?: string }).stderr || (e as Error).message).trim().slice(-300)}`)
    }
    await setupGit()
    log('github: sign-in taken from the computer')
    return status()
  }

  // Commits need an author: the account's private noreply address, unless one is already set
  async function setupGit() {
    await gh(['auth', 'setup-git'])
    const [login, id, name] = (await gh(['api', 'user', '--jq', '.login, .id, (.name // "")'])).split('\n')
    const email = await exec('git', ['config', '--global', 'user.email']).then(r => r.stdout.trim(), () => '')
    if (email) return
    await exec('git', ['config', '--global', 'user.name', name || login])
    await exec('git', ['config', '--global', 'user.email', `${id}+${login}@users.noreply.github.com`])
  }

  async function logout(): Promise<GitHubStatus> {
    cloudOnly()
    pending?.proc.kill()
    pending = null
    await gh(['auth', 'logout', '--hostname', 'github.com']).catch(() => {})
    log('github: signed out')
    return status()
  }

  async function login(): Promise<GitHubLogin> {
    cloudOnly()
    // Asking again while the user is still on github.com shows the same code instead of a new one
    if (pending && Date.now() - pending.at < CODE_TTL_MS) return { code: pending.code, url: pending.url }
    pending?.proc.kill()
    pending = null
    // Signing in by code starts over: until the new account is in there is none, so the old one is never
    // mistaken for the sign-in being done
    await gh(['auth', 'logout', '--hostname', 'github.com']).catch(() => {})
    // Without a terminal gh prints the code and the link instead of opening a browser, then waits
    const proc = spawn('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'], {
      windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
    })
    let out = ''
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.kill()
        reject(new ToolError('failed', `gh gave no sign-in code within 20 s: ${out.trim().slice(-200)}`))
      }, 20_000)
      const read = (d: Buffer) => {
        out += d
        const code = out.match(CODE)?.[1]
        const url = out.match(URL_RE)?.[0]
        if (!code || !url || pending?.proc === proc) return
        clearTimeout(timer)
        pending = { code, url, at: Date.now(), proc }
        resolve({ code, url })
      }
      proc.stdout.on('data', read)
      proc.stderr.on('data', read)
      proc.on('error', e => {
        clearTimeout(timer)
        const missing = (e as NodeJS.ErrnoException).code === 'ENOENT'
        reject(new ToolError('unavailable', missing ? 'GitHub CLI (gh) is not installed on this device' : e.message))
      })
      proc.on('exit', async code => {
        clearTimeout(timer)
        if (pending?.proc === proc) pending = null
        if (code !== 0) {
          log(`github: sign-in not completed (code ${code})`)
          return reject(new ToolError('failed', out.trim().slice(-300) || `gh exited with code ${code}`))
        }
        await setupGit().catch(e => log('github: git not set up', (e as Error).message))
        log('github: signed in')
      })
    })
  }

  async function status(): Promise<GitHubStatus> {
    try {
      return { installed: true, login: await gh(['api', 'user', '--jq', '.login']), pending: false }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { installed: false, login: null, pending: false }
      return { installed: true, login: null, pending: !!pending }
    }
  }

  return { login, logout, status, token, importToken }
}

export type GitHub = ReturnType<typeof createGitHub>
