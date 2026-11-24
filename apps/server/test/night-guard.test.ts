import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NIGHT_RULE, nightDeny, nightRefusal } from '../src/claude/night-guard.ts'

const REFUSED: [string, string][] = [
  ['git push', 'git push'],
  ['git push origin main', 'git push'],
  ['git push --dry-run', 'git push'],
  ['cd x && git push', 'git push'],
  ['git status; git push', 'git push'],
  ['git status || git push', 'git push'],
  ['git status | git push', 'git push'],
  ['git status & git push', 'git push'],
  ['git status\ngit push', 'git push'],
  ['FOO=1 git push', 'git push'],
  ['FOO=1 BAR="a b" git push', 'git push'],
  ['env FOO=1 git push', 'git push'],
  ['sudo git push', 'git push'],
  ['timeout 30 git push', 'git push'],
  ['git -C ../repo push', 'git push'],
  ['git -C "../my repo" push', 'git push'],
  ['git -c x=y push', 'git push'],
  ['git -c user.name=a -c user.email=b push origin HEAD:main', 'git push'],
  ['git --git-dir=.git push', 'git push'],
  ['git --no-pager push', 'git push'],
  ['/usr/bin/git push', 'git push'],
  ['"C:\\Program Files\\Git\\bin\\git.exe" push', 'git push'],
  ['C:\\tools\\git.exe push', 'git push'],
  ['git "push"', 'git push'],
  ['git \\\n  push', 'git push'],
  ['git push 2>&1', 'git push'],
  ['2>&1 git push', 'git push'],
  ['git push > out.log', 'git push'],
  ['(git push)', 'git push'],
  ['{ git push; }', 'git push'],
  ['if true; then git push; fi', 'git push'],
  ['bash -c "git push"', 'git push'],
  ['bash -lc \'cd x && git push\'', 'git push'],
  ['cmd /c git push', 'git push'],
  ['powershell -NoProfile -Command "git push"', 'git push'],
  ['eval "git push"', 'git push'],
  ['echo $(git push)', 'git push'],
  ['echo "$(git push)"', 'git push'],
  ['echo `git push`', 'git push'],
  ['echo x | xargs git push', 'git push'],
  ['git commit -m "$(cat <<\'EOF\'\nDon\'t stop (ever)\nEOF\n)" && git push', 'git push'],
  ['git pull', 'git pull'],
  ['git merge agent/x', 'git merge'],
  ['git merge --no-ff agent/x', 'git merge'],
  ['git -C ../repo merge agent/x', 'git merge'],
  ['git merge --continue', 'git merge'],
  ['git rebase main', 'git rebase onto main'],
  ['git rebase origin/main', 'git rebase onto main'],
  ['git rebase --onto master a b', 'git rebase onto main'],
  ['git rebase --onto=origin/main a', 'git rebase onto main'],
  ['git tag v1.0.0', 'git tag'],
  ['git tag -a v1 -m x', 'git tag'],
  ['git subtree push --prefix x origin y', 'git subtree push'],
  ['gh pr merge 12', 'gh pr merge'],
  ['gh pr merge --squash', 'gh pr merge'],
  ['gh --repo a/b pr merge 12', 'gh pr merge'],
  ['gh release create v1', 'gh release create'],
  ['gh release upload v1 f', 'gh release upload'],
  ['npm publish', 'npm publish'],
  ['npm --prefix x publish', 'npm publish'],
  ['pnpm publish', 'pnpm publish'],
  ['npx -y npm@10 publish', 'npm publish'],
  ['docker compose up', 'docker compose up'],
  ['docker compose up -d --build', 'docker compose up'],
  ['docker compose -f x.yml up -d', 'docker compose up'],
  ['cd deploy && docker compose up -d --build', 'docker compose up'],
  ['docker-compose up', 'docker compose up'],
]

const ALLOWED = [
  'git status',
  'git log --oneline',
  'git diff main...HEAD',
  'git diff origin/main',
  'git add .',
  'git commit -m "fix"',
  'git -c user.name=a -c user.email=b commit -m "fix"',
  'git commit -m "before git push && git merge x"',
  'git commit -m "$(cat <<\'EOF\'\nDon\'t git push yet\ngit push\ngit merge x\nEOF\n)"',
  'git commit -F- <<EOF\ngit push\nEOF\ngit status',
  'git fetch origin',
  'git switch -c agent/x',
  'git worktree add ../x -b y',
  'git stash push',
  'git merge-base main HEAD',
  'git merge --abort',
  'git rebase -i HEAD~3',
  'git rebase agent/base',
  'git rebase --abort',
  'git log --grep "git push"',
  'git tag',
  'git tag -l',
  'git tag --list "v*"',
  'git push --help',
  'git push -h',
  'git merge --help',
  'npm publish --help',
  'grep "git push" README.md',
  'grep -rn "git merge" docs && git status',
  'rg \'gh release\' .',
  'echo "git push"',
  'echo git push',
  'sed -i "s/git push/x/" f.md',
  'git status # then git push',
  'cat <<EOF\ngit push\nEOF',
  'gh pr list',
  'gh pr view 12',
  'gh release list',
  'gh release view v1',
  'gh issue create --title release',
  'npm test',
  'npm ci',
  'npm run build',
  'npm view x',
  'docker ps',
  'docker compose logs',
  'docker compose down',
  'ls && pwd',
  '',
]

test('the night guard refuses what merges, pushes or publishes, in the shapes commands come in', () => {
  for (const [command, op] of REFUSED) assert.equal(nightRefusal({ command }), op, command)
})

test('the night guard lets reading and work in the own branch through', () => {
  for (const command of ALLOWED) assert.equal(nightRefusal({ command }), null, command)
})

test('program and args are checked like a command', () => {
  assert.equal(nightRefusal({ program: 'git', args: ['-C', 'x', 'push'] }), 'git push')
  assert.equal(nightRefusal({ program: 'C:\\Git\\git.exe', args: ['push'] }), 'git push')
  assert.equal(nightRefusal({ program: 'bash', args: ['-c', 'git push'] }), 'git push')
  assert.equal(nightRefusal({ program: 'git', args: ['status'] }), null)
  assert.equal(nightRefusal({ program: 'grep', args: ['git push', 'f'] }), null)
  assert.equal(nightRefusal({}), null)
})

test('a script file is out of its reach, and that is said out loud', () => {
  assert.equal(nightRefusal({ command: './deploy.sh' }), null)
  assert.equal(nightRefusal({ command: 'bash deploy.sh' }), null)
})

test('what Claude reads tells it to wait for the morning and where the switch is', () => {
  assert.match(nightDeny('git push'), /git push.*morning.*button/s)
  for (const word of ['own branch', 'merge', 'push', 'tag', 'release', 'deploy', 'publish', 'final answer', 'button']) assert.ok(NIGHT_RULE.includes(word), word)
})
