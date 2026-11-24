import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRemote, isRemoteTool, DEFAULT_REMOTE } from '../src/claude/remote.ts'

test('Figma is on by default; REMOTE_MCP replaces the list or switches it off', () => {
  assert.deepEqual(parseRemote(undefined), DEFAULT_REMOTE)
  assert.deepEqual(parseRemote(''), {})
  assert.deepEqual(parseRemote('none'), {})
  assert.deepEqual(parseRemote('figma=https://mcp.figma.com/mcp, notion=https://mcp.notion.com/mcp'),
    { figma: 'https://mcp.figma.com/mcp', notion: 'https://mcp.notion.com/mcp' })
  // Only https, only plain names
  assert.deepEqual(parseRemote('x=http://plain.example/mcp,bad name=https://a.b/mcp,=https://a.b'), {})
})

test('a remote tool is trusted by its server as the SDK reports it, not by its name', () => {
  const remote = { figma: 'https://mcp.figma.com/mcp' }
  assert.equal(isRemoteTool('mcp__figma__use_figma', { name: 'figma', source: 'dynamic' }, remote), true)
  // Same name from somewhere else, or another server's tool under the figma prefix
  assert.equal(isRemoteTool('mcp__figma__use_figma', { name: 'figma', source: 'sdk' }, remote), false)
  assert.equal(isRemoteTool('mcp__figma__use_figma', { name: 'figma', source: 'claudeai' }, remote), false)
  assert.equal(isRemoteTool('mcp__figma__use_figma', { name: 'notion', source: 'dynamic' }, remote), false)
  assert.equal(isRemoteTool('mcp__figma__use_figma', undefined, remote), false)
  assert.equal(isRemoteTool('mcp__figma__use_figma', { name: 'figma', source: 'dynamic' }, {}), false)
})
