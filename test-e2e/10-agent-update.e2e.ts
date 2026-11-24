import { test, after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pairCodeIn, until, sleep, startStack, ROOT, type Stack } from './support/stack.ts'
import { openTopic, setMode } from './support/boot.ts'

// A computer set up the way the one line from /pair does it: the archive from the server, no git. It runs an older
// release, and the server comes back on a newer one during a command: the computer updates itself, its restart waits for
// the command (the gate), and it comes back on the new code

const CURRENT: string = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

for (const language of ['en', 'ru'] as const) {
  describe(`agent update in ${language}`, { timeout: 10 * 60_000 }, () => {
    let s: Stack
    let thread = 0
    let zone = ''
    let root = ''
    const tr = (en: RegExp, ru: RegExp) => (language === 'en' ? en : ru)
    const ID = 'old-pc'

    before(async () => {
      s = await startStack({ language })
      s.tg.setLang(language)
      await s.startServer()
      // Not asked to update yet: the first connection stays on the old release
      writeFileSync(join(s.dataDir, 'updates.json'), JSON.stringify({ agents: { [ID]: CURRENT } }))
      const t = Date.now()
      s.send('/pair')
      const code = pairCodeIn(await s.reply(/install\//, { after: t }))!

      // What the installer downloads and unpacks
      const res = await fetch(`http://127.0.0.1:${s.wsPort}/install/${code}/agent.tar.gz`, { signal: AbortSignal.timeout(5 * 60_000) })
      assert.equal(res.status, 200, 'the archive comes from the server')
      root = join(s.base, 'old-agent')
      mkdirSync(root, { recursive: true })
      writeFileSync(join(root, 'agent.tar.gz'), Buffer.from(await res.arrayBuffer()))
      execFileSync(process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar', ['-xzf', 'agent.tar.gz'], { cwd: root, windowsHide: true })
      mkdirSync(join(root, 'node_modules', '@tgcv'), { recursive: true })
      symlinkSync(join(root, 'packages', 'protocol'), join(root, 'node_modules', '@tgcv', 'protocol'), 'junction')
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
      assert.equal(pkg.version, CURRENT)
      writeFileSync(join(root, 'package.json'), JSON.stringify({ ...pkg, version: '0.0.1' }))

      const a = await s.pairAgent('Old-PC', code, ['alpha'], { agentRoot: root })
      assert.equal(a.id, ID)
      zone = join(a.zone, 'alpha')
      await sleep(300)
      thread = await openTopic(s, 'Work', 'alpha')
      await setMode(s, thread, 'all')
    })
    after(() => s?.stop())

    test('the server comes back newer during a command: the computer updates, waits for the command, restarts on the new code', async () => {
      const name = 'slow.cjs'
      writeFileSync(join(zone, name), `const fs=require('fs');fs.appendFileSync(${JSON.stringify(join(zone, 'slow.runs'))},'run\\n');setTimeout(()=>{fs.writeFileSync(${JSON.stringify(join(zone, 'slow.done'))},'x');console.log('finished slow')},25000)`)
      const t = Date.now()
      const msg = s.send(`go ${s.script([{ tool: 'mcp__device__run_command', input: { command: `node ${name}` } }, { text: 'after the update E2E' }])}`, { thread })
      await until('the command to start', () => existsSync(join(zone, 'slow.runs')))
      await sleep(300)
      await s.killServer()
      // A new release is what the server now says it is: this computer has not been asked to take it
      writeFileSync(join(s.dataDir, 'updates.json'), JSON.stringify({ agents: {} }))
      await s.startServer()

      const note = await s.reply(tr(/restarts once its running commands finish \(1\)/, /перезапустится, когда закончатся его команды \(1\)/), { after: t, ms: 60_000 })
      assert.match(note.text, /0\.0\.1/)
      assert.equal(existsSync(join(zone, 'slow.done')), false, 'the update came while the command ran')
      const a = s.agents.get('Old-PC')!
      const stillUp = a.child
      assert.ok(stillUp, 'the old process waits')

      const answer = await s.reply(/after the update E2E/, { thread, after: t, ms: 60_000 })
      assert.equal(answer.reply_to, msg.message_id, 'the answer replies to the original message')
      assert.equal(readFileSync(join(zone, 'slow.runs'), 'utf8').trim().split('\n').length, 1, 'the command ran once')
      const prompt = s.journal().filter(j => j.kind === 'turn' && j.at >= t).at(-1)!.prompt
      assert.match(prompt, /finished slow/, 'Claude reads how the command ended')

      // Under the service the process ends with the restart code and starts again; here the test is the service
      await until('the old process to leave', () => s.exits.some(e => e.name === 'agent-Old-PC' && e.at >= t), 30_000)
      assert.equal(s.exits.find(e => e.name === 'agent-Old-PC' && e.at >= t)!.code, 75, 'the code that asks the service to restart')
      assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, CURRENT, 'the new code is in place')
      const online = s.onlineCount(ID)
      await s.startAgent('Old-PC')
      await s.online(ID, online)
      const done = await until('the note to become the outcome', () => s.tg.sent.find(m => m.message_id === note.message_id && tr(/updated to/, /обновлён до/).test(m.text)), 10_000)
      assert.match(done.text, new RegExp(CURRENT.replace(/\./g, '\\.')))

      // And it still works on the new code
      const t2 = Date.now()
      s.send(`go ${s.script([{ tool: 'mcp__device__run_command', input: { command: 'echo works-after-update' } }, { text: 'still fine E2E' }])}`, { thread })
      await s.reply(/still fine E2E/, { thread, after: t2 })
      assert.match(s.journal().filter(j => j.kind === 'tool').at(-1)!.text, /works-after-update/)
    })

    test('nothing raw, nothing in the wrong language, nothing left the computer', () => {
      assert.deepEqual(s.tg.findings, [])
      assert.deepEqual(s.netViolations(), [])
    })
  })
}
