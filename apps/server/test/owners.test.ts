import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOwners } from '../src/owners.ts'

const file = () => join(mkdtempSync(join(tmpdir(), 'tgcv-owners-')), 'owners.json')

test('the installer code makes the first sender the owner, once, and survives a restart', () => {
  const f = file()
  const o = createOwners(f, [])
  assert.equal(o.claim(111, 'wrong', 'c0de'), false)
  assert.equal(o.claim(111, 'c0de', 'c0de'), true)
  assert.equal(o.has(111), true)
  // Spent: nobody else can use it, even with the right code
  assert.equal(o.claim(222, 'c0de', 'c0de'), false)
  assert.equal(o.has(222), false)
  assert.equal(createOwners(f, []).has(111), true)
})

test('no code, an owner from .env, or too many wrong codes: nothing can be claimed', () => {
  assert.equal(createOwners(file(), []).claim(1, 'x', undefined), false)
  assert.equal(createOwners(file(), [5]).claim(1, 'c0de', 'c0de'), false)
  const o = createOwners(file(), [])
  for (let i = 0; i < 20; i++) o.claim(9, `guess${i}`, 'c0de')
  assert.equal(o.claim(9, 'c0de', 'c0de'), false)
})

test('accounts join and leave the list; the main one is the first and stays', () => {
  const f = file()
  const o = createOwners(f, [])
  o.claim(111, 'c0de', 'c0de')
  assert.equal(o.isMain(111), true)
  assert.equal(o.add(222), true)
  assert.equal(o.add(222), false, 'already there')
  assert.equal(o.has(222), true)
  assert.equal(o.isMain(222), false)
  assert.deepEqual(o.ids(), [111, 222])
  assert.deepEqual(o.mainOnly(), [111], 'news of the server goes to the main account alone')
  assert.equal(createOwners(f, []).has(222), true, 'survives a restart')
  assert.equal(o.removable(111), false)
  assert.equal(o.remove(111), false)
  assert.equal(o.has(111), true)
  assert.equal(o.remove(222), true)
  assert.equal(o.has(222), false)
  assert.equal(o.remove(222), false)
  assert.equal(createOwners(f, []).has(222), false)
})

test('adding an account doesn\'t bring the spent code back', () => {
  const o = createOwners(file(), [])
  o.claim(111, 'c0de', 'c0de')
  o.add(222)
  o.remove(222)
  assert.equal(o.claim(333, 'c0de', 'c0de'), false)
})

test('accounts from .env come first and can only be removed there', () => {
  const o = createOwners(file(), [5, 6])
  assert.equal(o.isMain(5), true)
  assert.deepEqual(o.mainOnly(), [5])
  assert.equal(o.isFromEnv(6), true)
  assert.equal(o.removable(6), false)
  assert.equal(o.remove(6), false)
  assert.equal(o.has(6), true)
  o.add(7)
  assert.equal(o.removable(7), true)
  assert.deepEqual(createOwners(file(), []).mainOnly(), [], 'no owner yet')
})
