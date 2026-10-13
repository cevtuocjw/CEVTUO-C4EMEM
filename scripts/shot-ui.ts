
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
const errs: string[] = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
await p.waitForTimeout(700);
const nav = await p.$$eval('nav button', els => els.map(e => e.textContent));
await p.screenshot({ path: 'out/ui-ask.png' });
// 切到主题分布，确认是异步渲染出来的
await p.click('nav button[data-v="tax"]');
await p.waitForTimeout(1500);
const rows = await p.$$eval('main table tr', els => els.length);
await p.screenshot({ path: 'out/ui-tax.png' });
console.log('导航按钮:', nav.join(' | '));
console.log('主题分布表格行数:', rows);
console.log(errs.length ? '⚠️ 报错: ' + errs.slice(0,4).join(' ;; ') : '✅ 无页面报错');
await b.close();
