/**
 * ⭐⭐ 2D 图 → **真 3D**（不是"叠 16 层"）。
 *
 * 读者 2026-10-14：「我希望你能做到的是把 2D 的转化为 3D 的，**不是仅仅加厚**，
 * 你要查找是否有现成的项目你直接来使用可以处理，打包到软件里面来」。
 *
 * ⭐ 找的现成的项目 = **Depth Anything V2 (Small)** 的 ONNX 版
 *   （`onnx-community/depth-anything-v2-small`，Apache-2.0），
 *   用 **transformers.js + onnxruntime-web（WASM）** 跑，
 *   渲染用 **three.js**。全都离线、全在本地，没有一次联网请求。
 *
 * 为什么不是"上传到某个网站/调某个 API"：读者要的是**打包进软件**，
 * 而且这台机器在国内，任何云端的 3D 生成服务都不该是它的必经之路。
 *
 * ── 这条流水线 ─────────────────────────────────────────────
 *   图  →  深度图(512²)  →  N×N 的位移网格  →  three.js 里转
 *
 * ⚠️⚠️ 三个**必须**同时成立的细节，少一个就会"看起来像坏了"：
 *   ① 位移要在**轮廓处收口**，而且要跟着**纹理自己的 alpha** 收
 *      —— 只跟着网格上的距离变换收的话，几何归零的位置和纹理消失的位置
 *         是**两条不同的曲线**，中间那条楔形带就是侧面看过去的一圈毛边
 *         （实测：茎上像一把刷子）。
 *   ② 深度要**只在主体内部**取分位再归一化 —— 背景那一整片会把范围撑开，
 *      于是主体本身只用到动态范围的一小截，看着像"平的"。
 *   ③ 源图里**已经烘好了明暗**，所以把它当 `emissiveMap` 贴回去、
 *      真实光照只负责补一点方向感；重打一遍光会和原图打架（整只糊成白的）。
 *
 * 这个文件是**唯一一份** —— 设置页预览和桌面上那只 Pet 都 import 它。
 * （"两份必然漂移"在本项目已经栽过：形态名单、渲染器。）
 */

export const VENDOR = '/ui/vendor';
/** 深度模型在 vendor 里的相对路径 */
const MODEL_DIR = 'depth-anything-v2-small';
/** 网格分辨率。200² = 4 万顶点 / 8 万三角 —— 104px 的 Pet 上远远够用 */
export const N_GRID = 200;
/** 起伏幅度（相对平面边长 1.0） */
export const DEPTH_AMP = 0.30;
/** 轮廓收口强度：越大，边缘越平（越不容易看出"切开的墙"） */
export const EDGE_TAPER = 0.62;

/* ══ 一、深度 ═══════════════════════════════════════════════════════ */

let _tf = null, _pipe = null, _loading = null;

/** 懒加载 transformers.js —— 只有真的要造 3D 时才拉那 586KB */
async function loadTF() {
  if (_tf) return _tf;
  _tf = await import(VENDOR + '/transformers.min.js');
  const env = _tf.env;
  env.allowRemoteModels = false;              // ⚠️ 两个都写死，漏一个就会去网上拉模型
  env.allowLocalModels = true;
  env.localModelPath = VENDOR + '/';
  env.backends.onnx.wasm.numThreads = 1;      // 没有 COOP/COEP 就没有 SharedArrayBuffer
  env.backends.onnx.wasm.proxy = false;
  // ⚠️ 必须显式成 {wasm,mjs}：默认去抓 asyncify 那一份（26.8MB），
  //    而实测两者出的深度**一模一样**、耗时也一样（4.35s vs 4.6s）⇒ 白多 12.6MB。
  env.backends.onnx.wasm.wasmPaths = {
    wasm: VENDOR + '/ort-wasm-simd-threaded.wasm',
    mjs: VENDOR + '/ort-wasm-simd-threaded.mjs',
  };
  return _tf;
}

/**
 * 给一张图算深度。**会阻塞几秒**（实测 512² 约 4.3 秒，WASM 单线程）。
 * @returns {Promise<{w:number,h:number,data:Uint8Array}>} data 是 h*w 的 0..255 灰度
 */
