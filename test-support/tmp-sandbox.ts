// Preloaded into every test process (node --import): points the temp folder at a private one and removes it at exit,
// so tests and the code they run leave no tgcv-* folders behind. os.tmpdir() reads these variables on every call.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'tgcv-run-'))
process.env.TMPDIR = process.env.TEMP = process.env.TMP = dir

process.on('exit', () => {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }) } catch {}
})
