import { Bot, InlineKeyboard, InputFile, type Context } from 'grammy'
import type { Message, ReactionTypeEmoji, ReplyParameters } from 'grammy/types'
import { randomInt, randomBytes, randomUUID, createHash } from 'node:crypto'
import { readFileSync, readdirSync, rmSync, writeFileSync, statSync, mkdtempSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir, freemem, totalmem, platform, release, hostname } from 'node:os'
import { disk, diskLow, dirSize, claudeVersions, bytes, duration, SERVER_VERSION } from '../diag.ts'
import { listBackups } from '../backup.ts'
import { pullFile, relayFile } from '../transfer.ts'
import { redact, revealText } from './redact.ts'
import { pageRow } from './pages.ts'
import { MUTATING_TOOLS, FILE_CHUNK_BYTES, CLOUD_DEVICE_ID, SEND_FILE_MAX_BYTES, FILE_GET_MAX_BYTES, RESERVED_MCP_NAMES,
  type McpServerInfo, type OpTool, type ContextFile, type ProjectContext, type Project, type GitHubStatus, type GitHubLogin, type GitHubToken, type BrowserProxyState,
  type SelfUpdateResult, newer, mcpInstallProblem, UPDATE_UNREACHED, type ToolResult, type DeviceTool, DEVICE_SKILL_BYTES, type DeviceSkill, type McpCallResult, SCREEN_LOOKS, type ScreenParams, type ScreenResult, sparsePatterns } from '@tgcv/protocol'
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { whenOnline, type Gateway, type OpOutcome, type Device } from '../gateway.ts'
import { notesIn, type Updates, type Release } from '../updates.ts'
import type { DeviceRegistry, Pairing } from '../devices.ts'
import type { TopicStore } from '../store.ts'
import { readJson, writeJson, topicKey, expiryOf, browserDone, browserIdle, MODES, EFFORTS, type Mode, type Effort, type Topic, type Suggestion } from '../store.ts'
import type { Log } from '../log.ts'
import type { ServerConfig } from '../config.ts'
import { runTurn, compactSession, HOST_TOOLS, type PromptImage, type TurnCanUseTool, type RemoteStatus } from '../claude/runner.ts'
import { isRemoteTool } from '../claude/remote.ts'
import {
  classifyChrome, chromeHooks, createBrowserLock, listBrowsers, sameOs, isChromeTool, surelyThroughServer, chromeScreenshot, CHROME_SERVER, type Browser,
} from '../claude/chrome.ts'
import type { BrowserStore } from '../browsers.ts'
import type { Profiles, ProfileUsage, Window } from '../profiles.ts'
import { startLogin, startMcpLogin, type LoginRun, type McpLoginRun } from '../login.ts'
import { installLines } from '../install.ts'
import type { AgentBundles } from '../bundle.ts'
import type { Owners } from '../owners.ts'
import type { Sandbox, SandboxState } from '../sandbox.ts'
import { usageMarkdown, planLabel, maskEmail, costLabel, resetTag, bar, epochMs } from './usage.ts'
import { createLimitWatch, limitWarning } from './limit-watch.ts'
import { createAppServer, appToolOf } from '../claude/app-tools.ts'
import { decide } from '../claude/policy.ts'
import { resolvedPublicUrl, fetchWebMedia, carriesData } from '../net.ts'
import { createDeviceServer, isDeviceTool, deviceToolOf } from '../claude/device-tools.ts'
import { offlineAppend, systemAppend, envChangedNote, ECONOMY, browserBlock, computersReport, ownComputerBlock, noProjectAppend, TEAM, teamLinks, scheduleBlock, BROWSER_ASK, agentBlock, HEAD_TASK, HEAD_MESSAGE } from '../claude/prompt.ts'
import { createSurveyServer, ASK_SURVEY, SURVEY_SERVER, type SurveyInput, createTopicServer, createTopicNameServer, createComputerServer, SUGGEST_PROJECT, TOPIC_SERVER, RENAME_TOPIC, TOPIC_NAME_SERVER, SUGGEST_COMPUTER, COMPUTER_SERVER, COPY_TO_COMPUTER, SYNC_BRANCH, WHERE_TO_RUN, type SyncBranch, createDeleteServer, DELETE_SERVER, DELETE_TOPICS, type DeleteTopics, createDeferServer, DEFER_SERVER, DEFER_TASK, createMessageServer, MESSAGE_SERVER, MESSAGE_TOPIC, type TopicMessage } from '../claude/topic-tools.ts'
import { answerTarget, canTalkOffline, cloneableRemote, computerNameProblem, deferredPrompt, findComputer, groupProjects, modeCapOf, otherComputers, senderCap, stricterMode, topicMessagePrompt, worktreePath } from './computers.ts'
import { createProjectCopy, MOVE_SKIP } from './project-copy.ts'
import { createScheduleServer, SCHEDULE_SERVER, SCHEDULE_TASK } from '../claude/schedule-tools.ts'
import { usageWidgetHtml } from './usage-widget.ts'
import { nowWidgetHtml, nowAnswer, NOW_QUERY } from './now-widget.ts'
import { nightWidgetHtml } from './night-widget.ts'
import { createRenderWatch, readCommand, readOutput, renderStarted, renderWidgetHtml, renderLine, renderAnswer, RENDER_QUERY, type RenderJob } from './render-watch.ts'
import { statusWidgetHtml, type StatusWidget } from './status-widget.ts'
import { createWidgetServer, widgetProblem, loadWidgetGuide, isWidgetTool, WIDGET_SERVER, WIDGET_PROMPT, type WidgetRequest } from '../claude/widget-tools.ts'
import { createSkills, createSkillsServer, skillsBlock, fromFile, fromGitHub, fromGitHubVia, parseGitHub, isSkillTool, NotPublic, INSTALL_SKILL, SKILLS_SERVER, SKILL_LIMITS, type FoundSkill, type SkillScope, type Via } from '../claude/skills.ts'
import { createBrowserAskServer, createBrowserOpenServer, BROWSER_ASK_SERVER, ASK_FOR_BROWSER, BROWSER_OPEN_SERVER, OPEN_CHROME } from '../claude/browser-tools.ts'
import { createSchedule } from '../schedule.ts'
import { mdText } from './schedule-menu.ts'
import { createScheduleMenu } from './schedule-menu.ts'
import { createUsersMenu } from './users-menu.ts'
import { setBotAvatar } from './avatar.ts'
import { createTopicState, turnState, type TopicState } from './topic-state.ts'
import { answeredCount, createSurveyStore, newSurvey, surveyMarkdown, surveyResult, surveyRows, surveyTap, surveyText, type Survey, type SurveyEnd, type SurveyStep } from './survey.ts'
import { appEmoji, animatePayload, claudeEmoji, hashtag, plainEmoji, thinkingStatus, toolStatus, writingStatus } from './emoji.ts'
import { topicTitle } from '../claude/title.ts'
import { createTeamServer, isTeamTool, TEAM_READ, TEAM_SERVER, type TeamHandlers } from '../claude/team-tools.ts'
import { createModelCatalog, type ModelCatalog } from '../models.ts'
import { createNetWatch } from '../claude/netwatch.ts'
import { createDrafter, type Drafter } from './drafter.ts'
import { createQueueStore } from './queue-store.ts'
import { createFlightStore } from './flights.ts'
import { failureText } from './failure.ts'
import { createRecovery } from './recovery.ts'
import { createGroupLimit, createStatusBubble, isGroupChat, limitTransformer, quietMark } from './group-limit.ts'
import { createWorkspaceMenu, groupLink, WORKSPACE_START, WORKSPACE_NEW } from './workspace-menu.ts'
import { createCompanion, COMPANION_NEW } from './companion.ts'
import { createCompanionStore } from '../companions.ts'
import { findPictures } from '../commons.ts'
import { companionTurn } from '../claude/companion.ts'
import type { Secret } from './leak.ts'
import { createDecisionsMenu } from './decisions-menu.ts'
import { createQuietMenu, createQuietStore, keepLoud, keepSilent, quietLabel, quietTransformer } from './quiet.ts'
import { notStickerCaption, prepareSticker, type StickerCheck } from './sticker.ts'
import { createVoiceTasks, isList, SPLIT_MIN_CHARS } from './voice-tasks.ts'
import { splitTasks } from '../claude/split-tasks.ts'
import { createLockMenu, createLocks } from './lock-menu.ts'
import { moveCard, type PortableSettings } from './settings-move.ts'
import { cleanable, firstNames, folderName, lastMoved, parseWorktrees, type Worktree } from './worktree-clean.ts'
import { createHeavyStore } from './heavy.ts'
import { instructionNotes, toldOf, type Section } from './told.ts'
import { createChecklistServer, livePlan, finalPlan, CHECKLIST_SERVER, SET_CHECKLIST, type ChecklistStep } from '../claude/checklist-tools.ts'
import { toolResultImage, imageMime } from '../claude/tool-results.ts'
import { stageUploads } from '../claude/browser-upload.ts'
import { createShiftServer, SHIFT_SERVER, isShiftTool } from '../claude/shift-tools.ts'
import { createShifts, morningAfter, wrapAfter, shiftCard, startedLine, morningPing, shiftRule, agentShiftRule, strongerPower, strongerTidy, type Shift, type ShiftPower, type ShiftTidy } from './night-shift.ts'
import { createPowerServer, POWER_SERVER, POWER_TOOL, type PowerOffer } from '../claude/power-tools.ts'
import { createStuckWatch, failureOf, stuckForClaude, type StuckReason } from './stuck.ts'
import { createPauses, resumePrompt, untilOf, MAX_LIMIT_ATTEMPTS, type Pause } from './limit-pause.ts'
import { createDecisionStore } from '../decisions.ts'
import { createNightStore } from '../night.ts'
import { RECORD_DECISION, DECISION_SERVER } from '../claude/decision-tools.ts'
import { NIGHT_RULE, nightDeny, nightRefusal, powerDeny, powerRefusal } from '../claude/night-guard.ts'
import { tidyCommand, parseTidy, tidyLine } from './tidy.ts'
import { sleepCommand, offCommand, type PowerHow } from './sleep.ts'
import { inherited, type WorkspaceStore } from '../workspaces.ts'
import { createZonesMenu } from './zones.ts'
import { compactView, compactingText, compactedText, shouldOffer, AGENT_WINDOW, TOPIC_WINDOW } from './compact.ts'
import { createSpeechSetup } from './speech.ts'
import { createHandIn, handInNote, justHandedIn, ownWords, HAND_IN } from './hand-in.ts'
import { createFolderRetry, isBusyFolder, rmdirCommand } from './busy-folder.ts'
import { createSpend } from './spend.ts'
import { createOffers, createOverview, topicWay, botUserOf } from './overview.ts'
import { createMoveOffers } from './move-offers.ts'
import { linkNames } from './agent-links.ts'
import { createPresence } from './presence.ts'
import { createContextTrust, heldBackBlock, heldBackPreview, textHash } from './context-trust.ts'
import { createRuleServer, withRule, RULE_SERVER, SUGGEST_RULE } from '../claude/rule-tools.ts'
import { createFreshServer, FRESH_SERVER, OFFER_FRESH } from '../claude/fresh-tools.ts'
import { createNewSessionServer, NEW_SESSION_SERVER, OFFER_NEW_SESSION } from '../claude/session-tools.ts'
import { createNewSessionOffers } from './new-session.ts'
import { createErrandServer, errandRules, screenshotPaths, ERRAND_SERVER, ERRAND_TOOL, type Errand, type ErrandResult } from '../claude/errand-tools.ts'
import { createScreenAskServer, createScreenServer, screenBlock, SCREEN_ACCESS_SERVER, ASK_FOR_SCREEN, SCREEN_SERVER, SCREEN_TOOL } from '../claude/screen-tools.ts'
import { createLottieServer, LOTTIE_SERVER, LOTTIE_TO_SVG, type LottieRequest } from '../claude/lottie-tools.ts'
import { lottieToSvg, svgName } from '../lottie.ts'
import { lottieSummary } from '../lottie-file.ts'
import { zip } from '../zip.ts'
import { tr, setLang, guessLang, loadLang, followLang, lang, type Lang, count } from '../i18n.ts'
import { sizeLabel, type Inbox, type Attachment } from '../attachments.ts'
import { videoFrames, transcribe, transcribeData, shrinkImage, missingForSpeech, onlyModelMissing, type MediaConfig } from '../media.ts'
import { VIEWABLE, IMAGE_INLINE_MAX, attachmentLine, customEmojiNote, asText, fenced, langOf, lines, topicName, prepStatus, kindLabel, replyContext, forwardContext, forwardedText, captionOf, editedPrompt, dislikedPrompt, justDisliked, justPraised, praisedNote, replaceQueued, turnReaction, type Kind } from './incoming.ts'
import {
  toolStep, draftMarkdown, finalMarkdown, splitMarkdown, permissionMarkdown, questionMarkdown, interruptedSummary, starredLabel,
  PLAIN_LIMIT, verdictLabel, plural, replyQuestion, findDeviceMedia, isSticker, isInMessage, stickerCaption, stickerNote, embedDeviceMedia, splitReplies, replyButtons, isClipped, plainTable, withoutButtons, settledMarkdown, statusMarkdown, STATUS_TIME_STEP_MS, defuseButtons, keepOwnButtons, richButtons, questionButtons, reusableMedia, suggestionData, suggestionId, markdownQuote, foldedQuote, withoutUploads, uploadCaption, richLines, type RichButton, type SentMedia, type Verdict, type Question, type MediaKind, type MediaRef,
} from './render.ts'

// Evaluated when shown: the descriptions follow the bot's language
const commands = () => [
  { command: 'now', description: tr('What is running and what waits for you, in all your topics', 'Что идёт и что ждёт твоего решения во всех топиках') },
  { command: 'project', description: tr('Choose a computer and project', 'Выбрать компьютер и проект') },
  { command: 'devices', description: tr('Computers: online, working folders, unlink', 'Компьютеры: в сети, рабочие папки, отвязать') },
  { command: 'lock', description: tr('Lock all computers: undone only at the computer', 'Заблокировать все компьютеры: снять можно только за ними') },
  { command: 'pair', description: tr('Connect a new computer', 'Подключить новый компьютер') },
  { command: 'github', description: tr('GitHub: where it is connected, sign-in for the cloud', 'GitHub: где подключён, вход для облака') },
  { command: 'proxy', description: tr('Your Chrome through the server: on, off', 'Твой Chrome через сервер: включить, выключить') },
  { command: 'move', description: tr('Move a project from the cloud to a computer', 'Перенести проект из облака на компьютер') },
  { command: 'team', description: tr("This topic's agents: where, which model, what they do", 'Агенты этого топика: где, какая модель, что делают') },
  { command: 'tools', description: tr('Apps on the computer and their state', 'Приложения на компьютере и их состояние') },
  { command: 'new', description: tr('New session in this topic', 'Новая сессия в этом топике') },
  { command: 'compact', description: tr('Conversation history: how full, compact it', 'История разговора: сколько занято, сжать') },
  { command: 'users', description: tr('Which accounts the bot answers', 'Каким аккаунтам отвечает бот') },
  { command: 'schedule', description: tr('Tasks on a schedule: list, pause, time zone', 'Задачи по расписанию: список, пауза, часовой пояс') },
  { command: 'status', description: tr('Where the topic runs, session, queue', 'Где работает топик, сессия, очередь') },
  { command: 'stop', description: tr('Stop the task', 'Остановить задачу') },
  { command: 'mode', description: tr('Permissions: ask, no questions, read-only', 'Разрешения: спрашивать, без вопросов, только просмотр') },
  { command: 'model', description: tr('Model, effort, answer length', 'Модель, усилие, краткость ответов') },
  { command: 'browser', description: tr("This computer's Chrome: turn on in the topic, choose", 'Chrome этого компьютера: включить в топике, выбрать') },
  { command: 'profile', description: tr("This topic's Claude profile", 'Профиль Claude этого топика') },
  { command: 'profiles', description: tr('All Claude profiles: accounts and sign-in', 'Все профили Claude: аккаунты и вход') },
  { command: 'usage', description: tr('Profile limits: 5 hours, week', 'Лимиты профилей: 5 часов, неделя') },
  { command: 'diag', description: tr('State of the server, computers and integrations', 'Состояние сервера, компьютеров и интеграций') },
  { command: 'update', description: tr('New version: check and update', 'Новая версия: проверить и обновиться') },
  { command: 'cleanup', description: tr('Delete temporary files, history, logs', 'Удалить временные файлы, историю, журналы') },
  { command: 'computer', description: tr('Continue this topic on another computer', 'Продолжить этот топик на другом компьютере') },
  { command: 'topic', description: tr('New topic: /topic name', 'Новый топик: /topic название') },
  { command: 'workspace', description: tr('Workspaces: groups with their own topics', 'Воркспейсы: группы со своими топиками') },
  { command: 'decisions', description: tr('Decisions all topics of a workspace read', 'Решения, которые читают все топики воркспейса') },
  { command: 'quiet', description: tr('Quiet mode: a push only when you are needed or all is done', 'Тихий режим: уведомление, только когда нужен ты или всё готово') },
  { command: 'delete', description: tr('Delete this topic and its session on the server', 'Удалить этот топик и его сессию на сервере') },
  { command: 'language', description: tr('Bot language: English or Russian', 'Язык бота: английский или русский') },
  { command: 'help', description: tr('Help', 'Справка') },
]

const CHROME_CONNECT_MS = 8000
// Projects offered in one list when the user picks one on another computer
const PICK_MAX = 20

// Accounts, pairing codes, the state of the server: not for a group, where others may read along
const PRIVATE_ONLY = ['users', 'devices', 'pair', 'github', 'tools', 'profile', 'profiles', 'diag', 'update', 'cleanup']
// Nothing to do in a group with no topics
const TOPICS_ONLY = ['topic', 'team', 'delete']
const NO_TOPICS = () => tr('This group has no topics, so there is nothing for this to work on. Turn on Topics in its settings to get topics and agents.', 'В этой группе нет тем, поэтому здесь это не работает. Включи «Темы» в настройках группы: появятся топики и агенты.')

// Where git keeps what it runs by itself. The trailing dots and :$INDEX_ALLOCATION are other ways Windows spells the same folder
const INSIDE_GIT = /(?:^|[\\/])\.(?:git|husky|githooks)[. ]*(?::[^\\/]*)?(?:[\\/]|$)/i

// Answers a 👎 can still reach. Lost on a restart: an old answer then just takes no reaction
const ANSWERS_KEPT = 200
const PERMISSION_TIMEOUT_MS = 30 * 60_000 // §13: no answer means no action
// Projects per page in the picker; the device lists the most recently touched first
const PICKER_PAGE = 8
const MAX_IMAGES = 20 // per turn: albums and video frames add up fast, and every image costs tokens
// A picker shown this recently is still on screen: a second one would only add noise
const PICKER_FRESH_MS = 10 * 60_000
const pickerFresh = (l: { pickerAt: number }) => Date.now() - l.pickerAt < PICKER_FRESH_MS
const DEDUP_SIZE = 1000
// Telegram hands bots files up to 20 MB; bigger ones never reach the server
const TG_FILE_MAX = 20 * 1024 * 1024
// A picture an answer names but the computer doesn't have yet is looked for again after this
const MEDIA_RETRY_MS = 60_000
// An app's MCP call waiting this long is offered a restart of its bridge
const APP_HANG_MS = 3 * 60_000
// How often the heads' team boards are looked at
const BOARD_TICK_MS = 10_000
const NO_FILE = /no such file|not found/i
const ABSOLUTE = /^([a-z]:)?[\\/]/i
// 20 MB over a slow link still fits; a stalled one is dropped and tried again
const DOWNLOAD_TIMEOUT_MS = 3 * 60_000
const DOWNLOAD_TRIES = 3
// What to do with a file too big for Telegram's 50 MB from a bot
const tgTooBig = () => tr('Telegram takes up to 50 MB from a bot: make a lighter preview or leave the file on the computer', 'Telegram принимает от бота до 50 МБ: сделай превью полегче или оставь файл на компьютере')
// …and takes photos from a bot up to 10 MB (other files up to 50 MB)
const PHOTO_MAX = 10 * 1024 * 1024

const OS_ICON = { windows: '🖥', macos: '💻', linux: '🐧' } as const
// The cloud is a Linux container on the server, but to the user it is “☁️ Cloud”, not one more Linux box
const isCloud = (id?: string) => id === CLOUD_DEVICE_ID
const iconOf = (d: { id: string, os?: keyof typeof OS_ICON }) => (isCloud(d.id) ? '☁️' : d.os ? OS_ICON[d.os] : '💻')
// The same in a text. Buttons take only plain emoji: they keep iconOf
const osIcon = (d: { id: string, os?: keyof typeof OS_ICON }) => (isCloud(d.id) ? iconOf(d) : d.os === 'windows' ? appEmoji('windows') : d.os === 'macos' ? appEmoji('apple') : iconOf(d))
const onDevice = (d: { id: string, name: string }) => (isCloud(d.id) ? tr('in the cloud', 'в облаке') : tr(`on ${d.name}`, `на ${d.name}`))
// Said whenever a topic settles in the cloud: it is a waiting room for projects, not their home
const cloudNote = (deviceId: string) => (isCloud(deviceId) ? tr("\n<i>☁️ The cloud is a temporary place: once a computer is on, I'll offer to move the project there.</i>", '\n<i>☁️ Облако — временное место: когда включится компьютер, предложу перенести проект туда.</i>') : '')

import { trunc, wellFormed } from './text.ts'
// Topic id for messages inside a private-chat topic; undefined for the plain chat
const topicOf = (msg?: Message) => (msg?.is_topic_message ? msg.message_thread_id : undefined)
const where = (topicId?: number) => (topicId ? { message_thread_id: topicId } : {})
// Service messages are edited in place, which rich messages can't be: they are formatted with HTML instead
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// A long error folded: its first lines say what happened, the rest is a tap away
// Where a sign-in opened, as the computer reports it
const loginBrowser = (r: unknown) => {
  const { browser, own } = r as { browser: string, own?: boolean }
  return own ? tr('your Chrome', 'твоём Chrome') : esc(browser)
}
const errorHtml = (text: string) => (text.length > 200 ? `<blockquote expandable>${esc(text)}</blockquote>` : esc(text))
const HTML = { parse_mode: 'HTML' } as const

type Live = {
  // How many times in a row the limit has stopped the task of this topic
  limitAttempts?: number
  // The steps Claude listed for the turn under way, as it last ticked them
  checklist?: ChecklistStep[]
  busy: boolean
  // When the turn under way began
  since?: number
  queue: Incoming[]
  abort: AbortController | null
  draftId: number
  allowAll: boolean
  timer: NodeJS.Timeout | undefined
  waitingDevice: boolean
  // This turn answers another topic: it can't do more than that topic could
  modeCap?: Mode
  // The messages this turn answers include the owner's own words: only then can it record a decision
  ownerSpoke?: boolean
  // Whether the messages this turn answers have been deleted, and that the answer is taken back
  promptGone?: () => Promise<boolean>
  answerTakenBack?: boolean
  // Told once, each time the computer goes away, that the conversation can go on
  offlineNoted?: boolean
  // Told once that this topic's messages wait for an update
  updateNoted?: boolean
  // Set while Claude waits for an answer: the next text message in the topic is that answer
  answer: ((text: string) => void) | null
  // Set after “➕ New project”: the next text message is the project's name, on this device
  newProjectOn: string | null
  // Scheduled tasks in the turn now working: the next run of one of them doesn't start on top of it
  runs: Set<string>
  // The device/project picker is already in the topic: don't post another one for each queued message
  pickerAt: number
  // Files still downloading, transcribing or being cut into frames: the turn waits for them
  preparing: number
  // The draft bubble that says what is being prepared; Claude's turn then streams into the same bubble
  prep: Prep | null
  // Arrival order of messages, so a slow voice message keeps its place before a quick text
  arrivals: number
  // Bumped by /stop: media that finishes preparing after it is dropped
  epoch: number
  // The turn under way, for /now and for ⚡. toolSince: when the tool it waits on was called, 0 between tools
  now?: { since: number, status: () => string, kick: () => void, toolSince: number }
  // Handed in to this turn, not confirmed read yet
  handing?: { id: string, items: Incoming[] }[]
}

// seen: files of each kind in this batch (an album counts its photos), active: still being prepared
type LiveView = {
  markdown: (p: { steps: string[], text: string, status: string, plan?: string }) => string
  send: (md: string) => Promise<unknown>
  end: () => Promise<void>
  minGap?: () => number
  heartbeat?: number
}
type Prep = { draftId: number, drafter: Drafter, view: LiveView, seen: Map<Kind, number>, active: Map<Kind, number> }

type Pending = {
  // Its buttons are inside the message: what to send again to take them away
  choice?: Choice
  resolve: (r: PermissionResult) => void, tool: string, input: Record<string, unknown>, live: Live, timer: NodeJS.Timeout, key: string,
}

type Asking = { key: string, q: Question, selected: Set<number>, done: (answer: string | null) => void, choice?: Choice }
// A rich message with buttons in it: what to send again to change or remove them
export type Choice = { messageId: number, md: string }

// One message waiting for Claude: its text and the pictures it carries (photos, album, video frames)
// The message in the chat that stands for what waits: the user's own, or the one the bot showed for it
const waitingOn = (i: { msgId?: number, shownId?: number } | undefined) => i?.msgId ?? i?.shownId
// continuation: this goes on with a turn a restart cut off: how many times it has by now, and what was asked
type Incoming = { seq: number, text: string, images: PromptImage[], context?: string, msgId?: number, shownId?: number, scheduleId?: string, waitMark?: boolean, fromMode?: Mode, continuation?: { n: number, asked: string }, rush?: boolean, ownAnswers?: boolean }
// What a photo, file, voice or video message turns into once prepared; plain: the text when it answers a question
type Prepared = { text: string, images?: PromptImage[], plain?: string, shownId?: number }

// How a turn ended, for a worker's report to its head
// paused: the limit stopped it and it goes on by itself, so a head has nothing to hear yet
// paused: the task is not over, it goes on later. moved: it goes on at once, on another profile
type TurnOutcome = { text: string, note?: string | null, stopped?: boolean, paused?: boolean, moved?: boolean }
// The project a picture in a message is fetched through
type MediaOp = { deviceId: string, projectId: string, bindingVersion: number }

// A file embedded in a rich message, referenced from its markdown by tg://<kind>?id=<id>
type Upload = { id: string, kind: MediaKind, name: string, mime: string, data: Buffer }
// note: why it can't come at all, which goes in the text. Otherwise the file, and whether it fits
type PulledSticker = { ref: MediaRef<'sticker'>, note?: string, file?: { name: string, mime: string, data: Buffer }, check?: StickerCheck }

export function createBot({ cfg, topics, workspaces, gateway, registry, pairing, log, workDir, inbox, media, browsers, profiles, owners, sandbox, updates, bundles, runTurn: startTurn = runTurn, hear = transcribeData, splitVoice = splitTasks, companionTurn: askCompanion = companionTurn, companionWeb = { findPictures, download: fetchWebMedia } }: {
  cfg: ServerConfig, topics: TopicStore, workspaces: WorkspaceStore, gateway: Gateway, registry: DeviceRegistry, pairing: Pairing, log: Log, workDir: string,
  inbox: Inbox, media: MediaConfig, browsers: BrowserStore, profiles: Profiles, owners: Owners, sandbox?: Sandbox, updates: Updates,
  // The agent's archive: computers installed from /pair update from it, checked against its checksum
  bundles?: AgentBundles,
  // Claude, which a test replaces with a function it finishes by hand
  runTurn?: typeof runTurn,
  // The same for speech recognition and the helper that sorts a long voice message
  hear?: typeof transcribeData,
  splitVoice?: typeof splitTasks,
  // And for an answer in a companion chat
  companionTurn?: typeof companionTurn,
  // Where a companion chat's pictures come from
  companionWeb?: { findPictures: (query: string) => Promise<{ title: string, url: string }[]>, download: (url: string) => Promise<{ name: string, data: Buffer }> },
}) {
  const bot = new Bot(cfg.token, cfg.apiRoot ? { client: { apiRoot: cfg.apiRoot } } : undefined)
  const api = bot.api
  const ownButtonsOnly = (payload: Record<string, unknown>) => {
    const rich = payload.rich_message as { markdown?: string } | undefined
    return rich?.markdown ? { ...payload, rich_message: { ...rich, markdown: keepOwnButtons(rich.markdown) } } : payload
  }
  // Last of all, whatever was cut on the way: half a character anywhere in a message and Telegram refuses all of it
  api.config.use((prev, method, payload, signal) => prev(method, wellFormed(animatePayload(method, ownButtonsOnly(payload as Record<string, unknown>))) as typeof payload, signal))
  // grammY handles updates one at a time, and a handler it waits for holds up every topic and account, with /stop and
  // permission buttons among them. What takes long runs beside the queue
  const inFlight = new Set<Promise<unknown>>()
  const background = (work: Promise<unknown>) => {
    const p: Promise<unknown> = work
      .catch(e => log.warn('background', (e as Error).message))
      .finally(() => inFlight.delete(p))
    inFlight.add(p)
  }
  // A group with no topics gets a list of its own; with topics, the one all groups have
  const groupCommands = (chatId: number, plain: boolean) => (plain
    ? api.setMyCommands(commands().filter(c => !PRIVATE_ONLY.includes(c.command) && !TOPICS_ONLY.includes(c.command)), { scope: { type: 'chat', chat_id: chatId } })
    : api.deleteMyCommands({ scope: { type: 'chat', chat_id: chatId } })
  ).catch(e => log.warn('group commands', (e as Error).message))
  const syncCommands = () => Promise.all([
    api.setMyCommands(commands()),
    // Typing a command relies on these suggestions, so everything that works here is listed
    api.setMyCommands(commands().filter(c => !PRIVATE_ONLY.includes(c.command)), { scope: { type: 'all_group_chats' } }),
    ...workspaces.list().filter(w => w.plain).map(w => groupCommands(w.chatId, true)),
    companion.commandsFor(),
  ])
  // Groups where the bot only talks, apart from workspaces: nothing made for the owner's work finds them
  const companions = createCompanionStore(cfg.dataDir)
  // Speech somebody waits for, counted: what is heard for nobody in particular lets it go first
  let hearingNow = 0
  const hearFirst: typeof hear = async (data, c) => {
    hearingNow++
    try {
      return await hear(data, c)
    } finally {
      hearingNow--
    }
  }
  const groupLimit = createGroupLimit()
  api.config.use(limitTransformer(groupLimit))
  loadLang(join(cfg.dataDir, 'language.json'))
  // The message about SSH logins is sent by the VPS itself (deploy/tgcv-ssh-alert.sh), in the bot's language
  followLang(l => {
    if (!process.env.UPDATE_DIR) return
    try {
      writeFileSync(join(process.env.UPDATE_DIR, 'lang'), l)
    } catch {}
  })
  // Sent answers by chat and message id: a 👎 names only those, neither the topic nor the text. Ids repeat between chats
  const answers = new Map<string, { key: string, text: string }>()
  const topicState = createTopicState({ api, log, load: key => topics.get(key).icon, save: (key, icon) => topics.set(key, { icon }) })
  const schedules = createSchedule(join(cfg.dataDir, 'schedule.json'))
  const spend = createSpend(join(cfg.dataDir, 'spend.json'), cfg.weekEstimate ? { week: cfg.weekEstimate } : {})
  // Two groups each have a «Head»: the group's name tells them apart
  const spendName = (t: Topic) => (t.workerName ? `🤖 ${t.workerName}` : t.title)
  const spendLabel = (key: string, saved?: string) => {
    const { chatId, topicId } = parseKey(key)
    const name = spendName(topics.get(key)) ?? saved ?? (chatId > 0 ? tr('private chat', 'личка') : topicId ? tr('deleted topic', 'удалённый топик') : tr('general chat', 'общий чат'))
    const group = chatId < 0 ? workspaces.get(chatId)?.title : undefined
    return group ? `${name} · ${group}` : name
  }
  const pauses = createPauses(join(cfg.dataDir, 'paused.json'), { warn: m => log.warn('paused work not saved', m) })
  const limitWatch = createLimitWatch({
    ...(cfg.freshOfferPct !== undefined && { offerAt: { fiveHour: cfg.freshOfferPct, week: cfg.freshOfferPct } }), file: join(cfg.dataDir, 'limit-warnings.json'), usage: n => profiles.usage(n), last: n => profiles.lastLimit(n) })

  // The models to pick from, as the account lists them, so a new one needs no release. A topic or group that chose an
  // older version of a family moves to its newest: it chose Fable, not Fable 5.1
  const models: ModelCatalog = createModelCatalog({
    file: join(cfg.dataDir, 'models.json'),
    fetch: () => profiles.models(profiles.defaultName),
    onChange: () => upgradeModels(),
  })
  const agentModel = (family: string) => models.list().find(m => m.family === family)?.value ?? family
  function upgradeModels() {
    for (const [key, t] of topics.entries()) {
      const to = t.model && models.upgrade(t.model)
      if (!to) continue
      topics.set(key, { model: to })
      log.info('model upgraded', { key, from: t.model, to })
    }
    for (const w of workspaces.list()) {
      const to = w.model && models.upgrade(w.model)
      if (to) workspaces.update(w.chatId, { model: to })
    }
  }
  upgradeModels()
  void models.refresh()
  setInterval(() => void models.refresh(), 6 * 3600_000).unref()
  const live = new Map<string, Live>()
  const pending = new Map<number, Pending>()
  const asking = new Map<number, Asking>()
  const surveys = createSurveyStore(join(cfg.dataDir, 'surveys.json'))
  const offers = createOffers()
  const decisionStore = createDecisionStore(join(cfg.dataDir, 'decisions'))
  const night = createNightStore(join(cfg.dataDir, 'night.json'))
  const quiet = createQuietStore(join(cfg.dataDir, 'quiet.json'))
  const shifts = createShifts(join(cfg.dataDir, 'shifts.json'))
  // A night shift is quiet all night: only its morning push makes a sound
  api.config.use(quietTransformer(chatId => quiet.on(chatId) || shifts.inChat(chatId)))
  // The shift a topic works in: its own as a head, or its head's as an agent
  const shiftOf = (key: string) => shifts.running(key) ?? (topics.get(key).head ? shifts.running(topics.get(key).head!) : undefined)
  const retries = new Map<number, { key: string, prompt: string, images: PromptImage[], fromMode?: Mode, ownAnswers?: boolean }>() // prompts behind a "repeat" button
  // Sent again under the same limits, and the owner's words stay the owner's. Whole albums sit in here and nothing else
  // takes them out, so only the latest buttons work
  const RETRIES_KEPT = 20
  const keepRetry = (id: number, key: string, prompt: string, images: PromptImage[], l: Live) => {
    retries.set(id, { key, prompt, images, fromMode: l.modeCap, ownAnswers: l.ownerSpoke })
    while (retries.size > RETRIES_KEPT) retries.delete(retries.keys().next().value!)
  }
  const seenUpdates = new Set<number>()
  // Ids behind the buttons (permissions, questions, retries): they start from the clock, so a button left in the chat
  // by an earlier run never matches a question of this one
  let permSeq = Date.now()
  // What the last turn saw of the remote MCP servers (Figma): connected, or waiting for a sign-in
  // Per profile: each signs in to Figma on its own
  const remoteStatus = new Map<string, RemoteStatus[]>()
  // §14: Claude turns running now, and topics waiting for a free slot, first come first served
  let running = 0
  const slotWaiters: string[] = []
  const wakeWaiters = () => {
    // A woken topic may have nothing left to run (stopped, device gone): then the next one gets the slot
    while (running < cfg.maxParallel && slotWaiters.length) processQueue(slotWaiters.shift()!)
  }
  // Claude keeps one chosen browser for the whole profile: topics on different browsers take turns
  const browserLocks = new Map<string, ReturnType<typeof createBrowserLock>>()
  // The Claude account a computer's Chrome is signed in to, when known: as chosen, or the computer's profile
  const chromeAccount = (deviceId: string) => browsers.get(deviceId)?.profile ?? registry.profileOf(deviceId)
  // A profile whose plan limit ran out and that goes on on paid extra usage: the user heard of it, when (once a window)
  const overageWarned = new Map<string, number>()
  const OVERAGE_WARN_MS = 5 * 3600_000
  // A topic named in another topic is the way there: one tap instead of a search through the list. For HTML and for
  // Rich Markdown; where Telegram has no link to give, it stays a name
  const topicUrl = (key: string) => topicWay(parseKey(key).chatId, parseKey(key).topicId, botUserOf(bot))
  const topicA = (key: string, name: string) => (topicUrl(key) ? `<a href="${topicUrl(key)}">${esc(name)}</a>` : esc(name))
  const topicMd = (key: string, name: string) => (topicUrl(key) ? `[${mdText(name)}](${topicUrl(key)})` : mdText(name))
  // A head's agents, each with the way to its topic: for the head's prompt, and for its answers, where the bot itself
  // turns their names into links
  const teamWays = (key: string) => workersOf(key).flatMap(k => (topicUrl(k) && topics.get(k).workerName ? [{ name: topics.get(k).workerName!, link: topicUrl(k)! }] : []))
  // When the bot moved a topic to another profile at a spent limit. Two accounts that both refuse without saying their
  // limit is spent would pass a task back and forth for ever: past a few moves an hour it waits instead
  const limitMoves = new Map<string, number[]>()
  const LIMIT_MOVES_MAX = 2
  const LIMIT_MOVES_MS = 3600_000
  const mayMoveAtLimit = (key: string) => (limitMoves.get(key) ?? []).filter(at => Date.now() - at < LIMIT_MOVES_MS).length < LIMIT_MOVES_MAX
  const movedAtLimit = (key: string) => limitMoves.set(key, [...(limitMoves.get(key) ?? []).filter(at => Date.now() - at < LIMIT_MOVES_MS), Date.now()])
  const lockOf = (profile: string) => browserLocks.get(profile) ?? browserLocks.set(profile, createBrowserLock()).get(profile)!
  // A browser errand on another computer has this long to finish
  const ERRAND_MS = 10 * 60_000
  // Browsers from the last listing, for the binding buttons (callback data only fits the id)
  const listed = new Map<string, Browser>()

  const liveOf = (key: string) => {
    let l = live.get(key)
    if (!l) {
      l = { busy: false, queue: [], abort: null, draftId: 0, allowAll: false, timer: undefined, waitingDevice: false, answer: null, newProjectOn: null, runs: new Set(), pickerAt: 0,
        preparing: 0, prep: null, arrivals: 0, epoch: 0 }
      live.set(key, l)
    }
    return l
  }
  const parseKey = (key: string) => {
    const [chat, thread] = key.split(':').map(Number)
    return { chatId: chat, topicId: thread || undefined }
  }
  const handIn = createHandIn<Incoming, Live>({
    live, chatOf: key => parseKey(key).chatId, mark: (chatId, ids, emoji) => mark(chatId, ids, emoji), gone: (chatId, id) => messageGone(chatId, id),
    maxImages: MAX_IMAGES, log, hintsFile: join(cfg.dataDir, 'hand-in-hints.json'), secret: cfg.token,
    changed: (key, l) => flights.handedIn(key, { modeCap: l.modeCap, ownerSpoke: l.ownerSpoke }),
  })

  // What goes to Telegram is always masked (emails, keys, cards…): the real values only through the
  // “Show for a minute” button. Drafts are masked quietly: they are redrawn many times a turn
  function masked(chatId: number, topicId: number | undefined, text: string, quiet = false) {
    const r = redact(text)
    if (r.found.length && !quiet) log.info('redacted', { key: topicKey(chatId, topicId), kinds: r.found })
    return r.text
  }

  async function sendPlain(chatId: number, topicId: number | undefined, text: string, extra = {}) {
    text = masked(chatId, topicId, text)
    for (const chunk of splitMarkdown(text, PLAIN_LIMIT)) await api.sendMessage(chatId, chunk, { ...where(topicId), ...extra })
  }

  // Photos and videos show inline; anything else, or a photo Telegram refuses, goes as a document.
  // original: always a document — Telegram recompresses photos and videos, a file arrives byte for byte
  async function sendFile(chatId: number, topicId: number | undefined, data: Buffer, name: string, mime: string, caption?: string, { original = false } = {}) {
    const extra = { ...where(topicId), ...(caption && { caption: trunc(masked(chatId, topicId, caption), 1000) }) }
    const file = () => new InputFile(data, name)
    if (original) return api.sendDocument(chatId, file(), extra)
    try {
      if (/^image\/(png|jpeg|webp)$/.test(mime)) return await api.sendPhoto(chatId, file(), extra)
      if (mime === 'image/gif') return await api.sendAnimation(chatId, file(), extra)
      if (/^video\/(mp4|quicktime)$/.test(mime)) return await api.sendVideo(chatId, file(), extra)
    } catch (e) {
      log.warn('inline upload refused, sending as document', (e as Error).message)
    }
    return api.sendDocument(chatId, file(), extra)
  }


  // A masked message keeps its original here for an hour, in memory only: “👁 Show for a minute”
  // sends it once more, unmasked, and deletes that copy after a minute
  const REVEAL_TTL_MS = 3600_000
  const REVEAL_SHOW_MS = 60_000
  const revealable = new Map<string, { chatId: number, topicId?: number, md: string, at: number }>()
  type Extra = { reply_markup?: InlineKeyboard, reply_parameters?: ReplyParameters }
  // The real values go to everyone who reads the chat, so in a group only if no one else is there
  const memberCounts = new Map<number, { n: number, at: number }>()
  async function mayReveal(chatId: number) {
    if (!isGroupChat(chatId)) return true
    // Whoever is in a companion chat today, it is not the owner's own place
    if (companions.get(chatId)) return false
    let c = memberCounts.get(chatId)
    if (!c || Date.now() - c.at > 60_000) {
      c = { n: await api.getChatMemberCount(chatId).catch(() => Infinity), at: Date.now() }
      memberCounts.set(chatId, c)
    }
    return c.n <= 2
  }
  function withReveal(extra: Extra, chatId: number, topicId: number | undefined, original: string): Extra {
    for (const [id, r] of revealable) if (Date.now() - r.at > REVEAL_TTL_MS) revealable.delete(id)
    const id = randomBytes(6).toString('hex')
    revealable.set(id, { chatId, topicId, md: original, at: Date.now() })
    // Under the message's own buttons (permission prompts, questions), or alone
    const own = extra.reply_markup ? InlineKeyboard.from(extra.reply_markup.inline_keyboard).row() : new InlineKeyboard()
    return { ...extra, reply_markup: own.text(tr('👁 Show for a minute', '👁 Показать на минуту'), `show:${id}`) }
  }

  async function sendRich(chatId: number, topicId: number | undefined, md: string, extra: Extra = {}, uploads: Upload[] = []) {
    // Only the first part of a long answer is a reply: the rest follow it
    const { reply_parameters: _first, ...rest } = extra
    const ids: number[] = []
    // The last part as it was sent, for sending it again: masked text with its “Show” button
    let last: { messageId: number, md: string, media: SentMedia[], keyboard?: InlineKeyboard['inline_keyboard'] } | undefined
    const safe = masked(chatId, topicId, md)
    const parts = splitMarkdown(safe)
    for (const [i, chunk] of parts.entries()) {
      const base = i ? rest : extra
      // One button under the whole answer, on its last part
      const ex = safe === md || i < parts.length - 1 || !await mayReveal(chatId) ? base : withReveal(base, chatId, topicId, md)
      // Each part of a long answer carries only the files its own tg:// links point to
      const used = uploads.filter(u => chunk.includes(`?id=${u.id} `))
      try {
        const sent = await api.sendRichMessage(chatId, {
          markdown: chunk,
          ...(used.length && { media: used.map(u => ({ id: u.id, media: { type: u.kind, media: new InputFile(u.data, u.name) } })) }),
        }, { ...where(topicId), ...ex })
        ids.push(sent.message_id)
        const media = reusableMedia(sent.rich_message.blocks, used)
        last = media ? { messageId: sent.message_id, md: chunk, media, keyboard: ex.reply_markup?.inline_keyboard } : undefined
      } catch (e) {
        last = undefined
        log.warn('sendRichMessage failed, falling back to plain text', (e as Error).message)
        const plainText = plainEmoji(withoutButtons(withoutUploads(chunk)))
        if (plainText) await sendPlain(chatId, topicId, plainText, ex)
        for (const u of used) await sendFile(chatId, topicId, u.data, u.name, u.mime, uploadCaption(chunk, u.id)).catch(() => {})
      }
    }
    return { ids, last }
  }

  // Fetches the files an answer points to from the device, then sends text and images as one message
  // op: the project files come from; a function picks it per file (a head shows its agents' pictures)
  async function sendRichWithDeviceMedia(
    chatId: number, topicId: number | undefined, md: string, op: MediaOp | ((path: string) => MediaOp | undefined) | undefined, extra = {},
  ) {
    const found = findDeviceMedia(md)
    const stickers = await pullStickers(chatId, found.filter(isSticker), op)
    for (const s of stickers) md = md.replace(s.ref.match, s.note ?? stickerCaption(s.ref))
    const refs = found.filter(isInMessage)
    // Not there yet: a render, an export or a merge still writing it
    const later: { r: MediaRef<MediaKind>, from: MediaOp }[] = []
    const uploads: Upload[] = []
    const fetched: ({ id: string, kind?: MediaKind } | { error: string })[] = []
    // One at a time: each file is a single message over the device link
    for (const [i, r] of refs.entries()) {
      const id = `m${i + 1}`
      // Web images are downloaded here, files on the computer come through the device
      if (r.web) {
        // The server fetching it is enough to carry out what is in its address, before anyone has seen the answer
        if (carriesData(r.path) && turnMode(topicKey(chatId, topicId)) !== 'all') {
          fetched.push({ error: tr('not downloaded: the address carries parameters. Open the link if you trust it', 'не скачано: в адресе есть параметры. Открой ссылку, если ей доверяешь') })
          continue
        }
        try {
          const f = await fetchWebMedia(r.path)
          uploads.push({ id, kind: r.kind, name: f.name, mime: f.mime, data: f.data })
          fetched.push({ id })
        } catch (e) {
          fetched.push({ error: failureText(e) })
          log.warn('media fetch failed', { url: r.path, error: (e as Error).message })
        }
        continue
      }
      // A file isn't masked as text is. Claude can still send it, after the question send_file asks in such a group
      if (!await mayReveal(chatId)) {
        fetched.push({ error: tr('not attached: others read this group. Ask Claude to send the file, and it will ask you first', 'не приложено: эту группу читают другие. Попроси Claude отправить файл, он сначала спросит') })
        continue
      }
      // A browser screenshot is on the server, where the Chrome integration saved it
      const shot = chromeScreenshot(r.path)
      if (shot) {
        uploads.push({ id, kind: r.kind, name: basename(shot), mime: /\.png$/i.test(shot) ? 'image/png' : /\.webp$/i.test(shot) ? 'image/webp' : 'image/jpeg', data: readFileSync(shot) })
        fetched.push({ id })
        continue
      }
      // A frame an app's MCP returned is kept on the server, where the CLI saved it
      const kept = toolResultImage(r.path, dirname(cfg.profileDir))
      if (kept) {
        uploads.push({ id, kind: r.kind, name: basename(kept), mime: imageMime(kept), data: readFileSync(kept) })
        fetched.push({ id })
        continue
      }
      const from = typeof op === 'function' ? op(r.path) : op
      if (!from) {
        fetched.push({ error: tr('this topic has no computer', 'у этого топика нет компьютера') })
        continue
      }
      const got = await pullMedia(r, from)
      if (!got.ok) {
        const missing = NO_FILE.test(got.error.message)
        if (missing) later.push({ r, from })
        fetched.push({ error: missing ? tr(`${got.error.message}. I'll look again in a minute`, `${got.error.message}. Посмотрю ещё раз через минуту`) : got.error.message })
        log.warn('media fetch failed', { path: r.path, error: got.error.message })
        continue
      }
      // Telegram takes photos up to 10 MB; a bigger picture still arrives, as a file
      const kind = r.kind === 'photo' && got.file.size > PHOTO_MAX ? 'document' : r.kind
      uploads.push({ id, kind, name: got.file.name, mime: got.file.mime, data: got.file.data })
      fetched.push({ id, kind })
    }
    if (refs.length) log.info('inline media', { files: refs.length, ok: uploads.length })
    const text = embedDeviceMedia(md, refs, fetched).trim()
    const sent: Awaited<ReturnType<typeof sendRich>> = text ? await sendRich(chatId, topicId, text, extra, uploads) : { ids: [], last: undefined }
    // One push for one answer: the message before them has it
    const follow = () => sendStickers(chatId, topicId, stickers)
    await (text ? keepSilent(follow) : follow())
    if (later.length) {
      const timer = setTimeout(() => sendLater(chatId, topicId, later).catch(e => log.warn('media later', (e as Error).message)), cfg.mediaRetryMs ?? MEDIA_RETRY_MS)
      timer.unref?.()
    }
    return sent
  }

  // From the computer in pieces, up to Telegram's 50 MB: a bigger file is refused before it is pulled. A picture or video
  // that isn't in the topic's project may be in another project of the same computer's working folders (a head's merged
  // branch, a file made elsewhere): it comes through that one, under the computer's own checks on what may be read
  async function pullMedia(r: MediaRef<MediaKind>, from: MediaOp) {
    const pull = (o: MediaOp) => pullFile(params => gateway.request(o.deviceId, { projectId: o.projectId, bindingVersion: o.bindingVersion, tool: 'file_get', params }), r.path, { maxBytes: SEND_FILE_MAX_BYTES, tooBig: tgTooBig() })
    const got = await pull(from)
    if (got.ok || r.kind === 'document' || !ABSOLUTE.test(r.path) || !/outside|no such file|not found/i.test(got.error.message)) return got
    const other = (gateway.device(from.deviceId)?.projects ?? [])
      .filter(p => p.id !== from.projectId && slash(r.path).startsWith(slash(p.path) + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0]
    if (!other) return got
    const again = await pull({ deviceId: from.deviceId, projectId: other.id, bindingVersion: 0 })
    if (again.ok) log.info('media from another project', { project: other.id })
    return again.ok ? again : got
  }

  // Once more, a minute later: what has turned up goes as a message of its own, what hasn't is left as said
  async function sendLater(chatId: number, topicId: number | undefined, items: { r: MediaRef<MediaKind>, from: MediaOp }[]) {
    const refs: MediaRef<MediaKind>[] = []
    const uploads: Upload[] = []
    const fetched: { id: string, kind?: MediaKind }[] = []
    for (const { r, from } of items) {
      const got = await pullMedia(r, from)
      if (!got.ok) continue
      const id = `m${refs.length + 1}`
      const kind = r.kind === 'photo' && got.file.size > PHOTO_MAX ? 'document' : r.kind
      refs.push(r)
      uploads.push({ id, kind, name: got.file.name, mime: got.file.mime, data: got.file.data })
      fetched.push({ id, kind })
    }
    log.info('media later', { files: items.length, ok: refs.length })
    if (!refs.length) return
    const md = [tr('📎 **Turned up a little later:**', '📎 **Нашлось чуть позже:**'), ...refs.map(r => r.match)].join('\n\n')
    await sendRich(chatId, topicId, embedDeviceMedia(md, refs, fetched).trim(), {}, uploads)
  }

  // Before the text goes, so that a file that can't be had is said in it, like a picture that can't
  async function pullStickers(chatId: number, refs: MediaRef<'sticker'>[], op: MediaOp | ((path: string) => MediaOp | undefined) | undefined) {
    const out: PulledSticker[] = []
    for (const ref of refs) {
      const from = typeof op === 'function' ? op(ref.path) : op
      if (!from) {
        out.push({ ref, note: stickerNote(ref, tr('this topic has no computer', 'у этого топика нет компьютера')) })
        continue
      }
      // A file isn't masked as text is: see the same check for pictures
      if (!await mayReveal(chatId)) {
        out.push({ ref, note: stickerNote(ref, tr('not attached: others read this group. Ask Claude to send the file, and it will ask you first', 'не приложено: эту группу читают другие. Попроси Claude отправить файл, он сначала спросит')) })
        continue
      }
      const got = await pullFile(params => gateway.request(from.deviceId, { projectId: from.projectId, bindingVersion: from.bindingVersion, tool: 'file_get', params }), ref.path, { maxBytes: SEND_FILE_MAX_BYTES, tooBig: tgTooBig() })
      if (!got.ok) {
        log.warn('sticker fetch failed', { path: ref.path, error: got.error.message })
        out.push({ ref, note: stickerNote(ref, got.error.message) })
        continue
      }
      out.push({ ref, file: { name: got.file.name, mime: got.file.mime, data: got.file.data }, check: prepareSticker(got.file.name, got.file.data) })
    }
    return out
  }

  // What doesn't fit, or what Telegram turns down all the same, goes as the file it is, with the reason under it
  // What each sticker the bot sent was made from: a reply to one says only «a sticker» otherwise
  const sentStickers = new Map<string, string>()
  const STICKERS_KEPT = 500
  const ownSticker = (chatId: number) => (messageId: number) => sentStickers.get(`${chatId}:${messageId}`)
  async function sendStickers(chatId: number, topicId: number | undefined, stickers: PulledSticker[]) {
    for (const { ref, file, check } of stickers) {
      if (!file || !check) continue
      let why = check.ok ? '' : check.why
      if (check.ok) {
        try {
          const sent = await api.sendSticker(chatId, new InputFile(check.tgs, check.name), where(topicId))
          const caption = stickerCaption(ref)
          sentStickers.set(`${chatId}:${sent.message_id}`, `${caption ? `«${caption}», ` : ''}${ref.path}`)
          while (sentStickers.size > STICKERS_KEPT) sentStickers.delete(sentStickers.keys().next().value!)
          continue
        } catch (e) {
          log.warn('sticker refused, sending as a file', (e as Error).message)
          why = tr('Telegram turned it down', 'Telegram его не принял')
        }
      }
      await sendFile(chatId, topicId, file.data, file.name, file.mime, notStickerCaption(why), { original: true }).catch(e => log.warn('sticker file', (e as Error).message))
    }
  }

  // What is left to set up, as it really is: done steps are ticked, only the open ones say what to do
  // In the order that keeps the home address out of the Claude sign-in: a computer first, then the sign-in, which
  // the bot opens on that computer in a window going through the server. Recommended, not enforced
  async function setupSteps() {
    const claude = await profiles.status(profiles.defaultName)
    const online = gateway.devices()
    const steps = [
      online.length
        ? `- ✅ ${online.length > 1 ? tr('Computers online', 'Компьютеры в сети') : tr('Computer online', 'Компьютер в сети')}: ${online.map(d => d.name).join(', ')}`
        : tr('- **Connect a computer** with the button below: the bot gives you one line for it.', '- **Подключи компьютер** — кнопкой ниже: бот даст одну строку для него.'),
      claude.loggedIn
        ? `- ✅ ${tr('Claude: signed in', 'Claude: вход выполнен')}${claude.plan ? ` (${planLabel(claude.plan)})` : ''}`
        : tr("- **Sign in to Claude** with the button below: the sign-in window opens on the computer and goes through the server, so claude.ai doesn't see your address.", '- **Войди в Claude** — кнопкой ниже: окно входа откроется на компьютере и пойдёт через сервер, так claude.ai не увидит твой адрес.'),
    ]
    const ready = claude.loggedIn && online.length
    return [steps.join('\n'), ready
      ? tr('**All set.** Write a task here or create a topic: pick a project and get to work.', '**Всё готово.** Напиши задачу здесь или создай топик — выберешь проект и работаешь.')
      : tr("Once that's done, write the task as a regular message.", 'Как закончишь — пиши задачу обычным сообщением.')].join('\n\n')
  }

  // 401/409 stop grammY's polling for good (409 = another process polls this token): exit loudly instead of
  // pretending to work, the service manager restarts us. An update stops it on purpose and may start it again
  let botName = ''
  function poll(name = botName) {
    botName = name
    bot.start({
      allowed_updates: ['message', 'edited_message', 'message_reaction', 'callback_query', 'stopped_message_generation', 'my_chat_member', 'chat_member', 'widget_query'] as never,
      onStart: () => log.info(`bot @${botName} polling`),
    }).catch(e => {
      log.error('polling stopped', e.message)
      process.exit(1)
    })
  }

  // --- access: owner ids only, private chat only, each update once ------------------------------
  bot.use(async (ctx, next) => {
    if (seenUpdates.has(ctx.update.update_id)) return
    seenUpdates.add(ctx.update.update_id)
    if (seenUpdates.size > DEDUP_SIZE) seenUpdates.delete(seenUpdates.values().next().value!)

    if (ctx.update.my_chat_member) return companion.owns(ctx.update.my_chat_member.chat.id) ? companion.membership(ctx) : workspaceMenu.membership(ctx)
    // Who joins and leaves matters in one case only: the owner leaving a companion chat
    if (ctx.update.chat_member) return companion.member(ctx)
    const wq = (ctx.update as { widget_query?: WidgetQuery }).widget_query
    if (wq) return widgetQuery(wq)
    // A companion chat is a closed corridor: whatever happens in it goes to the companion and nowhere further, the
    // owner's messages and taps too. Nothing below this line ever sees such a chat
    if (ctx.chat && ctx.message?.migrate_from_chat_id && companion.owns(ctx.message.migrate_from_chat_id)) return companion.moved(ctx.message.migrate_from_chat_id, ctx.chat.id)
    if (ctx.chat && companion.owns(ctx.chat.id)) return companion.handle(ctx)
    // Telegram says it in both chats, and whichever comes first does the move
    if (ctx.chat && ctx.message?.migrate_to_chat_id) return moveChat(ctx.chat.id, ctx.message.migrate_to_chat_id)
    if (ctx.chat && ctx.message?.migrate_from_chat_id) return moveChat(ctx.message.migrate_from_chat_id, ctx.chat.id)
    if (ctx.chat?.is_forum && workspaces.get(ctx.chat.id)?.plain) workspaceMenu.topicsOn(ctx.chat.id)
    // An anonymous admin writes as the group itself, from a bot's account
    if (ctx.chat && isGroupChat(ctx.chat.id) && ctx.msg?.sender_chat?.id === ctx.chat.id && workspaces.get(ctx.chat.id)) {
      return workspaceMenu.anonymous(ctx.chat.id, topicOf(ctx.msg as Message | undefined))
    }
    // Service messages from the bot itself. “The icon changed”, “the topic was renamed”, “the photo changed”: noise each time, so they go
    if (ctx.from?.is_bot) {
      if (ctx.message?.forum_topic_edited || ctx.message?.new_chat_photo) await api.deleteMessage(ctx.message.chat.id, ctx.message.message_id).catch(e => log.debug('service message', (e as Error).message))
      return
    }
    // stopped_message_generation carries only a chat; in a private chat its id is the user id
    const id = ctx.from?.id ?? ctx.chat?.id
    // A fresh install has no owner yet: the installer's link t.me/<bot>?start=<code> claims it, once
    const text = ctx.message?.text ?? ''
    if (id && ctx.chat?.type === 'private' && text.startsWith('/start ') && owners.claim(id, text.slice(7).trim(), cfg.claimCode)) {
      log.info('owner claimed', { id, name: ctx.from?.username })
      setBotAvatar(api, log)
      if (guessLang(ctx.from?.language_code)) await syncCommands().catch(() => {})
      const signedIn = (await profiles.status(profiles.defaultName)).loggedIn
      const kb = new InlineKeyboard()
      if (!gateway.devices().some(d => !isCloud(d.id))) kb.text(tr('🔗 Connect a computer', '🔗 Подключить компьютер'), 'pairnew').row()
      if (!signedIn) kb.text(`${tr('🔑 Sign in to Claude', '🔑 Войти в Claude')}: ${profiles.defaultName}`, `lg:${profiles.defaultName}`)
      await sendRich(ctx.chat.id, undefined, [tr('### ✅ The bot is yours now', '### ✅ Бот теперь твой'), tr('It will answer only you.', 'Отвечать он будет только тебе.'), await setupSteps()].join('\n\n'), { reply_markup: kb })
      return
    }
    // A group counts once it is a workspace, and /workspace is how it becomes one
    // And the two buttons under the question the bot asks when it is added: what the group is to be
    const choosing = ctx.callbackQuery?.data === WORKSPACE_NEW || ctx.callbackQuery?.data === COMPANION_NEW
    const openChat = !ctx.chat || ctx.chat.type === 'private' || !!workspaces.get(ctx.chat.id) || /^\/workspace(@\w+)?(\s|$)/.test(text) || choosing
    if (!id || !owners.has(id) || !openChat) {
      if (ctx.from && ctx.chat?.type === 'private' && !ctx.callbackQuery && !ctx.messageReaction) await usersMenu.stranger(ctx.from).catch(e => log.warn('account offer', (e as Error).message))
      if (id) log.warn('rejected', { id, name: ctx.from?.username, hint: 'add the id to OWNER_IDS if this is you' })
      if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {})
      return
    }
    // Until the owner picks one with /language, the bot speaks the language of their Telegram
    if (guessLang(ctx.from?.language_code)) await syncCommands().catch(() => {})
    // Any message or tap inside a topic keeps it alive (TOPIC_TTL_DAYS)
    const thread = topicOf(ctx.msg as Message | undefined)
    if (thread && ctx.chat) {
      const key = topicKey(ctx.chat.id, thread)
      topics.touch(key)
      releaseReports(key)
    }
    if (ctx.chat && ctx.callbackQuery?.message) offers.tapped(topicKey(ctx.chat.id, thread), ctx.callbackQuery.message.message_id)
    // A word from the user: topics may write to each other again
    if (ctx.chat) topicWakes.delete(ctx.chat.id)
    // A command never reaches the text handler, so here it calls off a rename in waiting
    if (ctx.chat && /^\/\w/.test(text)) renames.delete(topicKey(ctx.chat.id, thread))
    // A topic of a workspace is what its settings say from the first word, /status included: General and older topics
    // get no "created" event to take them from
    if (ctx.chat && ctx.message && workspaces.get(ctx.chat.id)) inheritWorkspace(topicKey(ctx.chat.id, thread))
    // A group's writes can wait half a minute out on Telegram's limit: not at the expense of the private chat
    if (ctx.chat && isGroupChat(ctx.chat.id)) return background(next())
    await next()
  })

  bot.catch(err => log.error('bot error', err.error instanceof Error ? err.error.message : err.message))

  // Before the commands: a «/delete» someone else wrote is no command, a code in it no sign-in. /users takes a forward to
  // learn an account. While Claude waits for an answer it can be that answer, and then the source has to go with it
  bot.on('message:text', (ctx, next) => {
    if (!ctx.msg.forward_origin || usersMenu.waiting(ctx.chat.id)) return next()
    const topicId = topicOf(ctx.msg)
    const key = topicKey(ctx.chat.id, topicId)
    const context = lines(replyContext(ctx.msg, ownSticker(ctx.chat.id)), forwardContext(ctx.msg))
    const text = forwardedText(ctx.msg.text)
    if (liveOf(key).answer || surveys.get(key)) return enqueue(ctx.chat.id, topicId, `${context}\n\n${text}`)
    return enqueue(ctx.chat.id, topicId, text, { reply: false, context, msgId: ctx.msg.message_id })
  })

  // --- stop button on the draft -----------------------------------------------------------------
  function stopGeneration(key: string, draftId: number) {
    const l = live.get(key)
    if (!l || l.draftId !== draftId) return false
    if (l.abort) {
      l.abort.abort()
      return true
    }
    // Stop while files are still being prepared: drop them, nothing starts
    flights.end(key)
    l.queue.length = 0
    l.epoch++
    endPrep(l)
    return true
  }
  bot.on('stopped_message_generation', ctx => {
    const u = ctx.update.stopped_message_generation!
    stopGeneration(topicKey(u.chat.id, u.message_thread_id), u.draft_id)
  })
  // The same from a group's status message, which is an ordinary message with a button
  bot.callbackQuery(/^stg:(\d+)$/, ctx => {
    const stopped = stopGeneration(topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message as Message | undefined)), Number(ctx.match[1]))
    return ctx.answerCallbackQuery(stopped ? tr('Stopping…', 'Останавливаю…') : tr('No longer relevant', 'Уже неактуально'))
  })

  // These show accounts, pairing codes and the state of the server: not for a group, where others may read along
  bot.chatType(['group', 'supergroup']).callbackQuery(/^(pairnew$|lg:|ghc:|ghout$|ghcode$|mcl:|mcw:|dvs$|dv:|zo:|rn:|rv:|rvok:|usr:)/, ctx =>
    ctx.answerCallbackQuery({ text: tr('This one works only in the private chat with me.', 'Это работает только в личке со мной.'), show_alert: true }))
  bot.chatType(['group', 'supergroup']).command([...PRIVATE_ONLY], ctx =>
    ctx.reply(tr('This one works only in the private chat with me.', 'Эта команда работает только в личке со мной.'), where(topicOf(ctx.msg))))

  // --- commands ---------------------------------------------------------------------------------
  const help = (ctx: Context) => ctx.match === WORKSPACE_START ? undefined : sendRich(ctx.chat!.id, topicOf(ctx.msg), [
    tr('# Claude on your computers', '# Claude на твоих компьютерах'),
    tr('Every topic is a separate conversation with its own computer, project and session. Write a task as a regular message.', 'Каждый топик — отдельный диалог со своим компьютером, проектом и сессией. Пиши задачу обычным сообщением.'),
    tr('A message sent while Claude works waits with 👀. Put ⚡ on it to send it in now: Claude gets it after the current step, and 🫡 says it arrived. /now shows what runs and what waits for you.', 'Сообщение, отправленное пока Claude работает, ждёт с 👀. Поставь на него ⚡, чтобы передать сразу: Claude получит его после текущего шага, а 🫡 скажет, что дошло. /now показывает, что идёт и что ждёт тебя.'),
    tr('Reactions on an answer: 🔥 👍 ❤️ tell Claude what you liked (it hears it with your next message, at no extra cost); 👎 asks it to look again.', 'Реакции на ответ: 🔥 👍 ❤️ говорят Claude, что тебе понравилось (он узнает об этом с твоим следующим сообщением, без лишних токенов); 👎 просит его пересмотреть ответ.'),
    commands().filter(c => ctx.chat?.type === 'private' || !PRIVATE_ONLY.includes(c.command)).map(c => `- /${c.command} — ${c.description}`).join('\n'),
  ].join('\n\n'))
  bot.command(['start', 'help'], help)

  // One language for the whole bot; the menu of commands follows it
  bot.command('language', ctx => ctx.reply(tr('🌐 Bot language:', '🌐 Язык бота:'), {
    ...where(topicOf(ctx.msg)),
    reply_markup: new InlineKeyboard().text(`${lang() === 'en' ? '• ' : ''}🇬🇧 English`, 'lang:en').text(`${lang() === 'ru' ? '• ' : ''}🇷🇺 Русский`, 'lang:ru'),
  }))
  bot.callbackQuery(/^lang:(en|ru)$/, async ctx => {
    setLang(ctx.match[1] as Lang)
    await ctx.answerCallbackQuery()
    await ctx.editMessageText(tr('🌐 The bot speaks English now.', '🌐 Теперь бот говорит по-русски.')).catch(() => {})
    await syncCommands().catch(e => log.warn('setMyCommands', e.message))
  })

  // §5.2 /tools: what the bound device can do right now
  bot.command('tools', ctx => {
    const topicId = topicOf(ctx.msg)
    const t = topics.get(topicKey(ctx.chat.id, topicId))
    const dev = t.deviceId ? gateway.device(t.deviceId) : undefined
    if (!dev && t.deviceId) wantedAt.set(t.deviceId, Date.now())
    if (!dev) return ctx.reply(t.deviceId ? tr(`🔌 <b>${esc(deviceName(t.deviceId))}</b> is offline.`, `🔌 <b>${esc(deviceName(t.deviceId))}</b> не в сети.`) : tr('Choose a computer first: /project', 'Сначала выбери компьютер: /project'), { ...where(topicId), ...HTML })
    const STATUS = { connected: '🟢', starting: '🟡', failed: '🔴' } as const
    const apps = dev.mcp.map(s => {
      const detail = s.status === 'connected'
        ? tr(`${s.tools.length} tools, read-only: ${s.tools.filter(x => x.annotations?.readOnlyHint).length}`, `${s.tools.length} инстр., только чтение: ${s.tools.filter(x => x.annotations?.readOnlyHint).length}`)
        : s.status === 'starting' ? tr('starting', 'запускается') : s.error ?? tr('unavailable', 'недоступен')
      return `- ${STATUS[s.status]} **${s.name}**${s.version ? ` v${s.version}` : ''} — ${detail}`
    })
    // Remote servers live on the server: the same in every topic, whatever the computer
    const remote = Object.keys(cfg.remoteMcp).map(name => {
      const s = remoteStatus.get(profiles.nameOf(t.profile))?.find(r => r.name === name)?.status
      const state = s === 'connected' ? '🟢' : s === 'needs-auth' ? '🔴' : s ? '🟡' : '⚪'
      const detail = s === 'connected' ? tr('on the server, for every computer', 'на сервере, для всех компьютеров')
        : s === 'needs-auth' ? tr('not signed in: the button below', 'не выполнен вход: кнопка ниже')
          : s ? s : tr('checked on the first task', 'проверится в первой задаче')
      return `- ${state} **${name}** — ${detail}`
    })
    const signIn = Object.keys(cfg.remoteMcp).filter(name => remoteStatus.get(profiles.nameOf(t.profile))?.find(r => r.name === name)?.status === 'needs-auth')
    const signInKb = new InlineKeyboard()
    for (const name of signIn) signInKb.text(tr(`🔑 Sign in to ${name}`, `🔑 Войти в ${name}`), `mcl:${name}`).row()
    return sendRich(ctx.chat.id, topicId, [
      `${osIcon(dev)} **${dev.name}**`,
      tr('- 🟢 **device** — files and commands in the project', '- 🟢 **device** — файлы и команды в проекте'),
      ...apps,
      apps.length ? '' : tr('_No apps connected: add mcpServers to agent.config.json._', '_Приложения не подключены: добавь mcpServers в agent.config.json._'),
      ...remote,
    ].filter(Boolean).join('\n'), signIn.length ? { reply_markup: signInKb } : {})
  })

  // /status in the private chat: the same facts as a card. Its icons say what the emoji in the text labels do
  const plainLabel = (s: string) => s.replace(/^\S+\s+/, '')
  async function sendStatusWidget(chatId: number, topicId: number | undefined, key: string) {
    const t = topics.get(key)
    const l = liveOf(key)
    const dev = t.deviceId ? gateway.device(t.deviceId) : undefined
    const project = dev?.projects.find(p => p.id === t.projectId)
    const state: StatusWidget['state'] = l.busy ? { label: l.since ? tr(`Working ${span(Date.now() - l.since)}`, `Работает ${span(Date.now() - l.since)}`) : tr('Working', 'Работает'), tone: 'busy' }
      : l.waitingDevice ? { label: tr('Waiting for the computer', 'Ждёт компьютер'), tone: 'wait' }
        : slotWaiters.includes(key) ? { label: tr('In the queue', 'В очереди'), tone: 'wait' }
          : { label: tr('Idle', 'Свободен'), tone: 'ok' }
    const computer: StatusWidget['tiles'][number] = t.noProject ? { icon: 'pc', label: tr('Computer', 'Компьютер'), value: tr('none', 'нет'), sub: tr('a conversation', 'просто разговор') }
      : t.deviceId ? { icon: isCloud(t.deviceId) ? 'cloud' : dev?.os === 'macos' ? 'mac' : 'pc', label: tr('Computer', 'Компьютер'), value: dev?.name ?? deviceName(t.deviceId), sub: dev ? tr('online', 'в сети') : tr('offline', 'не в сети'), dot: dev ? 'ok' : 'off' }
        : { icon: 'pc', label: tr('Computer', 'Компьютер'), value: tr('not chosen', 'не выбран') }
    const effort = t.effort ?? cfg.effort
    const html = statusWidgetHtml({
      state,
      tiles: [
        computer,
        { icon: 'folder', label: tr('Project', 'Проект'), value: project?.name ?? t.projectId ?? tr('not chosen', 'не выбран'), sub: t.sessionId ? tr(`session ${t.sessionId.slice(0, 8)}`, `сессия ${t.sessionId.slice(0, 8)}`) : tr('new session', 'новая сессия'), ...(project && { more: project.path }) },
        { icon: 'brain', label: tr('Model', 'Модель'), value: modelLabel(modelOf(t)), sub: tr(`effort ${effort}`, `усилие ${effort}`), more: t.verbose ? tr('detailed answers', 'ответы подробные') : tr('concise answers', 'ответы краткие') },
        { icon: 'shield', label: tr('Permissions', 'Разрешения'), value: plainLabel(MODES[modeOf(key)]), ...(t.head && !t.mode && { sub: tr('same as the head', 'как у хеда') }) },
      ],
      foot: [[tr('Profile', 'Профиль'), profiles.nameOf(t.profile)], [tr('Quiet mode', 'Тихий режим'), quietLabel(quiet.on(chatId))]],
    })
    if (widgetProblem(html)) return false
    try {
      await (api.raw as unknown as { sendWidget: (o: object) => Promise<unknown> }).sendWidget({ chat_id: chatId, ...where(topicId), html, width: 320, height: 320 })
      return true
    } catch (e) {
      log.warn('status widget', (e as Error).message)
      return false
    }
  }

  bot.command('status', async ctx => {
    const topicId = topicOf(ctx.msg)
    const key = topicKey(ctx.chat.id, topicId)
    const t = topics.get(key)
    const l = liveOf(key)
    const dev = t.deviceId ? gateway.device(t.deviceId) : undefined
    const project = dev?.projects.find(p => p.id === t.projectId)
    // What the card leaves out (work put off, a message handed in) keeps the text
    if (ctx.chat.id > 0 && !t.deferred?.length && !handInNote(l) && await sendStatusWidget(ctx.chat.id, topicId, key)) return
    return sendRich(ctx.chat.id, topicId, plainTable([
      `| ${tr('Computer', 'Компьютер')} | ${t.noProject ? tr('💬 no project', '💬 без проекта') : t.deviceId ? `${dev ? osIcon(dev) + ' ' + dev.name : deviceName(t.deviceId)} · ${dev ? tr('online', 'в сети') : tr('offline', 'не в сети')}` : tr('not chosen', 'не выбрано')} |`,
      `| ${tr('Project', 'Проект')} | ${project?.name ?? t.projectId ?? tr('not chosen', 'не выбран')} |`,
      `| ${tr('Session', 'Сессия')} | ${t.sessionId ? '`' + t.sessionId.slice(0, 8) + '`' : tr('new', 'новая')} |`,
      `| ${tr('Permissions', 'Разрешения')} | ${MODES[modeOf(key)]}${t.head && !t.mode ? tr(' · same as the head', ' · как у хеда') : ''} |`,
      `| ${tr('Quiet mode', 'Тихий режим')} | ${quietLabel(quiet.on(ctx.chat.id))} |`,
      `| ${tr('Profile', 'Профиль')} | ${profiles.nameOf(t.profile)} |`,
      `| ${tr('Model', 'Модель')} | ${modelSummary(t)} |`,
      ...(t.deferred?.length ? [`| ${tr('Put off', 'Отложено')} | ${t.deferred.length} |`] : []),
      `| ${tr('Now', 'Сейчас')} | ${l.busy ? tr('working', 'работает') : l.waitingDevice ? tr('waiting for the computer', 'ждёт компьютер') : slotWaiters.includes(key) ? tr('waiting in the server queue', 'ждёт очереди на сервере') : tr('idle', 'свободен')}${l.queue.length ? tr(`, ${l.queue.length} queued`, `, в очереди ${l.queue.length}`) : ''} |`,
      ...(handInNote(l) ? [`| ⚡ | ${handInNote(l)} |`] : []),
    ]))
  })

  // --- model, effort and answer length per topic ---------------------------------------------------
  const modelLabel = (value?: string) => models.label(value) ?? tr('default', 'по умолчанию')
  // The topic's own pick, else by what the topic is: Opus for project work, Sonnet for a conversation
  const modelOf = (t: Topic) => t.model ?? (t.noProject ? cfg.chatModel : cfg.model)
  // An agent without a mode of its own follows its head's, also when the head's changes later
  const modeOf = (key: string): Mode => {
    const t = topics.get(key)
    return t.mode ?? (t.head ? topics.get(t.head).mode : undefined) ?? 'ask'
  }
  // The mode a turn works under. A message from another topic can't get more done than its sender could
  const turnMode = (key: string): Mode => {
    const cap = live.get(key)?.modeCap
    return cap ? stricterMode(modeOf(key), cap) : modeOf(key)
  }
  // When the limit comes from the topic that wrote here, /mode in this one changes nothing: it has to say so
  const readOnlyMessage = (key: string) => (modeOf(key) === 'read'
    ? 'The topic is in "Read only" mode: changes are not allowed. The user can switch the mode with /mode.'
    : 'This turn answers a message from another topic that is in "Read only" mode, so nothing may be changed in it. This topic\'s own mode is not the cause: /mode here would not help. To go ahead, the user asks here directly, or switches the mode in that topic.')
  function modelSummary(t: Topic) {
    const effort = t.effort ?? cfg.effort
    return `${modelLabel(modelOf(t))} · ${effort}${t.effort ? '' : tr(' (default)', ' (по умолчанию)')} · ${t.verbose ? tr('detailed', 'подробно') : tr('concise', 'кратко')}`
  }
  // «Where the topic works» in rich text: the place as a heading, then the path, the session and the model, one line each
  function boundMarkdown(dev: Device | undefined, project: { name: string, path: string }, t: Topic, deviceId: string, extra?: string) {
    return [
      `### ${dev ? `${osIcon(dev)} ${mdText(dev.name)} · ` : ''}📁 ${mdText(project.name)}`,
      [
        `- \`${project.path}\``,
        `- ${t.sessionId ? tr('The session continues', 'Сессия продолжается') : tr('New session', 'Новая сессия')}`,
        `- ${tr(`🧠 **${mdText(modelLabel(modelOf(t)))}** · ${t.effort ?? cfg.effort} — change: /model`, `🧠 **${mdText(modelLabel(modelOf(t)))}** · ${t.effort ?? cfg.effort} — сменить: /model`)}`,
      ].join('\n'),
      extra,
      isCloud(deviceId) ? `<footer>${tr("☁️ The cloud is a temporary place: once a computer is on, I'll offer to move the project there.", '☁️ Облако — временное место: когда включится компьютер, я предложу перенести проект туда.')}</footer>` : '',
    ].filter(Boolean).join('\n\n')
  }
  // One line under «where the topic works»: which model answers and how to change it
  const modelLine = (t: Topic) => tr(`🧠 Model: <b>${esc(modelLabel(modelOf(t)))}</b> · ${t.effort ?? cfg.effort} — change: /model`, `🧠 Модель: <b>${esc(modelLabel(modelOf(t)))}</b> · ${t.effort ?? cfg.effort} — сменить: /model`)

  // One message, three rows: tapping a button changes the topic and redraws the message in place
  function modelMenu(t: Topic) {
    const model = modelOf(t)
    const picked = models.choice(model)?.value
    // Only the levels this model takes
    const efforts = models.efforts(model)
    const effort = t.effort ?? cfg.effort
    const kb = new InlineKeyboard()
    models.list().forEach(m => kb.text(`${m.value === picked ? '• ' : ''}${m.label}`, `mdl:${m.value}`))
    kb.row()
    efforts.forEach(e => kb.text(`${e === effort ? '• ' : ''}${e}`, `eff:${e}`))
    kb.row()
      .text(`${t.verbose ? '' : '• '}${tr('🗜 Concise', '🗜 Кратко')}`, 'vrb:0')
      .text(`${t.verbose ? '• ' : ''}${tr('📖 Detailed', '📖 Подробно')}`, 'vrb:1')
    const rows: RichButton[][] = [
      models.list().map(m => ({ text: `${m.value === picked ? '• ' : ''}${m.label}`, data: `mdl:${m.value}` })),
      efforts.map(e => ({ text: `${e === effort ? '• ' : ''}${e}`, data: `eff:${e}` })),
      [{ text: `${t.verbose ? '' : '• '}${tr('🗜 Concise', '🗜 Кратко')}`, data: 'vrb:0' }, { text: `${t.verbose ? '• ' : ''}${tr('📖 Detailed', '📖 Подробно')}`, data: 'vrb:1' }],
    ]
    const md = [
      `### 🧠 ${mdText(modelSummary(t))}`,
      `<footer>${tr('Effort: how much the model thinks before answering. Low is cheaper and faster, xhigh and max deeper and pricier.  \nConcise: no preambles, recaps or long summaries.', 'Усилие — сколько модель думает перед ответом: low дешевле и быстрее, xhigh и max глубже и дороже.  \nКратко — без вступлений, пересказов и итоговых простыней.')}</footer>`,
    ].join('\n\n')
    const text = [
      tr(`🧠 Model in this topic: <b>${esc(modelSummary(t))}</b>`, `🧠 Модель в этом топике: <b>${esc(modelSummary(t))}</b>`),
      tr('<b>Effort</b> is how much the model thinks before answering: low is cheaper and faster, xhigh and max deeper and pricier.', '<b>Усилие</b> — сколько модель думает перед ответом: low дешевле и быстрее, xhigh и max глубже и дороже.'),
      tr('<b>Concise</b>: no preambles, recaps or long summaries.', '<b>Кратко</b> — без вступлений, пересказов и итоговых простыней.'),
    ].join('\n')
    return { text, kb, md, rows }
  }

  bot.command('model', async ctx => {
    const topicId = topicOf(ctx.msg)
    // A list hours old is asked again, a few seconds at most: the menu then has a model that came out since
    if (models.stale()) await Promise.race([models.refresh(), pause(5000)])
    const { md, rows } = modelMenu(topics.get(topicKey(ctx.chat.id, topicId)))
    return sendChoice(ctx.chat.id, topicId, md, rows, goKeyboard(rows))
  })

  bot.callbackQuery(/^(mdl|eff|vrb):([\w.[\]-]+)$/, async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    const [, kind, value] = ctx.match
    if (kind === 'mdl' && models.list().some(m => m.value === value)) topics.set(key, { model: value })
    else if (kind === 'eff' && (EFFORTS as readonly string[]).includes(value)) topics.set(key, { effort: value as Effort })
    else if (kind === 'vrb') topics.set(key, { verbose: value === '1' })
    else return ctx.answerCallbackQuery()
    const t = topics.get(key)
    log.info('model', { key, model: t.model, effort: t.effort, verbose: t.verbose })
    await ctx.answerCallbackQuery(modelSummary(t))
    const { text, kb, md, rows } = modelMenu(t)
    // The next turn picks it up; a running one keeps the settings it started with. A card that went out plain stays plain
    const id = ctx.callbackQuery.message?.message_id
    if (!id || !(await editRich(ctx.chat!.id, id, `${md}\n\n${richButtons(rows)}`))) await ctx.editMessageText(text, { ...HTML, reply_markup: kb }).catch(() => {})
  })

  // §13: the topic's standing permission rule, changed only here or by the prompt's 🔓 button
  const MODE_HELP: Record<Mode, string> = {
    get ask() { return tr('I ask before every write, command and app action', 'спрашиваю на каждую запись, команду и действие в приложении') },
    get edits() { return tr('I change project files myself; commands and apps only after asking', 'файлы проекта меняю сам, команды и приложения — с вопросом') },
    get all() { return tr('I do everything without asking: commands, files, apps, access to neighbouring folders of the working folder. /stop works', 'делаю всё без вопросов: команды, файлы, приложения, доступ к соседним папкам рабочей зоны. /stop работает') },
    get read() { return tr('I only read: no changes, commands or writes in apps', 'только читаю: никаких изменений, команд и записи в приложения') },
  }
  bot.command('mode', ctx => {
    const topicId = topicOf(ctx.msg)
    const key = topicKey(ctx.chat.id, topicId)
    const cur = modeOf(key)
    const inherited = !!topics.get(key).head && !topics.get(key).mode
    const kb = new InlineKeyboard()
    for (const m of Object.keys(MODES) as Mode[]) kb.text((m === cur && !inherited ? '• ' : '') + MODES[m], `m:${m}`).row()
    if (topics.get(key).head) kb.text(`${inherited ? '• ' : ''}${tr('↩️ Same as the head', '↩️ Как у хеда')}`, 'm:head')
    return sendRich(ctx.chat.id, topicId, [
      tr(`**Permissions in this topic:** ${MODES[cur]}${inherited ? ' — same as the head' : ''}`, `**Разрешения в этом топике:** ${MODES[cur]}${inherited ? ' — как у хеда' : ''}`),
      (Object.keys(MODES) as Mode[]).map(m => `- ${MODES[m]} — ${MODE_HELP[m]}`).join('\n'),
    ].join('\n\n'), { reply_markup: kb })
  })

  bot.callbackQuery(/^m:(\w+)$/, async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    if (ctx.match[1] === 'head' && topics.get(key).head) {
      topics.set(key, { mode: undefined })
      await ctx.answerCallbackQuery(tr('Same as the head', 'Как у хеда'))
      return ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(tr(`Mode: same as the head (${MODES[modeOf(key)]})`, `Режим: как у хеда (${MODES[modeOf(key)]})`), 'noop') })
    }
    const mode = ctx.match[1] as Mode
    if (!MODES[mode]) return ctx.answerCallbackQuery()
    topics.set(key, { mode })
    log.info('mode', { key, mode })
    await ctx.answerCallbackQuery(MODES[mode])
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(`${tr('Mode', 'Режим')}: ${MODES[mode]}`, 'noop') })
  })

  // --- Claude in Chrome (§10.6): on per topic, one browser per computer -----------------------------
  const deviceOs = (id: string) => gateway.device(id)?.os ?? registry.list().find(r => r.id === id)?.os
  const deviceName = (id: string) => gateway.device(id)?.name ?? registry.list().find(r => r.id === id)?.name ?? id
  const browserLabel = (b: Browser) => `«${b.name}»${b.osPlatform ? ` · ${b.osPlatform}` : ''}`
  const browserBold = (b: Browser) => `<b>${esc(browserLabel(b))}</b>`

  // The browsers on the account right now, as buttons: the user says which one is this computer's
  async function chooseBrowser(chatId: number, topicId: number | undefined, deviceId: string, profile: string | undefined, edit?: Context) {
    const text = tr('🌐 Looking for browsers with the Claude extension…', '🌐 Ищу браузеры с расширением Claude…')
    const msg = edit ? (await edit.editMessageText(text).catch(() => null), null) : await api.sendMessage(chatId, text, where(topicId))
    const show = (t: string, kb?: InlineKeyboard) => edit
      ? edit.editMessageText(t, { ...HTML, reply_markup: kb }).catch(() => {})
      : api.editMessageText(chatId, (msg as Message).message_id, t, { ...HTML, reply_markup: kb }).catch(() => {})
    let found: Browser[] = []
    try {
      found = await listBrowsers({ cwd: workDir, env: profiles.env(profile) })
    } catch (e) {
      log.warn('browser list failed', (e as Error).message)
    }
    if (!found.length) {
      const again = new InlineKeyboard().text(tr('🔄 Check again', '🔄 Проверить снова'), 'brr')
      return show([
        tr('<b>No browser is connected to the Claude account.</b>', '<b>Ни один браузер не подключён к аккаунту Claude.</b>'),
        tr(`On <b>${esc(deviceName(deviceId))}</b>:\n1. Install the Claude extension in Chrome: chromewebstore.google.com → “Claude”\n2. Sign in to the same claude.ai account and organization as the server\n3. Send /browser again`, `На компьютере <b>${esc(deviceName(deviceId))}</b>:\n1. Поставь расширение Claude в Chrome: chromewebstore.google.com → «Claude»\n2. Войди в тот же аккаунт и ту же организацию claude.ai, что у сервера\n3. Отправь /browser ещё раз`),
      ].join('\n\n'), again)
    }
    const kb = new InlineKeyboard()
    for (const b of found) {
      listed.set(b.deviceId, b)
      kb.text(`${browserLabel(b)}${b.connectedAt ? ` · ${tr('since', 'с')} ${new Date(b.connectedAt).toLocaleTimeString(tr('en-GB', 'ru-RU'), { hour: '2-digit', minute: '2-digit' })}` : ''}`, `bb:${b.deviceId}`).row()
    }
    return show(tr(`<b>Which of these browsers is Chrome on ${esc(deviceName(deviceId))}?</b> Other computers won't get it.`, `<b>Какой из этих браузеров — Chrome на компьютере ${esc(deviceName(deviceId))}?</b> Другие компьютеры его не получат.`), kb)
  }

  bot.command('browser', async ctx => {
    const topicId = topicOf(ctx.msg)
    const key = topicKey(ctx.chat.id, topicId)
    const t = topics.get(key)
    if (!t.deviceId) return ctx.reply(tr('Choose a computer and project first: /project', 'Сначала выбери компьютер и проект: /project'), where(topicId))
    const bound = browsers.get(t.deviceId)
    const account = chromeAccount(t.deviceId)
    // Signed in to another account than this topic's. Another computer's Chrome may be on this topic's account: the
    // session works in that one itself. Otherwise Claude reaches this computer's through an errand on its account
    const direct = bound && account && account !== profiles.nameOf(t.profile) ? chromeOnAccount(t.deviceId, profiles.nameOf(t.profile)) : undefined
    if (direct) {
      const there = `${browserBold(browsers.get(direct.id)!)} ${tr('on', 'на')} ${esc(direct.name)}`
      const why = tr(`Chrome on ${esc(deviceName(t.deviceId))} is signed in to <b>${esc(account!)}</b>, this topic runs on <b>${esc(profiles.nameOf(t.profile))}</b>, and so does that Chrome.`, `Chrome на ${esc(deviceName(t.deviceId))} вошёл в <b>${esc(account!)}</b>, этот топик на <b>${esc(profiles.nameOf(t.profile))}</b>, как и тот Chrome.`)
      if (t.browser) return ctx.reply(tr(`🌐 Browser on: ${there}. ${why}`, `🌐 Браузер включён: ${there}. ${why}`), { ...where(topicId), ...HTML, reply_markup: new InlineKeyboard().text(tr('Turn off in this topic', 'Выключить в топике'), 'brx') })
      topics.set(key, { browser: true, browserAuto: false })
      return ctx.reply(tr(`🌐 Browser on: ${there}. ${why} Each request to Claude costs about 3k more tokens; turn it off with /browser.`, `🌐 Браузер включён: ${there}. ${why} Каждый запрос к Claude дороже примерно на 3 тыс. токенов, выключить — /browser.`), { ...where(topicId), ...HTML })
    }
    if (bound && account && account !== profiles.nameOf(t.profile)) {
      return ctx.reply(tr(`🌐 ${browserBold(bound)} on ${esc(deviceName(t.deviceId))} is signed in to the profile <b>${esc(account)}</b>, and this topic runs on <b>${esc(profiles.nameOf(t.profile))}</b>. Nothing to turn on: asked for Chrome, Claude hands the task to a short session on ${esc(account)}, which works in it.`, `🌐 ${browserBold(bound)} на ${esc(deviceName(t.deviceId))} вошёл в профиль <b>${esc(account)}</b>, а этот топик на <b>${esc(profiles.nameOf(t.profile))}</b>. Включать ничего не нужно: попросишь Chrome — Claude поручит задачу короткой сессии на ${esc(account)}, и она сделает её в этом браузере.`), { ...where(topicId), ...HTML })
    }
    if (t.browser && bound) {
      const kb = new InlineKeyboard().text(tr('Turn off in this topic', 'Выключить в топике'), 'brx').row().text(tr('Another browser', 'Другой браузер'), 'brr')
      return ctx.reply(tr(`🌐 Browser on: ${browserBold(bound)} on ${esc(deviceName(t.deviceId))}.`, `🌐 Браузер включён: ${browserBold(bound)} на ${esc(deviceName(t.deviceId))}.`), { ...where(topicId), ...HTML, reply_markup: kb })
    }
    if (bound) {
      topics.set(key, { browser: true, browserAuto: false })
      return ctx.reply(tr(`🌐 Browser on: ${browserBold(bound)} on ${esc(deviceName(t.deviceId))}. Each request to Claude costs about 3k more tokens; turn it off with /browser.`, `🌐 Браузер включён: ${browserBold(bound)} на ${esc(deviceName(t.deviceId))}. Каждый запрос к Claude дороже примерно на 3 тыс. токенов, выключить — /browser.`), { ...where(topicId), ...HTML })
    }
    return chooseBrowser(ctx.chat.id, topicId, t.deviceId, t.profile)
  })

  bot.callbackQuery(/^bb:([\w-]+)$/, async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    const t = topics.get(key)
    const b = listed.get(ctx.match[1])
    if (!b || !t.deviceId) return ctx.answerCallbackQuery(tr('The list is out of date: /browser', 'Список устарел: /browser'))
    const os = deviceOs(t.deviceId)
    // A Mac browser can't be a Windows computer's: refuse before it acts on the wrong machine
    if (os && !sameOs(b.osPlatform, os)) return ctx.answerCallbackQuery({ text: tr(`This browser is on ${b.osPlatform}, but the topic's computer is ${os}`, `Этот браузер на ${b.osPlatform}, а компьютер топика — ${os}`), show_alert: true })
    // Listed by this topic's profile: the extension is signed in to its account
    browsers.bind(t.deviceId, { ...b, profile: profiles.nameOf(t.profile) })
    topics.set(key, { browser: true, browserAuto: false })
    log.info('browser bound', { device: t.deviceId, browser: b.deviceId, name: b.name, os: b.osPlatform, profile: profiles.nameOf(t.profile) })
    await ctx.answerCallbackQuery(tr('Linked', 'Привязан'))
    browserGranted(key, ctx.callbackQuery.message?.message_id)
    await ctx.editMessageText(tr(`🌐 ${browserBold(b)} is linked to ${esc(deviceName(t.deviceId))} and on in this topic. Each request to Claude costs about 3k more tokens; turn it off with /browser.`, `🌐 ${browserBold(b)} привязан к ${esc(deviceName(t.deviceId))} и включён в этом топике. Каждый запрос к Claude дороже примерно на 3 тыс. токенов, выключить — /browser.`), HTML)
  })
  // Claude asked for the browser: the same as /browser, from a button, and the task carries on by itself
  // --- the screen: asked for like Chrome, shown as it goes ---------------------------------------------
  const SCREEN_IDLE_MS = 20 * 60_000
  // How long a batch waits for the user to step away from the computer, and how often it asks whether they have
  const SCREEN_WAIT_MS = 4 * 60_000
  const SCREEN_POLL_MS = 5000
  const screenAsks = new Map<number, { key: string, choice: Choice | null }>()
  async function askForScreen(key: string, p: { reason: string }) {
    const { chatId, topicId } = parseKey(key)
    const t = topics.get(key)
    const id = permSeq++
    const yes = tr('✅ Allow', '✅ Разрешить')
    const no = tr('No', 'Нет')
    const md = [
      tr(`**🖥 Claude asks for the screen of ${deviceName(t.deviceId!)}**`, `**🖥 Claude просит управлять экраном ${deviceName(t.deviceId!)}**`),
      defuseButtons(p.reason),
      tr('For this task it will see the windows it works in and press their buttons without touching your mouse, so you can keep working. The mouse and keyboard it takes only while you are away, and gives back the moment you touch them. A live view with a stop button comes here.', 'На эту задачу он будет видеть окна, в которых работает, и нажимать в них кнопки, не трогая твою мышь, — можно работать параллельно. Мышь и клавиатуру возьмёт, только пока ты отошёл, и отдаст, как только коснёшься. Сюда придёт живой просмотр с кнопкой «Стоп».'),
    ].join('\n\n')
    const choice = await keepLoud(() => sendChoice(chatId, topicId, md, [[{ text: yes, data: `scr:yes:${id}`, style: 'success' }, { text: no, data: `scr:no:${id}` }]], new InlineKeyboard().text(yes, `scr:yes:${id}`).text(no, `scr:no:${id}`)))
    screenAsks.set(id, { key, choice })
    offers.open(key, 'browser', choice?.messageId)
    log.info('screen asked', { key })
    return 'The question with its buttons is already in the chat, just above your final reply. End your turn now with one short line (do not call them "below"); the next message tells you what the user chose.'
  }
  bot.callbackQuery(/^scr:(yes|no):(\d+)$/, async ctx => {
    const ask = screenAsks.get(Number(ctx.match[2]))
    if (!ask || !owners.has(ctx.from.id)) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    screenAsks.delete(Number(ctx.match[2]))
    const { chatId, topicId } = parseKey(ask.key)
    const shownId = ask.choice?.messageId ?? ctx.callbackQuery.message?.message_id
    const settle = (note: string) => (ask.choice ? editRich(chatId, ask.choice.messageId, `${ask.choice.md}\n\n> ${note}`) : Promise.resolve(false))
    if (ctx.match[1] === 'no') {
      await ctx.answerCallbackQuery(tr('Not allowed', 'Не разрешено'))
      await settle(tr('**No screen**', '**Без экрана**'))
      return enqueue(chatId, topicId, '[The user did not let you use the screen. Go on without it, or say briefly what you can\'t do without it.]', { reply: false, shownId })
    }
    await ctx.answerCallbackQuery(tr('Allowed', 'Разрешено'))
    await settle(tr('✅ **The screen is Claude\'s for this task**', '✅ **Экран у Claude на эту задачу**'))
    topics.set(ask.key, { screen: true, screenUsedAt: Date.now() })
    log.info('screen given', { key: ask.key })
    enqueue(chatId, topicId, '[The user let you see and drive the screen: the screen tool is yours from this turn. Go on with the task.]', { reply: false, shownId })
  })

  // What Claude sees, in one message that follows it, with a stop button. Edited at most every 2 s: Telegram's limits
  const screenViews = new Map<string, { messageId?: number, at: number, busy?: boolean }>()
  const screenStop = () => new InlineKeyboard().text(tr('⏹ Stop', '⏹ Стоп'), 'scs:stop')
  async function showScreen(key: string, jpeg: string, what: string) {
    const { chatId, topicId } = parseKey(key)
    const v = screenViews.get(key) ?? { at: 0 }
    screenViews.set(key, v)
    if (v.busy || Date.now() - v.at < 2000) return
    v.busy = true
    v.at = Date.now()
    const caption = `🖥 ${what}`.slice(0, 900)
    const photo = new InputFile(Buffer.from(jpeg, 'base64'), 'screen.jpg')
    try {
      if (v.messageId) await api.editMessageMedia(chatId, v.messageId, { type: 'photo', media: photo, caption }, { reply_markup: screenStop() })
      else v.messageId = (await api.sendPhoto(chatId, photo, { ...where(topicId), caption, disable_notification: true, reply_markup: screenStop() })).message_id
    } catch (e) {
      log.debug('screen view', (e as Error).message)
    } finally {
      v.busy = false
    }
  }
  async function endScreenView(key: string) {
    const v = screenViews.get(key)
    screenViews.delete(key)
    screenNow.delete(key)
    await endScreenWait(key)
    if (v?.messageId) await api.editMessageReplyMarkup(parseKey(key).chatId, v.messageId, { reply_markup: new InlineKeyboard() }).catch(() => {})
  }

  // The mouse and the keyboard wait for the user to step away from the computer; one card says so while they do, and
  // a tap on it lets Claude have them at once, for the rest of the task
  const screenNow = new Set<string>()
  const screenWaits = new Map<string, { messageId?: number, wake?: () => void }>()
  function screenWait(key: string, device: string, ms: number) {
    let w = screenWaits.get(key)
    if (!w) {
      w = {}
      screenWaits.set(key, w)
      const { chatId, topicId } = parseKey(key)
      const card = w
      const md = tr(
        `**⏳ Claude waits for you to step away from ${device}**\n\nIt needs the mouse and the keyboard for a moment: it takes them after a minute without your input, and stops the moment you touch them.`,
        `**⏳ Claude ждёт, пока ты отойдёшь от ${device}**\n\nЕму ненадолго нужны мышь и клавиатура: возьмёт их через минуту без твоего ввода и остановится, как только ты их коснёшься.`,
      )
      const now = tr('▶️ Work now', '▶️ Работай сейчас'), stop = tr('⏹ Stop', '⏹ Стоп')
      void sendChoice(chatId, topicId, md, [[{ text: now, data: 'scs:now', style: 'success' }, { text: stop, data: 'scs:stop' }]], new InlineKeyboard().text(now, 'scs:now').text(stop, 'scs:stop'))
        .then(c => {
          if (!c) return
          if (screenWaits.get(key) === card) card.messageId = c.messageId
          else void api.deleteMessage(chatId, c.messageId).catch(() => {})
        }, e => log.debug('screen wait', (e as Error).message))
    }
    return new Promise<void>(res => {
      const timer = setTimeout(res, ms)
      w.wake = () => {
        clearTimeout(timer)
        res()
      }
    })
  }
  async function endScreenWait(key: string) {
    const w = screenWaits.get(key)
    screenWaits.delete(key)
    w?.wake?.()
    if (w?.messageId) await api.deleteMessage(parseKey(key).chatId, w.messageId).catch(() => {})
  }
  bot.callbackQuery('scs:now', async ctx => {
    if (!owners.has(ctx.from.id)) return ctx.answerCallbackQuery()
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    screenNow.add(key)
    log.info('screen: work now', { key })
    await ctx.answerCallbackQuery(tr('Claude takes the mouse now: hands off it', 'Claude берёт мышь: не трогай её'))
    await endScreenWait(key)
  })
  // Stops the task at once and takes the screen back: the next one asks again
  bot.callbackQuery('scs:stop', async ctx => {
    if (!owners.has(ctx.from.id)) return ctx.answerCallbackQuery()
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    topics.set(key, { screen: false })
    liveOf(key).abort?.abort()
    log.info('screen stopped by the user', { key })
    await ctx.answerCallbackQuery(tr('Stopped: the screen is yours', 'Остановлено: экран снова твой'))
    await endScreenView(key)
  })

  const browserAsks = new Map<number, { key: string, choice: Choice | null }>()
  // Topics that said yes and are still picking which browser is theirs
  const browserPending = new Set<string>()

  async function openChrome(deviceId: string) {
    const out = await gateway.request(deviceId, { projectId: '', bindingVersion: 0, tool: 'open_chrome', params: {} })
    if (!out.ok) return `Could not start Chrome: ${out.error.message}`
    log.info('chrome opened', { device: deviceId, started: (out.result as { started: boolean }).started })
    // The extension needs a moment to connect after the window appears, or after Chrome restarted for the proxy
    await new Promise(r => setTimeout(r, cfg.chromeConnectMs ?? CHROME_CONNECT_MS))
    const now = (out.result as { started: boolean }).started ? 'Chrome has started.' : 'Chrome was already running.'
    return `${now} Check the connected browsers again. If this computer's is still not there after a retry, the Claude extension is off or signed out in that Chrome: tell the user.`
  }

  // shownId: the card the user tapped. A busy topic marks it 👀, as it does a message of theirs, rather than saying
  // «queued» with nothing to show what
  function browserGranted(key: string, shownId?: number) {
    if (!browserPending.delete(key)) return
    topics.set(key, { browserAuto: true, browserUsedAt: Date.now() })
    const { chatId, topicId } = parseKey(key)
    enqueue(chatId, topicId, '[The user gave you access to their Chrome: it is on in this topic now. Go on with the task.]', { reply: false, shownId })
  }

  async function askForBrowser(key: string, p: { reason: string }) {
    const { chatId, topicId } = parseKey(key)
    const t = topics.get(key)
    const id = permSeq++
    const yes = tr('✅ Give access', '✅ Дать доступ')
    const no = tr('No', 'Нет')
    const md = [
      tr(`**🌐 Claude asks for your Chrome on ${deviceName(t.deviceId!)}**`, `**🌐 Claude просит доступ к твоему Chrome на ${deviceName(t.deviceId!)}**`),
      defuseButtons(p.reason),
      tr('It can read pages, and click and type as `/mode` allows, with your signed-in sites.', 'Он сможет читать страницы, а кликать и вводить — как разрешает `/mode`, в том числе на сайтах, где ты вошёл.'),
    ].join('\n\n')
    const choice = await keepLoud(() => sendChoice(chatId, topicId, md, [[{ text: yes, data: `bra:yes:${id}`, style: 'success' }, { text: no, data: `bra:no:${id}` }]], new InlineKeyboard().text(yes, `bra:yes:${id}`).text(no, `bra:no:${id}`)))
    browserAsks.set(id, { key, choice })
    offers.open(key, 'browser', choice?.messageId)
    log.info('browser asked', { key })
    return 'The question with its buttons is already in the chat, just above your final reply. End your turn now with one short line (do not call them "below"); the next message tells you what the user chose.'
  }

  bot.callbackQuery(/^bra:(yes|no):(\d+)$/, async ctx => {
    const id = Number(ctx.match[2])
    const ask = browserAsks.get(id)
    if (!ask) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    browserAsks.delete(id)
    const { chatId, topicId } = parseKey(ask.key)
    const settle = (note: string) => (ask.choice
      ? editRich(chatId, ask.choice.messageId, `${ask.choice.md}\n\n> ${note}`)
      : ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(note.replace(/\*\*/g, ''), 'noop') }).catch(() => {}))
    if (ctx.match[1] === 'no') {
      await ctx.answerCallbackQuery(tr('Not given', 'Не дан'))
      await settle(tr('**No access**', '**Без доступа**'))
      return enqueue(chatId, topicId, '[The user did not give you access to their Chrome. Go on without it, or say briefly what you can\'t do without it.]', { reply: false, shownId: ask.choice?.messageId ?? ctx.callbackQuery.message?.message_id })
    }
    await ctx.answerCallbackQuery(tr('Access given', 'Доступ дан'))
    await settle(tr('✅ **Access given**', '✅ **Доступ дан**'))
    const t = topics.get(ask.key)
    if (!t.deviceId) return
    browserPending.add(ask.key)
    if (browsers.get(t.deviceId)) {
      topics.set(ask.key, { browser: true })
      return browserGranted(ask.key, ask.choice?.messageId ?? ctx.callbackQuery.message?.message_id)
    }
    // First time on this computer: which of the connected browsers is its own
    return chooseBrowser(chatId, topicId, t.deviceId, t.profile)
  })

  bot.callbackQuery('brx', async ctx => {
    topics.set(topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message)), { browser: false, browserAuto: false })
    await ctx.answerCallbackQuery(tr('Off', 'Выключен'))
    await ctx.editMessageText(tr('🌐 The browser is <b>off</b> in this topic.', '🌐 Браузер в этом топике <b>выключен</b>.'), HTML)
  })
  bot.callbackQuery('brr', async ctx => {
    const t = topics.get(topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message)))
    await ctx.answerCallbackQuery()
    if (t.deviceId) await chooseBrowser(ctx.chat!.id, topicOf(ctx.callbackQuery.message), t.deviceId, t.profile, ctx)
  })

  // --- Claude profiles (§7): one per topic, switched only by the user ---------------------------------
  const newProfileHint = () => `${tr('A new profile is added on the server:', 'Новый профиль добавляется на сервере:')}\n\`\`\`\n${tr('npm run login -- --profile NAME', 'npm run login -- --profile ИМЯ')}\n\`\`\``

  function profileKeyboard(current?: string, device?: { name: string, profile: string }) {
    const kb = new InlineKeyboard()
    for (const name of profiles.list()) kb.text(`${name === profiles.nameOf(current) ? '✅ ' : ''}${name}`, `pf:${name}`)
    if (device) kb.row().text(tr(`💻 As ${device.name}: ${device.profile}`, `💻 Как у ${device.name}: ${device.profile}`), 'pfd')
    return kb
  }

  bot.command('profile', async ctx => {
    const topicId = topicOf(ctx.msg)
    const t = topics.get(topicKey(ctx.chat.id, topicId))
    const names = profiles.list()
    const st = await Promise.all(names.map(n => profiles.status(n)))
    const current = profiles.nameOf(t.profile)
    const account = (s: (typeof st)[number]) => (s.loggedIn ? `${planLabel(s.plan)} · ${maskEmail(s.email)}` : tr('not signed in', 'вход не выполнен'))
    const many = names.length > 1
    const devProfile = t.deviceId ? registry.profileOf(t.deviceId) : undefined
    const devName = t.deviceId ? deviceName(t.deviceId) : ''
    // A topic of its own choice offers its computer's back
    const back = devProfile && t.profileOwn ? { name: devName, profile: devProfile } : undefined
    return sendRich(ctx.chat.id, topicId, [
      tr(`### Claude profile in this topic: ${current}`, `### Профиль Claude в этом топике: ${current}`),
      many ? names.map((n, i) => `- ${n === current ? '✅ ' : ''}**${n}:** ${account(st[i])}`).join('\n') : account(st[0]),
      devProfile ? (t.profileOwn
        ? tr(`Picked for this topic: ${mdText(devName)} runs on ${devProfile}.`, `Выбран для этого топика: ${mdText(devName)} работает на ${devProfile}.`)
        : tr(`As its computer, ${mdText(devName)}: set in /devices.`, `Как у компьютера ${mdText(devName)}: задаётся в /devices.`)) : '',
      many ? tr('Switch with a button. The session can move to another profile.', 'Сменить можно кнопкой. Сессию можно перенести на другой профиль.') : newProfileHint(),
    ].filter(Boolean).join('\n\n'), many ? { reply_markup: profileKeyboard(t.profile, back) } : {})
  })

  bot.command('profiles', async ctx => {
    const names = profiles.list()
    const st = await Promise.all(names.map(n => profiles.status(n)))
    // A personal account's organization is only its email again: “c@g.com's Organization” says nothing
    const org = (o?: string) => (o && !o.includes('@') ? ` · ${o}` : '')
    return sendRich(ctx.chat.id, topicOf(ctx.msg), [
      tr('### Claude profiles', '### Профили Claude'),
      names.map((n, i) => `- **${n}${n === profiles.defaultName ? tr(' (default)', ' (по умолчанию)') : ''}:** ${st[i].loggedIn ? `${planLabel(st[i].plan)} · ${maskEmail(st[i].email)}${org(st[i].org)}` : tr('🔑 not signed in', '🔑 вход не выполнен')}`).join('\n'),
      tr('Sign in again with a button. Limits: /usage. The profile of this topic: /profile.', 'Войти заново можно кнопкой. Лимиты: /usage. Профиль этого топика: /profile.'),
      newProfileHint(),
    ].join('\n\n'), { reply_markup: loginKeyboard(names, st.map(s => s.loggedIn)) })
  })

  // A topic by its own name and its group apart, for the widget: the text keeps them on one line
  const spendPlace = (key: string, saved?: string) => {
    const { chatId, topicId } = parseKey(key)
    const t = topics.get(key)
    const name = t.workerName ?? t.title ?? saved?.replace(/^🤖\s*/, '') ?? (chatId > 0 ? tr('private chat', 'личка') : topicId ? tr('deleted topic', 'удалённый топик') : tr('general chat', 'общий чат'))
    return { name, place: chatId < 0 ? workspaces.get(chatId)?.title : undefined }
  }
  async function sendUsageWidget(chatId: number, topicId: number | undefined, usage: ProfileUsage, plan?: string) {
    const windows = [
      { label: tr('5 hours', '5 часов'), w: usage.fiveHour },
      { label: tr('Week', 'Неделя'), w: usage.sevenDay },
      ...usage.models.map(m => ({ label: m.name, w: m as Window | undefined })),
    ].flatMap(({ label, w }) => (w && w.utilization !== null ? [{ label, pct: w.utilization, resetsAt: w.resetsAt ? Date.parse(w.resetsAt) : undefined }] : []))
    if (!windows.length) return false
    const html = usageWidgetHtml({
      plan: planLabel(usage.plan ?? plan),
      windows,
      days: spend.days().map(d => ({ ...d, topics: d.topics.map(x => ({ ...spendPlace(x.key, x.name), units: x.units })) })),
      week: spend.week().topics.filter(x => x.share >= 0.01).slice(0, 3).map(x => ({ ...spendPlace(x.key, x.name), share: x.share })),
    })
    const problem = widgetProblem(html)
    if (problem) return void log.warn('usage widget', problem), false
    try {
      await (api.raw as unknown as { sendWidget: (o: object) => Promise<unknown> }).sendWidget({ chat_id: chatId, ...where(topicId), html, width: 320, reply_markup: resetsKeyboard() })
      return true
    } catch (e) {
      log.warn('usage widget', (e as Error).message)
      return false
    }
  }

  bot.command('usage', async ctx => {
    const topicId = topicOf(ctx.msg)
    // Accounts, plans and how much is spent, the same as /profiles: not where others read along
    if (!await mayReveal(ctx.chat.id)) return ctx.reply(tr('While others read this group, this one works only in the private chat with me.', 'Пока эту группу читают другие, эта команда работает только в личке со мной.'), where(topicId))
    const t = topics.get(topicKey(ctx.chat.id, topicId))
    const msg = await ctx.reply(tr('📊 Checking the limits…', '📊 Смотрю лимиты…'), where(topicId))
    const names = profiles.list()
    const seen = await Promise.all(names.map(async n => {
      const status = await profiles.status(n)
      return { n, status, usage: status.loggedIn ? await profiles.usage(n) : null }
    }))
    await api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {})
    // In the private chat this topic's profile is a widget; the others, if any, still come as text
    const mine = profiles.nameOf(t.profile)
    const own = seen.find(x => x.n === mine)
    const shown = ctx.chat.id > 0 && own?.usage ? await sendUsageWidget(ctx.chat.id, topicId, own.usage, own.status.plan) : false
    if (shown && seen.length === 1) return
    const parts = seen.filter(x => !shown || x.n !== mine).map(x => usageMarkdown(x.n, { status: x.status, usage: x.usage, last: profiles.lastLimit(x.n), isDefault: x.n === profiles.defaultName }))
    if (shown) return sendRich(ctx.chat.id, topicId, parts.join('\n\n'))
    const week = spend.week()
    const top = week.topics.slice(0, 6).filter(x => x.share >= 0.01)
    const where_ = top.length ? [
      tr('### 🔥 Where the tokens went, 7 days', '### 🔥 Куда ушли токены за 7 дней'),
      [
        `| ${tr('Topic', 'Топик')} | ${tr('Share', 'Доля')} |`,
        '|---|---|',
        ...top.map(x => `| ${mdText(spendLabel(x.key, x.name))} | ${bar(Math.round(x.share * 100))} ${Math.round(x.share * 100)}% |`),
      ].join('\n'),
    ].join('\n\n') : ''
    return sendRich(ctx.chat.id, topicId, [...parts, where_, `<footer>${tr(`In this topic: ${profiles.nameOf(t.profile)}. Switch: /profile.`, `В этом топике: ${profiles.nameOf(t.profile)}. Сменить — /profile.`)}${top.length ? tr(' Shares weigh Opus above Sonnet and rereading below writing.', ' Доли учитывают, что Opus дороже Sonnet, а перечитывание дешевле записи.') : ''}</footer>`].filter(Boolean).join('\n\n'), { reply_markup: resetsKeyboard() })
  })

  // Free limit resets are on claude.ai's usage page, nowhere the bot can read them. It opens on a computer, in the browser
  // that goes out through this server, so claude.ai sees the address it sees at sign-in; from the phone straight, only
  // with a word that it doesn't
  const RESETS_URL = 'https://claude.ai/settings/usage'
  const resetsKeyboard = () => new InlineKeyboard().text(tr('🔄 Limit resets', '🔄 Сбросы лимита'), 'rst:go')
  const directResets = () => new InlineKeyboard().url(tr('🌐 Open without the server', '🌐 Открыть без сервера'), RESETS_URL)
  const noServerNote = () => tr(
    'You can open it straight from here, but then claude.ai sees your own address, not the server\'s.',
    'Можно открыть прямо отсюда, но тогда claude.ai увидит твой адрес, а не адрес сервера.')
  bot.callbackQuery(/^rst:(go|d:[\w-]+)$/, async ctx => {
    if (!owners.has(ctx.from.id)) return ctx.answerCallbackQuery()
    const topicId = topicOf(ctx.callbackQuery.message)
    const chatId = ctx.chat!.id
    const say = (html: string, kb?: InlineKeyboard) => api.sendMessage(chatId, html, { ...where(topicId), ...HTML, ...(kb && { reply_markup: kb }) }).catch(() => {})
    const online = gateway.devices().filter(d => !isCloud(d.id) && !d.locked)
    const own = topics.get(topicKey(chatId, topicId)).deviceId
    const asked = ctx.match[1].startsWith('d:') ? ctx.match[1].slice(2) : undefined
    const d = asked ? online.find(x => x.id === asked) : online.find(x => x.id === own) ?? (online.length === 1 ? online[0] : undefined)
    if (!d && !asked && online.length > 1) {
      await ctx.answerCallbackQuery()
      const kb = new InlineKeyboard()
      for (const x of online) kb.text(`${iconOf(x)} ${x.name}`, `rst:d:${x.id}`).row()
      kb.url(tr('🌐 Without the server', '🌐 Без сервера'), RESETS_URL)
      return say(tr('🔄 <b>Where to open the limits page?</b> It opens in the browser that goes through the server.', '🔄 <b>Где открыть страницу лимитов?</b> Она откроется в браузере, который ходит через сервер.'), kb)
    }
    if (!d) {
      await ctx.answerCallbackQuery()
      return say(`${tr('⚠️ <b>No computer is online</b> to open claude.ai through the server.', '⚠️ <b>Ни один компьютер не в сети</b>, чтобы открыть claude.ai через сервер.')} ${noServerNote()}`, directResets())
    }
    await ctx.answerCallbackQuery(tr(`Opening on ${d.name}…`, `Открываю на ${d.name}…`))
    const out = await gateway.request(d.id, { projectId: '', bindingVersion: 0, tool: 'open_login', params: { url: RESETS_URL } })
    log.info('limit resets page', { device: d.id, ok: out.ok })
    if (out.ok) {
      return say(tr(
        `🔄 The claude.ai limits page is open on <b>${esc(d.name)}</b> in ${loginBrowser(out.result)}, through the server. Under <b>Limit resets</b>: how many you have and until when, and <b>Reset for free</b>. If it asks you to sign in, use your Claude account.`,
        `🔄 Страница лимитов claude.ai открыта на <b>${esc(d.name)}</b> в ${loginBrowser(out.result)}, через сервер. В разделе <b>Limit resets</b> видно, сколько сбросов и до какого числа, там же кнопка <b>Reset for free</b>. Если попросит войти, войди своим аккаунтом Claude.`))
    }
    return say(`${tr(`⚠️ <b>Didn't open on ${esc(d.name)}:</b> ${esc(out.error.message)}.`, `⚠️ <b>Не открылось на ${esc(d.name)}:</b> ${esc(out.error.message)}.`)} ${noServerNote()}`, directResets())
  })

  // Switching: never under a running task; the conversation goes along only when the user says so
  // own: the topic's own choice, which its computer's profile no longer overrides
  async function switchProfile(key: string, to: string, carry: boolean, own = true) {
    const t = topics.get(key)
    const from = profiles.nameOf(t.profile)
    const carried = carry && !!t.sessionId && profiles.carry(t.sessionId, from, to)
    // Any switch ends a stay the bot started at a limit; the move at a limit writes its own way back after this
    topics.set(key, { profile: to, sessionId: carried ? t.sessionId : null, profileBack: undefined, ...(own && { profileOwn: true }) })
    log.info('profile', { key, from, to, carried, own })
    return carried
  }

  // The profile a topic runs on: its own if it picked one, else its computer's, else what it has
  const profileFor = (t: Topic) => (t.profileOwn || !t.deviceId ? t.profile : registry.profileOf(t.deviceId) ?? t.profile)

  // Before a turn: a topic follows its computer's profile, the conversation carried over. Not onto a profile that
  // can't sign in: that would only stop it
  async function followDeviceProfile(key: string) {
    await profileHome(key)
    const t = topics.get(key)
    const want = profiles.nameOf(profileFor(t))
    if (want === profiles.nameOf(t.profile) || !profiles.list().includes(want)) return
    if (!(await profiles.status(want).catch(() => null))?.loggedIn) return
    const carried = await switchProfile(key, want, true, false)
    const { chatId, topicId } = parseKey(key)
    background(api.sendMessage(chatId, tr(
      `🧠 This topic runs on <b>${esc(want)}</b> now, as its computer does${t.sessionId ? (carried ? ': the conversation moved over' : ': a new session') : ''}.`,
      `🧠 Топик теперь на профиле <b>${esc(want)}</b>, как его компьютер${t.sessionId ? (carried ? ': переписка перенесена' : ': новая сессия') : ''}.`,
    ), { ...where(topicId), ...HTML, disable_notification: true }).catch(() => {}))
  }

  // Before a turn: a topic the bot moved at a spent limit goes home once that limit has reset. Its computer's profile
  // and the account its Chrome is signed in to are there. A limit that turned out longer puts the return off
  async function profileHome(key: string) {
    const t = topics.get(key)
    const back = t.profileBack
    if (!back || Date.now() < back.at) return
    const last = profiles.lastLimit(back.to)
    const reset = epochMs(last?.resetsAt)
    if (last?.status === 'rejected' && reset && reset > Date.now()) return void topics.set(key, { profileBack: { ...back, at: reset } })
    topics.set(key, { profileBack: undefined })
    if (back.to === profiles.nameOf(t.profile) || !profiles.list().includes(back.to)) return
    if (!(await profiles.status(back.to).catch(() => null))?.loggedIn) return
    const carried = await switchProfile(key, back.to, true, back.own)
    if (!back.own) topics.set(key, { profileOwn: undefined })
    const { chatId, topicId } = parseKey(key)
    background(api.sendMessage(chatId, tr(
      `🧠 The limit of <b>${esc(back.to)}</b> has reset: this topic is back on it${t.sessionId ? (carried ? ', the conversation moved over' : ', in a new session') : ''}.`,
      `🧠 Лимит <b>${esc(back.to)}</b> сбросился: топик снова на нём${t.sessionId ? (carried ? ', переписка перенесена' : ', в новой сессии') : ''}.`,
    ), { ...where(topicId), ...HTML, disable_notification: true }).catch(() => {}))
  }

  // A profile whose limit is spent, until when if it said: nothing runs on it before that
  const limitSpent = (name: string) => {
    const last = profiles.lastLimit(name)
    const reset = epochMs(last?.resetsAt)
    return last?.status === 'rejected' && (!reset || reset > Date.now()) ? { reset } : undefined
  }
  // Computers other than this one whose Chrome is signed in to an account with room: where browser work can go when a
  // topic's own account is spent. A Chrome works only through the account it is signed in to
  // One that dropped its link a moment ago counts: a laptop does that for a few seconds many times a day, and the errand waits for it
  const JUST_HERE_MS = 2 * 60_000
  const hereOrJustHere = (r: { id: string, lastSeen?: number }) => {
    const d = gateway.device(r.id)
    return d ? !d.locked : Date.now() - (r.lastSeen ?? 0) < JUST_HERE_MS
  }
  const chromesWithRoom = (deviceId?: string) => registry.list().filter(r => r.id !== deviceId && !isCloud(r.id) && hereOrJustHere(r) && !!browsers.get(r.id) && !!chromeAccount(r.id) && !limitSpent(profiles.nameOf(chromeAccount(r.id))))
  // Another computer whose Chrome is signed in to this very account: a session on that account sees that Chrome itself
  const chromeOnAccount = (deviceId: string, profile: string) =>
    registry.list().find(r => r.id !== deviceId && !isCloud(r.id) && !!browsers.get(r.id) && chromeAccount(r.id) === profile && hereOrJustHere(r))

  // Another signed-in profile with room left, the emptiest first: for a topic that ran into a limit. One already
  // spent is skipped until its reset, so two accounts never pass a task back and forth
  async function spareProfile(from: string) {
    const room: { name: string, used: number }[] = []
    for (const name of profiles.list()) {
      if (name === from || !(await profiles.status(name).catch(() => null))?.loggedIn) continue
      if (limitSpent(name)) continue
      const u = await profiles.usage(name).catch(() => null)
      const used = Math.max(u?.fiveHour?.utilization ?? 0, u?.sevenDay?.utilization ?? 0)
      if (used < 98) room.push({ name, used })
    }
    return room.sort((a, b) => a.used - b.used)[0]?.name
  }

  async function checkTarget(ctx: Context, key: string, name: string) {
    if (!profiles.list().includes(name)) return ctx.answerCallbackQuery(tr('That profile is gone', 'Такого профиля больше нет')), false
    if (liveOf(key).busy) return ctx.answerCallbackQuery(tr('Wait for the task to finish first, or /stop', 'Сначала дождись конца задачи или /stop')), false
    if (!(await profiles.status(name)).loggedIn) {
      return ctx.answerCallbackQuery({ text: tr(`Profile ${name} isn't signed in to Claude: /profiles → “Sign in”`, `Профиль ${name} не вошёл в Claude: /profiles → «Войти»`), show_alert: true }), false
    }
    return true
  }

  bot.callbackQuery(/^pf:([\w-]+)$/, async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    const name = ctx.match[1]
    const t = topics.get(key)
    if (name === profiles.nameOf(t.profile)) return ctx.answerCallbackQuery(tr(`Already ${name}`, `Уже ${name}`))
    if (!(await checkTarget(ctx, key, name))) return
    await ctx.answerCallbackQuery()
    if (!t.sessionId) {
      await switchProfile(key, name, false)
      return ctx.editMessageText(tr(`Claude profile in this topic: <b>${name}</b>. New session.`, `Профиль Claude в этом топике: <b>${name}</b>. Новая сессия.`), HTML).catch(() => {})
    }
    return ctx.editMessageText(tr(`Switch the profile to <b>${name}</b>. Continue the current session or start a new one?`, `Сменить профиль на <b>${name}</b>. Продолжить текущую сессию или начать новую?`), {
      ...HTML,
      reply_markup: new InlineKeyboard().text(tr('Continue the session', 'Продолжить сессию'), `pfc:${name}`).text(tr('New session', 'Новая сессия'), `pfn:${name}`),
    }).catch(() => {})
  })

  bot.callbackQuery('pfd', async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    const t = topics.get(key)
    const devProfile = t.deviceId ? registry.profileOf(t.deviceId) : undefined
    if (!devProfile) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    topics.set(key, { profileOwn: undefined, profileBack: undefined })
    log.info('profile follows the computer', { key, profile: devProfile })
    await ctx.answerCallbackQuery(devProfile)
    await ctx.editMessageText(tr(`Claude profile in this topic: as its computer, <b>${esc(devProfile)}</b>, from the next message.`, `Профиль Claude в этом топике: как у компьютера, <b>${esc(devProfile)}</b>, со следующего сообщения.`), HTML).catch(() => {})
  })

  bot.callbackQuery(/^pf([cn]):([\w-]+)$/, async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    const name = ctx.match[2]
    if (!(await checkTarget(ctx, key, name))) return
    const carried = await switchProfile(key, name, ctx.match[1] === 'c')
    await ctx.answerCallbackQuery(name)
    await ctx.editMessageText(`${tr('Claude profile in this topic', 'Профиль Claude в этом топике')}: <b>${name}</b>. ${carried ? tr('The session moved over: the first answer rereads all of it, without the cache.', 'Сессия перенесена: первый ответ перечитает её целиком, без кеша.') : tr('New session.', 'Новая сессия.')}`, HTML).catch(() => {})
  })

  // From the "limit is spent" notice: carry the conversation over and send the message again there
  bot.callbackQuery(/^pfr:([\w-]+):(\d+)$/, async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    const name = ctx.match[1]
    const r = retries.get(Number(ctx.match[2]))
    if (!r) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    if (!(await checkTarget(ctx, key, name))) return
    retries.delete(Number(ctx.match[2]))
    pauses.dropHolding(key)
    const carried = await switchProfile(key, name, true)
    await ctx.answerCallbackQuery(name)
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(tr(`▶️ Continuing on ${name}`, `▶️ Продолжаю на ${name}`), 'noop') }).catch(() => {})
    if (!carried) await api.sendMessage(ctx.chat!.id, tr("The session couldn't move over: a new one starts on the new profile.", 'Сессию перенести не удалось: на новом профиле начнётся новая.'), where(topicOf(ctx.callbackQuery.message))).catch(() => {})
    const { chatId, topicId } = parseKey(r.key)
    enqueue(chatId, topicId, r.prompt, { images: r.images, reply: false, fromMode: r.fromMode, ownAnswers: r.ownAnswers })
  })

  // --- §18 diagnostics: server, tasks, devices, versions, integrations --------------------------------
  bot.command('diag', async ctx => {
    const topicId = topicOf(ctx.msg)
    const t = topics.get(topicKey(ctx.chat.id, topicId))
    const msg = await ctx.reply(tr('🩺 Collecting…', '🩺 Собираю…'), where(topicId))
    const [v, logs, history] = await Promise.all([claudeVersions(), dirSize(join(cfg.dataDir, 'logs')), dirSize(dirname(cfg.profileDir))])
    const space = disk(cfg.dataDir)
    const inboxNow = inbox.stats()
    const names = profiles.list()
    const st = await Promise.all(names.map(n => profiles.status(n)))
    const queued = [...live.values()].reduce((n, x) => n + x.queue.length, 0)
    const last = listBackups(cfg.backupDir).at(-1)
    const online = new Map(gateway.devices().map(d => [d.id, d]))
    const devices = registry.list().map(r => {
      const d = online.get(r.id)
      const mcp = d ? `, MCP ${d.mcp.filter(s => s.status === 'connected').length}/${d.mcp.length}` : ''
      const browser = browsers.get(r.id)
      return `| ${d ? '🟢' : '⚪'} ${d?.name ?? r.name} | ${d ? tr(`${d.os}, version ${d.version ?? '?'}${mcp}, online for ${duration(Date.now() - d.connectedAt)}`, `${d.os}, версия ${d.version ?? '?'}${mcp}, в сети ${duration(Date.now() - d.connectedAt)}`) : `${tr('offline', 'не в сети')}${r.lastSeen ? tr(`, last seen ${duration(Date.now() - r.lastSeen)} ago`, `, был ${duration(Date.now() - r.lastSeen)} назад`) : ''}`}${browser ? `, Chrome “${browser.name}”` : ''} |`
    })
    const missing = missingForSpeech(media)
    const figma = names.map(n => `${n}: ${remoteStatus.get(n)?.find(r => r.name === 'figma')?.status ?? tr('not checked yet', 'не проверялась')}`).join(', ')
    const table = (title: string, rows: string[]) => [`### ${title}`, plainTable(rows)].join('\n\n')
    await api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {})
    return sendRich(ctx.chat.id, topicId, [
      table(tr('Server', 'Сервер'), [
        `| ${tr('Version', 'Версия')} | ${SERVER_VERSION} · Node ${process.versions.node} · ${platform()} ${release()} |`,
        `| ${tr('Updates', 'Обновления')} | ${lastRelease ? (newer(lastRelease.version, updates.current) ? tr(`${lastRelease.version} is out: /update`, `есть ${lastRelease.version} — /update`) : tr('latest version', 'последняя версия')) : tr('GitHub not checked yet', 'GitHub ещё не проверялся')}${updates.helper() ? '' : tr(', updates by hand', ', обновление вручную')} |`,
        `| ${tr('Up for', 'Работает')} | ${duration(process.uptime() * 1000)} |`,
        `| ${tr('Disk', 'Диск')} | ${space ? tr(`${bytes(space.free)} free of ${bytes(space.total)}`, `свободно ${bytes(space.free)} из ${bytes(space.total)}`) : tr('no data', 'нет данных')} |`,
        `| ${tr('Memory', 'Память')} | ${tr(`process ${bytes(process.memoryUsage().rss)}, ${bytes(freemem())} free of ${bytes(totalmem())}`, `процесс ${bytes(process.memoryUsage().rss)}, свободно ${bytes(freemem())} из ${bytes(totalmem())}`)} |`,
        `| ${tr('Tasks', 'Задачи')} | ${tr(`${running} of ${cfg.maxParallel} running, ${slotWaiters.length} waiting for a slot, ${queued} queued`, `идут ${running} из ${cfg.maxParallel}, ждут очереди ${slotWaiters.length}, в очередях ${queued}`)} |`,
        `| ${tr('Browser tunnel', 'Туннель браузера')} | ${tr(`${gateway.tunnels().open} open, ${gateway.tunnels().total} since start`, `открыто ${gateway.tunnels().open}, с запуска ${gateway.tunnels().total}`)} |`,
        `| ${tr('Attachments', 'Вложения')} | ${inboxNow.files} · ${bytes(inboxNow.bytes)} |`,
        `| ${tr('History', 'История')} | ${bytes(history.bytes)} |`,
        `| ${tr('Logs', 'Журналы')} | ${bytes(logs.bytes)}${tr(', kept 14 days', ', хранятся 14 дней')} |`,
        `| ${tr('Backup', 'Бэкап')} | ${cfg.backupKey ? (last ? tr(`${duration(Date.now() - last.at.getTime())} ago, ${bytes(last.bytes)}`, `${duration(Date.now() - last.at.getTime())} назад, ${bytes(last.bytes)}`) : tr('none yet', 'ещё не было')) : tr('off: no BACKUP_KEY', 'выключен: нет BACKUP_KEY')} |`,
      ]),
      table('Claude', [
        `| ${tr('Versions', 'Версии')} | CLI ${v.cli} · SDK ${v.sdk} |`,
        ...names.map((n, i) => `| ${n === profiles.nameOf(t.profile) ? '• ' : ''}${n} | ${st[i].loggedIn ? `✅ ${planLabel(st[i].plan)}` : tr('🔑 not signed in', '🔑 вход не выполнен')} |`),
      ]),
      table(tr('Computers', 'Компьютеры'), devices.length ? devices : [tr('| — | none |', '| — | ни одного |')]),
      table(tr('Integrations', 'Интеграции'), [
        `| ${tr('Sandbox', 'Песочница')} | ${!sandbox || sandbox.state().state === 'off' ? tr('not on a VPS', 'не на VPS') : sandbox.state().state === 'ok' ? tr('✅ containers are shut off from the VPS and private networks', '✅ контейнеры закрыты от VPS и частных сетей') : tr(`⚠️ not working: ${sandbox.state().reason}`, `⚠️ не работает: ${sandbox.state().reason}`) } |`,
        `| Figma | ${figma} |`,
        `| ${tr('Voice', 'Голос')} | ${!missing.length ? 'whisper ✅' : onlyModelMissing(media) ? tr('model not downloaded yet: the bot offers it with the first voice message', 'модель ещё не скачана: бот предложит её с первым голосовым') : tr(`missing: ${missing.join(', ')}`, `нет: ${missing.join(', ')}`)} |`,
        `| ${tr('Video', 'Видео')} | ${media.ffmpeg && media.ffprobe ? 'ffmpeg ✅' : tr('no ffmpeg', 'нет ffmpeg')} |`,
      ]),
    ].join('\n\n'))
  })

  // --- §16 cleanup: each kind of data on its own, every deletion confirmed with a second tap --------------
  const CLEANUP: Record<string, { label: string, ask: string }> = {
    tmp: { get label() { return tr('🧹 Temporary files', '🧹 Временные файлы') }, get ask() { return tr('Delete every Telegram attachment on the server (copies saved to computers stay) and old browser screenshots?', 'Удалить все вложения из Telegram на сервере (сохранённые на компьютеры копии останутся) и старые скриншоты браузера?') } },
    topic: { get label() { return tr("🗑 This topic's session", '🗑 Сессия этого топика') }, get ask() { return tr("Delete this topic's session on the server? The next message starts a new one.", 'Удалить сессию этого топика на сервере? Следующее сообщение начнёт новую.') } },
    all: { get label() { return tr('🗑 All sessions on the server', '🗑 Все сессии на сервере') }, get ask() { return tr('Delete ALL sessions of every topic and profile on the server? Claude sign-ins and settings stay.', 'Удалить ВСЕ сессии всех топиков и профилей на сервере? Входы в Claude и настройки останутся.') } },
    logs: { get label() { return tr('📜 Server logs', '📜 Журналы сервера') }, get ask() { return tr("Delete the server's technical logs?", 'Удалить технические журналы сервера?') } },
  }
  const cleanupKeyboard = () => {
    const kb = new InlineKeyboard()
    for (const [k, c] of Object.entries(CLEANUP)) kb.text(c.label, `cl:${k}`).row()
    return kb
  }

  bot.command('cleanup', ctx => sendRich(ctx.chat.id, topicOf(ctx.msg), [
    tr('**What to delete on the server?** Every action asks for confirmation.', '**Что удалить на сервере?** Каждое действие спросит подтверждение.'),
    tr("_Deleting here doesn't delete data at Telegram, Anthropic or in projects on computers. A computer's log is data/logs/agent.log on that computer._", '_Удаление здесь не удаляет данные у Telegram, Anthropic и в проектах на компьютерах. Журнал компьютера — data/logs/agent.log на нём самом._'),
  ].join('\n\n'), { reply_markup: cleanupKeyboard() }))

  bot.callbackQuery(/^cl:(\w+)$/, async ctx => {
    const c = CLEANUP[ctx.match[1]]
    if (!c) return ctx.answerCallbackQuery()
    await ctx.answerCallbackQuery()
    await ctx.editMessageText(`<b>${c.ask}</b>`, {
      ...HTML,
      reply_markup: new InlineKeyboard().text(tr('Yes, delete', 'Да, удалить'), `clok:${ctx.match[1]}`).text(tr('Cancel', 'Отмена'), 'clno'),
    }).catch(() => {})
  })
  // --- teams: a head topic starts agents, each a topic of its own; their reports wake the head ---------------
  const MAX_WORKERS = 5
  // Reports that wake the head with no word from the user in between; past this the head waits for the user
  const MAX_WAKES = 20
  const teamWakes = new Map<string, number>()
  const heldReports = new Map<string, string[]>()
  const lastReports = new Map<string, string>()
  const reportedAt = new Map<string, number>()
  // What the head and its workers tell each other is shown to the user as quotes
  // A cut in the middle of a code block would leave it open and break the whole message
  // A heading and a long text folded under it, masked like everything that leaves for Telegram
  // A reply to an agent's report in the head's topic goes to that agent: the head would only pass it on, and rereading its
  // whole history for that costs more than the agent's work. Which agent sent which report, for the latest of them
  const reportOf = new Map<string, string>()
  const REPORTS_KEPT = 300
  async function toAgentByReply(chatId: number, topicId: number | undefined, msg: Message, text: string, images: PromptImage[] = []) {
    const replied = msg.reply_to_message?.message_id
    const agent = replied ? reportOf.get(`${chatId}:${replied}`) : undefined
    const headKey = topicKey(chatId, topicId)
    if (!agent || topics.get(agent).head !== headKey || !workersOf(headKey).includes(agent)) return false
    const name = topics.get(agent).workerName ?? 'agent'
    const at = parseKey(agent)
    const shown = await foldedMessage(at.chatId, at.topicId, `<b>${topicA(headKey, tr('👤 You, answering your report in the head:', '👤 Ты, в ответ на отчёт в хеде:'))}</b>`, text).catch(() => undefined)
    enqueue(at.chatId, at.topicId, `[The user answers your report, writing in the head's topic]\n${text}`, { reply: false, shownId: shown?.message_id, ownAnswers: true, rush: true, images })
    log.info('reply to a report sent to its agent', { head: headKey, agent })
    await api.sendMessage(chatId, tr(`↪️ Sent to the agent <b>${topicA(agent, name)}</b>`, `↪️ Передал агенту <b>${topicA(agent, name)}</b>`), { ...where(topicId), ...HTML, reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } }).catch(() => {})
    return true
  }

  const foldedMessage = async (chatId: number, topicId: number | undefined, head: string, text: string) => {
    const safe = masked(chatId, topicId, text)
    const send = (quote: string) => api.sendMessage(chatId, text ? `${head}\n${quote}` : head, { ...where(topicId), ...HTML })
    // Refused over the formatting, it still arrives: a report must not be lost over its looks
    return send(markdownQuote(safe)).catch(e => {
      log.warn('folded message refused, sending it unformatted', (e as Error).message)
      return send(foldedQuote(safe))
    }).catch(e => {
      log.warn('folded message', (e as Error).message)
      return undefined
    })
  }
  const workersOf = (head: string) => (topics.get(head).workers ?? []).filter(k => topics.get(k).head === head)
  const mindOf = (t: Topic) => `${modelLabel(modelOf(t))} · ${t.effort ?? cfg.effort}`
  const placeOf = (t: Topic) => {
    const d = gateway.device(t.deviceId ?? '')
    const p = d?.projects.find(x => x.id === t.projectId)
    return `${d ? `${iconOf(d)} ${d.name}` : deviceName(t.deviceId ?? '')} · 📁 ${p?.name ?? t.projectId}${t.worktree ? ` · 🌿 ${t.worktree.branch}` : ''}`
  }

  // An agent's own branch: a worktree in the repository's worktrees folder, <project>-wt/<branch>, branch agent/<branch>
  const git = (deviceId: string, projectId: string, args: string[], timeoutSec = 120) =>
    gateway.request(deviceId, { projectId, bindingVersion: 0, tool: 'run_command', params: { program: 'git', args, timeoutSec } })
  const gitOut = (out: OpOutcome) => (out.ok ? (out.result as { stdout: string }).stdout : '')
  const gitFailed = (out: OpOutcome) => {
    if (!out.ok) return out.error.message
    const r = out.result as { exitCode: number | null, stderr: string, stdout: string }
    return r.exitCode === 0 ? null : (r.stderr || r.stdout).trim().slice(-300) || tr(`code ${r.exitCode}`, `код ${r.exitCode}`)
  }
  async function makeWorktree(deviceId: string, repo: Project, name: string, from?: string): Promise<{ project: Project, worktree: NonNullable<Topic['worktree']> } | string> {
    if (!/^[a-z0-9][a-z0-9._-]{0,39}$/i.test(name)) return 'branch: Latin letters, digits, dots and dashes, e.g. "balance".'
    const notRepo = gitFailed(await git(deviceId, repo.id, ['rev-parse', '--show-toplevel']))
    if (notRepo) return `${repo.name} is not a git repository (${notRepo}): run git init and commit first, or start the agent without a branch.`
    const folder = worktreePath(repo, await gateway.refreshProjects(deviceId), name)
    const branch = `agent/${name}`
    // A new branch from the head's HEAD, or from the agent this one follows; one that exists already (an agent started again) is checked out as is
    // A repository that names its heavy folders (.worktree-skip) gets the worktree without them
    const light = sparsePatterns(repo.worktreeSkip ?? [])
    const bare = light.length > 1 ? ['--no-checkout'] : []
    let failed = gitFailed(await git(deviceId, repo.id, ['worktree', 'add', ...bare, '-b', branch, folder, ...(from ? [from] : [])]))
    if (failed && /already exists/i.test(failed)) failed = gitFailed(await git(deviceId, repo.id, ['worktree', 'add', ...bare, folder, branch]))
    if (failed) return `Could not make a worktree for ${branch}: ${failed}`
    if (bare.length) await fillLight(deviceId, repo.id, folder, light)
    const project = (await gateway.refreshProjects(deviceId)).find(p => p.name === name && p.worktreeOf === (repo.worktreeOf ?? repo.id))
    if (!project) return `The worktree ${folder} was made, but the computer doesn't list it as a project: it is outside the workspace zone, or the computer's agent is older than this server. No agent can be bound to it yet.`
    log.info('worktree made', { device: deviceId, repo: repo.id, folder, branch })
    return { project, worktree: { repo: repo.id, folder, branch } }
  }
  // Everything but the folders left out. A git that can't do that checks the whole of it out, as ever
  async function fillLight(deviceId: string, repo: string, folder: string, patterns: string[]) {
    const failed = gitFailed(await git(deviceId, repo, ['-C', folder, 'sparse-checkout', 'set', '--no-cone', ...patterns]))
      ?? gitFailed(await git(deviceId, repo, ['-C', folder, 'read-tree', '-mu', 'HEAD'], 600))
    if (!failed) return
    log.warn('light worktree', { device: deviceId, folder, failed })
    await git(deviceId, repo, ['-C', folder, 'sparse-checkout', 'disable'])
    await git(deviceId, repo, ['-C', folder, 'reset', '--hard', '-q'], 600)
  }
  // Null when gone; otherwise why the folder stays (uncommitted work is never thrown away)
  // git won't remove a worktree with submodules even when nothing in it has changed. --force does, after the check git
  // skips for them, done here first: anything uncommitted, in the submodules too, and it stays
  async function removeWorktree(deviceId: string, repo: string, folder: string) {
    const failed = gitFailed(await git(deviceId, repo, ['worktree', 'remove', folder], 600))
    if (!failed || !/submodule/i.test(failed)) return failed
    const status = await git(deviceId, repo, ['-C', folder, 'status', '--porcelain', '--ignore-submodules=none'])
    const changed = gitFailed(status) ?? ((status as { ok: true, result: { stdout: string } }).result.stdout.trim() ? tr('it has uncommitted changes', 'в ней есть незакоммиченные изменения') : null)
    return changed ?? gitFailed(await git(deviceId, repo, ['worktree', 'remove', '--force', folder], 600))
  }
  const folderRetry = createFolderRetry({
    remove: async (deviceId, repo, folder) => {
      const out = await gateway.request(deviceId, { projectId: repo, bindingVersion: 0, tool: 'run_command', params: { ...rmdirCommand(gateway.device(deviceId)?.os, folder), timeoutSec: 30 } })
      return gitFailed(out)
    },
    online: deviceId => !!gateway.device(deviceId),
    done: (deviceId, repo, folder, removed) => {
      log.info(removed ? 'busy folder removed' : 'busy folder given up', { device: deviceId, folder })
      if (removed) git(deviceId, repo, ['worktree', 'prune']).then(() => gateway.refreshProjects(deviceId)).catch(() => {})
    },
  })
  // busy: git let go of it, but another program holds the folder; it is deleted later, by itself
  async function dropWorktree(t: Topic): Promise<{ kept: string, busy?: boolean } | null> {
    if (!t.worktree || !t.deviceId) return null
    // Older ones were a bare folder name next to the repository
    const folder = /^([a-z]:)?[\\/]/i.test(t.worktree.folder) ? t.worktree.folder : `../${t.worktree.folder}`
    const failed = await removeWorktree(t.deviceId, t.worktree.repo, folder)
    if (!failed) {
      log.info('worktree removed', { folder: t.worktree.folder })
      await gateway.refreshProjects(t.deviceId)
      return null
    }
    if (isBusyFolder(failed)) {
      log.info('worktree folder busy, removed later', { folder: t.worktree.folder })
      folderRetry.later(t.deviceId, t.worktree.repo, folder)
      await gateway.refreshProjects(t.deviceId).catch(() => {})
      return { kept: t.worktree.folder, busy: true }
    }
    return { kept: `${t.worktree.folder}: ${failed}` }
  }
  const stateOf = (k: string): 'asking' | 'working' | 'queued' | 'idle' => {
    const l = live.get(k)
    if ([...pending.values()].some(p => p.key === k) || l?.answer) return 'asking'
    return l?.busy ? 'working' : l?.queue.length ? 'queued' : 'idle'
  }
  const STATE_LABEL: Record<'asking' | 'working' | 'queued' | 'idle', string> = { get asking() { return tr('⏸ waiting for you', '⏸ ждёт тебя') }, get working() { return tr('⚙️ working', '⚙️ работает') }, get queued() { return tr('📥 queued', '📥 в очереди') }, get idle() { return tr('✅ idle', '✅ свободен') } }

  // A file inside one of the head's agents' projects is fetched through that agent's project
  const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  function agentMediaOp(headKey: string, path: string): MediaOp | undefined {
    for (const k of workersOf(headKey)) {
      const w = topics.get(k)
      const p = gateway.device(w.deviceId ?? '')?.projects.find(x => x.id === w.projectId)
      if (p && slash(path).startsWith(slash(p.path) + '/')) return { deviceId: w.deviceId!, projectId: p.id, bindingVersion: w.bindingVersion }
    }
  }

  // A worker waits for the user: said in the head's topic too, where the user is looking
  function notifyHead(key: string, what: string) {
    const t = topics.get(key)
    if (!t.head) return
    const { chatId, topicId } = parseKey(t.head)
    api.sendMessage(chatId, tr(`🤖 Agent <b>${topicA(key, t.workerName ?? '')}</b> ${what}: look in its topic.`, `🤖 Агент <b>${topicA(key, t.workerName ?? '')}</b> ${what} — загляни в его топик.`), { ...where(topicId), ...HTML }).catch(() => {})
  }

  // chained: this start is the moment an agent waited for, past the check it went through when it was asked for
  function teamOf(headKey: string, chained?: { branch?: string }): TeamHandlers {
    const { chatId, topicId: headTopic } = parseKey(headKey)
    const sameName = (list: { name: string }[], name: string) => list.some(w => w.name.toLowerCase() === name.trim().toLowerCase())
    const find = (name: string) => workersOf(headKey).find(k => topics.get(k).workerName?.toLowerCase() === name.trim().toLowerCase())
    const missing = (name: string) => `No agent «${name}». Yours: ${workersOf(headKey).map(k => topics.get(k).workerName).join(', ') || 'none'}.`
    const say = (k: string, md: string) => {
      const { topicId } = parseKey(k)
      return sendRich(chatId, topicId, md).catch(() => {})
    }
    const sayFolded = (k: string, head: string, text: string) => foldedMessage(chatId, parseKey(k).topicId, head, text)
    return {
      async start(a) {
        const head = topics.get(headKey)
        const team = workersOf(headKey)
        const waiting = head.waitingAgents ?? []
        if (team.length + waiting.length >= MAX_WORKERS && !chained) return `You already have ${MAX_WORKERS} agents: remove one first (remove_agent).`
        if (find(a.name) || sameName(waiting, a.name)) return `An agent named «${a.name}» already exists: pick another name or message it.`
        if (a.profile && !(await profiles.status(a.profile).catch(() => null))?.loggedIn) return `The profile ${a.profile} isn't signed in to Claude: leave profile out, or the user signs it in with /profiles.`
        if (a.after) {
          if (!find(a.after) && !sameName(waiting, a.after)) return missing(a.after)
          topics.set(headKey, { waitingAgents: [...waiting, { ...a, after: a.after }] })
          log.info('agent waits', { head: headKey, name: a.name, after: a.after })
          return `«${a.name}» will start when «${a.after}» has finished, with its report added to the task. If «${a.after}» fails it won't start, and you will hear of it. Nothing else to do for now.`
        }
        const online = gateway.devices()
        const want = a.device?.trim().toLowerCase()
        const dev = want ? online.find(d => d.id.toLowerCase() === want || d.name.toLowerCase() === want)
          : (head.deviceId && gateway.device(head.deviceId)) || (online.length === 1 ? online[0] : undefined)
        if (!dev) return `${want ? `Computer «${a.device}» is not online.` : 'Name the computer (device).'} Online: ${online.map(d => `${d.name} (id ${d.id})`).join(', ') || 'none'}.`
        let project: Project | undefined
        if (a.new_project) {
          const out = await gateway.request(dev.id, { projectId: '', bindingVersion: 0, tool: 'create_project', params: { name: a.new_project } })
          if (!out.ok) return `Could not create project «${a.new_project}» on ${dev.name}: ${out.error.message}`
          project = out.result as Project
          await gateway.refreshProjects(dev.id)
        } else {
          const list = await gateway.refreshProjects(dev.id)
          const p = a.project?.trim() ?? (head.deviceId === dev.id ? head.projectId : undefined)
          project = p ? list.find(x => x.id === p || x.name.toLowerCase() === p.toLowerCase()) : undefined
          if (!project) return `${p ? `No project «${p}» on ${dev.name}.` : 'Name the project or pass new_project.'} Projects there: ${list.filter(x => !x.hidden).slice(0, 40).map(x => x.name).join(', ')}.`
        }
        let worktree: Topic['worktree']
        if (a.branch) {
          const made = await makeWorktree(dev.id, project, a.branch, chained?.branch)
          if (typeof made === 'string') return made
          ;({ project, worktree } = made)
        }
        const topic = await api.createForumTopic(chatId, trunc(`🤖 ${a.name}`, 128))
        const key = topicKey(chatId, topic.message_thread_id)
        topics.bind(key, dev.id, project.id)
        // The head's permissions apply live (modeOf) and so does its Claude profile; Chrome too when on the
        // same computer. The head picks the model
        const t = topics.set(key, {
          head: headKey, workerName: a.name, workerDoing: a.doing, model: agentModel(a.model), effort: a.effort, profile: a.profile ? a.profile : head.profile, ...(a.profile && { profileOwn: true }), usedAt: Date.now(),
          browser: !!head.browser && head.deviceId === dev.id, worktree,
        })
        topics.set(headKey, { workers: [...team, key] })
        log.info('agent started', { head: headKey, worker: key, name: a.name, device: dev.id, project: project.id, branch: worktree?.branch, model: a.model, effort: a.effort, profile: profiles.nameOf(t.profile) })
        const shown = await sayFolded(key, `<b>${topicA(headKey, tr('🧭 Task from the head', '🧭 Задача от хеда'))}</b> · ${esc(placeOf(t))} · 🧠 ${esc(mindOf(t))}`, a.task)
        await sendRich(chatId, headTopic, `${tr('🤖 Agent started', '🤖 Запущен агент')} **${topicMd(key, a.name)}** · ${placeOf(t)} · 🧠 ${mindOf(t)}`).catch(() => {})
        enqueue(chatId, topic.message_thread_id, `${HEAD_TASK}\n${a.task}`, { reply: false, shownId: shown?.message_id })
        return `Started «${a.name}» on ${dev.name}, project ${project.name} (${project.path})${worktree ? `, its own branch ${worktree.branch}: merge it into yours after its report` : ''}, ${a.model}/${a.effort}.${topicUrl(key) ? ` Its topic: ${topicUrl(key)}` : ''} It works in parallel; its report arrives here as a message when its turn ends. End your turn unless you have other work.`
      },

      async message({ agent, text, now, doing }) {
        const k = find(agent)
        if (!k) return missing(agent)
        if (doing) topics.set(k, { workerDoing: doing })
        topics.touch(k)
        const shown = await sayFolded(k, `<b>${topicA(headKey, tr('🧭 Head:', '🧭 Хед:'))}</b>`, text)
        const busy = live.get(k)?.busy
        enqueue(chatId, parseKey(k).topicId, `${HEAD_MESSAGE}\n${text}`, { reply: false, shownId: shown?.message_id, rush: now })
        if (!busy) return 'Delivered; the agent is on it.'
        return now ? 'Delivered; the agent is busy and gets it after its current step.' : 'Delivered; the agent is busy and gets it after its current turn.'
      },

      async setModel({ agent, model, effort }) {
        const k = find(agent)
        if (!k) return missing(agent)
        if (!model && !effort) return 'Give a model, an effort or both.'
        const t = topics.set(k, { ...(model && { model: agentModel(model) }), ...(effort && { effort }) })
        log.info('agent model', { agent: k, model, effort })
        await say(k, tr(`🧭 The head changed the model: 🧠 **${mindOf(t)}**`, `🧭 Хед сменил модель: 🧠 **${mindOf(t)}**`))
        return `«${agent}» now runs on ${mindOf(t)} from its next turn${live.get(k)?.busy ? ' (the current one keeps its settings)' : ''}.`
      },

      async status() {
        const team = workersOf(headKey)
        const waiting = topics.get(headKey).waitingAgents ?? []
        if (!team.length && !waiting.length) return 'No agents.'
        return [...team.map(k => {
          const t = topics.get(k)
          const last = lastReports.get(k)
          return `- ${t.workerName}${topicUrl(k) ? ` (topic ${topicUrl(k)})` : ''}: ${placeOf(t)}, ${mindOf(t)}${t.profile !== topics.get(headKey).profile ? `, profile ${profiles.nameOf(t.profile)}` : ''}; ${stateOf(k)}${last ? `; last report: ${trunc(last, 400)}` : ''}`
        }), ...waiting.map(w => `- ${w.name}: not started, waits for ${w.after}`)].join('\n')
      },

      async stop({ agent }) {
        const k = find(agent)
        if (!k) return missing(agent)
        const l = liveOf(k)
        const was = l.busy
        handIn.drop(k, l)
        l.queue.length = 0
        if (!l.abort) flights.end(k)
        l.waitingDevice = false
        l.epoch++
        l.abort?.abort()
        await say(k, tr('🧭 The head stopped the task.', '🧭 Хед остановил задачу.'))
        return was ? `Stopping «${agent}»; its report of the cut-short turn will come here.` : `«${agent}» was not working; its queue is cleared.`
      },

      async remove({ agent }) {
        const k = find(agent)
        if (!k && sameName(topics.get(headKey).waitingAgents ?? [], agent)) {
          const gone = dropWaiting(headKey, w => w.name.toLowerCase() === agent.trim().toLowerCase())
          return `Not started, and won't be: ${gone.join(', ')}.`
        }
        if (!k) return missing(agent)
        if (live.get(k)?.busy) return `«${agent}» is working: stop_agent first.`
        const { worktree } = topics.get(k)
        const dropped = await dropWorktree(topics.get(k))
        const kept = dropped && !dropped.busy ? dropped.kept : null
        const out = await deleteTopic(k)
        if (out === 'busy') return `«${agent}» is working: stop_agent first.`
        topics.set(headKey, { workers: workersOf(headKey) })
        lastReports.delete(k)
        reportedAt.delete(k)
        const orphans = dropWaiting(headKey, w => w.after.toLowerCase() === agent.trim().toLowerCase())
        // Said outright: told nothing, Claude takes it that the folder is still there
        const branch = worktree?.branch
        const folder = kept ?? worktree?.folder
        const busy = !!dropped?.busy
        await sendRich(chatId, headTopic, tr(
          `👋 Agent **${agent}** removed: its topic and session on the server are deleted. ${kept ? `Folder kept: ${kept}.` : busy ? `Its folder is held by another program (Roblox Studio, an editor or a terminal open in it): I'll delete it once it's free. The branch \`${branch}\` stays in the repository.` : folder ? `Its folder is deleted too, the branch \`${branch}\` stays in the repository.` : 'Project files stay.'}`,
          `👋 Агент **${agent}** удалён: его топик и сессия на сервере удалены. ${kept ? `Папка осталась: ${kept}.` : busy ? `Его папку держит другая программа (Roblox Studio, редактор или терминал в ней): удалю, когда освободится. Ветка \`${branch}\` осталась в репозитории.` : folder ? `Его папка тоже удалена, ветка \`${branch}\` осталась в репозитории.` : 'Файлы проекта остались.'}`,
        ))
        return `«${agent}» removed.${orphans.length ? ` Not started and dropped, as they waited for it: ${orphans.join(', ')}.` : ''}${kept ? ` Its worktree folder stays: ${kept}` : busy ? ` Its worktree folder ${folder} is emptied but held by another program; the bot deletes it by itself once free. Files in it are gone. The branch ${branch} stays in the repository.` : folder ? ` Its worktree folder ${folder} is deleted; the branch ${branch} stays in the repository.` : ''}`
      },
    }
  }

  // Takes these and whoever waits for them off the list; returns their names
  function dropWaiting(headKey: string, gone: (w: { name: string, after: string }) => boolean) {
    let waiting = topics.get(headKey).waitingAgents ?? []
    const dropped: string[] = []
    for (let found = waiting.filter(gone); found.length; found = waiting.filter(w => found.some(f => f.name.toLowerCase() === w.after.toLowerCase()))) {
      dropped.push(...found.map(w => w.name))
      waiting = waiting.filter(w => !found.includes(w))
    }
    if (dropped.length) topics.set(headKey, { waitingAgents: waiting })
    return dropped
  }

  // An agent finished: the ones waiting for it start with its report, or don't start if it failed. Told before the head
  // reads the report, so that it doesn't start them again by hand
  function settleChain(headKey: string, finishedKey: string, finished: Topic, out: TurnOutcome, body: string) {
    const name = finished.workerName?.toLowerCase() ?? ''
    const waiting = topics.get(headKey).waitingAgents ?? []
    const next = waiting.filter(w => w.after.toLowerCase() === name)
    if (!next.length) return
    const { chatId, topicId } = parseKey(headKey)
    const tell = (en: string, ru: string, forClaude: string) => background(api.sendMessage(chatId, tr(en, ru), { ...where(topicId), ...HTML }).then(shown => {
      enqueue(chatId, topicId, forClaude, { reply: false, shownId: shown.message_id })
    }))
    if (out.note || out.stopped) {
      const dropped = dropWaiting(headKey, w => w.after.toLowerCase() === name)
      log.info('chain stopped', { head: headKey, after: name, dropped })
      return tell(
        `⛓ <b>${esc(dropped.join(', '))}</b> did not start: <b>${topicA(finishedKey, finished.workerName ?? '')}</b> didn't finish well.`,
        `⛓ <b>${esc(dropped.join(', '))}</b> не запущены: <b>${topicA(finishedKey, finished.workerName ?? '')}</b> не завершил работу нормально.`,
        `[Not started: ${dropped.join(', ')}. They were waiting for “${finished.workerName}”, which ended with: ${out.note ?? 'stopped'}. Decide what to do: start them again if it makes sense.]`,
      )
    }
    topics.set(headKey, { waitingAgents: waiting.filter(w => !next.includes(w)) })
    for (const w of next) {
      const { after: _after, ...agent } = w
      teamOf(headKey, { branch: finished.worktree?.branch }).start({
        ...agent, task: `${w.task}\n\n[Report of the agent “${finished.workerName}”, which this task waited for:]\n${trunc(body || '(no text)', 6000)}`,
      }).then(said => {
        log.info('chain goes on', { head: headKey, name: w.name, said: said.slice(0, 80) })
        if (!said.startsWith('Started')) tell(
          `⛓ <b>${esc(w.name)}</b> did not start.`,
          `⛓ <b>${esc(w.name)}</b> не запущен.`,
          `[“${w.name}”, which waited for “${finished.workerName}”, did not start: ${said}]`,
        )
      }, e => log.warn('chain', (e as Error).message))
    }
  }

  // The end of an agent's turn: the user sees it as a quote in the head's topic, the head gets it as a message
  async function reportToHead(key: string, out: TurnOutcome) {
    const t = topics.get(key)
    if (!t.head || !topics.get(t.head).workers?.includes(key)) return
    const { chatId, topicId } = parseKey(t.head)
    const body = out.text.trim()
    lastReports.set(key, body || out.note || '')
    reportedAt.set(key, Date.now())
    settleChain(t.head, key, t, out, body)
    topics.touch(t.head)
    const title = `${tr('🤖 Report from agent', '🤖 Отчёт агента')} <b>${topicA(key, t.workerName ?? '')}</b>${out.note ? ` · ${esc(out.note)}` : ''}`
    // Pictures in the report are files on the agent's computer: they go under the quote and are fetched from
    // there, as in the agent's own topic. Left in the quote, Telegram takes their paths for web addresses
    // and refuses the whole message
    const pics = findDeviceMedia(body).filter(p => !p.web)
    const said = pics.reduce((s, p) => s.replace(p.match, ''), body).replace(/\n{3,}/g, '\n\n').trim()
    const shown = await foldedMessage(chatId, topicId, title, said)
    if (shown) {
      reportOf.set(`${chatId}:${shown.message_id}`, key)
      for (const old of [...reportOf.keys()].slice(0, Math.max(0, reportOf.size - REPORTS_KEPT))) reportOf.delete(old)
    }
    if (pics.length) {
      await sendRichWithDeviceMedia(chatId, topicId, pics.map(p => p.match).join('\n\n'), { deviceId: t.deviceId!, projectId: t.projectId!, bindingVersion: t.bindingVersion })
        .catch(e => log.warn('report pictures not shown', (e as Error).message))
    }
    const report = `[Report from agent “${t.workerName}” · ${placeOf(t)}${out.note ? ` · ${out.note}` : ''}${topicUrl(key) ? ` · topic ${topicUrl(key)}` : ''}]\n${trunc(body || '(no text)', 8000)}` +
      (pics.length ? '\n[The bot has already shown the images from the report to the user, under the report.]' : '')
    // Head and workers may keep waking each other: a while without the user and the head waits for them
    const n = (teamWakes.get(t.head) ?? 0) + 1
    teamWakes.set(t.head, n)
    if (n > MAX_WAKES && !shifts.running(t.head)) {
      heldReports.set(t.head, [...(heldReports.get(t.head) ?? []), report])
      if (n === MAX_WAKES + 1) {
        await api.sendMessage(chatId, tr(`⏸ The agents sent ${MAX_WAKES} reports in a row without you, so the head is waiting. Write it anything and it goes on with the reports gathered so far.`, `⏸ Агенты прислали ${MAX_WAKES} отчётов подряд без тебя — хед ждёт. Напиши ему что-нибудь, и он продолжит с накопившимися отчётами.`), where(topicId)).catch(() => {})
      }
      return
    }
    enqueue(chatId, topicId, report, { reply: false, shownId: shown?.message_id })
  }

  // Going round in circles costs the limit and tells nobody. The head hears of it while the agent is still running
  // Said in a head's topic, and given to the head as a message that takes the place of a report
  function toHead(key: string, shown: string, forClaude: string) {
    const t = topics.get(key)
    if (!t.head || !topics.get(t.head).workers?.includes(key)) return
    const { chatId, topicId } = parseKey(t.head)
    background(api.sendMessage(chatId, shown, { ...where(topicId), ...HTML }).then(m => {
      enqueue(chatId, topicId, forClaude, { reply: false, shownId: m.message_id })
    }))
  }

  // Going round in circles costs the limit and tells nobody. An agent's head hears of it; anywhere else the user does,
  // with a way to stop it, as it needs their decision
  function stuckAgent(key: string, reason: StuckReason) {
    const t = topics.get(key)
    log.warn('task may be stuck', { key, kind: reason.kind, agent: !!t.head })
    const what = reason.kind === 'error'
      ? tr(`the same error ${reason.times} times in a row`, `одна и та же ошибка ${reason.times} раза подряд`)
      : reason.kind === 'loop'
        ? tr(`the same step ${reason.times} times in a row`, `один и тот же шаг ${reason.times} раз подряд`)
        : reason.running
          ? tr(`a command has been running for ${reason.minutes} min`, `команда идёт уже ${reason.minutes} мин`)
          : tr(`no progress for ${reason.minutes} min`, `нет прогресса уже ${reason.minutes} мин`)
    if (t.head) {
      const name = t.workerName ?? ''
      return toHead(key, tr(`🤖 Agent <b>${topicA(key, name)}</b> may be stuck: ${esc(what)}.`, `🤖 Агент <b>${topicA(key, name)}</b>, похоже, завис: ${esc(what)}.`), stuckForClaude(name, reason))
    }
    const { chatId, topicId } = parseKey(key)
    background(keepLoud(() => api.sendMessage(chatId, tr(`🔁 <b>The task may be stuck:</b> ${esc(what)}. It is still running.`, `🔁 <b>Похоже, задача застряла:</b> ${esc(what)}. Она ещё идёт.`), {
      ...where(topicId), ...HTML, reply_markup: new InlineKeyboard().text(tr('⏹ Stop it', '⏹ Остановить'), 'stk:stop'),
    })))
  }
  bot.callbackQuery('stk:stop', async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    const { running } = await haltTopic(key)
    await ctx.answerCallbackQuery(running ? tr('⏹ Stopped', '⏹ Остановлено') : tr('It has already ended', 'Уже закончилась'))
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {})
  })

  function releaseReports(key: string) {
    teamWakes.delete(key)
    const held = heldReports.get(key)
    if (!held) return
    heldReports.delete(key)
    const { chatId, topicId } = parseKey(key)
    for (const r of held) enqueue(chatId, topicId, r, { reply: false })
  }

  bot.command('team', ctx => {
    const topicId = topicOf(ctx.msg)
    const key = topicKey(ctx.chat.id, topicId)
    const t = topics.get(key)
    if (workspaces.get(ctx.chat.id)?.plain) return ctx.reply(NO_TOPICS())
    if (t.head) return sendRich(ctx.chat.id, topicId, tr(`🤖 This is the agent **${t.workerName}** · 🧠 ${mindOf(t)}. ${topicMd(t.head, 'A head in another topic')} runs it; only a regular topic can start agents.`, `🤖 Это агент **${t.workerName}** · 🧠 ${mindOf(t)}. Им управляет ${topicMd(t.head, 'хед из другого топика')}; запускать агентов может только обычный топик.`))
    const team = workersOf(key)
    const waiting = t.waitingAgents ?? []
    if (!team.length && !waiting.length) {
      return sendRich(ctx.chat.id, topicId, tr('### 🤖 No agents here yet\n\nAsk Claude to put a team together, for example:\n\n> hand this to agents: the layout on the PC, the texts in the cloud\n\n<footer>It becomes the head: starts the agents, picks a model for each, and their reports come here</footer>', '### 🤖 Агентов пока нет\n\nПопроси Claude собрать команду, например:\n\n> раздай это агентам: вёрстку на ПК, тексты в облаке\n\n<footer>Он станет хедом: сам запустит агентов, выберет каждому модель, а их отчёты будут приходить сюда</footer>'))
    }
    return sendRich(ctx.chat.id, topicId, [
      tr('### Agents', '### Агенты'),
      [tr('| Agent | Where | Model | Now |', '| Агент | Где | Модель | Сейчас |'), '|:--|:--|:--|:--|', ...team.map(k => {
        const w = topics.get(k)
        return `| 🤖 ${topicMd(k, w.workerName ?? '')} | ${placeOf(w)} | ${mindOf(w)} | ${STATE_LABEL[stateOf(k)]} |`
      }), ...waiting.map(w => `| ⏳ ${w.name} | — | — | ${tr(`waits for ${w.after}`, `ждёт ${w.after}`)} |`)].join('\n'),
      tr('The head starts agents, gives them tasks and removes them. You can look in on an agent and answer it in its topic.', 'Хед сам запускает агентов, даёт им задачи и удаляет их. Заглянуть к агенту и ответить ему можно в его топике.'),
    ].join('\n\n'))
  })

  // --- deleting topics: by /delete, or after TOPIC_TTL_DAYS of quiet with a warning a day ahead -----------
  // The topic goes from Telegram with all its messages, its conversation from the server; projects stay
  async function deleteTopic(key: string): Promise<'busy' | 'deleted' | 'kept-in-telegram'> {
    const l = live.get(key)
    if (l?.busy) return 'busy'
    const { chatId, topicId } = parseKey(key)
    const t = topics.get(key)
    if (l) {
      l.queue.length = 0
      l.epoch++
      await endPrep(l)
      live.delete(key)
    }
    continueAfterBind.delete(key)
    offers.passed(key)
    surveys.drop(key)
    if (t.sessionId) profiles.removeSession(t.sessionId, profiles.nameOf(t.profile))
    topics.remove(key)
    schedules.removeTopic(key)
    // A head goes with its workers; one still busy is only unlinked and stays
    for (const w of t.workers ?? []) {
      if (topics.get(w).head !== key) continue
      if (live.get(w)?.busy) topics.set(w, { head: undefined })
      else {
        const kept = await dropWorktree(topics.get(w)).catch(e => ({ kept: (e as Error).message, busy: false }))
        if (kept && !kept.busy) log.warn('worktree kept', { agent: w, why: kept.kept })
        await deleteTopic(w)
      }
    }
    if (!topicId) return 'deleted'
    try {
      await api.deleteForumTopic(chatId, topicId)
      log.info('topic deleted', { key })
      return 'deleted'
    } catch (e) {
      log.warn('topic kept in telegram', { key, error: (e as Error).message })
      return 'kept-in-telegram'
    }
  }

  // Telegram says a group is gone for the bot (removed from it, or the group deleted): all the server kept of it goes,
  // its topics with their sessions, its general chat, queues, schedules and the workspace, instead of being tried again
  const GONE_CHAT = /chat not found|bot was kicked|bot is not a member|group chat was deleted/i
  async function forgetGoneChat(chatId: number, why: string) {
    for (const [k] of [...topics.entries()]) if (parseKey(k).chatId === chatId) await deleteTopic(k).catch(() => {})
    dropChat(chatId)
    workspaces.remove(chatId)
    log.info('group gone from telegram, cleared', { chatId, why: why.slice(0, 120) })
  }
  // At start, once: a group the bot was taken out of while the server was down, or before this check existed
  async function sweepGoneChats() {
    const chats = new Set([...workspaces.list().map(w => w.chatId), ...[...topics.entries()].map(([k]) => parseKey(k).chatId)].filter(id => id < 0))
    for (const chatId of chats) {
      const gone = await api.getChat(chatId).then(() => null, e => (GONE_CHAT.test((e as Error).message) ? (e as Error).message : null))
      if (gone) await forgetGoneChat(chatId, gone)
    }
  }

  const deleteAsks = new Map<string, Choice>()
  bot.command('delete', async ctx => {
    const topicId = topicOf(ctx.msg)
    if (!topicId) return ctx.reply(tr("This is the general chat; it can't be deleted. Topics can: send /delete in the one you want. To clear history here: /cleanup.", 'Это общий чат, его не удалить. Удаляются топики: отправь /delete в нужном. Очистить историю здесь — /cleanup.'))
    const team = workersOf(topicKey(ctx.chat.id, topicId)).length
    const md = tr(`**Delete this topic${team ? ` and its agents (${team})` : ''}?** All messages and Claude sessions on the server will be gone. Projects and files on computers stay.`, `**Удалить этот топик${team ? ` и его агентов (${team})` : ''}?** Пропадут все сообщения и сессии Claude на сервере. Проекты и файлы на компьютерах останутся.`)
    const yes = tr('🗑 Yes, delete', '🗑 Да, удалить')
    const cancel = tr('Cancel', 'Отмена')
    const choice = await sendChoice(ctx.chat.id, topicId, md, [[{ text: yes, data: 'del:yes', style: 'danger' }, { text: cancel, data: 'del:no' }]], new InlineKeyboard().text(yes, 'del:yes').text(cancel, 'del:no'))
    if (choice) deleteAsks.set(topicKey(ctx.chat.id, topicId), choice)
    offers.open(topicKey(ctx.chat.id, topicId), 'delete', choice?.messageId)
  })

  bot.callbackQuery(/^del:(yes|no)$/, async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message as Message | undefined))
    const asked = deleteAsks.get(key)
    if (ctx.match[1] === 'no') {
      deleteAsks.delete(key)
      await ctx.answerCallbackQuery(tr('Cancelled', 'Отменено'))
      if (asked) return editRich(ctx.chat!.id, asked.messageId, `${asked.md}\n\n> ${tr('Nothing deleted.', 'Ничего не удалено.')}`)
      return ctx.editMessageText(tr('Nothing deleted.', 'Ничего не удалено.')).catch(() => {})
    }
    const out = await deleteTopic(key)
    if (out === 'busy') return ctx.answerCallbackQuery({ text: tr('A task is running here: wait for it to finish or /stop', 'Здесь идёт задача: дождись конца или /stop'), show_alert: true })
    await ctx.answerCallbackQuery(tr('Deleted', 'Удалено'))
    deleteAsks.delete(key)
    if (out === 'kept-in-telegram') {
      if (asked) return editRich(ctx.chat!.id, asked.messageId, `${asked.md}\n\n> ${tr("**The session on the server is deleted.** Telegram didn't let me delete the topic itself: delete it by hand (long-press the topic → Delete).", '**Сессия на сервере удалена.** Сам топик Telegram удалить не дал — удали его вручную: долгое нажатие на топик → Удалить.')}`)
      await ctx.editMessageText(tr("🗑 <b>The session on the server is deleted.</b> Telegram didn't let me delete the topic itself: delete it by hand (long-press the topic → Delete).", '🗑 <b>Сессия на сервере удалена.</b> Сам топик Telegram удалить не дал — удали его вручную: долгое нажатие на топик → Удалить.'), HTML).catch(() => {})
    }
  })

  // Claude's offer to delete topics: what goes is shown, and goes only at the tap. The bot knows the topics it has seen
  const deleteOffers = new Map<string, { chatId: number, keys: string[] }>()
  const projectNameOf = (t: Topic) => (t.deviceId ? gateway.device(t.deviceId)?.projects.find(p => p.id === t.projectId)?.name : undefined)
  const topicLabel = (key: string, t: Topic) => t.title ?? t.workerName ?? projectNameOf(t) ?? `#${parseKey(key).topicId}`

  async function offerDeleteTopics(key: string, p: DeleteTopics) {
    const { chatId, topicId } = parseKey(key)
    if (p.which === 'this' && !topicId) return "This is the general chat: it can't be deleted."
    const here = topics.entries().filter(([k]) => parseKey(k).chatId === chatId && parseKey(k).topicId)
    const wanted = (p.names ?? []).map(n => n.trim().toLowerCase())
    // An agent goes with its head, unless it is asked for by name
    const chosen = p.which === 'this' ? here.filter(([k]) => k === key)
      : p.which === 'all' ? here.filter(([, t]) => !t.head)
        : here.filter(([k, t]) => wanted.includes(topicLabel(k, t).toLowerCase()))
    if (!chosen.length) return `No such topics. The ones known here: ${here.map(([k, t]) => topicLabel(k, t)).join(', ') || 'none'}.`
    const id = randomBytes(4).toString('hex')
    deleteOffers.set(id, { chatId, keys: chosen.map(([k]) => k) })
    const yes = tr(`🗑 Yes, delete (${chosen.length})`, `🗑 Да, удалить (${chosen.length})`)
    const no = tr('Cancel', 'Отмена')
    const choice = await sendChoice(chatId, topicId, [
      tr(`**Delete these topics?**`, `**Удалить эти топики?**`),
      chosen.map(([k, t]) => `- ${topicMd(k, topicLabel(k, t))}`).join('\n'),
      tr('All their messages and Claude sessions on the server will be gone, agents of a head too. Projects and files on computers stay.', 'Пропадут все их сообщения и сессии Claude на сервере, вместе с агентами хеда. Проекты и файлы на компьютерах останутся.'),
    ].join('\n\n'), [[{ text: yes, data: `dlt:yes:${id}`, style: 'danger' }, { text: no, data: `dlt:no:${id}` }]], new InlineKeyboard().text(yes, `dlt:yes:${id}`).text(no, `dlt:no:${id}`))
    offers.open(key, 'delete', choice?.messageId)
    log.info('topics offered for deleting', { key, count: chosen.length })
    return "The list and the buttons are already in the chat, just above your final reply. End your turn now with one short line (do not call them \"below\"). Topics the bot hasn't seen since it started tracking names, or that it has never seen, have to be deleted by hand in Telegram: mention it only if the user's list looks short."
  }

  bot.callbackQuery(/^dlt:(yes|no):([0-9a-f]{8})$/, async ctx => {
    const offer = deleteOffers.get(ctx.match[2])
    if (!offer || offer.chatId !== ctx.chat!.id) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    deleteOffers.delete(ctx.match[2])
    await ctx.answerCallbackQuery()
    const status = (html: string) => ctx.editMessageText(html, HTML).catch(() => {})
    if (ctx.match[1] === 'no') return status(tr('Nothing deleted.', 'Ничего не удалено.'))
    await status(tr('🗑 Deleting…', '🗑 Удаляю…'))
    // Many deletions in a group take a while on Telegram's limit
    background((async () => {
      const count = { deleted: 0, busy: 0, kept: 0 }
      for (const key of offer.keys) {
        const out = await deleteTopic(key)
        count[out === 'kept-in-telegram' ? 'kept' : out === 'busy' ? 'busy' : 'deleted']++
      }
      log.info('topics deleted', { chatId: offer.chatId, ...count })
      // The message may have gone with its topic
      await status([
        tr(`🗑 <b>Deleted: ${count.deleted}.</b>`, `🗑 <b>Удалено: ${count.deleted}.</b>`),
        ...(count.busy ? [tr(`A task is running in ${count.busy}: they stay.`, `В ${count.busy} идёт задача: они остались.`)] : []),
        ...(count.kept ? [tr(`${count.kept} went from the server, but Telegram kept the topic: delete it by hand.`, `${count.kept}: сессия удалена, но Telegram оставил топик, удали его вручную.`)] : []),
      ].join('\n'))
    })())
  })

  bot.callbackQuery('ttl:keep', async ctx => {
    // The tap itself already counts as use: the topic has a fresh week
    await ctx.answerCallbackQuery(tr('Postponed', 'Отложено'))
    await ctx.editMessageText(tr(`⏳ <b>Postponed:</b> the topic stays for another ${cfg.topicTtlDays} days.`, `⏳ <b>Отложено:</b> топик останется ещё на ${cfg.topicTtlDays} дн.`), HTML).catch(() => {})
  })
  // Kept for good: no more weekly warnings. Owners only, as deleting is theirs; /delete still removes it by hand
  bot.callbackQuery(/^ttl:(pin|unpin)$/, async ctx => {
    if (!owners.has(ctx.from.id)) return ctx.answerCallbackQuery()
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    const pin = ctx.match[1] === 'pin'
    topics.set(key, { pinned: pin || undefined, warnedAt: undefined })
    log.info(pin ? 'topic kept for good' : 'topic back to deleting when quiet', { key })
    await ctx.answerCallbackQuery(pin ? tr('Kept for good', 'Не удалится') : tr('Deleted when quiet again', 'Снова удаляется сам'))
    await ctx.editMessageText(pin
      ? tr('📌 <b>The topic is kept:</b> it is never deleted for being quiet. /delete removes it by hand.', '📌 <b>Топик сохранён:</b> сам он больше не удалится. Удалить вручную — /delete.')
      : tr(`🗑 <b>The topic is deleted when quiet again:</b> after ${cfg.topicTtlDays} days without use, with a warning a day ahead.`, `🗑 <b>Топик снова удаляется сам:</b> через ${cfg.topicTtlDays} дн. без дела, с предупреждением за день.`), {
      ...HTML,
      reply_markup: pin ? new InlineKeyboard().text(tr('↩️ Delete it when quiet again', '↩️ Снова удалять, если без дела'), 'ttl:unpin') : new InlineKeyboard(),
    }).catch(() => {})
  })

  async function checkExpiry() {
    const now = Date.now()
    for (const [key, t] of topics.entries()) {
      const { chatId, topicId } = parseKey(key)
      if (!topicId || schedules.activeIn(key)) continue
      // Topics from before the clock existed get their full week from now
      if (!t.usedAt) {
        topics.set(key, { usedAt: now })
        continue
      }
      const due = expiryOf(t, now, cfg.topicTtlDays)
      if (due === 'delete') {
        const out = await deleteTopic(key)
        if (out !== 'busy') log.info('quiet topic removed', { key, out })
        continue
      }
      if (due !== 'warn') continue
      const days = Math.floor((now - t.usedAt) / (24 * 3600_000))
      try {
        await api.sendMessage(chatId, tr(`🗑 <b>The topic hasn't been used for ${days} days.</b>\nTomorrow I delete it with its Claude session, so topics don't pile up.\n<i>Projects on computers stay.</i>`, `🗑 <b>Топик не использовался ${days} дн.</b>\nЗавтра удалю его вместе с сессией Claude, чтобы топики не копились.\n<i>Проекты на компьютерах останутся.</i>`), {
          ...where(topicId), ...HTML,
          // One per row: side by side Telegram cuts the label off
          reply_markup: new InlineKeyboard().text(tr(`⏳ Postpone ${cfg.topicTtlDays} days`, `⏳ Отложить на ${cfg.topicTtlDays} дн.`), 'ttl:keep').row().text(tr('📌 Never delete it', '📌 Никогда не удалять'), 'ttl:pin').row().text(tr('🗑 Delete now', '🗑 Удалить сейчас'), 'del:yes'),
        })
        topics.set(key, { warnedAt: now })
        log.info('quiet topic warned', { key, days })
      } catch (e) {
        // Deleted in Telegram by hand, or the whole group is gone for the bot (removed from it, the group deleted):
        // nothing to warn, only the server's leftovers to clear
        const message = (e as Error).message
        if (GONE_CHAT.test(message)) await forgetGoneChat(chatId, message)
        else if (/thread not found|TOPIC_ID_INVALID|TOPIC_DELETED/i.test(message)) {
          await deleteTopic(key)
          log.info('topic gone from telegram, cleared', { key, error: message })
        } else log.warn('quiet topic warning failed', { key, error: message })
      }
    }
    // Conversations left behind by /new, a project switch or a deleted topic: on a small VPS they only pile up
    const keep = new Set(topics.entries().map(([, t]) => t.sessionId).filter((id): id is string => !!id))
    const swept = profiles.sweepSessions(keep, cfg.topicTtlDays * 24 * 3600_000, now)
    if (swept) log.info('old conversations swept', { swept })
  }
  // The server's disk running out: said once a day while it lasts. Nothing else warns before the bot can no longer
  // write its own state; the cloud's projects are on the same disk
  const serverDisk = () => (cfg.diskOf ? cfg.diskOf() : disk(cfg.dataDir))
  let diskSaidAt = 0
  function checkDisk() {
    const d = serverDisk()
    if (!diskLow(d) || Date.now() - diskSaidAt < 24 * 3600_000) return
    diskSaidAt = Date.now()
    log.warn('server disk low', { free: d!.free, total: d!.total })
    toOwners(tr(
      `💽 The server's disk is nearly full: <b>${bytes(d!.free)}</b> free of ${bytes(d!.total)}. The cloud takes no new projects until there is room. /cleanup shows what can go; /diag shows what takes it.`,
      `💽 Диск сервера почти полон: свободно <b>${bytes(d!.free)}</b> из ${bytes(d!.total)}. Облако не принимает новые проекты, пока место не появится. /cleanup покажет, что можно удалить; /diag — что занимает место.`,
    ))
  }
  const diskTimers = [setTimeout(checkDisk, 90_000).unref(), setInterval(checkDisk, 3600_000).unref()]
  const expiryTimers = cfg.topicTtlDays
    ? [setTimeout(() => checkExpiry().catch(e => log.warn('expiry', (e as Error).message)), 60_000),
      setInterval(() => checkExpiry().catch(e => log.warn('expiry', (e as Error).message)), 3600_000)]
    : []

  bot.callbackQuery('clno', async ctx => {
    await ctx.answerCallbackQuery(tr('Cancelled', 'Отменено'))
    await ctx.editMessageText(tr('Nothing deleted.', 'Ничего не удалено.')).catch(() => {})
  })

  bot.callbackQuery(/^clok:(\w+)$/, async ctx => {
    const what = ctx.match[1]
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    let done = ''
    if (what === 'tmp') {
      const n = inbox.clear()
      // The browser's screenshots in the server's temp folder; recent ones may still be on their way to Telegram
      let shots = 0
      for (const d of readdirSync(tmpdir()).filter(f => f.startsWith('claude-chrome-screenshots-'))) {
        const p = join(tmpdir(), d)
        if (Date.now() - statSync(p).mtimeMs > 3600_000) {
          rmSync(p, { recursive: true, force: true })
          shots++
        }
      }
      done = tr(`🧹 Deleted attachments: <b>${n}</b>, screenshot folders: <b>${shots}</b>.`, `🧹 Удалено вложений: <b>${n}</b>, папок скриншотов: <b>${shots}</b>.`)
    } else if (what === 'topic') {
      if (liveOf(key).busy) return ctx.answerCallbackQuery(tr('Wait for the task to finish first, or /stop', 'Сначала дождись конца задачи или /stop'))
      const t = topics.get(key)
      const removed = t.sessionId ? profiles.removeSession(t.sessionId, profiles.nameOf(t.profile)) : false
      topics.set(key, { sessionId: null })
      done = removed ? tr("🗑 <b>This topic's session is deleted</b>; a new one comes next.", '🗑 <b>Сессия этого топика удалена</b>, дальше — новая.') : tr('There was no saved session in this topic.', 'В этом топике не было сохранённой сессии.')
    } else if (what === 'all') {
      if (running) return ctx.answerCallbackQuery({ text: tr('Tasks are running: wait for them to finish, or /stop in those topics', 'Сейчас идут задачи: дождись их конца или /stop в тех топиках'), show_alert: true })
      profiles.removeAllSessions()
      for (const [k] of topics.entries()) topics.set(k, { sessionId: null })
      done = tr('🗑 <b>All sessions on the server are deleted.</b> Claude sign-ins and settings are in place.', '🗑 <b>Все сессии на сервере удалены.</b> Входы в Claude и настройки на месте.')
    } else if (what === 'logs') {
      const dir = join(cfg.dataDir, 'logs')
      for (const f of readdirSync(dir)) if (/^server-\d{4}-\d{2}-\d{2}\.log$/.test(f)) rmSync(join(dir, f), { force: true })
      writeFileSync(join(dir, 'server.log'), '')
      done = tr('📜 <b>Server logs cleared.</b>', '📜 <b>Журналы сервера очищены.</b>')
    } else return ctx.answerCallbackQuery()
    log.info('cleanup', { key, what })
    await ctx.answerCallbackQuery(tr('Done', 'Готово'))
    await ctx.editMessageText(done, HTML).catch(() => {})
  })

  bot.callbackQuery(/^show:([0-9a-f]{12})$/, async ctx => {
    const r = revealable.get(ctx.match[1])
    if (r && !await mayReveal(r.chatId)) return ctx.answerCallbackQuery({ text: tr('Others are in this group now, so the original stays hidden.', 'В группе теперь есть кто-то ещё, поэтому оригинал остаётся скрытым.'), show_alert: true })
    if (!r) return ctx.answerCallbackQuery({ text: tr('The original is no longer kept: over an hour has passed or the server restarted', 'Оригинал уже не хранится: прошло больше часа или сервер перезапускался'), show_alert: true })
    await ctx.answerCallbackQuery(tr("I'll show it and delete it in a minute", 'Покажу и удалю через минуту'))
    const whole = `${tr('_👁 Deleted in a minute_', '_👁 Удалится через минуту_')}\n\n${revealText(withoutButtons(r.md))}`
    log.info('revealed', { key: topicKey(r.chatId, r.topicId) })
    for (const md of splitMarkdown(whole)) {
      // Straight to Telegram: this one copy is the unmasked one, everything else stays masked
      const sent = await api.sendRichMessage(r.chatId, { markdown: md }, where(r.topicId))
        .catch(() => api.sendMessage(r.chatId, md, where(r.topicId)))
        .catch(e => log.warn('reveal failed', (e as Error).message))
      if (sent) setTimeout(() => api.deleteMessage(r.chatId, sent.message_id).catch(e => log.warn('reveal not deleted', (e as Error).message)), REVEAL_SHOW_MS).unref()
    }
  })

  bot.command('new', ctx => {
    const topicId = topicOf(ctx.msg)
    topics.set(topicKey(ctx.chat.id, topicId), { sessionId: null, envChanged: false })
    // The record of a turn under way would bring the old session back after a restart
    flights.session(topicKey(ctx.chat.id, topicId), null)
    // Nothing to go on with in a new conversation, and what waited behind it goes ahead
    if (pauses.dropHolding(topicKey(ctx.chat.id, topicId)) && liveOf(topicKey(ctx.chat.id, topicId)).queue.length) schedule(topicKey(ctx.chat.id, topicId))
    // Its answers would go to a conversation that never asked
    if (surveys.get(topicKey(ctx.chat.id, topicId))) {
      surveys.drop(topicKey(ctx.chat.id, topicId))
      showState(topicKey(ctx.chat.id, topicId), 'idle')
    }
    return ctx.reply(tr('🆕 <b>New session.</b> Same computer and project.', '🆕 <b>Новая сессия.</b> Компьютер и проект те же.'), { ...where(topicId), ...HTML })
  })

  // running: there was a turn or a survey, and how it ends is what the user gets to read
  async function haltTopic(key: string) {
    const l = liveOf(key)
    const paused = pauses.dropTopic(key).length
    // A running task is what /stop is about: what was put off for later stays, unless nothing else is going on
    const deferred = l.abort ? 0 : topics.get(key).deferred?.length ?? 0
    if (deferred) {
      disarm(key)
      topics.set(key, { deferred: undefined, deferredTitles: undefined })
    }
    const queued = l.queue.length + l.preparing + deferred + paused
    handIn.drop(key, l)
    l.queue.length = 0
    // Nothing runs: all a record can be now is a continuation that was waiting for its turn
    if (!l.abort) flights.end(key)
    l.waitingDevice = false
    l.epoch++
    endPrep(l)
    const waiting = slotWaiters.indexOf(key)
    if (waiting >= 0) slotWaiters.splice(waiting, 1)
    // Claude gets what was answered: the question was its own, and the user's answers are worth keeping
    const survey = surveys.get(key)
    if (survey) {
      l.abort?.abort()
      await endSurvey(key, survey, 'stopped')
      return { queued, running: true }
    }
    if (l.abort) {
      l.abort.abort()
      return { queued, running: true }
    }
    return { queued, running: false }
  }
  bot.command('stop', async ctx => {
    const topicId = topicOf(ctx.msg)
    const { queued, running } = await haltTopic(topicKey(ctx.chat.id, topicId))
    if (running) return
    return ctx.reply(queued ? tr(`⏹ Queue cleared: <b>${queued}</b>.`, `⏹ Очередь очищена: <b>${queued}</b>.`) : tr('Nothing is running right now.', 'Сейчас ничего не выполняется.'), { ...where(topicId), ...HTML })
  })

  bot.command('project', ctx => {
    // An offer passed over must not fire on this choice
    continueAfterBind.delete(topicKey(ctx.chat.id, topicOf(ctx.msg)))
    return sendPicker(ctx.chat.id, topicOf(ctx.msg))
  })

  // --- picking where a topic works: device (only when several are online) → project ------------
  const connectHelp = () => {
    const known = registry.list()
    return [
      tr('**No computer is connected right now.**', '**Ни один компьютер сейчас не подключён.**'),
      known.length ? tr(`Connected before but offline now: ${known.map(d => d.name).join(', ')}. Turn on the one you need: its agent starts with the system.`, `Подключены раньше, но сейчас не в сети: ${known.map(d => d.name).join(', ')} — включи нужный: исполнитель запускается вместе с системой.`) : '',
      tr('To connect a new computer:', 'Подключить новый компьютер:'),
      tr('send /pair: the bot gives you one line to paste on Windows or a Mac.', 'отправь /pair — бот пришлёт одну строку для Windows или Mac.'),
    ].filter(Boolean).join('\n\n')
  }

  const deviceKeyboard = () => {
    const kb = new InlineKeyboard()
    // Computers first, the cloud last: it is the fallback when they are off
    const list = gateway.devices().sort((a, b) => Number(isCloud(a.id)) - Number(isCloud(b.id)))
    for (const d of list) kb.text(`${iconOf(d)} ${d.name}`, `pd:${d.id}`).row()
    return kb.text(tr('💬 No project', '💬 Без проекта'), 'nop')
  }

  async function projectKeyboard(deviceId: string, page = 0, fresh = true) {
    // Fresh from the device when the picker opens: a folder created a minute ago is already a project.
    // Turning pages uses that same list
    const projects = fresh ? await gateway.refreshProjects(deviceId) : gateway.device(deviceId)?.projects ?? []
    const groups = groupProjects(projects)
    const pages = Math.max(1, Math.ceil(groups.length / PICKER_PAGE))
    page = Math.min(Math.max(page, 0), pages - 1)
    const kb = new InlineKeyboard()
    for (const { root, worktrees } of groups.slice(page * PICKER_PAGE, (page + 1) * PICKER_PAGE)) {
      const data = worktrees.length ? `pg:${deviceId}:${root.id}` : `b:${deviceId}:${root.id}`
      const label = worktrees.length ? `${root.name} · ${count(worktrees.length + 1, ['branch', 'branches'], ['ветка', 'ветки', 'веток'])}` : root.name
      if (Buffer.byteLength(data) <= 64) kb.text(label, data).row() // Telegram callback_data limit
    }
    const row = pageRow(page, pages)
    for (const b of row) kb.text(b.label, b.page === page ? 'noop' : `pp:${deviceId}:${b.page}`)
    if (row.length) kb.row()
    kb.text(tr('➕ New project', '➕ Новый проект'), `np:${deviceId}`)
    // With several computers “No project” sits on the computer list: next to one computer's projects it
    // would look like a mode of that computer
    if (gateway.devices().length > 1) kb.row().text(tr('← Another computer', '← Другой компьютер'), 'pdl')
    else kb.text(tr('💬 No project', '💬 Без проекта'), 'nop')
    return kb
  }

  const projectsTitle = (deviceId: string, text: string) => {
    const d = gateway.device(deviceId)
    return d ? `<b>${osIcon(d)} ${esc(d.name)}</b> — ${text}` : text
  }

  const nameQuestion = (deviceId: string) => `${projectsTitle(deviceId, tr('what should the new project be called?', 'как назвать новый проект?'))}\n${tr('Write the name as your next message: it becomes the folder name.', 'Напиши название следующим сообщением — это будет имя папки.')}`

  async function sendPicker(chatId: number, topicId?: number, intro = '') {
    liveOf(topicKey(chatId, topicId)).pickerAt = Date.now()
    const online = gateway.devices()
    if (!online.length) return sendRich(chatId, topicId, connectHelp(), { reply_markup: new InlineKeyboard().text(tr('💬 No project', '💬 Без проекта'), 'nop') })
    const lead = intro ? `${esc(intro)}\n` : ''
    // One computer, or the one its workspace works on: nothing to choose between, straight to its projects
    const preferred = online.find(d => d.id === workspaces.get(chatId)?.deviceId) ?? (online.length === 1 ? online[0] : undefined)
    if (preferred) {
      return api.sendMessage(chatId, lead + projectsTitle(preferred.id, tr('choose a project:', 'выбери проект:')), { ...where(topicId), ...HTML, reply_markup: await projectKeyboard(preferred.id) })
    }
    return api.sendMessage(chatId, `${lead}<b>${tr('Choose a computer:', 'Выбери компьютер:')}</b>`, { ...where(topicId), ...HTML, reply_markup: deviceKeyboard() })
  }

  bot.callbackQuery(/^pd:([\w-]+)$/, async ctx => {
    const deviceId = ctx.match[1]
    if (!gateway.device(deviceId)) return ctx.answerCallbackQuery(tr('This computer is offline now', 'Этот компьютер уже не в сети'))
    await ctx.answerCallbackQuery()
    await ctx.editMessageText(projectsTitle(deviceId, tr('choose a project:', 'выбери проект:')), { ...HTML, reply_markup: await projectKeyboard(deviceId) })
  })

  // One repository's folders: the main one and its worktrees, each a project of its own to bind to
  bot.callbackQuery(/^pg:([\w-]+):(.+?)(?::(\d+))?$/, async ctx => {
    const [, deviceId, rootId, wanted] = ctx.match
    const projects = gateway.device(deviceId)?.projects
    if (!projects) return ctx.answerCallbackQuery(tr('This computer is offline now', 'Этот компьютер уже не в сети'))
    const group = groupProjects(projects).find(g => g.root.id === rootId)
    if (!group) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    await ctx.answerCallbackQuery()
    const kb = new InlineKeyboard()
    const all = [group.root, ...group.worktrees]
    const pages = Math.ceil(all.length / PICKER_PAGE)
    const page = Math.min(Number(wanted ?? 0), pages - 1)
    for (const p of all.slice(page * PICKER_PAGE, (page + 1) * PICKER_PAGE)) {
      const data = `b:${deviceId}:${p.id}`
      if (Buffer.byteLength(data) <= 64) kb.text(p.branch && p.branch !== p.name ? `${p.name} · ${p.branch}` : p.name, data).row()
    }
    const row = pageRow(page, pages)
    for (const b of row) kb.text(b.label, b.page === page ? 'noop' : `pg:${deviceId}:${rootId}:${b.page}`)
    if (row.length) kb.row()
    kb.text(tr('← Back', '← Назад'), `pp:${deviceId}:0`)
    await ctx.editMessageReplyMarkup({ reply_markup: kb }).catch(() => {})
  })

  bot.callbackQuery(/^pp:([\w-]+):(\d+)$/, async ctx => {
    const deviceId = ctx.match[1]
    if (!gateway.device(deviceId)) return ctx.answerCallbackQuery(tr('This computer is offline now', 'Этот компьютер уже не в сети'))
    await ctx.answerCallbackQuery()
    await ctx.editMessageReplyMarkup({ reply_markup: await projectKeyboard(deviceId, Number(ctx.match[2]), false) }).catch(() => {})
  })

  bot.callbackQuery('pdl', async ctx => {
    await ctx.answerCallbackQuery()
    await ctx.editMessageText(`<b>${tr('Choose a computer:', 'Выбери компьютер:')}</b>`, { ...HTML, reply_markup: deviceKeyboard() })
  })

  // New project: the next text message in the topic is its name, not a task
  bot.callbackQuery(/^np:([\w-]+)$/, async ctx => {
    const deviceId = ctx.match[1]
    if (!gateway.device(deviceId)) return ctx.answerCallbackQuery(tr('This computer is offline now', 'Этот компьютер уже не в сети'))
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    liveOf(key).newProjectOn = deviceId
    await ctx.answerCallbackQuery()
    await ctx.editMessageText(nameQuestion(deviceId), HTML)
  })

  async function createProject(key: string, deviceId: string, name: string) {
    const { chatId, topicId } = parseKey(key)
    const l = liveOf(key)
    const out = await gateway.request(deviceId, { projectId: '', bindingVersion: 0, tool: 'create_project', params: { name } })
    if (!out.ok) {
      // Ask again: the next message is still the name
      l.newProjectOn = deviceId
      return api.sendMessage(chatId, tr(`⚠️ <b>Folder not created:</b> ${esc(out.error.message)}\nWrite another name.`, `⚠️ <b>Папка не создана:</b> ${esc(out.error.message)}\nНапиши другое название.`), { ...where(topicId), ...HTML }).catch(() => {})
    }
    const project = out.result as Project
    await gateway.refreshProjects(deviceId)
    const t = topics.bind(key, deviceId, project.id)
    log.info('project created', { key, device: deviceId, project: project.id })
    const dev = gateway.device(deviceId)
    await sendRich(chatId, topicId, boundMarkdown(dev, project, t, deviceId, tr('📁 A new project folder', '📁 Новая папка проекта'))).catch(() => {})
    if (!continueTask(key, deviceId, project) && l.queue.length) processQueue(key)
  }

  // --- devices: pairing and revoking (§8.2) -------------------------------------------------------
  // One line per system: it installs Node and the agent from this server, pairs the computer and turns autostart
  // on. A checkout of the code (a developer's) pairs with the old command
  function sendPairCode(chatId: number, topicId?: number) {
    const { code, ttlMin } = pairing.create(chatId, topicId)
    const lines = installLines(cfg.publicUrl, code)
    return sendRich(chatId, topicId, [
      tr('### Connect a computer', '### Подключить компьютер'),
      tr(`Copy the line for your system, paste it and press Enter. The code inside works once, for ${ttlMin} minutes.`, `Скопируй строку для своей системы, вставь и нажми Enter. Код внутри — один раз, ${ttlMin} минут.`),
      tr('**Windows**: in PowerShell (Start → PowerShell):', '**Windows** — в PowerShell (Пуск → PowerShell):'),
      '```powershell\n' + lines.windows + '\n```',
      tr('**Mac or Linux**: in Terminal:', '**Mac или Linux** — в Терминале:'),
      '```bash\n' + lines.macos + '\n```',
      tr('No admin rights needed. A message shows up here once the computer is connected.', 'Права администратора не нужны. Когда компьютер подключится, здесь появится сообщение.'),
      tr(`_From a code checkout: \`npm run agent -- pair ${code} --server ${cfg.publicUrl}\`._`, `_Из папки с кодом: \`npm run agent -- pair ${code} --server ${cfg.publicUrl}\`._`),
    ].join('\n\n'), { reply_markup: new InlineKeyboard().copyText(tr('📋 Line for Windows', '📋 Строка для Windows'), lines.windows).row().copyText(tr('📋 Line for Mac or Linux', '📋 Строка для Mac и Linux'), lines.macos) })
  }

  bot.command('pair', ctx => sendPairCode(ctx.chat.id, topicOf(ctx.msg)))
  bot.callbackQuery('pairnew', async ctx => {
    await ctx.answerCallbackQuery()
    await sendPairCode(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
  })

  gateway.events.on('paired', async d => {
    // Not signed in to Claude yet (a fresh install): the sign-in is next, and now it can open on this computer
    const signedIn = (await profiles.status(profiles.defaultName).catch(() => ({ loggedIn: true }))).loggedIn
    const next = signedIn ? '' : tr('\n\nNext: sign in to Claude. The sign-in window opens on this computer and goes through the server.', '\n\nДальше: войди в Claude — окно входа откроется на этом компьютере и пойдёт через сервер.')
    api.sendMessage(d.chatId, tr(`🔗 Connected <b>${osIcon(d)} ${esc(d.name)}</b> (id <code>${d.id}</code>). Its projects are in /project.${next}`, `🔗 Подключён <b>${osIcon(d)} ${esc(d.name)}</b> (id <code>${d.id}</code>). Его проекты — в /project.${next}`), {
      ...where(d.topicId), ...HTML,
      ...(!signedIn && { reply_markup: new InlineKeyboard().text(tr('🔑 Sign in to Claude', '🔑 Войти в Claude'), `lg:${profiles.defaultName}`) }),
    }).catch(() => {})
  })

  const ago = (t?: number) => {
    if (!t) return ''
    const min = Math.round((Date.now() - t) / 60_000)
    return min < 60 ? tr(`${min} min ago`, `${min} мин назад`) : min < 48 * 60 ? tr(`${Math.round(min / 60)} h ago`, `${Math.round(min / 60)} ч назад`) : tr(`${Math.round(min / 1440)} days ago`, `${Math.round(min / 1440)} дн назад`)
  }

  // Working folders: from /devices, and offered once a newly paired computer is online
  createZonesMenu({ bot, gateway, log })
  // The speech model, offered with the first voice message or round video that needs it
  const speech = createSpeechSetup({ bot, media, log })

  // A list of computers, and a card for the one tapped: five actions on each of several computers don't fit a phone
  const deviceState = (r: { id: string, os?: keyof typeof OS_ICON, lastSeen?: number }) => {
    const d = gateway.device(r.id)
    if (d?.locked) return tr('🔒 locked: only someone at the computer can unlock it', '🔒 заблокирован: снять можно только за самим компьютером')
    return d ? tr(`🟢 online · ${groupProjects(d.projects).length} projects`, `🟢 в сети · проектов ${groupProjects(d.projects).length}`) : `${tr('⚪ offline', '⚪ не в сети')}${r.lastSeen ? ` · ${ago(r.lastSeen)}` : ''}`
  }
  const onlineLabel = (d: Device | undefined) => (d?.locked ? tr('🔒 locked', '🔒 заблокирован') : d ? tr('🟢 online', '🟢 в сети') : '')
  function devicesList() {
    const known = registry.list()
    const rows: RichButton[][] = known.map(r => [{
      text: `${iconOf({ id: r.id, os: gateway.device(r.id)?.os ?? r.os })} ${gateway.device(r.id)?.name ?? r.name} · ${onlineLabel(gateway.device(r.id)) || tr('⚪ offline', '⚪ не в сети')}`,
      data: `dv:${r.id}`,
    }])
    rows.push([{ text: tr('➕ Connect a computer', '➕ Подключить компьютер'), data: 'pairnew' }])
    // Where there is room now: the computers that are online, each with what it has and how busy it is
    const now = gateway.devices().filter(d => capacityText(d)).map(d => `- ${iconOf(d)} **${mdText(d.name)}:** ${capacityText(d)}`)
    return { md: `### ${tr('💻 Computers', '💻 Компьютеры')}${known.length ? '' : `\n\n${tr('No computers yet.', 'Пока ни одного компьютера.')}`}${now.length ? `\n\n${now.join('\n')}` : ''}`, rows }
  }
  function deviceCard(id: string) {
    const r = registry.list().find(x => x.id === id)
    if (!r) return null
    const d = gateway.device(id)
    const note = isCloud(id) ? tr(' · on the server', ' · на сервере') : r.legacy ? tr(' · key from .env', ' · ключ из .env') : ''
    const awake = d && !isCloud(id) && d.keepAwake !== undefined ? d.keepAwake : undefined
    const others = d && !isCloud(id) ? gateway.devices().filter(x => x.id !== id && !isCloud(x.id)) : []
    const actions: RichButton[] = [
      ...(d && !isCloud(id) ? [{ text: tr('📁 Folders', '📁 Папки'), data: `zo:${id}` }] : []),
      ...(!isCloud(id) ? [{ text: tr('✏️ Name', '✏️ Имя'), data: `rn:${id}` }] : []),
    ]
    const own = registry.profileOf(id)
    const many = profiles.list().length > 1
    return {
      md: `### ${osIcon({ id, os: d?.os ?? r.os })} ${mdText(d?.name ?? r.name)}\n\n${deviceState(r)}${d?.release ? ` · v${d.release}` : ''}${note}${d && capacityText(d) ? `\n\n${capacityText(d)}` : ''}${own ? `\n\n${tr(`Claude profile: **${mdText(own)}**`, `Профиль Claude: **${mdText(own)}**`)}` : ''}\n\nid: \`${id}\``,
      rows: [
        ...(actions.length ? [actions] : []),
        ...(many || own ? [[{ text: tr(`🧠 Claude profile: ${own ?? 'as the topics'}`, `🧠 Профиль Claude: ${own ?? 'как у топиков'}`), data: `dvp:${id}` }]] : []),
        ...others.map(x => [{ text: tr(`📦 Settings to ${x.name}`, `📦 Настройки на ${x.name}`), data: `stm:${id}:${x.id}` }]),
        ...(awake !== undefined ? [[{ text: awake ? tr('☕ Stays awake during tasks: on', '☕ Не засыпать во время задач: вкл') : tr('💤 Stays awake during tasks: off', '💤 Не засыпать во время задач: выкл'), data: `kaw:${awake ? 'off' : 'on'}:${id}` }]] : []),
        ...(!r.legacy && !isCloud(id) ? [[{ text: tr('🔌 Unlink', '🔌 Отвязать'), data: `rv:${id}` }]] : []),
        [{ text: tr('← All computers', '← Все компьютеры'), data: 'dvs' }],
      ] as RichButton[][],
    }
  }
  const keyboardOf = (rows: RichButton[][]) => goKeyboard(rows)
  const drawDevices = (ctx: Context, view: { md: string, rows: RichButton[][] }) => {
    const id = ctx.callbackQuery?.message?.message_id
    return id ? editRich(ctx.chat!.id, id, `${view.md}\n\n${richButtons(view.rows)}`) : false
  }

  bot.command('devices', ctx => {
    const { md, rows } = devicesList()
    return sendChoice(ctx.chat.id, topicOf(ctx.msg), md, rows, keyboardOf(rows))
  })
  bot.callbackQuery('dvs', async ctx => {
    await ctx.answerCallbackQuery()
    await drawDevices(ctx, devicesList())
  })
  // --- settings from one computer offered to another: each thing on its own tap, keys never ------------------
  const settingsOf = async (id: string) => {
    const out = await gateway.request(id, { projectId: '', bindingVersion: 0, tool: 'settings', params: {} })
    return out.ok ? out.result as PortableSettings : out.error.message
  }
  async function drawMove(ctx: Context, from: string, to: string) {
    const [a, b] = await Promise.all([settingsOf(from), settingsOf(to)])
    if (typeof a === 'string' || typeof b === 'string') return ctx.answerCallbackQuery({ text: (typeof a === 'string' ? a : b as string).slice(0, 190), show_alert: true })
    await ctx.answerCallbackQuery()
    const { md, rows } = moveCard(from, to, { from: gateway.device(from)?.name ?? from, to: gateway.device(to)?.name ?? to }, a, b)
    await drawDevices(ctx, { md, rows })
  }
  bot.callbackQuery(/^stm:([\w-]+):([\w-]+)$/, ctx => drawMove(ctx, ctx.match[1], ctx.match[2]))
  bot.callbackQuery(/^stma:([\w-]+):([\w-]+):([\w-]+)$/, async ctx => {
    const [, from, to, name] = ctx.match
    const a = await settingsOf(from)
    const server = typeof a === 'string' ? undefined : a.mcp.find(s => s.name === name)
    if (!server) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    // The same checks as when Claude adds one: an exact version, nothing to run past them
    const out = await gateway.request(to, { projectId: '', bindingVersion: 0, tool: 'add_mcp_server', params: { name, command: server.command, args: server.args, env: {} } })
    log.info('mcp moved', { from, to, name, ok: out.ok })
    if (!out.ok) return ctx.answerCallbackQuery({ text: out.error.message.slice(0, 190), show_alert: true })
    await ctx.answerCallbackQuery(server.env.length ? tr(`Added. Its keys are not moved: ${server.env.join(', ')}`, `Добавлен. Ключи не перенесены: ${server.env.join(', ')}`).slice(0, 190) : tr('Added', 'Добавлен'))
    await drawMove(ctx, from, to).catch(() => {})
  })
  bot.callbackQuery(/^stmr:([\w-]+):([\w-]+)$/, async ctx => {
    const [, from, to] = ctx.match
    const a = await settingsOf(from)
    if (typeof a === 'string' || !a.rules) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    const out = await gateway.request(to, { projectId: '', bindingVersion: 0, tool: 'settings', params: { rules: a.rules } })
    log.info('instructions moved', { from, to, ok: out.ok })
    if (!out.ok) return ctx.answerCallbackQuery({ text: out.error.message.slice(0, 190), show_alert: true })
    await drawMove(ctx, from, to).catch(() => {})
  })

  // The screen still goes dark: only sleep is held off, and only while something runs and a few minutes after
  bot.callbackQuery(/^kaw:(on|off):([\w-]+)$/, async ctx => {
    const id = ctx.match[2]
    const out = await gateway.request(id, { projectId: '', bindingVersion: 0, tool: 'keep_awake', params: { on: ctx.match[1] === 'on' } })
    if (!out.ok) return ctx.answerCallbackQuery({ text: out.error.message.slice(0, 190), show_alert: true })
    const dev = gateway.device(id)
    if (dev) dev.keepAwake = (out.result as { on: boolean }).on
    log.info('keep awake', { id, on: dev?.keepAwake })
    await ctx.answerCallbackQuery(dev?.keepAwake ? tr('☕ Stays awake while a task runs', '☕ Не уснёт, пока идёт задача') : tr('💤 Sleeps as usual', '💤 Засыпает как обычно'))
    const card = deviceCard(id)
    if (card) await drawDevices(ctx, card)
  })
  // A computer's Claude profile: its topics run on it, except those that picked their own
  bot.callbackQuery(/^dvp:([\w-]+)$/, async ctx => {
    const id = ctx.match[1]
    if (!registry.list().some(r => r.id === id)) return ctx.answerCallbackQuery(tr('Already unlinked', 'Уже отвязан'))
    await ctx.answerCallbackQuery()
    const names = profiles.list()
    const st = await Promise.all(names.map(n => profiles.status(n).catch(() => ({ loggedIn: false }))))
    const own = registry.profileOf(id)
    const rows: RichButton[][] = [
      ...names.map((n, i) => [{ text: `${n === own ? '✅ ' : ''}${n}${st[i].loggedIn ? '' : tr(' · not signed in', ' · вход не выполнен')}`, data: st[i].loggedIn ? `dvps:${id}:${n}` : 'noop' }]),
      [{ text: `${own ? '' : '✅ '}${tr('None of its own', 'Без своего')}`, data: `dvps:${id}:-` }],
      [{ text: tr('← Back', '← Назад'), data: `dv:${id}` }],
    ]
    await drawDevices(ctx, {
      md: [
        tr(`### 🧠 Claude profile of ${mdText(deviceName(id))}`, `### 🧠 Профиль Claude для ${mdText(deviceName(id))}`),
        tr('Its topics run on it, from their next message, the conversation carried over; a topic that picked its own in /profile keeps it. Sign Chrome\'s Claude extension on it in to the same account.', 'Его топики работают на нём со следующего сообщения, переписка переносится; топик, где профиль выбран в /profile, остаётся на своём. Расширение Claude в Chrome на этом компьютере войди в тот же аккаунт.'),
      ].join('\n\n'),
      rows,
    })
  })
  bot.callbackQuery(/^dvps:([\w-]+):([\w-]+)$/, async ctx => {
    const [, id, pick] = ctx.match
    const name = pick === '-' ? undefined : pick
    if (name && !profiles.list().includes(name)) return ctx.answerCallbackQuery(tr('That profile is gone', 'Такого профиля больше нет'))
    if (!registry.setProfile(id, name)) return ctx.answerCallbackQuery(tr('Already unlinked', 'Уже отвязан'))
    log.info('computer profile', { id, profile: name ?? null })
    await ctx.answerCallbackQuery(name ?? tr('None of its own', 'Без своего'))
    const card = deviceCard(id)
    if (card) await drawDevices(ctx, card)
  })

  bot.callbackQuery(/^dv:([\w-]+)$/, async ctx => {
    const card = deviceCard(ctx.match[1])
    if (!card) return ctx.answerCallbackQuery(tr('Already unlinked', 'Уже отвязан'))
    await ctx.answerCallbackQuery()
    await drawDevices(ctx, card)
  })

  // The next message in this topic is the new name. Everywhere it shows it follows; the id, which topics hold, stays
  const RENAME_WAIT_MS = 10 * 60_000
  const renames = new Map<string, { id: string, at: number }>()
  bot.callbackQuery(/^rn:([\w-]+)$/, async ctx => {
    const rec = registry.list().find(r => r.id === ctx.match[1])
    if (!rec || isCloud(rec.id)) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    const topicId = topicOf(ctx.callbackQuery.message as Message | undefined)
    renames.set(topicKey(ctx.chat!.id, topicId), { id: rec.id, at: Date.now() })
    await ctx.answerCallbackQuery()
    await api.sendMessage(ctx.chat!.id, tr(`✏️ What should <b>${esc(rec.name)}</b> be called? Send the name as your next message, or /devices to cancel.`, `✏️ Как назвать <b>${esc(rec.name)}</b>? Отправь имя следующим сообщением, для отмены — /devices.`), { ...where(topicId), ...HTML })
  })
  // True when the message was the name, or told what is wrong with it
  async function takeComputerName(chatId: number, topicId: number | undefined, text: string) {
    const key = topicKey(chatId, topicId)
    const wait = renames.get(key)
    if (!wait) return false
    if (Date.now() - wait.at > RENAME_WAIT_MS || /^\/\w/.test(text)) {
      renames.delete(key)
      return false
    }
    const name = text.trim()
    const problem = computerNameProblem(name, registry.list().filter(r => r.id !== wait.id))
    if (problem) {
      await api.sendMessage(chatId, problem === 'taken'
        ? tr('Another computer has this name: Claude tells them apart by it. Send another.', 'Такое имя уже есть у другого компьютера, а Claude различает их по имени. Отправь другое.')
        : tr('Up to 40 characters: letters, digits, spaces and . _ \' -, starting with a letter or digit. Send another, or /devices to cancel.', 'До 40 символов: буквы, цифры, пробелы и . _ \' -, в начале буква или цифра. Отправь другое, для отмены — /devices.'), where(topicId))
      return true
    }
    renames.delete(key)
    const ok = gateway.rename(wait.id, name)
    await api.sendMessage(chatId, ok
      ? tr(`✅ Now it's <b>${esc(name)}</b>.`, `✅ Теперь это <b>${esc(name)}</b>.`)
      : tr('This computer is no longer linked.', 'Этот компьютер уже отвязан.'), { ...where(topicId), ...HTML })
    return true
  }

  // Two taps: revoking cuts the computer off at once and its topics wait until it is paired again
  bot.callbackQuery(/^rv:([\w-]+)$/, async ctx => {
    const rec = registry.list().find(r => r.id === ctx.match[1])
    if (!rec) return ctx.answerCallbackQuery(tr('Already unlinked', 'Уже отвязан'))
    await ctx.answerCallbackQuery()
    await drawDevices(ctx, {
      md: tr(`**Unlink ${mdText(rec.name)}?** Its key stops working at once, and its topics wait until it is connected again. Nothing on the computer is deleted.`, `**Отвязать ${mdText(rec.name)}?** Его ключ сразу перестанет работать, а его топики будут ждать нового подключения. На самом компьютере ничего не удалится.`),
      rows: [[{ text: tr('🔌 Yes, unlink', '🔌 Да, отвязать'), data: `rvok:${rec.id}`, style: 'danger' }, { text: tr('Cancel', 'Отмена'), data: `dv:${rec.id}` }]],
    })
  })
  bot.callbackQuery(/^rvok:([\w-]+)$/, async ctx => {
    const ok = gateway.revoke(ctx.match[1])
    // New topics of a workspace would bind to it and wait for ever
    for (const w of workspaces.list()) if (w.deviceId === ctx.match[1]) workspaces.update(w.chatId, { deviceId: undefined, projectId: undefined })
    await ctx.answerCallbackQuery(ok ? tr('Unlinked', 'Отвязано') : tr('Already unlinked', 'Уже отвязан'))
    await drawDevices(ctx, devicesList())
  })

  // --- GitHub for the cloud: the access a computer already has, or the official CLI's device flow ---------
  const cloudOp = (tool: OpTool, params: Record<string, unknown> = {}) => gateway.request(CLOUD_DEVICE_ID, { projectId: '', bindingVersion: 0, tool, params })
  const githubDone = (login: string, how = '') =>
    tr(`✅ <b>GitHub connected to the cloud: @${esc(login)}</b>${how}. The cloud can clone and push your repositories: just ask Claude.`, `✅ <b>GitHub подключён к облаку: @${esc(login)}</b>${how}. Облако может клонировать и пушить твои репозитории — просто попроси Claude.`)
  let githubWatch = false
  // Bumped when the cloud signs in another way: a code still waiting on github.com no longer matters
  let githubEpoch = 0

  // Git runs on the topic's computer with that computer's own sign-in, wherever the server is: one table of
  // who is signed in, and buttons for the one place the bot signs in itself, the cloud
  async function githubFlow(chatId: number, topicId?: number) {
    const online = gateway.devices().sort((a, b) => Number(isCloud(a.id)) - Number(isCloud(b.id)))
    const states = await Promise.all(online.map(async d => {
      const st = await gateway.request(d.id, { projectId: '', bindingVersion: 0, tool: 'github_status', params: {} })
      return { d, s: st.ok ? st.result as GitHubStatus : null }
    }))
    const label = (s: GitHubStatus | null) =>
      !s ? tr('no answer', 'не ответил') : s.login ? `✅ @${s.login}` : s.installed ? tr('⚪ not connected', '⚪ не подключён') : tr('⚪ no GitHub CLI', '⚪ нет GitHub CLI')
    const rows = [
      ...states.map(({ d, s }) => `| ${osIcon(d)} ${d.name} | ${label(s)} |`),
      ...registry.list().filter(r => !online.some(d => d.id === r.id)).map(r => `| ${osIcon({ id: r.id, os: r.os })} ${r.name} | ${tr('offline', 'не в сети')} |`),
    ]
    const cloud = states.find(x => isCloud(x.d.id))?.s
    // Where the access can be taken from: signed in with gh, or without gh at all (git may still keep it)
    const sources = states.filter(({ d, s }) => !isCloud(d.id) && s && (s.login || !s.installed)).map(x => x.d)
    const bare = states.filter(({ d, s }) => !isCloud(d.id) && s?.installed && !s.login).map(x => x.d.name)
    const parts = [
      '### GitHub',
      [tr('| Where | Sign-in |', '| Где | Вход |'), '|:--|:--|', ...rows].join('\n'),
      tr("Git runs on the project's computer with that computer's sign-in: Claude clones, commits and pushes when you ask. The server, on a PC or a VPS, plays no part here.", 'Git работает на компьютере проекта и с его входом: Claude клонирует, коммитит и пушит, когда попросишь. Сервер — хоть на ПК, хоть на VPS — тут ни при чём.'),
      bare.length ? tr(`**Not connected:** ${bare.join(', ')}. Sign in there once: \`gh auth login\`.`, `**Не подключён:** ${bare.join(', ')} — войди там один раз: \`gh auth login\`.`) : '',
    ]
    if (!cloud) return sendRich(chatId, topicId, parts.filter(Boolean).join('\n\n'))
    if (!cloud.installed) return sendRich(chatId, topicId, [...parts, tr('The cloud has no GitHub CLI: update the server (`bash deploy/install-server.sh`).', 'В облаке нет GitHub CLI: обнови сервер (`bash deploy/install-server.sh`).')].filter(Boolean).join('\n\n'))
    // Signed in or not, the same ways in: taking the access again or another account replaces the current one
    const kb = new InlineKeyboard()
    for (const d of sources) kb.text(`${iconOf(d)} ${cloud.login ? tr('Cloud: sign in again', 'Облаку заново') : tr('Cloud', 'Облаку')} ${tr('with the sign-in from', 'вход с')} ${d.name}`, `ghc:${d.id}`).row()
    kb.text(cloud.login ? tr('🔑 Cloud by code (another account)', '🔑 Облаку по коду (другой аккаунт)') : tr('🔑 Cloud by code', '🔑 Облаку по коду'), 'ghcode')
    if (cloud.login) kb.row().text(tr('🚪 Disconnect GitHub in the cloud', '🚪 Отключить GitHub в облаке'), 'ghout')
    parts.push(cloud.login
      ? tr('**The cloud** reconnects with the buttons below: take the sign-in again, or sign in by code with another account.', '**Облако** переподключается кнопками ниже: взять вход заново или войти по коду под другим аккаунтом.')
      : [
        tr('**The cloud** is a separate computer with no sign-in of its own.', '**Облако** — отдельный компьютер, своего входа у него нет.'),
        sources.length
          ? tr("Simplest: take the sign-in from a computer that has one. One button, no browser; it goes through the server, not Telegram.", 'Проще всего — взять вход с компьютера, где он есть: одна кнопка, без браузера, доступ идёт через сервер, не через Telegram.')
          : tr("Turn on a computer where you're signed in to GitHub and I'll take the sign-in from there.", 'Включи компьютер, где ты вошёл в GitHub, — возьму вход оттуда.'),
        tr("Or by code: you enter it on github.com in a browser where you're signed in to GitHub.", 'Или по коду: вводишь его на github.com в браузере, где ты вошёл в GitHub.'),
      ].join(' '))
    await sendRich(chatId, topicId, parts.filter(Boolean).join('\n\n'), { reply_markup: kb })
  }

  bot.callbackQuery(/^ghc:([\w-]+)$/, async ctx => {
    const from = gateway.device(ctx.match[1])
    if (!from || isCloud(from.id)) return ctx.answerCallbackQuery(tr('This computer is offline now', 'Этот компьютер уже не в сети'))
    if (!gateway.device(CLOUD_DEVICE_ID)) return ctx.answerCallbackQuery(tr('The cloud is offline', 'Облако не в сети'))
    await ctx.answerCallbackQuery()
    const status = (html: string) => ctx.editMessageText(html, HTML).catch(() => {})
    await status(tr(`⏳ Taking the GitHub sign-in from <b>${esc(from.name)}</b>…`, `⏳ Беру вход в GitHub с <b>${esc(from.name)}</b>…`))
    const got = await gateway.request(from.id, { projectId: '', bindingVersion: 0, tool: 'github_token', params: {} })
    if (!got.ok) {
      return status(got.error.code === 'not_found'
        ? tr(`⚠️ <b>${esc(from.name)} isn't signed in to GitHub.</b> Sign in there (<code>gh auth login</code>) or connect the cloud by code: /github`, `⚠️ <b>На ${esc(from.name)} нет входа в GitHub.</b> Войди там (<code>gh auth login</code>) или подключи облако по коду: /github`)
        : tr(`⚠️ <b>Couldn't take the sign-in from ${esc(from.name)}:</b> ${esc(got.error.message)}`, `⚠️ <b>Не получилось взять вход с ${esc(from.name)}:</b> ${esc(got.error.message)}`))
    }
    const put = await cloudOp('github_import', { token: (got.result as GitHubToken).token })
    if (!put.ok) return status(tr(`⚠️ <b>The cloud didn't accept the sign-in:</b> ${esc(put.error.message)}\nConnect by code: /github`, `⚠️ <b>Облако не приняло вход:</b> ${esc(put.error.message)}\nПодключи по коду: /github`))
    const s = put.result as GitHubStatus
    githubEpoch++
    log.info('github signed in', { login: s.login, from: from.id })
    await status(s.login ? githubDone(s.login, tr(`, signed in with the sign-in from ${esc(from.name)}`, ` — вход взят с ${esc(from.name)}`)) : tr("⚠️ The sign-in was handed over, but GitHub didn't confirm it. Try by code: /github", '⚠️ Вход передан, но GitHub его не подтвердил. Попробуй по коду: /github'))
  })

  bot.callbackQuery('ghout', async ctx => {
    await ctx.answerCallbackQuery()
    const out = await cloudOp('github_logout')
    githubEpoch++
    log.info('github signed out', { ok: out.ok })
    await ctx.editMessageText(out.ok
      ? tr('🚪 <b>GitHub is disconnected from the cloud.</b> To connect again: /github', '🚪 <b>GitHub отключён от облака.</b> Подключить снова — /github')
      : tr(`⚠️ <b>Couldn't disconnect:</b> ${esc(out.error.message)}`, `⚠️ <b>Не получилось отключить:</b> ${esc(out.error.message)}`), HTML).catch(() => {})
  })

  bot.callbackQuery('ghcode', async ctx => {
    await ctx.answerCallbackQuery()
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {})
    const chatId = ctx.chat!.id
    const topicId = topicOf(ctx.callbackQuery.message)
    const out = await cloudOp('github_login')
    if (!out.ok) return api.sendMessage(chatId, `⚠️ <b>GitHub:</b> ${esc(out.error.message)}`, { ...where(topicId), ...HTML }).catch(() => {})
    const { code, url } = out.result as GitHubLogin
    log.info('github login started', { chatId })
    // The code goes to the clipboard with a button: inline code in the text is not always tap-to-copy
    await sendRich(chatId, topicId, [
      tr('### GitHub sign-in by code', '### Вход в GitHub по коду'),
      `${tr('Code', 'Код')}: **${code}**`,
      tr('1. Press “📋 Copy the code”.', '1. Нажми «📋 Скопировать код».'),
      tr('2. Press “Open GitHub”, paste the code and press **Authorize**.', '2. Нажми «Открыть GitHub», вставь код и нажми **Authorize**.'),
      '',
      tr("If GitHub asks you to sign in first, do (Apple, Google or a passkey works too), then paste the code. The code works for 15 minutes. I'll write when the sign-in is done.", 'Если GitHub сначала попросит войти — войди (можно через Apple, Google или ключ доступа), потом вставь код. Код действует 15 минут. Напишу, когда вход завершится.'),
    ].join('\n'), { reply_markup: new InlineKeyboard().copyText(tr(`📋 Copy the code ${code}`, `📋 Скопировать код ${code}`), code).row().url(tr('Open GitHub', 'Открыть GitHub'), url) })
    watchGitHub(chatId, topicId)
  })

  // The user finishes on github.com; the cloud is asked every few seconds until then or until the code expires
  async function watchGitHub(chatId: number, topicId?: number) {
    if (githubWatch) return
    githubWatch = true
    const epoch = githubEpoch
    try {
      for (const end = Date.now() + 16 * 60_000; Date.now() < end && epoch === githubEpoch;) {
        await new Promise(r => setTimeout(r, 5000))
        const st = await cloudOp('github_status')
        if (!st.ok || epoch !== githubEpoch) continue
        const s = st.result as GitHubStatus
        if (s.login) {
          log.info('github signed in', { login: s.login })
          return await api.sendMessage(chatId, githubDone(s.login), { ...where(topicId), ...HTML })
        }
        if (!s.pending) return await api.sendMessage(chatId, tr("⌛ <b>The GitHub sign-in didn't finish:</b> the code expired or the sign-in was cancelled. Again: /github", '⌛ <b>Вход в GitHub не завершился:</b> код истёк или вход отменён. Ещё раз — /github'), { ...where(topicId), ...HTML })
      }
    } catch (e) {
      log.warn('github watch', (e as Error).message)
    } finally {
      githubWatch = false
    }
  }

  bot.command('github', ctx => githubFlow(ctx.chat.id, topicOf(ctx.msg)))

  // --- the user's own Chrome through the server: a Chrome policy on the computer, switched from here --------
  // Sites see the server's address instead of the home one, and every sign-in in that Chrome stays as it was
  const proxyOp = (id: string, action: 'on' | 'off' | 'status') =>
    gateway.request(id, { projectId: '', bindingVersion: 0, tool: 'browser_proxy', params: { action } })

  async function proxyStates() {
    const online = gateway.devices().filter(d => !isCloud(d.id))
    return Promise.all(online.map(async d => {
      const st = await proxyOp(d.id, 'status')
      return { d, s: st.ok ? st.result as BrowserProxyState : null }
    }))
  }

  const proxyKeyboard = (states: Awaited<ReturnType<typeof proxyStates>>) => {
    const kb = new InlineKeyboard()
    for (const { d, s } of states.filter(x => x.s?.supported)) {
      kb.text(s!.on ? tr(`Turn off on ${d.name}`, `Выключить на ${d.name}`) : tr(`Turn on on ${d.name}`, `Включить на ${d.name}`), `bpx:${s!.on ? 'off' : 'on'}:${d.id}`).row()
    }
    return kb
  }

  bot.command('proxy', ctx => showProxy(ctx.chat.id, topicOf(ctx.msg)))

  async function showProxy(chatId: number, topicId: number | undefined) {
    const states = await proxyStates()
    const online = states.map(x => x.d.id)
    const way = (on: boolean) => on ? tr('🟢 through the server', '🟢 через сервер') : tr('⚪ direct', '⚪ напрямую')
    const label = (s: BrowserProxyState | null) =>
      !s ? tr('no answer', 'не ответил') : !s.supported ? (s.why ?? tr('not supported', 'не поддерживается')) : s.pending ? tr(`${way(s.on)} after Chrome restarts`, `${way(s.on)} после перезапуска Chrome`) : way(s.on)
    const rows = [
      ...states.map(({ d, s }) => `| ${osIcon(d)} ${d.name} | ${label(s)} |`),
      ...registry.list().filter(r => !isCloud(r.id) && !online.includes(r.id)).map(r => `| ${osIcon({ id: r.id, os: r.os })} ${r.name} | ${tr('offline', 'не в сети')} |`),
    ]
    await sendRich(chatId, topicId, [
      tr('### Chrome through the server', '### Chrome через сервер'),
      rows.length ? [tr('| Computer | Chrome |', '| Компьютер | Chrome |'), '|:--|:--|', ...rows].join('\n') : tr('No computers yet: /pair', 'Компьютеров пока нет: /pair'),
      tr('When on, your usual Chrome with all its sign-ins goes online through the server: sites see the server\'s address, not yours.', 'Когда включено, твой обычный Chrome со всеми входами ходит в интернет через сервер: сайты видят адрес сервера, а не твой.'),
      states.some(x => x.s?.supported && !x.s.relaunch) ? tr('**Windows:** restart Chrome yourself after switching.', '**Windows:** после переключения перезапусти Chrome сам.') : '',
      states.some(x => x.s?.supported && x.s.relaunch)
        ? tr("**Mac:** the bot restarts Chrome itself and the tabs come back. A Chrome opened later from the Dock goes direct: the bot sees that and asks before working in Chrome.", '**Mac:** бот перезапускает Chrome сам, вкладки возвращаются. Открытый потом из Dock Chrome ходит напрямую — бот это видит и спросит перед работой в Chrome.')
        : '',
      tr('While on, Chrome opens sites only while the agent and the server are running. You can also turn it off on the computer itself: `npm run agent -- chrome-proxy off`.', 'Пока включено, Chrome открывает сайты, только когда работают исполнитель и сервер. Выключить можно и на самом компьютере: `npm run agent -- chrome-proxy off`.'),
    ].filter(Boolean).join('\n\n'), { reply_markup: proxyKeyboard(states) })
  }

  // --- signing in to Claude from the chat -----------------------------------------------------------------
  // The CLI's own sign-in runs on the server: the link goes to the chat, the code comes back as the next message
  // and is deleted from the chat at once; it reaches only the CLI, never Claude or the log. Before the link: is
  // there a Chrome that goes through the server, so claude.ai sees the server's address rather than the home one
  type LoginWait = { run: LoginRun, profile: string, timer: NodeJS.Timeout }
  const loginWaits = new Map<string, LoginWait>() // topic key → the sign-in waiting for its code
  const LOGIN_WAIT_MS = 10 * 60_000

  function loginKeyboard(names: string[], signedIn: boolean[]) {
    const kb = new InlineKeyboard()
    names.forEach((n, i) => kb.text(signedIn[i] ? tr(`🔄 Sign in again: ${n}`, `🔄 Войти заново: ${n}`) : tr(`🔑 Sign in to Claude: ${n}`, `🔑 Войти в Claude: ${n}`), `lg:${n}`).row())
    return kb
  }

  const endLogin = (key: string) => {
    const w = loginWaits.get(key)
    if (!w) return
    loginWaits.delete(key)
    clearTimeout(w.timer)
    w.run.cancel()
  }

  bot.callbackQuery(/^lg(go)?:([\w-]+)$/, async ctx => {
    const [, go, name] = ctx.match
    if (!profiles.list().includes(name)) return ctx.answerCallbackQuery(tr('No such profile', 'Такого профиля нет'))
    await ctx.answerCallbackQuery()
    const chatId = ctx.chat!.id
    const topicId = topicOf(ctx.callbackQuery.message)
    // Nothing connected yet (right after installing the server): the window that goes through the server opens on
    // a computer, so connecting one comes first. A recommendation, never a wall
    if (!go && !gateway.devices().some(d => !isCloud(d.id))) {
      return sendRich(chatId, topicId, [tr('### Claude sign-in', '### Вход в Claude'),
        tr('While signing in, claude.ai sees the address the sign-in page is opened from; the account then works from the server\'s address.', 'При входе claude.ai увидит адрес, с которого открыта страница входа, а работать аккаунт будет с адреса сервера.'),
        tr("I recommend connecting a computer first: then the bot opens the sign-in on it, in a window that goes through the server, and claude.ai sees the server's address, not yours.", 'Рекомендую сначала подключить компьютер: тогда бот откроет вход на нём в окне, которое ходит через сервер, и claude.ai увидит адрес сервера, а не твой.'),
      ].join('\n\n'), { reply_markup: new InlineKeyboard().text(tr('🔗 Connect a computer', '🔗 Подключить компьютер'), 'pairnew').row().text(tr('Sign in anyway', 'Всё равно войти'), `lggo:${name}`) })
    }
    return beginLogin(chatId, topicId, name)
  })
  bot.callbackQuery('lgx', async ctx => {
    endLogin(topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message)))
    await ctx.answerCallbackQuery(tr('Sign-in cancelled', 'Вход отменён'))
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(tr('Cancelled', 'Отменено'), 'noop') }).catch(() => {})
  })

  async function beginLogin(chatId: number, topicId: number | undefined, name: string) {
    const key = topicKey(chatId, topicId)
    endLogin(key)
    let run: LoginRun
    try {
      run = await startLogin({ dir: profiles.dir(name), env: profiles.env(name), timeoutMs: LOGIN_WAIT_MS })
    } catch (e) {
      return api.sendMessage(chatId, tr(`⚠️ <b>The Claude sign-in didn't start:</b> ${esc((e as Error).message)}`, `⚠️ <b>Вход в Claude не запустился:</b> ${esc((e as Error).message)}`), { ...where(topicId), ...HTML }).catch(() => {})
    }
    const timer = setTimeout(() => {
      if (loginWaits.get(key)?.run !== run) return
      endLogin(key)
      api.sendMessage(chatId, tr("⌛ <b>The Claude sign-in didn't finish within 10 minutes.</b> Again: /profiles", '⌛ <b>Вход в Claude не завершён за 10 минут.</b> Ещё раз — /profiles'), { ...where(topicId), ...HTML }).catch(() => {})
    }, LOGIN_WAIT_MS)
    loginWaits.set(key, { run, profile: name, timer })
    const computers = gateway.devices().filter(d => !isCloud(d.id))
    log.info('claude login started', { profile: name, computers: computers.length })
    // No link button: Telegram would open it in the default browser, which goes straight. The window that goes
    // through the server is opened by the computer itself; the link is there as text for when that can't be done
    const kb = new InlineKeyboard()
    for (const d of computers) kb.text(tr(`🖥 Open sign-in on ${d.name}`, `🖥 Открыть вход на ${d.name}`), `lgw:${d.id}`).row()
    kb.text(tr('Cancel', 'Отмена'), 'lgx')
    await sendRich(chatId, topicId, [
      tr(`### Claude sign-in: profile ${name}`, `### Вход в Claude: профиль ${name}`),
      computers.length
        ? tr(`1. Press “🖥 Open sign-in on ${computers[0].name}”: a browser window opens on the computer and goes through the server, so claude.ai sees the server's address, not yours.`, `1. Нажми «🖥 Открыть вход на ${computers[0].name}»: на компьютере откроется окно браузера, которое ходит через сервер, — claude.ai увидит адрес сервера, а не твой.`)
        : tr('1. There are no computers, so open the link below yourself. The sign-in comes from the address where you open it.', '1. Компьютеров нет, поэтому открой ссылку ниже сам. Вход пойдёт с адреса, где ты её откроешь.'),
      tr('2. Sign in and press **Authorize**.', '2. Войди и нажми **Authorize**.'),
      tr("3. Copy the code with the **Copy Code** button and send it here as your next message. I'll remove it from the chat right away.", '3. Скопируй код кнопкой **Copy Code** и пришли его сюда следующим сообщением — я сразу уберу его из чата.'),
      '',
      tr('The code works for a few minutes.', 'Код действует несколько минут.'),
      '',
      computers.length
        ? tr("_If the window didn't open, here is the link. Paste it into a browser that goes through the server: in a regular one the sign-in comes from your address. Don't tap it in Telegram: that opens the default browser._", '_Если окно не открылось — вот ссылка. Вставь её в браузер, который ходит через сервер: в обычном вход пойдёт с твоего адреса. Не нажимай на неё в Telegram — откроется браузер по умолчанию._')
        : tr('_Copy it and paste it into the address bar of a browser; tapping it in Telegram opens the default browser._', '_Скопируй и вставь в адресную строку браузера; нажатие в Telegram откроет браузер по умолчанию._'),
      '```text\n' + run.url + '\n```',
    ].join('\n'), { reply_markup: kb })
  }

  // The window for the sign-in, opened on a computer: only Claude's sign-in page, and only the one this topic waits for
  bot.callbackQuery(/^lgw:([\w-]+)$/, async ctx => {
    const w = loginWaits.get(topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message)))
    if (!w) return ctx.answerCallbackQuery(tr('This sign-in is over: start again with /profiles', 'Вход уже закончен: начни заново — /profiles'))
    const d = gateway.device(ctx.match[1])
    if (!d) return ctx.answerCallbackQuery(tr('This computer is offline', 'Этот компьютер не в сети'))
    await ctx.answerCallbackQuery(tr(`Opening on ${d.name}…`, `Открываю на ${d.name}…`))
    const out = await gateway.request(d.id, { projectId: '', bindingVersion: 0, tool: 'open_login', params: { url: w.run.url } })
    log.info('claude login window', { device: d.id, ok: out.ok })
    await api.sendMessage(ctx.chat!.id, out.ok
      ? tr(`🖥 The sign-in window is open on <b>${esc(d.name)}</b> in ${loginBrowser(out.result)}, through the server. Sign in, press Authorize and send the code here.`, `🖥 Окно входа открыто на <b>${esc(d.name)}</b> в ${loginBrowser(out.result)}, через сервер. Войди, нажми Authorize и пришли код сюда.`)
      : tr(`⚠️ <b>Didn't open on ${esc(d.name)}:</b> ${esc(out.error.message)}. You can take the link from the message above.`, `⚠️ <b>Не открылось на ${esc(d.name)}:</b> ${esc(out.error.message)}. Можно взять ссылку из сообщения выше.`),
    { ...where(topicOf(ctx.callbackQuery.message)), ...HTML }).catch(() => {})
  })

  // --- signing in to a remote MCP server (Figma), from /tools ------------------------------------------------
  type McpWait = { run: McpLoginRun, name: string, timer: NodeJS.Timeout }
  const mcpWaits = new Map<string, McpWait>()

  async function finishMcpLogin(key: string, redirect: string) {
    const w = mcpWaits.get(key)
    if (!w) return
    mcpWaits.delete(key)
    clearTimeout(w.timer)
    const { chatId, topicId } = parseKey(key)
    const r = await w.run.submit(redirect)
    log.info('mcp login', { name: w.name, ok: r.ok })
    await api.sendMessage(chatId, r.ok
      ? tr(`✅ <b>${esc(w.name)} is connected.</b> It works from your next message.`, `✅ <b>${esc(w.name)} подключена.</b> Заработает со следующего сообщения.`)
      : tr(`⚠️ <b>${esc(w.name)}: not connected:</b> ${esc(r.message)}. Try again: /tools.`, `⚠️ <b>${esc(w.name)}: не подключено:</b> ${esc(r.message)}. Попробуй ещё раз: /tools.`),
    { ...where(topicId), ...HTML }).catch(() => {})
  }

  bot.callbackQuery(/^mcl:([\w-]+)$/, async ctx => {
    const name = ctx.match[1]
    const topicId = topicOf(ctx.callbackQuery.message)
    const key = topicKey(ctx.chat!.id, topicId)
    if (!(name in cfg.remoteMcp)) return ctx.answerCallbackQuery()
    await ctx.answerCallbackQuery(tr('Starting the sign-in…', 'Запускаю вход…'))
    const old = mcpWaits.get(key)
    if (old) {
      clearTimeout(old.timer)
      old.run.cancel()
      mcpWaits.delete(key)
    }
    const profile = topics.get(key).profile
    let run: McpLoginRun
    try {
      run = await startMcpLogin({ dir: profiles.dir(profile), name, url: cfg.remoteMcp[name], env: profiles.env(profile) })
    } catch (e) {
      log.warn('mcp login did not start', (e as Error).message)
      return sendRich(ctx.chat!.id, topicId, tr(`⚠️ The sign-in to ${name} didn't start: ${(e as Error).message}`, `⚠️ Вход в ${name} не запустился: ${(e as Error).message}`))
    }
    const timer = setTimeout(() => {
      if (mcpWaits.get(key)?.run !== run) return
      mcpWaits.delete(key)
      run.cancel()
    }, 10 * 60_000)
    mcpWaits.set(key, { run, name, timer })
    const computers = gateway.devices().filter(d => !isCloud(d.id))
    const kb = new InlineKeyboard()
    for (const d of computers) kb.text(tr(`🖥 Open on ${d.name}`, `🖥 Открыть на ${d.name}`), `mcw:${d.id}`).row()
    await sendRich(ctx.chat!.id, topicId, [
      tr(`### 🔑 Sign in to ${name}`, `### 🔑 Вход в ${name}`),
      computers.length
        ? tr('Press the button: the page opens on the computer and goes through the server. Sign in if asked and press **Allow access**, and that is all.', 'Нажми кнопку: страница откроется на компьютере и пойдёт через сервер. Если попросит, войди и нажми **Allow access**. Больше ничего не нужно.')
        : tr('⚠️ No computer is online, so the sign-in can\'t go through the server by itself. Open the link below yourself: the service will see the address of that browser.', '⚠️ Компьютеров в сети нет, поэтому вход не пойдёт через сервер сам. Открой ссылку ниже: сервис увидит адрес этого браузера.'),
      tr('_Opening it yourself? Only a browser that goes through the server hides your address. After **Allow access** the page shows a connection error on localhost: that is fine. Copy the address from the browser and send it here, I\'ll remove it from the chat._', '_Открываешь сам? Твой адрес скрыт только в браузере, который идёт через сервер. После **Allow access** страница покажет ошибку соединения на localhost, это нормально. Скопируй адрес из браузера и пришли сюда, я сразу уберу его из чата._'),
      '```text\n' + run.url + '\n```',
    ].join('\n\n'), { reply_markup: kb })
  })

  bot.callbackQuery(/^mcw:([\w-]+)$/, async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    const w = mcpWaits.get(key)
    if (!w) return ctx.answerCallbackQuery(tr('This sign-in is over: start again with /tools', 'Вход уже закончен: начни заново — /tools'))
    const d = gateway.device(ctx.match[1])
    if (!d) return ctx.answerCallbackQuery(tr('This computer is offline', 'Этот компьютер не в сети'))
    await ctx.answerCallbackQuery(tr(`Opening on ${d.name}…`, `Открываю на ${d.name}…`))
    const { port } = w.run
    // The computer catches the way back: first the listener, then the window that will come to it
    gateway.request(d.id, { projectId: '', bindingVersion: 0, tool: 'login_callback', params: { port } }).then(out => {
      const path = out.ok ? (out.result as { path: string | null }).path : null
      if (!out.ok) log.warn('login callback', out.error.message)
      if (path && mcpWaits.get(key) === w) return finishMcpLogin(key, `http://localhost:${port}${path}`)
    }).catch(e => log.warn('login callback', (e as Error).message))
    await new Promise(r => setTimeout(r, 500))
    const out = await gateway.request(d.id, { projectId: '', bindingVersion: 0, tool: 'open_login', params: { url: w.run.url } })
    log.info('mcp login window', { device: d.id, ok: out.ok })
    await api.sendMessage(ctx.chat!.id, out.ok
      ? tr(`🖥 The window is open on <b>${esc(d.name)}</b> in ${loginBrowser(out.result)}, through the server. Press <b>Allow access</b> there.`, `🖥 Окно открыто на <b>${esc(d.name)}</b> в ${loginBrowser(out.result)}, через сервер. Нажми там <b>Allow access</b>.`)
      : tr(`⚠️ <b>Didn't open on ${esc(d.name)}:</b> ${esc(out.error.message)}. You can take the link from the message above.`, `⚠️ <b>Не открылось на ${esc(d.name)}:</b> ${esc(out.error.message)}. Ссылку можно взять из сообщения выше.`),
    { ...where(topicOf(ctx.callbackQuery.message)), ...HTML }).catch(() => {})
  })

  // The next text in the topic is the code: straight to the CLI, out of the chat
  async function takeLoginCode(chatId: number, topicId: number | undefined, messageId: number, code: string) {
    const key = topicKey(chatId, topicId)
    const w = loginWaits.get(key)!
    loginWaits.delete(key)
    clearTimeout(w.timer)
    await api.deleteMessage(chatId, messageId).catch(() => {})
    const msg = await api.sendMessage(chatId, tr('⏳ Checking the code…', '⏳ Проверяю код…'), where(topicId)).catch(() => null)
    const r = await w.run.submit(code)
    log.info('claude login', { profile: w.profile, ok: r.ok })
    profiles.forget(w.profile)
    const st = r.ok ? await profiles.status(w.profile) : null
    const text = r.ok
      ? `${tr('✅ <b>Claude connected:</b> profile', '✅ <b>Claude подключён:</b> профиль')} ${esc(w.profile)}${st?.plan ? ` · ${esc(planLabel(st.plan))}` : ''}${st?.email ? ` · ${esc(maskEmail(st.email))}` : ''}`
      : tr(`⚠️ <b>Sign-in failed:</b> ${esc(r.message)}`, `⚠️ <b>Вход не удался:</b> ${esc(r.message)}`)
    const extra = { ...HTML, ...(r.ok ? {} : { reply_markup: new InlineKeyboard().text(tr('🔁 Try again', '🔁 Ещё раз'), `lggo:${w.profile}`) }) }
    if (msg) await api.editMessageText(chatId, msg.message_id, text, extra).catch(() => {})
    else await api.sendMessage(chatId, text, { ...where(topicId), ...extra }).catch(() => {})
  }

  // «Off» takes two taps: whoever holds the chat could otherwise show sites the home address with one.
  // On a Mac both ways restart Chrome, so «on» asks too while Chrome is open
  bot.callbackQuery(/^bpx:(on|off|onok|offok|back):([\w-]+)$/, async ctx => {
    const [, action, id] = ctx.match
    const d = gateway.device(id)
    if (!d || isCloud(id)) return ctx.answerCallbackQuery(tr('This computer is offline now', 'Этот компьютер уже не в сети'))
    if (action === 'on' || action === 'off') {
      const st = await proxyOp(id, 'status')
      const cur = st.ok ? st.result as BrowserProxyState : null
      const restart = !!cur?.relaunch && !!cur.running
      if (action === 'on' && !restart) return proxySwitch(ctx, d, 'on')
      await ctx.answerCallbackQuery(restart ? { text: tr("Chrome closes and opens again with the same tabs; whatever isn't saved in the tabs is lost.", 'Chrome закроется и откроется с теми же вкладками; несохранённое во вкладках пропадёт.'), show_alert: true } : undefined)
      const yes = restart ? tr(`🔄 Yes, restart Chrome on ${d.name}`, `🔄 Да, перезапустить Chrome на ${d.name}`) : tr(`✅ Yes, turn off on ${d.name}`, `✅ Да, выключить на ${d.name}`)
      return ctx.editMessageReplyMarkup({
        reply_markup: new InlineKeyboard().text(yes, `bpx:${action}ok:${id}`).row().text(tr('Cancel', 'Отмена'), `bpx:back:${id}`),
      }).catch(() => {})
    }
    if (action === 'back') {
      await ctx.answerCallbackQuery()
      return ctx.editMessageReplyMarkup({ reply_markup: proxyKeyboard(await proxyStates()) }).catch(() => {})
    }
    return proxySwitch(ctx, d, action === 'onok' ? 'on' : 'off')
  })

  async function proxySwitch(ctx: Context & { callbackQuery: NonNullable<Context['callbackQuery']> }, d: { id: string, name: string }, action: 'on' | 'off') {
    await ctx.answerCallbackQuery()
    const out = await proxyOp(d.id, action)
    log.info('browser proxy', { device: d.id, action, ok: out.ok })
    await ctx.editMessageReplyMarkup({ reply_markup: proxyKeyboard(await proxyStates()) }).catch(() => {})
    const s = out.ok ? out.result as BrowserProxyState : null
    await api.sendMessage(ctx.chat!.id, !s
      ? tr(`⚠️ <b>Didn't work on ${esc(d.name)}:</b> ${esc(out.ok ? '' : out.error.message)}`, `⚠️ <b>Не получилось на ${esc(d.name)}:</b> ${esc(out.ok ? '' : out.error.message)}`)
      : (s.on
        ? tr(`🟢 <b>Chrome on ${esc(d.name)} goes through the server.</b> Sign-ins stay. To check: api.ipify.org shows the server's address.`, `🟢 <b>Chrome на ${esc(d.name)} — через сервер.</b> Входы останутся. Проверить: api.ipify.org покажет адрес сервера.`)
        : tr(`⚪ <b>Chrome on ${esc(d.name)} goes direct.</b> Sites see your address again.`, `⚪ <b>Chrome на ${esc(d.name)} — напрямую.</b> Сайты снова видят твой адрес.`))
        + (s.relaunch && s.running ? tr('\nChrome restarted, the tabs are back.', '\nChrome перезапущен, вкладки вернулись.') : '')
        + (s.pending ? tr("\nChrome hasn't restarted since the switch: close all its windows and open it again.", '\nChrome ещё не перезапущен после переключения: закрой все его окна и открой снова.') : ''),
    { ...where(topicOf(ctx.callbackQuery.message)), ...HTML }).catch(() => {})
  }

  // --- before Claude's first step in Chrome in a task: which way that Chrome goes is the user's call ---------
  // Windows: Chrome reads the policy at start (and rechecks it now and then), so after a switch which way it
  // goes is known only once it has restarted: “Done” checks that. A Mac restarts Chrome itself, after a yes
  const routeAsks = new Map<number, (choice: string) => void>()
  bot.callbackQuery(/^bpr:(\d+):(server|direct|asis|done|cancel)$/, async ctx => {
    const answer = routeAsks.get(Number(ctx.match[1]))
    await ctx.answerCallbackQuery(answer ? undefined : tr('This question is closed', 'Вопрос уже закрыт'))
    answer?.(ctx.match[2])
  })

  // night: a night shift, with nobody to ask. Chrome goes through the server then, as the user asked for nights: a
  // Mac's is restarted that way with its tabs; one that can't, goes unused rather than show the user's own address
  async function nightRoute(chatId: number, topicId: number | undefined, dev: { id: string, name: string }, s: BrowserProxyState | null): Promise<true | string> {
    const say = (html: string) => background(api.sendMessage(chatId, html, { ...where(topicId), ...HTML, disable_notification: true }).catch(() => {}))
    const name = esc(dev.name)
    const without = (why: string) => {
      say(tr(`🌐 <b>Chrome on ${name} stays unused tonight:</b> ${esc(why)}.`, `🌐 <b>Chrome на ${name} этой ночью не используется:</b> ${esc(why)}.`))
      log.info('browser proxy', { device: dev.id, night: true, used: false, why })
      return `Chrome on ${dev.name} can't go through the server tonight (${why}), and nobody is there to allow going direct: don't use Chrome in this task, and say so in your summary.`
    }
    if (!s) return without(tr("couldn't find out how it goes online", 'не удалось узнать, как он ходит в интернет'))
    if (!s.supported) return without(s.why ?? tr('it can\'t go through the server', 'через сервер он не умеет'))
    // On Windows the switch waits for a restart only the user does
    if (!s.relaunch && (!s.on || s.pending)) return without(tr('it has to be restarted by hand to go through the server', 'чтобы пойти через сервер, его нужно перезапустить вручную'))
    if (!s.on || s.pending) {
      const out = await proxyOp(dev.id, 'on')
      log.info('browser proxy', { device: dev.id, action: 'on', ok: out.ok, from: 'night' })
      if (!out.ok) return without(out.error.message)
      const now = out.result as BrowserProxyState
      if (now.pending || !now.on) return without(tr("it didn't switch", 'он не переключился'))
    }
    say(tr(`🌐 Night shift: Chrome on <b>${name}</b> restarted through the server, with its tabs.`, `🌐 Ночная смена: Chrome на <b>${name}</b> перезапущен через сервер, вкладки на месте.`))
    return true
  }

  async function chromeRoute(chatId: number, topicId: number | undefined, dev: { id: string, name: string }, signal: AbortSignal, night = false): Promise<true | string> {
    const got = await proxyOp(dev.id, 'status')
    let s = got.ok ? got.result as BrowserProxyState : null
    if (surelyThroughServer(s)) return true
    if (night) return nightRoute(chatId, topicId, dev, s)
    const id = permSeq++
    const name = esc(dev.name)
    let msgId: number | undefined
    const show = async (html: string, kb = new InlineKeyboard()) => {
      if (msgId === undefined) msgId = (await api.sendMessage(chatId, html, { ...where(topicId), ...HTML, reply_markup: kb })).message_id
      else await api.editMessageText(chatId, msgId, html, { ...HTML, reply_markup: kb }).catch(() => {})
    }
    const answer = () => new Promise<string>(resolve => {
      const finish = (c: string) => {
        clearTimeout(timer)
        routeAsks.delete(id)
        offers.close(topicKey(chatId, topicId), 'route')
        signal.removeEventListener('abort', onAbort)
        resolve(c)
      }
      const onAbort = () => finish('abort')
      const timer = setTimeout(() => finish('timeout'), PERMISSION_TIMEOUT_MS)
      routeAsks.set(id, finish)
      offers.open(topicKey(chatId, topicId), 'route', msgId)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) finish('abort')
    })
    const refuse = async (c: string) => {
      if (c === 'abort') {
        await show(tr('⏹ <b>Stopped.</b>', '⏹ <b>Остановлено.</b>'))
        return 'Stopped by the user.'
      }
      if (c === 'timeout') {
        await show(tr('⌛ <b>No answer about Chrome</b>: this task goes without the browser.', '⌛ <b>Нет ответа про Chrome</b> — в этой задаче без браузера.'))
        return "The user didn't answer within 30 minutes how Chrome goes online: Chrome is not used in this task."
      }
        await show(tr('🚫 <b>No Chrome</b> in this task.', '🚫 <b>Без Chrome</b> в этой задаче.'))
      return "The user chose not to open Chrome in this task. Don't call Chrome tools until the task ends; if it can't be done without a browser, say so."
    }
    const head = tr(`🌐 <b>Claude wants to work in Chrome on ${name}.</b>`, `🌐 <b>Claude хочет работать в Chrome на ${name}.</b>`)
    try {
      notifyHead(topicKey(chatId, topicId), tr('is waiting for your answer about Chrome', 'ждёт твоего ответа про Chrome'))
      // Unknown, or no way through the server here (another system, a company policy): a warning all the same
      if (!s || !s.supported) {
        await show(!s
          ? `${head}\n${tr("Couldn't find out how this Chrome goes online: through the server or direct.", 'Не получилось узнать, как этот Chrome ходит в интернет: через сервер или напрямую.')}`
          : `${head}\n${tr(`Going through the server isn't possible here (${esc(s.why ?? 'not supported')}): sites will see your address.`, `Через сервер здесь нельзя (${esc(s.why ?? 'не поддерживается')}): сайты увидят твой адрес.`)}`,
        new InlineKeyboard().text(s ? tr('⚪ Continue direct', '⚪ Продолжить напрямую') : tr('Continue as is', 'Продолжить как есть'), `bpr:${id}:asis`).row().text(tr('Cancel', 'Отмена'), `bpr:${id}:cancel`))
        const c = await answer()
        if (c !== 'asis') return await refuse(c)
        await show(`🌐 <b>Chrome ${tr('on', 'на')} ${name}</b> — ${s ? tr('⚪ direct', '⚪ напрямую') : tr('as is', 'как есть')}.`)
        return true
      }
      // Switched and not restarted since: either way is possible, so either answer takes a restart
      const now = s.pending ? null : s.on
      await show(now === null
        ? `${head}\n${tr("Chrome was switched but hasn't restarted since, so how it goes online now is unknown. Choose, and I'll ask to restart it.", 'Chrome переключали, но с тех пор не перезапускали — неизвестно, как он ходит сейчас. Выбери, и я попрошу его перезапустить.')}`
        : `${head}\n${tr('Right now it goes', 'Сейчас он ходит')} ${now ? tr("<b>through the server</b>: sites see the server's address.", '<b>через сервер</b>: сайты видят адрес сервера.') : tr('<b>direct</b>: sites will see your address.', '<b>напрямую</b>: сайты увидят твой адрес.')}`,
      new InlineKeyboard()
        .text(now === null ? tr('🟢 Through the server', '🟢 Через сервер') : now ? tr('🟢 Through the server (as now)', '🟢 Через сервер (как сейчас)') : tr('🟢 Switch to the server', '🟢 Переключить через сервер'), `bpr:${id}:server`).row()
        .text(now === null ? tr('⚪ Direct', '⚪ Напрямую') : now ? tr('⚪ Switch to direct', '⚪ Переключить напрямую') : tr('⚪ Direct (as now)', '⚪ Напрямую (как сейчас)'), `bpr:${id}:direct`).row()
        .text(tr('Cancel', 'Отмена'), `bpr:${id}:cancel`))
      const c = await answer()
      if (c !== 'server' && c !== 'direct') return await refuse(c)
      const want = c === 'server'
      const label = want ? tr('🟢 through the server', '🟢 через сервер') : tr('⚪ direct', '⚪ напрямую')
      // A Mac restarts Chrome itself: closing the user's open browser takes a yes
      if (s.on !== want && s.relaunch && s.running) {
        await show(tr(`🔄 <b>I'll restart Chrome on ${name} ${want ? 'through the server' : 'direct'}.</b>\nIt closes and opens again with the same tabs; whatever isn't saved in the tabs (unfinished forms) is lost.`, `🔄 <b>Перезапущу Chrome на ${name} ${want ? 'через сервер' : 'напрямую'}.</b>\nОн закроется и откроется с теми же вкладками; то, что не сохранено во вкладках (недописанные формы), пропадёт.`),
          new InlineKeyboard().text(tr('🔄 Restart', '🔄 Перезапустить'), `bpr:${id}:done`).row().text(tr('Cancel', 'Отмена'), `bpr:${id}:cancel`))
        const r = await answer()
        if (r !== 'done') return await refuse(r)
        await show(tr(`⏳ Restarting Chrome on ${name}…`, `⏳ Перезапускаю Chrome на ${name}…`))
      }
      if (s.on !== want) {
        const out = await proxyOp(dev.id, want ? 'on' : 'off')
        log.info('browser proxy', { device: dev.id, action: want ? 'on' : 'off', ok: out.ok, from: 'chrome' })
        if (!out.ok) {
          await show(tr(`⚠️ <b>Couldn't switch Chrome on ${name}:</b> ${esc(out.error.message)}`, `⚠️ <b>Не получилось переключить Chrome на ${name}:</b> ${esc(out.error.message)}`))
          return `Couldn't switch how Chrome goes online (${out.error.message}). Don't use Chrome in this task, and tell the user.`
        }
        s = out.result as BrowserProxyState
        if (!s.pending && s.on !== want) {
          await show(tr(`⚠️ <b>Chrome on ${name} didn't switch.</b>`, `⚠️ <b>Chrome на ${name} не переключился.</b>`))
          return "Chrome didn't switch the way the user asked. Don't use Chrome in this task, and tell the user."
        }
      }
      for (let tries = 0; s.pending; tries++) {
        await show(tries
          ? tr(`⏳ <b>Chrome on ${name} hasn't restarted yet.</b>\nClose all its windows (if it stays in the tray by the clock, quit it there too), open it again and press “Done”.`, `⏳ <b>Chrome на ${name} ещё не перезапущен.</b>\nЗакрой все его окна (если он остаётся в трее у часов — выйди и там), открой снова и нажми «Готово».`)
          : tr(`🔄 <b>Chrome on ${name}: ${label}</b>, but it has to restart first.\nClose all Chrome windows, open it again and press “Done”. Claude is waiting.`, `🔄 <b>Chrome на ${name} — ${label}</b>, но сначала его нужно перезапустить.\nЗакрой все окна Chrome, открой снова и нажми «Готово». Claude ждёт.`),
        new InlineKeyboard().text(tr('✅ Done', '✅ Готово'), `bpr:${id}:done`).row().text(tr('Cancel', 'Отмена'), `bpr:${id}:cancel`))
        const r = await answer()
        if (r !== 'done') return await refuse(r)
        const st = await proxyOp(dev.id, 'status')
        if (!st.ok) {
          await show(tr(`⚠️ <b>Couldn't check Chrome on ${name}:</b> ${esc(st.error.message)}`, `⚠️ <b>Не получилось проверить Chrome на ${name}:</b> ${esc(st.error.message)}`))
          return `Couldn't check how Chrome goes online (${st.error.message}). Don't use Chrome in this task, and tell the user.`
        }
        s = st.result as BrowserProxyState
      }
      await show(`🌐 <b>Chrome ${tr('on', 'на')} ${name}: ${label}.</b>`)
      return true
    } catch (e) {
      log.warn('chrome route', (e as Error).message)
      return `Couldn't ask the user how Chrome goes online (${(e as Error).message}). Don't use Chrome in this task.`
    }
  }

  // --- updates: a newer release, the server and every computer moved to it with one tap -------------------
  let lastRelease: Release | null = null
  // The release being installed: new tasks don't start, and once the helper is asked, Telegram keeps new
  // messages for the next version
  let updating: string | null = null
  // The wait for tasks to finish before an update, which is short: what doesn't finish goes on by itself after the
  // restart (recovery.ts). So the card has nothing to hurry, only the way out of a tap made by mistake
  let updateWait: { cancelled: boolean } | null = null
  const UPDATE_WAIT_MS = 3 * 60_000
  const DEVICE_WAIT_MS = 60_000
  const updateWaitRows = (): RichButton[][] => [[{ text: tr('Cancel the update', 'Отменить обновление'), data: 'updw:cancel' }]]
  const releaseTimers: NodeJS.Timeout[] = []
  const pause = (ms: number) => new Promise(r => setTimeout(r, ms))
  const toOwners = (html: string) => {
    for (const id of owners.mainOnly()) api.sendMessage(id, html, HTML).catch(() => {})
  }

  const computersMd = () => gateway.devices().filter(d => !isCloud(d.id))
    .map(d => `- ${osIcon(d)} ${d.name}: ${d.release ?? tr('old version, update by hand', 'старая версия, обновить вручную')}`).join('\n')

  const releaseMd = (r: Release) => [
    tr(`### 🆕 ${r.version} is out`, `### 🆕 Вышла ${r.version}`),
    [`- ${tr('Server', 'Сервер')}: ${updates.current}`, computersMd()].filter(Boolean).join('\n'),
    tr("### What's new", '### Что нового'),
    notesIn(r.notes, lang()),
    r.url && `${appEmoji('github')} [${tr('More on GitHub', 'Подробнее на GitHub')}](${r.url})`,
    tr('### How it updates', '### Как пройдёт обновление'),
    updates.helper()
      ? tr('- **The server** goes quiet for about a minute\n- **Tasks** get up to 3 minutes to finish; the rest go on by themselves after the restart, commands on computers keep running\n- **Computers** update right after, the ones that are off once they connect', '- **Сервер** замолчит примерно на минуту\n- **Задачам** — до 3 минут на завершение, остальные сами продолжатся после перезапуска, команды на компьютерах не прервутся\n- **Компьютеры** обновятся следом, выключенные — когда подключатся')
      : [
        tr('**Updates here are by hand:** the server runs without the update helper.', '**Здесь обновление вручную:** сервер запущен без помощника обновлений.'),
        '- VPS: `cd /opt/tgcv/src && sudo bash deploy/install-server.sh`',
        tr('- This computer: `git pull`, `npm install`, restart `npm run server`', '- Этот компьютер: `git pull`, `npm install`, перезапусти `npm run server`'),
      ].join('\n'),
  ].filter(Boolean).join('\n\n')

  const releaseKb = (r: Release) => {
    const kb = new InlineKeyboard()
    if (updates.helper()) kb.text(tr('⬆️ Update everything', '⬆️ Обновить всё'), `upd:go:${r.version}`).row()
    return kb.text(tr('Remind me tomorrow', 'Напомнить завтра'), `upd:later:${r.version}`).text(tr('Skip', 'Пропустить'), `upd:skip:${r.version}`)
  }

  // Once a day: a release the owners haven't heard of (or asked to hear of again) goes to the bot's chat
  async function checkRelease() {
    await updates.refresh()
    const r = await updates.latest()
    if (r) lastRelease = r
    if (!r || !updates.due(r)) return
    updates.notified(r.version)
    log.info('release available', { version: r.version })
    for (const id of owners.mainOnly()) await sendRich(id, undefined, releaseMd(r), { reply_markup: releaseKb(r) }).catch(() => {})
  }

  bot.command('update', async ctx => {
    const topicId = topicOf(ctx.msg)
    await updates.refresh()
    const r = await updates.latest()
    if (r) lastRelease = r
    if (!r) return sendRich(ctx.chat.id, topicId, tr("⚠️ Couldn't check for new versions: GitHub didn't answer. Try later.", '⚠️ Не получилось узнать о новых версиях: GitHub не ответил. Попробуй позже.'))
    if (!newer(r.version, updates.current)) {
      return sendRich(ctx.chat.id, topicId, [`✅ **${tr('Latest version', 'Последняя версия')}: ${updates.current}**`, computersMd() && `${tr('Computers', 'Компьютеры')}:\n${computersMd()}`].filter(Boolean).join('\n\n'))
    }
    await sendRich(ctx.chat.id, topicId, releaseMd(r), { reply_markup: releaseKb(r) })
  })

  bot.callbackQuery(/^upd:(go|later|skip):(\d+\.\d+\.\d+)$/, async ctx => {
    const [, action, version] = ctx.match
    if (action === 'later') {
      updates.remindLater()
      await ctx.answerCallbackQuery(tr("I'll remind you tomorrow", 'Напомню завтра'))
      return ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(tr("⏰ I'll remind you tomorrow", '⏰ Напомню завтра'), 'noop') }).catch(() => {})
    }
    if (action === 'skip') {
      updates.skip(version)
      await ctx.answerCallbackQuery(tr(`Skipping version ${version}`, `Версию ${version} пропускаю`))
      return ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(tr(`Skipped ${version}`, `Пропущена ${version}`), 'noop') }).catch(() => {})
    }
    if (updating) return ctx.answerCallbackQuery(tr('Already updating', 'Уже обновляюсь'))
    if (!newer(version, updates.current)) return ctx.answerCallbackQuery(tr(`Already on ${updates.current}`, `Уже версия ${updates.current}`))
    if (!updates.helper()) return ctx.answerCallbackQuery(tr('Updates here are by hand', 'Здесь обновление вручную'))
    await ctx.answerCallbackQuery()
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(tr('⏳ Updating…', '⏳ Обновляюсь…'), 'noop') }).catch(() => {})
    runUpdate(ctx.chat!.id, topicOf(ctx.callbackQuery.message), version, ctx.callbackQuery.message?.message_id).catch(e => log.error('update', (e as Error).message))
  })

  // Any of the old buttons too, on a card from before this version
  bot.callbackQuery(/^updw:\w+$/, async ctx => {
    if (!updateWait || ctx.callbackQuery.data !== 'updw:cancel') return ctx.answerCallbackQuery(tr('This update is no longer waiting', 'Это обновление уже не ждёт'))
    await ctx.answerCallbackQuery()
    updateWait.cancelled = true
  })

  const queueStore = createQueueStore<Incoming>(join(cfg.dataDir, 'queues.json'))
  function saveQueues() {
    const queues: Record<string, Incoming[]> = {}
    for (const [key, l] of live) if (l.queue.length || l.handing?.length) queues[key] = [...handIn.unread(l), ...l.queue.filter(i => !i.continuation)]
    try {
      queueStore.save(queues)
      if (Object.keys(queues).length) log.info('queues saved', { topics: Object.keys(queues).length })
    } catch (e) {
      log.warn('queues not saved', (e as Error).message)
    }
  }
  // Computers need a moment to reconnect after a restart, or every topic would first announce its own as offline
  const QUEUES_BACK_MS = 15_000
  function restoreQueues() {
    const saved = queueStore.take()
    for (const [key, items] of Object.entries(saved)) {
      const l = liveOf(key)
      // Ahead of whatever arrived since
      l.queue.unshift(...items.map((i, n) => ({ ...i, seq: n - items.length })))
      log.info('queue restored', { key, items: items.length })
      schedule(key)
    }
  }
  // The update didn't happen: what waited for it goes on here
  function resumeQueues() {
    queueStore.clear()
    for (const [key, l] of live) if (l.queue.length) schedule(key)
  }

  async function runUpdate(chatId: number, topicId: number | undefined, version: string, card?: number) {
    updating = version
    log.info('update started', { from: updates.current, to: version })
    let msgId: number | undefined
    // Refused as rich, it goes on as a plain message with a keyboard: the card must not be lost over its looks
    let plain = false
    // rich: the card's own rich text, where it has one; the HTML stays for when Telegram refuses rich messages
    const status = async (html: string, rows?: RichButton[][], rich?: string) => {
      const md = `${rich ?? richLines(html)}${rows ? `\n\n${richButtons(rows)}` : ''}`
      const extra = { ...HTML, ...(rows && { reply_markup: goKeyboard(rows) }) }
      if (msgId === undefined) {
        const sent = await api.sendRichMessage(chatId, { markdown: md }, where(topicId)).catch(e => {
          log.warn('update card', (e as Error).message)
          return null
        })
        msgId = sent?.message_id
        plain = !sent
        if (plain) msgId = (await api.sendMessage(chatId, html, { ...where(topicId), ...extra }).catch(() => null))?.message_id
      } else if (plain) await api.editMessageText(chatId, msgId, html, extra).catch(() => {})
      else await editRich(chatId, msgId, md)
    }
    // Tasks under way get a moment to finish (their permission buttons still work); new ones are asked to wait
    // Files still being prepared count too: they would arrive at a server already gone
    // Each task a line, its group in italics: the card says what it waits for and nothing more
    const busyTasks = () => {
      const all = [...live].filter(([, l]) => l.busy || l.preparing).map(([k]) => {
        const { chatId: chat, topicId: topic } = parseKey(k)
        return { key: k, topic: topic ? topicLabel(k, topics.get(k)) : tr('general chat', 'общий чат'), where: workspaces.get(chat)?.title }
      })
      const shown = all.slice(0, 6)
      const more = all.length > shown.length ? `+${all.length - shown.length}` : ''
      return {
        key: JSON.stringify(all),
        md: [...shown.map(x => `- ${topicMd(x.key, x.topic)}${x.where ? ` · _${mdText(x.where)}_` : ''}`), ...(more ? [`- ${more}`] : [])].join('\n'),
        html: [...shown.map(x => `${topicA(x.key, x.topic)}${x.where ? ` <i>· ${esc(x.where)}</i>` : ''}`), ...(more ? [more] : [])].join(', '),
      }
    }
    const w: NonNullable<typeof updateWait> = updateWait = { cancelled: false }
    const busy = () => running > 0 || [...live.values()].some(l => l.preparing)
    const until = Date.now() + (cfg.updateWaitMs ?? UPDATE_WAIT_MS)
    const waiting = () => busy() && !w.cancelled && Date.now() < until
    for (let shown: string | null = null; waiting(); await pause(Math.min(1000, cfg.updateWaitMs ?? 1000))) {
      const tasks = busyTasks()
      const now = `${running}\n${tasks.key}`
      if (shown === now) continue
      shown = now
      const waits = count(running, ['task', 'tasks'], ['задачу', 'задачи', 'задач'])
      const line = tr(`⏳ <b>Updating to ${version}</b>\nWaiting for ${waits}, at most 3 min. Nothing is lost: they go on after the restart.`, `⏳ <b>Обновление до ${version}</b>\nЖду ${waits}, не дольше 3 мин. Ничего не потеряется: после перезапуска они продолжатся.`)
      const rich = [
        tr(`### ⏳ Updating to ${version}`, `### ⏳ Обновление до ${version}`),
        tr(`Waiting for **${waits}**, at most 3 min`, `Жду **${waits}**, не дольше 3 мин`),
        tasks.md,
        `<footer>${tr('Nothing is lost: they go on after the restart', 'Ничего не потеряется: после перезапуска они продолжатся')}</footer>`,
      ].filter(Boolean).join('\n\n')
      await status(`${line}${tasks.html && `\n${tasks.html}`}`, updateWaitRows(), rich)
    }
    updateWait = null
    if (w.cancelled) {
      updating = null
      log.info('update cancelled', { to: version })
      resumeQueues()
      if (card) await api.editMessageReplyMarkup(chatId, card, { reply_markup: new InlineKeyboard().text(tr('Cancelled', 'Отменено'), 'noop') }).catch(() => {})
      return status(tr(`⏹ <b>Update to ${version} cancelled.</b> Running on ${updates.current}, tasks go on.`, `⏹ <b>Обновление до ${version} отменено.</b> Работаю на ${updates.current}, задачи продолжаются.`), [[{ text: tr('⬆️ Update again', '⬆️ Обновить снова'), data: `upd:go:${version}` }]])
    }
    const under = running > 0 ? tr(' Tasks still under way continue by themselves after the restart.', ' Задачи, которые ещё идут, сами продолжатся после перезапуска.') : ''
    await status(tr(`⏳ <b>Updating to ${version}:</b> building the new version. That takes a few minutes, then the bot goes quiet for about 10 seconds. Messages sent meanwhile won't be lost.${under}`, `⏳ <b>Обновление до ${version}:</b> собираю новую версию — это несколько минут, потом бот замолчит секунд на 10. Сообщения за это время не потеряются.${under}`), undefined, [
      tr(`### ⏳ Updating to ${version}`, `### ⏳ Обновление до ${version}`),
      tr('Building the new version: a few minutes, then the bot goes quiet for about 10 seconds.', 'Собираю новую версию: несколько минут, потом бот замолчит секунд на 10.'),
      `<footer>${tr("Messages sent meanwhile won't be lost", 'Сообщения за это время не потеряются')}${under}</footer>`,
    ].join('\n\n'))
    if (msgId !== undefined) updates.noteMessage({ chatId, messageId: msgId })
    // From here Telegram holds new messages for the next version
    await bot.stop()
    saveQueues()
    updates.clearResult()
    updates.request(`v${version}`)
    // The helper answers this process only when it failed before the switch; a switch replaces this process
    for (const end = Date.now() + 30 * 60_000; Date.now() < end; await pause(3000)) {
      const res = updates.result()
      if (!res) continue
      updates.clearResult()
      updating = null
      poll()
      resumeQueues()
      log.warn('update failed', res)
      return status(tr(`⚠️ <b>Didn't update to ${version}:</b> ${esc(res.error ?? 'no details')}. Running on ${updates.current}.`, `⚠️ <b>Не обновился до ${version}:</b> ${esc(res.error ?? 'без описания')}. Работаю на ${updates.current}.`))
    }
    updating = null
    poll()
    resumeQueues()
    await status(tr("⚠️ <b>The update helper didn't answer within 30 minutes.</b> Running on the previous version. On the VPS: <code>systemctl status tgcv-update</code>", '⚠️ <b>Помощник обновлений не ответил за 30 минут.</b> Работаю на прежней версии. На VPS: <code>systemctl status tgcv-update</code>'))
  }

  // The outcome of an update that just replaced this process (or failed and brought it back): the helper writes
  // it a moment after this server says it is alive, so it is waited for a little rather than read once
  async function reportUpdate() {
    for (let i = 0; i < 30 && updates.helper() && !updating; i++) {
      const res = updates.result()
      if (res) {
        updates.clearResult()
        log.info('update outcome', res)
        const link = `<a href="${updates.releaseUrl(res.to)}">${esc(res.to)}</a>`
        const html = res.ok
          ? tr(`${claudeEmoji('party')} <b>Server updated: ${esc(res.from)} → ${link}.</b> Computers online update themselves; the ones that are off, once they connect. ${hashtag('update')}`, `${claudeEmoji('party')} <b>Сервер обновлён: ${esc(res.from)} → ${link}.</b> Компьютеры в сети обновятся сами, выключенные — когда подключатся. ${hashtag('update')}`)
          : tr(`⚠️ <b>Didn't update to ${res.to}:</b> ${esc(res.error ?? 'no details')}. Running on ${updates.current}.`, `⚠️ <b>Не обновился до ${res.to}:</b> ${esc(res.error ?? 'без описания')}. Работаю на ${updates.current}.`)
        const note = updates.takeMessage()
        if (note) {
          const edited = await api.editMessageText(note.chatId, note.messageId, html, HTML).then(() => true, () => false)
          if (edited) return
        }
        return toOwners(html)
      }
      await pause(2000)
    }
  }

  // Computers follow the server: one behind it updates itself as soon as it is here, once per release
  // A computer restarting into a new version: one message, which turns into the outcome when it is back
  const restarting = new Map<string, Promise<{ chatId: number, messageId: number } | null>>()
  // It said it restarts once its commands finish: until then it can drop off and come back on the old version
  const restartWaits = new Set<string>()
  async function restartNote(html: string) {
    const [chatId] = owners.mainOnly()
    if (!chatId) return null
    const m = await api.sendMessage(chatId, html, HTML).catch(() => null)
    return m ? { chatId, messageId: m.message_id } : null
  }
  async function restartDone(note: Promise<{ chatId: number, messageId: number } | null>, html: string) {
    const n = await note
    if (n) await api.editMessageText(n.chatId, n.messageId, html, HTML).catch(() => toOwners(html))
    else toOwners(html)
  }
  // A project's new CLAUDE.md: left out until the owner says, asked once in a topic and never holding the task up. A card
  // can be left unanswered: the work goes on without the file, and Claude says so
  // --- widgets (Bot API 10.4): Claude's HTML in a message; a value set in it comes back as the user's words --------
  type WidgetQuery = { id: string, from: { id: number }, chat?: { id: number }, message_id?: number, data: string }
  // Which topic a widget is in: a query names only its chat and message. Gone with a restart, and the widget is told
  const widgetsSent = new Map<string, { key: string, caption: string }>()
  async function sendWidget(key: string, p: WidgetRequest) {
    const problem = widgetProblem(p.html)
    if (problem) return problem
    const { chatId, topicId } = parseKey(key)
    // Without a caption the message is a line shorter; the value still needs a name
    const caption = p.caption?.trim() || tr('Widget', 'Виджет')
    try {
      const sent = await (api.raw as unknown as { sendWidget: (o: object) => Promise<Message> }).sendWidget({
        chat_id: chatId, ...where(topicId), html: p.html, ...(p.caption?.trim() && { caption: trunc(p.caption.trim(), 1024) }), ...(p.width && { width: p.width }), ...(p.height && { height: p.height }), allow_queries: true,
      })
      widgetsSent.set(`${chatId}:${sent.message_id}`, { key, caption })
      while (widgetsSent.size > 200) widgetsSent.delete(widgetsSent.keys().next().value!)
      log.info('widget sent', { key, bytes: Buffer.byteLength(p.html) })
      return `Sent. A value the user sets in it comes to you as their message «🧩 ${caption}: value».`
    } catch (e) {
      return `Telegram refused the widget: ${(e as Error).message}. Fix it and send it again.`
    }
  }
  async function widgetQuery(q: WidgetQuery) {
    // The /now widget asking for its rows again, by itself, while it is on screen: the bot answers, nobody is told
    if (q.data === NOW_QUERY) {
      const rows = owners.has(q.from.id) && q.chat?.id === q.from.id ? nowAnswer(overview.nowRows(q.from.id)) : '{"r":[],"more":0}'
      await (api.raw as unknown as { answerWidgetQuery: (o: object) => Promise<unknown> }).answerWidgetQuery({ widget_query_id: q.id, data: rows }).catch(e => log.debug('now widget answer', (e as Error).message))
      return
    }
    // A render's widget asking how far it got: only in the chat it was shown in
    if (q.data.startsWith(RENDER_QUERY)) {
      const j = renders.get(q.data.slice(RENDER_QUERY.length))
      const data = j && owners.has(q.from.id) && q.chat?.id === j.where.chatId ? renderAnswer(j) : '{}'
      await (api.raw as unknown as { answerWidgetQuery: (o: object) => Promise<unknown> }).answerWidgetQuery({ widget_query_id: q.id, data }).catch(e => log.debug('render widget answer', (e as Error).message))
      return
    }
    const w = q.chat && q.message_id !== undefined ? widgetsSent.get(`${q.chat.id}:${q.message_id}`) : undefined
    const answer = (data: string) => (api.raw as unknown as { answerWidgetQuery: (o: object) => Promise<unknown> }).answerWidgetQuery({ widget_query_id: q.id, data })
      .catch(e => log.warn('widget answer', (e as Error).message))
    if (!owners.has(q.from.id) || !w) return void await answer(w ? 'not allowed' : 'gone')
    await answer('ok')
    const { chatId, topicId } = parseKey(w.key)
    const shown = await api.sendMessage(chatId, `🧩 ${esc(w.caption)}: <code>${esc(masked(chatId, topicId, q.data))}</code>`, { ...where(topicId), ...HTML }).catch(() => null)
    log.info('widget value', { key: w.key })
    enqueue(chatId, topicId, `🧩 ${w.caption}: ${q.data}`, { msgId: shown?.message_id })
  }

  // --- skills: shown first, put where the user taps (everywhere, a computer, a project) or removed the same way --
  const skills = createSkills(join(cfg.dataDir, 'skills'))
  type SkillHome = { deviceId: string, projectId: string, device: string, project: string }
  const skillOffers = new Map<string, { key: string, names: string[], home?: SkillHome }>()
  const skillRemovals = new Map<string, { key: string, name: string, scope: SkillScope, home?: SkillHome }>()
  // The topic's computer and project, where a skill can go besides everywhere. Not the cloud's name for the server's
  const skillHome = (key: string): SkillHome | undefined => {
    const t = topics.get(key)
    const dev = t.deviceId ? gateway.device(t.deviceId) : undefined
    const project = dev && t.projectId ? dev.projects.find(p => p.id === t.projectId) : undefined
    return dev && project ? { deviceId: dev.id, projectId: project.id, device: dev.name, project: project.name } : undefined
  }
  const scopeLabel = (scope: SkillScope, home?: SkillHome) => scope === 'everywhere' ? tr('everywhere', 'везде')
    : scope === 'computer' ? tr(`all projects on ${home?.device ?? '?'}`, `все проекты на ${home?.device ?? '?'}`)
      : tr(`project ${home?.project ?? '?'}`, `проект ${home?.project ?? '?'}`)

  // via: the topic's computer, for a private repository or a file of its own
  async function offerSkillInstall(key: string, source: string, via?: Via) {
    const s = source.trim()
    const g = parseGitHub(s)
    const isId = /^[0-9a-f]{8}$/.test(s)
    const a = isId ? inbox.get(s) : undefined
    if (isId && !a) return `No attachment ${s}: over a day has passed or the id is wrong. Ask the user to send the file again.`
    if (!g && !a && (!via || /^https?:/i.test(s))) return /^https?:/i.test(s) ? 'Only https://github.com/… links.' : 'The source is the 📎 id of a file the user sent or a https://github.com/… link; a file on a computer needs a topic with that computer.'
    let found: FoundSkill[]
    try {
      if (g) {
        found = await fromGitHub(g).catch(e => {
          if (!(e instanceof NotPublic)) throw e
          if (!via) throw new Error(`${e.message}. If it is private, a topic with a computer signed in to GitHub can install it`)
          log.info('skill: private repository, cloned on the computer', { key, repo: `${g.owner}/${g.repo}` })
          return fromGitHubVia(g, via)
        })
      } else if (a) found = fromFile(a.name, readFileSync(a.path))
      else found = fromFile(s.split(/[\\/]/).at(-1)!, await via!.pull(s))
    } catch (e) {
      return `Could not take the skill from there: ${(e as Error).message}.`
    }
    if (!found.length) return 'There is no skill there: a skill is a folder with a SKILL.md.'
    const id = skills.stage(found)
    const home = skillHome(key)
    skillOffers.set(id, { key, names: found.map(f => f.name), home })
    const { chatId, topicId } = parseKey(key)
    const from = g ? `github.com/${g.owner}/${g.repo}${g.path ? `/${g.path}` : ''}` : a ? a.name : s
    const md = [
      found.length > 1 ? tr(`### 🧩 Install ${found.length} skills?`, `### 🧩 Установить скиллы (${found.length})?`) : tr('### 🧩 Install a skill?', '### 🧩 Установить скилл?'),
      ...found.map(f => `> **${mdText(f.name)}**  \n> ${mdText(trunc(f.description, 200))}`),
      tr(`From ${mdText(from)}. Claude follows a skill when a task fits it: install only what you trust.`, `Из ${mdText(from)}. Claude следует скиллу, когда задача подходит: ставь только то, чему доверяешь.`),
      [
        tr('**🌍 Everywhere**: every topic, every computer', '**🌍 Везде**: все топики, все компьютеры'),
        ...(home ? [
          tr(`**💻 ${mdText(home.device)}**: every project on this computer`, `**💻 ${mdText(home.device)}**: все проекты этого компьютера`),
          tr(`**📁 ${mdText(home.project)}**: this project only`, `**📁 ${mdText(home.project)}**: только этот проект`),
        ] : []),
      ].join('  \n'),
    ].join('\n\n')
    const rows: RichButton[][] = [
      [{ text: tr('🌍 Everywhere', '🌍 Везде'), data: `skl:a:${id}` }],
      ...(home ? [[{ text: `💻 ${home.device}`, data: `skl:c:${id}` }, { text: `📁 ${home.project}`, data: `skl:p:${id}` }]] : []),
      [{ text: tr('Cancel', 'Отмена'), data: `skl:n:${id}` }],
    ]
    const choice = await keepLoud(() => sendChoice(chatId, topicId, md, rows, goKeyboard(rows))).catch(() => null)
    offers.open(key, 'skill', choice?.messageId)
    return `The user sees ${found.map(f => f.name).join(', ')} and picks where it goes with a button; nothing is installed until then. Don't ask about it in words: end your turn with one short line.`
  }

  // To a computer: the skill's files in one message, then trusted there like a rule the bot wrote itself
  async function skillToDevice(home: SkillHome, scope: 'computer' | 'project', id: string): Promise<string | null> {
    for (const s of skills.staged(id)) {
      const files = s.files.map(f => ({ path: f.path, data: f.data.toString('base64') }))
      if (s.files.reduce((n, f) => n + f.data.length, 0) > DEVICE_SKILL_BYTES) return tr(`${s.name} is too big for a computer: install it everywhere`, `${s.name} слишком большой для компьютера: поставь его «Везде»`)
      const out = await gateway.request(home.deviceId, { projectId: home.projectId, bindingVersion: 0, tool: 'skill_put', params: { name: s.name, scope, files } })
      if (!out.ok) return out.error.code === 'offline' ? tr(`${home.device} is offline`, `${home.device} не в сети`) : out.error.message
      if (scope === 'project') {
        const md = s.files.find(f => f.path === 'SKILL.md')
        if (md) contextTrust.decide(textHash(md.data.toString('utf8')), true)
      }
    }
    return null
  }

  bot.callbackQuery(/^skl:([acpn]):([0-9a-f]{8})$/, async ctx => {
    const id = ctx.match[2]
    const o = skillOffers.get(id)
    if (!o) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    const msg = ctx.callbackQuery.message
    const show = (md: string) => (msg ? editRich(ctx.chat!.id, msg.message_id, md) : Promise.resolve(false))
    const how = ctx.match[1]
    if (how === 'n') {
      skillOffers.delete(id)
      skills.drop(id)
      await ctx.answerCallbackQuery()
      return void await show(tr('🧩 Not installed.', '🧩 Не установлено.'))
    }
    if (how !== 'a' && !o.home) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    skillOffers.delete(id)
    await ctx.answerCallbackQuery(tr('Installing…', 'Устанавливаю…'))
    const scope: SkillScope = how === 'a' ? 'everywhere' : how === 'c' ? 'computer' : 'project'
    const failed = scope === 'everywhere' ? null : await skillToDevice(o.home!, scope, id)
    if (scope === 'everywhere') skills.commit(id)
    else skills.drop(id)
    log.info('skills installed', { key: o.key, names: o.names, scope, failed: !!failed })
    const names = o.names.map(n => `**${mdText(n)}**`).join(', ')
    await show(failed
      ? `⚠️ ${tr('Not installed:', 'Не установлено:')} ${mdText(failed)}`
      : `🧩 ✅ ${tr(`Installed (${scopeLabel(scope, o.home)}), from the next message:`, `Установлено (${scopeLabel(scope, o.home)}), со следующего сообщения:`)} ${names}`)
  })

  async function offerSkillRemove(key: string, name: string, where: SkillScope | undefined, onDevice: DeviceSkill[]) {
    const home = skillHome(key)
    const places: SkillScope[] = [
      ...(skills.has(name) ? ['everywhere' as const] : []),
      ...(home ? onDevice.filter(s => s.name === name).map(s => s.scope) : []),
    ]
    const scope = where ?? (places.length === 1 ? places[0] : undefined)
    if (!places.length) return `No skill «${name}» is installed. Installed: ${[...skills.list().map(s => s.name), ...onDevice.map(s => s.name)].join(', ') || 'none'}.`
    if (!scope) return `«${name}» is installed in more than one place (${places.join(', ')}): call remove_skill again with where.`
    if (!places.includes(scope)) return `«${name}» is not installed there; it is: ${places.join(', ')}.`
    const id = randomBytes(4).toString('hex')
    skillRemovals.set(id, { key, name, scope, home })
    const { chatId, topicId } = parseKey(key)
    const rows: RichButton[][] = [[{ text: tr('🗑 Remove', '🗑 Удалить'), data: `skr:y:${id}` }, { text: tr('Keep', 'Оставить'), data: `skr:n:${id}` }]]
    const choice = await keepLoud(() => sendChoice(chatId, topicId, tr(`### 🧩 Remove the skill **${mdText(name)}** (${scopeLabel(scope, home)})?`, `### 🧩 Удалить скилл **${mdText(name)}** (${scopeLabel(scope, home)})?`), rows, goKeyboard(rows))).catch(() => null)
    offers.open(key, 'skill', choice?.messageId)
    return 'The user decides with a button. End your turn with one short line.'
  }
  bot.callbackQuery(/^skr:([yn]):([0-9a-f]{8})$/, async ctx => {
    const r = skillRemovals.get(ctx.match[2])
    if (!r) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    skillRemovals.delete(ctx.match[2])
    await ctx.answerCallbackQuery()
    let failed: string | null = null
    if (ctx.match[1] === 'y') {
      if (r.scope === 'everywhere') skills.remove(r.name)
      else {
        const out = await gateway.request(r.home!.deviceId, { projectId: r.home!.projectId, bindingVersion: 0, tool: 'skill_remove', params: { name: r.name, scope: r.scope } })
        if (!out.ok) failed = out.error.message
      }
      if (!failed) log.info('skill removed', { key: r.key, name: r.name, scope: r.scope })
    }
    const msg = ctx.callbackQuery.message
    const where_ = scopeLabel(r.scope, r.home)
    if (msg) await editRich(ctx.chat!.id, msg.message_id, failed ? `⚠️ ${tr('Not removed:', 'Не удалён:')} ${mdText(failed)}`
      : ctx.match[1] === 'y' ? tr(`🧩 🗑 Removed: **${mdText(r.name)}** (${where_})`, `🧩 🗑 Удалён: **${mdText(r.name)}** (${where_})`)
        : tr(`🧩 Kept: **${mdText(r.name)}**`, `🧩 Оставлен: **${mdText(r.name)}**`))
  })

  const contextTrust = createContextTrust(join(cfg.dataDir, 'context-trust.json'))
  const contextAsked = new Set<string>()
  async function askAboutContext(key: string, projectName: string, ask: ReturnType<typeof contextTrust.review>['ask']) {
    const { chatId, topicId } = parseKey(key)
    for (const { file, hash } of ask) {
      if (contextAsked.has(`${key}:${hash}`)) continue
      contextAsked.add(`${key}:${hash}`)
      const name = file.label.replace(/^Project /, '')
      const md = [
        tr(`📄 **New \`${name}\` in ${mdText(projectName)}.** I haven't seen this text, and it may not be yours. Until you decide, Claude works without it.`, `📄 **Новый \`${name}\` в ${mdText(projectName)}.** Этот текст я ещё не видел, и он может быть не твоим. Пока ты не решишь, Claude работает без него.`),
        `<details><summary>${tr('The text', 'Текст файла')}</summary>\n\n${heldBackPreview(file.content)}\n\n</details>`,
      ].join('\n\n')
      const rows: RichButton[][] = [[{ text: tr('✅ Use it', '✅ Использовать'), data: `ctxt:y:${hash}` }, { text: tr("Don't use", 'Не использовать'), data: `ctxt:n:${hash}` }]]
      const choice = await keepLoud(() => sendChoice(chatId, topicId, md, rows, goKeyboard(rows))).catch(e => {
        log.warn('context card', (e as Error).message)
        return null
      })
      offers.open(key, 'context', choice?.messageId)
    }
  }
  bot.callbackQuery(/^ctxt:([yn]):([0-9a-f]{16})$/, async ctx => {
    const use = ctx.match[1] === 'y'
    contextTrust.decide(ctx.match[2], use)
    log.info('project instructions decided', { hash: ctx.match[2], use })
    await ctx.answerCallbackQuery(use ? tr('It applies from the next message', 'Применится со следующего сообщения') : tr('Claude works without it', 'Claude работает без него'))
    const msg = ctx.callbackQuery.message
    if (msg) await editRich(ctx.chat!.id, msg.message_id, use ? tr('📄 ✅ **Using this file** from the next message.', '📄 ✅ **Использую этот файл** со следующего сообщения.') : tr("📄 **Not using this file.** I'll ask again if its text changes.", '📄 **Этот файл не используется.** Спрошу снова, если его текст изменится.'))
  })

  // --- a correction made twice becomes a rule in the project's CLAUDE.md, on the user's tap ----------------
  const rulesOffered = new Map<string, { key: string, rule: string, deviceId: string, projectId: string }>()
  async function offerRule(key: string, p: { rule: string, why: string }) {
    const t = topics.get(key)
    if (!t.deviceId || !t.projectId) return 'This topic has no project: there is no CLAUDE.md to write it to.'
    const { chatId, topicId } = parseKey(key)
    const id = randomBytes(4).toString('hex')
    rulesOffered.set(id, { key, rule: p.rule, deviceId: t.deviceId, projectId: t.projectId })
    const rows: RichButton[][] = [[{ text: tr('📝 Write it down', '📝 Записать'), data: `rul:y:${id}` }, { text: tr('No need', 'Не надо'), data: `rul:n:${id}` }]]
    const md = [
      tr('### 📝 Make it a rule?', '### 📝 Сделать правилом?'),
      `> ${mdText(p.rule)}`,
      tr(`You said this before: ${mdText(p.why)}. Written into the project's \`CLAUDE.md\`, it holds in every session from now on.`, `Ты уже говорил это: ${mdText(p.why)}. Если записать в \`CLAUDE.md\` проекта, правило будет действовать во всех следующих сессиях.`),
    ].join('\n\n')
    const choice = await keepLoud(() => sendChoice(chatId, topicId, md, rows, goKeyboard(rows))).catch(() => null)
    offers.open(key, 'rule', choice?.messageId)
    return 'The user sees the offer and decides with a button. Don\'t ask about it in words; go on with the task.'
  }
  bot.callbackQuery(/^rul:([yn]):([0-9a-f]{8})$/, async ctx => {
    const r = rulesOffered.get(ctx.match[2])
    if (!r) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    rulesOffered.delete(ctx.match[2])
    const msg = ctx.callbackQuery.message
    if (ctx.match[1] === 'n') {
      await ctx.answerCallbackQuery()
      if (msg) await editRich(ctx.chat!.id, msg.message_id, tr('📝 Not written down.', '📝 Не записано.'))
      return
    }
    await ctx.answerCallbackQuery(tr('Writing…', 'Записываю…'))
    const said = await writeRule(r)
    if (msg) await editRich(ctx.chat!.id, msg.message_id, said ? `⚠️ ${tr("Couldn't write it down:", 'Не удалось записать:')} ${mdText(said)}` : `📝 ✅ ${tr('Written into the project\'s `CLAUDE.md`:', 'Записано в `CLAUDE.md` проекта:')}\n\n> ${mdText(r.rule)}`)
  })
  // Null when written. What the bot writes itself needs no second word about the file
  async function writeRule(r: { rule: string, deviceId: string, projectId: string }) {
    const op = (tool: OpTool, params: Record<string, unknown>) => gateway.request(r.deviceId, { projectId: r.projectId, bindingVersion: 0, tool, params })
    const read = await op('read_file', { path: 'CLAUDE.md', limit: 5000 })
    if (!read.ok && read.error.code !== 'not_found') return read.error.message
    const was = read.ok ? read.result as { lines: string[], hash: string, totalLines: number } : null
    if (was && was.totalLines > was.lines.length) return tr('CLAUDE.md is too long to change from here', 'CLAUDE.md слишком длинный, чтобы менять его отсюда')
    const content = withRule(was?.lines.join('\n') ?? '', r.rule)
    const wrote = await op('write_file', { path: 'CLAUDE.md', content, ...(was && { expectedHash: was.hash }) })
    if (!wrote.ok) return wrote.error.message
    contextTrust.decide(textHash(content), true)
    log.info('rule written', { device: r.deviceId, project: r.projectId })
    return null
  }

  // A closed Mac wakes by itself at night and connects for a few minutes: «online» each time was noise. It is said only
  // when the user ran into this computer being off lately; a topic with work waiting says «going on» by itself instead
  const wantedAt = new Map<string, number>()
  const WANTED_MS = 12 * 3600_000
  const presence = createPresence({
    notify: id => {
      const dev = gateway.device(id)
      const wanted = wantedAt.get(id)
      wantedAt.delete(id)
      if (!dev || !wanted || Date.now() - wanted > WANTED_MS) return log.info('computer back, not announced', { id })
      if ([...live.entries()].some(([k, l]) => l.queue.length && topics.get(k).deviceId === id)) return
      toOwners(tr(`🟢 ${osIcon(dev)} <b>${esc(dev.name)}</b> is online.`, `🟢 ${osIcon(dev)} <b>${esc(dev.name)}</b> в сети.`))
    },
  })
  gateway.events.on('online', dev => {
    if (!isCloud(dev.id)) presence.online(dev.id)
  })
  gateway.events.on('offline', id => {
    presence.offline(id)
  })
  gateway.events.on('online', dev => {
    followServer(dev).catch(e => log.warn('computer update', (e as Error).message))
  })
  // A computer that couldn't reach GitHub is tried again a few times, quietly; then once more at its next connection
  const unreached = new Map<string, number>()
  const UNREACHED_TRIES = 3
  async function followServer(dev: Device) {
    // A locked one refuses it. Its next hello, once unlocked, brings it here again
    if (isCloud(dev.id) || dev.locked) return
    const name = `${osIcon(dev)} <b>${esc(dev.name)}</b>`
    const note = restarting.get(dev.id)
    if (note) {
      if (restartWaits.has(dev.id) && dev.release !== updates.current) return
      restartWaits.delete(dev.id)
      restarting.delete(dev.id)
      if (dev.release === updates.current) return restartDone(note, tr(`✅ ${name} updated to ${updates.current}.`, `✅ ${name} обновлён до ${updates.current}.`))
      return restartDone(note, tr(`⚠️ ${name} restarted, but it is on ${dev.release ?? 'an unknown version'}.`, `⚠️ ${name} перезапустился, но он на ${dev.release ?? 'неизвестной версии'}.`))
    }
    if (dev.release && !newer(updates.current, dev.release)) return
    if (updates.agentTried(dev.id, updates.current)) return
    updates.markAgent(dev.id, updates.current)
    // Older than self-updating agents: once, by hand
    if (!dev.release) {
      return toOwners(tr(`💻 ${name} is on an old version that doesn't update itself. Update it once by hand: <code>git pull</code>, <code>npm install</code>, <code>npm run agent -- restart</code>.`, `💻 ${name} на старой версии, которая не обновляется сама. Обнови его один раз вручную: <code>git pull</code>, <code>npm install</code>, <code>npm run agent -- restart</code>.`))
    }
    const sha256 = (await bundles?.())?.sha256
    const out = await gateway.request(dev.id, { projectId: '', bindingVersion: 0, tool: 'self_update', params: { tag: `v${updates.current}`, ...(sha256 && { sha256 }) } })
    const r = out.ok ? out.result as SelfUpdateResult : null
    log.info('computer update', { id: dev.id, ok: !!r?.ok, dev: r?.dev })
    if (r?.ok) {
      if (r.waiting) restartWaits.add(dev.id)
      restarting.set(dev.id, restartNote(r.waiting
        ? tr(`⬆️ ${name}: ${r.from} → ${r.to}, restarts once its running commands finish (${r.waiting})…`, `⬆️ ${name}: ${r.from} → ${r.to}, перезапустится, когда закончатся его команды (${r.waiting})…`)
        : tr(`⬆️ ${name}: ${r.from} → ${r.to}, restarting…`, `⬆️ ${name}: ${r.from} → ${r.to}, перезапускается…`)))
      return
    }
    // Agents before 0.9.4 say it their own way
    if (r?.error?.startsWith(UPDATE_UNREACHED) || /^cannot download from GitHub.*(ssl|tls|handshake|resolve|timed out|connection)/i.test(r?.error ?? '')) {
      updates.markAgent(dev.id, '')
      const tries = (unreached.get(dev.id) ?? 0) + 1
      unreached.set(dev.id, tries)
      if (tries < UNREACHED_TRIES) {
        log.info('computer update: GitHub unreached, trying again later', { id: dev.id, tries })
        const timer = setTimeout(() => {
          const now = gateway.device(dev.id)
          if (now) followServer(now).catch(e => log.warn('computer update', (e as Error).message))
        }, cfg.updateRetryMs ?? 10 * 60_000)
        timer.unref?.()
        return
      }
      unreached.delete(dev.id)
      return toOwners(tr(`⚠️ ${name} stayed on ${dev.release}: it couldn't reach GitHub ${UNREACHED_TRIES} times in a row (the connection dropped). It tries again the next time it connects, or tap “Update everything”.`, `⚠️ ${name} остался на ${dev.release}: ${UNREACHED_TRIES} раза подряд не смог достучаться до GitHub (обрывалась связь). Попробует снова при следующем подключении, или нажми «Обновить всё».`))
    }
    toOwners(tr(`⚠️ ${name} stayed on ${dev.release}: ${esc(r?.error ?? (out.ok ? 'no details' : out.error.message))}`, `⚠️ ${name} остался на ${dev.release}: ${esc(r?.error ?? (out.ok ? 'без описания' : out.error.message))}`))
  }

  // --- a cloud project onto a computer: one archive, relayed through the server piece by piece --------------
  const { copyProject, copyFiles } = createProjectCopy({ gateway, log, isCloud })

  // An agent works in a cloud project: moving it would take its folder away under it. The head removes the agent first
  const agentInCloud = (projectId?: string) => sharing(projectId).map(k => topics.get(k)).find(x => x.head)?.workerName
  const agentThere = (name: string) => tr(`The agent «${name}» works in this project: moving it would take the folder away from it. Remove the agent first.`, `В этом проекте работает агент «${name}»: перенос заберёт у него папку. Сначала удали агента.`)

  bot.command('move', async ctx => {
    const topicId = topicOf(ctx.msg)
    const t = topics.get(topicKey(ctx.chat.id, topicId))
    const project = gateway.device(CLOUD_DEVICE_ID)?.projects.find(p => p.id === t.projectId)
    const agent = isCloud(t.deviceId) && project ? agentInCloud(project.id) : undefined
    if (agent) return ctx.reply(agentThere(agent), where(topicId))
    if (!isCloud(t.deviceId) || !project) return ctx.reply(tr('🚚 Moving is for projects in the <b>cloud</b>: open a cloud project in /project and try again.', '🚚 Перенос — для проектов в <b>облаке</b>: открой облачный проект в /project и повтори.'), { ...where(topicId), ...HTML })
    const targets = gateway.devices().filter(d => !isCloud(d.id))
    if (!targets.length) return ctx.reply(tr('🔌 <b>No computer is online:</b> turn on the one you need and /move again.', '🔌 <b>Ни один компьютер не в сети:</b> включи нужный и повтори /move.'), { ...where(topicId), ...HTML })
    const kb = new InlineKeyboard()
    for (const d of targets) kb.text(`${iconOf(d)} ${tr('To', 'На')} ${d.name}`, `mv:${d.id}`).row()
    return sendRich(ctx.chat.id, topicId, [
      tr(`**Move “${project.name}” from the cloud to a computer?**`, `**Перенести «${project.name}» из облака на компьютер?**`),
      tr(`I'll move the whole folder, \`.git\` included; ${MOVE_SKIP.map(s => `\`${s}\``).join(', ')} don't move: reinstall the dependencies. The session goes on here, on the computer, and the project is removed from the cloud.`, `Перенесу папку целиком, вместе с \`.git\`; ${MOVE_SKIP.map(s => `\`${s}\``).join(', ')} не переношу — зависимости поставишь заново. Сессия продолжится здесь, уже на компьютере, а из облака проект удалится.`),
    ].join('\n\n'), { reply_markup: kb })
  })

  // Every topic working on this cloud project: they all go over to the computer together
  const sharing = (projectId?: string) => topics.entries().filter(([, t]) => isCloud(t.deviceId) && t.projectId === projectId).map(([k]) => k)

  bot.callbackQuery(/^mv:([\w-]+)$/, async ctx => {
    const topicId = topicOf(ctx.callbackQuery.message)
    const key = topicKey(ctx.chat!.id, topicId)
    const keys = sharing(topics.get(key).projectId)
    if (!keys.includes(key)) return ctx.answerCallbackQuery(tr('This topic is no longer in a cloud project', 'Этот топик уже не в облачном проекте'))
    const agent = agentInCloud(topics.get(key).projectId)
    if (agent) return ctx.answerCallbackQuery({ text: agentThere(agent).slice(0, 190), show_alert: true })
    if (keys.some(k => liveOf(k).busy)) return ctx.answerCallbackQuery(tr('Wait for the task to finish first, or /stop', 'Сначала дождись конца задачи или /stop'))
    if (!gateway.device(ctx.match[1])) return ctx.answerCallbackQuery(tr('This computer is offline now', 'Этот компьютер уже не в сети'))
    await ctx.answerCallbackQuery()
    // The topics wait while the files travel: messages sent meanwhile queue up for after
    for (const k of keys) liveOf(k).busy = true
    const status = (html: string) => ctx.editMessageText(html, HTML).catch(() => {})
    background((async () => {
      try {
        await moveProject(key, keys, ctx.match[1], status)
      } catch (e) {
        log.error('move failed', { key, error: (e as Error).message })
        await status(tr(`⚠️ <b>The move failed:</b> ${esc((e as Error).message)}\nThe project stayed in the cloud.`, `⚠️ <b>Перенос не удался:</b> ${esc((e as Error).message)}\nПроект остался в облаке.`))
      } finally {
        for (const k of keys) {
          const l = liveOf(k)
          l.busy = false
          if (l.queue.length) processQueue(k)
        }
      }
    })())
  })

  bot.callbackQuery('mvlater', async ctx => {
    await ctx.answerCallbackQuery()
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {})
    await api.sendMessage(ctx.chat!.id, tr('OK. You can move it any time: /move', 'Хорошо. Перенести можно в любой момент: /move'), where(topicOf(ctx.callbackQuery.message))).catch(() => {})
  })

  // A computer came online while worked-on projects wait in the cloud: offer to carry each one over.
  // Once a day per computer, all its offers together
  const moveOffers = createMoveOffers(join(cfg.dataDir, 'move-offers.json'))
  const startedAt = Date.now()
  gateway.events.on('online', d => {
    // Right after a restart every device reconnects at once: that is not a computer appearing
    const cloud = gateway.device(CLOUD_DEVICE_ID)
    if (isCloud(d.id) || !cloud || Date.now() - startedAt < 60_000 || !moveOffers.due(d.id)) return
    const offered = new Set<string>()
    for (const [key, t] of topics.entries()) {
      const project = cloud.projects.find(p => p.id === t.projectId)
      if (!isCloud(t.deviceId) || !t.sessionId || !project || offered.has(project.id)) continue
      // Not while an agent works there, nor while a task runs in it: the offer would only invite a tap that loses work
      if (agentInCloud(project.id) || sharing(project.id).some(k => live.get(k)?.busy)) continue
      offered.add(project.id)
      const { chatId, topicId } = parseKey(key)
      log.info('move offered', { key, project: project.id, device: d.id })
      sendRich(chatId, topicId, tr(`${osIcon(d)} **${d.name} is online.** Move “${project.name}” from the cloud there? The cloud is a temporary place: after the move the project is removed from it.`, `${osIcon(d)} **${d.name} в сети.** Перенести «${project.name}» из облака туда? Облако — временное место: после переноса проект оттуда удалится.`), {
        reply_markup: new InlineKeyboard().text(tr(`🚚 Move to ${d.name}`, `🚚 Перенести на ${d.name}`), `mv:${d.id}`).text(tr('Later', 'Позже'), 'mvlater'),
      }).catch(() => {})
    }
    if (offered.size) moveOffers.made(d.id)
  })

  async function moveProject(key: string, keys: string[], targetId: string, status: (text: string) => Promise<unknown>) {
    const t = topics.get(key)
    const source = (await gateway.refreshProjects(CLOUD_DEVICE_ID)).find(p => p.id === t.projectId)
    const target = gateway.device(targetId)
    if (!isCloud(t.deviceId) || !source) throw new Error(tr('the topic is no longer in a cloud project', 'топик уже не в облачном проекте'))
    if (!target) throw new Error(tr('the computer went offline', 'компьютер отключился'))
    const { project, size } = await copyProject({
      fromId: CLOUD_DEVICE_ID,
      source,
      bindingVersion: t.bindingVersion,
      targetId,
      // The same name on the computer; a folder already taken gets a suffix rather than being mixed into
      names: [source.name, `${source.name}-cloud`, ...[2, 3, 4, 5].map(n => `${source.name}-cloud-${n}`)],
      // The cloud copy is deleted after a move, so an archive that may miss changes is a failure
      changed: tr('files in the cloud project changed while packing: wait until everything there is done, then /move again', 'файлы в облачном проекте менялись во время упаковки — дождись, пока там всё закончится, и повтори /move'),
      status,
    })
    for (const k of keys) topics.bind(k, targetId, project.id, { carry: true })
    // The cloud is a waiting room, not storage: the project leaves it once it is safe on the computer
    const quoted = `'${source.path.replace(/'/g, `'\\''`)}'`
    const removed = await gateway.request(CLOUD_DEVICE_ID, { projectId: source.id, bindingVersion: t.bindingVersion, tool: 'run_command', params: { command: `rm -rf -- ${quoted}`, timeoutSec: 300 } })
    const gone = removed.ok && (removed.result as { exitCode: number | null }).exitCode === 0
    if (!gone) log.warn('cloud copy left after move', { project: source.id, error: removed.ok ? removed.result : removed.error })
    await gateway.refreshProjects(CLOUD_DEVICE_ID)
    log.info('project moved', { key, from: source.id, to: `${targetId}:${project.id}`, size, topics: keys.length })
    await status([
      tr(`✅ <b>“${esc(source.name)}” moved ${esc(onDevice(target))}</b>`, `✅ <b>«${esc(source.name)}» перенесён ${esc(onDevice(target))}</b>`),
      `<code>${esc(project.path)}</code>`,
      `<b>${osIcon(target)} ${esc(target.name)} · 📁 ${esc(project.name)}</b> — ${tr('the session goes on here.', 'сессия продолжается здесь.')} ${gone ? tr('Removed from the cloud.', 'Из облака удалён.') : tr("Couldn't remove it from the cloud; a copy stays there.", 'Удалить его из облака не вышло, копия осталась там.')}`,
      modelLine(topics.get(key)),
    ].join('\n'))
  }

  bot.callbackQuery(/^b:([\w-]+):(.+)$/, async ctx => {
    const [, deviceId, projectId] = ctx.match
    const dev = gateway.device(deviceId)
    const project = dev?.projects.find(p => p.id === projectId)
    if (!dev || !project) return ctx.answerCallbackQuery(tr('The computer or project is no longer available', 'Компьютер или проект уже недоступны'))
    const topicId = topicOf(ctx.callbackQuery.message)
    const key = topicKey(ctx.chat!.id, topicId)
    const l = liveOf(key)
    // §12: no switching under a running operation
    if (l.busy) return ctx.answerCallbackQuery(tr('Wait for the task to finish first, or /stop', 'Сначала дождись конца задачи или /stop'))
    const t = topics.bind(key, deviceId, projectId)
    await ctx.answerCallbackQuery(project.name)
    const many = profiles.list().length > 1
    const shown = ctx.callbackQuery.message?.message_id
    if (shown && await editRich(ctx.chat!.id, shown, boundMarkdown(dev, project, t, deviceId), undefined, many ? profileKeyboard(t.profile).inline_keyboard : undefined)) {
      if (!continueTask(key, deviceId, project) && l.queue.length) processQueue(key)
      return
    }
    await ctx.editMessageText(
      `<b>${osIcon(dev)} ${esc(dev.name)} · 📁 ${esc(project.name)}</b>\n${t.sessionId ? tr('The session continues.', 'Сессия продолжается.') : tr('New session.', 'Новая сессия.')}\n${modelLine(t)}${cloudNote(deviceId)}${many ? `\n${tr('Claude profile', 'Профиль Claude')}: <b>${profiles.nameOf(t.profile)}</b>` : ''}`,
      many ? { ...HTML, reply_markup: profileKeyboard(t.profile) } : HTML,
    )
    if (!continueTask(key, deviceId, project) && l.queue.length) processQueue(key)
  })

  bot.callbackQuery('nop', async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    const l = liveOf(key)
    // §12: no switching under a running operation
    if (l.busy) return ctx.answerCallbackQuery(tr('Wait for the task to finish first, or /stop', 'Сначала дождись конца задачи или /stop'))
    const t = topics.unbind(key)
    continueAfterBind.delete(key)
    log.info('no project', { key })
    await ctx.answerCallbackQuery(tr('No project', 'Без проекта'))
    await ctx.editMessageText(`${tr("💬 <b>No project</b>: just a conversation, no computer or folders. If files are needed, Claude offers to open a project itself.", '💬 <b>Без проекта</b> — просто разговор, без компьютера и папок. Понадобятся файлы — Claude сам предложит открыть проект.')}\n${modelLine(t)}`, HTML).catch(() => {})
    if (l.queue.length) processQueue(key)
  })

  // --- /computer: the same conversation on another computer. It lives on the server, so only the folder must be there
  const stillHere = (t: Topic) => {
    if (!t.deviceId) return tr('Choose a project first: /project', 'Сначала выбери проект: /project')
    if (isCloud(t.deviceId)) return tr('This project is in the cloud: /move carries it to a computer.', 'Этот проект в облаке: на компьютер его переносит /move.')
    // Its folder is a worktree of a repository on that computer
    if (t.worktree) return tr('This agent works on a branch of its own on this computer: start a new agent there instead.', 'Этот агент работает в своей ветке на этом компьютере: лучше запустить нового агента там.')
    return null
  }
  const goRow = (d: { id: string, os?: keyof typeof OS_ICON, name: string }) => [{ text: tr(`${iconOf(d)} To ${d.name}`, `${iconOf(d)} На ${d.name}`), data: `cs:go:${d.id}` }]
  const goKeyboard = (rows: RichButton[][]) => {
    const kb = new InlineKeyboard()
    for (const row of rows) {
      for (const b of row) kb.text(b.text, b.data)
      kb.row()
    }
    return kb
  }

  bot.command('computer', ctx => {
    const topicId = topicOf(ctx.msg)
    const t = topics.get(topicKey(ctx.chat.id, topicId))
    const blocked = stillHere(t)
    if (blocked) return ctx.reply(blocked, where(topicId))
    const others = otherComputers(gateway.devices(), t.deviceId)
    if (!others.length) return ctx.reply(tr('No other computer is online.', 'Других компьютеров в сети нет.'), where(topicId))
    const rows = others.map(goRow)
    return sendChoice(ctx.chat.id, topicId, [
      `**${tr('Now', 'Сейчас')}:** ${esc(deviceName(t.deviceId!))}`,
      tr('The conversation goes on wherever you switch to: only the folder has to be there.', 'Разговор продолжится там, куда перейдёшь: нужна только папка проекта.'),
    ].join('\n\n'), rows, goKeyboard(rows))
  })

  // Claude's offer of another computer, from its own turn. Only a tap switches anything
  async function suggestComputer(key: string, p: { computer: string, reason: string }) {
    const { chatId, topicId } = parseKey(key)
    const t = topics.get(key)
    const others = otherComputers(gateway.devices(), t.deviceId)
    const d = findComputer(others, p.computer)
    if (!d) return `No computer «${p.computer}» to switch to. Online: ${others.map(o => o.name).join(', ') || 'none'}.`
    const rows: RichButton[][] = [
      [{ text: tr(`${iconOf(d)} Go to ${d.name}`, `${iconOf(d)} Перейти на ${d.name}`), data: `cs:try:${d.id}`, style: 'primary' }],
      ...(t.head ? [] : [[{ text: tr(`🤖 Start an agent there`, `🤖 Запустить там агента`), data: `cs:agent:${d.id}` }]]),
      [{ text: tr('Stay here', 'Остаться здесь'), data: 'cs:stay' }],
    ]
    log.info('computer suggested', { key, device: d.id })
    const choice = await keepLoud(() => sendChoice(chatId, topicId, `**${tr(`Better on ${d.name}.`, `Лучше на ${d.name}.`)}** ${defuseButtons(p.reason)}`, rows, goKeyboard(rows)))
    offers.open(key, 'computer', choice?.messageId)
    return 'The buttons are already in the chat, just above your final reply. End your turn now with one short line (do not call them "below"); the next message tells you what was chosen.'
  }

  // Everything that ends on another computer: holds the topic while files travel, then the queue goes on there
  async function switchComputer(key: string, targetId: string, status: (html: string) => Promise<unknown>, prepare: () => Promise<Project>, came?: string) {
    const l = liveOf(key)
    l.busy = true
    let project: Project | undefined
    try {
      project = await prepare()
      topics.bind(key, targetId, project.id, { carry: true })
      // Chrome belongs to the computer the topic has just left
      topics.set(key, { browser: false, browserAuto: false, envCame: came })
      const d = gateway.device(targetId)
      log.info('computer switched', { key, device: targetId, project: project.id })
      await status(`<b>${d ? osIcon(d) : '💻'} ${esc(deviceName(targetId))} · 📁 ${esc(project.name)}</b>\n${tr('The conversation goes on here.', 'Разговор продолжается здесь.')}`)
      armDeferred(key)
    } catch (e) {
      log.warn('computer switch failed', { key, device: targetId, error: (e as Error).message })
      continueAfterBind.delete(key)
      await status(tr(`⚠️ <b>Didn't switch:</b> ${esc((e as Error).message)}\nThe topic stays where it was.`, `⚠️ <b>Не перешёл:</b> ${esc((e as Error).message)}\nТопик остался на прежнем месте.`))
    } finally {
      l.busy = false
    }
    if (project && continueTask(key, targetId, project)) return
    if (l.queue.length) processQueue(key)
  }

  const created = async (targetId: string, name: string) => {
    const out = await gateway.request(targetId, { projectId: '', bindingVersion: 0, tool: 'create_project', params: { name } })
    if (!out.ok) throw new Error(out.error.message)
    return out.result as Project
  }

  // The address the project pushes to, when it has one worth cloning from
  // With the computer off, what was read while it was on
  const remoteFor = (t: Topic) => `${t.deviceId}:${t.projectId}`
  async function remoteOf(t: Topic, key?: string) {
    if (!t.deviceId || !gateway.device(t.deviceId)) return t.remote?.for === remoteFor(t) ? t.remote.url : null
    const out = await gateway.request(t.deviceId, { projectId: t.projectId!, bindingVersion: t.bindingVersion, tool: 'run_command', params: { program: 'git', args: ['remote', 'get-url', 'origin'], timeoutSec: 15 } })
    const url = out.ok ? cloneableRemote(String((out.result as { stdout?: string }).stdout ?? '')) : null
    if (key && out.ok) topics.set(key, { remote: { for: remoteFor(t), url } })
    return url
  }
  // The same repository, however its address is written
  const repoOf = (url: string) => url.trim().replace(/^(https?:\/\/|ssh:\/\/)/i, '').replace(/^[^/@]*@/, '').replace(':', '/').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase()
  // A branch of this topic's project on another computer: pushed from here, cloned or fetched there. Code travels through
  // its remote, the one way that keeps both sides in step; what isn't committed stays here. via: for tests, which have
  // no remote a real project would
  async function syncBranch(key: string, p: SyncBranch, via?: string): Promise<string> {
    const t = topics.get(key)
    const here = t.deviceId ? gateway.device(t.deviceId) : undefined
    const source = here?.projects.find(x => x.id === t.projectId)
    if (!here || !source) return 'This topic has no project on a computer that is online.'
    const target = findComputer(gateway.devices(), p.computer)
    if (!target || target.id === here.id) return `No other computer named "${p.computer}" is online.`
    if (target.locked) return `${target.name} is locked at the computer: nothing can be done there.`
    const url = via ?? await remoteOf(t)
    if (!url) return 'This project has no git remote to go through (git remote get-url origin). Push it to a remote first, or send files with copy_files.'
    const out = async (deviceId: string, projectId: string, args: string[], timeoutSec = 120) => {
      const r = await git(deviceId, projectId, args, timeoutSec)
      return { failed: gitFailed(r), text: gitOut(r).trim() }
    }
    const branch = p.branch ?? (await out(here.id, source.id, ['rev-parse', '--abbrev-ref', 'HEAD'])).text
    if (!/^[\w][\w./-]{0,100}$/.test(branch) || branch === 'HEAD') return 'No branch to send: the project is on a detached HEAD. Name a branch.'
    const pushed = (await out(here.id, source.id, ['push', '-q', 'origin', branch], 600)).failed
    if (pushed) return `git push origin ${branch} failed on ${here.name}: ${pushed}`
    const head = (await out(here.id, source.id, ['rev-parse', '--short', branch])).text
    const dirty = (await out(here.id, source.id, ['status', '--porcelain'])).text.split('\n').filter(Boolean).length
    // By the repository's own name, whatever worktree this topic is in
    const root = (source.worktreeOf && here.projects.find(x => x.id === source.worktreeOf)) || source
    let there = (await gateway.refreshProjects(target.id)).find(x => !x.worktreeOf && x.name === root.name)
    const skip = sparsePatterns(root.worktreeSkip ?? source.worktreeSkip ?? [])
    let made = false
    if (there) {
      const its = (await out(target.id, there.id, ['remote', 'get-url', 'origin'])).text
      if (!its || repoOf(its) !== repoOf(url)) return `${target.name} has a project "${root.name}" that is not a clone of this repository: nothing was changed there.`
      if ((await out(target.id, there.id, ['status', '--porcelain'])).text) return `The copy on ${target.name} has uncommitted changes: nothing was changed there. An agent there commits or discards them first.`
      const fetched = (await out(target.id, there.id, ['fetch', '-q', 'origin', branch], 900)).failed
      if (fetched) return `git fetch on ${target.name} failed: ${fetched}`
      const has = !(await out(target.id, there.id, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`])).failed
      const moved = has
        ? (await out(target.id, there.id, ['checkout', '-q', branch], 600)).failed ?? (await out(target.id, there.id, ['merge', '-q', '--ff-only', `origin/${branch}`], 600)).failed
        : (await out(target.id, there.id, ['checkout', '-q', '-b', branch, '--track', `origin/${branch}`], 600)).failed
      if (moved) return `The copy on ${target.name} could not be moved to ${branch} as pushed: ${moved}. If it has commits of its own on that branch, an agent there pushes or drops them first.`
    } else {
      // The cloud's projects are on the server's own disk, with nothing to stop them filling it
      if (isCloud(target.id) && diskLow(serverDisk())) return `The server's disk is nearly full (${Math.round((serverDisk()?.free ?? 0) / 1024 ** 3)} GB free): no new project is cloned to ${target.name} until the user frees room (/cleanup). Tell the user.`
      try {
        there = await created(target.id, root.name)
      } catch (e) {
        return `No project folder could be made on ${target.name}: ${(e as Error).message}`
      }
      made = true
      const failed = (await out(target.id, there.id, ['clone', '-q', '--filter=blob:none', '--no-checkout', url, '.'], 900)).failed
        ?? (skip.length > 1 ? (await out(target.id, there.id, ['sparse-checkout', 'set', '--no-cone', ...skip])).failed : null)
        ?? (await out(target.id, there.id, ['checkout', '-q', branch], 900)).failed
      if (failed) return `The folder "${root.name}" on ${target.name} was made, but git didn't fill it: ${failed}`
    }
    // Submodules are part of the code: tests that need one fail without it in ways that say nothing of why
    const subs = !(await out(target.id, there.id, ['config', '--file', '.gitmodules', '--get-regexp', 'path'])).failed
    const subFailed = subs ? (await out(target.id, there.id, ['submodule', 'update', '--init', '-q'], 900)).failed : null
    await gateway.refreshProjects(target.id).catch(() => {})
    log.info('branch synced', { key, from: here.id, to: target.id, project: root.name, branch, made })
    return [
      `${branch} (${head}) is on ${target.name}, in the project "${root.name}"${made ? ', cloned just now' : ''}: start_agent with device "${target.name}" and project "${root.name}" works there.`,
      dirty ? `Not committed here, so not there: ${dirty} ${dirty === 1 ? 'file' : 'files'}.` : '',
      made && skip.length > 1 ? `Left out there, as .worktree-skip says: ${skip.slice(1).map(s => s.slice(2, -1)).join(', ')}.` : '',
      subFailed ? `Its submodules could not be brought: ${subFailed}` : '',
      'Tools the project needs are not installed by this: the agent there checks them first (command -v) and installs what is missing into its home folder.',
    ].filter(Boolean).join(' ')
  }

  // Once per project on a computer, and only while the cloud is there to use it: the day the computer is off is too late to ask it
  async function rememberRemote(key: string) {
    const t = topics.get(key)
    if (t.remote?.for === remoteFor(t)) return
    await remoteOf(t, key)
  }

  bot.callbackQuery(/^cs:(go|try|new|git|copy|agent|stay|no|pick|use)(?::([\w-]+))?(?::([\w-]+))?$/, async ctx => {
    const chatId = ctx.chat!.id
    const message = ctx.callbackQuery.message as Message | undefined
    const topicId = topicOf(message)
    const key = topicKey(chatId, topicId)
    const [, what, targetId, projectId] = ctx.match
    const status = (html: string) => ctx.editMessageText(html, HTML).catch(() => {})
    if (what === 'no') {
      await ctx.answerCallbackQuery()
      await status(tr('Stayed where it was.', 'Топик остался на прежнем месте.'))
      // The same as "stay" when it came from Claude's offer: it is waiting to hear
      if (continueAfterBind.delete(key)) enqueue(chatId, topicId, `[The user stays on this computer. Go on here.]`, { reply: false, shownId: message?.message_id })
      return
    }
    // Claude waits to hear what was chosen
    if (what === 'stay') {
      await ctx.answerCallbackQuery()
      await status(tr('Stayed here.', 'Остаёмся здесь.'))
      return enqueue(chatId, topicId, `[The user stays on this computer. Go on here.]`, { reply: false, shownId: message?.message_id })
    }
    const t = topics.get(key)
    const blocked = stillHere(t)
    if (blocked) return ctx.answerCallbackQuery({ text: blocked, show_alert: true })
    // §12: no switching under a running operation
    if (liveOf(key).busy) return ctx.answerCallbackQuery(tr('Wait for the task to finish first, or /stop', 'Сначала дождись конца задачи или /stop'))
    const target = targetId ? gateway.device(targetId) : undefined
    if (!target) return ctx.answerCallbackQuery(tr('This computer is offline now', 'Этот компьютер уже не в сети'))
    if (target.id === t.deviceId) return ctx.answerCallbackQuery(tr('The topic is already there', 'Топик уже там'))
    await ctx.answerCallbackQuery()

    if (what === 'agent') {
      await status(tr(`🤖 An agent on ${esc(target.name)}`, `🤖 Агент на ${esc(target.name)}`))
      return enqueue(chatId, topicId, `[The user wants an agent on ${target.name} for this: call start_agent with device "${target.id}" and everything it needs in its task. It sees nothing of this conversation, and its computer has none of this one's files: code comes through git, anything else with copy_files.]`, { reply: false, shownId: message?.message_id })
    }
    if (what === 'try') continueAfterBind.add(key)

    const here = gateway.device(t.deviceId!)
    const source = here?.projects.find(p => p.id === t.projectId)
    const name = source?.name ?? t.projectId!
    if (what === 'new') return background(switchComputer(key, target.id, status, () => created(target.id, name), 'The project folder here is new and empty, by the user\'s choice.'))
    if (what === 'copy') {
      if (!source) return status(tr(`⚠️ ${esc(deviceName(t.deviceId!))} is offline: nothing to copy from.`, `⚠️ ${esc(deviceName(t.deviceId!))} не в сети: копировать неоткуда.`))
      return background(switchComputer(key, target.id, status, async () => (await copyProject({
        fromId: t.deviceId!,
        source,
        bindingVersion: t.bindingVersion,
        targetId: target.id,
        names: [name],
        changed: tr('files in the project changed while packing: wait until everything there is done, then try again', 'файлы проекта менялись во время упаковки: дождись, пока всё закончится, и повтори'),
        status,
      })).project, `The project folder was just copied here from ${deviceName(t.deviceId!)}, by the user's choice, without node_modules and the like.`))
    }
    if (what === 'git') {
      return background(switchComputer(key, target.id, status, async () => {
        const url = await remoteOf(t)
        if (!url) throw new Error(tr('the project has no address to clone from', 'у проекта нет адреса, откуда клонировать'))
        await status(tr(`📥 Cloning on ${esc(target.name)}…`, `📥 Клонирую на ${esc(target.name)}…`))
        const project = await created(target.id, name)
        const out = await gateway.request(target.id, { projectId: project.id, bindingVersion: 0, tool: 'run_command', params: { program: 'git', args: ['clone', url, '.'], timeoutSec: 900 } })
        const r = out.ok ? out.result as { exitCode: number | null, stderr: string } : null
        if (!r || r.exitCode !== 0) throw new Error(tr(`the folder on ${target.name} was created, but git didn't fill it: `, `папка на ${target.name} создана, но git её не заполнил: `) + (out.ok ? r!.stderr.trim().slice(-300) : out.error.message))
        return project
      }, 'The project folder here was just cloned from its git remote, by the user\'s choice: only what was pushed came along.'))
    }

    // One the user picks among the projects there, when none is the topic's own
    const projects = (await gateway.refreshProjects(target.id)).filter(p => !p.hidden)
    if (what === 'use') {
      const picked = projects.find(p => p.id === projectId)
      if (!picked) return status(tr('⚠️ That project is gone from there: try /computer again.', '⚠️ Такого проекта там уже нет: повтори /computer.'))
      return background(switchComputer(key, target.id, status, async () => picked, 'The project folder here is a different one, picked by the user: its files may not be what you saw before.'))
    }
    if (what === 'pick') {
      const rows: RichButton[][] = [...projects.slice(0, PICK_MAX).map(p => [{ text: `📁 ${p.name}`, data: `cs:use:${target.id}:${p.id}` }]), [{ text: tr('Cancel', 'Отмена'), data: 'cs:no' }]]
      const md = tr(`**Which project on ${target.name}?**`, `**Какой проект на ${target.name}?**`)
      if (!message || !await editRich(chatId, message.message_id, `${md}\n\n${richButtons(rows)}`)) await status(tr('Telegram refused the buttons: try /computer again.', 'Telegram не принял кнопки: повтори /computer.'))
      return
    }
    // go, try: straight there if the folder is already on that computer. In the cloud a folder of the same name is the same project
    const same = projects.find(p => p.id === t.projectId || (isCloud(target.id) && p.name === name))
    if (same) return background(switchComputer(key, target.id, status, async () => same))
    const remote = await remoteOf(t, key)
    const toCloud = isCloud(target.id)
    const rows: RichButton[][] = [
      ...(remote ? [[{ text: tr('📥 From git', '📥 Из git'), data: `cs:git:${target.id}` }]] : []),
      ...(projects.length ? [[{ text: tr(`📂 Pick a project on ${target.name}`, `📂 Выбрать проект на ${target.name}`), data: `cs:pick:${target.id}` }]] : []),
      ...(source && !toCloud ? [[{ text: tr(`📦 Copy from ${here!.name}`, `📦 Скопировать с ${here!.name}`), data: `cs:copy:${target.id}` }]] : []),
      [{ text: tr('🆕 Empty folder', '🆕 Пустая папка'), data: `cs:new:${target.id}` }],
      [{ text: tr('Cancel', 'Отмена'), data: 'cs:no' }],
    ]
    const md = [
      tr(`**${target.name} has no folder “${name}”.** What goes in it?`, `**На ${target.name} нет папки «${name}».** Что в неё положить?`),
      [
        ...(remote ? [tr('- **From git:** what has been pushed', '- **Из git:** то, что запушено')] : []),
        ...(projects.length ? [tr('- **Pick:** a project already there', '- **Выбрать:** проект, который уже там')] : []),
        ...(source && !toCloud ? [tr(`- **Copy:** everything as it is now, without ${MOVE_SKIP.map(s => `\`${s}\``).join(', ')}`, `- **Копия:** всё как сейчас, кроме ${MOVE_SKIP.map(s => `\`${s}\``).join(', ')}`)] : []),
      ].join('\n'),
    ].filter(Boolean).join('\n\n')
    if (!message || !await editRich(chatId, message.message_id, `${md}\n\n${richButtons(rows)}`)) await status(tr('Telegram refused the buttons: try /computer again.', 'Telegram не принял кнопки: повтори /computer.'))
  })

  // --- Claude in a topic without a project offers one: new folder on an online computer, or an existing project
  const suggestions = new Map<string, { key: string, name?: string }>()
  const continueAfterBind = new Set<string>()

  async function suggestProject(key: string, p: { name?: string, reason: string }) {
    const { chatId, topicId } = parseKey(key)
    const online = gateway.devices()
    if (!online.length) return 'No computer is online: tell the user the project can be opened once a computer is on.'
    const id = randomBytes(4).toString('hex')
    const name = p.name && /^[\w.-]{1,40}$/.test(p.name) ? p.name : undefined
    suggestions.set(id, { key, name })
    const kb = new InlineKeyboard()
    for (const d of online) kb.text(name ? tr(`📁 New “${name}” ${onDevice(d)}`, `📁 Новый «${name}» ${onDevice(d)}`) : tr(`📁 New project ${onDevice(d)}`, `📁 Новый проект ${onDevice(d)}`), `spn:${d.id}:${id}`).row()
    kb.text(tr('📂 Choose a project', '📂 Выбрать проект'), `spp:${id}`)
    log.info('project suggested', { key, name })
    const sent = await sendRich(chatId, topicId, `**${tr('This needs a project.', 'Для этого нужен проект.')}** ${defuseButtons(p.reason)}`, { reply_markup: kb })
    offers.open(key, 'project', sent.ids.at(-1))
    return 'The buttons are already in the chat, just above your final reply. End your turn now with one short line (do not call them "below"); the next message tells you which project was opened.'
  }

  // After a project is opened from Claude's offer, Claude is told so and continues the task by itself
  function continueTask(key: string, deviceId: string, project: Project) {
    if (!continueAfterBind.delete(key)) return false
    const { chatId, topicId } = parseKey(key)
    enqueue(chatId, topicId, `[Opened the project “${project.name}” on ${gateway.device(deviceId)?.name ?? deviceId}, root ${project.path}. Go on with the task.]`, { reply: false })
    return true
  }

  bot.callbackQuery(/^spn:([\w-]+):([0-9a-f]{8})$/, async ctx => {
    const sug = suggestions.get(ctx.match[2])
    if (!sug) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    const deviceId = ctx.match[1]
    if (!gateway.device(deviceId)) return ctx.answerCallbackQuery(tr('This computer is offline now', 'Этот компьютер уже не в сети'))
    if (liveOf(sug.key).busy) return ctx.answerCallbackQuery(tr('Wait for the task to finish first, or /stop', 'Сначала дождись конца задачи или /stop'))
    suggestions.delete(ctx.match[2])
    continueAfterBind.add(sug.key)
    await ctx.answerCallbackQuery()
    if (!sug.name) {
      liveOf(sug.key).newProjectOn = deviceId
      return ctx.editMessageText(nameQuestion(deviceId), HTML).catch(() => {})
    }
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(`📁 «${sug.name}» ${onDevice(gateway.device(deviceId)!)}`, 'noop') }).catch(() => {})
    await createProject(sug.key, deviceId, sug.name)
  })

  bot.callbackQuery(/^spp:([0-9a-f]{8})$/, async ctx => {
    const sug = suggestions.get(ctx.match[1])
    if (!sug) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    suggestions.delete(ctx.match[1])
    continueAfterBind.add(sug.key)
    await ctx.answerCallbackQuery()
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(tr('📂 Choosing a project…', '📂 Выбираю проект…'), 'noop') }).catch(() => {})
    const { chatId, topicId } = parseKey(sug.key)
    await sendPicker(chatId, topicId, tr('Choose a project for this topic:', 'Выбери проект для этого топика:'))
  })

  // Claude's answer to "rename this topic": what Telegram said goes back to it, so it won't claim a name that didn't change
  const renameTopic = (chatId: number, topicId: number, raw: string) => {
    const name = masked(chatId, topicId, raw, true)
    return api.editForumTopic(chatId, topicId, { name })
      .catch(e => {
        // It has this name already, which the bot may not have known: a topic named before it kept names, or by the user
        if (!/TOPIC_NOT_MODIFIED/i.test((e as Error).message)) throw e
      })
      .then(() => {
        topics.set(topicKey(chatId, topicId), { title: name })
        return 'Renamed.'
      }, e => `Telegram refused: ${(e as Error).message}`)
  }

  // A topic of a workspace starts from its settings. True when that leaves nothing to choose
  function inheritWorkspace(key: string) {
    const w = workspaces.get(parseKey(key).chatId)
    const t = topics.get(key)
    if (!w) return false
    if (t.noProject || (t.deviceId && t.projectId)) return true
    topics.set(key, inherited(w, t))
    if (!w.deviceId || !w.projectId) return false
    topics.bind(key, w.deviceId, w.projectId)
    return true
  }

  // Outside a workspace a new topic never inherits a computer or project: nothing runs until the user picks both
  bot.command('topic', async ctx => {
    if (workspaces.get(ctx.chat.id)?.plain) return ctx.reply(NO_TOPICS())
    const name = trunc(ctx.match?.trim() || tr('New chat', 'Новый чат'), 128)
    try {
      const topic = await api.createForumTopic(ctx.chat.id, name)
      // Telegram doesn't report a topic the bot itself made. Without a name of the user's, the first task names it
      topics.set(topicKey(ctx.chat.id, topic.message_thread_id), { nameImplicit: !ctx.match?.trim(), title: name })
      if (inheritWorkspace(topicKey(ctx.chat.id, topic.message_thread_id))) return void await sendRich(ctx.chat.id, topic.message_thread_id, tr('New topic: write your task here.', 'Новый топик: пиши задачу здесь.'))
      await sendPicker(ctx.chat.id, topic.message_thread_id, tr('New topic.', 'Новый топик.'))
    } catch (e) {
      await ctx.reply(tr(`⚠️ <b>Couldn't create the topic:</b> ${esc(failureText(e))}\nTurn topics on: @BotFather → the bot → Bot Settings → Threaded Mode.`, `⚠️ <b>Не получилось создать топик:</b> ${esc(failureText(e))}\nВключи топики: @BotFather → бот → Bot Settings → Threaded Mode.`), HTML)
    }
  })

  bot.on('message:forum_topic_edited', ctx => {
    const name = ctx.msg.forum_topic_edited.name
    if (name) topics.set(topicKey(ctx.chat.id, ctx.msg.message_thread_id), { title: name })
  })

  // A topic the user created, usually by writing its first message: name it from that message;
  // the message waits in the queue until a computer and project are picked
  bot.on('message:forum_topic_created', async ctx => {
    const topicId = ctx.msg.message_thread_id!
    topics.set(topicKey(ctx.chat.id, topicId), { nameImplicit: !!ctx.msg.forum_topic_created.is_name_implicit, title: ctx.msg.forum_topic_created.name })
    if (inheritWorkspace(topicKey(ctx.chat.id, topicId))) return
    if (!pickerFresh(liveOf(topicKey(ctx.chat.id, topicId)))) await sendPicker(ctx.chat.id, topicId, tr("New topic. I'll answer once you choose where to work.", 'Новый топик. Отвечу, когда выберешь, где работать.'))
  })

  // --- permissions ------------------------------------------------------------------------------
  bot.callbackQuery(/^(ok|no|all|forever):(\d+)$/, async ctx => {
    const id = Number(ctx.match[2])
    const p = pending.get(id)
    // Only the button under the question itself, in the topic it was asked in
    if (!p || p.key !== topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))) {
      await ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
      return ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(tr('⌛ No longer relevant', '⌛ Неактуально'), 'noop') }).catch(() => {})
    }
    pending.delete(id)
    clearTimeout(p.timer)
    showState(p.key, 'idle')
    const verdict = ctx.match[1] as Verdict
    if (verdict === 'all') p.live.allowAll = true
    // An explicit, lasting rule for this topic (§13); /mode switches it back
    if (verdict === 'forever') topics.set(p.key, { mode: 'all' })
    log.info('permission', { key: p.key, tool: p.tool, verdict })
    // Allowed with exactly the parameters the user saw (§13)
    p.resolve(verdict === 'no'
      ? { behavior: 'deny', message: 'The user denied this action in Telegram.' }
      : { behavior: 'allow', updatedInput: p.input })
    await ctx.answerCallbackQuery(verdictLabel(verdict))
    if (p.choice) await editRich(ctx.chat!.id, p.choice.messageId, `${p.choice.md}\n\n> **${verdictLabel(verdict)}**`)
    else await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(verdictLabel(verdict), 'noop') })
  })
  bot.callbackQuery('noop', ctx => ctx.answerCallbackQuery())

  // Suggestions are over, answered or passed by: the buttons leave the message. False when it can't be edited
  async function settleButtons(chatId: number, s: Pick<Suggestion, 'messageId' | 'md' | 'media' | 'keyboard'>, choice?: string) {
    if (!s.messageId || !s.md) return false
    return editRich(chatId, s.messageId, settledMarkdown(s.md, choice), s.media, s.keyboard)
  }

  async function editRich(chatId: number, messageId: number, markdown: string, media?: SentMedia[], keyboard?: InlineKeyboard['inline_keyboard']) {
    try {
      await api.raw.editMessageText({ chat_id: chatId, message_id: messageId, rich_message: { markdown, ...(media?.length && { media: media as never }) }, ...(keyboard && { reply_markup: { inline_keyboard: keyboard } }) })
      return true
    } catch (e) {
      // Already reads so: after a restart the bot no longer knows what it last wrote there
      if (/message is not modified/.test((e as Error).message)) return true
      log.warn('rich message not edited', (e as Error).message)
      return false
    }
  }

  // A decision to make, with its buttons inside the message. Whatever gets in the way, the buttons must arrive: a
  // question without them would hold the task until it times out. So rich only when it can be sent and edited as it
  // is, else the ordinary keyboard; null then
  async function sendChoice(chatId: number, topicId: number | undefined, md: string, rows: RichButton[][], keyboard: InlineKeyboard): Promise<Choice | null> {
    if (masked(chatId, topicId, md, true) === md && splitMarkdown(md).length === 1) {
      try {
        const sent = await api.sendRichMessage(chatId, { markdown: `${md}\n\n${richButtons(rows)}` }, where(topicId))
        return { messageId: sent.message_id, md }
      } catch (e) {
        log.warn('rich buttons refused, sending a keyboard', (e as Error).message)
      }
    }
    await sendRich(chatId, topicId, md, { reply_markup: keyboard })
    return null
  }

  // A tap on a reply Claude suggested counts as the user writing it: it stays visible in the message, and the answer
  // comes as a reply to that
  bot.callbackQuery(/^sug:(\w+):(\d)$/, async ctx => {
    const chatId = ctx.chat!.id
    const topicId = topicOf(ctx.callbackQuery.message)
    const key = topicKey(chatId, topicId)
    const s = topics.get(key).suggested
    const reply = s?.id === suggestionId(ctx.match[1]) ? s.replies[Number(ctx.match[2])] : undefined
    if (!reply) return ctx.answerCallbackQuery(tr('No longer relevant: just write your message', 'Уже неактуально, просто напиши сообщение'))
    topics.set(key, { suggested: undefined })
    await ctx.answerCallbackQuery()
    const msgId = await settleButtons(chatId, s!, reply)
      ? s!.messageId!
      : (await api.sendMessage(chatId, `👉 ${esc(masked(chatId, topicId, reply))}`, { ...where(topicId), ...HTML })).message_id
    enqueue(chatId, topicId, reply, { msgId })
  })

  bot.callbackQuery(/^again:(\d+)$/, async ctx => {
    const id = Number(ctx.match[1])
    const r = retries.get(id)
    if (!r) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    retries.delete(id)
    await ctx.answerCallbackQuery(tr('Sending', 'Отправляю'))
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(tr('🔁 Sent', '🔁 Отправлено'), 'noop') })
    const { chatId, topicId } = parseKey(r.key)
    enqueue(chatId, topicId, r.prompt, { images: r.images, reply: false, fromMode: r.fromMode, ownAnswers: r.ownAnswers })
  })

  // --- questions from Claude (AskUserQuestion) --------------------------------------------------
  const questionKeyboard = (id: number, q: Question, selected: Set<number>) => {
    const kb = new InlineKeyboard()
    q.options.forEach((o, i) => kb.text(`${q.multiSelect ? (selected.has(i) ? '☑️ ' : '⬜ ') : ''}${redact(starredLabel(o.label)).text}`, `qa:${id}:${i}`).row())
    if (q.multiSelect) kb.text(tr('Done', 'Готово'), `qa:${id}:done`)
    return kb
  }

  const questionRows = (id: number, q: Question, selected: ReadonlySet<number>) => questionButtons(q, selected, choice => `qa:${id}:${choice}`)

  bot.callbackQuery(/^qa:(\d+):(\d+|done)$/, async ctx => {
    const id = Number(ctx.match[1])
    const a = asking.get(id)
    if (!a) {
      await ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
      return ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(tr('⌛ No longer relevant', '⌛ Неактуально'), 'noop') }).catch(() => {})
    }
    const choice = ctx.match[2]
    let answer: string
    if (choice === 'done') {
      if (!a.selected.size) return ctx.answerCallbackQuery(tr('Tick at least one option', 'Отметь хотя бы один вариант'))
      answer = [...a.selected].sort().map(i => a.q.options[i].label).join(', ')
    } else {
      const i = Number(choice)
      if (!a.q.options[i]) return ctx.answerCallbackQuery()
      if (a.q.multiSelect) {
        if (a.selected.has(i)) a.selected.delete(i)
        else a.selected.add(i)
        await ctx.answerCallbackQuery()
        if (a.choice) return editRich(ctx.chat!.id, a.choice.messageId, `${a.choice.md}\n\n${richButtons(questionRows(id, a.q, a.selected))}`)
        return ctx.editMessageReplyMarkup({ reply_markup: questionKeyboard(id, a.q, a.selected) })
      }
      answer = a.q.options[i].label
    }
    a.done(answer)
    await ctx.answerCallbackQuery(trunc(answer, 60))
    // A rich question has settled itself in done(): a typed answer takes its buttons away just the same
    if (!a.choice) await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(`✅ ${trunc(answer, 40)}`, 'noop') })
  })

  // One question at a time; a button or the next text message in the topic answers it
  function askOne(chatId: number, topicId: number | undefined, l: Live, q: Question, index: number, total: number, signal: AbortSignal) {
    const id = permSeq++
    return new Promise<string | null>(resolve => {
      let settled = false
      const done = (answer: string | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const choice = asking.get(id)?.choice
        if (choice) settleButtons(chatId, choice, answer ?? undefined)
        asking.delete(id)
        if (l.answer === done) l.answer = null
        resolve(answer)
      }
      const timer = setTimeout(() => done(null), PERMISSION_TIMEOUT_MS)
      asking.set(id, { key: topicKey(chatId, topicId), q, selected: new Set(), done })
      l.answer = done
      signal.addEventListener('abort', () => done(null), { once: true })
      keepLoud(() => sendChoice(chatId, topicId, questionMarkdown(q, index, total), questionRows(id, q, new Set()), questionKeyboard(id, q, new Set())))
        .then(choice => {
          const a = asking.get(id)
          if (a && choice) a.choice = choice
          // Answered in the moment it took to send
          else if (choice) settleButtons(chatId, choice)
        })
        .catch(e => {
          log.warn('question not sent', (e as Error).message)
          done(null)
        })
    })
  }

  async function askUser(chatId: number, topicId: number | undefined, l: Live, input: Record<string, unknown>, signal: AbortSignal): Promise<PermissionResult> {
    const questions = (input.questions as Question[] | undefined) ?? []
    notifyHead(topicKey(chatId, topicId), tr('asked you a question', 'задал тебе вопрос'))
    showState(topicKey(chatId, topicId), 'waiting')
    const answers: Record<string, string> = {}
    for (const [i, q] of questions.entries()) {
      const answer = await askOne(chatId, topicId, l, q, i, questions.length, signal)
      if (answer === null) {
        showState(topicKey(chatId, topicId), 'idle')
        return signal.aborted
          ? { behavior: 'deny', message: 'Stopped by the user.', interrupt: true }
          : { behavior: 'deny', message: "The user didn't answer the question within 30 minutes." }
      }
      answers[q.question] = answer
    }
    log.info('question answered', { key: topicKey(chatId, topicId), count: questions.length })
    showState(topicKey(chatId, topicId), 'idle')
    return { behavior: 'allow', updatedInput: { ...input, answers } }
  }

  // --- surveys: many questions in one message, answered at the user's pace ---------------------
  const drawSurvey = (key: string, s: Survey, how: { fresh?: boolean, same?: boolean } = {}) => keepLoud(() => drawSurveyCard(key, s, how))
  async function drawSurveyCard(key: string, s: Survey, { fresh = false, same = false } = {}) {
    const { chatId, topicId } = parseKey(key)
    // An edit goes straight to Telegram, and a question is whatever Claude wrote: masked like every other text
    const body = `${masked(chatId, topicId, surveyMarkdown(s), true)}\n\n${richButtons(surveyRows(s))}`
    // Ticking a box on the question at hand
    const image = s.questions[s.index].image
    if (same && s.messageId && (s.picture || !image) && await editRich(chatId, s.messageId, s.picture ? `${s.picture}\n\n${body}` : body, s.media)) return
    // An edit can't upload a picture, and leaving one behind would show it under the wrong question. Below a message
    // the user just wrote, an edit would happen out of their sight
    if (!fresh && !image && !s.media && s.messageId && await editRich(chatId, s.messageId, body)) return
    if (s.messageId) await api.deleteMessage(chatId, s.messageId).catch(e => log.debug('survey card', (e as Error).message))
    s.messageId = undefined
    s.media = undefined
    s.picture = undefined
    if (image) {
      const t = topics.get(key)
      const op = t.deviceId && t.projectId ? { deviceId: t.deviceId, projectId: t.projectId, bindingVersion: t.bindingVersion } : undefined
      const sent = await sendRichWithDeviceMedia(chatId, topicId, `![](${image})\n\n${body}`, op).catch(e => {
        log.warn('survey picture', (e as Error).message)
        return null
      })
      s.messageId = sent?.ids.at(-1)
      s.media = sent?.last?.media
      s.picture = sent?.last?.md.match(/!\[\]\(tg:\/\/[^)]*\)/)?.[0]
      if (sent?.ids.length) return void surveys.set(key, s)
    }
    const rows = surveyRows(s)
    const choice = await sendChoice(chatId, topicId, surveyMarkdown(s), rows, goKeyboard(rows))
    s.messageId = choice?.messageId
    surveys.set(key, s)
  }

  async function endSurvey(key: string, s: Survey, end: SurveyEnd) {
    const { chatId, topicId } = parseKey(key)
    surveys.drop(key)
    showState(key, 'idle')
    log.info('survey ended', { key, end, answered: answeredCount(s), of: s.questions.length })
    const line = `**📋 ${s.title ? `${s.title}: ` : ''}${end === 'complete' ? tr('all done', 'готово') : tr('finished early', 'закончен раньше')}** · ${tr('answered', 'ответов')} ${answeredCount(s)}/${s.questions.length}`
    // A card with a picture can't simply lose it: it goes
    const edited = !!s.messageId && !s.media && await editRich(chatId, s.messageId, line)
    if (s.messageId && !edited) await api.deleteMessage(chatId, s.messageId).catch(() => {})
    const shownId = edited ? s.messageId : (await sendRich(chatId, topicId, line)).ids[0]
    enqueue(chatId, topicId, surveyResult(s, end), { reply: false, silent: true, shownId, ownAnswers: true })
  }

  async function surveyStep(key: string, s: Survey, step: SurveyStep, draw: { fresh?: boolean, same?: boolean } = {}) {
    surveys.set(key, s)
    if (step === 'end') return endSurvey(key, s, 'complete')
    if (step !== 'nothing') await drawSurvey(key, s, draw)
  }

  async function startSurvey(key: string, input: SurveyInput) {
    if (surveys.get(key)) return 'Not started: a survey is still open in this topic. Its answers come when it ends: end your turn.'
    const s = newSurvey(input.questions.map(q => ({ ...q, options: q.options ?? [] })), input.title)
    surveys.set(key, s)
    showState(key, 'waiting')
    notifyHead(key, tr('sent you a survey', 'прислал тебе опрос'))
    log.info('survey started', { key, questions: s.questions.length })
    await drawSurvey(key, s)
    return `The survey is with the user: ${s.questions.length} questions, and they may take days. End your turn now with one short line. The answers arrive as your next message.`
  }

  // The question is left out on cards from before it was added to their buttons
  bot.callbackQuery(/^sv:(\w+):(?:(\d+):)?(\d+|done|back|skip|end)$/, async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    const s = surveys.get(key)
    if (!s || s.id !== ctx.match[1]) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    const choice = ctx.match[3]
    if (choice !== 'end' && ctx.match[2] !== undefined && Number(ctx.match[2]) !== s.index) return ctx.answerCallbackQuery(tr('That question has passed', 'Этот вопрос уже позади'))
    if (choice === 'end') {
      await ctx.answerCallbackQuery()
      return endSurvey(key, s, 'ended')
    }
    const step = surveyTap(s, choice)
    if (step === 'nothing') return ctx.answerCallbackQuery(choice === 'done' ? tr('Tick at least one, or press Skip', 'Отметь хотя бы один вариант или нажми «Пропустить»') : undefined)
    await ctx.answerCallbackQuery()
    return surveyStep(key, s, step, { same: step === 'toggled' })
  })

  // The ✅ / 🚫 / ⚡ / 🔓 question in Telegram; no answer in 30 minutes means no
  function askPermission(
    chatId: number, topicId: number | undefined, l: Live, key: string, tool: string, input: Record<string, unknown>,
    where_: { device: string, project: string }, signal: AbortSignal, grant = false,
  ) {
    const id = permSeq++
    const kb = new InlineKeyboard().text(tr('✅ Allow', '✅ Разрешить'), `ok:${id}`).text(tr('🚫 No', '🚫 Нет'), `no:${id}`)
    notifyHead(key, tr('is waiting for your permission', 'ждёт твоего разрешения'))
    showState(key, 'waiting')
    if (!grant) kb.row().text(tr('⚡ Allow until the task ends', '⚡ Разрешать до конца задачи'), `all:${id}`).row().text(tr('🔓 Stop asking in this topic', '🔓 Больше не спрашивать тут'), `forever:${id}`)
    const rows: RichButton[][] = [[{ text: tr('✅ Allow', '✅ Разрешить'), data: `ok:${id}`, style: 'success' }, { text: tr('🚫 No', '🚫 Нет'), data: `no:${id}`, style: 'danger' }]]
    if (!grant) rows.push([{ text: tr('⚡ Allow until the task ends', '⚡ Разрешать до конца задачи'), data: `all:${id}` }], [{ text: tr('🔓 Stop asking in this topic', '🔓 Больше не спрашивать тут'), data: `forever:${id}` }])
    const clear = (choice?: Choice) => { if (choice) editRich(chatId, choice.messageId, choice.md) }
    return new Promise<PermissionResult>(resolve => {
      const timer = setTimeout(() => {
        clear(pending.get(id)?.choice)
        pending.delete(id)
        showState(key, 'idle')
        log.info('permission', { key, tool, verdict: 'timeout' })
        resolve({ behavior: 'deny', message: "The user didn't answer within 30 minutes: the action was not taken." })
      }, PERMISSION_TIMEOUT_MS)
      pending.set(id, { resolve, tool, input, live: l, timer, key })
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        clear(pending.get(id)?.choice)
        pending.delete(id)
        resolve({ behavior: 'deny', message: 'Stopped by the user.', interrupt: true })
      }, { once: true })
      const body = permissionMarkdown(tool, input, where_)
      // What is allowed is the whole input, so the whole of it can be read
      if (isClipped(body)) sendFile(chatId, topicId, Buffer.from(masked(chatId, topicId, JSON.stringify(input, null, 2), true)), 'full-input.txt', 'text/plain').catch(e => log.warn('full input', (e as Error).message))
      // With a secret masked the card shows less than what runs: never without saying so
      const shown = redact(body).found.length ? `${body}\n\n${tr('⚠️ Part of this is hidden as a secret, so what runs may be more than you see here.', '⚠️ Часть здесь скрыта как секрет, поэтому выполнится может больше, чем ты видишь.')}` : body
      keepLoud(() => sendChoice(chatId, topicId, shown, rows, kb)).then(choice => {
        const p = pending.get(id)
        if (p && choice) p.choice = choice
        // Decided in the moment it took to send
        else clear(choice ?? undefined)
      }).catch(e => {
        clearTimeout(timer)
        pending.delete(id)
        resolve({ behavior: 'deny', message: `Couldn't ask the user: ${(e as Error).message}` })
      })
    })
  }

  // A file for a page's upload is named by its path on the computer, which the CLI on the server can't read: it comes
  // over first, through the topic's own project, under the same rules as any file read
  async function uploadFromComputer(key: string, input: Record<string, unknown>): Promise<string | { input: Record<string, unknown> }> {
    const t = topics.get(key)
    const staged = await stageUploads((input.paths as unknown[]).map(String), {
      workDir,
      pull: async path => {
        if (!t.deviceId || !t.projectId || !gateway.device(t.deviceId)) return { ok: false, error: 'the topic\'s computer is offline' }
        const got = await pullFile(params => gateway.request(t.deviceId!, { projectId: t.projectId!, bindingVersion: t.bindingVersion, tool: 'file_get', params }), path, { maxBytes: SEND_FILE_MAX_BYTES })
        return got.ok ? { ok: true, name: got.file.name, data: got.file.data } : { ok: false, error: got.error.message }
      },
    })
    if (!staged.ok) return `The file could not be brought over from the computer for the upload: ${staged.error}`
    log.info('browser upload staged', { key, files: staged.paths.length })
    return { input: { ...input, paths: staged.paths } }
  }

  const makeCanUseTool = (
    chatId: number, topicId: number | undefined, l: Live, where_: { device: string, project: string }, apps: McpServerInfo[], chromeOn = false,
  ): TurnCanUseTool =>
    async (tool, input, { signal, mcpServer, readOnly: remoteReadOnly }) => {
      const key = topicKey(chatId, topicId)
      // Second line behind interrupt(): after Stop no tool call gets through, whatever the CLI still tries
      if (l.abort?.signal.aborted) return { behavior: 'deny', message: 'Stopped by the user.', interrupt: true }
      const nightShift = shiftOf(key)
      if (nightShift && (tool === 'AskUserQuestion' || tool === ASK_SURVEY)) return { behavior: 'deny', message: 'This is a night shift: the user is asleep and nobody answers until morning. Decide yourself, and say in the summary or the report what you decided and why.' }
      if (tool === 'AskUserQuestion' && HOST_TOOLS.has(tool)) return askUser(chatId, topicId, l, input, signal)
      // Web reading is reading: no prompt, but a fetch from the server never goes to its own network
      if ((tool === 'WebSearch' || tool === 'ToolSearch') && HOST_TOOLS.has(tool)) return { behavior: 'allow', updatedInput: input }
      if (tool === 'WebFetch' && HOST_TOOLS.has(tool)) {
        // Without the VPS's firewall a name that flips to an inside address after the check could still get in
        if (sandbox?.state().state === 'open') {
          log.warn('permission', { key, tool, verdict: 'denied: sandbox open' })
          return { behavior: 'deny', message: "The server's sandbox isn't working right now, so reading pages from the server is off. The user sees the reason in /diag." }
        }
        if (await resolvedPublicUrl(String(input.url ?? ''))) {
          // Parameters in an address are how something Claude read would carry a secret out: not without a look
          if (carriesData(String(input.url)) && turnMode(key) !== 'all' && !l.allowAll) return askPermission(chatId, topicId, l, key, tool, input, where_, signal)
          return { behavior: 'allow', updatedInput: input }
        }
        log.warn('permission', { key, tool, verdict: 'denied: private address', url: input.url })
        return { behavior: 'deny', message: 'Only public internet addresses open from the server.' }
      }
      // The bot's own offer of a project: only buttons, nothing happens until the user taps one
      if (tool === SUGGEST_PROJECT && mcpServer?.source === 'sdk' && mcpServer.name === TOPIC_SERVER) return { behavior: 'allow', updatedInput: input }
      // The same for a schedule: nothing exists until the user taps, in any mode
      if (tool === SCHEDULE_TASK && mcpServer?.source === 'sdk' && mcpServer.name === SCHEDULE_SERVER) return { behavior: 'allow', updatedInput: input }
      // A message in this chat, in any mode
      if (isWidgetTool(tool) && mcpServer?.source === 'sdk' && mcpServer.name === WIDGET_SERVER) return { behavior: 'allow', updatedInput: input }
      // Reading a skill reads the bot's own folder; installing and removing are cards the user taps
      if (isSkillTool(tool) && mcpServer?.source === 'sdk' && mcpServer.name === SKILLS_SERVER) return { behavior: 'allow', updatedInput: input }
      // And for the browser: only the user's tap turns it on
      if (tool === ASK_FOR_BROWSER && mcpServer?.source === 'sdk' && mcpServer.name === BROWSER_ASK_SERVER) return { behavior: 'allow', updatedInput: input }
      // The Chrome the user already gave: starting it opens no page
      if (tool === OPEN_CHROME && mcpServer?.source === 'sdk' && mcpServer.name === BROWSER_OPEN_SERVER) return { behavior: 'allow', updatedInput: input }
      // The same for another computer: only the user's tap switches
      // An offer the user answers, and a look that changes nothing
      if ((tool === SUGGEST_COMPUTER || tool === WHERE_TO_RUN) && mcpServer?.source === 'sdk' && mcpServer.name === COMPUTER_SERVER) return { behavior: 'allow', updatedInput: input }
      // What it can start at the other end is limited there: see turnMode
      if (tool === MESSAGE_TOPIC && mcpServer?.source === 'sdk' && mcpServer.name === MESSAGE_SERVER) return { behavior: 'allow', updatedInput: input }
      // Only adds to this topic's list, which the chat shows and /stop clears
      if (tool === DEFER_TASK && mcpServer?.source === 'sdk' && mcpServer.name === DEFER_SERVER) return { behavior: 'allow', updatedInput: input }
      // Only the list and the buttons: the user's tap deletes
      if (tool === DELETE_TOPICS && mcpServer?.source === 'sdk' && mcpServer.name === DELETE_SERVER) return { behavior: 'allow', updatedInput: input }
      // Only the name of this topic, in any mode
      if (tool === RENAME_TOPIC && mcpServer?.source === 'sdk' && mcpServer.name === TOPIC_NAME_SERVER) return { behavior: 'allow', updatedInput: input }
      if (tool === OFFER_FRESH && mcpServer?.source === 'sdk' && mcpServer.name === FRESH_SERVER) return { behavior: 'allow', updatedInput: input }
      // Only a card: the session changes at the user's tap
      if (tool === OFFER_NEW_SESSION && mcpServer?.source === 'sdk' && mcpServer.name === NEW_SESSION_SERVER) return { behavior: 'allow', updatedInput: input }
      // Writes only new files into the project, and not in a read-only topic: the handler checks the mode
      if (tool === LOTTIE_TO_SVG && mcpServer?.source === 'sdk' && mcpServer.name === LOTTIE_SERVER) return { behavior: 'allow', updatedInput: input }
      // Only a card: the screen becomes Claude's at the user's tap
      if (tool === ASK_FOR_SCREEN && mcpServer?.source === 'sdk' && mcpServer.name === SCREEN_ACCESS_SERVER) return { behavior: 'allow', updatedInput: input }
      // Given by that tap for the task, and held to looking in a read-only topic by the handler
      if (tool === SCREEN_TOOL && mcpServer?.source === 'sdk' && mcpServer.name === SCREEN_SERVER) return { behavior: 'allow', updatedInput: input }
      // Asks the user itself, by the topic's mode, before anything runs on the other computer
      if (tool === ERRAND_TOOL && mcpServer?.source === 'sdk' && mcpServer.name === ERRAND_SERVER) return { behavior: 'allow', updatedInput: input }
      if (isShiftTool(tool) && mcpServer?.source === 'sdk' && mcpServer.name === SHIFT_SERVER) return { behavior: 'allow', updatedInput: input }
      // It only shows a card: the user's tap on it is the permission
      if (tool === POWER_TOOL && mcpServer?.source === 'sdk' && mcpServer.name === POWER_SERVER) return { behavior: 'allow', updatedInput: input }
      // Only a card: what it offers is written on the user's tap
      if (tool === SUGGEST_RULE && mcpServer?.source === 'sdk' && mcpServer.name === RULE_SERVER) return { behavior: 'allow', updatedInput: input }
      // Nothing happens but a message showing how far it got: read-only topics too
      if (tool === SET_CHECKLIST && mcpServer?.source === 'sdk' && mcpServer.name === CHECKLIST_SERVER) return { behavior: 'allow', updatedInput: input }
      if (tool === ASK_SURVEY && mcpServer?.source === 'sdk' && mcpServer.name === SURVEY_SERVER) return { behavior: 'allow', updatedInput: input }
      // No card and in any mode: the bot checks whose words the turn answers, and the topic shows what was recorded
      if (tool === RECORD_DECISION && mcpServer?.source === 'sdk' && mcpServer.name === DECISION_SERVER) return { behavior: 'allow', updatedInput: input }
      // The head's own team tools: what workers do is asked for in their topics, not here
      if (isTeamTool(tool) && mcpServer?.source === 'sdk' && mcpServer.name === TEAM_SERVER) {
        if (turnMode(key) === 'read' && !TEAM_READ.has(tool)) return { behavior: 'deny', message: 'The topic is in "Read only" mode: starting agents and giving them tasks is not allowed.' }
        // An agent inherits this topic's mode wherever it runs, so a task elsewhere must not get there unseen: "no
        // questions" was given for here. Between the user's own computers it stands; a cloud topic can't reach them by it
        if (tool === 'mcp__team__start_agent' && agentCrosses(key, input) && !l.allowAll && !(turnMode(key) === 'all' && topics.get(key).deviceId && !isCloud(topics.get(key).deviceId))) {
          return askPermission(chatId, topicId, l, key, tool, input, where_, signal)
        }
        return { behavior: 'allow', updatedInput: input }
      }
      // Browser calls were already decided by the Chrome hook; this is only a second line if the CLI asks too
      if (chromeOn && isChromeTool(tool) && mcpServer?.name === CHROME_SERVER) return { behavior: 'allow', updatedInput: input }
      // Only our own in-process servers; trust is keyed on the source and the registered name, not on the tool name
      const app = appToolOf(tool, apps)
      const remote = isRemoteTool(tool, mcpServer, cfg.remoteMcp)
      // Writes on a computer like any command: the topic's mode decides
      const copying = (tool === COPY_TO_COMPUTER || tool === SYNC_BRANCH) && mcpServer?.source === 'sdk' && mcpServer.name === COMPUTER_SERVER
      const ours = remote || copying || (mcpServer?.source === 'sdk' && (isDeviceTool(tool) ? mcpServer.name === 'device' : !!app && mcpServer.name === app.app.name))
      if (!ours) {
        log.warn('permission', { key, tool, verdict: 'denied: not ours', server: mcpServer })
        return { behavior: 'deny', message: `The tool ${tool} is not available.` }
      }
      // Reads go through: device file reads, and app or remote tools their server marks read-only
      const readOnly = copying ? false : remote ? remoteReadOnly === true
        : app ? app.tool.annotations?.readOnlyHint === true : !MUTATING_TOOLS.has(deviceToolOf(tool))
      const device = !app && !remote && !copying
      // A hook in .git runs on the next commit with no command to show on a card: not what "changes project files" was given for
      const fileEdit = device && ['write_file', 'edit_file', 'save_attachment'].includes(deviceToolOf(tool)) && !INSIDE_GIT.test(String(input.path ?? ''))
      const installing = device && ['add_mcp_server', 'remove_mcp_server'].includes(deviceToolOf(tool))
      // Computers are never turned off or restarted: only one asleep can be woken from afar. In every mode, night or day
      if (device && deviceToolOf(tool) === 'run_command') {
        const op = powerRefusal(input)
        if (op) {
          log.info('permission', { key, tool, verdict: `denied: ${op}` })
          return { behavior: 'deny', message: powerDeny(op) }
        }
      }
      // Before the mode: it holds under "Everything without asking" too, and the owner gets no card to tap it through.
      // Read on every call, so turning it on reaches a task already running. A guard against mistakes: see night-guard.ts
      if (device && deviceToolOf(tool) === 'run_command' && night.on(chatId)) {
        const op = nightRefusal(input)
        if (op) {
          log.info('permission', { key, tool, verdict: `denied by night mode: ${op}` })
          // In a shift kept to branches, one tap allows it for the rest of the night
          const sh = shiftOf(key)
          if (sh && !sh.release && !sh.releaseOffered) background(offerShiftRelease(sh))
          return { behavior: 'deny', message: sh && !sh.release ? 'This night shift is kept to branches: the push is refused. The user sees a button to allow merging and releasing for the rest of the shift; if they tap it, you are told. Until then keep the work in branches and go on.' : nightDeny(op) }
        }
      }
      if (installing) {
        const name = String(input.name)
        const problem = deviceToolOf(tool) === 'add_mcp_server'
          ? (name in cfg.remoteMcp ? `The name ${name} is taken by a server on the bot's side` : mcpInstallProblem({ name, command: String(input.command), args: input.args as string[] | undefined }))
          : null
        if (problem) return { behavior: 'deny', message: problem }
        if (turnMode(key) === 'read') return { behavior: 'deny', message: readOnlyMessage(key) }
        // A program on the computer, for every topic there: a fresh yes from the user, in every mode
        return askPermission(chatId, topicId, l, key, tool, input, where_, signal, true)
      }
      // Widening what a project may touch: a fresh yes every time, except in “Everything without asking”, where commands
      // reach any file anyway. ⚡ for one task never covers it; the computer still keeps it inside the approved zone
      const grant = device && deviceToolOf(tool) === 'add_project_folder'
      // Read on every call: a mode switched mid-task applies to the next call
      const mode = turnMode(key)
      if (device && deviceToolOf(tool) === 'send_file' && !await mayReveal(chatId)) return askPermission(chatId, topicId, l, key, tool, input, where_, signal)
      const decision = grant ? (mode === 'read' ? 'deny' : mode === 'all' ? 'allow' : 'ask') : decide({ mode, readOnly, fileEdit, allowAllForTask: l.allowAll })
      if (decision === 'allow') {
        if (!readOnly) log.info('permission', { key, tool, verdict: l.allowAll && mode === 'ask' ? 'all (earlier ⚡)' : `mode ${mode}` })
        return { behavior: 'allow', updatedInput: input }
      }
      if (decision === 'deny') {
        log.info('permission', { key, tool, verdict: `denied by mode ${mode}` })
        return { behavior: 'deny', message: readOnlyMessage(key) }
      }
      return askPermission(chatId, topicId, l, key, tool, input, where_, signal, grant)
    }

  function agentCrosses(key: string, input: Record<string, unknown>) {
    const t = topics.get(key)
    const device = input.device ? findComputer(gateway.devices(), String(input.device))?.id ?? String(input.device) : t.deviceId
    if (device !== t.deviceId) return true
    if (input.new_project || !input.project) return false
    const wanted = String(input.project).toLowerCase()
    const here = t.deviceId ? gateway.device(t.deviceId)?.projects.find(p => p.id === t.projectId) : undefined
    return wanted !== here?.id.toLowerCase() && wanted !== here?.name.toLowerCase()
  }

  // --- turns ------------------------------------------------------------------------------------
  // What is under way, on disk: a restart kills Claude's process but not the commands it started
  const flights = createFlightStore(join(cfg.dataDir, 'in-flight.json'), { warn: m => log.warn('in-flight record not saved', m) })
  const recovery = createRecovery({
    store: flights, gateway, api, log, parseKey, deviceName, schedule,
    live: liveOf,
    session: { get: key => topics.get(key).sessionId, set: (key, sessionId) => topics.set(key, { sessionId }) },
    unmark: (chatId, ids) => mark(chatId, ids, null),
    // A survey is the one thing left waiting for the owner: it outlives a restart
    idle: key => {
      if (!surveys.get(key)) showState(key, 'idle')
    },
    shown: (key, text) => {
      const { chatId, topicId } = parseKey(key)
      return masked(chatId, topicId, text, true)
    },
    continueWith: (f, text) => {
      const { chatId, topicId } = parseKey(f.key)
      // Ahead of whatever waited, under the message it was answering
      const under = f.replyTo ? (f.fromUser ? { msgId: f.replyTo } : { shownId: f.replyTo }) : {}
      enqueue(chatId, topicId, text, { ...under, reply: false, seq: Number.MIN_SAFE_INTEGER, fromMode: f.modeCap as Mode | undefined, continuation: { n: f.continuations + 1, asked: f.prompt }, ownAnswers: f.ownerSpoke ?? f.fromUser })
    },
    report: (key, note) => void reportToHead(key, { text: '', note }).catch(e => log.warn('report to head', (e as Error).message)),
    deviceWaitMs: cfg.recoveryDeviceWaitMs,
    opWaitMs: cfg.recoveryOpWaitMs,
    noteMs: cfg.recoveryNoteMs,
  })
  // The process is on its way out: turns stop here, and how they stand on disk is what the next run picks up
  let closing = false

  // reply: the message may answer Claude's question or name a new project (typed text and voice, not files)
  const showState = (key: string, state: TopicState) => {
    const { chatId, topicId } = parseKey(key)
    topicState.set(key, chatId, topicId, state)
  }

  // A reaction on a message, or none to take one away. Never worth failing over
  function mark(chatId: number, ids: number[], emoji: ReactionTypeEmoji['emoji'] | null) {
    for (const id of ids) api.setMessageReaction(chatId, id, emoji ? [{ type: 'emoji', emoji }] : []).catch(e => log.debug('reaction', (e as Error).message))
  }

  function enqueue(chatId: number, topicId: number | undefined, text: string,
    { images = [], seq, reply = true, context = '', msgId, shownId, scheduleId, fromMode, silent = false, continuation, ownAnswers, rush }: { images?: PromptImage[], seq?: number, reply?: boolean, context?: string, msgId?: number, shownId?: number, scheduleId?: string, fromMode?: Mode, silent?: boolean, continuation?: Incoming['continuation'], ownAnswers?: boolean, rush?: boolean } = {}) {
    const key = topicKey(chatId, topicId)
    const l = liveOf(key)
    if (l.answer && reply) return l.answer(text) // Claude asked a question: this message is the answer
    const survey = reply ? surveys.get(key) : undefined
    if (survey) return void surveyStep(key, survey, surveyText(survey, text), { fresh: true }).catch(e => log.warn('survey', (e as Error).message))
    if (l.newProjectOn && reply) {
      const deviceId = l.newProjectOn
      l.newProjectOn = null
      return createProject(key, deviceId, text)
    }
    // An album is many messages replying to the same one: Claude reads it once
    const quoted = context && !l.queue.some(i => i.context === context)
    // Held behind a turn the limit cut off, as behind one that is running
    const held = pauses.holding(key)
    const waits = (l.busy || !!held) && !!(msgId ?? shownId)
    // Handed into the turn under way at once, as if ⚡ were put on it (the head's corrections to its agents)
    const rushed = !!rush && l.busy && !held
    l.queue.push({ seq: seq ?? l.arrivals++, text: quoted ? `${context}\n\n${text}` : text, images, context, msgId, shownId, scheduleId, waitMark: waits, fromMode, continuation, ownAnswers, ...(rushed && { rush: true }) })
    if (held && !l.busy) {
      if (waits) mark(chatId, [(msgId ?? shownId)!], '👀')
      if (!held.told && !silent) {
        pauses.told(held.id)
        api.sendMessage(chatId, tr(`⏳ This waits until the limit resets (${resetTag(held.until)}), then it goes after the task. To go now: /stop.`, `⏳ Это подождёт сброса лимита (${resetTag(held.until)}) и пойдёт после задачи. Чтобы не ждать: /stop.`), where(topicId)).catch(() => {})
      }
      return
    }
    if (l.busy) {
      if (waits && rushed) {
        mark(chatId, [(msgId ?? shownId)!], HAND_IN)
        log.info('handing in', { key })
        l.now?.kick()
      } else if (waits) {
        mark(chatId, [(msgId ?? shownId)!], '👀')
        if (msgId && handIn.firstWait(chatId)) api.sendMessage(chatId, tr('👀 It waits for the current task. Put ⚡ on the message to send it in now: Claude gets it after the current step.', '👀 Ждёт конца текущей задачи. Поставь на сообщение ⚡, чтобы передать сразу: Claude получит его после текущего шага.'), { ...where(topicId), reply_parameters: { message_id: msgId, allow_sending_without_reply: true } }).catch(() => {})
      }
      // An album is many messages: say it once. Without a message of the user's to mark, say it in words
      else if (l.queue.length === 1 && !silent) api.sendMessage(chatId, tr("📥 Queued: I'll send it after the current task.", '📥 В очереди, отправлю после текущей задачи.'), { ...where(topicId), ...replyToWaiting(l.queue) }).catch(() => {})
      return
    }
    schedule(key)
  }

  // A file and its text often arrive as two messages, an album as ten: wait briefly and send them as one prompt
  function schedule(key: string) {
    const l = liveOf(key)
    clearTimeout(l.timer)
    l.timer = setTimeout(() => processQueue(key), 1500)
  }

  // Telegram tells a bot nothing when a message is deleted. Clearing its own reaction answers without a trace: it fails
  // with these words when there is no message. Any other failure says nothing about that
  const messageGone = (chatId: number, id: number) => api.setMessageReaction(chatId, id, [])
    .then(() => false, e => /message to react not found/i.test((e as Error).message))
  const PROMPT_WATCH_MS = (chatId: number) => cfg.promptWatchMs ?? (isGroupChat(chatId) ? 20_000 : 5000)
  // A notice that something waits answers the message that waits: "this" says nothing on its own. What came from
  // another session has no message of the user's, but the bot showed it here
  const replyToWaiting = (queue: Incoming[]) => {
    const id = queue.map(waitingOn).find(Boolean)
    return id ? { reply_parameters: { message_id: id, allow_sending_without_reply: true } } : {}
  }

  // Called from timers and events, where nobody waits for it. What fails here is a notice: the message goes on waiting
  function processQueue(key: string) {
    return takeQueue(key).catch(e => log.error('queue', { key, error: (e as Error).message }))
  }

  async function takeQueue(key: string) {
    const l = liveOf(key)
    if (l.busy || l.preparing || closing || pauses.holding(key)) return
    // No turn follows, so what says files are being prepared would go on for as long as this lasts, spending the group's
    // writes. Emptied by a /stop from the head or a removed group; with a survey open, what came goes along with its answers
    if (!l.queue.length || surveys.get(key)) return void endPrep(l)
    const { chatId, topicId } = parseKey(key)
    // The server is about to be replaced: a new task would be cut off. What waits stays in the queue and goes along
    if (updating) {
      endPrep(l)
      for (const i of l.queue) i.waitMark ||= !!waitingOn(i)
      mark(chatId, l.queue.flatMap(i => waitingOn(i) ?? []), '👀')
      if (!l.updateNoted) {
        l.updateNoted = true
        await api.sendMessage(chatId, tr(`⏳ The server is updating to <b>${updating}</b>. I'll take this up by myself once it's back.`, `⏳ Сервер обновляется до <b>${updating}</b>. Возьмусь за это сам, как только он вернётся.`), { ...where(topicId), ...HTML, ...replyToWaiting(l.queue) }).catch(() => {})
      }
      return
    }
    l.updateNoted = false
    inheritWorkspace(key)
    const t = topics.get(key)
    if (!t.noProject && (!t.deviceId || !t.projectId)) {
      // One picker per topic: the topic-created handler has usually sent it already
      endPrep(l)
      if (!pickerFresh(l)) {
        await keepLoud(() => sendPicker(chatId, topicId, tr('The message waits until you choose where to work.', 'Сообщение подождёт, пока не выберешь, где работать.'))).catch(e => {
          // Not there, so the next message offers it again
          l.pickerAt = 0
          log.warn('picker not sent', (e as Error).message)
        })
      }
      return
    }
    // §3.5: the bound device is offline — never reroute silently. The user can still talk: work for it waits as deferred
    // tasks. What has no one to talk to waits as it is
    const away = !t.noProject && !gateway.device(t.deviceId!)
    if (away) wantedAt.set(t.deviceId!, Date.now())
    if (away && canTalkOffline(t, l.queue)) {
      if (!l.offlineNoted) {
        l.offlineNoted = true
        const others = stillHere(t) ? [] : otherComputers(gateway.devices(), t.deviceId)
        await sendRich(chatId, topicId, [
          tr(`### 🔌 ${mdText(deviceName(t.deviceId!))} is offline`, `### 🔌 ${mdText(deviceName(t.deviceId!))} не в сети`),
          tr('We can go on talking. Work for it waits and starts by itself when it connects.', 'Можно продолжать разговор. Работа для него подождёт и начнётся сама, когда он подключится.'),
        ].join('\n\n'), others.length ? { reply_markup: goKeyboard(others.map(goRow)) } : {}).catch(() => {})
        // That can take half a minute in a busy group, and the next message may have started the turn meanwhile. Two turns
        // at once on one session is what the rest of this function is there to prevent
        if (l.busy || !l.queue.length) return
      }
    } else if (away) {
      endPrep(l)
      if (!l.waitingDevice) {
        l.waitingDevice = true
        // Never rerouted silently, but one tap away
        const others = stillHere(t) ? [] : otherComputers(gateway.devices(), t.deviceId)
        await sendRich(chatId, topicId, [
          tr(`### 🔌 ${mdText(deviceName(t.deviceId!))} is offline`, `### 🔌 ${mdText(deviceName(t.deviceId!))} не в сети`),
          tr('The message waits until it connects.', 'Сообщение подождёт, пока он подключится.'),
          `<footer>${tr('/stop to cancel · /project to choose another', '/stop — отменить · /project — выбрать другое')}</footer>`,
        ].join('\n\n'), { ...replyToWaiting(l.queue), ...(others.length && { reply_markup: goKeyboard(others.map(goRow)) }) }).catch(() => {})
      }
      return
    }
    // Not kept for after the lock: what was asked before it may be what the lock is there to stop
    if (!t.noProject && gateway.device(t.deviceId!)?.locked) {
      endPrep(l)
      l.queue.length = 0
      flights.end(key)
      await api.sendMessage(chatId, tr(`🔒 <b>${esc(deviceName(t.deviceId!))}</b> is locked, so this will not run. Only someone at the computer can unlock it.`, `🔒 <b>${esc(deviceName(t.deviceId!))}</b> заблокирован, поэтому это не выполнится. Снять блокировку можно только за самим компьютером.`), { ...where(topicId), ...HTML })
      return
    }
    l.waitingDevice = false
    // A turn that starts by itself: whatever was offered before it was passed over, and must not fire on a later /project
    if (!l.queue.some(i => !i.msgId)) continueAfterBind.delete(key)
    // §14: a server-wide cap on turns at once; this topic waits its turn and is told so once
    if (running >= cfg.maxParallel) {
      endPrep(l)
      if (!slotWaiters.includes(key)) {
        slotWaiters.push(key)
        await api.sendMessage(chatId, tr(`⏳ <b>${running}</b> ${running === 1 ? 'task is' : 'tasks are'} running: that's the server's limit. I'll start as soon as one finishes.`, `⏳ Сейчас идут <b>${running}</b> ${plural(running, 'задача', 'задачи', 'задач')} — это предел сервера. Начну, как только одна закончится.`), { ...where(topicId), ...HTML, ...replyToWaiting(l.queue) }).catch(() => {})
      }
      return
    }
    if (slotWaiters.includes(key)) slotWaiters.splice(slotWaiters.indexOf(key), 1)
    running++
    // Everything sent while Claude was busy (or within the short merge window) becomes one prompt
    const taken = l.queue.splice(0).sort((a, b) => a.seq - b.seq)
    // Held from here: what arrives while this is being checked waits its turn, and a /stop has something to reach
    l.busy = true
    l.since = Date.now()
    l.abort = new AbortController()
    const gone = await Promise.all(taken.map(i => (i.msgId ? messageGone(chatId, i.msgId) : false)))
    const items = taken.filter((_, n) => !gone[n])
    if (!items.length) {
      log.info('prompt deleted before its turn', { key, messages: taken.length })
      l.busy = false
      l.abort = null
      running--
      wakeWaiters()
      if (l.queue.length) processQueue(key)
      return
    }
    const all = items.flatMap(i => i.images)
    const images = all.slice(0, MAX_IMAGES)
    // Several messages make one prompt: the answer goes under the last of them
    const replyTo = answerTarget(items)
    for (const i of items) if (i.scheduleId) l.runs.add(i.scheduleId)
    // The user wrote something else instead of tapping: those buttons have passed. An agent's report or a scheduled
    // run is no answer to them, and they keep working
    const passed = items.some(ownWords) && topics.get(key).suggested
    if (items.some(ownWords)) offers.passed(key)
    if (passed) {
      topics.set(key, { suggested: undefined })
      settleButtons(chatId, passed)
    }
    const msgIds = (only: (i: Incoming) => boolean) => items.flatMap(i => (i.msgId && only(i) ? [i.msgId] : []))
    const praised = praise.get(key)
    praise.delete(key)
    const prompt = lines(
      ...(praised ?? []),
      items.map(i => i.text).filter(Boolean).join('\n\n'),
      all.length > MAX_IMAGES && `(showing the first ${MAX_IMAGES} images of ${all.length})`,
    ) || '(no caption)'
    l.modeCap = modeCapOf(items)
    l.ownerSpoke = items.some(ownWords)
    showState(key, 'idle')
    const quiet = isGroupChat(chatId) ? quietMark(items, groupLimit.room(chatId)) : undefined
    if (quiet) {
      // Taken away with the end of the turn, like the mark of a message that waited
      quiet.waitMark = true
      mark(chatId, [waitingOn(quiet)!], '👀')
    }
    let outcome: TurnOutcome = { text: '', note: tr('⚠️ no answer', '⚠️ без ответа') }
    // All of what this turn answers has been deleted: the user took it back. Stop, and don't answer it. A turn started by
    // the bot itself has nothing to watch
    const asked = msgIds(() => true)
    // One at a time, and only until one still stands: in a group each question is a write, and an album would spend all
    // the group has every minute on this
    l.promptGone = async () => {
      for (const id of asked) if (!await messageGone(chatId, id)) return false
      return asked.length > 0
    }
    const promptWatch = asked.length ? setInterval(() => {
      if (isGroupChat(chatId) && !groupLimit.room(chatId)) return
      l.promptGone?.().then(deleted => {
        if (!deleted) return
        log.info('prompt deleted during its turn', { key })
        l.answerTakenBack = true
        l.abort?.abort()
      }).catch(() => {})
    }, PROMPT_WATCH_MS(chatId)) : undefined
    const continuation = items.find(i => i.continuation)?.continuation
    flights.begin(key, {
      sessionId: topics.get(key).sessionId ?? null, replyTo, fromUser: !!replyTo && asked.includes(replyTo),
      // Marks a restart has to clear, on messages the bot showed as well
      msgIds: [...new Set([...asked, ...items.flatMap(i => (i.waitMark ? waitingOn(i) ?? [] : []))])],
      // What was asked: a message that waited goes on with the one before it, the bot's own words about a restart don't
      prompt: continuation ? lines(continuation.asked, ...items.filter(i => !i.continuation).map(i => i.text)) : prompt,
      // A topic talking with its computer away has nothing to wait for
      continuations: continuation?.n ?? 0, modeCap: l.modeCap, ownerSpoke: l.ownerSpoke, deviceId: t.deviceId && gateway.device(t.deviceId) ? t.deviceId : undefined,
    })
    try {
      outcome = await runOne(key, prompt, l, images, replyTo)
    } catch (e) {
      log.error('turn failed', e)
      outcome = { text: '', note: `⚠️ ${failureText(e)}` }
      if (!closing) await keepLoud(() => api.sendMessage(chatId, `${tr('⚠️ <b>Task failed:</b>', '⚠️ <b>Задача не выполнена:</b>')} ${errorHtml(masked(chatId, topicId, (e as Error).message))} ${hashtag('error')}`, { ...where(topicId), ...HTML })).catch(() => {})
    } finally {
      flights.end(key)
      handIn.settle(key, l)
      l.now = undefined
      clearInterval(promptWatch)
      // On the way out: no reaction, no report to a head, no next turn. The next run of the server sees to this one
      if (closing) return
      l.modeCap = undefined
      l.ownerSpoke = false
      l.promptGone = undefined
      l.answerTakenBack = false
      // A turn that failed before its first draft must not leave the preparing bubble refreshing
      endPrep(l)
      // A long batch is an album: its last few say it well enough. What waited and gets no such mark loses the one it has
      const failed = turnReaction(outcome)
      const broken = failed ? msgIds(() => true).slice(-5) : []
      mark(chatId, broken, failed)
      mark(chatId, items.flatMap(i => (i.waitMark ? waitingOn(i) ?? [] : [])).filter(id => !broken.includes(id)), null)
      l.busy = false
      // An agent's scheduled run answers the user in its topic: waking the head for each run costs its whole history
      const scheduledRun = l.runs.size > 0
      l.runs.clear()
      l.abort = null
      l.allowAll = false
      running--
      if (!l.queue.length) showState(key, turnState(outcome))
      wakeWaiters()
      if (topics.get(key).head && !outcome.paused && !scheduledRun) reportToHead(key, outcome).catch(e => log.warn('report to head', (e as Error).message))
      else if (!outcome.paused) background(lookForMergedWorktrees(key))
      shiftTurnEnded(key)
      if (l.queue.length) processQueue(key)
    }
  }

  // --- what heavy commands cost, by repository on its computer: a worktree's runs count for its repository -------------
  const heavy = createHeavyStore(join(cfg.dataDir, 'heavy-commands.json'))
  const heavyKey = (deviceId: string, project: Project) => `${deviceId}:${project.worktreeOf ?? project.id}`

  // --- worktrees that only take room. Of merged branches: a card to remove them, or done by itself once the user
  // says so. Ones nobody has touched for a week: a card to remove their folders, the branches stay ---------------
  const worktreeAuto = readJson<Record<string, boolean>>(join(cfg.dataDir, 'worktree-clean.json'), {})
  // Per repository, until when the stale ones are not offered again: a day after a card, a week after "Not now"
  const staleQuiet = readJson<Record<string, number>>(join(cfg.dataDir, 'worktree-stale.json'), {})
  const staleQuietFor = (at: string, ms: number) => {
    staleQuiet[at] = Date.now() + ms
    writeJson(join(cfg.dataDir, 'worktree-stale.json'), staleQuiet)
  }
  const worktreeLooked = new Map<string, number>()
  const worktreeOffers = new Map<string, { key: string, deviceId: string, repo: string, list: Worktree[], stale?: boolean }>()
  const worktreeClean = async (deviceId: string, repo: string, folder: string) => {
    const status = await git(deviceId, repo, ['-C', folder, 'status', '--porcelain'])
    return !gitFailed(status) && !gitOut(status).trim()
  }
  async function lookForMergedWorktrees(key: string) {
    const t = topics.get(key)
    const project = t.deviceId ? gateway.device(t.deviceId)?.projects.find(p => p.id === t.projectId) : undefined
    if (!t.deviceId || !project) return
    const repo = project.worktreeOf ?? project.id
    const at = `${t.deviceId}:${repo}`
    if (Date.now() - (worktreeLooked.get(at) ?? 0) < (cfg.worktreeCheckMs ?? 6 * 3600_000)) return
    worktreeLooked.set(at, Date.now())
    const listed = await git(t.deviceId, repo, ['worktree', 'list', '--porcelain'])
    if (gitFailed(listed)) return
    // Where agents and topics still work: those stay whatever git says
    const busy = topics.entries().flatMap(([, x]) => (x.worktree && x.deviceId === t.deviceId && x.head && topics.get(x.head).workers?.length ? [x.worktree.folder] : []))
    const merged: Worktree[] = []
    const others: Worktree[] = []
    for (const w of cleanable(parseWorktrees(gitOut(listed)), busy)) {
      const inHead = !gitFailed(await git(t.deviceId, repo, ['merge-base', '--is-ancestor', w.branch!, 'HEAD']))
      if (!inHead) others.push(w)
      else if (await worktreeClean(t.deviceId, repo, w.folder)) merged.push(w)
    }
    const { chatId, topicId } = parseKey(key)
    // One card at a time: the stale ones wait for the next look when the merged ones are asked about
    if (!merged.length || worktreeAuto[at]) {
      if (merged.length) {
        const gone = await removeWorktrees(t.deviceId, repo, merged)
        if (gone.length) await api.sendMessage(chatId, tr(`🧹 Folders of merged branches removed: ${gone.map(esc).join(', ')}.`, `🧹 Удалены папки смёрженных веток: ${gone.map(esc).join(', ')}.`), { ...where(topicId), ...HTML, disable_notification: true }).catch(() => {})
      }
      return offerStaleWorktrees(key, t.deviceId, repo, others)
    }
    const id = randomBytes(4).toString('hex')
    worktreeOffers.set(id, { key, deviceId: t.deviceId, repo, list: merged })
    const rows: RichButton[][] = [
      [{ text: tr('🧹 Remove', '🧹 Удалить'), data: `wtc:del:${id}` }, { text: tr('Not now', 'Не сейчас'), data: `wtc:no:${id}` }],
      [{ text: tr('Remove them by itself from now on', 'Дальше удалять самому'), data: `wtc:auto:${id}` }],
    ]
    await sendChoice(chatId, topicId, [
      tr(`🧹 **Merged, with nothing uncommitted:** ${merged.map(w => `\`${folderName(w.folder)}\``).join(', ')}. Remove their folders and branches?`, `🧹 **Смёржены, незакоммиченного нет:** ${merged.map(w => `\`${folderName(w.folder)}\``).join(', ')}. Удалить их папки и ветки?`),
    ].join('\n\n'), rows, goKeyboard(rows))
  }
  // Not merged, but nobody works there: no topic is bound to the folder, nothing in it is uncommitted, and neither a
  // commit nor a move of its HEAD happened for a week
  async function offerStaleWorktrees(key: string, deviceId: string, repo: string, list: Worktree[]) {
    const at = `${deviceId}:${repo}`
    if (!list.length || Date.now() < (staleQuiet[at] ?? 0)) return
    const bound = new Set(topics.entries().flatMap(([, x]) => (x.deviceId === deviceId && x.projectId ? [x.projectId] : [])))
    // Asked anew: a worktree made by git itself may not be in the list yet
    const projects = await gateway.refreshProjects(deviceId).catch(() => gateway.device(deviceId)?.projects ?? [])
    const open = projects.filter(p => bound.has(p.id)).map(p => p.path)
    const stale: Worktree[] = []
    for (const w of cleanable(list, open)) {
      let moved = lastMoved(gitOut(await git(deviceId, repo, ['-C', w.folder, 'log', '-g', '-1', '--date=unix', '--format=%ct %gd', 'HEAD'])))
      if (!moved) moved = lastMoved(gitOut(await git(deviceId, repo, ['-C', w.folder, 'log', '-1', '--format=%ct', 'HEAD'])))
      if (!moved || Date.now() - moved < (cfg.worktreeStaleMs ?? 7 * 86400_000)) continue
      if (await worktreeClean(deviceId, repo, w.folder)) stale.push(w)
    }
    if (!stale.length) return
    let room = 0
    for (const w of stale) room += await trackedBytes(deviceId, repo, w.folder)
    staleQuietFor(at, 86400_000)
    const id = randomBytes(4).toString('hex')
    worktreeOffers.set(id, { key, deviceId, repo, list: stale, stale: true })
    const names = firstNames(stale.map(w => `\`${folderName(w.folder)}\``), n => tr(`and ${n} more`, `и ещё ${n}`))
    const size = room ? tr(`, about ${bytes(room)}`, `, около ${bytes(room)}`) : ''
    const rows: RichButton[][] = [[{ text: tr('🧹 Remove the folders', '🧹 Удалить папки'), data: `wtc:del:${id}` }, { text: tr('Not now', 'Не сейчас'), data: `wtc:no:${id}` }]]
    const { chatId, topicId } = parseKey(key)
    await sendChoice(chatId, topicId, tr(
      `🧹 **Untouched for over a week, nothing uncommitted:** ${count(stale.length, ['worktree', 'worktrees'], ['рабочая копия', 'рабочие копии', 'рабочих копий'])}${size} (${names}). Remove their folders? The branches stay: \`git worktree add\` brings any of them back.`,
      `🧹 **Не трогали больше недели, незакоммиченного нет:** ${count(stale.length, ['worktree', 'worktrees'], ['рабочая копия', 'рабочие копии', 'рабочих копий'])}${size} (${names}). Удалить их папки? Ветки останутся: \`git worktree add\` вернёт любую.`,
    ), rows, goKeyboard(rows))
  }
  // What a worktree's files weigh, by git's own list of them: quick, and near enough to what the folder takes.
  // Needs a shell with awk; 0 when there is none
  async function trackedBytes(deviceId: string, repo: string, folder: string) {
    if (!/(^|[\\/])(ba|z|da)?sh(\.exe)?$/i.test(gateway.device(deviceId)?.shell ?? '')) return 0
    const command = `git -C '${folder.replace(/'/g, `'\\''`)}' ls-tree -r -l HEAD | awk '{s+=$4} END {print s+0}'`
    const out = await gateway.request(deviceId, { projectId: repo, bindingVersion: 0, tool: 'run_command', params: { command, timeoutSec: 60 } })
    return gitFailed(out) ? 0 : Number(gitOut(out).trim()) || 0
  }
  // git refuses a folder with changes and a branch that isn't merged: those stay, whatever was decided.
  // branches: false for the stale ones, which lose the folder only
  async function removeWorktrees(deviceId: string, repo: string, list: Worktree[], branches = true) {
    const gone: string[] = []
    for (const w of list) {
      const failed = await removeWorktree(deviceId, repo, w.folder)
      if (failed && !isBusyFolder(failed)) continue
      if (failed) folderRetry.later(deviceId, repo, w.folder)
      if (branches) await git(deviceId, repo, ['branch', '-d', w.branch!])
      gone.push(folderName(w.folder))
    }
    if (gone.length) {
      log.info(branches ? 'merged worktrees removed' : 'stale worktrees removed', { device: deviceId, repo, gone })
      await gateway.refreshProjects(deviceId).catch(() => {})
    }
    return gone
  }
  bot.callbackQuery(/^wtc:(del|no|auto):([0-9a-f]{8})$/, async ctx => {
    const o = worktreeOffers.get(ctx.match[2])
    if (!o) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    worktreeOffers.delete(ctx.match[2])
    const msg = ctx.callbackQuery.message
    if (ctx.match[1] === 'no') {
      await ctx.answerCallbackQuery()
      if (o.stale) staleQuietFor(`${o.deviceId}:${o.repo}`, 7 * 86400_000)
      if (msg) await editRich(ctx.chat!.id, msg.message_id, o.stale ? tr('🧹 Left as they are. I will ask again in a week.', '🧹 Оставлены как есть. Спрошу снова через неделю.') : tr('🧹 Left as they are.', '🧹 Оставлены как есть.'))
      return
    }
    if (o.stale) {
      // Dozens of folders of gigabytes each take minutes: the card says so, and the answer comes when they are gone
      await ctx.answerCallbackQuery(tr('Removing…', 'Удаляю…'))
      if (msg) await editRich(ctx.chat!.id, msg.message_id, tr(`🧹 Removing ${count(o.list.length, ['folder', 'folders'], ['папку', 'папки', 'папок'])}…`, `🧹 Удаляю ${count(o.list.length, ['folder', 'folders'], ['папку', 'папки', 'папок'])}…`)).catch(() => {})
      background((async () => {
        const gone = await removeWorktrees(o.deviceId, o.repo, o.list, false)
        const kept = o.list.map(w => folderName(w.folder)).filter(n => !gone.includes(n))
        if (msg) await editRich(ctx.chat!.id, msg.message_id, [
          gone.length ? tr(`🧹 Folders removed: ${gone.join(', ')}. Their branches stay.`, `🧹 Папки удалены: ${gone.join(', ')}. Ветки остались.`) : '',
          kept.length ? tr(`Kept, as git refused: ${kept.join(', ')}.`, `Остались, git отказался: ${kept.join(', ')}.`) : '',
        ].filter(Boolean).join(' '))
      })())
      return
    }
    if (ctx.match[1] === 'auto') {
      worktreeAuto[`${o.deviceId}:${o.repo}`] = true
      writeJson(join(cfg.dataDir, 'worktree-clean.json'), worktreeAuto)
    }
    await ctx.answerCallbackQuery(tr('Removing…', 'Удаляю…'))
    const gone = await removeWorktrees(o.deviceId, o.repo, o.list)
    const kept = o.list.map(w => folderName(w.folder)).filter(n => !gone.includes(n))
    if (msg) await editRich(ctx.chat!.id, msg.message_id, [
      gone.length ? tr(`🧹 Removed: ${gone.join(', ')}.`, `🧹 Удалены: ${gone.join(', ')}.`) : '',
      kept.length ? tr(`Kept, as git refused: ${kept.join(', ')}.`, `Остались, git отказался: ${kept.join(', ')}.`) : '',
      ctx.match[1] === 'auto' ? tr('From now on such folders of this repository go by themselves.', 'Дальше такие папки этого репозитория будут удаляться сами.') : '',
    ].filter(Boolean).join(' '))
  })

  // --- the night shift: a card to start it, the night without questions, the summary, the computers asleep, a morning push ---
  const zone = () => schedules.zone()
  const tidyLabel = (t?: ShiftTidy) => (t === 'force'
    ? tr('🧹 Open windows: close all by force', '🧹 Открытые окна: закрыть все принудительно')
    : t === 'soft' ? tr('🧹 Open windows: close', '🧹 Открытые окна: закрыть') : tr('🧹 Open windows: leave', '🧹 Открытые окна: не трогать'))
  const tidyNext = (t?: ShiftTidy): ShiftTidy | undefined => (!t ? 'soft' : t === 'soft' ? 'force' : undefined)
  const powerLabel = (p: ShiftPower) => (p === 'off'
    ? tr('⏻ Computers after it: turn off', '⏻ Компьютеры после смены: выключить')
    : p === 'sleep' ? tr('💤 Computers after it: sleep', '💤 Компьютеры после смены: усыпить') : tr('💻 Computers after it: leave on', '💻 Компьютеры после смены: оставить'))
  const powerNext = (p: ShiftPower): ShiftPower => (p === 'on' ? 'sleep' : p === 'sleep' ? 'off' : 'on')
  const shiftKeyboard = (sh: Shift): RichButton[][] => [
    [{ text: tr('🌙 Start', '🌙 Начать'), data: `nsh:go:${sh.id}` }],
    [{ text: sh.release ? tr('Branches only, no release', 'Только ветки, без выпуска') : tr('Allow merge and release', 'Разрешить мёрж и выпуск'), data: `nsh:rel:${sh.id}` }],
    [{ text: tidyLabel(sh.tidy), data: `nsh:tidy:${sh.id}` }],
    [{ text: powerLabel(sh.power), data: `nsh:pc:${sh.id}` }],
    [{ text: tr('Cancel', 'Отмена'), data: `nsh:no:${sh.id}` }],
  ]
  async function offerShift(key: string, p: { tasks: string[], power: ShiftPower, tidy?: ShiftTidy, release: boolean }) {
    const sh = shifts.offer(key, p)
    const { chatId, topicId } = parseKey(key)
    const rows = shiftKeyboard(sh)
    const choice = await keepLoud(() => sendChoice(chatId, topicId, shiftCard(sh, mdText), rows, goKeyboard(rows))).catch(() => null)
    offers.open(key, 'retry', choice?.messageId)
    log.info('night shift offered', { key, tasks: p.tasks.length })
    return 'The user sees the night shift card and starts it with a tap. Don\'t start the work now. End your turn with one short line.'
  }
  bot.callbackQuery(/^nsh:(go|rel|pc|tidy|no|stop|allow):([0-9a-f]{8})$/, async ctx => {
    const [, what, id] = ctx.match
    const sh = shifts.get(id)
    const msg = ctx.callbackQuery.message
    const running = what === 'stop' || what === 'allow'
    if (!sh || (running ? sh.state !== 'running' : sh.state !== 'offered')) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    const { chatId, topicId } = parseKey(sh.key)
    const draw = (md: string, rows: RichButton[][] = []) => (msg ? editRich(chatId, msg.message_id, rows.length ? `${md}\n\n${richButtons(rows)}` : md) : Promise.resolve(false))
    await ctx.answerCallbackQuery()
    if (what === 'allow') {
      shifts.change(id, { release: true })
      if (!sh.before?.night) night.set(chatId, false)
      log.info('night shift: release allowed', { key: sh.key })
      await draw(tr('🌙 ✅ **Merge and release are allowed** for the rest of the shift.', '🌙 ✅ **Мёрж и выпуск разрешены** до конца смены.'))
      return enqueue(chatId, topicId, '[The user allowed merging and releasing for the rest of this night shift: your instructions say so now. Push and release what is ready, by the project\'s rules, when the tests are green and the work is accepted.]', { reply: false })
    }
    if (what === 'rel' || what === 'pc' || what === 'tidy') {
      const next = shifts.change(id, what === 'rel' ? { release: !sh.release } : what === 'tidy' ? { tidy: tidyNext(sh.tidy) } : { power: powerNext(sh.power) })!
      return draw(shiftCard(next, mdText), shiftKeyboard(next))
    }
    if (what === 'no') {
      shifts.change(id, { state: 'ended', endedAt: Date.now(), pinged: true })
      return draw(tr('🌙 The night shift was not started.', '🌙 Ночная смена не начата.'))
    }
    if (what === 'stop') {
      await finishShift(sh, false, true)
      return draw(tr('🌙 The night shift was stopped.', '🌙 Ночная смена остановлена.'))
    }
    // Everything without questions for the night, and the guard of night mode when only branches are allowed
    const t = topics.get(sh.key)
    const morningAt = cfg.shiftMorningInMs !== undefined ? Date.now() + cfg.shiftMorningInMs : morningAfter(Date.now(), zone())
    const wrapAt = cfg.shiftWrapInMs !== undefined ? Date.now() + cfg.shiftWrapInMs : wrapAfter(Date.now(), zone())
    const started = shifts.start(id, { morningAt, ...(wrapAt < morningAt && { wrapAt }), before: { mode: t.mode, night: night.on(chatId) } })!
    topics.set(sh.key, { mode: 'all' })
    if (!sh.release) night.set(chatId, true)
    log.info('night shift started', { key: sh.key, release: sh.release, power: sh.power, tidy: sh.tidy })
    background(weeksUsed().then(w => void shifts.change(id, { weekAt: w[profiles.nameOf(t.profile)], weeksAt: w })))
    await draw(startedLine(started, zone()), [[{ text: tr('⏹ Stop the shift', '⏹ Остановить смену'), data: `nsh:stop:${id}` }]])
    enqueue(chatId, topicId, `[The user started the night shift and went to sleep. Its rules are in your instructions now. Begin.]`, { reply: false })
  })

  async function offerShiftRelease(sh: Shift) {
    shifts.change(sh.id, { releaseOffered: true })
    const { chatId, topicId } = parseKey(sh.key)
    const rows: RichButton[][] = [[{ text: tr('✅ Allow merge and release', '✅ Разрешить мёрж и выпуск'), data: `nsh:allow:${sh.id}` }]]
    await keepLoud(() => sendChoice(chatId, topicId, [
      tr('### 🌙 The shift is kept to branches', '### 🌙 Смена работает только в ветках'),
      tr('A push was refused. Allow merging and releasing for the rest of the night?', 'Пуш отклонён. Разрешить мёрж и выпуск до конца ночи?'),
    ].join('\n\n'), rows, goKeyboard(rows))).catch(e => log.warn('shift release offer', (e as Error).message))
  }

  async function endShift(key: string, p: { done: boolean, finished?: string[], left?: string[] }) {
    const sh = shifts.running(key)
    if (!sh) return 'No night shift is running here.'
    shifts.change(sh.id, { ending: { done: p.done }, finished: p.finished, left: p.left })
    return 'Noted. Now write the summary as your final answer; the bot puts the computers to sleep after it, if that was asked.'
  }

  // A turn of the head or of one of its agents ended: the shift is alive. The head's summary is its last turn
  function shiftTurnEnded(key: string) {
    const sh = shiftOf(key)
    if (!sh) return
    shifts.change(sh.id, { activeAt: Date.now() })
    if (sh.key === key && sh.ending) background(finishShift(sh, sh.ending.done, false))
  }

  // stopped: by the user, so no computer goes off and no morning push follows
  async function finishShift(sh: Shift, done: boolean, stopped: boolean) {
    const ended = shifts.end(sh.id, done)!
    // Topics the night moved to another profile at a limit follow their computers' again: the limit resets
    for (const k of sh.moved ?? []) if (registry.profileOf(topics.get(k).deviceId ?? '')) topics.set(k, { profileOwn: undefined })
    const { chatId } = parseKey(sh.key)
    topics.set(sh.key, { mode: sh.before?.mode })
    if (!sh.before?.night) night.set(chatId, false)
    log.info('night shift ended', { key: sh.key, done, stopped })
    if (stopped) return void shifts.change(sh.id, { pinged: true })
    // Ended in the night, done or not, nothing more happens on it until someone is there: off, once nothing of the shift
    // runs any more. Only unfinished work at the morning call keeps it on, for the user who is about to go on with it
    if (done || !sh.morningAsked) background(whenShiftIdle(sh).then(idle => (idle ? restComputers(sh) : undefined)))
    if (Date.now() >= (sh.morningAt ?? 0)) await pingMorning(ended)
  }

  // Its agents may still be at a command when the head ends the shift. Waited for until the morning at most: then the
  // user is there, and it stays on
  async function whenShiftIdle(sh: Shift) {
    const busy = () => [sh.key, ...workersOf(sh.key)].some(k => liveOf(k).busy || liveOf(k).queue.length > 0)
    while (busy()) {
      if (Date.now() >= (sh.morningAt ?? 0)) return false
      await pause(cfg.shiftTickMs ?? 30_000)
    }
    return true
  }

  // The computers a shift works on, the cloud aside, each with a topic of the shift's on it
  function shiftComputers(key: string) {
    const out = new Map<string, string>()
    for (const k of [key, ...workersOf(key)]) {
      const t = topics.get(k)
      if (t.deviceId && t.projectId && !isCloud(t.deviceId) && !out.has(t.deviceId)) out.set(t.deviceId, k)
    }
    return out
  }

  // What this shift asked for, and what shifts before it left to the last one. A computer another shift still works on
  // is left as it is, and goes to that one: two games in Roblox overnight, and the first done doesn't cut the second off.
  // Tidied first, then asleep or off, as the user chose; of two wishes for one computer the stronger holds
  async function restComputers(sh: Shift) {
    const mine = shiftComputers(sh.key)
    const rest = new Map<string, PowerHow>(Object.entries(sh.restAfter ?? {}))
    const tidy = new Map<string, ShiftTidy>(Object.entries(sh.tidyAfter ?? {}))
    for (const id of mine.keys()) {
      if (sh.power !== 'on') rest.set(id, strongerPower(rest.get(id), sh.power)!)
      if (sh.tidy) tidy.set(id, strongerTidy(tidy.get(id), sh.tidy)!)
    }
    const { chatId, topicId } = parseKey(sh.key)
    for (const id of new Set([...tidy.keys(), ...rest.keys()])) {
      const others = shifts.all().filter(x => x.state === 'running' && x.id !== sh.id && shiftComputers(x.key).has(id))
      if (others.length) {
        for (const o of others) {
          shifts.change(o.id, {
            ...(rest.has(id) && { restAfter: { ...o.restAfter, [id]: strongerPower(o.restAfter?.[id], rest.get(id))! } }),
            ...(tidy.has(id) && { tidyAfter: { ...o.tidyAfter, [id]: strongerTidy(o.tidyAfter?.[id], tidy.get(id))! } }),
          })
        }
        log.info('night shift: computer left as it is', { device: id, for: others.map(o => o.key) })
        background(api.sendMessage(chatId, tr(`💻 <b>${esc(deviceName(id))}</b> is left as it is: another night shift still works on it. It is tidied up, put to sleep or turned off when that one is done.`, `💻 <b>${esc(deviceName(id))}</b> пока не трогаю: на нём ещё идёт другая ночная смена. Уберу, усыплю или выключу, когда она закончит.`), { ...where(topicId), ...HTML }).catch(() => {}))
        continue
      }
      const dev = gateway.device(id)
      // A topic of this shift on it, or of the one that left it here: run_command needs a project there
      const k = mine.get(id) ?? [...topics.entries()].find(([, t]) => t.deviceId === id && t.projectId)?.[0]
      const t = k ? topics.get(k) : undefined
      if (!dev || !t?.projectId) continue
      if (tidy.has(id)) await tidyComputer(dev, t.projectId, chatId, topicId, tidy.get(id) === 'force')
      if (rest.has(id)) await powerDown(dev, t.projectId, rest.get(id)!, chatId, topicId)
    }
  }

  // To sleep or off, a minute from now, and a look later at whether it happened
  async function powerDown(dev: { id: string, os: Device['os'] }, projectId: string, how: PowerHow, chatId: number, topicId: number | undefined) {
    const cmd = how === 'off' ? cfg.shiftOff ?? offCommand(dev.os) : cfg.shiftSleep ?? sleepCommand(dev.os)
    if (!cmd) return false
    const out = await gateway.request(dev.id, { projectId, bindingVersion: 0, tool: 'run_command', params: { ...cmd, timeoutSec: 120 } })
    log.info('computer to rest', { device: dev.id, how, ok: out.ok })
    if (out.ok) checkAsleep(dev.id, Date.now(), chatId, topicId, how)
    return out.ok
  }

  // --- sleep or off at the user's word: Claude offers a card, and their tap on it does it --------------------
  type PowerAsk = { key: string, deviceId: string, tidy?: ShiftTidy }
  const powerAsks = new Map<string, PowerAsk>()
  const powerCard = (o: PowerAsk) => {
    const busy = [...live].filter(([k, l]) => k !== o.key && (l.busy || l.queue.length > 0) && topics.get(k).deviceId === o.deviceId).length
    return [
      tr(`### 💻 ${mdText(deviceName(o.deviceId))}: sleep or off?`, `### 💻 ${mdText(deviceName(o.deviceId))}: усыпить или выключить?`),
      [
        `- ${tr('**Sleep:** open apps stay as they are.', '**Сон:** открытые программы остаются как есть.')}`,
        `- ${tr('**Off:** everything open closes, unsaved work is lost. It is turned on at the computer or by a smart plug.', '**Выключение:** всё открытое закроется, несохранённое пропадёт. Включить можно на месте или умной розеткой.')}`,
        ...(o.tidy === 'force' ? [`- ${tr('**Before that** the open windows close, and what stays open is ended by force.', '**Перед этим** открытые окна закроются, а что не закрылось, будет завершено принудительно.')}`]
          : o.tidy ? [`- ${tr('**Before that** the open windows close; apps asking to save stay.', '**Перед этим** открытые окна закроются; программы, которые просят сохранить, останутся.')}`] : []),
      ].join('\n'),
      ...(busy ? [tr(`⚠️ Tasks are running on it in other topics (${busy}): they will be cut off.`, `⚠️ На нём идут задачи в других топиках (${busy}): они оборвутся.`)] : []),
      tr('It happens a minute after your tap.', 'Сработает через минуту после нажатия.'),
    ].join('\n\n')
  }
  const powerKeyboard = (id: string, o: PowerAsk): RichButton[][] => [
    [{ text: tr('💤 Sleep', '💤 Усыпить'), data: `pwr:sleep:${id}` }, { text: tr('⏻ Turn off', '⏻ Выключить'), data: `pwr:off:${id}`, style: 'danger' }],
    [{ text: tidyLabel(o.tidy), data: `pwr:tidy:${id}` }],
    [{ text: tr('Cancel', 'Отмена'), data: `pwr:no:${id}` }],
  ]
  async function offerPower(key: string, p: PowerOffer) {
    const dev = p.computer ? gateway.devices().find(d => d.name === p.computer) : gateway.device(topics.get(key).deviceId ?? '')
    if (!dev || isCloud(dev.id)) return `${p.computer ?? 'This topic\'s computer'} is not online: nothing to turn off or put to sleep. Tell the user.`
    const id = randomBytes(4).toString('hex')
    const o: PowerAsk = { key, deviceId: dev.id, ...(p.tidy && { tidy: p.tidy }) }
    powerAsks.set(id, o)
    const { chatId, topicId } = parseKey(key)
    const rows = powerKeyboard(id, o)
    const choice = await keepLoud(() => sendChoice(chatId, topicId, powerCard(o), rows, goKeyboard(rows))).catch(() => null)
    offers.open(key, 'retry', choice?.messageId)
    log.info('power offered', { key, device: dev.id })
    return 'The user sees a card and chooses with a button: sleep, off, or cancel. The bot does it a minute after their tap. Run no command for it. End your turn with one short line.'
  }
  bot.callbackQuery(/^pwr:(sleep|off|tidy|no):([0-9a-f]{8})$/, async ctx => {
    const [, what, id] = ctx.match
    const o = powerAsks.get(id)
    const msg = ctx.callbackQuery.message
    if (!o) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    const { chatId, topicId } = parseKey(o.key)
    const draw = (md: string, rows: RichButton[][] = []) => (msg ? editRich(chatId, msg.message_id, rows.length ? `${md}\n\n${richButtons(rows)}` : md) : Promise.resolve(false))
    await ctx.answerCallbackQuery()
    if (what === 'tidy') {
      o.tidy = tidyNext(o.tidy)
      return draw(powerCard(o), powerKeyboard(id, o))
    }
    powerAsks.delete(id)
    const name = mdText(deviceName(o.deviceId))
    if (what === 'no') return draw(tr(`💻 **${name}** stays on.`, `💻 **${name}** остаётся включён.`))
    const how: PowerHow = what === 'off' ? 'off' : 'sleep'
    const dev = gateway.device(o.deviceId)
    const t = topics.get(o.key)
    // run_command needs a project there: this topic's, or any topic's on that computer
    const projectId = (t.deviceId === o.deviceId ? t.projectId : undefined) ?? [...topics.entries()].find(([, x]) => x.deviceId === o.deviceId && x.projectId)?.[1].projectId
    if (!dev || !projectId) return draw(tr(`💻 **${name}** is not online any more: nothing was done.`, `💻 **${name}** уже не в сети: ничего не сделано.`))
    log.info('power chosen', { key: o.key, device: dev.id, how, tidy: o.tidy })
    await draw(how === 'off'
      ? tr(`⏻ **${name}** turns off in a minute${o.tidy ? ', after its windows close' : ''}.`, `⏻ **${name}** выключится через минуту${o.tidy ? ', после закрытия окон' : ''}.`)
      : tr(`💤 **${name}** goes to sleep in a minute${o.tidy ? ', after its windows close' : ''}.`, `💤 **${name}** уснёт через минуту${o.tidy ? ', после закрытия окон' : ''}.`))
    background((async () => {
      if (o.tidy) await tidyComputer(dev, projectId, chatId, topicId, o.tidy === 'force')
      if (!(await powerDown(dev, projectId, how, chatId, topicId))) {
        await api.sendMessage(chatId, tr(`💻 <b>${esc(dev.name)}</b>: the command didn't go through, it stays on.`, `💻 <b>${esc(dev.name)}</b>: команда не прошла, он остаётся включён.`), { ...where(topicId), ...HTML }).catch(() => {})
      }
    })())
  })

  // The week's limit used so far by each signed-in profile, in percent
  async function weeksUsed() {
    const out: Record<string, number> = {}
    for (const name of profiles.list()) {
      const u = await profiles.usage(name).catch(() => null)
      if (u?.sevenDay?.utilization != null) out[name] = u.sevenDay.utilization
    }
    return out
  }

  // In the private chat, with the head's lists: a card. Otherwise, or when Telegram won't take it, the line
  async function morningCard(sh: Shift) {
    const { chatId, topicId } = parseKey(sh.key)
    if (chatId < 0 || !(sh.finished?.length || sh.left?.length) || !sh.startedAt || !sh.endedAt) return false
    const now = await weeksUsed()
    const own = profiles.nameOf(topics.get(sh.key).profile)
    const before = sh.weeksAt ?? (sh.weekAt !== undefined ? { [own]: sh.weekAt } : {})
    // A week that started over in the night leaves nothing to compare. Every profile the night ran on, by name
    const points = (name: string) => (now[name] !== undefined && before[name] !== undefined && now[name] >= before[name] ? now[name] - before[name] : undefined)
    const used = (sh.profilesUsed ?? []).flatMap(name => (points(name) !== undefined ? [{ name, points: points(name)! }] : []))
    const html = nightWidgetHtml({ from: sh.startedAt, to: sh.endedAt, zone: zone(), finished: sh.finished ?? [], left: sh.left ?? [], weekPoints: points(own), ...(used.length > 1 && { byProfile: used }), power: sh.power })
    if (widgetProblem(html)) return false
    try {
      await keepLoud(() => (api.raw as unknown as { sendWidget: (o: object) => Promise<unknown> }).sendWidget({ chat_id: chatId, ...where(topicId), html, width: 320 }))
      return true
    } catch (e) {
      log.warn('morning card', (e as Error).message)
      return false
    }
  }

  async function pingMorning(sh: Shift) {
    shifts.change(sh.id, { pinged: true })
    const { chatId, topicId } = parseKey(sh.key)
    if (await morningCard(sh)) return
    await keepLoud(() => api.sendMessage(chatId, morningPing(sh, zone()), where(topicId))).catch(e => log.warn('morning push', (e as Error).message))
  }

  setInterval(() => {
    if (closing) return
    const now = Date.now()
    for (const sh of shifts.all()) {
      const { chatId, topicId } = parseKey(sh.key)
      if (sh.state === 'ended' && !sh.pinged && now >= (sh.morningAt ?? 0)) background(pingMorning(sh))
      if (sh.state !== 'running') continue
      const l = liveOf(sh.key)
      const busy = l.busy || l.queue.length > 0 || workersOf(sh.key).some(k => liveOf(k).busy)
      // Morning before the end: the head sums up what there is
      // Both go into a turn under way after its current step: a head can be in one turn for hours
      if (now >= (sh.morningAt ?? Infinity) && !sh.morningAsked) {
        shifts.change(sh.id, { morningAsked: true })
        enqueue(chatId, topicId, '[It is morning: the user wakes up now. Start nothing new. Call end_night_shift with done=false unless everything is done, and write the summary.]', { reply: false, rush: true })
      } else if (now >= (sh.wrapAt ?? Infinity) && !sh.wrapAsked) {
        shifts.change(sh.id, { wrapAsked: true })
        log.info('night shift: wrap-up', { key: sh.key })
        enqueue(chatId, topicId, '[Night shift: it is wrap-up time. Start nothing long now: no full test runs, no long renders, nothing you would have to wait for. Finish what is quick, commit and push what is ready by the shift\'s rules, tell your agents to wrap up too, then call end_night_shift (done=true only if everything is done) and write the summary.]', { reply: false, rush: true })
      } else if (!busy && now - (sh.activeAt ?? now) >= (cfg.shiftQuietMs ?? 3600_000)) {
        shifts.change(sh.id, { activeAt: now })
        enqueue(chatId, topicId, '[Night shift: an hour has gone by quietly. Look at your agents (team_status): unblock the stuck, accept what is done, start what is next. If everything is done, end the shift.]', { reply: false })
      }
    }
  }, cfg.shiftTickMs ?? 60_000).unref()

  // --- work put off until a limit resets ------------------------------------------------------------
  function wakePause(p: Pause) {
    const { chatId, topicId } = parseKey(p.key)
    log.info('paused work goes on', { key: p.key, fresh: !!p.fresh, attempts: p.attempts })
    const t = topics.get(p.key)
    // Its computer is off: one message that says both. The queue then waits for it as for any other, without a word of its own
    const away = !t.noProject && t.deviceId && !gateway.device(t.deviceId) ? deviceName(t.deviceId) : null
    if (away) liveOf(p.key).waitingDevice = true
    api.sendMessage(chatId, away
      ? tr(`⏳ The limit has reset. The task starts when <b>${esc(away)}</b> connects.`, `⏳ Лимит обновился. Задача начнётся, когда подключится <b>${esc(away)}</b>.`)
      : p.fresh
        ? tr('▶️ Starting the task you put off for a fresh limit.', '▶️ Начинаю задачу, отложенную до свежего лимита.')
        : tr('▶️ The limit has reset: going on with the task.', '▶️ Лимит обновился, продолжаю задачу.'), { ...where(topicId), ...HTML }).catch(e => log.debug('limit note', (e as Error).message))
    if (!p.fresh) liveOf(p.key).limitAttempts = p.attempts
    // Ahead of what waited behind it. A fresh task is a new one, and takes its place in line
    enqueue(chatId, topicId, p.fresh ? p.text : resumePrompt(p.text), {
      images: (p.images ?? []) as PromptImage[], reply: false, silent: true, fromMode: p.fromMode as Mode | undefined,
      ...(!p.fresh && { seq: Number.MIN_SAFE_INTEGER }),
    })
  }
  setInterval(() => {
    if (!closing) for (const p of pauses.due(cfg.limitGraceMs ?? 60_000)) wakePause(p)
  }, cfg.limitTickMs ?? 20_000).unref()

  bot.callbackQuery('lmt:off', async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    const dropped = pauses.dropHolding(key)
    await ctx.answerCallbackQuery(dropped ? tr('It won\'t go on by itself', 'Само не продолжится') : tr('No longer relevant', 'Уже неактуально'))
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {})
    if (dropped && liveOf(key).queue.length) schedule(key)
  })

  // Little of the limit left and a big task: Claude asks, the user decides here. Put off, it waits on disk like a task
  // the limit stopped, and leaves the topic free meanwhile
  const freshOffers = new Map<string, { key: string, text: string, until: number, profile: string }>()
  async function offerFresh(key: string, text: string, w: { pct: number, resetsAt: number, label: string }, profile: string, why: string) {
    const { chatId, topicId } = parseKey(key)
    const id = randomBytes(4).toString('hex')
    freshOffers.set(id, { key, text, until: w.resetsAt, profile })
    const rows: RichButton[][] = [[{ text: tr('⏳ Wait for the reset', '⏳ Дождаться сброса'), data: `frl:later:${id}` }, { text: tr('▶️ Now', '▶️ Сейчас'), data: `frl:now:${id}` }]]
    const choice = await keepLoud(() => sendChoice(chatId, topicId, [
      tr(`⏳ **${Math.round(w.pct)}% of the limit is used** (${mdText(w.label)}), it resets ${resetTag(w.resetsAt)}.`, `⏳ **Лимит использован на ${Math.round(w.pct)}%** (${mdText(w.label)}), сброс ${resetTag(w.resetsAt)}.`),
      tr(`The task is big (${mdText(why)}) and may be cut off halfway. Wait, and it starts by itself after the reset?`, `Задача большая (${mdText(why)}) и может оборваться на середине. Подождать, чтобы она началась сама после сброса?`),
    ].join('\n\n'), rows, goKeyboard(rows))).catch(() => null)
    offers.open(key, 'retry', choice?.messageId)
    return 'The user decides with a card: wait for the reset, or now. Don\'t start the task. End your turn with one short line; you will get word of what they chose.'
  }
  bot.callbackQuery(/^frl:(later|now):([0-9a-f]{8})$/, async ctx => {
    const o = freshOffers.get(ctx.match[2])
    if (!o) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    freshOffers.delete(ctx.match[2])
    await ctx.answerCallbackQuery()
    const msg = ctx.callbackQuery.message
    const { chatId, topicId } = parseKey(o.key)
    if (ctx.match[1] === 'now') {
      if (msg) await editRich(chatId, msg.message_id, tr('▶️ Going now.', '▶️ Делаю сейчас.'))
      return enqueue(chatId, topicId, '[The user wants the task done now, in this limit window. Go on with it.]', { reply: false, shownId: msg?.message_id })
    }
    const p = pauses.add({ key: o.key, until: o.until, profile: o.profile, text: o.text, attempts: 0, fresh: true })
    log.info('task put off for a fresh limit', { key: o.key })
    const rows: RichButton[][] = [[{ text: tr('▶️ Start now', '▶️ Начать сейчас'), data: `frs:now:${p.id}` }, { text: tr('Cancel', 'Отмена'), data: `frs:no:${p.id}` }]]
    if (msg) await editRich(chatId, msg.message_id, `${tr(`⏳ **Put off for a fresh limit.** It starts by itself ${resetTag(o.until)}.`, `⏳ **Отложено до свежего лимита.** Начнётся само ${resetTag(o.until)}.`)}\n\n${richButtons(rows)}`)
  })
  bot.callbackQuery(/^frs:(now|no):(\w+)$/, async ctx => {
    const p = pauses.drop(ctx.match[2])
    if (!p) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    await ctx.answerCallbackQuery()
    const id = ctx.callbackQuery.message?.message_id
    if (id) await editRich(ctx.chat!.id, id, ctx.match[1] === 'now' ? tr('▶️ Started.', '▶️ Запущено.') : tr('Cancelled.', 'Отменено.'))
    if (ctx.match[1] === 'now') wakePause(p)
  })

  // A new task in a long conversation: a fresh session for it, at the user's tap
  const newSession = createNewSessionOffers({
    send: async (key, md, rows) => {
      const { chatId, topicId } = parseKey(key)
      const choice = await keepLoud(() => sendChoice(chatId, topicId, md, rows, goKeyboard(rows))).catch(() => null)
      offers.open(key, 'retry', choice?.messageId)
      return choice?.messageId
    },
    edit: (key, messageId, md) => editRich(parseKey(key).chatId, messageId, md),
    reset: key => {
      topics.set(key, { sessionId: null, envChanged: false })
      flights.session(key, null)
      log.info('new session for a new task', { key })
    },
    run: (key, text, images, shownId) => {
      const { chatId, topicId } = parseKey(key)
      enqueue(chatId, topicId, text, { images, reply: false, shownId })
    },
    mdText,
  })
  bot.callbackQuery(/^nss:(new|keep):([0-9a-f]{8})$/, async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    const how = ctx.match[1] as 'new' | 'keep'
    // Not under a turn that runs in the old session
    if (how === 'new' && liveOf(key).busy) return ctx.answerCallbackQuery({ text: tr('Wait for the task to finish first, or /stop', 'Сначала дождись конца задачи или /stop'), show_alert: true })
    const done = newSession.choose(ctx.match[2], how, topics.get(key).sessionId, ctx.callbackQuery.message?.message_id)
    await ctx.answerCallbackQuery(done ? undefined : tr('No longer relevant', 'Уже неактуально'))
  })

  // Topics write to each other within their chat. They could also go on doing that for ever at the user's expense, so a
  // run of messages with no word from the user stops, and the user's next word opens it again
  const TOPIC_WAKES_MAX = 10
  const topicWakes = new Map<number, number>()
  const topicsOf = (chatId: number) => topics.entries().filter(([k]) => parseKey(k).chatId === chatId && parseKey(k).topicId)

  async function messageTopic(key: string, p: TopicMessage) {
    const { chatId, topicId } = parseKey(key)
    const others = topicsOf(chatId).filter(([k]) => k !== key)
    const wanted = p.topic.trim().toLowerCase()
    const named = others.filter(([k, t]) => topicLabel(k, t).toLowerCase() === wanted)
    const found = named.length ? named : others.filter(([k, t]) => [`#${parseKey(k).topicId}`, projectNameOf(t)].some(n => n?.toLowerCase() === wanted))
    const names = others.map(([k, t]) => topicLabel(k, t)).join(', ') || 'none'
    if (!found.length) return `Not delivered: no topic «${p.topic}» in this chat. Topics here: ${names}.`
    if (found.length > 1) return `Not delivered: several topics here are called «${p.topic}». The user can rename one.`
    const n = (topicWakes.get(chatId) ?? 0) + 1
    if (n > TOPIC_WAKES_MAX) {
      if (n === TOPIC_WAKES_MAX + 1) {
        topicWakes.set(chatId, n)
        await api.sendMessage(chatId, tr(`⏸ <b>Topics sent each other ${TOPIC_WAKES_MAX} messages in a row without you.</b>\nWrite anything in any topic, and they go on.`, `⏸ <b>Топики отправили друг другу ${TOPIC_WAKES_MAX} сообщений подряд без тебя.</b>\nНапиши что-нибудь в любом топике, и они продолжат.`), { ...where(topicId), ...HTML }).catch(() => {})
      }
      return 'Not delivered: topics have written to each other too many times without the user. Tell the user what you wanted to pass on and stop; it opens again when they write.'
    }
    const [toKey, to] = found[0]
    const from = topics.get(key)
    // It would arrive twice, and wake the head twice
    if (from.head === toKey) return 'Not delivered: that topic is your head. The final answer of this turn reaches it as your report: put this there.'
    const toTopic = parseKey(toKey).topicId
    const name = topicLabel(key, from)
    const shown = await foldedMessage(chatId, toTopic, `<b>${tr('✉️ From the topic', '✉️ Из топика')} ${topicA(key, name)}</b>`, p.text)
    // Telegram doesn't tell a bot that a topic was deleted: here is where that shows
    if (!shown) return `Not delivered: the topic «${p.topic}» can't be reached. It may have been deleted.`
    topicWakes.set(chatId, n)
    log.info('topic message', { from: key, to: toKey })
    enqueue(chatId, toTopic, topicMessagePrompt(name, p.text), { reply: false, shownId: shown.message_id, fromMode: senderCap(turnMode(key), isCloud(from.deviceId), isCloud(to.deviceId)) })
    return `Delivered to «${topicLabel(toKey, to)}». It works by itself from here; its answer stays there unless it writes back.`
  }

  // Tasks put off for a computer. It has to stay online for a moment first, since a laptop can wake for a few seconds in
  // its sleep, and there is a moment to call them off: nobody asked for them just now
  const DEFER_MAX = 20
  const deferArms = new Map<string, NodeJS.Timeout>()
  const disarm = (key: string) => {
    clearTimeout(deferArms.get(key))
    deferArms.delete(key)
  }
  function armDeferred(key: string) {
    const t = topics.get(key)
    const dev = t.deviceId ? gateway.device(t.deviceId) : undefined
    if (!dev || !t.deferred?.length || deferArms.has(key)) return
    const { chatId, topicId } = parseKey(key)
    const connectedAt = (dev as { connectedAt?: number }).connectedAt
    const here = () => {
      const now = gateway.device(dev.id) as { connectedAt?: number } | undefined
      return !!now && now.connectedAt === connectedAt && topics.get(key).deviceId === dev.id
    }
    const settle = cfg.deferredSettleMs ?? 15_000
    const later = (work: () => Promise<unknown> | void) => setTimeout(() => {
      deferArms.delete(key)
      if (here()) background(Promise.resolve(work()))
    }, settle).unref()
    deferArms.set(key, later(async () => {
      const tasks = topics.get(key).deferred ?? []
      if (!tasks.length) return
      const rows: RichButton[][] = [[{ text: tr('Cancel them', 'Отменить'), data: 'dfc' }]]
      await sendChoice(chatId, topicId, [
        tr(`🟢 **${mdText(dev.name)} is online.** Starting in a moment:`, `🟢 **${mdText(dev.name)} в сети.** Сейчас начну:`),
        deferredNames(topics.get(key)).map(x => `- ${mdText(x)}`).join('\n'),
      ].join('\n\n'), rows, goKeyboard(rows))
      deferArms.set(key, later(() => {
        const now = topics.get(key).deferred ?? []
        if (!now.length) return
        topics.set(key, { deferred: undefined, deferredTitles: undefined })
        log.info('deferred tasks started', { key, device: dev.id, tasks: now.length })
        enqueue(chatId, topicId, deferredPrompt(dev.name, now), { reply: false })
      }))
    }))
  }
  const deferredNames = (t: Topic) => (t.deferred ?? []).map((task, i) => t.deferredTitles?.[i] ?? trunc(task, 60))
  async function deferTask(key: string, task: string, title = trunc(task, 60)) {
    const t = topics.get(key)
    if ((t.deferred?.length ?? 0) >= DEFER_MAX) return `${DEFER_MAX} tasks are already put off. Tell the user the list is full: /stop clears it.`
    // Side by side, so tasks put off by an older version keep their place
    topics.set(key, { deferred: [...(t.deferred ?? []), task], deferredTitles: [...deferredNames(t), title] })
    log.info('task deferred', { key, count: (t.deferred?.length ?? 0) + 1 })
    const { chatId, topicId } = parseKey(key)
    const device = mdText(deviceName(t.deviceId!))
    const md = `${tr(`📌 **Waits for ${device}:** ${mdText(title)}`, `📌 **Ждёт ${device}:** ${mdText(title)}`)}\n\n<details><summary>${tr('The task', 'Текст задачи')}</summary>\n\n${mdText(task)}\n\n</details>`
    await sendRich(chatId, topicId, md).catch(e => log.warn('deferred note', (e as Error).message))
    // It may have come back during this very turn
    armDeferred(key)
    return 'Written down, and the chat shows it. It starts by itself when the computer connects: do not tell the user to remind you.'
  }
  bot.callbackQuery('dfc', async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message as Message | undefined))
    const had = topics.get(key).deferred?.length ?? 0
    disarm(key)
    topics.set(key, { deferred: undefined, deferredTitles: undefined })
    log.info('deferred tasks cancelled', { key, tasks: had })
    await ctx.answerCallbackQuery(had ? tr('Cancelled', 'Отменено') : tr('No longer relevant', 'Уже неактуально'))
    const id = ctx.callbackQuery.message?.message_id
    if (had && id) await editRich(ctx.chat!.id, id, tr('Tasks put off for this computer are cancelled.', 'Отложенные задачи отменены.'))
  })

  gateway.events.on('online', dev => {
    for (const [key, t] of topics.entries()) {
      if (t.deviceId !== dev.id) continue
      const l = live.get(key)
      if (l) l.offlineNoted = false
      // A new connection: anything counted on the old one is over
      if (t.deferred?.length) {
        disarm(key)
        armDeferred(key)
      }
    }
    for (const [key, l] of live) {
      if (l.waitingDevice && topics.get(key).deviceId === dev.id) {
        const { chatId, topicId } = parseKey(key)
        api.sendMessage(chatId, tr(`🔌 <b>${esc(dev.name)}</b> is back online, going on.`, `🔌 <b>${esc(dev.name)}</b> снова в сети, продолжаю.`), { ...where(topicId), ...HTML }).catch(() => {})
        processQueue(key)
      }
    }
  })

  // 🔥 👍 ❤️ on answers, said to Claude with the next prompt of the topic
  const praise = new Map<string, string[]>()
  const PRAISE_KEPT = 3
  // An app's MCP call that has hung for minutes: one tap restarts that server on the computer, and the call fails with it.
  // The card goes once the call ends either way
  const appHangs = new Map<string, { deviceId: string, server: string }>()
  async function offerAppRestart(chatId: number, topicId: number | undefined, deviceId: string, server: string, done: Promise<OpOutcome>) {
    const id = randomBytes(4).toString('hex')
    appHangs.set(id, { deviceId, server })
    const app = server.replace(/[-_]/g, ' ')
    const rows: RichButton[][] = [[{ text: tr('🔄 Restart the bridge', '🔄 Перезапустить мост'), data: `apr:${id}`, style: 'primary' }, { text: tr('Wait', 'Подождать'), data: `apw:${id}` }]]
    const md = [
      tr(`### ⏳ ${mdText(app)} isn't answering`, `### ⏳ ${mdText(app)} не отвечает`),
      tr(`A call to it has been waiting for ${Math.round((cfg.appHangMs ?? APP_HANG_MS) / 60_000)} min. If the app was restarted or hangs, restarting the bridge frees it: the call fails and Claude tries again.`, `Вызов к нему ждёт уже ${Math.round((cfg.appHangMs ?? APP_HANG_MS) / 60_000)} мин. Если приложение перезапускали или оно зависло, перезапуск моста освободит его: вызов завершится с ошибкой, и Claude попробует снова.`),
    ].join('\n\n')
    const choice = await sendChoice(chatId, topicId, md, rows, goKeyboard(rows)).catch(() => null)
    log.info('app call hangs', { device: deviceId, server })
    done.then(() => {
      if (!appHangs.delete(id) || !choice) return
      editRich(chatId, choice.messageId, `${md}\n\n> ${tr('✅ It answered.', '✅ Ответило.')}`).catch(() => {})
    })
  }
  bot.callbackQuery(/^ap([rw]):([0-9a-f]{8})$/, async ctx => {
    const h = appHangs.get(ctx.match[2])
    const msgId = ctx.callbackQuery.message?.message_id
    const settle = (note: string) => msgId && ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(note, 'noop') }).catch(() => {})
    if (!h) {
      await ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
      return settle(tr('⌛ No longer relevant', '⌛ Неактуально'))
    }
    if (ctx.match[1] === 'w') {
      await ctx.answerCallbackQuery()
      return settle(tr('⏳ Waiting', '⏳ Ждём'))
    }
    appHangs.delete(ctx.match[2])
    const out = await gateway.request(h.deviceId, { projectId: '', bindingVersion: 0, tool: 'mcp_restart', params: { server: h.server } })
    const r = out.ok ? out.result as { restarted: boolean, error?: string } : null
    log.info('app bridge restarted', { device: h.deviceId, server: h.server, ok: !!r?.restarted })
    await ctx.answerCallbackQuery(r?.restarted ? tr('Restarting', 'Перезапускаю') : tr('Not restarted', 'Не перезапущен'))
    return settle(r?.restarted ? tr('🔄 Restarted: it is back in a few seconds', '🔄 Перезапущен: вернётся через несколько секунд') : `⚠️ ${r?.error ?? (out.ok ? '' : out.error.message)}`.slice(0, 60))
  })

  // A head's team at a glance: one pinned message in its topic, redrawn when an agent's state changes, instead of /team.
  // Checked on a timer: states change in many places, and an edit only goes when the board reads differently
  const boards = new Map<string, string>()
  // One quote per agent: its state and for how long, then what it works on and the step it is at
  const span = (ms: number) => {
    const min = Math.max(1, Math.round(ms / 60_000))
    return min < 60 ? tr(`${min} min`, `${min} мин`) : tr(`${Math.floor(min / 60)} h ${min % 60} min`, `${Math.floor(min / 60)} ч ${min % 60} мин`)
  }
  const clockOf = (t: number) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: schedules.zone() }).format(t)
  const stepOf = (steps: ChecklistStep[]) => {
    const now = steps.find(s => s.state === 'now')
    return `${steps.filter(s => s.state === 'done').length}/${steps.length}${now ? ` ${trunc(now.text, 50)}` : ''}`
  }
  // What a computer said of itself in the last ten minutes: older says nothing of now
  const freshLoad = (d: { load?: { busy: number, idleSec?: number, at: number } }) => (d.load && Date.now() - d.load.at < 10 * 60_000 ? d.load : undefined)
  // What it has and how busy it is, for /devices
  const capacityText = (d: { cores?: number, memGb?: number, load?: { busy: number, idleSec?: number, at: number } }) => {
    const load = freshLoad(d)
    return [
      d.cores && count(d.cores, ['core', 'cores'], ['ядро', 'ядра', 'ядер']),
      d.memGb && tr(`${d.memGb} GB`, `${d.memGb} ГБ`),
      load && tr(`${load.busy}% busy`, `загрузка ${load.busy}%`),
      load?.idleSec !== undefined && load.idleSec < 120 && tr('someone is at it', 'за ним работают'),
    ].filter(Boolean).join(' · ')
  }
  function boardEntry(k: string) {
    const t = topics.get(k)
    const l = live.get(k)
    const state = stateOf(k)
    const [icon, ...word] = STATE_LABEL[state].split(' ')
    const reported = reportedAt.get(k)
    const when = state === 'working' && l?.since ? span(Date.now() - l.since)
      : state === 'idle' && reported ? tr(`report at ${clockOf(reported)}`, `отчёт в ${clockOf(reported)}`)
      : word.join(' ')
    const what = [t.workerDoing && trunc(t.workerDoing, 60), state === 'working' && l?.checklist?.length && stepOf(l.checklist)].filter(Boolean).join(' → ')
    // On another computer than its head: said, so that it is plain whose processors the work takes
    const away = t.deviceId && t.head && t.deviceId !== topics.get(t.head).deviceId ? ` · ${iconOf({ id: t.deviceId, os: gateway.device(t.deviceId)?.os })} ${mdText(deviceName(t.deviceId))}` : ''
    return `> ${icon} **${topicMd(k, t.workerName ?? '?')}**${away} · ${when} · ${mdText(modelLabel(modelOf(t)))}${what ? `  \n> ${mdText(what)}` : ''}`
  }
  function boardMarkdown(headKey: string) {
    const team = workersOf(headKey)
    const waiting = topics.get(headKey).waitingAgents ?? []
    if (!team.length && !waiting.length) return null
    const queued = waiting.map(w => `> ⏳ **${mdText(w.name)}** · ${tr(`starts after ${mdText(w.after)}`, `начнёт после ${mdText(w.after)}`)}${w.doing ? `  \n> ${mdText(trunc(w.doing, 60))}` : ''}`)
    const states = team.map(stateOf)
    const n = (s: string) => states.filter(x => x === s).length
    const sums = [
      n('working') && count(n('working'), ['working', 'working'], ['работает', 'работают', 'работают']),
      n('asking') && count(n('asking'), ['waits for you', 'wait for you'], ['ждёт тебя', 'ждут тебя', 'ждут тебя']),
      n('queued') && count(n('queued'), ['queued', 'queued'], ['в очереди', 'в очереди', 'в очереди']),
      n('idle') && count(n('idle'), ['idle', 'idle'], ['свободен', 'свободны', 'свободны']),
      waiting.length && count(waiting.length, ['not started', 'not started'], ['ждёт старта', 'ждут старта', 'ждут старта']),
    ].filter(Boolean)
    // How busy the computers of this team are, the head's first
    const at = [...new Set([headKey, ...team].map(k => topics.get(k).deviceId).filter((id): id is string => !!id))]
    const loads = at.map(id => gateway.device(id)).filter((d): d is NonNullable<typeof d> => !!d && !!freshLoad(d))
      .map(d => `${iconOf(d)} ${mdText(d.name)} ${freshLoad(d)!.busy}%`)
    return [tr('### 🧭 Team', '### 🧭 Команда'), ...team.map(boardEntry), ...queued, `<footer>${[...sums, ...loads, tr('updates by itself', 'обновляется само')].join(' · ')}</footer>`].join('\n\n')
  }
  // What a failed edit of the board means. Only a board that is gone is sent anew. While Telegram is down or slow every
  // edit fails, and a board sent at each failure became thirty boards in every head's topic the moment it answered again
  const BOARD_GONE = /message to edit not found|message was deleted|message can't be edited|MESSAGE_ID_INVALID/i
  // Heads whose board could not be edited for now: said once in the log, not at every tick
  const boardWaits = new Set<string>()
  async function drawBoard(headKey: string) {
    const md = boardMarkdown(headKey)
    const t = topics.get(headKey)
    if (!md) {
      if (t.boardId) {
        const { chatId } = parseKey(headKey)
        await api.unpinChatMessage(chatId, t.boardId).catch(() => {})
        await api.deleteMessage(chatId, t.boardId).catch(() => {})
        topics.set(headKey, { boardId: undefined })
      }
      boards.delete(headKey)
      return
    }
    if (boards.get(headKey) === md) return
    const { chatId, topicId } = parseKey(headKey)
    if (t.boardId) {
      const failed = await api.raw.editMessageText({ chat_id: chatId, message_id: t.boardId, rich_message: { markdown: md } }).then(() => '', e => (e as Error).message || 'failed')
      if (!failed || /message is not modified/.test(failed)) {
        boardWaits.delete(headKey)
        return void boards.set(headKey, md)
      }
      if (!BOARD_GONE.test(failed)) {
        // Still there, as far as anyone knows: the next tick tries again
        if (!boardWaits.has(headKey)) log.warn('team board waits', failed)
        boardWaits.add(headKey)
        return
      }
    }
    boardWaits.delete(headKey)
    const old = t.boardId
    const sent = await api.sendRichMessage(chatId, { markdown: md }, { ...where(topicId), disable_notification: true }).catch(e => log.warn('team board', (e as Error).message))
    if (!sent) return
    topics.set(headKey, { boardId: sent.message_id })
    boards.set(headKey, md)
    await api.pinChatMessage(chatId, sent.message_id, { disable_notification: true }).catch(e => log.warn('team board pin', (e as Error).message))
    // The board it replaces would stay pinned beside it
    if (old) {
      await api.unpinChatMessage(chatId, old).catch(() => {})
      await api.deleteMessage(chatId, old).catch(() => {})
    }
  }
  const boardTimer = setInterval(() => {
    const heads = new Set([...topics.entries()].flatMap(([k, t]) => (t.workers?.length || t.boardId || t.waitingAgents?.length ? [k] : [])))
    for (const k of heads) drawBoard(k).catch(e => log.warn('team board', (e as Error).message))
  }, cfg.boardTickMs ?? BOARD_TICK_MS)
  boardTimer.unref?.()

  // A topic that has spent a good part of the week in one day: said once that day, in that topic, with the two things
  // that help most. Most of it is rereading a long history
  async function warnSpend(key: string) {
    const t = topics.get(key)
    const { chatId, topicId } = parseKey(key)
    const pct = Math.round(spend.shareOfWeek(key) * 100)
    log.info('topic spends a lot', { key, pct })
    const rows: RichButton[][] = [[
      ...(t.sessionId ? [{ text: tr('🗜 Compact the history', '🗜 Сжать историю'), data: 'cp:go' }] : []),
      ...(/opus/i.test(modelOf(t)) ? [{ text: tr('🧠 Switch to Sonnet', '🧠 Перевести на Sonnet'), data: 'csn:go' }] : []),
    ]].filter(r => r.length)
    const md = [
      tr(`### 💸 This topic spent about ${pct}% of the week today`, `### 💸 Этот топик сегодня потратил около ${pct}% недели`),
      tr('Most of it is Claude rereading a long history at every step. Compacting it, or Sonnet for routine work, makes each step several times cheaper.', 'Больше всего уходит на то, что Claude на каждом шаге перечитывает длинную историю. Сжатие или Sonnet для рутины делают каждый шаг в разы дешевле.'),
      `<footer>${tr('An estimate: Anthropic doesn\'t publish the limits. /usage shows the topics of the week.', 'Оценка: Anthropic не публикует лимиты. /usage покажет топики за неделю.')}</footer>`,
    ].join('\n\n')
    await (rows.length ? sendChoice(chatId, topicId, md, rows, goKeyboard(rows)) : sendRich(chatId, topicId, md))
  }
  bot.callbackQuery('csn:go', async ctx => {
    const key = topicKey(ctx.chat!.id, topicOf(ctx.callbackQuery.message))
    topics.set(key, { model: agentModel('sonnet') })
    log.info('switched to sonnet from the spend card', { key })
    await ctx.answerCallbackQuery(tr('Sonnet from the next task', 'Sonnet со следующей задачи'))
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(tr('🧠 Sonnet from the next task', '🧠 Sonnet со следующей задачи'), 'noop') }).catch(() => {})
  })

  async function tidyComputer(dev: { id: string, name: string, os: Device['os'] }, projectId: string, chatId: number, topicId: number | undefined, force = false) {
    const how = cfg.shiftTidy ?? tidyCommand(dev.os, false, force)
    if (!how) return
    const out = await gateway.request(dev.id, { projectId, bindingVersion: 0, tool: 'run_command', params: { ...how, timeoutSec: 120 } })
    const r = out.ok ? parseTidy(String((out.result as { stdout?: string }).stdout ?? '')) : null
    log.info('computer tidied', { device: dev.id, ok: !!r, force, closed: r?.closed, left: r?.left.length, killed: r?.killed?.length })
    background(api.sendMessage(chatId, tidyLine(dev.name, r, esc), { ...where(topicId), ...HTML, disable_notification: true }).catch(() => {}))
  }

  // Sent to sleep or told to turn off, still there a while later on a connection from before it should have gone: said
  // once, so the morning doesn't find it on unawares. A computer that slept and woke has a connection from after it, and
  // is not a failure; one that only reconnected in the minute before is no proof of one (a night it stayed on all the same)
  const SLEEP_AFTER_MS = 60_000
  function checkAsleep(deviceId: string, orderedAt: number, chatId: number, topicId: number | undefined, how: PowerHow = 'sleep') {
    const timer = setTimeout(() => {
      const dev = gateway.device(deviceId)
      if (!dev || dev.connectedAt > orderedAt + SLEEP_AFTER_MS + 30_000) return
      log.warn('computer still on', { device: deviceId, how })
      background(api.sendMessage(chatId, how === 'off'
        ? tr(`💻 <b>${esc(dev.name)}</b> was told to turn off, but it is still on. Something holds it: a Windows update or a system prompt. It needs a look.`, `💻 <b>${esc(dev.name)}</b> получил команду выключиться, но всё ещё включён. Что-то его держит: обновление Windows или системный запрос. Стоит посмотреть.`)
        : tr(`💻 <b>${esc(dev.name)}</b> was told to sleep, but it is still awake. Something holds it: a Windows update or a system prompt. It needs a look in the morning.`, `💻 <b>${esc(dev.name)}</b> получил команду уснуть, но всё ещё не спит. Что-то его держит: обновление Windows или системный запрос. Утром стоит посмотреть.`), { ...where(topicId), ...HTML }).catch(() => {}))
    }, cfg.shiftOffCheckMs ?? 10 * 60_000)
    timer.unref?.()
  }

  // Topics whose Chrome is on only for the scheduled run under way
  const browserForRun = new Set<string>()
  async function runOne(key: string, prompt: string, l: Live, images: PromptImage[] = [], replyTo?: number): Promise<TurnOutcome> {
    const { chatId, topicId } = parseKey(key)
    const abort = l.abort ?? new AbortController()
    l.abort = abort
    if (browserIdle(topics.get(key), Date.now())) {
      topics.set(key, { browser: false, browserAuto: false })
      log.info('browser off: idle', { key })
    }
    // Its computer may run on another Claude profile now: the conversation goes along before anything starts
    await followDeviceProfile(key)
    // One memory of the user for every profile the topic may run on
    profiles.shareMemory?.(profiles.nameOf(topics.get(key).profile), workDir)
    const t = topics.get(key)
    let chromeUsed = false
    // “No project”: no computer and no project, a conversation; Claude may offer a project (suggest_project)
    const offline = !t.noProject && !gateway.device(t.deviceId!)
    const dev = t.noProject || offline ? undefined : gateway.device(t.deviceId!)!
    let project = dev
      ? dev.projects.find(p => p.id === t.projectId) ?? (await gateway.refreshProjects(dev.id)).find(p => p.id === t.projectId)
      : undefined
    if (dev && !project) throw new Error(tr(`The project ${t.projectId} isn't on ${dev.name}. Choose another: /project`, `Проекта ${t.projectId} нет на компьютере ${dev.name}. Выбери другой: /project`))
    if (t.nameImplicit && topicId) {
      topics.set(key, { nameImplicit: false })
      // A few words about the task, made by a small model alongside the turn; the plain cut if that fails
      const said = masked(chatId, topicId, topicName(prompt), true)
      topicTitle(said, { cwd: workDir, env: profiles.env(t.profile) })
        .then(title => {
          const name = trunc(masked(chatId, topicId, title ?? said, true), title ? 60 : 40)
          topics.set(key, { title: name })
          return api.editForumTopic(chatId, topicId, { name })
        })
        .catch(e => log.warn('topic not named', (e as Error).message))
    }
    const binding = t.bindingVersion
    // Kept for the turn that has the computer again
    const tellEnv = t.envChanged && !offline
    const fullPrompt = tellEnv ? `${envChangedNote(dev, project, t.envCame)}\n\n${prompt}` : prompt
    // The user's CLAUDE.md / AGENTS.md / memory index, read fresh from the device every turn;
    // without them the turn still runs, just without the project's rules
    let ctx: ProjectContext | null = null
    let heldBack: ContextFile[] = []
    if (dev && project) {
      const ctxOut = await gateway.request(dev.id, { projectId: project.id, bindingVersion: binding, tool: 'project_context', params: {} }, abort.signal)
      ctx = ctxOut.ok ? ctxOut.result as ProjectContext : null
      if (!ctxOut.ok) log.warn('project context unavailable', { key, error: ctxOut.error })
      // The device's own view of the project: folders granted in an earlier turn are in it
      if (ctx?.project) {
        project = ctx.project
        gateway.updateProject(dev.id, project)
      }
      if (ctx) {
        // A project's skills are someone else's instructions as much as its CLAUDE.md: the same word from the owner
        const label = (name: string) => `Project skill ${name}`
        const skillFiles = (ctx.skills ?? []).filter(s => s.scope === 'project').map(s => ({ label: label(s.name), path: s.path, content: s.content, truncated: false, modified: s.modified }))
        const review = contextTrust.review([...ctx.files, ...skillFiles])
        const usable = new Set(review.usable.map(f => f.label))
        ctx = { ...ctx, files: review.usable.filter(f => !skillFiles.some(x => x.label === f.label)), skills: (ctx.skills ?? []).filter(s => s.scope === 'computer' || usable.has(label(s.name))) }
        heldBack = review.held
        if (review.ask.length) background(askAboutContext(key, project.name, review.ask))
      }
    }
    // A /stop before Claude started: all of the above can take a while, and the topic has to hear that it was obeyed
    if (abort.signal.aborted) {
      log.info('stopped before it started', { key })
      await sendRich(chatId, topicId, tr('⏹ Stopped', '⏹ Остановлено'), replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}).catch(() => {})
      return { text: '', note: null, stopped: true }
    }
    if (tellEnv) topics.set(key, { envChanged: false, envCame: undefined })
    log.info('turn start', { key, device: dev?.id ?? '—', project: project?.id ?? 'no project', resume: !!t.sessionId, context: ctx?.files.map(f => f.label) })

    // Continue the bubble that showed the files being prepared, if there is one
    const draftId = l.prep?.draftId ?? randomInt(1, 2 ** 31 - 1)
    await endPrep(l)
    l.draftId = draftId
    const steps: string[] = []
    let text = ''
    let status = thinkingStatus()
    const view = liveView(chatId, topicId, draftId)
    const drafter = createDrafter(
      () => {
        const note = handInNote(l)
        return view.markdown({ steps: note ? [...steps, note] : steps, text, status, plan: l.checklist && livePlan(l.checklist, mdText) })
      },
      async md => {
        const t0 = Date.now()
        await view.send(masked(chatId, topicId, md, true))
        log.debug('draft', { key, draftId, sentAt: t0, ms: Date.now() - t0, status })
      },
      { minGap: view.minGap, heartbeat: view.heartbeat, onError: e => log.warn('draft failed, using typing indicator', (e as Error).message) },
    )
    const typing = setInterval(() => drafter.failed && api.sendChatAction(chatId, 'typing', where(topicId)).catch(() => {}), 4500)
    drafter.kick()
    l.now = { since: Date.now(), status: () => status, kick: () => drafter.kick(), toolSince: 0 }
    let noted: string | null = null

    const net = createNetWatch({ timeoutMs: cfg.apiTimeoutSec * 1000 })
    let netFail = false
    // Claude Code compacting the conversation: the API is busy with it, not gone
    let compacting = false
    // What the topic said before the computer dropped off with a command under way
    let beforeLost = ''
    const watchdog = setInterval(() => {
      const lost = !!dev && inflight.size > 0 && !gateway.device(dev.id)
      if (lost && !beforeLost) {
        beforeLost = status
        status = [...inflight].some(o => !o.waiting)
          ? tr(`🔌 ${dev.name} dropped off: its command keeps running, waiting for it to come back…`, `🔌 ${dev.name} отключился: команда на нём продолжает идти, жду, пока он вернётся…`)
          : tr(`🔌 ${dev.name} dropped off: waiting for it to come back…`, `🔌 ${dev.name} отключился: жду, пока он вернётся…`)
        drafter.kick()
      } else if (!lost && beforeLost) {
        status = beforeLost
        beforeLost = ''
        drafter.kick()
      }
      if (handInNote(l) !== noted) {
        noted = handInNote(l)
        drafter.kick()
      }
      for (const op of inflight) {
        if (!op.app || op.hangNoted || Date.now() - op.at < (cfg.appHangMs ?? APP_HANG_MS)) continue
        op.hangNoted = true
        offerAppRestart(chatId, topicId, dev!.id, op.app, op.done)
      }
      if (compacting) return
      if (net.isStalled()) {
        netFail = true
        log.warn('api stalled, aborting', { key, retries: net.retries })
        abort.abort()
      } else if (net.stalledFor() > 15000 || net.retries) {
        const s = `${tr('📡 Waiting for Anthropic', '📡 Жду ответа Anthropic')}${net.retries ? ` · ${tr('attempt', 'попытка')} ${net.retries + 1}` : ''}…`
        if (status !== s) {
          status = s
          drafter.kick()
        }
      }
    }, 2000)

    // The steps of the task go into the live status, which is redrawn anyway: no message, no write of their own
    l.checklist = undefined
    const showChecklist = (list: ChecklistStep[]) => {
      l.checklist = list
      drafter.kick()
    }
    // An agent's head wants to hear if it goes round in circles
    const stuck = createStuckWatch()
    const stuckLook = stuck && setInterval(() => {
      const reason = stuck.quiet({ waiting: !!l.answer || !!surveys.get(key) || [...pending.values()].some(p => p.live === l), running: inflight.size > 0 })
      if (reason) stuckAgent(key, reason)
    }, 30_000)
    stuckLook?.unref()
    // Device operations in flight; the ones caught by Stop are reported with their real outcome
    // app: the MCP server of an app on the computer this call went to, which can hang on the app
    type Op = { step: string, done: Promise<OpOutcome>, waiting?: boolean, app?: string, at: number, hangNoted?: boolean }
    const inflight = new Set<Op>()
    let interrupted: Op[] = []
    abort.signal.addEventListener('abort', () => { interrupted = [...inflight] }, { once: true })

    // A link drops for half a minute now and then. A task that gave up at once would stop over that: the call waits a
    // moment for the computer, and only then says it is gone
    const deviceBack = () => whenOnline(gateway, dev!.id, cfg.deviceWaitMs ?? DEVICE_WAIT_MS, abort.signal)
    const deviceAway = () => ({ code: 'offline' as const, message: `${dev!.name} has been offline for a minute. Nothing was run. Say so to the user and stop here: this task can go on when it is back.` })

    // Every device call re-checks the binding: after a switch, operations of the old one are refused (§12)
    const request = (tool: OpTool, params: Record<string, unknown>, step: string): Promise<OpOutcome> => {
      if (topics.get(key).bindingVersion !== binding) {
        return Promise.resolve({ ok: false, error: { code: 'expired', message: "The topic's binding changed: a command from the previous one doesn't run" } })
      }
      // What changes something is remembered across a restart; a read cut off by one is simply read again
      const opId = randomUUID()
      const remembered = tool === 'mcp_call' || MUTATING_TOOLS.has(tool as DeviceTool)
      if (remembered) flights.opStart(key, { opId, deviceId: dev!.id, tool, step })
      const send = () => gateway.request(dev!.id, { projectId: project!.id, bindingVersion: binding, tool, params, sessionId: t.sessionId ?? undefined }, abort.signal, opId)
      const op: Op = { step, done: null!, waiting: !gateway.device(dev!.id), at: Date.now(), ...(tool === 'mcp_call' && { app: String(params.server ?? '') }) }
      op.done = op.waiting
        ? deviceBack().then(back => {
          op.waiting = false
          if (back && topics.get(key).bindingVersion !== binding) return { ok: false as const, error: { code: 'expired' as const, message: "The topic's binding changed: a command from the previous one doesn't run" } }
          return back ? send() : { ok: false as const, error: deviceAway() }
        })
        : send()
      inflight.add(op)
      op.done.then(out => {
        inflight.delete(op)
        if (remembered) flights.opEnd(key, opId)
        const reason = stuck?.outcome(failureOf(tool, out))
        if (reason) stuckAgent(key, reason)
      })
      return op.done
    }
    // The file is on the server: it goes to the device in pieces the device puts together and checks
    async function saveAttachment(params: Record<string, unknown>): Promise<OpOutcome> {
      const a = inbox.get(String(params.id))
      if (!a) return { ok: false, error: { code: 'not_found', message: `No attachment ${params.id}: over a day has passed or the id is wrong. Ask for the file again` } }
      const dest = String(params.path ?? '')
      const path = !dest ? a.name : /[\\/]$/.test(dest) ? dest + a.name : dest
      const data = readFileSync(a.path)
      const sha256 = createHash('sha256').update(data).digest('hex')
      const upload = randomBytes(6).toString('hex')
      const step = toolStep('mcp__device__save_attachment', params)
      for (let offset = 0; ; offset += FILE_CHUNK_BYTES) {
        const chunk = data.subarray(offset, offset + FILE_CHUNK_BYTES)
        const done = offset + chunk.length >= data.length
        const out = await request('file_put', { path, upload, offset, data: chunk.toString('base64'), done, size: data.length, sha256 }, step)
        if (!out.ok || done) {
          if (out.ok) log.info('attachment saved', { key, id: a.id, size: a.size })
          return out
        }
      }
    }

    // A new file into the project, in pieces the computer puts together and checks. A name already taken gets a number
    async function putOnComputer(path: string, data: Buffer, step: string): Promise<{ ok: true, path: string } | { ok: false, error: string }> {
      const sha256 = createHash('sha256').update(data).digest('hex')
      for (let n = 1; n <= 20; n++) {
        const at = n === 1 ? path : path.replace(/(\.\w+)?$/, m => `-${n}${m}`)
        const upload = randomBytes(6).toString('hex')
        for (let offset = 0; ; offset += FILE_CHUNK_BYTES) {
          const chunk = data.subarray(offset, offset + FILE_CHUNK_BYTES)
          const done = offset + chunk.length >= data.length
          const out = await request('file_put', { path: at, upload, offset, data: chunk.toString('base64'), done, size: data.length, sha256 }, step)
          if (!out.ok && out.error.code === 'exists') break
          if (!out.ok) return { ok: false, error: out.error.message }
          if (done) return { ok: true, path: at }
        }
      }
      return { ok: false, error: `${path}: twenty files of that name already` }
    }

    // Lottie animations into SVG files, a frame each: from the chat's files, Telegram's custom emoji or the computer
    async function convertLottie(p: LottieRequest): Promise<string> {
      const step = toolStep(LOTTIE_TO_SVG, p as unknown as Record<string, unknown>)
      const items: { name: string, data: Buffer }[] = []
      const problems: string[] = []
      const emoji = p.sources.filter(s => /^\d{12,25}$/.test(s))
      if (emoji.length) {
        const found = await api.getCustomEmojiStickers(emoji).catch(e => (problems.push(`custom emoji: ${(e as Error).message}`), []))
        for (const id of emoji) {
          const s = found.find(x => x.custom_emoji_id === id)
          if (!s) problems.push(`${id}: no such custom emoji`)
          else if (!s.is_animated) problems.push(`${id}: ${s.is_video ? 'a video emoji (WebM)' : 'a still emoji (WebP)'}, not TGS`)
          else await download(s.file_id, s.file_size).then(data => void items.push({ name: `emoji-${id}`, data }), e => void problems.push(`${id}: ${(e as Error).message}`))
        }
      }
      for (const s of p.sources.filter(x => !emoji.includes(x))) {
        const a = /^[0-9a-f]{8}$/.test(s) ? inbox.get(s) : undefined
        if (a) {
          items.push({ name: a.name, data: readFileSync(a.path) })
          continue
        }
        if (/^[0-9a-f]{8}$/.test(s)) {
          problems.push(`${s}: no such attachment (they are kept for a day)`)
          continue
        }
        if (!dev || !project) {
          problems.push(`${s}: this topic has no computer to take it from`)
          continue
        }
        const got = await pullFile(q => request('file_get', q, step), s, { maxBytes: 10 * 1024 * 1024 })
        if (got.ok) items.push({ name: got.file.name, data: got.file.data })
        else problems.push(`${s}: ${got.error.message}`)
      }
      if (!items.length) return `Nothing converted. ${problems.join('; ')}`
      const out = await lottieToSvg(items, p.frame ?? 'first')
      for (const o of out) if ('error' in o) problems.push(`${o.name}: ${o.error}`)
      const done = out.flatMap(o => ('svg' in o ? [o] : []))
      if (!done.length) return `Nothing converted. ${problems.join('; ')}`
      const about = (o: typeof done[number]) => `${o.w}×${o.h}, frame ${o.frame} of ${o.frames}, ${Math.round(o.svg.length / 1024)} KB${o.note ? ` (${o.note})` : ''}`
      const lines_ = (where_: (o: typeof done[number]) => string) => done.map(o => `- ${where_(o)}: ${about(o)}`)
      const tail = problems.length ? `\nNot converted: ${problems.join('; ')}` : ''
      const toChat = p.to === 'chat' || !dev || !project
      if (!toChat && turnMode(key) === 'read') return 'This topic is read-only: nothing may be written on the computer. Use to: "chat", or the user changes the mode with /mode.'
      log.info('lottie to svg', { key, files: done.length, failed: problems.length, to: toChat ? 'chat' : 'computer' })
      if (toChat) {
        const archive = zip(done.map(o => ({ path: svgName(o.name), data: Buffer.from(o.svg) })))
        try {
          await sendFile(chatId, topicId, archive, done.length === 1 ? `${svgName(done[0].name).replace(/\.svg$/, '')}-svg.zip` : 'lottie-svg.zip', 'application/zip', undefined, { original: true })
        } catch (e) {
          return `Converted, but Telegram didn't take the zip: ${(e as Error).message}`
        }
        return `Sent to the user as one zip:\n${lines_(o => svgName(o.name)).join('\n')}${tail}`
      }
      const folder = (p.folder ?? 'lottie-svg').replace(/[\\/]+$/, '')
      const written: string[] = []
      for (const o of done) {
        const r = await putOnComputer(`${folder}/${svgName(o.name)}`, Buffer.from(o.svg), step)
        if (r.ok) written.push(`- ${r.path}: ${about(o)}`)
        else problems.push(`${o.name}: ${r.error}`)
      }
      return `Written in the project:\n${written.join('\n')}${problems.length ? `\nNot converted: ${problems.join('; ')}` : ''}`
    }

    // The file comes from the computer in pieces and goes to the topic; Claude gets only a receipt
    async function sendFromDevice(params: Record<string, unknown>): Promise<OpOutcome> {
      const step = toolStep('mcp__device__send_file', params)
      const got = await pullFile(p => request('file_get', p, step), String(params.path ?? ''), { maxBytes: SEND_FILE_MAX_BYTES, tooBig: tgTooBig() })
      if (!got.ok) return got
      const f = got.file
      try {
        // Pictures for the answer go inline; a separate file is wanted as it is, not recompressed
        await sendFile(chatId, topicId, f.data, f.name, f.mime, params.caption as string | undefined, { original: true })
        log.info('file sent', { key, name: f.name, size: f.size })
        return { ok: true, result: { name: f.name, size: f.size } }
      } catch (e) {
        return { ok: false, error: { code: 'failed', message: `Telegram didn't accept the file: ${(e as Error).message}` } }
      }
    }

    // A picture on the computer for Claude's own eyes: pulled in pieces, scaled to what the API takes
    async function viewDeviceImage(params: Record<string, unknown>): Promise<OpOutcome> {
      const step = toolStep('mcp__device__view_image', params)
      const got = await pullFile(p => request('file_get', p, step), String(params.path ?? ''), { maxBytes: SEND_FILE_MAX_BYTES })
      if (!got.ok) return got
      const f = got.file
      try {
        const img = await forClaude(f.data, f.mime, f.name)
        log.info('image viewed', { key, name: f.name, size: f.size, shown: img.data.length })
        return { ok: true, result: { name: f.name, size: f.size, mime: img.mime, data: img.data.toString('base64') } }
      } catch (e) {
        return { ok: false, error: { code: 'failed', message: `${f.name}: ${(e as Error).message}` } }
      }
    }

    const deviceServer = dev && createDeviceServer(async (tool, params) => {
      // These fetch through the computer on their own, and need it here first
      if (['view_image', 'save_attachment', 'send_file'].includes(tool) && !await deviceBack()) return { ok: false, error: deviceAway() }
      if (tool === 'view_image') return viewDeviceImage(params)
      if (tool === 'save_attachment') return saveAttachment(params)
      if (tool === 'send_file') return sendFromDevice(params)
      const out = await request(tool, params, toolStep(`mcp__device__${tool}`, params))
      // What it cost, for the next time it is about to run (heavy.ts)
      if (out.ok && tool === 'run_command' && project && heavy.note(heavyKey(dev.id, project), dev, params, out.result as ToolResult['run_command'])) {
        log.info('heavy command', { key, device: dev.id, sec: Math.round((out.result as ToolResult['run_command']).durationMs / 1000), coreSec: (out.result as ToolResult['run_command']).coreSec })
      }
      // Claude's tools are set when a turn starts: the next one has them, and goes on with the task
      if (out.ok && tool === 'add_mcp_server' && (out.result as ToolResult['add_mcp_server']).status === 'connected') {
        enqueue(chatId, topicId, `[The MCP server «${String(params.name)}» is connected: its tools are here now. Go on with the task.]`, { reply: false })
      }
      return out
    })
    // Apps that are up right now; one that is down is described in the prompt but offers no tools (§6)
    // A device MCP named like a remote one (a local Figma) would shadow it: the remote one wins
    // The same for one named like the bot's own tools, which are trusted by that name: a computer's config can still say anything
    const apps = (dev?.mcp ?? []).filter(s => s.status === 'connected' && s.tools.length && !(s.name in cfg.remoteMcp) && !RESERVED_MCP_NAMES.includes(s.name))
    const appServers = Object.fromEntries(apps.map(s => [s.name, createAppServer(s, async (tool, args) => {
      const out = await request('mcp_call', { server: s.name, tool, arguments: args, lane: key }, toolStep(`mcp__${s.name}__${tool}`, args))
      return /aerender/i.test(tool) ? followRender(out) : out
    })]))
    // A render started in the background: the bot follows it from here, and Claude needn't
    function followRender(out: OpOutcome): OpOutcome {
      if (!out.ok || !project) return out
      const r = out.result as McpCallResult
      const text = r.content.map(c => (c as { type?: string, text?: string }).type === 'text' ? (c as { text: string }).text : '').join('')
      const started = renderStarted(text)
      if (!started) return out
      renders.start(started, { chatId, topicId, deviceId: dev!.id, projectId: project.id, binding })
      log.info('render followed', { key, pid: started.pid })
      const note = { type: 'text', text: '[The bot now shows the user this render\'s progress live and its end. Don\'t poll render-status to report progress; check it only when you need the result.]' }
      return { ok: true, result: { ...r, content: [...r.content, note] } }
    }

    // A big task with little of the limit left: the head asks, an agent was given its task by one
    const freshWindow = t.head ? undefined : await limitWatch.offerWindow(profiles.nameOf(t.profile))
    // The screen: in a topic of the user's own (an agent would fight them for the mouse), on a computer that can
    const screenable = !!(dev && project && dev.screen && !dev.locked && !t.head)
    if (topics.get(key).screen && Date.now() - (topics.get(key).screenUsedAt ?? 0) > SCREEN_IDLE_MS) {
      topics.set(key, { screen: false })
      log.info('screen off: idle', { key })
    }
    const screenOn = screenable && !!topics.get(key).screen
    let screenUsed = false
    async function useScreen(p: ScreenParams): Promise<ScreenResult | string> {
      if (turnMode(key) === 'read' && p.actions.some(a => !SCREEN_LOOKS.has(a.do))) return 'This topic is read-only: only screenshot, zoom, windows and elements.'
      if (!topics.get(key).screen) return 'The user took the screen back. Ask for it again only if the task can\'t go on without it.'
      const step = toolStep(SCREEN_TOOL, { window: p.window ?? '', actions: p.actions.map(a => a.do).join(', ') })
      // What needs the mouse waits on the computer's word that the user is still there, asked again every few seconds:
      // the batch goes on from where it stopped once they step away or tap «Work now»
      const log: string[] = []
      let rest = p
      const until = Date.now() + SCREEN_WAIT_MS
      screenUsed = true
      try {
        for (;;) {
          const out = await request('screen', { ...rest, ...(screenNow.has(key) && { now: true }) }, step)
          if (!out.ok) return `[${out.error.code}] ${out.error.message}`
          topics.set(key, { screenUsedAt: Date.now() })
          const r = out.result as ScreenResult
          log.push(...r.log)
          if (!r.waiting) {
            const did = log.filter(l => !/^screenshot /.test(l)).at(-1)?.split('\n')[0] ?? ''
            if (r.image) void showScreen(key, r.image.data, `${dev!.name}${did ? ` · ${did}` : ''}`)
            return { ...r, log }
          }
          const left = rest.actions.slice(r.waiting.done)
          if (Date.now() >= until || abort.signal.aborted || !topics.get(key).screen) {
            return { log: [...log, `The user stayed at the computer for ${Math.round(SCREEN_WAIT_MS / 60_000)} minutes: ${left.map(a => a.do).join(', ')} did not run. They need the real mouse or keyboard. Do what you can by looking and with the element actions, or tell the user in the chat what you are waiting for.`] }
          }
          await screenWait(key, dev!.name, SCREEN_POLL_MS)
          rest = { ...rest, actions: left }
        }
      } finally {
        void endScreenWait(key)
      }
    }
    // The topic's computer for install_skill: a private repository is cloned there with its sign-in, a file of it read
    const skillVia = (): Via | undefined => (dev && project ? {
      shell: dev.shell,
      run: async command => {
        const out = await request('run_command', { command, timeoutSec: 180 }, toolStep(INSTALL_SKILL, { step: 'clone' }))
        if (!out.ok) throw new Error(out.error.message)
        const r = out.result as { exitCode: number, stdout: string, stderr: string }
        return { code: r.exitCode, out: `${r.stdout}\n${r.stderr}` }
      },
      pull: async path => {
        const got = await pullFile(q => request('file_get', q, toolStep(INSTALL_SKILL, { step: 'read' })), path, { maxBytes: SKILL_LIMITS.bytes })
        if (!got.ok) throw new Error(got.error.message)
        return got.file.data
      },
    } : undefined)
    // A long conversation and the user's own words: Claude may ask whether this is a new task for a new session
    const askNewSession = newSession.wanted(key, t, !!l.ownerSpoke)
    // One conversation is all this group has: no topics for agents, none to delete
    const plainGroup = !!workspaces.get(chatId)?.plain
    // Claude in Chrome: only when switched on in the topic and this computer has its browser chosen
    // Not when that Chrome is signed in to another account than this topic's: this session wouldn't see it, an errand
    // on that account does (browse_on_computer)
    const ownChrome = dev && !dev.locked ? browsers.get(dev.id) : undefined
    const ownAccount = dev ? chromeAccount(dev.id) : undefined
    const chromeElsewhere = !!ownChrome && !!ownAccount && ownAccount !== profiles.nameOf(t.profile)
    // With that Chrome out of reach, another computer's may be within it: one signed in to this topic's own account is
    // seen by this session. It is worked in directly, step by step, where an errand would start anew for every request
    // and retell what it saw. So it is after a move at the limit: the topic is on the account of the other computer
    const directFrom = t.browser && chromeElsewhere ? chromeOnAccount(dev!.id, profiles.nameOf(t.profile)) : undefined
    // The computer this session's Chrome is on: the topic's own, or that one
    const chromeAt = directFrom ? { id: directFrom.id, name: directFrom.name } : dev ? { id: dev.id, name: dev.name } : undefined
    const bound = !t.browser ? undefined : directFrom ? browsers.get(directFrom.id) : chromeElsewhere ? undefined : ownChrome
    const browserLock = lockOf(profiles.nameOf(t.profile))
    const where_ = { device: dev?.name ?? '—', project: project?.name ?? tr('no project', 'без проекта'), icon: dev && iconOf(dev) }
    let picked = false
    let toldWait = false
    // Asked once per task, at the first step into Chrome; the answer holds for the rest of it
    let route: Promise<true | string> | undefined
    const chromeGate = async (tool: string, input: Record<string, unknown>, hookSignal: AbortSignal) => {
      const v = await chromeVerdict(tool, input, hookSignal)
      return v === true && tool === `mcp__${CHROME_SERVER}__file_upload` && Array.isArray(input.paths) ? uploadFromComputer(key, input) : v
    }
    const chromeVerdict = async (tool: string, input: Record<string, unknown>, hookSignal: AbortSignal): Promise<true | string> => {
      const signal = AbortSignal.any([hookSignal, abort.signal])
      if (signal.aborted) return 'Stopped by the user.'
      const c = classifyChrome(tool, input, { bound: bound!, device: chromeAt!.name, selected: picked })
      if (typeof c === 'object') {
        log.info('chrome', { key, tool, verdict: 'denied', reason: c.deny.slice(0, 80) })
        return c.deny
      }
      if (c === 'select') {
        // Another computer's Chrome: that computer has to be here, and one that just dropped its link is waited for
        if (directFrom) {
          const there = await errandDevice(chromeAt!)
          if (!there || there.locked) return `Chrome on ${chromeAt!.name} can't be used now: that computer is ${there ? 'locked' : awayFor(chromeAt!)}. Say so in your answer; no other Chrome is within this session's reach.`
          log.info('chrome', { key, direct: chromeAt!.id })
        }
        if (browserLock.busyFor(bound!.deviceId) && !toldWait) {
          toldWait = true
          api.sendMessage(chatId, tr('🌐 A task in another topic is using the browser; waiting for it to finish.', '🌐 Браузером сейчас пользуется задача в другом топике, жду, пока она закончится.'), where(topicId)).catch(() => {})
        }
        try {
          await browserLock.acquire(bound!.deviceId, key, signal)
        } catch {
          return 'Stopped by the user.'
        }
        return route ??= chromeRoute(chatId, topicId, chromeAt!, signal, !!shiftOf(key))
      }
      if (c !== 'act') return true
      // Navigation, clicks, typing, scripts: the topic's mode decides, like any other change (§13)
      const mode = turnMode(key)
      const d = decide({ mode, readOnly: false, fileEdit: false, allowAllForTask: l.allowAll })
      if (d === 'deny') return readOnlyMessage(key)
      if (d === 'allow') {
        log.info('permission', { key, tool, verdict: `mode ${mode}` })
        return true
      }
      const r = await askPermission(chatId, topicId, l, key, tool, input, where_, signal)
      return r.behavior === 'allow' ? true : r.message
    }
    const chrome = bound ? chromeHooks(chromeGate, ok => { picked = ok }, list => {
      // The extension renames browsers as they come and go: what /browser shows follows it
      const now = list.find(b => b.deviceId === bound.deviceId)
      if (now && now.name !== bound.name) {
        browsers.bind(chromeAt!.id, { ...now, profile: bound.profile ?? profiles.nameOf(t.profile) })
        bound.name = now.name
      }
      // The list says one is in use and nothing more is needed: for this topic, picking it is still the first step
      return now && !picked ? `This topic's browser is deviceId ${bound.deviceId}. Next call select_browser with it, whatever the list says is in use: other browser tools are refused until then.` : undefined
    }) : undefined

    const powerComputers = gateway.devices().filter(d => !isCloud(d.id) && !d.locked).map(d => d.name)
    // Chrome on another computer: a short session on that computer's profile does the task there and answers
    // Every computer with a Chrome chosen, online or not: who is here is looked at when Chrome is asked for, not now. A
    // computer away for the seconds in which a turn starts used to be left out of the whole turn
    const errandComputers = dev && !isCloud(dev.id) ? registry.list().filter(r => (r.id === dev.id ? chromeElsewhere : !isCloud(r.id) && !!browsers.get(r.id) && r.id !== directFrom?.id)).map(r => ({ id: r.id, name: r.name })) : []
    // The computer, once it is online: one that dropped its link a moment ago is waited for, it is usually back in seconds
    // When it was last seen is read now: a computer here as the turn began can drop its link in the middle of it
    const seenOf = (id: string) => registry.list().find(r => r.id === id)?.lastSeen
    async function errandDevice(c: (typeof errandComputers)[number]) {
      const wait = hereOrJustHere({ id: c.id, lastSeen: seenOf(c.id) }) ? cfg.errandBackMs ?? 30_000 : 0
      for (const end = Date.now() + wait; !gateway.device(c.id) && Date.now() < end && !abort.signal.aborted;) await new Promise(r => setTimeout(r, Math.min(500, Math.max(10, wait / 10))))
      return gateway.device(c.id)
    }
    const awayFor = (c: (typeof errandComputers)[number]) => {
      const seen = seenOf(c.id)
      const min = Math.round((Date.now() - (seen ?? 0)) / 60_000)
      return seen ? `offline, last seen ${min < 1 ? 'less than a minute' : min < 120 ? `${min} min` : `${Math.round(min / 60)} h`} ago` : 'offline'
    }
    // One computer's Chrome for an errand. limit: its account has spent its limit. skip: it can't take the errand at all
    type ErrandTry = ErrandResult | { limit: string } | { skip: string }
    async function errandOn(target: NonNullable<ReturnType<typeof gateway.device>>, p: Errand, instead?: string): Promise<ErrandTry> {
      const b = browsers.get(target.id)!
      const profile = profiles.nameOf(chromeAccount(target.id) ?? t.profile)
      const atLimit = () => {
        const reset = limitSpent(profile)?.reset
        return { limit: `${target.name} (profile ${profile}${reset ? `, until ${new Date(reset).toISOString()}` : ''})` }
      }
      if (!(await profiles.status(profile).catch(() => null))?.loggedIn) return { skip: `The profile ${profile} of ${target.name} isn't signed in to Claude: the user signs it in with /profiles.` }
      // A session on a spent account only fails: not started, and not asked about
      if (limitSpent(profile)) return atLimit()
      // One browser at a time per account: this turn's own, if it holds another on the same one, blocks it
      const lock = lockOf(profile)
      const mine = lock.holds(key)
      if (mine && mine !== b.deviceId) return { skip: `${target.name}'s Chrome is on the same Claude account as the browser this turn is using, and the account works one browser at a time: do it in a turn that doesn't use this topic's Chrome.` }
      const d = decide({ mode: turnMode(key), readOnly: false, fileEdit: false, allowAllForTask: l.allowAll })
      if (d === 'deny') return readOnlyMessage(key)
      if (d === 'ask') {
        const r = await askPermission(chatId, topicId, l, key, ERRAND_TOOL, { ...p, computer: target.name } as unknown as Record<string, unknown>, { device: target.name, project: '' }, abort.signal)
        if (r.behavior !== 'allow') return r.message
      }
      const errandKey = `${key}:errand`
      const ac = new AbortController()
      const stop = () => ac.abort()
      abort.signal.addEventListener('abort', stop, { once: true })
      const timer = setTimeout(stop, ERRAND_MS)
      let picked = false
      let route: Promise<true | string> | undefined
      let session: string | undefined
      log.info('browser errand', { key, computer: target.id, profile, fallback: !!instead })
      try {
        const res = await startTurn({
          prompt: p.task,
          cwd: workDir,
          sessionId: null,
          model: agentModel('sonnet'),
          effort: 'medium',
          env: profiles.env(profile),
          append: browserBlock(target.name, b.deviceId) + errandRules(dev!.name),
          // The user allowed the errand as a whole: inside it, the browser alone, no questions
          canUseTool: async (tool, input) => (tool === 'ToolSearch' ? { behavior: 'allow' as const, updatedInput: input } : { behavior: 'deny' as const, message: 'Only the browser in this errand.' }),
          chrome: chromeHooks(async (tool, input, hookSignal) => {
            const signal = AbortSignal.any([hookSignal, ac.signal])
            if (signal.aborted) return 'Stopped.'
            const c = classifyChrome(tool, input, { bound: b, device: target.name, selected: picked })
            if (typeof c === 'object') return c.deny
            if (c !== 'select') return true
            try {
              await lock.acquire(b.deviceId, errandKey, signal)
            } catch {
              return 'Stopped.'
            }
            return route ??= chromeRoute(chatId, topicId, target, signal, !!shiftOf(key))
          }, ok => { picked = ok }),
          abortController: ac,
          onSession: id => { session = id },
          onRateLimit: info => profiles.noteLimit(profile, info),
        })
        if (res.errorKind === 'rate_limit') return atLimit()
        if (ac.signal.aborted && !abort.signal.aborted) return `The errand on ${target.name} didn't finish within ${ERRAND_MS / 60_000} minutes.`
        const images = screenshotPaths(res.text).flatMap(path => {
          const shot = chromeScreenshot(path)
          return shot ? [{ data: readFileSync(shot).toString('base64'), mime: /\.png$/i.test(shot) ? 'image/png' : /\.webp$/i.test(shot) ? 'image/webp' : 'image/jpeg' }] : []
        })
        log.info('browser errand done', { key, computer: target.id, error: !!res.isError, images: images.length })
        return { text: `[From Chrome on ${target.name}, profile ${profile}${instead ? `. ${instead}` : ''}]\n${res.text.replace(/^SCREENSHOT:.*$/gm, '').trim()}`, images }
      } catch (e) {
        return `The errand on ${target.name} failed: ${(e as Error).message}`
      } finally {
        clearTimeout(timer)
        abort.signal.removeEventListener('abort', stop)
        lock.release(errandKey)
        if (session) profiles.removeSession(session, profile)
      }
    }

    // The Chrome asked for first. A Chrome works only through the Claude account it is signed in to, so when that
    // account has spent its limit the errand goes to the other computers' in turn: the task matters more than which
    // browser does it, and the answer says where it was done
    async function browserErrand(p: Errand): Promise<ErrandResult> {
      const asked = errandComputers.find(d => d.name === p.computer)
      if (!asked || !browsers.get(asked.id)) return `${p.computer} has no Chrome chosen: the user picks one with /browser in a topic on it.`
      const others = errandComputers.filter(d => d.id !== asked.id && browsers.get(d.id))
      const spent: string[] = []
      // The others that could not take it, each with its reason: the answer names them, so nobody is left to guess why
      // a Chrome that was there wasn't used
      const passed: string[] = []
      for (const c of [asked, ...others]) {
        const target = await errandDevice(c)
        if (!target || target.locked) {
          const why = `${c.name}: ${target ? 'locked at the computer' : awayFor(c)}`
          if (c === asked) return `${why}. Nothing was done.`
          passed.push(why)
          continue
        }
        const r = await errandOn(target, p, spent.length ? `Done here instead of ${spent.join(', ')}, at the limit of its Claude account: the sign-ins in this Chrome may differ` : undefined)
        if (typeof r === 'object' && 'limit' in r) {
          spent.push(r.limit)
          continue
        }
        if (typeof r === 'object' && 'skip' in r) {
          if (c === asked) return r.skip
          passed.push(`${c.name}: ${r.skip}`)
          continue
        }
        return r
      }
      log.info('browser errand not done', { key, spent, passed })
      if (!passed.length) return `Nothing was done: the Claude account of every Chrome that could do it has spent its limit: ${spent.join('; ')}. A Chrome works only through the account it is signed in to, so none can before a reset. Don't try a browser again in this turn.`
      return `Nothing was done. At the limit of its Claude account: ${spent.join('; ')}. Could not take it instead: ${passed.join('; ')}. A Chrome works only through the account it is signed in to. Name in your answer each computer that could not take it and why: the user can bring it back.`
    }

    const canAskBrowser = !!dev && !isCloud(dev.id) && !t.browser && !chromeElsewhere
    // A topic whose computer is off may still be offered the cloud: nothing else can be offered then
    const otherOnline = dev && !stillHere(t) ? otherComputers(gateway.devices(), dev.id)
      : offline && !stillHere(t) ? otherComputers(gateway.devices(), t.deviceId).filter(d => isCloud(d.id)) : []
    if (dev && project && !isCloud(dev.id) && gateway.device(CLOUD_DEVICE_ID)) background(rememberRemote(key))
    // Without a project Claude can offer one: buttons in the topic, the conversation goes on there
    // Any topic but an agent's can start agents
    const botServers = {
      ...(!dev && !offline && { [TOPIC_SERVER]: createTopicServer(p => suggestProject(key, p)) }),
      ...(topicId && topicsOf(chatId).some(([k]) => k !== key) ? { [MESSAGE_SERVER]: createMessageServer(topicsOf(chatId).filter(([k]) => k !== key).map(([k, x]) => topicLabel(k, x)), p => messageTopic(key, p)) } : {}),
      ...(offline && { [DEFER_SERVER]: createDeferServer(deviceName(t.deviceId!), (task, title) => deferTask(key, task, title)) }),
      [SURVEY_SERVER]: createSurveyServer(p => startSurvey(key, p)),
      [CHECKLIST_SERVER]: createChecklistServer(showChecklist),
      [LOTTIE_SERVER]: createLottieServer(convertLottie, !!(dev && project)),
      // Sleep or off at the user's word: where a person leads the topic, never an agent or a night shift
      ...(powerComputers.length && !t.head && !shiftOf(key) && turnMode(key) !== 'read' && { [POWER_SERVER]: createPowerServer(powerComputers, p => offerPower(key, p)) }),
      // Offered where a shift can be led from; its head alone ends it
      ...((shifts.running(key) || (!t.head && !shiftOf(key))) && { [SHIFT_SERVER]: createShiftServer(shifts.running(key)
        ? { end: p => endShift(key, p) }
        : { offer: p => offerShift(key, p) }) }),
      ...(topicId ? { [TOPIC_NAME_SERVER]: createTopicNameServer(name => renameTopic(chatId, topicId, name)) } : {}),
      ...(dev && project && { [RULE_SERVER]: createRuleServer(p => offerRule(key, p)) }),
      ...(freshWindow && { [FRESH_SERVER]: createFreshServer({ pct: Math.round(freshWindow.pct), resetsIn: resetTag(freshWindow.resetsAt), label: freshWindow.label }, why => offerFresh(key, prompt, freshWindow, profiles.nameOf(t.profile), why)) }),
      ...(askNewSession && { [NEW_SESSION_SERVER]: createNewSessionServer(Math.round((t.context?.total ?? 0) / 1000), what => newSession.offer(key, t, prompt, images, what)) }),
      ...(!t.head && !plainGroup && { [DELETE_SERVER]: createDeleteServer(p => offerDeleteTopics(key, p)) }),
      ...(otherOnline.length ? { [COMPUTER_SERVER]: createComputerServer(otherOnline.map(d => d.name), p => suggestComputer(key, p), p => copyFiles(key, topics.get(key), p, abort.signal), otherOnline.filter(d => !isCloud(d.id)).map(d => d.name), dev && project ? p => syncBranch(key, p) : undefined,
        // Read as it is asked: who is online and how busy changes within a turn
        dev && project ? async () => computersReport(gateway.device(dev.id) ?? dev, otherComputers(gateway.devices(), dev.id).filter(d => !d.locked), heavy.top(heavyKey(dev.id, project))) : undefined) } : {}),
      ...(!t.head && !plainGroup && { [TEAM_SERVER]: createTeamServer(teamOf(key), models.list().map(m => m.family), [profiles.nameOf(t.profile), ...profiles.list().filter(n => n !== profiles.nameOf(t.profile))]) }),
      [SCHEDULE_SERVER]: createScheduleServer(p => scheduleMenu.propose(key, p)),
      // Telegram takes widgets in private chats only, for now
      ...(chatId > 0 && { [WIDGET_SERVER]: createWidgetServer({ guide: () => loadWidgetGuide(join(cfg.dataDir, 'widget-guide.txt')), send: p => sendWidget(key, p) }) }),
      [SKILLS_SERVER]: createSkillsServer({ read: (name, file) => skills.read(name, file), install: src => offerSkillInstall(key, src, skillVia()), remove: (name, where) => offerSkillRemove(key, name, where, ctx?.skills ?? []) }),
      ...(canAskBrowser && { [BROWSER_ASK_SERVER]: createBrowserAskServer(p => askForBrowser(key, p)) }),
      ...(screenOn ? { [SCREEN_SERVER]: createScreenServer(dev!.name, turnMode(key) === 'read', dev!.os === 'macos', useScreen) } : screenable ? { [SCREEN_ACCESS_SERVER]: createScreenAskServer(dev!.name, p => askForScreen(key, p)) } : {}),
      ...decisionsMenu.servers(chatId, topicId),
      ...(bound && { [BROWSER_OPEN_SERVER]: createBrowserOpenServer(() => openChrome(chromeAt!.id)) }),
      ...(errandComputers.length && turnMode(key) !== 'read' && { [ERRAND_SERVER]: createErrandServer(errandComputers.map(d => d.name), browserErrand) }),
    }

    // The plan's limit ran out and the account goes on on paid extra usage (claude.ai's «Extra usage»). The API says
    // nothing is wrong, so this is the only sign: in a night shift the turn stops and goes on on a profile with room;
    // by day the user is told, once a window, and decides
    let overageSeen = false
    let overage: string | undefined
    async function onOverage(name: string) {
      log.warn('profile on paid extra usage', { key, profile: name })
      const sp = shiftOf(key) && !topics.get(key).browser ? await spareProfile(name) : undefined
      if (sp && !abort.signal.aborted) {
        overage = sp
        abort.abort()
        return
      }
      if (Date.now() - (overageWarned.get(name) ?? 0) < OVERAGE_WARN_MS) return
      overageWarned.set(name, Date.now())
      const others = profiles.list().filter(n => n !== name)
      await api.sendMessage(chatId, tr(
        `💳 <b>The limit of ${esc(name)} is reached, and Claude goes on on paid extra usage.</b> /stop stops it${others.length ? `; /profile moves the topic to ${esc(others.join(', '))}` : ''}. Extra usage is turned off in claude.ai: Settings → Usage.`,
        `💳 <b>Лимит ${esc(name)} исчерпан, и Claude продолжает за счёт платного Extra usage.</b> Остановить — /stop${others.length ? `; перенести топик на ${esc(others.join(', '))} — /profile` : ''}. Выключается Extra usage на claude.ai: Settings → Usage.`,
      ), { ...where(topicId), ...HTML }).catch(() => {})
    }

    // The parts of the instructions that change while a conversation lives. A conversation under way keeps the
    // instructions it began with, so a change in one of these is said in the user's turn, once (told.ts)
    const browserPart = (bound ? browserBlock(chromeAt!.name, bound.deviceId, directFrom ? dev!.name : undefined) : canAskBrowser ? BROWSER_ASK : '')
    const screenPart = (screenOn ? screenBlock(dev!.name, dev!.os === 'macos') : '')
    const readOnlyPart = (turnMode(key) === 'read'
      ? '\n\n# Read-only topic\nThe user set this topic to review and planning only: read and analyse, propose changes as text, do not attempt writes, commands or app changes.'
      : '')
    const heldPart = heldBackBlock(heldBack)
    const economyPart = (t.verbose ? '' : ECONOMY)
    const decisionsPart = decisionsMenu.promptBlock(chatId)
    const nightPart = (night.on(chatId) ? NIGHT_RULE : '')
    const shiftPart = (shifts.running(key) ? shiftRule(shifts.running(key)!) : shiftOf(key) ? agentShiftRule : '')
    const skillsPart = skillsBlock(skills.list(), ctx?.skills ?? [])
    // With the computer away the whole of the instructions is another text (offlineAppend), which a conversation that
    // began with the computer on never sees: the part that changes what it may do, in short
    const awayPart = offline ? `\n\n# This topic's computer is offline\n"${deviceName(t.deviceId!)}" is offline right now: until it connects you can't read or change its files, run commands or use its apps. When something needs it, call defer_task for each task and carry on: deferred tasks start by themselves as soon as it connects. Never claim as done what is only deferred, and don't answer from memory of files as if you had just read them.` : ''
    const sections: Section[] = [
      { id: 'away', text: awayPart, core: true },
      { id: 'night', text: nightPart, core: true },
      { id: 'shift', text: shiftPart, core: true },
      { id: 'read-only', text: readOnlyPart, core: true },
      { id: 'browser', text: browserPart, core: !!bound },
      { id: 'screen', text: screenPart, core: true },
      { id: 'held', text: heldPart, core: true },
      { id: 'decisions', text: decisionsPart, core: true },
      { id: 'skills', text: skillsPart },
      { id: 'economy', text: economyPart },
      // The user's own instruction files: a pointer when one changes, its text would be thousands of words in every
      // conversation. Claude's memory index is its own writing, and changes with it
      ...(ctx?.files ?? []).filter(f => !/memory/i.test(f.label)).map(f => ({
        id: `file:${f.path}`, sig: f.content,
        text: `# ${f.label}\nThis instruction file on the computer has changed, or is new: ${f.path}. What you were given of it when this conversation began is out of date. Read it with read_file before going on, and follow it as it is now.`,
      })),
    ]
    // A new conversation, or one just compacted, renders the instructions as they are now: nothing to add
    const known = !t.sessionId || t.toldFresh ? null : t.told ?? 'legacy'
    const notes = known ? instructionNotes(known, sections) : ''
    if (notes) log.info('instructions told', { key, legacy: known === 'legacy', chars: notes.length })
    const started = Date.now()
    // The session as this turn last knew it. Anything else is a /new or another project, which this turn must not undo
    let session = t.sessionId ?? null
    let res
    try {
      res = await startTurn({
        prompt: notes ? `${notes}\n\n${fullPrompt}` : fullPrompt,
        images,
        cwd: workDir,
        sessionId: t.sessionId,
        model: modelOf(t),
        effort: t.effort ?? cfg.effort,
        env: profiles.env(t.profile),
        // §13 mode 1: say it up front instead of letting every change bounce off a denial
        append: (dev && project ? systemAppend(dev, project, dev.id, ctx, Object.keys(cfg.remoteMcp)) : offline ? offlineAppend(Object.keys(cfg.remoteMcp), deviceName(t.deviceId!), t.projectId!) : noProjectAppend(Object.keys(cfg.remoteMcp), gateway.devices().map(d => d.name)))
          + (dev && project && t.head ? ownComputerBlock(dev, isCloud(dev.id)) : '')
          + browserPart + screenPart + readOnlyPart + (t.head ? agentBlock(t.workerName ?? 'agent', t.worktree?.branch) : (plainGroup ? '' : TEAM + teamLinks(teamWays(key)))) + scheduleBlock(schedules.zoneChosen() ? schedules.zone() : null) + handIn.block(key) + heldPart + economyPart + decisionsPart + nightPart + shiftPart + skillsPart + (chatId > 0 ? WIDGET_PROMPT : ''),
        deviceServer: deviceServer || undefined,
        compactWindow: t.head ? AGENT_WINDOW : TOPIC_WINDOW,
        botServers,
        appServers,
        remote: cfg.remoteMcp,
        onRateLimit: info => {
          const name = profiles.nameOf(t.profile)
          profiles.noteLimit(name, info)
          if ((info.isUsingOverage || info.overageInUse) && !overageSeen) {
            overageSeen = true
            background(onOverage(name))
          }
        },
        onRemoteStatus: s => {
          remoteStatus.set(profiles.nameOf(t.profile), s)
          for (const r of s) if (r.status !== 'connected') log.warn('remote mcp', r)
        },
        chrome,
        handIn: handIn.forTurn(key, l),
        canUseTool: makeCanUseTool(chatId, topicId, l, where_, apps, !!chrome),
        abortController: abort,
        onSession: id => {
          if ((topics.get(key).sessionId ?? null) !== session) return
          session = id
          if (id !== topics.get(key).sessionId) topics.set(key, { sessionId: id })
          // The prompt is with Claude now, the notes in it too
          topics.set(key, { told: toldOf(sections), toldFresh: false })
          flights.session(key, id)
        },
        onStep: (name, input) => {
          // The plan shows itself; a step saying it was updated is only noise among the real ones
          if (name !== SET_CHECKLIST) steps.push(toolStep(name, input))
          const looping = stuck?.step(name, input)
          if (looping) stuckAgent(key, looping)
          if (isChromeTool(name)) {
            chromeUsed = true
            topics.set(key, { browserUsedAt: Date.now() })
          }
          status = toolStatus(name, input)
          if (l.now) l.now.toolSince = Date.now()
          drafter.kick()
        },
        onText: s => {
          text = s
          stuck?.activity()
          status = writingStatus()
          drafter.kick()
        },
        onStderr: d => log.debug('claude', d.trim()),
        onApiWait: waiting => {
          if (waiting) {
            net.waiting()
            if (l.now) l.now.toolSince = 0
          } else {
            if (net.retries || status.startsWith('📡')) status = thinkingStatus()
            net.progress()
          }
        },
        onCompacting: on => {
          compacting = on
          if (on) {
            net.progress()
            status = tr('🗜 Compacting the conversation history…', '🗜 Сжимаю историю разговора…')
          } else {
            net.waiting()
            status = thinkingStatus()
          }
          drafter.kick()
        },
        onCompacted: c => {
          log.info('compacted', { key, pre: c.pre, post: c.post, trigger: 'auto' })
          // The instructions are rendered anew after it, from what this turn passed
          topics.set(key, { told: toldOf(sections), toldFresh: false })
        },
        onRetry: m => {
          net.retry()
          log.warn('api retry', { attempt: m.attempt, status: m.error_status })
        },
      })
    } catch (e) {
      if (!abort.signal.aborted) throw e
      res = { aborted: true, text }
    } finally {
      clearInterval(typing)
      clearInterval(watchdog)
      if (stuckLook) clearInterval(stuckLook)
      browserLock.release(key)
      await drafter.stop()
      await view.end()
    }

    // Claude's process went down with the server: this is no answer, and the next run carries the turn on
    if (closing) return { text: '', note: null, stopped: true }
    void endScreenView(key)
    // Windows Claude moved out of the user's sight come back with the end of the task, stopped or not
    if (screenUsed && gateway.device(dev!.id)) {
      void gateway.request(dev!.id, { projectId: project!.id, bindingVersion: binding, tool: 'screen', params: { actions: [{ do: 'unpark' }], look: false }, sessionId: t.sessionId ?? undefined }, new AbortController().signal, randomUUID())
        .catch(e => log.debug('unpark', (e as Error).message))
    }
    if (browserForRun.delete(key)) {
      topics.set(key, { browser: false, browserAuto: false })
      log.info('browser off: the scheduled run is over', { key })
    } else if (browserDone(topics.get(key), chromeUsed, Date.now())) {
      topics.set(key, { browser: false, browserAuto: false })
      log.info('browser off: not used', { key })
    }
    log.info('turn end', { key, steps: steps.length, aborted: !!res.aborted, error: !!res.isError, ms: Date.now() - started, usage: 'usage' in res ? res.usage : undefined })
    if ('usage' in res && res.usage && spend.add(key, modelOf(t), res.usage, spendName(t)).warn) background(warnSpend(key))
    if ('context' in res && res.context) topics.set(key, { context: res.context })

    // §6: the stored session is gone — say so and offer a fresh one instead of failing silently
    if (res.resumeFailed) {
      topics.set(key, { sessionId: null })
      const id = permSeq++
      keepRetry(id, key, prompt, images, l)
      await sendRich(chatId, topicId, [
        tr(`⚠️ The session \`${t.sessionId?.slice(0, 8)}\` can't be continued: Claude didn't find it (the session files were deleted or the profile changed).`, `⚠️ Сессию \`${t.sessionId?.slice(0, 8)}\` продолжить нельзя: Claude её не нашёл (файлы сессии удалены или сменился профиль).`),
        tr("The previous session's history won't carry over into the new one.", 'В новую сессию история прошлой не перенесётся.'),
      ].join('\n\n'), { reply_markup: new InlineKeyboard().text(tr('🆕 New session with this message', '🆕 Новая сессия с этим сообщением'), `again:${id}`) })
      offers.open(key, 'retry')
      return { text: '', note: tr('⚠️ previous session not found', '⚠️ прошлая сессия не найдена') }
    }

    // §7: a spent plan limit moves the topic to a signed-in profile with room and the task goes on there, by day as
    // in a night shift. With none, or a lost sign-in, it gets a plain status and a button for each other profile
    const profileName = profiles.nameOf(t.profile)
    const signIn = ['authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'verification_required', 'billing_error'].includes(res.errorKind ?? '')
    const limitHit = res.errorKind === 'rate_limit' || (!!res.isError && !signIn && profiles.lastLimit(profileName)?.status === 'rejected')
    // A topic working in Chrome moves only when its browser work has somewhere to go: its own Chrome is signed in to
    // the spent account, so another computer's, on an account with room, takes it (the errand tool finds it)
    // Stopped by the bot itself at paid extra usage counts the same: the plan's limit ran out
    const inChrome = !!topics.get(key).browser
    const chromeTo = inChrome && t.deviceId && chromeAccount(t.deviceId) ? chromesWithRoom(t.deviceId).map(d => d.name) : []
    const atLimit = !res.aborted && limitHit && (!inChrome || chromeTo.length > 0) && mayMoveAtLimit(key)
    const spare = overage ?? (atLimit ? await spareProfile(profileName) : undefined)
    if (spare) {
      const nightOn = shiftOf(key)
      const was = topics.get(key)
      const carried = await switchProfile(key, spare, true)
      movedAtLimit(key)
      // A night shift sends its topics home when it ends. By day the topic goes back once the limit has reset, and a
      // topic already away from home keeps the home it had
      const backAt = untilOf(epochMs(profiles.lastLimit(profileName)?.resetsAt), Date.now())
      if (nightOn) shifts.change(nightOn.id, { profilesUsed: [...new Set([...(nightOn.profilesUsed ?? []), profileName, spare])], moved: [...new Set([...(nightOn.moved ?? []), key])] })
      else topics.set(key, { profileBack: was.profileBack ?? { to: profileName, at: backAt, own: !!was.profileOwn } })
      log.info('profile switched at the limit', { key, from: profileName, to: spare, carried, overage: !!overage, night: !!nightOn })
      const session = carried ? '' : tr(', in a new session', ', в новой сессии')
      background(api.sendMessage(chatId, overage
        ? tr(`🔀 The limit of <b>${esc(profileName)}</b> is reached and paid extra usage began: the night shift goes on on <b>${esc(spare)}</b>${session}.`, `🔀 Лимит <b>${esc(profileName)}</b> исчерпан, пошёл платный Extra usage: ночная смена продолжает на <b>${esc(spare)}</b>${session}.`)
        : nightOn
          ? tr(`🔀 The limit of <b>${esc(profileName)}</b> is reached: the night shift goes on on <b>${esc(spare)}</b>${session}.`, `🔀 Лимит <b>${esc(profileName)}</b> исчерпан: ночная смена продолжает на <b>${esc(spare)}</b>${session}.`)
          : tr(`🔀 The limit of <b>${esc(profileName)}</b> is reached: I go on on <b>${esc(spare)}</b>${session}, and back after it resets, ${resetTag(backAt)}.`, `🔀 Лимит <b>${esc(profileName)}</b> исчерпан: продолжаю на <b>${esc(spare)}</b>${session}, вернусь после сброса, ${resetTag(backAt)}.`)
            + (chromeTo.length ? tr(` This computer's Chrome works only through <b>${esc(profileName)}</b>, so until then the browser work goes to Chrome on <b>${esc(chromeTo.join(', '))}</b>.`, ` Chrome этого компьютера работает только через <b>${esc(profileName)}</b>, поэтому до тех пор работа в браузере идёт через Chrome на <b>${esc(chromeTo.join(', '))}</b>.`) : ''),
      { ...where(topicId), ...HTML, disable_notification: true }).catch(() => {}))
      // The same task again, as what it was: still a scheduled run if it was one, answering the same message, and with
      // no word about a queue. Not a failure and not a report: an agent's head hears nothing until the work is done
      enqueue(chatId, topicId, prompt, { images, reply: false, fromMode: l.modeCap, ownAnswers: l.ownerSpoke, silent: true, scheduleId: [...l.runs][0], shownId: replyTo })
      return { text: '', paused: true, moved: true, note: tr(`🔀 on ${spare}`, `🔀 на ${spare}`) }
    }
    if (!res.aborted && (limitHit || signIn)) {
      const reset = epochMs(profiles.lastLimit(profileName)?.resetsAt)
      const others = []
      for (const n of profiles.list()) if (n !== profileName && (await profiles.status(n)).loggedIn) others.push(n)
      const id = permSeq++
      keepRetry(id, key, prompt, images, l)
      const kb = new InlineKeyboard()
      for (const n of others) kb.text(tr(`▶️ Continue on ${n}`, `▶️ Продолжить на ${n}`), `pfr:${n}:${id}`).row()
      log.warn('profile trouble', { key, profile: profileName, kind: res.errorKind, limitHit })
      // Spent limits come back, so the work does too. Not for ever: a limit that doesn't let up is for the user to look at
      const attempts = (l.limitAttempts ?? 0) + 1
      const until = limitHit && attempts <= MAX_LIMIT_ATTEMPTS ? untilOf(reset, Date.now()) : undefined
      l.limitAttempts = 0
      if (until) {
        pauses.add({ key, until, profile: profileName, text: prompt, attempts, fromMode: l.modeCap, images })
        // A head that waits for a report would wait in silence: no report comes until the reset
        if (t.head) toHead(key, tr(`⏸ Agent <b>${topicA(key, t.workerName ?? '')}</b> ran into the limit and goes on by itself ${resetTag(until)}.`, `⏸ Агент <b>${topicA(key, t.workerName ?? '')}</b> упёрся в лимит и продолжит сам ${resetTag(until)}.`), `[Agent “${t.workerName}” ran into the usage limit and goes on by itself after the reset, ${new Date(until).toISOString()}. Its report comes after that. Nothing to do now unless it can't wait.]`)
        kb.text(tr('⏹ Don\'t go on', '⏹ Не продолжать'), 'lmt:off').row()
      }
      await keepLoud(() => sendRich(chatId, topicId, [
        until
          ? tr(`⏳ **The limit of the profile ${profileName} is reached.** I'll go on by myself after it resets, ${resetTag(until)}. What you write here waits.`, `⏳ **Лимит профиля ${profileName} исчерпан.** Продолжу сам после сброса, ${resetTag(until)}. Что напишешь здесь, подождёт.`)
          : limitHit
            ? tr(`⏳ The limit of the profile **${profileName}** is reached${reset ? `, resets ${resetTag(reset)}` : ''}. More: /usage. It has stopped this task too many times, so it isn't going on by itself: write anything to pick it up.`, `⏳ Лимит профиля **${profileName}** исчерпан${reset ? `, сброс ${resetTag(reset)}` : ''}. Подробнее — /usage. Он уже слишком много раз останавливал эту задачу, поэтому сама она не продолжится: напиши что-нибудь, чтобы продолжить.`)
            : tr(`🔑 The profile **${profileName}** needs a Claude sign-in: /profiles → “Sign in”.`, `🔑 Профилю **${profileName}** нужен вход в Claude: /profiles → «Войти».`),
        others.length ? tr('The session can continue on another profile: it rereads all of it.', 'Сессию можно продолжить на другом профиле — он перечитает её целиком.') : !until ? tr('No other profiles are signed in.', 'Других профилей с выполненным входом нет.') : '',
      ].filter(Boolean).join('\n\n'), kb.inline_keyboard.length ? { reply_markup: kb } : {}))
      if (others.length) offers.open(key, 'retry')
      return { text: '', paused: !!until, note: limitHit ? tr("⏳ profile's limit reached", '⏳ лимит профиля исчерпан') : tr('🔑 Claude sign-in needed', '🔑 нужен вход в Claude') }
    }
    l.limitAttempts = 0

    // Gateway resolves every cancelled operation within its cancel wait, so this is bounded
    const stopped = interruptedSummary(await Promise.all(interrupted.map(async o => ({ step: o.step, out: await o.done }))))
    const note = netFail ? tr(`📡 No connection to Anthropic for over ${cfg.apiTimeoutSec} s: the request was stopped`, `📡 Нет связи с Anthropic больше ${cfg.apiTimeoutSec} с — запрос остановлен`)
      : res.aborted || abort.signal.aborted ? tr('⏹ Stopped', '⏹ Остановлено')
        : res.isError ? tr('⚠️ Ended with an error', '⚠️ Завершилось с ошибкой') : null
    let retry = {}
    if (netFail) {
      const id = permSeq++
      keepRetry(id, key, prompt, images, l)
      retry = { reply_markup: new InlineKeyboard().text(tr('🔁 Retry', '🔁 Повторить'), `again:${id}`) }
    }
    // Deleted while it was being answered, or in the last moments of that
    if (l.answerTakenBack || await l.promptGone?.().catch(() => false)) {
      log.info('answer dropped: its message was deleted', { key, steps: steps.length })
      // Nothing was asked of the answer any more, but what was done on the computer has happened
      if (steps.length) await sendRich(chatId, topicId, tr(`🗑 **The message was deleted, so there is no answer.** Done before that: ${count(steps.length, ['step', 'steps'], ['шаг', 'шага', 'шагов'])}.`, `🗑 **Сообщение удалено, поэтому ответа не будет.** До этого успело выполниться: ${count(steps.length, ['step', 'steps'], ['шаг', 'шага', 'шагов'])}.`)).catch(() => {})
      return { text: '', note: null, stopped: true }
    }
    log.debug('final', { key, draftId, sentAt: Date.now() })
    const { text: answer, replies, question } = splitReplies(res.text || (res.aborted ? '' : text))
    // Only the latest answer's suggestions work: older ones were about a moment that has passed
    // Stopped or failed: going on takes one tap, like a suggested reply (a lost connection has its own Retry)
    const offered: Suggestion | null = !note && replies.length ? { id: permSeq++, replies }
      : note && !netFail ? { id: permSeq++, replies: [tr('▶️ Continue', '▶️ Продолжай')] } : null
    // A turn the user didn't start that offers nothing of its own leaves the user's buttons from before as they are
    const before = topics.get(key).suggested
    if (offered || l.ownerSpoke || !before) {
      if (before) settleButtons(chatId, before)
      topics.set(key, { suggested: offered ?? undefined })
    }
    const buttons = offered ? `\n\n${question && !note ? `${replyQuestion(question)}\n\n` : ''}${replyButtons(offered.replies, i => suggestionData(offered.id, i))}` : ''
    // A head's agents, named in its answer, lead to their topics whether or not Claude wrote the links itself
    const finalMd = finalMarkdown({
      text: [t.head ? answer : linkNames(answer, teamWays(key)), stopped].filter(Boolean).join('\n\n'),
      steps,
      durationMs: res.durationMs ?? Date.now() - started,
      note,
      cost: costLabel('usage' in res ? res.usage : undefined, limitWatch.fiveHour(profileName)),
      // A turn stopped or failed before its last step says so on the plan. One that ended well with steps left unticked
      // is shown as it is: Claude may simply not have ticked them
      plan: l.checklist && finalPlan(l.checklist, mdText, !!note),
    }) + buttons
    const send = () => deliver(() => sendRichWithDeviceMedia(chatId, topicId, finalMd, path => agentMediaOp(key, path) ?? (dev && project ? { deviceId: dev.id, projectId: project.id, bindingVersion: binding } : undefined), { ...retry, ...(replyTo && { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }) }))
    // Quiet mode: the answer of a topic that is no agent's says it is over. An agent's stays silent unless it failed: the head speaks for it
    const wasStopped = (!!res.aborted || abort.signal.aborted) && !netFail
    const sent = await (!t.head || (note && !wasStopped) ? keepLoud(send) : send())
    if (offered && sent.last) topics.set(key, { suggested: { ...offered, ...sent.last } })
    if (answer) {
      for (const id of sent.ids) answers.set(`${chatId}:${id}`, { key, text: answer })
      while (answers.size > ANSWERS_KEPT) answers.delete(answers.keys().next().value!)
    }
    warnLimits(t.head ?? key, profileName)
    offerCompact(key)
    return { text: answer, note, stopped: wasStopped }
  }

  // An answer lives nowhere else: a moment without a network or a limit in a chat must not lose what a long task came to. Not
  // for every send: a handler that waits holds up the whole bot. At worst the first parts of a long answer arrive twice
  const ANSWER_WAITS_S = [5, 15, 30]
  async function deliver<T>(send: () => Promise<T>) {
    for (const [i, wait] of ANSWER_WAITS_S.entries()) {
      try {
        return await send()
      } catch (e) {
        if (closing) throw e
        log.warn('answer not sent, trying again', { attempt: i + 1, error: (e as Error).message })
        const after = (e as { parameters?: { retry_after?: number } }).parameters?.retry_after
        await pause(cfg.answerWaitMs ?? (after ?? wait) * 1000)
      }
    }
    return send()
  }

  // Once per session, after the answer: the history passed OFFER_AT of the window
  function offerCompact(key: string) {
    const t = topics.get(key)
    // An agent compacts by itself, unasked
    if (!t.sessionId || t.head || t.compactOffered === t.sessionId || !shouldOffer(t.context)) return
    topics.set(key, { compactOffered: t.sessionId })
    const { chatId, topicId } = parseKey(key)
    const v = compactView(t.context, true)
    sendChoice(chatId, topicId, v.md, v.rows, v.kb).catch(() => {})
  }

  // --- /compact: how full the history is, and compacting it at a tap -----------------------------
  bot.command('compact', ctx => {
    const topicId = topicOf(ctx.msg)
    const key = topicKey(ctx.chat.id, topicId)
    const t = topics.get(key)
    if (!t.sessionId) return ctx.reply(tr('No conversation in this topic yet: nothing to compact.', 'В этом топике ещё нет разговора: сжимать нечего.'), where(topicId))
    const v = compactView(t.context)
    return sendChoice(ctx.chat.id, topicId, v.md, v.rows, v.kb)
  })
  // The topic comes from the message; the end of the pattern is for older messages, which carried it in their data
  bot.callbackQuery(/^cp:(go|no)(?::-?\d+:\d+)?$/, async ctx => {
    const chatId = ctx.chat!.id
    const message = ctx.callbackQuery.message as Message | undefined
    const key = topicKey(chatId, topicOf(message))
    const t = topics.get(key)
    // The plain edit is for those older messages too, sent before these were rich
    const show = async (md: string) => {
      if (!message || !await editRich(chatId, message.message_id, md)) await ctx.editMessageText(md.replace(/\*\*/g, '')).catch(() => {})
    }
    if (ctx.match[1] === 'no') {
      await ctx.answerCallbackQuery()
      return show(`${compactView(t.context).md}\n\n> ${tr('Left as is.', 'Оставлено как есть.')}`)
    }
    const l = liveOf(key)
    if (!t.sessionId) return ctx.answerCallbackQuery(tr('Nothing to compact', 'Сжимать нечего'))
    if (l.busy) return ctx.answerCallbackQuery({ text: tr('Wait for the task to finish first, or /stop', 'Сначала дождись конца задачи или /stop'), show_alert: true })
    // Busy for the whole compaction: messages that arrive meanwhile wait in the queue
    l.busy = true
    await ctx.answerCallbackQuery()
    await show(compactingText())
    // A big history takes minutes
    background((async () => {
      try {
        const out = await compactSession({ cwd: workDir, sessionId: t.sessionId!, model: modelOf(t), env: profiles.env(t.profile), onStderr: d => log.debug('claude', d.trim()) })
        topics.set(key, { sessionId: out.sessionId, toldFresh: true, ...(out.context && { context: out.context }) })
        log.info('compacted', { key, pre: out.pre, post: out.post, trigger: 'manual' })
        await show(compactedText(out.pre, out.post ?? out.context?.total))
      } catch (e) {
        log.warn('compact failed', { key, error: (e as Error).message })
        await show(tr(`⚠️ **Couldn't compact:** ${(e as Error).message}`, `⚠️ **Не получилось сжать:** ${(e as Error).message}`))
      } finally {
        l.busy = false
        if (l.queue.length) schedule(key)
      }
    })())
  })

  // After the answer, and not holding up the next turn: the check takes a second or two
  function warnLimits(key: string, profile: string) {
    const { chatId, topicId } = parseKey(key)
    limitWatch.check(profile)
      .then(near => (near.length ? sendRich(chatId, topicId, limitWarning(profile, near)) : undefined))
      .catch(e => log.warn('limit check', (e as Error).message))
  }

  // --- incoming: text, photos, albums, files, voice, video (§15) -----------------------------------
  async function download(fileId: string, size?: number) {
    if (size && size > TG_FILE_MAX) throw new Error(tr(`${sizeLabel(size)}, and Telegram gives bots files up to 20 MB.\nSend a link (Drive, Dropbox, WeTransfer…): Claude downloads it straight to the computer`, `${sizeLabel(size)}, а Telegram отдаёт ботам файлы до 20 МБ.\nПришли ссылку (Drive, Dropbox, WeTransfer…): Claude скачает файл прямо на компьютер`))
    const f = await api.getFile(fileId).catch(e => {
      log.warn('getFile', (e as Error).message)
      throw new Error(tr("Telegram didn't hand over the file. Send it again", 'Telegram не отдал файл. Отправь его ещё раз'))
    })
    // The URL carries the bot token: it never goes to the log
    const url = `${cfg.apiRoot ?? 'https://api.telegram.org'}/file/bot${cfg.token}/${f.file_path}`
    // The connection to Telegram's file server drops now and then («fetch failed»): a dropped one is tried again, a
    // refusal is not
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
        if (!res.ok) throw Object.assign(new Error(tr(`Telegram didn't hand over the file: ${res.status}`, `Telegram не отдал файл: ${res.status}`)), { final: true })
        return Buffer.from(await res.arrayBuffer())
      } catch (e) {
        if ((e as { final?: boolean }).final) throw e
        log.warn('file download', { attempt, error: (e as Error).message })
        if (attempt >= DOWNLOAD_TRIES) throw new Error(tr("The file didn't come through from Telegram: the connection dropped. Send it again", 'Файл не скачался из Telegram: обрывалась связь. Отправь его ещё раз'))
        await pause(cfg.downloadRetryMs ?? attempt * 2000)
      }
    }
  }

  // Media takes seconds to fetch, transcribe or cut into frames. It holds its place in the queue and the turn
  // waits for it, while the bot keeps handling buttons and Stop: handlers start the work and return at once
  function accept(ctx: Context, what: Kind, work: (key: string) => Promise<Prepared>) {
    const chatId = ctx.chat!.id
    const topicId = topicOf(ctx.msg)
    const key = topicKey(chatId, topicId)
    const l = liveOf(key)
    const seq = l.arrivals++
    const epoch = l.epoch
    const context = lines(replyContext(ctx.msg!, ownSticker(ctx.chat!.id)), forwardContext(ctx.msg!))
    l.preparing++
    startPrep(key, l, what)
    work(key)
      .then(async m => {
        if (l.epoch !== epoch) return
        // A voice reply to Claude's question answers it, like typed text would
        const answers = () => m.plain !== undefined && (l.answer || l.newProjectOn || surveys.get(key))
        const tasks = !answers() && (m.plain?.length ?? 0) >= SPLIT_MIN_CHARS ? await splitVoice(m.plain!, { cwd: workDir, env: profiles.env(topics.get(key).profile) }) : null
        if (l.epoch !== epoch) return
        if (answers()) return enqueue(chatId, topicId, m.plain!)
        if (await toAgentByReply(chatId, topicId, ctx.msg!, m.text, m.images)) return
        // Waits for a tap; a card that can't be sent is no reason to lose the message
        if (isList(tasks) && await voiceTasks.offer(chatId, topicId, { tasks, text: m.plain!, context, msgId: ctx.msg!.message_id, shownId: m.shownId }).then(() => true, e => log.warn('voice list', (e as Error).message))) return
        enqueue(chatId, topicId, m.text, { images: m.images, seq, reply: false, context, msgId: ctx.msg!.message_id, shownId: m.shownId })
      })
      .catch(e => {
        log.warn('attachment failed', { key, what, error: (e as Error).message })
        return keepLoud(() => api.sendMessage(chatId, `⚠️ <b>${esc(kindLabel(what))}: ${tr('not processed', 'не обработано')}:</b> ${errorHtml(masked(chatId, topicId, (e as Error).message))}`, { ...where(topicId), ...HTML }))
      })
      .catch(() => {})
      .finally(() => {
        l.preparing--
        prepDone(l, what)
        if (l.preparing) return
        if (l.queue.length && !l.busy) schedule(key)
        // Nothing to run: it failed, answered a question or was stopped
        else endPrep(l)
      })
  }

  // Where the live preview goes: a draft in a private chat, a status message in a group, which has no drafts
  function liveView(chatId: number, topicId: number | undefined, draftId: number): LiveView {
    if (!isGroupChat(chatId)) {
      return {
        markdown: draftMarkdown,
        send: md => api.sendRichMessageDraft(chatId, draftId, { markdown: md }, { ...where(topicId), can_stop: true }),
        end: async () => {},
      }
    }
    const stop = richButtons([[{ text: tr('⏹ Stop', '⏹ Стоп'), data: `stg:${draftId}` }]])
    const started = Date.now()
    const bubble = createStatusBubble({
      limit: groupLimit,
      chatId,
      send: async md => {
        const id = (await api.sendRichMessage(chatId, { markdown: `${md}\n\n${stop}` }, where(topicId))).message_id
        flights.bubble(topicKey(chatId, topicId), id)
        return id
      },
      edit: (id, md) => editRich(chatId, id, `${md}\n\n${stop}`),
      remove: id => {
        flights.bubbleGone(topicKey(chatId, topicId), id)
        return api.deleteMessage(chatId, id)
      },
    })
    return { markdown: p => statusMarkdown({ ...p, elapsedMs: Date.now() - started }), send: bubble.show, end: bubble.end, minGap: bubble.gap, heartbeat: STATUS_TIME_STEP_MS }
  }

  function startPrep(key: string, l: Live, what: Kind) {
    const t = topics.get(key)
    // Only when a turn follows right after: a busy topic shows Claude's own draft, an unbound one the picker
    if (l.busy || !t.deviceId || !t.projectId || !gateway.device(t.deviceId)) return
    if (!l.prep) {
      const { chatId, topicId } = parseKey(key)
      const draftId = randomInt(1, 2 ** 31 - 1)
      const view = liveView(chatId, topicId, draftId)
      const p: Prep = { draftId, view, seen: new Map(), active: new Map(), drafter: null! }
      p.drafter = createDrafter(
        () => view.markdown({ steps: [], text: '', status: prepStatus(p.seen, p.active) }),
        md => view.send(md),
        { minGap: view.minGap, heartbeat: view.heartbeat, onError: e => log.warn('prep draft failed', (e as Error).message) },
      )
      l.prep = p
      l.draftId = draftId
    }
    l.prep.seen.set(what, (l.prep.seen.get(what) ?? 0) + 1)
    l.prep.active.set(what, (l.prep.active.get(what) ?? 0) + 1)
    l.prep.drafter.kick()
  }

  function prepDone(l: Live, what: Kind) {
    if (!l.prep) return
    l.prep.active.set(what, (l.prep.active.get(what) ?? 1) - 1)
    l.prep.drafter.kick()
  }

  function endPrep(l: Live) {
    const p = l.prep
    l.prep = null
    return p?.drafter.stop().then(() => p.view.end())
  }

  const asImage = (data: Buffer, mime: string): PromptImage => ({ mime: mime as PromptImage['mime'], data: data.toString('base64') })

  // Any picture, as a copy Claude can look at: scaled to 1568 px when the server has ffmpeg (also turns BMP,
  // TIFF and the like into PNG/JPEG), as it is when it is small and in a format the API takes
  async function forClaude(data: Buffer, mime: string, name: string): Promise<{ mime: string, data: Buffer }> {
    if (media.ffmpeg) {
      const work = mkdtempSync(join(tmpdir(), 'tgcv-view-'))
      try {
        const file = join(work, basename(name) || 'image')
        writeFileSync(file, data)
        return await shrinkImage(file, media, IMAGE_INLINE_MAX)
      } finally {
        rmSync(work, { recursive: true, force: true })
      }
    }
    if (VIEWABLE.has(mime) && data.length <= IMAGE_INLINE_MAX) return { mime, data }
    throw new Error(VIEWABLE.has(mime) ? tr("the image is too big, and the server has nothing to shrink it with: no ffmpeg", 'картинка слишком большая, а сжать её на сервере нечем: нет ffmpeg') : tr(`the ${mime} format can't be shown without ffmpeg on the server`, `формат ${mime} без ffmpeg на сервере не показать`))
  }

  // A picture sent as a file can be any size: Claude gets a copy it can safely look at, the original stays as is
  async function viewImage(a: Attachment, data: Buffer): Promise<PromptImage[]> {
    if (media.ffmpeg) {
      const v = await shrinkImage(a.path, media, IMAGE_INLINE_MAX).catch(e => log.warn('image not shrunk', (e as Error).message))
      if (v) return [asImage(v.data, v.mime)]
    }
    return data.length <= IMAGE_INLINE_MAX ? [asImage(data, a.mime)] : []
  }

  // Claude can't watch: a few stills, plus what is said in it
  async function viewVideo(a: Attachment, head: string, speech: boolean): Promise<Prepared> {
    const v = await videoFrames(a.path, media).catch(e => {
      log.warn('video frames failed', (e as Error).message)
      return null
    })
    let said: string | false = false
    if (speech) {
      const missing = missingForSpeech(media)
      said = missing.length
        ? `(speech not transcribed: the server has no ${missing.join(', ')})`
        : await transcribe(a.path, media).then(t => t && `🎙 ${t}`, e => `(speech not transcribed: ${(e as Error).message})`)
    }
    return {
      text: lines(head, v ? `🎬 ${Math.round(v.duration)} s, frames at ${v.frames.map(f => `${f.t} s`).join(', ')}` : '(frames unavailable: the server has no ffmpeg)', said),
      images: v?.frames.map(f => asImage(f.data, 'image/jpeg')) ?? [],
    }
  }

  const overview = createOverview({
    bot,
    source: {
      live, pending, asking, surveys, offers, slotWaiters,
      signIns: () => [...loginWaits.keys(), ...mcpWaits.keys()],
      speechOffer: () => {
        const o = speech.offer()
        return o && { key: topicKey(o.chatId, o.topicId), messageId: o.messageId }
      },
      unbound: key => {
        const t = topics.get(key)
        return !t.noProject && (!t.deviceId || !t.projectId)
      },
      computerOf: key => deviceName(topics.get(key).deviceId ?? ''),
      chatOf: key => parseKey(key).chatId,
      deferred: () => topics.entries().flatMap(([key, t]) => deferredNames(t).map(title => ({ key, computer: deviceName(t.deviceId ?? ''), title }))),
    },
    names: {
      place: chatId => workspaces.get(chatId)?.title ?? tr('Private chat', 'Личный чат'),
      topic: key => (parseKey(key).topicId ? topicLabel(key, topics.get(key)) : tr('general chat', 'общий чат')),
      where: parseKey,
      masked: (key, text) => masked(parseKey(key).chatId, parseKey(key).topicId, text, true),
    },
    addedBy: chatId => workspaces.get(chatId)?.addedBy,
    send: (chatId, topicId, md, rows) => sendChoice(chatId, topicId, md, rows, goKeyboard(rows)),
    sendWidget: async (chatId, topicId, rows) => {
      const html = nowWidgetHtml(rows)
      if (widgetProblem(html)) return false
      try {
        await (api.raw as unknown as { sendWidget: (o: object) => Promise<unknown> }).sendWidget({ chat_id: chatId, ...where(topicId), html, width: 320, allow_queries: true })
        return true
      } catch (e) {
        log.warn('now widget', (e as Error).message)
        return false
      }
    },
    edit: (chatId, messageId, md, rows) => editRich(chatId, messageId, `${md}\n\n${richButtons(rows)}`),
  })

  // Renders Claude started in the background: the bot reads their logs on the computer and shows the progress itself
  type RenderPlace = { chatId: number, topicId?: number, deviceId: string, projectId: string, binding: number }
  const renderEdited = new Map<string, number>()
  const renders = createRenderWatch<RenderPlace>({
    read: async j => {
      const op = { projectId: j.where.projectId, bindingVersion: j.where.binding, tool: 'run_command' as const, params: { command: readCommand(j.pid, j.log), timeoutSec: 20 } }
      const out = await gateway.request(j.where.deviceId, op)
      return out.ok ? readOutput((out.result as ToolResult['run_command']).stdout) : null
    },
    shown: j => void showRender(j),
    changed: j => void showRender(j),
  })
  async function showRender(j: RenderJob<RenderPlace>) {
    const { chatId, topicId } = j.where
    // The widget asks for its own numbers: once it is there, nothing more to send
    if (j.msgId === -1) return
    if (chatId > 0 && j.msgId === undefined) {
      const html = renderWidgetHtml(j)
      try {
        if (widgetProblem(html)) throw new Error(widgetProblem(html)!)
        await (api.raw as unknown as { sendWidget: (o: object) => Promise<unknown> }).sendWidget({ chat_id: chatId, ...where(topicId), html, width: 320, height: 320, allow_queries: true })
        j.msgId = -1
        return
      } catch (e) {
        log.warn('render widget', (e as Error).message)
      }
    }
    if (j.msgId === undefined) {
      j.msgId = 0
      const m = await api.sendMessage(chatId, renderLine(j), { ...where(topicId), disable_notification: true }).catch(() => null)
      j.msgId = m?.message_id ?? 0
      renderEdited.set(j.id, Date.now())
      return
    }
    // A group's message follows the frames now and then, and the end at once
    if (!j.msgId || (j.state === 'run' && Date.now() - (renderEdited.get(j.id) ?? 0) < 20_000)) return
    renderEdited.set(j.id, Date.now())
    await api.editMessageText(chatId, j.msgId, renderLine(j)).catch(() => {})
  }

  const scheduleMenu = createScheduleMenu({
    bot, schedule: schedules, topics, gateway, profiles, log, modeOf, masked, enqueue, sendChoice, editRich, topicGone: deleteTopic,
    defer: (key, task, title) => deferTask(key, task, title),
    browserFor: key => {
      const t = topics.get(key)
      if (!t.deviceId || !browsers.get(t.deviceId)) return false
      // Already on for good: left as it is
      if (t.browser && !t.browserAuto) return true
      topics.set(key, { browser: true, browserAuto: true, browserUsedAt: Date.now() })
      browserForRun.add(key)
      log.info('browser on for a scheduled run', { key })
      return true
    },
    tickMs: cfg.scheduleTickMs,
    offered: (key, messageId) => offers.open(key, 'schedule', messageId),
    isRunning: (key, id) => {
      const l = live.get(key)
      return !!l && (l.runs.has(id) || l.queue.some(i => i.scheduleId === id))
    },
  })

  // Nothing of this chat may go on running: its account is off the list, or the bot was removed from the group
  // Telegram turned a basic group into a supergroup, which comes with a new id. The conversation goes over with all that
  // belongs to it. A turn under way would go on writing under the old id, so it stops, and says so
  function moveChat(from: number, to: number) {
    const w = workspaces.get(from)
    if (!w) return
    workspaceMenu.moved(from)
    const [oldKey, newKey] = [topicKey(from), topicKey(to)]
    const running = !!live.get(oldKey)?.abort
    schedules.moveTopic(oldKey, newKey)
    dropChat(from)
    flights.end(oldKey)
    workspaces.remove(from)
    workspaces.add(to, w)
    topics.rekey(oldKey, newKey)
    decisionStore.move(from, to)
    if (night.on(from)) {
      night.set(from, false)
      night.set(to, true)
    }
    if (quiet.on(from)) {
      quiet.set(from, false)
      quiet.set(to, true)
    }
    log.info('workspace moved', { from, to })
    background(groupCommands(to, !!w.plain))
    if (running) background(api.sendMessage(to, tr('🔄 Telegram gave this group a new id, which stopped the running task. The conversation is saved: send it again.', '🔄 Telegram сменил группе id, поэтому задача остановилась. Разговор сохранён: отправь её ещё раз.')))
  }

  const dropChat = (chatId: number) => {
    for (const [key, l] of live) {
      if (parseKey(key).chatId !== chatId) continue
      handIn.drop(key, l)
      l.queue.length = 0
      l.waitingDevice = false
      l.epoch++
      l.abort?.abort()
    }
    for (const o of offers.list()) if (parseKey(o.key).chatId === chatId) offers.passed(o.key)
    for (const key of surveys.keys()) if (parseKey(key).chatId === chatId) surveys.drop(key)
    schedules.removeChat(chatId)
    pauses.dropChat(chatId)
  }

  // A topic with something to carry over, and no team tied to its place
  const canMoveTopic = (key: string) => {
    const t = topics.get(key)
    return !!(t.sessionId || t.deviceId || t.noProject) && !t.head && !t.workers?.length
  }
  // In a group with no topics the card is the conversation's own settings, not what new topics start from
  const applyToPlainGroup = (chatId: number) => {
    const w = workspaces.get(chatId)
    if (!w?.plain) return
    const key = topicKey(chatId)
    const t = topics.get(key)
    topics.set(key, { mode: w.mode ?? t.mode, model: w.model ?? t.model })
    if (w.deviceId && w.projectId && (t.deviceId !== w.deviceId || t.projectId !== w.projectId)) topics.bind(key, w.deviceId, w.projectId)
  }
  // What Claude Code tells every session about the account and the machine: no answer to a companion chat may carry it.
  // An address is asked for once an hour; an account whose address can't be had is one whose answers can't be checked
  const companionRoom = join(tmpdir(), 'room')
  const companionMails = new Map<string, { at: number, email: string }>()
  async function companionSecrets(profile: string): Promise<Secret[]> {
    for (const p of profiles.list()) {
      const kept = companionMails.get(p)
      if (kept && Date.now() - kept.at < 3600_000) continue
      const s = await profiles.status(p).catch(() => null)
      if (s?.email) companionMails.set(p, { at: Date.now(), email: s.email })
      else if (p === profile && !kept && (!s || s.error)) throw new Error("the account's address could not be asked for, so its answers can't be checked")
    }
    return [
      ...[...companionMails.values()].map(m => ({ kind: 'e-mail' as const, value: m.email })),
      { kind: 'system', value: release() }, { kind: 'system', value: hostname() },
      ...[companionRoom, workDir, cfg.profileDir, dirname(cfg.profileDir)].map(value => ({ kind: 'folder' as const, value })),
    ]
  }
  const companion = createCompanion({
    bot, store: companions, owners, models, profiles, log, zone: () => schedules.zone(), turn: askCompanion, secrets: companionSecrets, background, sendChoice, editRich,
    taken: chatId => !!workspaces.get(chatId),
    cwd: () => {
      mkdirSync(companionRoom, { recursive: true })
      return companionRoom
    },
    say: (chatId, thread, md, extra) => sendRich(chatId, thread, md, extra),
    hearVoice: async (fileId, size) => {
      const missing = missingForSpeech(media)
      if (missing.length) throw new Error(`the server has no ${missing.join(', ')}`)
      const text = await hearFirst(await download(fileId, size), media)
      if (!text) throw new Error('no speech recognized')
      return text
    },
    // Voice messages of a chat that nobody asked about: never beside one that is waited for, and on half the threads,
    // so that one arriving meanwhile is not held up by much
    hearQuietly: async (fileId, size) => {
      if (missingForSpeech(media).length) throw new Error('the server cannot hear speech')
      const data = await download(fileId, size)
      while (hearingNow > 0) await pause(1000)
      return hear(data, { ...media, threads: Math.max(1, Math.floor(media.threads / 2)) })
    },
    // A photo as Telegram re-encoded it: nothing a stranger sends is opened by a program on the server
    picture: async (fileId, size) => asImage(await download(fileId, size), 'image/jpeg'),
    // The same two conditions as for the owner's own reading: the firewall that keeps the inside of the server
    // unreachable is up, and the name leads outside
    openable: async url => {
      if (sandbox?.state().state === 'open') return 'Reading pages is switched off on the server right now. Say so.'
      return await resolvedPublicUrl(url) ? null : 'Only public internet addresses open from here.'
    },
    findPictures: query => companionWeb.findPictures(query),
    download: url => companionWeb.download(url),
  })
  const companionTimer = setInterval(() => void companion.tick().catch(e => log.warn('companion tick', (e as Error).message)), 30_000).unref()
  const workspaceMenu = createWorkspaceMenu({ companions: () => companion.list(), bot, owners, workspaces, models, gateway, log, sendChoice, editRich, sendRich, dropChat, applied: applyToPlainGroup, topicsChanged: (chatId, plain) => background(groupCommands(chatId, plain)), canMove: (chatId, topicId) => canMoveTopic(topicKey(chatId, topicId)), nightOn: shifts.inChat, quietOn: quiet.on })
  // /night was a switch of its own, and it outlived the night: whatever it left on with no shift kept to branches goes
  for (const chatId of night.chats()) {
    if (!shifts.all().some(sh => sh.state === 'running' && !sh.release && parseKey(sh.key).chatId === chatId)) {
      night.set(chatId, false)
      log.info('night mode left from /night turned off', { chatId })
    }
  }
  createQuietMenu({ bot, quiet, log, sendRich, editRich })
  const voiceTasks = createVoiceTasks({ bot, file: join(cfg.dataDir, 'voice-lists.json'), log, sendChoice, editRich: (chatId, messageId, md) => editRich(chatId, messageId, md), enqueue, autoMs: cfg.voiceListAutoMs })
  const locks = createLocks({
    file: join(cfg.dataDir, 'locks.json'),
    gateway,
    log,
    heard: (dev, file) => toOwners(tr(`🔒 <b>${esc(dev.name)}</b> connected and is now locked. To unlock, delete this file on it: <code>${esc(file ?? '')}</code>`, `🔒 <b>${esc(dev.name)}</b> подключился и теперь заблокирован. Чтобы снять, удали на нём файл: <code>${esc(file ?? '')}</code>`)),
  })
  createLockMenu({
    bot, locks, log, isCloud, sendChoice, keyboardOf: rows => goKeyboard(rows),
    ids: () => registry.list().map(r => r.id),
    nameOf: id => gateway.device(id)?.name ?? registry.list().find(r => r.id === id)?.name ?? id,
    stopAll: () => Promise.all([...live.keys()].map(haltTopic)),
    editRich: (chatId, messageId, md) => editRich(chatId, messageId, md),
  })
  const decisionsMenu = createDecisionsMenu({
    bot, store: decisionStore, workspaces, log, masked, sendRich, editRich,
    today: () => new Intl.DateTimeFormat('en-CA', { timeZone: schedules.zone() }).format(Date.now()),
    ownerSpoke: key => !!live.get(key)?.ownerSpoke,
  })

  const movedMarkdown = (title: string, group: number, thread: number) => tr(
    `➡️ **Moved to [${mdText(title)}](${groupLink(group).replace(/\/1$/, '')}/${thread}).** This topic stays to read.`,
    `➡️ **Перенесён в [${mdText(title)}](${groupLink(group).replace(/\/1$/, '')}/${thread}).** Этот топик остаётся для чтения.`,
  )
  bot.callbackQuery(/^wmk:(-\d+):(\d+)$/, async ctx => {
    await ctx.answerCallbackQuery()
    const message = ctx.callbackQuery.message
    if (message) await editRich(ctx.chat!.id, message.message_id, movedMarkdown(workspaces.get(Number(ctx.match[1]))?.title ?? tr('the group', 'группу'), Number(ctx.match[1]), Number(ctx.match[2])))
  })

  // The conversation moves to a new topic of the group: a session belongs to one topic. Telegram can't move messages, so
  // the old topic stays to read, with nothing tied to it
  bot.callbackQuery(/^wm:(-\d+)$/, async ctx => {
    const target = Number(ctx.match[1])
    const w = workspaces.get(target)
    const message = ctx.callbackQuery.message as Message | undefined
    const topicId = topicOf(message)
    const key = topicKey(ctx.chat!.id, topicId)
    if (!w || !topicId || !canMoveTopic(key)) return ctx.answerCallbackQuery(tr('No longer relevant', 'Уже неактуально'))
    const l = liveOf(key)
    if (l.busy || l.queue.length) return ctx.answerCallbackQuery(tr('Wait for the task to finish first, or /stop', 'Сначала дождись конца задачи или /stop'))
    await ctx.answerCallbackQuery()
    const t = topics.get(key)
    const name = t.title
      ?? message?.reply_to_message?.forum_topic_created?.name
      ?? (t.deviceId ? gateway.device(t.deviceId)?.projects.find(p => p.id === t.projectId)?.name : undefined)
      ?? tr('Moved topic', 'Перенесённый топик')
    try {
      const topic = await api.createForumTopic(target, trunc(name, 128))
      const newKey = topicKey(target, topic.message_thread_id)
      // What described the old place stays behind
      const { suggested: _suggested, icon: _icon, warnedAt: _warned, nameImplicit: _implicit, ...kept } = t
      topics.set(newKey, { ...kept, usedAt: Date.now() })
      schedules.moveTopic(key, newKey)
      topics.remove(key)
      log.info('topic moved', { from: key, to: newKey })
      await sendRich(target, topic.message_thread_id, tr('**Topic moved here.** Claude remembers the conversation; the earlier messages stayed in the private chat.', '**Топик перенесён сюда.** Claude помнит разговор, а прежние сообщения остались в личке.')).catch(e => log.warn('moved note', (e as Error).message))
      // The old topic is only something to read now: one tap takes it away
      const rows: RichButton[][] = [[{ text: tr('🗑 Delete this topic', '🗑 Удалить этот топик'), data: 'del:yes', style: 'danger' }, { text: tr('Keep it', 'Оставить'), data: `wmk:${target}:${topic.message_thread_id}` }]]
      const md = movedMarkdown(w.title, target, topic.message_thread_id)
      if (!message || !await editRich(ctx.chat!.id, message.message_id, `${md}\n\n${richButtons(rows)}`)) await ctx.editMessageText(md.replace(/\*\*/g, '')).catch(() => {})
    } catch (e) {
      log.warn('topic move failed', { key, error: (e as Error).message })
      await ctx.editMessageText(tr(`⚠️ <b>Didn't move:</b> ${esc(failureText(e))}`, `⚠️ <b>Не перенёс:</b> ${esc(failureText(e))}`), HTML).catch(() => {})
    }
  })

  const usersMenu = createUsersMenu({
    bot, owners, log, sendChoice, editRich,
    dropChat: chatId => {
      dropChat(chatId)
      for (const w of workspaces.list()) {
        if (w.addedBy !== chatId) continue
        dropChat(w.chatId)
        workspaces.remove(w.chatId)
        api.leaveChat(w.chatId).catch(e => log.warn('leaving a group', (e as Error).message))
      }
    },
  })

  bot.on('message:text', async ctx => {
    // The way back from a sign-in page, pasted by hand: to the CLI, out of the chat
    if (mcpWaits.has(topicKey(ctx.chat.id, topicOf(ctx.msg))) && /^https?:\/\/localhost[:/]\S+$/.test(ctx.msg.text.trim())) {
      api.deleteMessage(ctx.chat.id, ctx.msg.message_id).catch(() => {})
      return finishMcpLogin(topicKey(ctx.chat.id, topicOf(ctx.msg)), ctx.msg.text)
    }
    if (renames.size && await takeComputerName(ctx.chat.id, topicOf(ctx.msg), ctx.msg.text)) return
    if (usersMenu.waiting(ctx.chat.id)) {
      if (!/^\/\w/.test(ctx.msg.text)) return usersMenu.receive(ctx.chat.id, topicOf(ctx.msg), ctx.msg)
      usersMenu.cancel(ctx.chat.id)
    }
    // A sign-in waits for its code here: it goes to the CLI, never into the conversation with Claude
    if (loginWaits.has(topicKey(ctx.chat.id, topicOf(ctx.msg))) && !/^\/\w/.test(ctx.msg.text)) {
      return takeLoginCode(ctx.chat.id, topicOf(ctx.msg), ctx.msg.message_id, ctx.msg.text)
    }
    if (scheduleMenu.takesZone(topicKey(ctx.chat.id, topicOf(ctx.msg))) && !/^\/\w/.test(ctx.msg.text)) {
      return scheduleMenu.setZone(ctx.chat.id, topicOf(ctx.msg), ctx.msg.text)
    }
    const addressed = ctx.msg.text.match(/^\/\w+@(\w+)/)?.[1]
    if (addressed && addressed.toLowerCase() !== ctx.me.username.toLowerCase()) return
    // What the "add to group" link leaves behind, which can come without the marks of a command: the bot has just
    // shown its card in that group
    if (isGroupChat(ctx.chat.id) && /^\/start(@\w+)?(\s|$)/.test(ctx.msg.text)) return
    // Not one of ours: Claude Code would run it as its own console command (/mcp, /clear…) without the
    // model and with nothing to show here. Except while Claude waits for an answer — then it is the answer
    if (/^\/\w/.test(ctx.msg.text) && !liveOf(topicKey(ctx.chat.id, topicOf(ctx.msg))).answer) {
      return ctx.reply(tr('The bot has no such command. The list: /help. If this is a question for Claude, write it without the “/” at the start.', 'Такой команды у бота нет. Список — /help. Если это вопрос для Claude, напиши его без «/» в начале.'), where(topicOf(ctx.msg)))
    }
    if (!liveOf(topicKey(ctx.chat.id, topicOf(ctx.msg))).answer && await toAgentByReply(ctx.chat.id, topicOf(ctx.msg), ctx.msg, ctx.msg.text)) return
    return enqueue(ctx.chat.id, topicOf(ctx.msg), ctx.msg.text, { context: lines(replyContext(ctx.msg, ownSticker(ctx.chat.id)), customEmojiNote(ctx.msg.text, ctx.msg.entities)), msgId: ctx.msg.message_id })
  })

  // A corrected message: still waiting, it just takes the new text; already taken up, Claude hears of the correction
  bot.on('edited_message:text', ctx => {
    const m = ctx.editedMessage
    const key = topicKey(ctx.chat.id, topicOf(m))
    if (!m.edit_date || /^\/\w/.test(m.text) || loginWaits.has(key)) return
    log.info('message edited', { key })
    if (replaceQueued(liveOf(key).queue, m.message_id, m.text)) return
    enqueue(ctx.chat.id, topicOf(m), editedPrompt(m.text), { reply: false, msgId: m.message_id })
  })

  bot.on('message_reaction', ctx => {
    const r = ctx.messageReaction
    if (justHandedIn(r.old_reaction, r.new_reaction) && handIn.react(ctx.chat.id, r.message_id)) return
    const answerId = `${ctx.chat.id}:${r.message_id}`
    const answer = answers.get(answerId)
    const praised = answer && justPraised(r.old_reaction, r.new_reaction)
    if (praised) {
      // A few at most: a row of fires says no more than the last ones
      praise.set(answer.key, [...(praise.get(answer.key) ?? []), praisedNote(praised, answer.text)].slice(-PRAISE_KEPT))
      log.info('answer praised', { key: answer.key, emoji: praised })
      return
    }
    if (!answer || !justDisliked(r.old_reaction, r.new_reaction)) return
    answers.delete(answerId)
    log.info('answer disliked', { key: answer.key })
    const { chatId, topicId } = parseKey(answer.key)
    enqueue(chatId, topicId, dislikedPrompt(answer.text), { reply: false, msgId: r.message_id })
  })

  bot.on('message:photo', ctx => accept(ctx, 'photo', async key => {
    const photo = ctx.msg.photo.at(-1)!
    const data = await download(photo.file_id, photo.file_size)
    const a = inbox.add(key, `photo-${ctx.msg.message_id}.jpg`, 'image/jpeg', data)
    return { text: lines(captionOf(ctx.msg), attachmentLine(a)), images: [asImage(data, 'image/jpeg')] }
  }))

  bot.on('message:voice', async ctx => {
    const go = () => accept(ctx, 'voice', async () => {
      const missing = missingForSpeech(media)
      if (missing.length) throw new Error(tr(`can't transcribe: the server has no ${missing.join(', ')}`, `не расшифровать: на сервере нет ${missing.join(', ')}`))
      const v = ctx.msg.voice
      const began = Date.now()
      const text = await hearFirst(await download(v.file_id, v.file_size), media)
      // How long hearing takes against how long was said: the one sign that the server has too little to do it with
      log.info('voice heard', { audioSec: v.duration, tookSec: Math.round((Date.now() - began) / 100) / 10 })
      if (!text) throw new Error(tr('no speech recognized', 'речь не распознана'))
      // The user sees what was heard, so a misrecognised word is caught before Claude acts on it
      const shown = await api.sendMessage(ctx.chat.id, foldedQuote(`🎙 ${masked(ctx.chat.id, topicOf(ctx.msg), text)}`, PLAIN_LIMIT - 200), { ...where(topicOf(ctx.msg)), ...HTML, reply_parameters: { message_id: ctx.msg.message_id } }).catch(() => {})
      const shownId = shown ? shown.message_id : undefined
      // Someone else's voice answers no question and is no list of the user's tasks
      if (ctx.msg.forward_origin) return { text: forwardedText(`🎙 ${text}`), shownId }
      return { text: `🎙 ${text}`, plain: text, shownId }
    })
    if (!(await speech.holdFor(ctx.chat.id, topicOf(ctx.msg), go))) go()
  })

  // Before documents: Telegram sends a GIF animation with a document field too
  bot.on(['message:video', 'message:animation', 'message:video_note'], async ctx => {
    const m = ctx.msg
    const go = () => accept(ctx, 'video', async key => {
      const v = m.video ?? m.animation
      const f = v ?? m.video_note!
      const a = inbox.add(key, v?.file_name ?? `video-${m.message_id}.mp4`, v?.mime_type ?? 'video/mp4', await download(f.file_id, f.file_size))
      return viewVideo(a, lines(captionOf(m), attachmentLine(a)), !m.animation)
    })
    // A round video is mostly what is said in it: it waits for the speech model like a voice message. Other
    // videos go on at once with their frames, the offer comes alongside
    if (m.video_note && (await speech.holdFor(ctx.chat.id, topicOf(m), go))) return
    if (m.video) await speech.holdFor(ctx.chat.id, topicOf(m))
    go()
  })

  bot.on('message:audio', ctx => accept(ctx, 'audio', async key => {
    const au = ctx.msg.audio
    const a = inbox.add(key, au.file_name ?? `audio-${ctx.msg.message_id}.mp3`, au.mime_type ?? 'audio/mpeg', await download(au.file_id, au.file_size))
    return { text: lines(captionOf(ctx.msg), attachmentLine(a)) }
  }))

  // A sticker the user sends: its file comes along, a TGS for Claude's lottie_to_svg, a still one to look at
  bot.on('message:sticker', ctx => accept(ctx, 'file', async key => {
    const s = ctx.msg.sticker
    const [ext, mime] = s.is_animated ? ['tgs', 'application/x-tgsticker'] : s.is_video ? ['webm', 'video/webm'] : ['webp', 'image/webp']
    const data = await download(s.file_id, s.file_size)
    const a = inbox.add(key, `sticker-${ctx.msg.message_id}.${ext}`, mime, data)
    const head = lines(`[The user sent a sticker${s.emoji ? ` ${s.emoji}` : ''}${s.set_name ? ` from the set “${s.set_name.slice(0, 64)}”` : ''}${s.is_animated ? ', animated (TGS)' : s.is_video ? ', video (WebM)' : ''}]`, attachmentLine(a))
    return VIEWABLE.has(mime) ? { text: head, images: await viewImage(a, data) } : { text: head }
  }))

  bot.on('message:document', ctx => accept(ctx, 'file', async key => {
    const d = ctx.msg.document
    const mime = d.mime_type ?? 'application/octet-stream'
    const data = await download(d.file_id, d.file_size)
    const a = inbox.add(key, d.file_name ?? `file-${ctx.msg.message_id}`, mime, data)
    const head = lines(captionOf(ctx.msg), attachmentLine(a))
    if (VIEWABLE.has(mime)) return { text: head, images: await viewImage(a, data) }
    if (mime.startsWith('video/')) return viewVideo(a, head, true)
    // A Lottie is told in a line: its JSON would cost tens of thousands of tokens and say nothing to read
    const lottieNote = lottieSummary(a.name, data)
    if (lottieNote) return { text: lines(head, lottieNote) }
    const text = asText(a.name, mime, data)
    return { text: text === null ? head : `${head}\n${fenced(text, langOf(a.name))}` }
  }))

  return {
    async start() {
      await syncCommands().catch(e => log.warn('setMyCommands', e.message))
      const me = await api.getMe()
      if (!owners.any()) {
        if (cfg.claimCode) log.info(`the bot has no owner yet: open https://t.me/${me.username}?start=${cfg.claimCode} and press Start`)
        else log.warn('OWNER_IDS is empty: message the bot and the id shows up in the log as rejected')
      }
      poll(me.username)
      // The update helper waits for this to call a new version good, and writes the outcome only after it
      updates.alive()
      scheduleMenu.start()
      releaseTimers.push(setTimeout(restoreQueues, QUEUES_BACK_MS))
      recovery.run().catch(e => log.warn('turn recovery', (e as Error).message))
      background(sweepGoneChats())
      reportUpdate().catch(e => log.warn('update outcome', (e as Error).message))
      releaseTimers.push(setTimeout(() => checkRelease().catch(() => {}), 60_000), setInterval(() => checkRelease().catch(() => {}), 24 * 3600_000))
      return me
    },
    // The firewall went missing or came back: every owner hears it, it decides whether web reading is safe
    sandboxChanged(s: SandboxState) {
      const text = s.state === 'open'
        ? tr(`⚠️ <b>The server's sandbox isn't working:</b> ${esc(s.reason ?? '')}. Reading pages from the server is off. On the VPS: <code>sudo systemctl restart tgcv-firewall</code>, state: /diag.`, `⚠️ <b>Песочница сервера не работает:</b> ${esc(s.reason ?? '')}. Чтение страниц с сервера выключено. На VPS: <code>sudo systemctl restart tgcv-firewall</code>, состояние — /diag.`)
        : tr('✅ <b>The server\'s sandbox works again.</b> Reading pages from the server is on.', '✅ <b>Песочница сервера снова работает.</b> Чтение страниц с сервера включено.')
      for (const id of owners.mainOnly()) api.sendMessage(id, text, HTML).catch(() => {})
    },
    bot,
    liveOf,
    decisions: decisionsMenu,
    companion,
    night,
    messageTopic,
    renameTopic,
    startSurvey,
    surveys,
    retries,
    // What a turn answering a queued message from another topic would run under
    handInFor: (key: string) => handIn.forTurn(key, liveOf(key)),
    settleHandIn: (key: string) => handIn.settle(key, liveOf(key)),
    offers,
    capTurn: async (key: string) => { const l = liveOf(key); l.modeCap = modeCapOf(l.queue) },
    permissionFor: (key: string, tool: string, input: Record<string, unknown>, signal = new AbortController().signal, server = 'device') => {
      const { chatId, topicId } = parseKey(key)
      return makeCanUseTool(chatId, topicId, liveOf(key), { device: 'PC', project: 'p' }, [], false)(tool, input, { signal, mcpServer: { source: 'sdk', name: server } } as never)
    },
    makeWorktree,
    dropWorktree,
    lookAtWorktrees: lookForMergedWorktrees,
    checkDisk,
    syncBranch,
    schedules,
    scheduleTick: () => scheduleMenu.tick(),
    checkExpiry,
    sweepGoneChats,
    openChrome,
    deferTask,
    offerDeleteTopics,
    restoreQueues,
    recoverTurns: recovery.run,
    flights,
    processQueue,
    enqueue,
    deleteTopic,
    dropChat,
    groupLimit,
    async idle() {
      while (inFlight.size) await Promise.all(inFlight)
    },
    async stop() {
      for (const key of [...deferArms.keys()]) disarm(key)
      for (const t of expiryTimers) clearTimeout(t)
      for (const t of diskTimers) clearTimeout(t)
      for (const t of releaseTimers) clearTimeout(t)
      scheduleMenu.stop()
      folderRetry.stop()
      renders.stop()
      clearInterval(boardTimer)
      clearInterval(companionTimer)
      companion.stop()
      voiceTasks.stop()
      // Not stopped: a Stop would kill the commands on the computers, which are the reason to carry on after this
      closing = true
      flights.freeze()
      saveQueues()
      for (const l of live.values()) l.queue.length = 0
      // Files being prepared are no turn yet: no record says their status is there, and nothing would ever take it away
      await Promise.all([...live.values()].map(endPrep))
      await bot.stop()
    },
  }
}
