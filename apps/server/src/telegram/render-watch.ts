import { tr } from '../i18n.ts'

// A render Claude started in the background with aerender: the bot reads its log on the computer by itself and shows
// the progress, so Claude neither polls it nor spends a turn on it. In the private chat it is a widget that asks for
// fresh numbers while it is on screen; in a group, one message edited now and then

export const RENDER_QUERY = 'tgcv:r:'

// What aerender writes: the span in frames or as a timecode, then a line per frame done, then the end
export function parseAerender(log: string) {
  const fps = Number((/Frame Rate:\s*([\d.,]+)/.exec(log)?.[1] ?? '').replace(',', '.'))
  const total = framesOf(/Duration:\s*(\S+)/.exec(log)?.[1], fps)
  let frame = 0
  for (const m of log.matchAll(/^PROGRESS:\s+[\d:;+]+ \((\d+)\):/gm)) frame = Number(m[1])
  return {
    frame,
    total,
    done: /Finished composition/.test(log),
    // "aerender ERROR: …" before a render, "aerender Error: After Effects error: …" from inside one
    error: /aerender error:?\s*(?:After Effects error:\s*)?(.+)/i.exec(log)?.[1]?.trim(),
    output: /Output To:\s*(.+)/.exec(log)?.[1]?.trim(),
  }
}

function framesOf(d: string | undefined, fps: number) {
  if (!d) return undefined
  if (/^\d+$/.test(d)) return Number(d)
  const t = /^(\d+)[:;](\d+)[:;](\d+)[:;](\d+)$/.exec(d)
  if (!t || !fps) return undefined
  const [h, m, s, f] = t.slice(1).map(Number)
  return ((h * 60 + m) * 60 + s) * Math.round(fps) + f
}

// The app's answer to render-aerender, when it started one: its process and log
export function renderStarted(text: string) {
  try {
    const r = JSON.parse(text) as Record<string, unknown>
    if (typeof r.pid !== 'number' || r.pid <= 0 || typeof r.logPath !== 'string' || r.status === 'finished') return undefined
    return { pid: r.pid, log: r.logPath, comp: String(r.comp ?? ''), output: String(r.output ?? '') }
  } catch {
    return undefined
  }
}

// One command for bash on Windows (Git Bash) and macOS: is the process alive, then the head of the log (where the span
// is) and its tail (where the last frame is). Alive is asked first: a process gone by then has written all it will
export function readCommand(pid: number, log: string) {
  const q = `'${log.replace(/'/g, `'\\''`)}'`
  return [
    `if command -v tasklist >/dev/null 2>&1; then tasklist //FI "PID eq ${pid}" //NH 2>/dev/null | grep -qw ${pid} && echo A=1 || echo A=0; else kill -0 ${pid} 2>/dev/null && echo A=1 || echo A=0; fi`,
    `head -c 4000 ${q}; echo; echo '${CUT}'; tail -c 1500 ${q}`,
  ].join('\n')
}
const CUT = '<<<tgcv-tail>>>'

export function readOutput(stdout: string) {
  const alive = /^A=1/m.test(stdout)
  const [head, tail = ''] = stdout.replace(/^A=[01]\r?\n/m, '').split(CUT)
  return { alive, log: head + tail }
}

export type RenderState = 'run' | 'done' | 'fail'
export type RenderJob<W> = {
  id: string
  pid: number
  log: string
  comp: string
  output: string
  where: W
  state: RenderState
  frame: number
  total?: number
  startedAt: number
  endedAt?: number
  // The expected end, from the pace so far
  end?: number
  error?: string
  // The group message that shows it
  msgId?: number
}

type Read = { alive: boolean, log: string } | null

