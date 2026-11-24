import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// A long conversation and a task unrelated to it: Claude sees both and asks. Every step rereads the whole history, so a
// new task in a fresh session costs a fraction. The user decides with a card
export const NEW_SESSION_SERVER = 'new_session'
export const OFFER_NEW_SESSION = `mcp__${NEW_SESSION_SERVER}__offer_new_session`

export function createNewSessionServer(contextK: number, offer: (what: string) => Promise<string>) {
  return createSdkMcpServer({
    name: NEW_SESSION_SERVER,
    tools: [tool(
      'offer_new_session',
      `This conversation already holds about ${contextK}k tokens, and each of your steps rereads all of it. If the user's latest message starts a new task that doesn't need this conversation (another feature, another bug, another question), call this first, before any other tool: the user chooses with a card whether it starts in a fresh session (same computer and project, without this history) or goes on here. Not when the message continues, corrects, refers to or builds on the work here, and not for a short question you can answer in one step. Then end your turn with one short line.`,
      { what: z.string().trim().min(3).max(120).describe('The new task, a few words in the user\'s language') },
      async a => ({ content: [{ type: 'text' as const, text: await offer(a.what) }] }),
    )],
  })
}
