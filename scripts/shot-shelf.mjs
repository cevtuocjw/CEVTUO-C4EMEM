import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await p.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('c4emem.shelf', JSON.stringify([
    { text: 'Crapette 是什么', kind: 'clip', ic: 'clip' },
    { text: 'https://www.figma.com/file/abc/Design-System', kind: 'link', ic: 'link' },
  ]));
});
await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
await p.waitForTimeout(1000);
await p.evaluate(() => {
  const dt = new DataTransfer(); dt.setData('text/plain', '从外面复制的一段话 —— 先丢这儿，待会儿再决定拿它干嘛');
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await p.waitForTimeout(300);
await p.evaluate(() => {
  const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  const f = new File([png], '截图.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(f);
  document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
});
await p.waitForTimeout(700);
await p.evaluate(() => { const e = document.querySelector('#shelfHint'); e.hidden = false; e.classList.add('on'); });
await p.waitForTimeout(260);
await p.screenshot({ path: 'out/s9-shelf.png' });
console.log('ok');
await b.close();
