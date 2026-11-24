import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { InlineKeyboard } from 'grammy'
import type { FolderList, ZonesState } from '@tgcv/protocol'
import { tilde, zonesView, browseView, pickView, zonesSummary } from '../src/telegram/zones.ts'
import { setLang } from '../src/i18n.ts'

setLang('ru')

const buttons = (kb?: InlineKeyboard) => (kb?.inline_keyboard ?? []).flat().map(b => ({ text: b.text, data: (b as { callback_data: string }).callback_data }))

const state: ZonesState = {
  home: '/Users/scott',
  zones: [{ path: '/Users/scott/code', projects: 5 }],
  suggestions: [{ path: '/Users/scott/Documents/GitHub', projects: 3 }],
  roots: [{ name: 'home', path: '/Users/scott' }, { name: 'Backup', path: '/Volumes/Backup' }],
}

test('paths read from home as ~, on Windows too', () => {
  assert.equal(tilde('/Users/scott/code', '/Users/scott'), '~/code')
  assert.equal(tilde('/Users/scott', '/Users/scott'), '~')
  assert.equal(tilde('/Users/scottish/x', '/Users/scott'), '/Users/scottish/x')
  assert.equal(tilde('C:\\Users\\admin\\Desktop\\code', 'C:\\Users\\admin'), '~\\Desktop\\code')
})

test('the folders screen: the working folder, suggestions as buttons, another folder, done', () => {
  const v = zonesView('abcd1234', 'MacBook', state)
  assert.match(v.text, /<code>~\/code<\/code> — 5 проектов/)
  assert.match(v.text, /<code>~\/Documents\/GitHub<\/code> — 3 проекта/)
  const b = buttons(v.kb)
  assert.deepEqual(b.map(x => x.data), ['zf:abcd1234:sg:0', 'zf:abcd1234:br', 'zf:abcd1234:ok'])
  // One working folder can't be removed, only replaced
  assert.ok(!b.some(x => x.data.includes(':rm:')))
  const two = buttons(zonesView('abcd1234', 'MacBook', { ...state, zones: [...state.zones, { path: '/Users/scott/work', projects: 1 }] }).kb)
  assert.deepEqual(two.filter(x => x.data.includes(':rm:')).map(x => x.text), ['✖ Убрать ~/code', '✖ Убрать ~/work'])
  assert.doesNotMatch(zonesSummary('MacBook', state).text, /GitHub/)
})

test('browsing: a page of folders, pages, up, home and volumes, pick this one; a drive root can\'t be picked', () => {
  const list: FolderList = {
    path: '/Users/scott/Documents', parent: '/Users/scott', more: 0,
    folders: Array.from({ length: 30 }, (_, i) => ({ name: `f${i}`, path: `/Users/scott/Documents/f${i}` })),
  }
  const b = buttons(browseView('abcd1234', state, list, 1).kb)
  const opened = b.filter(x => x.data.includes(':o:')).map(x => x.data)
  assert.equal(opened.length, 12)
  assert.equal(opened[0], 'zf:abcd1234:o:12')
  assert.deepEqual(b.filter(x => x.data.includes(':pg:')).map(x => x.text), ['1', '· 2 ·', '3'])
  assert.ok(b.some(x => x.data === 'zf:abcd1234:up'))
  assert.deepEqual(b.filter(x => x.data.includes(':rt:')).map(x => x.text), ['🏠 Домой', '💽 Backup'])
  assert.ok(b.some(x => x.data === 'zf:abcd1234:pk'))
  // No row wider than two buttons (page numbers are short): a phone cuts four down to a letter or two
  assert.ok(browseView('abcd1234', { ...state, roots: [...state.roots, { name: 'Media', path: '/Volumes/Media' }, { name: 'Work', path: '/Volumes/Work' }] }, list, 0).kb!.inline_keyboard.filter(r => !(r[0] as { callback_data: string }).callback_data.includes(':pg:')).every(r => r.length <= 2))
  // Every button fits Telegram's 64 bytes
  assert.ok(b.every(x => Buffer.byteLength(x.data) <= 64))

  const root = buttons(browseView('abcd1234', state, { path: '/', parent: null, folders: [], more: 0 }, 0).kb)
  assert.ok(!root.some(x => x.data.endsWith(':pk') || x.data.endsWith(':up')))
})

test('a picked folder goes instead of the working one or next to it', () => {
  const one = pickView('abcd1234', state, '/Users/scott/Documents/GitHub')
  assert.match(one.text, /Папки на диске остаются как есть/)
  assert.deepEqual(buttons(one.kb).map(x => x.text), ['Вместо ~/code', 'Вместе с ~/code', '← Назад'])
  assert.deepEqual(buttons(pickView('abcd1234', { ...state, zones: [] }, '/x').kb).map(x => x.data), ['zf:abcd1234:rep', 'zf:abcd1234:back'])
})
