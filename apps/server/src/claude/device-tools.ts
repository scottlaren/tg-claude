import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { toolParams, DEVICE_TOOLS, type DeviceTool, type ToolResult } from '@tgcv/protocol'
import type { OpOutcome } from '../gateway.ts'

// Claude on the server has no built-in tools; everything goes through this in-process MCP
// server, which forwards each call to the device bound to the topic (§9.4)
export const DEVICE_SERVER = 'device'
const PREFIX = `mcp__${DEVICE_SERVER}__`
export const isDeviceTool = (name: string) => name.startsWith(PREFIX) && DEVICE_TOOLS.includes(name.slice(PREFIX.length) as DeviceTool)
export const deviceToolOf = (name: string) => name.slice(PREFIX.length) as DeviceTool

const DESCRIPTIONS: Record<DeviceTool, string> = {
  list_files: 'List files and folders of the project on the user\'s computer.',
  read_file: 'Read a text file of the project. Lines come numbered ("N<tab>text"); the header has the file hash that write_file and edit_file require.',
  write_file: 'Create a new file, or replace a whole existing file (then pass expectedHash from the latest read_file).',
  edit_file: 'Replace exact text in a file. Read it first; oldString must match the file exactly, without line-number prefixes; expectedHash is the hash from the latest read_file or edit.',
  run_command: 'Run a command on the user\'s computer inside the project. Use `command` for a shell script or `program` + `args` to start an executable directly. Returns exit code, stdout and stderr separately. A call waits 30 minutes at most: for anything longer use background: true and read its log later. Do not start desktop apps with it: use open_app.',
  list_apps: 'Desktop apps configured on the user\'s computer (After Effects, Blender, Roblox Studio…), whether each is running, and which MCP server drives it.',
  open_app: 'Start a desktop app (optionally with a file from the project) and wait until its MCP tools can talk to it. Use before calling an app\'s tools when the app is not running.',
  close_app: 'Close a desktop app politely; it may stay open if it asks to save changes. force kills it and loses unsaved work.',
  send_file: 'Send a file from the computer to the user as a separate Telegram message: archives, logs, documents, .blend/.rbxl/.aep files, or an image only when the user asks for it as a separate file (an original, a screenshot in full quality) or must see it before you finish. Arrives as a document, byte for byte, never recompressed. Up to 50 MB, the Telegram limit for bots; for a video to watch, send a light H.264 preview instead of the master. Images and videos that illustrate your answer do NOT go through this tool: put them in your final answer as ![caption](path) so they arrive inside one message with the text.',
  view_image: 'Look at an image on the computer yourself: a render, a screenshot you made, a texture, a design export. You get the picture (large ones scaled down to about 1568 px); the user does not see it — to show them, put it in your answer as ![caption](path). Up to 50 MB.',
  save_attachment: 'Copy a file the user sent in Telegram (a 📎 line with its id) into the project on the computer, e.g. to unpack an archive, open a .blend or use an image as an asset. Attachments live on the server for 24 hours and are not on the computer until saved. Never overwrites: if the name is taken, pick another path.',
  add_mcp_server: 'Ask the user to connect an MCP server on this computer: they always confirm with a button. It stays, for every topic on this computer. A package runner needs an exact version. Its tools come on your next turn, which starts by itself. Use it when a task needs a tool no connected server has; not through the shell or any Claude Code installed there.',
  remove_mcp_server: 'Ask the user to remove an MCP server from this computer: they always confirm with a button.',
  add_project_folder: 'Ask the user to let this project also use another folder next to it (worktrees, shared scripts). The user confirms in Telegram unless the topic is set to do everything without asking; only folders inside the workspace approved on the computer can be added.',
}

type Text = { type: 'text', text: string }
type Image = { type: 'image', data: string, mimeType: string }
type Result = { content: (Text | Image)[], isError?: boolean }
const text = (s: string, isError = false): Result => ({ content: [{ type: 'text', text: s }], ...(isError && { isError }) })

const LINE_MAX = 2000

