// Worktrees of branches that are merged stay behind as folders, a few more after every team. Which of them can go: the
// branch is in the repository's HEAD, nothing in the folder is uncommitted, and no agent still works in it. git itself
// refuses the rest when they are removed, so a mistake here costs a refusal, not work

export type Worktree = { folder: string, branch?: string }

// `git worktree list --porcelain`: blocks of lines, the main checkout first
export function parseWorktrees(out: string): Worktree[] {
  return out.replace(/\r\n/g, '\n').split('\n\n').map(block => {
    const folder = /^worktree (.+)$/m.exec(block)?.[1]
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]
    return folder ? { folder, ...(branch && { branch }) } : null
  }).filter((w): w is Worktree => !!w).slice(1)
}

const same = (a: string, b: string) => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

// busy: folders an agent or a topic still works in
export function cleanable(list: Worktree[], busy: string[]) {
  return list.filter(w => w.branch && !busy.some(b => same(b, w.folder)))
}

export const folderName = (folder: string) => folder.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? folder
