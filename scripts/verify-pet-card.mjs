/**
 * 读者 2026-10-13：「**这上边怎么有一个灰色正方形**」。
 * 那其实是 Pet 本体那张卡（`#petbody .ck`，53×92 的竖长矩形）—— 展开轮盘时它正好落在
 * **正中央**：既压住扇区，又在透明窗里渲染成一块认不出来的毛玻璃方片。
 * ⇒ 展开时把它收掉（`body.pw-on #petbody{opacity:0}`），收起时照旧。
 *
 * 三条断言，判据都是**量出来的**：
 *   ① 收起时卡片必须**看得见**（不能把它永久藏了）；
 *   ② 展开时卡片必须**看不见**；
 *   ③ 展开时**每一格都不能被卡片盖住** —— 判据用 `elementFromPoint` 打在每格中心，
 *      这一条才是"正方形没了"的**真正契约**（前两条只说明卡片淡出了，
 *      万一是别的东西盖着也照样过）。
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

const cardOpacity = () => p.evaluate(() => {
  const e = document.querySelector('#petbody');
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { op: Number(getComputedStyle(e).opacity), w: Math.round(r.width), h: Math.round(r.height) };
});

console.log('① 轮盘收起时：卡片应当看得见');
{
  const c = await cardOpacity();
  ok(c && c.op > 0.95, '卡片 opacity ≈ 1', JSON.stringify(c));
  ok(c && c.w > 10 && c.h > 10, '卡片有实际尺寸（不是被压成 0）', JSON.stringify(c));
}

console.log('② 轮盘展开后：卡片应当看不见');
await p.evaluate(() => window.__petOpen());
await p.waitForTimeout(700);
{
  const c = await cardOpacity();
  ok(c && c.op < 0.05, '卡片 opacity ≈ 0', JSON.stringify(c));

  // ③ 真正的契约：每一格的中心，问到的必须是那一格自己（不是被卡片压着）
  const cover = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('#pwwheel .pwic').forEach((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      if (!hit || !hit.closest?.('.pwic')) {
        out.push({ i: el.dataset.i, 命中: hit ? hit.tagName.toLowerCase() + '.' + String(hit.className).split(' ')[0] : 'null' });
      }
    });
    return out;
  });
  ok(cover.length === 0, '每一格的中心都命中它自己（没有被别的东西盖住）', JSON.stringify(cover));

  const n = await p.evaluate(() => document.querySelectorAll('#pwwheel .pwic').length);
  ok(n === FAKE.length, '扇里 ' + FAKE.length + ' 格都在', String(n));
}

await p.screenshot({ path: '/tmp/pet-card.png' });
await b.close();
console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
