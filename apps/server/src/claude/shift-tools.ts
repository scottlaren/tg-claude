import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// The night shift: Claude recognises it in the user's words and offers a card; the shift's head says when it is over
export const SHIFT_SERVER = 'night_shift'
export const OFFER_SHIFT = `mcp__${SHIFT_SERVER}__offer_night_shift`
export const END_SHIFT = `mcp__${SHIFT_SERVER}__end_night_shift`
export const isShiftTool = (name: string) => name === OFFER_SHIFT || name === END_SHIFT

const reply = (text: string) => ({ content: [{ type: 'text' as const, text }] })

export function createShiftServer(h: {
  offer?: (p: { tasks: string[], power: 'on' | 'sleep' | 'off', tidy?: 'soft' | 'force', release: boolean }) => Promise<string>
  end?: (p: { done: boolean, finished?: string[], left?: string[] }) => Promise<string>
}) {
  return createSdkMcpServer({
    name: SHIFT_SERVER,
    tools: [
      ...(h.offer ? [tool(
        'offer_night_shift',
        'The user gives you a night shift: says so, in text or a voice message ("this is your night shift", «ночная смена», "work through the night"), and lists tasks for while they sleep. Call this instead of starting the work: the user sees a card with the tasks and starts the shift with one tap. Then end your turn with one short line. Not for an ordinary task given in the evening.',
        {
          tasks: z.array(z.string().trim().min(1).max(500)).min(1).max(20).describe('The tasks, each in a line, in the user\'s words and language'),
          power: z.enum(['on', 'sleep', 'off']).describe('What the user asked to do with the computers at the end: "off" when they said to turn them off or shut them down, "sleep" when they said to put them to sleep, "on" when they said nothing of it. The card shows it and lets them change it with a tap'),
          tidy: z.enum(['soft', 'force']).optional().describe('The user asked to close the open windows and apps at the end, for an empty desktop in the morning: "soft" asks each app to close and leaves one that asks to save; "force" when they said to close everything for sure or by force (unsaved work in what stays open is lost). Leave out when they didn\'t ask'),
          release: z.boolean().describe('true unless the user asked to keep the work in branches: they allow everything for a night shift'),
        },
        async a => reply(await h.offer!(a)),
      )] : []),
      ...(h.end ? [tool(
        'end_night_shift',
        'The night shift is over: call it right before your summary. done: everything was done; false when you stop with work left.',
        {
          done: z.boolean(),
          finished: z.array(z.string().trim().min(1).max(80)).max(12).optional().describe('What got done, a few words each, in the user\'s language: their morning card lists them'),
          left: z.array(z.string().trim().min(1).max(80)).max(12).optional().describe('What is left undone, the same way'),
        },
        async a => reply(await h.end!(a)),
      )] : []),
    ],
  })
}
