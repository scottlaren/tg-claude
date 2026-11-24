import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// Claude proposes a task on a schedule; only the user's tap creates it, whatever the topic's mode: text from a file
// or a page must not be able to set up work that runs by itself later
export const SCHEDULE_SERVER = 'schedule'
export const SCHEDULE_TASK = `mcp__${SCHEDULE_SERVER}__schedule_task`

export type ScheduleProposal = { name: string, cron?: string, at?: string, inMinutes?: number, prompt: string, timeZone?: string, browser?: boolean }

export function createScheduleServer(propose: (p: ScheduleProposal) => Promise<string>) {
  return createSdkMcpServer({
    name: SCHEDULE_SERVER,
    tools: [tool(
      'schedule_task',
      'Propose a task that runs by itself in this topic, repeatedly or once: give exactly one of cron, at, inMinutes. The user confirms it with a button; nothing is scheduled until then.',
      {
        name: z.string().min(1).max(40).describe('Short title in the user\'s language, e.g. "Morning build check"'),
        cron: z.string().max(60).optional().describe('To repeat: five cron fields (minute hour day month weekday), numbers only, in the user\'s time zone, at most once an hour: "0 9 * * *" is every day at 9:00'),
        at: z.string().max(20).optional().describe('To run once at a set time: local time in the user\'s time zone as YYYY-MM-DDTHH:MM, e.g. 2026-10-31T10:00'),
        inMinutes: z.number().int().min(1).max(525600).optional().describe('To run once after a while: "in 2 hours" is 120. Use this for anything relative: you don\'t know the exact time now'),
        prompt: z.string().min(1).max(2000).describe('What to do at each run, complete in itself: this text is what you will get then'),
        timeZone: z.string().max(64).optional().describe('IANA name such as Europe/Kyiv, only when the user just told you where they are: it becomes their time zone for all schedules'),
        browser: z.boolean().optional().describe('true when each run needs the user\'s Chrome (a site they are signed in to, such as an ads dashboard). Nobody is there to grant it at run time: with this, Chrome is on for each run only, and off again after it'),
      },
      async args => ({ content: [{ type: 'text' as const, text: await propose(args) }] }),
    )],
    alwaysLoad: true,
  })
}
