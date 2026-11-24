// The macOS side of Claude's screen tool, driven by mac.ts: one JSON request per line on stdin, one JSON answer per
// line on stdout ({error} on failure, {need} for a permission the user has to give). Every coordinate is in screen
// points, as CGEvent and Accessibility use them: the main screen's top left is 0, 0, whatever its Retina scale
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit

// The window id of an Accessibility window: private, but the only exact link between the two worlds
@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ el: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError

struct Fail: Error { let why: String }
struct Need: Error { let what: String }

// --- permissions -----------------------------------------------------------------------------------
// Missing ones are asked for once per run: the system's own prompt adds the app to the list in System Settings,
// where the user turns it on. Nothing here goes around it
var asked = Set<String>()

func needScreen() throws {
  if CGPreflightScreenCaptureAccess() { return }
  if asked.insert("screen").inserted { _ = CGRequestScreenCaptureAccess() }
  throw Need(what: "screen")
}

func needAX() throws {
  if AXIsProcessTrusted() { return }
  if asked.insert("ax").inserted { _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) }
  throw Need(what: "ax")
}

// Behind the lock screen nothing can be seen, and the mouse and keyboard would go to the password field
func needUnlocked() throws {
  let d = CGSessionCopyCurrentDictionary() as? [String: Any]
  if (d?["CGSSessionScreenIsLocked"] as? Bool) == true { throw Fail(why: "the screen is locked or asleep: nothing to see or click until someone unlocks it") }
}

// --- windows ---------------------------------------------------------------------------------------
typealias Info = [String: Any]

func infos(_ opts: CGWindowListOption, _ rel: CGWindowID = kCGNullWindowID) -> [Info] {
  (CGWindowListCopyWindowInfo(opts, rel) as? [Info]) ?? []
}

func info(_ id: CGWindowID) -> Info? { infos(.optionIncludingWindow, id).first }

func bounds(_ d: Info) -> CGRect {
  guard let b = d[kCGWindowBounds as String], let r = CGRect(dictionaryRepresentation: b as! CFDictionary) else { return .zero }
  return r
}

