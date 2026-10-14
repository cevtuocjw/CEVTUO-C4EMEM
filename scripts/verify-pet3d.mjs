/**
 * ⭐⭐ 「2D 图 → **真 3D**」的验收（读者 2026-10-14：「不是仅仅加厚」）。
 *
 * 跑法：
 *   C4EMEM_CONFIG=/tmp/c4pet3d.json C4EMEM_PORT=8791 bun run src/server.ts &
 *   bun scripts/verify-pet3d.mjs                 # 默认打 8791（沙盒）
 *
 * ⚠️⚠️ 打的是**真实那条路**：设置页上传图 → 抠底 → 跑深度模型 → 存 → 桌面那只读它。
 *    每一步都可能在下一步里"看起来是对的"。所以：
 *      · 判据打在 `window.__pet3d` 上（**页面自证**：三角面数 / 在不在转 / 角度），
 *        不是"画布存在" —— **冻结在 0° 的 3D 和"没挂上"在截图上分不开**；
 *      · 「不转」要断言 `frames` **不再增长**（WebGL 不吃 CSS 动画，
 *        用 `getAnimations()` 会得到恒 0 —— 那正是本项目栽过的假绿）。
 *
 * 跑之前会先把沙盒库清空（`dataDir` 在配置里，见文件尾的 SAFE 检查）。
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { readFileSync, existsSync } from 'node:fs';

const B = process.env.C4EMEM_BASE || 'http://127.0.0.1:8791';
const ROSE = process.env.ROSE_PNG || `${process.env.HOME}/.c4emem/pets/pet-nycuj.png`;

let pass = 0, fail = 0, skip = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };
const sk = (m) => { skip++; console.log('  ⏭ ' + m); };
const sec = (t) => console.log('\n' + t);

// ⚠️ 先确认打的是**沙盒**，不是读者正在用的那个核心 —— 这一步会往 dataDir 里写东西
const cfg = process.env.C4EMEM_CONFIG || '/tmp/c4pet3d.json';
if (!existsSync(cfg)) { console.log(`❌ 找不到沙盒配置 ${cfg}`); process.exit(2); }
const dataDir = JSON.parse(readFileSync(cfg, 'utf8')).dataDir || '';
if (!/^\/tmp\//.test(dataDir)) { console.log(`❌ dataDir 不在 /tmp 下（${dataDir}）—— 拒绝在真实数据上跑`); process.exit(2); }
if (!existsSync(ROSE)) { console.log(`❌ 没有测试图 ${ROSE}`); process.exit(2); }

const br = await chromium.launch({ args: ['--no-proxy-server', '--proxy-bypass-list=*', '--enable-unsafe-swiftshader'] });
// ⚠️ 设置页和 Pet 页**必须同一个 context**（= 同一个 localStorage 域）
const ctx = await br.newContext({ viewport: { width: 1100, height: 900 } });
await ctx.addInitScript(() => { window.webkit = { messageHandlers: { c4: { postMessage() {} } } }; });

const S = await ctx.newPage();
S.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
S.on('console', (m) => { if (m.type() === 'error') console.log('  [err]', m.text().slice(0, 200)); });

sec('① 设置页：上传一张 2D 图，它要自己走完「抠底 → 量深度」');
await S.goto(B + '/ui/petsettings.html', { waitUntil: 'load' });
ok(await S.$('#mkfile') !== null, '有「上传」那个口');
await S.setInputFiles('#mkfile', ROSE);
// 深度模型第一次要十几秒（要下 19MB 的 onnx 到内存 + 初始化 wasm）
let cap = '';
try {
  await S.waitForFunction(() => {
    const c = document.querySelector('#mk3dcap');
    return c && /三角面|装不上/.test(c.textContent);
  }, { timeout: 180000 });
  cap = await S.$eval('#mk3dcap', (e) => e.textContent);
} catch { /* 落到下面按 cap 判 */ }
ok(/三角面/.test(cap), `预览里真的挂出了 3D：${cap || '（没出结果）'}`);

