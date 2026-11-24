import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromeHooks, classifyChrome, createBrowserLock, parseBrowsers, sameOs, surelyThroughServer, CHROME_PREFIX } from '../src/claude/chrome.ts'

const bound = { deviceId: 'pc-chrome', name: 'Browser 2', osPlatform: 'Windows' }
const c = (tool: string, input: Record<string, unknown> = {}, selected = false) => classifyChrome(CHROME_PREFIX + tool, input, { bound, device: 'PC', selected })
const denied = (x: unknown) => typeof x === 'object' && x !== null && 'deny' in x

test('a refusal goes by the deviceId and the computer: the extension\'s names change', () => {
  const said = c('navigate') as { deny: string }
  assert.match(said.deny, /deviceId pc-chrome/)
  assert.match(said.deny, /on the computer PC/)
  assert.doesNotMatch(said.deny, /Browser 2/)
})

test('after the list of browsers Claude hears what to do next, and the bot sees the names as they are now', async () => {
  const seen: unknown[] = []
  const hooks = chromeHooks(async () => true, () => {}, list => {
    seen.push(list)
    return 'pick it'
  })
  const post = hooks.PostToolUse![0].hooks[0]
  const run = (tool_name: string, text: string) => post({ hook_event_name: 'PostToolUse', tool_name, tool_response: { content: [{ type: 'text', text }] } } as never, undefined, { signal: new AbortController().signal })
  const list = [{ deviceId: 'pc-chrome', name: 'DESKTOP', osPlatform: 'Windows' }]
  const out = await run(`${CHROME_PREFIX}list_connected_browsers`, JSON.stringify(list))
  assert.deepEqual(seen, [list])
  assert.deepEqual(out, { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'pick it' } })
  assert.deepEqual(await run(`${CHROME_PREFIX}get_page_text`, 'text'), {}, 'nothing for another tool')
  assert.equal(seen.length, 1)
})

test('a call the gate gives an input of its own runs with that input', async () => {
  const hooks = chromeHooks(async (_t, input) => ({ input: { ...input, paths: ['/srv/a.png'] } }), () => {})
  const pre = hooks.PreToolUse![0].hooks[0]
  const out = await pre({ hook_event_name: 'PreToolUse', tool_name: `${CHROME_PREFIX}file_upload`, tool_input: { ref: 'r1', paths: ['C:\\a.png'] } } as never, undefined, { signal: new AbortController().signal })
  assert.deepEqual(out, { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ref: 'r1', paths: ['/srv/a.png'] } } })
})

test('only the topic\'s own browser can be picked; nothing acts before it is', () => {
  assert.equal(c('list_connected_browsers'), 'free')
  assert.equal(c('select_browser', { deviceId: 'pc-chrome' }), 'select')
  // The Mac's browser, or a broadcast to every browser on the account
  assert.ok(denied(c('select_browser', { deviceId: 'mac-chrome' })))
  assert.ok(denied(c('switch_browser')))
  // Without a pick in this turn the CLI may still point at another computer's browser
  assert.ok(denied(c('navigate', { url: 'https://example.com' })))
  assert.ok(denied(c('read_page')))
})

test('after the pick, looking goes through and acting asks', () => {
  assert.equal(c('read_page', {}, true), 'read')
  assert.equal(c('get_page_text', {}, true), 'read')
  assert.equal(c('computer', { action: 'screenshot' }, true), 'read')
  assert.equal(c('computer', { action: 'left_click' }, true), 'act')
  assert.equal(c('navigate', { url: 'https://example.com' }, true), 'act')
  assert.equal(c('form_input', { ref: 'r1', value: 'x' }, true), 'act')
  assert.equal(c('javascript_tool', { text: '1' }, true), 'act')
  // Picking another browser stays refused mid-turn too
  assert.ok(denied(c('select_browser', { deviceId: 'mac-chrome' }, true)))
})

