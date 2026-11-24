# Technical specification: a personal Claude client with a Telegram interface

Version: 1.0  
Date: October 29, 2026  
Status: specification for design and implementation

## 1. Purpose

Develop a personal client for working with Claude through Telegram. The client should make it possible to keep separate per-project conversations, set tasks, get results and control tools on Windows and macOS.

The server side runs permanently on a VPS. Working projects, sources and heavy applications live on the owner's computers. The user chooses which computer and which project a given conversation works with.

Basic scenario: the user sends a message in Telegram, the server starts or continues a Claude session, Claude calls the tools of the chosen computer, and the result comes back to the same Telegram topic.

The model runs on Anthropic's infrastructure. The VPS hosts the Claude Code client, the Telegram bot and the task management service. The local application executes commands and provides tools; no separate model is needed on the computer.

## 2. Product composition and first-version scope

The product consists of three parts:

1. Telegram bot — the user's main interface.
2. Server — conversations, queue, Claude sessions, tool routing and device connections.
3. Local application for Windows and macOS — access to the chosen folders, processes and applications of the computer.

The first version is designed for one owner, two computers and two independent Claude profiles. The architecture should allow adding devices and profiles without changing the protocol.

The full version 1.0 includes: text, topics, files and images, task management, local file operations and commands, Git, Figma, After Effects, Blender, Roblox Studio and browser integration after a compatibility check.

Voice messages, video, full desktop control, collaboration of several users and automatic project sync belong to later versions. Voice messages and videos may be stored as attachments, but the first version is not required to recognize their content.

## 3. Main user scenarios

### 3.1. New project

The user adds a project folder in the local application. In Telegram they create a topic and choose the project, the computer and the Claude profile. Then they send tasks as ordinary messages.

### 3.2. Working at home

The topic is bound to Windows. Claude reads local files, edits code, runs checks and calls open applications. Results appear in Telegram, changes — in the local project.

### 3.3. Working on the road

The user switches the topic to the Mac. The client checks for the matching project folder, tools and unfinished operations. The conversation history is kept; paths and environment state are updated. Project files are not moved automatically.

### 3.4. Working with an application

The user asks to change a composition, a scene or a game project. Claude picks an available MCP tool, performs the action in the right application instance and returns a description of the result and a preview, if the integration supports them.

### 3.5. Computer unavailable

The bot reports that the chosen device is offline. Actions on it are not started and are not redirected to another computer. The user can wait for it to connect, cancel the task or explicitly choose another device.

## 4. Architecture

Control flow:

```text
The user → Telegram → Telegram bot on the VPS → Claude session
                                                │
                           ┌────────────────────┴──────────────────┐
                           │                                       │
                      Remote MCPs                           Device gateway
                      e.g. Figma                                   │
                                                           secure connection
                                                                   │
                                                           Windows or macOS
                                                     files / commands / local MCPs
```

The server includes a Telegram adapter, a topic manager, a task scheduler, a Claude adapter, a device gateway, an MCP manager, metadata storage and an attachment handler.

The preferred way to integrate with Claude is the official Agent SDK. The official machine interface of the CLI with documented structured output is acceptable if it's needed for specific capabilities. Parsing the visual output of an interactive terminal must not be the main mechanism.

The SDK and the CLI are hidden behind a common adapter: creating a session, continuing by ID, the event stream, questions to the user, permission requests, cancellation and getting the result. The specific adapter is chosen based on the results of a preliminary prototype.

The original project `scottlaren/tg-claude` can be used as a base after checking the license or the owner's rights, the dependencies and the actual fitness of its modules. Components tied to macOS must not move into the server side.

## 5. Telegram interface

### 5.1. Access and topics

- Access is granted to the owner by numeric Telegram user ID.
- The main interface is a private chat with the bot, with topics enabled.
- One topic corresponds to one active binding to a project, a device, a Claude profile and a session.
- The topic identifier is stored together with the chat ID; the display name is not used as a technical identifier.
- The user can create, rename and archive topics.
- A name can be suggested from the first message; a name set manually by the user takes priority.
- If topics aren't supported, setup must say so explicitly. The fallback mode is the owner's private forum group with the necessary bot rights.
- Archiving a conversation does not delete project files.

### 5.2. Commands and buttons

Commands must have equivalents available through the menu or buttons:

