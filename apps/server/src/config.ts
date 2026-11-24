import { resolve, join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { EFFORTS, type Effort } from './store.ts'
import { parseRemote, type RemoteServers } from './claude/remote.ts'
import { parseKey } from './backup.ts'
import { CLOUD_DEVICE_ID } from '@tgcv/protocol'

export type ServerConfig = {
  token: string
  // Tests only: a local stand-in for Telegram. Unset, grammY and file downloads go to api.telegram.org
  apiRoot?: string
  ownerIds: number[]
  // One-time code the installer prints: t.me/<bot>?start=<code> makes the sender the owner (once)
  claimCode?: string
  deviceKeys: Map<string, string>
  wsHost: string
  wsPort: number
  // The address devices dial, shown in pairing instructions: wss://… behind the TLS proxy on the VPS
  publicUrl: string
  dataDir: string
  profileDir: string
  // Claude's working directory on the server; must not be inside a git repo (see main.ts)
  claudeCwd: string
  // Default models when a topic hasn't picked one with /model: project work, and "No project" topics
  model: string
  chatModel: string
  effort: Effort
  apiTimeoutSec: number
  // Remote MCP servers reached from the server (Figma by default)
  remoteMcp: RemoteServers
  // A topic nobody writes in for this many days is deleted with its conversation, after a warning; 0 keeps them
  topicTtlDays: number
  // Claude turns running at once across all topics (§14); the rest wait their turn
  maxParallel: number
  // How long Claude waits for the extension after Chrome starts
  chromeConnectMs?: number
  // How long a computer must stay online before tasks put off for it are announced, and again before they start
  deferredSettleMs?: number
  // Tests: how long an update and a turn cut off by a restart wait
  updateWaitMs?: number
  deviceWaitMs?: number
  // After a limit's reset, before work goes on: its clock and ours needn't agree
  limitGraceMs?: number
  // How often a repository is looked at for merged worktrees
  worktreeCheckMs?: number
  limitTickMs?: number
  // The night shift: how often it is looked at, after how long a quiet head is woken, and for tests a harmless stand-in
  // for putting a computer to sleep
  shiftTickMs?: number
  shiftQuietMs?: number
  shiftSleep?: { program: string, args: string[] }
  shiftOff?: { program: string, args: string[] }
  shiftTidy?: { program: string, args: string[] }
  // For tests: the morning this long after the start, instead of 9:00 in the user's time zone
  shiftMorningInMs?: number
  // How long a voice message's list of tasks waits for a tap before it goes as it was said
  voiceListAutoMs?: number
  // For tests: how often due scheduled tasks are looked for
  scheduleTickMs?: number
  // For tests: one threshold for every window instead of 80% of 5 hours and 90% of a week
  freshOfferPct?: number
  recoveryDeviceWaitMs?: number
  recoveryOpWaitMs?: number
  recoveryNoteMs?: number
  promptWatchMs?: number
  answerWaitMs?: number
  // Between tries of a file download from Telegram
  downloadRetryMs?: number
  // Before a computer that couldn't reach GitHub tries its update again
  updateRetryMs?: number
  // Before a picture the computer didn't have yet is looked for again
  mediaRetryMs?: number
  // An app's MCP call waiting this long gets a card to restart its bridge
  appHangMs?: number
  // How often the heads' team boards are looked at
  boardTickMs?: number
  // A week's limit in Opus units, for the share a topic is told it spent
  weekEstimate?: number
  // A night shift wraps up this long after it starts, instead of at 5:00
  shiftWrapInMs?: number
  // How long after the order to turn off a computer still on is reported
  shiftOffCheckMs?: number
  healthStaleMs?: number
  // §16: daily encrypted copies; off without a key
  backupDir: string
  backupKey?: Buffer
}

const ids = (s = '') => [...new Set(s.split(/[\s,;]+/).filter(x => /^\d{1,20}$/.test(x)).map(Number))]

// DEVICE_KEYS=pc=<key>: keys set by hand before /pair existed; new devices pair from Telegram instead
function deviceKeys(s = '') {
  const map = new Map<string, string>()
  for (const pair of s.split(',').map(x => x.trim()).filter(Boolean)) {
    const i = pair.indexOf('=')
    if (i > 0) map.set(pair.slice(0, i), pair.slice(i + 1))
  }
  return map
}

// The cloud container (deploy/compose.yml) gets the same CLOUD_KEY from .env: it connects without /pair
const withCloud = (keys: Map<string, string>, cloudKey?: string) => (cloudKey ? keys.set(CLOUD_DEVICE_ID, cloudKey) : keys)

export function loadConfig(env = process.env): ServerConfig {
  if (!env.TG_TOKEN) throw new Error('TG_TOKEN is not set (.env)')
  const dataDir = resolve(env.DATA_DIR ?? 'data')
  const wsHost = env.WS_HOST ?? '127.0.0.1'
  const wsPort = Number(env.WS_PORT ?? 8787)
  return {
    token: env.TG_TOKEN,
    apiRoot: env.TG_API_ROOT || undefined,
    ownerIds: ids(env.OWNER_IDS),
    claimCode: env.CLAIM_CODE || undefined,
    deviceKeys: withCloud(deviceKeys(env.DEVICE_KEYS), env.CLOUD_KEY),
    wsHost,
    wsPort,
    publicUrl: env.PUBLIC_WS_URL ?? `ws://${wsHost === '0.0.0.0' ? '127.0.0.1' : wsHost}:${wsPort}/device`,
    dataDir,
    // Claude profile = its own CLAUDE_CONFIG_DIR: login, settings and sessions stay apart (§7)
    profileDir: resolve(env.CLAUDE_PROFILE_DIR ?? `${dataDir}/profiles/main`),
    // Outside the code checkout by default: Claude Code reads the git status of its cwd into the context
    claudeCwd: resolve(env.CLAUDE_CWD ?? join(homedir(), '.tg-claude-vps', 'claude-cwd')),
    model: env.CLAUDE_MODEL || 'opus',
    chatModel: env.CLAUDE_CHAT_MODEL || 'sonnet',
    // Economy by default: thinking is the biggest share of output tokens; a topic raises it with /model
    effort: (EFFORTS as readonly string[]).includes(env.CLAUDE_EFFORT ?? '') ? env.CLAUDE_EFFORT as Effort : 'medium',
    // A minute proved too short for long thinking and big conversations; a dead network still fails in three
    apiTimeoutSec: Number(env.API_TIMEOUT_SEC ?? 180),
    remoteMcp: parseRemote(env.REMOTE_MCP),
    maxParallel: Math.max(1, Number(env.MAX_PARALLEL) || 2),
    topicTtlDays: Math.max(0, Number(env.TOPIC_TTL_DAYS ?? 7) || 0),
    backupDir: resolve(env.BACKUP_DIR ?? 'backups'),
    backupKey: parseKey(env.BACKUP_KEY),
  }
}

// The nearest folder above dir (or dir itself) that holds a .git, if any
export function gitRootOf(dir: string): string | null {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d
    if (dirname(d) === d) return null
  }
}