func pidOf(_ d: Info) -> pid_t { (d[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0 }
func onScreen(_ d: Info) -> Bool { (d[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue ?? false }

// An app's ordinary window a person could pick: not the menu bar, the Dock, panels or tiny helpers
func ordinary(_ d: Info) -> Bool {
  let layer = (d[kCGWindowLayer as String] as? NSNumber)?.intValue ?? -1
  let owner = d[kCGWindowOwnerName as String] as? String ?? ""
  let r = bounds(d)
  return layer == 0 && owner != "Window Server" && owner != "Dock" && r.width >= 40 && r.height >= 30
}

// A window's title needs Screen Recording; without it, its app's name stands in
func title(_ d: Info) -> String {
  let t = d[kCGWindowName as String] as? String ?? ""
  return t.isEmpty ? d[kCGWindowOwnerName as String] as? String ?? "" : t
}

func attr(_ e: AXUIElement, _ name: String) -> CFTypeRef? {
  var v: CFTypeRef?
  return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
}

func app(_ pid: pid_t, timeout: Float = 1) -> AXUIElement {
  let a = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(a, timeout)
  return a
}

func windowId(_ w: AXUIElement) -> CGWindowID {
  var id: CGWindowID = 0
  return _AXUIElementGetWindow(w, &id) == .success ? id : 0
}

func frame(_ e: AXUIElement) -> CGRect? {
  guard let p = attr(e, kAXPositionAttribute), let s = attr(e, kAXSizeAttribute) else { return nil }
  var pt = CGPoint.zero, sz = CGSize.zero
  AXValueGetValue(p as! AXValue, .cgPoint, &pt)
  AXValueGetValue(s as! AXValue, .cgSize, &sz)
  return CGRect(origin: pt, size: sz)
}

// The Accessibility window of a window id: by its id, else by its frame
func axWindow(_ id: CGWindowID) -> AXUIElement? {
  guard let d = info(id), let all = attr(app(pidOf(d)), kAXWindowsAttribute) as? [AXUIElement] else { return nil }
  return all.first { windowId($0) == id } ?? all.first { frame($0) == bounds(d) }
}

// The front app's pid: Accessibility knows at once, the workspace once its notifications have come in
func frontPid() -> pid_t {
  if AXIsProcessTrusted() {
    let sys = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(sys, 0.5)
    if let a = attr(sys, kAXFocusedApplicationAttribute) {
      var pid: pid_t = 0
      if AXUIElementGetPid(a as! AXUIElement, &pid) == .success { return pid }
    }
  }
  return NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
}

func foreground() -> CGWindowID {
  let pid = frontPid()
  if pid == 0 { return 0 }
  if AXIsProcessTrusted(), let w = attr(app(pid, timeout: 0.5), kAXFocusedWindowAttribute) {
    let id = windowId(w as! AXUIElement)
    if id != 0 { return id }
  }
  // On screen, front to back: the front app's first window
  let d = infos([.optionOnScreenOnly, .excludeDesktopElements]).first { pidOf($0) == pid && ordinary($0) }
  return (d?[kCGWindowNumber as String] as? NSNumber)?.uint32Value ?? 0
}

func winJson(_ d: Info, minimized: Bool, front: CGWindowID) -> [String: Any] {
  let id = (d[kCGWindowNumber as String] as? NSNumber)?.uint32Value ?? 0
  let r = bounds(d)
  return ["id": id, "title": title(d), "app": d[kCGWindowOwnerName as String] as? String ?? "", "x": Int(r.minX), "y": Int(r.minY),
          "w": Int(r.width), "h": Int(r.height), "minimized": minimized, "focused": id == front]
}

func windows() -> [[String: Any]] {
  let front = foreground()
  var list = infos([.optionOnScreenOnly, .excludeDesktopElements]).filter(ordinary).map { winJson($0, minimized: false, front: front) }
  // Minimized windows are off screen like those of hidden apps and other Spaces: Accessibility tells them apart
  guard AXIsProcessTrusted() else { return list }
  var off = [pid_t: [CGWindowID: Info]]()
  for d in infos([.optionAll, .excludeDesktopElements]) where ordinary(d) && !onScreen(d) {
    off[pidOf(d), default: [:]][(d[kCGWindowNumber as String] as? NSNumber)?.uint32Value ?? 0] = d
  }
  for (pid, wins) in off {
    for w in attr(app(pid, timeout: 0.3), kAXWindowsAttribute) as? [AXUIElement] ?? [] {
      guard (attr(w, kAXMinimizedAttribute) as? Bool) == true, let d = wins[windowId(w)] else { continue }
      list.append(winJson(d, minimized: true, front: front))
    }
  }
  return list
}

func rect(_ id: CGWindowID) throws -> [Int] {
  guard let d = info(id) else { throw Fail(why: "the window is closed") }
  // A minimized window keeps its old frame but shows nothing: the same answer as on Windows
  if !onScreen(d) { return [-32000, -32000, 0, 0] }
  let r = bounds(d)
  return [Int(r.minX), Int(r.minY), Int(r.width), Int(r.height)]
}

func focus(_ id: CGWindowID) throws -> Bool {
  try needAX()
  guard let d = info(id) else { throw Fail(why: "the window is closed") }
  let pid = pidOf(d)
  if let w = axWindow(id) {
    if (attr(w, kAXMinimizedAttribute) as? Bool) == true { AXUIElementSetAttributeValue(w, kAXMinimizedAttribute as CFString, kCFBooleanFalse) }
    AXUIElementSetAttributeValue(w, kAXMainAttribute as CFString, kCFBooleanTrue)
    AXUIElementPerformAction(w, kAXRaiseAction as CFString)
  }
  // Accessibility says it is in front before the window server has switched, and an activation still under way
  // (the user's window given back a moment ago) can win after it: only twice in a row, by both, is it in front
  for attempt in 0..<2 {
    AXUIElementSetAttributeValue(app(pid), kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    if attempt > 0 { NSRunningApplication(processIdentifier: pid)?.activate(options: []) }
    var steady = 0
    for _ in 0..<15 {
      usleep(50_000)
      steady = NSWorkspace.shared.frontmostApplication?.processIdentifier == pid && foreground() == id ? steady + 1 : 0
      if steady == 2 {
        usleep(100_000)
        return true
      }
    }
  }
  return false
}

// --- screenshots -----------------------------------------------------------------------------------
func screenRect() -> CGRect { CGDisplayBounds(CGMainDisplayID()) }

// A window alone as it draws itself, even under other windows, or the main screen (id 0), at full resolution, and
// where it is on the screen
func grab(_ id: CGWindowID) throws -> (CGImage, CGRect) {
  try needScreen()
  try needUnlocked()
  let at: CGRect
  if id == 0 { at = screenRect() } else {
    guard let d = info(id) else { throw Fail(why: "the window is closed") }
    at = bounds(d)
  }
  if #available(macOS 14, *) { return (try sck(id), at) }
  return (try screencapture(id), at)
}

@available(macOS 14, *)
func sck(_ id: CGWindowID) throws -> CGImage {
  var out: Result<CGImage, Error> = .failure(Fail(why: "the screenshot took too long"))
  let done = DispatchSemaphore(value: 0)
  Task {
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: id == 0)
      let filter: SCContentFilter
      if id == 0 {
        guard let s = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first else { throw Fail(why: "no screen to see") }
        filter = SCContentFilter(display: s, excludingWindows: [])
      } else {
        guard let w = content.windows.first(where: { $0.windowID == id }) else { throw Fail(why: "the window is closed") }
        filter = SCContentFilter(desktopIndependentWindow: w)
      }
      let cfg = SCStreamConfiguration()
      let k = CGFloat(filter.pointPixelScale)
      cfg.width = max(1, Int(filter.contentRect.width * k))
      cfg.height = max(1, Int(filter.contentRect.height * k))
      cfg.showsCursor = false
      cfg.ignoreShadowsSingleWindow = true
      out = .success(try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg))
    } catch { out = .failure(error) }
    done.signal()
  }
  _ = done.wait(timeout: .now() + 10)
  return try out.get()
}

// Before macOS 14: the system's own tool
func screencapture(_ id: CGWindowID) throws -> CGImage {
  let file = NSTemporaryDirectory() + "tgcv-shot-\(getpid()).png"
  defer { try? FileManager.default.removeItem(atPath: file) }
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  p.arguments = (id == 0 ? ["-x", "-m"] : ["-x", "-o", "-l\(id)"]) + ["-t", "png", file]
  try p.run()
  p.waitUntilExit()
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: file) as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    throw Fail(why: "the screenshot failed")
  }
  return img
}