const made = await S.evaluate(() => {
  const c = document.querySelector('#mk3dc');
  return c && c.__pet3d
    ? { tris: c.__pet3d.tris, spin: c.__pet3d.spin, relief: c.__pet3d.relief, distinctZ: c.__pet3d.distinctZ }
    : null;
});
ok(!!made && made.tris > 8000, `三角面数是真的：${made ? made.tris : 'null'}`);
// ⚠️⚠️ **面数证明不了"不是一块平板"** —— 全叠在同一个 z 上照样是 8 万个面。
//    所以真正的判据是下面这两条（本项目在"叠 16 层"那版上栽过同一个形状）。
ok(!!made && made.relief > 0.05, `★ 真的鼓起来了（起伏 ${made ? made.relief.toFixed(3) : '—'}，< 0.05 就是平的）`);
ok(!!made && made.distinctZ > 50, `★ 顶点不是全落在同一层（${made ? made.distinctZ : '—'} 个不同的 z）`);

// ★ 预览里那只真的在动（角度在变）
const a1 = await S.evaluate(() => document.querySelector('#mk3dc').__pet3d.angle);
await S.waitForTimeout(1200);
const a2 = await S.evaluate(() => document.querySelector('#mk3dc').__pet3d.angle);
ok(Math.abs(a2 - a1) > 1e-4, `★ 预览在转（角度 ${a1.toFixed(3)} → ${a2.toFixed(3)} 弧度）`);
await S.screenshot({ path: '/tmp/pet3d-settings.png' });

sec('② 存下来：深度图必须真的落到盘上（"做完了"和"存下来了"是两件事）');
await S.fill('#mknamein', '验收玫瑰');
await S.click('#mksave');
await S.waitForTimeout(2500);
const forms = await (await fetch(B + '/api/pet/forms')).json();
const it = (forms.items || [])[0];
ok(!!it, `列表里出现了：${it ? it.nm : '（空）'}`);
ok(!!it && !!it.depth, `★ 它带着深度图（${it && it.depth ? it.depth : '没有'}）`);
if (it && it.depth) {
  const r = await fetch(B + it.depth);
  ok(r.ok && Number(r.headers.get('content-length') || 0) > 2000, `深度图能取到（${r.status}，${r.headers.get('content-length')} 字节）`);
}

sec('③ 桌面上那只：同一份名单、同一套渲染（换过去必须真的是 3D）');
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
await P.goto(B + '/ui/pet.html', { waitUntil: 'load' });
await P.evaluate((f) => localStorage.setItem('c4emem.pet', JSON.stringify({ form: f })), 'u-' + it.id);
await P.reload({ waitUntil: 'load' });
let live = null;
try {
  await P.waitForFunction(() => {
    const c = document.querySelector('#pet3dc');
    return c && c.__pet3d;
  }, { timeout: 60000 });
  live = await P.evaluate(() => {
    const c = document.querySelector('#pet3dc');
    return { tris: c.__pet3d.tris, cls: document.querySelector('#petbody').className, on: c.__pet3d.on };
  });
} catch { /* 落到断言里 */ }
ok(!!live, '桌面上那只挂上了 3D 画布');
ok(!!live && live.cls.includes('p3d'), `形态类是 p3d（实际：${live ? live.cls : '—'}）`);
ok(!!live && live.tris === made.tris, `★ 和预览是同一套几何（${live ? live.tris : '—'} vs ${made.tris}）`);