- `/start`, `/help` — setup and help.
- `/topic` — a new topic with a choice of project, device and profile.
- `/project` — choose a project.
- `/devices`, `/device` — the device list and choosing a device for the current topic.
- `/profiles`, `/profile` — Claude profiles and choosing a profile.
- `/new` — a new session in the current topic, keeping the bindings.
- `/resume` — choose a saved session of the current profile.
- `/status` — the current task, bindings, tool availability and the queue.
- `/tools` — available integrations and their state.
- `/stop` — stop the current task.
- `/queue` — view and delete pending messages.
- `/mode` — choose the permission mode.

The user should not have to enter session IDs, internal paths or technical parameters for normal work.

### 5.3. Replies and events

- After receiving a message, the bot shows that it has been accepted, or reports why it was refused.
- A long reply is shown progressively, respecting Telegram's limits on updates.
- If streaming drafts are unavailable, editing a regular message or sequential messages are used.
- Long text is split into parts; large logs are sent as a file with a short summary in the chat.
- Code and formatting are preserved within Telegram's capabilities.
- Service statuses must not create a separate message for every internal event.
- On completion, the result, the changed files, the checks performed and the action expected from the user, if any, are shown.
- Model replies and tool events intended for the user are displayed. The product does not promise to show the model's internal reasoning.

## 6. Conversations and Claude sessions

- History is independent between topics.
- Continuation is done by a specific session ID; "the latest session in the folder" must not be used for all topics.
- In one topic, at most one model request that changes its history runs at a time.
- New messages that arrive during work are queued. The user can stop the task and send a clarification as the next request.
- After a normal restart, bindings, history, the queue and session identifiers are preserved.
- If a session can't be continued, the client explains why and offers a new session with a brief carry-over of the context. Such a carry-over must not be passed off as a full restoration.
- The environment context includes the project, the chosen device, the OS, the allowed roots and the tools. It is updated when the device is switched.
- Unavailable applications must not be announced as available tools.
- When the context fills up, history compaction supported by Claude's mechanism or an agreed switch to a new session is used; important decisions are kept in a short summary.

## 7. Claude profiles

- Two independently authorized profiles are supported.
- Authorization data, configuration and session directories are isolated between profiles by means of the chosen SDK/CLI and, if needed, separate system users or containers.
- Each topic is explicitly linked to one profile.
- When the profile is changed, the running task must finish or be stopped. A new session is created; only an agreed summary is carried over, without assuming that the previous ID is portable.
- Limits and available models are shown separately, and only if the supported interface provides them. Without data, "no data" is shown.
- When the available resource runs out or re-authorization is needed, the task gets a clear status. Automatic profile rotation is not provided.
- Authorization goes through the official sign-in method. Passwords are not requested via Telegram messages; keys are entered on a one-time server page. The one-time code of the official sign-in may be forwarded to the bot (change of 29.10, see docs/simple-setup-plan.md).
- Secrets don't get into messages, diagnostic reports or regular logs.

## 8. Local application for Windows and macOS

### 8.1. Interface

The application lives in the Windows system tray or the macOS menu bar. It shows:

- the state of the connection to the server;
- the device name;
- the allowed project folders;
- the available integrations and application instances;
- the running tasks;
- buttons to pause, disconnect and stop a local operation;
- autostart, notification and diagnostics settings.

Minimum target environment: Windows 11 x64 and macOS 13+ on Apple Silicon. Support for Windows 10 and Intel Macs is assessed separately and is not mandatory for the first version. The versions of creative applications are pinned to the ones the owner has installed at the time of the preliminary check.

### 8.2. Connection

- The local application initiates the connection; no inbound public port is needed on the home computer.
- A persistent secure connection to the server is used, e.g. WSS.
- Initial pairing is done with a one-time code or a short-lived link, confirmed by the owner.
- After pairing, the device gets its own revocable key. The key is stored using OS facilities.
- Reconnection uses an increasing delay; sleep, wake-up and network changes are handled normally.
- The heartbeat is separate from task state. The recommended interval is 15 seconds; a lost connection is detected within 60 seconds.
- Being connected to a VPN must not be a prerequisite for the bridge application to work.

### 8.3. Execution

- The application runs with normal user rights.
- It starts and ends only the processes related to the task, taking child processes into account.
- It supports long operations with a job ID, an output stream, status and cancellation.
- It doesn't require a second Claude sign-in for normal file operations and local MCPs. Individual integrations, e.g. a browser extension, may have their own authorization requirements.
- After the connection is lost, new commands are not accepted. For an operation already running, the status is kept; whether it continues or stops is a policy set per operation type.

## 9. Projects, files and local commands

