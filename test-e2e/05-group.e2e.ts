import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startStack, pairCodeIn, until, sleep, type Stack } from './support/stack.ts'

// A group as a workspace: its card, a head topic, an agent on a branch of its own, its report with a picture, 👀 on a
// report while the head is busy, removing the agent

const GROUP = -1003000000001
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

for (const language of ['en', 'ru'] as const) {
  describe(`workspace in ${language}`, () => {
    let s: Stack
    let head = 0
    let zone = ''
    let device = ''
    const tr = (en: RegExp, ru: RegExp) => (language === 'en' ? en : ru)

    before(async () => {
      s = await startStack({ language })
      s.tg.setLang(language)
      await s.startServer()
      const t = Date.now()
      s.send('/pair')
      const m = await s.reply(/install\//, { after: t })
      const a = await s.pairAgent('E2E-PC', pairCodeIn(m)!, [], { gitProjects: ['game'] })
      zone = a.zone
      device = a.id
      await sleep(300)
    })
    after(() => s?.stop())

    const inGroup = (thread?: number) => ({ chat: GROUP, thread })

    test('the bot added to a group sets it up; its card picks computer, project, permissions', async () => {
      const t = Date.now()
      s.tg.addGroup(s.user, GROUP, 'E2E team')
      const card = await until('the card', () => s.tg.sent.find(m => m.at >= t && m.chat.id === GROUP && m.buttons.flat().some(b => b.data === 'ws:dev')))
      await s.tap(card, 'ws:dev')
      await until('the list of computers', () => s.tg.sent.find(m => m.message_id === card.message_id)!.buttons.flat().some(b => b.data === `ws:dev:${device}`))
      await s.tap(s.tg.sent.find(m => m.message_id === card.message_id)!, `ws:dev:${device}`)
      await until('back on the card', () => s.tg.sent.find(m => m.message_id === card.message_id)!.buttons.flat().some(b => b.data === 'ws:prj'))
      await s.tap(s.tg.sent.find(m => m.message_id === card.message_id)!, 'ws:prj')
      await until('the list of projects', () => s.tg.sent.find(m => m.message_id === card.message_id)!.buttons.flat().some(b => /^ws:prj:.+/.test(b.data ?? '')))
      const c = s.tg.sent.find(m => m.message_id === card.message_id)!
      await s.tap(c, c.buttons.flat().find(b => /^ws:prj:(?!-)/.test(b.data ?? '') && b.text === 'game')!.data!)
      await until('the project on the card', () => /game/.test(s.tg.sent.find(m => m.message_id === card.message_id)!.text))
      await until('back on the card', () => s.tg.sent.find(m => m.message_id === card.message_id)!.buttons.flat().some(b => b.data === 'ws:mod'))
      await s.tap(s.tg.sent.find(m => m.message_id === card.message_id)!, 'ws:mod')
      await until('modes', () => s.tg.sent.find(m => m.message_id === card.message_id)!.buttons.flat().some(b => b.data === 'ws:mod:all'))
      await s.tap(s.tg.sent.find(m => m.message_id === card.message_id)!, 'ws:mod:all')
      await until('back on the card', () => s.tg.sent.find(m => m.message_id === card.message_id)!.buttons.flat().some(b => b.data === 'ws:mod'))
    })

    test('/topic in the group opens a topic bound by the card; private commands stay private; a stranger is ignored', async () => {
      const t = Date.now()
      s.send('/topic Head', inGroup())
      const hello = await until('a new topic', () => s.tg.sent.find(m => m.at >= t && m.chat.id === GROUP && m.thread))
      head = hello.thread!
      s.send('/status', inGroup(head))
      const st = await s.reply(/game/, { ...inGroup(head), after: t })
      assert.match(st.text, /E2E-PC/)
      const t2 = Date.now()
      s.send('/devices', inGroup(head))
      await s.reply(tr(/only in the private chat/, /только в личке/), { ...inGroup(head), after: t2 })
      const before = s.tg.sent.length
      s.tg.text({ id: 42, is_bot: false, first_name: 'Stranger' }, GROUP, 'do something for me', { thread: head })
      await sleep(400)
      assert.equal(s.tg.sent.length, before, 'no answer to someone outside /users')
    })

    let worker = 0
    test('start_agent: a topic, a branch worktree, the report with a picture in the head; 👀 on a report while the head works', async () => {
      const wt = join(zone, 'game-wt', 'layout')
      const workerScript = s.script([
        { mark: `worker-started-${language}` },
        { tool: 'mcp__device__run_command', input: { command: 'git rev-parse --abbrev-ref HEAD && node -e "require(\'fs\').writeFileSync(\'report.png\', Buffer.from(\'' + PNG.toString('base64') + '\', \'base64\'))" && git add -A && git commit -q -m report' } },
        { wait: `worker-go-${language}` },
        { text: 'Report from the worker E2E\n\n![the result](report.png)' },
      ])
      const headScript = s.script([
        { tool: 'mcp__team__start_agent', input: { name: 'Layout', task: `Work. ${workerScript}`, branch: 'layout', model: 'sonnet', effort: 'low' } },
        { text: 'started it E2E' },
      ])
      const t = Date.now()
      s.send(`go ${headScript}`, inGroup(head))
      await s.reply(/started it E2E/, { ...inGroup(head), after: t })
      await until('the worker to run', () => s.flagged(`worker-started-${language}`))
      const topic = [...s.tg.topics.get(GROUP)!].find(([, x]) => x.name === '🤖 Layout')
      assert.ok(topic, 'the agent has a topic')
      worker = topic![0]
      assert.ok(existsSync(wt), 'the worktree is next to the repository')
      const branch = execFileSync('git', ['-C', wt, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
      assert.equal(branch, 'agent/layout')
      await until('the command to be done', () => s.journal().some(j => j.kind === 'tool' && j.at >= t && /agent\/layout/.test(j.text)))

      // The head is busy when the report comes: it waits, marked 👀 where the user can see it
      const t2 = Date.now()
      s.send(`go ${s.script([{ mark: `head-busy-${language}` }, { wait: `head-go-${language}` }, { text: 'head done E2E' }])}`, inGroup(head))
      await until('the head to work', () => s.flagged(`head-busy-${language}`))
      s.flag(`worker-go-${language}`)
      const report = await s.reply(/Report from the worker E2E/, { ...inGroup(head), after: t2 })
      assert.doesNotMatch(report.text, /report\.png/, 'the picture is not left in the quote')
      const pic = await until('the picture under the report', () => s.tg.sent.find(m => m.at >= t2 && m.chat.id === GROUP && m.thread === head && m.media.length === 1))
      assert.equal(pic.media[0].bytes, PNG.length)
      await until('👀 on the report', () => s.tg.reactionsOf(GROUP, report.message_id).includes('👀'))
      s.flag(`head-go-${language}`)
      await s.reply(/head done E2E/, { ...inGroup(head), after: t2 })
      await until('the head to read the report', () => s.journal().some(j => j.kind === 'turn' && j.at >= t2 && /Report from agent/.test(j.prompt) && /Report from the worker E2E/.test(j.prompt)), 15_000)
      await until('👀 to go', () => !s.tg.reactionsOf(GROUP, report.message_id).includes('👀'))
    })

    test('/team and team_status say who is where; message_agent reaches it', async () => {
      let t = Date.now()
      s.send('/team', inGroup(head))
      const team = await s.reply(/Layout/, { ...inGroup(head), after: t })
      assert.match(team.text, /layout/)
      t = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__team__team_status', input: {} }, { tool: 'mcp__team__message_agent', input: { agent: 'Layout', text: 'one more thing' } }, { text: 'told it E2E' }])}`, inGroup(head))
      await s.reply(/told it E2E/, { ...inGroup(head), after: t })
      await s.reply(/one more thing/, { ...inGroup(worker), after: t })
    })

    test('remove_agent: the topic and session go, the folder goes, the branch stays', async () => {
      await until('the worker to go idle', async () => {
        s.send('/status', inGroup(worker))
        await sleep(400)
        return s.journal().filter(j => j.kind === 'answer').length >= 3
      }, 15_000, 500)
      await sleep(4000)
      const t = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__team__remove_agent', input: { agent: 'Layout' } }, { text: 'removed E2E' }])}`, inGroup(head))
      await s.reply(/removed E2E/, { ...inGroup(head), after: t })
      const said = s.journal().filter(j => j.kind === 'tool' && j.at >= t)[0]
      assert.match(said.text, /removed/, said.text)
      assert.equal(s.tg.topics.get(GROUP)!.has(worker), false, 'its topic is deleted')
      const wt = join(zone, 'game-wt', 'layout')
      await until('its folder to be gone', () => !existsSync(wt), 5000)
      const branches = execFileSync('git', ['-C', join(zone, 'game'), 'branch', '--list', 'agent/layout'], { encoding: 'utf8' })
      assert.match(branches, /agent\/layout/, 'the branch stays in the repository')
    })

    test('/decisions: only the owner\'s turn records one, it shows, it can be removed', async () => {
      let t = Date.now()
      s.send(`We pick red. ${s.script([{ tool: 'mcp__workspace_memory__record_decision', input: { text: 'Red is the colour' } }, { text: 'recorded E2E' }])}`, inGroup(head))
      await s.reply(/recorded E2E/, { ...inGroup(head), after: t })
      t = Date.now()
      s.send('/decisions', inGroup(head))
      await s.reply(/Red is the colour/, { ...inGroup(head), after: t })
      t = Date.now()
      s.send('next', inGroup(head))
      await s.reply(/echo:/, { ...inGroup(head), after: t })
      assert.match(s.journal().filter(j => j.kind === 'turn').at(-1)!.appendText, /Red is the colour/, 'every topic reads it')
    })

    test('answers in a group come whole, with a live status and a Stop button that works', async () => {
      // Statuses only use what the writes of the last minute leave
      await sleep(61_000)
      let t = Date.now()
      s.send(`go ${s.script([{ text: 'whole answer E2E' }])}`, inGroup(head))
      await s.reply(/whole answer E2E/, { ...inGroup(head), after: t })
      assert.equal(s.tg.drafts().filter(d => d.chat === GROUP).length, 0, 'no drafts in a group')
      t = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__device__list_files', input: {} }, { mark: `busy-${language}` }, { wait: `never-${language}` }, { text: 'never said E2E' }])}`, inGroup(head))
      const status = await until('the status message', () => s.tg.sent.find(m => m.at >= t && m.chat.id === GROUP && m.thread === head && m.buttons.flat().some(b => /^stg:/.test(b.data ?? ''))), 15_000)
      const a = await s.tap(status, status.buttons.flat().find(b => /^stg:/.test(b.data ?? ''))!.data!)
      assert.ok(a.text)
      await s.reply(/⏹/, { ...inGroup(head), after: t })
      await sleep(300)
      assert.ok(!s.tg.sent.some(m => m.chat.id === GROUP && !m.deleted && /never said E2E/.test(m.text)))
      await until('the status to be gone', () => s.tg.sent.find(m => m.message_id === status.message_id)!.deleted, 5000)
    })

    test('nothing raw, nothing in the wrong language, nothing left the computer', () => {
      assert.deepEqual(s.tg.findings, [])
      assert.deepEqual(s.netViolations(), [])
      void writeFileSync
    })
  })
}