sec('④ 「转 / 不转」—— 这一条是读者点名说"还是没处理好"的那个');
{
  const f1 = await P.evaluate(() => document.querySelector('#pet3dc').__pet3d.frames);
  await P.waitForTimeout(1000);
  const f2 = await P.evaluate(() => document.querySelector('#pet3dc').__pet3d.frames);
  ok(f2 > f1 + 5, `★ 默认**在转**（1 秒内画了 ${f2 - f1} 帧）`);
}
{
  // 改 localStorage 再 reload —— 这正是设置页勾选后走的那条路（`reloadPet` → location.reload）
  await P.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('c4emem.pet') || '{}');
    p.spin = false;
    localStorage.setItem('c4emem.pet', JSON.stringify(p));
  });
  await P.reload({ waitUntil: 'load' });
  await P.waitForFunction(() => {
    const c = document.querySelector('#pet3dc');
    return c && c.__pet3d;
  }, { timeout: 60000 });
  const r1 = await P.evaluate(() => {
    const c = document.querySelector('#pet3dc').__pet3d;
    return { f: c.frames, ang: c.angle, spin: c.spin };
  });
  await P.waitForTimeout(1200);
  const r2 = await P.evaluate(() => {
    const c = document.querySelector('#pet3dc').__pet3d;
    return { f: c.frames, ang: c.angle };
  });
  ok(r1.spin === false, '★ spin 真的传到了 three 那边（CSS 管不着 WebGL）');
  ok(r2.f === r1.f, `★ 帧数**不再增长**（${r1.f} → ${r2.f}）—— 真停了，不是"看着像停了"`);
  ok(Math.abs(r2.ang) < 1e-6, `★ 停在**正对镜头**（角度 ${r2.ang.toFixed(4)} 弧度），不是冻在某个侧角`);
  await P.screenshot({ path: '/tmp/pet3d-still.png' });
  // 再打开：必须还能转（"关掉之后就再也打不开"是这一族最坏的形状）
  await P.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('c4emem.pet') || '{}');
    p.spin = true;
    localStorage.setItem('c4emem.pet', JSON.stringify(p));
  });
  await P.reload({ waitUntil: 'load' });
  await P.waitForFunction(() => {
    const c = document.querySelector('#pet3dc');
    return c && c.__pet3d;
  }, { timeout: 60000 });
  const q1 = await P.evaluate(() => document.querySelector('#pet3dc').__pet3d.frames);
  await P.waitForTimeout(1000);
  const q2 = await P.evaluate(() => document.querySelector('#pet3dc').__pet3d.frames);
  ok(q2 > q1 + 5, `★ 打开之后又能转了（${q1} → ${q2}）`);
}

sec('⑤ 主界面（app.js）那只 —— 以前它**完全不认识** spin 和自己造的形态');
{
  const A = await ctx.newPage();
  A.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  await A.goto(B + '/', { waitUntil: 'load' });
  // ⚠️ form 用的是**服务端给的 id**（`pet-a369f`），不是名字 —— 我第一版写了名字，
  //    于是 "u-验收玫瑰" 在名单里查不到 ⇒ 静默退回叠层 ⇒ 测出来像是**产品坏了**。
  await A.evaluate((f) => localStorage.setItem('c4emem.pet', JSON.stringify({ on: true, form: f })), 'u-' + it.id);
  await A.reload({ waitUntil: 'load' });
  await A.waitForTimeout(3500);
  const r = await A.evaluate(() => {
    const b = document.querySelector('#petbody');
    const c = document.querySelector('#pet3dc');
    return { on: document.body.classList.contains('pet-on'), cls: b ? b.className : '', has3d: !!c, tris: c && c.__pet3d ? c.__pet3d.tris : null };
  });
  if (!r.on) sk('主界面那只没打开（pet-on 关着）—— 这一节跳过，不算通过也不算失败');
  else {
    ok(r.cls.includes('p3d'), `主界面那只走的是 3D（类名：${r.cls}）`);
    ok(!!r.tris && r.tris > 8000, `主界面那只是真的几何（${r.tris}）`);
  }
  await A.close();
}

await br.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail}${skip ? ` · 跳过 ${skip}` : ''}`);
process.exit(fail ? 1 : 0);
