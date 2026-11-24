import { tr } from '../i18n.ts'

// /now in the private chat as a widget that keeps itself current: while it is on screen it asks the bot for the
// rows again (Telegram lets a widget there ask without a tap, at most every 5 seconds), and the bot answers with them.
// An answer holds at most 1024 bytes, so the rows are short and few, and what doesn't fit is a count
// What the widget asks with: one any widget of this bot may send, so it is answered after a restart too
export const NOW_QUERY = 'tgcv:now'
export type NowRow = { kind: 'wait' | 'run' | 'queue', what: string, topic: string, link?: string, since?: number }
// [kind, what, topic, link, since]: arrays, since names in Cyrillic take two bytes a letter
type Packed = [0 | 1 | 2, string, string, string, number]

const ROWS_MAX = 6
const ANSWER_MAX = 1024
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const pack = (r: NowRow): Packed => [r.kind === 'wait' ? 0 : r.kind === 'run' ? 1 : 2, cut(r.what, 34), cut(r.topic, 26), r.link ?? '', r.since ? Math.floor(r.since / 1000) : 0]

// Waiting first: that is where a tap is needed
export function nowRows(rows: NowRow[], max = ROWS_MAX) {
  const order = { wait: 0, run: 1, queue: 2 }
  const sorted = [...rows].sort((a, b) => order[a.kind] - order[b.kind])
  return { r: sorted.slice(0, max).map(pack), more: Math.max(0, sorted.length - max) }
}

// The answer to the widget's own request: as many rows as fit in Telegram's 1024 bytes
export function nowAnswer(rows: NowRow[]) {
  for (let max = ROWS_MAX; max >= 0; max--) {
    const json = JSON.stringify(nowRows(rows, max))
    if (Buffer.byteLength(json) <= ANSWER_MAX) return json
  }
  return JSON.stringify({ r: [], more: rows.length })
}

