import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { promisify } from 'node:util'

// What the agent started for an app's MCP server, remembered so that a crash or an update doesn't leave it running.
// Deliberately narrow: only the one process it started itself, looked up by its own number, and closed only if its
// name and start time still match. Never walks parents and children: on Windows a process number can be reused, so
// "the children of N" can turn out to be anyone's, and closing those once took a whole Windows session down

const exec = promisify(execFile)

export type StartedProcess = { pid: number, name: string, started: string }

export async function describeProcess(pid: number, platform = process.platform): Promise<StartedProcess | null> {
  try {
    if (platform === 'win32') {
      const script = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { $p.Name + '|' + $p.CreationDate.ToString('o') }`
      const { stdout } = await exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20_000 })
      const [name, started] = stdout.trim().split('|')
      return name && started ? { pid, name, started } : null
    }
    const { stdout } = await exec('ps', ['-o', 'lstart=,comm=', '-p', String(pid)], { timeout: 20_000 })
    const m = stdout.trim().match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/)
    return m ? { pid, started: m[1], name: basename(m[2].trim()) } : null
  } catch {
    return null
  }
}

export const sameProcess = (a: StartedProcess, b: StartedProcess | null) => !!b && a.pid === b.pid && a.name === b.name && a.started === b.started

// True when it was still that very process and it was told to go
export async function closeIfSame(saved: StartedProcess, look = describeProcess, kill: (pid: number) => void = pid => void process.kill(pid)) {
  if (!Number.isInteger(saved.pid) || saved.pid <= 4 || saved.pid === process.pid) return false
  if (!sameProcess(saved, await look(saved.pid))) return false
  try {
    kill(saved.pid)
    return true
  } catch {
    return false
  }
}

// `cmd /c ...\mcp.bat` hides the real server under a process of its own, which closing cmd leaves behind. Roblox's bat
// names the server's exe, whichever Studio version is current: run that one directly. Anything else stays as it is
export function directCommand(cfg: { command: string, args?: string[] }, env: NodeJS.ProcessEnv = process.env,
  read: (p: string) => string = p => readFileSync(p, 'utf8'), exists: (p: string) => boolean = existsSync) {
  const [flag, bat, ...rest] = cfg.args ?? []
  if (!/^cmd(\.exe)?$/i.test(basename(cfg.command)) || flag?.toLowerCase() !== '/c' || !/\.bat$/i.test(bat ?? '')) return cfg
  const path = bat.replace(/%(\w+)%/g, (m, name) => env[name] ?? m)
  try {
    const exe = [...read(path).matchAll(/"([^"]+\.exe)"/gi)].map(m => m[1]).find(exists)
    return exe ? { command: exe, args: rest } : cfg
  } catch {
    return cfg
  }
}
