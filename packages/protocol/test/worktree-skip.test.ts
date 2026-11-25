import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWorktreeSkip, sparseLeftOut, sparsePatterns } from '../src/index.ts'

test('.worktree-skip: one folder per line, comments and blank lines aside, however the slashes are written', () => {
  assert.deepEqual(parseWorktreeSkip('# screenshots of playtests\r\ndocs/playtest\r\n\r\n/docs/head/\nart\\raw\n  renders  \ndocs/playtest\n'), ['docs/playtest', 'docs/head', 'art/raw', 'renders'])
  assert.deepEqual(parseWorktreeSkip(''), [])
})

test('only plain paths inside the repository: nothing that means something to git or to a shell', () => {
  assert.deepEqual(parseWorktreeSkip(['../other', 'a/../b', './a', 'docs/*', '!docs', 'a[b]', 'what?', "it's", 'a%sb', '$HOME', 'a`b`', 'a//b', 'x'.repeat(201), 'Арт/исходники'].join('\n')), ['Арт/исходники'])
  assert.equal(parseWorktreeSkip(Array.from({ length: 80 }, (_, i) => `f${i}`).join('\n')).length, 50)
})

test('the patterns keep everything but those folders, and say nothing a bad line asked for', () => {
  assert.deepEqual(sparsePatterns(['docs/playtest', 'art']), ['/*', '!/docs/playtest/', '!/art/'])
  assert.deepEqual(sparsePatterns(['*', '../x']), ['/*'])
  assert.deepEqual(sparsePatterns([]), ['/*'])
})

test('what a sparse checkout leaves out: a folder brought back later is no longer one of them', () => {
  assert.deepEqual(sparseLeftOut('/*\n!/docs/playtest/\n!/docs/head/\n'), ['docs/playtest', 'docs/head'])
  assert.deepEqual(sparseLeftOut('/*\r\n!/docs/playtest/\r\n!/docs/head/\r\n/docs/head/\r\n'), ['docs/playtest'])
  assert.deepEqual(sparseLeftOut('/*\n'), [])
  assert.deepEqual(sparseLeftOut(''), [])
})
