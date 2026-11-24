import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import type { Browser } from './claude/chrome.ts'

// Which Chrome (Claude in Chrome extension) belongs to which computer: chosen once by the user with a
// button, then a topic on that computer uses only that browser (§10.6)
export function createBrowserStore(file: string) {
  let byDevice: Record<string, Browser> = {}
  try {
    byDevice = JSON.parse(readFileSync(file, 'utf8'))
  } catch {}
  const save = () => {
    writeFileSync(file + '.tmp', JSON.stringify(byDevice, null, 2))
    renameSync(file + '.tmp', file)
  }
  return {
    get: (deviceId: string): Browser | undefined => byDevice[deviceId],
    bind(deviceId: string, b: Browser) {
      // One browser, one computer: taking it from another computer unbinds it there
      for (const [d, x] of Object.entries(byDevice)) if (x.deviceId === b.deviceId) delete byDevice[d]
      byDevice[deviceId] = { deviceId: b.deviceId, name: b.name, osPlatform: b.osPlatform, ...(b.profile && { profile: b.profile }) }
      save()
    },
    unbind(deviceId: string) {
      delete byDevice[deviceId]
      save()
    },
  }
}

export type BrowserStore = ReturnType<typeof createBrowserStore>
