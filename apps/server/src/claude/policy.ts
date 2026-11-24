import type { Mode } from '../store.ts'

export type Decision = 'allow' | 'ask' | 'deny'

// What happens to one tool call under the topic's mode (§13). Reads always pass; questions to
// the user are not permissions and are handled before this
export function decide({ mode, readOnly, fileEdit, allowAllForTask }: {
  mode: Mode, readOnly: boolean, fileEdit: boolean, allowAllForTask: boolean,
}): Decision {
  if (readOnly) return 'allow'
  if (mode === 'read') return 'deny'
  if (mode === 'all') return 'allow'
  if (mode === 'edits' && fileEdit) return 'allow'
  return allowAllForTask ? 'allow' : 'ask'
}
