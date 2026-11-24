// Tiny stdio MCP server standing in for an app (AE, Blender…) in tests
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'echo-app', version: '1.2.3' })

server.registerTool('echo', {
  description: 'Echo text back',
  inputSchema: { text: z.string() },
  annotations: { readOnlyHint: true },
}, async ({ text }) => ({ content: [{ type: 'text', text: `echo: ${text}` }] }))

// Reports when it ran, so a test can see whether two calls overlapped
server.registerTool('slow', {
  description: 'Takes 150 ms',
  inputSchema: { tag: z.string() },
}, async ({ tag }) => {
  const start = Date.now()
  await new Promise(r => setTimeout(r, 150))
  return { content: [{ type: 'text', text: JSON.stringify({ tag, start, end: Date.now() }) }] }
})

// Which server process answered: per-topic instances must be different processes
server.registerTool('pid', { description: 'Process id', annotations: { readOnlyHint: true } }, async () => ({
  content: [{ type: 'text', text: String(process.pid) }],
}))

// Never answers: an app's bridge waiting on an app that is gone
server.registerTool('hang', { description: 'Never returns' }, async () => new Promise(() => {}))

server.registerTool('fail', { description: 'Always reports an error' }, async () => ({
  content: [{ type: 'text', text: 'composition not found' }], isError: true,
}))

await server.connect(new StdioServerTransport())
