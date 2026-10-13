// ⑧ 执行链：**点「运行」到底跑没跑完**。前两轮只验到「按钮」和「填什么」这两层。
// 走的是读者指定的那条路：**Enter 开跑**。
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';

// ⚠️ 要先起**沙盒**实例（同上）。这条会**真的跑一遍结构流**（会调一次模型）。
const BASE = process.env.C4EMEM_BASE || 'http://127.0.0.1:8791';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1460, height: 920 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const out = { checks: [] };
const chk = (ok, what, got) => out.checks.push({ ok: !!ok, what, got });

await p.goto(BASE + '/', { waitUntil: 'load' });
await p.waitForSelector('#modes', { timeout: 15000 });
await p.waitForTimeout(1500);
const dc = await p.$('#dclose');
if (dc && await dc.isVisible()) { await dc.click(); await p.waitForTimeout(600); }
await p.click('#modes button[data-m="flow"]');
await p.waitForTimeout(700);
await p.click('#flowskel');
await p.waitForTimeout(900);

// 给「来源」那一格填一句查询（走真的 /api/search，沙盒索引是空的 ⇒ 不会外发任何私内容）
await p.evaluate(() => {
  const t = [...document.querySelectorAll('#flowworld .blk .txt')][1];
  t.focus(); t.textContent = '玻璃质感'; t.dispatchEvent(new Event('input', { bubbles: true })); t.blur();
});
await p.waitForTimeout(400);

// ── Enter 开跑（读者点名的那条路） ──
await p.evaluate(() => document.activeElement && document.activeElement.blur());
await p.click('#flowcanvas', { position: { x: 40, y: 40 } }).catch(() => {});
await p.waitForTimeout(300);
const before = await p.evaluate(() => (document.querySelector('#flowout') || {}).textContent || '');
await p.keyboard.press('Enter');
let via = '键盘 Enter';
await p.waitForTimeout(1200);

let after = await p.evaluate(() => (document.querySelector('#flowout') || {}).textContent || '');
if (!after || after === before) {                       // Enter 没触发就退回按钮，并如实记下来
  via = '⚠️ Enter 没反应，改用「运行」按钮';
  const runBtn = p.locator('.fpane button', { hasText: '运行' }).first();
  await runBtn.click().catch(() => {});
  await p.waitForTimeout(1500);
  after = await p.evaluate(() => (document.querySelector('#flowout') || {}).textContent || '');
}

// 跑完要等（LLM 那条腿可能慢）—— 等条件，别等固定秒数
await p.waitForFunction(() => {
  const t = (document.querySelector('#flowout') || {}).textContent || '';
  return /块 ·\s*[\d.]+s/.test(t);
}, { timeout: 90000 }).catch(() => {});
await p.waitForTimeout(600);

const r = await p.evaluate(() => ({
  flowout: (document.querySelector('#flowout') || {}).textContent || '',
  frwhen: (document.querySelector('#frwhen') || {}).textContent || '',
  runsHidden: !!document.querySelector('#flowruns')?.hidden,
  steps: [...document.querySelectorAll('#frlog .st')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
  badges: [...document.querySelectorAll('#flowworld .blk')].map((blk) => ({
    kind: blk.querySelector('.nm')?.textContent || '',
    stat: (blk.querySelector('.bstat') || {}).textContent || '',
    cls: (blk.querySelector('.bstat') || {}).className || '',
    text: (blk.querySelector('.txt') || {}).textContent || '',
  })),
}));
out.via = via;
out.run = r;

chk(!!r.flowout && /块 ·/.test(r.flowout), '按下去真的跑完了，并给出了「N 块 · 耗时」', r.flowout);
chk(!r.runsHidden, '运行面板出现了', r.runsHidden ? '还是 hidden' : '可见');
chk(r.steps.length === 4, '四块**每一块都有交代**（没有哪一块静默消失）', r.steps.length + ' 行');
chk(r.badges.every((x) => x.stat), '每一块的角标都有文字', r.badges.map((x) => x.kind + '=' + x.stat).join(' | '));

// ⭐ 这一条是**契约**：事件块是"触发器"，不是"要执行的一步"
const ev = r.badges[0];
chk(!/失败/.test(r.flowout) || !/执行器/.test(ev.stat),
  '【契约】「事件」块不该被算成失败 —— 它是触发器，不是一步',
  '汇总：' + r.flowout + ' ／ 事件块角标：' + ev.stat + '（' + ev.cls + '）');

// ── 契约：**实时那一栏**和**历史那一栏**对同一块必须说同一句话 ──
//    ⚠️ 这两处是两份各自独立的渲染代码（app.js:2245 和 2724）—— 改了其中一处，
//       另一处就会跟它说法不一致，而**两边单独看都正常**。
await p.click('#frHist').catch(() => {});
await p.waitForTimeout(900);
const hpCount = await p.evaluate(() => document.querySelectorAll('.hp').length);
if (hpCount) {
  await p.click('.hp');
  await p.waitForTimeout(900);
  const hist = await p.evaluate(() => [...document.querySelectorAll('#frlog .st')].map((e) => ({
    marker: (e.querySelector('span') || {}).textContent || '',
    cls: (e.querySelector('span') || {}).className || '',
    txt: e.textContent.replace(/\s+/g, ' ').trim(),
  })));
  out.history = hist;
  const h0 = hist[0] || {};
  chk(h0.cls === 'trig' && h0.marker === '·',
    '【契约】历史那一栏对「触发器」用的是同一个说法（不是又变回 ✗）',
    '历史第一行：' + JSON.stringify(h0));
} else {
  chk(false, '【契约】历史列表里能找到刚才那次运行', '一条都没有');
}

out.errs = errs;
out.pass = out.checks.filter((c) => c.ok).length;
out.fail = out.checks.filter((c) => !c.ok).length;
await p.locator('#m-flow').screenshot({ path: '/tmp/run-result.png' });
console.log(JSON.stringify(out, null, 1));
await b.close();
