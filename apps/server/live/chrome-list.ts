// Browsers the server's Claude can reach right now, as /browser would offer them: `npm run live:browsers`
import { listBrowsers } from '../src/claude/chrome.ts'
import { loadConfig } from '../src/config.ts'
const cfg = loadConfig({ ...process.env, TG_TOKEN: process.env.TG_TOKEN || '-' })
const t0 = Date.now()
const found = await listBrowsers({ cwd: cfg.claudeCwd, env: { ...process.env, CLAUDE_CONFIG_DIR: cfg.profileDir } })
console.log(JSON.stringify(found), `${Date.now() - t0} ms`)
process.exit(0)