// The region (screen points) of an image of what lies at `at`, drawn into ow × oh pixels; black where it shows nothing
func draw(_ img: CGImage, at: CGRect, region: CGRect, ow: Int, oh: Int, grey: Bool) -> CGImage {
  let space = grey ? CGColorSpaceCreateDeviceGray() : CGColorSpace(name: CGColorSpace.sRGB)!
  let ctx = CGContext(data: nil, width: ow, height: oh, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                      bitmapInfo: grey ? CGImageAlphaInfo.none.rawValue : CGImageAlphaInfo.noneSkipLast.rawValue)!
  ctx.interpolationQuality = .high
  ctx.setFillColor(CGColor(gray: 0, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: ow, height: oh))
  let kx = CGFloat(ow) / region.width, ky = CGFloat(oh) / region.height
  let w = at.width * kx, h = at.height * ky
  // Bitmap contexts count y from the bottom
  ctx.draw(img, in: CGRect(x: (at.minX - region.minX) * kx, y: CGFloat(oh) - (at.minY - region.minY) * ky - h, width: w, height: h))
  return ctx.makeImage()!
}

func jpeg(_ img: CGImage, quality: Double) -> String {
  let data = NSMutableData()
  let dest = CGImageDestinationCreateWithData(data, "public.jpeg" as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, img, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
  CGImageDestinationFinalize(dest)
  return (data as Data).base64EncodedString()
}

// A region as JPEG, scaled to fit maxW × maxH but never past the screen's own pixels; scale: output pixels per point
func capture(_ id: CGWindowID, _ region: CGRect, maxW: Double, maxH: Double, quality: Double) throws -> [String: Any] {
  let (img, at) = try grab(id)
  let pixels = at.width > 0 ? CGFloat(img.width) / at.width : 1
  let scale = min(Double(pixels), maxW / region.width, maxH / region.height)
  let ow = max(1, Int((region.width * scale).rounded())), oh = max(1, Int((region.height * scale).rounded()))
  return ["data": jpeg(draw(img, at: at, region: region, ow: ow, oh: oh, grey: false), quality: quality), "w": ow, "h": oh, "scale": scale]
}

// A small grey thumbnail's fingerprint: equal twice in a row means the screen has settled
func fingerprint(_ id: CGWindowID, _ region: CGRect) throws -> String {
  let (img, at) = try grab(id)
  let t = draw(img, at: at, region: region, ow: 48, oh: 32, grey: true)
  guard let data = t.dataProvider?.data, let p = CFDataGetBytePtr(data) else { return "" }
  var s = ""
  for j in 0..<32 { for i in 0..<48 { s.append(Character(UnicodeScalar(97 + p[j * t.bytesPerRow + i] / 16))) } }
  return s
}

// --- input -----------------------------------------------------------------------------------------
let src = CGEventSource(stateID: .hidSystemState)

func post(_ e: CGEvent?) { e?.post(tap: .cghidEventTap) }

// Milliseconds since anyone's last input, Claude's own included
func idle() -> Int {
  let kinds: [CGEventType] = [.mouseMoved, .leftMouseDown, .rightMouseDown, .otherMouseDown, .leftMouseDragged, .scrollWheel, .keyDown, .flagsChanged]
  let s = kinds.map { CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: $0) }.min() ?? 0
  return Int(s * 1000)
}

