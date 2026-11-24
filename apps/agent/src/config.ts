import { chmodSync, readFileSync, existsSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { hostname, homedir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { CLOUD_DEVICE_ID, type Project, type Hello } from '@tgcv/protocol'
import type { McpServerConfig } from './mcp.ts'
import type { AppConfig } from './apps.ts'
import { memoryDirOf } from './context.ts'
import { knownMcpServers } from './mcp-known.ts'
import type { Zone } from './workspace.ts'

// A Mac's host name ends in «.local» (its name on the local network): the bot shows the computer without it
export const machineName = (name = hostname()) => name.replace(/.local$/i, '')

export type AgentConfig = {
  serverUrl: string
  deviceId: string
  deviceKey: string
  deviceName: string
  shell: string
  projects: Project[]
  // App MCP servers this device runs: they stay here, only their tools are announced to the server
  mcpServers: Record<string, McpServerConfig>
  // Desktop apps Claude may open and close (open_app / close_app)
  apps: Record<string, AppConfig>
  // Folders approved on this computer: their subfolders are projects to pick from Telegram
  zones: Zone[]
  // Working folders in the config that are gone from the disk: skipped, so the agent still starts
  missingZones?: string[]
  // Folders every project may read but never change (Downloads…): set only here, on the computer
  shared: string[]
  // The browser tunnel's local proxy (socks5://127.0.0.1:<port>), 0 when off
  browserProxyPort: number
  // Kept from sleeping while a task runs; unset: the default of the system
  keepAwake?: boolean
}

export const deviceOs = (): Hello['os'] =>
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'

// Bash syntax is what Claude writes best: Git Bash on Windows when present
function defaultShell() {
  if (process.platform === 'darwin') return '/bin/zsh'
  if (process.platform !== 'win32') return '/bin/bash'
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
  return existsSync(gitBash) ? gitBash : 'powershell.exe'
}

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory()

export const configFile = () => process.env.AGENT_CONFIG ?? 'agent.config.json'

// The stdio MCP servers of this computer's Claude Code (~/.claude.json); remote ones belong on the server
export function claudeMcpServers(home = homedir()): Record<string, McpServerConfig> {
  try {
    const all = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers ?? {}
    return Object.fromEntries(Object.entries(all as Record<string, McpServerConfig>).filter(([, s]) => s.command))
  } catch {
    return {}
  }
}

// The MCP servers this agent runs: its own list, next to its config, so nothing depends on another program's files.
// Env values can be keys: closed to file tools like the config itself
export const mcpFile = (config = configFile()) => join(dirname(resolve(config)), 'agent.mcp.json')
export type McpFile = { mcpServers: Record<string, McpServerConfig>, imported: string[] }

// Null when it is there but can't be read: then it must not be written over. A bad entry costs that server, not the agent
export function readMcpFile(file: string): McpFile | null {
  if (!existsSync(file)) return { mcpServers: {}, imported: [] }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const mcpServers = Object.fromEntries(Object.entries((raw.mcpServers ?? {}) as Record<string, McpServerConfig>).filter(([name, s]) => {
      if (s?.command && /^[\w-]{1,40}$/.test(name) && name !== 'device') return true
      console.error(`${file}: MCP server "${name}" skipped: the name is letters, digits, _ and -, and it needs a command`)
      return false
    }))
    return { mcpServers, imported: Array.isArray(raw.imported) ? raw.imported : [] }
  } catch (e) {
    console.error(`${file} skipped: ${(e as Error).message}`)
    return null
  }
}

// It holds this computer's key, and on a Mac other accounts may read what isn't closed: for its user alone, like the MCP list
export function writeConfigFile(file: string, cfg: object) {
  const temp = `${file}.tmp`
  writeFileSync(temp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })
  renameSync(temp, file)
  chmodSync(file, 0o600)
}

export function writeMcpFile(file: string, list: McpFile) {
  const temp = `${file}.tmp`
  writeFileSync(temp, JSON.stringify(list, null, 2) + '\n', { mode: 0o600 })
  renameSync(temp, file)
  chmodSync(file, 0o600)
}

// What this computer has already goes into the list once: from then on the list is what counts, so one taken out of it
// stays out and the source may go away. Unwritable, the servers still run this time
export function pullMcp(file: string, found: Record<string, McpServerConfig>): Record<string, McpServerConfig> {
  const list = readMcpFile(file)
  if (!list) return found
  const fresh = Object.keys(found).filter(name => !list.imported.includes(name) && !list.mcpServers[name] && /^[\w-]{1,40}$/.test(name) && name !== 'device')
  if (!fresh.length) return list.mcpServers
  const mcpServers = { ...list.mcpServers, ...Object.fromEntries(fresh.map(name => [name, found[name]])) }
  try {
    writeMcpFile(file, { mcpServers, imported: [...list.imported, ...fresh] })
  } catch (e) {
    console.error(`${file} not saved: ${(e as Error).message}`)
  }
  return mcpServers
}

