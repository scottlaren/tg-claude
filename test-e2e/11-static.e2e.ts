import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './support/stack.ts'

// The install scripts and the update helper, read and parsed but never run: they change autostart and system services

const SCRIPTS = [
  ...readdirSync(join(ROOT, 'deploy')).filter(f => f.endsWith('.sh')).map(f => join('deploy', f)),
  join('apps', 'server', 'src', 'install-agent.sh'),
]

for (const f of SCRIPTS) {
  test(`bash -n ${f}`, () => {
    const r = spawnSync('bash', ['-n', join(ROOT, f)], { encoding: 'utf8', windowsHide: true })
    assert.equal(r.status, 0, r.stderr)
  })
}

test("install-agent.sh keeps to macOS's bash 3.2", () => {
  const text = readFileSync(join(ROOT, 'apps/server/src/install-agent.sh'), 'utf8')
  const lines = text.split('\n')
  // What bash 3.2 doesn't have, or reads differently
  const NOT_32: [RegExp, string][] = [
    [/\bdeclare\s+-A\b|\blocal\s+-A\b/, 'associative arrays'],
    [/\bmapfile\b|\breadarray\b/, 'mapfile'],
    [/\$\{[A-Za-z_]\w*(\^\^?|,,?)\}/, 'case conversion'],
    [/\|&/, '|&'],
    [/&>>/, '&>>'],
    [/\bcoproc\b/, 'coproc'],
    [/\$\{[A-Za-z_]\w*@[A-Z]\}/, 'transformations'],
    [/\[\[.*-v\s/, '[[ -v ]]'],
  ]
  for (const [i, line] of lines.entries()) {
    if (/^\s*#/.test(line)) continue
    for (const [re, what] of NOT_32) assert.ok(!re.test(line), `line ${i + 1}, ${what}: ${line}`)
    // $NAME right before a non-ASCII character: bash 3.2 on a Mac reads the letter into the name
    assert.ok(!/\$[A-Za-z_]\w*[^\x00-\x7F]/.test(line), `line ${i + 1}, $NAME before a non-ASCII character: ${line}`)
  }
})

test('install-agent.ps1 is plain ASCII and parses in Windows PowerShell 5.1', { skip: process.platform !== 'win32' }, () => {
  const file = join(ROOT, 'apps/server/src/install-agent.ps1')
  const data = readFileSync(file)
  const at = data.findIndex(b => b > 0x7f)
  assert.equal(at, -1, `a non-ASCII byte at ${at}`)
  const script = `$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}',[ref]$t,[ref]$e);if($e.Count){$e|ForEach-Object{$_.ToString()};exit 1};Write-Output "ok $($PSVersionTable.PSVersion.Major)"`
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true })
  assert.match(out, /^ok 5/m)
})

test('the update helper asks nothing of the bot it does not check: the tag is matched by shape, forward only', () => {
  const text = readFileSync(join(ROOT, 'deploy/tgcv-update.sh'), 'utf8')
  assert.match(text, /v\[0-9\]\[0-9\]\*\\\.\[0-9\]\[0-9\]\*\\\.\[0-9\]\[0-9\]\*/, 'only vX.Y.Z')
  assert.match(text, /sort -V/, 'forward only')
  assert.match(text, /result false "\$WHY, rolled back to \$FROM"/, 'says the outcome before it rolls back')
  assert.match(text, /deploy "\$OLD"/, 'rolls back')
})

test('the Dockerfile copies what the server needs and runs as a user, not root', () => {
  const text = readFileSync(join(ROOT, 'deploy/Dockerfile'), 'utf8')
  assert.match(text, /agent-bundle\.tar\.gz/, 'the agent bundle is baked in')
  assert.match(text, /^USER\s+(?!root)/m, 'not root')
})
