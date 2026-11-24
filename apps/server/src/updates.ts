import { readFileSync, renameSync, writeFileSync, existsSync, rmSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { newer, RELEASE_TAG } from '@tgcv/protocol'

// New releases (§updates): GitHub says what the newest one is, the owner decides when. On a VPS a helper outside
// the container does the switch: the server leaves a request in a folder they share and reads the outcome back.
// The folder holds only a tag, so a server taken over can do no more than ask for an official newer release
export type Release = { version: string, tag: string, notes: string, url: string }
export type UpdateResult = { ok: boolean, from: string, to: string, error?: string }

const DAY_MS = 24 * 3600_000
const NOTES_MAX = 1200
const RU_NOTES = /^### Русский[ \t]*$/m
const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max).replace(/\n[^\n]*$/, '') + '\n…' : s).trim()

// A release's text in one language. English comes first, Russian under a “### Русский” heading; older releases have
// only one text, shown in any language. The cut is per language, or the English would push the Russian out
export function notesIn(notes: string, language: 'en' | 'ru') {
  const at = notes.search(RU_NOTES)
  if (at < 0) return cut(notes, NOTES_MAX)
  return cut(language === 'ru' ? notes.slice(at).replace(RU_NOTES, '') : notes.slice(0, at), NOTES_MAX)
}

// owner/name from the address the installer clones
export const repoOf = (url: string) => url.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1] ?? null

