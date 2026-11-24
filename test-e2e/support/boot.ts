import { startStack, pairCodeIn, until, sleep, type Stack, type StackOptions } from './stack.ts'

// A running stand with one computer and a topic bound to its first project
export async function boot(language: 'en' | 'ru', projects: string[] = ['alpha'], o: StackOptions & { name?: string } = {}) {
  const s: Stack = await startStack({ language, ...o })
  s.tg.setLang(language)
  await s.startServer()
  const t = Date.now()
  s.send('/pair')
  const m = await s.reply(/install\//, { after: t })
  const agent = await s.pairAgent(o.name ?? 'E2E-PC', pairCodeIn(m)!, projects)
  await sleep(300)
  const thread = await openTopic(s, 'Work', projects[0])
  return { s, agent, thread }
}

export async function openTopic(s: Stack, name: string, project: string, chat = s.CHAT) {
  const t = Date.now()
  s.send(`/topic ${name}`, { chat })
  const picker = await until('a picker', () => s.tg.sent.find(x => x.touched >= t && x.chat.id === chat && x.thread && x.buttons.flat().some(b => b.text === project)))
  await s.tap(picker, new RegExp(`^${project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  await s.reply(/./, { chat, thread: picker.thread, after: t })
  return picker.thread!
}

export async function setMode(s: Stack, thread: number, mode: 'ask' | 'edits' | 'all' | 'read') {
  const t = Date.now()
  s.send('/mode', { thread })
  const card = await until('the mode card', () => s.tg.sent.find(x => x.touched >= t && x.thread === thread && x.buttons.flat().some(b => b.data === `m:${mode}`)))
  await s.tap(card, `m:${mode}`)
}
