// Daily encrypted copy of the server's state (§16): topics, devices, browsers and the Claude profiles with
// their sessions and sign-ins. AES-256-GCM with BACKUP_KEY, which is kept apart from the copies: without it
// they can't be read, with it anyone can. 7 days are kept. Nothing is restored over live data.
//   npm run backup                          make one now
//   npm run backup -- key                   a new key for BACKUP_KEY
//   npm run backup -- restore FILE [--to DIR]   unpack into a new folder
import { spawn, spawnSync } from 'node:child_process'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { once } from 'node:events'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const MAGIC = Buffer.from('TGCVBK1\n')
const IV = 12
const TAG = 16
// The state worth keeping; attachments, logs, whisper and caches are temporary or rebuilt
// owners.json too: without it a restored server has no owner and the install's claim link works again
// workspaces.json: decisions and night mode belong to a group, which only this says is a workspace
const ITEMS = ['topics.json', 'devices.json', 'browsers.json', 'owners.json', 'schedule.json', 'workspaces.json', 'context-trust.json', 'language.json', 'surveys.json', 'decisions', 'night.json', 'profiles']
const EXCLUDE = ['profiles/*/cache', 'profiles/*/backups', '*.tmp']
export const KEEP_DAYS = 7
const NAME = /^backup-(\d{4}-\d{2}-\d{2})-(\d{4})\.tgcv$/

// Windows has bsdtar in System32; Git Bash would put its own GNU tar first on PATH
const tarBin = () => (process.platform === 'win32' && existsSync('C:\\Windows\\System32\\tar.exe') ? 'C:\\Windows\\System32\\tar.exe' : 'tar')

export function parseKey(s: string | undefined) {
  if (!s) return undefined
  const key = Buffer.from(s, 'base64')
  if (key.length !== 32) throw new Error('BACKUP_KEY must be 32 bytes in base64: npm run backup -- key')
  return key
}

// Sessions are written to while the copy is made: GNU tar then says «file changed as we read it» and exits with 1,
// though the archive is whole (the changed file is in it as it was at that moment). Only a GNU tar knows the flags
let gnu: boolean | undefined
export const gnuTar = () => (gnu ??= /GNU tar/.test(spawnSync(tarBin(), ['--version'], { encoding: 'utf8', windowsHide: true }).stdout ?? ''))
export const liveFilesFlags = () => (gnuTar() ? ['--warning=no-file-changed', '--warning=no-file-removed', '--ignore-failed-read'] : [])

function runTar(args: string[], stdin?: 'pipe', okCodes = [0]) {
  const child = spawn(tarBin(), args, { stdio: [stdin ?? 'ignore', 'pipe', 'pipe'], windowsHide: true })
  let err = ''
  child.stderr!.on('data', d => (err += d))
  const done = once(child, 'close').then(([code]) => {
    if (!okCodes.includes(code as number)) throw new Error(`tar: ${err.trim().slice(-300) || `exit code ${code}`}`)
  })
  return { child, done }
}

async function write(out: NodeJS.WritableStream, chunk: Buffer) {
  if (!out.write(chunk)) await once(out, 'drain')
}

export async function createBackup({ dataDir, outDir, key, now = new Date() }: { dataDir: string, outDir: string, key: Buffer, now?: Date }) {
  mkdirSync(outDir, { recursive: true })
  const items = ITEMS.filter(i => existsSync(join(dataDir, i)))
  if (!items.length) throw new Error(`Nothing to back up in ${dataDir}`)
  const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '')
  const file = join(outDir, `backup-${stamp}.tgcv`)
  const tmp = file + '.part'
  const iv = randomBytes(IV)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const out = createWriteStream(tmp)
  out.on('error', () => {})
  try {
    await write(out, MAGIC)
    await write(out, iv)
    // GNU tar's 1 is «some files differ»: files written to meanwhile, still in the archive. 2 is a real failure
    const tar = runTar(['-czf', '-', ...liveFilesFlags(), '-C', dataDir, ...EXCLUDE.flatMap(x => ['--exclude', x]), ...items], undefined, gnuTar() ? [0, 1] : [0])
    for await (const chunk of tar.child.stdout!) await write(out, cipher.update(chunk))
    await tar.done
    await write(out, cipher.final())
    await write(out, cipher.getAuthTag())
    out.end()
    await once(out, 'finish')
    renameSync(tmp, file)
    return { file, bytes: statSync(file).size }
  } catch (e) {
    out.destroy()
    await once(out, 'close').catch(() => {})
    rmSync(tmp, { force: true })
    throw e
  }
}

