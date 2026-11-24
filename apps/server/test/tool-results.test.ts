import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toolResultImage } from '../src/claude/tool-results.ts'

function stand() {
  const root = mkdtempSync(join(tmpdir(), 'tgcv-profiles-'))
  const results = join(root, 'main', 'projects', '-home-node-claude-cwd', '92b66e7e-2739', 'tool-results')
  mkdirSync(results, { recursive: true })
  writeFileSync(join(results, 'mcp-after-effects-blob-1793-e592aw.png'), 'png')
  writeFileSync(join(results, 'notes.txt'), 'text')
  writeFileSync(join(root, 'main', '.credentials.json'), '{}')
  return { root, results, done: () => rmSync(root, { recursive: true, force: true }) }
}

test('a picture an app returned in a session is found on the server', () => {
  const s = stand()
  try {
    const file = join(s.results, 'mcp-after-effects-blob-1793-e592aw.png')
    assert.ok(toolResultImage(file, s.root))
  } finally {
    s.done()
  }
})

test('nothing else of the server: no other file, no other folder, no way out, no relative path', () => {
  const s = stand()
  try {
    assert.equal(toolResultImage(join(s.results, 'notes.txt'), s.root), null, 'not a picture')
    assert.equal(toolResultImage(join(s.root, 'main', '.credentials.json'), s.root), null, 'not a tool result')
    assert.equal(toolResultImage(join(s.results, '..', '..', '..', '..', '.credentials.json'), s.root), null)
    assert.equal(toolResultImage(join(s.results, 'missing.png'), s.root), null, 'not there')
    assert.equal(toolResultImage('tool-results/mcp-after-effects-blob-1793-e592aw.png', s.root), null, 'a path on a computer')
  } finally {
    s.done()
  }
})
