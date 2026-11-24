import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { startStack, pairCodeIn, until, sleep, type Stack } from './support/stack.ts'
import type { Sent } from './support/fake-telegram.ts'

// /mode in each mode with real tool calls, permission cards, a question, a survey with an image and ticks

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

for (const language of ['en', 'ru'] as const) {
  const ALLOW = language === 'en' ? /✅ Allow/ : /✅ Разрешить/
  const NO = language === 'en' ? /🚫 No/ : /🚫 Нет/
  describe(`permissions in ${language}`, () => {
    let s: Stack
    let thread = 0
    let zone = ''
    let n = 0
    const lastTool = () => s.journal().filter(j => j.kind === 'tool').at(-1)!

    before(async () => {
      s = await startStack({ language })
      s.tg.setLang(language)
      await s.startServer()
      const t = Date.now()
      s.send('/pair')
      const m = await s.reply(/install\//, { after: t })
      const a = await s.pairAgent('E2E-PC', pairCodeIn(m)!, ['alpha'])
      zone = join(a.zone, 'alpha')
      await sleep(300)
      s.send('/topic Work')
      const picker = await until('a picker', () => s.tg.sent.find(x => x.thread && x.buttons.flat().some(b => b.text === 'alpha')))
      thread = picker.thread!
      await s.tap(picker, /^alpha$/)
      await s.reply(/alpha/, { thread })
    })
    after(() => s?.stop())

    async function setMode(data: string) {
      const t = Date.now()
      s.send('/mode', { thread })
      const card = await until('the mode card', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && m.buttons.flat().some(b => b.data === `m:${data}`)))
      await s.tap(card, `m:${data}`)
    }

    const write = (file: string) => ({ tool: 'mcp__device__write_file', input: { path: file, content: `written ${file}` } })
    const cmd = (c: string) => ({ tool: 'mcp__device__run_command', input: { command: c } })

    // The card of the tool call, or nothing
    const cardAfter = (t: number) => until('a card', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && m.buttons.flat().some(b => b.data && /^ok:/.test(b.data)) && !m.deleted))

    test('ask: a write waits for its card; allow writes, deny does not', async () => {
      await setMode('ask')
      const file = `a${++n}.txt`
      let t = Date.now()
      s.send(`go ${s.script([write(file), { text: 'done one E2E' }])}`, { thread })
      let card = await cardAfter(t)
      assert.equal(existsSync(join(zone, file)), false, 'nothing is written before the tap')
      await s.tap(card, ALLOW)
      await s.reply(/done one E2E/, { thread, after: t })
      assert.equal(readFileSync(join(zone, file), 'utf8'), `written ${file}`)
      await until('the card to settle', () => !s.tg.sent.find(m => m.message_id === card.message_id)!.buttons.flat().some(b => /^ok:/.test(b.data ?? '')))

      const denied = `a${++n}.txt`
      t = Date.now()
      s.send(`go ${s.script([write(denied), { text: 'done two E2E' }])}`, { thread })
      card = await cardAfter(t)
      await s.tap(card, NO)
      await s.reply(/done two E2E/, { thread, after: t })
      assert.equal(existsSync(join(zone, denied)), false)
      assert.equal(lastTool().verdict, 'deny')
    })

    test('ask: allow until the task ends covers the next call and no later turn', async () => {
      const a = `a${++n}.txt`
      const b = `a${++n}.txt`
      let t = Date.now()
      s.send(`go ${s.script([write(a), write(b), { text: 'until task E2E' }])}`, { thread })
      const card = await cardAfter(t)
      await s.tap(card, 'all:' + card.buttons.flat().find(x => x.data?.startsWith('all:'))!.data!.slice(4))
      await s.reply(/until task E2E/, { thread, after: t })
      assert.ok(existsSync(join(zone, a)) && existsSync(join(zone, b)))
      const c = `a${++n}.txt`
      t = Date.now()
      s.send(`go ${s.script([write(c), { text: 'next task E2E' }])}`, { thread })
      await s.tap(await cardAfter(t), ALLOW)
      await s.reply(/next task E2E/, { thread, after: t })
    })

    test('edits: files without asking, commands still ask', async () => {
      await setMode('edits')
      const file = `a${++n}.txt`
      let t = Date.now()
      s.send(`go ${s.script([write(file), { text: 'edits write E2E' }])}`, { thread })
      await s.reply(/edits write E2E/, { thread, after: t })
      assert.ok(existsSync(join(zone, file)))
      t = Date.now()
      s.send(`go ${s.script([cmd('echo from-command'), { text: 'edits cmd E2E' }])}`, { thread })
      await s.tap(await cardAfter(t), ALLOW)
      await s.reply(/edits cmd E2E/, { thread, after: t })
      assert.match(lastTool().text, /from-command/)
    })

    test('all: nothing asks', async () => {
      await setMode('all')
      const t = Date.now()
      s.send(`go ${s.script([cmd('echo all-mode'), write(`a${++n}.txt`), { text: 'all E2E' }])}`, { thread })
      await s.reply(/all E2E/, { thread, after: t })
      assert.ok(!s.tg.sent.some(m => m.at >= t && m.buttons.flat().some(b => /^ok:/.test(b.data ?? ''))))
    })

    test('read: reads work, writes and commands refused with no card', async () => {
      await setMode('read')
      const file = `a${++n}.txt`
      const t = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__device__list_files', input: {} }, write(file), cmd('echo nope'), { text: 'read E2E' }])}`, { thread })
      await s.reply(/read E2E/, { thread, after: t })
      assert.equal(existsSync(join(zone, file)), false)
      const tools = s.journal().filter(j => j.kind === 'tool' && j.at >= t)
      assert.deepEqual(tools.map(j => j.verdict), ['allow', 'deny', 'deny'])
      assert.ok(!s.tg.sent.some(m => m.at >= t && m.buttons.flat().some(b => /^ok:/.test(b.data ?? ''))))
      await setMode('ask')
    })

    test('a question: a button answers it, and so does typed text', async () => {
      const q = (question: string, options = ['Red', 'Blue'], multiSelect = false) => ({
        tool: 'AskUserQuestion',
        input: { questions: [{ question, header: 'Pick', multiSelect, options: options.map(label => ({ label, description: `${label} one` })) }] },
      })
      let t = Date.now()
      s.send(`ask ${s.script([q('Which colour E2E?'), { text: 'q one E2E' }])}`, { thread })
      let card = await s.reply(/Which colour E2E/, { thread, after: t })
      await s.tap(card, /Red/)
      await s.reply(/q one E2E/, { thread, after: t })
      assert.match(lastTool().text, /Red/)

      t = Date.now()
      s.send(`ask ${s.script([q('Which one typed E2E?'), { text: 'q two E2E' }])}`, { thread })
      await s.reply(/Which one typed E2E/, { thread, after: t })
      s.send('something else entirely', { thread })
      await s.reply(/q two E2E/, { thread, after: t })
      assert.match(lastTool().text, /something else entirely/)

      t = Date.now()
      s.send(`ask ${s.script([q('Which many E2E?', ['One', 'Two', 'Three'], true), { text: 'q three E2E' }])}`, { thread })
      card = await s.reply(/Which many E2E/, { thread, after: t })
      await s.tap(card, /One/)
      card = await until('the tick', () => {
        const c = s.tg.sent.find(m => m.message_id === card.message_id)!
        return c.buttons.flat().some(b => /☑️ One/.test(b.text)) ? c : null
      })
      await s.tap(card, /Three/)
      await until('the second tick', () => s.tg.sent.find(m => m.message_id === card.message_id)!.buttons.flat().some(b => /☑️ Three/.test(b.text)))
      await s.tap(s.tg.sent.find(m => m.message_id === card.message_id)!, language === 'en' ? /Done/ : /Готово/)
      await s.reply(/q three E2E/, { thread, after: t })
      assert.match(lastTool().text, /One, Three/)
    })

    test('a survey with an image and ticks keeps the picture to the end', async () => {
      const png = Buffer.from(PNG, 'base64')
      const { writeFileSync } = await import('node:fs')
      writeFileSync(join(zone, 'pic.png'), png)
      const script = s.script([
        {
          tool: 'mcp__survey__ask_survey',
          input: {
            title: 'E2E survey',
            questions: [
              { question: 'First E2E: which?', image: 'pic.png', multiple: true, options: [{ label: 'Aaa' }, { label: 'Bbb' }, { label: 'Ccc' }], recommended: [1] },
              { question: 'Second E2E: which?', options: [{ label: 'Xxx' }, { label: 'Yyy' }] },
              { question: 'Third E2E: say it' },
            ],
          },
        },
        { text: 'after the survey E2E' },
      ])
      let t = Date.now()
      s.send(`survey ${script}`, { thread })
      const first = await s.reply(/First E2E/, { thread, after: t })
      assert.equal(first.media.length, 1, 'the picture came with the question')
      // Ticks edit the message: the fake reports an edit that loses the picture
      const tick = async (label: RegExp, want: RegExp) => {
        const m = s.tg.sent.find(x => x.message_id === first.message_id)!
        await s.tap(m, label)
        await until(`the tick ${want}`, () => s.tg.sent.find(x => x.message_id === first.message_id)!.buttons.flat().some(b => want.test(b.text)))
      }
      await tick(/Aaa/, /☑️.*Aaa|✅.*Aaa/)
      await tick(/Ccc/, /☑️.*Ccc|✅.*Ccc/)
      const after = s.tg.sent.find(x => x.message_id === first.message_id)!
      assert.equal(after.media.length, 1, 'the picture stays after ticks')
      assert.ok(after.edits >= 2)
      t = Date.now()
      await s.tap(after, language === 'en' ? /Next|Done|Further/ : /Дальше|Готово/)
      const second = await s.reply(/Second E2E/, { thread, after: t })
      t = Date.now()
      await s.tap(second, /Yyy/)
      await s.reply(/Third E2E/, { thread, after: t })
      t = Date.now()
      s.send('my own words here', { thread })
      await until('the answers to reach Claude', () => s.journal().some(j => j.kind === 'turn' && j.at >= t && /my own words here/.test(j.prompt) && /Yyy/.test(j.prompt) && /Aaa/.test(j.prompt) && /Ccc/.test(j.prompt)))
    })

    test('every message was well-formed', () => {
      assert.deepEqual(s.tg.findings, [])
      assert.deepEqual(s.netViolations(), [])
    })
  })
}
void ({} as Sent)
