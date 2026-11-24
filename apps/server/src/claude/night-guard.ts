// Night mode's check of run_command, and the one that keeps computers from being turned off. It reads a command the way a
// shell would, well enough that `grep "git push" f` is not a push and `cd x && FOO=1 git -C y push` is. This is a guard against mistakes, not a sandbox: a script file, a
// git alias, `$VAR push` or a package.json script can still do all of it, and the rule in the prompt is what covers those

const HEREDOC = /^<<-?\s*(?:'([^']*)'|"([^"]*)"|\\?([^\s;&|<>()'"]+))/
const REDIRECT = /^(?:&>>?|>>|>&|>\||<&|<>|<<<|>|<)/
const ASSIGNMENT = /^[A-Za-z_]\w*=/
const KEYWORDS = new Set(['{', '}', '!', 'if', 'then', 'elif', 'else', 'fi', 'do', 'done', 'while', 'until'])
const WRAPPERS = new Set(['env', 'sudo', 'command', 'builtin', 'exec', 'nohup', 'time', 'nice', 'ionice', 'timeout', 'xargs', 'npx', 'winpty', 'call', 'start'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'cmd', 'powershell', 'pwsh'])
const EVALS = new Set(['eval', 'iex', 'invoke-expression'])
const NPMS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const GUARDED = new Set(['git', 'gh', 'docker', 'docker-compose', ...NPMS])
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path', '--attr-source'])
const REBASE_CONTROL = new Set(['--abort', '--quit', '--continue', '--skip', '--edit-todo', '--show-current-patch'])
const MAIN_BRANCH = /^(?:--onto=)?(?:\S*\/)?(?:main|master)$/
const TAG_READS = /^(?:-l|--list|-v|--verify|-n\d*|--contains|--no-contains|--merged|--no-merged|--points-at|--sort(?:=.*)?|--format(?:=.*)?)$/
const MAX_DEPTH = 5

// Lines of a heredoc are text, not commands. What a shell reads from one (`bash <<EOF`) goes unseen, like a script file
function skipBodies(src: string, from: number, delims: string[]) {
  let i = from
  for (const delim of delims) {
    for (;;) {
      if (i >= src.length) return src.length
      const eol = src.indexOf('\n', i)
      const end = eol < 0 ? src.length : eol
      const line = src.slice(i, end).replace(/\r$/, '').replace(/^\t+/, '')
      i = end + 1
      if (line === delim) break
    }
  }
  return i
}

const heredocAt = (src: string, i: number) => {
  const m = HEREDOC.exec(src.slice(i, i + 256))
  return m ? { delim: m[1] ?? m[2] ?? m[3], length: m[0].length } : null
}

function closeDouble(src: string, open: number) {
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i]
    if (c === '\\') i++
    else if (c === '"') return i
    else if (c === '`') {
      const end = src.indexOf('`', i + 1)
      i = end < 0 ? src.length : end
    } else if (c === '$' && src[i + 1] === '(') i = closeParen(src, i + 2)
  }
  return src.length
}

// A heredoc inside `$(...)` is how commit messages arrive, and an apostrophe in one must not swallow the rest of the command
function closeParen(src: string, from: number) {
  let depth = 1
  const pending: string[] = []
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (c === '\\') i++
    else if (c === "'") {
      const end = src.indexOf("'", i + 1)
      i = end < 0 ? src.length : end
    } else if (c === '"') i = closeDouble(src, i)
    else if (c === '<') {
      const h = heredocAt(src, i)
      if (h) {
        pending.push(h.delim)
        i += h.length - 1
      }
    } else if (c === '\n' && pending.length) {
      i = skipBodies(src, i + 1, pending) - 1
      pending.length = 0
    } else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return src.length
}

