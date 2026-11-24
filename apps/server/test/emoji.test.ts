import { test } from 'node:test'
import assert from 'node:assert/strict'
import { animateEmoji, animatePayload, APP_EMOJI, appEmoji, CLAUDE_EMOJI, claudeEmoji, plainEmoji, toolStatus, type ClaudeState } from '../src/telegram/emoji.ts'
import { redact } from '../src/telegram/redact.ts'
import { draftMarkdown, finalMarkdown, stepsBlock } from '../src/telegram/render.ts'
import { prepStatus } from '../src/telegram/incoming.ts'

const STATES = Object.keys(CLAUDE_EMOJI) as ClaudeState[]

test('no emoji id reads as a card number: masking would break the link', () => {
  for (const s of STATES) assert.equal(redact(claudeEmoji(s)).text, claudeEmoji(s), s)
})

test('the status follows the tool Claude called', () => {
  const emoji = (tool: string) => toolStatus(tool).match(/emoji-id="(\d+)"/)?.[1]
  const id = (s: ClaudeState) => CLAUDE_EMOJI[s][1]
  assert.equal(emoji('mcp__device__read_file'), id('reading'))
  assert.equal(emoji('WebSearch'), id('reading'))
  assert.equal(emoji('mcp__device__edit_file'), id('editing'))
  assert.equal(emoji('mcp__device__run_command'), id('running'))
  assert.equal(emoji('mcp__team__start_agent'), id('agents'))
  assert.equal(emoji('mcp__Roblox_Studio__execute_luau'), id('running'))
  assert.match(toolStatus('mcp__device__read_file'), /Reading…$/)
})

test('a call to a service shows its icon and name', () => {
  const app = (tool: string, input = {}) => toolStatus(tool, input).match(/emoji-id="(\d+)"/)?.[1]
  assert.equal(app('mcp__figma__use_figma'), APP_EMOJI.figma[1])
  assert.equal(app('mcp__after-effects__see-frame'), APP_EMOJI.afterEffects[1])
  assert.equal(app('mcp__blender__get_objects_summary'), APP_EMOJI.blender[1])
  assert.equal(app('mcp__claude-in-chrome__navigate'), APP_EMOJI.chrome[1])
  assert.match(toolStatus('mcp__figma__use_figma'), /Figma…$/)
  const github = APP_EMOJI.github[1]
  assert.equal(app('mcp__device__run_command', { command: 'git push origin main' }), github)
  assert.equal(app('mcp__device__run_command', { command: 'cd x && gh release list' }), github)
  assert.notEqual(app('mcp__device__run_command', { command: 'git status' }), github)
  assert.notEqual(app('mcp__device__run_command', { command: 'npm run highlight' }), github)
  assert.equal(app('WebFetch', { url: 'https://github.com/a/b' }), github)
  assert.notEqual(app('WebFetch', { url: 'https://example.com/github.com/' }), github)
})

test('masking leaves the id of a custom emoji alone, and it stays out of animateEmoji', () => {
  for (const app of Object.keys(APP_EMOJI) as (keyof typeof APP_EMOJI)[]) {
    assert.equal(redact(appEmoji(app)).text, appEmoji(app))
    assert.equal(animateEmoji(appEmoji(app)), appEmoji(app))
  }
  assert.match(redact('карта 4242 4242 4242 4242').text, /•••• 4242/)
})

test('a plain message shows the plain emoji, not the link', () => {
  assert.equal(plainEmoji(`${claudeEmoji('done')} Готово`), '🏁 Готово')
  assert.equal(plainEmoji('![кадр](tg://photo?id=m1)'), '![кадр](tg://photo?id=m1)', 'pictures are not emoji')
})

test('drafts carry the status with its emoji, thinking by default', () => {
  assert.ok(!claudeEmoji('thinking').includes('tg://'), 'Telegram shows a Markdown link inside tg-thinking as text')
  assert.ok(draftMarkdown({ steps: [], text: '', status: '' }).includes(`<tg-thinking>${claudeEmoji('thinking')} Thinking…</tg-thinking>`))
  assert.ok(prepStatus(new Map(), new Map()).includes(claudeEmoji('thinking')))
})

test('the steps of a finished answer end with the flag, of a stopped or failed one without it', () => {
  assert.ok(stepsBlock(['a'], 1000).includes(claudeEmoji('done')))
  assert.ok(finalMarkdown({ text: 'x', steps: ['a'] }).includes(claudeEmoji('done')))
  const stopped = finalMarkdown({ text: 'x', steps: ['a'], note: '⏹ Stopped' })
  assert.ok(!stopped.includes(claudeEmoji('done')))
  assert.ok(stopped.includes('🔧'))
})