export function createRenderWatch<W>({ read, shown, changed, every = 5000, giveUpMs = 30 * 60_000, now = Date.now, auto = true }: {
  // null: the computer didn't answer this time
  read: (job: RenderJob<W>) => Promise<Read>
  shown: (job: RenderJob<W>) => void
  changed: (job: RenderJob<W>) => void
  every?: number
  // Without an answer from the computer this long, it is given up on
  giveUpMs?: number
  now?: () => number
  auto?: boolean
}) {
  const jobs = new Map<string, RenderJob<W>>()
  const pace = new Map<string, { frame: number, at: number }>()
  const lastHeard = new Map<string, number>()
  const timers = new Set<NodeJS.Timeout>()
  let seq = 0

  function next(job: RenderJob<W>) {
    if (!auto || job.state !== 'run') return
    const t = setTimeout(() => { timers.delete(t); void tick(job.id).then(() => next(job)) }, every)
    t.unref()
    timers.add(t)
  }

  async function tick(id: string) {
    const job = jobs.get(id)
    if (!job || job.state !== 'run') return
    const r = await read(job).catch(() => null)
    const t = now()
    if (!r) {
      if (t - (lastHeard.get(id) ?? job.startedAt) < giveUpMs) return
      Object.assign(job, { state: 'fail', endedAt: t, end: undefined, error: tr('The computer stopped answering', 'Компьютер перестал отвечать') })
      return void changed(job)
    }
    lastHeard.set(id, t)
    const p = parseAerender(r.log)
    const before = `${job.state}${job.frame}${job.total}`
    job.total = p.total ?? job.total
    job.output = p.output ?? job.output
    if (p.frame !== job.frame) {
      // The pace from the first frame seen: the first ones are slow while aerender warms up, so it settles as it goes
      const first = pace.get(id)
      if (!first) pace.set(id, { frame: p.frame, at: t })
      else if (job.total && p.frame > first.frame) job.end = t + ((job.total - p.frame) * (t - first.at)) / (p.frame - first.frame)
      job.frame = p.frame
    }
    if (p.done) Object.assign(job, { state: 'done', endedAt: t, end: undefined, frame: job.total ?? job.frame })
    else if (!r.alive) Object.assign(job, { state: 'fail', endedAt: t, end: undefined, error: p.error ?? tr('aerender stopped before the end', 'aerender остановился до конца') })
    if (`${job.state}${job.frame}${job.total}` !== before) changed(job)
  }

  return {
    start(info: { pid: number, log: string, comp: string, output: string }, where: W) {
      const job: RenderJob<W> = { id: (++seq).toString(36) + now().toString(36).slice(-4), ...info, where, state: 'run', frame: 0, startedAt: now() }
      jobs.set(job.id, job)
      shown(job)
      next(job)
      return job
    },
    get: (id: string) => jobs.get(id),
    tick,
    stop() {
      for (const t of timers) clearTimeout(t)
      timers.clear()
    },
  }
}
export type RenderWatch<W> = ReturnType<typeof createRenderWatch<W>>

const base = (p: string) => p.split(/[\\/]/).pop() ?? p

// What the widget gets, at first and then for each of its questions: seconds, short keys
export function renderAnswer(j: RenderJob<unknown>) {
  const s = (ms?: number) => (ms ? Math.round(ms / 1000) : 0)
  return JSON.stringify({ s: j.state, f: j.frame, n: j.total ?? 0, a: s(j.startedAt), e: s(j.endedAt), z: s(j.end), x: j.error ?? '', o: base(j.output) })
}

const clock = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

// The group's message
export function renderLine(j: RenderJob<unknown>, now = Date.now()) {
  const name = j.comp || base(j.output)
  if (j.state === 'done') return tr(`✅ Render «${name}» is done in ${clock(Math.round((j.endedAt! - j.startedAt) / 1000))}: ${base(j.output)}`, `✅ Рендер «${name}» готов за ${clock(Math.round((j.endedAt! - j.startedAt) / 1000))}: ${base(j.output)}`)
  if (j.state === 'fail') return tr(`⚠️ Render «${name}» failed: ${j.error}`, `⚠️ Рендер «${name}» не удался: ${j.error}`)
  const pct = j.total ? `${Math.floor((j.frame / j.total) * 100)}% (${j.frame}/${j.total})` : tr(`frame ${j.frame}`, `кадр ${j.frame}`)
  const left = j.end ? tr(`, about ${clock(Math.max(0, Math.round((j.end - now) / 1000)))} left`, `, осталось около ${clock(Math.max(0, Math.round((j.end - now) / 1000)))}`) : ''
  return tr(`🎬 Render «${name}»: ${pct}${left}`, `🎬 Рендер «${name}»: ${pct}${left}`)
}