func cursor() -> [Int] {
  let p = CGEvent(source: nil)?.location ?? .zero
  return [Int(p.x), Int(p.y)]
}

func moveTo(_ p: CGPoint) {
  post(CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left))
  usleep(15_000)
}

func click(_ p: CGPoint, button: String, count: Int) {
  moveTo(p)
  let (down, up, b): (CGEventType, CGEventType, CGMouseButton) = button == "right" ? (.rightMouseDown, .rightMouseUp, .right)
    : button == "middle" ? (.otherMouseDown, .otherMouseUp, .center) : (.leftMouseDown, .leftMouseUp, .left)
  for n in 1...max(1, count) {
    for t in [down, up] {
      let e = CGEvent(mouseEventSource: src, mouseType: t, mouseCursorPosition: p, mouseButton: b)
      // The second and third clicks say so: that is what makes a double click on macOS
      e?.setIntegerValueField(.mouseEventClickState, value: Int64(n))
      post(e)
      usleep(t == down ? 20_000 : 60_000)
    }
  }
}

func drag(_ a: CGPoint, _ b: CGPoint) {
  moveTo(a)
  post(CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: a, mouseButton: .left))
  usleep(60_000)
  for s in 1...20 {
    let p = CGPoint(x: a.x + (b.x - a.x) * CGFloat(s) / 20, y: a.y + (b.y - a.y) * CGFloat(s) / 20)
    post(CGEvent(mouseEventSource: src, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left))
    usleep(12_000)
  }
  usleep(60_000)
  post(CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: b, mouseButton: .left))
}

func scroll(_ p: CGPoint, dx: Int, dy: Int) {
  moveTo(p)
  // A wheel notch is about three lines; a positive wheel scrolls up and left
  post(CGEvent(scrollWheelEvent2Source: src, units: .line, wheelCount: 2, wheel1: Int32(-dy * 3), wheel2: Int32(-dx * 3), wheel3: 0))
}

func key(_ code: CGKeyCode, down: Bool, flags: CGEventFlags = []) {
  let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)
  e?.flags = flags
  post(e)
}