test('topics on one browser share it; another browser waits until it is free', async () => {
  const lock = createBrowserLock()
  const never = new AbortController().signal
  await lock.acquire('pc', 'topic-a', never)
  await lock.acquire('pc', 'topic-b', never)
  assert.equal(lock.busyFor('pc'), false)
  assert.equal(lock.busyFor('mac'), true)
  let macGot = false
  const mac = lock.acquire('mac', 'topic-c', never).then(() => { macGot = true })
  lock.release('topic-a')
  await new Promise(r => setTimeout(r, 10))
  assert.equal(macGot, false, 'topic-b still uses the PC browser')
  lock.release('topic-b')
  await mac
  assert.equal(macGot, true)
  assert.equal(lock.busyFor('pc'), true)
})

test('a waiting topic stops waiting on Stop', async () => {
  const lock = createBrowserLock()
  await lock.acquire('pc', 'a', new AbortController().signal)
  const stop = new AbortController()
  const waiting = lock.acquire('mac', 'b', stop.signal)
  stop.abort()
  await assert.rejects(waiting)
})

test('browser list from the tool result; OS names match loosely', () => {
  const text = JSON.stringify([{ deviceId: '68b1', name: 'Browser 1', osPlatform: 'macOS', isLocal: false }])
  assert.deepEqual(parseBrowsers([{ type: 'text', text }]).map(b => b.deviceId), ['68b1'])
  assert.deepEqual(parseBrowsers({ content: [{ type: 'text', text }] }).map(b => b.name), ['Browser 1'])
  assert.deepEqual(parseBrowsers('No browsers are connected'), [])
  assert.equal(sameOs('macOS', 'macos'), true)
  assert.equal(sameOs('macOS', 'windows'), false)
  assert.equal(sameOs('Windows', 'windows'), true)
  assert.equal(sameOs(undefined, 'windows'), true)
})

test('browser screenshots are read from the server only inside the Chrome screenshot folder', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { chromeScreenshot } = await import('../src/claude/chrome.ts')
  const tmp = mkdtempSync(join(tmpdir(), 'tgcv-tmp-'))
  mkdirSync(join(tmp, 'claude-chrome-screenshots-zvT8U4'))
  const shot = join(tmp, 'claude-chrome-screenshots-zvT8U4', 'screenshot-1793288645056-0.jpg')
  writeFileSync(shot, 'jpg')
  writeFileSync(join(tmp, 'secret.jpg'), 'x')
  assert.equal(chromeScreenshot(shot, tmp), shot)
  assert.equal(chromeScreenshot(join(tmp, 'secret.jpg'), tmp), null)
  assert.equal(chromeScreenshot(join(tmp, 'claude-chrome-screenshots-zvT8U4', '..', 'secret.jpg'), tmp), null)
  assert.equal(chromeScreenshot(join(tmp, 'claude-chrome-screenshots-zvT8U4', 'missing.jpg'), tmp), null)
  assert.equal(chromeScreenshot('C:/Windows/win.ini', tmp), null)
})

test('opening and closing its own tabs needs no question; going somewhere does', () => {
  assert.equal(c('tabs_create_mcp', {}, true), 'read')
  assert.equal(c('tabs_close_mcp', { tabId: 1 }, true), 'read')
  assert.equal(c('navigate', { url: 'https://example.com' }, true), 'act')
})

test('no question about the way online only when Chrome surely goes through the server', () => {
  const ok = { supported: true, on: true, pending: false }
  assert.equal(surelyThroughServer(ok), true)
  assert.equal(surelyThroughServer({ ...ok, on: false }), false, 'direct: sites would see the owner\'s address')
  assert.equal(surelyThroughServer({ ...ok, pending: true }), false, 'not restarted since the switch')
  assert.equal(surelyThroughServer({ ...ok, supported: false }), false)
  assert.equal(surelyThroughServer(null), false, 'unknown')
})
