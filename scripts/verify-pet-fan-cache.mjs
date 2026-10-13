/**
 * 验证：Pet 的扇（轮盘）**每次展开都要现读"正在运行"**。
 * 复现读者 2026-10-13 报的：软件已经关掉了（右键那个列表里已经没了），
 * 可是摸一下 Pet 弹出的扇里**还有它的图标**。
 *
 * 手法：走**真实页面 + 真实交互**（`__petMouse` 就是 Swift 喂鼠标那条路），
 *      只把 `/api/running` 打桩成可控的两份数据。
 */
import { chromium } from '/Users/cjw/Documents/DSP Deepseek/pingfang-factcheck/node_modules/playwright-core/index.js';

const URL_PET = 'http://127.0.0.1:8770/ui/pet.html';
const A = [
  { name: 'Alpha', path: '/Applications/Alpha.app', pid: 11 },
  { name: 'Bravo', path: '/Applications/Bravo.app', pid: 12 },
  { name: 'Charlie', path: '/Applications/Charlie.app', pid: 13 },
];
const B = [
  { name: 'Alpha', path: '/Applications/Alpha.app', pid: 11 },
  { name: 'Bravo', path: '/Applications/Bravo.app', pid: 12 },
]; // ← Charlie 退掉了

let fails = 0, passes = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { passes += 1; console.log('  ✓ ' + label); }
  else { fails += 1; console.log('  ✗ ' + label + (extra ? '  ' + extra : '')); }
};

const b = await chromium.launch({ args: ['--no-proxy-server', '--proxy-bypass-list=*'] });
const p = await b.newPage({ viewport: { width: 900, height: 780 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('  PAGEERROR ' + e.message));
await p.goto(URL_PET, { waitUntil: 'load' });
await p.waitForTimeout(700);

// ── 打桩 /api/running（只拦这一条，其余照走）──────────────────
await p.evaluate((a) => {
  window.__fake = { phase: 'A', A: a, B: null };
  const of = window.fetch.bind(window);
  window.fetch = (u, o) => {
    const s = String(u);
    if (s.includes('/api/running')) {
      const list = window.__fake.phase === 'A' ? window.__fake.A : window.__fake.B;
      return Promise.resolve(new Response(JSON.stringify({ apps: list }),
        { headers: { 'content-type': 'application/json' } }));
    }
    return of(u, o);
  };
}, A);

const CENTER = await p.evaluate(() => {
  const r = document.querySelector('#pet').getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});

/** 扇里实际画出来的那些 App（从图标 URL 的 path 反推，不读我们的内部状态） */
const fan = () => p.evaluate(() => {
  const host = document.querySelector('#pwwheel');
  const open = document.body.classList.contains('pw-on');
  const paths = [...host.querySelectorAll('.pwic img')]
    .map((i) => decodeURIComponent(String(i.getAttribute('src') || '').replace(/^.*path=/, '')))
    .map((s) => s.split('/').pop());
  return { open, paths };
});

const hover = async (x, y, ms) => { await p.evaluate(([x, y]) => window.__petMouse(x, y), [x, y]); await p.waitForTimeout(ms); };

console.log('① 第一次摸 Pet（此时运行中 = Alpha/Bravo/Charlie）');
await hover(CENTER.x, CENTER.y, 500);
let r1 = await fan();
ok(r1.open, '轮盘展开了');
ok(r1.paths.slice().sort().join(',') === 'Alpha.app,Bravo.app,Charlie.app', '扇里是这三颗', JSON.stringify(r1.paths));

console.log('② 挪开 → 轮盘收起');
await hover(CENTER.x + 420, CENTER.y + 320, 1000);
let r2 = await fan();
ok(!r2.open, '轮盘收起了');

console.log('③ Charlie 退掉了（右键列表点过删除）');
await p.evaluate((bb) => { window.__fake.B = bb; window.__fake.phase = 'B'; }, B);

console.log('④ 再摸一次 Pet —— 这就是读者报的那一下');
await hover(CENTER.x, CENTER.y, 500);
let r3 = await fan();
ok(r3.open, '轮盘又展开了');
ok(!r3.paths.includes('Charlie.app'), '退掉的那颗**不在**扇里了（读者报的 bug）', JSON.stringify(r3.paths));
ok(r3.paths.slice().sort().join(',') === 'Alpha.app,Bravo.app', '扇里正好是 Alpha/Bravo', JSON.stringify(r3.paths));

await p.screenshot({ path: '/tmp/pet-fan.png' });
await b.close();
console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
