import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSettings } from '../src/settings.ts'

function stand() {
  const home = mkdtempSync(join(tmpdir(), 'tgcv-settings-'))
  mkdirSync(join(home, '.tg-claude-vps'))
  const mcpFile = join(home, 'agent.mcp.json')
  return { home, mcpFile, settings: createSettings({ mcpFile, home }), done: () => rmSync(home, { recursive: true, force: true }) }
}

test('the servers go with the names of their keys, never the values', () => {
  const s = stand()
  try {
    writeFileSync(s.mcpFile, JSON.stringify({ mcpServers: { figma: { command: 'npx', args: ['-y', 'figma-mcp@1.2.3'], env: { FIGMA_TOKEN: 'secret-value' } } }, imported: [] }))
    const got = s.settings.read()
    assert.deepEqual(got.mcp, [{ name: 'figma', command: 'npx', args: ['-y', 'figma-mcp@1.2.3'], env: ['FIGMA_TOKEN'] }])
    assert.ok(!JSON.stringify(got).includes('secret-value'))
  } finally {
    s.done()
  }
})

test('the global instructions: read, none at all, written on request', () => {
  const s = stand()
  try {
    assert.equal(s.settings.read().rules, null)
    assert.deepEqual(s.settings.read().mcp, [])
    s.settings.setRules('# Rules\n- short\n')
    assert.equal(readFileSync(join(s.home, '.tg-claude-vps', 'CLAUDE.md'), 'utf8'), '# Rules\n- short\n')
    assert.equal(s.settings.read().rules, '# Rules\n- short\n')
    assert.throws(() => s.settings.setRules('x'.repeat(70_000)), /too long/)
  } finally {
    s.done()
  }
})
