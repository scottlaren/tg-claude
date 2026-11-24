import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// The same remark twice is a rule nobody wrote down. Claude offers it; it is written only on the user's tap
export const RULE_SERVER = 'rules'
export const SUGGEST_RULE = `mcp__${RULE_SERVER}__suggest_rule`

export const RULES_HEADING = '## Rules from corrections'

// The project's CLAUDE.md with one more rule: under its own heading, made at the end when there is none
// The file's own line ends stay: written over with others, all of it would look changed in git
export function withRule(text: string, rule: string) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const line = `- ${rule.replace(/\s+/g, ' ').trim()}`
  const lines = text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n')
  const at = lines.findIndex(l => l.trim() === RULES_HEADING)
  let out: string[]
  if (at < 0) out = [...(lines.join('\n') ? [...lines, ''] : []), RULES_HEADING, '', line]
  else {
    let end = lines.findIndex((l, i) => i > at && /^#{1,2} /.test(l))
    if (end < 0) end = lines.length
    while (end > at + 1 && !lines[end - 1].trim()) end--
    out = [...lines.slice(0, end), line, ...lines.slice(end)]
  }
  return `${out.join(eol)}${eol}`
}

export function createRuleServer(offer: (p: { rule: string, why: string }) => Promise<string>) {
  return createSdkMcpServer({
    name: RULE_SERVER,
    tools: [tool(
      'suggest_rule',
      'Offer to write a rule into this project\'s CLAUDE.md, for a correction the user has now made a second time (in this conversation, or one you remember). The user sees a card and decides with a button; nothing is written without that. Once per correction, never for a one-off wish, and don\'t also ask about it in words.',
      {
        rule: z.string().trim().min(3).max(300).describe('The rule, one line, in the user\'s language, as an instruction for later sessions'),
        why: z.string().trim().min(3).max(200).describe('What the user corrected, briefly, in the user\'s language'),
      },
      async a => ({ content: [{ type: 'text' as const, text: await offer(a) }] }),
    )],
  })
}
