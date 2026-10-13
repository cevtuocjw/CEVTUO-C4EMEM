/**
 * 矿物标本（银 / 铅 / 锌）**白底真的被抠掉了吗**。
 *
 * ⚠️⚠️ 判据是「**背景像素的 alpha ≈ 0、标本的 alpha ≈ 255**」——
 *    用 canvas 自己 `readPixels` 读出来的**像素**，不是"canvas 在动"、
 *    也不是"样式表里写了 `#orbkey`"。写了不等于生效，生效不等于生效在**对的地方**。
 *
 * ⚠️ 反向对照（`-e NEGCTL=1`）：把 `vkey.js` 的阈值改成 `near=-99,far=-98`
 *    ⇒ 一切都不透明 ⇒ 四角 alpha 变 255 ⇒ 本条断言必须红。
 *    只想"看它有没有红"的话这一步不能省 —— 断言不会红 = 它什么都没测。
 *
 * 跑：env -u HTTPS_PROXY … NO_PROXY='*' bun scripts/verify-mineral-key.mjs
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const VKEY = '/Users/cjw/Documents/Cevtuo-C4emem/src/ui/vkey.js';
let restored = null;
if (process.env.NEGCTL) {
  const src = readFileSync(VKEY, 'utf8');
  restored = src;
  writeFileSync(VKEY, src.replace('opts.near ?? 0.045', 'opts.near ?? -99').replace('opts.far ?? 0.13', 'opts.far ?? -98'));
}

let pass = 0, fail = 0, skip = 0;
const ok = (n, c, extra = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (extra ? '  ' + extra : '')); } };

try {
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
  await p.waitForTimeout(1800);

  for (const m of ['silver', 'lead', 'zinc']) {
    await p.selectOption('#vorb', m);
    await p.waitForTimeout(1400);
    const r = await p.evaluate((form) => {
      const cv = document.querySelector('#orbkey');
      const box = document.querySelector('.orbbg');
      const rect = cv.getBoundingClientRect();
      const st = getComputedStyle(cv);
      // ⚠️⚠️ 像素**只能**从 keyer.stats() 拿（它自己画一帧、在同一个任务里读回）。
      //    从外面 `toDataURL()` 拿到的是**已被合成器清空的缓冲** —— 我第一版就是这么写的，
      //    结果四角 alpha=0（假绿）＋ 中心 alpha=0（看着像"整幅被抠没了"）。
      const s = window.__orbKeyer ? window.__orbKeyer.stats() : null;
      return {
        form, display: st.display,
        w: +rect.width.toFixed(1), h: +rect.height.toFixed(1),
        videoVisible: getComputedStyle(document.querySelector('#orbvid')).display,
        keyfail: box.dataset.keyfail || '',
        paused: document.querySelector('#orbvid').paused,
        s,
      };
    }, m);

    ok(`${m}：抠图层是显示着的`, r.display !== 'none' && r.w > 60, `display=${r.display} w=${r.w}`);
    ok(`${m}：白底那段视频不再露出来`, r.videoVisible === 'none', `video display=${r.videoVisible}`);
    ok(`${m}：没有走降级`, r.keyfail === '', `keyfail=${r.keyfail}`);
    ok(`${m}：那段视频在放（纹理源是活的）`, r.paused === false);
    if (!r.s) { fail++; console.log(`  ✗ ${m}：拿不到抠图的像素统计（keyer 没建起来）`); continue; }
    ok(`${m}：四角是透明的（alpha≤25）`, r.s.cornerMax <= 25, `四角 alpha=${r.s.corners.join(',')}`);
    ok(`${m}：标本本体是不透明的（有 alpha>200 的像素）`, r.s.maxA > 200, `maxAlpha=${r.s.maxA}`);
    // ⚠️ **不是退化的**：整幅全透明也会让上面那条"四角透明"通过 —— 必须再要一条
    ok(`${m}：不是整幅全透明（不透明采样点 > 3%）`, r.s.opaque > r.s.samples * 0.03,
      `不透明=${r.s.opaque}/${r.s.samples}`);
    ok(`${m}：透明与不透明**同时**存在（真的抠了：不是全透也不是全不透）`,
      r.s.cornerMax <= 25 && r.s.maxA > 200 && r.s.opaque > r.s.samples * 0.03);
    await p.screenshot({ path: `out/mineral-${m}.png` });
  }
  ok('没有页面报错', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
} catch (e) {
  fail++;
  console.log('  ✗ 跑不起来：' + e.message);
} finally {
  if (restored) writeFileSync(VKEY, restored);
}

console.log(`\n${pass}/${pass + fail} 通过` + (skip ? ` · ${skip} 跳过` : ''));
process.exit(fail ? 1 : 0);