### 9.1. Project registry

A project has a permanent ID, a name and a separate path binding for each device. For example, one project may be located at `D:\Projects\Demo` on Windows and `/Users/owner/Projects/Demo` on the Mac.

Adding a root folder is confirmed in the local application. Additional asset folders are connected separately. Matching folder names alone are not considered confirmation that it's the same project.

### 9.2. File tools

Required operations: listing files, searching by names and text, reading a range of lines, creating a file, applying changes, viewing a diff and getting metadata.

- Paths are checked on the chosen device, taking into account the OS's rules, symbolic links and junctions.
- Writes check the expected version or hash of the file. On a conflict the file is re-read; external changes are not silently overwritten.
- Writes are atomic where possible.
- Binary files are not handled with text patches.
- Deleting or overwriting large sets of files requires separate confirmation, unless an exact permission for that operation was given earlier.

### 9.3. Commands

- A command always has an explicit device, project and working directory.
- Running an executable with an array of arguments is preferred. A shell is used when a shell script is specifically what's needed.
- A timeout, an allowed output size and a cancellation method are specified.
- The exit code, stdout and stderr are returned separately; truncated output is marked as such.
- A file path must not be treated as a command or unsafely included in a shell string.
- Secrets are given to a process only when needed and are not included in the result.

### 9.4. Separating the computer and the server

For a local project, Claude Code's built-in file and command tools on the VPS must not accidentally carry out the task on the server. They must be disabled or confined to the service environment, and the working operations routed through the local tools.

An instruction in the system message alone is not enough: the route is checked by the gateway's code and by the local agent.

Restricting the file MCP to certain folders is not full isolation of an arbitrary shell command. An arbitrary shell is provided only in a separately allowed mode; stronger isolation by OS means is a separate feature for later versions.

## 10. Integrations

### 10.1. Common MCP mechanism

- The registry stores the transport type, the device or remote address, the authorization method and the launch settings.
- Local stdio servers through the agent and remote HTTP MCPs through the server are supported.
- Tool schemas, resources, images and structured errors are preserved.
- Clarifications and authorization requests, if the chosen MCP needs them, are routed to the user; unsupported capabilities are explicitly marked.
- Tools get namespaces that rule out name clashes between different integrations.
- The list of capabilities is refreshed after an application connects or disconnects.
- A failure of one MCP doesn't stop the other integrations.
- Write operations to one application instance go through a sequential queue unless the integration guarantees safe parallelism.

### 10.2. Figma

Use the official remote Figma MCP with the owner's authorization. Support reading a file and selected nodes, creating and editing available content, getting images and links to the result, within the account's rights and the tool set.

The file and node are chosen by a link or a saved binding. The client must not assume it knows the current selection in the local application. The applicable official Figma instructions are connected to the agent's working environment.

### 10.3. Roblox Studio

Use the MCP installed by the owner, preferably the built-in Studio MCP. A local stdio process runs on the computer with Roblox Studio.

Support discovering Studio instances, choosing a specific place, reading and changing scripts, viewing the tree, getting output and starting/stopping a test, within the server's capabilities.

With several Studios open, the instance is chosen explicitly and pinned to the topic. The choice is checked again after the application restarts. Publishing the project is a separate action at the user's request, not a side effect of saving.

### 10.4. After Effects

Use the owner's local MCP. Support getting the project state, operations on compositions and layers, running supported scripts, saving and getting previews.

A render is handled as a long task with its state monitored. If the MCP doesn't provide a reliable render status or cancellation, the interface must say so. Moving `.aep` files and sources to the VPS is not required.

### 10.5. Blender

Use the local Blender MCP. Support getting the scene state, operations on objects and materials, running supported Python code, saving `.blend`, rendering and getting images.

Rendering uses the chosen computer's resources. With several Blender instances an unambiguous binding is needed; if the MCP doesn't support that, only one connected instance is allowed until selection is implemented.

### 10.6. Chrome

The goal is working with the user's local browser: reading pages, navigation, filling in forms, clicks and getting screenshots, keeping the site sessions available to the browser.

The preferred option is the standard Claude in Chrome integration. Before including it in the main implementation, verify that it works specifically with the server-side Claude adapter used by the Telegram client: authorization, browser selection, permissions, non-interactive launch and cancellation.

Working in the interactive CLI does not by itself confirm compatibility with the Agent SDK or the bot's background process.

If the standard path doesn't cover the requirements, prepare a separate local browser MCP/adapter. Its compatibility with an already open user profile and how it differs from the standard extension must be described and checked before the solution is chosen.