export async function estimateDepth(src, onStage) {
  if (!_pipe) {
    if (!_loading) {
      _loading = (async () => {
        onStage && onStage('在加载深度模型（第一次要几秒）…');
        const tf = await loadTF();
        _pipe = await tf.pipeline('depth-estimation', MODEL_DIR, { dtype: 'q4f16', device: 'wasm' });
      })().catch((e) => { _loading = null; throw e; });
    }
    await _loading;
  }
  onStage && onStage('在量它的深浅…');
  const out = await _pipe(src);
  const d = out.depth;
  return { w: d.width, h: d.height, data: d.data };
}

/* ══ 二、主体遮罩 ═══════════════════════════════════════════════════
   ⚠️⚠️ 这里只留**一份**实现，设置页的预览和桌面上那只都调它。
      （两份必然漂移 —— 本项目在"形态名单""材质"上各栽过一次。）

   ⭐⭐ 三条判据，按可信度排序：

     ① **图自带透明底** ⇒ 用它。这是最准的（用户或上一个工具已经抠好了）。
     ② **用深度分**（默认），当图是不透明的照片/渲染图：
        单目深度模型知道"哪个是东西"—— 物体近、背景远。实测在**铬面反射背景**
        这种图上，它是唯一能用的那一把尺子（见下面 ③ 的对照）。
     ③ 按背景色泛洪（**只在你明确要求时**才走这一条）：
        ⚠️ 它假设"背景是一块纯色"。**铬/玻璃/渐变背景**上它会崩 ——
           铬面反射的就是背景，颜色几乎一样 ⇒ **把物体上亮的面一起吃掉**。
           读者 2026-10-14 给的那张（铬环雕塑 + 渐变影棚背景）实测：
           按颜色只留下 **2.9%**（副骨架），按深度留下 **44.1%**（整件东西）。
*/
function otsu(hist, total) {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = -1, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

/**
 * 哪块是主体。**唯一的实现。**
 * @param px    n×n 的 RGBA（原图缩样）
 * @param dz    n×n 的灰度（深度缩样，每位一个字节）
 * @returns {mask:Uint8Array, from:'alpha'|'depth'|'color'|'none'}
 */
export function subjectMask(px, n, dz, tune = {}) {
  // ① 自带透明底
  let clear = 0;
  for (let i = 0; i < n * n; i++) if (px[i * 4 + 3] < 24) clear++;
  const hasAlpha = clear > n * n * 0.03;
  const want = tune.maskFrom || 'auto';
  if (want === 'none') return { mask: new Uint8Array(n * n).fill(1), from: 'none' };
  if (hasAlpha && want !== 'depth' && want !== 'color') {
    const m = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) m[i] = px[i * 4 + 3] > 96 ? 1 : 0;
    return { mask: m, from: 'alpha' };
  }
  if (want === 'color' || !dz) {
    // ③ 兜底：按四角颜色泛洪（只在明确要求 / 没有深度图时）
    const med = (k) => { const a = [0, 1, 2, 3].map((j) => {
      const x = [2, n - 3, 2, n - 3][j], y = [2, 2, n - 3, n - 3][j];
      return px[(y * n + x) * 4 + k];
    }).sort((u, v) => u - v); return a[1]; };
    const bg = [med(0), med(1), med(2)];
    const dist = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) {
      dist[i] = Math.min(255, Math.max(Math.abs(px[i * 4] - bg[0]),
        Math.abs(px[i * 4 + 1] - bg[1]), Math.abs(px[i * 4 + 2] - bg[2])));
    }
    const HARD = 42, SOFT = 62, isBg = new Uint8Array(n * n), st = [];
    for (let x = 0; x < n; x++) st.push(x, 0, x, n - 1);
    for (let y = 0; y < n; y++) st.push(0, y, n - 1, y);
    const P = (x, y) => { const k = y * n + x; if (!isBg[k] && dist[k] < SOFT) { isBg[k] = 1; st.push(x, y); } };
    while (st.length) {
      const y = st.pop(), x = st.pop(), k = y * n + x;
      if (dist[k] < HARD) isBg[k] = 1;
      if (x > 0) P(x - 1, y); if (x < n - 1) P(x + 1, y);
      if (y > 0) P(x, y - 1); if (y < n - 1) P(x, y + 1);
    }
    const m = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) m[i] = isBg[i] ? 0 : 1;
    return { mask: keepBiggest(fillHoles(m, n), n), from: 'color' };
  }
  // ② 用深度：Otsu 找阈值 → 只留最大的那一块 → 补内部洞
  const hist = new Array(256).fill(0);
  for (let i = 0; i < n * n; i++) hist[dz[i]]++;
  const thr = otsu(hist, n * n);
  const m = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) m[i] = dz[i] > thr ? 1 : 0;
  /* ⚠️ 深度遮罩的边是**阈值切过去**的，物体外面还有一圈深度斜坡
     ⇒ 那一圈会变成侧面看过去的毛边。**退 2px**（侵蚀）再收口，实测明显干净。
     ⚠️ 侵蚀不能多：退过头会把细的地方（茎、环）整条切掉。 */
  const e = erode(keepBiggest(fillHoles(m, n), n), n, 2);
  return { mask: e, from: 'depth' };
}

