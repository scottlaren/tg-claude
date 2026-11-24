import { z } from 'zod'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Bump on any incompatible change: both sides refuse to work across versions (§17)
// v2: device MCP servers (hello.mcp, mcp.update, mcp_call)
// v3: files from Telegram into a project (save_attachment, file_put)
// v4: files from a project to Telegram in pieces (file_get), up to 50 MB
export const PROTOCOL_VERSION = 4

// --- tools a device executes ----------------------------------------------------------------
// Raw zod shapes: the server hands them to the Agent SDK as tool schemas, the device validates with them

export const toolParams = {
  list_files: {
    path: z.string().default('.').describe('Folder relative to the project root'),
    depth: z.number().int().min(1).max(5).default(1).describe('How many levels to descend'),
  },
  read_file: {
    path: z.string().describe('File relative to the project root'),
    offset: z.number().int().min(1).optional().describe('First line, 1-based'),
    limit: z.number().int().min(1).max(5000).optional().describe('Number of lines'),
  },
  write_file: {
    path: z.string().describe('File relative to the project root'),
    content: z.string(),
    expectedHash: z.string().optional().describe('Hash from read_file; required when the file already exists'),
  },
  edit_file: {
    path: z.string().describe('File relative to the project root'),
    oldString: z.string().min(1).describe('Exact text to replace, unique in the file unless replaceAll'),
    newString: z.string(),
    expectedHash: z.string().describe('Hash from the last read_file of this file'),
    replaceAll: z.boolean().default(false),
  },
  run_command: {
    command: z.string().optional().describe('Shell script, run by the device shell'),
    program: z.string().optional().describe('Executable to run without a shell'),
    args: z.array(z.string()).default([]).describe('Arguments for program'),
    cwd: z.string().default('.').describe('Working folder relative to the project root'),
    timeoutSec: z.number().int().min(1).max(1800).default(120),
    background: z.boolean().default(false).describe('Start it and return at once: for anything that may run longer than 30 minutes (a full test run, a long render). It keeps running after this call and writes its output to the log file named in the result; read that log later instead of waiting in a command'),
  },
  // Desktop apps listed in the device config (AE, Blender, Roblox Studio…)
  list_apps: {},
  open_app: {
    app: z.string().describe('App id from list_apps'),
    file: z.string().optional().describe('File to open, relative to the project root (.aep, .blend, .rbxl…)'),
  },
  close_app: {
    app: z.string().describe('App id from list_apps'),
    force: z.boolean().default(false).describe('Kill without waiting: unsaved work in the app is lost'),
  },
  // A file from the device to the user's Telegram chat (screenshots, renders, generated images)
  // An image on the computer for Claude to look at itself (a render, a screenshot it made). The server runs
  // this tool: it pulls the file with file_get and hands Claude a copy sized for the API
  view_image: {
    path: z.string().describe('Image file relative to the project root or absolute inside its folders: PNG, JPEG, WebP, GIF; other formats when the server has ffmpeg'),
  },
  send_file: {
    path: z.string().describe('File to send, relative to the project root or absolute inside its folders'),
    caption: z.string().max(1000).optional().describe('Short caption shown under the file'),
  },
  // A file the user sent in Telegram, kept on the server, copied into the project. The server runs
  // this tool itself and streams the file to the device as file_put chunks
  save_attachment: {
    id: z.string().regex(/^[0-9a-f]{8}$/).describe('Attachment id from the 📎 line'),
    path: z.string().optional().describe('Destination relative to the project root; a path ending in / is a folder. Default: the original name in the project root'),
  },
  // Always confirmed by the user, whatever the topic's mode: it widens what the project may touch
  add_project_folder: {
    path: z.string().describe('Absolute path of a folder next to the project, inside the approved workspace'),
  },
  // Always confirmed by the user, whatever the topic's mode: it runs a program on the computer, for every topic there
  add_mcp_server: {
    name: z.string().regex(/^[\w-]{1,40}$/).describe('Short name: its tools become mcp__<name>__*. Latin letters, digits, _ and -'),
    command: z.string().min(1).describe('The program to start, e.g. npx'),
    args: z.array(z.string()).default([]).describe('Its arguments. A package runner needs an exact version, e.g. ["-y", "some-mcp@1.2.3", "mcp"]'),
    env: z.record(z.string(), z.string()).default({}).describe('Environment variables it needs'),
  },
  remove_mcp_server: {
    name: z.string().regex(/^[\w-]{1,40}$/).describe('The name it was added under'),
  },
} as const

