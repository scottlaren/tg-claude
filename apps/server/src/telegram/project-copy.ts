import { randomBytes } from 'node:crypto'
import { FILE_GET_MAX_BYTES, type OpTool, type Project } from '@tgcv/protocol'
import type { Gateway, OpOutcome } from '../gateway.ts'
import type { CopyFiles } from '../claude/topic-tools.ts'
import type { Log } from '../log.ts'
import { bytes } from '../diag.ts'
import { relayFile } from '../transfer.ts'
import { tr } from '../i18n.ts'
import { findComputer, onlyRootChanged, otherComputers } from './computers.ts'

// Files between two computers through the server. tar is on Windows 10+, macOS and Linux alike, and a folder travels as
// one archive of at most what a device hands out at all

export const MOVE_ARCHIVE = '.tgcv-move.tar.gz'
export const MOVE_MAX = FILE_GET_MAX_BYTES
// Dependencies are rebuilt on the computer: they are big and often tied to the platform
export const MOVE_SKIP = ['node_modules', '.venv', 'venv', '__pycache__']

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const placeOf = (d: { id: string, name: string }, cloud: boolean) => (cloud ? tr('in the cloud', 'в облаке') : tr(`on ${d.name}`, `на ${d.name}`))
const rmCommand = (shell: string, path: string) => (/powershell|pwsh/i.test(shell) ? `Remove-Item -Force ${path}` : `rm -f ${path}`)

type CopyGateway = Pick<Gateway, 'device' | 'devices' | 'request' | 'refreshProjects'>