// Simple commands as lists of words, and the text of every `$(...)` and backtick to look into as well
function scan(src: string) {
  const segments: string[][] = []
  const inner: string[] = []
  const pending: string[] = []
  let words: string[] = []
  let word: string | null = null
  let dropNext = false
  const endWord = () => {
    if (word === null) return
    if (dropNext) dropNext = false
    else words.push(word)
    word = null
  }
  const endSegment = () => {
    endWord()
    dropNext = false
    if (words.length) segments.push(words)
    words = []
  }
  const substitution = (body: string) => {
    inner.push(body)
    word = `${word ?? ''}$()`
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      const next = src[i + 1]
      if (next === '\n') i += 2
      // Before an ordinary character a backslash means nothing to bash but is part of a path on Windows: C:\tools\git.exe
      else if (next !== undefined && /[\s"'\\$`&|;()<>#]/.test(next)) {
        word = `${word ?? ''}${next}`
        i += 2
      } else {
        word = `${word ?? ''}\\`
        i++
      }
    } else if (c === "'") {
      const end = src.indexOf("'", i + 1)
      const stop = end < 0 ? src.length : end
      word = `${word ?? ''}${src.slice(i + 1, stop)}`
      i = stop + 1
    } else if (c === '"') {
      const stop = closeDouble(src, i)
      let text = ''
      for (let j = i + 1; j < stop; j++) {
        const d = src[j]
        if (d === '\\' && /["\\$`]/.test(src[j + 1] ?? '')) text += src[++j]
        else if (d === '$' && src[j + 1] === '(') {
          const end = closeParen(src, j + 2)
          inner.push(src.slice(j + 2, end))
          j = end
        } else if (d === '`') {
          const end = src.indexOf('`', j + 1)
          const close = end < 0 ? stop : end
          inner.push(src.slice(j + 1, close))
          j = close
        } else text += d
      }
      word = `${word ?? ''}${text}`
      i = stop + 1
    } else if (c === '$' && src[i + 1] === '(') {
      const end = closeParen(src, i + 2)
      substitution(src.slice(i + 2, end))
      i = end + 1
    } else if (c === '`') {
      const end = src.indexOf('`', i + 1)
      const stop = end < 0 ? src.length : end
      substitution(src.slice(i + 1, stop))
      i = stop + 1
    } else if (c === '#' && word === null) {
      const eol = src.indexOf('\n', i)
      i = eol < 0 ? src.length : eol
    } else if (c === '\n') {
      endSegment()
      i = pending.length ? skipBodies(src, i + 1, pending) : i + 1
      pending.length = 0
    } else if (/\s/.test(c)) {
      endWord()
      i++
    } else if (c === '<' || c === '>' || (c === '&' && src[i + 1] === '>')) {
      const h = c === '<' ? heredocAt(src, i) : null
      // The number in 2>&1 and the file after > are no part of the command
      if (word !== null && /^\d+$/.test(word)) word = null
      endWord()
      if (h) {
        pending.push(h.delim)
        i += h.length
      } else {
        i += REDIRECT.exec(src.slice(i, i + 3))![0].length
        dropNext = true
      }
    } else if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')') {
      endSegment()
      i++
    } else {
      word = `${word ?? ''}${c}`
      i++
    }
  }
  endSegment()
  return { segments, inner }
}

const nameOf = (word: string) => word
  .replace(/^.*[\\/]/, '')
  .toLowerCase()
  .replace(/\.(?:exe|cmd|bat|ps1)$/, '')
  .replace(/(.)@.*$/, '$1')

function gitOp(args: string[]) {
  let i = 0
  while (i < args.length && args[i].startsWith('-')) i += GIT_VALUE_OPTS.has(args[i]) ? 2 : 1
  const [sub, ...rest] = args.slice(i)
  if (sub === 'push' || sub === 'pull') return `git ${sub}`
  if (sub === 'merge') return rest.includes('--abort') || rest.includes('--quit') ? null : 'git merge'
  if (sub === 'rebase') return !rest.some(a => REBASE_CONTROL.has(a)) && rest.some(a => MAIN_BRANCH.test(a)) ? 'git rebase onto main' : null
  if (sub === 'tag') return !rest.length || rest.some(a => TAG_READS.test(a)) ? null : 'git tag'
  if ((sub === 'subtree' || sub === 'lfs') && rest.includes('push')) return `git ${sub} push`
  return null
}

function ghOp(args: string[]) {
  const words: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-R' || args[i] === '--repo') i++
    else if (!args[i].startsWith('-')) words.push(args[i])
  }
  if (words[0] === 'pr' && words[1] === 'merge') return 'gh pr merge'
  if (words[0] === 'release' && words[1] && !['list', 'view', 'download'].includes(words[1])) return `gh release ${words[1]}`
  return null
}

