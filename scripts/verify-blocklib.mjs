// ⑧ 最后一条「块库可增删」：**能收能放**。
// ⚠️ 契约是三条，缺一条都不算做完：
//   ① 收起来 ⇒ 它从「换类型」里消失   ② 刷新后仍然消失（真的记住了）   ③ 放出 ⇒ 回来
//   ④ 而且**收起 ≠ 删掉**：画布上已经有的那种块照跑（执行器没被动）
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
const BASE = process.env.C4EMEM_BASE || 'http://127.0.0.1:8791';
const TARGET = 'act.summary';            // 拿「总结」当样本
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1460, height: 920 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const out = { checks: [] };
const chk = (ok, what, got) => out.checks.push({ ok: !!ok, what, got });

const toFlow = async () => {
  const dc = await p.$('#dclose'); if (dc && await dc.isVisible()) { await dc.click(); await p.waitForTimeout(500); }
  await p.click('#modes button[data-m="flow"]'); await p.waitForTimeout(700);
};
const openPickerKeys = async () => {
  await p.click('#flowworld .blk .kb');                       // 选中一块（点左侧图标那一栏，不碰可编辑区）
  await p.waitForTimeout(300);
  await p.keyboard.press('/');
  await p.waitForTimeout(700);
  const keys = await p.evaluate(() => [...document.querySelectorAll('.kpick:not(.lib) button')].map((x) => x.dataset.k).filter(Boolean));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelectorAll('.kpick').forEach((e) => e.remove()));
  return keys;
};
const openLib = async () => {
  await p.click('#flowlib'); await p.waitForTimeout(500);
  return p.evaluate(() => ({
    rows: [...document.querySelectorAll('.kpick.lib button[data-h]')].map((x) => ({ k: x.dataset.h, st: (x.querySelector('.st') || {}).textContent || '', off: x.classList.contains('off') })),
  }));
};
const clickLib = async (key) => {
  await p.click('.kpick.lib button[data-h="' + key + '"]');
  await p.waitForTimeout(500);
};

await p.goto(BASE + '/', { waitUntil: 'load' });
await p.waitForSelector('#modes', { timeout: 15000 });
await p.waitForTimeout(1500);
await toFlow();
await p.click('#flowskel'); await p.waitForTimeout(900);

// 「块库」这颗按钮本身
const btn = await p.evaluate(() => { const e = document.querySelector('#flowlib'); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { w: Math.round(r.width), h: Math.round(r.height), vis: cs.visibility, text: e.textContent.trim() }; });
chk(btn && btn.w > 0 && btn.h > 0 && btn.vis === 'visible', '工具栏上有一颗「块库」按钮、真的可点', JSON.stringify(btn));
chk(btn && btn.text === '块库', '按钮文案就是「块库」', btn && btn.text);

const before = await openPickerKeys();
chk(before.includes(TARGET), '动手之前：「总结」在换类型菜单里', '菜单共 ' + before.length + ' 项，含 ' + TARGET);
await p.evaluate(() => document.querySelectorAll('.kpick').forEach((e) => e.remove()));

const lib = await openLib();
// ⚠️ 面板底部那颗「全部放出」也是 `button[data-h]` —— 第一版把它算成"一行块"，
//    于是「每行都带收起/放出」这条假红。**是断言写错了，不是产品**：把它排掉再数。
const kinds = lib.rows.filter((r) => r.k !== '__all__');
chk(lib.rows.some((r) => r.k === '__all__'), '面板底部有「把收起来的全部放出」', lib.rows.filter((r) => r.k === '__all__').length + ' 颗');
chk(kinds.length > 15, '块库面板把所有块都列出来了', kinds.length + ' 种');
chk(kinds.every((r) => r.st === '收起' || r.st === '放出'), '每一种块都带一个「收起 / 放出」', kinds.filter((r) => !r.st).length + ' 种没有');

await clickLib(TARGET);
const afterHide = await openLib();
const row = afterHide.rows.find((r) => r.k === TARGET);
chk(row && row.off && row.st === '放出', '点「收起」之后，那一行变成「放出」', JSON.stringify(row));
await p.evaluate(() => document.querySelectorAll('.kpick').forEach((e) => e.remove()));

// ① 从换类型里消失
const after = await openPickerKeys();
chk(!after.includes(TARGET), '① 收起来的那一种**不再出现在「换类型」里**', '菜单 ' + after.length + ' 项（原 ' + before.length + '）');
chk(after.length === before.length - 1, '而且只少了它一个（不是连带掉一串）', before.length + ' → ' + after.length);
await p.evaluate(() => document.querySelectorAll('.kpick').forEach((e) => e.remove()));

// ② 刷新后仍然记住
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1600); await toFlow();
const afterReload = await openPickerKeys();
chk(!afterReload.includes(TARGET), '② 刷新之后它**还是**收着的（真的记住了，不是只在这一次会话里）', '菜单 ' + afterReload.length + ' 项');
await p.evaluate(() => document.querySelectorAll('.kpick').forEach((e) => e.remove()));

// ④ 收起 ≠ 删掉：画布上那种块照跑
const still = await p.evaluate(() => [...document.querySelectorAll('#flowworld .blk .nm')].map((x) => x.textContent));
chk(still.includes('总结'), '④ **收起 ≠ 删掉**：画布上那一块还在（不会被连带清掉）', still.join('/'));

// ③ 放出来
const l2 = await openLib();
await clickLib(TARGET);
const l3 = await openLib();
const row2 = l3.rows.find((r) => r.k === TARGET);
chk(row2 && !row2.off && row2.st === '收起', '③ 点「放出」之后它回来了', JSON.stringify(row2));
await p.evaluate(() => document.querySelectorAll('.kpick').forEach((e) => e.remove()));
const back = await openPickerKeys();
chk(back.includes(TARGET) && back.length === before.length, '③ 换类型里也回来了，项数恢复原样', back.length + ' 项（原 ' + before.length + '）');

// 「全部放出」这条路
await p.evaluate(() => document.querySelectorAll('.kpick').forEach((e) => e.remove()));
await openLib(); await clickLib(TARGET);            // 再收起一个
await openLib(); await clickLib('__all__');         // 一把全放
const l4 = await openLib();
chk(l4.rows.every((r) => !r.off), '「把收起来的全部放出」一把清空', l4.rows.filter((r) => r.off).length + ' 行还是收着的');

out.errs = errs;
out.pass = out.checks.filter((c) => c.ok).length;
out.fail = out.checks.filter((c) => !c.ok).length;
await p.locator('#m-flow').screenshot({ path: '/tmp/blocklib.png' });
console.log(JSON.stringify(out, null, 1));
await b.close();