const CLOCK = '<tg-emoji emoji-id="5413704112220949842">⏰</tg-emoji>'

test('ordinary emoji in a text become animated; ones the pack lacks stay', () => {
  assert.equal(animateEmoji('⏰ <b>Задача</b>'), `${CLOCK} <b>Задача</b>`)
  assert.equal(animateEmoji('🛑 внимание'), '🛑 внимание')
  assert.equal(animateEmoji('© 2026 ® ™'), '© 2026 ® ™', 'symbols of plain text are not emoji')
})

test('emoji the bot leans on get a close stand-in, and notifications still show the original', () => {
  const warning = animateEmoji('⚠️ внимание')
  assert.match(warning, /^<tg-emoji emoji-id="\d+">⚠️<\/tg-emoji> внимание$/)
  assert.equal(plainEmoji(warning), '⚠️ внимание')
  assert.ok(animateEmoji('🕐').startsWith('<tg-emoji emoji-id="5413704112220949842">🕐'), 'the clock stands in as ⏰')
  for (const e of ['⚠️', '🗑', '⏹', '🖥', '🌐', '📡', '🟢', '🕐', '🔁', '⬆️', '▶️', '⏸', '🎧', '🔧', '🔌']) {
    assert.ok(animateEmoji(e).startsWith('<tg-emoji'), `${e} has a stand-in the pack really holds`)
  }
  assert.equal(animateEmoji('⚪️ x'), '⚪️ x', 'a white circle stays one: no heart stands in for it')
  assert.equal(animateEmoji('нет эмодзи, 123 # *'), 'нет эмодзи, 123 # *')
  assert.ok(animateEmoji('☁️ x').includes('☁️</tg-emoji>'), 'keeps the variation selector the text had')
})

test('code, tags and links keep their emoji as written', () => {
  for (const text of [
    '`⏰`',
    '```js\nconst a = "⏰"\n```',
    '```\nне закрыто ⏰',
    '<code>⏰</code>',
    '<pre>⏰</pre>',
    '<a href="https://t.me/⏰">x</a>',
    '[⏰ ссылка](https://t.me)',
    '![⏰](tg://photo?id=m1)',
    '<tg-button type="callback_data" data="x">⏰</tg-button>',
    claudeEmoji('done'),
  ]) assert.equal(animateEmoji(text), text)
  assert.equal(animateEmoji('`a` ⏰ `b`'), `\`a\` ${CLOCK} \`b\``)
})

test('a text takes at most 50 of them', () => {
  const out = animateEmoji('⏰ '.repeat(60))
  assert.equal(out.match(/<tg-emoji/g)?.length, 50)
  assert.ok(out.endsWith('⏰ '))
})

test('only messages that can carry them change on the way to Telegram', () => {
  assert.equal(animatePayload('sendMessage', { text: '⏰', parse_mode: 'HTML' }).text, CLOCK)
  assert.equal(animatePayload('editMessageText', { text: '⏰', parse_mode: 'HTML' }).text, CLOCK)
  assert.deepEqual(animatePayload('sendMessage', { text: '⏰' }), { text: '⏰' }, 'plain text would show the tag')
  assert.deepEqual(animatePayload('sendPhoto', { caption: '⏰' }), { caption: '⏰' })
  for (const m of ['sendRichMessage', 'sendRichMessageDraft']) {
    const media = [{ id: 'm1' }]
    const out = animatePayload(m, { chat_id: 1, rich_message: { markdown: '⏰', media } }) as { rich_message: { markdown: string, media: unknown } }
    assert.equal(out.rich_message.markdown, CLOCK)
    assert.equal(out.rich_message.media, media, 'files go along untouched')
  }
})

test('the fallback to plain text gets the ordinary emoji back, and the readable time', () => {
  assert.equal(plainEmoji('<tg-time unix="1" format="r">через 1 ч</tg-time>'), 'через 1 ч')
  assert.equal(plainEmoji(animateEmoji('⏰ готово')), '⏰ готово')
})

test('an edited rich message keeps its animated emoji', () => {
  const out = animatePayload('editMessageText', { chat_id: 1, message_id: 2, rich_message: { markdown: '⏰' } }) as { rich_message: { markdown: string } }
  assert.equal(out.rich_message.markdown, CLOCK)
})