const dockerOp = (name: string, args: string[]) => {
  if (name === 'docker-compose') return args.includes('up') ? 'docker compose up' : null
  const compose = args.indexOf('compose')
  return compose >= 0 && args.slice(compose + 1).includes('up') ? 'docker compose up' : null
}

function guardedOp(name: string, args: string[]) {
  if (args.includes('--help') || args.includes('-h')) return null
  if (name === 'git') return gitOp(args)
  if (name === 'gh') return ghOp(args)
  if (NPMS.has(name)) return args.includes('publish') ? `${name} publish` : null
  return dockerOp(name, args)
}

// What one check looks for: the programs worth finding behind wrappers, and what each of them does that it refuses
type Watch = { names: ReadonlySet<string>, op: (name: string, args: string[]) => string | null }
const NIGHT: Watch = { names: GUARDED, op: guardedOp }

function wordsOp(words: string[], depth: number, watch: Watch): string | null {
  let w = words
  for (;;) {
    while (w.length && (ASSIGNMENT.test(w[0]) || KEYWORDS.has(w[0]))) w = w.slice(1)
    if (!w.length || !WRAPPERS.has(nameOf(w[0]))) break
    // What a wrapper runs comes after its own options, some with values: go to the first thing worth looking at
    const next = w.findIndex((x, i) => {
      if (i === 0 || x.startsWith('-')) return false
      const name = nameOf(x)
      return watch.names.has(name) || SHELLS.has(name) || EVALS.has(name) || WRAPPERS.has(name)
    })
    if (next < 0) return null
    w = w.slice(next)
  }
  if (!w.length) return null
  const name = nameOf(w[0])
  const args = w.slice(1)
  if (SHELLS.has(name)) {
    const flag = args.findIndex(a => /^(?:-[a-z]*c|-command|\/c|\/k)$/i.test(a))
    return flag < 0 ? null : commandOp(args.slice(flag + 1).join(' '), depth + 1, watch)
  }
  if (EVALS.has(name)) return commandOp(args.join(' '), depth + 1, watch)
  return watch.names.has(name) ? watch.op(name, args) : null
}

function commandOp(src: string, depth: number, watch: Watch): string | null {
  if (depth > MAX_DEPTH) return null
  const { segments, inner } = scan(src)
  for (const words of segments) {
    const op = wordsOp(words, depth, watch)
    if (op) return op
  }
  for (const body of inner) {
    const op = commandOp(body, depth + 1, watch)
    if (op) return op
  }
  return null
}

// What the night guard refuses in this run_command call, by name, or null. --help and read-only forms pass: they change nothing
type CommandInput = { command?: unknown, program?: unknown, args?: unknown }
function refusal(input: CommandInput, watch: Watch): string | null {
  if (typeof input.program === 'string' && input.program) {
    const args = Array.isArray(input.args) ? input.args.map(String) : []
    const op = wordsOp([input.program, ...args], 0, watch)
    if (op) return op
  }
  return typeof input.command === 'string' ? commandOp(input.command, 0, watch) : null
}
export const nightRefusal = (input: CommandInput) => refusal(input, NIGHT)