// Any text, any layout: each character goes as itself, not as the key that makes it here
func type(_ text: String) {
  for ch in text {
    if ch == "\r" { continue }
    if ch == "\n" || ch == "\r\n" || ch == "\t" {
      let code: CGKeyCode = ch == "\t" ? 48 : 36
      key(code, down: true); key(code, down: false)
      usleep(8_000)
      continue
    }
    let units = Array(String(ch).utf16)
    for down in [true, false] {
      let e = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: down)
      e?.flags = []
      e?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
      post(e)
    }
    usleep(4_000)
  }
}

let MODS: [String: (CGEventFlags, CGKeyCode)] = [
  "cmd": (.maskCommand, 55), "command": (.maskCommand, 55), "win": (.maskCommand, 55), "super": (.maskCommand, 55), "meta": (.maskCommand, 55),
  "ctrl": (.maskControl, 59), "control": (.maskControl, 59), "alt": (.maskAlternate, 58), "option": (.maskAlternate, 58), "opt": (.maskAlternate, 58),
  "shift": (.maskShift, 56), "fn": (.maskSecondaryFn, 63),
]

// Keys by their place on a US keyboard, as macOS shortcuts go whatever the layout
let KEYS: [String: CGKeyCode] = [
  "enter": 36, "return": 36, "tab": 48, "space": 49, "backspace": 51, "delete": 117, "del": 117, "esc": 53, "escape": 53,
  "home": 115, "end": 119, "pageup": 116, "pagedown": 121, "left": 123, "right": 124, "down": 125, "up": 126, "capslock": 57, "help": 114, "insert": 114,
  "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
  "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33,
  "i": 34, "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50,
]

// "cmd+shift+s", "enter", "esc": modifiers held in order, let go in reverse
func keys(_ combo: String) throws {
  var mods = [(CGEventFlags, CGKeyCode)](), main = [CGKeyCode]()
  for part in combo.split(separator: "+").map({ $0.trimmingCharacters(in: .whitespaces).lowercased() }) where !part.isEmpty {
    if let m = MODS[part] { mods.append(m) } else if let k = KEYS[part] { main.append(k) } else { throw Fail(why: "unknown key: \(part)") }
  }
  var flags: CGEventFlags = []
  for (f, code) in mods { flags.insert(f); key(code, down: true, flags: flags); usleep(15_000) }
  for code in main { key(code, down: true, flags: flags); usleep(15_000); key(code, down: false, flags: flags); usleep(15_000) }
  for (f, code) in mods.reversed() { flags.remove(f); key(code, down: false, flags: flags); usleep(15_000) }
}

// The clipboard, for text too long to type: what was there goes back after the paste
func paste(_ text: String) throws {
  let pb = NSPasteboard.general
  let was = (pb.pasteboardItems ?? []).map { item in item.types.compactMap { t in item.data(forType: t).map { (t, $0) } } }
  pb.clearContents()
  pb.setString(text, forType: .string)
  try keys("cmd+v")
  // The app reads the clipboard when it gets to the keystroke
  usleep(400_000)
  pb.clearContents()
  if !was.isEmpty {
    pb.writeObjects(was.map { pairs in
      let item = NSPasteboardItem()
      for (t, d) in pairs { item.setData(d, forType: t) }
      return item
    })
  }
}

// --- Accessibility ---------------------------------------------------------------------------------
// What a person could see and use, by role; the rest (groups, layout, images) only holds them
let ROLES: Set<String> = [
  "AXButton", "AXTextField", "AXTextArea", "AXComboBox", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton", "AXMenuItem",
  "AXRow", "AXLink", "AXSlider", "AXIncrementor", "AXDisclosureTriangle", "AXStaticText", "AXColorWell", "AXDateField", "AXWebArea",
  "AXHeading", "AXSearchField", "AXTab",
]

// The elements of the last list, by their place in it: what act and scrollEl work on
var seen = [AXUIElement]()

func str(_ v: Any?) -> String? {
  if let s = v as? String { return s.isEmpty ? nil : s }
  if let n = v as? NSNumber { return n.stringValue }
  return nil
}