/** 只留最大的那块连通域（水印 / 碎屑会把包围盒撑到整张图）。 */
function keepBiggest(m, n) {
  const seen = new Uint8Array(n * n); let best = null; const st = [];
  for (let s0 = 0; s0 < n * n; s0++) {
    if (!m[s0] || seen[s0]) continue;
    let cnt = 0; st.push(s0); seen[s0] = 1;
    while (st.length) {
      const k = st.pop(); cnt++;
      const x = k % n, y = (k - x) / n;
      if (x > 0 && m[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; st.push(k - 1); }
      if (x < n - 1 && m[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; st.push(k + 1); }
      if (y > 0 && m[k - n] && !seen[k - n]) { seen[k - n] = 1; st.push(k - n); }
      if (y < n - 1 && m[k + n] && !seen[k + n]) { seen[k + n] = 1; st.push(k + n); }
    }
    if (!best || cnt > best) best = cnt;
  }
  if (best == null) return m;
  // 第二遍：把不是最大那块的都清掉
  const seen2 = new Uint8Array(n * n), out = new Uint8Array(n * n);
  for (let s0 = 0; s0 < n * n; s0++) {
    if (!m[s0] || seen2[s0]) continue;
    const comp = []; st.push(s0); seen2[s0] = 1;
    while (st.length) {
      const k = st.pop(); comp.push(k);
      const x = k % n, y = (k - x) / n;
      if (x > 0 && m[k - 1] && !seen2[k - 1]) { seen2[k - 1] = 1; st.push(k - 1); }
      if (x < n - 1 && m[k + 1] && !seen2[k + 1]) { seen2[k + 1] = 1; st.push(k + 1); }
      if (y > 0 && m[k - n] && !seen2[k - n]) { seen2[k - n] = 1; st.push(k - n); }
      if (y < n - 1 && m[k + n] && !seen2[k + n]) { seen2[k + n] = 1; st.push(k + n); }
    }
    if (comp.length === best) for (const k of comp) out[k] = 1;
  }
  return out;
}

/** 侵蚀 k 圈（4 邻域）。⚠️ k 只能是 1~3 —— 再大细结构就没了。 */
function erode(m, n, k) {
  let cur = m;
  for (let step = 0; step < k; step++) {
    const out = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (!cur[i]) continue;
      out[i] = (x > 0 && cur[i - 1] && x < n - 1 && cur[i + 1] && y > 0 && cur[i - n] && y < n - 1 && cur[i + n]) ? 1 : 0;
    }
    cur = out;
  }
  return cur;
}

/** 补主体内部的洞（从四条边泛洪，走不到的就是洞）。 */
function fillHoles(m, n) {
  const out = new Uint8Array(n * n), st = [];
  const P = (x, y) => { const k = y * n + x; if (!out[k] && !m[k]) { out[k] = 1; st.push(x, y); } };
  for (let x = 0; x < n; x++) { P(x, 0); P(x, n - 1); }
  for (let y = 0; y < n; y++) { P(0, y); P(n - 1, y); }
  while (st.length) {
    const y = st.pop(), x = st.pop();
    if (x > 0) P(x - 1, y); if (x < n - 1) P(x + 1, y);
    if (y > 0) P(x, y - 1); if (y < n - 1) P(x, y + 1);
  }
  const f = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) f[i] = (m[i] || !out[i]) ? 1 : 0;
  return f;
}

/* ══ 三、几何 ═══════════════════════════════════════════════════════ */

/** 两遍 chamfer 距离变换（到"图外"的距离）—— 只用来做第二重收口保险 */
function chamfer(mask, w, h) {
  const INF = 1e9, d = new Float32Array(w * h), A = 1, B = Math.SQRT2;
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + A);
    if (y > 0) v = Math.min(v, d[i - w] + A);
    if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + B);
    if (x < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + B);
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + A);
    if (y < h - 1) v = Math.min(v, d[i + w] + A);
    if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + B);
    if (x > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + B);
    d[i] = v;
  }
  return d;
}

