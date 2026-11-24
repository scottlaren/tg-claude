import { query } from '@anthropic-ai/claude-agent-sdk'

const PROMPT = `Make up a short title for a chat from the user's first message.
2–5 words, up to 40 characters, in the language of the message. The gist of the task, not a retelling: "Coffee shop website", "AE export bug", "Logo animation".
No quotes, emoji or final period. Reply with the title only.

Message:
`

// What a model returns, made safe for a topic name: one line, no quotes or trailing dot, sane length
export function cleanTitle(raw: string) {
  const line = raw.split('\n').map(l => l.trim()).find(Boolean) ?? ''
  let title = line.replace(/^(название|title)\s*:\s*/i, '').replace(/\.$/, '').trim()
  // Quotes come off only when they wrap the whole title: «Cafe «Mocha»» keeps its inner pair; «название:» is
  // the Russian «title:»
  if (/^(«.*»|".*"|'.*'|`.*`|\*\*.*\*\*)$/.test(title)) title = title.replace(/^(«|"|'|`|\*\*)|(»|"|'|`|\*\*)$/g, '').trim()
  return title.length >= 2 && title.length <= 60 ? title : null
}

// A topic's name from its first message: a few words about the task instead of the message cut at 60 letters.
// A small model, no tools, nothing saved as a session; null when it fails, and the caller keeps the plain cut
export async function topicTitle(text: string, { cwd, env }: { cwd: string, env: Record<string, string | undefined> }): Promise<string | null> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 30_000)
  try {
    const q = query({
      prompt: PROMPT + text.slice(0, 2000),
      options: {
        cwd, env, model: 'haiku', tools: [], settingSources: [], strictMcpConfig: true,
        persistSession: false, maxTurns: 1, abortController: abort, verbatimPrompts: true,
      },
    })
    for await (const m of q) {
      if (m.type === 'result') return m.subtype === 'success' ? cleanTitle(m.result) : null
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
