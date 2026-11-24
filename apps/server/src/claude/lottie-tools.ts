import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// Lottie animations (Telegram's TGS stickers and emoji, JSON, dotLottie) as SVG files: a frame each, drawn on the server
export const LOTTIE_SERVER = 'lottie'
export const LOTTIE_TO_SVG = `mcp__${LOTTIE_SERVER}__lottie_to_svg`

export type LottieRequest = { sources: string[], frame?: 'first' | 'middle' | 'last' | number, to?: 'computer' | 'chat', folder?: string }

export function createLottieServer(convert: (p: LottieRequest) => Promise<string>, hasComputer: boolean) {
  return createSdkMcpServer({
    name: LOTTIE_SERVER,
    tools: [tool(
      'lottie_to_svg',
      'Turn Lottie animations into SVG files, one frame each: the first unless asked otherwise. Any Lottie: Telegram\'s animated stickers and emoji (.tgs), plain JSON, dotLottie (.lottie, every animation in it). Sources: an attachment id from a 📎 line (a file or a sticker the user sent), a custom emoji id the message lists, or the path of a file on the computer. ' +
        (hasComputer
          ? 'The SVGs are written into the project on the computer (folder, default lottie-svg), where you go on with them: sort, rename, open in an app. to: "chat" sends them to the user as one zip instead.'
          : 'This topic has no computer: the SVGs go to the user as one zip.') +
        ' You get back each file\'s name, size and frame, not its contents: read a file only when you need what is inside.',
      {
        sources: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
        frame: z.union([z.enum(['first', 'middle', 'last']), z.number().int().min(0)]).optional().describe('Which frame: first (default), middle, last, or its number from 0'),
        to: z.enum(['computer', 'chat']).optional(),
        folder: z.string().trim().min(1).max(200).optional().describe('Folder in the project, relative to its root; default lottie-svg'),
      },
      async a => ({ content: [{ type: 'text' as const, text: await convert(a) }] }),
    )],
  })
}