/** 把一张图缩到 N×N 并取出像素（浏览器里做，本机没有 PNG 解码器） */
function sample(img, n) {
  const c = document.createElement('canvas'); c.width = n; c.height = n;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, n, n);
  g.drawImage(img, 0, 0, n, n);
  return g.getImageData(0, 0, n, n).data;
}

/**
 * ⭐ 把「图 + 深度」变成一块**可以转的网格**。
 * @param THREE  已经加载好的 three 模块
 * @param img    已经 decode 完的 Image
 * @param depth  estimateDepth 的结果
 */
export function buildGeometry(THREE, img, depth, n = N_GRID, tune = {}) {
  /* ⭐⭐ 三个可调的旋钮（读者 2026-10-14：「我给你一张 3D 图之后我跟你沟通你来修改，
     例如**后边的镂空了需要补满**等，修改好了我说确定」）——
     这里是"改"的落点：改的都是这几个**确定性的量**，不是重新生成一遍。
     ⚠️ 每一档都要能在预览里**立刻看见**，否则"改到满意再确定"就是空话。 */
  const FILL = tune.fillHoles !== false;   // 补镂空：把主体内部的孔洞填平
  const EDGE = tune.edge != null ? Math.min(0.95, Math.max(0, tune.edge)) : EDGE_TAPER;
  const DEPTH = tune.depth != null ? Math.min(0.8, Math.max(0.05, tune.depth)) : DEPTH_AMP;
  const px = sample(img, n);                     // RGBA：颜色 + alpha
  // 深度图也是 0..255 灰度，同样缩到 N×N
  const dc = document.createElement('canvas'); dc.width = depth.w; dc.height = depth.h;
  const dg = dc.getContext('2d', { willReadFrequently: true });
  const dimg = dg.createImageData(depth.w, depth.h);
  for (let i = 0; i < depth.w * depth.h; i++) {
    dimg.data[i * 4] = dimg.data[i * 4 + 1] = dimg.data[i * 4 + 2] = depth.data[i];
    dimg.data[i * 4 + 3] = 255;
  }
  dg.putImageData(dimg, 0, 0);
  const dz = sample(dc, n);

  // ── 遮罩：**唯一一处**（见文件上面的 `subjectMask`）──
  const got = subjectMask(px, n, dz, tune);
  const mask = got.mask;
  const maskedFrom = got.from;
  let opaque = 0;
  for (let i = 0; i < n * n; i++) opaque += mask[i];

  // ⭐ 补镂空：从**四条边**泛洪，走不到的地方就是"主体内部的孔" ⇒ 填满。
  //   ⚠️ 这和"抠底"是两件事：抠底去的是**外面**的背景，这一条补的是**里面**的洞
  //      （读者原话「后边的**镂空了**，需要补满」）。
  if (FILL && maskedFrom !== 'depth' && maskedFrom !== 'color') {
    const out = new Uint8Array(n * n), st = [];
    const push = (x, y) => { const k = y * n + x; if (!out[k] && !mask[k]) { out[k] = 1; st.push(x, y); } };
    for (let x = 0; x < n; x++) { push(x, 0); push(x, n - 1); }
    for (let y = 0; y < n; y++) { push(0, y); push(n - 1, y); }
    while (st.length) {
      const y = st.pop(), x = st.pop();
      if (x > 0) push(x - 1, y); if (x < n - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1); if (y < n - 1) push(x, y + 1);
    }
    let filled = 0;
    for (let i = 0; i < n * n; i++) if (!out[i] && !mask[i]) { mask[i] = 1; filled++; }
    void filled;
  }

  const dmap = chamfer(mask, n, n);

  // ── 深度归一化：**只取主体内部的分位**（③ 条见文件头）─────
  const inside = [];
  for (let i = 0; i < n * n; i++) if (mask[i]) inside.push(dz[i * 4]);
  if (inside.length < 32) throw new Error('这张图几乎是空的（抠出来没有东西）');
  inside.sort((a, b) => a - b);
  const lo = inside[Math.floor(inside.length * 0.03)];
  const hi = inside[Math.floor(inside.length * 0.97)];

  // ── 顶点 ───────────────────────────────────────────────
  const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, k = i * 3;
    pos[k] = x / (n - 1) - 0.5;
    pos[k + 1] = -(y / (n - 1) - 0.5);
    uv[i * 2] = x / (n - 1); uv[i * 2 + 1] = 1 - y / (n - 1);
    let h = 0;
    if (mask[i]) {
      const t = Math.max(0, Math.min(1, (dz[i * 4] - lo) / Math.max(1, hi - lo)));
      const al = px[i * 4 + 3] / 255;
      const byAlpha = Math.max(0, Math.min(1, (al - 0.04) / 0.5));
      const byDist = Math.sin(Math.min(1, dmap[i] / (n * 0.10)) * Math.PI * 0.5);
      const taper = Math.min(byAlpha, byDist);           // ① 条见文件头
      h = (t * (1 - EDGE) + t * EDGE * taper) * DEPTH * (0.25 + 0.75 * byAlpha);
    }
    pos[k + 2] = h;
  }
  const idx = [];
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const a = y * n + x, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // ⚠️★ 记下**起伏的实际范围**。判据"有 8 万个三角面"**证明不了它有起伏** ——
  //    全叠在同一个 z 上照样是 8 万个面（本项目栽过一模一样的："16 层全在同一 z"）。
  //    ⇒ 这个数就是"它到底鼓起来了没有"的判据。
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < n * n; i++) { const z = pos[i * 3 + 2]; if (z < zMin) zMin = z; if (z > zMax) zMax = z; }
  const zs = new Set();
  for (let i = 0; i < n * n; i++) zs.add(pos[i * 3 + 2].toFixed(4));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, tris: idx.length / 3, coverage: (opaque / (n * n)), maskedFrom,
    relief: zMax - zMin, distinctZ: zs.size, depthLo: lo, depthHi: hi };
}

