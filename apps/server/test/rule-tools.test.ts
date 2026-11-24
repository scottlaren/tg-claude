import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withRule, RULES_HEADING } from '../src/claude/rule-tools.ts'

test('no file yet: the heading and the rule', () => {
  assert.equal(withRule('', 'Short answers'), `${RULES_HEADING}\n\n- Short answers\n`)
})

test('a file without the heading: it goes at the end, the rest as it was', () => {
  assert.equal(withRule('# Project\n\nText.\n', 'Short answers'), `# Project\n\nText.\n\n${RULES_HEADING}\n\n- Short answers\n`)
})

test('the heading there: the rule goes after the last one in it, before the next section', () => {
  const before = `# P\n\n${RULES_HEADING}\n\n- One\n\n## Later\n\nMore.\n`
  assert.equal(withRule(before, 'Two'), `# P\n\n${RULES_HEADING}\n\n- One\n- Two\n\n## Later\n\nMore.\n`)
})

test('one line, whatever came in; Windows line ends stay Windows line ends', () => {
  assert.equal(withRule(`${RULES_HEADING}\r\n\r\n- One\r\n`, 'Two\n  lines'), `${RULES_HEADING}\r\n\r\n- One\r\n- Two lines\r\n`)
  assert.equal(withRule('# P\r\n', 'Two'), `# P\r\n\r\n${RULES_HEADING}\r\n\r\n- Two\r\n`)
})
