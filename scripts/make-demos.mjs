/**
 * ⭐ 分发页要用的**演示视频 + GIF** —— 一条命令全出。
 *
 * ⚠️⚠️ 本机**没有 ffmpeg**（Playwright 那个 chromium 目录里也没有）——
 *    所以：
 *      · 视频只能出 **webm**（Playwright 录的），**压不出 mp4**；
 *      · GIF 不走视频转码 —— 直接**逐帧截图**，再用 Pillow 拼（`uv run --with pillow`）。
 *
 * 跑：bun scripts/make-demos.mjs
 * 产物 → `~/Library/Application Support/CEVTUO-RWP-build/usersite/cevtuopet/assets/`
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';

const B = process.env.C4EMEM_BASE || 'http://127.0.0.1:8770';
const OUT = `${process.env.HOME}/Library/Application Support/CEVTUO-RWP-build/usersite/cevtuopet/assets`;
const TMP = '/tmp/pet-demos';
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });

const br = await chromium.launch({
  args: ['--no-proxy-server', '--proxy-bypass-list=*', '--enable-unsafe-swiftshader'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 开一个带"录屏"的上下文，跑完把 webm 挪到目的地 */
async function record(name, w, h, fn) {
  const ctx = await br.newContext({
    viewport: { width: w, height: h },
    recordVideo: { dir: TMP, size: { width: w, height: h } },
    deviceScaleFactor: 1,
  });
  // Pet 那一页会去读 localStorage 里的偏好；给一套干净的默认值
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('c4emem.pet')) localStorage.setItem('c4emem.pet', JSON.stringify({ form: 'card', spin: true }));
    window.webkit = { messageHandlers: { c4: { postMessage() {} } } };
    /* ⚠️⚠️ 录 `pet.html` 时必须补两样，不然录出来是**一片白 + 角落一小只**：
       · 它是给**透明小窗**画的，浏览器里 body 是白的 ⇒ 铺一层"桌面"底色；
       · 它的位置是 `right:26px;bottom:96px`（相对窗口），而窗口在真 App 里
         会随轮盘**长大**才够放那一圈 —— 浏览器里没人替它长
         ⇒ 直接把宠物**钉在正中间**，那一圈才完整。 */
    const st = document.createElement('style');
    st.textContent = `
      html,body{background:
        radial-gradient(120% 90% at 18% 12%, #3b4b63 0%, #232a38 42%, #171a22 100%) !important}
      .pet{right:auto !important;bottom:auto !important;
           left:50% !important;top:50% !important;transform:translate(-50%,-50%) !important}
    `;
    const put = () => document.head && document.head.appendChild(st);
    if (document.head) put(); else addEventListener('DOMContentLoaded', put);
  });
  const p = await ctx.newPage();
  try { await fn(p); } catch (e) { console.log(`  ⚠️ ${name}: ${e.message}`); }
  const vid = p.video();
  await ctx.close();
  if (vid) {
    const t = await vid.path();
    if (t) { try { renameSync(t, `${OUT}/${name}.webm`); console.log(`  ✓ ${name}.webm`); } catch (e) { console.log(`  ✗ ${name}: ${e.message}`); } }
  }
}

console.log('① 那一圈软件（悬停展开 → 敲首字母）');
await record('demo-wheel', 700, 700, async (p) => {
  await p.goto(`${B}/ui/pet.html`, { waitUntil: 'load' });
  await sleep(2500);
  // 悬停：窗口坐标里宠物本体大概在 (162,268)；先晃两下再停上去
  for (const [x, y] of [[120, 200], [200, 300], [162, 268]]) {
    await p.mouse.move(x, y); await sleep(320);
  }
  await sleep(2600);                       // 让它摊开
  for (const [x, y] of [[360, 300], [300, 420], [250, 200], [330, 360]]) { await p.mouse.move(x, y); await sleep(420); }
  await sleep(1200);
  await p.keyboard.press('c');             // 敲首字母
  await sleep(1400);
  await p.keyboard.press('e');
  await sleep(1600);
});

