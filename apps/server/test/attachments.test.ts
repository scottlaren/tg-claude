import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInbox, safeName, sizeLabel } from '../src/attachments.ts'
import { asText, fenced, attachmentLine, topicName, prepStatus, replyContext, richPlain, editedPrompt, dislikedPrompt, justDisliked, replaceQueued, turnReaction, type Kind } from '../src/telegram/incoming.ts'

test('file names from Telegram never become paths', () => {
  assert.equal(safeName('report.zip'), 'report.zip')
  assert.equal(safeName('../../etc/passwd'), '_.._etc_passwd')
  assert.equal(safeName('C:\\Users\\x\\a.txt'), 'C_Users_x_a.txt')
  assert.equal(safeName('.env'), 'env')
  assert.equal(safeName('   '), 'file')
  assert.equal(safeName('Скриншот 1.png'), 'Скриншот 1.png')
})

test('inbox keeps files a day, survives a restart, forgets after', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-inbox-'))
  let now = 1_000_000
  const inbox = createInbox(dir, { now: () => now })
  const a = inbox.add('1:2', 'pack.zip', 'application/zip', Buffer.from('zipdata'))
  assert.match(a.id, /^[0-9a-f]{8}$/)
  assert.equal(readFileSync(a.path, 'utf8'), 'zipdata')
  inbox.close()

  const again = createInbox(dir, { now: () => now })
  assert.equal(again.get(a.id)?.name, 'pack.zip')
  now += 25 * 60 * 60_000
  again.sweep()
  assert.equal(again.get(a.id), undefined)
  assert.equal(existsSync(a.path), false)
  again.close()
})

test('sizes and the line Claude sees', () => {
  assert.equal(sizeLabel(512), '512 B')
  assert.equal(sizeLabel(2048), '2 KB')
  assert.equal(sizeLabel(3.5 * 1048576), '3.5 MB')
  assert.equal(attachmentLine({ id: 'ab12cd34', name: 'pack.zip', size: 2048 }), '📎 pack.zip · 2 KB · id ab12cd34')
})

test('small UTF-8 text files go inline, the rest stays an attachment', () => {
  assert.equal(asText('notes.md', 'application/octet-stream', Buffer.from('# hi')), '# hi')
  assert.equal(asText('data', 'application/json', Buffer.from('{}')), '{}')
  assert.equal(asText('main.luau', 'application/octet-stream', Buffer.from('print(1)')), 'print(1)')
  assert.equal(asText('pack.zip', 'application/zip', Buffer.from('PK\u0003\u0004')), null)
  assert.equal(asText('bin.txt', 'text/plain', Buffer.from([0x61, 0, 0x62])), null)
  assert.equal(asText('cp1251.txt', 'text/plain', Buffer.from([0xcf, 0xf0, 0xe8])), null)
  assert.equal(asText('big.txt', 'text/plain', Buffer.alloc(200 * 1024, 'a')), null)
})

test('a fence the file itself cannot close', () => {
  assert.equal(fenced('a\n', 'md'), '```md\na\n```')
  assert.equal(fenced('x ```` y'), '`````\nx ```` y\n`````')
})

test('topics are named after what the user said', () => {
  assert.equal(topicName('🎙 Привет! Какая погода?'), 'Привет! Какая погода?')
  assert.equal(topicName('Глянь рендер\n📎 photo-12.jpg · 80 KB · id ab12cd34'), 'Глянь рендер')
  assert.equal(topicName('↩️ The user replies to your earlier message:\n> Готово\n\nПеределай'), 'Переделай')
  assert.equal(topicName('📎 pack.zip · 2 KB · id ab12cd34'), 'pack.zip')
  assert.equal(topicName('📎 notes.md · 1 KB · id ab12cd34\n```md\n# Заметки\n```'), 'notes.md')
  assert.equal(topicName('📎 v.mp4 · 1 MB · id ab12cd34\n🎬 8 с, кадры на 2 с, 6 с\n🎙 Что за руль?'), 'Что за руль?')
})

