import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// Who the bot answers: OWNER_IDS from .env, whoever claimed it with the one-time code the installer printed
// (t.me/<bot>?start=<code>), and the accounts added with /users. Once the bot has an owner the code is spent for
// good, and after a run of wrong codes claiming stops until restart. The main account is the first of them: the only
// one that manages the list and hears about the server itself, and it can't be removed
const MAX_FAILURES = 20

export function createOwners(file: string, fromEnv: number[]) {
  let saved: { ids: number[], claimed: boolean } = { ids: [], claimed: false }
  try {
    saved = JSON.parse(readFileSync(file, 'utf8'))
  } catch {}
  let failures = 0
  const save = () => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file + '.tmp', JSON.stringify(saved, null, 2))
    renameSync(file + '.tmp', file)
  }
  const any = () => fromEnv.length > 0 || saved.ids.length > 0
  const main = () => fromEnv[0] ?? saved.ids[0]
  const has = (id: number) => fromEnv.includes(id) || saved.ids.includes(id)
  return {
    has,
    isMain: (id: number) => id === main(),
    isFromEnv: (id: number) => fromEnv.includes(id),
    // Who hears about the server itself: updates, the sandbox
    mainOnly: () => (any() ? [main()] : []),
    // Listed, so it has access from its first message
    add(id: number) {
      if (has(id)) return false
      saved = { ...saved, ids: [...saved.ids, id] }
      save()
      return true
    },
    removable: (id: number) => saved.ids.includes(id) && id !== main(),
    remove(id: number) {
      if (!saved.ids.includes(id) || id === main()) return false
      saved = { ...saved, ids: saved.ids.filter(x => x !== id) }
      save()
      return true
    },
    ids: () => [...new Set([...fromEnv, ...saved.ids])],
    any,
    // True when this message made `id` the owner
    claim(id: number, code: string, expected: string | undefined) {
      if (!expected || saved.claimed || any() || failures >= MAX_FAILURES) return false
      if (code !== expected) {
        failures++
        return false
      }
      saved = { ids: [id], claimed: true }
      save()
      return true
    },
  }
}

export type Owners = ReturnType<typeof createOwners>