/* ══ 三、挂到页面上 ═════════════════════════════════════════════════ */

/** 懒加载 three.js（1.16MB，也只在这一条路上花） */
let _three = null;
export function loadThree() {
  if (!_three) _three = import(VENDOR + '/three.module.js');
  return _three;
}

const loadImg = (src) => new Promise((res, rej) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => rej(new Error('读不到图：' + src));
  i.src = src;
});

/**
 * 在 `canvas` 上把一个 2D 的 Pet 渲染成**可以转的 3D**。
 * @returns {Promise<{setSpin:(b:boolean)=>void, setAngle:(a:number)=>void, dispose:()=>void, tris:number}>}
 */
export async function mountPet3D(canvas, petUrl, depthUrl, opts = {}) {
  /* ⚠️⚠️ 读者 2026-10-14 的原话点破了这里真正的毛病：
     「**由于你旋转的不是 360 度，所以你转的不是一圈**，所以导致现在一圈的速度很慢，
       即使最快的 4 秒档位也是。你需要给出来 120 度转回还是**连续 360 度转**的选项，
       然后最快一圈是 2 秒。」
     ⇒ 我原来写的是 `sin(t) * 26°` —— **来回摆 ±26°，一共才 52°**。
        它却按 `period` 秒走完一个正弦周期 ⇒ "18 秒转一圈"这个说法是**假的**，
        实际 18 秒只摆了 52°，而且两端还会**减速停一下**（正弦的驻点）。
     ⇒ 现在两个模式，而且**速度的含义跟着模式走**：
        · `swing` 摆：±60°（**120° 的弧**来回），`period` = **一次来回**几秒
        · `full`  转：**连续 360°**，`period` = **转一圈**几秒
        ⚠️ `full` 用 `ph * 360` 而不是 `sin` —— 正弦在两端会慢下来，看着一顿一顿的；
           连续转必须**匀速**。 */
  // ⭐ 摆幅：读者 2026-10-14「多少度这个除了 120 应该还有 90 60 这样」
  //   ⚠️ 这里的度数是**整个弧**，所以摆幅 = 一半（120° 的弧 = ±60°）。
  const SWING_DEG = { swing120: 60, swing90: 45, swing60: 30 };
  const { spin = true, period = 18, mode = 'swing120' } = opts;
  const deg = SWING_DEG[mode] ?? 60;
  const [THREE, img, dimg] = await Promise.all([loadThree(), loadImg(petUrl), loadImg(depthUrl)]);
  const dw = opts.depthW || 512, dh = opts.depthH || 512;
  const dc = document.createElement('canvas'); dc.width = dw; dc.height = dh;
  const dg = dc.getContext('2d', { willReadFrequently: true });
  dg.drawImage(dimg, 0, 0, dw, dh);
  const dd = dg.getImageData(0, 0, dw, dh).data;
  const gray = new Uint8Array(dw * dh);
  for (let i = 0; i < dw * dh; i++) gray[i] = dd[i * 4];

  const { geo, tris, relief, distinctZ, maskedFrom } = buildGeometry(THREE, img, { w: dw, h: dh, data: gray },
    opts.n || N_GRID, { fillHoles: opts.fillHoles !== false, edge: opts.edge, depth: opts.depth, maskFrom: opts.maskFrom });

  const tex = new THREE.Texture(img);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  // ⚠️ 默认的三线性 mipmap 会把 alpha 抹开 ⇒ alphaTest 切在模糊的边上 = 一圈锯齿毛边
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  const mat = new THREE.MeshStandardMaterial({
    map: tex, side: THREE.DoubleSide, alphaTest: 0.5,
    roughness: 0.7, metalness: 0,
    // ③ 条见文件头：源图已经烘好了明暗，重打一遍光会和它打架
    emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.62,
  });

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  cam.position.set(0, 0, 1.75); cam.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.10));
  const key = new THREE.DirectionalLight(0xffffff, 0.34); key.position.set(-1.2, 1.6, 2); scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.16); fill.position.set(1.4, -0.6, 1.2); scene.add(fill);
  const pivot = new THREE.Group();
  pivot.add(new THREE.Mesh(geo, mat));
  scene.add(pivot);

  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false });
  r.setClearColor(0x000000, 0);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  r.outputColorSpace = THREE.SRGBColorSpace;

  let on = spin, t0 = 0, raf = 0, frames = 0;
  const draw = (ms) => {
    if (!t0) t0 = ms;
    const ph = ((ms - t0) / 1000 / period) % 1;                 // 0..1
    const ang = !on ? 0
      : mode === 'full' ? ph * 360                             // 连续匀速转一圈
        : Math.sin(ph * Math.PI * 2) * deg;                    // 摆：±deg（120° 弧）
    pivot.rotation.y = ang * Math.PI / 180;
    pivot.rotation.x = 0.06;
    r.render(scene, cam);
    frames++;
    if (on) raf = requestAnimationFrame(draw);
  };
  const fit = () => {
    const w = canvas.clientWidth || 104, h = canvas.clientHeight || 104;
    r.setSize(w, h, false);
    r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  };
  fit();
  raf = requestAnimationFrame(draw);

  /* ⭐ **页面自证**：把"我到底怎么摆的、还在不在动"留在画布上。
     ⚠️ 判据不能只看"画布在不在" —— 一个冻结在 0° 的 3D 和"3D 没挂上"
        （退回叠层/一片空白）在截图上**分不开**，而这个能分开。
     ⚠️ 也**不能**靠 `getAnimations()`：WebGL 是 JS 在画，CSS 动画列表是空的
        —— 那正是本项目栽过的"假绿三连"里的一条。 */
  canvas.__pet3d = {
    tris,
    maskedFrom,
    // ⭐ 这两条才是"它真的不是一块平板"的判据（面数证明不了）
    relief,
    distinctZ,
    get spin() { return on; },
    get angle() { return pivot.rotation.y; },
    get frames() { return frames; },
  };

  return {
    tris,
    setSpin(b) {
      if (b === on) return;
      on = b;
      cancelAnimationFrame(raf);
      if (on) { t0 = 0; raf = requestAnimationFrame(draw); }
      else draw(performance.now());      // ⚠️ 停的时候要**再画一帧**回到正面
    },
    setAngle(a) { on = false; cancelAnimationFrame(raf); pivot.rotation.y = a * Math.PI / 180; r.render(scene, cam); },
    dispose() {
      cancelAnimationFrame(raf);
      geo.dispose(); mat.dispose(); tex.dispose(); r.dispose();
    },
  };
}

/**
 * ⭐ 把 0..255 的深度写成一张 PNG 的 dataURL —— 存下来给 Pet 窗口用。
 *   Pet 窗口**不跑模型**（4 秒 + 35MB 的依赖），它只读这张图。
 */
export function depthToDataURL(depth) {
  const c = document.createElement('canvas');
  c.width = depth.w; c.height = depth.h;
  const g = c.getContext('2d');
  const id = g.createImageData(depth.w, depth.h);
  for (let i = 0; i < depth.w * depth.h; i++) {
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = depth.data[i];
    id.data[i * 4 + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return c.toDataURL('image/png');
}
