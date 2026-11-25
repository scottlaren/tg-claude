import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// Tools of the bot itself for a topic without a project: Claude can't touch any computer there, but it can
// offer the user to open a project for the conversation. The user answers with buttons
export const TOPIC_SERVER = 'topic'
export const SUGGEST_PROJECT = `mcp__${TOPIC_SERVER}__suggest_project`

// Any topic: the only thing this changes is the name of the topic Claude is already talking in, so it needs no tap
export const TOPIC_NAME_SERVER = 'topic_name'
export const RENAME_TOPIC = `mcp__${TOPIC_NAME_SERVER}__rename_topic`

export function createTopicNameServer(rename: (name: string) => Promise<string>) {
  return createSdkMcpServer({
    name: TOPIC_NAME_SERVER,
    tools: [tool(
      'rename_topic',
      'Rename the Telegram topic of this conversation. Use it when the user asks for a new name.',
      { name: z.string().trim().min(1).max(128).describe('The new name, exactly as the user wants it') },
      async args => ({ content: [{ type: 'text' as const, text: await rename(args.name) }] }),
    )],
    alwaysLoad: true,
  })
}

// A long questionnaire: the bot runs it and Claude's turn ends meanwhile, so it costs nothing while the user thinks
export const SURVEY_SERVER = 'survey'
export const ASK_SURVEY = `mcp__${SURVEY_SERVER}__ask_survey`
export const surveyParams = {
  title: z.string().trim().max(60).optional().describe('Short title shown on every question'),
  questions: z.array(z.object({
    question: z.string().trim().min(1).max(1000).describe('The question, complete in itself; why it matters goes here too'),
    options: z.array(z.object({
      label: z.string().trim().min(1).max(60).describe('The answer, a few words'),
      description: z.string().trim().max(200).optional().describe('What choosing it means'),
    })).max(12).default([]).describe('Empty: the user answers in their own words. They can always do that instead'),
    multiple: z.boolean().optional().describe('More than one option can be chosen'),
    recommended: z.array(z.number().int().min(0)).optional().describe('Indexes of the options you advise: they get a star'),
    image: z.string().optional().describe('A picture on the computer to show with the question: path from the project root, or a web address'),
  })).min(1).max(200),
}
export type SurveyInput = { title?: string, questions: { question: string, options: { label: string, description?: string }[], multiple?: boolean, recommended?: number[], image?: string }[] }

export function createSurveyServer(start: (p: SurveyInput) => Promise<string>) {
  return createSdkMcpServer({
    name: SURVEY_SERVER,
    tools: [tool(
      'ask_survey',
      'Ask the user many questions in one go: one at a time, each with its options, in a single message they can walk through, leave and come back to, with Back, Skip and Finish. Use it when they ask to be asked, or when a choice is theirs and they haven\'t settled it: several decisions that depend on them, a brief to gather. For one to three quick questions use AskUserQuestion. Write all the questions at once, in the order that makes sense. The tool returns at once: end your turn with one short line. All the answers arrive as your next message, when the user finishes or stops; only then go on.',
      surveyParams,
      async args => ({ content: [{ type: 'text' as const, text: await start(args) }] }),
    )],
    alwaysLoad: true,
  })
}

// Topics of one chat can write to each other. What arrives is not the user speaking: see stricterMode for what it may do
export const MESSAGE_SERVER = 'topics'
export const MESSAGE_TOPIC = `mcp__${MESSAGE_SERVER}__message_topic`
export type TopicMessage = { topic: string, text: string }

const NAMES_SHOWN = 40
// Part of every request of every topic here, so a chat pays for its length many times over. The newest stay, in a steady
// order: one that changed with use would throw away the prompt cache. Those left out can still be written to by name
export const topicNames = (names: string[]) => (names.length > NAMES_SHOWN ? `${names.slice(-NAMES_SHOWN).join(', ')}, and ${names.length - NAMES_SHOWN} older` : names.join(', '))

export function createMessageServer(names: string[], send: (p: TopicMessage) => Promise<string>) {
  return createSdkMcpServer({
    name: MESSAGE_SERVER,
    tools: [tool(
      'message_topic',
      `Write to another topic of this chat: a separate Claude session, on its own computer and project, which sees nothing of this conversation. Topics here: ${topicNames(names)}. A topic whose name the bot doesn't know is listed by its project or number, so the user may call it something else: if only one fits what they mean, it is that one. Use it when work there depends on something here, or the user asks. It wakes that session, and costs what a turn costs: no courtesies, no replies that only say thanks. Its answer stays in its own topic unless it writes back to you.`,
      {
        topic: z.string().min(1).max(128).describe('The topic, by name as listed'),
        text: z.string().trim().min(1).max(4000).describe('Complete in itself: what you need, and everything it has to know to act on it'),
      },
      async args => ({ content: [{ type: 'text' as const, text: await send(args) }] }),
    )],
    alwaysLoad: true,
  })
}

// The topic's computer is away, so work that needs it waits: Claude writes it down, and it starts when the computer is back
export const DEFER_SERVER = 'later'
export const DEFER_TASK = `mcp__${DEFER_SERVER}__defer_task`

export function createDeferServer(device: string, defer: (task: string, title: string) => Promise<string>) {
  return createSdkMcpServer({
    name: DEFER_SERVER,
    tools: [tool(
      'defer_task',
      `${device} is offline. Write down one task that needs it: it starts by itself as soon as ${device} connects, with no word from the user. One call per task.`,
      {
        title: z.string().trim().min(1).max(80).describe('What it is, a few words in the user\'s language: the chat shows this name, not the task'),
        task: z.string().trim().min(1).max(2000).describe('Complete in itself: what to do and every decision made in this conversation that it depends on. This text is what you will get then'),
      },
      async args => ({ content: [{ type: 'text' as const, text: await defer(args.task, args.title) }] }),
    )],
    alwaysLoad: true,
  })
}