The browser is pinned to the device and the topic. If the integration only allows a global browser choice, concurrent work of different topics with different browsers is serialized, or the feature stays unavailable until the limitation is removed. A browser on another device must never be opened silently.

CAPTCHAs and manual sign-ins are handed over to the user. Full desktop control is not part of the browser integration.

## 11. Git and GitHub

- Git commands run in the local repository of the chosen computer.
- status, diff, branches, commit, fetch, pull and push are supported.
- The user's local credentials are used; SSH keys are not copied to the VPS.
- Commit and push happen at the user's explicit request or by a project rule set in advance.
- On a conflict in the working copy or history, the client shows the problem and suggests a specific action.
- When two topics work with one repository, write operations are coordinated. For parallel tasks, separate worktrees or working copies are preferred.
- Creating PRs can be added through the official API/CLI if local authorization is available. A push must not automatically create or merge a PR.

## 12. Switching devices

Before switching the device, the client checks the active tasks, whether the project folder exists, the Git branch and commit if there's a repository, and whether the needed MCPs are available.

Switching during a local operation is forbidden until that operation completes, is cancelled or is explicitly detached from the conversation. When the environment changes, the binding version is incremented; commands from the previous version are no longer executed.

After switching, Claude gets the current paths and a short description of how the environment differs. Earlier file reads are not considered current without checking again.

There's no automatic copying of uncommitted changes between computers. The client warns about the divergence and offers to move the project in a way agreed with the user.

## 13. Permissions

Provide two modes:

1. View and plan: reading allowed files and the state of tools, without changing the project.
2. Work on the project: allowed changes in the chosen project; arbitrary commands and actions outside the established rules require the user's decision.

Permission settings apply at the device, project and integration level. The user can allow an operation once, or a specific category of operations until the end of the current task. Permanent rules are changed explicitly.

A request contains the device, the project, the tool, the essential parameters and the expected action. A decision is tied to a specific ID, parameters and binding version. Changed parameters require a new assessment.

Without an answer, the action is not started. The wait time is configurable; the default is 30 minutes. After it expires, the task is paused and stale buttons no longer work.

Checks are done both on the server and in the local agent. The application verifies the capabilities of the chosen SDK: a single permission callback must not be assumed to control all calls universally without checking the order in which it is applied.

## 14. Queues, cancellation and recovery

A task has these states: queued, running, waiting for the user, waiting for the device, completed, failed, cancelling, cancelled, outcome unknown.

- The initial limit is two parallel Claude tasks on the server, configurable.
- One active task per topic.
- Conflicting write operations to one project or application instance are serialized.
- Telegram messages are processed with deduplication by update ID.
- Each local operation has a unique ID and a local execution log.
- A repeated network message must not re-run a confirmed operation.
- After a disconnect, the server first queries the operation's state. If the outcome is unknown, it records the uncertainty and does not blindly repeat the change.
- `/stop` stops generation and sends a cancellation for the current local operation. If the application can't cancel the action, the client shows the actual status.
- Stopping a task does not mean automatically rolling back changes already made.
- After a crash restart, active tasks are reconciled with the local logs. Unfinished model requests are not resent automatically if they could have triggered actions.
- After recovery, scheduled commands to an unavailable device require a current binding and a valid permission; old permissions are not renewed indefinitely.

## 15. File transfer

- Telegram attachments are accepted with size and type checks, stored in a temporary directory and, on request, delivered to the project folder of the chosen device.
- Names are normalized; a matching name doesn't lead to a silent overwrite.
- Transfer between the server and the device supports integrity checks and resuming for large files.
- A result file can be sent from the computer to Telegram through the server's temporary storage.
- The current Telegram limits are checked against the API version in use. If a limit is exceeded, the bot reports the size and offers an agreed alternative way of transfer.
- After a successful transfer, the temporary copy is deleted; unfinished transfers are cleaned up by TTL, after 24 hours by default.
- The full working folder is not copied to the VPS to carry out a normal task.

## 16. Data and storage

Minimal entities: owner, device, Claude profile, project, project-to-device binding, topic, session, task, tool operation, permission request, MCP connection and temporary attachment.

For a topic, the chat ID, thread ID, project ID, device ID, profile ID, session ID, binding version, permission mode and archive state are stored.

The VPS holds metadata, the queue, server-side Claude sessions, history, the necessary profile secrets and temporary attachments. History may contain fragments of files that were read, command output and images. This is reflected in the storage settings.

