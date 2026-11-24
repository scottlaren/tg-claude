import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { tr } from '../i18n.ts'

// The steps of a long task, ticking themselves off where the user already looks: the live status of the task, and then
// its answer. Not a message of its own: one more message to scroll past, and in a group one more write
export const CHECKLIST_SERVER = 'checklist'
export const SET_CHECKLIST = `mcp__${CHECKLIST_SERVER}__set_checklist`

export type ChecklistStep = { text: string, state: 'todo' | 'now' | 'done' | 'failed' }

// Scott's marks, the white ones from his own set (Unigram Icons): waits, under way, done, and a cross only for what went
// wrong. Where custom emoji don't show (a notification), the ordinary emoji inside stand in. The step under way is also
// bold. Rich text joins lines without two spaces at their end
const custom = (id: string, emoji: string) => `<tg-emoji emoji-id="${id}">${emoji}</tg-emoji>`
const MARK: Record<ChecklistStep['state'], string> = {
  todo: custom('5877409148232011610', '➕'),
  now: custom('5879893730978173215', '⚪️'),
  done: custom('5879923984727804781', '✅'),
  failed: custom('5879625832393084963', '❌'),
}
const lines = (steps: ChecklistStep[], escape: (s: string) => string) =>
  steps.map(s => `${MARK[s.state]} ${s.state === 'now' ? `**${escape(s.text)}**` : escape(s.text)}  `).join('\n')
const progress = (steps: ChecklistStep[]) => `${steps.filter(s => s.state === 'done').length}/${steps.length}`

// While the task runs: folded at the top of its status, as in the answer. The fold's own line says where it stands
export function livePlan(steps: ChecklistStep[], escape: (s: string) => string) {
  const now = steps.find(s => s.state === 'now')
  return `<details><summary>📋 ${tr('Plan', 'План')} · ${progress(steps)}${now ? ` · ${escape(now.text)}` : ''}</summary>\n\n${lines(steps, escape)}\n\n</details>`
}

// In the answer: folded like the steps, with what stopped it when it didn't get through
export function finalPlan(steps: ChecklistStep[], escape: (s: string) => string, cutOff: boolean) {
  const unfinished = steps.some(s => s.state !== 'done')
  const why = cutOff && unfinished ? ` · ${tr('⏹ interrupted', '⏹ прервано')}` : ''
  return `<details><summary>📋 ${tr('Plan', 'План')} · ${progress(steps)}${why}</summary>\n\n${lines(steps, escape)}\n\n</details>`
}

export function createChecklistServer(show: (steps: ChecklistStep[]) => void) {
  return createSdkMcpServer({
    name: CHECKLIST_SERVER,
    tools: [tool(
      'set_checklist',
      'Show the steps of a task of three steps or more, and keep them up to date as you go: call it when you start and again each time a step begins or ends, with the whole list each time. The user sees them in the live status of this task and then in your answer. For anything shorter, don\'t use it. It replaces nothing: your final answer still says what came of the work.',
      {
        steps: z.array(z.object({
          text: z.string().trim().min(1).max(200).describe('The step, a few words in the user\'s language'),
          state: z.enum(['todo', 'now', 'done', 'failed']).describe('failed: the step went wrong and is not done; say why in your answer'),
        })).min(1).max(30),
      },
      async a => {
        show(a.steps)
        return { content: [{ type: 'text' as const, text: 'Shown.' }] }
      },
    )],
    alwaysLoad: true,
  })
}
