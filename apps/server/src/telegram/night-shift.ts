import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { nextRun, parseCron } from '../schedule.ts'
import { tr } from '../i18n.ts'
import type { Mode } from '../store.ts'

// A night shift: the user gives a head topic its tasks for the night and goes to sleep. The head works with no one to
// ask, its agents too; the user reads one summary in the morning, and the computers that did the work go to sleep when
// it is done (never off: only a sleeping computer can be woken from afar). One per topic; on disk, so a restart in the night changes nothing

export type Shift = {
  id: string
  key: string
  tasks: string[]
  // Merging and releasing are allowed, when tests are green and the review accepted it. Off: own branches only
  release: boolean
  // Put the computers to sleep when it ends
  sleep: boolean
  // Close the open windows first, for an empty desktop in the morning
  tidy?: boolean
  state: 'offered' | 'running' | 'ended'
  startedAt?: number
  // The morning push, in the user's time zone
  morningAt?: number
  // From then on the shift starts nothing long and sums up: the computers are asleep well before the morning
  wrapAt?: number
  wrapAsked?: boolean
  // What the topic and its chat were before: given back when the shift ends
  before?: { mode?: Mode, night: boolean }
  // Something happened in the shift: a turn of the head or of one of its agents ended
  activeAt?: number
  morningAsked?: boolean
  ending?: { done: boolean }
  // What the head said got done and what is left, for the morning card
  finished?: string[]
  left?: string[]
  // The week's limit used when the shift started, in percent: the card says what the night took of it. weeksAt: of
  // every profile, for a night that went on on another one when a limit ran out (profilesUsed, the first among them)
  weekAt?: number
  weeksAt?: Record<string, number>
  profilesUsed?: string[]
  // Topics it moved to another profile at a limit: they follow their computers' again when it ends
  moved?: string[]
  endedAt?: number
  done?: boolean
  pinged?: boolean
  // Computers another shift asked to put to sleep, or to tidy, while this one still worked on them: the last to finish
  // does it
  offAfter?: string[]
  tidyAfter?: string[]
  // A push was refused, and the user was offered to allow merging and releasing: once a shift
  releaseOffered?: boolean
}

const MORNING = parseCron('0 9 * * *')!
export const morningAfter = (t: number, zone: string) => nextRun(MORNING, t, zone) ?? t + 10 * 3600_000
// One night a shift spent three hours of the small hours rerunning a 50-minute test suite, and the computer went off at
// 7:23. At 5:00 it wraps up
const WRAP = parseCron('0 5 * * *')!
export const WRAP_LABEL = '5:00'
export const wrapAfter = (t: number, zone: string) => nextRun(WRAP, t, zone) ?? t + 6 * 3600_000

export function createShifts(file: string, now = Date.now) {
  let list: Shift[] = []
  try {
    // Shifts saved before 0.17.2 said shutdown: they sleep now
    list = (JSON.parse(readFileSync(file, 'utf8')) as (Shift & { shutdown?: boolean })[]).map(({ shutdown, ...s }) => ({ ...s, sleep: s.sleep ?? !!shutdown }))
  } catch {}
  const save = () => {
    // Ended ones are kept until their morning push has gone, then a day more
    list = list.filter(s => s.state !== 'ended' || !s.pinged || now() - (s.endedAt ?? 0) < 86400_000)
    writeFileSync(`${file}.tmp`, JSON.stringify(list))
    renameSync(`${file}.tmp`, file)
  }
  const change = (id: string, patch: Partial<Shift>) => {
    const s = list.find(x => x.id === id)
    if (!s) return undefined
    Object.assign(s, patch)
    save()
    return s
  }
  return {
    offer(key: string, o: Pick<Shift, 'tasks' | 'release' | 'sleep' | 'tidy'>) {
      // An offer not taken is replaced by the next one
      list = list.filter(s => !(s.key === key && s.state === 'offered'))
      const s: Shift = { id: randomBytes(4).toString('hex'), key, state: 'offered', ...o }
      list.push(s)
      save()
      return s
    },
    get: (id: string) => list.find(s => s.id === id),
    running: (key: string) => list.find(s => s.key === key && s.state === 'running'),
    inChat: (chatId: number) => list.some(s => s.state === 'running' && s.key.startsWith(`${chatId}:`)),
    all: () => [...list],
    change,
    start: (id: string, o: { morningAt: number, wrapAt?: number, before: Shift['before'] }) => change(id, { state: 'running', startedAt: now(), activeAt: now(), ...o }),
    end: (id: string, done: boolean) => change(id, { state: 'ended', endedAt: now(), done, ending: undefined }),
  }
}

export type Shifts = ReturnType<typeof createShifts>

const clock = (t: number, zone: string) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(t)

