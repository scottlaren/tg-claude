// Live check of Claude in Chrome through the server's Claude (§10.6): `npm run live:chrome`
// Only lists the browsers the account can reach; it opens no tabs. Prints what the SDK reports
// about the integration: its tools, their origin for permissions, and the browsers
import { query } from '@anthropic-ai/claude-agent-sdk'
import { loadConfig } from '../src/config.ts'

const cfg = loadConfig({ ...process.env, TG_TOKEN: process.env.TG_TOKEN || '-' })
const q = query({
  prompt: process.argv[2] ?? 'Call list_connected_browsers from the Chrome tools and print its raw result. Do nothing else in the browser.',
  options: {
    cwd: cfg.claudeCwd,
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg.profileDir },
    tools: ['ToolSearch'],
    settingSources: [],
    strictMcpConfig: true,
    extraArgs: { chrome: null },
    canUseTool: async (tool, input, { mcpServer }) => {
      console.log('canUseTool', tool, JSON.stringify(mcpServer), JSON.stringify(input).slice(0, 200))
      return { behavior: 'allow', updatedInput: input }
    },
    maxTurns: 6,
  },
})
for await (const m of q) {
  if (m.type === 'system' && m.subtype === 'init') {
    console.log('mcp_servers', JSON.stringify(m.mcp_servers))
    const mcp = m.tools.filter(t => t.startsWith('mcp__'))
    console.log('tools', mcp.length, mcp.join(' '))
  }
  if (m.type === 'user') {
    for (const c of (m.message.content as { type: string, content?: unknown }[])) if (c.type === 'tool_result') console.log('tool_result', JSON.stringify(c.content).slice(0, 800))
  }
  if (m.type === 'result') console.log('result', m.subtype, 'result' in m ? m.result.slice(0, 600) : '')
}
process.exit(0)
