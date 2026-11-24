// Local executor: keeps a connection to the server and runs file and command operations
// for the projects of this computer, plus calls into the apps' MCP servers.
//   npm run agent                         run
//   npm run agent -- init [--server URL] [--zone DIR] [--name NAME] [--force]
//   npm run agent -- pair CODE [--server URL] [--name NAME]
//   … setup CODE --server URL                what the one line from /pair ends with: config, pairing, autostart
//   npm run agent -- install | uninstall | restart | status   background run, started at login
//   npm run agent -- chrome                 Chrome for Claude: its own profile, out to the web through the server
//   npm run agent -- chrome-proxy on|off|status   the user's own Chrome through the server (a Chrome policy)
//   node apps/agent/src/main.ts cloud      the cloud workspace container (deploy/compose.yml)
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { CLOUD_DEVICE_ID } from '@tgcv/protocol'
import { parseArgs } from 'node:util'
import { loadConfig, configFile, deviceOs, machineName, mcpFile, writeConfigFile } from './config.ts'
import { createMcpManager } from './mcp-manager.ts'
import { createZones } from './zones.ts'
import { createExecutor } from './executor.ts'
import { startClient } from './client.ts'
import { createMcpHub } from './mcp.ts'
import { createApps } from './apps.ts'
import { createWorkspace } from './workspace.ts'
import { defaultConfig } from './init.ts'
import { pairDevice } from './pair.ts'
import { createGitHub } from './github.ts'
import { startSocks } from './socks.ts'
import { launchChrome, openInOwnChrome, openSignIn, ownChromeWillDo, startOwnChrome } from './chrome.ts'
import { createChromePolicy } from './chrome-policy.ts'
import { createChromeMac } from './chrome-mac.ts'
import { selfUpdate, bundleUpdate, RESTART_CODE } from './self-update.ts'
import { createLock } from './lock.ts'
import { createAudit } from './audit.ts'
import { createKeepAwake, awakeDefault, saveKeepAwake, watchWakes } from './keep-awake.ts'
import { createSettings } from './settings.ts'
import { createRestartGate } from './restart-gate.ts'
import { newer, releaseOf, type SelfUpdateResult } from '@tgcv/protocol'
import { controlPath, listenControl, ask, AlreadyRunning } from './control.ts'
import { ROOT, supervise, startBackground, install, uninstall, restart, status } from './service.ts'
import { createScreen } from './screen/index.ts'
import { winBackend } from './screen/win.ts'
import { macBackend, macScreenMissing } from './screen/mac.ts'

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)
const DEFAULT_SERVER = 'ws://127.0.0.1:8787/device'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
// The time a server that just came back has to ask about what it left open, before this agent restarts
const LINK_SETTLE_MS = 5000

// The screen's helper of this system, or nothing when there is none
function desktop(stateDir: string) {
  if (process.platform === 'win32') return createScreen(winBackend())
  if (process.platform !== 'darwin') return undefined
  const why = macScreenMissing()
  if (why) {
    log(`the screen tool is off: ${why}`)
    return undefined
  }
  return createScreen(macBackend({ cacheDir: join(stateDir, 'screen-helper') }))
}

// Config and state are relative to the repo: the same files whether started by npm or at login
process.chdir(ROOT)

const { positionals, values: opt } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: 'string' }, zone: { type: 'string' }, name: { type: 'string' }, force: { type: 'boolean' },
    // Background runs: if another agent with this config is up (say, in a terminal), wait for it to close
    wait: { type: 'boolean' },
  },
})
const [command = 'run', arg] = positionals

const writeConfig = (cfg: object) => {
  mkdirSync(dirname(resolve(configFile())), { recursive: true })
  writeConfigFile(configFile(), cfg)
}
const fresh = () => defaultConfig({ os: deviceOs(), serverUrl: opt.server ?? DEFAULT_SERVER, zone: opt.zone && resolve(opt.zone), name: opt.name })

function init() {
  if (existsSync(configFile()) && !opt.force) {
    console.log(`${resolve(configFile())} already exists. To overwrite it: npm run agent -- init --force`)
    return
  }
  const cfg = fresh()
  writeConfig(cfg)
  console.log(`Created ${resolve(configFile())}`)
  console.log(`  computer: ${cfg.deviceName}`)
  console.log(`  server: ${cfg.serverUrl}`)
  console.log(`  working folder: ${cfg.zones[0]?.path ?? 'not found, set one with --zone FOLDER'}`)
  console.log(`  apps: ${Object.keys(cfg.apps).join(', ') || 'none'}; MCP: agent.mcp.json`)
  console.log('Next: send /pair to the bot and run the command it sends back.')
}