The computer keeps the source projects, local keys, MCP configuration, the local operation log and work results. Telegram stores the messages and attachments sent through it according to its own rules.

Provide separate actions for clearing temporary data, deleting the server history and deleting local logs. Deleting the client's history doesn't promise deletion of data at external services. By default, technical logs are kept for 14 days, conversation history — until the owner deletes it.

A backup of server metadata and the necessary sessions is created daily in encrypted form and kept for 7 days. The recovery key is stored separately. The restore procedure is tested before handover. Local projects are backed up separately by the owner's own means.

## 17. Server–device protocol

The protocol is versioned. On a version mismatch, the application reports that an update is needed and does not accept commands.

An operation request includes the operation, task and session IDs, the device and project IDs, the binding version, the tool name, parameters, an expiry and the associated permission.

An event contains the operation ID, a sequence number, the state and the result data. Sequence numbers make it possible to restore the stream after reconnecting and to filter out duplicates.

Required: delivery acknowledgment, a current state query, cancellation, heartbeat, a message about available tools and device revocation. Message size and the amount of accumulated output are limited by settings; files use a separate transfer.

If a remote MCP expects a callback connection or hands out a `localhost` address, the adapter must handle the addressing correctly rather than pass a local address along as reachable by the server. File paths are also not considered shared between the VPS and the computer.

## 18. Deployment and operation

Initial recommended VPS configuration: Ubuntu 24.04 LTS, 4 vCPU, 8 GB RAM, 80 GB SSD and a permanent public address. No GPU needed. This is a starting estimate; whether it's enough is confirmed by a test with two parallel conversations.

Recommended stack: TypeScript/Node.js in a supported LTS version, the official Claude Agent SDK or a compatible CLI adapter, SQLite with migrations for a single server instance, HTTPS/WSS, and systemd or containers. The local application — a shared agent in TypeScript and an Electron shell, or another agreed cross-platform option.

Services start automatically after a reboot. For Telegram, use long polling at first; a token serves only one active update receiver at a time.

Technical diagnostics show the bot's state, free space, the queue, devices, and the versions of clients and integrations. An error in one profile doesn't stop the other. When resources are short, new tasks stay in the queue with a clear status.

Updates check the compatibility of the protocol and migrations. A backup is made before a migration; a rollback is done together with a compatible data state. Local application packages have checksums; full signing of installers and notarization require the owner's certificates.

A network VPN, if needed, is deployed as a separate component and is not a mandatory part of the client protocol.

## 19. Non-functional requirements

- The bot's interface is in English or Russian (`/language`); docs, logs and what the computers print are in English.
- Target time to acknowledge a request — up to 3 seconds when Telegram and the server are available.
- Target added routing time of a short call through the bridge — up to 1 second on a stable connection; model and application time are not included in the estimate.
- State changes of a local task are delivered to Telegram within the API limits, without a constant stream of notifications.
- Two parallel tasks in different projects don't mix history, results and permissions.
- The bridge application at idle must not create a noticeable constant CPU load.
- Errors contain a clear description, the state of the work done and the available next action; a full technical report can be obtained separately.
- An update or a disconnect must not lead to an undetected repeated file write.

## 20. Preliminary compatibility check

Before the main development, build short prototypes and record the component versions, results and limitations:

1. Check the official way to run Claude in the background, session continuation, cancellation, questions and permissions through Telegram.
2. Check independent authorization of two profiles and that their configurations don't mix.
3. Check topics in a Telegram private chat, streaming output and sending files.
4. Check Chrome from the VPS through the chosen adapter, including two computers and an explicit browser choice.
5. Determine the exact MCPs and versions for After Effects, Blender and Roblox Studio; check one read and one write operation each on both OSes where the application is used.
6. Check that the built-in server tools don't substitute for local file operations.
7. Check reading and changing a test file through the remote Figma MCP with the owner's rights.

An unconfirmed integration gets the status "adapter required" with a specific description of the limitation. Its readiness must not be promised just because an MCP exists or the interactive CLI ran successfully.

## 21. Implementation stages

### Stage A. Technical prototype

Result: a confirmed Claude ↔ Telegram ↔ one local agent scheme, a compatibility report and the chosen stack. Chrome is checked at this stage.

### Stage B. Minimum working client

Result: text conversations, topics, one profile, one device, local files and commands, permissions, the queue, cancellation and continuing a session after a restart.

### Stage C. Full personal scenario