func cut(_ s: String) -> String { s.count > 120 ? String(s.prefix(120)) : s }

func elements(_ id: CGWindowID, max: Int, budgetMs: Int) throws -> [[String: Any]] {
  try needAX()
  seen = []
  guard let win = axWindow(id), let d = info(id) else { return [] }
  let box = bounds(d)
  let end = Date().addingTimeInterval(Double(budgetMs) / 1000)
  let names = [kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute, kAXPositionAttribute,
               kAXSizeAttribute, kAXEnabledAttribute, kAXChildrenAttribute, kAXPlaceholderValueAttribute, kAXHelpAttribute] as CFArray
  var list = [[String: Any]]()
  var stack = (attr(win, kAXChildrenAttribute) as? [AXUIElement] ?? []).reversed() as [AXUIElement]
  while let e = stack.popLast(), list.count < max, Date() < end {
    var raw: CFArray?
    guard AXUIElementCopyMultipleAttributeValues(e, names, AXCopyMultipleAttributeOptions(rawValue: 0), &raw) == .success, let v = raw as? [Any] else { continue }
    // A missing attribute comes back as an AXValue holding the error
    let get = { (i: Int) -> Any? in
      let x = v[i] as AnyObject
      return CFGetTypeID(x) == AXValueGetTypeID() && AXValueGetType(x as! AXValue) == .axError ? nil : v[i]
    }
    var pt = CGPoint.zero, sz = CGSize.zero
    if let p = get(5) { AXValueGetValue(p as! AXValue, .cgPoint, &pt) }
    if let s = get(6) { AXValueGetValue(s as! AXValue, .cgSize, &sz) }
    let r = CGRect(origin: pt, size: sz)
    // Scrolled out of the window: nor is anything inside it on screen
    if sz.width > 0 && sz.height > 0 && !r.intersects(box) { continue }
    if let kids = get(8) as? [AXUIElement] { stack.append(contentsOf: kids.reversed()) }
    let role = get(0) as? String ?? "", sub = get(1) as? String ?? ""
    guard ROLES.contains(role), sz.width >= 2, sz.height >= 2 else { continue }
    var name = str(get(2)) ?? str(get(3)) ?? ""
    var value = str(get(4))
    if role == "AXStaticText" {
      // A text is its value, unless it is described ("Edit field" = "42")
      if name.isEmpty { name = value ?? ""; value = nil }
      if name.isEmpty { continue }
    }
    // The window's own buttons have only their kind: AXCloseButton is a "close button"
    if name.isEmpty { name = str(get(9)) ?? str(get(10)) ?? sub.dropFirst(2).replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression).lowercased() }
    if sub == "AXSecureTextField" { value = nil }
    if role == "AXCheckBox" || role == "AXRadioButton" { value = value == "1" ? "on" : value == "0" ? "off" : value }
    let kind = sub == "AXTabButton" ? "tab" : sub == "AXSearchField" ? "searchfield" : sub == "AXSecureTextField" ? "securefield" : sub == "AXSwitch" ? "switch"
      : String(role.dropFirst(2)).lowercased()
    var el: [String: Any] = ["role": kind, "name": cut(name), "x": Int(r.minX), "y": Int(r.minY), "w": Int(r.width), "h": Int(r.height),
                             "enabled": (get(7) as? Bool) ?? true]
    el["value"] = value.map(cut) ?? NSNull()
    list.append(el)
    seen.append(e)
  }
  return list
}

func actions(_ e: AXUIElement) -> [String] {
  var a: CFArray?
  return AXUIElementCopyActionNames(e, &a) == .success ? a as? [String] ?? [] : []
}

func settable(_ e: AXUIElement, _ name: String) -> Bool {
  var ok: DarwinBoolean = false
  return AXUIElementIsAttributeSettable(e, name as CFString, &ok) == .success && ok.boolValue
}

// An app busy with what the action opened (a menu, a dialog) answers late: that counts as done, as on Windows
func done(_ r: AXError) -> String? {
  switch r {
  case .success, .cannotComplete: return nil
  case .invalidUIElement: return "it is gone: list the elements again"
  case .actionUnsupported, .attributeUnsupported: return "the app doesn't support that on it"
  default: return "the app refused (AXError \(r.rawValue))"
  }
}

