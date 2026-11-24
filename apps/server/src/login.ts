// Official Claude Code login for a server profile (§7): `npm run login` signs in the default profile,
// `npm run login -- --profile work` adds or signs in another one (data/profiles/work), `… status` shows it.
// `… mcp`: sign the profile in to remote MCP servers (Figma) — they are registered in it, then its Claude
// opens: /mcp → server → Authenticate, Allow access in the browser, /exit
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { mkdirSync } from 'node:fs'
import { loadConfig } from './config.ts'
import { PROFILE_NAME } from './profiles.ts'
import { tr } from './i18n.ts'

export function claudeBinary() {
  const require = createRequire(import.meta.url)
  const pkg = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)
  return join(dirname(pkg), process.platform === 'win32' ? 'claude.exe' : 'claude')
}

// The CLI's own sign-in, driven from the bot: it prints the link, then reads the code the user brings back.
// The code goes only to the CLI's stdin and the account lands in the profile's own credential store
export type LoginRun = { url: string, submit(code: string): Promise<{ ok: boolean, message: string }>, cancel(): void }

const AUTHORIZE = /https:\/\/\S+\/oauth\/authorize\?\S+/
const lastLine = (out: string) => out.split(/\r?\n/).map(l => l.replace(/^.*?>\s*/, '').trim()).filter(Boolean).at(-1) ?? ''