export type DeviceTool = keyof typeof toolParams
export const DEVICE_TOOLS = Object.keys(toolParams) as DeviceTool[]
export type ToolInput<T extends DeviceTool> = z.output<z.ZodObject<(typeof toolParams)[T]>>

// Tools that change something on the device; everything else only reads
export const MUTATING_TOOLS: ReadonlySet<DeviceTool> = new Set(['write_file', 'edit_file', 'run_command', 'open_app', 'close_app', 'add_project_folder', 'add_mcp_server', 'remove_mcp_server', 'save_attachment'])

// The names the bot's own tools live under. Its permission check goes by server and tool name, so a program on a computer
// must not pass for one of them
export const RESERVED_MCP_NAMES: readonly string[] = ['device', 'checklist', 'rules', 'fresh_limit', 'new_session', 'lottie', 'night_shift', 'topic', 'topic_name', 'topic_delete', 'topics', 'survey', 'later', 'computer', 'team', 'schedule', 'browser_access', 'browser_open', 'screen', 'screen_access', 'browser_elsewhere', 'workspace_memory', 'claude-in-chrome']

// A name and an exact version: some-mcp@1.2.3, some_mcp==1.2. Not @1 or @1.x, which are whatever is newest within them, and
// not an address that happens to end in a version
const EXACT_PACKAGE = /^(?:@[\w.-]+\/)?[\w.-]+(?:\[[\w,.-]+\])?(?:@\d+\.\d+\.\d+(?:[-+][\w.-]+)?|==\d[\w.!+-]*)$/
const PACKAGE_OPTION = /^(?:-p|--package|--from|--spec)$/
const PACKAGE_OPTION_VALUE = /^(?:-p|--package|--from|--spec)=(.*)$/
// Another place to take the package from, a shell command, more packages next to the one named: the exact version then says nothing
const RUNNER_ELSEWHERE = /^(?:-c|--call|--registry|--userconfig|-i|--index|--index-url|--default-index|--extra-index-url|-f|--find-links|--with|--with-editable|--with-requirements)(?:=|$)/

// A package runner with no exact version starts whatever is newest, every time: the user would have said yes to something else
export function mcpInstallProblem({ name, command, args = [] }: { name: string, command: string, args?: string[] }) {
  if (RESERVED_MCP_NAMES.includes(name)) return `The name "${name}" is taken`
  const program = command.split(/[\\/]/).pop()!.replace(/\.(cmd|exe|bat)$/i, '').toLowerCase()
  const sub = { pnpm: 'dlx', yarn: 'dlx', npm: 'exec', pipx: 'run' }[program]
  if (!['npx', 'bunx', 'uvx'].includes(program) && !(sub && args.includes(sub))) return null
  const rest = sub ? args.slice(args.indexOf(sub) + 1) : args
  const elsewhere = rest.find(a => RUNNER_ELSEWHERE.test(a))
  if (elsewhere) return `${command} ${elsewhere}: it can run something other than the exact package named, so it is not taken`
  const named = rest.flatMap((a, i) => (PACKAGE_OPTION.test(a) ? [rest[i + 1]] : PACKAGE_OPTION_VALUE.exec(a)?.slice(1) ?? []))
  const pkgs = named.length ? named : [rest.find(a => !a.startsWith('-'))]
  const loose = pkgs.find(p => !p || !EXACT_PACKAGE.test(p))
  return pkgs.length && !pkgs.includes(loose) ? null : `${command} needs an exact version of the package, such as some-mcp@1.2.3 (got ${loose ?? 'none'})`
}

