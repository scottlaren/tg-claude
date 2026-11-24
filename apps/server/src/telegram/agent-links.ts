// A head names its agents in its answers, and each name should be the way to that agent's topic. Asking the model to
// write the link is not enough: a head with months of «floor» behind it goes on writing «floor». So the bot does it,
// on the answer itself. Only where the text marks a name as a name: in quotes, in bold, in code, or after the word
// «agent». A bare word is left alone: «prod» is also where a release goes

export type Way = { name: string, link: string }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// What must stay as written: code, links and pictures already there, addresses, tags
const KEPT = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|!?\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/[^\s)>\]]+|<[^>\n]+>/g

const OPEN = '«"“„\'‘'
const CLOSE = '»"”“\'’'

function inText(text: string, ways: Way[]) {
  let out = text
  for (const { name, link } of ways) {
    const n = escape(name)
    const to = (said: string) => `[${said}](${link})`
    out = out
      .replace(new RegExp(`([${OPEN}])(${n})([${CLOSE}])`, 'giu'), (_m, a: string, said: string, b: string) => `${a}${to(said)}${b}`)
      .replace(new RegExp(`\\*\\*(${n})\\*\\*`, 'giu'), (_m, said: string) => `**${to(said)}**`)
      .replace(new RegExp(`((?:агент[а-яё]*|agents?)\\s+)(${n})(?![\\p{L}\\p{N}_-])`, 'giu'), (_m, before: string, said: string) => `${before}${to(said)}`)
  }
  return out
}

export function linkNames(md: string, ways: Way[]) {
  // The longer name first: «floor-2» is not «floor» with something after it
  const sorted = ways.filter(w => w.name.trim() && w.link).sort((a, b) => b.name.length - a.name.length)
  if (!sorted.length || !md) return md
  let out = ''
  let at = 0
  for (const m of md.matchAll(KEPT)) {
    out += inText(md.slice(at, m.index), sorted)
    // A name alone in code is a name too: `floor`
    const code = /^`([^`\n]+)`$/.exec(m[0])?.[1]
    const way = code ? sorted.find(w => w.name.toLowerCase() === code.trim().toLowerCase()) : undefined
    out += way ? `[${code!.trim()}](${way.link})` : m[0]
    at = m.index + m[0].length
  }
  return out + inText(md.slice(at), sorted)
}
