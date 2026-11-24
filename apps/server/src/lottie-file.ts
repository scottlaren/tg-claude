import { gunzipSync } from 'node:zlib'
import { isZip, unzip } from './zip.ts'

// Every way a Lottie animation travels, told apart by its bytes, not its name: TGS (gzipped JSON, Telegram's stickers
// and emoji), plain JSON (Bodymovin), and dotLottie (a zip of one or more animations and their images; v1 keeps them
// in animations/ and images/, v2 in a/ and i/)
export type LottieDoc = { name: string, anim: Record<string, unknown>, note?: string }

const LIMITS = { files: 2000, bytes: 200 * 1024 * 1024 }
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }

export const lottieBase = (name: string) => name.replace(/\.(tgs|json|lottie)$/i, '').replace(/\.lottie$/i, '') || 'animation'

export function readLottie(name: string, data: Buffer): LottieDoc[] {
  const base = lottieBase(name)
  if (data[0] === 0x1f && data[1] === 0x8b) return [doc(base, parse(gunzipSync(data)))]
  if (isZip(data)) return dotLottie(base, data)
  if (/^\s*\{/.test(data.subarray(0, 64).toString('utf8').replace(/^﻿/, ''))) return [doc(base, parse(data))]
  throw new Error('not a Lottie file (TGS, JSON or .lottie)')
}

// A Lottie file the user sends, told in one line instead of its JSON in the prompt; null for anything else
export function lottieSummary(name: string, data: Buffer) {
  if (!/\.(tgs|json|lottie)$/i.test(name)) return null
  try {
    const docs = readLottie(name, data)
    const one = (d: LottieDoc) => `${d.anim.w}×${d.anim.h}, ${Math.round(Number(d.anim.op) - Number(d.anim.ip ?? 0))} frames at ${d.anim.fr} fps`
    return `[A Lottie animation${docs.length > 1 ? `s: ${docs.map(d => `${d.name} ${one(d)}`).join('; ')}` : `: ${one(docs[0])}`}. lottie_to_svg turns its frames into SVG files.]`
  } catch {
    return null
  }
}

function dotLottie(base: string, data: Buffer): LottieDoc[] {
  const files = new Map(unzip(data, LIMITS).map(f => [f.path, f.data]))
  const manifest = files.has('manifest.json') ? parse(files.get('manifest.json')!) as { animations?: { id?: string }[] } : {}
  const path = (id: string) => [`animations/${id}.json`, `a/${id}.json`].find(p => files.has(p))
  let ids = (manifest.animations ?? []).map(a => String(a.id ?? '')).filter(id => path(id))
  if (!ids.length) ids = [...files.keys()].flatMap(p => /^(?:animations|a)\/([^/]+)\.json$/.exec(p)?.[1] ?? [])
  if (!ids.length) throw new Error('a .lottie with no animation in it')
  return ids.map(id => {
    const anim = parse(files.get(path(id)!)!)
    inlineImages(anim, files)
    return doc(ids.length > 1 ? `${base}-${id}` : base, anim)
  })
}

// Images the archive carries go into the animation itself, as lottie-web takes them: it can't open the archive
function inlineImages(anim: Record<string, unknown>, files: Map<string, Buffer>) {
  for (const a of (anim.assets as { u?: string, p?: string, e?: number }[] | undefined) ?? []) {
    if (!a.p || a.e === 1 || a.p.startsWith('data:')) continue
    const dir = (a.u ?? '').replace(/^\/+/, '')
    const found = [`${dir}${a.p}`, `images/${a.p}`, `i/${a.p}`].find(p => files.has(p))
    if (!found) continue
    const ext = found.split('.').pop()!.toLowerCase()
    Object.assign(a, { u: '', p: `data:${MIME[ext] ?? 'image/png'};base64,${files.get(found)!.toString('base64')}`, e: 1 })
  }
}

function doc(name: string, anim: Record<string, unknown>): LottieDoc {
  if (!anim || typeof anim.op !== 'number' || !Array.isArray(anim.layers)) throw new Error('not a Lottie animation')
  const outside = ((anim.assets as { p?: string, e?: number }[] | undefined) ?? []).filter(a => a.p && a.e !== 1 && !a.p.startsWith('data:')).length
  return { name, anim, ...(outside && { note: `${outside} image(s) live outside the file and are left out` }) }
}

function parse(b: Buffer) {
  try {
    return JSON.parse(b.toString('utf8').replace(/^﻿/, ''))
  } catch {
    throw new Error('not a Lottie animation (broken JSON)')
  }
}
