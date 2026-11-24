import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../../../deploy/tgcv-ssh-alert.sh', import.meta.url))
const sh = (p: string) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, d) => `/${d.toLowerCase()}`)
const hasBash = (() => {
  try {
    return /Linux|Darwin|MINGW|MSYS/.test(execFileSync('bash', ['-c', 'uname -s'], { encoding: 'utf8' }))
  } catch {
    return false
  }
})()

// A fake curl first on the PATH: it writes down its arguments and what it read from stdin, and Telegram is never reached
function stand(env = 'TG_TOKEN=123:abc\nOWNER_IDS=555,666\n') {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-alert-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const out = join(dir, 'curl.txt')
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash\n{ printf '%s\\n' "$@"; cat; printf '=====\\n'; } >> "${sh(out)}"\n`, { mode: 0o755 })
  writeFileSync(join(dir, '.env'), env)
  const run = (extra: Record<string, string> = {}) => execFileSync('bash', [sh(SCRIPT), sh(join(dir, '.env'))], {
    env: {
      ...process.env,
      PATH: `${sh(bin)}:${process.env.PATH}`,
      PAM_TYPE: 'open_session', PAM_USER: 'root', PAM_RHOST: '203.0.113.7',
      TGCV_ALERT_CHAT: sh(join(dir, 'alert-chat')), TGCV_ALERT_OWNER: sh(join(dir, 'main-owner')),
      TGCV_ALERT_LANG: sh(join(dir, 'lang')), TGCV_ALERT_SEEN: sh(join(dir, 'seen')), TGCV_ALERT_API: 'http://fake.invalid',
      ...extra,
    },
    encoding: 'utf8', timeout: 20_000,
  })
  const sent = async () => {
    await new Promise(r => setTimeout(r, 600))
    return existsSync(out) ? readFileSync(out, 'utf8').split('=====\n').filter(Boolean) : []
  }
  return { dir, run, sent, done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('a login from a new address sends a message, with the token on no command line', { skip: !hasBash }, async () => {
  const s = stand()
  try {
    s.run()
    const [call] = await s.sent()
    assert.ok(call, 'one message')
    assert.match(call, /chat_id=555/)
    assert.match(call, /parse_mode=HTML/)
    assert.match(call, /<code>root<\/code>/)
    assert.match(call, /<code>203\.0\.113\.7<\/code>/)
    assert.match(call, /SSH login to the VPS/)
    assert.doesNotMatch(call, /Вход на VPS/)
    const [args, stdin] = [call.split('url = ')[0], call.split('url = ')[1]]
    assert.ok(!args.includes('123:abc'), 'not in the arguments')
    assert.match(stdin, /fake\.invalid\/bot123:abc\/sendMessage/)
  } finally {
    s.done()
  }
})

test('it speaks the language the bot left for it, one at a time', { skip: !hasBash }, async () => {
  const s = stand()
  try {
    writeFileSync(join(s.dir, 'lang'), 'ru')
    s.run()
    const [call] = await s.sent()
    assert.match(call, /Вход на VPS/)
    assert.doesNotMatch(call, /SSH login to the VPS/)
  } finally {
    s.done()
  }
})

test('the same address again says nothing; another one does', { skip: !hasBash }, async () => {
  const s = stand()
  try {
    s.run()
    s.run()
    assert.equal((await s.sent()).length, 1)
    s.run({ PAM_RHOST: '203.0.113.8' })
    assert.equal((await s.sent()).length, 2)
  } finally {
    s.done()
  }
})

test('only the opening of a session counts, and whatever is missing the login goes on', { skip: !hasBash }, async () => {
  const s = stand('')
  try {
    s.run({ PAM_TYPE: 'close_session' })
    s.run()
    assert.equal((await s.sent()).length, 0)
  } finally {
    s.done()
  }
})

test('with no owner in the settings, the bot\'s word is taken once and kept', { skip: !hasBash }, async () => {
  const s = stand('TG_TOKEN=123:abc\n')
  try {
    writeFileSync(join(s.dir, 'main-owner'), '777')
    s.run()
    assert.match((await s.sent())[0], /chat_id=777/)
    assert.equal(readFileSync(join(s.dir, 'alert-chat'), 'utf8'), '777')
    // A server taken over can rewrite this file: it no longer matters
    writeFileSync(join(s.dir, 'main-owner'), '999')
    s.run({ PAM_RHOST: '203.0.113.9' })
    assert.match((await s.sent())[1], /chat_id=777/)
  } finally {
    s.done()
  }
})

test('an address that is not one cannot reach outside the folder or into the text as anything else', { skip: !hasBash }, async () => {
  const s = stand()
  try {
    s.run({ PAM_RHOST: '../../evil;$(touch pwned)' })
    const [call] = await s.sent()
    assert.ok(call)
    assert.ok(!call.includes('$('))
    assert.ok(!call.includes('/evil'))
    assert.equal(existsSync(join(s.dir, 'evil')), false)
  } finally {
    s.done()
  }
})
