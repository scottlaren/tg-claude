// Stands in for `claude auth login` on pipes: the link, the prompt, then the verdict on the code it reads.
// FAKE_LOGIN=broken: fails before ever showing a link, like a CLI that can't start its listener
import { createInterface } from 'node:readline'

if (process.env.FAKE_LOGIN === 'broken') {
  console.log("Login failed: Couldn't start the local listener that receives the browser sign-in. Try again.")
  process.exit(1)
}
console.log('Opening browser to sign in…')
console.log(`If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=${process.env.CLAUDE_CONFIG_DIR ? 'dir' : 'none'}`)
process.stdout.write('Paste code here if prompted > ')
const rl = createInterface({ input: process.stdin })
rl.once('line', line => {
  if (line === 'good-code#state') {
    console.log('Login successful.')
    process.exit(0)
  }
  console.log("Login failed: That code wasn't accepted. It may be incomplete, expired, already used, or from an earlier sign-in attempt.")
  process.exit(1)
})
