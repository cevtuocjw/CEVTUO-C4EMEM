/**
 * 把 out/taxonomy.json 变成两份能看的东西：
 *   out/taxonomy.md    文字报告：树状图 + 条形比例 + 每个类的关键词和例子
 *   out/taxonomy.html  交互图：**树图（treemap，面积 = 段数）** + 可折叠的树
 *
 * ⚠️ HTML 是**自包含**的：不引任何 CDN、不发任何网络请求 —— 双击就能开。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = join(process.cwd(), 'out');
const data = JSON.parse(readFileSync(join(outDir, 'taxonomy.json'), 'utf8'));

const total = data.totalDocs;
const pct = (n: number) => ((n / total) * 100).toFixed(1);

// ── Markdown ─────────────────────────────────────────────────
const lines: string[] = [];
lines.push('# C4emem 知识库主题分布');
lines.push('');
lines.push(`> 生成于 ${data.generatedAt}　·　共 **${total}** 段　·　${data.groups.length} 个大类`);
lines.push('');

lines.push('## 四、来源分布');
lines.push('');
lines.push('| 板块 | 段数 | 占比 |');
lines.push('|---|---:|---:|');
for (const s of data.spaces) lines.push(`| ${s.label} | ${s.count} | ${pct(s.count)}% |`);
lines.push(`| **合计** | **${total}** | 100% |`);
lines.push('');

lines.push('## 大类分布（按体量排序）');
lines.push('');
lines.push('| 大类 | 段数 | 占比 | 子类数 |');
lines.push('|---|---:|---:|---:|');
for (const g of data.groups) lines.push(`| **${g.name}** | ${g.size} | ${pct(g.size)}% | ${g.clusters.length} |`);
lines.push('');

// 条形图：一眼看谁多谁少
const maxSize = Math.max(...data.groups.map((g: any) => g.size));
lines.push('```');
for (const g of data.groups) {
  const bar = '█'.repeat(Math.max(1, Math.round((g.size / maxSize) * 40)));
  lines.push(`${String(g.size).padStart(5)} ${bar} ${g.name}（${pct(g.size)}%）`);
}
lines.push('```');
lines.push('');

// 树状图
lines.push('## 树状图');
lines.push('');
lines.push('```');
const allGroups = [...data.groups];
allGroups.forEach((g: any, gi: number) => {
  const last = gi === allGroups.length - 1;
  lines.push(`${last ? '└─' : '├─'} ${g.name}  [${g.size} 段 / ${pct(g.size)}%]`);
  g.clusters.forEach((c: any, ci: number) => {
    const clast = ci === g.clusters.length - 1;
    const branch = last ? '   ' : '│  ';
    lines.push(`${branch}${clast ? '└─' : '├─'} ${c.name}  (${c.size})`);
    if (c.keywords?.length) {
      lines.push(`${branch}${clast ? '   ' : '│  '}   🔑 ${c.keywords.join(' · ')}`);
    }
  });
});
lines.push('```');
lines.push('');

// 逐类明细
lines.push('## 逐类明细');
lines.push('');
for (const g of data.groups) {
  lines.push(`### ${g.name} — ${g.size} 段（${pct(g.size)}%）`);
  lines.push('');
  lines.push('| 子类 | 段数 | 关键词 | 时间跨度 | 板块 |');
  lines.push('|---|---:|---|---|---|');
  for (const c of g.clusters) {
    const span = c.dateMin && c.dateMax && c.dateMin !== c.dateMax ? `${c.dateMin} → ${c.dateMax}` : c.dateMin || '';
    lines.push(`| ${c.name} | ${c.size} | ${(c.keywords ?? []).join('、')} | ${span} | ${(c.spaces ?? []).join('/')} |`);
  }
  lines.push('');
  for (const c of g.clusters.slice(0, 3)) {
    if (!c.examples?.length) continue;
    lines.push(`<details><summary>${c.name} 的例子（${c.size} 段）</summary>`);
    lines.push('');
    for (const e of c.examples) lines.push(`- \`${e.space} ${e.date}\` ${e.text}`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
}

writeFileSync(join(outDir, 'taxonomy.md'), lines.join('\n'), 'utf8');

// ── HTML ─────────────────────────────────────────────────────
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>C4emem 知识库主题分布</title>
<style>
:root{--bg:#0f1115;--fg:#e7e9ee;--dim:#8b93a7;--line:#252a35}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 -apple-system,"PingFang SC","Helvetica Neue",sans-serif}
header{padding:22px 26px;border-bottom:1px solid var(--line)}
h1{margin:0 0 6px;font-size:19px;font-weight:600}
.sub{color:var(--dim);font-size:13px}
.wrap{display:flex;gap:0;height:calc(100vh - 92px)}
#map{flex:1.35;position:relative;background:#0b0d11}
#side{flex:1;overflow:auto;border-left:1px solid var(--line);padding:14px 18px}
.node{position:absolute;overflow:hidden;border:1px solid rgba(0,0,0,.45);cursor:pointer;transition:filter .12s}
.node:hover{filter:brightness(1.35)}
.node .lbl{position:absolute;left:5px;top:3px;right:5px;font-size:11.5px;font-weight:600;
  text-shadow:0 1px 3px rgba(0,0,0,.9);pointer-events:none;line-height:1.25}
.node .cnt{position:absolute;left:5px;bottom:3px;font-size:10.5px;opacity:.85;text-shadow:0 1px 3px rgba(0,0,0,.9)}
.grp{border-left:2px solid;padding-left:10px;margin:0 0 14px}
.grp>h3{margin:0 0 4px;font-size:14.5px}
.grp .meta{color:var(--dim);font-size:12px;margin-bottom:5px}
.cl{display:flex;align-items:baseline;gap:8px;padding:3px 0;font-size:12.5px;cursor:pointer;border-radius:4px}
.cl:hover{background:#1a1f2a}
.cl .bar{height:8px;border-radius:2px;opacity:.75;flex:none}
.cl .nm{flex:1}
.cl .sz{color:var(--dim);font-variant-numeric:tabular-nums}
.kw{color:var(--dim);font-size:11.5px;margin:0 0 8px 0}
#tip{position:fixed;pointer-events:none;background:#1a1f2af2;border:1px solid var(--line);
  border-radius:8px;padding:9px 11px;font-size:12.5px;max-width:340px;opacity:0;transition:opacity .1s;
  box-shadow:0 8px 28px rgba(0,0,0,.5)}
#tip b{color:#fff}
#tip .k{color:var(--dim);font-size:11.5px;margin-top:4px}
</style></head><body>
<header>
  <h1>C4emem 知识库主题分布</h1>
  <div class="sub">共 <b>${total}</b> 段 · ${data.groups.length} 个大类 · ${
    data.groups.reduce((a: number, g: any) => a + g.clusters.length, 0)
  } 个子类 · ${data.generatedAt.slice(0, 10)}　｜　左边面积 = 段数，鼠标悬停看细节</div>
</header>
<div class="wrap"><div id="map"></div><div id="side"></div></div>
<div id="tip"></div>
<script>
const DATA = ${JSON.stringify(data)};
const PALETTE = ['#4f7cff','#22b07d','#e0562f','#b45cf0','#e0a93b','#2fb6c9','#e05a9b','#7fa63b','#8d6bff','#d4562f','#3ba5e0','#c9c04a'];
const map = document.getElementById('map'), side = document.getElementById('side'), tip = document.getElementById('tip');

function hex2rgb(h){return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];}
function rgba(h,a){const c=hex2rgb(h);return 'rgba('+c[0]+','+c[1]+','+c[2]+','+a+')';}
function shade(h,f){const c=hex2rgb(h).map(v=>Math.max(0,Math.min(255,Math.round(v*f))));return 'rgb('+c.join(',')+')';}

// 递归二分树图：每层按面积对半分，交替横竖切
function layout(items,x,y,w,h,out,depth){
  if(!items.length) return;
  if(items.length===1){out.push({it:items[0],x:x,y:y,w:w,h:h,d:depth});return;}
  const tot=items.reduce((s,i)=>s+i.value,0);
  let acc=0,k=0;
  for(let i=0;i<items.length;i++){acc+=items[i].value;k=i;if(acc>=tot/2)break;}
  const A=items.slice(0,k+1),B=items.slice(k+1);
  const fa=A.reduce((s,i)=>s+i.value,0)/tot;
  if(w>=h){layout(A,x,y,w*fa,h,out,depth);layout(B,x+w*fa,y,w*(1-fa),h,out,depth);}
  else{layout(A,x,y,w,h*fa,out,depth);layout(B,x,y+h*fa,w,h*(1-fa),out,depth);}
}

function draw(){
  map.innerHTML='';
  const W=map.clientWidth, H=map.clientHeight;
  // 第一层：大类
  const gs=DATA.groups.map((g,i)=>({...g,value:g.size,color:PALETTE[i%PALETTE.length]}));
  const gRects=[];
  layout(gs.sort((a,b)=>b.value-a.value),0,0,W,H,gRects,0);
  for(const gr of gRects){
    const g=gr.it;
    const el=document.createElement('div');
    el.className='node';
    el.style.cssText='left:'+gr.x+'px;top:'+gr.y+'px;width:'+gr.w+'px;height:'+gr.h+'px;background:'+rgba(g.color,.30)+';border-color:'+rgba(g.color,.9);
    el.innerHTML='<div class="lbl">'+g.name+'</div><div class="cnt">'+g.size+' · '+(g.size/DATA.totalDocs*100).toFixed(1)+'%</div>';
    el.onmousemove=(e)=>show(e,g.name,g.size,g.clusters.length+' 个子类',g.color,null);
    el.onmouseleave=hide;
    map.appendChild(el);
    // 第二层：子类（铺在父块内部）
    const cs=g.clusters.map(c=>({...c,value:c.size,color:g.color}));
    const sub=[]; if(gr.w>90&&gr.h>70) layout(cs,gr.x+1,gr.y+16,gr.w-2,gr.h-18,sub,1);
    for(const sr of sub){
      const c=sr.it;
      const e2=document.createElement('div');
      e2.className='node';
      const shadeF=0.55+0.75*Math.min(1,c.size/Math.max(1,g.clusters[0].size));
      e2.style.cssText='left:'+sr.x+'px;top:'+sr.y+'px;width:'+sr.w+'px;height:'+sr.h+'px;background:'+rgba(shade(c.color,shadeF),.85)+';border-color:rgba(0,0,0,.5)';
      e2.innerHTML='<div class="lbl">'+(sr.w>62&&sr.h>26?c.name:'')+'</div><div class="cnt">'+(sr.h>40?c.size:'')+'</div>';
      e2.onmousemove=(e)=>show(e,c.name,c.size,(c.keywords||[]).join(' · '),g.color,c);
      e2.onmouseleave=hide;
      map.appendChild(e2);
    }
  }
}

function show(e,title,size,sub,color,c){
  tip.innerHTML='<b>'+title+'</b><br>'+size+' 段 · '+(size/DATA.totalDocs*100).toFixed(1)+'%'
    +'<div class="k">'+sub+'</div>'
    +(c&&c.desc?'<div class="k">'+c.desc+'</div>':'')
    +(c&&c.dateMin?'<div class="k">'+c.dateMin+' → '+c.dateMax+'</div>':'');
  tip.style.opacity=1;
  const x=Math.min(e.clientX+16,innerWidth-360), y=Math.min(e.clientY+16,innerHeight-140);
  tip.style.left=x+'px'; tip.style.top=y+'px';
}
function hide(){tip.style.opacity=0;}

// 右侧树
(function(){
  let h='';
  const maxG=Math.max(...DATA.groups.map(g=>g.size));
  DATA.groups.forEach((g,i)=>{
    const col=PALETTE[i%PALETTE.length];
    h+='<div class="grp" style="border-color:'+col+'">';
    h+='<h3>'+g.name+'</h3><div class="meta">'+g.size+' 段 · '+(g.size/DATA.totalDocs*100).toFixed(1)+'% · '+g.clusters.length+' 子类</div>';
    const maxC=Math.max(...g.clusters.map(c=>c.size));
    g.clusters.forEach(c=>{
      const wpx=Math.max(3,Math.round(c.size/maxC*90));
      h+='<div class="cl" title="'+(c.examples||[]).map(x=>x.date+' '+x.text).join('\\n')+'">'
        +'<span class="bar" style="width:'+wpx+'px;background:'+col+'"></span>'
        +'<span class="nm">'+c.name+'</span><span class="sz">'+c.size+'</span></div>';
      if(c.keywords&&c.keywords.length) h+='<div class="kw">🔑 '+c.keywords.join(' · ')+'</div>';
    });
    h+='</div>';
  });
  side.innerHTML=h;
})();

draw();
addEventListener('resize',draw);
</script></body></html>`;

writeFileSync(join(outDir, 'taxonomy.html'), html, 'utf8');
console.log('✅ out/taxonomy.md / out/taxonomy.html');
