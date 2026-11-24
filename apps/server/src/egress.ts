import { connect, isIP, type Socket } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isPrivateHost, type Lookup } from './net.ts'

// Where the browser tunnel may go: web ports only, so the server never becomes a relay for mail or anything else
export const TUNNEL_PORTS = new Set([80, 443, 8080, 8443])
const systemLookup: Lookup = host => dnsLookup(host, { all: true })

export class EgressRefused extends Error {}

// A connection from the server for the browser tunnel: the name is resolved once, every address it gives must
// be public, and the socket goes to that checked address (no DNS flip in between). IPv4 first, like fetches
export function dialOut(host: string, port: number, { lookup = systemLookup, allowPrivate = false, timeoutMs = 15_000 }: {
  lookup?: Lookup, allowPrivate?: boolean, timeoutMs?: number,
} = {}): Promise<Socket> {
  return (async () => {
    if (!TUNNEL_PORTS.has(port)) throw new EgressRefused(`port ${port} is closed: the browser only goes to web ports`)
    const name = host.replace(/^\[|\]$/g, '')
    if (!allowPrivate && isPrivateHost(name)) throw new EgressRefused('address is not public')
    const found = isIP(name) ? [{ address: name }] : await lookup(name)
    if (!found.length) throw new Error('address not found')
    if (!allowPrivate && found.some(a => isPrivateHost(a.address))) throw new EgressRefused('address is not public')
    const address = (found.find(a => isIP(a.address) === 4) ?? found[0]).address
    return new Promise<Socket>((resolve, reject) => {
      const s = connect({ host: address, port })
      s.setTimeout(timeoutMs, () => s.destroy(new Error('the site did not respond')))
      s.once('connect', () => {
        s.setTimeout(0)
        resolve(s)
      })
      s.once('error', reject)
    })
  })()
}