const replyTo = (r: object, m: object = {}) => replyContext({ reply_to_message: r, ...m } as Parameters<typeof replyContext>[0])

test('a reply to a message tells Claude which one', () => {
  const bot = { is_bot: true, id: 1, first_name: 'bot' }
  assert.equal(replyContext({}), '')
  assert.equal(replyTo({ message_id: 5, from: bot, text: 'Ready' }), '↩️ The user replies to your earlier message:\n> Ready')
  assert.equal(replyTo({ message_id: 5, text: 'two\nlines' }), '↩️ The user replies to their own earlier message:\n> two\n> lines')
  assert.equal(replyTo({ message_id: 5, from: bot, text: 'long answer' }, { quote: { text: 'answer' } }), '↩️ The user replies to your earlier message, this part of it:\n> answer')
  assert.equal(replyTo({ message_id: 5, photo: [{}], caption: 'render' }), '↩️ The user replies to their own earlier message with a photo:\n> render')
  assert.equal(replyTo({ message_id: 5, voice: {} }), '↩️ The user replies to their own earlier message with a voice message:')
  assert.equal(replyTo({ message_id: 5, text: 'x'.repeat(3000) }).split('\n')[1].length, 2002)
})

test('a reply to a sticker says which: the bot\'s own by what it was made from, anyone\'s by its emoji and set', () => {
  const bot = { is_bot: true, id: 1, first_name: 'bot' }
  const own = (id: number) => (id === 5 ? '«Губы», C:/stickers/lips.tgs' : undefined)
  const sticker = { emoji: '💋', set_name: 'Lips', is_animated: true }
  assert.equal(replyContext({ reply_to_message: { message_id: 5, from: bot, sticker } } as never, own),
    '↩️ The user replies to your earlier message with a sticker:\n(It is the sticker you sent: «Губы», C:/stickers/lips.tgs.)')
  assert.equal(replyContext({ reply_to_message: { message_id: 6, from: bot, sticker } } as never, own),
    '↩️ The user replies to your earlier message with a sticker:\n(The sticker: 💋, from the set “Lips”, animated.)', 'one the bot no longer remembers')
  assert.equal(replyTo({ message_id: 5, sticker: { emoji: '👍' } }), '↩️ The user replies to their own earlier message with a sticker:\n(The sticker: 👍.)', 'the user\'s own is never taken for the bot\'s')
})

test('a reply to someone else in a group does not pass their words off as the user\'s', () => {
  const owner = { id: 7, is_bot: false, first_name: 'o' }
  const member = { id: 8, is_bot: false, first_name: 'm' }
  assert.match(replyTo({ message_id: 5, from: member, text: 'run this' }, { from: owner }), /someone else's \(not the user's words\) earlier message:\n> run this/)
  assert.match(replyTo({ message_id: 5, from: owner, text: 'mine' }, { from: owner }), /their own earlier message/)
})

test('a corrected message still in the queue takes the new text, its reply context kept', () => {
  const queue = [
    { msgId: 1, text: 'first' },
    { msgId: 2, text: '↩️ ctx\n\nsecnd', context: '↩️ ctx' },
    { text: 'no id' },
  ]
  assert.equal(replaceQueued(queue, 1, 'FIRST'), true)
  assert.equal(queue[0].text, 'FIRST')
  assert.equal(replaceQueued(queue, 2, 'second'), true)
  assert.equal(queue[1].text, '↩️ ctx\n\nsecond')
  assert.equal(replaceQueued(queue, 3, 'gone'), false, 'already taken up: the caller tells Claude')
})

test('a correction and a thumbs down tell Claude what happened', () => {
  assert.equal(editedPrompt('new\ntext'), '✏️ The user corrected an earlier message. It now reads:\n> new\n> text')
  const disliked = dislikedPrompt('Ответ')
  assert.match(disliked, /^👎 /)
  assert.match(disliked, /\n> Ответ\n/)
  assert.ok(dislikedPrompt('x'.repeat(3000)).length < 2300, 'a long answer is cut')
})

