/**
 * ⭐ CEVTUO Pet 的字标 —— **一支手绘线稿玫瑰**（读者 2026-10-14 给的那张的样子）。
 *
 * 读者原话：「另外这个软件的 logo 用这个，类似这样，**我没有截图好也没有去掉背景**，
 * 大概这个意思，你来处理好，**下一轮开头让我审核你的这个 logo 画的对不对**」。
 * ⇒ 所以这个文件的意义不只是"生成一张图"，而是**把"我打算画成什么"落成可核对的东西**：
 *    同一个 SVG 同时喂给 App 图标 / 设置页 / 分发页，改一处三处一起变。
 *
 * ⚠️ 为什么是**画的**（矢量）而不是把那张照片抠出来：
 *    · 读者给的就是**线稿**（不是那张银色渲染图）—— 他要的是"描出来的"那一支；
 *    · 线稿在任何尺寸下都清楚（Dock 16px 上照片会糊成一团灰）。
 *
 * 跑：bun app/make-logo.mjs
 *     出 `app/pet/rose-line.svg`（源）和 `app/pet/rose-line.png`（512，给设置页/分发页）
 */
import { writeFileSync } from 'node:fs';
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';

const HERE = '/Users/cjw/Documents/Cevtuo-C4emem/app';

/* ── 花头：一条从花心往外绕 2.6 圈的螺线 ────────────────────────────
   ⚠️ 手写一串贝塞尔点很难"看着对"，所以螺线**算出来**：
      半径随角度线性长（阿基米德），再用 Catmull-Rom 转成三次贝塞尔。
      ⚠️ 不能用"每隔 30° 一个点直接连线" —— 那样是折线，放大就看得出棱角
        （CANTO 那次的经验：曲线必须平滑，而且**能读出数**）。 */
function catmullToBezier(pts) {
  const p = [pts[0], ...pts, pts[pts.length - 1]];
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

/**
 * ⭐ 花头的外轮廓：**波浪形的闭合曲线**（花瓣边）。
 * ⚠️⚠️ 第一版画的是**正圆** —— 出来是一根棒棒糖（读者要审核的正是这个）。
 *    真玫瑰的外缘是**一瓣一瓣鼓出来**的 ⇒ r(θ) 上加几个余弦鼓包，
 *    幅度只要 7% 就够"读成花"，多了会变成云朵。
 * ⚠️ 底下（θ≈90°）收一点：花头是**坐在花托上**的，正圆会像个气球飘着。
 */
function blob(cx, cy, R, squash, lobes, amp, phase) {
  const N = 72, pts = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = R * (1 + amp * Math.cos(lobes * a + phase)) * (1 - 0.13 * Math.max(0, Math.sin(a)));
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * squash]);
  }
  return catmullToBezier(pts);
}

/** 花心的螺线：cx,cy 是花头中心；r0 起始半径；r1 结束半径；turns 圈数；a0 起始角 */
function spiral(cx, cy, r0, r1, turns, a0) {
  const N = 90, pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = a0 + t * turns * Math.PI * 2;
    const r = r0 + (r1 - r0) * t;
    // ⚠️ 纵向压一点（0.86）：真玫瑰的花心是**扁的**，正圆看起来像蜗牛
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.86]);
  }
  return catmullToBezier(pts);
}

const W = 240, H = 360;

/* 花头中心稍偏右上，茎往左下走 —— 和读者那张草图的构图一致（他是这么摆的）。 */
const CX = 142, CY = 92;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"
     fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
  <!-- ⭐ 花头：**侧看的杯状玫瑰**，不是正圆。
       ⚠️ 第一版画了个圆 + 螺线 —— 出来是一根**棒棒糖**（读者要审核的正是这个）。
          玫瑰的花头必须：① 顶上两个花瓣的**鼓包**；② 底下收成杯底；③ 里面是**层层叠的瓣**。 -->
  <path d="${blob(140, 90, 48, 0.94, 5, 0.075, -0.7)}"/>

  <!-- 内外两层瓣的边（两条弧，走向要"包"住花心） -->
  <!-- 一道内瓣的边：从轮廓往里收，让花心不是"浮在一片空白里" -->
  <path d="M 158 66 C 172 58 184 66 186 82 C 188 100 178 118 162 126"/>

  <!-- 花心：一条短的螺（1.7 圈就够，多了又变蜗牛） -->
  <path d="${spiral(CX - 4, CY - 4, 4, 30, 2.4, -0.9)}"/>

  <!-- 花托 + 萼片：花头和茎接住的那一小段，两个尖角 -->
  <path d="M 120 134 C 124 150 134 160 148 168"/>
  <path d="M 152 136 C 150 150 150 160 148 168"/>

  <!-- 茎：长、粗、往左下走，中间一道缓弯（原来画得太直 ⇒ 像一根签子） -->
  <path d="M 148 166 C 160 200 152 236 126 266 C 102 294 78 318 58 340"/>

  <!-- ⭐ 叶子：**两段弧对出来的一片尖叶**（两个尖端 + 上下两条边），不是两个小圈圈。
       ⚠️ 第一版那两个"圈"看起来像茎上打了两个结。 -->
  <path d="M 128 232 C 108 200 76 186 50 196 C 74 216 104 234 128 232 Z"/>
  <!-- 主脉：从叶尖往叶柄走，微微弯 -->
  <path d="M 54 199 C 76 214 104 228 126 231"/>

  <!-- 右边一片小叶（和左边那片错开，不然整支是"对称"的，假） -->
  <path d="M 152 186 C 166 172 186 170 196 180 C 188 196 166 200 152 190"/>