// Pairing writes this computer's id and key into its config, then the agent just starts
// The one line from /pair ends here: a config if there is none yet, this computer paired, autostart on (an agent
// already running takes the new server and key on a restart). TGCV_NO_AUTOSTART stops after the pairing
async function setup(code: string) {
  if (!existsSync(configFile())) {
    const cfg = fresh()
    writeConfig(cfg)
    log(`working folder: ${cfg.zones[0]?.path ?? 'not found, set it later with: npm run agent -- init --force --zone FOLDER'}`)
  }
  await pair(code)
  if (process.env.TGCV_NO_AUTOSTART) return
  if (await ask(controlPath('agent', configFile()), 'ping', 1000)) await restart()
  else await install()
}

async function pair(code: string) {
  const raw = existsSync(configFile()) ? JSON.parse(readFileSync(configFile(), 'utf8')) : fresh()
  if (opt.server) raw.serverUrl = opt.server
  if (opt.name) raw.deviceName = opt.name
  const { deviceId, key } = await pairDevice(raw.serverUrl, code, machineName(raw.deviceName))
  writeConfig({ ...raw, deviceId, deviceKey: key })
  log(`paired with ${raw.serverUrl} as ${deviceId}`)
}

// The cloud container: settings come from its environment and no pairing is needed, the server knows
// this key from CLOUD_KEY in the same .env. Projects are the folders in the workspace volume
function cloud() {
  const { AGENT_SERVER, CLOUD_KEY, CLOUD_WORKSPACE = '/home/node/workspace' } = process.env
  if (!AGENT_SERVER || !CLOUD_KEY) throw new Error('The cloud needs AGENT_SERVER and CLOUD_KEY in its environment')
  mkdirSync(CLOUD_WORKSPACE, { recursive: true })
  writeConfig({
    serverUrl: AGENT_SERVER, deviceId: CLOUD_DEVICE_ID, deviceKey: CLOUD_KEY, deviceName: 'Cloud',
    zones: [{ path: CLOUD_WORKSPACE }], shared: [], projects: [], mcpServers: {}, apps: {}, browserProxyPort: 0,
  })
}

// Chrome for Claude, started from the computer itself: the running agent keeps its proxy
async function chrome() {
  const raw = existsSync(configFile()) ? JSON.parse(readFileSync(configFile(), 'utf8')) : {}
  const port = Number.isInteger(raw.browserProxyPort) ? raw.browserProxyPort : 1089
  const { dir, first } = await launchChrome(port, log)
  console.log(`Chrome for Claude started: profile ${dir}, everything goes through the server (socks5://127.0.0.1:${port}).`)
  if (first) {
    console.log('First run, once:')
    console.log('  1. A tab shows the address websites see: it must be the server address, not yours.')
    console.log('  2. Install the Claude extension from the open store tab and sign in to the same claude.ai account as the server.')
    console.log('  3. In the bot: /browser → pick this browser. Do not sign in to your own accounts in it.')
  }
}

// What the Chrome policy replaced, to put back on «off»: a file of its own, the workspace rewrites its state whole
const chromeStateFile = () => join(dirname(resolve(process.env.AGENT_STATE ?? 'agent.state.json')), 'agent.chrome.json')

// Windows: a Chrome policy; a Mac: Chrome started again with the proxy flags
const chromeRoute = (port: number) => process.platform === 'darwin' ? createChromeMac({ port }) : createChromePolicy({ port, stateFile: chromeStateFile() })

// The user's own Chrome through the server, switched on the computer itself (works with the server down too)
async function chromeProxy(action = 'status') {
  const raw = existsSync(configFile()) ? JSON.parse(readFileSync(configFile(), 'utf8')) : {}
  const port = Number.isInteger(raw.browserProxyPort) ? raw.browserProxyPort : 1089
  const p = chromeRoute(port)
  const s = action === 'on' ? await p.on() : action === 'off' ? await p.off() : await p.status()
  if (!s.supported) return console.log(`Chrome cannot go through the server here: ${s.why}.`)
  // Chrome reads policies at start: the one running since before the switch may go either way
  if (s.pending) return console.log(`Switched to "${s.on ? 'through the server' : 'direct'}", but Chrome has not restarted since: close all its windows and open it again.`)
  console.log(s.on
    ? `Chrome goes through the server (socks5://127.0.0.1:${port}): websites see the server address.`
    : 'Chrome goes direct: websites see your address.')
}

