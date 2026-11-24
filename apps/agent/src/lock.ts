import { existsSync, writeFileSync } from 'node:fs'

// /lock: a file on the computer. The bot can ask for it, and nothing that comes from the server can take it back: every
// operation is refused while it is there, updates and file tools too. So neither a stolen Telegram account nor a server
// taken over can undo it, and only someone at the computer can: the file goes, the agent works again
export type Lock = { file: string, locked: () => boolean, lock: () => void }

export const createLock = (file: string): Lock => ({
  file,
  // Looked at for each operation, not kept: deleting the file is all it takes, with no agent command to know of
  locked: () => existsSync(file),
  lock: () => writeFileSync(file, `Locked from the bot at ${new Date().toISOString()}. Delete this file to unlock this computer.\n`),
})