</svg>`;
writeFileSync(`${HERE}/pet/rose-line.svg`, svg);
console.log('✅ app/pet/rose-line.svg');

// ── 出一张 512 的 PNG：**线稿放在深色圆角底盘上**（和 App 图标同一套） ──
// ⚠️ 本机没有 PNG 编解码器（pngjs / sharp / jimp 都没有）⇒ 只能靠浏览器截
const page = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:transparent}
  #plate{width:512px;height:512px;border-radius:116px;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(120% 120% at 28% 18%, #2c2b31 0%, #1b1a1f 58%, #131217 100%);
    box-shadow: inset 0 2px 0 rgba(255,255,255,.10), inset 0 -6px 40px rgba(0,0,0,.55)}
  #plate svg{height:340px;width:auto;color:#e9e7e2}
</style></head><body><div id="plate">${svg}</div></body></html>`;

/* ⭐ 顺手把 **App 图标的源页** 也写出来 —— 一个命令同时更新
   · 图标源（app/pet/icon.html → 再跑 app/pet/make-icon.mjs 出 icns）
   · 512 的 PNG（设置页 / 分发页用）
   ⚠️ 分开写两份必然漂移：改了 logo 忘了改图标 = "换了 logo 但 Dock 上还是旧的"，
      而**没有任何东西会报错**。
   ⚠️ icon.html 是**内联** SVG 的（不是 `<img src=…>`）：SVG 里写的是
      `stroke="currentColor"`，走 `<img>` 的话 `currentColor` 解析成**黑色**，
      在深色底盘上等于**什么都看不见**。 */
const iconHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  /* ⚠️ 图标是**渲染出来再截图**的（本机没有 PNG 编解码器，sips 只能缩放不能合成）。 */
  html,body{margin:0;width:1024px;height:1024px;overflow:hidden;background:transparent}
  .plate{width:1024px;height:1024px;border-radius:228px;
    background:radial-gradient(120% 120% at 28% 18%, #2c2b31 0%, #1b1a1f 58%, #131217 100%);
    display:flex;align-items:center;justify-content:center;
    box-shadow: inset 0 2px 0 rgba(255,255,255,.10), inset 0 -6px 40px rgba(0,0,0,.55)}
  /* ⚠️ 玫瑰是"瘦高"的 —— 按**高度**定尺寸，宽度自然留白，
     这样它在 Dock 的小尺寸下也是**立着的一支**，而不是被压扁的一团。 */
  .plate svg{height:700px;width:auto;display:block;color:#e9e7e2;
    filter:drop-shadow(0 10px 22px rgba(0,0,0,.45))}
</style></head>
<body>
  <div class="plate">${svg.replace(/^<svg[^>]*>/, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 360">').replace(/\n\s*width="[^"]*" height="[^"]*"/, '')}</div>
</body></html>
`;
writeFileSync(`${HERE}/pet/icon.html`, iconHtml);
console.log('✅ app/pet/icon.html（图标源 —— 再跑 bun app/pet/make-icon.mjs 出 icns）');

const br = await chromium.launch();
const p = await br.newPage({ viewport: { width: 512, height: 512 } });
await p.setContent(page, { waitUntil: 'load' });
await p.waitForTimeout(200);
await p.screenshot({ path: `${HERE}/pet/rose-line.png`, omitBackground: true });
// ⭐ 顺带出一张**大图给读者审核用**（看细节），和一张 32px 的（看它在 Dock 上还认得出来吗）
const p2 = await br.newPage({ viewport: { width: 1400, height: 620 } });
await p2.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#111114;color:#9aa;font:14px -apple-system,sans-serif;padding:24px}
  .row{display:flex;align-items:center;gap:28px;margin-bottom:26px}
  .big svg{height:420px;width:auto;color:#e9e7e2}
  .onwhite{background:#fff;padding:14px;border-radius:14px}
  .onwhite svg{height:120px;width:auto;color:#111}
  .tiny{display:flex;gap:16px;align-items:flex-end}
  .plate{display:flex;align-items:center;justify-content:center;border-radius:22%;
    background:radial-gradient(120% 120% at 28% 18%, #2c2b31 0%, #1b1a1f 58%, #131217 100%);}
  .plate svg{color:#e9e7e2}
</style></head><body>
  <div class="row">
    <div class="big">${svg}</div>
    <div>
      <div class="onwhite" style="margin-bottom:18px">${svg}</div>
      <div class="tiny">
        ${[16, 32, 64, 128, 256].map((s) => `<div><div class="plate" style="width:${s}px;height:${s}px">
          <div style="height:${(s * 0.68).toFixed(1)}px;display:flex">${svg.replace(`width="${W}" height="${H}"`, '')}</div></div>
          <div style="font-size:11px;margin-top:6px">${s}px</div></div>`).join('')}
      </div>
    </div>
  </div>
</body></html>`, { waitUntil: 'load' });
await p2.waitForTimeout(300);
await p2.screenshot({ path: '/tmp/logo-review.png' });
await br.close();
console.log('✅ app/pet/rose-line.png · 审核图 → /tmp/logo-review.png');
