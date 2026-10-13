
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
const errs: string[] = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://127.0.0.1:8770/ui/orb-demo.html', { waitUntil: 'load' });
await p.waitForTimeout(2500);
const ok = await p.evaluate(() => Boolean(window.__ok));
console.log('模块加载:', ok ? '✅' : '❌');
if (errs.length) console.log('报错:', errs.slice(0,3).join(' | '));
// 逐个形态截图，并读中心像素确认不是一片空白
for (const v of ['pearl','stone','lime']) {
  await p.click(`button[data-v="${v}"]`);
  await p.waitForTimeout(1400);
  const px = await p.evaluate(() => window.__orb.debugPixel());
  await p.screenshot({ path: `out/orb-${v}.png` });
  const spread = Math.max(...px) - Math.min(...px);
  console.log(`  ${v.padEnd(6)} 中心像素 rgb(${px.join(',')})  变化=${spread}`);
}
// 聆听态 + 拉高音量，看形变是否真的变了
await p.click('button[data-v="pearl"]');
await p.click('button[data-s="listening"]');
await p.fill('#lv', '90');
await p.waitForTimeout(1600);
await p.screenshot({ path: 'out/orb-listening.png' });
console.log('✅ 截图完成 out/orb-*.png');
await b.close();
