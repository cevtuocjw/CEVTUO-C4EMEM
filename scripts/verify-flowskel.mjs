// ⑧「照着填」：骨架四格的填空提示是不是真的按语法（①事件 ②来源 ③动作 ④去处）显示出来了。
// 外加一条约束断言：**只能有一张画布**（读者 2026-10-13：「要都做在一页里面，不能分页」）。
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';

// ⚠️ 要先起**沙盒**实例：C4EMEM_CONFIG=/tmp/c4skel.json C4EMEM_PORT=8791 bun run src/server.ts
//    （画布会落在 config 里的 dataDir，别拿读者的真数据试）
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

// ── 每一格的填空提示（读 DOM 真值：data-ph + ::before 真的画出来的内容） ──
const slots = await p.evaluate(() => [...document.querySelectorAll('#flowworld .blk')].map((blk) => {
  const txt = blk.querySelector('.txt');
  const before = getComputedStyle(txt, '::before').content;
  return {
    kind: blk.querySelector('.nm')?.textContent || '',
    ph: txt.getAttribute('data-ph'),
    before: before,
    empty: txt.matches(':empty'),
    hasText: (txt.textContent || '').length > 0,
  };
}));
out.slots = slots;

chk(slots.length === 4, '骨架还是 4 格', slots.length + ' 格');
const want = ['①', '②', '③', '④'];
chk(slots.every((s, i) => (s.ph || '').startsWith(want[i])),
  '四格的提示按语法编号 ①②③④（事件→来源→动作→去处）',
  slots.map((s) => s.kind + ': ' + s.ph).join(' | '));
chk(slots.every((s) => s.empty), '四格都还是空的（提示才显示得出来）', slots.filter((s) => !s.empty).length + ' 格非空');
// ⚠️ 关键：不能只看 data-ph —— 属性写着、::before 没画出来，界面上就是一片空白
chk(slots.every((s, i) => (s.before || '').includes(want[i])),
  '提示**真的画出来了**（读 ::before 的计算值，不是读属性）',
  slots.map((s) => JSON.stringify(s.before).slice(0, 34)).join(' | '));
chk(new Set(slots.map((s) => s.ph)).size === 4, '四格提示各不相同（不是四个「写点什么」）',
  new Set(slots.map((s) => s.ph)).size + ' 种');

// ── 负向对照：往第一格写字 ⇒ 那一格的提示必须消失，别的格不受影响 ──
await p.evaluate(() => {
  const t = document.querySelector('#flowworld .blk .txt');
  t.focus(); t.textContent = '我按下运行';
  t.dispatchEvent(new Event('input', { bubbles: true }));
  t.blur();
});
await p.waitForTimeout(700);
const after = await p.evaluate(() => [...document.querySelectorAll('#flowworld .blk .txt')].map((t) => ({
  empty: t.matches(':empty'), before: getComputedStyle(t, '::before').content.slice(0, 20), text: t.textContent,
})));
out.afterTyping = after;
chk(!after[0].empty && after[0].before === 'none',
  '【对照】填了字的那一格：提示消失（:empty 不再成立）', 'empty=' + after[0].empty + ' before=' + after[0].before);
chk(after.slice(1).every((t) => t.empty && t.before !== 'none'),
  '【对照】其余三格的提示**还在**（不是一起被抹掉）',
  after.slice(1).map((t) => t.empty + '/' + t.before).join(' | '));

// ── 落盘：刷新后填的字还在、提示还在 ──
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(1800);
await p.click('#modes button[data-m="flow"]');
await p.waitForTimeout(800);
const persisted = await p.evaluate(() => [...document.querySelectorAll('#flowworld .blk .txt')].map((t) => ({
  text: t.textContent, empty: t.matches(':empty'),
})));
chk(persisted[0] && persisted[0].text === '我按下运行' && !persisted[0].empty, '刷新之后填的字还在', JSON.stringify(persisted[0]));
chk(persisted.slice(1).every((t) => t.empty), '刷新之后其余三格还是空的（提示还在）', persisted.slice(1).map((t) => t.empty).join(','));

// ── 读者的约束：**只有一张画布，不能分页** ──
const sheets = await p.evaluate(() => ({
  canvases: document.querySelectorAll('#flowcanvas').length,
  worlds: document.querySelectorAll('#flowworld').length,
  sheetUI: document.querySelectorAll('#sheetbar, [data-sheet], .sheettabs, #flowsheets').length,
  buttons: [...document.querySelectorAll('.flowbar button')].map((x) => (x.textContent || '').trim()).filter(Boolean),
}));
out.sheets = sheets;
chk(sheets.canvases === 1 && sheets.worlds === 1, '画布只有**一张**（不是多张工作表）',
  'canvas=' + sheets.canvases + ' world=' + sheets.worlds);
chk(sheets.sheetUI === 0, '没有冒出任何「切工作表 / 分页」的控件', sheets.sheetUI + ' 个');

await p.locator('#m-flow').screenshot({ path: '/tmp/fillslots.png' });
out.errs = errs;
out.pass = out.checks.filter((c) => c.ok).length;
out.fail = out.checks.filter((c) => !c.ok).length;
console.log(JSON.stringify(out, null, 1));
await b.close();