func perform(_ e: AXUIElement, _ action: String) -> String? { done(AXUIElementPerformAction(e, action as CFString)) }
func set(_ e: AXUIElement, _ name: String, _ v: CFTypeRef) -> String? { done(AXUIElementSetAttributeValue(e, name as CFString, v)) }

// An element's own action, without the mouse or the keyboard: nil when done, else why not
func act(_ index: Int, kind: String, text: String, open: Bool) throws -> String? {
  try needAX()
  guard index >= 0 && index < seen.count else { return "not in the last elements list: list them again" }
  let e = seen[index]
  AXUIElementSetMessagingTimeout(e, 3)
  let has = actions(e), role = attr(e, kAXRoleAttribute) as? String ?? ""
  switch kind {
  case "press":
    if has.contains(kAXPressAction) { return perform(e, kAXPressAction) }
    if has.contains(kAXPickAction) { return perform(e, kAXPickAction) }
    if settable(e, kAXSelectedAttribute) { return set(e, kAXSelectedAttribute, kCFBooleanTrue) }
    if has.contains(kAXShowMenuAction) { return perform(e, kAXShowMenuAction) }
    if has.contains(kAXConfirmAction) { return perform(e, kAXConfirmAction) }
    return "it has no action of its own to press"
  case "set":
    if settable(e, kAXValueAttribute) { return set(e, kAXValueAttribute, text as CFString) }
    return "it takes no text of its own"
  case "select":
    if settable(e, kAXSelectedAttribute) { return set(e, kAXSelectedAttribute, kCFBooleanTrue) }
    // A table's row is selected through its table
    if role == "AXRow", let p = attr(e, kAXParentAttribute), settable(p as! AXUIElement, kAXSelectedRowsAttribute) {
      return set(p as! AXUIElement, kAXSelectedRowsAttribute, [e] as CFArray)
    }
    if has.contains(kAXPickAction) { return perform(e, kAXPickAction) }
    if (role == "AXRadioButton" || role == "AXMenuItem") && has.contains(kAXPressAction) { return perform(e, kAXPressAction) }
    return "it is not something to select"
  case "expand":
    if settable(e, "AXDisclosing") { return set(e, "AXDisclosing", open ? kCFBooleanTrue : kCFBooleanFalse) }
    if settable(e, kAXExpandedAttribute) { return set(e, kAXExpandedAttribute, open ? kCFBooleanTrue : kCFBooleanFalse) }
    if open && has.contains(kAXShowMenuAction) { return perform(e, kAXShowMenuAction) }
    if open && (role == "AXPopUpButton" || role == "AXComboBox" || role == "AXMenuButton" || role == "AXDisclosureTriangle") && has.contains(kAXPressAction) {
      return perform(e, kAXPressAction)
    }
    if !open && has.contains(kAXCancelAction) { return perform(e, kAXCancelAction) }
    return "it doesn't open or close"
  default:
    return "unknown action \(kind)"
  }
}

// Scrolls the nearest list or page around the element by its scroll bar: false when there is none
func scrollEl(_ index: Int, dx: Int, dy: Int) throws -> Bool {
  try needAX()
  guard index >= 0 && index < seen.count else { return false }
  var e: AXUIElement? = seen[index]
  for _ in 0..<8 {
    guard let el = e else { return false }
    if attr(el, kAXRoleAttribute) as? String == "AXScrollArea", let view = frame(el) {
      let content = (attr(el, kAXContentsAttribute) as? [AXUIElement])?.first.flatMap(frame)
      var moved = false
      for (d, bar, along) in [(dy, kAXVerticalScrollBarAttribute, \CGSize.height), (dx, kAXHorizontalScrollBarAttribute, \CGSize.width)] where d != 0 {
        guard let b = attr(el, bar), settable(b as! AXUIElement, kAXValueAttribute), let now = attr(b as! AXUIElement, kAXValueAttribute) as? Double else { continue }
        // Three lines of about 16 points a notch, as a share of how far it scrolls
        let range = (content?.size[keyPath: along] ?? 0) - view.size[keyPath: along]
        let step = range > 0 ? 48 * Double(abs(d)) / Double(range) : 0.1 * Double(abs(d))
        let to = Swift.max(0, Swift.min(1, now + (d > 0 ? step : -step)))
        if set(b as! AXUIElement, kAXValueAttribute, to as CFNumber) == nil { moved = true }
      }
      if moved { return true }
    }
    e = attr(el, kAXParentAttribute).map { $0 as! AXUIElement }
  }
  return false
}

