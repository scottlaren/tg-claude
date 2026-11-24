// Putting a computer to sleep, or turning it off, at a night shift's end or at the user's tap: a minute after the
// order so the summary is out and the links settle, from a process of its own: the command returns at once

// Windows' own suspend, not rundll32's (which hibernates when hibernation is on). It takes the shutdown privilege,
// which every user has but no process holds switched on: without it the call is logged and nothing happens. The outcome
// goes to %TEMP%\tgcv-sleep.log, written when the computer wakes
const WINDOWS = `Start-Sleep 60
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Nap {
  [StructLayout(LayoutKind.Sequential, Pack = 4)] struct TP { public int Count; public long Luid; public int Attr; }
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool LookupPrivilegeValue(string system, string name, out long luid);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool none, ref TP state, int len, IntPtr prev, IntPtr ret);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("powrprof.dll", SetLastError = true)] static extern bool SetSuspendState(bool hibernate, bool force, bool noWake);
  public static string Go(bool dry) {
    IntPtr t;
    if (!OpenProcessToken(GetCurrentProcess(), 0x28, out t)) return "token " + Marshal.GetLastWin32Error();
    var tp = new TP { Count = 1, Attr = 2 };
    if (!LookupPrivilegeValue(null, "SeShutdownPrivilege", out tp.Luid)) return "lookup " + Marshal.GetLastWin32Error();
    AdjustTokenPrivileges(t, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
    int e = Marshal.GetLastWin32Error();
    if (e != 0) return "privilege " + e;
    if (dry) return "ready";
    return SetSuspendState(false, false, false) ? "slept" : "suspend " + Marshal.GetLastWin32Error();
  }
}
'@
$r = [Nap]::Go(__DRY__)
"$(Get-Date -Format o) $r" | Out-File -Append -Encoding utf8 (Join-Path $env:TEMP 'tgcv-sleep.log')
$r`

const encoded = (script: string) => Buffer.from(script, 'utf16le').toString('base64')

export type SleepOs = 'windows' | 'macos' | 'linux'

// dry: Windows only, everything but the sleep itself and with no minute's wait, answering «ready»: for tests on a real computer
export function sleepCommand(os: SleepOs, dry = false): { program: string, args: string[] } | null {
  if (os === 'windows') {
    const script = WINDOWS.replace('__DRY__', dry ? '$true' : '$false')
    if (dry) return { program: 'powershell', args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(script.replace('Start-Sleep 60\n', ''))] }
    return { program: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', `Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded(script)}'`] }
  }
  if (os === 'macos') return { program: 'sh', args: ['-c', 'nohup sh -c "sleep 60; pmset sleepnow" >/dev/null 2>&1 &'] }
  if (os === 'linux') return { program: 'sh', args: ['-c', 'nohup sh -c "sleep 60; systemctl suspend" >/dev/null 2>&1 &'] }
  return null
}

// Turning it off: only ever the user's own choice, by a button. Windows ends what is still open itself (/f, which a
// delay implies anyway): an app asking to save would otherwise hold the computer on all night. A Mac asks System Events,
// which macOS lets an app do only after the user allowed it once
export function offCommand(os: SleepOs): { program: string, args: string[] } | null {
  if (os === 'windows') return { program: 'shutdown', args: ['/s', '/f', '/t', '60'] }
  if (os === 'macos') return { program: 'sh', args: ['-c', `nohup sh -c "sleep 60; osascript -e 'tell application \\"System Events\\" to shut down'" >/dev/null 2>&1 &`] }
  if (os === 'linux') return { program: 'sh', args: ['-c', 'nohup sh -c "sleep 60; systemctl poweroff" >/dev/null 2>&1 &'] }
  return null
}

export type PowerHow = 'sleep' | 'off'
export const powerCommand = (os: SleepOs, how: PowerHow) => (how === 'off' ? offCommand(os) : sleepCommand(os))
