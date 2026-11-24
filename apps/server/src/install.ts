import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DeviceRegistry, Pairing } from './devices.ts'
import type { AgentBundles } from './bundle.ts'

// What a computer downloads to join the bot, from this server only (the repository may be private):
//   /install/<code>/windows | /install/<code>/macos   the script behind the one line /pair gives
//   /install/<code>/agent.tar.gz                       the agent itself, for that script
//   /agent/bundle                                       the same, for a paired computer updating itself (its key)
// A pairing code opens these without being spent (pairing at the end spends it); a wrong one counts toward the
// pairing lock. Nothing here logs a code, a key or an address
const SCRIPTS = {
  windows: readFileSync(new URL('./install-agent.ps1', import.meta.url), 'utf8'),
  macos: readFileSync(new URL('./install-agent.sh', import.meta.url), 'utf8'),
}

// wss://host/device → https://host
export const httpsBase = (publicUrl: string) => {
  const u = new URL(publicUrl)
  return `${u.protocol === 'ws:' ? 'http:' : 'https:'}//${u.host}`
}

export const installLines = (publicUrl: string, code: string) => ({
  windows: `irm ${httpsBase(publicUrl)}/install/${code}/windows | iex`,
  macos: `curl -fsSL ${httpsBase(publicUrl)}/install/${code}/macos | bash`,
})

export function createInstallRoutes({ pairing, registry, publicUrl, bundles, nodeVersion = process.version }: {
  pairing: Pairing, registry: DeviceRegistry, publicUrl: string, bundles: AgentBundles, nodeVersion?: string,
}) {
  const text = (res: ServerResponse, status: number, body: string) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  }
  const sendBundle = async (res: ServerResponse) => {
    const b = await bundles()
    if (!b) return text(res, 503, 'The server cannot build the agent: see the server log')
    res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': b.data.length, 'x-sha256': b.sha256, 'cache-control': 'no-store' })
    res.end(b.data)
  }
  // Only what a code from /pair can look like ever reaches the scripts
  const codeOf = (raw: string) => (/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(raw) ? raw.toUpperCase() : null)

  // true when the request was one of these; anything else is left to the caller
  return function route(req: IncomingMessage, res: ServerResponse): boolean {
    const path = (req.url ?? '').split('?')[0]
    if (req.method !== 'GET') return false
    if (path === '/agent/bundle') {
      const id = String(req.headers['x-tgcv-device'] ?? '')
      const key = String(req.headers['x-tgcv-key'] ?? '')
      if (!id || !key || !registry.verify(id, key)) text(res, 403, 'Unknown computer')
      else sendBundle(res).catch(() => text(res, 500, 'Error'))
      return true
    }
    const m = path.match(/^\/install\/([^/]+)\/(windows|macos|agent\.tar\.gz)$/)
    if (!m) return false
    // Taken as it came: a real code needs no decoding, and decoding throws on an address like /install/%FF/windows
    const code = codeOf(m[1])
    const ok = code ? pairing.valid(code) : false
    if (ok !== true) {
      const why = ok === 'locked' ? 'Too many wrong codes: try again in 10 minutes' : 'The code is wrong or has expired: get a new one with /pair'
      // The scripts are run as they come: a refusal is a script that only says why
      if (m[2] === 'windows') text(res, 404, `Write-Host '${why}' -ForegroundColor Red`)
      else if (m[2] === 'macos') text(res, 404, `echo '${why}' >&2; exit 1`)
      else text(res, 404, why)
      return true
    }
    if (m[2] === 'agent.tar.gz') {
      sendBundle(res).catch(() => text(res, 500, 'Error'))
      return true
    }
    const fill = (s: string) => s
      .replaceAll('__SERVER__', httpsBase(publicUrl))
      .replaceAll('__WSS__', publicUrl)
      .replaceAll('__CODE__', code!)
      .replaceAll('__NODE__', nodeVersion)
    text(res, 200, fill(SCRIPTS[m[2] as 'windows' | 'macos']))
    return true
  }
}

export type InstallRoutes = ReturnType<typeof createInstallRoutes>
