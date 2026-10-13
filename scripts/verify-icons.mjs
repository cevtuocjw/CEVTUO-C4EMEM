/**
 * 图标系统 + 「知识库聚合 / Notion 标记」。
 * ⚠️ 判据：
 *    · 图标必须是**描边**不是填充（fill:none）—— 这是"手绘线稿"和"一坨黑"的分界，
 *      而它坏掉的表现只是"图标看着糊"，不会报任何错。
 *    · 每个 <use href> 都要能解析到真的 symbol（断掉的引用一片空白，也不报错）。
 *    · 屏幕上看得到的文字里不能再有 emoji（emoji 在不同系统长得不一样）。
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { seedFlow } from './_flowseed.mjs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

// ⚠️ 画布以**服务端那份**为准（种 localStorage 会被 hydrateFlow 盖掉）。
await seedFlow([
  { id: 'b1', kind: 'src.notes', text: '骑行 心率', x: 60, y: 60 },
  { id: 'b2', kind: 'act.summary', text: '总结', x: 430, y: 60 },
  { id: 'b3', kind: 'out.notion', text: '', x: 800, y: 60 },
]);
await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
await p.waitForTimeout(1100);

console.log('\n▸ 图标是描边，不是填充');
const paint = await p.$eval('svg.ic use', (u) => {
  const path = document.querySelector(u.getAttribute('href')).querySelector('path');
  const cs = getComputedStyle(path);
  return { fill: cs.fill, stroke: cs.stroke, w: cs.strokeWidth };
});
// ⚠️ 这条是这次的**主 bug**：样式写在包着 <symbol> 的 <g> 上，
//    而 <use> 只克隆 symbol 自己的子树 ⇒ 属性根本没跟过去 ⇒ 全被填黑。
ok(paint.fill === 'none', `fill 是 none（实得 ${paint.fill}）—— <use> 拿得到 symbol 上的样式`);
ok(paint.stroke !== 'none', `stroke 不是 none（实得 ${paint.stroke}）`);
ok(parseFloat(paint.w) > 1, `线宽 ${paint.w}（太细小尺寸下会消失）`);

console.log('\n▸ 没有断掉的引用');
const broken = await p.evaluate(() => {
  const uses = [...document.querySelectorAll('svg.ic use')].map((u) => u.getAttribute('href'));
  return { total: uses.length, uniq: new Set(uses).size, dead: uses.filter((h) => !h || !document.querySelector(h)).length };
});
ok(broken.dead === 0, `${broken.total} 个图标引用全部解析得到（${broken.uniq} 种，断了 ${broken.dead} 个）`);
ok(broken.total > 25, `图标确实铺开了（${broken.total} 个）`);

console.log('\n▸ 看得见的文字里没有 emoji');
const leftover = await p.evaluate(() => {
  const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}]/u;
  const bad = [];
  const walk = (root) => {
    for (const n of root.querySelectorAll('*')) {
      if (n.closest('svg') || ['SCRIPT', 'STYLE'].includes(n.tagName)) continue;
      for (const c of n.childNodes) if (c.nodeType === 3 && re.test(c.textContent)) bad.push((c.textContent || '').trim().slice(0, 34));
    }
  };
  walk(document.body);
  return [...new Set(bad)];
});
ok(leftover.length === 0, `没有漏网的 emoji${leftover.length ? '（还有：' + leftover.join(' | ') + '）' : ''}`);

console.log('\n▸ 来源按钮显示的是图形不是标签文本（踩过一次：用了 textContent）');
const fab = await p.$eval('#fangle', (e) => ({ html: e.querySelector('svg') ? 'svg' : e.textContent.slice(0, 30), txt: e.textContent.trim() }));
ok(fab.html === 'svg' && !fab.txt.includes('<'), `按钮里是图形（实得 ${fab.html}）`);

console.log('\n▸ 选择器：知识库聚成一块 + Notion 有角标');
await p.click('.thumb[data-m="flow"]'); await p.waitForTimeout(600);
await p.click('#flowlist .blk[data-id="b2"] .kb'); await p.waitForTimeout(200);
await p.keyboard.press('/'); await p.waitForTimeout(500);
const groups = await p.$$eval('.kpick .hd', (es) => es.map((e) => e.textContent.trim()));
ok(groups.includes('知识库 · 全部来源'), `有「知识库 · 全部来源」这一块（${groups.join(' / ')}）`);
ok(!groups.includes('主语 · 来源'), '而且「来源」不再单列一遍（同一批东西列两遍 = 让人在两处做同一个决定）');
const kbCount = await p.evaluate(() => {
  const hds = [...document.querySelectorAll('.kpick .hd')];
  const i = hds.findIndex((h) => h.textContent.includes('知识库'));
  if (i < 0) return 0;
  let n = 0, node = hds[i].nextElementSibling;
  while (node && !node.classList.contains('hd')) { n += node.tagName === 'BUTTON' ? 1 : 0; node = node.nextElementSibling; }
  return n;
});
ok(kbCount >= 6, `那一块里聚了 ${kbCount} 个来源`);
const nb = await p.$$eval('.kpick .nb', (es) => es.length);
ok(nb >= 2, `Notion 相关的功能带了 ${nb} 个角标`);
// 负向对照：不带 Notion 的功能**不该**有角标
const sumHasBadge = await p.$eval('.kpick button[data-k="act.summary"]', (e) => !!e.querySelector('.nb'));
ok(!sumHasBadge, '⚠️ 负向对照：「总结」不带 Notion 角标（角标不是随手撒的）');
await p.screenshot({ path: 'out/i2-picker.png' });
await p.keyboard.press('Escape'); await p.waitForTimeout(200);

console.log('\n▸ 写回 Notion 的卡片被标出来了');
const tags = await p.$eval('#flowlist .blk[data-id="b3"]', (e) => [...e.querySelectorAll('.tag')].map((t) => t.textContent.trim()));
ok(tags.includes('Notion'), `卡片上有 Notion 标签（${tags.join(' / ')}）`);
ok(tags.includes('会动到外面'), '并且同时标了「会动到外面」');
await p.screenshot({ path: 'out/i2-flow.png' });

console.log(`\n${pass} 通过 / ${fail} 失败` + (errs.length ? '\n⚠️ 页面报错: ' + errs.slice(0, 4).join(' ;; ') : '\n✅ 无页面报错'));
await b.close();
process.exit(fail ? 1 : 0);
