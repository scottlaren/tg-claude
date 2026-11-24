import { execFile } from 'node:child_process'
import { readFileSync, statfsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { codeVersion } from '@tgcv/protocol'
import { claudeBinary } from './login.ts'
import { tr } from './i18n.ts'

// The release from package.json, and the commit the server runs from
export const APP_VERSION: string = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version
export const SERVER_VERSION = `${APP_VERSION} · ${codeVersion(fileURLToPath(new URL('../../..', import.meta.url)))}`

// What /diag reports about the server itself (§18): disk, sizes, versions
const exec = promisify(execFile)

export function disk(dir: string) {
  try {
    const s = statfsSync(dir)
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }
  } catch {
    return null
  }
}

// Bytes and files under a folder; missing folders count as empty
export async function dirSize(dir: string): Promise<{ bytes: number, files: number }> {
  let bytes = 0
  let files = 0
  async function walk(d: string) {
    const items = await readdir(d, { withFileTypes: true }).catch(() => [])
    for (const it of items) {
      const p = join(d, it.name)
      if (it.isDirectory()) await walk(p)
      else if (it.isFile()) {
        bytes += (await stat(p).catch(() => ({ size: 0 }))).size
        files++
      }
    }
  }
  await walk(dir)
  return { bytes, files }
}

let cli: Promise<string> | null = null
export function claudeVersions() {
  cli ??= exec(claudeBinary(), ['--version'], { timeout: 15_000, windowsHide: true })
    .then(r => r.stdout.trim().split(/\s/)[0], () => 'unknown')
  const sdk = (() => {
    try {
      // The package exports no package.json: read it next to its entry point
      const entry = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')
      return JSON.parse(readFileSync(join(dirname(entry), 'package.json'), 'utf8')).version as string
    } catch {
      return 'unknown'
    }
  })()
  return cli.then(c => ({ cli: c, sdk }))
}

export const bytes = (n: number) =>
  n < 1024 ** 2 ? `${Math.round(n / 1024)} ${tr('KB', 'КБ')}` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(0)} ${tr('MB', 'МБ')}` : `${(n / 1024 ** 3).toFixed(1)} ${tr('GB', 'ГБ')}`

export const duration = (ms: number) => {
  const min = Math.floor(ms / 60_000)
  const h = Math.floor(min / 60)
  const d = Math.floor(min / 1440)
  // Days only from two on: always plural
  return min < 60 ? tr(`${min} min`, `${min} мин`) : min < 48 * 60 ? tr(`${h} h ${min % 60} min`, `${h} ч ${min % 60} мин`) : tr(`${d} days`, `${d} дн`)
}
