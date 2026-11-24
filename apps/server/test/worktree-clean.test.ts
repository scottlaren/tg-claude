import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanable, folderName, parseWorktrees } from '../src/telegram/worktree-clean.ts'

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
