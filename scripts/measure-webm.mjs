import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
const br = await chromium.launch();
const p = await br.newPage({ viewport: { width: 960, height: 600 }, colorScheme: 'dark' });
await p.goto('file:///tmp/c4demos/g-tour.webm', { waitUntil: 'load' });
const d = await p.evaluate(() => new Promise((res) => {
  const v = document.querySelector('video');
  if (!v) return res({ err: '页面上没有 video 元素' });
  const done = () => res({ dur: v.duration, w: v.videoWidth, h: v.videoHeight });
  if (v.readyState >= 1 && isFinite(v.duration)) return done();
  v.onloadedmetadata = done;
  setTimeout(() => res({ err: 'metadata 超时', rs: v.readyState }), 8000);
}));
if (d.err) { console.log('量不到：', JSON.stringify(d)); await br.close(); process.exit(1); }
console.log('时长 ' + d.dur.toFixed(1) + ' 秒 | ' + d.w + '×' + d.h);
for (const [tag, frac] of [['起', 0.02], ['①问', 0.14], ['②搜', 0.30], ['③流', 0.52], ['③跑', 0.68], ['④架', 0.85], ['⑤改', 0.97]]) {
  await p.evaluate(async (t) => {
    const v = document.querySelector('video');
    v.currentTime = t;
    await new Promise((r) => { v.onseeked = r; setTimeout(r, 4000); });
  }, d.dur * frac);
  await p.screenshot({ path: `/tmp/c4demos/tour-${tag}.png` });
}
console.log('抽了 7 帧到 /tmp/c4demos/tour-*.png');
await br.close();