// One agent per config: a second one would fight the first for the same device id on the server
async function takeLock(onStop: () => void) {
  const path = controlPath('agent', configFile())
  const started = Date.now()
  const handle = (cmd: string) => {
    if (cmd === 'ping') return `pong ${process.pid} ${started}`
    if (cmd === 'stop') {
      setImmediate(onStop)
      return 'ok'
    }
    return 'unknown'
  }
  for (let said = false; ; said = true) {
    try {
      return await listenControl(path, handle)
    } catch (e) {
      if (!(e instanceof AlreadyRunning)) throw e
      const pid = (await ask(path, 'ping'))?.split(' ')[1]
      if (!opt.wait) throw new Error(`The agent is already running${pid ? ` (pid ${pid})` : ''}. The background one is managed with: npm run agent -- status | restart | uninstall`)
      if (!said) log(`the agent is already running${pid ? ` (pid ${pid})` : ''}, waiting for it to exit`)
      await sleep(30_000)
    }
  }
}

// Set once the switch exists: a shutdown before then has nothing of it to stop
let awakeClose = () => {}

async function run() {
  let client: ReturnType<typeof startClient> | undefined
  let mcp: ReturnType<typeof createMcpHub> | undefined
  let closing = false
  // Ctrl+C, launchd, or restart/uninstall through the control socket: close app servers, then leave
  const shutdown = async (code = 0) => {
    if (closing) return
    closing = true
    client?.stop()
    awakeClose()
    await mcp?.close()
    process.exit(code)
  }
  // After an update: under the service (run --wait) it starts the new code at once; in a terminal, by hand
  const restartGate = createRestartGate({
    log,
    restart: to => {
      if (opt.wait) return void shutdown(RESTART_CODE)
      log(`✔ Updated to ${to}. Start the agent again: npm run agent`)
      shutdown()
    },
  })
  // refused: the server turned this agent away, so it has no link to wait for and nobody to report to
  const update = async (tag: string, sha256?: string, refused = false): Promise<SelfUpdateResult> => {
    log(`updating to ${tag}…`)
    // A git checkout moves to the tag; an install from /pair takes the server's archive
    const r = existsSync(join(ROOT, '.git'))
      ? await selfUpdate({ root: ROOT, tag })
      : await bundleUpdate({ root: ROOT, tag, sha256, serverUrl: cfg.serverUrl, deviceId: cfg.deviceId, key: cfg.deviceKey })
    log(r.ok ? `updated: ${r.from} → ${r.to}` : `not updated: ${r.error}`)
    if (!r.ok) return r
    // A result that finished while the link was down goes with this process: the server gets to ask for it first
    restartGate.request(r.to, () => executor.running() > 0 || (!refused && client!.linkedFor() < LINK_SETTLE_MS))
    return { ...r, ...(executor.running() > 0 && { waiting: executor.running() }) }
  }
  // Not over one promise nobody waited on: the commands running here would go with it
  process.on('unhandledRejection', e => log('unhandled rejection:', e))
  process.on('SIGINT', () => shutdown())
  process.on('SIGTERM', () => shutdown())
  await takeLock(() => shutdown())

  const cfg = loadConfig()
  log(`device ${cfg.deviceId} (${cfg.deviceName}), shell: ${cfg.shell}`)
  for (const z of cfg.zones) log(`  working folder: ${z.path}${z.exclude?.length ? ` (except ${z.exclude.join(', ')})` : ''}`)
  for (const z of cfg.missingZones ?? []) log(`  ⚠ working folder ${z} is gone: skipping it, another one can be picked in the bot (/devices → "📁 Folders")`)

  // This repo holds the bot token and device keys: never a project, never inside one
  const selfDir = fileURLToPath(new URL('../../..', import.meta.url))
  const workspace = createWorkspace({
    projects: cfg.projects,
    zones: cfg.zones,
    stateFile: process.env.AGENT_STATE ?? 'agent.state.json',
    selfDir,
  })
  for (const p of workspace.list().slice(0, 12)) {
    log(`  project ${p.id}: ${p.path}`)
    for (const r of p.extraRoots) log(`    + ${r}`)
  }
  if (workspace.list().length > 12) log(`  …and ${workspace.list().length - 12} more`)

  mcp = createMcpHub(cfg.mcpServers, { log, onChange: () => client?.mcpChanged(), pidsFile: `${configFile()}.mcp-pids` })
  const apps = createApps(cfg.apps, mcp)
  for (const s of cfg.shared) log(`  shared folder (read-only): ${s}`)
  // Every computer can hand its GitHub access to the cloud; only the cloud signs in
  const github = createGitHub(log, { cloud: cfg.deviceId === CLOUD_DEVICE_ID })
  const chromePolicy = chromeRoute(cfg.browserProxyPort)
  // Next to the state, outside any project
  const stateDir = dirname(resolve(process.env.AGENT_STATE ?? 'agent.state.json'))
  const lock = createLock(join(stateDir, 'agent.locked'))
  // The desktop, for Claude's screen tool
  const screen = cfg.deviceId === CLOUD_DEVICE_ID ? undefined : desktop(stateDir)
  const awake = createKeepAwake({ on: cfg.keepAwake ?? awakeDefault(process.platform), log, save: on => saveKeepAwake(configFile(), on) })
  awakeClose = awake.close
  // Woken from afar, the computer would go back to sleep before the user could give it a task
  if (cfg.deviceId !== CLOUD_DEVICE_ID) {
    watchWakes(() => {
      log('woke from sleep: kept awake for a few minutes')
      awake.woke()
    })
  }
  if (lock.locked()) log(`🔒 this computer is locked: every operation is refused until this file is deleted: ${lock.file}`)
  // The cloud is rebuilt with the server: it never updates itself
  const executor = createExecutor({
    workspace, shell: cfg.shell, log, mcp, apps, shared: cfg.shared, github, chromePolicy, lock,
    awake: cfg.deviceId === CLOUD_DEVICE_ID ? undefined : awake,
    settings: cfg.deviceId === CLOUD_DEVICE_ID ? undefined : createSettings({ mcpFile: mcpFile() }),
    audit: createAudit(join(stateDir, 'agent.audit.log'), log),
    // The cloud's servers are fixed
    mcpManager: cfg.deviceId === CLOUD_DEVICE_ID ? undefined : createMcpManager({ file: mcpFile(), hub: mcp }),
    // The cloud's folder is fixed; a computer's working folders change from the bot
    zones: cfg.deviceId === CLOUD_DEVICE_ID ? undefined : createZones({ workspace, file: configFile(), selfDir }),
    selfUpdate: cfg.deviceId === CLOUD_DEVICE_ID ? undefined : update,
    openChrome: cfg.deviceId === CLOUD_DEVICE_ID ? undefined : () => startOwnChrome(),
    screen,
    openLogin: cfg.deviceId === CLOUD_DEVICE_ID ? undefined : async url => (ownChromeWillDo(await chromePolicy?.status().catch(() => null)) ? openInOwnChrome(url) : openSignIn(url, cfg.browserProxyPort)),
  })
  // Turned away by a server on a newer release (an old protocol): catch up with it by itself
  const onReject = (_reason: string, serverRelease?: string) => {
    if (lock.locked() || cfg.deviceId === CLOUD_DEVICE_ID || !serverRelease || !newer(serverRelease, releaseOf(ROOT))) return
    update(`v${serverRelease}`, undefined, true).catch(e => log('update failed:', (e as Error).message))
  }
  client = startClient(cfg, executor, log, mcp.snapshot, apps.names(), workspace.list, onReject, {
    locked: lock.locked,
    keepAwake: () => (cfg.deviceId !== CLOUD_DEVICE_ID && awake.state().supported ? awake.state().on : undefined),
    screen: !!screen,
  })
  // The browser for Claude goes out through the server: its proxy lives here, only for this computer
  if (cfg.browserProxyPort) startSocks({ port: cfg.browserProxyPort, connect: (socket, host, port) => client!.tunnel(socket, host, port), log })
}

