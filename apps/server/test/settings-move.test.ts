import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setLang } from '../src/i18n.ts'
import { moveCard, settingsDiff } from '../src/telegram/settings-move.ts'

setLang('ru')

const figma = { name: 'figma', command: 'npx', args: ['-y', 'f@1.0.0'], env: ['FIGMA_TOKEN'] }
const blender = { name: 'blender', command: 'uvx', args: ['blender-mcp==1.0.0'], env: [] }

test('what the other one lacks; the same instructions with other line ends are the same', () => {
  const d = settingsDiff({ mcp: [figma, blender], rules: 'a\r\nb\n' }, { mcp: [blender], rules: 'a\nb' })
  assert.deepEqual(d.mcp.map(s => s.name), ['figma'])
  assert.equal(d.rules, false)
  assert.equal(settingsDiff({ mcp: [], rules: '' }, { mcp: [], rules: 'x' }).rules, false, 'empty instructions are nothing to offer')
})

test('the card names the keys that stay, and has a button for each thing', () => {
  const { md, rows } = moveCard('pc', 'mac', { from: 'PC', to: 'Mac' }, { mcp: [figma], rules: 'mine' }, { mcp: [], rules: null })
  assert.match(md, /ключи останутся здесь: FIGMA_TOKEN/)
  assert.match(md, /заменит их на Mac/)
  assert.deepEqual(rows.flat().map(b => b.data), ['stma:pc:mac:figma', 'stmr:pc:mac', 'dv:pc'])
})

test('nothing to move says so', () => {
  const { md, rows } = moveCard('pc', 'mac', { from: 'PC', to: 'Mac' }, { mcp: [blender], rules: 'x' }, { mcp: [blender], rules: 'x' })
  assert.match(md, /Переносить нечего/)
  assert.equal(rows.length, 1)
})
