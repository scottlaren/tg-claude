import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { screenParams, type ScreenParams, type ScreenResult } from '@tgcv/protocol'
import { z } from 'zod'

// The computer's screen for Claude: asked for with a card like Chrome, then one tool that takes a batch of actions and
// answers with what happened and a screenshot
export const SCREEN_ACCESS_SERVER = 'screen_access'
export const ASK_FOR_SCREEN = `mcp__${SCREEN_ACCESS_SERVER}__ask_for_screen`
export const SCREEN_SERVER = 'screen'
export const SCREEN_TOOL = `mcp__${SCREEN_SERVER}__screen`

export function createScreenAskServer(device: string, ask: (p: { reason: string }) => Promise<string>) {
  return createSdkMcpServer({
    name: SCREEN_ACCESS_SERVER,
    tools: [tool(
      'ask_for_screen',
      `Ask the user to let you see and drive the screen of "${device}" (any app's windows, their controls, and the mouse and keyboard while the user is away) for this task. For what nothing else reaches: a system dialog (Open or Save a file), an app with no tools of its own, a step an app's tools can't do. Not for what files, commands or an app's own tools can do. They answer with buttons.`,
      { reason: z.string().min(1).max(200).describe('One short line in the user\'s language: what you will do on the screen') },
      async a => ({ content: [{ type: 'text' as const, text: await ask(a) }] }),
    )],
    alwaysLoad: true,
  })
}

const DESCRIPTION = (device: string, readOnly: boolean, mac: boolean) => [
  `See and drive the screen of "${device}": a batch of actions in one call, in order, then a screenshot of the result.`,
  'window: part of a window\'s title or its app (as `windows` lists them). It stays where it is: screenshots show it alone, as it draws itself, even under other windows, and coordinates are of it. Without one, the whole screen.',
  'Actions: screenshot; zoom {region: [x, y, w, h]} (that part at full resolution, to read small text); windows; elements {filter?} (the window\'s controls as refs with their centre in the screenshot);' +
    (readOnly ? '' : [
      ' Without the user\'s mouse or keyboard, while they work: press {ref} (a button, checkbox, tab, menu item); set {ref, text} (a text box\'s whole value); select {ref} (a list item, a radio button); expand {ref, open?} (a combo box, a tree item, a menu); scroll {ref, dy? (+ down), dx?} (the list or page around it);',
      mac ? '' : ' park (the window to a virtual monitor, out of the user\'s sight; unpark brings every parked window back, as does the end of the task).',
      ` With the real mouse and keyboard, which wait until the user has left the computer alone for a minute: click {at: [x, y] | ref, button?, count? (2 = double)}; move {at | ref}; drag {from, to}; scroll {at}; type {text} (any language; long text goes through the clipboard, which is put back); key {keys: ${mac ? '"cmd+s", "enter", "cmd+tab"… (cmd is ⌘, ctrl is ⌃)' : '"ctrl+s", "enter", "alt+tab"…'}}; focus {window} (brings it to the front and leaves it there).`,
    ].join('')) +
    ' wait {ms?} (until the screen settles).',
  'Coordinates are pixels of the last screenshot; a ref is from the last elements list. After each change the screen settles before the next action.',
  readOnly ? 'This topic is read-only: looking actions only.' : '',
].filter(Boolean).join(' ')

const resultContent = (r: ScreenResult) => [
  { type: 'text' as const, text: [...r.log, r.stopped ?? ''].filter(Boolean).join('\n') },
  ...(r.image ? [{ type: 'image' as const, data: r.image.data, mimeType: r.image.mime }] : []),
]

export function createScreenServer(device: string, readOnly: boolean, mac: boolean, run: (p: ScreenParams) => Promise<ScreenResult | string>) {
  return createSdkMcpServer({
    name: SCREEN_SERVER,
    tools: [tool(
      'screen',
      DESCRIPTION(device, readOnly, mac),
      screenParams,
      async p => {
        const r = await run(p as ScreenParams)
        return typeof r === 'string' ? { content: [{ type: 'text' as const, text: r }], isError: true } : { content: resultContent(r) }
      },
    )],
    alwaysLoad: true,
  })
}

// What Claude is told while the screen is its: when to use it at all, how to use it well, what never to do
export const screenBlock = (device: string, mac: boolean) => `
You can see and drive the screen of "${device}" with the screen tool. The user may be working on it at the same time.
- An app with tools of its own (After Effects, Blender, Roblox Studio; Chrome through Claude in Chrome) goes through them. The screen is for the rest: system dialogs, apps with no tools, a step their tools can't do.
- Name the window you work in (window: part of its title or app, as windows lists them: names may be in the system's language): it stays where it is, and the screenshot shows it alone.
- Work in the background first: list the controls with elements and use press, set, select, expand and scroll by ref. They don't touch the user's mouse or keyboard, so the user keeps working.
- click, type, key, drag and focus need the real mouse and keyboard: they wait until the user has left the computer alone for a minute, give the cursor and the window back after, and stop the moment the user touches them. Use them only for what has no ref or doesn't answer the element actions (canvases, games, some Electron apps).
${mac ? '' : "- A window you opened yourself for a long job can go out of the user's sight with park, if the computer has a virtual monitor; it comes back at the end of the task.\n"}- Put what you are sure of into one call: each call costs a screenshot. Look again before deciding anything new; zoom to read small text.
- In an Open or Save dialog, set the file name box to the full path and press the Open or Save button, rather than clicking through folders.
- If a result says the user came back, go on in the background or tell them in the chat what you are waiting for; don't fight them for the mouse.
- Never type passwords, codes or payment details, and never confirm a purchase, a deletion or sending anything on the user's behalf unless they asked for exactly that in this conversation.`
