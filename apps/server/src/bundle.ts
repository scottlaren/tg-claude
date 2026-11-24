import { exec as execShell, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

// The agent as one archive for computers: its code, the protocol and its dependencies, ready to run with no
// npm and no git there. The workspace link to the protocol is left out (a link in an archive doesn't survive
// Windows): the installer and the update make it on the spot
export type Bundle = { data: Buffer, sha256: string }

// Windows has bsdtar in System32; the tar of Git Bash would read «C:\…» as a remote host
export const tarBinary = () => (process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar')

// npm is a .cmd on Windows, which runs only through a shell; the arguments here are fixed words
const npm = (cwd: string, args: string[]) =>
  promisify(execShell)(`npm ${args.join(' ')}`, { cwd, windowsHide: true, timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024 })

export async function buildAgentBundle({ root, out }: { root: string, out: string }) {
  const stage = mkdtempSync(join(tmpdir(), 'tgcv-bundle-'))
  try {
    // The lock covers every workspace, so every manifest comes along; only the agent's are installed
    for (const f of ['package.json', 'package-lock.json', 'packages/protocol/package.json', 'apps/agent/package.json', 'apps/server/package.json']) {
      mkdirSync(dirname(join(stage, f)), { recursive: true })
      cpSync(join(root, f), join(stage, f))
    }
    await npm(stage, ['ci', '--omit=dev', '--workspace', '@tgcv/agent', '--workspace', '@tgcv/protocol', '--no-audit', '--no-fund', '--ignore-scripts'])
    rmSync(join(stage, 'node_modules', '@tgcv'), { recursive: true, force: true })
    rmSync(join(stage, 'apps', 'server'), { recursive: true, force: true })
    for (const d of ['apps/agent/src', 'packages/protocol/src']) cpSync(join(root, d), join(stage, d), { recursive: true })
    mkdirSync(dirname(out), { recursive: true })
    await exec(tarBinary(), ['-czf', out, 'package.json', 'apps', 'packages', 'node_modules'], { cwd: stage, windowsHide: true, timeout: 5 * 60_000 })
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

const read = (path: string): Bundle => {
  const data = readFileSync(path)
  return { data, sha256: createHash('sha256').update(data).digest('hex') }
}

// The bundle this server hands out: the one baked into its image, or (running from a checkout) built once from
// it and kept. A failed build is tried again next time
export function agentBundles({ prebuilt, root, cacheDir, version, log }: {
  prebuilt?: string, root?: string, cacheDir: string, version: string, log: { info(...a: unknown[]): void, warn(...a: unknown[]): void },
}) {
  let pending: Promise<Bundle | null> | null = null
  async function load(): Promise<Bundle | null> {
    if (prebuilt && existsSync(prebuilt)) return read(prebuilt)
    if (!root || !existsSync(join(root, 'apps', 'agent', 'package.json'))) return null
    const out = join(cacheDir, `agent-bundle-${version}.tar.gz`)
    if (!existsSync(out)) {
      log.info('building the agent bundle', { version })
      await buildAgentBundle({ root, out })
    }
    return read(out)
  }
  return () => (pending ??= load().catch(e => {
    log.warn('agent bundle', (e as Error).message)
    pending = null
    return null
  }))
}

export type AgentBundles = ReturnType<typeof agentBundles>
