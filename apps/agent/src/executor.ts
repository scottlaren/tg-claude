import { z } from 'zod'
import {
  parseToolInput, mcpCallParams, screenRequest, skillPutParams, skillRemoveParams, filePutParams, fileGetParams, foldersParams, setZonesParams, DEVICE_OPS, type OpRequest, type OpEvent, type Project, type OpTool, type OpError,
} from '@tgcv/protocol'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { ToolError, type Roots } from './paths.ts'
import { listFiles, readTextFile, writeTextFile, editTextFile, readChunk, putFileChunk } from './files.ts'
import { runCommand } from './command.ts'
import { projectContext, skillsDirOf, putSkill, removeSkill } from './context.ts'
import type { McpHub } from './mcp.ts'
import type { McpManager } from './mcp-manager.ts'
import type { Apps } from './apps.ts'
import type { Workspace } from './workspace.ts'
import type { Zones } from './zones.ts'
import type { GitHub } from './github.ts'
import type { ChromePolicy } from './chrome-policy.ts'
import type { Lock } from './lock.ts'
import type { KeepAwake } from './keep-awake.ts'
import type { Settings } from './settings.ts'
import type { SelfUpdateResult } from '@tgcv/protocol'
import { waitLoginCallback } from './login-callback.ts'
import type { Screen } from './screen/index.ts'

// The project folder first (relative paths start there), then its extra folders, then memory and the
// computer's shared folders, both read-only
export const rootsOf = (p: Project, shared: string[] = []): Roots => [
  { path: p.path },
  ...p.extraRoots.map(path => ({ path })),
  ...(p.memoryDir ? [{ path: p.memoryDir, readOnly: true }] : []),
  ...shared.map(path => ({ path, readOnly: true })),
]

type Emit = (ev: OpEvent) => void
// bytes and finishedAt: set once it has ended, what it holds in memory and since when
type Op = { tool: OpTool, events: OpEvent[], abort: AbortController, finished: boolean, bytes: number, finishedAt: number }

const JOURNAL_SIZE = 500
// What a server may still come back for after a lost link or its own restart. A file piece is 3 MB and a picture from
// an app's MCP can be more: without a limit on bytes this is gigabytes
const JOURNAL_BYTES = 64 * 1024 * 1024
const JOURNAL_TTL_MS = 6 * 3600_000
// Asked for every turn or every few seconds: logging them would drown the real operations
const QUIET: ReadonlySet<OpTool> = new Set(['project_context', 'list_projects', 'github_status', 'zones', 'folders'])
const deviceOp = (tool: OpTool) => (DEVICE_OPS as readonly string[]).includes(tool)

