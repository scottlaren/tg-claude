// Stands in for `claude mcp login <name> --no-browser` in a terminal: colours, the link, the prompt, then the verdict
// on the redirect it reads. FAKE_LOGIN=broken: fails before ever showing a link
import { createInterface } from 'node:readline'

if (process.env.FAKE_LOGIN === 'broken') {
  console.log('MCP server "figma" not found.')
  process.exit(1)
}
console.log('Starting authentication for "figma"…')
console.log('Visit this URL to authorize:')
const link = 'https://www.figma.com/oauth/mcp?response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A60668%2Fcallback&state=s'
console.log(`\u001b[36m  \u001b]8;;${link}\u0007${link}\u001b]8;;\u0007\u001b[39m`)
console.log('Waiting for authorization… (^C to cancel)')
process.stdout.write('Or paste the redirect URL here: ')
const rl = createInterface({ input: process.stdin })
rl.once('line', line => {
  if (line.includes('code=good')) {
    console.log('Authentication successful. Connected to figma.')
    process.exit(0)
  }
  if (line.includes('state=wrong')) {
    // The real CLI goes on waiting after this
    console.log("That doesn't look like a redirect URL for this sign-in.")
    return
  }
  console.log('Authentication failed: the code was not accepted.')
  process.exit(1)
})