// --- the loop --------------------------------------------------------------------------------------
func answer(_ o: [String: Any]) {
  var data = (try? JSONSerialization.data(withJSONObject: o)) ?? Data("{\"error\":\"unanswerable\"}".utf8)
  data.append(0x0A)
  FileHandle.standardOutput.write(data)
}

func run(_ q: [String: Any]) throws -> [String: Any] {
  let n = { (k: String) -> Double in (q[k] as? NSNumber)?.doubleValue ?? 0 }
  let s = { (k: String) -> String in q[k] as? String ?? "" }
  let id = CGWindowID(truncatingIfNeeded: Int(n("id")))
  let region = CGRect(x: n("x"), y: n("y"), width: Swift.max(1, n("w")), height: Swift.max(1, n("h")))
  let at = CGPoint(x: n("x"), y: n("y"))
  // Real input goes nowhere without Accessibility, and says nothing
  let input = ["move", "click", "drag", "scroll", "type", "paste", "keys"]
  if input.contains(s("op")) {
    try needAX()
    try needUnlocked()
  }
  switch s("op") {
  case "screen": let r = screenRect(); return ["size": [Int(r.width), Int(r.height)]]
  case "cursor": return ["cursor": cursor()]
  case "idle": return ["idle": idle()]
  case "windows": return ["windows": windows()]
  case "foreground": return ["id": foreground()]
  case "rect": return ["rect": try rect(id)]
  case "focus": return ["ok": try focus(id)]
  case "capture": return try capture(id, region, maxW: n("maxW"), maxH: n("maxH"), quality: (q["quality"] as? NSNumber)?.doubleValue ?? 0.72)
  case "fingerprint": return ["fp": try fingerprint(id, region)]
  case "move": moveTo(at); return ["ok": true]
  case "click": click(at, button: s("button"), count: Int(n("count"))); return ["ok": true]
  case "drag": drag(at, CGPoint(x: n("x2"), y: n("y2"))); return ["ok": true]
  case "scroll": scroll(at, dx: Int(n("dx")), dy: Int(n("dy"))); return ["ok": true]
  case "type": type(s("text")); return ["ok": true]
  case "paste": try paste(s("text")); return ["ok": true]
  case "keys": try keys(s("keys")); return ["ok": true]
  case "elements": return ["elements": try elements(id, max: Int(n("max")), budgetMs: Int(n("budget")))]
  case "act":
    if let why = try act(Int(n("index")), kind: s("kind"), text: s("text"), open: (q["open"] as? Bool) ?? true) { return ["failed": why] }
    return ["ok": true]
  case "scrollEl": return ["ok": try scrollEl(Int(n("index")), dx: Int(n("dx")), dy: Int(n("dy")))]
  case "monitor": return ["monitor": NSNull()]
  default: throw Fail(why: "unknown op \(s("op"))")
  }
}

// The requests are read off the main thread: the main run loop keeps the workspace and ScreenCaptureKit up to date
Thread {
  answer(["ready": true, "screen": CGPreflightScreenCaptureAccess(), "ax": AXIsProcessTrusted()])
  while let line = readLine() {
    do {
      guard let q = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { throw Fail(why: "not a request") }
      answer(try run(q))
    } catch let e as Need {
      answer(["need": e.what])
    } catch let e as Fail {
      answer(["error": e.why])
    } catch {
      answer(["error": error.localizedDescription])
    }
  }
  exit(0)
}.start()
RunLoop.main.run()
