import { parentPort, workerData } from 'node:worker_threads'
import { JSDOM } from 'jsdom'
import { readLottie } from './lottie-file.ts'

// lottie-web draws into a DOM: it gets one of its own here, in a thread of its own, so the server's process never has
// a `window` that would make other libraries think they run in a browser
type Job = { items: { name: string, data: Uint8Array }[], frame: 'first' | 'middle' | 'last' | number }

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
Object.assign(globalThis, { window: dom.window, document: dom.window.document })
// It asks a canvas for a context as it loads; the SVG renderer never draws on one
dom.window.HTMLCanvasElement.prototype.getContext = (() => ({ fillRect() {}, measureText: () => ({ width: 0 }) })) as never
const lottie = (await import('lottie-web/build/player/lottie_svg.js')).default as unknown as {
  loadAnimation(o: object): { goToAndStop(f: number, isFrame: boolean): void, destroy(): void }
}

function draw(name: string, anim: Record<string, unknown>) {
  const box = document.createElement('div')
  try {
    const w = Number(anim.w), h = Number(anim.h)
    const frames = Math.max(1, Math.round(Number(anim.op) - Number(anim.ip ?? 0)))
    const at = frame === 'first' ? 0 : frame === 'middle' ? Math.floor(frames / 2) : frame === 'last' ? frames - 1 : Math.min(Math.max(0, Math.round(frame)), frames - 1)
    document.body.appendChild(box)
    const player = lottie.loadAnimation({ container: box, renderer: 'svg', loop: false, autoplay: false, animationData: anim })
    player.goToAndStop(at, true)
    // A file of its own: its size and namespace, not the player's box styles
    const svg = box.innerHTML.replace(/^<svg ([^>]*?)>/, (_, attrs: string) => {
      const own = attrs.replace(/\s*style="[^"]*"/, '').replace(/width="[^"]*"/, `width="${w}"`).replace(/height="[^"]*"/, `height="${h}"`)
      return `<svg ${/xmlns="/.test(own) ? '' : 'xmlns="http://www.w3.org/2000/svg" '}${own}>`
    })
    player.destroy()
    return { name, svg, frame: at, frames, w, h }
  } finally {
    box.remove()
  }
}

const { items, frame } = workerData as Job
const out = items.flatMap(({ name, data }) => {
  try {
    return readLottie(name, Buffer.from(data)).map(d => {
      try {
        return { ...draw(d.name, d.anim), ...(d.note && { note: d.note }) }
      } catch (e) {
        return { name: d.name, error: (e as Error).message }
      }
    })
  } catch (e) {
    return [{ name, error: (e as Error).message }]
  }
})
parentPort!.postMessage(out)
