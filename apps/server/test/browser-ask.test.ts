import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ASK_FOR_BROWSER, BROWSER_ASK_SERVER, BROWSER_OPEN_SERVER, OPEN_CHROME, createBrowserAskServer, createBrowserOpenServer } from '../src/claude/browser-tools.ts'
import { BROWSER_ASK, browserBlock } from '../src/claude/prompt.ts'

test('Claude asks for the browser with a tool of the bot, never by telling the user a command', () => {
  assert.equal(ASK_FOR_BROWSER, `mcp__${BROWSER_ASK_SERVER}__ask_for_browser`)
  assert.match(BROWSER_ASK, /call ask_for_browser/)
  assert.match(BROWSER_ASK, /Never tell the user to send a command/)
  assert.match(BROWSER_ASK, /WebFetch is enough/)
  assert.equal(createBrowserAskServer(async () => '').name, BROWSER_ASK_SERVER)
})

test('Claude starts a closed Chrome itself before asking the user to', () => {
  assert.equal(OPEN_CHROME, `mcp__${BROWSER_OPEN_SERVER}__open_chrome`)
  assert.equal(createBrowserOpenServer(async () => '').name, BROWSER_OPEN_SERVER)
  assert.match(browserBlock('PC', 'id'), /open_chrome/)
})

test('Claude is told a frozen screenshot is a hidden window, and to check an upload by the page before giving up', () => {
  const b = browserBlock('PC', 'id')
  assert.match(b, /renderer may be frozen" means the Chrome window on the computer is most likely minimized/)
  assert.match(b, /bring Chrome to the front/)
  assert.match(b, /file_upload, a path on the computer included/)
  assert.match(b, /upload by hand only when file_upload itself failed/)
})
