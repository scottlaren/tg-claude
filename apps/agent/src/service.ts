import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { controlPath, ask, listenControl } from './control.ts'
import { configFile } from './config.ts'
import { RESTART_CODE } from './self-update.ts'

// The agent in the background, started with the user's session so it can open AE, Blender and Studio
// on their desktop. Windows: a Run entry in the registry starts a small supervisor that restarts the
// agent after a crash. macOS: a LaunchAgent, launchd restarts it itself. Linux: a user unit of systemd, the same
const exec = promisify(execFile)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url))
export const LOG_FILE = join(ROOT, 'data', 'logs', 'agent.log')
const LOG_MAX = 5 * 1024 * 1024
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
// The project was called tg-claude-vps: installed computers know their autostart, folders and pipes by that
// name, so on disk it stays (here, in chrome.ts, control.ts and the install scripts)
const RUN_VALUE = 'tg-claude-vps agent'
export const LABEL = 'dev.tg-claude-vps.agent'
const plistFile = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
export const UNIT = 'tg-claude-vps-agent.service'
const unitFile = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user', UNIT)
const systemctl = (...args: string[]) => exec('systemctl', ['--user', ...args])
const domain = () => `gui/${userInfo().uid}`

const agentSocket = () => controlPath('agent', configFile())
const supervisorSocket = () => controlPath('supervisor', configFile())

// What the registry starts at login: node with the agent's `start`, which detaches and exits
export const runKeyCommand = (node: string, main: string) => `"${node}" "${main}" start`

export function launchAgentPlist({ node, main, cwd, log, path }: { node: string, main: string, cwd: string, log: string, path: string }) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const str = (s: string) => `<string>${esc(s)}</string>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${str(LABEL)}
  <key>ProgramArguments</key><array>${str(node)}${str(main)}${str('run')}${str('--wait')}</array>
  <key>WorkingDirectory</key>${str(cwd)}
  <key>EnvironmentVariables</key><dict><key>PATH</key>${str(path)}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key>${str(log)}
  <key>StandardErrorPath</key>${str(log)}
</dict>
</plist>
`
}

// Started with the user's session and stopped with it, as on a Mac. Exit code 75 is an update: the new code starts at once
export function systemdUnit({ node, main, cwd, log, path }: { node: string, main: string, cwd: string, log: string, path: string }) {
  const q = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return `[Unit]
Description=tg-claude agent
After=network-online.target

[Service]
ExecStart=${q(node)} ${q(main)} run --wait
WorkingDirectory=${cwd}
Environment=${q(`PATH=${path}`)}
Restart=on-failure
RestartSec=10
RestartForceExitStatus=${RESTART_CODE}
StandardOutput=append:${log}
StandardError=append:${log}

[Install]
WantedBy=default.target
`
}

