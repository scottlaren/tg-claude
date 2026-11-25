import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanable, firstNames, folderName, lastMoved, parseWorktrees } from '../src/telegram/worktree-clean.ts'

const porcelain = [
  'worktree C:/code/game', 'HEAD aaa', 'branch refs/heads/main', '',
  'worktree C:/code/game-wt/layout', 'HEAD bbb', 'branch refs/heads/agent/layout', '',
  'worktree C:/code/game-wt/loose', 'HEAD ccc', 'detached', '',
].join('\r\n')

test('the main checkout is not one of them; a detached one has no branch', () => {
  assert.deepEqual(parseWorktrees(porcelain), [
    { folder: 'C:/code/game-wt/layout', branch: 'agent/layout' },
    { folder: 'C:/code/game-wt/loose' },
  ])
})

test('one an agent works in stays, however its path is written; one with no branch stays', () => {
  const list = parseWorktrees(porcelain)
  assert.deepEqual(cleanable(list, []).map(w => w.branch), ['agent/layout'])
  assert.deepEqual(cleanable(list, ['c:\\code\\game-wt\\layout\\']), [])
})

test('the name to show is the folder\'s own', () => {
  assert.equal(folderName('C:\\code\\game-wt\\layout\\'), 'layout')
})

test('a worktree last moved at the newer of its last commit and the last move of its HEAD', () => {
  assert.equal(lastMoved('1793995387 HEAD@{1793999999}\n'), 1793999999_000)
  assert.equal(lastMoved('1793995387\r\n'), 1793995387_000)
  assert.equal(lastMoved(''), 0, 'git said nothing: not known, so not stale')
  assert.equal(lastMoved('fatal: bad object 12'), 0)
})

test('a long list of names is cut, with how many more', () => {
  const more = (n: number) => `and ${n} more`
  assert.equal(firstNames(['a', 'b'], more), 'a, b')
  assert.equal(firstNames(['a', 'b', 'c', 'd'], more, 2), 'a, b and 2 more')
})
