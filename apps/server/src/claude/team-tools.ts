import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { EFFORTS } from '../store.ts'

// Tools of a head topic: it starts agents, each a Claude session in a Telegram topic of its own with its own
// computer, project and model, and their reports come back to the head as messages. Agents get none of
// these: one level, no chains
export const TEAM_SERVER = 'team'
export const isTeamTool = (name: string) => name.startsWith(`mcp__${TEAM_SERVER}__`)
// Tools that only look: allowed even in a read-only topic
export const TEAM_READ = new Set([`mcp__${TEAM_SERVER}__team_status`])


type Effort = (typeof EFFORTS)[number]
export type StartAgent = { name: string, task: string, doing?: string, device?: string, project?: string, new_project?: string, branch?: string, after?: string, model: string, effort: Effort, profile?: string }
export type TeamHandlers = {
  start(p: StartAgent): Promise<string>
  message(p: { agent: string, text: string, now?: boolean, doing?: string }): Promise<string>
  setModel(p: { agent: string, model?: string, effort?: Effort }): Promise<string>
  status(): Promise<string>
  stop(p: { agent: string }): Promise<string>
  remove(p: { agent: string }): Promise<string>
}

const agent = z.string().min(1).max(40).describe('Agent name, as given to start_agent')
const reply = (text: string) => ({ content: [{ type: 'text' as const, text }] })

// families: the model families the account offers now (opus, sonnet, haiku, fable…): an agent gets the newest of its.
// profiles: the user's Claude accounts, the head's own first; with more than one, an agent can run on another
export function createTeamServer(h: TeamHandlers, families: string[], profiles: string[] = []) {
  const modelNames = (families.length ? families : ['sonnet']) as [string, ...string[]]
  const fallback = modelNames.includes('sonnet') ? 'sonnet' : modelNames[0]
  return createSdkMcpServer({
    name: TEAM_SERVER,
    tools: [
      tool(
        'start_agent',
        'Start an agent: a separate Claude session in its own Telegram topic, bound to a computer and a project, working on its task in parallel with you. Its report arrives here as a message each time its turn ends. ' +
        'Pick the model and effort by how hard its part is: haiku + low for mechanical edits, renames and simple lookups; sonnet + medium for typical coding and app work; opus + high or xhigh for architecture, tricky debugging and design decisions. ' +
        'The agent sees nothing of this conversation: write a self-contained task (goal, where, constraints, what to report). Give each agent its own project or folder: two agents in the same files collide.',
        {
          name: z.string().min(1).max(32).describe('Short name shown on its topic, e.g. "Layout"'),
          task: z.string().min(1).max(8000),
          doing: z.string().max(60).optional().describe("What it works on, a few words in the user's language, e.g. \"Shop menu\": shown on your team's pinned board. Always give it"),
          device: z.string().optional().describe("Computer id or name; default: this topic's computer, or the only one online"),
          project: z.string().optional().describe("Existing project id or name on that computer; default: this topic's project"),
          new_project: z.string().max(64).optional().describe('Create a new project folder with this name instead (Latin letters, digits, dashes)'),
          branch: z.string().max(40).optional().describe('Give the agent a git branch of its own in the project (a git repository): the bot makes a worktree in the folder next to it that holds them, <project>-wt/<branch> on branch agent/<branch> from the current HEAD. Use it whenever several agents work on one repository'),
          after: z.string().max(40).optional().describe('Name of one of your agents: this one then starts only when that one has finished, with its report added to the task. If that one fails, this one does not start and you hear of it. With branch set, its branch starts from that agent\'s branch, so it has its commits.'),
          model: z.enum(modelNames).default(fallback),
          effort: z.enum(EFFORTS).default('medium'),
          ...(profiles.length > 1 && {
            profile: z.enum(profiles as [string, ...string[]]).optional().describe(`The Claude account it runs on, with limits of its own; default yours (${profiles[0]}). Agents on another account spend both accounts' limits in parallel: put the long or heavy parts there`),
          }),
        },
        async a => reply(await h.start(a as StartAgent)),
      ),
      tool(
        'message_agent',
        'Send an agent a message: new instructions, a correction, an answer to its question. A busy agent gets it after its current turn; with now, after its current step, inside the work under way. The user sees it in the agent\'s topic.',
        {
          agent,
          text: z.string().min(1).max(8000),
          doing: z.string().max(60).optional().describe('With a new task: what it works on now, a few words in the user\'s language, for your team\'s pinned board'),
          now: z.boolean().optional().describe('A correction or detail of the task the agent is working on, such as the user adding to what they asked: true, so the agent doesn\'t finish the work first and then redo it. A new task of its own: leave it out.'),
        },
        async a => reply(await h.message(a)),
      ),
      tool(
        'set_agent_model',
        'Change an agent\'s model and/or effort as the work goes: raise them when it struggles or its part turns out harder, lower them for routine follow-ups. Applies from the agent\'s next turn.',
        { agent, model: z.enum(modelNames).optional(), effort: z.enum(EFFORTS).optional() },
        async a => reply(await h.setModel(a)),
      ),
      tool('team_status', 'Your agents: computer, project, model and effort, what each is doing now, its last report.', {}, async () => reply(await h.status())),
      tool('stop_agent', 'Stop what an agent is doing now and drop its queued messages.', { agent }, async a => reply(await h.stop(a))),
      tool('remove_agent', 'Remove an agent: its topic and its session on the server are deleted, its project files stay.', { agent }, async a => reply(await h.remove(a))),
    ],
  })
}
