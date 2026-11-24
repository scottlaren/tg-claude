import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { startStack, pairCodeIn, until, sleep, type Stack } from './support/stack.ts'

// Agents that follow each other, and an agent that goes round in circles

describe('a team', () => {
  let s: Stack
  let head = 0
  let zone = ''
  const inHead = () => ({ thread: head })
  const prompts = () => s.journal().filter(j => j.kind === 'turn').map(j => String(j.prompt))
  const startAgent = (input: Record<string, unknown>) => ({ tool: 'mcp__team__start_agent', input: { model: 'sonnet', effort: 'low', ...input } })

  before(async () => {
    s = await startStack({ language: 'en', config: { worktreeCheckMs: 0 } })
    await s.startServer()
    const t = Date.now()
    s.send('/pair')
    const m = await s.reply(/install\//, { after: t })
    zone = (await s.pairAgent('E2E-PC', pairCodeIn(m)!, [], { gitProjects: ['game'] })).zone
    await sleep(300)
    s.send('/topic Head')
    const picker = await until('a picker', () => s.tg.sent.find(x => x.thread && x.buttons.flat().some(b => b.text === 'game')))
    head = picker.thread!
    await s.tap(picker, /^game$/)
    await s.reply(/game/, { thread: head })
    const c = Date.now()
    s.send('/mode', inHead())
    const card = await until('the mode card', () => s.tg.sent.find(x => x.touched >= c && x.thread === head && x.buttons.flat().some(b => b.data === 'm:all')))
    await s.tap(card, 'm:all')
  })
  after(() => s?.stop())

  test('B starts when A has finished, with its report, on a branch that has its commits', async () => {
    const a = s.script([
      { wait: 'a-go' },
      { tool: 'mcp__device__run_command', input: { command: 'git -c user.name=t -c user.email=t@t commit -q --allow-empty -m "from agent A"' } },
      { text: 'A found the answer: forty-two' },
    ])
    const b = s.script([{ tool: 'mcp__device__run_command', input: { command: 'git log --format=%s' } }, { text: 'B done' }])
    const t = Date.now()
    s.send(`go ${s.script([
      startAgent({ name: 'A', task: `First. ${a}`, branch: 'first' }),
      startAgent({ name: 'B', task: `Second. ${b}`, branch: 'second', after: 'A' }),
      { text: 'team set up E2E' },
    ])}`, inHead())
    await s.reply(/team set up E2E/, { thread: head, after: t })
    assert.ok(![...s.tg.topics.get(777001)?.values() ?? []].some(x => x.name === '🤖 B'), 'B has no topic yet')

    s.flag('a-go')
    await until('B to start', () => prompts().some(p => /Second\./.test(p)))
    const task = prompts().find(p => /Second\./.test(p))!
    assert.match(task, /Report of the agent “A”/)
    assert.match(task, /forty-two/)
    await until('B to look at the log', () => s.journal().some(j => j.kind === 'tool' && j.at >= t && /from agent A/.test(String(j.text))))
    const branch = execFileSync('git', ['-C', join(zone, 'game-wt', 'second'), 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
    assert.equal(branch, 'agent/second')
  })

  test('the head\'s correction to a busy agent goes into its work at once: ⚡, then 🫡, and no second turn', async () => {
    const c = s.script([
      { wait: 'c-go' },
      { tool: 'mcp__device__run_command', input: { command: 'echo step' } },
      { tool: 'mcp__device__list_files', input: {} },
      { text: 'C done E2E' },
    ])
    let t = Date.now()
    s.send(`go ${s.script([startAgent({ name: 'Fix', task: `Third. ${c}` }), { text: 'C started E2E' }])}`, inHead())
    await s.reply(/C started E2E/, { thread: head, after: t })
    await until('C to start', () => prompts().some(p => /Third\./.test(p)))
    t = Date.now()
    s.send(`go ${s.script([{ tool: 'mcp__team__message_agent', input: { agent: 'Fix', text: 'narrow it E2E', now: true } }, { text: 'told C E2E' }])}`, inHead())
    await s.reply(/told C E2E/, { thread: head, after: t })
    const shown = await until('the correction in C\'s topic', () => s.tg.sent.find(m => m.at >= t && m.thread !== head && /narrow it E2E/.test(m.text)))
    await until('⚡ on it', () => s.tg.reactionsOf(shown.chat.id, shown.message_id).includes('⚡'))
    s.flag('c-go')
    await until('C to get it inside its turn', () => s.journal().some(j => j.kind === 'handin' && j.at >= t && /narrow it E2E/.test(j.prompt)), 15_000)
    await until('🫡', () => s.tg.reactionsOf(shown.chat.id, shown.message_id).includes('🫡'), 8000)
    await s.reply(/C done E2E/, { thread: shown.thread, after: t })
    await sleep(2500)
    assert.ok(!s.journal().some(j => j.kind === 'turn' && j.at >= t && /narrow it E2E/.test(j.prompt)), 'no second turn for it')
    // The next tests count on a quiet head and no other agents
    await until('the head to read its report', () => prompts().some(p => /Report from agent “Fix”/.test(p)), 15_000)
    await until('the head to go idle', async () => {
      const c = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__team__remove_agent', input: { agent: 'Fix' } }, { text: 'Fix removed E2E' }])}`, inHead())
      return !!(await s.reply(/Fix removed E2E/, { thread: head, after: c }))
    }, 30_000, 1000)
  })

  test('if the first fails, the next doesn\'t start, nor the one after it, and the head hears of it', async () => {
    const t = Date.now()
    s.send(`go ${s.script([
      startAgent({ name: 'C', task: `Fails. ${s.script([{ throw: 'Claude Code process exited with code 1' }])}` }),
      startAgent({ name: 'D', task: 'Must not run D', after: 'C' }),
      startAgent({ name: 'E', task: 'Must not run E', after: 'D' }),
      { text: 'second team E2E' },
    ])}`, inHead())
    await s.reply(/second team E2E/, { thread: head, after: t })
    await s.reply(/did not start/, { thread: head, after: t })
    await until('the head to be told', () => prompts().some(p => /\[Not started: D, E\./.test(p)))
    await sleep(500)
    assert.ok(!prompts().some(p => /Must not run/.test(p)))
  })

  test('a checklist: in the live status while it runs, then in the answer; no message of its own', async () => {
    const steps = (a: string, b: string) => ({ tool: 'mcp__checklist__set_checklist', input: { steps: [{ text: 'read it', state: a }, { text: 'change it', state: b }] } })
    const t = Date.now()
    s.send(`go ${s.script([steps('now', 'todo'), { mark: 'list-1' }, { wait: 'list-go' }, steps('done', 'done'), { text: 'list over E2E' }])}`, inHead())
    await until('the plan in the live status', () => s.tg.calls.some(c => c.at >= t && /Draft/.test(c.method) && /^<details><summary>📋 Plan · 0\/2 · read it<\/summary>\s*<tg-emoji emoji-id="5879893730978173215">⚪️<\/tg-emoji> \*\*read it\*\* {2}\n<tg-emoji emoji-id="5877409148232011610">➕<\/tg-emoji> change it {2}\s*<\/details>[\s\S]*<tg-thinking>/.test(JSON.parse(JSON.stringify(c.payload)).rich_message?.markdown ?? JSON.stringify(c.payload))))
    s.flag('list-go')
    const answer = await s.reply(/list over E2E/, { thread: head, after: t })
    assert.match(answer.text, /Plan · 2\/2/)
    assert.doesNotMatch(answer.text, /interrupted/)
    assert.ok(!s.tg.sent.some(m => m.at >= t && m.message_id !== answer.message_id && /read it/.test(m.text)), 'no message of its own')
  })

  test('a correction made twice: written into CLAUDE.md on a tap, and nothing is asked about the file after', async () => {
    let t = Date.now()
    s.send(`again ${s.script([{ tool: 'mcp__rules__suggest_rule', input: { rule: 'Answers in Russian, short', why: 'long answers' } }, { text: 'offered E2E' }])}`, inHead())
    const card = await s.reply(/Make it a rule/, { thread: head, after: t })
    await s.reply(/offered E2E/, { thread: head, after: t })
    await s.tap(card, 'rul:y:' + card.buttons.flat().find(b => b.data?.startsWith('rul:y:'))!.data!.slice(6))
    await until('written', () => !/Make it a rule/.test(s.tg.sent.find(m => m.message_id === card.message_id)!.text))
    assert.match(s.tg.sent.find(m => m.message_id === card.message_id)!.text, /Written into the project/)
    const { readFileSync } = await import('node:fs')
    assert.match(readFileSync(join(zone, 'game', 'CLAUDE.md'), 'utf8'), /## Rules from corrections\r?\n\r?\n- Answers in Russian, short/)
    t = Date.now()
    s.send(`next ${s.script([{ text: 'after the rule E2E' }])}`, inHead())
    await s.reply(/after the rule E2E/, { thread: head, after: t })
    assert.ok(!s.tg.sent.some(m => m.touched >= t && /New `CLAUDE\.md`/.test(m.text)), 'no card about its own change')
  })

  test('a merged worktree with nothing uncommitted: a card offers to remove it, and an agent\'s own stays', async () => {
    const repo = join(zone, 'game')
    const wt = join(zone, 'game-wt', 'done')
    // The fixture's line ends would look like a change on Windows
    execFileSync('git', ['-C', repo, 'config', 'core.autocrlf', 'false'])
    // A submodule, which git won't remove a worktree with on its own
    const lib = join(zone, 'lib')
    execFileSync('git', ['init', '-q', lib])
    execFileSync('git', ['-C', lib, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'lib'])
    execFileSync('git', ['-C', repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'lib'])
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'a submodule'])
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'agent/done', wt])
    execFileSync('git', ['-C', wt, '-c', 'protocol.file.allow=always', 'submodule', 'update', '-q', '--init'])
    const t = Date.now()
    s.send(`look ${s.script([{ text: 'looked E2E' }])}`, inHead())
    const card = await s.reply(/Merged, with nothing uncommitted/, { thread: head, after: t })
    assert.match(card.text, /done/)
    assert.doesNotMatch(card.text, /second|first/, 'agents still at work keep theirs')
    await s.tap(card, card.buttons.flat().find(b => b.data?.startsWith('wtc:del:'))!.data!)
    await until('removed', () => /Removed: done/.test(s.tg.sent.find(m => m.message_id === card.message_id)!.text))
    const { existsSync } = await import('node:fs')
    assert.equal(existsSync(wt), false)
    const branches = execFileSync('git', ['-C', repo, 'branch', '--list', 'agent/done'], { encoding: 'utf8' })
    assert.equal(branches.trim(), '')
  })

  test('a checklist cut off says so, and a task stuck in an ordinary topic is told to the user, with a way to stop it', async () => {
    const steps = { tool: 'mcp__checklist__set_checklist', input: { steps: [{ text: 'step one', state: 'now' }, { text: 'step two', state: 'todo' }] } }
    const failing = { tool: 'mcp__device__run_command', input: { command: 'echo boom >&2; exit 3' } }
    const t = Date.now()
    s.send(`go ${s.script([steps, failing, failing, failing, { wait: 'never-comes' }])}`, inHead())
    const stuck = await s.reply(/The task may be stuck/, { thread: head, after: t })
    await s.tap(stuck, 'stk:stop')
    const answer = await s.reply(/Plan · 0\/2 · .*interrupted/, { thread: head, after: t })
    assert.match(answer.text, /step one/)
  })

  test('an agent that runs into the limit: its head hears of it at once, not after the reset', async () => {
    const spent = { limit: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 3600, rateLimitType: 'seven_day' } }
    const t = Date.now()
    s.send(`go ${s.script([
      startAgent({ name: 'Spent', task: `Big. ${s.script([spent, { errorKind: 'rate_limit', text: 'limit' }])}` }),
      { text: 'spent started E2E' },
    ])}`, inHead())
    await s.reply(/spent started E2E/, { thread: head, after: t })
    await s.reply(/Agent .*Spent.* ran into the limit/, { thread: head, after: t })
    await until('the head to be told', () => prompts().some(p => /\[Agent “Spent” ran into the usage limit/.test(p)))
    assert.ok(!prompts().some(p => /\[Report from agent “Spent”/.test(p)), 'no report: it isn\'t done')
  })

  test('an agent going round in circles: the head hears of it while it is running', async () => {
    const failing = { tool: 'mcp__device__run_command', input: { command: 'echo boom >&2; exit 3' } }
    const t = Date.now()
    s.send(`go ${s.script([
      startAgent({ name: 'Loop', task: `Loop. ${s.script([failing, failing, failing, { mark: 'loop-said' }, { wait: 'loop-go' }, { text: 'loop over' }])}` }),
      { text: 'loop started E2E' },
    ])}`, inHead())
    await s.reply(/loop started E2E/, { thread: head, after: t })
    await s.reply(/may be stuck/, { thread: head, after: t })
    await until('the head to be told', () => prompts().some(p => /“Loop” may be stuck: the same error 3 times/.test(p)))
    assert.ok(s.flagged('loop-said'))
    s.flag('loop-go')
  })
})
