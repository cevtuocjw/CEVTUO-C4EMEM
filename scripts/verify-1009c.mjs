/**
 * 2026-10-09 第三批：**什么都能放进货架**。
 * 四条入口各测一条，每条都断言"货架上真的多了一段"（不是"高亮出现了"）。
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };
const len = () => p.evaluate(() => JSON.parse(localStorage.getItem('c4emem.shelf') || '[]').length);

await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
await p.waitForTimeout(1200);
await p.evaluate(() => localStorage.setItem('c4emem.shelf', '[]'));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(1200);

// ───────────────── ① 从**别的 app** 拖一段普通文字进来（原来完全不收） ─────────────────
console.log('\n▸ ① 外来的普通文字，落在页面上任意位置');
const before1 = await len();
const dropped = await p.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/plain', '从别的 app 拖过来的一段普通文字');
  const target = document.querySelector('.main') || document.body;
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  return true;
});
await p.waitForTimeout(400);
const after1 = await len();
ok(dropped && after1 === before1 + 1, `落在页面中间也收（${before1} → ${after1}）`);
ok(await p.evaluate(() => decodeURIComponent(JSON.parse(localStorage.getItem('c4emem.shelf'))[0].text).includes('别的 app') ||
  JSON.parse(localStorage.getItem('c4emem.shelf'))[0].text.includes('别的 app')), '收下的正是那一段文字');

// ───────────────── ② 货架上的「＋ 剪贴板」 ─────────────────
console.log('\n▸ ② 「＋ 剪贴板」这颗按钮');
ok(!!(await p.$('#shelfPaste')), '按钮在');
const before2 = await len();
await p.evaluate(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { readText: async () => '剪贴板里的一段' },
  });
});
await p.click('#shelfPaste');
await p.waitForTimeout(500);
ok((await len()) === before2 + 1, `点一下就收进来了（${before2} → ${await len()}）`);

// 读剪贴板被拒时要**说清还有哪条路**（不是静默失败）
await p.evaluate(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { readText: async () => { throw new Error('NotAllowedError'); } },
  });
});
await p.click('#shelfPaste');
await p.waitForTimeout(500);
const t2 = await p.evaluate(() => document.querySelector('#toast')?.textContent || '');
ok(/⌘V|被拦/.test(t2), `被拒时说得清（实得「${t2.slice(0, 50)}」）`);

// ───────────────── ③ 选中一段 + 点货架（万能入口） ─────────────────
console.log('\n▸ ③ 选中一段 → 点货架');
const before3 = await len();
const viaClick = await p.evaluate(() => {
  const real = window.getSelection;
  window.getSelection = () => ({ isCollapsed: false, toString: () => '我选中的这一段', anchorNode: document.body, contains: () => true });
  try { document.querySelector('#shelfToggle').click(); } finally { window.getSelection = real; }
  return JSON.parse(localStorage.getItem('c4emem.shelf') || '[]').length;
});
ok(viaClick === before3 + 1, `【打桩选区】点一下货架就收进来了（${before3} → ${viaClick}）`);
// 没选区时它还得**能正常收起/展开**
await p.evaluate(() => window.getSelection().removeAllRanges());
const foldedNow = await p.evaluate(() => document.querySelector('#shelf').classList.contains('folded'));
await p.click('#shelfToggle');
await p.waitForTimeout(300);
ok(foldedNow !== (await p.evaluate(() => document.querySelector('#shelf').classList.contains('folded'))),
  '没有选区时，点货架还是照常收起/展开（没被抢）');

// ───────────────── ④ 覆盖面：内容块自己就可拖 ─────────────────
console.log('\n▸ ④ 各个视图里的内容块');
const check = async (name, sel, opener) => {
  if (opener) { await opener(); await p.waitForTimeout(1300); }
  const r = await p.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    return { draggable: el.draggable, text: (el.innerText || el.textContent || '').trim().slice(0, 24) };
  }, sel);
  ok(r && r.draggable === true, `${name} 可拖${r ? '（«' + r.text + '»）' : '—— 找不到元素'}`);
  return r;
};
await check('知识库卡片', '#kbmount .card', () => p.click('.nv[data-v="links"]'));
await check('（主动页的卡片）', '#kbmount .card', () => p.click('.nv[data-v="proactive"]'));
await check('结构流的块', '#flowlist .blk', () => p.click('.thumb[data-m="flow"]'));
await check('记录栏的一条', '#loglist .item');
// 帮助弹窗里的一段（读者说"什么都要"）
await p.click('#flowHelp').catch(() => {});
await p.waitForTimeout(600);
await check('帮助弹窗里的一节', '#flowhelp .hsec');
await p.click('#helpClose').catch(() => p.keyboard.press('Escape'));
await p.waitForTimeout(400);

// ───────────────── ⑤ 代价：卡片里还能不能选字？ ─────────────────
console.log('\n▸ ⑤ 把它标成可拖之后，里面的字还选得动吗');
await p.click('.nv[data-v="links"]');
await p.waitForTimeout(1400);
const selInfo = await p.evaluate(async () => {
  const el = document.querySelector('#kbmount .card');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const ev = (type, x, y, extra = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1, ...extra }));
  ev('mousedown', r.left + 30, r.top + 20);
  ev('mousemove', r.left + 120, r.top + 20, { buttons: 1 });
  ev('mouseup', r.left + 120, r.top + 20);
  const s = getSelection();
  return { rangeCount: s.rangeCount, collapsed: s.isCollapsed };
});
console.log('    （信息）合成鼠标按下+拖动后：rangeCount=' + selInfo?.rangeCount + ' collapsed=' + selInfo?.collapsed);
console.log('    ⚠️ 无头窗口里本来就没有真实选区（document.hasFocus() 为 false），这条只作记录，不作判据');

ok(errs.length === 0, '没有页面报错' + (errs.length ? '：' + errs.slice(0, 2).join(' | ') : ''));
console.log(`\n${pass}/${pass + fail} 通过`);
await b.close();
process.exit(fail ? 1 : 0);