const note = (line: string) => appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`)

function rotateLog() {
  mkdirSync(dirname(LOG_FILE), { recursive: true })
  if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > LOG_MAX) renameSync(LOG_FILE, LOG_FILE + '.1')
}

// Windows: keeps one agent running, restarting it after a crash (sooner if it ran for a while)
export async function supervise() {
  let child: ChildProcess | undefined
  let stopping = false
  let delay = 5000
  await listenControl(supervisorSocket(), cmd => {
    if (cmd === 'ping') return `pong ${process.pid}`
    if (cmd !== 'stop') return 'unknown'
    stopping = true
    if (!child) setTimeout(() => process.exit(0), 100)
    // Politely, so the agent shuts its app servers down; by force if it is still there after 10 s
    else ask(agentSocket(), 'stop').then(() => setTimeout(() => child?.kill(), 10_000).unref())
    return 'ok'
  })
  const start = () => {
    if (stopping) return
    rotateLog()
    const fd = openSync(LOG_FILE, 'a')
    const started = Date.now()
    child = spawn(process.execPath, [MAIN, 'run', '--wait'], { cwd: ROOT, stdio: ['ignore', fd, fd], windowsHide: true })
    closeSync(fd)
    child.on('exit', code => {
      child = undefined
      if (stopping || code === 0) process.exit(0)
      // Updated itself: start the new code now, no backoff
      if (code === RESTART_CODE) {
        note('the agent updated itself, starting the new version')
        return start()
      }
      delay = Date.now() - started > 60_000 ? 5000 : Math.min(delay * 2, 60_000)
      note(`the agent exited with code ${code}, restarting in ${delay / 1000} s`)
      setTimeout(start, delay)
    })
  }
  start()
}

// Polls until the agent answers (or stops answering); its ping line, or null
async function waitAgent(up: boolean, ms = 15_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
    const pong = await ask(agentSocket(), 'ping', 1000)
    if (!!pong === up) return pong
  }
  return up ? null : 'still running'
}

// Windows: the supervisor, detached from this console, with no window of its own. At login this runs
// in a console window of its own, so it leaves at once instead of waiting for the agent to answer
export async function startBackground({ wait = true } = {}) {
  if (!(await ask(supervisorSocket(), 'ping', 1000))) {
    rotateLog()
    spawn(process.execPath, [MAIN, 'supervise'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref()
  }
  return wait ? waitAgent(true) : null
}

async function stopBackground() {
  if (!(await ask(supervisorSocket(), 'stop'))) return false
  for (const end = Date.now() + 15_000; Date.now() < end && (await ask(supervisorSocket(), 'ping', 1000)); ) await sleep(500)
  return true
}

const installed = async () => process.platform === 'darwin'
  ? existsSync(plistFile())
  : process.platform === 'linux' ? existsSync(unitFile())
    : exec('reg', ['query', RUN_KEY, '/v', RUN_VALUE]).then(() => true, () => false)

const uptime = (pong: string) => {
  const min = Math.round((Date.now() - Number(pong.split(' ')[2])) / 60_000)
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
}
const running = (pong: string | null) => (pong ? `running (pid ${pong.split(' ')[1]}, up ${uptime(pong)})` : 'not running')

// Linux needs a user session of systemd: WSL and containers often have none
async function supported() {
  if (process.platform === 'win32' || process.platform === 'darwin') return true
  if (process.platform === 'linux' && await systemctl('show-environment').then(() => true, () => false)) return true
  console.log('Autostart needs systemd here, and it has no user session: start the agent with npm run agent yourself, or as a service of your own.')
  return false
}

export async function install() {
  if (!(await supported())) return
  if (!existsSync(resolve(ROOT, configFile()))) throw new Error('Set up the agent first: npm run agent -- init, then /pair in the bot')
  rotateLog()
  if (process.platform === 'darwin') {
    mkdirSync(dirname(plistFile()), { recursive: true })
    writeFileSync(plistFile(), launchAgentPlist({ node: process.execPath, main: MAIN, cwd: ROOT, log: LOG_FILE, path: process.env.PATH ?? '' }))
    await exec('launchctl', ['bootout', `${domain()}/${LABEL}`]).catch(() => {})
    await exec('launchctl', ['bootstrap', domain(), plistFile()])
  } else if (process.platform === 'linux') {
    mkdirSync(dirname(unitFile()), { recursive: true })
    writeFileSync(unitFile(), systemdUnit({ node: process.execPath, main: MAIN, cwd: ROOT, log: LOG_FILE, path: process.env.PATH ?? '' }))
    await systemctl('daemon-reload')
    await systemctl('enable', UNIT)
    await systemctl('restart', UNIT)
  } else {
    await exec('reg', ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', runKeyCommand(process.execPath, MAIN), '/f'])
    await startBackground()
  }
  const pong = await waitAgent(true)
  console.log(`✔ Autostart is on: the agent starts when you log in. Now: ${running(pong)}.`)
  console.log(`  Log: ${LOG_FILE}`)
  if (!pong) console.log('  No answer within 15 s: check the log.')
}

export async function uninstall() {
  if (!(await supported())) return
  if (process.platform === 'darwin') {
    await exec('launchctl', ['bootout', `${domain()}/${LABEL}`]).catch(() => {})
    rmSync(plistFile(), { force: true })
  } else if (process.platform === 'linux') {
    await systemctl('disable', '--now', UNIT).catch(() => {})
    rmSync(unitFile(), { force: true })
    await systemctl('daemon-reload').catch(() => {})
  } else {
    await exec('reg', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f']).catch(() => {})
    await stopBackground()
  }
  const left = await waitAgent(false, 3000)
  console.log('✔ Autostart is off, the background agent is stopped.')
  if (left) console.log('  An agent started in a terminal is still running: Ctrl+C there stops it.')
}

export async function restart() {
  if (!(await supported())) return
  if (!(await installed())) throw new Error('Autostart is not on: npm run agent -- install')
  if (process.platform === 'darwin') await exec('launchctl', ['kickstart', '-k', `${domain()}/${LABEL}`])
  else if (process.platform === 'linux') await systemctl('restart', UNIT)
  else {
    await stopBackground()
    await startBackground()
  }
  console.log(`✔ Restarted. Now: ${running(await waitAgent(true))}.`)
}

export async function status() {
  const pong = await ask(agentSocket(), 'ping')
  const bg = process.platform === 'win32' ? !!(await ask(supervisorSocket(), 'ping')) : await installed()
  console.log(`Autostart: ${(await installed()) ? 'on' : 'off'}`)
  console.log(`Agent: ${running(pong)}${pong && !bg ? ', in a terminal, not in the background' : ''}`)
  console.log(`Background log: ${LOG_FILE}`)
}
