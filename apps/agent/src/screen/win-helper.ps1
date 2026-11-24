# Screen helper for Windows: screenshots, windows, mouse, keyboard, clipboard and UI Automation, for Claude's
# screen tool. One process lives while a task uses the screen; it reads one JSON request per line on stdin and
# writes one JSON answer per line on stdout. C# 5 only: Windows PowerShell 5.1 compiles it. Plain ASCII.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -ReferencedAssemblies System.Drawing, System.Windows.Forms, UIAutomationClient, UIAutomationTypes, WindowsBase -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

public static class Scr {
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
  [DllImport("user32.dll")] static extern short VkKeyScan(char c);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO i);
  [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
  [DllImport("user32.dll")] static extern bool SetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplayDevices(string dev, int i, ref DISPLAY_DEVICE d, int f);

  delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint size, time; }
  [StructLayout(LayoutKind.Sequential)] struct WINDOWPLACEMENT { public int length, flags, showCmd; public POINT min, max; public RECT normal; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct DISPLAY_DEVICE {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string name;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string text;
    public int flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string id;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string key;
  }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }

  public static void Init() {
    // Per-monitor aware: every coordinate here is a real pixel, whatever the display scaling
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
  }

  public static int[] ScreenSize() { return new int[] { GetSystemMetrics(0), GetSystemMetrics(1) }; }

  public static int[] Cursor() { POINT p; GetCursorPos(out p); return new int[] { p.X, p.Y }; }

  // --- windows ---------------------------------------------------------------------------------
  public class Win { public long id; public string title; public string app; public int x, y, w, h; public bool minimized, focused; }

  static RECT Bounds(IntPtr h) {
    RECT r;
    // The frame as drawn, without the invisible resize borders GetWindowRect counts
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) r = new RECT();
    return r;
  }

  public static List<Win> Windows() {
    var list = new List<Win>();
    var fg = GetForegroundWindow();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || GetWindowTextLength(h) == 0 || GetWindow(h, 4) != IntPtr.Zero) return true;
      int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4);
      if (cloaked != 0) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      uint pid; GetWindowThreadProcessId(h, out pid);
      string app = "";
      try { app = Process.GetProcessById((int)pid).ProcessName; } catch { }
      var r = Bounds(h);
      if (r.R - r.L < 40 || r.B - r.T < 30) { if (!IsIconic(h)) return true; }
      list.Add(new Win { id = h.ToInt64(), title = sb.ToString(), app = app, x = r.L, y = r.T, w = r.R - r.L, h = r.B - r.T, minimized = IsIconic(h), focused = h == fg });
      return true;
    }, IntPtr.Zero);
    return list;
  }

  public static int[] WindowRect(long id) { var r = Bounds(new IntPtr(id)); return new int[] { r.L, r.T, r.R - r.L, r.B - r.T }; }

  public static bool Focus(long id) {
    var h = new IntPtr(id);
    if (IsIconic(h)) ShowWindow(h, 9);
    uint pid;
    var mine = GetCurrentThreadId();
    var theirs = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    // Windows lets a process take the foreground only from the one that has it: join its input for a moment
    AttachThreadInput(mine, theirs, true);
    BringWindowToTop(h);
    var ok = SetForegroundWindow(h);
    AttachThreadInput(mine, theirs, false);
    Thread.Sleep(120);
    return ok || GetForegroundWindow() == h;
  }

  public static long Foreground() { return GetForegroundWindow().ToInt64(); }

  // Milliseconds since the last input of anyone, Claude's own included
  public static long Idle() {
    var i = new LASTINPUTINFO(); i.size = 8;
    GetLastInputInfo(ref i);
    return unchecked((uint)Environment.TickCount - i.time);
  }

  // A virtual display (Virtual Display Driver, IddSampleDriver, usbmmidd, Parsec): null with none, { 0 } while it is
  // off, { 1, x, y, w, h } on
  public static int[] VirtualMonitor() {
    int[] found = null;
    for (int i = 0; ; i++) {
      var d = new DISPLAY_DEVICE(); d.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
      if (!EnumDisplayDevices(null, i, ref d, 0)) break;
      var what = (d.text + " " + d.id).ToLowerInvariant();
      if (!(what.Contains("virtual display") || what.Contains("mttvdd") || what.Contains("iddsample") || what.Contains("usbmmidd") || what.Contains("parsec"))) continue;
      if ((d.flags & 1) == 0) { if (found == null) found = new int[] { 0 }; continue; }
      foreach (var s in System.Windows.Forms.Screen.AllScreens)
        if (s.DeviceName == d.name) return new int[] { 1, s.Bounds.X, s.Bounds.Y, s.Bounds.Width, s.Bounds.Height };
    }
    return found;
  }

  // Moves a window to x, y (shrunk to fit w, h) without bringing it forward, restoring it if minimized; answers where
  // it was, to go back with Unpark
  public static int[] Park(long id, int x, int y, int w, int h) {
    var hw = new IntPtr(id);
    var p = new WINDOWPLACEMENT(); p.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
    GetWindowPlacement(hw, ref p);
    var was = new int[] { p.showCmd, p.normal.L, p.normal.T, p.normal.R, p.normal.B };
    int pw = Math.Min(p.normal.R - p.normal.L, w - 40), ph = Math.Min(p.normal.B - p.normal.T, h - 40);
    p.normal = new RECT { L = x + 20, T = y + 20, R = x + 20 + pw, B = y + 20 + ph };
    p.showCmd = 4; p.flags = 0;
    SetWindowPlacement(hw, ref p);
    return was;
  }

  public static void Unpark(long id, int[] was) {
    var hw = new IntPtr(id);
    var p = new WINDOWPLACEMENT(); p.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
    GetWindowPlacement(hw, ref p);
    p.normal = new RECT { L = was[1], T = was[2], R = was[3], B = was[4] };
    // Maximized or minimized as it was; a normal one comes back without taking the user's keyboard
    p.showCmd = was[0] == 3 ? 3 : was[0] == 2 ? 7 : 4; p.flags = 0;
    SetWindowPlacement(hw, ref p);
  }

  // --- screenshots -------------------------------------------------------------------------------
  static bool Blank(Bitmap b) {
    int c0 = b.GetPixel(b.Width / 2, b.Height / 2).ToArgb();
    for (int j = 1; j < 8; j++) for (int i = 1; i < 8; i++) if (b.GetPixel(b.Width * i / 8, b.Height * j / 8).ToArgb() != c0) return false;
    return true;
  }

  // The pixels of x, y, w, h on the screen. With a window: what it draws itself, so another window on top of it, or the
  // user's work, never gets in; a window that won't draw itself (blank) is copied from the screen instead
  static Bitmap Grab(long id, int x, int y, int w, int h) {
    var bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb);
    var hw = new IntPtr(id);
    RECT wr;
    if (id != 0 && !IsIconic(hw) && GetWindowRect(hw, out wr) && wr.R > wr.L && wr.B > wr.T) {
      using (var full = new Bitmap(wr.R - wr.L, wr.B - wr.T, PixelFormat.Format32bppRgb)) {
        bool ok;
        using (var g = Graphics.FromImage(full)) { var dc = g.GetHdc(); ok = PrintWindow(hw, dc, 2); g.ReleaseHdc(dc); }
        if (ok && !Blank(full)) {
          using (var g = Graphics.FromImage(bmp)) {
            g.Clear(Color.Black);
            g.DrawImage(full, new Rectangle(0, 0, w, h), new Rectangle(x - wr.L, y - wr.T, w, h), GraphicsUnit.Pixel);
          }
          return bmp;
        }
      }
    }
    using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(x, y, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
    return bmp;
  }

  // A region as JPEG, scaled to fit maxW x maxH; scale: output pixels per screen pixel
  public static object[] Capture(long id, int x, int y, int w, int h, int maxW, int maxH, int quality) {
    using (var src = Grab(id, x, y, w, h)) {
      double scale = Math.Min(1.0, Math.Min((double)maxW / w, (double)maxH / h));
      int ow = Math.Max(1, (int)Math.Round(w * scale)), oh = Math.Max(1, (int)Math.Round(h * scale));
      using (var dst = new Bitmap(ow, oh, PixelFormat.Format24bppRgb)) {
        using (var g = Graphics.FromImage(dst)) {
          g.InterpolationMode = InterpolationMode.HighQualityBicubic;
          g.PixelOffsetMode = PixelOffsetMode.HighQuality;
          g.DrawImage(src, 0, 0, ow, oh);
        }
        var codec = Array.Find(ImageCodecInfo.GetImageEncoders(), c => c.FormatID == ImageFormat.Jpeg.Guid);
        var ps = new EncoderParameters(1);
        ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality);
        using (var ms = new MemoryStream()) {
          dst.Save(ms, codec, ps);
          return new object[] { Convert.ToBase64String(ms.ToArray()), ow, oh, scale };
        }
      }
    }
  }

  // A small grey thumbnail's fingerprint: equal twice in a row means the screen has settled
  public static string Fingerprint(long id, int x, int y, int w, int h) {
    using (var src = Grab(id, x, y, w, h)) {
      using (var t = new Bitmap(src, new Size(48, 32))) {
        var sb = new StringBuilder();
        for (int j = 0; j < 32; j++) for (int i = 0; i < 48; i++) { var c = t.GetPixel(i, j); sb.Append((char)('a' + (c.R + c.G + c.B) / 3 / 16)); }
        return sb.ToString();
      }
    }
  }

  // --- mouse -------------------------------------------------------------------------------------
  const uint MOVE = 1, LDOWN = 2, LUP = 4, RDOWN = 8, RUP = 16, MDOWN = 32, MUP = 64, WHEEL = 0x800, HWHEEL = 0x1000;

  static void Mouse(uint flags, uint data) {
    var i = new INPUT[1];
    i[0].type = 0; i[0].u.mi.flags = flags; i[0].u.mi.data = data;
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void MoveTo(int x, int y) { SetCursorPos(x, y); Thread.Sleep(15); }

  public static void Click(int x, int y, string button, int count) {
    MoveTo(x, y);
    uint d = button == "right" ? RDOWN : button == "middle" ? MDOWN : LDOWN;
    uint u = button == "right" ? RUP : button == "middle" ? MUP : LUP;
    for (int n = 0; n < count; n++) { Mouse(d, 0); Thread.Sleep(20); Mouse(u, 0); Thread.Sleep(60); }
  }

  public static void Drag(int x1, int y1, int x2, int y2) {
    MoveTo(x1, y1);
    Mouse(LDOWN, 0);
    Thread.Sleep(60);
    for (int s = 1; s <= 20; s++) { SetCursorPos(x1 + (x2 - x1) * s / 20, y1 + (y2 - y1) * s / 20); Thread.Sleep(12); }
    Thread.Sleep(60);
    Mouse(LUP, 0);
  }

  public static void Scroll(int x, int y, int dx, int dy) {
    MoveTo(x, y);
    // One notch is 120; a positive vertical one scrolls up
    if (dy != 0) Mouse(WHEEL, unchecked((uint)(-dy * 120)));
    if (dx != 0) Mouse(HWHEEL, unchecked((uint)(dx * 120)));
  }

  // --- keyboard ----------------------------------------------------------------------------------
  static void Key(ushort vk, bool up, bool extended) {
    var i = new INPUT[1];
    i[0].type = 1; i[0].u.ki.vk = vk; i[0].u.ki.scan = (ushort)MapVirtualKey(vk, 0);
    i[0].u.ki.flags = (up ? 2u : 0u) | (extended ? 1u : 0u);
    SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
  }

  // Any text, any layout: each character goes as itself, not as the key that makes it here
  public static void Type(string text) {
    foreach (char ch in text) {
      if (ch == '\r') continue;
      if (ch == '\n') { Key(0x0D, false, false); Key(0x0D, true, false); Thread.Sleep(8); continue; }
      var i = new INPUT[2];
      i[0].type = 1; i[0].u.ki.scan = ch; i[0].u.ki.flags = 4;
      i[1].type = 1; i[1].u.ki.scan = ch; i[1].u.ki.flags = 4 | 2;
      SendInput(2, i, Marshal.SizeOf(typeof(INPUT)));
      Thread.Sleep(4);
    }
  }

  static readonly Dictionary<string, ushort> VK = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase) {
    {"ctrl",0x11},{"control",0x11},{"alt",0x12},{"shift",0x10},{"win",0x5B},{"cmd",0x11},{"super",0x5B},
    {"enter",0x0D},{"return",0x0D},{"tab",0x09},{"esc",0x1B},{"escape",0x1B},{"space",0x20},{"backspace",0x08},{"delete",0x2E},{"del",0x2E},{"insert",0x2D},
    {"home",0x24},{"end",0x23},{"pageup",0x21},{"pagedown",0x22},{"up",0x26},{"down",0x28},{"left",0x25},{"right",0x27},
    {"f1",0x70},{"f2",0x71},{"f3",0x72},{"f4",0x73},{"f5",0x74},{"f6",0x75},{"f7",0x76},{"f8",0x77},{"f9",0x78},{"f10",0x79},{"f11",0x7A},{"f12",0x7B},
    {"printscreen",0x2C},{"capslock",0x14},{"menu",0x5D}
  };
  static readonly HashSet<ushort> EXTENDED = new HashSet<ushort> { 0x2E, 0x2D, 0x24, 0x23, 0x21, 0x22, 0x26, 0x28, 0x25, 0x27, 0x5B, 0x5D };

  // "ctrl+shift+s", "alt+f4", "enter": held in order, let go in reverse
  public static string Keys(string combo) {
    var vks = new List<ushort>();
    foreach (var part in combo.Split('+')) {
      var p = part.Trim();
      if (p.Length == 0) continue;
      ushort vk;
      if (VK.TryGetValue(p, out vk)) vks.Add(vk);
      else if (p.Length == 1) {
        char c = char.ToUpperInvariant(p[0]);
        if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) vks.Add((ushort)c);
        else { short s = VkKeyScan(p[0]); if (s == -1) return "unknown key: " + p; vks.Add((ushort)(s & 0xff)); }
      } else return "unknown key: " + p;
    }
    foreach (var v in vks) { Key(v, false, EXTENDED.Contains(v)); Thread.Sleep(15); }
    for (int n = vks.Count - 1; n >= 0; n--) { Key(vks[n], true, EXTENDED.Contains(vks[n])); Thread.Sleep(15); }
    return null;
  }

  // --- UI Automation -------------------------------------------------------------------------------
  public class El { public string role, name, value; public int x, y, w, h; public bool enabled; }

  static readonly HashSet<ControlType> USEFUL = new HashSet<ControlType> {
    ControlType.Button, ControlType.Edit, ControlType.ComboBox, ControlType.CheckBox, ControlType.RadioButton, ControlType.ListItem,
    ControlType.MenuItem, ControlType.TabItem, ControlType.Hyperlink, ControlType.TreeItem, ControlType.DataItem, ControlType.Text,
    ControlType.SplitButton, ControlType.Slider, ControlType.Spinner, ControlType.Document, ControlType.HeaderItem, ControlType.MenuBar
  };

  // The window's controls a person could see and use, in reading order, within a time budget
  // The elements of the last list, by their place in it: what press, set, select and expand act on
  static List<AutomationElement> seen = new List<AutomationElement>();

  public static List<El> Elements(long id, int max, int budgetMs) {
    var list = new List<El>();
    seen = new List<AutomationElement>();
    var watch = Stopwatch.StartNew();
    AutomationElement root;
    try { root = AutomationElement.FromHandle(new IntPtr(id)); } catch { return list; }
    var req = new CacheRequest();
    req.Add(AutomationElement.NameProperty); req.Add(AutomationElement.ControlTypeProperty); req.Add(AutomationElement.BoundingRectangleProperty);
    req.Add(AutomationElement.IsEnabledProperty); req.Add(AutomationElement.IsOffscreenProperty); req.Add(ValuePattern.ValueProperty);
    req.TreeScope = TreeScope.Element;
    var walker = TreeWalker.ControlViewWalker;
    var stack = new Stack<AutomationElement>();
    stack.Push(root);
    using (req.Activate()) {
      while (stack.Count > 0 && list.Count < max && watch.ElapsedMilliseconds < budgetMs) {
        var e = stack.Pop();
        AutomationElement c = null;
        try { c = walker.GetFirstChild(e, req); } catch { }
        var kids = new List<AutomationElement>();
        while (c != null) { kids.Add(c); try { c = walker.GetNextSibling(c, req); } catch { c = null; } }
        for (int k = kids.Count - 1; k >= 0; k--) stack.Push(kids[k]);
        if (e == root) continue;
        try {
          var ct = (ControlType)e.GetCachedPropertyValue(AutomationElement.ControlTypeProperty);
          if (!USEFUL.Contains(ct) || (bool)e.GetCachedPropertyValue(AutomationElement.IsOffscreenProperty)) continue;
          var r = (System.Windows.Rect)e.GetCachedPropertyValue(AutomationElement.BoundingRectangleProperty);
          if (r.IsEmpty || r.Width < 2 || r.Height < 2) continue;
          var name = (string)e.GetCachedPropertyValue(AutomationElement.NameProperty) ?? "";
          object v = e.GetCachedPropertyValue(ValuePattern.ValueProperty, true);
          string value = v is string ? (string)v : null;
          if (ct == ControlType.Text && name.Length == 0) continue;
          list.Add(new El { role = ct.ProgrammaticName.Replace("ControlType.", "").ToLowerInvariant(), name = name.Length > 120 ? name.Substring(0, 120) : name,
            value = value != null && value.Length > 120 ? value.Substring(0, 120) : value,
            x = (int)r.X, y = (int)r.Y, w = (int)r.Width, h = (int)r.Height, enabled = (bool)e.GetCachedPropertyValue(AutomationElement.IsEnabledProperty) });
          seen.Add(e);
        } catch { }
      }
    }
    return list;
  }

  static bool Has<T>(AutomationElement e, AutomationPattern p, out T pattern) where T : class {
    object o;
    pattern = e.TryGetCurrentPattern(p, out o) ? o as T : null;
    return pattern != null;
  }

  // An element's own action, without the mouse or the keyboard: null when done, else why not. Some apps answer an
  // invoke only once the dialog it opens is closed: after 3 s it counts as done, and the helper goes on
  public static string Act(int index, string kind, string text, bool open) {
    if (index < 0 || index >= seen.Count) return "not in the last elements list: list them again";
    var e = seen[index];
    string result = null;
    var t = new Thread(delegate () {
      try {
        InvokePattern inv; TogglePattern tog; SelectionItemPattern sel; ExpandCollapsePattern exp; ValuePattern val;
        if (kind == "press") {
          if (Has(e, InvokePattern.Pattern, out inv)) inv.Invoke();
          else if (Has(e, TogglePattern.Pattern, out tog)) tog.Toggle();
          else if (Has(e, SelectionItemPattern.Pattern, out sel)) sel.Select();
          else if (Has(e, ExpandCollapsePattern.Pattern, out exp)) { if (exp.Current.ExpandCollapseState == ExpandCollapseState.Expanded) exp.Collapse(); else exp.Expand(); }
          else result = "it has no action of its own to press";
        } else if (kind == "set") {
          if (Has(e, ValuePattern.Pattern, out val) && !val.Current.IsReadOnly) val.SetValue(text);
          else result = "it takes no text of its own";
        } else if (kind == "select") {
          if (Has(e, SelectionItemPattern.Pattern, out sel)) sel.Select();
          else result = "it is not something to select";
        } else if (kind == "expand") {
          if (Has(e, ExpandCollapsePattern.Pattern, out exp)) { if (open) exp.Expand(); else exp.Collapse(); }
          else result = "it doesn't open or close";
        } else result = "unknown action " + kind;
      } catch (Exception ex) { result = ex.Message; }
    });
    t.IsBackground = true;
    t.Start();
    t.Join(3000);
    return result;
  }

  // Scrolls the element's own list or page, or the nearest one around it: false when there is none
  public static bool ScrollEl(int index, int dx, int dy) {
    if (index < 0 || index >= seen.Count) return false;
    var e = seen[index];
    var walker = TreeWalker.ControlViewWalker;
    for (int up = 0; e != null && up < 8; up++) {
      ScrollPattern sp;
      try {
        if (Has(e, ScrollPattern.Pattern, out sp) && ((dy != 0 && sp.Current.VerticallyScrollable) || (dx != 0 && sp.Current.HorizontallyScrollable))) {
          // A wheel notch is about three lines
          for (int n = 0; n < Math.Abs(dy) * 3 && sp.Current.VerticallyScrollable; n++) sp.ScrollVertical(dy > 0 ? ScrollAmount.SmallIncrement : ScrollAmount.SmallDecrement);
          for (int n = 0; n < Math.Abs(dx) * 3 && sp.Current.HorizontallyScrollable; n++) sp.ScrollHorizontal(dx > 0 ? ScrollAmount.SmallIncrement : ScrollAmount.SmallDecrement);
          return true;
        }
        e = walker.GetParent(e);
      } catch { return false; }
    }
    return false;
  }
}
'@

