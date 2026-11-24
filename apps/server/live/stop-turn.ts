// Live check against real Claude (uses the server profile, costs a few tokens): `npm run live:stop`
// Stop must end the turn within ~1.5 s with nothing written or called after it
import { resolve } from 'node:path'
import { runTurn } from '../src/claude/runner.ts'
import { createDeviceServer } from '../src/claude/device-tools.ts'
const ac = new AbortController()
let stoppedAt = 0
const deviceServer = createDeviceServer(async () => {
  setTimeout(() => { stoppedAt = Date.now(); ac.abort() }, 1000)
  await new Promise(r => setTimeout(r, 4000))
  return { ok: true, result: { exitCode: 0, signal: null, timedOut: false, cancelled: false, stdout: 'ok', stderr: '', truncated: false, durationMs: 4000 } }
})
let textAfterStop = ''
const res = await runTurn({
  prompt: 'Call run_command with command "sleep 4" once. After it returns, write one short sentence about the sea.',
  cwd: process.cwd(), env: { ...process.env, CLAUDE_CONFIG_DIR: resolve(process.env.CLAUDE_PROFILE_DIR ?? 'data/profiles/main') }, append: '', deviceServer, abortController: ac,
  canUseTool: async (_t, input) => ({ behavior: 'allow', updatedInput: input }),
  onText: s => { if (stoppedAt) textAfterStop = s },
}).catch(e => ({ text: 'THROW ' + (e as Error).message, aborted: false }))
const ms = Date.now() - stoppedAt
console.log(JSON.stringify({ aborted: !!res.aborted, msAfterStop: ms, textAfterStop, resultText: res.text.slice(0, 80) }))
console.log(res.aborted && ms < 1500 && !textAfterStop ? 'PASS' : 'FAIL')
process.exit(0)
