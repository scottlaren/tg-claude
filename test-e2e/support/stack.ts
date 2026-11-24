// The whole product on one computer: the real server and the real agent as processes of their own, each with a temporary
// HOME, data folder, ports and pipe names, and a fake Telegram here in the test process. Processes are stopped only by
// the pid they were started with
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { connect, createServer, createServer as createNet, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFakeTelegram, type FakeTelegram, type Sent, type Button } from './fake-telegram.ts'
import { controlPath, ask } from '../../apps/agent/src/control.ts'
import { addToDump } from './dump.ts'
import type { Step } from './fake-sdk.ts'

export const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PRELOAD = new URL('./preload.ts', import.meta.url).href
const GUARD = new URL('./guard.ts', import.meta.url).href
const AGENT_MAIN = join(ROOT, 'apps/agent/src/main.ts')
const SERVER_MAIN = join(ROOT, 'apps/server/src/main.ts')
export const OWNER_ID = 777001
export const TOKEN = '123456:E2E-fake-token-not-real'

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function until<T>(what: string, fn: () => T | Promise<T>, ms = 20_000, every = 40): Promise<NonNullable<T>> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`)
    await sleep(every)
  }
}

const freePort = () => new Promise<number>((ok, fail) => {
  const s = createServer()
  s.on('error', fail)
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address() as { port: number }
    s.close(() => ok(port))
  })
})

// Enough for git, bash, node and npm, and nothing else of this computer's: no ffmpeg, whisper, gh or anything else on PATH
function minimalPath() {
  const want = [dirname(process.execPath), 'C:\\Program Files\\Git\\cmd', 'C:\\Program Files\\Git\\bin', 'C:\\Program Files\\Git\\usr\\bin', 'C:\\Windows\\system32', 'C:\\Windows', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0']
  if (process.platform !== 'win32') want.push('/usr/bin', '/bin', '/usr/local/bin')
  return want.join(delimiter)
}

function baseEnv(dir: string, home: string): NodeJS.ProcessEnv {
  const tmp = join(home, 'tmp')
  mkdirSync(tmp, { recursive: true })
  mkdirSync(join(home, 'AppData/Roaming'), { recursive: true })
  mkdirSync(join(home, 'AppData/Local'), { recursive: true })
  const gitconfig = join(home, '.gitconfig')
  writeFileSync(gitconfig, '[user]\n\tname = e2e\n\temail = e2e@example.test\n[init]\n\tdefaultBranch = main\n')
  return {
    PATH: minimalPath(),
    SystemRoot: process.env.SystemRoot, windir: process.env.windir, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT,
    HOME: home, USERPROFILE: home, HOMEDRIVE: home.slice(0, 2), HOMEPATH: home.slice(2),
    APPDATA: join(home, 'AppData/Roaming'), LOCALAPPDATA: join(home, 'AppData/Local'),
    TEMP: tmp, TMP: tmp, TMPDIR: tmp,
    GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', GH_CONFIG_DIR: join(home, 'gh'), GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
    npm_config_cache: join(home, 'npm-cache'), npm_config_update_notifier: 'false',
    E2E_DIR: dir, NODE_NO_WARNINGS: '1',
  }
}

export type AgentProc = { name: string, id: string, config: string, zone: string, log: string, child: ChildProcess | null }

export type Stack = Awaited<ReturnType<typeof startStack>>

export type StackOptions = {
  owner?: boolean
  claim?: string
  // ServerConfig fields a test may shorten
  config?: Record<string, unknown>
  env?: Record<string, string>
  language?: 'en' | 'ru'
  // A helper in UPDATE_DIR: on by default, so the server never asks GitHub
  helper?: boolean
}

export async function startStack(o: StackOptions = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-e2e-')))
  const dir = join(base, 'stand')
  const home = join(base, 'server-home')
  const dataDir = join(base, 'data')
  const updateDir = join(base, 'update')
  for (const d of [dir, home, dataDir, updateDir, join(dir, 'scripts'), join(dir, 'flags')]) mkdirSync(d, { recursive: true })
  if (o.helper !== false) {
    writeFileSync(join(updateDir, 'ready'), '1')
    writeFileSync(join(updateDir, 'tags.txt'), '')
  }
  // The update helper of the VPS, faked as far as the folder it shares with the server: a check leaves what GitHub would
  // say, a request is written down for the test to act on
  const helper = { tags: [] as string[], release: null as null | Record<string, unknown>, requests: [] as string[] }
  const helperTimer = setInterval(() => {
    if (existsSync(join(updateDir, 'check'))) {
      rmSync(join(updateDir, 'check'), { force: true })
      if (helper.release) writeFileSync(join(updateDir, 'release.json'), JSON.stringify(helper.release))
      else rmSync(join(updateDir, 'release.json'), { force: true })
      writeFileSync(join(updateDir, 'tags.txt'), helper.tags.map(t => `abc\trefs/tags/${t}\n`).join(''))
    }
    if (existsSync(join(updateDir, 'request'))) {
      helper.requests.push(readFileSync(join(updateDir, 'request'), 'utf8'))
      rmSync(join(updateDir, 'request'), { force: true })
    }
  }, 50)

  // The default profile starts signed in; a journey about sign-in takes the mark away
  const profile = join(dataDir, 'profiles', 'main')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, '.signed-in'), '1')
  if (o.language) writeFileSync(join(dataDir, 'language.json'), JSON.stringify({ lang: o.language }))

  const tg: FakeTelegram = createFakeTelegram({ token: TOKEN })
  const tgPort = await tg.listen()
  const wsPort = await freePort()
  const wsUrl = `ws://127.0.0.1:${wsPort}/device`
  const user = { id: OWNER_ID, is_bot: false, first_name: 'Owner', username: 'e2e_owner', language_code: o.language ?? 'en' }

  const serverLog = join(base, 'server.out.log')
  let server: ChildProcess | null = null
  const exits: { name: string, code: number | null, signal: string | null, at: number }[] = []
  const serverEnv = (): NodeJS.ProcessEnv => ({
    ...baseEnv(dir, home),
    TG_TOKEN: TOKEN, TG_API_ROOT: `http://127.0.0.1:${tgPort}`,
    ...(o.owner !== false && { OWNER_IDS: String(OWNER_ID) }),
    ...(o.claim && { CLAIM_CODE: o.claim }),
    DATA_DIR: dataDir, WS_HOST: '127.0.0.1', WS_PORT: String(wsPort), PUBLIC_WS_URL: wsUrl,
    CLAUDE_CWD: join(base, 'claude-cwd'), BACKUP_DIR: join(base, 'backups'), UPDATE_DIR: updateDir,
    MAX_PARALLEL: '3', AGENT_BUNDLE: join(base, 'no-bundle.tar.gz'),
    E2E_CONFIG: JSON.stringify({ recoveryNoteMs: 200, deferredSettleMs: 300, ...o.config }), E2E_ROOT: resolve(ROOT),
    ...o.env,
  })
  async function startServer() {
    const out = openSync(serverLog, 'a')
    server = spawn(process.execPath, ['--import', PRELOAD, SERVER_MAIN], { cwd: ROOT, env: serverEnv(), stdio: ['ignore', out, out, 'ipc'], windowsHide: true })
    const started = server
    server.on('exit', (code, signal) => {
      exits.push({ name: 'server', code, signal, at: Date.now() })
      if (server === started) server = null
    })
    const since = tg.calls.length
    await until('the server to reach getMe', () => server === null ? Promise.reject(new Error(`the server exited: ${readFileSync(serverLog, 'utf8').slice(-2000)}`)) : tg.calls.slice(since).some(c => c.method === 'getMe'), 40_000)
    return server!
  }

  // Hard stop: what a crash or kill -9 does (on Windows, any signal)
  async function killServer() {
    const s = server
    if (!s) return
    const gone = new Promise(r => s.once('exit', r))
    process.kill(s.pid!, 'SIGKILL')
    await gone
  }
  // The handler Docker's SIGTERM runs
  async function termServer() {
    const s = server
    if (!s) return
    const gone = new Promise(r => s.once('exit', r))
    s.send('SIGTERM')
    await Promise.race([gone, sleep(15_000).then(() => {
      throw new Error('the server did not exit on SIGTERM within 15 s')
    })])
  }

  // The line between the agents and the server, which a test can cut as a network would
  const linkPort = await freePort()
  const linkOpen = new Set<Socket>()
  let linkUp = true
  const linkServer = createNet(client => {
    if (!linkUp) return client.destroy()
    const remote = connect(wsPort, '127.0.0.1')
    for (const c of [client, remote]) {
      linkOpen.add(c)
      c.on('error', () => {})
      c.on('close', () => {
        linkOpen.delete(c)
        client.destroy()
        remote.destroy()
      })
    }
    client.pipe(remote)
    remote.pipe(client)
  })
  await new Promise<void>(r => linkServer.listen(linkPort, '127.0.0.1', r))
  const link = {
    cut() {
      linkUp = false
      for (const c of linkOpen) c.destroy()
    },
    restore() {
      linkUp = true
    },
  }

  const agents = new Map<string, AgentProc>()
  const agentEnv = (a: { home: string, config: string, base: string }): NodeJS.ProcessEnv => ({
    ...baseEnv(dir, a.home),
    AGENT_CONFIG: a.config, AGENT_STATE: join(a.base, 'agent.state.json'), TGCV_NO_AUTOSTART: '1',
  })

  // The real pairing flow: a code from /pair, the same `setup` the one line from /pair ends with
  async function pairAgent(name: string, code: string, projects: string[] = [], { gitProjects = [] as string[], agentRoot = ROOT } = {}) {
    const agentBase = join(base, `agent-${name}`)
    const agentHome = join(agentBase, 'home')
    const zone = join(agentBase, 'zone')
    mkdirSync(agentHome, { recursive: true })
    mkdirSync(zone, { recursive: true })
    for (const p of [...projects, ...gitProjects]) mkdirSync(join(zone, p), { recursive: true })
    const config = join(agentBase, 'agent.config.json')
    const env = agentEnv({ home: agentHome, config, base: agentBase })
    // The isolation is the point: this agent's pipe must be its own, and nobody may be listening on it
    const pipe = controlPath('agent', config)
    if (await ask(pipe, 'ping', 500)) throw new Error(`Somebody already answers on ${pipe}`)
    const main = join(agentRoot, 'apps/agent/src/main.ts')
    for (const p of gitProjects) {
      const opts = { cwd: join(zone, p), env, stdio: 'ignore' as const, windowsHide: true }
      execFileSync('git', ['init', '-q', '-b', 'main'], opts)
      writeFileSync(join(zone, p, 'README.md'), `# ${p}\n`)
      execFileSync('git', ['add', '.'], opts)
      execFileSync('git', ['commit', '-q', '-m', 'first'], opts)
    }
    const out = execFileSync(process.execPath, ['--import', GUARD, main, 'setup', code, '--server', wsUrl, '--zone', zone, '--name', name], { cwd: agentBase, env, encoding: 'utf8', windowsHide: true })
    const cfg = JSON.parse(readFileSync(config, 'utf8'))
    // No apps, no MCP servers and no browser proxy port: nothing here reaches a real app, and 1089 belongs to the real agent
    cfg.apps = {}
    cfg.mcpServers = {}
    cfg.mcpFromClaude = false
    cfg.browserProxyPort = 0
    cfg.keepAwake = false
    cfg.shared = []
    cfg.serverUrl = `ws://127.0.0.1:${linkPort}/device`
    writeFileSync(config, JSON.stringify(cfg, null, 2))
    const a: AgentProc = { name, id: cfg.deviceId, config, zone, log: join(agentBase, 'agent.out.log'), child: null }
    agents.set(name, a)
    void out
    await startAgent(name, { main, env })
    await online(a.id, 0)
    return a
  }

  // The n-th time the server logged this computer as online (0: the next one to come)
  const onlineCount = (id: string) => serverLogText().split(/\r?\n/).filter(l => l.includes('device online') && l.includes(`"id":"${id}"`)).length
  async function online(id: string, seen = onlineCount(id)) {
    await until(`${id} online`, () => onlineCount(id) > seen, 30_000, 50)
  }

  const agentSpawn = new Map<string, { main: string, env: NodeJS.ProcessEnv }>()
  async function startAgent(name: string, how?: { main: string, env: NodeJS.ProcessEnv }) {
    const a = agents.get(name)!
    if (how) agentSpawn.set(name, how)
    const { main, env } = agentSpawn.get(name)!
    const out = openSync(a.log, 'a')
    const child = spawn(process.execPath, ['--import', GUARD, main, 'run', '--wait'], { cwd: dirname(a.config), env, stdio: ['ignore', out, out], windowsHide: true })
    a.child = child
    child.on('exit', (code, signal) => {
      exits.push({ name: `agent-${name}`, code, signal, at: Date.now() })
      if (a.child === child) a.child = null
    })
    return child
  }
  async function killAgent(name: string) {
    const a = agents.get(name)!
    const c = a.child
    if (!c) return
    const gone = new Promise(r => c.once('exit', r))
    process.kill(c.pid!, 'SIGKILL')
    await gone
  }

  // The cloud container's agent, on this computer: its own settings from its environment, no pairing
  const cloudBase = join(base, 'cloud')
  let cloudChild: ChildProcess | null = null
  async function startCloud() {
    mkdirSync(join(cloudBase, 'home'), { recursive: true })
    const out = openSync(join(cloudBase, 'out.log'), 'a')
    cloudChild = spawn(process.execPath, ['--import', GUARD, AGENT_MAIN, 'cloud'], {
      cwd: cloudBase, stdio: ['ignore', out, out], windowsHide: true,
      env: { ...agentEnv({ home: join(cloudBase, 'home'), config: join(cloudBase, 'agent.config.json'), base: cloudBase }), AGENT_SERVER: wsUrl, CLOUD_KEY: 'e2e-cloud-key', CLOUD_WORKSPACE: join(cloudBase, 'workspace') },
    })
    cloudChild.on('exit', () => { cloudChild = null })
  }

  const scripts = new Map<string, Step[]>()
  let scriptSeq = 0
  // A script a message can name; returns the token to put in the message
  function script(steps: Step[], name = `s${++scriptSeq}-${createHash('sha1').update(JSON.stringify(steps)).digest('hex').slice(0, 6)}`) {
    scripts.set(name, steps)
    writeFileSync(join(dir, 'scripts', `${name}.json`), JSON.stringify(steps))
    return `SCRIPT:${name}`
  }
  const flag = (name: string) => writeFileSync(join(dir, 'flags', name), '1')
  const flagged = (name: string) => existsSync(join(dir, 'flags', name))
  const journal = (): Record<string, any>[] => {
    try {
      return readFileSync(join(dir, 'journal.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    } catch {
      return []
    }
  }
  const netViolations = () => {
    try {
      return readFileSync(join(dir, 'net-violations.log'), 'utf8').trim().split('\n').filter(Boolean)
    } catch {
      return []
    }
  }

  // The user, in the private chat
  const CHAT = OWNER_ID
  const send = (text: string, opts: { thread?: number, replyTo?: number, chat?: number } = {}) => tg.text(user, opts.chat ?? CHAT, text, opts)

  const inChat = (chat: number, thread?: number) => tg.sent.filter(m => m.chat.id === chat && m.thread === thread)
  const texts = (chat = CHAT, thread?: number) => inChat(chat, thread).map(m => m.text)

  // The next message from the bot after a mark, in that chat and topic, whose text matches
  async function reply(match: RegExp, { chat = CHAT, thread, after = 0, ms = 20_000, deleted = false }: { chat?: number, thread?: number, after?: number, ms?: number, deleted?: boolean } = {}): Promise<Sent> {
    return until(`a message matching ${match} in ${chat}/${thread}`, () => tg.sent.find(m => m.touched >= after && m.chat.id === chat && m.thread === thread && (deleted || !m.deleted) && match.test(m.text)), ms)
  }

  const buttonOf = (m: Sent, label: RegExp): Button => {
    const b = m.buttons.flat().find(x => label.test(x.text))
    if (!b) throw new Error(`no button ${label} on: ${m.text.slice(0, 120)} [${m.buttons.flat().map(x => x.text).join(' | ')}]`)
    return b
  }
  // A tap, and it has to be answered: a button left spinning is a dead button
  async function tap(m: Sent, label: RegExp | string, ms = 8000) {
    const data = typeof label === 'string' ? label : buttonOf(m, label).data
    if (!data) throw new Error(`the button ${label} has no callback data`)
    const id = tg.tap(user, m, data)
    await until(`an answer to the tap on ${label}`, () => tg.wasAnswered(id), ms)
    return tg.wasAnswered(id)!
  }

  // What happened, for reading after a run: the conversation, what the fake refused, and the server's own log
  function dump() {
    const out = join(process.env.E2E_DUMP_DIR ?? tmpdir(), `tgcv-e2e-${basename(process.argv[1] ?? 'x')}.txt`)
    const lines = tg.sent.map(m => `#${m.message_id} ${m.method} chat=${m.chat.id} thread=${m.thread ?? '-'}${m.deleted ? ' DELETED' : ''} edits=${m.edits} reply=${m.reply_to ?? '-'} media=${m.media.length}\n  ${m.text.replace(/\n/g, '\n  ')}\n  [${m.buttons.map(r => r.map(b => `${b.text} → ${b.data ?? b.url ?? 'copy'}`).join(' | ')).join(' ;; ')}]`)
    const refused = tg.calls.filter(c => !c.ok).map(c => `${c.method}: ${c.error} ${JSON.stringify(c.payload).slice(0, 300)}`)
    writeFileSync(out, ['=== MESSAGES', ...lines, '=== REFUSED', ...refused, '=== FINDINGS', ...tg.findings.map(f => JSON.stringify(f)), '=== EXITS', JSON.stringify(exits), '=== SERVER LOG', serverLogText(), '=== SERVER OUT', existsSync(serverLog) ? readFileSync(serverLog, 'utf8') : '', '=== JOURNAL', ...journal().map(j => JSON.stringify({ ...j, appendText: undefined }).slice(0, 1500))].join('\n'))
  }

  async function stop() {
    dump()
    if (process.env.E2E_DUMP) addToDump(process.env.E2E_DUMP, tg.outgoing)
    clearInterval(helperTimer)
    link.cut()
    linkServer.close()
    const procs = [...agents.values()].flatMap(a => (a.child ? [a.child] : [])).concat(server ? [server] : [], cloudChild ? [cloudChild] : [])
    for (const p of procs) {
      try {
        process.kill(p.pid!, 'SIGKILL')
      } catch {}
    }
    await Promise.all(procs.map(p => (p.exitCode === null && p.signalCode === null ? new Promise(r => p.once('exit', r)) : null)))
    await tg.close()
    await sleep(300)
    try {
      rmSync(base, { recursive: true, force: true, maxRetries: 40, retryDelay: 500 })
    } catch (e) {
      console.error(`could not remove ${base}: ${(e as Error).message}`)
    }
  }

  const serverLogText = () => {
    try {
      return readFileSync(join(dataDir, 'logs/server.log'), 'utf8')
    } catch {
      return ''
    }
  }

  return {
    base, dir, tg, user, CHAT, helper, link, wsPort, wsUrl, dataDir, updateDir, agents, exits,
    startServer, killServer, termServer, online, onlineCount, pairAgent, startAgent, killAgent, script, flag, flagged, journal, netViolations,
    send, reply, tap, texts, inChat, buttonOf, stop, serverLogText, serverLog,
    startCloud, cloudWorkspace: () => join(cloudBase, 'workspace'),
    isServerUp: () => !!server,
    serverPid: () => server?.pid,
  }
}

// The code out of what /pair sent
export const pairCodeIn = (m: Sent) => (m.text.match(/\/install\/([\w-]+)\//)?.[1]) ?? m.text.match(/pair\s+([\w-]{4,})/)?.[1]

// Asserts the stand itself held: no outside connection, and every message well-formed
export function standClean(s: Stack) {
  return { net: s.netViolations(), findings: s.tg.findings }
}
