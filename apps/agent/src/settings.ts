import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { readMcpFile } from './config.ts'
import { ToolError } from './paths.ts'

// What one computer can offer another: the MCP servers added here and the global instructions. Keys stay where they are:
// of an environment only its names leave this computer
export type PortableMcp = { name: string, command: string, args: string[], env: string[] }
export type PortableSettings = { mcp: PortableMcp[], rules: string | null }

const RULES_MAX = 64 * 1024

export function createSettings({ mcpFile, home = homedir() }: { mcpFile: string, home?: string }) {
  const rulesFile = join(home, '.tg-claude-vps', 'CLAUDE.md')
  return {
    read(): PortableSettings {
      const list = readMcpFile(mcpFile)
      const mcp = Object.entries(list?.mcpServers ?? {}).map(([name, s]) => ({ name, command: s.command, args: s.args ?? [], env: Object.keys(s.env ?? {}) }))
      const rules = existsSync(rulesFile) ? readFileSync(rulesFile, 'utf8') : null
      return { mcp, rules }
    },
    // On the user's tap in the bot, with the text of another of their computers
    setRules(text: string) {
      if (text.length > RULES_MAX) throw new ToolError('bad_request', 'The instructions are too long to move')
      mkdirSync(dirname(rulesFile), { recursive: true })
      writeFileSync(`${rulesFile}.tmp`, text)
      renameSync(`${rulesFile}.tmp`, rulesFile)
      return { written: true }
    },
  }
}

export type Settings = ReturnType<typeof createSettings>
