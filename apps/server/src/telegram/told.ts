import { createHash } from 'node:crypto'

// A conversation that goes on keeps the instructions it began with: the SDK records the system prompt on the first
// request and sends that record afterwards, whatever a later turn passes, until the conversation is compacted or a new
// one starts. The parts of the instructions that change while a conversation lives (a night shift begins, the topic
// becomes read-only, a browser is switched on, a skill is installed) therefore never reached a conversation already
// under way. They are said in the user's turn instead, once, when they change: the bot keeps count of what each
// conversation was last told

// sig: what tells a change, when it isn't the text (a file's content, said as a pointer to the file).
// core: said to a conversation that began before the bot kept count, which may never have seen it
export type Section = { id: string, text: string, sig?: string, core?: boolean }
// By section: the hash of what the conversation knows, and its heading, to name it when it goes
export type Told = Record<string, { h: string, t: string }>

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12)
const titleOf = (text: string) => /^#+ .+$/m.exec(text)?.[0] ?? ''

export const toldOf = (sections: Section[]): Told =>
  Object.fromEntries(sections.filter(s => s.text).map(s => [s.id, { h: hash(s.sig ?? s.text), t: titleOf(s.text) }]))

// known: what the conversation was last told. 'legacy': it began before any count was kept; it gets what matters most,
// whether or not it once had it. Empty when there is nothing to say
export function instructionNotes(known: Told | 'legacy', sections: Section[]) {
  const now = toldOf(sections)
  const fresh = sections.filter(s => s.text && (known === 'legacy' ? s.core : known[s.id]?.h !== now[s.id].h))
  const gone = known === 'legacy' ? [] : Object.entries(known).filter(([id, k]) => !now[id] && k.t).map(([, k]) => k.t)
  if (!fresh.length && !gone.length) return ''
  return [
    `[From the bot, not the user's words. Your instructions have changed since this conversation began, and what you were given then is all you see of them. ${fresh.length ? 'These sections are in force now, in place of any earlier version of them:' : ''}`.trimEnd(),
    ...fresh.map(s => s.text.trim()),
    `${gone.length ? `No longer in force: ${gone.map(t => `"${t}"`).join(', ')}.` : ''}]`,
  ].filter(Boolean).join('\n\n').replace(/\n\n\]$/, ']')
}
