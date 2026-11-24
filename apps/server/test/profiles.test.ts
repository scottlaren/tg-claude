import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, lstatSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProfiles } from '../src/profiles.ts'
import { usageMarkdown, inTime, bar, maskEmail, planLabel } from '../src/telegram/usage.ts'
import { plainEmoji } from '../src/telegram/emoji.ts'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'tgcv-profiles-'))
  for (const d of ['main', 'work', 'zz-2', 'bad name']) mkdirSync(join(root, d))
  return { root, p: createProfiles({ defaultDir: join(root, 'main'), cwd: tmpdir(), baseEnv: {} }) }
}

test('profiles are the folders next to the default one, default first; odd names are ignored', () => {
  const { root, p } = setup()
  assert.deepEqual(p.list(), ['main', 'work', 'zz-2'])
  assert.equal(p.nameOf(undefined), 'main')
  assert.equal(p.nameOf('../etc'), 'main')
  assert.equal(p.env('work').CLAUDE_CONFIG_DIR, join(root, 'work'))
})

test('a conversation moves to another profile with its side files; nothing to move means a new session', () => {
  const { root, p } = setup()
  const folder = join(root, 'main', 'projects', 'C--Users-admin--tg-claude-vps-claude-cwd')
  mkdirSync(join(folder, 'abc', 'tool-results'), { recursive: true })
  writeFileSync(join(folder, 'abc.jsonl'), '{"type":"user"}\n')
  writeFileSync(join(folder, 'abc', 'tool-results', 'big.txt'), 'output')
  assert.equal(p.carry('abc', 'main', 'work'), true)
  const moved = join(root, 'work', 'projects', 'C--Users-admin--tg-claude-vps-claude-cwd')
  assert.equal(readFileSync(join(moved, 'abc.jsonl'), 'utf8'), '{"type":"user"}\n')
  assert.ok(existsSync(join(moved, 'abc', 'tool-results', 'big.txt')))
  assert.equal(p.carry('missing', 'main', 'work'), false)
  assert.equal(p.carry('abc', 'zz-2', 'work'), false)
})

test('limits read at a glance', () => {
  assert.equal(inTime(12 * 60_000), 'in 12 min')
  assert.equal(inTime(130 * 60_000), 'in 2 h 10 min')
  assert.equal(inTime(5 * 24 * 3600_000), 'in 5 days')
  assert.equal(bar(32), '▓▓▓░░░░░░░')
  assert.equal(maskEmail('abc123xyz0@privaterelay.appleid.com'), 'a…@p….com')
  const now = Date.parse('2026-10-29T15:00:00Z')
  const md = usageMarkdown('main', {
    status: { loggedIn: true, plan: 'max' }, isDefault: true, now,
    usage: { plan: 'max', fiveHour: { utilization: 32, resetsAt: '2026-10-29T17:10:00Z' }, sevenDay: { utilization: 22, resetsAt: '2026-11-04T13:00:00Z' }, models: [] },
  })
  assert.ok(md.startsWith('### main · default\n\nMax'))
  // A table: Telegram would glue plain lines into one paragraph
  assert.ok(plainEmoji(md).includes('| 5 hours | ▓▓▓░░░░░░░ 32% | in 2 h 10 min |'))
  assert.ok(plainEmoji(md).includes('| Week | ▓▓░░░░░░░░ 22% | in 6 days |'))
})

test('no live numbers: what the last task saw, or plainly no data; signed out says how to sign in', () => {
  const now = Date.parse('2026-10-29T15:00:00Z')
  const last = { status: 'rejected' as const, resetsAt: now / 1000 + 3600, at: now }
  assert.ok(plainEmoji(usageMarkdown('work', { status: { loggedIn: true }, usage: null, last, isDefault: false, now })).includes('⛔ limit reached · resets in 1 h'))
  assert.ok(usageMarkdown('work', { status: { loggedIn: true }, usage: null, isDefault: false, now }).endsWith('no data'))
  assert.ok(usageMarkdown('work', { status: { loggedIn: false }, usage: null, isDefault: false, now }).includes('npm run login -- --profile work'))
})

