import { readJson, writeJson } from './store.ts'

// Night mode, per chat: the guard of a night shift kept to branches, on for as long as that shift runs, also across
// restarts. Only chats it is on for are kept
export function createNightStore(file: string) {
  const data = readJson<Record<string, true>>(file, {})
  return {
    on: (chatId: number) => !!data[chatId],
    chats: () => Object.keys(data).map(Number),
    set(chatId: number, on: boolean) {
      if (on) data[chatId] = true
      else delete data[chatId]
      writeJson(file, data)
    },
  }
}

export type NightStore = ReturnType<typeof createNightStore>
