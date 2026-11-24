import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, mkdirSync, openSync, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { stat } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import type { ToolInput, ToolResult } from '@tgcv/protocol'
import { resolveInRoot, ToolError, type Roots } from './paths.ts'

// Every byte of output goes back to the model as input tokens: keep the head and the end, drop the middle
const OUTPUT_LIMIT = 32 * 1024
const KILL_GRACE_MS = 3000

// Keeps the start and the end of a stream (errors usually live at the end), drops the middle
export function createCapture(limit = OUTPUT_LIMIT) {
  const headMax = Math.floor(limit / 4)
  let head = ''
  let tail = ''
  let dropped = false
  return {
    push(s: string) {
      if (head.length < headMax) {
        const take = s.slice(0, headMax - head.length)
        head += take
        s = s.slice(take.length)
      }
      tail += s
      if (tail.length > limit - headMax) {
        tail = tail.slice(tail.length - (limit - headMax))
        dropped = true
      }
    },
    get truncated() { return dropped },
    text: () => (dropped ? `${head}\n…[output truncated]…\n${tail}` : head + tail),
  }
}

// Kill the whole tree: build tools and test runners love spawning children
function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    return
  }
  try { process.kill(-child.pid, 'SIGTERM') } catch {}
  setTimeout(() => {
    try { process.kill(-child.pid!, 'SIGKILL') } catch {}
  }, KILL_GRACE_MS).unref()
}

export function shellArgs(shell: string, script: string) {
  const name = shell.toLowerCase()
  if (name.includes('powershell') || name.includes('pwsh')) return ['-NoProfile', '-NonInteractive', '-Command', script]
  if (name.endsWith('cmd.exe')) return ['/d', '/s', '/c', script]
  // bash/zsh: login shell on macOS so Homebrew tools are on PATH
  return process.platform === 'darwin' ? ['-lc', script] : ['-c', script]
}

// Windows looks in the working folder before PATH, so a git.exe in a cloned repository would run in place of git, and the
// bot itself runs git and tar in project folders without a question. A bare name comes from PATH and nowhere else
export function fromPath(program: string, path = process.env.PATH ?? '', isFile = (p: string) => !!statSync(p, { throwIfNoEntry: false })?.isFile()) {
  if (/[\\/:]/.test(program)) return program
  const names = [...(win32.extname(program) ? [program] : []), `${program}.com`, `${program}.exe`]
  for (const dir of path.split(';').filter(d => win32.isAbsolute(d))) {
    for (const name of names) if (isFile(win32.join(dir, name))) return win32.join(dir, name)
  }
  return null
}

// A command longer than a call may wait (a full test run took 50 minutes one night, and the tries to start it with nohup
// or & died with the call that started them): its own process group, its output in a log file, nothing tying it to
// the call or to the agent, so it outlives both
export const BACKGROUND_DIR = join(tmpdir(), 'tgcv-background')
function startInBackground(bin: string, args: string[], cwd: string, started: number): ToolResult['run_command'] {
  mkdirSync(BACKGROUND_DIR, { recursive: true })
  const log = join(BACKGROUND_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}.log`)
  const fd = openSync(log, 'a')
  try {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', fd, fd], windowsHide: true, detached: true })
    child.on('error', () => {})
    child.unref()
    const pid = child.pid ?? 0
    return {
      exitCode: null, signal: null, timedOut: false, cancelled: false, truncated: false, durationMs: Date.now() - started,
      stdout: `Started in the background (pid ${pid}). Its output goes to ${log}: read it later (tail) to see how it went.`, stderr: '',
      background: { pid, log },
    }
  } catch (e) {
    throw new ToolError('failed', `${bin} does not start: ${(e as Error).message}`)
  } finally {
    closeSync(fd)
  }
}

export async function runCommand(
  root: string | Roots, shell: string, input: ToolInput<'run_command'>, signal: AbortSignal,
): Promise<ToolResult['run_command']> {
  if (!input.command === !input.program) throw new ToolError('bad_request', 'Exactly one of the fields is needed: command or program')
  const cwd = await resolveInRoot(root, input.cwd)
  if (!(await stat(cwd).then(s => s.isDirectory(), () => false))) throw new ToolError('not_found', `No such folder: ${input.cwd}`)
  const program = input.program && process.platform === 'win32' ? fromPath(input.program) : input.program
  if (input.program && !program) throw new ToolError('failed', `${input.program} does not start: it is not on PATH as a program. A .cmd or .bat runs through command; one in the project needs its path (./${input.program})`)

  // program + args never goes through a shell, so paths and arguments can't be reinterpreted (§9.3)
  const [bin, args] = input.command ? [shell, shellArgs(shell, input.command)] : [program!, input.args]
  const started = Date.now()
  const out = createCapture()
  const err = createCapture()
  let timedOut = false
  let cancelled = false
  // A Stop that came during the checks above has already fired: a listener added now would never hear it
  if (signal.aborted) {
    return { exitCode: null, signal: null, timedOut, cancelled: true, stdout: '', stderr: '', truncated: false, durationMs: 0 }
  }

  if (input.background) return startInBackground(bin, args, cwd, started)

  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(bin, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32', // own process group, so killTree reaches grandchildren
      })
    } catch (e) {
      // Windows refuses .cmd/.bat without a shell (EINVAL)
      return reject(new ToolError('failed', `${bin} does not start: ${(e as Error).message}. Try it through command`))
    }
    child.stdout!.setEncoding('utf8').on('data', (s: string) => out.push(s))
    child.stderr!.setEncoding('utf8').on('data', (s: string) => err.push(s))

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, input.timeoutSec * 1000)
    const onAbort = () => {
      cancelled = true
      killTree(child)
    }
    signal.addEventListener('abort', onAbort, { once: true })

    child.on('error', e => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(new ToolError('failed', `${bin} does not start: ${e.message}`))
    })
    let settled = false
    let drain: NodeJS.Timeout | undefined
    // An app the command launched (Studio via `cmd //c start`) can inherit the output pipe and hold it open
    // for hours. The command is over when its own process exits: its output gets a moment to drain, then
    // we stop listening. Neither the timeout nor Stop can reach the app after that
    child.on('exit', (exitCode, sig) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      drain = setTimeout(() => {
        child.stdout!.destroy()
        child.stderr!.destroy()
        finish(exitCode, sig)
      }, 1000)
    })
    child.on('close', (exitCode, sig) => finish(exitCode, sig))

    function finish(exitCode: number | null, sig: NodeJS.Signals | null) {
      if (settled) return
      settled = true
      clearTimeout(drain)
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve({
        exitCode,
        signal: sig,
        timedOut,
        cancelled,
        stdout: out.text(),
        stderr: err.text(),
        truncated: out.truncated || err.truncated,
        durationMs: Date.now() - started,
      })
    }
  })
}
