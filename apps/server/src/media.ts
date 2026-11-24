import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir, availableParallelism } from 'node:os'
import { join, delimiter, dirname } from 'node:path'
import { lang, tr } from './i18n.ts'

// Speech and video on the server: ffmpeg cuts frames and audio, whisper.cpp transcribes.
// Nothing leaves the server; the same code runs on the PC now and on the VPS later
// model: the speech model when it is there; modelPath: where it goes when the bot downloads it
export type MediaConfig = { ffmpeg?: string, ffprobe?: string, whisper?: string, model?: string, modelPath?: string, language?: string, threads: number }

// The speech model the bot downloads: whisper's large-v3-turbo, quantised, good at Russian and English alike
export const MODEL = {
  name: 'ggml-large-v3-turbo-q5_0.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
  size: 574_041_195,
  sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
}

const run = (bin: string, args: string[], timeout = 300_000) => new Promise<string>((resolve, reject) => {
  execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
    if (err) reject(new Error(`${bin.split(/[\\/]/).pop()}: ${String(stderr || err.message).slice(-400)}`))
    else resolve(String(stdout))
  })
})

export function findBin(names: string[]): string | undefined {
  const exts = process.platform === 'win32' ? ['.exe', ''] : ['']
  for (const dir of String(process.env.PATH).split(delimiter)) {
    for (const n of names) for (const e of exts) if (existsSync(join(dir, n + e))) return join(dir, n + e)
  }
  return undefined
}

export function mediaConfig(env = process.env, dataDir: string): MediaConfig {
  const model = env.WHISPER_MODEL ?? join(dataDir, 'models', MODEL.name)
  return {
    modelPath: model,
    ffmpeg: env.FFMPEG_BIN ?? findBin(['ffmpeg']),
    ffprobe: env.FFPROBE_BIN ?? findBin(['ffprobe']),
    whisper: env.WHISPER_BIN ?? findBin(['whisper-cli', 'whisper-cpp']),
    model: existsSync(model) ? model : undefined,
    language: env.VOICE_LANGUAGE,
    // whisper.cpp uses 4 threads by default; on the dev PC 16 threads take a voice note from 12 s to under 6 s
    threads: Number(env.WHISPER_THREADS) || Math.min(availableParallelism(), 16),
  }
}

// Only the model is missing: the one thing the bot can fetch by itself
export const onlyModelMissing = (c: MediaConfig) => !!(c.ffmpeg && c.whisper && !c.model && c.modelPath)

// The speech model, at the user's tap: streamed to a .part file next to its place, checked against its checksum,
// then moved into place. onProgress gets the bytes so far
export async function downloadModel(c: MediaConfig, { fetch = globalThis.fetch, onProgress, model = MODEL }: {
  fetch?: typeof globalThis.fetch, onProgress?: (bytes: number) => void, model?: typeof MODEL,
} = {}) {
  if (!c.modelPath) throw new Error('No place for the speech model (WHISPER_MODEL)')
  mkdirSync(dirname(c.modelPath), { recursive: true })
  const part = c.modelPath + '.part'
  const res = await fetch(model.url, { signal: AbortSignal.timeout(60 * 60_000) })
  if (!res.ok || !res.body) throw new Error(tr(`the download failed: HTTP ${res.status}`, `не скачалось: HTTP ${res.status}`))
  const hash = createHash('sha256')
  const out = createWriteStream(part)
  let done = 0
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk)
      done += chunk.length
      if (!out.write(chunk)) await once(out, 'drain')
      onProgress?.(done)
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
  } catch (e) {
    out.destroy()
    rmSync(part, { force: true })
    throw e
  }
  if (hash.digest('hex') !== model.sha256) {
    rmSync(part, { force: true })
    throw new Error(tr('the downloaded model is damaged (checksum mismatch): try again', 'скачанная модель повреждена (не сошлась контрольная сумма): попробуй ещё раз'))
  }
  renameSync(part, c.modelPath)
  c.model = c.modelPath
}

export const missingForSpeech = (c: MediaConfig) =>
  [!c.ffmpeg && 'ffmpeg', !c.whisper && 'whisper.cpp (whisper-cli)', !c.model && tr('whisper model (WHISPER_MODEL)', 'модель whisper (WHISPER_MODEL)')].filter(Boolean) as string[]

// The language to hear: the bot's own unless pinned. Detecting it (VOICE_LANGUAGE=auto) makes whisper encode the audio
// a second time, which is most of the wait: measured on the 6-core VPS, 25 s against 13 s for an 11 s voice message
export const speechLanguage = (c: Pick<MediaConfig, 'language'>) => c.language || lang()

// Any audio or video → 16 kHz mono wav → whisper.cpp; empty string when there is no speech
// The model learned from films: over the silence at the end of a recording it writes the credits of their subtitles
const MADE_UP_ENDING = /(?:^|(?<=[.!?…,]\s)|\s)(?:(?:спасибо за субтитры|субтитры (?:сделал|сделала|создавал|создала|подготовил|подготовила|делал|делала|предоставил)|subtitles by|dimatorzok)(?:[^.,!?…]|\.(?=\S))*|спасибо за просмотр|продолжение следует|подписывайтесь на канал|thanks for watching)[.!?…]*\s*$/iu

export function cleanTranscript(out: string) {
  // whisper marks silence and noise with [BLANK_AUDIO], (music) and the like
  let text = out.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  for (let was = ''; was !== text;) {
    was = text
    text = text.replace(MADE_UP_ENDING, '').trim()
  }
  return text.replace(/,$/, '')
}

