import { tr } from '../i18n.ts'

// The morning card of a night shift in the private chat: what got done of it, how long it took, what it cost of the
// week, and the items themselves. The head's summary above it says the rest in words
export type NightCard = {
  from: number
  to: number
  zone: string
  finished: string[]
  left: string[]
  // Points of the week's limit the night took, when both ends of it are known
  weekPoints?: number
  // The night ran on several profiles: each one's points instead
  byProfile?: { name: string, points: number }[]
  power: 'on' | 'sleep' | 'off'
}

const clock = (t: number, zone: string) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(t)

const span = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000)), h = Math.floor(m / 60)
  return h ? (m % 60 ? tr(`${h} h ${m % 60} min`, `${h} ч ${m % 60} мин`) : tr(`${h} h`, `${h} ч`)) : tr(`${m} min`, `${m} мин`)
}

export function nightWidgetHtml(c: NightCard) {
  const total = c.finished.length + c.left.length
  const pct = (n: number) => `+${Math.max(0, Math.round(n))}%`
  const stats = [
    [tr('Took', 'Длилась'), span(c.to - c.from)],
    ...(c.byProfile?.length
      ? c.byProfile.slice(0, 3).map(p => [tr(`Week, ${p.name}`, `Неделя, ${p.name}`), pct(p.points)])
      : [c.weekPoints !== undefined
        ? [tr('Week\'s limit', 'Лимит недели'), pct(c.weekPoints)]
        : [tr('Computers', 'Компьютеры'), c.power === 'off' ? tr('turned off', 'выключены') : c.power === 'sleep' ? tr('asleep', 'спят') : tr('left on', 'включены')]]),
  ]
  const data = {
    f: c.finished.slice(0, 12), l: c.left.slice(0, 12),
    t: { f: tr('Done', 'Сделано'), l: tr('Left', 'Осталось') },
  }
  // Inside a script element: nothing in the items may close it
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  const esc = (s: string) => s.replace(/[&<>"]/g, ch => `&#${ch.charCodeAt(0)};`)
  const R = 27, C = 2 * Math.PI * R, v = total ? c.finished.length / total : 0
  return `<style>
:root{--a:var(--tg-theme-button-color,#0A84FF);--h:var(--tg-theme-hint-color);--w:light-dark(#C93400,#FF9F0A);--w2:rgba(255,149,0,.16);--ok:light-dark(#248A3D,#30D158);--ok2:rgba(52,199,89,.16)}
body{margin:0;padding:16px 16px 30px;box-sizing:border-box;font-family:ui-rounded,system-ui;color:var(--tg-theme-text-color)}
.top{display:flex;justify-content:space-between;align-items:baseline}
.ctx{font-size:17px;font-weight:600}.hint{font-size:14px;color:var(--h);font-variant-numeric:tabular-nums}
.hd{display:flex;align-items:center;gap:16px;margin-top:12px}
.rg{position:relative;width:64px;height:64px;flex:none}
.rg svg{width:64px;height:64px;transform:rotate(-90deg)}
.rg circle{fill:none;stroke-width:7;stroke-linecap:round}
.rg .p{transition:stroke-dasharray .8s ease-out}
.rg b{position:absolute;inset:0;display:grid;place-items:center;font-size:16px;font-weight:600;font-variant-numeric:tabular-nums}
.st{flex:1;min-width:0;display:grid;gap:4px}
.st div{display:flex;justify-content:space-between;gap:8px;font-size:15px}
.st span{color:var(--h)}.st b{font-weight:500;white-space:nowrap}
.sg{display:flex;margin-top:12px;padding:2px;border-radius:9px;background:rgba(128,128,128,.16);touch-action:pan-y}
.sg button{flex:1;height:26px;border:0;border-radius:7px;background:none;color:inherit;font:inherit;font-size:13px;font-weight:500}
.sg button.on{background:var(--tg-theme-bg-color,#fff);box-shadow:0 1px 3px rgba(0,0,0,.18)}
.sec{margin-top:12px;font-size:15px;font-weight:600}
.l{margin-top:4px}
.row{display:flex;align-items:center;gap:10px;height:32px}
.bd{position:relative;flex:none;width:22px;height:22px;display:grid;place-items:center}
.bd svg.f{position:absolute;inset:0;width:22px;height:22px}
.ic{position:relative;width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.row span{flex:1;min-width:0;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row em{font-style:normal;font-size:14px;color:var(--h)}
</style>
<div class=top><div class=ctx>${tr('Night shift', 'Ночная смена')}</div><div class=hint>${clock(c.from, c.zone)}–${clock(c.to, c.zone)}</div></div>
<div class=hd><div class=rg><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="${R}" style="stroke:var(--ok2)"/><circle class=p id=p cx="32" cy="32" r="${R}" style="stroke:var(--ok);stroke-dasharray:0 ${C}"/></svg><b>${c.finished.length}/${total}</b></div>
<div class=st>${stats.map(([k, x]) => `<div><span>${esc(k)}</span><b>${esc(x)}</b></div>`).join('')}</div></div>
${c.finished.length && c.left.length ? '<div class=sg id=sg><button data-k=f></button><button data-k=l></button></div>' : `<div class=sec>${c.left.length ? tr('Left', 'Осталось') : tr('Done', 'Сделано')}</div>`}
<div class=l id=l></div>
<script>
${SQ}
const U=${json},T=window.TelegramWidget,$=id=>document.getElementById(id),esc=x=>String(x).replace(/[&<>"]/g,c=>'&#'+c.charCodeAt(0)+';'),D=sq(22,22,6);
const I={f:'<path d="M20 6 9 17l-5-5"/>',l:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'},K={f:['var(--ok)','var(--ok2)'],l:['var(--w)','var(--w2)']};
const MAX=4;
function show(k){const r=U[k],n=r.length>MAX?MAX-1:MAX;
$('l').innerHTML=r.slice(0,n).map(x=>'<div class=row><div class=bd style="color:'+K[k][0]+'"><svg class=f><path style="fill:'+K[k][1]+'" d="'+D+'"/></svg><svg class=ic viewBox="0 0 24 24">'+I[k]+'</svg></div><span>'+esc(x)+'</span></div>').join('')+(r.length>n?'<div class=row><em>+'+(r.length-n)+'</em></div>':'');
const sg=$('sg');if(sg)[...sg.children].forEach(b=>{b.classList.toggle('on',b.dataset.k===k);b.textContent=U.t[b.dataset.k]+' '+U[b.dataset.k].length})}
const sg=$('sg');if(sg)sg.addEventListener('click',e=>{const k=e.target.dataset&&e.target.dataset.k;if(k){show(k);T?.HapticFeedback?.selectionChanged?.()}});
show(U.f.length?'f':'l');
requestAnimationFrame(()=>{$('p').style.opacity=${v ? 1 : 0};$('p').style.strokeDasharray='${C * Math.min(v, .9999)} ${C}'});
</script>`
}

const SQ = 'function sq(w,h,r,s=.6){const B=Math.min(w,h)/2;r=Math.min(r,B);const p=Math.min((1+s)*r,B);s=Math.min(s,B/r-1);const R=Math.PI/180,am=90*(1-s),L=Math.sin(am/2*R)*r*Math.SQRT2,al=(90-am)/2,t=r*Math.tan(al/2*R),be=45*s,c=t*Math.cos(be*R),d=c*Math.tan(be*R),b=(p-L-c-d)/3,a=2*b,A=a+b,C=A+c;return`M${w-p} 0c${a} 0 ${A} 0 ${C} ${d}a${r} ${r} 0 0 1 ${L} ${L}c${d} ${c} ${d} ${b+c} ${d} ${C}L${w} ${h-p}c0 ${a} 0 ${A} ${-d} ${C}a${r} ${r} 0 0 1 ${-L} ${L}c${-c} ${d} ${-(b+c)} ${d} ${-C} ${d}L${p} ${h}c${-a} 0 ${-A} 0 ${-C} ${-d}a${r} ${r} 0 0 1 ${-L} ${-L}c${-d} ${-c} ${-d} ${-(b+c)} ${-d} ${-C}L0 ${p}c0 ${-a} 0 ${-A} ${d} ${-C}a${r} ${r} 0 0 1 ${L} ${-L}c${c} ${-d} ${b+c} ${-d} ${C} ${-d}Z`}'
