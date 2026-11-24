import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpEvent, OpTool, Project } from '@tgcv/protocol'
import { createExecutor } from '../../agent/src/executor.ts'
import { createWorkspace } from '../../agent/src/workspace.ts'
import { createProjectCopy } from '../src/telegram/project-copy.ts'

// Two real agents on two temporary folders, with real files and tar: what /computer and copy_files send, end to end. The
// only thing left out is the network between the server and a computer

function computer(id: string, name: string, projects: string[]) {
  const base = mkdtempSync(join(tmpdir(), `tgcv-copy-${id}-`))
  const zone = join(base, 'zone')
  mkdirSync(zone)
  for (const p of projects) mkdirSync(join(zone, p))
  const workspace = createWorkspace({ projects: [], zones: [{ path: zone }], stateFile: join(base, 'state.json'), selfDir: join(base, 'agent') })
  const executor = createExecutor({ workspace, shell: 'bash', log: () => {} })
  return { id, name, zone, executor, workspace, shell: 'bash', projects: workspace.list() as Project[] }
}

function network(...devices: ReturnType<typeof computer>[]) {
  let n = 0
  const device = (id: string) => devices.find(d => d.id === id)
  const gateway = {
    device: device as never,
    devices: () => devices as never,
    refreshProjects: async (id: string) => {
      const d = device(id)!
      d.projects = d.workspace.list() as Project[]
      return d.projects
    },
    request: async (id: string, op: { projectId: string, bindingVersion: number, tool: OpTool, params: Record<string, unknown> }) => {
      const events: OpEvent[] = []
      await device(id)!.executor.handle({ type: 'op.request', opId: `op-${n++}`, ...op, deadline: Date.now() + 120_000 } as never, (e: OpEvent) => events.push(e))
      const last = events.at(-1)!
      return last.error ? { ok: false, error: last.error } : { ok: true, result: last.result }
    },
  }
  return createProjectCopy({ gateway: gateway as never, log: { info: () => {}, warn: () => {} } as never, isCloud: () => false })
}

const here = (d: ReturnType<typeof computer>, project: string) => ({ deviceId: d.id, projectId: d.workspace.list().find(p => p.name === project)!.id, bindingVersion: 0 })
const status = async () => {}

test('a whole project gets to the other computer, without dependencies and without the archive', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const mac = computer('mac', 'Mac', [])
  const root = join(pc.zone, 'game')
  mkdirSync(join(root, 'node_modules', 'x'), { recursive: true })
  mkdirSync(join(root, '.git'))
  mkdirSync(join(root, 'папка'))
  writeFileSync(join(root, 'a.txt'), 'a')
  writeFileSync(join(root, '.git', 'HEAD'), 'ref')
  writeFileSync(join(root, 'папка', 'файл.txt'), 'б')
  writeFileSync(join(root, 'node_modules', 'x', 'y'), 'no')

  const { copyProject } = network(pc, mac)
  const source = pc.workspace.list().find(p => p.name === 'game') as Project
  const { project } = await copyProject({ fromId: 'pc', source, bindingVersion: 0, targetId: 'mac', names: ['game'], changed: 'changed', status })
  assert.equal(project.id, source.id, 'the same folder name is the same project: the conversation goes on')

  const there = join(mac.zone, 'game')
  assert.equal(readFileSync(join(there, 'a.txt'), 'utf8'), 'a')
  assert.equal(readFileSync(join(there, '.git', 'HEAD'), 'utf8'), 'ref')
  assert.equal(readFileSync(join(there, 'папка', 'файл.txt'), 'utf8'), 'б')
  assert.equal(existsSync(join(there, 'node_modules')), false)
  assert.equal(existsSync(join(there, '.tgcv-move.tar.gz')), false)
  assert.equal(existsSync(join(root, '.tgcv-move.tar.gz')), false, 'nor left on the computer it came from')
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'a', 'a copy: the original stays')
})

test('a project does not land in a folder that is already there', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const mac = computer('mac', 'Mac', ['game'])
  writeFileSync(join(pc.zone, 'game', 'a.txt'), 'new')
  writeFileSync(join(mac.zone, 'game', 'a.txt'), 'theirs')
  const { copyProject } = network(pc, mac)
  const source = pc.workspace.list().find(p => p.name === 'game') as Project
  await assert.rejects(copyProject({ fromId: 'pc', source, bindingVersion: 0, targetId: 'mac', names: ['game'], changed: 'changed', status }), /game/)
  assert.equal(readFileSync(join(mac.zone, 'game', 'a.txt'), 'utf8'), 'theirs')
  assert.equal(existsSync(join(pc.zone, 'game', '.tgcv-move.tar.gz')), false)
})

