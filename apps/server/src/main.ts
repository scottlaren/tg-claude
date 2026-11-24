// Server: Telegram bot + Claude sessions + gateway for devices. `npm run server`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, gitRootOf } from './config.ts'
import { createLogger, surviveRejections } from './log.ts'
import { createGateway } from './gateway.ts'
import { createDeviceRegistry, createPairing } from './devices.ts'
import { createTopicStore } from './store.ts'
import { createWorkspaceStore } from './workspaces.ts'
import { createBot } from './telegram/bot.ts'
import { createInbox } from './attachments.ts'
import { createBrowserStore } from './browsers.ts'
import { createProfiles } from './profiles.ts'
import { createOwners } from './owners.ts'
import { scheduleBackups } from './backup.ts'
import { mediaConfig, missingForSpeech } from './media.ts'
import { watchSandbox, type SandboxState } from './sandbox.ts'
import { APP_VERSION } from './diag.ts'
import { createUpdates, repoOf } from './updates.ts'
import { agentBundles } from './bundle.ts'
import { createInstallRoutes } from './install.ts'
import { createHealth } from './health.ts'
import { fileURLToPath } from 'node:url'

const cfg = loadConfig()
const log = createLogger(join(cfg.dataDir, 'logs/server.log'))
surviveRejections(log)
// Claude's working directory on the server: an empty folder it has no tools to touch (§9.4).
// Inside a git repo, Claude Code would read that repo's branch and changed files into every
// conversation — the server's own code, presented as if it were the user's project
const workDir = cfg.claudeCwd
const repo = gitRootOf(workDir)
if (repo) throw new Error(`CLAUDE_CWD ${workDir} is inside the git repository ${repo}: Claude would see its status. Pick a folder outside any repository`)
mkdirSync(workDir, { recursive: true })
mkdirSync(cfg.profileDir, { recursive: true })

const registry = createDeviceRegistry(join(cfg.dataDir, 'devices.json'), cfg.deviceKeys)
const pairing = createPairing()
// The agent computers download (one line from /pair, then their updates): baked into the image, or built once
// from this checkout when the server runs from one
const bundles = agentBundles({
  prebuilt: process.env.AGENT_BUNDLE ?? '/app/agent-bundle.tar.gz',
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  cacheDir: cfg.dataDir,
  version: APP_VERSION,
  log,
})
const install = createInstallRoutes({ pairing, registry, publicUrl: cfg.publicUrl, bundles })
const health = createHealth(Date.now, cfg.healthStaleMs)
const gateway = createGateway({ port: cfg.wsPort, host: cfg.wsHost, registry, pairing, log, release: APP_VERSION, http: (req, res) => health.route(req, res) || install(req, res) })
log.info(`gateway ws://${cfg.wsHost}:${cfg.wsPort}/device (devices dial ${cfg.publicUrl}), known: ${registry.list().map(d => d.id).join(', ') || 'none yet — /pair'}`)

const topics = createTopicStore(join(cfg.dataDir, 'topics.json'), { warn: m => log.warn('topics not saved', m) })
const workspaces = createWorkspaceStore(join(cfg.dataDir, 'workspaces.json'))
// Files from Telegram wait here until Claude saves them to a computer; speech and video are handled on the server
const inbox = createInbox(join(cfg.dataDir, 'inbox'))
const media = mediaConfig(process.env, cfg.dataDir)
const noSpeech = missingForSpeech(media)
if (noSpeech.length) log.warn(`voice messages won't be transcribed: missing ${noSpeech.join(', ')}`)
if (!media.ffmpeg || !media.ffprobe) log.warn('videos without frames: no ffmpeg/ffprobe on PATH (FFMPEG_BIN, FFPROBE_BIN)')

const browsers = createBrowserStore(join(cfg.dataDir, 'browsers.json'))
// Claude's processes get the server's environment minus the bot's own secrets and addresses: it has no shell
// on the server, and even so none of this should be one tool away
const PRIVATE_ENV = new Set(['TG_TOKEN', 'OWNER_IDS', 'DEVICE_KEYS', 'CLAIM_CODE', 'BACKUP_KEY', 'CLOUD_KEY', 'PUBLIC_WS_URL', 'DOMAIN', 'WS_HOST', 'WS_PORT', 'SANDBOX', 'UPDATE_DIR', 'TGCV_REPO', 'TG_API_ROOT'])
// …and anything named like a secret that may be added later; Claude's own sign-in variables stay
const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|_KEYS?)$/i
const CLAUDE_OWN = /^(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_AUTH_TOKEN)$/
const claudeEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !PRIVATE_ENV.has(k) && (CLAUDE_OWN.test(k) || !SECRET_NAME.test(k))))
const profiles = createProfiles({ defaultDir: cfg.profileDir, cwd: workDir, baseEnv: { ...claudeEnv, CLAUDE_AGENT_SDK_CLIENT_APP: `tg-claude/${APP_VERSION}` } })
log.info(`Claude profiles: ${profiles.list().join(', ')} (default ${profiles.defaultName})`)
// §16: one encrypted copy a day, 7 kept; without BACKUP_KEY there are none, and /diag says so
const backups = cfg.backupKey ? scheduleBackups({ dataDir: cfg.dataDir, outDir: cfg.backupDir, key: cfg.backupKey, log }) : null
if (!backups) log.warn('backups are off: no BACKUP_KEY (npm run backup -- key)')
const owners = createOwners(join(cfg.dataDir, 'owners.json'), cfg.ownerIds)
// For the message about SSH logins, sent by the VPS itself (deploy/tgcv-ssh-alert.sh), on a server claimed with a code
if (process.env.UPDATE_DIR && owners.mainOnly()[0]) {
  try {
    writeFileSync(join(process.env.UPDATE_DIR, 'main-owner'), String(owners.mainOnly()[0]))
  } catch {}
}
// On the VPS: the firewall is checked from inside the container, and the owner hears when it is missing
let sandboxChanged = (_s: SandboxState) => {}
const sandbox = watchSandbox({ log, onChange: s => sandboxChanged(s) })
// New releases on GitHub; on the VPS a helper outside the container switches to one (deploy/tgcv-update.sh)
const updates = createUpdates({
  repo: repoOf(process.env.TGCV_REPO ?? '') ?? 'scottlaren/tg-claude',
  current: APP_VERSION,
  stateFile: join(cfg.dataDir, 'updates.json'),
  dir: process.env.UPDATE_DIR,
})
const bot = createBot({ cfg, topics, workspaces, gateway, registry, pairing, log, workDir, inbox, media, browsers, profiles, owners, sandbox, updates, bundles })
sandboxChanged = s => bot.sandboxChanged(s)
bot.bot.api.config.use(health.watch)
await bot.start()

async function shutdown() {
  await Promise.race([bot.stop(), new Promise(r => setTimeout(r, 5000))])
  topics.flush()
  inbox.close()
  gateway.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
