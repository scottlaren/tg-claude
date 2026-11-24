import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { deflateSync } from 'node:zlib'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Bot API 10.4 widgets: a small HTML page drawn inside a message bubble, run by the app in a sandbox with no network.
// Only private chats take them in production, so the tools are offered there alone. What the user sets in one comes
// back as their message, the way a suggested reply does
export const WIDGET_SERVER = 'widget'
export const SEND_WIDGET = `mcp__${WIDGET_SERVER}__send_widget`
export const WIDGET_GUIDE_TOOL = `mcp__${WIDGET_SERVER}__widget_guide`
export const isWidgetTool = (t: string) => t === SEND_WIDGET || t === WIDGET_GUIDE_TOOL
export const WIDGET_HTML_MAX = 32_768
export const WIDGET_PACKED_MAX = 4096

// Telegram's own rules for a model that writes widgets, from the sandbox every client runs. Read from there at a
// pinned release rather than copied into this repository: it carries no licence
export const GUIDE_URL = 'https://raw.githubusercontent.com/TelegramMessenger/widget-sandbox/v0.6.1/docs/widget-runtime-profile.md'

export type WidgetRequest = { html: string, caption?: string, width?: number, height?: number }

// Checked before sending: Telegram's own refusal names the limit, not by how much it was missed
export function widgetProblem(html: string): string | null {
  if (html.includes('\u0000')) return 'The HTML has a NUL character: remove it.'
  const bytes = Buffer.byteLength(html)
  if (bytes > WIDGET_HTML_MAX) return `The HTML is ${bytes} bytes; at most ${WIDGET_HTML_MAX}. Make it shorter.`
  const packed = deflateSync(html, { level: 9 }).length
  if (packed > WIDGET_PACKED_MAX) return `The HTML takes ${packed} bytes compressed; at most ${WIDGET_PACKED_MAX}. Cut repetition, comments and long names, draw with loops instead of markup.`
  return null
}

// The "Agent block" of the authors' guide, without its links to docs that aren't published yet
export function agentBlock(md: string): string | null {
  const m = /<!-- agent-block -->\s*```text\n([\s\S]*?)```\s*<!-- \/agent-block -->/.exec(md.replace(/\r\n/g, '\n'))
  if (!m) return null
  return m[1]
    .split('\n')
    .filter(l => !/^<!-- \/?profile:agent -->$/.test(l.trim()) && !/^More: \{docs\}/.test(l.trim()))
    .join('\n')
    .replace(/ Docs: \{docs\}[^\n]*(\n[^\n]*\(every feature\)\.)?/, '')
    .trim()
}

// Fetched once and kept: the turn that needs it shouldn't wait on GitHub again
export async function loadWidgetGuide(cacheFile: string, get: typeof fetch = fetch): Promise<string | null> {
  if (existsSync(cacheFile)) return readFileSync(cacheFile, 'utf8')
  try {
    const res = await get(GUIDE_URL, { signal: AbortSignal.timeout(15_000) })
    const block = res.ok ? agentBlock(await res.text()) : null
    if (block) writeFileSync(cacheFile, block)
    return block
  } catch {
    return null
  }
}