export function createExecutor({ projects = [], workspace, zones, shell, log, mcp, mcpManager, apps, shared = [], github, chromePolicy, selfUpdate, openLogin, openChrome, screen, lock, audit, awake, settings, meter, journalBytes = JOURNAL_BYTES, journalTtlMs = JOURNAL_TTL_MS, skillsDir = skillsDirOf() }: {
  projects?: Project[], workspace?: Workspace, zones?: Zones, shell: string, log: (...a: unknown[]) => void, mcp?: McpHub, mcpManager?: McpManager, apps?: Apps, shared?: string[],
  journalBytes?: number, journalTtlMs?: number, skillsDir?: string,
  github?: GitHub, chromePolicy?: ChromePolicy, selfUpdate?: (tag: string, sha256?: string) => Promise<SelfUpdateResult>,
  // Claude's sign-in page for the server, in a window here that goes out through the server
  openLogin?: (url: string) => Promise<{ browser: string, own?: boolean }>,
  openChrome?: () => Promise<{ started: boolean }>,
  // Claude's eyes and hands on this desktop; absent where there is none to drive
  screen?: Screen,
  lock?: Lock,
  audit?: (req: OpRequest, refused: boolean) => void,
  awake?: KeepAwake,
  settings?: Settings,
  // What a command cost in processor time (load.ts)
  meter?: () => () => number,
}) {
  const githubOrFail = () => {
    if (!github) throw new ToolError('unavailable', 'GitHub is not set up on this device')
    return github
  }
  const zonesOrFail = () => {
    if (!zones) throw new ToolError('unavailable', 'The working folders of this device do not change')
    return zones
  }
  const appsOrFail = () => {
    if (!apps) throw new ToolError('unavailable', 'No apps are set up on this device (apps in agent.config.json)')
    return apps
  }
  // Looked up per operation: projects appear in the zone and gain folders while the agent runs
  const projectOf = (id: string) => workspace?.get(id) ?? projects.find(p => p.id === id)

  // Every operation id ever seen (bounded): a repeated request replays the outcome instead of running twice (§14)
  const ops = new Map<string, Op>()
  let kept = 0

  // Oldest first, never one still running: the server is waiting to hear how that ends
  function prune() {
    const now = Date.now()
    for (const [id, op] of ops) {
      if (!op.finished) continue
      if (ops.size <= JOURNAL_SIZE && kept <= journalBytes && now - op.finishedAt <= journalTtlMs) continue
      ops.delete(id)
      kept -= op.bytes
    }
  }

  function settle(op: Op) {
    op.finished = true
    op.finishedAt = Date.now()
    op.bytes = JSON.stringify(op.events).length
    kept += op.bytes
    prune()
  }

  // The same repository on other branches. A topic on the repository can step into a worktree with its commands and name
  // what it made from there, while the server asks from the project's root. Several may have the file: the newest counts.
  // Null when none has it; each read goes through the same checks as any other
  // A full path into one worktree where the file isn't (Claude named the wrong one of several) is looked for at the same
  // place in the others
  async function chunkFromWorktrees(project: Project, input: { path: string, offset: number, length: number }) {
    const repo = project.worktreeOf ?? project.id
    const others = (workspace?.list(true) ?? []).filter(p => p.id !== project.id && (p.id === repo || p.worktreeOf === repo))
    if (!others.length) return null
    let rel = input.path
    let among = others
    if (isAbsolute(input.path)) {
      const home = [project, ...others].find(p => within(p.path, input.path))
      if (!home) return readChunk(others.map(p => ({ path: p.path, readOnly: true })), input)
      if (home !== project && await stat(input.path).then(st => st.isFile(), () => false)) return readChunk([{ path: home.path, readOnly: true }], input)
      rel = relative(resolve(home.path), resolve(input.path))
      among = [project, ...others].filter(p => p !== home)
    }
    const found = await Promise.all(among.map(async p => ({ p, st: await stat(join(p.path, rel)).catch(() => null) })))
    const newest = found.filter(f => f.st?.isFile()).sort((a, b) => b.st!.mtimeMs - a.st!.mtimeMs)[0]
    return newest ? readChunk(newest.p.path, { ...input, path: rel }) : null
  }
  const within = (dir: string, p: string) => {
    const rel = relative(resolve(dir), resolve(p))
    return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
  }

  async function run(tool: OpTool, project: Project, params: unknown, signal: AbortSignal): Promise<unknown> {
    // The user's own skills: Claude is told of them by path, and reads them from any project
    const root = rootsOf(project, existsSync(skillsDir) ? [...shared, skillsDir] : shared)
    switch (tool) {
      case 'project_context': return projectContext(project)
      case 'list_projects': return workspace?.list(true) ?? projects
      case 'create_project': {
        if (!workspace) throw new ToolError('unavailable', 'No working folder is set up on this device')
        return workspace.createProject(String((params as { name?: unknown }).name ?? ''))
      }
      case 'github_status': return githubOrFail().status()
      case 'github_login': return githubOrFail().login()
      case 'github_logout': return githubOrFail().logout()
      case 'skill_put': return putSkill(project, skillPutParams.parse(params), skillsDir)
      case 'skill_remove': return removeSkill(project, skillRemoveParams.parse(params), skillsDir)
      case 'mcp_restart':
        if (!mcp) throw new ToolError('unavailable', 'No app MCP servers are set up on this device')
        return mcp.restart(String((params as { server?: unknown }).server ?? ''))
      case 'self_update':
        if (!selfUpdate) throw new ToolError('unavailable', 'This computer does not update itself')
        return selfUpdate(String((params as { tag?: unknown }).tag ?? ''), (params as { sha256?: string }).sha256)
      case 'open_login':
        if (!openLogin) throw new ToolError('unavailable', 'A sign-in window cannot be opened on this device')
        try {
          return await openLogin(String((params as { url?: unknown }).url ?? ''))
        } catch (e) {
          throw new ToolError('unavailable', (e as Error).message)
        }
      case 'screen':
        if (!screen) throw new ToolError('unavailable', 'This computer cannot drive its screen')
        return screen.run(z.object(screenRequest).parse(params))
      case 'open_chrome':
        if (!openChrome) throw new ToolError('unavailable', 'Chrome cannot be opened on this device')
        try {
          return await openChrome()
        } catch (e) {
          throw new ToolError('unavailable', (e as Error).message)
        }
      case 'login_callback': {
        if (!openLogin) throw new ToolError('unavailable', 'A sign-in window cannot be opened on this device')
        const port = Number((params as { port?: unknown }).port)
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new ToolError('bad_request', 'Not a port for a sign-in')
        try {
          return await waitLoginCallback(port)
        } catch (e) {
          throw new ToolError('unavailable', (e as Error).message)
        }
      }
      case 'browser_proxy': {
        if (!chromePolicy) throw new ToolError('unavailable', 'Chrome through the server is not available on this device')
        const action = (params as { action?: unknown }).action
        if (action === 'on') return chromePolicy.on()
        if (action === 'off') return chromePolicy.off()
        return chromePolicy.status()
      }
      case 'lock': {
        if (!lock) throw new ToolError('unavailable', 'This device cannot be locked')
        lock.lock()
        log('🔒 locked from the bot: every operation is refused until this file is deleted:', lock.file)
        // What is already running goes too: the point is that nothing more happens here
        for (const o of ops.values()) if (!o.finished && o.abort.signal !== signal) o.abort.abort()
        return { file: lock.file }
      }
      case 'settings': {
        if (!settings) throw new ToolError('unavailable', 'This device has no settings to move')
        const rules = (params as { rules?: unknown }).rules
        return typeof rules === 'string' ? settings.setRules(rules) : settings.read()
      }
      case 'keep_awake': {
        if (!awake) throw new ToolError('unavailable', 'This device has no switch for sleep')
        const on = (params as { on?: unknown }).on
        if (typeof on === 'boolean') awake.set(on)
        return awake.state()
      }
      case 'zones': return zonesOrFail().state()
      case 'folders': return zonesOrFail().folders(foldersParams.parse(params).path)
      case 'set_zones': return zonesOrFail().set(setZonesParams.parse(params).paths)
      case 'github_token': return githubOrFail().token()
      case 'github_import': return githubOrFail().importToken(String((params as { token?: unknown }).token ?? ''))
      case 'add_project_folder': {
        if (!workspace) throw new ToolError('unavailable', 'No working folder is set up on this device')
        return { project: workspace.addFolder(project.id, parseToolInput(tool, params).path) }
      }
      case 'add_mcp_server':
      case 'remove_mcp_server': {
        if (!mcpManager) throw new ToolError('unavailable', 'MCP servers cannot be changed on this device')
        return tool === 'add_mcp_server' ? mcpManager.add(parseToolInput(tool, params)) : mcpManager.remove(parseToolInput(tool, params))
      }
      case 'list_files': return listFiles(root, parseToolInput(tool, params))
      case 'read_file': return readTextFile(root, parseToolInput(tool, params))
      case 'file_get': {
        const input = fileGetParams.parse(params)
        return readChunk(root, input).catch(async e => {
          if (!(e instanceof ToolError) || (e.code !== 'not_found' && e.code !== 'outside_root')) throw e
          // What was wrong in the first place is what gets said, whatever the look elsewhere ran into
          const other = await chunkFromWorktrees(project, input).catch(() => null)
          if (!other) throw e
          return other
        })
      }
      // Runs on the server, which pulls the file with file_get and uploads it to Telegram
      case 'send_file': throw new ToolError('bad_request', 'send_file is run by the server, not the device')
      case 'view_image': throw new ToolError('bad_request', 'view_image is run by the server, not the device')
      case 'write_file': return writeTextFile(root, parseToolInput(tool, params))
      case 'edit_file': return editTextFile(root, parseToolInput(tool, params))
      case 'run_command': {
        const spent = meter?.()
        try {
          const r = await runCommand(root, shell, parseToolInput(tool, params), signal)
          // One left running in the background has spent nothing yet
          return spent && !r.background ? { ...r, coreSec: spent() } : r
        } finally {
          spent?.()
        }
      }
      case 'file_put': return putFileChunk(root, filePutParams.parse(params))
      // Runs on the server, which holds the file and sends it here as file_put
      case 'save_attachment': throw new ToolError('bad_request', 'save_attachment is run by the server, not the device')
      case 'list_apps': return appsOrFail().list()
      case 'open_app': return appsOrFail().open(root, parseToolInput(tool, params), signal)
      case 'close_app': return appsOrFail().close(parseToolInput(tool, params), signal)
      case 'mcp_call': {
        if (!mcp) throw new ToolError('unavailable', 'No app MCP servers are set up on this device')
        const p = mcpCallParams.parse(params)
        return mcp.call(p.server, p.tool, p.arguments, signal, p.lane)
      }
    }
  }

  function toOpError(e: unknown): OpError {
    if (e instanceof ToolError) return { code: e.code, message: e.message }
    if ((e as Error)?.name === 'ZodError') return { code: 'bad_request', message: `Invalid parameters: ${(e as Error).message}` }
    return { code: 'failed', message: (e as Error)?.message ?? String(e) }
  }

  async function handle(req: OpRequest, emit: Emit) {
    const seen = ops.get(req.opId)
    if (seen) {
      seen.events.forEach(emit)
      return
    }
    const op: Op = { tool: req.tool, events: [], abort: new AbortController(), finished: false, bytes: 0, finishedAt: 0 }
    ops.set(req.opId, op)
    const send = (ev: Omit<OpEvent, 'type' | 'opId' | 'seq'>) => {
      const full: OpEvent = { type: 'op.event', opId: req.opId, seq: op.events.length + 1, ...ev }
      op.events.push(full)
      emit(full)
    }

    // Before anything else about the request: what was asked for while locked is what a record is there to show
    const refused = !!lock?.locked() && req.tool !== 'lock'
    audit?.(req, refused)
    if (refused) {
      send({ state: 'error', error: { code: 'locked', message: 'This computer is locked (/lock in the bot). Only someone at the computer can unlock it, so do not look for a way round it: tell the user.' } })
      if (!QUIET.has(req.tool)) log('op', req.tool, 'refused: locked')
      return settle(op)
    }

    if (Date.now() > req.deadline) {
      send({ state: 'error', error: { code: 'expired', message: 'The request arrived after it expired' } })
      return settle(op)
    }
    const project = deviceOp(req.tool) ? { id: '', name: '', path: '', extraRoots: [] } : projectOf(req.projectId)
    if (!project) {
      send({ state: 'error', error: { code: 'unknown_project', message: `Project ${req.projectId} is not connected on this device` } })
      return settle(op)
    }

    send({ state: 'accepted' })
    const started = Date.now()
    const label = req.tool === 'mcp_call' ? `${req.params.server}.${req.params.tool}` : req.tool
    // Asking about the computer is no work to stay awake for
    const working = !QUIET.has(req.tool) && !deviceOp(req.tool)
    if (working) awake?.hold()
    try {
      const result = await run(req.tool, project, req.params, op.abort.signal)
      send({ state: 'done', result })
      if (!QUIET.has(req.tool)) log('op', label, project.id, 'ok', `${Date.now() - started}ms`)
    } catch (e) {
      const error = toOpError(e)
      send({ state: 'error', error })
      log('op', label, project.id, error.code, error.message)
    } finally {
      if (working) awake?.release()
      settle(op)
    }
  }

  return {
    handle,
    cancel(opId: string) {
      const op = ops.get(opId)
      if (op && !op.finished) op.abort.abort()
    },
    // What a restart would cut off. The update that asks for the restart doesn't count
    running: () => [...ops.values()].filter(op => !op.finished && op.tool !== 'self_update').length,
  }
}
