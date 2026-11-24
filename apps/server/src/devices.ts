import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Hello } from '@tgcv/protocol'

// Every device that may connect (§8.2): its own key, stored only as a hash, revocable one by one.
// Keys from DEVICE_KEYS in .env still work (the first device was set up that way) but can't be revoked from Telegram
export type DeviceRecord = {
  id: string
  name: string
  os?: Hello['os']
  keyHash?: string
  createdAt?: number
  lastSeen?: number
  legacy?: boolean
}

const sha = (s: string) => createHash('sha256').update(s).digest()
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'device'

export function createDeviceRegistry(file: string, legacyKeys = new Map<string, string>()) {
  // retired: ids of unlinked computers. Topics and the browser binding may still name one, so it never goes to
  // a new computer: those topics wait for a new choice instead of running on a stranger
  // names: what the user called a computer. Its agent says its own name at every connection, and this one wins.
  // profiles: the Claude profile a computer's topics run on, when the user gave it one
  let data: { devices: Record<string, DeviceRecord>, retired?: string[], names?: Record<string, string>, profiles?: Record<string, string> }
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    data = { devices: {} }
  }
  const save = () => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file + '.tmp', JSON.stringify(data, null, 2))
    renameSync(file + '.tmp', file)
  }

  return {
    verify(id: string, key: string) {
      const legacy = legacyKeys.get(id)
      if (legacy !== undefined) return timingSafeEqual(sha(legacy), sha(key))
      const rec = data.devices[id]
      return !!rec?.keyHash && timingSafeEqual(Buffer.from(rec.keyHash, 'hex'), sha(key))
    },

    // A new device: a readable unique id from its name, a random key shown to it once
    register(name: string, os: Hello['os']) {
      const base = slug(name)
      let id = base
      const taken = (x: string) => !!data.devices[x] || legacyKeys.has(x) || !!data.retired?.includes(x)
      for (let n = 2; taken(id); n++) id = `${base}-${n}`
      const key = randomBytes(32).toString('base64url')
      data.devices[id] = { id, name, os, keyHash: sha(key).toString('hex'), createdAt: Date.now() }
      save()
      return { id, key }
    },

    revoke(id: string) {
      if (!data.devices[id]) return false
      delete data.devices[id]
      if (data.names) delete data.names[id]
      if (data.profiles) delete data.profiles[id]
      data.retired = [...new Set([...(data.retired ?? []), id])]
      save()
      return true
    },

    touch(id: string, patch: Partial<Pick<DeviceRecord, 'name' | 'os' | 'lastSeen'>>) {
      const rec = data.devices[id]
      if (!rec) return
      Object.assign(rec, patch)
      save()
    },

    rename(id: string, name: string) {
      if (!data.devices[id] && !legacyKeys.has(id)) return false
      data.names = { ...data.names, [id]: name }
      save()
      return true
    },
    nameOf: (id: string): string | undefined => data.names?.[id],

    // undefined: none of its own, the topics' own or the default one
    setProfile(id: string, profile: string | undefined) {
      if (!data.devices[id] && !legacyKeys.has(id)) return false
      const { [id]: _, ...rest } = data.profiles ?? {}
      data.profiles = profile ? { ...rest, [id]: profile } : rest
      save()
      return true
    },
    profileOf: (id: string): string | undefined => data.profiles?.[id],

    list(): DeviceRecord[] {
      const legacy = [...legacyKeys.keys()].filter(id => !data.devices[id]).map(id => ({ id, name: id, legacy: true }))
      return [...Object.values(data.devices), ...legacy].map(r => ({ ...r, name: data.names?.[r.id] ?? r.name }))
    },
  }
}

export type DeviceRegistry = ReturnType<typeof createDeviceRegistry>

// No 0/O, 1/I/L: the code is read off a phone and typed on a laptop
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_TTL_MS = 10 * 60_000
const MAX_FAILURES = 10

export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')

// One-time codes from /pair; a burst of wrong guesses closes pairing for a while
export function createPairing({ now = Date.now }: { now?: () => number } = {}) {
  const codes = new Map<string, { expiresAt: number, chatId: number, topicId?: number }>()
  let failures: number[] = []

  return {
    create(chatId: number, topicId?: number) {
      const raw = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
      codes.set(raw, { expiresAt: now() + CODE_TTL_MS, chatId, topicId })
      return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, ttlMin: CODE_TTL_MS / 60_000 }
    },

    // Checked without being spent: the install link downloads with it, the pairing at the end spends it.
    // A wrong one counts toward the lock like a wrong pairing
    valid(code: string): boolean | 'locked' {
      // A real code first: anyone online can run up the failures, and that must not lock its owner out
      const entry = codes.get(normalizeCode(code))
      if (entry && entry.expiresAt >= now()) return true
      failures = failures.filter(t => now() - t < CODE_TTL_MS)
      if (failures.length >= MAX_FAILURES) return 'locked'
      failures.push(now())
      return false
    },

    // Single use: a code that worked once never works again
    consume(code: string): { chatId: number, topicId?: number } | 'locked' | null {
      failures = failures.filter(t => now() - t < CODE_TTL_MS)
      const key = normalizeCode(code)
      const entry = codes.get(key)
      if ((!entry || entry.expiresAt < now()) && failures.length >= MAX_FAILURES) return 'locked'
      if (!entry || entry.expiresAt < now()) {
        codes.delete(key)
        failures.push(now())
        return null
      }
      codes.delete(key)
      return { chatId: entry.chatId, topicId: entry.topicId }
    },
  }
}

export type Pairing = ReturnType<typeof createPairing>
