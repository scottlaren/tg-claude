import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from '../src/log.ts'

test('a new day starts a new file; dated files older than 14 days go away', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-log-'))
  writeFileSync(join(dir, 'server-2026-10-01.log'), 'old\n')
  writeFileSync(join(dir, 'server-2026-10-20.log'), 'recent\n')
  let now = new Date('2026-10-28T23:59:00Z')
  const log = createLogger(join(dir, 'server.log'), { now: () => now })
  log.info('evening')
  now = new Date('2026-10-29T00:01:00Z')
  log.info('morning')
  assert.deepEqual(readdirSync(dir).sort(), ['server-2026-10-20.log', 'server-2026-10-28.log', 'server.log'])
  assert.match(readFileSync(join(dir, 'server-2026-10-28.log'), 'utf8'), /evening/)
  assert.match(readFileSync(join(dir, 'server.log'), 'utf8'), /morning/)
  assert.doesNotMatch(readFileSync(join(dir, 'server.log'), 'utf8'), /evening/)
})

test('a full disk or a missing folder never reaches whoever is logging', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-log-'))
  const log = createLogger(join(dir, 'server.log'))
  rmSync(dir, { recursive: true })
  assert.doesNotThrow(() => log.warn('still here'))
})

test('a promise nobody waited on is logged, and the process goes on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-log-'))
  const url = new URL('../src/log.ts', import.meta.url).href
  const script = `import { createLogger, surviveRejections } from ${JSON.stringify(url)}
surviveRejections(createLogger(${JSON.stringify(join(dir, 'server.log'))}))
Promise.reject(new Error('boom'))
setTimeout(() => process.exit(7), 100)`
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
  assert.equal(r.status, 7, r.stderr)
  assert.match(readFileSync(join(dir, 'server.log'), 'utf8'), /unhandled rejection.*boom/s)
})