// Starts from the agent's own list; entries in the config's mcpServers adjust (perTopic, timeouts)
// or add servers, mcpExclude drops some
export function mergeMcp(raw: { mcpFromClaude?: boolean, mcpServers?: Record<string, Partial<McpServerConfig>>, mcpExclude?: string[] }, imported: Record<string, McpServerConfig>) {
  const merged: Record<string, McpServerConfig> = {}
  const base = raw.mcpFromClaude ? imported : {}
  for (const name of new Set([...Object.keys(base), ...Object.keys(raw.mcpServers ?? {})])) {
    if (raw.mcpExclude?.includes(name)) continue
    const entry = { ...base[name], ...raw.mcpServers?.[name] } as McpServerConfig
    if (entry.command) merged[name] = entry
  }
  return merged
}

// The computer's key goes to the server in every hello, and with every update it downloads. Over anything but TLS it
// can be read on the way. So a plain ws:// address is taken for this same computer only (development), for the cloud
// container, whose link to the server never leaves the VPS, and from one who wrote "plainServer": true into the config
// knowing what it means
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i
export function plainServerProblem(serverUrl: string, { cloud = false, allowed = false } = {}): string | null {
  let url: URL
  try {
    url = new URL(serverUrl)
  } catch {
    return `The server address is not an address: ${serverUrl}`
  }
  if (url.protocol === 'wss:') return null
  if (url.protocol !== 'ws:') return `The server address must start with wss://: ${serverUrl}`
  if (cloud || allowed || LOOPBACK.test(url.hostname)) return null
  return `${serverUrl} is not encrypted: this computer's key would cross the network in the open. Use the wss:// address (the bot's /pair gives it). For a server on a network of your own, put "plainServer": true into agent.config.json`
}

export function loadConfig(file = configFile(), home = homedir()): AgentConfig {
  if (!existsSync(file)) throw new Error(`No ${resolve(file)}: create it with npm run agent -- init`)
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  if (!raw.serverUrl) throw new Error(`serverUrl is not set in ${file}`)
  if (!raw.deviceId || !raw.deviceKey) throw new Error('This computer is not paired yet: send /pair to the bot and run the command it sends back')
  const plain = plainServerProblem(raw.serverUrl, { cloud: raw.deviceId === CLOUD_DEVICE_ID, allowed: raw.plainServer === true })
  if (plain) throw new Error(plain)
  // Roots are stored as real paths: every later check compares against the resolved form
  const dir = (id: string, path: string) => {
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`Project ${id}: no folder ${path}`)
    return realpathSync(path)
  }
  const projects: Project[] = (raw.projects ?? []).map((p: Project) => {
    const path = dir(p.id, p.path)
    return {
      id: p.id,
      name: p.name || p.id,
      path,
      extraRoots: (p.extraRoots ?? []).map(r => dir(p.id, r)),
      memoryDir: memoryDirOf(path),
    }
  })
  // Unless turned off: a config older than the flag has it missing. The cloud's servers are fixed
  const found = raw.mcpFromClaude !== false && raw.deviceId !== CLOUD_DEVICE_ID ? { ...knownMcpServers(deviceOs(), home), ...claudeMcpServers(home) } : {}
  const mcpServers = mergeMcp({ ...raw, mcpFromClaude: true }, pullMcp(mcpFile(file), found))
  for (const [name, s] of Object.entries(mcpServers)) {
    // The name becomes part of Claude's tool names: mcp__<name>__<tool>
    if (!/^[\w-]{1,40}$/.test(name) || name === 'device') throw new Error(`MCP server "${name}": the name is letters, digits, _ and -, and not "device"`)
    if (!s.command) throw new Error(`MCP server ${name}: command is not set`)
  }
  return {
    serverUrl: raw.serverUrl,
    deviceId: raw.deviceId,
    deviceKey: raw.deviceKey,
    deviceName: machineName(raw.deviceName || hostname()),
    shell: raw.shell || defaultShell(),
    projects,
    mcpServers,
    apps: raw.apps ?? {},
    zones: (raw.zones ?? []).filter((z: Zone) => isDir(z.path)).map((z: Zone) => ({ path: realpathSync(z.path), exclude: z.exclude ?? [] })),
    missingZones: (raw.zones ?? []).filter((z: Zone) => !isDir(z.path)).map((z: Zone) => z.path),
    browserProxyPort: Number.isInteger(raw.browserProxyPort) ? raw.browserProxyPort : 1089,
    ...(typeof raw.keepAwake === 'boolean' && { keepAwake: raw.keepAwake }),
    shared: (raw.shared ?? []).map((p: string) => {
      const path = p.replace(/^~(?=$|[\\/])/, homedir())
      if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`Shared folder ${p}: no such folder (shared in ${file})`)
      return realpathSync(path)
    }),
  }
}
