import { execFile } from 'node:child_process'

// A Mac under a closed lid doesn't sleep through: it wakes with no screen (a dark wake) for seconds to a minute, over and
// over, and the agent ran in each of them. It answered the server's pings, which woke the Mac again, held the Mac up
// with its own request to stay awake, and showed online and offline by turns: 266 lost links in one day, on battery.
// Asleep is asleep: in a dark wake the agent leaves the link and asks for nothing, until the Mac wakes for real.
//
// `pmset -g systemstate` tells the two apart. Awake, it lists Graphics among the system's capabilities; in a dark wake it
// doesn't; a display that is merely asleep, as in a night's work, keeps it (measured on a MacBook, 2026-11-25)
export const darkWake = (systemstate: string) => {
  const m = /Current System Capabilities are:([^\n]*)/.exec(systemstate)
  return !!m && !/\bGraphics\b/.test(m[1])
}

const pmset = () => new Promise<string>((resolve, reject) => {
  execFile('pmset', ['-g', 'systemstate'], { timeout: 5000 }, (e, out) => (e ? reject(e) : resolve(out)))
})

// Looked at every few seconds, oftener while resting so that an opened lid is noticed at once: the process only runs in
// the wakes anyway. Two looks in a row have to agree, a state in the middle of changing is neither. A look that fails
// changes nothing: a Mac whose pmset doesn't answer stays as it was
export function watchNaps(onChange: (resting: boolean) => void, { platform = process.platform, every = 10_000, restingEvery = 3000, read = pmset } = {}) {
  if (platform !== 'darwin') return () => {}
  let resting = false
  let seen: boolean | undefined
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  const look = async () => {
    let dark: boolean | undefined
    try {
      dark = darkWake(await read())
    } catch {}
    if (stopped) return
    const twice = dark !== undefined && dark === seen
    seen = dark
    if (twice && dark !== resting) {
      resting = dark!
      onChange(resting)
    }
    // A first look that differs is checked again soon, not a whole interval later
    timer = setTimeout(look, resting || (dark !== undefined && dark !== resting) ? restingEvery : every)
    timer.unref()
  }
  look()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
