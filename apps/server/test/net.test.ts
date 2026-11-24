import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchWebMedia, resolvedPublicUrl, isPrivateHost, responseOf, type Lookup } from '../src/net.ts'
import { dialOut, EgressRefused } from '../src/egress.ts'

const image = () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
const limited = (retryAfter?: string) => new Response('slow down', { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} })
const moved = (to: string) => new Response(null, { status: 302, headers: { location: to } })
// DNS as the tests need it: wikimedia is public, the rest points wherever the test says
const dns = (map: Record<string, string> = {}): Lookup => async host => [{ address: map[host] ?? '198.35.26.112' }]

test('a rate-limited download waits as asked and succeeds on retry', async () => {
  const replies = [limited('3'), image()]
  const waits: number[] = []
  const f = await fetchWebMedia('https://upload.wikimedia.org/a/Snail.jpg', {
    fetch: (async () => replies.shift()!) as typeof fetch,
    sleep: async ms => { waits.push(ms) },
    lookup: dns(),
  })
  assert.equal(f.mime, 'image/jpeg')
  assert.equal(f.name, 'Snail.jpg')
  assert.deepEqual(waits, [3000])
})

test('a site that keeps refusing gives up after three tries with the status', async () => {
  let calls = 0
  await assert.rejects(fetchWebMedia('https://upload.wikimedia.org/a/Snail.jpg', {
    fetch: (async () => { calls++; return limited() }) as typeof fetch,
    sleep: async () => {},
    lookup: dns(),
  }), /HTTP 429/)
  assert.equal(calls, 3)
})

