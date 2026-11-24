import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// Little of the limit left and a big task ahead: Claude sees both and asks. The user decides with a card, not a command
export const FRESH_SERVER = 'fresh_limit'
export const OFFER_FRESH = `mcp__${FRESH_SERVER}__offer_fresh_limit`

export function createFreshServer(window: { pct: number, resetsIn: string, label: string }, offer: (why: string) => Promise<string>) {
  return createSdkMcpServer({
    name: FRESH_SERVER,
    tools: [tool(
      'offer_fresh_limit',
      `The plan's limit (${window.label}) is at ${window.pct}% and resets ${window.resetsIn}. If the task you were just given is big (an hour of work or more, many steps, several agents), call this before starting it: the user chooses whether it waits for the reset and then starts by itself, or goes now. Not for small tasks, and not for a task already under way.`,
      { why: z.string().trim().min(3).max(200).describe('Why it is big, a few words in the user\'s language') },
      async a => ({ content: [{ type: 'text' as const, text: await offer(a.why) }] }),
    )],
  })
}