export function createUpdates({ repo, current, stateFile, dir, fetch: get = fetch, now = Date.now }: {
  repo: string, current: string, stateFile: string, dir?: string, fetch?: typeof fetch, now?: () => number,
}) {
  // notified: the release the owners were told about; remindAt: «tomorrow»; agents: device id → release it was asked to take
  type State = { notified?: string, skipped?: string, remindAt?: number, agents?: Record<string, string>, updateMessage?: { chatId: number, messageId: number } }
  const read = (): State => {
    try {
      return JSON.parse(readFileSync(stateFile, 'utf8'))
    } catch {
      return {}
    }
  }
  const write = (patch: Partial<State>) => {
    mkdirSync(dirname(stateFile), { recursive: true })
    writeFileSync(`${stateFile}.tmp`, JSON.stringify({ ...read(), ...patch }, null, 2))
    renameSync(`${stateFile}.tmp`, stateFile)
  }

  const github = async (path: string) => {
    const res = await get(`https://api.github.com/repos/${repo}/${path}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'tg-claude' },
      signal: AbortSignal.timeout(15_000),
    })
    return res.ok ? res.json() : null
  }
  const trim = (s: string) => cut(s, NOTES_MAX * 3)

  const helperFile = (name: string) => join(dir!, name)
  // The VPS helper is installed and listening (the installer leaves this mark)
  const helper = () => !!dir && existsSync(helperFile('ready'))

  // The newest release: a GitHub Release with its notes, or else the highest vX.Y.Z tag
  type GitHubRelease = { tag_name?: string, body?: string, html_url?: string } | null
  const fromRelease = (r: GitHubRelease): Release | null =>
    r?.tag_name && RELEASE_TAG.test(r.tag_name) ? { version: r.tag_name.slice(1), tag: r.tag_name, notes: trim(r.body ?? ''), url: r.html_url ?? '' } : null
  const fromTags = (names: string[]): Release | null => {
    const best = names.filter(t => RELEASE_TAG.test(t)).reduce<string | null>((a, t) => (!a || newer(t, a) ? t : a), null)
    return best ? { version: best.slice(1), tag: best, notes: '', url: `https://github.com/${repo}/releases/tag/${best}` } : null
  }

  // On the VPS the helper asks GitHub (it holds the read-only token, the container never does) and leaves the
  // answers here: release.json as GitHub gave it, tags.txt from git ls-remote
  // A tag newer than the last GitHub Release wins, without notes
  const pick = (rel: Release | null, tag: Release | null) => (rel && (!tag || !newer(tag.version, rel.version)) ? rel : tag)
  const readOr = <T>(f: () => T, fallback: T) => {
    try {
      return f()
    } catch {
      return fallback
    }
  }

  function fromHelper(): Release | null {
    const rel = readOr(() => fromRelease(JSON.parse(readFileSync(helperFile('release.json'), 'utf8'))), null)
    const tags = readOr(() => [...readFileSync(helperFile('tags.txt'), 'utf8').matchAll(/refs\/tags\/(v\d+\.\d+\.\d+)$/gm)].map(m => m[1]), [])
    return pick(rel, fromTags(tags))
  }

  // Null when GitHub can't say. A server without the helper asks GitHub itself, which needs a public repo
  async function latest(): Promise<Release | null> {
    if (helper()) return fromHelper()
    try {
      const rel = fromRelease(await github('releases/latest'))
      return pick(rel, fromTags(((await github('tags?per_page=100')) ?? []).map((t: { name: string }) => t.name)))
    } catch {
      return null
    }
  }

  // A fresh look by the helper, waited for a little: it answers in a few seconds. Both its answers are waited for:
  // a helper from before 0.2.2 writes the tags first and the release notes a moment later
  async function refresh(waitMs = 25_000) {
    if (!helper()) return
    const mtime = (name: string) => {
      try {
        return statSync(helperFile(name)).mtimeMs
      } catch {
        return 0
      }
    }
    const tags = mtime('tags.txt')
    const notes = mtime('release.json')
    try {
      writeFileSync(helperFile('check'), '1')
    } catch {
      return
    }
    const sleep = () => new Promise(r => setTimeout(r, 300))
    const end = Date.now() + waitMs
    while (Date.now() < end && mtime('tags.txt') === tags) await sleep()
    // The notes are new, or gone (no GitHub Release, or GitHub didn't answer): either way, settled
    while (Date.now() < end && notes && mtime('release.json') === notes) await sleep()
  }

  // Whether to tell the owners now: newer than this server, not skipped, not told already unless «tomorrow» came
  function due(r: Release) {
    const s = read()
    if (!newer(r.version, current) || s.skipped === r.version) return false
    if (s.remindAt) return now() >= s.remindAt
    return s.notified !== r.version
  }

  return {
    current,
    latest,
    refresh,
    due,
    notified: (version: string) => write({ notified: version, remindAt: undefined }),
    remindLater: () => write({ remindAt: now() + DAY_MS }),
    skip: (version: string) => write({ skipped: version, remindAt: undefined }),

    helper,
    releaseUrl: (version: string) => `https://github.com/${repo}/releases/tag/v${version}`,
    // The helper starts the moment the file exists: it must never find it empty
    request(tag: string) {
      writeFileSync(helperFile('request.tmp'), JSON.stringify({ tag, at: now() }))
      renameSync(helperFile('request.tmp'), helperFile('request'))
    },
    result(): UpdateResult | null {
      if (!dir) return null
      try {
        return JSON.parse(readFileSync(helperFile('result'), 'utf8'))
      } catch {
        return null
      }
    },
    clearResult: () => dir && rmSync(helperFile('result'), { force: true }),
    // The message that said an update is on: the new version turns it into the outcome, so it survives the restart
    noteMessage: (updateMessage: { chatId: number, messageId: number }) => write({ updateMessage }),
    takeMessage() {
      const { updateMessage } = read()
      if (updateMessage) write({ updateMessage: undefined })
      return updateMessage ?? null
    },
    // The helper waits for this before it calls the new version good
    alive() {
      try {
        if (dir && existsSync(dir)) writeFileSync(helperFile('alive'), current)
      } catch {}
    },

    // Each computer is asked once per release: a failure is told once, not on every reconnect
    agentTried: (id: string, version: string) => read().agents?.[id] === version,
    markAgent: (id: string, version: string) => write({ agents: { ...(read().agents ?? {}), [id]: version } }),
  }
}

export type Updates = ReturnType<typeof createUpdates>
