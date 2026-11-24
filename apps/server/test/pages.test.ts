import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageRow } from '../src/telegram/pages.ts'

const labels = (page: number, pages: number) => pageRow(page, pages).map(b => b.label).join(' ')

test('one page needs no row; up to five pages are all shown', () => {
  assert.equal(labels(0, 1), '')
  assert.equal(labels(0, 3), '· 1 · 2 3')
  assert.equal(labels(4, 5), '1 2 3 4 · 5 ·')
})

test('more pages: first, three around the current one, last', () => {
  assert.equal(labels(0, 9), '· 1 · 2 3 4 9 »')
  assert.equal(labels(4, 9), '« 1 4 · 5 · 6 9 »')
  assert.equal(labels(8, 9), '« 1 6 7 8 · 9 ·')
  assert.deepEqual(pageRow(4, 9).map(b => b.page), [0, 3, 4, 5, 8])
})