[Scr]::Init()

# The clipboard, for text too long or too foreign to type: what was there goes back after the paste
function Paste([string]$text) {
  Add-Type -AssemblyName System.Windows.Forms
  $was = $null
  try { if ([System.Windows.Forms.Clipboard]::ContainsText()) { $was = [System.Windows.Forms.Clipboard]::GetText() } } catch { }
  [System.Windows.Forms.Clipboard]::SetText($text)
  [void][Scr]::Keys('ctrl+v')
  Start-Sleep -Milliseconds 250
  try { if ($null -ne $was) { [System.Windows.Forms.Clipboard]::SetText($was) } else { [System.Windows.Forms.Clipboard]::Clear() } } catch { }
}

function Answer($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6)); [Console]::Out.Flush() }

Answer @{ ready = $true; screen = [Scr]::ScreenSize() }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $q = $line | ConvertFrom-Json
    $r = switch ($q.op) {
      'screen' { @{ size = [Scr]::ScreenSize(); cursor = [Scr]::Cursor() } }
      'windows' { @{ windows = @([Scr]::Windows()) } }
      'rect' { @{ rect = [Scr]::WindowRect([long]$q.id) } }
      'focus' { @{ ok = [Scr]::Focus([long]$q.id) } }
      'capture' { $c = [Scr]::Capture([long]$q.id, $q.x, $q.y, $q.w, $q.h, $q.maxW, $q.maxH, $q.quality); @{ data = $c[0]; w = $c[1]; h = $c[2]; scale = $c[3] } }
      'fingerprint' { @{ fp = [Scr]::Fingerprint([long]$q.id, $q.x, $q.y, $q.w, $q.h) } }
      'cursor' { @{ cursor = [Scr]::Cursor() } }
      'idle' { @{ idle = [Scr]::Idle() } }
      'foreground' { @{ id = [Scr]::Foreground() } }
      'act' { $e = [Scr]::Act([int]$q.index, [string]$q.kind, [string]$q.text, [bool]$q.open); if ($e) { @{ failed = $e } } else { @{ ok = $true } } }
      'scrollEl' { @{ ok = [Scr]::ScrollEl([int]$q.index, [int]$q.dx, [int]$q.dy) } }
      'monitor' { $m = [Scr]::VirtualMonitor(); @{ monitor = $m } }
      'park' { @{ was = [Scr]::Park([long]$q.id, $q.x, $q.y, $q.w, $q.h) } }
      'unpark' { [Scr]::Unpark([long]$q.id, [int[]]$q.was); @{ ok = $true } }
      'move' { [Scr]::MoveTo($q.x, $q.y); @{ ok = $true } }
      'click' { [Scr]::Click($q.x, $q.y, $q.button, $q.count); @{ ok = $true } }
      'drag' { [Scr]::Drag($q.x, $q.y, $q.x2, $q.y2); @{ ok = $true } }
      'scroll' { [Scr]::Scroll($q.x, $q.y, $q.dx, $q.dy); @{ ok = $true } }
      'type' { [Scr]::Type($q.text); @{ ok = $true } }
      'paste' { Paste $q.text; @{ ok = $true } }
      'keys' { $e = [Scr]::Keys($q.keys); if ($e) { @{ error = $e } } else { @{ ok = $true } } }
      'elements' { @{ elements = @([Scr]::Elements([long]$q.id, $q.max, $q.budget)) } }
      default { @{ error = "unknown op $($q.op)" } }
    }
    Answer $r
  } catch {
    Answer @{ error = $_.Exception.Message }
  }
}
