// Windows won't delete a folder another program holds: Roblox Studio with a place from it, an editor, a terminal open
// in it. git has let go of the worktree by then, and what is left is an empty folder: it is tried again, for a day,
// whenever the computer is on. Only an empty folder is ever removed this way (rmdir without /s or -r)

export const isBusyFolder = (error: string) => /permission denied|resource busy|being used by another process/i.test(error)

export function rmdirCommand(os: string | undefined, folder: string) {
  return os === 'windows'
    ? { program: 'cmd', args: ['/c', 'rmdir', folder.replace(/\//g, '\\')] }
    : { program: 'rmdir', args: [folder] }
}

const GONE = /cannot find|no such file|not found/i

export function createFolderRetry({ remove, online, done, everyMs = 10 * 60_000, forMs = 24 * 3600_000, now = Date.now }: {
  // null: removed; otherwise why not
  remove: (deviceId: string, repo: string, folder: string) => Promise<string | null>
  online: (deviceId: string) => boolean
  done: (deviceId: string, repo: string, folder: string, removed: boolean) => void
  everyMs?: number
  forMs?: number
  now?: () => number
}) {
  const waiting = new Map<string, NodeJS.Timeout>()

  function later(deviceId: string, repo: string, folder: string, until = now() + forMs) {
    const id = `${deviceId}\n${folder}`
    clearTimeout(waiting.get(id))
    const timer = setTimeout(async () => {
      waiting.delete(id)
      if (!online(deviceId)) {
        if (now() < until) later(deviceId, repo, folder, until)
        else done(deviceId, repo, folder, false)
        return
      }
      const failed = await remove(deviceId, repo, folder).catch(e => (e as Error).message)
      if (!failed || GONE.test(failed)) return done(deviceId, repo, folder, true)
      if (now() < until) later(deviceId, repo, folder, until)
      else done(deviceId, repo, folder, false)
    }, everyMs)
    timer.unref?.()
    waiting.set(id, timer)
  }

  return { later, waiting: () => waiting.size, stop: () => { for (const t of waiting.values()) clearTimeout(t); waiting.clear() } }
}
