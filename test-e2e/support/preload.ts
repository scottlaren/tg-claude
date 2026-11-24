// Preloaded into the server process only. Swaps what can't run here for fakes without a line of the server knowing:
// the Claude Agent SDK's query() (fake-sdk.ts), the CLI binary (fake-cli.mjs), and adds a few test-only timings to the
// config (config-wrap.ts)
import './guard.ts'
import childProcess from 'node:child_process'
import { registerHooks, syncBuiltinESMExports } from 'node:module'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const here = (f: string) => new URL(f, import.meta.url).href
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@anthropic-ai/claude-agent-sdk') return { url: here('./fake-sdk.ts'), shortCircuit: true }
    if (spec === './config.ts' && ctx.parentURL?.endsWith('/apps/server/src/main.ts')) return { url: here('./config-wrap.ts'), shortCircuit: true }
    return next(spec, ctx)
  },
})

// Anything that would start a CLI named claude starts the fake one, through Node
const CLI = /(^|[\\/])claude(\.exe)?$/i
const fakeCli = fileURLToPath(here('./fake-cli.mjs'))
const route = (file: string, args: unknown): [string, string[]] => (CLI.test(file) ? [process.execPath, [fakeCli, ...((args as string[]) ?? [])]] : [file, args as string[]])

const { spawn, execFile } = childProcess
childProcess.spawn = ((file: string, args: unknown, opts: unknown) => {
  // spawn(file, opts) with no arguments passes straight through
  if (!Array.isArray(args)) return (spawn as (...a: unknown[]) => unknown)(file, args, opts)
  return (spawn as (...a: unknown[]) => unknown)(...route(file, args), opts)
}) as typeof spawn
const custom = (execFile as unknown as Record<symbol, (...a: unknown[]) => unknown>)[promisify.custom]
const wrapped = ((file: string, args: unknown, ...rest: unknown[]) => (execFile as (...a: unknown[]) => unknown)(...route(file, args), ...rest)) as unknown as typeof execFile
Object.defineProperty(wrapped, promisify.custom, { value: (file: string, args: unknown, ...rest: unknown[]) => custom(...route(file, args), ...rest) })
childProcess.execFile = wrapped
syncBuiltinESMExports()

// Windows has no SIGTERM to send: the stand asks over IPC, and the server's own handler runs as it does under Docker
process.on('message', m => {
  if (m === 'SIGTERM') process.emit('SIGTERM')
})
process.channel?.unref()