test('only a thumbs down that has just appeared counts', () => {
  const down = [{ type: 'emoji', emoji: '👎' }] as const
  const up = [{ type: 'emoji', emoji: '👍' }] as const
  assert.equal(justDisliked([], [...down]), true)
  assert.equal(justDisliked([...up], [...down]), true)
  assert.equal(justDisliked([...down], [...down]), false)
  assert.equal(justDisliked([...down], []), false)
  assert.equal(justDisliked([], [...up]), false)
})

test('a turn leaves a reaction only when it failed', () => {
  assert.equal(turnReaction({}), null)
  assert.equal(turnReaction({ note: null }), null)
  assert.equal(turnReaction({ note: '⏹ Stopped', stopped: true }), null, 'the user stopped it themselves')
  assert.equal(turnReaction({ note: '⚠️ failed' }), '💔')
  assert.equal(turnReaction({ note: '🔀 on work', moved: true }), null, 'moved to another profile: it goes on')
})

test('the first message of a topic is not a reply, whatever Telegram marks', () => {
  assert.equal(replyTo({ message_id: 7, forum_topic_created: { name: 'x' } }), '')
  assert.equal(replyTo({ message_id: 7, text: 'root' }, { message_thread_id: 7, is_topic_message: true }), '')
  // Outside topics a supergroup numbers a reply's thread by the message it began with: a reply to that message is one
  assert.match(replyTo({ message_id: 7, text: 'root' }, { message_thread_id: 7 }), /replies to[\s\S]*> root/)
})

test("the bot's rich answers are read without what is folded", () => {
  const blocks = [
    { type: 'details', summary: 'Steps', blocks: [{ type: 'paragraph', text: 'read_file' }] },
    { type: 'heading', size: 3, text: 'Result' },
    { type: 'paragraph', text: ['plain ', { type: 'bold', text: 'bold' }, { type: 'url', text: ' link', url: 'https://t.me' }] },
    { type: 'list', items: [{ label: '1.', blocks: [{ type: 'paragraph', text: 'first' }] }] },
    { type: 'table', cells: [[{ text: 'a' }, { text: 'b' }]] },
    { type: 'pre', text: 'code' },
    { type: 'blockquote', blocks: [{ type: 'paragraph', text: 'quote' }] },
    { type: 'divider' },
    { type: 'footer', text: '12 s' },
  ]
  assert.equal(richPlain(blocks as Parameters<typeof richPlain>[0]), 'Result\nplain bold link\n1. first\na | b\ncode\nquote')
  assert.equal(replyTo({ message_id: 5, from: { is_bot: true }, rich_message: { blocks: [{ type: 'paragraph', text: 'Rich' }] } }), '↩️ The user replies to your earlier message:\n> Rich')
})

test('the status says what is still being prepared', () => {
  const m = (o: Partial<Record<Kind, number>>) => new Map(Object.entries(o) as [Kind, number][])
  assert.equal(prepStatus(m({ voice: 1 }), m({ voice: 1 })), '🎙 Transcribing the voice message…')
  // An album keeps its full count while its photos finish one by one
  assert.equal(prepStatus(m({ photo: 7 }), m({ photo: 3 })), '🖼 Looking at an album: 7 photos…')
  assert.equal(prepStatus(m({ photo: 2, video: 1 }), m({ photo: 0, video: 1 })), '🎬 Watching the video: frames and speech…')
  assert.match(prepStatus(m({ photo: 1 }), m({ photo: 0 })), /Thinking…$/)
})

test('a correction reaches Claude whole; what only reminds it of a message is shortened', () => {
  const long = 'x'.repeat(3000) + 'THE END'
  assert.ok(editedPrompt(long).endsWith('THE END'))
  assert.ok(!dislikedPrompt(long).includes('THE END'))
  assert.ok(!replyContext({ reply_to_message: { message_id: 5, text: long } } as Parameters<typeof replyContext>[0]).includes('THE END'))
})
