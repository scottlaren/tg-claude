import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { writeConfigFile } from './config.ts'

// A computer that falls asleep in the middle of a task drops the task and its link. While something runs here, and for a
// while after (Claude thinks between commands), a child process of the agent's asks the system to stay up. The screen
// still goes dark. Ours to start and stop by its handle: no process is looked up by name, none but our own is touched

const GRACE_MS = 5 * 60_000
// Windows puts a computer back to sleep two minutes after a wake nobody touched it for (a wake from the network or a
// timer). Just woken, it is held this long whatever the switch says, so the user has time to give it a task
const WOKE_MS = 5 * 60_000

// The way to ask on each system. agent: the agent's pid. The request lasts only as
// long as the agent does: one that crashes or is killed can't leave the computer unable to sleep until a reboot
export function awakeCommand(platform: NodeJS.Platform, agent: number): [string, string[]] | null {
  if (platform === 'darwin') return ['caffeinate', ['-i', '-w', String(agent)]]
  if (platform === 'win32') {
    // ES_CONTINUOUS | ES_SYSTEM_REQUIRED, held for as long as this process lives, and it lives while the agent does
    const ps = `$t = Add-Type -Name P -Namespace W -PassThru -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'; $null = $t::SetThreadExecutionState([uint32]2147483649); while (Get-Process -Id ${agent} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 20 }`
    return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]]
  }
  // systemd's inhibitor lock, held by a tail that ends with the agent. The cloud has no switch at all (main.ts)
  if (platform === 'linux') return ['systemd-inhibit', ['--what=sleep:idle', '--who=tg-claude', '--why=A task is running', '--mode=block', 'tail', `--pid=${agent}`, '-f', '/dev/null']]
  return null
}

// On by default on a Mac, which sleeps on its own lid and timers; a PC is left as its owner set it up
export const awakeDefault = (platform: NodeJS.Platform) => platform === 'darwin'

export function createKeepAwake({ platform = process.platform, agent = process.pid, on, spawn = nodeSpawn, log, graceMs = GRACE_MS, save = () => {} }: {
  platform?: NodeJS.Platform
  agent?: number
  on: boolean
  spawn?: (cmd: string, args: string[], opts: object) => ChildProcess
  log: (...a: unknown[]) => void
  graceMs?: number
  save?: (on: boolean) => void
}) {
  const command = awakeCommand(platform, agent)
  let enabled = on
  let holds = 0
  let child: ChildProcess | null = null
  let timer: NodeJS.Timeout | undefined
  let wokeUntil = 0

  const start = (anyway = false) => {
    if (child || !command || (!enabled && !anyway)) return
    try {
      child = spawn(command[0], command[1], { stdio: 'ignore', windowsHide: true })
      child.on('error', e => {
        log('keeping awake failed:', e.message)
        child = null
      })
      child.on('exit', () => { child = null })
    } catch (e) {
      log('keeping awake failed:', (e as Error).message)
      child = null
    }
  }
  const stop = () => {
    clearTimeout(timer)
    timer = undefined
    child?.kill()
    child = null
  }

  return {
    hold() {
      holds++
      clearTimeout(timer)
      timer = undefined
      start()
    },
    release() {
      holds = Math.max(0, holds - 1)
      if (holds || !child) return
      clearTimeout(timer)
      timer = setTimeout(stop, Math.max(graceMs, wokeUntil - Date.now()))
      timer.unref()
    },
    woke(ms = WOKE_MS) {
      if (!command) return
      wokeUntil = Date.now() + ms
      start(true)
      if (holds && enabled) return
      clearTimeout(timer)
      timer = setTimeout(stop, ms)
      timer.unref()
    },
    set(next: boolean) {
      enabled = next
      save(next)
      if (!next) stop()
      else if (holds) start()
    },
    state: () => ({ on: enabled, supported: !!command, active: !!child }),
    close: stop,
  }
}

export type KeepAwake = ReturnType<typeof createKeepAwake>

// The clock jumped: the computer slept in between. Looked at every few seconds; a minute missing is a sleep
export function watchWakes(onWake: () => void, { every = 10_000, gap = 60_000, now = Date.now } = {}) {
  let last = now()
  const timer = setInterval(() => {
    const at = now()
    if (at - last > gap) onWake()
    last = at
  }, every)
  timer.unref()
  return () => clearInterval(timer)
}

// The switch lives in the config, the user's file: only it changes there
export function saveKeepAwake(file: string, on: boolean) {
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  raw.keepAwake = on
  writeConfigFile(file, raw)
}
