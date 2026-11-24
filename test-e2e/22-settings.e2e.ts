import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { startStack, pairCodeIn, until, sleep, type Stack } from './support/stack.ts'

// Settings offered from one computer to another: only on a tap, and the keys of a server stay where they are.
// Adding a server on the other computer would start it, so here only its card is looked at

describe('settings to another computer', () => {
  let s: Stack
  let a = { id: '', home: '' }
  let b = { id: '', home: '' }
  const pair = async (name: string) => {
    const t = Date.now()
    s.send('/pair')
    const m = await s.reply(/install\//, { after: t })
    const got = await s.pairAgent(name, pairCodeIn(m)!, ['alpha'])
    return { id: got.id, home: join(dirname(got.config), 'home') }
  }

  before(async () => {
    s = await startStack({ language: 'en' })
    await s.startServer()
    a = await pair('E2E-PC')
    b = await pair('E2E-Mac')
    await sleep(300)
    mkdirSync(join(a.home, '.tg-claude-vps'), { recursive: true })
    writeFileSync(join(a.home, '.tg-claude-vps', 'CLAUDE.md'), '# Mine\n- short answers\n')
    writeFileSync(join(dirname(join(a.home, '..', 'agent.config.json')), 'agent.mcp.json'), JSON.stringify({ mcpServers: { figma: { command: 'npx', args: ['-y', 'figma@1.0.0'], env: { FIGMA_TOKEN: 'value-stays-here' } } }, imported: ['figma'] }))
  })
  after(() => s?.stop())

  test('the card shows what the other lacks; the instructions move on a tap, and nothing else does', async () => {
    const t = Date.now()
    s.send(`/devices`)
    const list = await s.reply(/Computers/, { after: t })
    await s.tap(list, `dv:${a.id}`)
    const card = () => s.tg.sent.find(m => m.message_id === list.message_id)!
    await until('the card', () => card().buttons.flat().some(x => x.data === `stm:${a.id}:${b.id}`))
    await s.tap(card(), `stm:${a.id}:${b.id}`)
    await until('what can move', () => /Replace the instructions/.test(card().buttons.flat().map(x => x.text).join(' ')))
    assert.match(card().text, /figma/)
    assert.match(card().text, /keys stay here: FIGMA_TOKEN/)
    assert.doesNotMatch(card().text, /value-stays-here/)
    assert.throws(() => readFileSync(join(b.home, '.tg-claude-vps', 'CLAUDE.md'), 'utf8'), 'nothing moved before the tap')

    await s.tap(card(), `stmr:${a.id}:${b.id}`)
    await until('moved', () => {
      try {
        return readFileSync(join(b.home, '.tg-claude-vps', 'CLAUDE.md'), 'utf8') === '# Mine\n- short answers\n'
      } catch {
        return false
      }
    })
    await until('the card says the instructions are the same now', () => !/Replace the instructions/.test(card().buttons.flat().map(x => x.text).join(' ')))
  })
})