console.log('② 换形态 + 转 / 不转');
await record('demo-forms', 420, 420, async (p) => {
  await p.goto(`${B}/ui/pet.html`, { waitUntil: 'load' });
  for (const [form, spin] of [['card', true], ['pearl', true], ['silver', true], ['silver', false], ['zinc', true], ['lead', true]]) {
    await p.evaluate(([f, s]) => localStorage.setItem('c4emem.pet', JSON.stringify({ form: f, spin: s })), [form, spin]);
    await p.reload({ waitUntil: 'load' });
    await sleep(2600);
  }
});

console.log('③ 一起造一只新的（拖一张图 → 抠底 → 量深度 → 出 3D）');
await record('demo-make', 900, 780, async (p) => {
  await p.goto(`${B}/ui/petsettings.html`, { waitUntil: 'load' });
  await sleep(1200);
  await p.evaluate(() => document.querySelector('#mkdrop').scrollIntoView({ block: 'center' }));
  await sleep(900);
  // ⚠️ 用**服务端现在真的有的那一只**（读者会自己删/换宠物，写死一个名字必然失效）
  const src = await p.evaluate(async () => {
    const r = await (await fetch('/api/pet/forms')).json();
    return (r.items || [])[0] ? (r.items[0].img) : null;
  });
  if (!src) throw new Error('库里有 0 只宠物 —— 演示没法录');
  await p.goto(`${B}${src}`, { waitUntil: 'load' });
  const dl = await p.evaluate(() => location.href);
  await p.evaluate(async (u) => { window.__img = u; }, dl);
  await p.goto(`${B}/ui/petsettings.html`, { waitUntil: 'load' });
  await p.evaluate(() => document.querySelector('#mkdrop').scrollIntoView({ block: 'center' }));
  await p.setInputFiles('#mkfile', { name: 'ref.png', mimeType: 'image/png', buffer: null }).catch(() => {});
  const b64 = await p.evaluate(async (u) => {
    const b = await (await fetch(u)).blob();
    return await new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(b); });
  }, dl);
  await p.setInputFiles('#mkfile', { name: 'ref.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  try {
    await p.waitForFunction(() => {
      const c = document.querySelector('#mk3dcap');
      return c && /三角面|装不上/.test(c.textContent);
    }, { timeout: 180000 });
  } catch { /* 超时就让它录到失败为止 —— 别把"没等够"咽下去 */ }
  await sleep(3500);
  await p.fill('#mknamein', '银玫瑰');
  await sleep(600);
  await p.click('#mksave');
  await sleep(2500);
});

// ── GIF：逐帧截（不走视频转码）──────────────────────────────────
console.log('④ GIF：那只 3D 在转 + 不转（两种状态各一段）');
{
  const ctx = await br.newContext({ viewport: { width: 240, height: 240 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { window.webkit = { messageHandlers: { c4: { postMessage() {} } } }; });
  const p = await ctx.newPage();
  const frames = [];
  async function grab(form, spin, n, gap, tag) {
    await p.evaluate(([f, s]) => localStorage.setItem('c4emem.pet', JSON.stringify({ form: f, spin: s })), [form, spin]);
    await p.reload({ waitUntil: 'load' });
    await sleep(2600);
    const box = await p.locator('#pet').boundingBox();
    for (let i = 0; i < n; i++) {
      frames.push({ buf: await p.screenshot({ clip: box }), tag });
      await sleep(gap);
    }
  }
  await p.goto(`${B}/ui/pet.html`, { waitUntil: 'load' });
  const forms = await p.evaluate(async () => {
    const r = await (await fetch('/api/pet/forms')).json();
    const mine = (r.items || [])[0];
    return { mine: mine && mine.depth ? 'u-' + mine.id : null };
  });
  await grab('silver', true, 26, 90, 'spin');
  await grab('silver', false, 8, 90, 'still');
  if (forms.mine) await grab(forms.mine, true, 26, 90, 'rose');
  await ctx.close();
  writeFileSync(`${TMP}/frames.json`, JSON.stringify(frames.map((f) => ({ tag: f.tag }))));
  for (let i = 0; i < frames.length; i++) writeFileSync(`${TMP}/f${String(i).padStart(3, '0')}.png`, frames[i].buf);
  console.log(`  ✓ ${frames.length} 帧 → /tmp/pet-demos/`);
}

await br.close();
console.log('✅ 视频 →', OUT);
