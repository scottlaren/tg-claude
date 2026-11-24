import { tr } from '../i18n.ts'

// /usage in the private chat as a widget: the limit windows as rings, the week's spending by day as bars, the
// costliest topics under them. A tap on a day shows that day's topics. The data goes inside the HTML: this bot never
// edits a widget's state, and the time left to a reset is counted where it is read, so it stays right
export type UsageWidget = {
  plan: string
  windows: { label: string, pct: number, resetsAt?: number }[]
  // A topic by its own name, and where it is under it: never joined into one line
  days: { day: string, total: number, topics: { name: string, place?: string, units: number }[] }[]
  week: { name: string, place?: string, share: number }[]
}

const SHORT = () => tr('Sun Mon Tue Wed Thu Fri Sat', 'вс пн вт ср чт пт сб').split(' ')
const LONG = () => tr('Sunday Monday Tuesday Wednesday Thursday Friday Saturday', 'воскресенье понедельник вторник среда четверг пятница суббота').split(' ')

export function usageWidgetHtml(u: UsageWidget) {
  const days = u.days.map(d => {
    const w = new Date(`${d.day}T12:00:00Z`).getUTCDay()
    return { s: SHORT()[w], l: LONG()[w], v: d.total, t: d.topics.map(x => [x.name, d.total ? Math.round((x.units / d.total) * 100) : 0, x.place ?? '']) }
  })
  const data = {
    w: u.windows.slice(0, 3).map(x => [x.label, Math.round(x.pct), x.resetsAt ?? 0]),
    d: days,
    k: u.week.slice(0, 3).map(x => [x.name, Math.round(x.share * 100), x.place ?? '']),
    t: { week: tr('week', 'неделя'), in: tr('in', 'через'), h: tr('h', 'ч'), m: tr('min', 'мин'), dd: tr('d', 'д'), now: tr('now', 'сейчас') },
  }
  // Inside a script element: nothing in the names may close it
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  const spent = days.some(d => d.v > 0)
  return `<style>
:root{--a:var(--tg-theme-button-color,#0A84FF);--a2:rgba(10,132,255,.16);--h:var(--tg-theme-hint-color);--w:light-dark(#C93400,#FF9F0A);--w2:rgba(255,149,0,.16)}
body{margin:0;padding:16px 16px max(16px,env(safe-area-inset-bottom));box-sizing:border-box;font-family:ui-rounded,system-ui;color:var(--tg-theme-text-color)}
.top,.sec{display:flex;justify-content:space-between;align-items:baseline}
.ctx{font-size:17px;font-weight:600}.hint{font-size:14px;color:var(--h)}
.rs{display:flex;justify-content:space-around;margin-top:14px}
.r{text-align:center;width:90px}
.rg{position:relative;width:64px;height:64px;margin:0 auto}
.rg svg{width:64px;height:64px;transform:rotate(-90deg)}
.rg circle{fill:none;stroke-width:7;stroke-linecap:round}
.rg .p{transition:stroke-dasharray .8s ease-out}
.rg b{position:absolute;inset:0;display:grid;place-items:center;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}
.r .t{font-size:14px;font-weight:500;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.r .s{font-size:13px;color:var(--h)}
.sec{margin-top:18px}.sec b{font-size:15px;font-weight:600}
.ch{display:flex;align-items:flex-end;gap:8px;height:84px;margin-top:10px;touch-action:pan-y}
.c{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%;justify-content:flex-end}
.c i{width:100%;min-height:3px;border-radius:5px;background:var(--a2);height:0;transition:height .6s ease-out,background .2s}
.c em{font-style:normal;font-size:12px;color:var(--h)}
.c.on i{background:var(--a)}.c.on em{color:var(--tg-theme-text-color);font-weight:500}
.l{margin-top:8px}
.row{display:flex;align-items:center;gap:10px;height:44px}.row div{flex:1;min-width:0}
.row+.row{border-top:1px solid rgba(128,128,128,.22)}
.row b,.row i{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row b{font-size:15px;font-weight:500}.row i{font-style:normal;font-size:13px;color:var(--h)}
.row em{font-style:normal;font-size:14px;color:var(--h);font-variant-numeric:tabular-nums}
</style>
<div class=top><div class=ctx>${tr('Limits', 'Лимиты')}</div><div class=hint id=pl></div></div>
<div class=rs id=rs></div>
${spent ? `<div class=sec><b>${tr('Spent', 'Расход')}</b><span class=hint id=per></span></div>
<div class=ch id=ch></div>
<div class=l id=l></div>` : ''}
<script>
const U=${json},$=id=>document.getElementById(id),T=window.TelegramWidget,esc=s=>String(s).replace(/[&<>"]/g,c=>'&#'+c.charCodeAt(0)+';');
$('pl').textContent=${JSON.stringify(u.plan)};
const rel=ms=>{const m=Math.round((ms-Date.now())/6e4);if(m<=0)return U.t.now;if(m<60)return U.t.in+' '+m+' '+U.t.m;const h=Math.floor(m/60);return h<48?U.t.in+' '+h+' '+U.t.h:U.t.in+' '+Math.round(h/24)+' '+U.t.dd};
const C=2*Math.PI*28;
$('rs').innerHTML=U.w.map(w=>{const hot=w[1]>=70;return'<div class=r><div class=rg><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" style="stroke:'+(hot?'var(--w2)':'var(--a2)')+'"/><circle class=p cx="32" cy="32" r="28" data-v="'+w[1]+'" style="stroke:'+(hot?'var(--w)':'var(--a)')+';stroke-dasharray:0 '+C+'"/></svg><b>'+w[1]+'</b></div><div class=t>'+esc(w[0])+'</div><div class=s>'+(w[2]?rel(w[2]):'')+'</div></div>'}).join('');
const ch=$('ch');let sel=-2;
if(ch){const max=Math.max(...U.d.map(d=>d.v))||1;
ch.innerHTML=U.d.map(d=>'<div class=c><i></i><em>'+esc(d.s)+'</em></div>').join('');
const bars=[...ch.children];
const list=r=>$('l').innerHTML=r.map(x=>'<div class=row><div><b>'+esc(x[0])+'</b>'+(x[2]?'<i>'+esc(x[2])+'</i>':'')+'</div><em>'+x[1]+'%</em></div>').join('');
const show=i=>{if(i===sel)return;sel=i;bars.forEach((b,j)=>b.classList.toggle('on',j===i));if(i<0){$('per').textContent=U.t.week;list(U.k)}else{$('per').textContent=U.d[i].l;list(U.d[i].t)}T?.HapticFeedback?.selectionChanged?.()};
const at=e=>{const r=ch.getBoundingClientRect();return Math.max(0,Math.min(6,Math.floor((e.clientX-r.left)/r.width*7)))};
let down=-1,moved=false;
ch.addEventListener('pointerdown',e=>{down=at(e);moved=false;ch.setPointerCapture?.(e.pointerId)});
ch.addEventListener('pointermove',e=>{if(down<0)return;const i=at(e);if(i!==down||moved){moved=true;show(i)}});
ch.addEventListener('pointerup',()=>{if(down<0)return;if(!moved)show(sel===down?-1:down);down=-1});
ch.addEventListener('pointercancel',()=>{down=-1});
show(-1);requestAnimationFrame(()=>bars.forEach((b,i)=>b.firstChild.style.height=U.d[i].v/max*100+'%'))}
requestAnimationFrame(()=>document.querySelectorAll('.rg .p').forEach(c=>c.style.strokeDasharray=C*c.dataset.v/100+' '+C));
const tint=()=>{const c=(T&&T.themeParams.button_color)||getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-button-color').trim(),m=/^#?([\\da-f]{2})([\\da-f]{2})([\\da-f]{2})/i.exec(c);if(m)document.documentElement.style.setProperty('--a2','rgba('+m.slice(1).map(x=>parseInt(x,16))+',.16)')};tint();T&&T.onEvent('themeChanged',tint);
</script>`
}