export function renderWidgetHtml(j: RenderJob<unknown>) {
  const t = {
    of: tr('of', 'из'), frame: tr('frame', 'кадр'), done: tr('Done', 'Готово'), fail: tr('Failed', 'Ошибка'),
    left: tr('Left', 'Осталось'), took: tr('Took', 'Заняло'), file: tr('File', 'Файл'), what: tr('What went wrong', 'Что не так'), wait: tr('counting', 'считаю'),
  }
  // Inside a script element: nothing in the names may close it
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')
  return `<style>
:root{--a:var(--tg-theme-button-color,#0A84FF);--a2:rgba(10,132,255,.16);--h:var(--tg-theme-hint-color);--w:light-dark(#C93400,#FF9F0A);--w2:rgba(255,149,0,.16);--ok:light-dark(#248A3D,#30D158);--ok2:rgba(52,199,89,.16)}
body{margin:0;padding:16px 16px 30px;box-sizing:border-box;height:320px;display:flex;flex-direction:column;font-family:ui-rounded,system-ui;color:var(--tg-theme-text-color)}
.top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.ctx{font-size:17px;font-weight:600}.hint{font-size:14px;color:var(--h);font-variant-numeric:tabular-nums}
.nm{font-size:14px;color:var(--h);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.rg{position:relative;width:150px;height:150px;margin:auto;align-self:center}
.rg svg.r{width:150px;height:150px;transform:rotate(-90deg)}
.rg circle{fill:none;stroke-width:12;stroke-linecap:round;transition:stroke .3s}
.rg .p{transition:stroke-dasharray .8s ease-out,stroke .3s}
.mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.mid b{font-size:34px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.1}
.mid i{font-style:normal;font-size:13px;color:var(--h);margin-top:4px;font-variant-numeric:tabular-nums}
.ic{width:38px;height:38px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.ft{display:flex;gap:16px}.ft div{flex:1;min-width:0}
.ft span{display:block;font-size:13px;color:var(--h)}
.ft b{display:block;font-size:16px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.ft b.x{white-space:normal;font-size:14px;line-height:18px;max-height:36px}
</style>
<div class=top><div class=ctx>${tr('Render', 'Рендер')}</div><div class=hint id=el></div></div>
<div class=nm id=nm></div>
<div class=rg><svg class=r viewBox="0 0 150 150"><circle id=bg cx="75" cy="75" r="63"/><circle class=p id=p cx="75" cy="75" r="63" style="stroke-dasharray:0 999"/></svg><div class=mid id=mid></div></div>
<div class=ft id=ft></div>
<script>
const Q=${json(RENDER_QUERY + j.id)},L=${json(t)},T=window.TelegramWidget,$=id=>document.getElementById(id),esc=x=>String(x).replace(/[&<>"]/g,c=>'&#'+c.charCodeAt(0)+';'),C=2*Math.PI*63;
let J=${renderAnswer(j)};
$('nm').textContent=${json(j.comp || base(j.output))};
const clk=s=>{s=Math.max(0,Math.round(s));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60,p=n=>String(n).padStart(2,'0');return h?h+':'+p(m)+':'+p(x):m+':'+p(x)};
const now=()=>Date.now()/1e3;
const I={c:'<path d="M20 6 9 17l-5-5"/>',x:'<path d="M12 8v5M12 16.5v.5"/>'};
function draw(){const s=J.s,k=s==='done'?['var(--ok)','var(--ok2)']:s==='fail'?['var(--w)','var(--w2)']:['var(--a)','var(--a2)'];
$('bg').style.stroke=k[1];const p=$('p');p.style.stroke=k[0];
const v=s==='done'?1:J.n?Math.min(1,J.f/J.n):0;p.style.strokeDasharray=C*Math.min(v,.9999)+' '+C;p.style.opacity=v>0?1:0;
$('mid').innerHTML=s==='run'?'<b>'+(J.n?Math.floor(v*100)+'%':J.f)+'</b><i>'+(J.n?J.f+' '+L.of+' '+J.n:L.frame)+'</i>':'<svg class=ic viewBox="0 0 24 24" style="color:'+k[0]+'">'+(s==='done'?I.c:I.x)+'</svg><i>'+(s==='done'?L.done:L.fail)+'</i>';
$('ft').innerHTML=s==='fail'?'<div><span>'+L.what+'</span><b class=x>'+esc(J.x)+'</b></div>':'<div><span>'+(s==='done'?L.took:L.left)+'</span><b id=lf></b></div><div><span>'+L.file+'</span><b>'+esc(J.o)+'</b></div>';
tick()}
function tick(){$('el').textContent=clk((J.e||now())-J.a);const lf=$('lf');if(lf)lf.textContent=J.s==='done'?clk(J.e-J.a):J.z?'~'+clk(J.z-now()):L.wait}
let busy=false;const ask=()=>{if(!T||busy||J.s!=='run'||document.hidden)return;busy=true;T.request(Q).then(a=>{busy=false;try{const d=JSON.parse(a.result);if(d.s){const was=J.s;J=d;draw();if(was==='run'&&d.s!=='run')T.HapticFeedback?.notificationOccurred?.(d.s==='done'?'success':'error')}}catch{}},()=>{busy=false})};
let n=0;requestAnimationFrame(draw);ask();setInterval(()=>{tick();if(++n%5===0)ask()},1000);
const tint=()=>{const c=(T&&T.themeParams.button_color)||getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-button-color').trim(),m=/^#?([\\da-f]{2})([\\da-f]{2})([\\da-f]{2})/i.exec(c);if(m)document.documentElement.style.setProperty('--a2','rgba('+m.slice(1).map(x=>parseInt(x,16))+',.16)')};tint();T&&T.onEvent('themeChanged',tint);
</script>`
}
