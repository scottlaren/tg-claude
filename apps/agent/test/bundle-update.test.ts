import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundleUpdate } from '../src/self-update.ts'
import { tarBinary } from '../../server/src/bundle.ts'

const put = (root: string, files: Record<string, string>) => {
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(root, f, '..'), { recursive: true })
    writeFileSync(join(root, f), body)
  }
}
const version = (v: string) => JSON.stringify({ name: 'tg-claude', version: v, private: true, type: 'module' })

// The server: a 0.3.0 archive for the computer with key «secret»
async function server() {
  const stage = mkdtempSync(join(tmpdir(), 'tgcv-bu-src-'))
  put(stage, {
    'package.json': version('0.3.0'),
    'apps/agent/src/main.ts': 'new',
    'packages/protocol/package.json': '{"name":"@tgcv/protocol"}',
    'packages/protocol/src/index.ts': 'export const v = 3',
    'node_modules/ws/package.json': '{"name":"ws","version":"9"}',
  })
  const out = join(mkdtempSync(join(tmpdir(), 'tgcv-bu-out-')), 'agent.tar.gz')
  execFileSync(tarBinary(), ['-czf', out, 'package.json', 'apps', 'packages', 'node_modules'], { cwd: stage })
  const data = readFileSync(out)
  const http = createServer((req, res) => {
    if (req.url !== '/agent/bundle' || req.headers['x-tgcv-key'] !== 'secret') return res.writeHead(403).end()
    res.writeHead(200).end(data)
  })
  await new Promise<void>(r => http.listen(0, '127.0.0.1', () => r()))
  const url = `ws://127.0.0.1:${(http.address() as { port: number }).port}/device`
  return { url, sha256: createHash('sha256').update(data).digest('hex'), close: () => http.close() }
}

// A computer on 0.2.0, with its own settings and logs next to the code
function computer() {
  const root = mkdtempSync(join(tmpdir(), 'tgcv-bu-pc-'))
  put(root, {
    'package.json': version('0.2.0'),
    'apps/agent/src/main.ts': 'old',
    'packages/protocol/package.json': '{"name":"@tgcv/protocol"}',
    'packages/protocol/src/index.ts': 'export const v = 2',
    'node_modules/ws/package.json': '{"name":"ws","version":"8"}',
    'agent.config.json': '{"deviceId":"pc"}',
    'data/logs/agent.log': 'line',
  })
  return root
}

test('a computer without git takes the new version from the server, keeps its settings and links the protocol', async () => {
  const s = await server()
  try {
    const root = computer()
    const r = await bundleUpdate({ root, tag: 'v0.3.0', sha256: s.sha256, serverUrl: s.url, deviceId: 'pc', key: 'secret' })
    assert.deepEqual(r, { ok: true, from: '0.2.0', to: '0.3.0' })
    assert.equal(readFileSync(join(root, 'apps/agent/src/main.ts'), 'utf8'), 'new')
    assert.match(readFileSync(join(root, 'node_modules/ws/package.json'), 'utf8'), /"9"/)
    assert.equal(readFileSync(join(root, 'agent.config.json'), 'utf8'), '{"deviceId":"pc"}')
    assert.equal(readFileSync(join(root, 'data/logs/agent.log'), 'utf8'), 'line')
    assert.equal(realpathSync(join(root, 'node_modules/@tgcv/protocol')), realpathSync(join(root, 'packages/protocol')))
  } finally {
    s.close()
  }
})

test('a damaged archive, the wrong version or a refused key leave the old version as it was', async () => {
  const s = await server()
  try {
    const root = computer()
    const same = () => assert.equal(readFileSync(join(root, 'apps/agent/src/main.ts'), 'utf8'), 'old')
    const bad = await bundleUpdate({ root, tag: 'v0.3.0', sha256: 'f'.repeat(64), serverUrl: s.url, deviceId: 'pc', key: 'secret' })
    assert.match(bad.error!, /checksum mismatch/)
    same()
    const other = await bundleUpdate({ root, tag: 'v0.4.0', sha256: s.sha256, serverUrl: s.url, deviceId: 'pc', key: 'secret' })
    assert.match(other.error!, /version 0\.3\.0, not 0\.4\.0/)
    same()
    const refused = await bundleUpdate({ root, tag: 'v0.3.0', serverUrl: s.url, deviceId: 'pc', key: 'wrong' })
    assert.match(refused.error!, /HTTP 403/)
    same()
  } finally {
    s.close()
  }
})
