
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1460, height: 920 }, deviceScaleFactor: 2 });
const errs: string[] = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
await p.waitForTimeout(2200);
console.log('初始模式:', await p.evaluate(() => window.__app.mode));
await p.screenshot({ path: 'out/app-voice.png' });

// 造几条记录：文字问一次
await p.keyboard.press('Backquote'); await p.waitForTimeout(400);
await p.fill('#tinput', 'Crapette 是什么');
await p.keyboard.press('Enter'); await p.waitForTimeout(4000);
console.log('记录条数:', await p.$$eval('#loglist .item', e => e.length));

// 续聊：再问一句，然后点记录里最早那条，看是否恢复对话
await p.fill('#tinput', '那怎么玩');
await p.keyboard.press('Enter'); await p.waitForTimeout(4500);
const turnsBefore = await p.$$eval('#thread .msg', e => e.length);
await p.locator('#loglist .item').last().click();
await p.waitForTimeout(1200);
await p.waitForTimeout(900);
const turnsAfter = await p.$$eval('#thread .msg', e => e.length);
const stray = await p.$$eval('#thread .msg', e => e.filter(x => x.innerText.trim() === '…').length);
console.log('恢复后残留的"…"气泡:', stray);
console.log('续聊前后气泡数:', turnsBefore, '→', turnsAfter);
await p.screenshot({ path: 'out/app-resume.png' });

// 把记录拖进货架
await p.locator('#loglist .item').first().dragTo(p.locator('#shelf'));
await p.waitForTimeout(500);
console.log('货架段数:', await p.evaluate(() => window.__app.shelf.length));
await p.screenshot({ path: 'out/app-main.png' });

// ~ 到流程
await p.keyboard.press('Backquote'); await p.waitForTimeout(400);
console.log('第三模式:', await p.evaluate(() => window.__app.mode));
// 主动式页面
await p.click('.nv[data-v="proactive"]'); await p.waitForTimeout(900);
console.log('主动式开关数:', await p.$$eval('.sw input', e => e.length), '总开关:', await p.$eval('#pOn', e => e.checked), '推过:', await p.$$eval('.push', e => e.length));
// ⚠️ 别只看截图 —— 读输入框的**实际值**，确认显示的和存的一致
console.log('静默起:', await p.$eval('#pFrom', e => e.value), '止:', await p.$eval('#pTo', e => e.value), '每天:', await p.$eval('#pPerDay', e => e.value));
await p.screenshot({ path: 'out/app-proactive.png' });
// 接入
await p.click('#gear'); await p.waitForTimeout(700);
console.log('接入分区:', await p.$$eval('.sec', e => e.length), '已接入:', await p.$$eval('.dot.on', e => e.length));
await p.screenshot({ path: 'out/app-settings.png' });
console.log(errs.length ? '⚠️ 报错: ' + errs.slice(0,5).join(' ;; ') : '✅ 无页面报错');
await b.close();