export function nowWidgetHtml(rows: NowRow[]) {
  const t = {
    sec: [tr('Waiting for you', 'Ждут тебя'), tr('Running', 'Работают'), tr('Queued', 'В очереди')],
    none: tr('Nothing runs and nothing waits for you', 'Ничего не идёт и ничего не ждёт тебя'),
    more: tr('more', 'ещё'), m: tr('min', 'мин'), h: tr('h', 'ч'),
  }
  const json = JSON.stringify({ d: nowRows(rows), t }).replace(/</g, '\\u003c')
  return `<style>
:root{--a:var(--tg-theme-button-color,#0A84FF);--a2:rgba(10,132,255,.16);--h:var(--tg-theme-hint-color);--w:light-dark(#C93400,#FF9F0A);--w2:rgba(255,149,0,.16);--ok:light-dark(#248A3D,#30D158)}
body{margin:0;padding:16px 16px max(14px,env(safe-area-inset-bottom));box-sizing:border-box;font-family:ui-rounded,system-ui;color:var(--tg-theme-text-color)}
.top{display:flex;justify-content:space-between;align-items:baseline}
.ctx{font-size:17px;font-weight:600}.upd{font-size:14px;color:var(--h)}
.sec{display:flex;justify-content:space-between;align-items:baseline;margin-top:16px}
.sec b{font-size:15px;font-weight:600}.sec span{font-size:14px;color:var(--h)}
.row{display:flex;align-items:center;gap:12px;height:50px}
.row+.row .tx{border-top:1px solid rgba(128,128,128,.22)}
.bd{position:relative;flex:none;width:28px;height:28px;display:grid;place-items:center}
.bd svg.f{position:absolute;inset:0;width:28px;height:28px}
.ic{position:relative;width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.tx{flex:1;display:flex;align-items:center;gap:8px;height:100%;min-width:0}
.tx div{flex:1;min-width:0}
.tx b,.tx i{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tx b{font-size:16px;font-weight:500}.tx i{font-style:normal;font-size:13px;color:var(--h)}
.tx em{font-style:normal;font-size:14px;color:var(--h);font-variant-numeric:tabular-nums}
.ch{width:14px;height:14px;color:var(--h)}
.none{display:flex;align-items:center;gap:12px;margin-top:14px;font-size:15px;color:var(--h)}
.more{margin-top:8px;font-size:14px;color:var(--h)}
</style>
<div class=top><div class=ctx>${tr('Now', 'Сейчас')}</div><div class=upd id=up></div></div>
<div id=l></div>
<script>
${SQ}
const NOW_QUERY=${JSON.stringify(NOW_QUERY)},U=${json},T=window.TelegramWidget,$=id=>document.getElementById(id),esc=x=>String(x).replace(/[&<>"]/g,c=>'&#'+c.charCodeAt(0)+';'),D=sq(28,28,8);
const I={0:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',1:'<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/>',2:'<path d="M3 12h18M3 6h18M3 18h18"/>',c:'<path d="M20 6 9 17l-5-5"/>',n:'<path d="m9 18 6-6-6-6"/>'};
const C=[['var(--w)','var(--w2)'],['var(--a)','var(--a2)'],['var(--tg-theme-hint-color)','rgba(128,128,128,.16)']];
const ago=s=>{const m=Math.max(0,Math.round((Date.now()/1e3-s)/60));return m<60?m+' '+U.t.m:Math.floor(m/60)+' '+U.t.h+(m%60?' '+m%60+' '+U.t.m:'')};
const badge=(k,ic)=>'<div class=bd style="color:'+C[k][0]+'"><svg class=f><path style="fill:'+C[k][1]+'" d="'+D+'"/></svg><svg class=ic viewBox="0 0 24 24">'+ic+'</svg></div>';
let rows=[];
function draw(d){rows=d.r;const l=$('l');
if(!rows.length){l.innerHTML='<div class=none>'+badge(0,I.c).replace('var(--w)','var(--ok)').replace('var(--w2)','rgba(52,199,89,.16)')+esc(U.t.none)+'</div>';return}
let h='';[0,1,2].forEach(k=>{const g=rows.filter(r=>r[0]===k);if(!g.length)return;
h+='<div class=sec><b>'+esc(U.t.sec[k])+'</b><span>'+g.length+'</span></div>';
h+=g.map(r=>'<div class=row data-i="'+rows.indexOf(r)+'">'+badge(k,I[k])+'<div class=tx><div><b>'+esc(r[1])+'</b><i>'+esc(r[2])+'</i></div>'+(r[4]?'<em data-s="'+r[4]+'">'+ago(r[4])+'</em>':'')+(r[3]?'<svg class="ic ch" viewBox="0 0 24 24">'+I.n+'</svg>':'')+'</div></div>').join('')});
if(d.more)h+='<div class=more>'+esc(U.t.more)+' '+d.more+'</div>';
l.innerHTML=h;
l.querySelectorAll('.row').forEach(e=>e.addEventListener('click',()=>{const r=rows[+e.dataset.i];if(r&&r[3]&&T)T.openTelegramLink(r[3])}))}
const stamp=()=>{$('up').textContent=new Date().toLocaleTimeString(navigator.language,{hour:'2-digit',minute:'2-digit'})};
draw(U.d);stamp();
const tick=()=>document.querySelectorAll('em[data-s]').forEach(e=>e.textContent=ago(+e.dataset.s));
let busy=false;const ask=()=>{if(!T||busy||document.hidden)return;busy=true;T.request(NOW_QUERY).then(a=>{busy=false;try{draw(JSON.parse(a.result));stamp()}catch{}},()=>{busy=false})};
ask();setInterval(()=>{tick();ask()},15000);
const tint=()=>{const c=(T&&T.themeParams.button_color)||getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-button-color').trim(),m=/^#?([\\da-f]{2})([\\da-f]{2})([\\da-f]{2})/i.exec(c);if(m)document.documentElement.style.setProperty('--a2','rgba('+m.slice(1).map(x=>parseInt(x,16))+',.16)')};tint();T&&T.onEvent('themeChanged',tint);
</script>`
}

const SQ = 'function sq(w,h,r,s=.6){const B=Math.min(w,h)/2;r=Math.min(r,B);const p=Math.min((1+s)*r,B);s=Math.min(s,B/r-1);const R=Math.PI/180,am=90*(1-s),L=Math.sin(am/2*R)*r*Math.SQRT2,al=(90-am)/2,t=r*Math.tan(al/2*R),be=45*s,c=t*Math.cos(be*R),d=c*Math.tan(be*R),b=(p-L-c-d)/3,a=2*b,A=a+b,C=A+c;return`M${w-p} 0c${a} 0 ${A} 0 ${C} ${d}a${r} ${r} 0 0 1 ${L} ${L}c${d} ${c} ${d} ${b+c} ${d} ${C}L${w} ${h-p}c0 ${a} 0 ${A} ${-d} ${C}a${r} ${r} 0 0 1 ${-L} ${L}c${-c} ${d} ${-(b+c)} ${d} ${-C} ${d}L${p} ${h}c${-a} 0 ${-A} 0 ${-C} ${-d}a${r} ${r} 0 0 1 ${-L} ${-L}c${-d} ${-c} ${-d} ${-(b+c)} ${-d} ${-C}L0 ${p}c0 ${-a} 0 ${-A} ${d} ${-C}a${r} ${r} 0 0 1 ${L} ${-L}c${c} ${-d} ${b+c} ${-d} ${C} ${-d}Z`}'
