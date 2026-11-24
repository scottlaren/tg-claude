import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Every Claude the server starts takes its prompt as written: an «@/path» in a message, a file, a transcript or
// another session's text must never pull a file of the server into the conversation
test('every query() on the server has verbatimPrompts on', () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []))
  let seen = 0
  for (const f of files(join(import.meta.dirname, '../src'))) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/\bquery\(\{/g)) {
      seen++
      // The options object of this call: up to the closing of query({ … })
      const call = src.slice(m.index, src.indexOf('\n  })', m.index) + 1 || undefined)
      // The one way out: a call whose only prompt is fixed in code (/compact needs slash commands), said where it is made
      assert.ok(/verbatimPrompts: true/.test(call) || call.includes('verbatimPrompts: false, // fixed prompt:'), `${f}: query() without verbatimPrompts`)
    }
  }
  assert.ok(seen >= 4, `found only ${seen} query() calls`)
})

test('the self-check finds the VPS on the container\'s default route', async () => {
  const { defaultGateway } = await import('../src/sandbox.ts')
  const routes = 'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\nEth0\t00FBD50A\t00000000\t0001\t0\t0\t0\t00FFFFFF\neth0\t00000000\t01FBD50A\t0003\t0\t0\t0\t00000000\n'
  assert.equal(defaultGateway(routes), '10.213.251.1')
  assert.equal(defaultGateway('Iface\tDestination\tGateway\n'), null)
})