export type AppState = { id: string, name: string, running: boolean, mcp?: string }

export type FileEntry = { path: string, type: 'file' | 'dir', size?: number }
export type ToolResult = {
  list_files: { entries: FileEntry[], truncated: boolean }
  read_file: { lines: string[], offset: number, totalLines: number, hash: string }
  write_file: { hash: string, created: boolean }
  edit_file: { hash: string, replacements: number }
  run_command: {
    exitCode: number | null, signal: string | null, timedOut: boolean, cancelled: boolean,
    stdout: string, stderr: string, truncated: boolean, durationMs: number,
    // Started with background: it runs on, its output going to log
    background?: { pid: number, log: string }
  }
  list_apps: { apps: AppState[] }
  // ready: the app's MCP answered its readiness check (or the process is up when it has none)
  open_app: { alreadyRunning: boolean, ready: boolean, waitedMs: number, note?: string }
  close_app: { closed: boolean, forced: boolean, note?: string }
  add_project_folder: { project: Project }
  add_mcp_server: { status: 'connected' | 'starting' | 'failed', tools: number, error?: string }
  remove_mcp_server: { removed: true }
  // What Claude learns: the server pulled the file in pieces (file_get) and uploaded it to Telegram
  send_file: { name: string, size: number }
  view_image: { name: string, size: number, mime: string, data: string }
  save_attachment: { path: string, size: number }
}

// Telegram's limit for what a bot uploads; the file crosses the device link in FILE_CHUNK_BYTES pieces
export const SEND_FILE_MAX_BYTES = 50 * 1024 * 1024
// What a device hands out through file_get at all: a project moved from the cloud is one archive of up to this.
// Each use on the server sets its own, lower limit (Telegram's above, pictures for Claude…)
export const FILE_GET_MAX_BYTES = 1024 ** 3

// One piece of a file going from the server to the device (§15). Pieces of one upload come in order;
// the last one (done) makes the device check size and hash and move the file into place
export const filePutParams = z.object({
  path: z.string(),
  upload: z.string().regex(/^[\w-]{1,40}$/),
  offset: z.number().int().min(0),
  data: z.string().describe('base64'),
  done: z.boolean(),
  size: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
})
export type FilePut = z.infer<typeof filePutParams>
// 3 MB of file is 4 MB of base64: well under the 8 MB message limit of the device link
export const FILE_CHUNK_BYTES = 3 * 1024 * 1024

// One piece of a file going from the device to the server (§15), asked for in order. Every piece carries
// the file's size and modification time, the first one its hash: a file that changes mid-way is caught,
// and a lost piece is simply asked for again from the same offset
export const fileGetParams = z.object({
  path: z.string(),
  offset: z.number().int().min(0),
  length: z.number().int().min(1).max(FILE_CHUNK_BYTES),
})
export type FileChunk = { name: string, size: number, mime: string, mtime: number, sha256?: string, data: string }

// --- MCP servers that run on the device (AE, Blender, Roblox Studio…) ---------------------------
// The device starts them over stdio and reports their tools; the server re-exposes them to Claude
// with the original JSON schemas and forwards each call as an `mcp_call` operation (§10.1)

const McpTool = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  annotations: z.object({
    title: z.string().optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
  }).optional(),
})
export type McpTool = z.infer<typeof McpTool>

export const McpServerInfo = z.object({
  name: z.string().regex(/^[\w-]{1,40}$/),
  status: z.enum(['starting', 'connected', 'failed']),
  version: z.string().optional(),
  error: z.string().optional(),
  tools: z.array(McpTool),
})
export type McpServerInfo = z.infer<typeof McpServerInfo>

export const mcpCallParams = z.object({
  server: z.string(),
  tool: z.string(),
  arguments: z.record(z.string(), z.unknown()).default({}),
  // The topic the call comes from: servers marked perTopic on the device get one process per lane
  lane: z.string().optional(),
})
// The MCP CallToolResult as the app returned it: text, images, resources, structured content
export type McpCallResult = { content: unknown[], structuredContent?: unknown, isError?: boolean }

