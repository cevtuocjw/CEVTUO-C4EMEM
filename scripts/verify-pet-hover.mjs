/**
 * ⭐⭐⭐ **指针放上去就要自动展开** —— 不用点。
 *
 * 读者 2026-10-14：「就因为你刚刚的修改，导致我现在又必须得**点击 pet 一下**，
 *   才能出来所有的 app 图标，原本是指针放到这个位置就自动出来。」
 *
 * ⚠️⚠️ 真因是**我把一个键当两个用**：给「转法」存的是 `c4emem.pet.mode`，
 *    而 `mode` 本来就是宠物的**工作模式**（`'apps'` / `'single'`）。
 *    存成 `'swing'` 之后，`if (petPref().mode === 'apps')` 永不成立 ⇒ 悬停不再开。
 *    ⇒ 现在转法存 `spinMode`，并且 `migratePetPrefs()` 会把被写坏的 `mode` 修回来。
 *
 * ⚠️ 所以这个测试**必须拿"坏数据"跑一遍** —— 否则它在读者那台机器上照样会红。
 *
 * 跑：C4EMEM_BASE=http://127.0.0.1:8791 bun scripts/verify-pet-hover.mjs
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
const B = process.env.C4EMEM_BASE || 'http://127.0.0.1:8791';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };
const br = await chromium.launch({ args: ['--no-proxy-server', '--proxy-bypass-list=*', '--enable-unsafe-swiftshader'] });
const p = await br.newPage({ viewport: { width: 440, height: 520 } });
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));

async function hoverOpens(pref, label) {
  await p.goto(B + '/ui/pet.html', { waitUntil: 'load' });
  await p.evaluate((v) => localStorage.setItem('c4emem.pet', v), JSON.stringify(pref));
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const box = await p.locator('#pet').boundingBox();
  if (!box || box.width < 20) { ok(false, `${label}：#pet 没渲染出来`); return null; }
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // 先挪开，再**只靠悬停**靠过去 —— 全程不点任何东西
  await p.evaluate(([x, y]) => window.__petMouse(x - 400, y - 400), [cx, cy]);
  await p.waitForTimeout(120);
  const before = await p.evaluate(() => document.body.classList.contains('pw-on'));
  await p.evaluate(([x, y]) => window.__petMouse(x, y), [cx, cy]);
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => document.body.classList.contains('pw-on'));
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('c4emem.pet') || '{}'));
  const expectOpen = pref.mode !== 'single';
  if (expectOpen) ok(!before && after, `${label}：指针放上去就展开（挪开 ${before} → 靠上去 ${after}）`);
  else ok(!after, `${label}：单个 APP 模式下悬停**不弹圈**（靠上去 ${after}）`);
  return stored;
}

console.log('① 干净数据：悬停就该展开');
await hoverOpens({ form: 'card', spin: true }, '干净');

console.log('② ⭐ 读者机器上的**坏数据**（`mode:"swing"` 是我写坏的）：迁移之后照样展开');
const st = await hoverOpens({ form: 'card', spin: true, mode: 'swing', period: 4 }, '坏数据');
ok(st && st.mode === 'apps', `★ \`mode\` 被修回 'apps'（实际 ${st ? JSON.stringify(st.mode) : '?'}）`);
ok(st && st.spinMode === 'swing', `★ 转法搬到 \`spinMode\` 了（实际 ${st ? JSON.stringify(st.spinMode) : '?'}）`);

console.log('③ 用户真的选了「单个 APP」时：不许被迁移改掉，而且**悬停不该弹圈**');
{
  /* ⚠️ 这一条我第一版写成"悬停要弹圈" —— **断言错了**：
     单个 APP 模式的承诺就是"这一次什么圈都不出现，直接切过去"
     （`openWheel()` 第一句就是 `if (one) { launchOne(one); return; }`）。
     ⇒ 正确的断言是"**不弹圈** + mode 原样保留"。 */
  const s2 = await hoverOpens({ form: 'card', mode: 'single' }, 'single');
  ok(s2 && s2.mode === 'single', `★ \`mode\` 保持 'single'（实际 ${s2 ? JSON.stringify(s2.mode) : '?'}）`);
}

console.log('④ 4 种转法都能存进去、都能读回来（键名不能再撞）');
for (const m of ['swing120', 'swing90', 'swing60', 'full']) {
  await p.goto(B + '/ui/pet.html', { waitUntil: 'load' });
  await p.evaluate((v) => localStorage.setItem('c4emem.pet', v), JSON.stringify({ form: 'card', spin: true, spinMode: m, mode: 'apps' }));
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(400);
  const s3 = await p.evaluate(() => JSON.parse(localStorage.getItem('c4emem.pet') || '{}'));
  ok(s3.mode === 'apps' && s3.spinMode === m, `${m}：mode 仍是 'apps'，spinMode = ${s3.spinMode}`);
}

await br.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
