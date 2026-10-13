/**
 * 给 out/taxonomy.html 截图 —— 顺便**抓 console 报错**。
 * 不截图就等于没验证过：图渲染错了（比如 JS 抛异常导致白屏）光看文件大小看不出来。
 */
// 本机已经在 CEVTUO-Z 里装过 playwright，浏览器也缓存好了 ——
// 不为了一张截图在本项目里再装一份（省 100+MB）。
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';

const file = `file://${process.cwd()}/out/taxonomy.html`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });

const errors: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(file, { waitUntil: 'load' });
await page.waitForTimeout(900);

// 断言：树图里真的画出了方块（不是白屏）
const boxes = await page.evaluate(() => {
  const nodes = document.querySelectorAll('#map .node');
  const sideRows = document.querySelectorAll('#side .grp');
  return { nodes: nodes.length, groups: sideRows.length, w: document.querySelector('#map')?.clientWidth ?? 0 };
});

await page.screenshot({ path: 'out/taxonomy.png' });

console.log(`树图方块 ${boxes.nodes} 个 · 右侧大类 ${boxes.groups} 个 · 画布宽 ${boxes.w}px`);
console.log(boxes.nodes > 10 ? '✅ 渲染出来了' : '❌ 树图是空的 —— 大概率 JS 挂了');
if (errors.length) {
  console.log('⚠️ 页面报错：');
  for (const e of errors.slice(0, 6)) console.log('   ' + e.slice(0, 200));
} else {
  console.log('✅ 无 console 报错');
}

await browser.close();
