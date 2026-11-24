import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveExe, type AppConfig } from './apps.ts'
import { claudeMcpServers, machineName } from './config.ts'
import { knownMcpServers } from './mcp-known.ts'

// Where the user's projects usually live; the first that exists becomes the workspace zone
const ZONE_GUESSES = ['Desktop/code', 'code', 'Projects', 'Developer', 'dev']

// Desktop apps with an MCP server we know how to drive; only those installed here are written
const APP_PRESETS: Record<'windows' | 'macos', Record<string, AppConfig>> = {
  windows: {
    'after-effects': {
      name: 'After Effects', exe: 'C:\\Program Files\\Adobe\\Adobe After Effects *\\Support Files\\AfterFX.exe', process: 'AfterFX.exe',
      mcp: 'after-effects', ready: { tool: 'check-bridge', expect: '"bridgeResponding": true' }, startTimeoutSec: 240,
    },
    blender: {
      name: 'Blender', exe: 'C:\\Program Files\\Blender Foundation\\Blender *\\blender.exe', process: 'blender.exe',
      mcp: 'blender', ready: { tool: 'get_objects_summary' }, startTimeoutSec: 120,
    },
  },
  macos: {
    'after-effects': {
      name: 'After Effects', exe: '/Applications/Adobe After Effects */Adobe After Effects *.app', process: 'After Effects',
      mcp: 'after-effects', ready: { tool: 'check-bridge', expect: '"bridgeResponding": true' }, startTimeoutSec: 240,
    },
    blender: {
      name: 'Blender', exe: '/Applications/Blender.app', process: 'Blender',
      mcp: 'blender', ready: { tool: 'get_objects_summary' }, startTimeoutSec: 120,
    },
  },
}

export const claudeMcpNames = (home = homedir()) => Object.keys(claudeMcpServers(home))

// A first agent.config.json for this computer; pairing fills in deviceId and deviceKey
export function defaultConfig({ os, serverUrl, zone, name, home = homedir() }: {
  os: 'windows' | 'macos' | 'linux', serverUrl: string, zone?: string, name?: string, home?: string,
}) {
  const zonePath = zone ?? ZONE_GUESSES.map(z => join(home, z)).find(p => existsSync(p))
  const mcp = [...Object.keys(knownMcpServers(os, home)), ...claudeMcpNames(home)]
  const presets = os === 'linux' ? {} : APP_PRESETS[os]
  const apps = Object.fromEntries(Object.entries(presets).filter(([, a]) => resolveExe(a.exe) && (!a.mcp || mcp.includes(a.mcp))))
  return {
    serverUrl,
    deviceName: name ?? machineName(),
    zones: zonePath ? [{ path: zonePath, exclude: [] }] : [],
    // Readable from every project, never writable: files the user downloads land here
    shared: existsSync(join(home, 'Downloads')) ? ['~/Downloads'] : [],
    projects: [],
    // What this computer has (Claude Code's list, if there is one) goes into agent.mcp.json; entries below only adjust them
    mcpFromClaude: true,
    mcpServers: Object.fromEntries(mcp.filter(n => /roblox/i.test(n)).map(n => [n, { perTopic: true }])),
    apps,
  }
}
