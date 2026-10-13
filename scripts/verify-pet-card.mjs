/**
 * 读者 2026-10-13 的第二句：「鼠标放上去就没有了，**我需要的是继续它存在**，
 * 然后出现那些 app 的 logo」。
 *
 * 背景：他先报了「轮盘中央有一个灰色正方形」，我**把那块卡整个藏了**
 * （`body.pw-on #petbody{opacity:0}`）—— 那不是他要的：展开轮盘时 **Pet 必须照样在**。
 * ⇒ 已撤回。这一支就是钉住"撤回之后它真的还在"。
 *
 * ⚠️ 顺带一条教训（写在这儿免得下次再犯）：把"看着不对的东西"直接隐藏，
 *    是按下了**症状**；"它不该在这儿"和"它在这儿但长得不对"是两件事，先问清哪一件。
 */
import { chromium } from '/Users/cjw/Documents/DSP Deepseek/pingfang-factcheck/node_modules/playwright-core/index.js';

const API = 'http://127.0.0.1:8770';
const FAKE = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel']
  .map((n, i) => ({ name: n, path: `/Applications/${n}.app`, pid: 300 + i }));

let fails = 0, passes = 0;
const ok = (c, label, extra = '') => {
  if (c) { passes += 1; console.log('  ✓ ' + label); }
  else { fails += 1; console.log('  ✗ ' + label + (extra ? '  ' + extra : '')); }
};

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 440, height: 520 }, deviceScaleFactor: 3 });
p.on('pageerror', (e) => console.log('  PAGEERROR ' + e.message));
await p.goto(API + '/ui/pet.html', { waitUntil: 'load' });
await p.waitForTimeout(700);
await p.evaluate((apps) => {
  const of = window.fetch.bind(window);
  window.fetch = (u, o) => (String(u).includes('/api/running')
    ? Promise.resolve(new Response(JSON.stringify({ apps }), { headers: { 'content-type': 'application/json' } }))
    : of(u, o));
}, FAKE);

const card = () => p.evaluate(() => {
  const e = document.querySelector('#petbody');
  const r = e.getBoundingClientRect();
  return { op: Number(getComputedStyle(e).opacity), w: Math.round(r.width), h: Math.round(r.height) };
});

console.log('① 轮盘收起时：Pet 在');
{
  const c = await card();
  ok(c.op > 0.95 && c.w > 10 && c.h > 10, 'Pet 可见且有尺寸', JSON.stringify(c));
}

console.log('② 鼠标放上去（轮盘展开）：**Pet 必须还在**（读者 2026-10-13 明确要求）');
await p.evaluate(() => window.__petOpen());
await p.waitForTimeout(700);
{
  const c = await card();
  ok(c.op > 0.95, '展开时 Pet 照样可见（不是被藏起来）', JSON.stringify(c));
  ok(c.w > 10 && c.h > 10, '展开时 Pet 有实际尺寸', JSON.stringify(c));

  const n = await p.evaluate(() => document.querySelectorAll('#pwwheel .pwic').length);
  ok(n === FAKE.length, '同时那些 app 的 logo 也在（' + FAKE.length + ' 格）', String(n));
}

console.log('③ 收起来之后 Pet 不能变成半透明（状态要还原）');
await p.evaluate(() => window.__petHover(false));
await p.waitForTimeout(900);
{
  const c = await card();
  ok(c.op > 0.95, '收起后仍是完全不透明', JSON.stringify(c));
}

await p.screenshot({ path: '/tmp/pet-card.png' });
await b.close();
console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
