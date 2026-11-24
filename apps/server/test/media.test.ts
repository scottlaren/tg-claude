import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { cleanTranscript, frameTimes, pickFrames, mediaConfig, missingForSpeech, shrinkImage, videoFrames, transcribe, downloadModel, onlyModelMissing, MODEL, type MediaConfig, speechLanguage } from '../src/media.ts'
import { setLang } from '../src/i18n.ts'

test('speech is heard in the bot\'s language unless pinned: detecting it costs a second pass', () => {
  assert.equal(speechLanguage({}), 'en')
  assert.equal(speechLanguage({ language: '' }), 'en')
  assert.equal(speechLanguage({ language: 'auto' }), 'auto')
  assert.equal(speechLanguage({ language: 'de' }), 'de')
  setLang('ru')
  assert.equal(speechLanguage({}), 'ru')
  setLang('en')
})

test('frames are spread over the clip, away from its edges', () => {
  assert.deepEqual(frameTimes(0, 6), [0])
  assert.deepEqual(frameTimes(3, 6), [0.75, 2.25])
  assert.deepEqual(frameTimes(60, 6), [5, 15, 25, 35, 45, 55])
})

test('speech reports exactly what is missing', () => {
  const c = mediaConfig({ PATH: '', WHISPER_MODEL: join(tmpdir(), 'no-such-model.bin') }, tmpdir())
  assert.deepEqual(missingForSpeech({ ...c, ffmpeg: undefined }), ['ffmpeg', 'whisper.cpp (whisper-cli)', 'whisper model (WHISPER_MODEL)'])
  return assert.rejects(transcribe('x.ogg', { ...c, ffmpeg: undefined }), /not set up/)
})

