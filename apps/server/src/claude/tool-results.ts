import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

// A picture an app's MCP returned (a frame from After Effects, a screenshot from Blender) is kept by the CLI on the
// server, in the session's tool-results folder. Claude then names that file in its answer, and it is not on any computer:
// it is taken from here. Only pictures, and only from that kind of folder of a profile: no other file of the server
export function toolResultImage(path: string, profilesRoot: string): string | null {
  if (!isAbsolute(path)) return null
  const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)
  let file: string
  let root: string
  try {
    file = realpathSync(resolve(path))
    root = realpathSync(resolve(profilesRoot))
  } catch {
    return null
  }
  const rel = relative(norm(root), norm(file))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  // <profile>/projects/<project>/<session>/tool-results/<file>
  const parts = rel.split(sep)
  const ok = parts.length === 6 && parts[1] === 'projects' && parts[4] === 'tool-results' && /^[\w.-]+\.(png|jpe?g|webp|gif)$/i.test(parts[5])
  return ok && existsSync(file) ? file : null
}

export const imageMime = (file: string) => (/\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : /\.gif$/i.test(file) ? 'image/gif' : 'image/jpeg')
