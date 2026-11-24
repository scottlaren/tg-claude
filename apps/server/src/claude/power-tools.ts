import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// Turning a computer off or putting it to sleep at the user's word. Claude never does it with a command (the power
// guard refuses those): it offers a card, and the user's own tap chooses sleep or off. The bot does it then
export const POWER_SERVER = 'power'
export const POWER_TOOL = `mcp__${POWER_SERVER}__offer_power`

export type PowerOffer = { computer?: string, tidy?: 'soft' | 'force' }

export function createPowerServer(computers: string[], offer: (p: PowerOffer) => Promise<string>) {
  return createSdkMcpServer({
    name: POWER_SERVER,
    tools: [tool(
      'offer_power',
      `The user asks to turn a computer off, shut it down or put it to sleep now (${computers.join(', ')}). Call this instead of any command: they see a card and choose with a button, sleep, off or cancel, and the bot does it a minute later. Don't decide between sleep and off for them, and don't ask in words: the card is the question. Then end your turn with one short line. For the end of a night shift use that shift's own card, not this.`,
      {
        computer: z.enum(computers as [string, ...string[]]).optional().describe('Which computer; default: the one this topic works on'),
        tidy: z.enum(['soft', 'force']).optional().describe('Only when the user also asked to close the open windows first: "soft" asks each app to close; "force" when they said to close everything for sure or by force. They can change it on the card'),
      },
      async p => ({ content: [{ type: 'text' as const, text: await offer(p) }] }),
    )],
  })
}