// Deleting topics takes conversations with it, so Claude only offers it: the list and the buttons are the bot's, and only
// the user's tap deletes. Any topic but an agent's
export const DELETE_SERVER = 'topic_delete'
export const DELETE_TOPICS = `mcp__${DELETE_SERVER}__delete_topics`
export type DeleteTopics = { which: 'this' | 'all' | 'named', names?: string[] }

export function createDeleteServer(offer: (p: DeleteTopics) => Promise<string>) {
  return createSdkMcpServer({
    name: DELETE_SERVER,
    tools: [tool(
      'delete_topics',
      'Offer to delete Telegram topics of this chat with their Claude sessions. Use it when the user asks for it. The user sees the list and confirms with a button; nothing is deleted before that. Projects and files stay.',
      {
        which: z.enum(['this', 'all', 'named']).describe('this: the topic of this conversation. all: every topic of this chat. named: those in names'),
        names: z.array(z.string().max(128)).max(50).optional().describe('Topic names, for "named"'),
      },
      async args => ({ content: [{ type: 'text' as const, text: await offer(args) }] }),
    )],
    alwaysLoad: true,
  })
}

// Another computer suits this better. The user decides with buttons: go there, or start an agent there
export const COMPUTER_SERVER = 'computer'
export const SUGGEST_COMPUTER = `mcp__${COMPUTER_SERVER}__suggest_computer`

export const COPY_TO_COMPUTER = `mcp__${COMPUTER_SERVER}__copy_files`
export const SYNC_BRANCH = `mcp__${COMPUTER_SERVER}__sync_branch`
export type SyncBranch = { computer: string, branch?: string }
export type CopyFiles = { direction: 'send' | 'fetch', computer: string, path: string, to?: string, project?: string }

// online: where a topic may be offered to go, copyable: where files may be copied to (the cloud is only the first)
export function createComputerServer(online: string[], suggest: (p: { computer: string, reason: string }) => Promise<string>, copy: (p: CopyFiles) => Promise<string>, copyable = online, sync?: (p: SyncBranch) => Promise<string>) {
  return createSdkMcpServer({
    name: COMPUTER_SERVER,
    tools: [tool(
      'copy_files',
      `Copy a file or folder between this computer's project and a project on another computer, through the server, up to 1 GB. For assets and renders; code goes through git. Online now: ${copyable.join(', ') || 'none'}. Never overwrites: a name already taken is an error. A folder leaves out node_modules and the like.`,
      {
        direction: z.enum(['send', 'fetch']).describe('send: from this computer to the other. fetch: from the other to this one'),
        computer: z.string().min(1).max(64).describe('The other computer, its name as listed'),
        path: z.string().min(1).describe('File or folder to copy, relative to the project root on the computer it is on'),
        to: z.string().min(1).optional().describe('Where it goes, relative to the project root on the receiving computer. Default: the same path'),
        project: z.string().optional().describe("The project on the other computer. Default: the one named like this project"),
      },
      async args => ({ content: [{ type: 'text' as const, text: await copy(args) }] }),
    ), ...(sync ? [tool(
      'sync_branch',
      `Bring a git branch of this project to the same project on another computer, through its git remote: pushes the branch from here, clones the project there if it isn't there yet (light: blobs as needed, without the folders .worktree-skip names) or fetches into the clone it has, checks the branch out, brings its submodules. For running long or heavy work there with start_agent, on the cloud first. Online now: ${online.join(', ')}. Uncommitted changes don't travel: commit first. Tools the project needs (compilers, runners) are not installed by this: the agent there checks and installs into its home folder.`,
      {
        computer: z.string().min(1).max(64).describe('The other computer, its name as listed'),
        branch: z.string().min(1).max(100).optional().describe('Default: the branch this project is on'),
      },
      async args => ({ content: [{ type: 'text' as const, text: await sync(args) }] }),
    )] : []), tool(
      'suggest_computer',
      `Offer to work on another of the user's computers. Online now: ${online.join(', ')}. Use it when the user asks, or when the task can't be done on this one (Xcode needs a Mac, an app is only there); not for what this computer can do too. The cloud (named Cloud, if listed) is a Linux container on the server for code only: git, Node, Python, no desktop apps and none of the user's files. Offer it when this topic's own computer is off and the work is code; the user picks or clones the project there. The user answers with buttons: go there with this conversation, start an agent there, or stay. End your turn right after calling it; the next message tells you what was chosen.`,
      {
        computer: z.string().min(1).max(64).describe('Its name as listed'),
        reason: z.string().min(1).max(200).describe('One short line for the user: why there'),
      },
      async args => ({ content: [{ type: 'text' as const, text: await suggest(args) }] }),
    )],
    alwaysLoad: true,
  })
}

export function createTopicServer(suggest: (p: { name?: string, reason: string }) => Promise<string>) {
  return createSdkMcpServer({
    name: TOPIC_SERVER,
    tools: [tool(
      'suggest_project',
      'This topic has no computer or project. When the task needs files, code, commands or desktop apps, call this to offer the user a project for the conversation: a new folder on one of their computers, or one of their existing projects. The user answers with buttons; end your turn right after calling it — the next message tells you which project was opened, and the conversation continues there.',
      {
        name: z.string().max(40).optional().describe('Folder name for a new project: latin letters, digits and dashes, e.g. "landing-page"'),
        reason: z.string().max(200).describe('One short line for the user: what the project is for'),
      },
      async args => ({ content: [{ type: 'text' as const, text: await suggest(args) }] }),
    )],
    alwaysLoad: true,
  })
}
