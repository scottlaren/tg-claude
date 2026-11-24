import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { InputFile } from 'grammy'
import { AVATAR_FILE, setBotAvatar } from '../src/telegram/avatar.ts'

const log = () => ({ infos: [] as string[], warns: [] as string[], info(m: string) { this.infos.push(m) }, warn(m: string) { this.warns.push(m) } })
const api = (photos: number, sent: unknown[] = [], over: object = {}) => ({
  getMe: async () => ({ id: 7 }),
  getUserProfilePhotos: async () => ({ total_count: photos, photos: [] }),
  setMyProfilePhoto: async (p: unknown) => { sent.push(p); return true },
  ...over,
}) as never

test('the picture is in the repository, as a JPEG', () => {
  const data = readFileSync(AVATAR_FILE)
  assert.equal(data[0], 0xff)
  assert.equal(data[1], 0xd8)
})

test('a bot without a picture gets it, as a new static photo', async () => {
  const sent: unknown[] = []
  const l = log()
  await setBotAvatar(api(0, sent), l as never)
  const [photo] = sent as { type: string, photo: unknown }[]
  assert.equal(photo.type, 'static')
  assert.ok(photo.photo instanceof InputFile)
  assert.deepEqual(l.infos, ['bot avatar set'])
})

test('a picture the owner has set stays', async () => {
  const sent: unknown[] = []
  const l = log()
  await setBotAvatar(api(1, sent), l as never)
  assert.deepEqual(sent, [])
  assert.match(l.infos[0], /kept/)
})

test('a refusal never stops the setup, and no answer about the picture means no change', async () => {
  const l = log()
  await setBotAvatar(api(0, [], { setMyProfilePhoto: async () => { throw new Error('flood') } }), l as never)
  assert.equal(l.warns.length, 1)
  const sent: unknown[] = []
  await setBotAvatar(api(0, sent, { getUserProfilePhotos: async () => { throw new Error('down') } }), log() as never)
  assert.deepEqual(sent, [])
})