// Instructions that live on the device and that Claude Code would normally load by itself:
// global and project CLAUDE.md, AGENTS.md, the memory index. Fetched by the server every turn
// modified: when the file last changed, in ms. Absent from a computer on an older version
export type ContextFile = { label: string, path: string, content: string, truncated: boolean, modified?: number }
// project: the project as the device sees it right now (folders granted since hello included)
// A skill on the computer: in the project (.claude/skills) or the user's own (~/.tg-claude-vps/skills). content is its
// SKILL.md, for the server to know a project's new one before Claude is told of it
export type DeviceSkill = { name: string, description: string, path: string, scope: 'project' | 'computer', content: string, modified: number }
export type ProjectContext = { files: ContextFile[], project: Project, skills?: DeviceSkill[] }

// A skill the user chose to keep on a computer: sent whole in one message, so it has to fit in one
export const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/
export const DEVICE_SKILL_BYTES = 4 * 1024 * 1024
const skillWhere = { name: z.string().regex(SKILL_NAME), scope: z.enum(['project', 'computer']) }
export const skillPutParams = z.object({ ...skillWhere, files: z.array(z.object({ path: z.string().min(1).max(300), data: z.string() })).min(1).max(500) })
export const skillRemoveParams = z.object(skillWhere)
export type SkillPut = z.infer<typeof skillPutParams>

