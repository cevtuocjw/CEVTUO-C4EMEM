// 看一眼语音屏的卡片形态 + 桌面 Pet + 矿物的展台光 —— 只截图，不改任何东西。
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1460, height: 920 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
await p.evaluate(() => localStorage.setItem('c4emem.pet', JSON.stringify({ on: true, form: 'card' })));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(2500);
await p.screenshot({ path: 'out/pet-voice-card.png' });
await p.locator('#pet').screenshot({ path: 'out/pet-crop-card.png' });
const info = await p.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b2 = e.getBoundingClientRect(); return { w: +b2.width.toFixed(1), h: +b2.height.toFixed(1) }; };
  return { ck: r('.ck'), petbody: r('.petbody'), petck: r('#petck'), petals: document.querySelectorAll('#petck i').length };
});
console.log('card:', JSON.stringify(info));
// 矿物形态 + 展台光
await p.selectOption('#vorb', 'zinc');
await p.waitForTimeout(2200);
await p.screenshot({ path: 'out/pet-voice-zinc.png' });
await p.evaluate(() => localStorage.setItem('c4emem.pet', JSON.stringify({ on: true, form: 'zinc' })));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(2500);
await p.locator('#pet').screenshot({ path: 'out/pet-crop-zinc.png' });
console.log('errs:', errs.slice(0, 3).join(' | ') || 'none');
await b.close();
