# tg-claude

A personal Claude client with a Telegram interface. The server holds the bot and the Claude sessions; the agent on a computer runs file operations and commands in the chosen project. Spec: [docs/telegram-claude-client-spec.md](docs/telegram-claude-client-spec.md).

## Server on a VPS with one command

On a Linux server (Ubuntu/Debian, ports 80 and 443 open):

```bash
curl -fsSL https://raw.githubusercontent.com/scottlaren/tg-claude/main/deploy/install-server.sh -o install-server.sh
```

```bash
bash install-server.sh
```

From an existing clone — just `bash deploy/install-server.sh`. A private fork (`TGCV_REPO=<its address>`) takes a read-only GitHub token (Fine-grained, that repository only, Contents: Read-only): the installer asks for it and keeps it only on the VPS, in `/etc/tgcv/github-token` (readable by its owner and root): git takes it from there by itself, it isn't in any URLs or in `.env`, and it never gets into the containers.

It installs Docker, asks only for the bot token (and a domain, if you have one — without it the address looks like `1-2-3-4.sslip.io`), makes the backup key and sets the task limit from the memory size by itself, builds the image and starts the server with Caddy (HTTPS/WSS), and optionally ☁️ the cloud for code. At the end it gives a link `t.me/<bot>?start=<code>` — open it and tap Start, and the bot becomes yours (the code is single-use). Running it again updates. Sign in to Claude with a button in the bot (`/profiles` → "Sign in"): the bot sends a link; send it the code from claude.ai as your next message, and it removes the code from the chat right away and hands it only to Claude Code on the server. The "🖥 Open sign-in on PC" button opens the sign-in page on a connected computer in a separate browser window (the first one found: Chrome → Firefox → Edge → Brave → Yandex Browser; not Safari — it only has the whole Mac's proxy) that goes through the server — so even at sign-in claude.ai sees the server's address; the link is also given as text, as a last resort. While there's no computer yet, the bot recommends connecting one first. Manually — `docker compose exec -it server npm run login` in `deploy/`.

## Running

You need Node 24+ and `npm install`.

**Server** (on the PC for now, later on the VPS):

```bash
cp .env.example .env     # TG_TOKEN, OWNER_IDS; on the VPS also PUBLIC_WS_URL=wss://…/device
npm run login            # sign in to Claude for the server's profile
npm run server           # bot + device gateway
```

Your Telegram id: message the bot while `OWNER_IDS` is empty, and the id shows up in the server log as `rejected`. Claude's working folder on the server is `~/.tg-claude-vps/claude-cwd` (`CLAUDE_CWD`), and it must be outside any git repository.

Voice and video are handled by the server. In Docker, ffmpeg and whisper.cpp are already in the image: the first voice message or round video brings a button to download the speech model (~550 MB, once, checked against its checksum), and the message is handled as soon as it is in place. Without Docker (`npm run server`) you need `ffmpeg`/`ffprobe` in PATH and [whisper.cpp](https://github.com/ggml-org/whisper.cpp/releases) — `whisper-cli` in PATH or `WHISPER_BIN`, the model `data/models/ggml-large-v3-turbo-q5_0.bin` or `WHISPER_MODEL`, the language `VOICE_LANGUAGE` (default: the bot's language; `auto` makes whisper detect it for each message, which takes about twice as long). Without them the bot works, only voice messages aren't transcribed; what's missing is in the log at startup.

**Each computer** (Windows or macOS) — with one line from the bot: `/pair` sends a line for PowerShell (Windows) and for Terminal (Mac), with "Copy" buttons. The line downloads the installer from your server (the code from `/pair` is inside the link — once, 10 minutes), and the installer puts its own Node (from nodejs.org, with a checksum check) and the agent (as an archive from the server — no git or npm needed on the computer) into `~/.tg-claude-vps/agent`, finds the working folder and apps by itself, pairs the computer and turns on autostart. No admin rights needed. Once the computer has connected, the bot shows its working folder and the folders where git projects were found: keep it or pick another — from the suggestions or by browsing folders right in Telegram. Later, the same via `/devices` → "📁 Folders": replace, add another one, remove. Changes apply at once, with no restart; a working folder that has vanished from the disk is simply skipped. Updates for such an install also come from the server (with the computer's key, with a checksum check), so the repository can stay private.

From a clone of the repository (for development) — the old way:

```bash
npm run agent -- init    # settings: workspace, the MCP servers this computer has, installed AE/Blender
# the agent's own list of MCP servers: agent.mcp.json next to the config. Claude adds to it with a button in Telegram
# in the bot /pair → code, then:
npm run agent -- pair CODE --server wss://server/device
npm run agent -- install # into the background and autostart at login (Windows, macOS, Linux with systemd)
```

The background agent: `npm run agent -- status`, `restart` (after `git pull` or editing `agent.config.json`), `uninstall` (remove from autostart and stop). The log is `data/logs/agent.log`. On Windows it's an entry in the user's startup items plus a watchdog that brings the agent back up after a crash; on macOS, a LaunchAgent. It runs in the user's session, so it opens AE, Blender and Studio on the user's screen. Two agents with the same config won't start: `npm run agent` in a terminal will say the background one is already running. Without autostart — just `npm run agent`.

`/devices` — which computers are online, unpair one, connect a new one.

`/users` — which Telegram accounts the bot answers, managed from the main account (the one that claimed the bot, or the first in `OWNER_IDS`). To add one, tap “Add” and write to the bot from it within 10 minutes (or send its numeric ID, or a message forwarded from it), then confirm; it has access from its next message. Each account has its own topics and sessions, and full access to your computers and Claude limits. News of the server (updates, the sandbox) goes to the main account only. Accounts from `OWNER_IDS` can only be removed in `.env`.

Shared read-only folders — `shared` in `agent.config.json` (default `~/Downloads`): any project reads and sends files from there, but changes nothing there. They are set only on the computer, not from Telegram. Commands (`run_command`) aren't limited by folders — the permission buttons and `/mode` keep them in check.

## In Telegram

The bot speaks English or Russian: it starts in the language of the owner's Telegram, and `/language` switches it.

New topic → computer (if more than one is online) → project (a paged list), "➕ New project" or "💬 No project" — just a conversation without a computer or folders; if files turn out to be needed, Claude offers a project with a button and continues in it. Default model: with a project Opus 5.5, without a project Sonnet 5.5 (`/model` — change it); the bot states it when the session starts. Until a project is chosen, the message waits. `/compact` shows how full the topic's history is (tokens against the model's window) and compacts it at a tap; past 70% the bot offers it by itself after an answer. When Claude compacts a long history on its own, the bot waits for it instead of calling it a lost connection. Every folder in the workspace is a project; a neighboring folder is given to a project only with the user's button.

Writing files, commands and actions in apps ask for permission with buttons; `/mode` changes the rule for the topic (ask / files without asking / everything without asking / view only). Claude puts images from the computer and from the web right into the reply. `/tools` — the computer's apps and their state.

**Head and agents:** any topic can become a head — ask Claude to hand a task out to agents. It launches the agents itself (each in its own topic "🤖 Name", on its own computer and in its own project, up to 5), picks each one's model and effort by complexity and changes them along the way, writes to them and gets their reports; all of it is visible as quotes. Agents inherit permissions from the head (in an agent's topic, `/mode` → its own mode or "Same as head"). `/team` — who is where and doing what. Deleting the head deletes its agents too.

**Names of computers:** `/devices` has a button to rename each one. The name stays whatever the computer calls itself; its id, which topics hold, doesn't change.

**Topics talk to each other:** within one chat, Claude can write to another topic with `message_topic`. It shows there as a folded message and starts that session by itself. A turn answering one runs under the stricter of the two topics' modes, so what a session read on a page can't get more done than it could itself, and a run of 10 messages without you stops until your next word.

**A computer that is off:** the topic goes on talking. Work that needs the computer is put off with `defer_task` and shown in the chat, and starts by itself once it has been online for a moment, with a button to call it off. `/status` counts what waits and `/stop` clears it. An agent's task and a scheduled run simply wait.

**Another computer:** `/computer` carries a topic over with its conversation: the history is on the server, so only the project's folder has to be there. If it isn't, the bot offers to take it from git, copy it from the first computer, or start with an empty one. Claude can offer the same when a task belongs elsewhere (Xcode on a Mac), and a message waiting for a closed computer gets buttons for the others. The cloud is among them while it is online: a project of the same name there takes the topic at once, otherwise you pick one of the cloud's projects or clone the repository there (the address is read while the computer is on, so it is still known when it is off). Nothing is cloned or copied without your tap, and Claude can offer the cloud when the topic's computer is off.

**Files between computers:** Claude copies a file or folder from one computer's project to another's with `copy_files`, up to 1 GB through the server. It never replaces anything, and the topic's mode decides whether it asks.

**Groups without topics:** add the bot to any group as an admin, and the whole group is one conversation: its card sets the computer, project and permissions directly. Turning Topics on later keeps that conversation in General and adds topics and agents; if Telegram gives the group a new id on the way, everything moves with it.

**Workspaces:** a group with topics works as a place of its own for one area of work. Create a group, turn on Topics, then `/workspace` in the private chat adds it with the rights the bot needs; its card sets the computer, project, permissions and model new topics start from. A topic from the private chat moves in with a button in its `/workspace`: the conversation goes over, the messages stay. Only accounts from `/users` can give tasks there. A group has no drafts, so answers arrive whole, with a live status and a Stop button meanwhile, and Telegram's limit of about 20 writes a minute per group is shared by its topics.

**Decisions of a workspace:** what you decide in one topic of a group, Claude records in a list every topic there reads on every turn; the topic shows what was recorded. `/decisions` shows the list and removes entries. Only what you said yourself counts: a turn answering another topic, a head or a schedule can't add to it. The list is a markdown file per group under `data/decisions` and stays if the bot leaves the group.

**Limits:** a task the limit stops waits and goes on by itself after the reset; with the 5-hour limit 80% used or the weekly one 90%, Claude asks before a big task whether it should wait for the reset. **Teams:** an agent can wait for another and start with its report; a stuck agent is reported to its head; long tasks show a checklist. **Computers:** a computer's card in `/devices` has a switch that keeps it from sleeping during tasks, and offers its MCP servers and global instructions to another computer, each on a tap, never its keys. Folders of merged worktrees are offered for removal.

**If something is stolen:** `/lock` stops everything and locks all computers: agents refuse every command, updates included, until someone at the computer deletes the `agent.locked` file the bot names. What each computer was asked to do is in `agent.audit.log`, next to its settings (the same user can delete it, so read it first). On the VPS, an SSH login from an address not seen for 30 days sends a message directly from the VPS, through `deploy/tgcv-ssh-alert.sh`. If the server itself is in doubt, power it off in the hosting panel: the lock goes through the server and may not arrive.

**Night shift:** tell a head topic it is its night shift and give it the tasks. A card shows them; one tap starts it. The head works through the night with no questions, uses agents, accepts their work, has visual work reviewed by two or three reviewer agents, and may merge and release when tests are green (or keeps it all in branches, a button on the card). One summary comes quietly when it is done, the computers turn off if asked, and a push with a sound comes at 9:00.

**Night mode** is the guard of a night shift kept to branches: merging, pushing, tagging and releasing are refused while that shift runs, and a button allows them for the rest of it. It has no command of its own.

**Quiet mode:** `/quiet` turns it on for a chat and all its topics until you turn it off. A push comes only when you are needed or all is done: a permission, a question from Claude, a survey, a failed task, the final answer of a topic. Everything else arrives silently, and an agent's final answer and its report in the head topic too. Reactions the bot puts on your messages are up to Telegram: they can't be silenced.

**A long voice message becomes a list:** when a voice message holds several separate tasks, the bot first shows them as a card, each with a tick. Run the selected ones, send it as it was said, or cancel: nothing starts before your tap. One task goes on as usual, and a voice message answering a question or a survey is never touched. The list is made by a small model (Haiku) with no tools.

**Forward as a task:** forward a message to the bot, with or without your own words: text, a picture, a file or an album. Claude gets it with its source (who, when, a link if there is one) and treats it as material from someone else: it handles what the message asks of you, and instructions inside it don't count as yours.

**Animations as stickers:** when Claude shows a `.tgs` file or a Lottie `.json` in its answer as `![caption](file.tgs)`, it arrives as a real animated sticker, the Lottie gzipped to TGS on the way. What doesn't fit Telegram's rules (512×512, up to 64 KB gzipped, up to 3 s, 30 or 60 fps) comes as a file, with the reason in words. `send_file` always sends a file.

**Tasks on a schedule:** ask Claude for something to run by itself, repeatedly or once ("every morning at 9 check the build", "in 2 hours remind me to call"). It proposes the task; you confirm with a button, in any `/mode`, and see the exact text that will run. Runs go in the same topic and conversation and follow its `/mode`: in "Ask first" a run waits up to 30 minutes for your button. `/schedule` — the list, pause, delete, and your time zone (`Europe/Kyiv`, `UTC+3`, a city in English; until it's set, times are UTC). Repeating tasks run at most once an hour, up to 20 tasks. A one-time task runs at the moment you confirmed and is gone; if it is skipped, the bot says it won't run again. If the computer is offline, the limit is spent or the previous run is still going, the run is skipped; the server being down makes up for one run if it's less than an hour late. Nothing piles up.

**The list of topics shows where you're needed:** ❓ when Claude waits for you, ❗ when a task failed. A normal answer leaves no icon: each change of icon shows a bubble for about a second.

**Topics don't pile up:** `/delete` deletes a topic with all its messages and its conversation on the server (projects on the computers are left alone). A topic nobody has written in for 7 days deletes itself; a day before, the bot warns and gives a "Postpone 7 days" button. The period is `TOPIC_TTL_DAYS` in `.env`; `0` — never delete.

**Sensitive data** in replies is always hidden: emails, phone numbers, card numbers, keys, tokens, passwords (`d•••@v•••.ru`, `sk-ant-•••`). Claude works with the real values; you can see them only with the "👁 Show for a minute" button — the bot sends the full text and deletes it a minute later.

**Claude profiles** — as many accounts as you like, each with its own sign-in, sessions and Figma sign-in (`data/profiles/<name>`). To add one: on the server, `npm run login -- --profile work` (the official browser sign-in; passwords don't go through Telegram); to sign in, or sign in again, to an existing one — a button in `/profiles`. In Telegram: `/profile` — the topic's profile (change it, move the conversation), `/profiles` — accounts, `/usage` — limits for 5 hours and for the week; at 80% of one the bot warns once, after an answer. When a limit runs out, the bot says when it resets and offers a button to continue on another profile; it doesn't switch profiles by itself.

**Figma** is connected to the server (the official remote MCP) and works in any topic, even when the computer is off. Sign in once with the button in `/tools`: the page opens on your computer, going through the server (a new tab in your own Chrome with `/proxy` on, a separate window otherwise), you press Allow access, and that's it. Without a computer the bot gives the link, and you send back the address the browser ends on. Other remote MCPs — `REMOTE_MCP` in `.env`.

**☁️ Cloud** — a computer for code on the server itself, for when your computers are off (VPS, turned on in the installer). A separate container: git, GitHub CLI, Node.js, Python, compilers; there's no After Effects, Blender or browser there, and no bot token or server keys either. It's last in the project picker. The cloud is a temporary place: when a computer comes online, the bot offers to move the cloud projects there; `/move` — move them now. The whole folder is moved, with `.git` (without `node_modules` and virtual environments); once it's verified on the computer, it's deleted from the cloud, and the conversation continues in the same topic. `/github` — GitHub sign-in for the cloud: you enter the code from the bot on github.com; no password or token goes into the chat.

**Your Chrome through the server:** `/proxy` in the bot (or `npm run agent -- chrome-proxy on|off|status` on the computer itself) sends your regular Chrome — with all its sign-ins — online through the server. It's a Chrome policy for the current Windows user (`HKCU\Software\Policies\Google\Chrome`: proxy `socks5://127.0.0.1:1089`, WebRTC only through the proxy, no QUIC or preloading); whatever was there before it was turned on is saved in `agent.chrome.json` and restored when it's turned off. After switching, Chrome has to be restarted; `chrome://policy` shows what's in effect. Before Claude's first action in Chrome in each task, if this Chrome isn't surely going through the server, the bot asks how it should go online: through the server or directly; when switching, it waits for Chrome to restart and, on the "Done" button, checks that Chrome really was started again (by its process's start time), and only then lets Claude go on. While it's on, Chrome opens sites only when the agent and the server are running; to turn it off without the server, use the command on the computer. Turning it off from the bot takes two taps.

On a Mac, Chrome doesn't accept the policy without a management profile, so there switching means a restart: the agent closes your Chrome (as on a normal quit) and opens the same profile with the same tabs (`--restore-last-session`), with or without the proxy flags. The bot tells how Chrome goes online from the flags of the running Chrome: a Chrome opened later from the Dock goes directly, and the bot will say so before working in Chrome. An open Chrome is restarted only after a "yes". If Chrome's proxy is set by a company policy (`/Library/Managed Preferences`), the flags have no effect — and the bot says so.

**A separate Chrome for Claude through the server:** `npm run agent -- chrome` opens a separate Chrome — its own profile without your sign-ins, all traffic through the agent's tunnel to the server, so sites see the server's address, not yours. Proxy `socks5://127.0.0.1:1089` (only from this computer), names are resolved on the server, WebRTC doesn't bypass the proxy; without the tunnel this Chrome opens nothing. The server lets it only into the public internet on web ports (80, 443, 8080, 8443) and doesn't record where it goes. Once: install the Claude extension in it, sign in to the same claude.ai as the server, and choose it in `/browser`. The port is `browserProxyPort` in `agent.config.json`; `0` turns it off.

**Chrome** (the Claude in Chrome extension, same claude.ai account and organization as the server): when a task needs it, Claude asks with buttons, and a yes turns it on in the topic and carries on; it goes off by itself after a turn that doesn't use it or 30 minutes without use. `/browser` turns it on by hand, until you turn it off. The first time, the bot asks which of the connected browsers is on the topic's computer. A topic uses only its own browser; reading pages happens without asking, navigation, clicks, typing and scripts — per `/mode`. A browser that's on adds ~3K tokens to each request.

Editing a message corrects it: one still waiting takes the new text, and Claude hears of the correction otherwise. A message waiting its turn gets 👀 until it's answered, a failed one 💔, a normal answer no reaction; a 👎 on an answer makes Claude look at it again. Replying to a message (or a selected part of it) tells Claude which one you mean; Claude's answer comes as a reply to yours and may end with buttons with suggested replies: a tap sends that text as your message. You can send the bot photos, albums, files (zip, .blend, anything up to 20 MB — Telegram's limit for bots), voice messages and videos. Claude sees photos and video frames itself, voice and speech in videos as a transcript, small text files as text. Each file stays on the server for a day; Claude puts it on the computer, into the project, by itself when the task needs it (`save_attachment`, no overwriting). The other way, from the computer to Telegram — up to 50 MB (Telegram's limit for bots), in chunks with integrity checks and resume; photos — up to 10 MB. Claude sends renders for viewing as a light H.264 preview; the master stays on the computer. Files over 20 MB won't get through to the bot — send a link, and Claude downloads it straight to the computer.

## Maintenance

- `/diag` — the server (version, disk, memory, tasks, attachments, history, logs, backup), Claude profiles, devices with their agent versions, integrations.
- `/update` — a new version. The server checks releases on GitHub (`vX.Y.Z` tags) by itself at startup and once a day and writes to the chat with the bot: "⬆️ Update everything", "Remind me tomorrow", "Skip". "Update everything" starts no new tasks and gives the current ones up to 3 minutes to finish ("Update now" skips the wait, "Cancel" calls it off), then a helper on the VPS (`deploy/tgcv-update.sh`, systemd `tgcv-update.path`, outside the container) switches the code to the tag, rebuilds and restarts; if the new version hasn't come up within 3 minutes, it brings back the old one. Messages that arrive during the update are held by Telegram for the new version. Tasks still running continue by themselves after the restart. Computers that are behind the server update themselves (`git` to the tag, `npm ci` on a new lockfile, a service restart, which waits up to 3 hours for running commands) — right away or on their next connection; a developer's working copy (local changes, or a branch other than `main`) is left alone. A server without the helper (`npm run server`) shows the commands for a manual update.
- **Long tasks survive.** A lost connection doesn't stop a command: the computer finishes it and keeps the result for up to 6 hours, and Claude's call waits for the computer for 10 minutes, or to the end of the command's own time limit if that is later. A server restart ends Claude's process but not the commands: what is under way is on disk (`data/in-flight.json`), and on the next start the topic removes its old status message, asks the computer how each command ended, waits for what still runs without running it again, and continues in the same session, as a reply to the original message. A computer that stays offline for 5 minutes is gone on without, and the topic says so. `/stop` calls it off. At most 3 automatic continuations per task; after a stop of over 12 hours the task waits for you.
- At most `MAX_PARALLEL` Claude tasks run at once (default 2, as in the spec); the rest wait with a message. Apps run on the computers; on the server a task is a Claude Code process, ~0.2–0.4 GB of memory (measured on 29.10: 170–220 MB per process, almost independent of the context size). Rough guide: an 8 GB VPS — 8–10 tasks, 4 GB — 4.
- A daily backup: topics, devices, browsers, Claude profiles with sessions and sign-ins, encrypted with AES-256-GCM, kept for 7 days in `backups/` (`BACKUP_DIR`). Key: `npm run backup -- key` → `BACKUP_KEY` in `.env` **and somewhere away from the server** (without the key the copies can't be read; with the key, anyone can read them). Right now: `npm run backup`. Restore only into a new folder: `npm run backup -- restore backups/backup-….tgcv --to data-new`, then stop the server and move it into `data/`. Copies on the same disk won't save you from losing the disk — better point `BACKUP_DIR` at a synced folder.
- `/cleanup` — delete temporary files, a topic's history, the whole server history or the logs (each with confirmation). Server logs are kept for 14 days on their own.

**Is the server alive?** `GET https://<your domain>/health` (`DOMAIN` from the install) answers `200 ok` while the bot hears from Telegram and `503` when it hasn't polled for 2 minutes; it says nothing else, so it is safe in the open. To be told when the server is down, add it to [UptimeRobot](https://uptimerobot.com): **New monitor** → type **HTTP(s)** → the address above → an interval of 5 minutes → your alert contact. No keyword and no port are needed. The same address works with any monitor that checks the status code, by `GET` or `HEAD`.

## Structure

- `packages/protocol` — server ⇄ device messages and tool schemas (§17).
- `apps/server` — the Telegram bot, the Agent SDK adapter, the WebSocket device gateway.
- `apps/agent` — the agent: files with hash checks, commands with cancellation and a timeout.

```bash
npm test          # unit and routing
npm run typecheck
npm run test:e2e  # the real server and agent as processes on temporary folders, against a local fake of Telegram and a scripted Claude; about 20 minutes
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md): free to use, change and share for personal and other noncommercial purposes. Commercial use needs the author's permission.

Required Notice: Copyright (c) 2026 scottlaren (https://github.com/scottlaren/tg-claude)
