// Stands in for the Claude Code binary: the version, the sign-in status (signed in once .signed-in is in the profile's
// folder) and a sign-in on pipes that accepts one code. No account, no network
import { createInterface } from 'node:readline'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [a, b] = process.argv.slice(2)
const dir = process.env.CLAUDE_CONFIG_DIR ?? '.'
if (a === '--version') console.log('9.9.9 (Claude Code)')
else if (a === 'auth' && b === 'status') {
  const loggedIn = existsSync(join(dir, '.signed-in'))
  console.log(JSON.stringify(loggedIn ? { loggedIn, email: 'e2e@example.test', orgName: 'E2E', subscriptionType: 'max' } : { loggedIn }))
  if (!loggedIn) process.exitCode = 1
} else if (a === 'auth' && b === 'login') {
  console.log('Opening browser to sign in…')
  console.log("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=e2e&state=x")
  process.stdout.write('Paste code here if prompted > ')
  createInterface({ input: process.stdin }).once('line', line => {
    if (line === 'good-code#state') {
      writeFileSync(join(dir, '.signed-in'), '1')
      console.log('Login successful.')
      process.exit(0)
    }
    console.log("Login failed: That code wasn't accepted.")
    process.exit(1)
  })
} else {
  console.log(`fake claude: unknown ${process.argv.slice(2).join(' ')}`)
  process.exitCode = 1
}
