import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stageUploads, UPLOADS_DIR } from '../src/claude/browser-upload.ts'
import { serverReadGuard, SERVER_READ } from '../src/claude/runner.ts'

function stand() {
  const workDir = mkdtempSync(join(tmpdir(), 'tgcv-upload-'))
  const pulled: string[] = []
  const pull = async (p: string) => {
    pulled.push(p)
    return p.includes('missing') ? { ok: false as const, error: 'No such file' } : { ok: true as const, name: 'icon-release-beta.png', data: Buffer.from('png') }
  }
  return { workDir, pulled, pull, done: () => rmSync(workDir, { recursive: true, force: true }) }
}

test('a file on the computer comes over into the session\'s folder, and the upload gets that path', async () => {
  const s = stand()
  try {
    const r = await stageUploads(['C:\\Users\\admin\\code\\mfm\\icon-release-beta.png'], { workDir: s.workDir, pull: s.pull })
    assert.equal(r.ok, true)
    const [path] = (r as { paths: string[] }).paths
    assert.ok(path.startsWith(join(s.workDir, UPLOADS_DIR)))
    assert.ok(path.endsWith('icon-release-beta.png'))
    assert.equal(readFileSync(path, 'utf8'), 'png')
    assert.deepEqual(s.pulled, ['C:\\Users\\admin\\code\\mfm\\icon-release-beta.png'])
  } finally {
    s.done()
  }
})

test('a file the session can read already is left as it is; one that can\'t be had says why', async () => {
  const s = stand()
  try {
    const here = join(s.workDir, 'shot.png')
    writeFileSync(here, 'x')
    const kept = await stageUploads([here], { workDir: s.workDir, pull: s.pull })
    assert.deepEqual(kept, { ok: true, paths: [here] })
    assert.deepEqual(s.pulled, [])
    const failed = await stageUploads(['C:\\missing.png'], { workDir: s.workDir, pull: s.pull })
    assert.equal(failed.ok, false)
    assert.match((failed as { error: string }).error, /No such file/)
  } finally {
    s.done()
  }
})

test('what earlier uploads left goes after a day', async () => {
  const s = stand()
  try {
    const old = join(s.workDir, UPLOADS_DIR, 'old')
    mkdirSync(old, { recursive: true })
    const day = new Date(Date.now() - 2 * 86400_000)
    utimesSync(old, day, day)
    await stageUploads(['C:\\a.png'], { workDir: s.workDir, pull: s.pull })
    assert.equal(existsSync(old), false)
  } finally {
    s.done()
  }
})

test('Read, there only for the upload\'s own check, never reads the server', async () => {
  const run = (tool_name: string) => serverReadGuard.hooks[0]({ hook_event_name: 'PreToolUse', tool_name, tool_input: { file_path: '/app/.env' } } as never, undefined, { signal: new AbortController().signal })
  const out = await run(SERVER_READ) as { hookSpecificOutput: { permissionDecision: string, permissionDecisionReason: string } }
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /mcp__device__read_file/)
  assert.deepEqual(await run('mcp__claude-in-chrome__file_upload'), {})
})
