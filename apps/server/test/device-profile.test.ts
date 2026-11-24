import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDeviceRegistry } from '../src/devices.ts'

test('a computer keeps its Claude profile across a restart, loses it when unlinked, and an unknown one gets none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-devprof-'))
  try {
    const file = join(dir, 'devices.json')
    const r = createDeviceRegistry(file)
    const { id } = r.register('Home Mac', 'macos')
    assert.equal(r.profileOf(id), undefined)
    assert.equal(r.setProfile(id, 'work'), true)
    assert.equal(createDeviceRegistry(file).profileOf(id), 'work')
    r.setProfile(id, undefined)
    assert.equal(r.profileOf(id), undefined)
    r.setProfile(id, 'work')
    r.revoke(id)
    assert.equal(r.profileOf(id), undefined)
    assert.equal(r.setProfile('nobody', 'work'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