Result: Windows and macOS, two profiles, device switching, projects, attachments, Git, connection recovery and the local application's interface.

### Stage D. Working applications

Result: Figma, Roblox Studio, After Effects, Blender and the chosen Chrome option, tested on the owner's installations. If one integration turns out to be impossible, that needs a separate decision on scope, not a silent exclusion from the handover.

### Stage E. Preparing for operation

Result: installers, VPS deployment, diagnostics, backups, a restore check and documentation.

## 22. Testing and acceptance criteria

Checks of routing, task state, redelivery, access rights and recovery are automated. Appearance is checked manually. One meaningful test per behavior is enough; integration scenarios are run on real applications.

The client is accepted if the following scenarios pass:

1. An unauthorized Telegram user gets no access to tasks, files or permission buttons.
2. Two topics keep independent histories; replies and attachments arrive in the right topic.
3. A task from Telegram changes a test file on Windows, then checks the result with a local command. A similar scenario passes on the Mac.
4. A working file is not created on the VPS instead of the chosen local computer.
5. Switching the device changes where things actually run, doesn't move files automatically and doesn't let an old command run on the new device.
6. Two profiles work independently; changing the profile doesn't use the other profile's secrets or the previous session ID.
7. Denying a permission prevents execution; a repeated tap or a stale button doesn't start the operation.
8. A repeated Telegram update or network message doesn't cause a repeated write, a second commit or a repeated render launch.
9. A connection drop during a change gives a reliable outcome or an explicitly marked unknown result, without a blind retry.
10. `/stop` stops a supported local command and reports the actions that were already done or can't be stopped.
11. After a server restart, topics, profiles, projects and the ability to continue a completed session are preserved.
12. In Roblox Studio the right instance is chosen; a test script is read, changed and checked by running it.
13. In After Effects a test composition is changed, and a preview or render result available to the integration is obtained.
14. In Blender a test scene is changed, a local file is saved and an image is returned.
15. In Figma a test file is read and changed; a link to the result is returned.
16. Chrome opens a test page and fills in a test field on the chosen computer; a different browser is never chosen implicitly.
17. Git status, diff, commit and an explicitly requested push run in the local repository.
18. A file from Telegram is delivered to the right device, and a local result is returned to the user; temporary copies are cleaned up.
19. Revoking a device stops it from getting new commands; working with it again requires a new pairing.
20. A backup makes it possible to restore the server state on a clean installation by following the instructions.

The final report contains the scenarios passed, the OS and application versions, known limitations and a list of open requirements. A feature is not considered verified just because the model replied successfully — an observable result from the tool or application is needed.

## 23. Deliverables

Hand over to the owner:

- the source code of the server and local parts;
- deployment and update instructions;
- Windows and macOS installers, with their signing status stated;
- configuration templates without secrets;
- a description of the protocol and the data schema;
- instructions for pairing devices and setting up profiles and projects;
- settings and instructions for each integration;
- a backup and restore script;
- acceptance results and a list of limitations;
- a short user cheat sheet for the Telegram commands.

## 24. Next versions

After version 1.0, the following can be added: voice message recognition, video processing, search across the whole history, task scheduling, desktop control, more devices, extended execution policies and managed project sync.

These features must not complicate the essential scenario: write a task in Telegram and get the result of the work on the chosen computer.

## 25. Official technical references

The links are used to check compatibility. API, SDK and MCP versions are pinned at the start of implementation; a feature being in the documentation does not replace testing the specific combination.

- Telegram Bot API, topics and messages: https://core.telegram.org/bots/api
- Claude Code, system requirements: https://code.claude.com/docs/en/setup
- Agent SDK, sessions: https://code.claude.com/docs/en/agent-sdk/sessions
- Agent SDK, permissions: https://code.claude.com/docs/en/agent-sdk/permissions
- Agent SDK, questions to the user: https://code.claude.com/docs/en/agent-sdk/user-input
- Claude Code and MCP: https://code.claude.com/docs/en/mcp
- Claude Code and Chrome: https://code.claude.com/docs/en/chrome
- Figma MCP: https://developers.figma.com/docs/figma-mcp-server/
- Remote Figma MCP: https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/
- Roblox Studio MCP: https://github.com/Roblox/creator-docs/blob/main/content/en-us/studio/mcp.md
- Possible original codebase: https://github.com/scottlaren/tg-claude

The specific MCP repositories for After Effects and Blender must be taken from the owner's current configuration and entered into the integration registry at stage A.
