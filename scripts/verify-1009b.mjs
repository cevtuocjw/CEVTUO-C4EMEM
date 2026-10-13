/**
 * 2026-10-09 第二批：拖到货架 + 功能按来源放行。
 * 判据全是**契约**：
 *   · 拖拽 —— 判据是货架上**真的多了一条**（不是"高亮出现了"）
 *   · 放行 —— 判据是 `.na` 类的**集合**（不是"看着灰"），而且**灰的那几个必须能说出为什么**
 *   · 负向对照 —— 切回「融合」必须全部恢复可点（不然"灰着"可能只是样式没生效）
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

const shelfLen = () => p.evaluate(() => JSON.parse(localStorage.getItem('c4emem.shelf') || '[]').length);
const setSrc = async (id) => {
  await p.evaluate((x) => localStorage.setItem('c4emem.src', x), id);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1100);
};
/** 用**真实鼠标**从 src 拖到货架（Playwright 走的是原生输入，会真的触发 HTML5 拖放） */
async function dragToShelf(srcSel) {
  const src = await p.$(srcSel);
  const dst = await p.$('#shelf');
  if (!src || !dst) return { ok: false, why: '找不到元素 ' + srcSel };
  const a = await src.boundingBox(), c = await dst.boundingBox();
  const before = await shelfLen();
  await p.mouse.move(a.x + Math.min(40, a.width / 2), a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(a.x + 8, a.y + a.height / 2 + 14, { steps: 4 });
  await p.waitForTimeout(90);
  const expanded = await p.evaluate(() => !document.querySelector('#shelf').classList.contains('folded'));
  await p.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 10 });
  await p.waitForTimeout(150);
  await p.mouse.up();
  await p.waitForTimeout(450);
  return { ok: (await shelfLen()) > before, expanded, before, after: await shelfLen() };
}

await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
await p.waitForTimeout(1100);

// ───────────────────────── ① 拖到货架 ─────────────────────────
console.log('\n▸ ① 拖到货架');
await p.evaluate(() => localStorage.setItem('c4emem.shelf', '[]'));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(1100);

// 记录栏那一条（原来就能拖，先确认没被改坏）
const r1 = await dragToShelf('#loglist .item');
ok(r1.ok, `记录里的一条能拖进货架（${r1.before} → ${r1.after}）`);
ok(r1.expanded, '一拖起来，货架自己展开了（58px 的球变成一块面板 —— 不然差几个像素就白拖）');

// ⭐ 语音那一屏的每一句（读者报的那条）
await p.click('.thumb[data-m="voice"]');
await p.waitForTimeout(700);
// 点一下麦克风 —— 不管成功还是报错，这一屏都会落下一行（`.you` / `.ai`）
await p.click('#mic').catch(() => {});
await p.waitForTimeout(1400);
const vlogInfo = await p.evaluate(() => {
  const xs = [...document.querySelectorAll('#vlog > div')];
  return { n: xs.length, draggable: xs.filter((e) => e.draggable).length, first: xs[0]?.className };
});
if (vlogInfo.n === 0) {
  console.log('    ⚠️ 语音屏一行都没有（点了麦克风也没落行）—— 这条**跳过**，别当它过了');
} else {
  ok(vlogInfo.draggable === vlogInfo.n, `语音屏 ${vlogInfo.n} 行（.${vlogInfo.first}）全都可拖（${vlogInfo.draggable} 行带 draggable）`);
  const r2 = await dragToShelf('#vlog > div');
  ok(r2.ok, `语音的一句真的能进货架（${r2.before} → ${r2.after}）`);
}

