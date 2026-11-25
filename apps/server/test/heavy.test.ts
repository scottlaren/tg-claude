import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandKey, createHeavyStore, isHeavy, wouldTake } from '../src/telegram/heavy.ts'
import { computerLine, heavyBlock } from '../src/claude/prompt.ts'

const PC = { name: 'PC', cores: 28 }

test('the same command with other numbers is the same command', () => {
  assert.equal(commandKey({ command: 'lune  run tools/soak/one 1301 hider 8 1' }), 'lune run tools/soak/one # hider # #')
  assert.equal(commandKey({ program: 'lune', args: ['run', 'tests', '--child', 'cans'] }), 'lune run tests --child cans')
  assert.equal(commandKey({ command: 'x'.repeat(300) }).length, 120)
})

test('heavy is much processor time over more than a moment', () => {
  assert.equal(isHeavy({ durationMs: 120_000, coreSec: 2000 }), true)
  assert.equal(isHeavy({ durationMs: 10_000, coreSec: 2000 }), false, 'a burst')
  assert.equal(isHeavy({ durationMs: 600_000, coreSec: 40 }), false, 'long, and waiting most of it')
  assert.equal(isHeavy({ durationMs: 600_000 }), false, 'an agent too old to measure')
})

test('with fewer cores the same work takes as much longer; with more, no less than it did', () => {
  const h = { wallSec: 120, coreSec: 2880 }
  assert.equal(wouldTake(h, 4), 720)
  assert.equal(wouldTake(h, 28), 120)
  assert.equal(wouldTake(h, 64), 120)
  assert.equal(wouldTake({ wallSec: 300, coreSec: 300 }, 4), 300, 'one core\'s work is no slower on four')
})

test('heavy commands are remembered by repository, the heaviest first, and forgotten after a month', () => {
  let at = 1_000_000
  const file = join(mkdtempSync(join(tmpdir(), 'tgcv-heavy-')), 'heavy.json')
  const store = createHeavyStore(file, () => at)
  assert.equal(store.note('pc:game', PC, { command: 'npm test' }, { durationMs: 20_000, coreSec: 30 }), false)
  assert.equal(store.note('pc:game', PC, { command: 'lune run tests' }, { durationMs: 120_000, coreSec: 2880 }), true)
  assert.equal(store.note('pc:game', PC, { command: 'lune run tools/soak/one 7 hider' }, { durationMs: 900_000, coreSec: 20_000 }), true)
  assert.equal(store.note('pc:game', PC, { command: 'lune run tools/soak/one 9 hider' }, { durationMs: 800_000, coreSec: 18_000 }), true)
  assert.equal(store.note('pc:game', PC, { command: 'lune run sweep' }, { durationMs: 900_000, coreSec: 20_000, cancelled: true }), false, 'stopped half way: no measure of it')
  assert.equal(store.note('pc:game', { name: 'Old' }, { command: 'lune run sweep' }, { durationMs: 900_000, coreSec: 20_000 }), false, 'a computer of unknown size')
  assert.deepEqual(store.top('pc:game').map(h => [h.cmd, h.wallSec, h.coreSec, h.runs]), [
    ['lune run tools/soak/one # hider', 800, 18_000, 2],
    ['lune run tests', 120, 2880, 1],
  ])
  assert.deepEqual(store.top('pc:other'), [])
  assert.equal(createHeavyStore(file, () => at).top('pc:game').length, 2, 'kept over a restart')
  at += 31 * 86400_000
  assert.deepEqual(store.top('pc:game'), [])
})

