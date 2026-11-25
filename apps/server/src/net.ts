import { isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { basename } from 'node:path'
import { tr } from './i18n.ts'
import { redact } from './telegram/redact.ts'

const privateV4 = (h: string) => {
  const [a, b] = h.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224
}

// An IPv6 address as its eight 16-bit words, however it is written: 0:0:0:0:0:0:0:1 and ::1 are the same,
// a trailing IPv4 is two words, a zone (%eth0) is not part of the address
function v6Words(h: string): number[] | null {
  let s = h.replace(/%.*$/, '')
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (v4) {
    if (isIP(v4) !== 4) return null
    const [a, b, c, d] = v4.split('.').map(Number)
    s = s.slice(0, -v4.length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const [head, tail, extra] = s.split('::')
  if (extra !== undefined) return null
  const part = (x: string) => (x ? x.split(':').map(w => parseInt(w, 16)) : [])
  const front = part(head)
  const back = tail === undefined ? [] : part(tail)
  const words = tail === undefined ? front : [...front, ...Array(8 - front.length - back.length).fill(0), ...back]
  return words.length === 8 && words.every(w => w >= 0 && w <= 0xffff) ? words : null
}

// Addresses a fetch from the server must never reach: loopback, private networks, link-local
// (cloud metadata lives at 169.254.169.254 on most VPS providers), carrier NAT, benchmark and multicast ranges
// A run of characters long enough to be something encoded. Addresses are mostly words with dashes, underscores and %D0-style
// letters, which stop it, and the 40 of a git commit stay under it
const ENCODED = /[A-Za-z0-9+=~]{48,}/
const ENCODED_LABEL = /^[a-z0-9]{32,}$/i

// An address can carry anything to whoever reads its logs: in its parameters, and just as well in its path or its name
// (a server of the attacker's sees those too). A token as it is or a long encoded run is caught; short pieces over several
// segments are not, and only a question before every fetch would catch those
export function carriesData(url: string) {
  try {
    const u = new URL(url)
    if (u.search.length > 1) return true
    if (u.pathname.split('/').some(s => ENCODED.test(s)) || u.hostname.split('.').some(l => ENCODED_LABEL.test(l))) return true
    let plain = u.href
    try {
      plain = decodeURIComponent(plain)
    } catch {}
    return redact(plain).found.length > 0
  } catch {
    return false
  }
}

export function isPrivateHost(host: string) {
  // A trailing dot is the same name: localhost. is localhost
  const h = host.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (isIP(h) === 4) return privateV4(h)
  // IPv6 by its words, not its spelling: loopback, unspecified and every form that carries an IPv4 inside
  // (::a.b.c.d, ::ffff:a.b.c.d, NAT64 64:ff9b::, 6to4 2002::, Teredo 2001:0::), unique-local, link-local, multicast
  if (isIP(h.replace(/%.*$/, '')) === 6) {
    const w = v6Words(h)
    if (!w) return true
    if (w.slice(0, 5).every(x => x === 0)) return true
    if ((w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xff00) === 0xff00) return true
    if ((w[0] === 0x64 && w[1] === 0xff9b) || w[0] === 0x2002 || (w[0] === 0x2001 && w[1] === 0)) return true
    return false
  }
  // One word with no dots is a name inside some network (a container, a machine on the LAN), never the internet
  return !h.includes('.')
}

export function publicUrl(raw: string): URL | null {
  try {
    const u = new URL(raw)
    return /^https?:$/.test(u.protocol) && !isPrivateHost(u.hostname) ? u : null
  } catch {
    return null
  }
}

export type Lookup = (host: string) => Promise<{ address: string }[]>
const systemLookup: Lookup = host => dnsLookup(host, { all: true })

// A public-looking name can still point inside: 169.254.169.254.nip.io, 127.0.0.1.sslip.io, a record set to
// a private address. The name passes only when every address it resolves to is public
export async function resolvedPublicUrl(raw: string, lookup: Lookup = systemLookup): Promise<URL | null> {
  const u = publicUrl(raw)
  if (!u) return null
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) return u
  try {
    const found = await lookup(host)
    return found.length && found.every(a => !isPrivateHost(a.address)) ? u : null
  } catch {
    return null
  }
}

export const WEB_MEDIA_MAX_BYTES = 10 * 1024 * 1024

const toHeaders = (raw: IncomingHttpHeaders) => {
  const h = new Headers()
  for (const [k, v] of Object.entries(raw)) for (const one of [v ?? []].flat()) h.append(k, String(one))
  return h
}

// Some statuses may not carry a body, and Response refuses one; a status out of range makes it throw
const NO_BODY = new Set([101, 103, 204, 205, 304])
export const responseOf = (status: number, body: Uint8Array<ArrayBuffer>, headers: IncomingHttpHeaders) =>
  new Response(NO_BODY.has(status) ? null : body, { status, headers: toHeaders(headers) })

// A GET whose connection goes to the address checked right here. The name is resolved once and that same answer
// is both checked and connected to, so a DNS record that flips between the check and the connection (rebinding)
// can't take it inside. TLS still checks the certificate against the name. Never follows redirects itself
export function pinnedFetch(lookup: Lookup = systemLookup): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const found = isIP(host) ? [{ address: host }] : await lookup(host)
    if (!found.length || found.some(a => isPrivateHost(a.address))) throw new Error(tr('address is not public', 'адрес не публичный'))
    // IPv4 first: a server without IPv6 (most containers) can't reach an AAAA answer
    const address = (found.find(a => isIP(a.address) === 4) ?? found[0]).address
    const family = isIP(address)
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    return new Promise<Response>((resolve, reject) => {
      const req = send(url, {
        method: 'GET',
        headers: Object.fromEntries(new Headers(init?.headers)),
        signal: init?.signal ?? undefined,
        // Node asks for one address or, with happy eyeballs, for a list: either way it gets only the checked one
        lookup: ((_name: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          (opts?.all ? cb(null, [{ address, family }]) : cb(null, address, family))) as never,
      }, res => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > WEB_MEDIA_MAX_BYTES) req.destroy(new Error(tr('over 10 MB', 'больше 10 МБ')))
          else chunks.push(c)
        })
        // A throw in here would not reach the caller: it would end the whole bot
        res.on('end', () => {
          try {
            resolve(responseOf(res.statusCode ?? 502, Buffer.concat(chunks), res.headers))
          } catch (e) {
            reject(e)
          }
        })
        res.on('error', reject)
      })
      req.on('error', reject)
      req.end()
    })
  }) as typeof fetch
}

