import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { startStack, pairCodeIn, until, sleep, type Stack } from './support/stack.ts'

// A night shift with the real server and agent. Putting the computer to sleep and tidying its desktop are harmless
// commands here, which leave a file: a test must never close the windows of the computer it runs on, or put it to sleep

const OFF_MARK = 'computer-asleep.txt'
const TIDY_MARK = 'computer-tidy.txt'

describe('a night shift', () => {
  let s: Stack
  let zone = ''
  const prompts = () => s.journal().filter(j => j.kind === 'turn')
  const offer = (o: { sleep: boolean, release: boolean }) => ({ tool: 'mcp__night_shift__offer_night_shift', input: { tasks: ['Собрать сцену', 'Проверить цены'], ...o } })

  async function topic(name: string, project: string) {
    const open = Date.now()
    s.send(`/topic ${name}`)
    const picker = await until('a picker', () => s.tg.sent.find(x => x.touched >= open && x.thread && x.buttons.flat().some(b => b.text === project)))
    await s.tap(picker, new RegExp(`^${project}$`))
    await s.reply(new RegExp(project), { thread: picker.thread! })
    return picker.thread!
  }

  before(async () => {
    s = await startStack({
      language: 'en',
      config: {
        shiftTickMs: 200, shiftMorningInMs: 6000, shiftWrapInMs: 5000, shiftOffCheckMs: 1500,
        shiftSleep: { program: 'node', args: ['-e', `require('fs').writeFileSync('${OFF_MARK}', 'off')`] },
        shiftTidy: { program: 'node', args: ['-e', `require('fs').writeFileSync('${TIDY_MARK}', 'x'); console.log('TIDY ' + JSON.stringify({ closed: 3, left: [{ app: 'AfterFX', title: 'scene.aep' }] }))`] },
      },
    })
    await s.startServer()
    const t = Date.now()
    s.send('/pair')
    const m = await s.reply(/install\//, { after: t })
    zone = (await s.pairAgent('E2E-PC', pairCodeIn(m)!, ['alpha', 'beta'])).zone
    await sleep(300)
  })
  after(() => s?.stop())

  test('said in words: a card first, the shift on a tap; the night asks nothing, and the end puts the computer to sleep, or says it stayed awake', async () => {
    const thread = await topic('Night', 'alpha')
    let t = Date.now()
    s.send(`it is your night shift ${s.script([offer({ sleep: true, release: false }), { text: 'card shown E2E' }])}`, { thread })
    const card = await s.reply(/Night shift/, { thread, after: t })
    await s.reply(/card shown E2E/, { thread, after: t })
    assert.match(card.text, /Собрать сцену/)
    assert.ok(!prompts().some(p => /started the night shift/.test(String(p.prompt))), 'nothing starts before the tap')

    // Asked at the start, as nobody is there at the end: tidy the desktop too
    await s.tap(card, card.buttons.flat().find(b => b.data?.startsWith('nsh:tidy:'))!.data!)
    await until('the tidy switch on', () => /Tidy the desktop: yes/.test(JSON.stringify(s.tg.sent.find(m => m.message_id === card.message_id)!.buttons)))
    t = Date.now()
    await s.tap(card, card.buttons.flat().find(b => b.data?.startsWith('nsh:go:'))!.data!)
    await until('the shift begun', () => /night shift started/.test(s.tg.sent.find(m => m.message_id === card.message_id)!.text))
    await until('the head told to begin', () => prompts().some(p => p.at >= t && /\[The user started the night shift/.test(String(p.prompt))))
    const begun = prompts().find(p => p.at >= t && /started the night shift/.test(String(p.prompt)))!
    assert.match(String(begun.appendText), /# Night shift/)
    assert.match(String(begun.appendText), /Own branches only/)

    // Everything without questions: a command runs with no card, a question is refused, a push is refused (branches only)
    t = Date.now()
    s.send(`go on ${s.script([
      { tool: 'mcp__device__run_command', input: { command: 'echo night-work' } },
      { tool: 'AskUserQuestion', input: { questions: [{ question: 'Which?', header: 'Q', options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }], multiSelect: false }] } },
      { tool: 'mcp__device__run_command', input: { command: 'git push origin main' } },
      { tool: 'mcp__night_shift__end_night_shift', input: { done: true } },
      { text: 'summary of the night E2E' },
    ])}`, { thread })
    await s.reply(/summary of the night E2E/, { thread, after: t })
    const tools = s.journal().filter(j => j.kind === 'tool' && j.at >= t)
    assert.deepEqual(tools.map(j => j.verdict), ['allow', 'deny', 'deny', 'allow'])
    assert.ok(!s.tg.sent.some(m => m.touched >= t && m.buttons.flat().some(b => /^(ok|no):/.test(b.data ?? ''))), 'no permission card')

    // Kept to branches, the refused push brings one offer to allow it
    const allowCard = await until('the offer to allow release', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && m.buttons.flat().some(b => b.data?.startsWith('nsh:allow:'))))
    assert.match(allowCard.text, /kept to branches/)
    await until('the computer told to sleep', () => existsSync(join(zone, 'alpha', OFF_MARK)), 15_000)
    assert.ok(existsSync(join(zone, 'alpha', TIDY_MARK)), 'tidied before it sleeps')
    await s.reply(/E2E-PC<\/b> tidied: 3 windows closed\. Still open, most likely asking to save: AfterFX/, { thread, after: t, ms: 15_000 })
    await s.reply(/night shift ended at/, { thread, after: t, ms: 15_000 })
    // The stand-in command puts nothing to sleep: still awake, on the same connection, and that is said
    await s.reply(/was told to sleep, but it is still awake/, { thread, after: t, ms: 15_000 })
  })

  test('two shifts on one computer: the first done leaves it awake, the last done puts it to sleep', async () => {
    const one = await topic('Game one', 'alpha')
    const two = await topic('Game two', 'beta')
    const start = async (thread: number, name: string) => {
      const t = Date.now()
      s.send(`night shift ${s.script([offer({ sleep: true, release: false }), { text: `${name} card E2E` }])}`, { thread })
      const card = await s.reply(/Night shift/, { thread, after: t })
      await s.tap(card, card.buttons.flat().find(b => b.data?.startsWith('nsh:go:'))!.data!)
      await until('started', () => /night shift started/.test(s.tg.sent.find(m => m.message_id === card.message_id)!.text))
    }
    const end = async (thread: number, name: string) => {
      const t = Date.now()
      s.send(`done ${s.script([{ tool: 'mcp__night_shift__end_night_shift', input: { done: true } }, { text: `${name} summary E2E` }])}`, { thread })
      await s.reply(new RegExp(`${name} summary E2E`), { thread, after: t })
      return t
    }
    const { rmSync } = await import('node:fs')
    for (const p of ['alpha', 'beta']) rmSync(join(zone, p, OFF_MARK), { force: true })
    await start(one, 'one')
    await start(two, 'two')
    const t1 = await end(one, 'one')
    await s.reply(/is left as it is: another night shift still works on it/, { thread: one, after: t1 })
    await sleep(1500)
    assert.ok(!existsSync(join(zone, 'alpha', OFF_MARK)) && !existsSync(join(zone, 'beta', OFF_MARK)), 'awake while the second works')
    await end(two, 'two')
    await until('put to sleep by the last one', () => existsSync(join(zone, 'beta', OFF_MARK)) || existsSync(join(zone, 'alpha', OFF_MARK)), 15_000)
  })

  test('ended unfinished in the night: nothing more happens on it, so it turns off all the same', async () => {
    const thread = await topic('Night early', 'alpha')
    const { rmSync } = await import('node:fs')
    rmSync(join(zone, 'alpha', OFF_MARK), { force: true })
    let t = Date.now()
    s.send(`night shift ${s.script([offer({ sleep: true, release: true }), { text: 'early card E2E' }])}`, { thread })
    const card = await s.reply(/Night shift/, { thread, after: t })
    await s.tap(card, card.buttons.flat().find(b => b.data?.startsWith('nsh:go:'))!.data!)
    await until('started', () => /night shift started/.test(s.tg.sent.find(m => m.message_id === card.message_id)!.text))
    t = Date.now()
    s.send(`stop here ${s.script([{ tool: 'mcp__night_shift__end_night_shift', input: { done: false } }, { text: 'left some for the morning E2E' }])}`, { thread })
    await s.reply(/left some for the morning E2E/, { thread, after: t })
    await until('put to sleep', () => existsSync(join(zone, 'alpha', OFF_MARK)), 15_000)
  })

  test('morning before the end: wrap-up comes first, then the morning; the head sums up, and the computer stays awake', async () => {
    const thread = await topic('Night two', 'beta')
    const { rmSync } = await import('node:fs')
    // What the shifts before left: this one is about not turning off
    await sleep(2500)
    rmSync(join(zone, 'beta', OFF_MARK), { force: true })
    let t = Date.now()
    s.send(`your night shift ${s.script([offer({ sleep: true, release: true }), { text: 'second card E2E' }])}`, { thread })
    const card = await s.reply(/Night shift/, { thread, after: t })
    assert.match(card.text, /Merge and release: allowed/)
    t = Date.now()
    await s.tap(card, card.buttons.flat().find(b => b.data?.startsWith('nsh:go:'))!.data!)
    await until('the head told to wrap up', () => prompts().some(p => p.at >= t && /it is wrap-up time/.test(String(p.prompt))), 20_000)
    await until('the head told it is morning', () => prompts().some(p => p.at >= t && /\[It is morning/.test(String(p.prompt))), 20_000)
    const at = (re: RegExp) => prompts().find(p => p.at >= t && re.test(String(p.prompt)))!.at
    assert.ok(at(/wrap-up time/) <= at(/\[It is morning/), 'wrap-up before the morning')
    const begun = prompts().find(p => p.at >= t && /started the night shift/.test(String(p.prompt)))!
    assert.match(String(begun.appendText), /background: true/)
    assert.match(String(begun.appendText), /you are told to wrap up/)
    assert.match(String(begun.appendText), /Merging and releasing are allowed/)
    await sleep(1000)
    assert.ok(!existsSync(join(zone, 'beta', OFF_MARK)), 'not turned off: the work is not done')
  })

  test('stopped by the user: the topic gets its permissions back, nothing turns off, no push', async () => {
    const thread = await topic('Night three', 'alpha')
    let t = Date.now()
    s.send(`night shift ${s.script([offer({ sleep: true, release: false }), { text: 'third card E2E' }])}`, { thread })
    const card = await s.reply(/Night shift/, { thread, after: t })
    await s.tap(card, card.buttons.flat().find(b => b.data?.startsWith('nsh:go:'))!.data!)
    const started = await until('the stop button', () => s.tg.sent.find(m => m.message_id === card.message_id && m.buttons.flat().some(b => b.data?.startsWith('nsh:stop:'))))
    await s.tap(started, started.buttons.flat().find(b => b.data?.startsWith('nsh:stop:'))!.data!)
    await until('stopped', () => /was stopped/.test(s.tg.sent.find(m => m.message_id === card.message_id)!.text))
    t = Date.now()
    s.send(`after ${s.script([{ tool: 'mcp__device__run_command', input: { command: 'echo asks-again' } }, { text: 'after the stop E2E' }])}`, { thread })
    await until('a permission card again', () => s.tg.sent.find(m => m.touched >= t && m.thread === thread && m.buttons.flat().some(b => /^ok:/.test(b.data ?? ''))), 15_000)
  })
})
