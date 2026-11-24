import { execFile } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { query, type SDKRateLimitInfo, type ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import { claudeBinary } from './login.ts'

const exec = promisify(execFile)

// Claude profiles (§7): each is its own CLAUDE_CONFIG_DIR next to the default one (data/profiles/<name>),
// so sign-in, sessions and MCP sign-ins never mix. Any number; added on the server with
// `npm run login -- --profile NAME`, never through Telegram. Switching is always the user's tap
export const PROFILE_NAME = /^[\w-]{1,32}$/

export type ProfileStatus = { loggedIn: boolean, email?: string, org?: string, plan?: string, error?: string }
export type Window = { utilization: number | null, resetsAt: string | null }
export type ProfileUsage = { plan: string | null, fiveHour?: Window, sevenDay?: Window, models: (Window & { name: string })[] }

// Seen in a turn: the CLI reports where the profile stands against its plan limits
export type LastLimit = SDKRateLimitInfo & { at: number }

const window = (w: { utilization: number | null, resets_at: string | null } | null | undefined): Window | undefined =>
  w ? { utilization: w.utilization, resetsAt: w.resets_at } : undefined

// The plan by the name people know: `auth status` and /usage still say "max" for an account on Ultra, while the account
// itself says "Claude Ultra". It takes a run of the CLI, so it is kept for a while, and without it the older word will do
const PLAN_KEPT_MS = 6 * 3600_000
const PLAN_ASK_MS = 8000

async function askAccountPlan(cwd: string, env: Record<string, string | undefined>) {
  let release!: () => void
  const done = new Promise<void>(r => (release = r))
  async function* input() {
    await done
  }
  const q = query({ prompt: input(), options: { cwd, env, tools: [], settingSources: [], strictMcpConfig: true, verbatimPrompts: true } })
  try {
    const a = await Promise.race([q.accountInfo(), new Promise<never>((_, fail) => setTimeout(() => fail(new Error('timeout')), PLAN_ASK_MS))])
    return a.subscriptionType
  } catch {
    return undefined
  } finally {
    release()
    q.close?.()
  }
}

export function createProfiles({ defaultDir, cwd, baseEnv, askPlan = askAccountPlan, now = Date.now }: {
  defaultDir: string, cwd: string, baseEnv: Record<string, string | undefined>,
  askPlan?: (cwd: string, env: Record<string, string | undefined>) => Promise<string | undefined>, now?: () => number,
}) {
  const root = dirname(defaultDir)
  const defaultName = basename(defaultDir)
  const statusCache = new Map<string, { at: number, s: ProfileStatus }>()
  const planCache = new Map<string, { at: number, plan: string }>()
  const lastLimit = new Map<string, LastLimit>()

  const dir = (name: string) => join(root, name)
  const nameOf = (name?: string) => (name && PROFILE_NAME.test(name) ? name : defaultName)
  const accountPlan = async (name: string) => {
    const c = planCache.get(name)
    if (c && now() - c.at < PLAN_KEPT_MS) return c.plan
    const plan = await askPlan(cwd, { ...baseEnv, CLAUDE_CONFIG_DIR: dir(name) })
    if (plan) planCache.set(name, { at: now(), plan })
    return plan
  }

  return {
    defaultName,
    nameOf,
    dir: (name?: string) => dir(nameOf(name)),
    accountPlan,
    // Folders next to the default profile; the default one is always listed, first
    list(): string[] {
      const found = existsSync(root)
        ? readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && PROFILE_NAME.test(d.name)).map(d => d.name)
        : []
      return [defaultName, ...found.filter(n => n !== defaultName).sort()]
    },
    env: (name?: string) => ({ ...baseEnv, CLAUDE_CONFIG_DIR: dir(nameOf(name)) }),

    // Right after a sign-in the cached «signed out» is stale
    forget: (name: string) => {
      planCache.delete(name)
      return statusCache.delete(name)
    },
    // Account and plan as the CLI knows them: no model call, cached for a minute
    async status(name: string): Promise<ProfileStatus> {
      const c = statusCache.get(name)
      if (c && Date.now() - c.at < 60_000) return c.s
      let s: ProfileStatus
      try {
        const { stdout } = await exec(claudeBinary(), ['auth', 'status', '--json'], { env: { ...baseEnv, CLAUDE_CONFIG_DIR: dir(name) }, timeout: 20_000, windowsHide: true })
        const j = JSON.parse(stdout)
        s = { loggedIn: !!j.loggedIn, email: j.email, org: j.orgName, plan: (j.loggedIn ? await accountPlan(name) : undefined) ?? j.subscriptionType ?? undefined }
      } catch (e) {
        // `auth status` exits non-zero when signed out; its JSON still says so
        const out = String((e as { stdout?: string }).stdout ?? '')
        try {
          s = { loggedIn: !!JSON.parse(out).loggedIn }
        } catch {
          s = { loggedIn: false, error: (e as Error).message.slice(0, 200) }
        }
      }
      statusCache.set(name, { at: Date.now(), s })
      return s
    },

    // Live plan limits through the CLI's /usage endpoint (no model call, ~1 s). The SDK marks it
    // experimental: on any failure the caller falls back to the limits seen in turns
    async usage(name: string): Promise<ProfileUsage | null> {
      let release!: () => void
      const done = new Promise<void>(r => (release = r))
      async function* input() {
        await done
      }
      const q = query({
        prompt: input(),
        options: { cwd, env: { ...baseEnv, CLAUDE_CONFIG_DIR: dir(name) }, tools: [], settingSources: [], strictMcpConfig: true, verbatimPrompts: true },
      })
      try {
        const u = await Promise.race([
          q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
          new Promise<never>((_, fail) => setTimeout(() => fail(new Error('timeout')), 20_000)),
        ])
        const plan = (await accountPlan(name)) ?? u.subscription_type
        if (!u.rate_limits_available || !u.rate_limits) return { plan, models: [] }
        const r = u.rate_limits
        return {
          plan,
          fiveHour: window(r.five_hour),
          sevenDay: window(r.seven_day),
          models: [
            ...(r.seven_day_opus ? [{ name: 'Opus', ...window(r.seven_day_opus)! }] : []),
            ...(r.seven_day_sonnet ? [{ name: 'Sonnet', ...window(r.seven_day_sonnet)! }] : []),
            ...(r.model_scoped ?? []).map(m => ({ name: m.display_name, utilization: m.utilization, resetsAt: m.resets_at })),
          ],
        }
      } catch {
        return null
      } finally {
        release()
        q.close?.()
      }
    },

    // The models this account offers, as its Claude Code lists them: new ones appear here before any release of ours
    async models(name: string): Promise<ModelInfo[] | null> {
      let release!: () => void
      const done = new Promise<void>(r => (release = r))
      async function* input() {
        await done
      }
      const q = query({
        prompt: input(),
        options: { cwd, env: { ...baseEnv, CLAUDE_CONFIG_DIR: dir(name) }, tools: [], settingSources: [], strictMcpConfig: true, verbatimPrompts: true },
      })
      try {
        return await Promise.race([
          q.supportedModels(),
          new Promise<never>((_, fail) => setTimeout(() => fail(new Error('timeout')), 30_000)),
        ])
      } catch {
        return null
      } finally {
        release()
        q.close?.()
      }
    },

    // Claude's memory lives in the profile, by the folder a session runs in: one per profile would split what it knows of
    // the user between accounts. Every other profile's points at the default one's; notes it already kept move there
    // first, none overwritten
    shareMemory(name: string, cwd: string) {
      if (name === defaultName || !PROFILE_NAME.test(name)) return
      const folder = join('projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), 'memory')
      const shared = join(dir(defaultName), folder)
      const own = join(dir(name), folder)
      try {
        if (lstatSync(own, { throwIfNoEntry: false })?.isSymbolicLink()) return
        mkdirSync(shared, { recursive: true })
        if (existsSync(own)) {
          for (const f of readdirSync(own)) if (!existsSync(join(shared, f))) renameSync(join(own, f), join(shared, f))
          rmSync(own, { recursive: true, force: true })
        }
        mkdirSync(dirname(own), { recursive: true })
        symlinkSync(shared, own, 'dir')
      } catch {}
    },

    noteLimit: (name: string, info: SDKRateLimitInfo) => lastLimit.set(name, { ...info, at: Date.now() }),
    lastLimit: (name: string) => lastLimit.get(name),

    // /cleanup: one conversation (and its side files) out of a profile; false when it was not there
    removeSession(sessionId: string, name: string): boolean {
      const projects = join(dir(name), 'projects')
      if (!existsSync(projects)) return false
      let found = false
      for (const folder of readdirSync(projects)) {
        const file = join(projects, folder, `${sessionId}.jsonl`)
        if (!existsSync(file)) continue
        rmSync(file, { force: true })
        rmSync(join(projects, folder, sessionId), { recursive: true, force: true })
        found = true
      }
      return found
    },
    // Conversations no topic points at any more (/new, another project, a deleted topic) and untouched for
    // a while: on a small VPS they would only pile up. Recent ones stay, a turn may be starting one
    sweepSessions(keep: Set<string>, olderThanMs: number, now = Date.now()): number {
      let removed = 0
      for (const n of this.list()) {
        const projects = join(dir(n), 'projects')
        if (!existsSync(projects)) continue
        for (const folder of readdirSync(projects)) {
          for (const f of readdirSync(join(projects, folder))) {
            const id = f.match(/^(.+)\.jsonl$/)?.[1]
            const file = join(projects, folder, f)
            if (!id || keep.has(id) || now - statSync(file).mtimeMs < olderThanMs) continue
            rmSync(file, { force: true })
            rmSync(join(projects, folder, id), { recursive: true, force: true })
            removed++
          }
        }
      }
      return removed
    },
    // /cleanup: every conversation of every profile; sign-ins and settings stay
    removeAllSessions() {
      for (const n of this.list()) rmSync(join(dir(n), 'projects'), { recursive: true, force: true })
    },

    // Carries a conversation to another profile: the history is a local file of the CLI, so the other
    // account continues it from there (its first answer re-reads the context without cache).
    // False when there is nothing to carry; the caller then starts a new session
    carry(sessionId: string, from: string, to: string): boolean {
      const projects = join(dir(from), 'projects')
      if (!existsSync(projects)) return false
      for (const folder of readdirSync(projects)) {
        const file = join(projects, folder, `${sessionId}.jsonl`)
        if (!existsSync(file)) continue
        const target = join(dir(to), 'projects', folder)
        mkdirSync(target, { recursive: true })
        cpSync(file, join(target, `${sessionId}.jsonl`))
        // Subagent transcripts and saved large tool outputs live next to it
        const side = join(projects, folder, sessionId)
        if (existsSync(side)) cpSync(side, join(target, sessionId), { recursive: true })
        return true
      }
      return false
    },
  }
}

export type Profiles = ReturnType<typeof createProfiles>