export async function transcribe(file: string, c: MediaConfig): Promise<string> {
  const missing = missingForSpeech(c)
  if (missing.length) throw new Error(tr(`Voice transcription is not set up on the server: missing ${missing.join(', ')}`, `Расшифровка голоса не настроена на сервере: нет ${missing.join(', ')}`))
  const work = mkdtempSync(join(tmpdir(), 'tgcv-voice-'))
  try {
    const wav = join(work, 'speech.wav')
    await run(c.ffmpeg!, ['-y', '-loglevel', 'error', '-i', file, '-ar', '16000', '-ac', '1', wav])
    const out = await run(c.whisper!, ['-m', c.model!, '-f', wav, '-l', speechLanguage(c), '-t', String(c.threads), '-nt', '-np'])
    return cleanTranscript(out)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

// A voice message is not kept as an attachment: it only lives long enough to be transcribed
export async function transcribeData(data: Buffer, c: MediaConfig) {
  const work = mkdtempSync(join(tmpdir(), 'tgcv-voice-in-'))
  try {
    const file = join(work, 'voice.ogg')
    writeFileSync(file, data)
    return await transcribe(file, c)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

// Claude's API refuses images over 8000 px or 5 MB, and a refused image stays in the session for good.
// A picture sent as a file gets a copy at the size Claude looks at anyway (long side 1568 px), never upscaled;
// PNG keeps transparency, JPEG when the PNG comes out too heavy
export async function shrinkImage(file: string, c: MediaConfig, maxBytes: number, max = 1568) {
  if (!c.ffmpeg) throw new Error(tr('needs ffmpeg', 'нужен ffmpeg'))
  const work = mkdtempSync(join(tmpdir(), 'tgcv-image-'))
  const scale = `scale=w='min(${max},iw)':h='min(${max},ih)':force_original_aspect_ratio=decrease`
  try {
    for (const [ext, mime] of [['png', 'image/png'], ['jpg', 'image/jpeg']] as const) {
      const out = join(work, `view.${ext}`)
      await run(c.ffmpeg, ['-y', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-vf', scale, ...(ext === 'jpg' ? ['-q:v', '3'] : []), out])
      const data = readFileSync(out)
      if (data.length <= maxBytes) return { mime, data }
    }
    throw new Error(tr('the image is too heavy even after compression', 'картинка слишком тяжёлая даже после сжатия'))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

// Evenly spaced moments, away from the very first/last frame (often black or blurred)
export function frameTimes(duration: number, maxFrames: number) {
  if (!(duration > 0)) return [0]
  const count = Math.max(1, Math.min(maxFrames, Math.ceil(duration / 2)))
  return Array.from({ length: count }, (_, i) => +((duration * (i + 0.5)) / count).toFixed(2))
}

// How different a frame must be from the one before to count as a change. Measured on real round videos: a hand-held
// phone scores about 0.02 all the time, a turn towards something else 0.05 and up, a hard cut over 0.3
const SCENE_CHANGE = 0.05
// The moving frame itself is often blurred: a little later the picture has settled
const SETTLE_S = 0.2
// However still the video, this many frames cover it
const BASE_FRAMES = 3

export type SceneChange = { t: number, score: number }

// The moments where the picture really changes, strongest first, on top of a few evenly spaced ones. Close ones
// are the same moment: the gap keeps a shaky stretch from taking every frame
export function pickFrames(duration: number, changes: SceneChange[], maxFrames: number) {
  const chosen = frameTimes(duration, BASE_FRAMES)
  const gap = Math.max(1, duration / (maxFrames * 2))
  for (const c of [...changes].sort((a, b) => b.score - a.score)) {
    if (chosen.length >= maxFrames) break
    const t = +Math.min(c.t + SETTLE_S, Math.max(duration - 0.1, 0)).toFixed(2)
    if (chosen.every(x => Math.abs(x - t) >= gap)) chosen.push(t)
  }
  return chosen.sort((a, b) => a - b)
}

async function sceneChanges(file: string, ffmpeg: string): Promise<SceneChange[]> {
  const out = await run(ffmpeg, ['-loglevel', 'error', '-i', file, '-an', '-vf', `scale=320:-2,select='gt(scene,${SCENE_CHANGE})',metadata=print:file=-`, '-f', 'null', '-'])
  const times = [...out.matchAll(/pts_time:([\d.]+)/g)].map(m => Number(m[1]))
  const scores = [...out.matchAll(/scene_score=([\d.]+)/g)].map(m => Number(m[1]))
  return times.map((t, i) => ({ t, score: scores[i] ?? 0 }))
}

// Claude can't watch video: a handful of JPEG stills it can look at instead, taken where something happens
export async function videoFrames(file: string, c: MediaConfig, maxFrames = 12, width = 768) {
  if (!c.ffmpeg || !c.ffprobe) throw new Error('Video needs ffmpeg on the server')
  const duration = parseFloat(await run(c.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).catch(() => '0')) || 0
  const work = mkdtempSync(join(tmpdir(), 'tgcv-frames-'))
  try {
    const frames: { t: number, data: Buffer }[] = []
    const changes = await sceneChanges(file, c.ffmpeg).catch(() => null)
    const times = changes ? pickFrames(duration, changes, maxFrames) : frameTimes(duration, 6)
    for (const [i, t] of times.entries()) {
      const out = join(work, `f${i}.jpg`)
      await run(c.ffmpeg, ['-y', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', out])
      if (existsSync(out)) frames.push({ t, data: readFileSync(out) })
    }
    return { duration, frames }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
