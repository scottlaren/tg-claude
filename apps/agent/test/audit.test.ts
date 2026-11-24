import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpTool } from '@tgcv/protocol'
import { auditLine, createAudit, scrub } from '../src/audit.ts'

const req = (tool: OpTool, params: Record<string, unknown> = {}, projectId = 'p') => ({ tool, projectId, params })

test('a command is on record in full, on one line', () => {
  const line = auditLine(req('run_command', { command: 'git status\necho "two lines"', cwd: 'sub' }), false, new Date('2026-11-01T10:00:00Z'))!
  assert.equal(line.split('\n').length, 2)
  assert.match(line, /^2026-11-01T10:00:00\.000Z\trun_command\tp\t/)
  assert.ok(line.includes('git status\\necho \\"two lines\\"'))
  assert.ok(line.includes('sub'))
})

test('what a file holds stays out, where it went stays in', () => {
  const write = auditLine(req('write_file', { path: 'a/b.txt', content: 'very private text' }), false)!
  assert.ok(write.includes('a/b.txt'))
  assert.ok(!write.includes('very private'))
  assert.ok(write.includes('[17 chars]'))
  const edit = auditLine(req('edit_file', { path: 'c.txt', oldString: 'old private', newString: 'new private' }), false)!
  assert.ok(edit.includes('c.txt'))
  assert.ok(!edit.includes('private'))
})

test('a token handed over and the values of a server\'s environment stay out', () => {
  const token = auditLine(req('github_import', { token: 'value-of-the-token' }, ''), false)!
  assert.ok(!token.includes('value-of-the-token'))
  const server = auditLine(req('add_mcp_server', { name: 's', command: 'npx', env: { API_KEY: 'value-of-the-key' } }), false)!
  assert.ok(server.includes('API_KEY'))
  assert.ok(!server.includes('value-of-the-key'))
})

test('known keys inside a command are masked', () => {
  const key = `ghp_${'a'.repeat(36)}`
  const bot = `123456789:${'b'.repeat(35)}`
  const text = scrub(`curl -H "Authorization: Bearer abcdefghijklmnop" https://api.telegram.org/bot${bot}/getMe; git clone https://${key}@github.com/x/y; PASSWORD=hunter2 run`)
  assert.ok(!text.includes(key))
  assert.ok(!text.includes(bot))
  assert.ok(!text.includes('abcdefghijklmnop'))
  assert.ok(!text.includes('hunter2'))
  assert.ok(text.includes('github.com/x/y'))
})

test('routine questions and the later pieces of a file make no line', () => {
  assert.equal(auditLine(req('project_context'), false), null)
  assert.equal(auditLine(req('list_projects'), false), null)
  assert.ok(auditLine(req('file_get', { path: 'a.bin', offset: 0 }), false))
  assert.equal(auditLine(req('file_get', { path: 'a.bin', offset: 3000 }), false), null)
})

test('a very long entry is cut and says so', () => {
  const line = auditLine(req('run_command', { command: 'x'.repeat(100_000) }), false)!
  assert.ok(line.length < 70_000)
  assert.match(line, /…\[cut, \d+ chars\]/)
})

test('a full journal moves aside; one that can\'t be written never stops the work, and is said once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-audit-'))
  try {
    const file = join(dir, 'audit.log')
    writeFileSync(file, 'x'.repeat(200))
    createAudit(file, () => {}, 100)(req('run_command', { command: 'echo new' }), false)
    assert.ok(existsSync(`${file}.1`))
    assert.ok(statSync(file).size < 200)
    assert.match(readFileSync(file, 'utf8'), /echo new/)

    const said: unknown[][] = []
    const broken = createAudit(join(dir, 'no', 'such', 'folder.log'), (...a) => said.push(a))
    broken(req('run_command', { command: 'a' }), false)
    broken(req('run_command', { command: 'b' }), false)
    assert.equal(said.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
