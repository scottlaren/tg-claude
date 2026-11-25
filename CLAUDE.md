# tg-claude

A personal Claude client with a Telegram interface. The **server** (Telegram bot, Claude Agent SDK, gateway) runs in
Docker on a VPS; **agents** run on the user's Windows and Mac computers and execute Claude's tools there (files,
commands, apps, MCP). Repository: `scottlaren/tg-claude`. Product spec: `docs/telegram-claude-client-spec.md`,
history: `CHANGELOG.md`, setup: `README.md`.

## Layout

- `apps/server/src`: the bot (`telegram/bot.ts` and its modules), Claude turns (`claude/`), the gateway computers
  connect to (`gateway.ts`), updates (`updates.ts`), media (`media.ts`), the agent install scripts and routes
  (`install*.ts`, `install-agent.sh`, `install-agent.ps1`)
- `apps/agent/src`: the agent: tools (`executor.ts`, `files.ts`, `command.ts`), working folders (`workspace.ts`,
  `zones.ts`), autostart (`service.ts`), self-update (`self-update.ts`), browsers (`chrome*.ts`)
- Companion chats (`apps/server/src/telegram/companion.ts`, `claude/companion.ts`, `companions.ts`): groups where the bot
  only talks, to everyone in them. They are not workspaces and are kept in a store of their own. Every update of such a
  chat stops in `companion.handle` (the corridor at the top of `bot.ts`); a session there has its own instructions and
  no tool that reaches the server or a computer: it searches, and reads pages at public addresses. Keep it so: nothing built for the
  owner's work may start answering in a companion chat
- `packages/protocol/src/index.ts`: the server ↔ agent protocol. `DEVICE_TOOLS` are Claude's tools; `DEVICE_OPS`
  are operations only the bot sends at the user's taps (working folders, updates, sign-in window) and are never
  offered to Claude
- `deploy/`: `Dockerfile`, `compose.yml`, `install-server.sh`, and `tgcv-update.sh` (the update helper that runs as
  root on the VPS, outside the containers)

Node 24 runs the TypeScript directly: no build step. npm workspaces.

## Checks

```bash
npx tsc -p tsconfig.json
npm test
```

Both must be clean before a commit. Tests use `node:test`; one process per test file. A test must never reach a real
app, process or setting of the computer it runs on.

`npm run test:e2e` (about 20 minutes, in `test-e2e/`, not part of `npm test`) walks the whole product with the real server
and agent processes; only Telegram and Claude are faked. `E2E_DUMP=<path>` writes all outgoing messages to a file, for
replaying against the real Telegram parser. The real server runs on Linux: before a big release run `npm test` there too.

## Code

- ES modules, no semicolons, small functions. Match the surrounding code; comments say why, not what.
- **Language.** The project is English: code, comments, docs, the changelog (its entries get a Russian copy, see releases), logs, everything the agent and the
  scripts print, and every text Claude reads (prompts, tool results, deny messages).
- **The bot's texts are bilingual**: `tr('English', 'Русский')` and `count(n, [...], [...])` from
  `apps/server/src/i18n.ts`. Call them when the text is shown, never in a module-level constant (the language
  switches at runtime with `/language`); for a label table use getters. Tests that check Russian texts call
  `setLang('ru')` at the top of their file.
- `install-agent.sh` runs on macOS's bash 3.2: write `${NAME}`, never `$NAME` right before a non-ASCII character
  (a test enforces it). `install-agent.ps1` runs in Windows PowerShell 5.1: keep it plain ASCII.
- Paths, autostart entries and pipes on computers keep the old name `tg-claude-vps` (`~/.tg-claude-vps`,
  `dev.tg-claude-vps.agent`): installed computers depend on them. Don't rename them.

## Secrets

Never read, print or commit `.env`, `agent.config*.json`, `agent.state.json`, `agent.chrome.json`, `agent.mcp.json`, `agent.audit.log`,
`.credentials.json`, `data/`, `backups/`. Never repeat a token in chat. The GitHub token lives only on the VPS
(`/etc/tgcv/github-token`), never in a container or a URL.

## Git and releases

Commit and push only when the user asks. `main` always equals the newest release. Commit as the user's noreply
identity, without touching the global git config:

```bash
git -c user.name=scottlaren -c user.email=105543365+scottlaren@users.noreply.github.com commit
```

Commit messages: an English subject that says what changed for the user, a body that says why. No
`Co-Authored-By:` line: the repository is public and lists its author only.

"Release X.Y.Z" means:

1. In `CHANGELOG.md`, `## Unreleased` becomes `## X.Y.Z` (entries are written for users: a short bold name ending in a period, then one or two short sentences; never half a sentence in bold; English first, then the same entries in Russian under `### Русский`, which the bot shows by its language).
2. Commit the work.
3. Bump `"version"` in `package.json`, `apps/agent/package.json`, `apps/server/package.json`,
   `packages/protocol/package.json` and the five matching fields of `package-lock.json`; commit as `Version X.Y.Z`.
4. Tag `vX.Y.Z`; `git push origin HEAD:main HEAD:stage-a/slice vX.Y.Z`.
5. `gh release create vX.Y.Z --title X.Y.Z --target main --notes-file <that changelog section>`: the bot shows
   these notes in its new-version message.

The user then taps "Update everything" in the bot: the helper on the VPS checks out the tag, rebuilds and restarts
the server, and returns to the previous version if the new one doesn't come up within 3 minutes. Computers follow
by themselves. A release that comes up but misbehaves is **not** rolled back: fix it from a local Claude Code, or
on the VPS:

```bash
cd /opt/tgcv/src && git checkout vX.Y.Z && cd deploy && docker compose up -d --build
```

## Working through the bot

When this project is developed from the bot itself, a broken release can take away the tool that fixes it: test
before releasing, and keep the way back above at hand.

## Later

- **XcodeBuildMCP (Scott, 2026-10-31):** Claude offers it on a Mac from 0.4.11. First real test (2026-10-31, 23 taps): with no delay 5 of 5 were lost while reporting SUCCEEDED; with postDelay 0.3 s or more 13 of 13 worked, batch 4 of 4. The small sample is why it stays a rule in the prompt. Scrolling is what got in the way: the only reason for a thin server of our own so far.

## Claude on the computers

Claude runs on the server. Agents and code never use a Claude Code installed on a computer: not its CLI, not its folders. Scott, 2026-10-31.
