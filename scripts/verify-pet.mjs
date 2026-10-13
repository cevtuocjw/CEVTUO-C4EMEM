/**
 * 桌面 CEVTUO Pet —— 形态 / 卡片 / 那一圈软件 / 拖它进货架。
 *
 * ⚠️⚠️ 这个套件是为了一个**已经发生过的**静默 bug 建的：
 *    `PET_FORMS` 里有个 `crystal`，而 `ORB_VIDEO` 里**没有它** ⇒
 *    `renderPet()` 会把 `src="undefined"` 塞进 `<video>` —— 换成那个形态就是**一片空白**，
 *    而 DOM、类名、控制台**全都正常**。判据是「每个形态都取到一个**真的 200** 的资源」。
 *
 * ⚠️ 另一条是刚踩的：Pet 里那张卡**掉到容器外面**去了
 *    （网格隐式行按内容撑成 296px，`place-items:center` 无处可中心）。
 *    DOM 正常、类名正常、`background-image` 正常，只是**画在屏幕外**。
 *    ⇒ 判据是**矩形的包含关系**：卡片矩形必须在 petbody 矩形里面。
 *
 * 跑：env -u HTTPS_PROXY … NO_PROXY='*' bun scripts/verify-pet.mjs
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (extra ? '  ' + extra : '')); } };

const br = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const p = await br.newPage({ viewport: { width: 1460, height: 920 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const bad = [];
p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });

// ⚠️ 这个套件会**写 `c4emem.pet`**（形态那一串）。今天它跑在 Playwright 的
//    **一次性 profile** 里，所以碰不到读者 App 里的那份 localStorage ——
//    但"靠 profile 隔离来保平安"这件事**不是这份代码保证的**，
//    哪天换成 `launchPersistentContext` 就会把人家选的形态静默换掉
//    （`verify-manage.mjs` 当初就是这么把真装着的功能删光的）。
//    ⇒ 开跑先拍快照，`finally` 里原样写回去，成本一次导航。
let savedPet = null;
try {
  await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
  savedPet = await p.evaluate(() => localStorage.getItem('c4emem.pet'));
  await p.evaluate(() => localStorage.setItem('c4emem.pet', JSON.stringify({ on: true, form: 'card', mode: 'apps' })));
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(2200);

  // ── ① 形态清单 ↔ 资源 ────────────────────────────────────────
  const forms = await p.$$eval('#vorb option', (o) => o.map((x) => x.value));
  ok('下拉里有这五个形态', forms.length === 5 && forms.includes('silver') && forms.includes('zinc'), forms.join(','));
  for (const f of forms) {
    await p.evaluate((form) => {
      const raw = JSON.parse(localStorage.getItem('c4emem.pet') || '{}');
      localStorage.setItem('c4emem.pet', JSON.stringify({ ...raw, form }));
      window.location.reload();
    }, f);
    await p.waitForLoadState('load');
    // ⚠️⚠️ 原来是死等 1300ms —— 那是个**抖动源**（实测：同一个套件连跑三次，
    //    失败的是 silver / silver / pearl，每次都不一样 ⇒ 任何一次绿色都不可信）。
    //    ⇒ 改成**等条件**：等 `renderPet()` 自己把 `dataset.form` 写上（那是它最后一行）。
    //    ⚠️ 等的**不是**下面那条断言要查的东西 —— 否则就先等到了再断言，断言永远绿。
    await p.waitForFunction((form) => document.querySelector('#pet')?.dataset.form === form, f, { timeout: 15000 })
      .catch(() => {});   // 超时就让它过去，下面那条断言会红（红的原因要看得见）
    const r = await p.evaluate(() => {
      const el = document.querySelector('#petbody img, #petbody video, #petbody .ck');
      if (!el) return { none: true };
      const src = el.getAttribute('src') || '';
      return { tag: el.tagName, src, hasUndef: /undefined/.test(el.outerHTML) };
    });
    ok(`形态 ${f}：Pet 里有东西`, !r.none);
    ok(`形态 ${f}：资源地址是真的（没有 undefined）`, !r.hasUndef, r.src || r.tag);
    if (r.src) {
      const code = await p.evaluate(async (u) => (await fetch(u, { method: 'HEAD' })).status, r.src);
      ok(`形态 ${f}：那份资源取得到（HTTP 200）`, code === 200, r.src + ' → ' + code);
    }
    // 矿物：用的是**抠好的**动图，而且要真的有透明像素
    if (['silver', 'lead', 'zinc'].includes(f)) {
      const a = await p.evaluate(async () => {
        const img = document.querySelector('#petbody img');
        if (!img) return null;
        await img.decode().catch(() => {});
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
        const px = (x, y) => g.getImageData(x, y, 1, 1).data[3];
        let maxA = 0;
        const d = g.getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 4 * 29) if (d[i] > maxA) maxA = d[i];
        return { corner: px(4, 4), maxA };
      });
      ok(`形态 ${f}：白底真的抠掉了（四角透明）`, a && a.corner <= 25, JSON.stringify(a));
      ok(`形态 ${f}：标本还在（有不透明像素）`, a && a.maxA > 200, JSON.stringify(a));
    }
  }

  // ── ② 卡片形态：在框里、会转 ────────────────────────────────
  await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('c4emem.pet') || '{}');
    localStorage.setItem('c4emem.pet', JSON.stringify({ ...raw, form: 'card' }));
  });
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1800);
  const box = await p.evaluate(() => {
    const b = document.querySelector('#petbody').getBoundingClientRect();
    const c = document.querySelector('#petck').getBoundingClientRect();
    const inside = c.left >= b.left - 6 && c.right <= b.right + 6 && c.top >= b.top - 6 && c.bottom <= b.bottom + 6;
    return { inside, pet: [b.left, b.top, b.width, b.height].map((x) => +x.toFixed(1)), ck: [c.left, c.top, c.width, c.height].map((x) => +x.toFixed(1)), layers: document.querySelectorAll('#petck i').length };
  });
  ok('Pet 卡片**在容器里面**（不是画到屏幕外）', box.inside, JSON.stringify(box));
  ok('卡片是**多层**的（有厚度，不是一张平铺的图）', box.layers >= 10, '层数=' + box.layers);
  ok('卡片比原来小了（≤ 92px 宽）', box.pet[2] <= 92, '宽=' + box.pet[2]);
  const t1 = await p.$eval('#petck', (e) => getComputedStyle(e).transform);
  await p.waitForTimeout(1400);
  const t2 = await p.$eval('#petck', (e) => getComputedStyle(e).transform);
  ok('Pet 里那张卡**在动**（会转）', t1 !== t2, t1.slice(0, 40) + ' vs ' + t2.slice(0, 40));

  // ── ③ **鼠标放上去**就弹出一圈正在运行的软件，移开收回 ─────
  //  ⚠️ 2026-10-10 深夜改的口径：读者要的是「**鼠标放上去它就展示**当前窗口打开的软件出现」。
  //     原来的"点一下弹出/再点收回"变成了"移上去弹出/移开收回"（点仍然能开关）。
  await p.hover('#pet');
  await p.waitForTimeout(2200);
  const n1 = await p.$$eval('#petring button', (e) => e.length);
  ok('鼠标放上去就弹出一圈**正在运行的软件**', n1 > 0, '个数=' + n1);
  const icon = await p.$$eval('#petring button img', (e) => e.filter((i) => i.naturalWidth > 0).length);
  ok('那一圈里**图标真的加载出来了**（不是一排空方块）', icon > 0, icon + '/' + n1);
  await p.mouse.move(5, 5);
  await p.waitForTimeout(900);
  ok('鼠标移开就收回', (await p.$$eval('#petring button', (e) => e.filter((b) => b.offsetParent).length)) === 0);

  // ── ④ 拖东西到它身上 = 进货架（读者：「不论怎么样都应该…」）──
  const before = await p.evaluate(() => window.__app.shelf.length);
  await p.evaluate(() => {
    const pet = document.querySelector('#pet');
    const dt = new DataTransfer();
    dt.setData('text/plain', '验收：拖到 Pet 上的这一段');
    dt.setData('application/x-c4emem-kind', 'clip');
    pet.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    pet.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => window.__app.shelf.length);
  ok('拖到 Pet 身上会进货架', after > before, before + ' → ' + after);

  ok('没有 404 之类的坏请求', bad.length === 0, bad.slice(0, 3).join(' | '));
  ok('没有页面报错', errs.length === 0, errs.slice(0, 2).join(' | '));
} catch (e) {
  fail++; console.log('  ✗ 跑不起来：' + e.message);
} finally {
  // 把读者的 Pet 设置还回去（跑红了也要还 —— 所以放在 finally）
  if (savedPet != null) {
    try {
      await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
      await p.evaluate((v) => localStorage.setItem('c4emem.pet', v), savedPet);
      console.log('  （已把 Pet 设置还原成跑之前那一份）');
    } catch { console.log('  ⚠️ Pet 设置没还原成 —— 去设置里自己挑一次形态'); }
  }
  await br.close();
}
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