try {
  if (command === 'init') init()
  else if (command === 'setup') {
    if (!arg) throw new Error('A code from /pair is needed')
    await setup(arg)
  } else if (command === 'pair') {
    if (!arg) throw new Error('A code is needed: npm run agent -- pair CODE (/pair in the bot gives it)')
    await pair(arg)
    // Already running in the background: it takes the new server and key on a restart, not a second agent here
    if (await ask(controlPath('agent', configFile()), 'ping', 1000)) {
      await restart().catch(() => log('the agent is already running: restart it so it connects to the new server'))
    } else await run()
  } else if (command === 'run') await run()
  else if (command === 'cloud') {
    cloud()
    await run()
  } else if (command === 'chrome') await chrome()
  else if (command === 'chrome-proxy') await chromeProxy(arg)
  else if (command === 'install') await install()
  else if (command === 'uninstall') await uninstall()
  else if (command === 'restart') await restart()
  else if (command === 'status') await status()
  // Internal: what the login entry starts (Windows), and the process that keeps the agent alive
  else if (command === 'start') await startBackground({ wait: false })
  else if (command === 'supervise') await supervise()
  else throw new Error(`Unknown command ${command}: run, init, pair, setup, install, uninstall, restart, status, chrome, chrome-proxy`)
} catch (e) {
  console.error(`✖ ${(e as Error).message}`)
  process.exit(1)
}