// What this bot adds to Telegram's rules: how a value comes back, and the look
export const BOT_WIDGET_RULES = `THIS BOT
- Send with send_widget. A caption is optional: without one the message is a line shorter and the client draws the time over the bottom corner, so keep the bottom padding at max(16px,env(safe-area-inset-bottom)). Give a caption when the widget sends a value back: it names the value.
- A value for you: on a clear button (Apply, Use this) call TelegramWidget.request(value) synchronously in its click handler, 1-64 bytes. It reaches you as the user's own message «🧩 caption: value»; the widget gets result "ok". Keep the value compact and ready to use: cubic-bezier(.65,0,.35,1), #FF5A1F, 240ms, B. Show on the button that it went (a check, HapticFeedback.notificationOccurred('success')).
- No state edits from this bot: draw everything from the HTML itself. A new version is a new widget.

THE SQUARE: the default shape, 320 by 320
Telegram's bubble at 320 is about the size of Apple's large widget (338 by 354 points), so the square has the large widget's room and must be as full as Apple's are. These rules come from Apple's Human Interface Guidelines for widgets and its WWDC20 talk "Design great widgets"; follow them before taste.
- Send width 320 and height 320 and lay out in that fixed box: body{margin:0;height:320px;box-sizing:border-box;display:flex;flex-direction:column}. Exceptions, for content that isn't square by nature (a strip like an hourly forecast, a long list, a value editor): width 320 and no height, the height following the content, the same rules otherwise.
- One subject, the most useful thing about it, now. At most four pieces of information carry it (Apple's limit for its small widget); the square may add one visualization of them or a short list, never a second subject. No app name or logo, no instructions ("tap to…"): a context label says what it is.
- Density: Apple's rule is "sparse layouts make a widget seem unnecessary, dense ones aren't glanceable". Split the square in three bands, top about a fifth, middle about half, bottom the rest: every band carries something, nothing is left bare, nothing crowds an edge. If the middle would be empty, the middle gets the visualization; if there is nothing to visualize, it isn't a square: make it the exception.
- Pick one archetype, the way Apple's own widgets are built:
  ring (Batteries, Fitness): a progress ring about 130px on the left or centred, the number inside, 2-3 stats in a column beside it, the name at the bottom left and its origin at the bottom right. The first reference below.
  number and chart (Screen Time, Stocks): the context label top-left and the period top-right, the hero number under it with the comparison as a column at its right, a bar or line chart filling the lower half, its axis labels at 12. The second reference below.
  list (Reminders, Calendar): the context label with its detail on a line under it, the count as the hero top right, then 3-4 rows sharing the rest of the height equally (rows flex:1), each a 26px tinted smooth badge, a 16/500 title on one line, a 14px value on the right, hairlines between.
  grid (Batteries with several devices, Home): the body padding 11px, four tinted smooth platters (radius 14, concentric with the bubble) in a 2 by 2 grid with 8px gaps, each an icon top-left, a status dot top-right, a 15/500 name and a 13px state at the bottom.
  strip (Weather): the hero top-left, 5-6 equal columns along the bottom of a 14px label, a 20px icon and a 15/500 value.
  full bleed (Clock, Photos, Music): the graphic is the widget, edge to edge, text in one corner.
- No interpunct. Never join facts with " · " (or a dash or slash used the same way) in a label or a line: each fact gets its own place in the composition. A second fact about the whole widget goes top-right in the hint colour (the period, the source, a count); a comparison becomes its own column beside the hero, the figure over its label; the name and its origin share the bottom row, one at each edge; a value with its unit stays one value. If a fact has no place, it goes. A rare exception is a short run of equal items no layout can hold.
- Alignment: leading. The context sits top-left, the payload and its name bottom-left; text is left-aligned. Only a symmetric graphic (one ring, a dial, a gauge) is centred, and then it is the hero.
- Margins: 16px from the edges, as Apple's standard. Platters, circles and other filled shapes near the edge sit 11px from it (Apple's tighter margin), with the text inside them inset again. Gaps 8-12px.
- Corners: Apple's smooth corners, 60% smoothing, on every shape you fill: badges, platters, pills, chart bars over 10px wide. CSS can't draw them (corner-shape is out of the profile), so draw the shape as an SVG path from this function (the math of figma-squircle, MIT): sq(width, height, radius) returns the d of the path.
function sq(w,h,r,s=.6){const B=Math.min(w,h)/2;r=Math.min(r,B);const p=Math.min((1+s)*r,B);s=Math.min(s,B/r-1);const R=Math.PI/180,am=90*(1-s),L=Math.sin(am/2*R)*r*Math.SQRT2,al=(90-am)/2,t=r*Math.tan(al/2*R),be=45*s,c=t*Math.cos(be*R),d=c*Math.tan(be*R),b=(p-L-c-d)/3,a=2*b,A=a+b,C=A+c;
return\`M\${w-p} 0c\${a} 0 \${A} 0 \${C} \${d}a\${r} \${r} 0 0 1 \${L} \${L}c\${d} \${c} \${d} \${b+c} \${d} \${C}L\${w} \${h-p}c0 \${a} 0 \${A} \${-d} \${C}a\${r} \${r} 0 0 1 \${-L} \${L}c\${-c} \${d} \${-(b+c)} \${d} \${-C} \${d}L\${p} \${h}c\${-a} 0 \${-A} 0 \${-C} \${-d}a\${r} \${r} 0 0 1 \${-L} \${-L}c\${-d} \${-c} \${-d} \${-(b+c)} \${-d} \${-C}L0 \${p}c0 \${-a} 0 \${-A} \${d} \${-C}a\${r} \${r} 0 0 1 \${L} \${-L}c\${c} \${-d} \${b+c} \${-d} \${C} \${-d}Z\`}
  A badge: a relative box with <svg style="position:absolute;inset:0"><path fill="..." d=sq(26,26,8)/></svg> and the icon over it. A platter: the same svg behind its content, sized from its offsetWidth and offsetHeight read once. Shapes near the bubble's edge are concentric with it: an 11px inset gets radius 14. Nothing can be clipped to the shape (no clip-path, no mask): fill it, content on top. Thin things keep border-radius: bars under 10px, tracks, hairlines. Quote attribute values before a self-closing slash: <path id=f/> is read as the id "f/".
- Type: SF Pro Rounded for everything, the user's choice: font-family:ui-rounded,system-ui on body. Three levels at most: the hero (a number 48-52, 600, line-height 1, letter-spacing -.02em, its unit at half size in the hint colour; or the graphic), primary text 15-17 at 500 (a context label 15/600), secondary 13-14 at 400 in the hint colour, sentence case, never uppercase or letter-spaced. Nothing under 12. Numbers tabular (font-variant-numeric:tabular-nums). Times relative where it reads better: "через 4 мин", "до 16:42".
- Colour: no background of your own: the message's colour shows through, text in var(--tg-theme-text-color), secondary in var(--tg-theme-hint-color); both light and dark must read (hairlines rgba(128,128,128,.22)). The accent is the user's own Telegram theme colour: var(--tg-theme-button-color) (with #0A84FF after the comma) for the badge, the ring or progress, the current bar, a selected item; white on it var(--tg-theme-button-text-color). Its light tint for tracks, platters and pills can't come from CSS (no color-mix): make it in JS from TelegramWidget.themeParams.button_color as rgba(r,g,b,.16) into a custom property, again on themeChanged, as the references do. Meaning keeps fixed colours and never colour alone, an icon or word too. Status is tinted, never a white glyph on a bright fill (white on iOS green is about 2:1, unreadable): the badge filled with the colour at .16, the glyph in the colour itself, darker on light and brighter on dark with light-dark(): done light-dark(#248A3D,#30D158) on rgba(52,199,89,.16), failed light-dark(#D70015,#FF6961) on rgba(255,69,58,.16), waiting light-dark(#C93400,#FF9F0A) on rgba(255,149,0,.16), in progress the accent on its tint. The same light-dark() colour for status words and figures in text (−12%, failed). Only the header's app badge is solid, the accent with var(--tg-theme-button-text-color) on it. A gradient background only for a subject that is all mood (weather, a sky, music) or when asked.
- Icons: only these, from Lucide (ISC), inside <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">, 15-20px. No hand-drawn icons and no emoji in place of icons.
check: <path d="M20 6 9 17l-5-5"/>
x: <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
clock: <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
zap: <path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/>
film: <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>
play: <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>
pause: <rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>
sun: <circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
cloud: <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
moon: <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>
flame: <path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>
calendar: <path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>
git-branch: <path d="M15 6a9 9 0 0 0-9 9V3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
cpu: <path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>
image: <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
layers: <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>
timer: <line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>
gauge: <path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>
sparkles: <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>
trending-up: <path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>
- One micro-interaction, where the data holds more than the hero shows; not on everything. The pattern: tap a part to bring it into the hero, tap it again to go back. A bar or a point of a chart: the hero rolls to its value (count over 300ms, ease-out), the top-right label names it, the comparison column recomputes, the part takes the accent. A row: it expands in place to its detail. A platter: its value becomes the hero. A ring: toggles between the share and the time left. Charts also scrub: drag sideways across them (touch-action:pan-y on the chart; vertical drags are always the chat's) and the selection follows the finger. HapticFeedback.selectionChanged() on each change. Pointer events, not click alone: pointerdown remembers the part, pointermove past it scrubs, pointerup without a move toggles, pointercancel undoes. Purely local: no request to the bot. Give the tappable part an obvious target (a whole bar, a whole row), never a tiny one.
- Motion: values grow into place on appearance (a ring's dash, bars' heights, 600-800ms ease-out, under Apple's 2 seconds), nothing loops, prefers-reduced-motion respected.
- Before sending, check it as Apple would: one subject; at most four pieces of information; no bare band; no interpunct; leading alignment; 16 and 11 margins; three type levels; the accent in one or two places; one micro-interaction where there is more to see; it reads in light and in dark.

REFERENCE: the ring archetype (a render's status; width 320, height 320, no caption). The level of finish, not a template:
<style>
:root{--a:var(--tg-theme-button-color,#0A84FF);--a2:rgba(10,132,255,.14)}
body{margin:0;padding:16px 16px max(16px,env(safe-area-inset-bottom));height:320px;box-sizing:border-box;display:flex;flex-direction:column;font-family:ui-rounded,system-ui;color:var(--tg-theme-text-color)}
.r{display:flex;align-items:center;gap:7px}
.ic{position:relative;width:22px;height:22px;display:grid;place-items:center;color:var(--tg-theme-button-text-color,#fff)}
.ic .f{position:absolute;inset:0;width:22px;height:22px;fill:var(--a)}
.ic .g{position:relative;width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.app{font-size:14px;font-weight:500;color:var(--tg-theme-hint-color)}
.k{margin-left:auto;font-size:12px;padding:2px 8px;border-radius:10px;background:var(--a2);color:var(--a)}
.m{flex:1;display:flex;align-items:center;gap:18px}
.ring{position:relative;width:132px;height:132px;flex:none}
.ring svg{width:132px;height:132px;transform:rotate(-90deg)}
.ring circle{fill:none;stroke-width:12;stroke-linecap:round}
.ring .tr{stroke:var(--a2)}.ring .pr{stroke:var(--a);stroke-dasharray:0 999;transition:stroke-dasharray .8s ease-out}
.ring b{position:absolute;inset:0;display:grid;place-items:center;font-size:34px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.ring b span{font-size:17px;color:var(--tg-theme-hint-color)}
.st{flex:1;display:flex;flex-direction:column;gap:10px}
.l{font-size:14px;color:var(--tg-theme-hint-color)}
.v{font-size:17px;font-weight:500;font-variant-numeric:tabular-nums}
.nm{font-size:17px;font-weight:500}
.ft{display:flex;align-items:baseline;justify-content:space-between}.s{font-size:14px;color:var(--tg-theme-hint-color)}
</style>
<div class=r><div class=ic><svg class=f><path id="f"/></svg><svg class=g viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 12h18M3 7.5h4M3 16.5h4M17 7.5h4M17 16.5h4"/></svg></div><div class=app>Рендер</div><div class=k>1080p</div></div>
<div class=m><div class=ring><svg viewBox="0 0 132 132"><circle class=tr cx=66 cy=66 r=58 /><circle class=pr id=p cx=66 cy=66 r=58 /></svg><b><div>73<span>%</span></div></b></div>
<div class=st><div><div class=l>Осталось</div><div class=v>4 мин</div></div><div><div class=l>Готово в</div><div class=v>16:42</div></div><div><div class=l>Кадры</div><div class=v>412 / 564</div></div></div></div>
<div class=ft><div class=nm>Intro_v4</div><div class=s>After Effects</div></div>
<script>
function sq(w,h,r,s=.6){const B=Math.min(w,h)/2;r=Math.min(r,B);const p=Math.min((1+s)*r,B);s=Math.min(s,B/r-1);const R=Math.PI/180,am=90*(1-s),L=Math.sin(am/2*R)*r*Math.SQRT2,al=(90-am)/2,t=r*Math.tan(al/2*R),be=45*s,c=t*Math.cos(be*R),d=c*Math.tan(be*R),b=(p-L-c-d)/3,a=2*b,A=a+b,C=A+c;
return\`M\${w-p} 0c\${a} 0 \${A} 0 \${C} \${d}a\${r} \${r} 0 0 1 \${L} \${L}c\${d} \${c} \${d} \${b+c} \${d} \${C}L\${w} \${h-p}c0 \${a} 0 \${A} \${-d} \${C}a\${r} \${r} 0 0 1 \${-L} \${L}c\${-c} \${d} \${-(b+c)} \${d} \${-C} \${d}L\${p} \${h}c\${-a} 0 \${-A} 0 \${-C} \${-d}a\${r} \${r} 0 0 1 \${-L} \${-L}c\${-d} \${-c} \${-d} \${-(b+c)} \${-d} \${-C}L0 \${p}c0 \${-a} 0 \${-A} \${d} \${-C}a\${r} \${r} 0 0 1 \${L} \${-L}c\${c} \${-d} \${b+c} \${-d} \${C} \${-d}Z\`}
document.getElementById('f').setAttribute('d',sq(22,22,7));
const T=window.TelegramWidget,tint=()=>{const c=(T&&T.themeParams.button_color)||getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-button-color').trim(),m=/^#?([\\da-f]{2})([\\da-f]{2})([\\da-f]{2})/i.exec(c);if(m)document.documentElement.style.setProperty('--a2','rgba('+m.slice(1).map(x=>parseInt(x,16))+',.16)')};
tint();T&&T.onEvent('themeChanged',tint);
const C=2*Math.PI*58;requestAnimationFrame(()=>document.getElementById('p').style.strokeDasharray=C*.73+' '+C);
</script>

REFERENCE: the number and chart archetype with its micro-interaction (tap or scrub a bar; the period top-right, the comparison as a column):
<style>
:root{--a:var(--tg-theme-button-color,#0A84FF);--a2:rgba(10,132,255,.16);--h:var(--tg-theme-hint-color)}
body{margin:0;padding:16px 16px max(16px,env(safe-area-inset-bottom));height:320px;box-sizing:border-box;display:flex;flex-direction:column;font-family:ui-rounded,system-ui;color:var(--tg-theme-text-color)}
.top{display:flex;justify-content:space-between;align-items:baseline}.ctx{font-size:15px;font-weight:600}.per{font-size:14px;color:var(--h)}
.hero{display:flex;justify-content:space-between;align-items:flex-end;margin-top:10px}
.n{font-size:48px;font-weight:600;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.n b{font-weight:inherit}.n span{font-size:22px;color:var(--h);margin-left:2px}
.cmp{text-align:right}.cmp b{display:block;font-size:17px;font-weight:500;font-variant-numeric:tabular-nums}.cmp i{font-style:normal;font-size:14px;color:var(--h)}
.up{color:light-dark(#C93400,#FF9F0A)}.dn{color:light-dark(#248A3D,#30D158)}
.ch{flex:1;display:flex;align-items:flex-end;gap:8px;margin-top:14px;touch-action:pan-y}
.c{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end}
.c i{width:100%;border-radius:6px;background:var(--a2);height:0;transition:height .6s ease-out,background .2s}
.c em{font-style:normal;font-size:12px;color:var(--h);transition:color .2s}
.c.on i{background:var(--a)}.c.on em{color:var(--tg-theme-text-color);font-weight:500}
</style>
<div class=top><div class=ctx>Токены</div><div class=per id=x>неделя</div></div>
<div class=hero><div class=n><b id=n>412</b><span>M</span></div><div class=cmp><b id=p></b><i id=q></i></div></div>
<div class=ch id=ch></div>
<script>
const D=[['пн','понедельник',58],['вт','вторник',84],['ср','среда',65],['чт','четверг',95],['пт','пятница',50],['сб','суббота',32],['вс','воскресенье',28]],TOT=412,AVG=59;
const $=id=>document.getElementById(id),ch=$('ch');let sel=-2,shown=TOT,raf=0;
ch.innerHTML=D.map(d=>'<div class=c><i></i><em>'+d[0]+'</em></div>').join('');
const bars=[...ch.children],max=Math.max(...D.map(d=>d[2]));
function roll(to){cancelAnimationFrame(raf);const from=shown,t0=performance.now();const f=t=>{const k=Math.min(1,(t-t0)/300),e=1-Math.pow(1-k,3);shown=Math.round(from+(to-from)*e);$('n').textContent=shown;if(k<1)raf=requestAnimationFrame(f)};raf=requestAnimationFrame(f)}
function show(i){if(i===sel)return;sel=i;bars.forEach((b,j)=>b.classList.toggle('on',j===i));
const cmp=(v,w)=>{$('p').textContent=(v>0?'+':'−')+Math.abs(v)+'%';$('p').className=v>0?'up':'dn';$('q').textContent=w};
if(i<0){$('x').textContent='неделя';cmp(-12,'к прошлой');roll(TOT)}
else{const d=D[i];$('x').textContent=d[1];cmp(Math.round((d[2]/AVG-1)*100),'к среднему дню');roll(d[2])}
window.TelegramWidget?.HapticFeedback?.selectionChanged?.()}
const at=e=>{const r=ch.getBoundingClientRect();return Math.max(0,Math.min(D.length-1,Math.floor((e.clientX-r.left)/r.width*D.length)))};
let down=-1,moved=false;
ch.addEventListener('pointerdown',e=>{down=at(e);moved=false;ch.setPointerCapture?.(e.pointerId)});
ch.addEventListener('pointermove',e=>{if(down<0)return;const i=at(e);if(i!==down||moved){moved=true;show(i)}});
ch.addEventListener('pointerup',e=>{if(down<0)return;if(!moved)show(sel===down?-1:down);down=-1});
ch.addEventListener('pointercancel',()=>{down=-1});
show(-1);requestAnimationFrame(()=>bars.forEach((b,i)=>b.firstChild.style.height=D[i][2]/max*100+'%'));
const T=window.TelegramWidget,tint=()=>{const c=(T&&T.themeParams.button_color)||getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-button-color').trim(),m=/^#?([\\da-f]{2})([\\da-f]{2})([\\da-f]{2})/i.exec(c);if(m)document.documentElement.style.setProperty('--a2','rgba('+m.slice(1).map(x=>parseInt(x,16))+',.16)')};tint();T&&T.onEvent('themeChanged',tint);
</script>`