test('conversations no topic points at and quiet for a week are swept; ones in use or fresh stay', () => {
  const { root, p } = setup()
  const folder = join(root, 'main', 'projects', 'cwd')
  mkdirSync(join(folder, 'old-orphan'), { recursive: true })
  for (const id of ['old-orphan', 'old-in-use', 'new-orphan']) writeFileSync(join(folder, `${id}.jsonl`), '{}\n')
  const week = 7 * 24 * 3600_000
  const old = (Date.now() - week - 60_000) / 1000
  for (const id of ['old-orphan', 'old-in-use']) utimesSync(join(folder, `${id}.jsonl`), old, old)
  assert.equal(p.sweepSessions(new Set(['old-in-use']), week), 1)
  assert.deepEqual(['old-orphan', 'old-in-use', 'new-orphan'].map(id => existsSync(join(folder, `${id}.jsonl`))), [false, true, true])
  assert.equal(existsSync(join(folder, 'old-orphan')), false)
})

test('every plan on Anthropic\'s pricing page has its name', () => {
  assert.equal(planLabel('ultra'), 'Ultra')
  assert.equal(planLabel('Claude Ultra'), 'Ultra', 'as the account says it')
  assert.equal(planLabel('Claude Something'), 'Something')
  assert.equal(planLabel('max'), 'Max')
  assert.equal(planLabel('free'), 'Free')
  assert.equal(planLabel('something_new'), 'something_new', 'a name not known yet shows as it came')
})

test('the plan comes from the account, is kept for a while, and a failed answer is asked again', async () => {
  let clock = 1000
  let asked = 0
  let answer: string | undefined
  const p = createProfiles({ defaultDir: join(mkdtempSync(join(tmpdir(), 'tgcv-plan-')), 'main'), cwd: tmpdir(), baseEnv: {}, now: () => clock, askPlan: async (_cwd, env) => {
    asked++
    assert.match(String(env.CLAUDE_CONFIG_DIR), /main$/, 'the account of that profile')
    return answer
  } })
  assert.equal(await p.accountPlan('main'), undefined)
  answer = 'Claude Ultra'
  assert.equal(await p.accountPlan('main'), 'Claude Ultra')
  assert.equal(await p.accountPlan('main'), 'Claude Ultra')
  assert.equal(asked, 2, 'kept')
  clock += 7 * 3600_000
  await p.accountPlan('main')
  assert.equal(asked, 3, 'a plan can change')
  p.forget('main')
  await p.accountPlan('main')
  assert.equal(asked, 4, 'a new sign-in may be another account')
})

test('every profile shares the default one\'s memory of the user: notes it kept move over, none overwritten, and it links once', () => {
  const root = mkdtempSync(join(tmpdir(), 'tgcv-mem-'))
  try {
    const p = createProfiles({ defaultDir: join(root, 'main'), cwd: root, baseEnv: {} })
    const mem = (name: string) => join(root, name, 'projects', '-home-node-claude-cwd', 'memory')
    mkdirSync(mem('main'), { recursive: true })
    writeFileSync(join(mem('main'), 'user.md'), 'main knows')
    mkdirSync(mem('work'), { recursive: true })
    writeFileSync(join(mem('work'), 'user.md'), 'work knew')
    writeFileSync(join(mem('work'), 'project.md'), 'only work knew')
    p.shareMemory('work', '/home/node/claude-cwd')
    assert.ok(lstatSync(mem('work')).isSymbolicLink())
    assert.equal(readFileSync(join(mem('main'), 'user.md'), 'utf8'), 'main knows', 'nothing overwritten')
    assert.equal(readFileSync(join(mem('work'), 'project.md'), 'utf8'), 'only work knew', 'moved over, seen from both')
    writeFileSync(join(mem('work'), 'new.md'), 'x')
    assert.ok(existsSync(join(mem('main'), 'new.md')), 'one folder')
    p.shareMemory('work', '/home/node/claude-cwd')
    p.shareMemory('main', '/home/node/claude-cwd')
    assert.ok(!lstatSync(mem('main')).isSymbolicLink())
    // A profile that never kept any gets the link straight away
    p.shareMemory('alt', '/home/node/claude-cwd')
    assert.equal(readFileSync(join(mem('alt'), 'user.md'), 'utf8'), 'main knows')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
