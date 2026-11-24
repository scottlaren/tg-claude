import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import type { McpServerInfo, McpCallResult, McpTool } from '@tgcv/protocol'
import type { OpOutcome } from '../gateway.ts'

// Long app operations (renders, bakes) are bounded on the device; this only keeps the CLI from giving up first
const CALL_TIMEOUT_MS = 30 * 60_000

export const appToolPrefix = (server: string) => `mcp__${server}__`

export function appToolOf(name: string, apps: McpServerInfo[]): { app: McpServerInfo, tool: McpTool } | null {
  for (const app of apps) {
    const prefix = appToolPrefix(app.name)
    if (!name.startsWith(prefix)) continue
    const tool = app.tools.find(t => t.name === name.slice(prefix.length))
    if (tool) return { app, tool }
  }
  return null
}

// An app's MCP server as reported by the device, re-exposed in-process with its own JSON schemas:
// the SDK's tool() helper wants zod, so the list/call handlers are set on the low-level server
export function createAppServer(info: McpServerInfo, call: (tool: string, args: Record<string, unknown>) => Promise<OpOutcome>): McpSdkServerConfigWithInstance {
  const server = new McpServer({ name: info.name, version: info.version ?? '0' }, { capabilities: { tools: {} } })
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: info.tools.map(t => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: { type: 'object' as const, ...t.inputSchema },
      annotations: t.annotations,
    })),
  }))
  server.server.setRequestHandler(CallToolRequestSchema, async req => {
    const out = await call(req.params.name, req.params.arguments ?? {})
    if (!out.ok) return { content: [{ type: 'text' as const, text: `[${out.error.code}] ${out.error.message}` }], isError: true }
    // Passed through as the app returned it: images, resources and structured errors included (§10.1)
    const r = out.result as McpCallResult
    return {
      content: r.content as never[],
      ...(r.structuredContent !== undefined && { structuredContent: r.structuredContent as Record<string, unknown> }),
      ...(r.isError && { isError: true }),
    }
  })
  return { type: 'sdk', name: info.name, instance: server, timeout: CALL_TIMEOUT_MS }
}
