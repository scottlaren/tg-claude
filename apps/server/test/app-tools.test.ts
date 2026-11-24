import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServerInfo } from '@tgcv/protocol'
import type { OpOutcome } from '../src/gateway.ts'
import { createAppServer, appToolOf } from '../src/claude/app-tools.ts'

const info: McpServerInfo = {
  name: 'blender', status: 'connected', version: '1.30.0',
  tools: [
    { name: 'get_objects_summary', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'execute_blender_code', description: 'Run Python', inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } },
  ],
}

async function connect(call: (tool: string, args: Record<string, unknown>) => Promise<OpOutcome>) {
  const cfg = createAppServer(info, call)
  const [a, b] = InMemoryTransport.createLinkedPair()
  await cfg.instance.connect(a)
  const client = new Client({ name: 't', version: '0' })
  await client.connect(b)
  return client
}

test('the app keeps its own tool names and JSON schemas', async () => {
  const client = await connect(async () => ({ ok: true, result: { content: [] } }))
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map(t => t.name), ['get_objects_summary', 'execute_blender_code'])
  assert.deepEqual(tools[1].inputSchema.required, ['code'])
  assert.equal(tools[0].annotations?.readOnlyHint, true)
})

test('results pass through untouched, images included; transport failures become tool errors', async () => {
  const seen: unknown[] = []
  const image = { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }
  const client = await connect(async (tool, args) => {
    seen.push([tool, args])
    return tool === 'get_objects_summary'
      ? { ok: true, result: { content: [image, { type: 'text', text: 'Cube' }] } }
      : { ok: false, error: { code: 'unavailable', message: 'Blender is not running' } }
  })
  const ok = await client.callTool({ name: 'get_objects_summary', arguments: {} })
  assert.deepEqual(ok.content, [image, { type: 'text', text: 'Cube' }])
  const bad = await client.callTool({ name: 'execute_blender_code', arguments: { code: 'x' } })
  assert.equal(bad.isError, true)
  assert.deepEqual(bad.content, [{ type: 'text', text: '[unavailable] Blender is not running' }])
  assert.deepEqual(seen, [['get_objects_summary', {}], ['execute_blender_code', { code: 'x' }]])
})

test('a tool name maps back to its app and definition', () => {
  assert.equal(appToolOf('mcp__blender__execute_blender_code', [info])?.tool.name, 'execute_blender_code')
  assert.equal(appToolOf('mcp__blender__nope', [info]), null)
  assert.equal(appToolOf('mcp__device__read_file', [info]), null)
})
