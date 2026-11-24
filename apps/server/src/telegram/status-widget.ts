import { tr } from '../i18n.ts'

// /status in the private chat as a widget: the topic's state as a pill, its computer, project, model and permissions
// as four platters, the profile and quiet mode under them. A tap on a platter shows its detail in place
export type StatusWidget = {
  state: { label: string, tone: 'ok' | 'busy' | 'wait' }
  tiles: { icon: 'pc' | 'mac' | 'cloud' | 'folder' | 'brain' | 'shield', label: string, value: string, sub?: string, more?: string, dot?: 'ok' | 'off' }[]
  foot: [string, string][]
}

const ICON = {
  pc: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
  mac: '<rect width="18" height="12" x="3" y="4" rx="2"/><path d="M2 20h20"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  brain: '<path d="M12 18V5"/><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/><path d="M18 18a4 4 0 0 0 2-7.464"/><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/><path d="M6 18a4 4 0 0 1-2-7.464"/><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
}

export function statusWidgetHtml(s: StatusWidget) {
  const data = { s: s.state, t: s.tiles.slice(0, 4), f: s.foot.slice(0, 2), i: ICON }
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return `<style>
:root{--a:var(--tg-theme-button-color,#0A84FF);--a2:rgba(10,132,255,.16);--h:var(--tg-theme-hint-color)}
body{margin:0;padding:11px 11px max(11px,env(safe-area-inset-bottom));height:320px;box-sizing:border-box;display:flex;flex-direction:column;font-family:ui-rounded,system-ui;color:var(--tg-theme-text-color)}
.top{display:flex;justify-content:space-between;align-items:center;padding:5px 5px 0}
.ctx{font-size:17px;font-weight:600}
.pill{font-size:13px;font-weight:500;padding:3px 10px;border-radius:11px}
.g{flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:8px;margin-top:10px}
.p{position:relative;padding:11px 12px;display:flex;flex-direction:column;min-width:0}
.p>svg.f{position:absolute;inset:0;width:100%;height:100%;fill:var(--a2)}
.p>*{position:relative}
.ic{width:20px;height:20px;color:var(--a);fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.dot{position:absolute;top:14px;right:14px;width:8px;height:8px;border-radius:4px}
.lb{margin-top:auto;font-size:13px;color:var(--h)}
.v{font-size:15px;font-weight:500;line-height:1.25}
.sb{font-size:13px;color:var(--h);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ft{display:flex;justify-content:space-between;padding:10px 5px 0;font-size:14px;color:var(--h)}.ft b{font-weight:500;color:var(--tg-theme-text-color)}
</style>
<div class=top><div class=ctx>${tr('Status', 'Статус')}</div><div class=pill id=st></div></div>
<div class=g id=g></div>
<div class=ft id=ft></div>
<script>
${sqSource}
const U=${json},$=id=>document.getElementById(id),T=window.TelegramWidget,esc=x=>String(x).replace(/[&<>"]/g,c=>'&#'+c.charCodeAt(0)+';');
const tone={ok:['light-dark(#248A3D,#30D158)','rgba(52,199,89,.16)'],busy:['var(--a)','var(--a2)'],wait:['light-dark(#C93400,#FF9F0A)','rgba(255,149,0,.16)']}[U.s.tone];
$('st').textContent=U.s.label;$('st').style.color=tone[0];$('st').style.background=tone[1];
const dot={ok:'light-dark(#248A3D,#30D158)',off:'light-dark(#D70015,#FF6961)'};
$('g').innerHTML=U.t.map(t=>'<div class=p><svg class=f><path/></svg><svg class=ic viewBox="0 0 24 24">'+U.i[t.icon]+'</svg>'+(t.dot?'<i class=dot style="background:'+dot[t.dot]+'"></i>':'')+'<div class=lb>'+esc(t.label)+'</div><div class=v>'+esc(t.value)+'</div><div class=sb>'+esc(t.sub||'')+'</div></div>').join('');
const tiles=[...$('g').children];
// Shaped once the grid has its final size: read earlier, a platter's height is not yet its row's
const shape=()=>tiles.forEach(p=>p.querySelector('path').setAttribute('d',sq(p.offsetWidth,p.offsetHeight,14)));shape();requestAnimationFrame(shape);
tiles.forEach((p,i)=>{const t=U.t[i];if(!t.more)return;let open=false;
p.addEventListener('click',()=>{open=!open;p.querySelector('.sb').textContent=open?t.more:(t.sub||'');T?.HapticFeedback?.selectionChanged?.()})});
$('ft').innerHTML=U.f.map(f=>'<span>'+esc(f[0])+' <b>'+esc(f[1])+'</b></span>').join('');
const tint=()=>{const c=(T&&T.themeParams.button_color)||getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-button-color').trim(),m=/^#?([\\da-f]{2})([\\da-f]{2})([\\da-f]{2})/i.exec(c);if(m)document.documentElement.style.setProperty('--a2','rgba('+m.slice(1).map(x=>parseInt(x,16))+',.16)')};tint();T&&T.onEvent('themeChanged',tint);
</script>`
}

// Apple's smooth corners for the platters (the math of figma-squircle, MIT), as the widget guide gives it to Claude
const sqSource = 'function sq(w,h,r,s=.6){const B=Math.min(w,h)/2;r=Math.min(r,B);const p=Math.min((1+s)*r,B);s=Math.min(s,B/r-1);const R=Math.PI/180,am=90*(1-s),L=Math.sin(am/2*R)*r*Math.SQRT2,al=(90-am)/2,t=r*Math.tan(al/2*R),be=45*s,c=t*Math.cos(be*R),d=c*Math.tan(be*R),b=(p-L-c-d)/3,a=2*b,A=a+b,C=A+c;return`M${w-p} 0c${a} 0 ${A} 0 ${C} ${d}a${r} ${r} 0 0 1 ${L} ${L}c${d} ${c} ${d} ${b+c} ${d} ${C}L${w} ${h-p}c0 ${a} 0 ${A} ${-d} ${C}a${r} ${r} 0 0 1 ${-L} ${L}c${-c} ${d} ${-(b+c)} ${d} ${-C} ${d}L${p} ${h}c${-a} 0 ${-A} 0 ${-C} ${-d}a${r} ${r} 0 0 1 ${-L} ${-L}c${-d} ${-c} ${-d} ${-(b+c)} ${-d} ${-C}L0 ${p}c0 ${-a} 0 ${-A} ${d} ${-C}a${r} ${r} 0 0 1 ${L} ${-L}c${c} ${-d} ${b+c} ${-d} ${C} ${-d}Z`}'
