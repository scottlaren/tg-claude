import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// A topic without Chrome: Claude asks for it instead of telling the user to send a command. Only the user's tap turns
// it on, in any mode. Chrome's tools can't join a turn already going, so the next turn carries on with them
export const BROWSER_ASK_SERVER = 'browser_access'
export const ASK_FOR_BROWSER = `mcp__${BROWSER_ASK_SERVER}__ask_for_browser`

// Chrome is on in the topic, but closed on the computer. Opening it adds nothing the user hasn't given: no page, no tap
export const BROWSER_OPEN_SERVER = 'browser_open'
export const OPEN_CHROME = `mcp__${BROWSER_OPEN_SERVER}__open_chrome`

export function createBrowserOpenServer(open: () => Promise<string>) {
  return createSdkMcpServer({
    name: BROWSER_OPEN_SERVER,
    tools: [tool(
      'open_chrome',
      "Start the user's Chrome on this computer if it is closed, and give it time to connect to Claude in Chrome. Call it when this computer's browser isn't among the connected ones, before telling the user.",
      {},
      async () => ({ content: [{ type: 'text' as const, text: await open() }] }),
    )],
    alwaysLoad: true,
  })
}

export function createBrowserAskServer(ask: (p: { reason: string }) => Promise<string>) {
  return createSdkMcpServer({
    name: BROWSER_ASK_SERVER,
    tools: [tool(
      'ask_for_browser',
      'Ask the user to let you work in their Chrome on this computer, with their signed-in sites. They answer with buttons.',
      { reason: z.string().min(1).max(200).describe('One short line in the user\'s language: what you will do in the browser') },
      async args => ({ content: [{ type: 'text' as const, text: await ask(args) }] }),
    )],
    alwaysLoad: true,
  })
}
