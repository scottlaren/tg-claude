// Live check of the remote Figma MCP through the server profile (§10.2): `npm run live:figma`
// Shows whether the profile is signed in to Figma and which tools the server would offer Claude
import { query } from '@anthropic-ai/claude-agent-sdk'
import { loadConfig } from '../src/config.ts'

const cfg = loadConfig({ ...process.env, TG_TOKEN: process.env.TG_TOKEN || '-' })
const q = query({
  prompt: process.argv[2] ?? 'Call the Figma whoami tool and reply with the account name and plan only.',
  options: {
    cwd: cfg.claudeCwd,
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg.profileDir },
    tools: ['ToolSearch'],
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: { figma: { type: 'http', url: 'https://mcp.figma.com/mcp' } },
    canUseTool: async (tool, input, { mcpServer }) => {
      console.log('canUseTool', tool, JSON.stringify(mcpServer))
      return { behavior: 'allow', updatedInput: input }
    },
    maxTurns: 6,
  },
})
for await (const m of q) {
  if (m.type === 'system' && m.subtype === 'init') {
    console.log('mcp_servers', JSON.stringify(m.mcp_servers))
    console.log('tools', m.tools.filter(t => t.startsWith('mcp__')).length, m.tools.filter(t => t.startsWith('mcp__')).slice(0, 40).join(' '))
  }
  if (m.type === 'result') console.log('result', m.subtype, 'result' in m ? m.result : '', JSON.stringify(m.usage?.input_tokens))
}
process.exit(0)