export function createProjectCopy({ gateway, log, isCloud }: { gateway: CopyGateway, log: Log, isCloud: (id: string) => boolean }) {
  // A whole project to a new folder on another computer. The first of names that is free is the folder
  async function copyProject({ fromId, source, bindingVersion, targetId, names, changed, status }: {
    fromId: string, source: Project, bindingVersion: number, targetId: string, names: string[], changed: string, status: (html: string) => Promise<unknown>
  }) {
    const from = gateway.device(fromId)
    const target = gateway.device(targetId)
    if (!from) throw new Error(tr('the computer with the project went offline', 'компьютер с проектом отключился'))
    if (!target) throw new Error(tr('the computer went offline', 'компьютер отключился'))
    const fail = (out: OpOutcome) => {
      if (!out.ok) throw new Error(out.error.message)
      return out.result
    }
    const onSource = (tool: OpTool, params: Record<string, unknown>) =>
      gateway.request(fromId, { projectId: source.id, bindingVersion, tool, params })
    const run = async (op: Promise<OpOutcome>, what: string) => {
      const r = fail(await op) as { exitCode: number | null, stderr: string }
      if (what === 'pack' && r.exitCode === 1) {
        if (onlyRootChanged(r.stderr)) return
        // GNU tar says 1 when a file changed while it was read: the archive may miss the last changes
        throw new Error(changed)
      }
      if (r.exitCode !== 0) throw new Error(`${what}: ${r.stderr.trim().slice(-300) || tr(`code ${r.exitCode}`, `код ${r.exitCode}`)}`)
    }

    await status(tr(`📦 Packing <b>“${esc(source.name)}”</b> ${esc(placeOf(from, isCloud(fromId)))}…`, `📦 Упаковываю <b>«${esc(source.name)}»</b> ${esc(placeOf(from, isCloud(fromId)))}…`))
    const skip = [MOVE_ARCHIVE, ...MOVE_SKIP].map(s => `--exclude=${s}`)
    await run(onSource('run_command', { program: 'tar', args: ['-czf', MOVE_ARCHIVE, ...skip, '.'], timeoutSec: 900 }), 'pack')
    try {
      let project: Project | undefined
      for (const name of names) {
        const out = await gateway.request(targetId, { projectId: '', bindingVersion: 0, tool: 'create_project', params: { name } })
        if (out.ok) {
          project = out.result as Project
          break
        }
        if (out.error.code !== 'exists') throw new Error(out.error.message)
      }
      if (!project) throw new Error(tr(`${target.name} already has folders ${names.join(', ')}: rename them`, `на ${target.name} уже есть папки ${names.join(', ')}: переименуй их`))
      const onTarget = (tool: OpTool, params: Record<string, unknown>) =>
        gateway.request(targetId, { projectId: project.id, bindingVersion: 0, tool, params })

      let shown = 0
      const sent = await relayFile(p => onSource('file_get', p), p => onTarget('file_put', p), MOVE_ARCHIVE, MOVE_ARCHIVE, {
        maxBytes: MOVE_MAX,
        onProgress: (done, size) => {
          if (Date.now() - shown < 5000) return
          shown = Date.now()
          status(tr(`🚚 Carrying <b>“${esc(source.name)}”</b> to ${esc(target.name)}: ${bytes(done)} of ${bytes(size)}…`, `🚚 Передаю <b>«${esc(source.name)}»</b> на ${esc(target.name)}: ${bytes(done)} из ${bytes(size)}…`))
        },
      })
      if (!sent.ok) {
        throw new Error(sent.error.code === 'bad_request'
          ? tr(`the project's archive is over ${bytes(MOVE_MAX)}: carry it with git instead. Ask Claude to push it, then clone it on the computer`, `проект в архиве больше ${bytes(MOVE_MAX)}: перенеси его через git — попроси Claude запушить, а на компьютере склонируй`)
          : sent.error.message)
      }
      await status(tr(`📂 Unpacking on ${esc(target.name)}…`, `📂 Распаковываю на ${esc(target.name)}…`))
      await run(onTarget('run_command', { program: 'tar', args: ['-xzf', MOVE_ARCHIVE], timeoutSec: 900 }), 'unpack')
      // Deleting needs the computer's own shell
      await onTarget('run_command', { command: rmCommand(target.shell, MOVE_ARCHIVE), timeoutSec: 60 })
      await gateway.refreshProjects(targetId)
      return { project, size: sent.size }
    } finally {
      await onSource('run_command', { command: rmCommand(from.shell, MOVE_ARCHIVE), timeoutSec: 60 }).catch(() => {})
    }
  }

  // Claude's copy: a file goes as it is, a folder as an archive unpacked in a new folder. Neither can replace anything:
  // the receiver refuses a file that exists, and a folder must not exist yet
  async function copyFiles(key: string, t: { deviceId?: string, projectId?: string, bindingVersion: number }, p: CopyFiles, signal?: AbortSignal) {
    const here = t.deviceId ? gateway.device(t.deviceId) : undefined
    if (!here || !t.projectId) return "This topic's computer is offline."
    const others = otherComputers(gateway.devices(), t.deviceId, { cloud: false })
    const other = findComputer(others, p.computer)
    if (!other) return `No computer «${p.computer}» online. Online: ${others.map(o => o.name).join(', ') || 'none'}.`
    const wanted = p.project ?? here.projects.find(x => x.id === t.projectId)?.name ?? t.projectId
    const list = await gateway.refreshProjects(other.id)
    const there = list.find(x => x.id === wanted || x.name === wanted)
    if (!there) return `${other.name} has no project «${wanted}». Its projects: ${list.slice(0, 40).map(x => x.name).join(', ')}.`
    const sides = [
      { device: here, projectId: t.projectId, binding: t.bindingVersion },
      { device: other, projectId: there.id, binding: 0 },
    ]
    const [from, to] = p.direction === 'send' ? sides : [sides[1], sides[0]]
    const on = (s: typeof from) => (tool: OpTool, params: Record<string, unknown>) =>
      gateway.request(s.device.id, { projectId: s.projectId, bindingVersion: s.binding, tool, params })
    const onFrom = on(from)
    const onTo = on(to)
    const dest = p.to ?? p.path
    const label = `${from.device.name}:${p.path} → ${to.device.name}:${dest}`
    const relay = (src: string, target: string) => relayFile(x => onFrom('file_get', x), x => onTo('file_put', x), src, target, { maxBytes: MOVE_MAX, signal })
    const done = (size: number) => {
      log.info('files copied', { key, from: from.device.id, to: to.device.id, size })
      return `Copied ${label}, ${bytes(size)}.`
    }

    // A folder can be listed, a file can't
    if (!(await onFrom('list_files', { path: p.path, depth: 1 })).ok) {
      const sent = await relay(p.path, dest)
      return sent.ok ? done(sent.size) : `Not copied: ${sent.error.message}`
    }
    if ((await onTo('list_files', { path: dest, depth: 1 })).ok) return `Not copied: ${dest} already exists on ${to.device.name}. Name another folder in "to".`
    const archive = `.tgcv-copy-${randomBytes(4).toString('hex')}.tar.gz`
    const removing = (s: typeof from, cwd: string) => on(s)('run_command', { command: rmCommand(s.device.shell, archive), cwd, timeoutSec: 60 }).catch(() => {})
    try {
      const skip = [archive, ...MOVE_SKIP].map(s => `--exclude=${s}`)
      const packed = await onFrom('run_command', { program: 'tar', args: ['-czf', archive, ...skip, '.'], cwd: p.path, timeoutSec: 900 })
      if (!packed.ok) return `Not copied: ${packed.error.message}`
      const r = packed.result as { exitCode: number | null, stderr: string }
      if (r.exitCode === 1 && !onlyRootChanged(r.stderr)) return `Not copied: files in ${p.path} changed while packing. Wait until they settle and try again.`
      if (r.exitCode !== 0 && r.exitCode !== 1) return `Not copied: packing failed: ${r.stderr.trim().slice(-300)}`
      const sent = await relay(`${p.path}/${archive}`, `${dest}/${archive}`)
      if (!sent.ok) return `Not copied: ${sent.error.message}`
      const unpacked = await onTo('run_command', { program: 'tar', args: ['-xzf', archive], cwd: dest, timeoutSec: 900 })
      const u = unpacked.ok ? unpacked.result as { exitCode: number | null, stderr: string } : null
      await removing(to, dest)
      if (!u || u.exitCode !== 0) return `Not copied in full: unpacking failed in ${dest} on ${to.device.name}: ${unpacked.ok ? u!.stderr.trim().slice(-300) : unpacked.error.message}`
      return done(sent.size)
    } finally {
      await removing(from, p.path)
    }
  }

  return { copyProject, copyFiles }
}
