import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentBlock, loadWidgetGuide, widgetProblem, GUIDE_URL } from '../src/claude/widget-tools.ts'

const DOC = [
  '# Writing widgets', '', '## Agent block', '', '<!-- agent-block -->', '```text',
  'You write Telegram widgets. Docs: {docs}/guide,', '{docs}/sdk (the API), {docs}/profile (every feature).', '',
  'SIZE', '- At most 32768 bytes.', 'More: {docs}/guide#size', '<!-- profile:agent -->', '- HTML: ruby', '<!-- /profile:agent -->',
  '```', '<!-- /agent-block -->', '',
].join('\n')

test('the limits are checked as Telegram counts them, compressed size included', () => {
  assert.equal(widgetProblem('<b>hi</b>'), null)
  assert.match(widgetProblem('a\u0000b')!, /NUL/)
  assert.match(widgetProblem('x'.repeat(40_000))!, /40000 bytes; at most 32768/)
  const noise = Array.from({ length: 6000 }, (_, i) => ((i * 7919) % 65536).toString(36)).join('')
  assert.match(widgetProblem(noise)!, /compressed; at most 4096/)
})

test("Telegram's agent block comes out whole, without links to docs that aren't there", () => {
  assert.equal(agentBlock(DOC), 'You write Telegram widgets.\n\nSIZE\n- At most 32768 bytes.\n- HTML: ruby')
  assert.equal(agentBlock('# nothing here'), null)
})

test('the guide is fetched from the pinned release once and kept; a failure leaves nothing behind', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-widget-'))
  try {
    const file = join(dir, 'widget-guide.txt')
    const asked: string[] = []
    const down = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    assert.equal(await loadWidgetGuide(file, down), null)
    const ok = (async (url: string) => { asked.push(url); return new Response(DOC) }) as unknown as typeof fetch
    assert.match((await loadWidgetGuide(file, ok))!, /^You write Telegram widgets/)
    assert.match(readFileSync(file, 'utf8'), /SIZE/)
    assert.match((await loadWidgetGuide(file, ok))!, /SIZE/)
    assert.deepEqual(asked, [GUIDE_URL], 'once')
    assert.match(GUIDE_URL, /\/v\d+\.\d+\.\d+\//, 'a release, not a branch')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
