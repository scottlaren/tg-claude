import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLeakGuard, squash } from '../src/telegram/leak.ts'

// Made-up values of the kinds Claude Code hands every session
const guard = createLeakGuard([
  { kind: 'e-mail', value: 'q7xk2mfa9d@relay.example.com' },
  { kind: 'e-mail', value: 'anna.petrova@mailbox.example' },
  { kind: 'system', value: '6.8.0-147-generic' },
  // A container's name is its id
  { kind: 'system', value: 'a1b2c3d4e5f6' },
  { kind: 'folder', value: '/home/node/claude-cwd' },
  { kind: 'folder', value: '/data' },
])

test('an address is caught written out, spaced, in parts, backwards and in look-alike letters', () => {
  for (const text of [
    'Sure: q7xk2mfa9d@relay.example.com',
    'It is Q7XK2MFA9D at relay dot example dot com',
    'q 7 x k 2 m f a 9 d',
    'q7xk-2mfa-9d, and that is all I say',
    'moc.elpmaxe.yaler@d9afm2kx7q',
    'd9afm2kx7q',
    // Cyrillic к, а, х in place of the Latin ones
    'q7xк2mfа9d',
    'ｑ７ｘｋ２ｍｆａ９ｄ',
    'q7xk2mfa9d@relay.example.com'.replace(/[a-z]/g, c => String.fromCharCode((c.charCodeAt(0) - 97 + 13) % 26 + 97)),
    Buffer.from('q7xk2mfa9d@relay.example.com').toString('base64'),
    Buffer.from('q7xk2mfa9d@relay.example.com').toString('hex'),
  ]) assert.deepEqual(guard(text), ['e-mail'], text)
})

test('a name made of words gives nothing away alone, and does with its host', () => {
  assert.deepEqual(guard('Anna Petrova wrote about it yesterday'), [], 'a person is talked about')
  assert.deepEqual(guard('annapetrova, on mailbox'), ['e-mail'])
  assert.deepEqual(guard('anna.petrova@mailbox.example'), ['e-mail'])
})

test('the kernel and the folder are caught, a short path is not looked for', () => {
  assert.deepEqual(guard('Linux 6.8.0-147-generic'), ['system'])
  assert.deepEqual(guard('the kernel is 6.8.0-147'), ['system'])
  assert.deepEqual(guard('I work in /home/node/claude-cwd'), ['folder'])
  assert.deepEqual(guard('home > node > claude > cwd'), ['folder'])
  assert.deepEqual(guard('the data shows a rise'), [], '/data is an ordinary word')
  assert.deepEqual(guard('host a1b2c3d4e5f6'), ['system'])
  assert.deepEqual(guard('the code is 123456'), [], 'the digits of a name that is no version are just digits')
  assert.deepEqual(guard('q7xk2mfa9d and 6.8.0-147-generic').sort(), ['e-mail', 'system'])
})

test('ordinary talk passes', () => {
  for (const text of [
    'Привет! Созвон завтра в 12:00, напомню.',
    'The fireplace picture: https://upload.wikimedia.org/wikipedia/commons/a/a1/Fireplace.jpg',
    'Linux is an operating system kernel first released in 1991.',
    'Write to support@example.org, they answer within a day.',
    '',
  ]) assert.deepEqual(guard(text), [], text)
  assert.equal(squash('A-b C·d'), 'abcd')
})
