import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBrowserStore } from '../src/browsers.ts'

test('a chosen browser keeps the Claude profile it was chosen on, across a restart; one browser, one computer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-browsers-'))
  try {
    const file = join(dir, 'browsers.json')
    const s = createBrowserStore(file)
    s.bind('mac', { deviceId: 'b1', name: 'Chrome', osPlatform: 'macOS', profile: 'work' })
    assert.equal(createBrowserStore(file).get('mac')?.profile, 'work')
    s.bind('pc', { deviceId: 'b1', name: 'Chrome', osPlatform: 'macOS' })
    assert.equal(s.get('mac'), undefined)
    assert.equal(s.get('pc')?.profile, undefined, 'none known: none made up')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
