import { mcpInstallProblem, type ToolInput, type ToolResult } from '@tgcv/protocol'
import { readMcpFile, writeMcpFile } from './config.ts'
import type { McpHub } from './mcp.ts'
import { ToolError } from './paths.ts'

const CONNECT_WAIT_MS = 120_000

// A server added or removed from Telegram, after the user's yes: written down first, so it outlasts a restart
export function createMcpManager({ file, hub, connectWaitMs = CONNECT_WAIT_MS }: { file: string, hub: McpHub, connectWaitMs?: number }) {
  const current = () => {
    const list = readMcpFile(file)
    if (!list) throw new ToolError('failed', `${file} can't be read: nothing was changed. The user can fix or delete the file on the computer`)
    return list
  }
  return {
    async add({ name, command, args, env }: ToolInput<'add_mcp_server'>): Promise<ToolResult['add_mcp_server']> {
      const problem = mcpInstallProblem({ name, command, args })
      if (problem) throw new ToolError('bad_request', problem)
      const list = current()
      if (list.mcpServers[name] || hub.info(name)) throw new ToolError('exists', `An MCP server named ${name} is already on this computer: remove it first, or pick another name`)
      const cfg = { command, ...(args.length && { args }), ...(Object.keys(env).length && { env }) }
      writeMcpFile(file, { mcpServers: { ...list.mcpServers, [name]: cfg }, imported: [...new Set([...list.imported, name])] })
      hub.add(name, cfg)
      // A package is downloaded on its first start: the hub tries again by itself after a slow one
      for (const end = Date.now() + connectWaitMs; Date.now() < end && hub.info(name)?.status !== 'connected'; await new Promise(r => setTimeout(r, Math.min(1000, connectWaitMs)))) {}
      const info = hub.info(name)
      return { status: info?.status ?? 'failed', tools: info?.tools.length ?? 0, ...(info?.error && { error: info.error }) }
    },

    async remove({ name }: ToolInput<'remove_mcp_server'>): Promise<ToolResult['remove_mcp_server']> {
      const list = current()
      if (!list.mcpServers[name]) throw new ToolError('not_found', hub.info(name) ? `${name} is set in agent.config.json: only the user changes that file` : `No MCP server named ${name} on this computer`)
      const { [name]: _gone, ...rest } = list.mcpServers
      // Stays in imported: it isn't pulled in again
      writeMcpFile(file, { mcpServers: rest, imported: [...new Set([...list.imported, name])] })
      await hub.remove(name)
      return { removed: true }
    },
  }
}

export type McpManager = ReturnType<typeof createMcpManager>