test('Claude sends a file and fetches one back, and neither replaces what is there', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const mac = computer('mac', 'Mac', ['game'])
  writeFileSync(join(pc.zone, 'game', 'logo.png'), 'png')
  writeFileSync(join(mac.zone, 'game', 'render.mp4'), 'mp4')
  const { copyFiles } = network(pc, mac)
  const t = here(pc, 'game')

  assert.match(await copyFiles('k', t, { direction: 'send', computer: 'Mac', path: 'logo.png' }), /^Copied PC:logo\.png → Mac:logo\.png/)
  assert.equal(readFileSync(join(mac.zone, 'game', 'logo.png'), 'utf8'), 'png')
  assert.match(await copyFiles('k', t, { direction: 'fetch', computer: 'mac', path: 'render.mp4', to: 'out/render.mp4' }), /^Copied Mac:render\.mp4 → PC:out\/render\.mp4/)
  assert.equal(readFileSync(join(pc.zone, 'game', 'out', 'render.mp4'), 'utf8'), 'mp4')

  writeFileSync(join(pc.zone, 'game', 'logo.png'), 'changed')
  assert.match(await copyFiles('k', t, { direction: 'send', computer: 'Mac', path: 'logo.png' }), /^Not copied: .*already exists/)
  assert.equal(readFileSync(join(mac.zone, 'game', 'logo.png'), 'utf8'), 'png')
})

test('Claude copies a folder only into a new one, and cleans up after itself on both sides', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const mac = computer('mac', 'Mac', ['game'])
  const assets = join(pc.zone, 'game', 'assets')
  mkdirSync(join(assets, 'node_modules'), { recursive: true })
  mkdirSync(join(assets, 'sub'))
  writeFileSync(join(assets, 'a.png'), 'a')
  writeFileSync(join(assets, 'sub', 'b.png'), 'b')
  writeFileSync(join(assets, 'node_modules', 'no'), 'no')
  const { copyFiles } = network(pc, mac)
  const t = here(pc, 'game')

  assert.match(await copyFiles('k', t, { direction: 'send', computer: 'Mac', path: 'assets' }), /^Copied/)
  const there = join(mac.zone, 'game', 'assets')
  assert.equal(readFileSync(join(there, 'sub', 'b.png'), 'utf8'), 'b')
  assert.equal(existsSync(join(there, 'node_modules')), false)
  assert.deepEqual(readdirSync(there).sort(), ['a.png', 'sub'])
  assert.deepEqual(readdirSync(assets).sort(), ['a.png', 'node_modules', 'sub'])

  writeFileSync(join(there, 'a.png'), 'theirs')
  assert.match(await copyFiles('k', t, { direction: 'send', computer: 'Mac', path: 'assets' }), /already exists/)
  assert.equal(readFileSync(join(there, 'a.png'), 'utf8'), 'theirs')
  assert.match(await copyFiles('k', t, { direction: 'send', computer: 'Mac', path: 'assets', to: 'assets2' }), /^Copied/)
  assert.equal(readFileSync(join(mac.zone, 'game', 'assets2', 'a.png'), 'utf8'), 'a')
})

test('Stop reaches a transfer', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const mac = computer('mac', 'Mac', ['game'])
  writeFileSync(join(pc.zone, 'game', 'big.bin'), 'x')
  const { copyFiles } = network(pc, mac)
  const stop = new AbortController()
  stop.abort()
  assert.match(await copyFiles('k', here(pc, 'game'), { direction: 'send', computer: 'Mac', path: 'big.bin' }, stop.signal), /^Not copied/)
  assert.equal(existsSync(join(mac.zone, 'game', 'big.bin')), false)
})

test('nothing leaves the project: paths outside it are refused on both sides', async () => {
  const pc = computer('pc', 'PC', ['game', 'other'])
  const mac = computer('mac', 'Mac', ['game'])
  writeFileSync(join(pc.zone, 'secret.txt'), 'secret')
  writeFileSync(join(pc.zone, 'other', 'neighbour.txt'), 'n')
  writeFileSync(join(pc.zone, 'game', 'a.txt'), 'a')
  const { copyFiles } = network(pc, mac)
  const t = here(pc, 'game')
  assert.match(await copyFiles('k', t, { direction: 'send', computer: 'Mac', path: '../secret.txt', to: 'stolen.txt' }), /^Not copied/)
  assert.equal(existsSync(join(mac.zone, 'game', 'stolen.txt')), false)
  assert.match(await copyFiles('k', t, { direction: 'send', computer: 'Mac', path: '../other', to: 'stolen' }), /^Not copied/)
  assert.equal(existsSync(join(mac.zone, 'game', 'stolen')), false)
  assert.match(await copyFiles('k', t, { direction: 'send', computer: 'Mac', path: 'a.txt', to: '../../escaped.txt' }), /^Not copied/)
  assert.equal(existsSync(join(mac.zone, '..', 'escaped.txt')), false)
  assert.equal(existsSync(join(mac.zone, 'escaped.txt')), false)
})

test('a computer or project that is not there is said plainly, with what there is', async () => {
  const pc = computer('pc', 'PC', ['game'])
  const mac = computer('mac', 'Mac', ['other'])
  const { copyFiles } = network(pc, mac)
  const t = here(pc, 'game')
  assert.match(await copyFiles('k', t, { direction: 'send', computer: 'Mini', path: 'a' }), /No computer «Mini» online\. Online: Mac/)
  assert.match(await copyFiles('k', t, { direction: 'send', computer: 'Mac', path: 'a' }), /Mac has no project «game»\. Its projects: other/)
  assert.match(await copyFiles('k', { bindingVersion: 0 }, { direction: 'send', computer: 'Mac', path: 'a' }), /offline/)
})
