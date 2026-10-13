/**
 * 2026-10-09 这一批的判据。
 * ⚠️ 全部是「契约」不是「运气」：
 *   · 点击式连线 —— 判据是 wires 真的多了一条（不是"高亮出现了"）
 *   · 重叠 —— 判据是两个矩形**真的不相交**（不是"看着不叠"）
 *   · 搜索空态 —— 判据是空态里**说得出这次的来源**（不是"有卡片"）
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { seedFlow } from './_flowseed.mjs';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_FILE/.test(m.text())) errs.push(m.text()); });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

await seedFlow([
  { id: 'b1', kind: 'kb_search', text: '先在笔记里找「骑行 心率」' },
  { id: 'b2', kind: 'llm_summary', text: '把找到的合成一段结论' },
], []);
await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
await p.waitForTimeout(900);
await p.click('.thumb[data-m="flow"]');
await p.waitForTimeout(700);

// ───────────────────────── ① 点击式连线 ─────────────────────────
console.log('\n▸ ① 端口连线：点两下（不是拖）');
const wireCount = () => p.evaluate(() => JSON.parse(localStorage.getItem('c4emem.wires') || '[]').length);
const before = await wireCount();

const clickPort = async (sel) => {
  const el = await p.$(sel);
  if (!el) { console.log('    (找不到 ' + sel + '，这条跳过)'); return false; }
  const r = await el.boundingBox();
  await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await p.mouse.down(); await p.waitForTimeout(60); await p.mouse.up();
  await p.waitForTimeout(260);
  return true;
};

await clickPort('#flowlist .blk[data-id="b1"] .port.out[data-t="notes"]');
const armed = await p.evaluate(() => document.body.classList.contains('wiring'));
ok(armed, '点了出端口之后，线是「举着」的（body.wiring）');
const lit = await p.evaluate(() => document.querySelectorAll('#flowlist .port.in.ok').length);
ok(lit > 0, `兼容的入端口亮着（${lit} 颗）`);
await clickPort('#flowlist .blk[data-id="b2"] .port.in[data-t="text"]');
const after = await wireCount();
ok(after === before + 1, `点击式真的连上了（wires ${before} → ${after}）`);
ok(!(await p.evaluate(() => document.body.classList.contains('wiring'))), '连上之后线放下了（wiring 类清掉）');
ok((await p.evaluate(() => document.querySelectorAll('#wires path').length)) > 0, '线画出来了');

// 类型不合的不许接上 —— 目标是**动态找**的：出端口能连的是同类型 + 笔记/网页→文本
const badSel = await p.evaluate(() => {
  for (const i of document.querySelectorAll('#flowlist .port.in')) {
    const t = i.dataset.t;
    if (t !== 'notes' && t !== 'text' && !i.classList.contains('ok')) { i.setAttribute('data-probe', '1'); return '#flowlist .port.in[data-probe="1"]'; }
  }
  return null;
});
if (!badSel) console.log('    (这一屏没有类型不合的入端口 —— 这条跳过)');
else {
  const n2 = await wireCount();
  await clickPort('#flowlist .blk[data-id="b1"] .port.out[data-t="notes"]');
  await clickPort(badSel);
  ok((await wireCount()) === n2, '类型不合的接不上（笔记 → 它没连）');
  await p.evaluate(() => document.querySelectorAll('[data-probe]').forEach((e) => e.removeAttribute('data-probe')));
}

// Esc 能放下举着的线
await clickPort('#flowlist .blk[data-id="b1"] .port.out[data-t="notes"]');
await p.keyboard.press('Escape');
await p.waitForTimeout(200);
ok(!(await p.evaluate(() => document.body.classList.contains('wiring'))), 'Esc 能放下举着的线');

// ───────────────────────── ② 收起栏后的重叠 ─────────────────────────
// ⭐ 三种情况都要看：只收来源栏 / 只收记录栏 / 两个都收。
//    ⚠️ 只测一种等于没测 —— 我第一版就只测了"只收来源栏"，
//    而读者截图里其实是**两个都收**（画布占满整宽），换成那个才是真会叠的组合。
console.log('\n▸ ② 收起栏之后，恢复条都不许压住内容');
const geometry = () => p.evaluate(() => {
  const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const bar = document.querySelector('#restorebar');
  return { bar: { hidden: bar.hidden, ...rect('#restorebar') }, seg: rect('#flowstyle'), dash: rect('.dashhead'), body: document.body.className };
});
const overlaps = (a, b) => !!a && !!b && a.w > 0 && b.w > 0 &&
  !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

const cases = [
  ['只收来源栏', async () => { await p.click('#railBtn'); }],
  ['来源栏 + 记录栏都收', async () => { await p.click('#recBtn'); }],
];
for (const [name, act] of cases) {
  await act();
  await p.waitForTimeout(550);
  const g = await geometry();
  ok(!g.bar.hidden && g.bar.w > 0, `${name}：恢复条显示着（宽 ${Math.round(g.bar.w)}px，body="${g.body}"）`);
  ok(!overlaps(g.bar, g.seg), `${name}：不压结构流工具栏（条 ${Math.round(g.bar.x)}..${Math.round(g.bar.x + g.bar.w)}，工具栏 ${Math.round(g.seg.x)}..${Math.round(g.seg.x + g.seg.w)}）`);
  if (g.dash && g.dash.w > 0) ok(!overlaps(g.bar, g.dash), `${name}：不压记录栏标题`);
  // ⭐ 负向对照：把让位量强行归零 ⇒ **必须真的叠上**。不红就说明上面那条在测空气。
  const hitZero = await p.evaluate(() => {
    document.body.style.setProperty('--restorew', '0px');
    const a = document.querySelector('#restorebar').getBoundingClientRect();
    const s = document.querySelector('#flowstyle').getBoundingClientRect();
    return !(a.right <= s.left || s.right <= a.left || a.bottom <= s.top || s.bottom <= a.top);
  });
  ok(hitZero, `${name}：负向对照 —— 让位量归零就真的会叠上`);
  await p.evaluate(() => document.body.style.removeProperty('--restorew'));
}
await p.click('#rsRail');
await p.click('#rsRec');
await p.waitForTimeout(500);

// ───────────────────────── ③ 搜索空态 ─────────────────────────
//
// ⚠️⚠️ 这一段 2026-10-09 晚**重写过**，因为它的前提没了：
//   原来写死「选 邮件（wecom）—— 邮件还没接入 ⇒ 库里没有数据」，
//   而那天邮件真的接进来了（36 封进 exmail）⇒ 前提失效、两条断言变红。
//   查下去还发现：**这条空态在界面上现在根本走不到**，两个独立的原因：
//     ① 没有数据的来源被「功能按来源放行」**挡在门口**（点搜索只弹一句"还没有内容"，
//        压根不进搜索视图）—— 实测 feishu / figma 都是这样；
//     ② 有数据的来源，向量腿**永远返回 top-N**，没有分数阈值 ——
//        实测连乱码 `zqxjwv` 都能拿回 10 条（余弦 0.62）⇒ 永远不是 0 命中。
//   ⇒ 判断挪到**它还能到的地方**：服务端那条路（spaces 指一个没有 chunk 的库）
//     仍然必须给出 0 条；界面上验的是**新的**那条出口（灰掉 + 说清原因 + 给回去的路）。
console.log('\n▸ ③ 搜索：空来源要说清"为什么不能搜 / 怎么回去"');
await p.evaluate(() => { localStorage.setItem('c4emem.src', 'feishu'); });
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(1000);
ok(await p.$eval('.nv[data-v="search"]', (e) => e.classList.contains('na')), '空的来源 ⇒ 搜索被标成不可点（.na）');
await p.click('.nv[data-v="search"]');
await p.waitForTimeout(600);
const why = await p.evaluate(() => document.querySelector('#toast')?.textContent || '');
ok(/飞书/.test(why) && /没有内容/.test(why), `说得出**是哪个**库没有内容（实得「${why.slice(0, 40)}」）`);
ok(/融合/.test(why), '并且给了**回去的路**（切回「融合」）—— 这就是原来那条「再搜一次」的替代');
ok((await p.evaluate(() => window.__app.kbView)) === null, '点了也**没有**真的切进搜索视图');

// 服务端那条路：指向一个没有 chunk 的 space，必须老老实实返回 0 条
// ⚠️ 参数名是 **`space`**（可重复 / 可逗号分隔），不是 `spaces` ——
//    写错了不会报错，只会**当作没传**，于是全库搜出 10 条，看起来像"服务端硬凑"。
const zero = await (await fetch('http://127.0.0.1:8770/api/search?q=kindle&space=__none__')).json();
ok(zero.hits.length === 0, `服务端仍然是 0 命中就 0 命中（实得 ${zero.hits.length} 条）`);
// 收尾：来源切回「融合」，不然下面「推荐」那一段会被按来源放行挡住
await p.evaluate(() => localStorage.setItem('c4emem.src', 'blend'));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(900);

// ───────────────────────── ④ 推荐「换一批」 ─────────────────────────
console.log('\n▸ ④ 推荐：有「换一批」，而且它真的把上一批排除掉');
await p.click('.nv[data-v="rec"]');
await p.waitForTimeout(500);
ok(!!(await p.$('#regen')), '「换一批」按钮在');
ok(await p.$eval('#regen', (e) => e.disabled), '还没生成过之前它是禁用的（不会白点一次）');

// ───────────────────────── ⑤ 同步弹窗 ─────────────────────────
console.log('\n▸ ⑤ 同步弹窗：有内容、有逐来源按钮、能关');
await p.click('#syncBtn');
await p.waitForTimeout(1200);
const sm = await p.evaluate(() => {
  const m = document.querySelector('#syncmodal');
  return { open: !m.hidden, rows: document.querySelectorAll('#syncbody .syncrow').length,
    btns: document.querySelectorAll('#syncbody button[data-sync]').length,
    text: document.querySelector('#syncbody').innerText.slice(0, 220) };
});
ok(sm.open, '弹窗打开了');
ok(sm.btns >= 3, `逐个来源都有「同步」按钮（${sm.btns} 个）`);
ok(sm.rows >= 3, `行渲染出来了（${sm.rows} 行）`);
ok(/能同步|还差点东西/.test(sm.text), '每行都写了「能不能同步」');
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
ok(await p.$eval('#syncmodal', (e) => e.hidden), 'Esc 能关掉同步弹窗');

ok(errs.length === 0, '没有页面报错' + (errs.length ? '：' + errs.slice(0, 3).join(' | ') : ''));

console.log(`\n${pass}/${pass + fail} 通过`);
await b.close();
process.exit(fail ? 1 : 0);