// Wikimedia's policy wants a client name with a contact; anonymous-looking agents get stricter limits
export const USER_AGENT = 'tg-claude/0.1 (https://github.com/scottlaren/tg-claude; personal Telegram client)'
const ATTEMPTS = 3
const MAX_RETRY_WAIT_MS = 10_000
const MAX_REDIRECTS = 5

const pause = (ms: number) => new Promise(r => setTimeout(r, ms))

// A web image or video for the answer, downloaded by the server: Telegram gets bytes, not a URL it may fail to fetch.
// Redirects are followed by hand, each hop checked before it is requested. 429 / 503 are rate limits: wait as long
// as the site asks (capped) and try again
export async function fetchWebMedia(raw: string, deps: { fetch?: typeof fetch, sleep?: (ms: number) => Promise<unknown>, lookup?: Lookup } = {}) {
  const doFetch = deps.fetch ?? pinnedFetch(deps.lookup)
  const sleep = deps.sleep ?? pause
  let url = await resolvedPublicUrl(raw, deps.lookup)
  if (!url) throw new Error(tr('address is not public', 'адрес не публичный'))
  let res: Response
  for (let hops = 0; ; hops++) {
    for (let attempt = 1; ; attempt++) {
      res = await doFetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': USER_AGENT }, redirect: 'manual' })
      if ((res.status !== 429 && res.status !== 503) || attempt === ATTEMPTS) break
      const asked = Number(res.headers.get('retry-after'))
      await sleep(Math.min(MAX_RETRY_WAIT_MS, asked > 0 ? asked * 1000 : 2000 * attempt))
    }
    const next = res.status >= 300 && res.status < 400 && res.headers.get('location')
    if (!next) break
    if (hops >= MAX_REDIRECTS) throw new Error(tr('too many redirects', 'слишком много редиректов'))
    const to = await resolvedPublicUrl(new URL(next, url).href, deps.lookup)
    if (!to) throw new Error(tr('redirect to a non-public address', 'редирект на непубличный адрес'))
    url = to
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (Number(res.headers.get('content-length') ?? 0) > WEB_MEDIA_MAX_BYTES) throw new Error(tr('over 10 MB', 'больше 10 МБ'))
  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!/^(image|video)\//.test(mime)) throw new Error(tr(`not an image (${mime || 'no type given'})`, `не картинка (${mime || 'тип не указан'})`))
  const data = Buffer.from(await res.arrayBuffer())
  if (data.length > WEB_MEDIA_MAX_BYTES) throw new Error(tr('over 10 MB', 'больше 10 МБ'))
  return { name: decodeURIComponent(basename(url.pathname)) || 'image', mime, data }
}