// 知识库里的卡片（它不是 .msg 也不是 .item —— 曾经完全拖不动）
await p.click('.nv[data-v="links"]');
await p.waitForTimeout(1500);
const card = await p.evaluate(() => {
  const el = document.querySelector('#kbmount .card');
  if (!el) return null;
  el.setAttribute('data-probe', '1');
  return { draggable: el.draggable, chars: (el.innerText || '').length };
});
if (!card) {
  console.log('    (链接页没有卡片，跳过这一条)');
} else {
  ok(card.draggable === true, `知识库的卡片**自己就是可拖的**（draggable=${card.draggable}）—— 这才是"随便一段都能拖"的前提`);
  const r3 = await dragToShelf('#kbmount .card[data-probe="1"]');
  ok(r3.ok, `把它整块拖进货架（${r3.before} → ${r3.after}）`);

  // ⭐ 契约：**选中了其中一段**时，带走的必须只是那一段，不是整块。
  //    ⚠️⚠️ 这一条**没法用真实的鼠标拖**验：无头 Chromium 里
  //    `document.hasFocus()` 是 false ⇒ `Selection.toString()` **恒为空**
  //    （实测：`range.toString()` 有文字、`selection.toString()` 是空串，reflow 也不管用）。
  //    所以我**把那一个输入换掉**（把 getSelection 打桩成"用户选中了一段"），
  //    验处理器拿它做什么 —— 被测的是**分支逻辑**，不是浏览器肯不肯让我造选区。
  //    （判据写清是被打桩的，别让它看起来像"真的拖过了"。）
  const carried = await p.evaluate(() => {
    const el = document.querySelector('#kbmount .card[data-probe="1"]');
    const whole = (el.innerText || '').trim();
    const real = window.getSelection;
    const fire = (sel) => {
      window.getSelection = () => sel;
      const dt = new DataTransfer();
      try { el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); }
      finally {
        window.getSelection = real;
        el.dispatchEvent(new DragEvent('dragend', { bubbles: true }));   // 合成的那一笔也要收尾
      }
      return dt.getData('text/plain').trim();
    };
    const withSel = fire({ isCollapsed: false, toString: () => '只这一段', anchorNode: el.firstChild, contains: () => true });
    const noSel = fire({ isCollapsed: true, toString: () => '', anchorNode: null, contains: () => false });
    return { withSel, noSel, whole: whole.length };
  });
  ok(carried.withSel === '只这一段', `【打桩】有选区时只带走那一段（实得「${carried.withSel}」）`);
  ok(carried.noSel.length === carried.whole && carried.noSel.length > 0,
    `【打桩】没选区时带走整块（${carried.noSel.length} 字 = 整块 ${carried.whole} 字）`);
  await p.evaluate(() => document.querySelector('[data-probe]')?.removeAttribute('data-probe'));
}
ok(await p.evaluate(() => !document.body.classList.contains('dragging')), '拖完之后 body.dragging 清掉了（不会一直亮着）');

// ───────────────────────── ② 功能按来源放行 ─────────────────────────
console.log('\n▸ ② 功能按来源放行');
const naSet = () => p.evaluate(() => [...document.querySelectorAll('.nv.na')].map((e) => e.dataset.v).sort().join(','));

await setSrc('learn');                       // 有内容的来源
const naLearn = await naSet();
ok(naLearn === '', `选了有内容的来源（Learn）⇒ 没有灰的（实得「${naLearn}」）`);

await setSrc('wecom');                       // 还没接入的来源
const naWecom = await naSet();
ok(naWecom === 'links,rec,search,tax,vocab', `选了**空的**来源（邮件）⇒ 读知识库那五个灰掉（实得「${naWecom}」）`);
ok(await p.$eval('.nv[data-v="voice"]', (e) => !e.classList.contains('na')), '语音不灰 —— 它只是检索面窄一点，不是干不了活');
ok(await p.$eval('.nv[data-v="usage"]', (e) => !e.classList.contains('na')), '用量不灰 —— 它读的不是知识库');

// 点它 ⇒ 必须**说得出为什么**
await p.click('.nv[data-v="search"]');
await p.waitForTimeout(400);
const toastTxt = await p.evaluate(() => document.querySelector('#toast')?.textContent || '');
ok(/邮件/.test(toastTxt) && /没有内容|不支持/.test(toastTxt), `点了灰的会说明原因（实得「${toastTxt.slice(0, 60)}」）`);
ok(await p.evaluate(() => window.__app.kbView === null), '点了灰的不会真的切过去（不是"灰着但还能进"）');

// ⭐ 负向对照：切回「融合」必须全部恢复
await setSrc('blend');
ok((await naSet()) === '', '负向对照：切回「融合」⇒ 灰的一个都不剩');
await p.click('.nv[data-v="search"]');
await p.waitForTimeout(600);
ok(await p.evaluate(() => window.__app.kbView === 'search'), '负向对照：这下真的进得去「搜索」了');

ok(errs.length === 0, '没有页面报错' + (errs.length ? '：' + errs.slice(0, 2).join(' | ') : ''));
console.log(`\n${pass}/${pass + fail} 通过`);
await b.close();
process.exit(fail ? 1 : 0);