const FALLBACK_RULES = `TELEGRAM'S RULES (their guide could not be loaded; the essentials)
- One self-contained HTML string, inline <style> and <script>, at most 32 KB and 4 KB after zlib level 9. No network, no external images or fonts, data: PNG/JPEG/GIF/WebP images only, no WebGL, no form controls (<button> only), no vh units, no overflow scrolling, no text-shadow, no 3D transforms, no canvas shadowBlur, no CSS nesting, no oklch or color-mix.
- The bubble: 200-600px wide (design for 320), at most 600px tall, clipped. Theme: --tg-theme-bg-color, --tg-theme-text-color, --tg-theme-hint-color, --tg-theme-button-color, --tg-theme-button-text-color, --tg-theme-secondary-bg-color; light-dark() works.
- Input: taps and pointer events, no keyboard. Vertical drags always scroll the chat: drag only sideways, with touch-action:pan-y (or none for holds); keep controls 20px from the left edge.
- At most 16 elements with a blurred shadow, filter, backdrop-filter or opacity below 1; 2 with backdrop-filter. Use document.getElementById, not ids as globals.`

export function createWidgetServer(h: { guide: () => Promise<string | null>, send: (p: WidgetRequest) => Promise<string> }) {
  return createSdkMcpServer({
    name: WIDGET_SERVER,
    tools: [
      tool('widget_guide', 'Telegram\'s rules for widgets and this bot\'s look for them. Read it before the first widget you write in a conversation.', {},
        async () => ({ content: [{ type: 'text' as const, text: `${(await h.guide()) ?? FALLBACK_RULES}\n\n${BOT_WIDGET_RULES}` }] })),
      tool(
        'send_widget',
        'Send a widget: an interactive HTML page drawn inside a message in this chat. Read widget_guide first.',
        {
          html: z.string().min(1).max(WIDGET_HTML_MAX).describe('One self-contained HTML document or fragment, inline <style> and <script>'),
          caption: z.string().max(200).optional().describe('A few words in the user\'s language under it: give one when the widget sends a value back, it names the value'),
          width: z.number().int().min(200).max(600).optional().describe('320: widgets are 320 wide'),
          height: z.number().int().min(50).max(600).optional().describe('320 for the square, the default shape; leave out to fit the content'),
        },
        async a => ({ content: [{ type: 'text' as const, text: await h.send(a) }] }),
      ),
    ],
    alwaysLoad: true,
  })
}

// In every turn of a private chat: when to reach for one, which is rarely. The rules themselves are read on demand
export const WIDGET_PROMPT = `

# Widgets
In this chat you can send a widget (send_widget): an interactive HTML page drawn inside a message. The default is a text answer; a widget is the exception, for what text can't do. The user doesn't want widgets for their own sake.
- A widget, only when one of these holds:
  - the user has to set something by hand and send it back: an easing curve, a colour, a timing, a pick among options that are judged by eye;
  - the answer is numbers whose shape is the point (a trend over days, shares of a whole, progress against a limit) and there are more than four of them;
  - the user asks for a widget.
- Text otherwise: words, reasons, steps, code, links, a yes or no, a short status, a list to read or copy, anything of four facts or fewer, any answer the user will reply to in words.
- Test before sending one: would the user tap it or read its shape at a glance? If not, write text. If unsure, write text.
- Never a widget as decoration of a text answer, never the same information as both, never two widgets in a row without the user asking. One short line of text with it says what it is for.
- Before the first widget in a conversation call widget_guide: the sandbox removes a lot silently, and a widget written without it breaks.`
