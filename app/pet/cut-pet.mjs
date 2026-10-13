/**
 * 把一张**白底的产品图**抠成"没有背景的"、裁到主体、居中输出。
 *
 * 读者 2026-10-13：
 *   「你截取一个在铅的中间放上 **不要做任何改动（没有背景的作为就好了）**」
 *
 * ⚠️⚠️ 本机**没有任何 PNG 编解码器**（pngjs / sharp / jimp 都没有）⇒ 只能在浏览器里解。
 *    这是这个项目一直以来的做法（`img-stats.mjs` 也是这么干的）。
 *
 * ⚠️ "不要做任何改动" = **不重画、不描边、不风格化**，只做三件事：
 *    ① 把接近背景色的像素变透明（带一段软过渡，不然边缘会是一圈硬锯齿）
 *    ② 裁到主体的包围盒
 *    ③ 居中放到画布上
 *
 * 用法：bun app/pet/cut-pet.mjs <输入图> <输出png> [画布边长] [留白比例]
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const [src, out, sizeArg, padArg] = process.argv.slice(2);
if (!src || !out) { console.error('用法: bun cut-pet.mjs <输入图> <输出png> [边长=1024] [留白=0.08]'); process.exit(2); }
const SIZE = Number(sizeArg || 1024);
const PAD = Number(padArg || 0.08);

const b64 = readFileSync(src).toString('base64');
const dataUrl = 'data:image/png;base64,' + b64;

const br = await chromium.launch();
const p = await br.newPage({ viewport: { width: 900, height: 900 } });
const res = await p.evaluate(async ({ dataUrl, SIZE, PAD }) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h);
  const px = d.data;

  // ① 背景色 = **四个角的中位数**（不是取一个角 —— 一个角可能正好有阴影/水印）
  const at = (x, y) => { const i = (y * w + x) * 4; return [px[i], px[i+1], px[i+2]]; };
  const corners = [at(2,2), at(w-3,2), at(2,h-3), at(w-3,h-3)];
  const med = (k) => { const a = corners.map(c0 => c0[k]).sort((x,y)=>x-y); return a[1]; };
  const bg = [med(0), med(1), med(2)];

  // ② ⚠️⚠️ **不能只看颜色** —— 这是一张**银色**物体配**白底**的图，
  //    银色高光本身就是白的，靠"离白色多远"永远分不开
  //    （我第一版就是这么写的：主体包围盒量出来几乎等于整张图、占画布只剩 6%）。
  //    ⇒ 正解是**连通性**：背景**一定连着边框**，物体不连。
  //      从四条边的背景像素泛洪，只吃掉"连着外面、而且颜色接近背景"的那些。
  //    ⚠️ 而且泛洪**不过银色的内部** —— 它被暗边围住了，天然进不去。
  const HARD = 42;   // 起洪的门槛：连边框在内、离背景色这么近的算背景
  const SOFT = 62;   // 泛洪过程中能爬过去的门槛（比 HARD 宽一点，好跨过纸纹的浅起伏）
  const dist = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dr = px[i] - bg[0], dg = px[i+1] - bg[1], db = px[i+2] - bg[2];
      // ⚠️ 用**最大值**而不是欧氏距离：纸纹会让三个通道一起轻微起伏，
      //    最大通道差对"略偏色的浅底"更宽容，而不会把银色高光一起放进来。
      dist[y * w + x] = Math.min(255, Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db)));
    }
  }
  const isBg = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, 0, x, h - 1); }
  for (let y = 0; y < h; y++) { stack.push(0, y, w - 1, y); }
  const PUSH = (x, y) => { const k = y * w + x; if (!isBg[k] && dist[k] < SOFT) { isBg[k] = 1; stack.push(x, y); } };
  while (stack.length) {
    const y = stack.pop(), x = stack.pop(), k = y * w + x;
    if (dist[k] < HARD) isBg[k] = 1;
    if (x > 0) PUSH(x - 1, y);
    if (x < w - 1) PUSH(x + 1, y);
    if (y > 0) PUSH(x, y - 1);
    if (y < h - 1) PUSH(x, y + 1);
  }
  // ③ 上透明度 + **一圈羽化**（硬边会在缩略图里显出一圈锯齿，而"锯齿"和
  //    "图本身就这样"分不开）。羽化只做在**紧贴背景**的那一层。
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x, i = k * 4;
      if (isBg[k]) { px[i+3] = 0; continue; }
      // 挨着背景 ⇒ 按"颜色离背景多远"给一个软 alpha；里面 ⇒ 全不透明
      let edge = false;
      if (x > 0 && isBg[k-1]) edge = true;
      else if (x < w-1 && isBg[k+1]) edge = true;
      else if (y > 0 && isBg[k-w]) edge = true;
      else if (y < h-1 && isBg[k+w]) edge = true;
      px[i+3] = edge ? Math.max(40, Math.min(255, dist[k] * 8)) : 255;
      // ⚠️⚠️ 包围盒**只认真的不透明的那些像素**（alpha ≥ 140）。
      //    第一版把所有 alpha>0 的都算进来 ⇒ 底部那点**几乎看不见的水印残影**
      //    把包围盒撑成了整张图 ⇒ **裁了等于没裁**（量出来主体只占画布 6%）。
      //    ⚠️ 判据的形状：这一步错了不会报错，只会让图上多出一大片空白。
      if (px[i+3] >= 140) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return { error: '抠完之后一个像素都不剩 —— 泛洪把整张图都吃了' };

  // ④ ⚠️⚠️ **只留最大的那块连通域。**
  //    为什么必须做：这张图右下角有个**水印**（"豆包AI生成"）—— 它不是背景
  //    （有颜色、泛洪吃不掉），于是它**把包围盒撑到了整张图** ⇒ 裁了等于没裁
  //    （量出来主体只占画布 6%，而那**不会报错**，只是图上多一大片空白）。
  //    ⇒ 玫瑰是一整块、水印是几个小字 ⇒ 按大小挑，通用而且不挑图。
  const solidMask = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) solidMask[k] = px[k * 4 + 3] >= 140 ? 1 : 0;
  const seen2 = new Uint8Array(w * h);
  let best = null;
  const st2 = new Int32Array(w * h);
  for (let start2 = 0; start2 < w * h; start2++) {
    if (!solidMask[start2] || seen2[start2]) continue;
    let sp = 0, n = 0, bx0 = w, by0 = h, bx1 = 0, by1 = 0;
    st2[sp++] = start2; seen2[start2] = 1;
    while (sp) {
      const k = st2[--sp]; n++;
      const x = k % w, y = (k - x) / w;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (y < by0) by0 = y; if (y > by1) by1 = y;
      if (x > 0 && solidMask[k-1] && !seen2[k-1]) { seen2[k-1] = 1; st2[sp++] = k-1; }
      if (x < w-1 && solidMask[k+1] && !seen2[k+1]) { seen2[k+1] = 1; st2[sp++] = k+1; }
      if (y > 0 && solidMask[k-w] && !seen2[k-w]) { seen2[k-w] = 1; st2[sp++] = k-w; }
      if (y < h-1 && solidMask[k+w] && !seen2[k+w]) { seen2[k+w] = 1; st2[sp++] = k+w; }
    }
    if (!best || n > best.n) best = { n, bx0, by0, bx1, by1 };
  }
  if (!best) return { error: '找不到任何实心块' };
  // 不是最大那块的一律抹掉（含羽化残影）—— ⚠️ 连 alpha 一起清，不然边框还在
  for (let k = 0; k < w * h; k++) {
    if (solidMask[k] && !seen2[k]) px[k * 4 + 3] = 0;
  }
  // 最大那块如果**特别小**，说明抠错了（宁可报出来，别默默给一张空图）
  if (best.n < w * h * 0.01) return { error: `最大的一块只占 ${(best.n / (w * h) * 100).toFixed(2)}% —— 抠过头了，检查背景色` };
  minX = best.bx0; maxX = best.bx1; minY = best.by0; maxY = best.by1;
  g.putImageData(d, 0, 0);
  if (maxX <= minX || maxY <= minY) return { error: '抠完之后一个像素都不剩 —— 背景色可能选错了' };

  // ③ 裁到主体 + 居中放到方形画布
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const inner = SIZE * (1 - PAD * 2);
  const k = Math.min(inner / bw, inner / bh);
  const dw = Math.round(bw * k), dh = Math.round(bh * k);
  const o = document.createElement('canvas');
  o.width = SIZE; o.height = SIZE;
  const og = o.getContext('2d');
  og.imageSmoothingQuality = 'high';
  og.drawImage(c, minX, minY, bw, bh, Math.round((SIZE - dw) / 2), Math.round((SIZE - dh) / 2), dw, dh);

  // ⚠️ 顺手把"主体占了多少"报出来 —— 抠过头 / 没抠掉，看这个数最直接
  let solid = 0;
  const od = og.getImageData(0, 0, SIZE, SIZE).data;
  for (let i = 3; i < od.length; i += 4) if (od[i] > 24) solid++;
  return {
    out: o.toDataURL('image/png'),
    bg, src: [w, h], bbox: [minX, minY, bw, bh],
    cover: +(solid / (SIZE * SIZE)).toFixed(4),
  };
}, { dataUrl, SIZE, PAD });
await br.close();

if (res.error) { console.error('❌ ' + res.error); process.exit(1); }
writeFileSync(out, Buffer.from(String(res.out).split(',')[1], 'base64'));
console.log(`✅ ${out}`);
console.log(`   原图 ${res.src[0]}×${res.src[1]} · 判定背景 rgb(${res.bg.join(',')})`);
console.log(`   主体包围盒 ${res.bbox[2]}×${res.bbox[3]} @ (${res.bbox[0]},${res.bbox[1]})`);
console.log(`   主体占画布 ${(res.cover * 100).toFixed(1)}%（太小 ⇒ 裁多了；>60% ⇒ 留白太少）`);