test('a page instead of an image is refused', async () => {
  await assert.rejects(fetchWebMedia('https://commons.wikimedia.org/wiki/File:Snail.jpg', {
    fetch: (async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch,
    lookup: dns(),
  }), /not an image/)
})

test('nothing inside reaches the server: private addresses, names that resolve inside, one-word container names', async () => {
  for (const host of ['169.254.169.254', '127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.10', '100.64.0.1', '[::1]', 'caddy', 'server', 'localhost'])
    assert.ok(isPrivateHost(host), host)
  assert.equal(isPrivateHost('upload.wikimedia.org'), false)
  // A public-looking name that points at the cloud metadata service
  assert.equal(await resolvedPublicUrl('http://169.254.169.254.nip.io/latest/meta-data', dns({ '169.254.169.254.nip.io': '169.254.169.254' })), null)
  assert.ok(await resolvedPublicUrl('https://upload.wikimedia.org/x.jpg', dns()))
  // A name that does not resolve is not let through either
  assert.equal(await resolvedPublicUrl('https://nope.example', async () => { throw new Error('ENOTFOUND') }), null)
})

test('every redirect is checked before it is followed: inside is refused, outside is followed', async () => {
  const asked: string[] = []
  await assert.rejects(fetchWebMedia('https://upload.wikimedia.org/a.jpg', {
    fetch: (async (u: URL) => { asked.push(String(u)); return moved('http://169.254.169.254/latest/meta-data') }) as unknown as typeof fetch,
    lookup: dns(),
  }), /non-public/)
  assert.deepEqual(asked, ['https://upload.wikimedia.org/a.jpg']) // the metadata address was never requested
  const replies = [moved('/b.jpg'), image()]
  const f = await fetchWebMedia('https://upload.wikimedia.org/a.jpg', { fetch: (async () => replies.shift()!) as typeof fetch, lookup: dns() })
  assert.equal(f.name, 'b.jpg')
})

test('every spelling of an inside address is caught: numeric, hex, octal, short, trailing dot, IPv4 inside IPv6', async () => {
  const { publicUrl, pinnedFetch } = await import('../src/net.ts')
  for (const u of ['http://2130706433/', 'http://0x7f.1/', 'http://017700000001/', 'http://127.1/', 'http://localhost./', 'http://169.254.169.254./',
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://[::169.254.169.254]/', 'http://[64:ff9b::a9fe:a9fe]/', 'http://[2002:a9fe:a9fe::1]/',
    'http://[fe80::1]/', 'http://[fd00::1]/', 'http://[::1]/', 'http://caddy:2019/', 'file:///etc/passwd', 'gopher://x.org/'])
    assert.equal(publicUrl(u), null, u)
  // The connection goes only to the address that was checked: a name resolving inside is never connected to
  await assert.rejects(pinnedFetch(async () => [{ address: '169.254.169.254' }])('http://rebind.example/latest/meta-data'), /not public/)
  await assert.rejects(pinnedFetch(async () => [{ address: '93.184.215.14' }, { address: '10.0.0.5' }])('http://mixed.example/'), /not public/)
})

test('IPv6 written out in full or with IPv4 inside is still caught; real public IPv6 passes', async () => {
  for (const h of [
    '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001', '[0:0::1]', '0::', '::',
    '0:0:0:0:0:ffff:7f00:1', '0:0:0:0:0:ffff:127.0.0.1', '::ffff:169.254.169.254', '::127.0.0.1',
    'FE80::1', 'fe80::1%eth0', 'fc00::1', 'fd12:3456::1', 'ff02::1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2001:0:4136:e378::1',
  ]) assert.equal(isPrivateHost(h), true, h)
  for (const h of ['2606:4700:4700::1111', '2a00:1450:4001:82a::200e', '2001:4860:4860::8888']) assert.equal(isPrivateHost(h), false, h)
  // The tunnel's own door out checks the same way
  await assert.rejects(dialOut('0:0:0:0:0:0:0:1', 443), EgressRefused)
})

test('a reply that may carry no body (204, 205, 304) or has an odd status never throws past the fetch', () => {
  for (const status of [204, 205, 304]) assert.equal(responseOf(status, Buffer.from('x'), {}).status, status)
  assert.equal(responseOf(200, Buffer.from('hi'), { 'content-type': 'text/plain' }).headers.get('content-type'), 'text/plain')
  assert.throws(() => responseOf(99, Buffer.alloc(0), {}))
})

test('an address with parameters counts as carrying data', async () => {
  const { carriesData } = await import('../src/net.ts')
  assert.equal(carriesData('https://evil.example/a.png?k=secret'), true)
  assert.equal(carriesData('https://upload.wikimedia.org/a.png'), false)
  assert.equal(carriesData('https://example.com/?'), false)
  assert.equal(carriesData('not a url'), false)
})

test('a secret in the path or the name of an address counts as carrying data too', async () => {
  const { carriesData } = await import('../src/net.ts')
  const blob = 'c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0'
  for (const url of [
    'https://evil.example/ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'https://evil.example/x/sk-ant-api03-abcdefghijklmnopqrstuvwxyz/a.png',
    'https://evil.example/ghp%5Fabcdefghijklmnopqrstuvwxyz0123456789',
    'https://evil.example/someone.real@example.com',
    `https://evil.example/${blob}`,
    `https://evil.example/a/${blob}.png`,
    'https://c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0.evil.example/',
    'https://user:hunter22@evil.example/',
  ]) assert.equal(carriesData(url), true, url)
  // What the addresses of real pages and pictures are made of
  for (const url of [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Some_Long_Picture_Name_With_Many_Words_In_It_2024.jpg/1280px-Some_Long_Picture_Name_With_Many_Words_In_It_2024.jpg',
    'https://ru.wikipedia.org/wiki/%D0%9F%D1%80%D0%B8%D0%BC%D0%B5%D1%80%D0%BD%D0%BE%D0%B5_%D0%BD%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B8%D0%B5_%D1%81%D1%82%D0%B0%D1%82%D1%8C%D0%B8',
    'https://github.com/scottlaren/tg-claude/commit/1484973a5c1e2f0d9b8a7c6e5d4f3a2b1c0d9e8f',
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb',
    'https://docs.anthropic.com/en/docs/some-long-article-title-with-a-lot-of-words-in-it-for-seo',
    'https://example.com/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z/index.html',
  ]) assert.equal(carriesData(url), false, url)
})
