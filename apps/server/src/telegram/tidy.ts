import { tr, count } from '../i18n.ts'

// Tidying a computer at a night shift's end, before it sleeps: every app with a window is asked to close, the way a
// click on its cross asks. One holding unsaved work asks «Save?» and stays open: nothing is killed, nothing is lost.
// The agent and what started it stay too: closing the terminal it runs in would end it. A run_command, as sleeping is:
// nothing new on the computers

const WAIT_S = 20
const MARK = 'TIDY '

// Windows: WM_CLOSE to each top-level window a person sees, the desktop and the taskbar aside
const WINDOWS = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$dry = __DRY__
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Tidy {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
  static readonly HashSet<string> SHELL = new HashSet<string> { "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd" };
  public class W { public long id; public int pid; public string title; }
  public static List<W> List() {
    var list = new List<W>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || GetWindowTextLength(h) == 0 || GetWindow(h, 4) != IntPtr.Zero) return true;
      int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4);
      if (cloaked != 0) return true;
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      if (SHELL.Contains(c.ToString())) return true;
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      uint pid; GetWindowThreadProcessId(h, out pid);
      list.Add(new W { id = h.ToInt64(), pid = (int)pid, title = t.ToString() });
      return true;
    }, IntPtr.Zero);
    return list;
  }
  public static void Close(long id) { PostMessage(new IntPtr(id), 0x10, IntPtr.Zero, IntPtr.Zero); }
}
'@
$keep = @{}
$p = $PID
for ($i = 0; $i -lt 30 -and $p; $i++) { $keep[[int]$p] = $true; $p = (Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue).ParentProcessId }
$mine = @([Tidy]::List() | Where-Object { -not $keep[$_.pid] })
if (-not $dry) { foreach ($w in $mine) { [Tidy]::Close($w.id) }; Start-Sleep -Seconds ${WAIT_S} }
$left = if ($dry) { $mine } else { @([Tidy]::List() | Where-Object { -not $keep[$_.pid] }) }
$apps = @($left | ForEach-Object { $n = ''; try { $n = (Get-Process -Id $_.pid -ErrorAction Stop).ProcessName } catch { }; @{ app = $n; title = $_.title } })
'${MARK}' + (@{ closed = $(if ($dry) { 0 } else { $mine.Count - $left.Count }); left = $apps } | ConvertTo-Json -Compress -Depth 4)
`

// macOS: each app in the Dock quits as with ⌘Q, Finder aside. No Apple events: no permission to ask for at night
const MAC = `ObjC.import('AppKit')
const sa = Application.currentApplication()
sa.includeStandardAdditions = true
const dry = __DRY__
const keep = new Set()
let p = $.NSProcessInfo.processInfo.processIdentifier
for (let i = 0; i < 30 && p > 1; i++) {
  keep.add(p)
  p = parseInt(sa.doShellScript('ps -o ppid= -p ' + p).trim(), 10)
}
const regular = () => {
  const all = $.NSWorkspace.sharedWorkspace.runningApplications
  const out = []
  for (let i = 0; i < all.count; i++) {
    const a = all.objectAtIndex(i)
    if (a.activationPolicy !== 0 || ObjC.unwrap(a.bundleIdentifier) === 'com.apple.finder' || keep.has(a.processIdentifier)) continue
    out.push(a)
  }
  return out
}
const mine = regular()
if (!dry) {
  mine.forEach(a => a.terminate)
  delay(${WAIT_S})
}
const left = dry ? mine : regular()
'${MARK}' + JSON.stringify({ closed: dry ? 0 : mine.length - left.length, left: left.map(a => ({ app: ObjC.unwrap(a.localizedName), title: '' })) })
`

export type TidyOs = 'windows' | 'macos' | 'linux'

// The command for run_command. dry: lists what would close, closes nothing
export function tidyCommand(os: TidyOs, dry = false): { program: string, args: string[] } | null {
  if (os === 'windows') {
    const script = WINDOWS.replace('__DRY__', dry ? '$true' : '$false')
    return { program: 'powershell', args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] }
  }
  if (os === 'macos') return { program: 'osascript', args: ['-l', 'JavaScript', '-e', MAC.replace('__DRY__', String(dry))] }
  return null
}

export type TidyResult = { closed: number, left: { app: string, title: string }[] }

export function parseTidy(stdout: string): TidyResult | null {
  // PowerShell may put its progress records in front, on the same line
  const json = stdout.split(/\r?\n/).map(l => l.slice(l.indexOf(MARK))).find(l => l.startsWith(MARK))
  if (!json) return null
  try {
    const r = JSON.parse(json.slice(MARK.length)) as { closed?: unknown, left?: unknown }
    const left = (Array.isArray(r.left) ? r.left : r.left ? [r.left] : []) as { app?: unknown, title?: unknown }[]
    return { closed: Number(r.closed) || 0, left: left.map(w => ({ app: String(w.app ?? ''), title: String(w.title ?? '') })) }
  } catch {
    return null
  }
}

// One line for the chat. An app that stayed open is most likely asking to save
export function tidyLine(device: string, r: TidyResult | null, esc: (s: string) => string) {
  if (!r) return tr(`🧹 <b>${esc(device)}</b>: couldn't tidy the desktop.`, `🧹 <b>${esc(device)}</b>: не получилось убрать рабочий стол.`)
  const closed = count(r.closed, ['window closed', 'windows closed'], ['окно закрыто', 'окна закрыто', 'окон закрыто'])
  const apps = [...new Set(r.left.map(w => w.app || w.title))].slice(0, 8)
  return apps.length
    ? tr(`🧹 <b>${esc(device)}</b> tidied: ${closed}. Still open, most likely asking to save: ${esc(apps.join(', '))}.`, `🧹 <b>${esc(device)}</b> убран: ${closed}. Остались открыты, скорее всего ждут сохранения: ${esc(apps.join(', '))}.`)
    : tr(`🧹 <b>${esc(device)}</b> tidied: ${closed}, the desktop is empty.`, `🧹 <b>${esc(device)}</b> убран: ${closed}, рабочий стол пустой.`)
}
