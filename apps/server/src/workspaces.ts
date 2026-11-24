import { readJson, writeJson, type Mode, type Topic } from './store.ts'

// A workspace is a group the bot was let into by one of its accounts: a place for one area of work, with settings its new
// topics start from. The bot leaves a group nobody on its list brought it into.
// plain: no topics in it, so the whole group is one conversation, which these settings apply to directly
export type Workspace = { title: string, addedBy: number, deviceId?: string, projectId?: string, mode?: Mode, model?: string, plain?: boolean }

export function createWorkspaceStore(file: string) {
  const data = readJson<Record<string, Workspace>>(file, {})
  const save = () => writeJson(file, data)
  return {
    get: (chatId: number): Workspace | undefined => data[chatId],
    add(chatId: number, w: Workspace) {
      data[chatId] = w
      save()
    },
    update(chatId: number, patch: Partial<Workspace>) {
      if (!data[chatId]) return
      data[chatId] = { ...data[chatId], ...patch }
      save()
    },
    remove(chatId: number) {
      delete data[chatId]
      save()
    },
    list: () => Object.entries(data).map(([id, w]) => ({ chatId: Number(id), ...w })),
  }
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>

// What a new topic takes from its workspace. A topic that already has its own settings keeps them
export function inherited(w: Workspace, t: Pick<Topic, 'mode' | 'model'>): Partial<Topic> {
  return {
    ...(w.mode && !t.mode && { mode: w.mode }),
    ...(w.model && !t.model && { model: w.model }),
  }
}