// A SKILL.md opens with a front matter block: name and description are what Claude chooses a skill by
export function skillHeader(md: string): { name?: string, description?: string } {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(md)
  if (!m) return {}
  const lines = m[1].split(/\r?\n/)
  const field = (key: string) => {
    const i = lines.findIndex(l => l.startsWith(`${key}:`))
    if (i < 0) return undefined
    const first = lines[i].slice(key.length + 1).trim()
    // A folded or block value (description: >) goes on over the indented lines below it
    if (!first || /^[>|][-+]?$/.test(first)) {
      const end = lines.findIndex((l, j) => j > i && !/^\s/.test(l))
      return lines.slice(i + 1, end < 0 ? undefined : end).map(l => l.trim()).join(' ').trim() || undefined
    }
    return first.replace(/^(["'])(.*)\1$/, '$2').trim() || undefined
  }
  return { name: field('name'), description: field('description') }
}

// The cloud workspace: a container next to the server that connects as one more computer (deploy/compose.yml)
export const CLOUD_DEVICE_ID = 'cloud'

// GitHub in the cloud: the official CLI signs in with a one-time code the user enters on github.com
export type GitHubStatus = { installed: boolean, login: string | null, pending: boolean }
export type GitHubLogin = { code: string, url: string }
// The access a computer already has, handed to the cloud through the server (never through Telegram)
export type GitHubToken = { token: string }

// Operations not tied to a project: the server sends them with an empty projectId
// The user's own Chrome through the server (a Chrome policy on the computer): turned on and off from Telegram
// pending: Chrome hasn't restarted since the last switch, so which way it goes is not known (Windows);
// relaunch: a switch quits and opens Chrome itself (a Mac); why: what stands in the way when not supported
export type BrowserProxyState = { supported: boolean, on: boolean, port: number, pending: boolean, relaunch: boolean, running?: boolean, why?: string }

// A computer moving itself to a release tag; dev: a developer's checkout, left for its owner to update
// waiting: commands still running there, which it restarts after (an older agent restarts at once and doesn't say)
export type SelfUpdateResult = { ok: boolean, from: string, to: string, error?: string, dev?: boolean, waiting?: number }

// Working folders as the bot shows and changes them, at the user's taps (never one of Claude's tools): every folder
// in one is a project. Suggestions are folders in the home folder that hold git projects; roots are where browsing
// can start (home, other drives or volumes)
export type FolderEntry = { name: string, path: string }
export type ZoneInfo = { path: string, projects: number }
export type ZonesState = { home: string, zones: ZoneInfo[], suggestions: ZoneInfo[], roots: FolderEntry[] }
// more: folders past the ones listed
export type FolderList = { path: string, parent: string | null, folders: FolderEntry[], more: number }
export const foldersParams = z.object({ path: z.string().max(1024).optional() })
export const setZonesParams = z.object({ paths: z.array(z.string().min(1).max(1024)).min(1).max(10) })

export const DEVICE_OPS = ['list_projects', 'create_project', 'github_status', 'github_login', 'github_token', 'github_import', 'github_logout', 'browser_proxy', 'self_update', 'open_login', 'open_chrome', 'login_callback', 'zones', 'folders', 'set_zones', 'lock', 'keep_awake', 'settings', 'mcp_restart', 'skill_put', 'skill_remove'] as const
// The screen: Claude sees and drives the computer's desktop, one batch of actions per call. Offered only while the user
// allows it in the topic, and only by a computer that says it can (hello.screen). Coordinates are pixels of the last
// screenshot; a ref is an element from the last `elements` list. Looking and the element actions (press, set, select,
// expand) leave the user's mouse and keyboard alone; the rest waits until the user steps away from the computer
const Point = z.tuple([z.number(), z.number()])
const Ref = z.string().max(20)
const Target = { at: Point.optional(), ref: Ref.optional() }
export const ScreenAction = z.discriminatedUnion('do', [
  z.object({ do: z.literal('screenshot') }),
  z.object({ do: z.literal('zoom'), region: z.tuple([z.number(), z.number(), z.number(), z.number()]) }),
  z.object({ do: z.literal('windows') }),
  z.object({ do: z.literal('focus'), window: z.string().min(1).max(200) }),
  z.object({ do: z.literal('elements'), filter: z.string().max(100).optional() }),
  z.object({ do: z.literal('press'), ref: Ref }),
  z.object({ do: z.literal('set'), ref: Ref, text: z.string().max(20_000) }),
  z.object({ do: z.literal('select'), ref: Ref }),
  z.object({ do: z.literal('expand'), ref: Ref, open: z.boolean().optional() }),
  z.object({ do: z.literal('park') }),
  z.object({ do: z.literal('unpark') }),
  z.object({ do: z.literal('click'), ...Target, button: z.enum(['left', 'right', 'middle']).optional(), count: z.number().int().min(1).max(3).optional() }),
  z.object({ do: z.literal('move'), ...Target }),
  z.object({ do: z.literal('drag'), from: Point, to: Point }),
  z.object({ do: z.literal('scroll'), ...Target, dx: z.number().int().min(-50).max(50).optional(), dy: z.number().int().min(-50).max(50).optional() }),
  z.object({ do: z.literal('type'), text: z.string().min(1).max(20_000) }),
  z.object({ do: z.literal('key'), keys: z.string().min(1).max(60) }),
  z.object({ do: z.literal('wait'), ms: z.number().int().min(0).max(30_000).optional() }),
])
export type ScreenAction = z.infer<typeof ScreenAction>
export const screenParams = {
  window: z.string().max(200).optional(),
  actions: z.array(ScreenAction).min(1).max(20),
  look: z.boolean().optional(),
}
export type ScreenParams = z.output<z.ZodObject<typeof screenParams>>
// What the server sends the computer: Claude's batch, and now when the user said not to wait for them to step away
export const screenRequest = { ...screenParams, now: z.boolean().optional() }
export type ScreenRequest = z.output<z.ZodObject<typeof screenRequest>>
// Actions that only look: all a read-only topic may do
export const SCREEN_LOOKS: ReadonlySet<ScreenAction['do']> = new Set(['screenshot', 'zoom', 'windows', 'elements'])
// waiting: the batch reached an action that needs the real mouse or keyboard while the user is at the computer; the
// first `done` actions ran, the rest is for the server to send again once they step away
export type ScreenResult = { log: string[], image?: { data: string, mime: string, w: number, h: number }, stopped?: string, waiting?: { done: number, idleMs: number } }

export type OpTool = DeviceTool | 'mcp_call' | 'project_context' | 'file_put' | 'file_get' | 'screen' | (typeof DEVICE_OPS)[number]

export const ERROR_CODES = [
  'bad_request', 'outside_root', 'not_found', 'exists', 'conflict', 'binary',
  'not_unique', 'no_match', 'unknown_project', 'expired', 'cancelled', 'failed', 'unavailable', 'read_only', 'locked',
  // server-side outcomes: device never got it / connection dropped mid-operation (§14)
  'offline', 'unknown',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
const OpError = z.object({ code: z.enum(ERROR_CODES), message: z.string() })
export type OpError = z.infer<typeof OpError>

// --- device → server --------------------------------------------------------------------------

const Project = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(64),
  path: z.string(),
  // Folders next to the project it may also work in, e.g. worktrees beside the repo (§9.1)
  extraRoots: z.array(z.string()).default([]),
  // Claude's memory for this project on the device, readable but not writable
  memoryDir: z.string().optional(),
  // A git worktree of another project in the list: the same repository on another branch
  worktreeOf: z.string().optional(),
  branch: z.string().optional(),
  // A folder that only holds worktrees (mfm-wt): a topic may be bound to it, but it isn't offered as a project
  hidden: z.boolean().optional(),
})
export type Project = z.infer<typeof Project>

const Hello = z.object({
  type: z.literal('hello'),
  protocol: z.number().int(),
  deviceId: z.string().regex(/^[\w-]{1,64}$/),
  deviceName: z.string().max(64),
  key: z.string(),
  os: z.enum(['windows', 'macos', 'linux']),
  shell: z.string(),
  projects: z.array(Project),
  mcp: z.array(McpServerInfo).default([]),
  // Apps Claude may start and stop with open_app / close_app
  apps: z.array(z.object({ id: z.string(), name: z.string(), mcp: z.string().optional() })).default([]),
  // The commit the agent runs from: /diag shows a computer left on old code
  version: z.string().max(64).optional(),
  // /lock is on: it refuses every operation until someone at the computer takes the lock off
  locked: z.boolean().optional(),
  // Whether it keeps from sleeping while a task runs. Absent: it can't (Linux) or is too old to
  keepAwake: z.boolean().optional(),
  // It can see and drive its screen for Claude (the screen tool). Absent: too old, or no way to on this system
  screen: z.boolean().optional(),
  // Its release (package.json): the server updates a computer that is behind it. Absent: too old to update itself
  release: z.string().max(32).optional(),
  // Folders every project may read, never change (Downloads…), set on the computer
  shared: z.array(z.string()).default([]),
})

// Sent whenever an app's MCP server connects, drops or changes its tool list (§10.1)
const McpUpdate = z.object({ type: z.literal('mcp.update'), servers: z.array(McpServerInfo) })

// First contact of a new device (§8.2): a one-time code from Telegram buys it an id and its own key.
// The connection closes after the answer; the device then reconnects with hello as usual
const Pair = z.object({
  type: z.literal('pair'),
  protocol: z.number().int(),
  code: z.string().max(32),
  deviceName: z.string().min(1).max(64),
  os: z.enum(['windows', 'macos', 'linux']),
})

// seq orders events of one operation so a reconnect can replay and drop duplicates (§17)
const OpEvent = z.object({
  type: z.literal('op.event'),
  opId: z.string(),
  seq: z.number().int(),
  state: z.enum(['accepted', 'running', 'done', 'error']),
  result: z.unknown().optional(),
  error: OpError.optional(),
})

// --- the browser tunnel (both ways; the pipe itself is in tunnel.ts) -------------------------------------
// The computer's local proxy asks the server to connect somewhere; the bytes then go as data frames with acks
const TunnelOpen = z.object({ type: z.literal('tunnel.open'), sid: z.number().int().min(1), host: z.string().min(1).max(253), port: z.number().int().min(1).max(65535) })
const TunnelOpened = z.object({ type: z.literal('tunnel.opened'), sid: z.number().int(), ok: z.boolean(), error: z.string().max(300).optional() })
const TunnelData = z.object({ type: z.literal('tunnel.data'), sid: z.number().int(), data: z.string() })
const TunnelAck = z.object({ type: z.literal('tunnel.ack'), sid: z.number().int(), bytes: z.number().int().min(0) })
const TunnelClose = z.object({ type: z.literal('tunnel.close'), sid: z.number().int(), error: z.string().max(300).optional() })
export type TunnelOpen = z.infer<typeof TunnelOpen>

export const DeviceMessage = z.discriminatedUnion('type', [Hello, OpEvent, McpUpdate, Pair, TunnelOpen, TunnelData, TunnelAck, TunnelClose])
export type DeviceMessage = z.infer<typeof DeviceMessage>
export type Hello = z.infer<typeof Hello>
export type OpEvent = z.infer<typeof OpEvent>
export type Pair = z.infer<typeof Pair>

// --- server → device --------------------------------------------------------------------------

const Welcome = z.object({ type: z.literal('welcome'), protocol: z.number().int() })
// serverRelease: a computer turned away for an old protocol can update itself to it
const Reject = z.object({ type: z.literal('reject'), reason: z.string(), serverRelease: z.string().max(32).optional() })
// The key is shown to the device once; the server keeps only its hash
const Paired = z.object({ type: z.literal('paired'), deviceId: z.string(), key: z.string(), deviceName: z.string() })

const OpRequest = z.object({
  type: z.literal('op.request'),
  opId: z.string(),
  taskId: z.string().optional(),
  sessionId: z.string().optional(),
  projectId: z.string(),
  bindingVersion: z.number().int(),
  tool: z.enum([...DEVICE_TOOLS, 'mcp_call', 'project_context', 'file_put', 'file_get', 'screen', ...DEVICE_OPS] as unknown as [OpTool, ...OpTool[]]),
  params: z.record(z.string(), z.unknown()),
  permissionId: z.string().optional(),
  deadline: z.number().describe('Epoch ms; the device refuses a request that arrives later'),
})

const OpCancel = z.object({ type: z.literal('op.cancel'), opId: z.string() })

export const ServerMessage = z.discriminatedUnion('type', [Welcome, Reject, Paired, OpRequest, OpCancel, TunnelOpened, TunnelData, TunnelAck, TunnelClose])
export type ServerMessage = z.infer<typeof ServerMessage>
export type OpRequest = z.infer<typeof OpRequest>

// --- helpers ----------------------------------------------------------------------------------

// A self-update that couldn't reach GitHub starts its error with this: the server tries it again later
export const UPDATE_UNREACHED = 'cannot reach GitHub'

// Releases are tags vX.Y.Z; versions compare by number, «0.10.0» after «0.9.9»
export const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/
const parts = (v: string) => (v.startsWith('v') ? v : 'v' + v).match(RELEASE_TAG)?.slice(1).map(Number) ?? null
export function newer(a: string, b: string) {
  const x = parts(a)
  const y = parts(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

// The release a checkout or an image runs: the version in its root package.json
export function releaseOf(dir: string) {
  try {
    return String(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version ?? 'unknown')
  } catch {
    return 'unknown'
  }
}

// Short commit of the checkout a server or agent runs from; "unknown" outside git
export function codeVersion(dir: string) {
  // Images carry no .git: the version is baked in at build time
  if (process.env.TGCV_VERSION && process.env.TGCV_VERSION !== 'unknown') return process.env.TGCV_VERSION
  try {
    // An install from /pair has no git: quietly «unknown», not git's own complaint on the screen
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unknown'
  }
}

export function decode<T>(schema: z.ZodType<T>, raw: unknown): T | null {
  try {
    const r = schema.safeParse(JSON.parse(String(raw)))
    return r.success ? r.data : null
  } catch {
    return null
  }
}

export function parseToolInput<T extends DeviceTool>(tool: T, params: unknown): ToolInput<T> {
  return z.object(toolParams[tool]).parse(params) as unknown as ToolInput<T>
}

export * from './tunnel.ts'
