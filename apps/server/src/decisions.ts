import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

// A workspace's decisions: one readable markdown file per group, under the data folder. Nothing here is removed with the
// workspace: a group that comes back finds its decisions, so the file goes only line by line, at the owner's tap
export type Decision = { id: string, date: string, text: string }

export const DECISION_MAX_CHARS = 500
export const MAX_DECISIONS = 300

const LINE = /^- (\d{4}-\d{2}-\d{2}) `([0-9a-f]+)` (.+)$/

// One line each, always: a line break in a decision could pass for a section of the prompt it goes back into
export const oneLine = (text: string) => text
  .replace(/[\s\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
  .trim()

const parse = (line: string): Decision | null => {
  const m = LINE.exec(line.trimEnd())
  return m ? { date: m[1], id: m[2], text: m[3] } : null
}

export function createDecisionStore(dir: string) {
  const file = (chatId: number) => join(dir, `${chatId}.md`)
  const read = (chatId: number) => {
    try {
      return readFileSync(file(chatId), 'utf8')
    } catch {
      return ''
    }
  }
  const write = (chatId: number, content: string) => {
    mkdirSync(dir, { recursive: true })
    const tmp = `${file(chatId)}.tmp`
    writeFileSync(tmp, content)
    renameSync(tmp, file(chatId))
  }
  const list = (chatId: number) => read(chatId).split('\n').flatMap(l => parse(l) ?? [])
  return {
    // Oldest first, as in the file. Read each time: a line edited by hand on the server counts at once
    list,
    // The group got a new id
    move(from: number, to: number) {
      if (existsSync(file(from))) renameSync(file(from), file(to))
    },
    add(chatId: number, raw: string, date: string, title?: string): { added: Decision } | { problem: 'empty' | 'same' | 'full' } {
      const text = oneLine(raw).slice(0, DECISION_MAX_CHARS)
      if (!text) return { problem: 'empty' }
      const now = list(chatId)
      if (now.some(d => d.text === text)) return { problem: 'same' }
      if (now.length >= MAX_DECISIONS) return { problem: 'full' }
      const added = { id: randomBytes(4).toString('hex'), date, text }
      const before = read(chatId) || `# Decisions${title ? `: ${oneLine(title)}` : ''}\n\n`
      write(chatId, `${before}${before.endsWith('\n') ? '' : '\n'}- ${date} \`${added.id}\` ${text}\n`)
      return { added }
    },
    remove(chatId: number, id: string) {
      const lines = read(chatId).split('\n')
      const kept = lines.filter(l => parse(l)?.id !== id)
      if (kept.length === lines.length) return false
      write(chatId, kept.join('\n'))
      return true
    },
  }
}

export type DecisionStore = ReturnType<typeof createDecisionStore>
