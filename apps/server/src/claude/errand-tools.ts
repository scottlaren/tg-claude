import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// Chrome this topic's session can't reach: on another of the user's computers, or on this one when it is signed in to
// another Claude account. A session sees only the browsers of its own account, so a short session of its own on that
// one does the task there and answers with what it found and its screenshots
export const ERRAND_SERVER = 'browser_elsewhere'
export const ERRAND_TOOL = `mcp__${ERRAND_SERVER}__browse_on_computer`

export type Errand = { computer: string, task: string }
export type ErrandResult = { text: string, images: { data: string, mime: string }[] } | string

export function createErrandServer(computers: string[], run: (p: Errand) => Promise<ErrandResult>) {
  return createSdkMcpServer({
    name: ERRAND_SERVER,
    tools: [tool(
      'browse_on_computer',
      `Do something in Chrome on one of the user's computers whose Chrome this session can't reach (${computers.join(', ')}): another computer, or this one when its Chrome is signed in to another Claude account. A separate short Claude session on that Chrome's account does the task there, with its sign-ins, and answers with what it found and screenshots. For when the user asks for Chrome and this topic has none of its own, asks to look on that computer, or a site is signed in to only there; this topic's own Chrome, when on, comes first. It sees nothing of this conversation: give a self-contained task (where to go, what to find or do, what to bring back). When the Claude account that Chrome is signed in to has spent its limit, the errand goes to another computer's Chrome by itself, and the answer says where it was done. A computer that is offline is waited for briefly; when nothing could be done, the answer names each computer and why.`,
      {
        computer: z.enum(computers as [string, ...string[]]),
        task: z.string().min(1).max(4000),
      },
      async p => {
        const r = await run(p)
        if (typeof r === 'string') return { content: [{ type: 'text' as const, text: r }], isError: true }
        return { content: [{ type: 'text' as const, text: r.text || '(no answer)' }, ...r.images.map(i => ({ type: 'image' as const, data: i.data, mimeType: i.mime }))] }
      },
    )],
    alwaysLoad: true,
  })
}

// What the session on the other computer works by
export const errandRules = (from: string) => `

# An errand
You run a task in the browser for Claude working with the user on "${from}"; it reads your answer, the user doesn't. Nobody answers questions: decide yourself, and on a login page or a CAPTCHA stop and say so.
- Do only the task: no purchases, no messages or posts sent, nothing deleted, no passwords typed.
- Answer briefly with what you found or did, facts and links. When a picture helps, take a screenshot with save_to_disk and put its path on a line of its own as "SCREENSHOT: <path>", two at most.`

// Paths of the screenshots the errand named, in its order
export const screenshotPaths = (text: string) => [...text.matchAll(/^SCREENSHOT:\s*(.+?)\s*$/gm)].map(m => m[1]).slice(0, 2)
