import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { McpServerConfig } from './mcp.ts'

// App MCP servers we know how to start, found by where they are installed. None of them is a package anyone can
// download: Roblox's comes with Studio, the other two are local builds, so a computer without them gets nothing here
export function knownMcpServers(os: 'windows' | 'macos' | 'linux', home: string): Record<string, McpServerConfig> {
  const found: Record<string, McpServerConfig> = {}
  const roblox = join(home, 'AppData', 'Local', 'Roblox', 'mcp.bat')
  if (os === 'windows' && existsSync(roblox)) found.Roblox_Studio = { command: 'cmd.exe', args: ['/c', roblox], perTopic: true }
  const afterEffects = join(home, '.codex', 'mcp', 'after-effects-mcp-modal-safe', 'build', 'index.js')
  if (existsSync(afterEffects)) found['after-effects'] = { command: 'node', args: [afterEffects] }
  const blender = os === 'windows'
    ? join(home, 'tools', 'blender-mcp', 'venv', 'Scripts', 'blender-mcp.exe')
    : join(home, 'tools', 'blender-mcp', 'venv', 'bin', 'blender-mcp')
  if (existsSync(blender)) found.blender = { command: blender }
  return found
}