export function formatOutcome(t: DeviceTool, out: OpOutcome): Result {
  if (!out.ok) return text(`[${out.error.code}] ${out.error.message}`, true)
  switch (t) {
    case 'list_files': {
      const r = out.result as ToolResult['list_files']
      const lines = r.entries.map(e => (e.type === 'dir' ? `${e.path}/` : `${e.path}  (${e.size ?? '?'} B)`))
      return text((lines.join('\n') || '(empty)') + (r.truncated ? '\n…list truncated' : ''))
    }
    case 'read_file': {
      const r = out.result as ToolResult['read_file']
      const last = r.offset + r.lines.length - 1
      const width = String(last).length
      const body = r.lines
        .map((l, i) => `${String(r.offset + i).padStart(width)}\t${l.length > LINE_MAX ? l.slice(0, LINE_MAX) + '…' : l}`)
        .join('\n')
      return text(`hash: ${r.hash} · lines ${r.offset}–${last} of ${r.totalLines}\n${body}`)
    }
    case 'write_file': {
      const r = out.result as ToolResult['write_file']
      return text(`${r.created ? 'Created' : 'Rewritten'}. hash: ${r.hash}`)
    }
    case 'edit_file': {
      const r = out.result as ToolResult['edit_file']
      return text(`Replaced ${r.replacements}. hash: ${r.hash}`)
    }
    case 'run_command': {
      const r = out.result as ToolResult['run_command']
      const status = [
        `exit code: ${r.exitCode ?? 'none'}${r.signal ? ` (${r.signal})` : ''}`,
        `${(r.durationMs / 1000).toFixed(1)} s`,
        r.timedOut && 'TIMED OUT',
        r.cancelled && 'CANCELLED',
        r.truncated && 'output truncated',
      ].filter(Boolean).join(' · ')
      return text([status, r.stdout && `--- stdout ---\n${r.stdout}`, r.stderr && `--- stderr ---\n${r.stderr}`].filter(Boolean).join('\n'))
    }
    case 'list_apps': {
      const r = out.result as ToolResult['list_apps']
      return text(r.apps.map(a => `${a.id} (${a.name}): ${a.running ? 'running' : 'not running'}${a.mcp ? `, MCP ${a.mcp}` : ''}`).join('\n') || 'No apps configured')
    }
    case 'open_app': {
      const r = out.result as ToolResult['open_app']
      const state = r.ready ? 'ready' : 'NOT READY'
      return text(`${r.alreadyRunning ? 'Was already running' : 'Started'}; ${state} after ${(r.waitedMs / 1000).toFixed(0)} s${r.note ? `. ${r.note}` : ''}`)
    }
    case 'close_app': {
      const r = out.result as ToolResult['close_app']
      return text(`${r.closed ? 'Closed' : 'STILL OPEN'}${r.forced ? ' (killed)' : ''}${r.note ? `. ${r.note}` : ''}`)
    }
    case 'send_file': {
      // By now the bot has uploaded it and replaced the payload: Claude only learns it arrived
      const r = out.result as { name: string, size: number }
      return text(`Sent to the user in Telegram: ${r.name} (${Math.max(1, Math.round(r.size / 1024))} KB)`)
    }
    case 'view_image': {
      const r = out.result as ToolResult['view_image']
      return {
        content: [
          { type: 'image' as const, data: r.data, mimeType: r.mime },
          { type: 'text' as const, text: `${r.name} · ${Math.max(1, Math.round(r.size / 1024))} KB` },
        ],
      }
    }
    case 'save_attachment': {
      const r = out.result as ToolResult['save_attachment']
      return text(`Saved to ${r.path} (${Math.max(1, Math.round(r.size / 1024))} KB)`)
    }
    case 'add_mcp_server': {
      const r = out.result as ToolResult['add_mcp_server']
      if (r.status === 'connected') return text(`Connected, ${r.tools} tools. They come on your next turn: stop here, it starts by itself.`)
      return text(`Saved, but ${r.status === 'starting' ? 'still starting' : `it did not start: ${r.error ?? 'no details'}`}. The computer keeps trying; /tools shows how it goes.`, r.status === 'failed')
    }
    case 'remove_mcp_server': return text('Removed. Its tools are gone from your next turn.')
    case 'add_project_folder': {
      const r = out.result as ToolResult['add_project_folder']
      return text(`Added. The project's folders now: ${[r.project.path, ...r.project.extraRoots].map(p => p.replace(/\\/g, '/')).join(', ')}`)
    }
  }
}

export type DeviceCall = (t: DeviceTool, params: Record<string, unknown>) => Promise<OpOutcome>

export function createDeviceServer(call: DeviceCall) {
  return createSdkMcpServer({
    name: DEVICE_SERVER,
    tools: DEVICE_TOOLS.map(t => tool(t, DESCRIPTIONS[t], toolParams[t], async args => formatOutcome(t, await call(t, args)))),
    // Files and commands are used in almost every turn: never hide them behind tool search
    alwaysLoad: true,
  })
}