export function startLogin({ dir, env = process.env, command = [claudeBinary(), 'auth', 'login'], timeoutMs = 10 * 60_000 }: {
  dir: string, env?: NodeJS.ProcessEnv, command?: string[], timeoutMs?: number,
}): Promise<LoginRun> {
  mkdirSync(dir, { recursive: true })
  const p = spawn(command[0], command.slice(1), { env: { ...env, CLAUDE_CONFIG_DIR: dir }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let out = ''
  const exited = new Promise<number | null>(resolve => {
    p.on('exit', code => resolve(code))
    p.on('error', () => resolve(-1))
  })
  // Nobody came back with a code: the CLI doesn't wait forever
  const timer = setTimeout(() => p.kill(), timeoutMs)
  exited.then(() => clearTimeout(timer))
  return new Promise((resolve, reject) => {
    let ready = false
    const seen = (d: Buffer) => {
      out += String(d)
      const url = out.match(AUTHORIZE)?.[0]
      if (ready || !url || !/code here/i.test(out)) return
      ready = true
      resolve({
        url,
        async submit(code: string) {
          const from = out.length
          p.stdin.write(code.trim() + '\n')
          let slow: NodeJS.Timeout | undefined
          const exit = await Promise.race([exited, new Promise<'slow'>(r => { slow = setTimeout(() => r('slow'), 60_000) })])
          clearTimeout(slow)
          if (exit === 'slow') p.kill()
          const said = lastLine(out.slice(from))
          return exit === 0 && /successful/i.test(out.slice(from))
            ? { ok: true, message: said }
            : { ok: false, message: exit === 'slow' ? tr('Claude did not answer within a minute', 'Claude не ответил за минуту') : said.replace(/^Login failed:\s*/i, '') || tr('sign-in failed', 'вход не удался') }
        },
        cancel: () => p.kill(),
      })
    }
    p.stdout.on('data', seen)
    p.stderr.on('data', seen)
    exited.then(code => {
      if (!ready) reject(new Error(lastLine(out).replace(/^Login failed:\s*/i, '') || tr(`sign-in did not start (exit code ${code})`, `вход не запустился (код ${code})`)))
    })
  })
}

// The same for a remote MCP server (Figma), with the CLI's own `mcp login`. It insists on a terminal, so it gets one
// from `script`. The way back from the sign-in page is a redirect to localhost: whoever catches it hands it to submit
export type McpLoginRun = { url: string, port: number, submit(redirect: string): Promise<{ ok: boolean, message: string }>, cancel(): void }

// Colours, and the hyperlinks a terminal gets around a link: \u001b]8;;url\u0007
const terminalCodes = (s: string) => s.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
const mcpLoginCommand = (name: string) => ['script', '-qefc', `stty cols 4000; '${claudeBinary()}' mcp login ${name} --no-browser`, '/dev/null']

export function startMcpLogin({ dir, name, url: serverUrl, env = process.env, command = mcpLoginCommand(name), timeoutMs = 10 * 60_000 }: {
  dir: string, name: string, url?: string, env?: NodeJS.ProcessEnv, command?: string[], timeoutMs?: number,
}): Promise<McpLoginRun> {
  if (!/^[\w-]{1,40}$/.test(name)) return Promise.reject(new Error('Not a name of an MCP server'))
  mkdirSync(dir, { recursive: true })
  const home = { ...env, CLAUDE_CONFIG_DIR: dir }
  // Already there is fine: only the sign-in matters
  if (serverUrl) spawnSync(claudeBinary(), ['mcp', 'add', '--transport', 'http', '--scope', 'user', name, serverUrl], { env: home, stdio: 'ignore' })
  const p = spawn(command[0], command.slice(1), { env: home, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let raw = ''
  let out = ''
  const exited = new Promise<number | null>(resolve => {
    p.on('exit', code => resolve(code))
    p.on('error', () => resolve(-1))
  })
  const timer = setTimeout(() => p.kill(), timeoutMs)
  exited.then(() => clearTimeout(timer))
  return new Promise((resolve, reject) => {
    let ready = false
    const seen = (d: Buffer) => {
      raw += String(d)
      out = terminalCodes(raw)
      const url = out.match(/https:\/\/\S+/)?.[0]
      if (ready || !url || !/redirect url/i.test(out)) return
      ready = true
      resolve({
        url,
        port: Number(new URL(new URL(url).searchParams.get('redirect_uri') ?? 'http://localhost:0').port),
        async submit(redirect: string) {
          const from = out.length
          p.stdin.write(redirect.trim() + '\n')
          let slow: NodeJS.Timeout | undefined
          // A way back that isn't for this sign-in: the CLI says so and waits on, and nobody will bring a better one
          let check: NodeJS.Timeout | undefined
          const refused = new Promise<'refused'>(r => {
            check = setInterval(() => { if (/doesn't look like/i.test(out.slice(from))) r('refused') }, 200)
          })
          const exit = await Promise.race([exited, refused, new Promise<'slow'>(r => { slow = setTimeout(() => r('slow'), 60_000) })])
          clearTimeout(slow)
          clearInterval(check)
          if (exit === 'slow' || exit === 'refused') p.kill()
          return exit === 0
            ? { ok: true, message: lastLine(out.slice(from)) }
            : { ok: false, message: exit === 'slow' ? tr('Claude did not answer within a minute', 'Claude не ответил за минуту') : lastLine(out.slice(from)) || tr('the sign-in was not accepted', 'вход не принят') }
        },
        cancel: () => p.kill(),
      })
    }
    p.stdout.on('data', seen)
    p.stderr.on('data', seen)
    exited.then(code => {
      if (!ready) reject(new Error(lastLine(out) || tr(`sign-in did not start (exit code ${code})`, `вход не запустился (код ${code})`)))
    })
  })
}

if (import.meta.main) {
  const cfg = loadConfig({ ...process.env, TG_TOKEN: process.env.TG_TOKEN || '-' })
  const { positionals: [sub], values: opt } = parseArgs({ allowPositionals: true, options: { profile: { type: 'string' } } })
  if (opt.profile !== undefined && !PROFILE_NAME.test(opt.profile)) throw new Error('Profile name: Latin letters, digits, - and _, up to 32 characters')
  // Profiles sit next to the default one: data/profiles/<name>
  const profileDir = opt.profile ? join(dirname(cfg.profileDir), opt.profile) : cfg.profileDir
  mkdirSync(profileDir, { recursive: true })
  const env = { ...process.env, CLAUDE_CONFIG_DIR: profileDir }
  console.log(`Claude profile: ${profileDir}`)
  if (sub === 'mcp') {
    for (const [name, url] of Object.entries(cfg.remoteMcp)) {
      // Already there is fine: only the sign-in matters
      spawnSync(claudeBinary(), ['mcp', 'add', '--transport', 'http', '--scope', 'user', name, url], { env, stdio: 'ignore' })
    }
    console.log(`Servers: ${Object.keys(cfg.remoteMcp).join(', ') || 'none (REMOTE_MCP)'}`)
    console.log('Claude for this profile opens now: /mcp → server → Authenticate, Allow access in the browser, then /exit')
    mkdirSync(cfg.claudeCwd, { recursive: true })
    const r = spawnSync(claudeBinary(), [], { stdio: 'inherit', env, cwd: cfg.claudeCwd })
    process.exit(r.status ?? 1)
  }
  const r = spawnSync(claudeBinary(), ['auth', sub === 'status' ? 'status' : 'login'], { stdio: 'inherit', env })
  process.exit(r.status ?? 1)
}
