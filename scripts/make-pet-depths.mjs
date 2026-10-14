/**
 * ⭐ 给**内置形态**的那几张静态图预先算好深度图（一次性，产物进仓库）。
 *
 * 为什么必须预先算：
 *   「银 / 铅 / 锌」在桌面上是**一张静态图**（`mineral-<id>-mini.webp`）
 *   ⇒ **没有任何东西可转** ⇒ 读者把「不转」打开、再关上，**画面一模一样**，
 *      于是这个开关看起来是坏的。（2026-10-14 实测：他的 pref 正是
 *      `{"form":"silver","spin":false}` —— 他碰到的就是这个。）
 *
 * 跑（**对着已经在跑的核心**，这样能直接用 `/ui/vendor/` 里那套：
 *   bun scripts/make-pet-depths.mjs            # 默认 127.0.0.1:8770
 *   C4EMEM_BASE=http://127.0.0.1:8791 bun scripts/make-pet-depths.mjs
 *
 * ⚠️ 产物写进 `src/ui/assets/`（**进 git**，很小：每张 ~100KB）。
 *    不预先算的话，每开一次 Pet 都要跑 4 秒模型 —— 那才是真的"卡"。
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';

const B = process.env.C4EMEM_BASE || 'http://127.0.0.1:8770';
const ROOT = '/Users/cjw/Documents/Cevtuo-C4emem';
/** 只有这三张是"静态图"形态（card 是多层卡、pearl 是视频，各有各的动法） */
const ITEMS = ['silver', 'lead', 'zinc'];

const br = await chromium.launch({ args: ['--no-proxy-server', '--proxy-bypass-list=*', '--enable-unsafe-swiftshader'] });
const p = await br.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

// ── 用核心自己的页面当跑台：它已经有 vendor 那套的相对路径 ──
await p.goto(B + '/ui/petsettings.html', { waitUntil: 'load' });
await p.evaluate(() => {
  window.__mk = async (url) => {
    const { estimateDepth, depthToDataURL } = await import('/ui/pet3d.js');
    const d = await estimateDepth(url, () => {});
    return { url: depthToDataURL(d), w: d.w, h: d.h };
  };
});

for (const id of ITEMS) {
  const src = `/ui/assets/mineral-${id}-mini.webp`;
  process.stdout.write(`· ${id} … `);
  const r = await p.evaluate((u) => window.__mk(u), src);
  const buf = Buffer.from(r.url.split(',')[1], 'base64');
  writeFileSync(`${ROOT}/src/ui/assets/mineral-${id}.depth.png`, buf);
  console.log(`${r.w}×${r.h} · ${(buf.length / 1024).toFixed(0)}KB`);
}

// ⚠️ 自检："文件在"不等于"下全了 / 算对了" —— 深度图**一定是灰度的、有明暗的**。
//    一张全黑或全白的深度图会让 3D 变成一块平板，而**看起来只是"没那么立体"**。
const bad = await p.evaluate(async (ids) => {
  const out = [];
  for (const id of ids) {
    const d = await window.__mk('/ui/assets/mineral-' + id + '-mini.webp');
    const img = new Image(); img.src = d.url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, img.width, img.height).data;
    let mn = 255, mx = 0;
    for (let i = 0; i < px.length; i += 4) { const v = px[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    out.push({ id, mn, mx });
  }
  return out;
}, ITEMS);
let okAll = true;
for (const r of bad) {
  const good = r.mx - r.mn > 40;
  if (!good) okAll = false;
  console.log(`  ${good ? '✓' : '✗'} ${r.id} 深度范围 ${r.mn}..${r.mx}${good ? '' : '  ← 太平了，做出来会是一块平板'}`);
}
await br.close();
console.log(okAll ? '\n✅ 三张深度图都写好了（src/ui/assets/mineral-*.depth.png）' : '\n❌ 有深度图是平的');
process.exit(okAll ? 0 : 1);