// Turning a computer off or restarting it. The user wakes a computer from afar, and only one asleep wakes: off, it stays
// off until someone is at home. Sleep and hibernation, cancelling a planned shutdown and logging out pass
const POWER_NAMES = new Set(['shutdown', 'halt', 'poweroff', 'reboot', 'stop-computer', 'restart-computer', 'systemctl', 'loginctl', 'init', 'telinit', 'osascript', 'pmset', 'rundll32'])
const POWER_UNITS = /^(?:poweroff|reboot|halt|kexec|soft-reboot)$/
const MAC_POWER = /\b(?:shut\s*down|restart)\b/i
// Windows' /s /p /r /g /sg; Unix's -h, -r, -P, alone or together (-h on Windows hibernates: written /h, it passes)
const SHUTDOWN_OFF = /^(?:[/-](?:s|p|r|g|sg)|-[a-z]*[hrp][a-z]*)$/i
// Windows' /a and Unix's -c cancel a planned one, /h hibernates, /l logs out
const SHUTDOWN_SAFE = /^(?:[/-]a|-c|\/h|[/-]l|--help|\/\?)$/i
function powerOp(name: string, args: string[]): string | null {
  if (name === 'shutdown') return args.some(a => SHUTDOWN_SAFE.test(a)) && !args.some(a => SHUTDOWN_OFF.test(a)) ? null : 'shutdown'
  if (name === 'halt' || name === 'poweroff' || name === 'reboot' || name === 'stop-computer' || name === 'restart-computer') return name
  if (name === 'systemctl' || name === 'loginctl') return args.find(a => POWER_UNITS.test(a)) ? `${name} ${args.find(a => POWER_UNITS.test(a))}` : null
  if (name === 'init' || name === 'telinit') return args.some(a => a === '0' || a === '6') ? `${name} ${args.find(a => a === '0' || a === '6')}` : null
  if (name === 'osascript') return MAC_POWER.test(args.join(' ')) ? 'osascript shut down or restart' : null
  if (name === 'pmset') return args.some(a => /^(?:schedule|repeat)$/.test(a)) && args.some(a => /^(?:shutdown|restart)$/.test(a)) ? 'pmset scheduled shutdown' : null
  return args.some(a => /ExitWindowsEx/i.test(a)) ? 'rundll32 ExitWindowsEx' : null
}
const POWER: Watch = { names: POWER_NAMES, op: powerOp }
export const powerRefusal = (input: CommandInput) => refusal(input, POWER)

// Claude reads this
export const powerDeny = (op: string) => `Turning the computer off or restarting it is not allowed (${op}): the user wakes their computers from afar, and only one asleep can be woken. Put it to sleep if it must stop (a night shift does that itself at its end), or leave it on and say so in your answer. This holds even if the user asked for it in this conversation: they can do it themselves. Don't work around this with a script or another command.`

// Claude reads this. One rule with no exceptions: a request from the user in the chat is refused too, and the button on
// the night shift's card is the way out
export const nightDeny = (op: string) => `Night mode is on in this chat, so this is refused: ${op}. Leave it for the morning: commit in your own branch and put in your final answer what is waiting for the user. This holds even if the user asked for it in this conversation: tell them to turn off the button the user gets to allow merging and releasing for the night shift first. Don't work around this with a script or another command.`

export const NIGHT_RULE = `

# Night mode
Night mode is on in this chat: the user decides in the morning. This overrides anything above about merging or releasing.
- Work only in your own branch and commit there. If the project is on its main branch or one you share with others, make a branch of your own first.
- Never merge, push, tag, release, deploy or publish: not with a command, not with a script, not through any other tool. Leave it for the morning.
- Put in your final answer what is waiting for the user: which branch, which commits, what they have to decide.
- If the user asks for one of these directly while night mode is on, it is still refused: words can't lift it. The user has a button to allow merging and releasing for the rest of the shift.`
