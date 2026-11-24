import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChromeMac, mainChrome, type Run } from '../src/chrome-mac.ts'
import { proxyFlags } from '../src/chrome.ts'

const EXE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const HELPER = '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/131/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper'

// A pretend Mac: ps lists what runs, kill quits Chrome, open starts it with the given flags
function fakeMac({ running = null as string[] | null, company = '' } = {}) {
  let chrome = running
  const calls: string[][] = []
  const run: Run = async (cmd, args) => {
    calls.push([cmd, ...args])
    if (cmd === 'ps') {
      return [
        '  1 /sbin/launchd',
        ...(chrome ? [`  501 ${[EXE, ...chrome].join(' ')}`, `  502 ${HELPER} --type=renderer`] : []),
        // Chrome for Claude, its own profile: never the user's
        `  700 ${EXE} --user-data-dir=/Users/me/Library/Application Support/tg-claude-vps/chrome-claude ${proxyFlags(1089).join(' ')}`,
      ].join('\n')
    }
    if (cmd === 'kill') chrome = null
    if (cmd === 'open') chrome = args.slice(args.indexOf('--args') + 1)
    if (cmd === 'defaults') {
      if (!company) throw new Error('does not exist')
      return company
    }
    return ''
  }
  const mac = createChromeMac({ port: 1089, run, wait: async () => {}, installed: () => true, user: 'me' })
  return { mac, calls, now: () => chrome }
}

test('the user\'s Chrome is the browser process on its own profile, not a helper or Chrome for Claude', () => {
  const ps = [`  502 ${HELPER} --type=gpu-process`, `  700 ${EXE} --user-data-dir=/x`, `  501 ${EXE} --flag-switches-begin`].join('\n')
  assert.deepEqual(mainChrome(ps), { pid: 501, args: `${EXE} --flag-switches-begin` })
  assert.equal(mainChrome(`  502 ${HELPER} --type=renderer`), null)
})

test('Mac: on quits Chrome and opens it again with the proxy flags and the same tabs; off opens it plain', async () => {
  const { mac, calls, now } = fakeMac({ running: [] })
  assert.deepEqual(await mac.status(), { supported: true, on: false, port: 1089, pending: false, relaunch: true, running: true })

  assert.equal((await mac.on()).on, true)
  assert.deepEqual(calls.find(c => c[0] === 'kill'), ['kill', '-TERM', '501'])
  assert.deepEqual(now(), ['--restore-last-session', ...proxyFlags(1089)])

  // Already through the server: nothing is restarted
  const before = calls.length
  assert.equal((await mac.on()).on, true)
  assert.equal(calls.slice(before).some(c => c[0] === 'kill' || c[0] === 'open'), false)

  assert.equal((await mac.off()).on, false)
  assert.deepEqual(now(), ['--restore-last-session'])
})

test('Mac: a Chrome opened from the Dock shows as straight; a closed one is just started through the server', async () => {
  const dock = fakeMac({ running: ['--flag-switches-begin'] })
  assert.equal((await dock.mac.status()).on, false)

  const closed = fakeMac()
  assert.deepEqual(await closed.mac.status(), { supported: true, on: false, port: 1089, pending: false, relaunch: true, running: false })
  assert.equal((await closed.mac.on()).on, true)
  assert.equal(closed.calls.some(c => c[0] === 'kill'), false)
  // Nothing to restore when Chrome wasn't open
  assert.deepEqual(closed.now(), proxyFlags(1089))
})

test('Mac: a company proxy policy outranks flags, so it says so instead of pretending', async () => {
  const { mac, calls } = fakeMac({ running: [], company: '{\n    ProxyMode = "fixed_servers";\n}' })
  const s = await mac.status()
  assert.equal(s.supported, false)
  assert.match(s.why!, /company policy/)
  await assert.rejects(mac.on(), /company policy/)
  assert.equal(calls.some(c => c[0] === 'kill' || c[0] === 'open'), false)
})

test('Mac: a Chrome that won\'t quit is left alone with a clear error', async () => {
  const calls: string[] = []
  const run: Run = async cmd => {
    calls.push(cmd)
    if (cmd === 'ps') return `  501 ${EXE}`
    if (cmd === 'defaults') throw new Error('none')
    return ''
  }
  const mac = createChromeMac({ port: 1089, run, wait: async () => {}, installed: () => true, user: 'me' })
  await assert.rejects(mac.on(), /did not close/)
  assert.equal(calls.includes('open'), false)
})
