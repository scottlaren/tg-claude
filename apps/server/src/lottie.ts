import { Worker } from 'node:worker_threads'

// A frame of a Lottie animation as an SVG file, drawn by lottie-web, the player Telegram's own clients use on the web, so
// the frame looks as it does in the chat. Any Lottie: TGS stickers and emoji, plain JSON, dotLottie (see lottie-file.ts)
export type LottieFrame = 'first' | 'middle' | 'last' | number
export type LottieSvg = { name: string, svg: string, frame: number, frames: number, w: number, h: number, note?: string } | { name: string, error: string }

// One thread for the batch, ended with it: the player and its DOM leave nothing behind in the server
export function lottieToSvg(items: { name: string, data: Buffer }[], frame: LottieFrame = 'first', timeoutMs = 120_000): Promise<LottieSvg[]> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./lottie-worker.ts', import.meta.url), { workerData: { items, frame } })
    const timer = setTimeout(() => {
      void w.terminate()
      reject(new Error('the conversion took too long'))
    }, timeoutMs)
    w.once('message', (out: LottieSvg[]) => {
      clearTimeout(timer)
      void w.terminate()
      resolve(out)
    })
    w.once('error', e => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

// A name for a file on any computer
export const svgName = (name: string) => `${name.replace(/\.(tgs|json|lottie)$/i, '').replace(/[^\w.() -]/g, '_').slice(0, 80) || 'animation'}.svg`
