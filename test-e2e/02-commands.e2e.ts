import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { startStack, pairCodeIn, until, sleep, type Stack } from './support/stack.ts'
import type { Sent } from './support/fake-telegram.ts'

// Every command of the menu, in the plain chat and in a topic, in both languages. Every button they show is tapped once,
// and then the buttons of what that opened, unless it starts something outside the stand (a browser window, a Chrome
// policy, GitHub) or takes away what the next step needs

const OUTSIDE = /^(lg:|lggo:|lgx|lgw:|mcl:|mcw:|bpx:(on|off|onok|offok)|bpr:|ghc:|ghout|ghcode|rv:|rvok:|del:|clok:|upd:go|updw:|dlt:|brr|bb:|np:|zf:[^:]+:(br|ok)|pairnew|lang:|lck:go|kaw:on|stm|wtc:|nsh:)/

for (const language of ['en', 'ru'] as const) {
  describe(`commands in ${language}`, () => {
    let s: Stack
    let thread = 0
    const dead: string[] = []

    before(async () => {
      s = await startStack({ language })
      s.tg.setLang(language)
      await s.startServer()
      const t = Date.now()
      s.send('/pair')
      const m = await s.reply(/install\//, { after: t })
      await s.pairAgent('E2E-PC', pairCodeIn(m)!, ['alpha', 'beta'])
      await sleep(500)
      s.send('/topic Work')
      const picker = await until('a picker', () => s.tg.sent.find(x => x.thread && x.buttons.flat().some(b => b.data?.startsWith('b:'))))
      thread = picker.thread!
      const b = picker.buttons.flat().find(x => x.text === 'alpha')!
      await s.tap(picker, b.text === 'alpha' ? /^alpha$/ : /./)
      await s.reply(/alpha/, { thread })
    })
    after(() => s?.stop())

    const newSince = (i: number) => s.tg.sent.slice(i).filter(m => !m.deleted)

    async function tapAll(m: Sent, depth: number) {
      for (const row of m.buttons) {
        for (const b of row) {
          if (!b.data || OUTSIDE.test(b.data) || m.deleted) continue
          // The card may have changed under us
          if (!m.buttons.flat().some(x => x.data === b.data)) continue
          const i = s.tg.sent.length
          const id = s.tg.tap(s.user, m, b.data)
          try {
            await until(`an answer to ${b.data}`, () => s.tg.wasAnswered(id), 4000)
          } catch {
            dead.push(`${b.text} → ${b.data} on: ${m.text.slice(0, 80)}`)
          }
          if (depth > 0) for (const n of newSince(i)) await tapAll(n, depth - 1)
        }
      }
    }

    const menu = () => s.tg.commands.find(c => !c.scope)!.list.map(c => c.command)

    test('every menu command answers in the plain chat and its buttons work', async () => {
      assert.ok(menu().length > 20, 'the menu is there')
      for (const command of [...menu().filter(c => c !== 'delete'), 'start']) {
        const i = s.tg.sent.length
        s.send(`/${command}`)
        await until(`an answer to /${command}`, () => newSince(i).length > 0, 15_000)
        await sleep(100)
        for (const m of newSince(i)) await tapAll(m, 1)
      }
    })

    test('every menu command answers in a topic', async () => {
      for (const command of menu().filter(c => c !== 'delete' && c !== 'topic')) {
        const i = s.tg.sent.length
        s.send(`/${command}`, { thread })
        await until(`an answer to /${command} in a topic`, () => newSince(i).length > 0, 15_000)
        await sleep(100)
        // The answer stays in the topic it was asked in
        for (const m of newSince(i)) {
          if (command === 'pair' || command === 'devices' || command === 'users') continue
          assert.equal(m.thread, thread, `/${command} answered outside its topic: ${m.text.slice(0, 100)}`)
        }
        for (const m of newSince(i)) await tapAll(m, 0)
      }
    })

    test('no dead buttons, no raw errors, no text in the wrong language', () => {
      assert.deepEqual(dead, [])
      assert.deepEqual(s.tg.findings, [])
      assert.deepEqual(s.netViolations(), [])
      assert.equal(s.isServerUp(), true)
    })
  })
}
