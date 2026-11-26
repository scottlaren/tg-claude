// Text on its way to Telegram. A string is cut by its units, and an emoji takes two of them: cut between the two, it
// leaves half a character, and Telegram refuses the whole message for it ("strings must be encoded in UTF-8"). An answer
// was lost that way to one step in its list, a command with an emoji at the seventieth place

const HIGH_FROM = 0xd800
const HIGH_TO = 0xdbff

// The first n units, without half a character at the end
export function cut(s: string, n: number) {
  const out = s.slice(0, Math.max(0, n))
  const last = out.charCodeAt(out.length - 1)
  return last >= HIGH_FROM && last <= HIGH_TO ? out.slice(0, -1) : out
}

export const trunc = (s: string, n: number) => (s.length > n ? cut(s, n - 1) + '…' : s)

// The net under every other cut in the code: whatever leaves for Telegram has no half characters in it. Files and other
// objects that are not plain data go through as they are
export function wellFormed<T>(value: T): T {
  if (typeof value === 'string') return (value.isWellFormed() ? value : value.toWellFormed()) as T
  if (Array.isArray(value)) return value.map(wellFormed) as T
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wellFormed(v)])) as T
  }
  return value
}
