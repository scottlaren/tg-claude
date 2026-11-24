import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { gitRootOf, loadConfig } from '../src/config.ts'

test("a folder inside a git checkout is caught, the repo's own folder included", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'tgcv-git-')))
  mkdirSync(join(base, 'repo', '.git'), { recursive: true })
  mkdirSync(join(base, 'repo', 'data', 'claude-cwd'), { recursive: true })
  mkdirSync(join(base, 'elsewhere'))
  assert.equal(gitRootOf(join(base, 'repo', 'data', 'claude-cwd')), join(base, 'repo'))
  assert.equal(gitRootOf(join(base, 'elsewhere')), null)
})

test("Claude's server cwd defaults to the home folder, outside the code checkout", () => {
  const cfg = loadConfig({ TG_TOKEN: 'x' })
  assert.equal(cfg.claudeCwd, join(homedir(), '.tg-claude-vps', 'claude-cwd'))
  assert.equal(gitRootOf(cfg.claudeCwd), null)
})

test('Telegram is api.telegram.org unless a test points elsewhere, and a test seam is off by default', () => {
  assert.equal(loadConfig({ TG_TOKEN: 'x' }).apiRoot, undefined)
  assert.equal(loadConfig({ TG_TOKEN: 'x', TG_API_ROOT: '' }).apiRoot, undefined)
  assert.equal(loadConfig({ TG_TOKEN: 'x', TG_API_ROOT: 'http://127.0.0.1:1' }).apiRoot, 'http://127.0.0.1:1')
})
