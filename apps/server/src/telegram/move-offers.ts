import { readJson, writeJson } from '../store.ts'

// Offers to move cloud projects to a computer that came online: once a day per computer, whatever the topic. Kept on
// disk: a laptop waking up every hour must not nag, and neither must a server restarted for an update
export const MOVE_OFFER_MS = 24 * 3600_000

export function createMoveOffers(file: string, every = MOVE_OFFER_MS) {
  const at = readJson<Record<string, number>>(file, {})
  return {
    due: (deviceId: string, now = Date.now()) => now - (at[deviceId] ?? 0) >= every,
    made(deviceId: string, now = Date.now()) {
      at[deviceId] = now
      writeJson(file, at)
    },
  }
}
