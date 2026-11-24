import { tr } from '../i18n.ts'
import type { RichButton } from './render.ts'
import { mdText } from './schedule-menu.ts'

// Settings one computer can offer another. The card is the offer: nothing moves without a tap, and keys never move
export type PortableMcp = { name: string, command: string, args: string[], env: string[] }
export type PortableSettings = { mcp: PortableMcp[], rules: string | null }

export function settingsDiff(from: PortableSettings, to: PortableSettings) {
  const there = new Set(to.mcp.map(s => s.name))
  return {
    mcp: from.mcp.filter(s => !there.has(s.name)),
    rules: !!from.rules?.trim() && from.rules.replace(/\r\n/g, '\n').trim() !== (to.rules ?? '').replace(/\r\n/g, '\n').trim(),
  }
}

export function moveCard(fromId: string, toId: string, names: { from: string, to: string }, from: PortableSettings, to: PortableSettings) {
  const diff = settingsDiff(from, to)
  const rows: RichButton[][] = diff.mcp.slice(0, 8).map(s => [{ text: `➕ ${s.name}`, data: `stma:${fromId}:${toId}:${s.name}` }])
  if (diff.rules) rows.push([{ text: tr(`📄 Replace the instructions on ${names.to}`, `📄 Заменить инструкции на ${names.to}`), data: `stmr:${fromId}:${toId}` }])
  rows.push([{ text: tr('← Back', '← Назад'), data: `dv:${fromId}` }])
  const lines = [
    tr(`### 📦 From ${mdText(names.from)} to ${mdText(names.to)}`, `### 📦 С ${mdText(names.from)} на ${mdText(names.to)}`),
    diff.mcp.length || diff.rules
      ? tr('Tap what to move. Nothing moves by itself.', 'Нажми, что перенести. Само ничего не переносится.')
      : tr(`Nothing to move: ${mdText(names.to)} has all of it already.`, `Переносить нечего: на ${mdText(names.to)} уже всё это есть.`),
    ...(diff.mcp.length ? [[
      tr('**MCP servers it lacks:**', '**MCP-серверов там нет:**'),
      ...diff.mcp.map(s => `- \`${s.name}\`${s.env.length ? tr(` · keys stay here: ${s.env.join(', ')}`, ` · ключи останутся здесь: ${s.env.join(', ')}`) : ''}`),
    ].join('\n')] : []),
    ...(diff.rules ? [tr(`**Global instructions** (\`~/.tg-claude-vps/CLAUDE.md\`) differ: moving them replaces the ones on ${mdText(names.to)}.`, `**Общие инструкции** (\`~/.tg-claude-vps/CLAUDE.md\`) отличаются: перенос заменит их на ${mdText(names.to)}.`)] : []),
  ]
  return { md: lines.join('\n\n'), rows }
}