// One pass over the encrypted body; with no sink it only checks the key and the integrity tag
async function decrypt(file: string, key: Buffer, iv: Buffer, tag: Buffer, end: number, sink?: NodeJS.WritableStream) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  for await (const chunk of createReadStream(file, { start: MAGIC.length + IV, end })) {
    const plain = decipher.update(chunk)
    if (sink) await write(sink, plain)
  }
  decipher.final()
}

// Checked in full before anything is written: a wrong key or a damaged file leaves no half-restore
export async function restoreBackup(file: string, key: Buffer, targetDir: string) {
  const size = statSync(file).size
  const fd = openSync(file, 'r')
  const head = Buffer.alloc(MAGIC.length + IV)
  const tag = Buffer.alloc(TAG)
  readSync(fd, head, 0, head.length, 0)
  readSync(fd, tag, 0, TAG, size - TAG)
  closeSync(fd)
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('This is not a tg-claude backup')
  if (existsSync(targetDir) && readdirSync(targetDir).length) throw new Error(`${targetDir} is not empty: a backup is restored only into a new folder`)
  const iv = head.subarray(MAGIC.length)
  await decrypt(file, key, iv, tag, size - TAG - 1).catch(e => {
    throw new Error(`Can't decrypt: wrong key or damaged file (${(e as Error).message})`)
  })
  mkdirSync(targetDir, { recursive: true })
  const plain = join(targetDir, '.restore.tar.gz')
  const out = createWriteStream(plain)
  await decrypt(file, key, iv, tag, size - TAG - 1, out)
  out.end()
  await once(out, 'finish')
  const tar = runTar(['-xzf', plain, '-C', targetDir])
  await tar.done
  rmSync(plain, { force: true })
  return targetDir
}

export function listBackups(outDir: string) {
  if (!existsSync(outDir)) return []
  return readdirSync(outDir).filter(f => NAME.test(f)).sort().map(f => {
    const s = statSync(join(outDir, f))
    return { file: join(outDir, f), bytes: s.size, at: s.mtime }
  })
}

// Older than KEEP_DAYS go, but the newest copy always stays
export function pruneBackups(outDir: string, now = new Date()) {
  const all = listBackups(outDir)
  const oldest = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)
  for (const b of all.slice(0, -1)) {
    const day = b.file.match(/backup-(\d{4}-\d{2}-\d{2})/)![1]
    if (day < oldest) rmSync(b.file, { force: true })
  }
}

// In the server: one copy a day, checked hourly; a failure is logged and retried at the next check
export function scheduleBackups({ dataDir, outDir, key, log }: { dataDir: string, outDir: string, key: Buffer, log: { info: (...a: unknown[]) => void, error: (...a: unknown[]) => void } }) {
  let running = false
  const tick = async () => {
    const last = listBackups(outDir).at(-1)
    if (running || (last && Date.now() - last.at.getTime() < 24 * 3600_000)) return
    running = true
    try {
      const b = await createBackup({ dataDir, outDir, key })
      pruneBackups(outDir)
      log.info('backup', { file: b.file, bytes: b.bytes })
    } catch (e) {
      log.error('backup failed', (e as Error).message)
    } finally {
      running = false
    }
  }
  tick()
  const timer = setInterval(tick, 3600_000)
  timer.unref()
  return { stop: () => clearInterval(timer), runNow: tick }
}

if (import.meta.main) {
  const { positionals: [cmd, file], values } = parseArgs({ allowPositionals: true, options: { to: { type: 'string' } } })
  const dataDir = resolve(process.env.DATA_DIR ?? 'data')
  const outDir = resolve(process.env.BACKUP_DIR ?? 'backups')
  try {
    if (cmd === 'key') {
      console.log(randomBytes(32).toString('base64'))
      console.log('Put it in .env as BACKUP_KEY=… and keep a copy away from the server (a password manager): without it the backups can\'t be read.')
    } else {
      const key = parseKey(process.env.BACKUP_KEY)
      if (!key) throw new Error('No BACKUP_KEY in .env: npm run backup -- key')
      if (cmd === 'restore') {
        if (!file) throw new Error('Which file? npm run backup -- restore backups/backup-….tgcv')
        const to = resolve(values.to ?? `data-restored-${new Date().toISOString().slice(0, 10)}`)
        await restoreBackup(resolve(file), key, to)
        console.log(`✔ Restored to ${to}`)
        console.log('Next: stop the server, move the contents of this folder into data/ (or point DATA_DIR at it) and start the server.')
      } else {
        const b = await createBackup({ dataDir, outDir, key })
        pruneBackups(outDir)
        console.log(`✔ ${b.file} (${(b.bytes / 1048576).toFixed(1)} MB)`)
      }
    }
  } catch (e) {
    console.error(`✖ ${(e as Error).message}`)
    process.exit(1)
  }
}