// The rest needs ffmpeg on PATH (it is on the dev machine and on the VPS)
const media = mediaConfig(process.env, tmpdir())
const ff = media.ffmpeg && media.ffprobe ? {} : { skip: 'no ffmpeg on PATH' }
const dims = (file: string) => execFileSync(media.ffprobe!, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim()

test('a huge picture becomes a copy Claude can take', ff, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-media-'))
  const big = join(dir, 'big.png')
  execFileSync(media.ffmpeg!, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=9000x3000', '-frames:v', '1', big])
  const v = await shrinkImage(big, media, 3.75 * 1024 * 1024)
  const out = join(dir, v.mime === 'image/png' ? 'v.png' : 'v.jpg')
  writeFileSync(out, v.data)
  assert.equal(dims(out), '1568,523')

  // Small pictures keep their size
  const small = join(dir, 'small.png')
  execFileSync(media.ffmpeg!, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=300x200', '-frames:v', '1', small])
  const s = await shrinkImage(small, media, 3.75 * 1024 * 1024)
  writeFileSync(join(dir, 's.png'), s.data)
  assert.equal(s.mime, 'image/png')
  assert.equal(dims(join(dir, 's.png')), '300,200')
})

test('a video gives evenly spaced stills', ff, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-media-'))
  const clip = join(dir, 'clip.mp4')
  execFileSync(media.ffmpeg!, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=1280x720:rate=10', '-pix_fmt', 'yuv420p', clip])
  const v = await videoFrames(clip, media)
  assert.equal(Math.round(v.duration), 4)
  assert.deepEqual(v.frames.map(f => f.t), [1, 3])
  assert.ok(v.frames.every(f => f.data[0] === 0xff && f.data[1] === 0xd8)) // JPEG
})

test('frames go where the picture changes, over a few that cover the whole video', () => {
  assert.deepEqual(pickFrames(0, [], 12), [0], 'length unknown')
  assert.deepEqual(pickFrames(18, [], 12), [3, 9, 15], 'nothing happens: three will do')
  assert.deepEqual(pickFrames(18, [{ t: 5.8, score: 0.3 }], 12), [3, 6, 9, 15])
  assert.deepEqual(pickFrames(2, [{ t: 1.5, score: 0.5 }], 12), [1], 'close to one already there')
})

test('a shaky stretch can\'t take every frame, and the strongest changes win', () => {
  const shaky = Array.from({ length: 50 }, (_, i) => ({ t: 5 + i / 50, score: 0.06 }))
  assert.equal(pickFrames(60, shaky, 12).filter(t => t >= 5 && t < 6.5).length, 1)
  const many = Array.from({ length: 40 }, (_, i) => ({ t: i * 1.5, score: i === 30 ? 0.9 : 0.1 }))
  const picked = pickFrames(60, many, 12)
  assert.equal(picked.length, 12)
  assert.ok(picked.includes(45.2), 'the hard cut is in')
  assert.deepEqual(picked, [...picked].sort((a, b) => a - b))
})

test('a hard cut in a real clip gets a frame right after it, and each colour is seen', ff, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-scenes-'))
  const clip = join(dir, 'cuts.mp4')
  const inputs = ['red', 'blue', 'green'].flatMap(c => ['-f', 'lavfi', '-i', `color=c=${c}:s=320x240:r=25:d=4`])
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', '[0][1][2]concat=n=3:v=1', clip])
  const v = await videoFrames(clip, { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', threads: 1 })
  assert.deepEqual(v.frames.map(f => f.t), [2, 4.2, 6, 8.2, 10])
  rmSync(dir, { recursive: true, force: true })
})

test('only a missing model is offered for download; missing programs are not', () => {
  const base = { language: 'auto', threads: 4, modelPath: '/data/models/m.bin' }
  assert.equal(onlyModelMissing({ ...base, ffmpeg: 'ffmpeg', whisper: 'whisper-cli' }), true)
  assert.equal(onlyModelMissing({ ...base, ffmpeg: 'ffmpeg', whisper: 'whisper-cli', model: '/data/models/m.bin' }), false)
  assert.equal(onlyModelMissing({ ...base, whisper: 'whisper-cli' }), false)
  assert.equal(onlyModelMissing({ ...base, ffmpeg: 'ffmpeg' }), false)
  assert.equal(mediaConfig({}, '/data').modelPath, join('/data', 'models', MODEL.name))
})

test('the speech model is downloaded, checked against its checksum, and only then put in place', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgcv-model-'))
  const bytes = Buffer.alloc(300_000, 7)
  const model = { ...MODEL, url: 'https://example.test/m.bin', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  const fetch = (async () => new Response(new Blob([bytes]).stream())) as unknown as typeof globalThis.fetch
  const c: MediaConfig = { ffmpeg: 'ffmpeg', whisper: 'whisper-cli', modelPath: join(dir, 'models', 'm.bin'), language: 'auto', threads: 4 }
  const seen: number[] = []
  await downloadModel(c, { fetch, model, onProgress: b => seen.push(b) })
  assert.equal(c.model, c.modelPath)
  assert.deepEqual(readFileSync(c.modelPath!), bytes)
  assert.equal(seen.at(-1), bytes.length)
  assert.ok(!existsSync(c.modelPath + '.part'))

  const bad: MediaConfig = { ...c, model: undefined, modelPath: join(dir, 'models', 'bad.bin') }
  await assert.rejects(downloadModel(bad, { fetch, model: { ...model, sha256: '0'.repeat(64) } }), /checksum/)
  assert.ok(!existsSync(bad.modelPath!) && !existsSync(bad.modelPath + '.part'))
  assert.equal(bad.model, undefined)
  const missing = (async () => new Response('nope', { status: 404 })) as unknown as typeof globalThis.fetch
  await assert.rejects(downloadModel(bad, { fetch: missing, model }), /HTTP 404/)
})

test('the credits whisper makes up over silence go; what was said stays', () => {
  const said = 'то есть там походу нет автоподключения'
  for (const ending of ['Спасибо за субтитры Алексею Дубровскому!', 'Субтитры сделал DimaTorzok', 'Субтитры создавал DimaTorzok.', 'Продолжение следует...', 'Спасибо за просмотр!', 'Thanks for watching!', 'Subtitles by the Amara.org community']) {
    assert.equal(cleanTranscript(`${said}, ${ending}`), said, ending)
    assert.equal(cleanTranscript(`${said}. ${ending}`), `${said}.`, ending)
    assert.equal(cleanTranscript(ending), '', 'a silent recording says nothing')
  }
  assert.equal(cleanTranscript(`${said}. Спасибо за просмотр! Продолжение следует...`), `${said}.`)
  // Only at the end, and never the words in the middle of what was said
  for (const kept of ['Сделай субтитры к видео и отправь мне', 'продолжение следует писать завтра, а пока отдыхай', 'спасибо за субтитры, отличная работа. Теперь сделай монтаж']) {
    assert.equal(cleanTranscript(kept), kept)
  }
  assert.equal(cleanTranscript('[BLANK_AUDIO]  привет (музыка) мир'), 'привет мир')
})
