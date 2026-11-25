import { USER_AGENT } from './net.ts'

// Pictures for a companion chat. A web search gives pages, not files, and an address Claude remembers is as often
// wrong as right; Wikimedia Commons answers a search with files that are free to show, and the server asks it itself
const API = 'https://commons.wikimedia.org/w/api.php'
export const COMMONS_FILES = 'upload.wikimedia.org'
const WIDTH = 1280

type Page = { index?: number, title?: string, imageinfo?: { url?: string, thumburl?: string, mime?: string }[] }

export async function findPictures(query: string, { fetch: doFetch = fetch, max = 5 }: { fetch?: typeof fetch, max?: number } = {}) {
  const url = new URL(API)
  url.search = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '12',
    prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: String(WIDTH),
  }).toString()
  const res = await doFetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': USER_AGENT } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json() as { query?: { pages?: Record<string, Page> } }
  return Object.values(body.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .flatMap(p => {
      const info = p.imageinfo?.[0]
      // Commons adds where the address was taken from; the file is the same without it
      const file = (info?.thumburl ?? info?.url ?? '').replace(/[?#].*$/, '')
      // Photos only, and only from where Commons keeps its files
      if (!/^image\/(jpeg|png)$/.test(info?.mime ?? '') || !file.startsWith(`https://${COMMONS_FILES}/`)) return []
      return [{ title: (p.title ?? '').replace(/^File:/, '').replace(/\.\w+$/, '').replace(/[_\s]+/g, ' ').trim(), url: file }]
    })
    .slice(0, max)
}
