// Claude Code tells every session a few things about where it runs, and nothing switches that off: the e-mail address of
// the account, the kernel, the folder. In a companion chat people other than the owner can ask for them, so every text
// leaving for such a chat is searched for them first, and one that carries any is not sent.
// It catches a value written out, with other letters between its characters, backwards, in look-alike letters, in rot13,
// base64 or hex. A value retold in words or one character a message is beyond it: the instructions are what stands
// against that, and this is the net under them.
export type Secret = { kind: 'e-mail' | 'system' | 'folder', value: string }

const LOOKALIKE: Record<string, string> = { а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ѕ: 's', ј: 'j' }
// Only letters and digits: whatever is put between the characters of a value falls out
export const squash = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[авекмнорстухіѕј]/g, c => LOOKALIKE[c]).replace(/[^a-z0-9]/g, '')
const reverse = (s: string) => [...s].reverse().join('')
const rot13 = (s: string) => s.replace(/[a-z]/g, c => String.fromCharCode((c.charCodeAt(0) - 97 + 13) % 26 + 97))
// Shorter than this a value is found in ordinary words
const MIN = 6

type Needle = { kind: Secret['kind'], all: string[] }

// One value as the forms it is looked for in. all: every one of them has to be there
function needles(s: Secret): Needle[] {
  const value = s.value.trim().toLowerCase()
  const whole = squash(value)
  if (whole.length < MIN) return []
  const out = [[whole], [squash(Buffer.from(value).toString('base64'))], [Buffer.from(value).toString('hex')]]
  if (s.kind === 'e-mail') {
    const [name, host = ''] = value.split('@')
    const local = squash(name)
    // A name with digits in it is nobody's word. A plain one is, so alone it says nothing: with its host it does
    if (local.length >= MIN && /\d/.test(local)) out.push([local])
    else if (local.length >= 3 && squash(host.split('.')[0]).length >= 3) out.push([local, squash(host.split('.')[0])])
  }
  // 6.8.0-147-generic is as much given away by its numbers alone
  const digits = whole.replace(/[a-z]/g, '')
  if (s.kind === 'system' && /\d\.\d/.test(value) && digits.length >= MIN) out.push([digits])
  return out.map(all => ({ kind: s.kind, all }))
}

export function createLeakGuard(secrets: Secret[]) {
  const wanted = secrets.flatMap(needles)
  // The kinds of what the text gives away, none when it is clean
  return (text: string): Secret['kind'][] => {
    const plain = squash(text)
    const forms = [plain, reverse(plain), rot13(plain)]
    const found = wanted.filter(n => forms.some(f => n.all.every(part => f.includes(part))))
    return [...new Set(found.map(n => n.kind))]
  }
}

export type LeakGuard = ReturnType<typeof createLeakGuard>