test('a computer in a line: what it has, how busy, and whether someone is at it', () => {
  const now = 1_000_000
  assert.equal(computerLine({ name: 'PC', cores: 28, memGb: 64, load: { busy: 95, idleSec: 20, at: now } }, now), 'PC: 28 cores, 64 GB, 95% busy, the user is at it')
  assert.equal(computerLine({ name: 'Cloud', cores: 4, memGb: 6, load: { busy: 3, at: now } }, now), 'Cloud: 4 cores, 6 GB, 3% busy')
  assert.equal(computerLine({ name: 'Mac', cores: 14, memGb: 48, load: { busy: 1, idleSec: 5400, at: now } }, now), 'Mac: 14 cores, 48 GB, 1% busy, nobody at it for 90 min')
  assert.equal(computerLine({ name: 'Mac', cores: 14, load: { busy: 80, idleSec: 5, at: now - 3600_000 } }, now), 'Mac: 14 cores', 'what it said an hour ago says nothing of now')
  assert.equal(computerLine({ name: 'Old' }, now), 'Old: size not known')
})

test('the computers are always said when there is more than one; the rule and the figures when there is a choice to make', () => {
  const now = 1_000_000
  const pc = (busy: number) => ({ name: 'PC', cores: 28, memGb: 64, load: { busy, idleSec: 10, at: now } })
  const cloud = { name: 'Cloud', cores: 4, memGb: 6, load: { busy: 2, at: now } }
  const heavy = [{ cmd: 'lune run tests', wallSec: 120, coreSec: 2880, device: 'PC', cores: 28 }]
  assert.equal(heavyBlock(pc(95), [], heavy, true, now), '', 'nowhere else to go')
  assert.equal(heavyBlock(pc(20), [cloud], [], true, now), '\n\n# Computers\nComputers now: PC: 28 cores, 64 GB, 20% busy, the user is at it. Cloud: 4 cores, 6 GB, 2% busy.', 'nothing heavy known, and room here: what there is, no rule')
  assert.match(heavyBlock(pc(60), [cloud], [], true, now), /# Where heavy work runs/, 'half busy is busy')
  const block = heavyBlock(pc(20), [cloud], heavy, true, now)
  assert.match(block, /# Where heavy work runs/)
  assert.match(block, /Computers now: PC: 28 cores, 64 GB, 20% busy, the user is at it\. Cloud: 4 cores, 6 GB, 2% busy\./)
  assert.match(block, /- `lune run tests`: 2 min on PC, using about 24 of its 28 cores; about 12 min on Cloud/)
  assert.match(block, /sync_branch brings this project and its branch/)
  const busy = heavyBlock(pc(95), [cloud], [], false, now)
  assert.match(busy, /95% busy/)
  assert.doesNotMatch(busy, /Measured in this project|sync_branch/)
})

test('a disk is low with a tenth or ten gigabytes left; one that can\'t be read is not called low', async () => {
  const { diskLow } = await import('../src/diag.ts')
  const GB = 1024 ** 3
  assert.equal(diskLow({ free: 150 * GB, total: 222 * GB }), false)
  assert.equal(diskLow({ free: 20 * GB, total: 222 * GB }), true, 'under a tenth')
  assert.equal(diskLow({ free: 9 * GB, total: 40 * GB }), true, 'under ten gigabytes')
  assert.equal(diskLow({ free: 12 * GB, total: 40 * GB }), false)
  assert.equal(diskLow(null), false)
})

test('an agent is told what its own computer has; in the cloud, that the system\'s tools show the whole server', async () => {
  const { ownComputerBlock } = await import('../src/claude/prompt.ts')
  const now = 1_000_000
  assert.equal(ownComputerBlock({ name: 'Cloud', cores: 4, memGb: 6, load: { busy: 35, at: now } }, true, now),
    '\n\n# This computer\nCloud: 4 cores, 6 GB, 35% busy. It is a container: nproc and free show the whole server, these figures are what it may use.')
  assert.equal(ownComputerBlock({ name: 'PC', cores: 28, memGb: 128 }, false, now), '\n\n# This computer\nPC: 28 cores, 128 GB.')
  assert.equal(ownComputerBlock({ name: 'Old' }, false, now), '', 'an agent too old to say: nothing')
})
