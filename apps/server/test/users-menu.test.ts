import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseUserId, usersKeyboard, usersText, type Account } from '../src/telegram/users-menu.ts'

const main: Account = { id: 111, name: 'Scott', username: 'scott', isMain: true, fromEnv: false }
const known: Account = { id: 222, name: 'Work <acc>', isMain: false, fromEnv: false }
const silent: Account = { id: 333, isMain: false, fromEnv: false }

test('an account is given by its numeric id; an @name can\'t be looked up', () => {
  assert.equal(parseUserId(' 5550001234 '), 5550001234)
  for (const bad of ['@scott', 'scott', '12', '1234567890123456', '12 34', '-5550001234', '']) assert.equal(parseUserId(bad), null, bad)
})

test('the list says who is who, escaped, and who hasn\'t written yet', () => {
  const text = usersText([main, known, silent])
  assert.match(text, /👑 <b>Scott @scott<\/b> · <code>111<\/code> · main/)
  assert.match(text, /Work &lt;acc&gt;/)
  assert.match(text, /<code>333<\/code> · hasn't written yet/)
  assert.match(text, /run of your computers/)
})

test('only accounts added here can be removed from here', () => {
  const buttons = usersKeyboard([main, known, silent, { id: 444, name: 'Env', isMain: false, fromEnv: true }]).inline_keyboard.flat().map(b => ('callback_data' in b ? b.callback_data : ''))
  assert.deepEqual(buttons, ['usr:rm:222', 'usr:rm:333', 'usr:add'])
})
