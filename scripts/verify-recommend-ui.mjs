/**
 * 「每日推荐」写回那一段的界面契约（2026-10-10）。
 *
 * 读者原话：「写回 notion 时候如果是这样的同一天或者已经有这一天，
 *            就不要另外起一个日期」。
 *
 * ⚠️ 这一节**一个字节都不写进 Notion**：
 *    `/api/recommend` 和 `/api/notion/append` 两条路都用 page.route **截住**，
 *    由测试自己给回执。要验的是**界面在拿到回执之后干了什么**，
 *    跟 Notion 那边真实发生什么无关（那是 verify-append-dedup.py 的地盘）。
 *
 * 为什么必须有这一节：
 *   实测读者 2026-10-09 那天写进的 TECH AI 块里，**同一篇内容重复了四遍**
 *   （段落 3×3+1，四组标记）。根因就是**写完之后勾还留着、②还是亮的**
 *   ⇒ 再点一次又把同一批写一遍。这是**界面**的毛病，
 *   跑一百遍 Python 那层的测试也照不出来。
 *
 * ⭐ 负向对照是**白捡的**，而且比造夹具强：
 *   修好的第一版我把改动落在了 `src/server.ts` 里那个**死掉的大字符串**上
 *   （`const UI`，全文没有一处引用它），于是这一节当场 **5/11 全红** ——
 *   「勾没清掉 / 第二下把三条又写了一遍 / 卡片没压暗」三条齐红。
 *   ⇒ 这就是把 bug 放回去的样子，断言确实抓得到，不必再手工做一遍。
 *   （顺带：这也说明**"改完验证全红"先要怀疑改错了文件**。）
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';

const B = 'http://127.0.0.1:8770';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

const b = await chromium.launch({ args: ['--no-proxy-server', '--proxy-bypass-list=*'] });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
// ⚠️ 只收**脚本自己的**错。浏览器的 "Failed to load resource ... 404" 不带 URL，
//    混进来就会把一条 favicon 404 报成"页面报错"（这条本轮已经误伤过一次）。
p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
const bad = [];   // 真正的 4xx/5xx，带 URL
p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });

// ── 两条路都截住 ────────────────────────────────────────────────
let appendCalls = [];
await p.route('**/api/recommend', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({
    items: [
      { kind: '延伸', cat: 'TECH AI', title: '甲条', why: '自检', detail: '甲条的正文' },
      { kind: '延伸', cat: 'Learn', title: '乙条', why: '自检', detail: '乙条的正文' },
      { kind: '延伸', cat: 'Shopping', title: '丙条', why: '自检', detail: '丙条的正文' },
    ],
  }),
}));
await p.route('**/api/notion/append', (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  appendCalls.push(body);
  // 甲条故意让它**写失败** —— 用来验"失败的留着勾、成功的才清"
  const bad = body.cat === 'Learn';
  return route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(bad
      ? { ok: false, code: 1, page: body.cat, wrote: true, output: '（自检）这条故意让它失败' }
      : { ok: true, code: 0, page: body.cat, wrote: true, output: '✅ 已写入（自检）' }),
  });
});

await p.goto(B + '/', { waitUntil: 'load' });
await p.waitForTimeout(1400);

console.log('\n── ① 页面里能找到「每日推荐」那一屏 ──────────────');
// ⚠️ 容器的 id 是 **#app**（那个 legacy 大字符串里才有 #main —— 它跑都没跑）。
//    第一版我照 legacy 那份写成 #main，于是这条**永远红**。
const got = await p.evaluate(() => ({
  app: !!document.querySelector('#app'),
  side: !!document.querySelector('#side'),
}));
ok(got.app && got.side, '主区在（#app + #side）');

// 用侧栏里的入口进去（走读者真正走的那条路），而不是直接调内部函数
const clicked = await p.evaluate(() => {
  const hit = [...document.querySelectorAll('#side [data-nav], #side button, #side a')]
    .find((e) => /推荐/.test(e.textContent || ''));
  if (hit) { hit.click(); return hit.textContent.trim(); }
  if (window.__app?.show) { window.__app.show('rec'); return '(直流 show)'; }
  return null;
});
ok(!!clicked, `进到了「每日推荐」（${clicked}）`);
await p.waitForTimeout(900);
ok(await p.$('#gen') !== null, '有「生成今天的推荐」那个按钮');

console.log('\n── ② 生成 + 全勾上 + 点两下② ⇒ **不许写两遍** ───────');
await p.click('#gen');
await p.waitForTimeout(700);
const n = await p.evaluate(() => document.querySelectorAll('#out input[type=checkbox]').length);
ok(n === 3, `列出来 3 条（${n}）`);
await p.evaluate(() => document.querySelectorAll('#out input[type=checkbox]').forEach((c) => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }));
await p.waitForTimeout(200);
await p.click('#push');                       // 第一下：真写
await p.waitForTimeout(900);

const after1 = appendCalls.length;
ok(after1 === 3, `第一下写了 3 条（实际发了 ${after1} 次）`);

// ⚠️ 这一段就是病灶所在：原来写完之后勾还在，②还是亮的，
//    第二下会把**同一批**原样再写一遍（读者那边是同一篇出现四遍）。
const btnState = await p.evaluate(() => ({
  checked: document.querySelectorAll('#out input[type=checkbox]:checked').length,
  disabled: document.querySelector('#push').disabled,
  label: document.querySelector('#push').textContent.trim(),
}));
ok(btnState.checked === 1, `⚠️ 写成功的勾清掉了、**只留下失败那条**（还剩 ${btnState.checked} 个勾：Learn 那条故意的）`);
ok(btnState.disabled === false, '② 还亮着 —— 因为还有一条没写成功，**得让人重试**（不是一刀切禁用）');

await p.click('#push');                       // 第二下
await p.waitForTimeout(900);
const after2 = appendCalls.length;
const second = appendCalls.slice(after1);
ok(second.length === 1 && second[0].cat === 'Learn',
   `⚠️ 第二下**只重试了失败那条**，没有把已写的三条再写一遍（第二下发了 ${second.length} 次：${second.map((x) => x.cat).join('/') || '无'}）`);

console.log('\n── ③ 状态要在卡片上看得出「哪些写过了」──────────────');
const marks = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('#out .card')];
  return {
    faded: cards.filter((c) => c.style.opacity && Number(c.style.opacity) < 1).length,
    disabledBoxes: document.querySelectorAll('#out input[type=checkbox][disabled]').length,
  };
});
ok(marks.disabledBoxes === 2, `写成功的两条勾变成不可点（${marks.disabledBoxes} 个）`);
ok(marks.faded === 2, `那两张卡片也被压暗了（${marks.faded} 张）—— 一眼能看出哪些已经写过`);

console.log('\n── ④ 收尾 ─────────────────────────────────');
ok(!errs.length, `全程没有页面报错${errs.length ? '：' + errs[0] : ''}`);
ok(!bad.length, `没有 4xx/5xx 的请求${bad.length ? '：' + bad.slice(0, 2).join(' · ') : ''}`);

await b.close();
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
