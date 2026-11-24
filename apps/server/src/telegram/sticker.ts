import { gunzipSync, gzipSync } from 'node:zlib'
import { tr } from '../i18n.ts'

// An animation in an answer goes as a real sticker when it fits Telegram's rules (core.telegram.org/stickers): a file
// sent anyway would be refused, or arrive as something no client plays. These rules are checked before anything is
// sent, so what doesn't fit says why instead of failing without a word

const SIDE = 512
const GZIPPED_MAX = 64 * 1024
const SECONDS_MAX = 3
// The page says 60; 30 is what exporters also produce and what clients play. If Telegram refuses one, it goes as a file
const FPS = [30, 60]
// Far above anything that fits once gzipped: this is only here to not unpack or parse something enormous
const JSON_MAX = 16 * 1024 * 1024

type Lottie = { w: unknown, h: unknown, fr: unknown, ip: unknown, op: unknown, ddd?: unknown, layers: unknown, assets?: { layers?: unknown }[] }
type Layer = { ty?: unknown, ddd?: unknown, hasMask?: unknown }

export type StickerCheck = { ok: true, tgs: Buffer, name: string } | { ok: false, why: string }

const isLottie = (d: unknown): d is Lottie => {
  const l = d as Lottie | null
  return !!l && typeof l === 'object' && [l.w, l.h, l.fr, l.ip, l.op].every(n => typeof n === 'number') && Array.isArray(l.layers)
}

// Things the rules name that a sticker's player doesn't draw: left in, the sticker shows up with parts missing
function unsupported(l: Lottie) {
  const layers = [l.layers, ...(l.assets ?? []).map(a => a.layers)].flatMap(x => (Array.isArray(x) ? x as Layer[] : []))
  const found = [
    layers.some(x => x.ty === 2) && tr('images', 'картинки'),
    layers.some(x => x.ty === 1) && tr('solids', 'заливки'),
    layers.some(x => x.ty === 5) && tr('text layers', 'текстовые слои'),
    (l.ddd === 1 || layers.some(x => x.ddd === 1)) && tr('3D layers', '3D-слои'),
    layers.some(x => x.hasMask) && tr('masks', 'маски'),
  ].filter(Boolean)
  return found.join(', ')
}

function problems(l: Lottie) {
  const w = l.w as number, h = l.h as number, fr = l.fr as number
  const seconds = ((l.op as number) - (l.ip as number)) / fr
  const features = unsupported(l)
  return [
    (w !== SIDE || h !== SIDE) && tr(`it is ${w}×${h}, a sticker has to be ${SIDE}×${SIDE}`, `размер ${w}×${h}, а стикер должен быть ${SIDE}×${SIDE}`),
    !FPS.includes(fr) && tr(`it runs at ${fr} fps, a sticker needs 30 or 60`, `в нём ${fr} кадров в секунду, а стикеру нужно 30 или 60`),
    !(seconds > 0 && seconds <= SECONDS_MAX) && tr(`it lasts ${Math.round(seconds * 10) / 10} s, a sticker lasts up to ${SECONDS_MAX} s`, `длится ${Math.round(seconds * 10) / 10} с, а стикер не дольше ${SECONDS_MAX} с`),
    features && tr(`it uses what a sticker can't: ${features}`, `в нём есть то, чего стикер не умеет: ${features}`),
  ].filter(Boolean) as string[]
}

const kb = (bytes: number) => Math.ceil(bytes / 1024)
const stem = (name: string) => name.replace(/\.[^.]+$/, '')

export function prepareSticker(name: string, data: Buffer): StickerCheck {
  const tgs = /\.tgs$/i.test(name)
  const notAnimation = { ok: false as const, why: tgs ? tr("it isn't a valid TGS file", 'это не настоящий файл TGS') : tr("it isn't a Lottie animation", 'это не анимация Lottie') }
  let lottie: unknown
  try {
    if (data.length > JSON_MAX) return { ok: false, why: tr('it is too big to be a sticker', 'он слишком большой для стикера') }
    lottie = JSON.parse((tgs ? gunzipSync(data, { maxOutputLength: JSON_MAX }) : data).toString('utf8'))
  } catch {
    return notAnimation
  }
  if (!isLottie(lottie)) return notAnimation
  const wrong = problems(lottie)
  if (wrong.length) return { ok: false, why: wrong.join('; ') }
  const packed = tgs ? data : gzipSync(JSON.stringify(lottie), { level: 9 })
  if (packed.length > GZIPPED_MAX) return { ok: false, why: tr(`it takes ${kb(packed.length)} KB gzipped, a sticker takes up to ${kb(GZIPPED_MAX)} KB`, `в сжатом виде занимает ${kb(packed.length)} КБ, а стикер не больше ${kb(GZIPPED_MAX)} КБ`) }
  return { ok: true, tgs: packed, name: `${stem(name)}.tgs` }
}

// The words under a file that was meant to be a sticker
export const notStickerCaption = (why: string) => tr(`🎞 Sent as a file, not a sticker: ${why}.`, `🎞 Отправлено файлом, а не стикером: ${why}.`)