export function shiftCard(s: Shift, escape: (t: string) => string) {
  return [
    tr('### 🌙 Night shift', '### 🌙 Ночная смена'),
    `**${tr('Tasks', 'Задачи')}:**\n${s.tasks.map((t, i) => `${i + 1}. ${escape(t)}`).join('\n')}`,
    [
      `- ${tr('Everything without questions, helpers allowed', 'Всё без вопросов, помощники разрешены')}`,
      `- ${s.release ? tr('Merge and release: allowed, with green tests and an accepted review', 'Мёрж и выпуск: разрешены, при зелёных тестах и принятой проверке') : tr('Own branches only: nothing merged or released', 'Только свои ветки: ничего не мёржится и не выпускается')}`,
      `- ${tr(`At ${WRAP_LABEL} it wraps up: nothing long is started after that`, `В ${WRAP_LABEL} смена сворачивается: долгого после этого не начинает`)}`,
      `- ${s.tidy ? tr('Before that the open windows close: apps asking to save stay open', 'Перед этим открытые окна закроются: программы, которые просят сохранить, останутся') : tr('Open windows stay as they are', 'Открытые окна останутся как есть')}`,
      `- ${s.sleep ? tr('The computers go to sleep when the work is done: open apps stay as they are, and they can be woken from afar', 'Компьютеры уснут, когда работа будет готова: открытые программы останутся как есть, разбудить можно издалека') : tr('The computers stay on', 'Компьютеры останутся включены')}`,
      `- ${tr('The summary comes as soon as it is done, quietly; a push at 9:00', 'Сводка придёт сразу, как будет готово, без звука; пуш в 9:00')}`,
    ].join('\n'),
  ].join('\n\n')
}

export const startedLine = (s: Shift, zone: string) =>
  tr(`🌙 **The night shift started at ${clock(s.startedAt!, zone)}.** Good night.`, `🌙 **Ночная смена началась в ${clock(s.startedAt!, zone)}.** Спокойной ночи.`)

export const morningPing = (s: Shift, zone: string) => (s.done
  ? tr(`🌙 The night shift ended at ${clock(s.endedAt!, zone)}: the summary is above.`, `🌙 Ночная смена закончилась в ${clock(s.endedAt!, zone)}: сводка выше.`)
  : tr(`🌙 The night shift didn't get through everything: the summary above says what is left.`, `🌙 Ночная смена сделала не всё: в сводке выше сказано, что осталось.`))

// What a head works by through the night
export const shiftRule = (s: Shift) => `

# Night shift
The user is asleep. They gave you this shift and allowed everything in advance; they check it all in the morning. Nobody answers questions until then, so you decide.
Tasks:
${s.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}
- Plan: show the tasks with set_checklist and keep it current.
- Team: split the work among agents (start_agent; \`after\` for an order). Give each a self-contained task.
- Accept each report as the customer would: compare it with the task, run the tests yourself, look at the screenshots. If it isn't right, send it back with message_agent, with concrete corrections.
- Visual work (screens, icons, animation, renders): before you accept it, convene 2–3 reviewers: agents on the same project without a branch, model sonnet, effort low, each in a role (for example designer, player, engineer). Give each the task and the paths of the screenshots or renders. Each answers with a score from 1 to 10 and its remarks. All 8 or more: accepted. Remarks: one more round of fixes, at most two rounds. Still no agreement: leave it in its branch and mark it disputed. Remove reviewers when they have answered.
- Initiative: fix an inconsistency you find when it belongs to these tasks. Anything bigger outside them: don't touch it, write it down.
- Keep a log of each decision you take in the user's place, with its reason.
- Never ask the user: no AskUserQuestion, no surveys, no questions in your answers.
${s.release ? '- Merging and releasing are allowed, by the project\'s own rules, only when the tests are green and the work is accepted (by the review, for visual work). Otherwise leave it in its branch.' : '- Own branches only: never merge, push to a shared branch, tag, release, deploy or publish.'}
- A spent limit moves the work to another of the user's Claude profiles with room left, by itself; with none, it pauses and goes on after the reset. With several profiles, put agents on another one (start_agent profile) to spend them in parallel.
- A command may run 30 minutes at most. Anything longer (a full test run, a long render) starts with run_command background: true; read its log later rather than waiting in a command (no long sleep). Don't run the same long check again without a reason.
- At ${WRAP_LABEL} (the user's clock) you are told to wrap up: from then on start nothing long, finish what is quick, commit and push what is ready, end the shift and write the summary.
- When everything is done: call end_night_shift with done=true and its lists, finished and left, a few words per item (the user's morning card shows them), then write the summary as your final answer, in the user's language: done, released or left in branches, your decisions with their reasons, what you noticed but didn't touch, what isn't done. Put the main pictures in it as ![caption](path), before and after for visual work.
- If you are told it is morning before you are done: stop starting new work, call end_night_shift with done=false and write the summary the same way, saying plainly what is left.
- Never put a computer to sleep, turn it off or restart it yourself: the bot puts it to sleep after your summary, when the user asked for it. Before you end the shift, save what is open (the After Effects project, the Roblox Studio place) through their tools and commit your work.`

// What an agent of a head on a night shift works by
export const agentShiftRule = `

# Night shift
Your head is on a night shift: the user is asleep and allowed everything in advance. Never ask the user anything (no AskUserQuestion, no surveys): decide yourself, and say in your report what you decided and why.`
