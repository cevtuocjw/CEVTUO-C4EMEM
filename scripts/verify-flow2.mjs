/**
 * 结构流第二轮：有类型的端口 / 自由拖拽 / 连线 / 发光 / 3D 厚度 / 帮助弹窗。
 * ⚠️ 判据：
 *    · 端口类型必须是**真的在拦**：不兼容的两端连不上，而兼容的连得上（两侧都要测）
 *    · 拖卡片必须真的改坐标（不是把 class 挪来挪去）
 *    · 键盘分叉必须真的多出一块**并且**多出一条线
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { seedFlow } from './_flowseed.mjs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

// ⚠️ 画布以**服务端那份**为准：种到 localStorage 会被 hydrateFlow 盖掉，
//    套件就崩在 `.blk[data-id="b1"]` 找不到上（这是套件过期，不是产品坏了）。
await seedFlow([
  { id: 'b1', kind: 'src.notes', text: '骑行 心率', x: 60, y: 60 },
  { id: 'b2', kind: 'act.summary', text: '总结成三条', x: 430, y: 60 },
  { id: 'b3', kind: 'out.shelf', text: '', x: 800, y: 60 },
  { id: 'b4', kind: 'act.words', text: '翻译', x: 430, y: 300 },
  { id: 'b5', kind: 'ev.app', text: '切到 Chrome', x: 60, y: 300 },
]);
await p.addInitScript(() => localStorage.clear());
await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
await p.waitForTimeout(900);
await p.click('.thumb[data-m="flow"]');
await p.waitForTimeout(800);

console.log('\n▸ 端口有类型');
const ports = await p.$$eval('#flowlist .port', (els) => els.map((e) => e.dataset.d + ':' + e.dataset.t));
ok(ports.length >= 5, `端口画出来了（${ports.length} 个：${[...new Set(ports)].join(' ')}）`);
const noteOut = ports.includes('out:notes'), sumIn = ports.includes('in:notes');
ok(noteOut && sumIn, '「我的笔记」吐 notes，「总结」收 notes');
// ⚠️ 上一条断言原本写的是「没有任何口是 text」—— **那是错的**：
//    「翻译」本来就只收文本，有 text 口是对的。真正该测的是**不同动词收的东西不一样**，
//    以及**每个口都申明了自己的类型**（没有裸的、什么都能塞的口）。
const sigs = await p.$$eval('#flowlist .blk', (els) => els.map((el) =>
  [...el.querySelectorAll('.port.in')].map((x) => x.dataset.t).sort().join('+')));
ok(new Set(sigs).size >= 3, `不同动词的收口签名确有差别（${[...new Set(sigs)].join(' | ')}）`);
const untyped = await p.$$eval('#flowlist .port', (els) => els.filter((e) => !e.dataset.t).length);
ok(untyped === 0, '没有"什么都能塞"的裸口');

console.log('\n▸ 拖卡片：位置真的变');
const before = await p.$eval('.blk[data-id="b1"]', (e) => ({ l: e.style.left, t: e.style.top }));
const box = await p.$eval('.blk[data-id="b1"] .kb', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await p.mouse.move(box.x, box.y); await p.mouse.down();
await p.mouse.move(box.x + 120, box.y + 90, { steps: 8 }); await p.mouse.up();
await p.waitForTimeout(300);
const after = await p.$eval('.blk[data-id="b1"]', (e) => ({ l: e.style.left, t: e.style.top }));
ok(before.l !== after.l && before.t !== after.t, `卡片拖得动（${before.l},${before.t} → ${after.l},${after.t}）`);

console.log('\n▸ 连线：兼容的连得上，不兼容的连不上');
const drag = async (fromSel, toSel) => {
  const a = await p.$eval(fromSel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const bb = await p.$eval(toSel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  await p.mouse.move(bb.x, bb.y, { steps: 10 }); await p.mouse.up();
  await p.waitForTimeout(300);
  return p.$$eval('#wires .wire', (e) => e.length);
};
const n1 = await drag('.port.out[data-b="b1"][data-t="notes"]', '.port.in[data-b="b2"][data-t="notes"]');
ok(n1 === 1, `notes → notes 连上了（线数 ${n1}）`);
const n2 = await drag('.port.out[data-b="b2"][data-t="text"]', '.port.in[data-b="b3"][data-t="text"]');
ok(n2 === 2, `text → text 也连上了（线数 ${n2}）`);
// ⚠️ 负向对照：翻译只收「文本」。拿「笔记」去接它，必须**接不上**
// ⚠️ 负向对照要把**被测的那一侧**选对：上一版我拿 `notes → act.summary 的 text 口`
//    当"不兼容"，可 summary 本来就收 text —— 对照根本没在测拒绝。
const n3 = await drag('.port.out[data-b="b5"][data-t="event"]', '.port.in[data-b="b2"][data-t="notes"]');
ok(n3 === n2, `⚠️ 负向对照：事件 → 总结的收口**接不上**（线数还是 ${n3}，没多）`);
// 正向对照：同一个事件，接到「我的笔记」的 event 口 —— 必须接得上
const n4 = await drag('.port.out[data-b="b5"][data-t="event"]', '.port.in[data-b="b1"][data-t="event"]');
ok(n4 === n3 + 1, `⚠️ 正向对照：事件 → 来源的 event 口**接得上**（${n3} → ${n4}）`);
// 另一条：判断 → 弹通知收，→ 写回 Notion 不收
const n5 = await drag('.port.out[data-b="b2"][data-t="text"]', '.port.in[data-b="b4"][data-t="text"]');
ok(n5 === n4 + 1, `文本 → 翻译收得上（${n4} → ${n5}）`);
await p.screenshot({ path: 'out/flow2-wires.png' });

console.log('\n▸ 拖线时"能接的亮、不能接的暗"');
await p.mouse.move(...(await p.$eval('.port.out[data-b="b1"][data-t="notes"]', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })));
await p.mouse.down(); await p.mouse.move(800, 400, { steps: 5 }); await p.waitForTimeout(250);
const mark = await p.$$eval('#flowlist .port.in', (els) => els.map((e) => e.className.includes('ok') ? 'ok' : e.className.includes('no') ? 'no' : '?'));
ok(mark.includes('ok') && mark.includes('no'), `兼容的标 ok、不兼容的标 no（${mark.join(',')}）`);
await p.screenshot({ path: 'out/flow2-wiring.png' });
await p.mouse.up(); await p.waitForTimeout(200);

console.log('\n▸ 选中发光');
await p.click('.blk[data-id="b3"] .kb');
await p.waitForTimeout(200);
const anim = await p.$eval('.blk.sel', (e) => getComputedStyle(e).animationName);
ok(anim === 'selglow', `选中的块在发光（animation=${anim}）`);
ok((await p.$$eval('.blk.sel', (e) => e.length)) === 1, '同时只有一块是选中的');

console.log('\n▸ 键盘分叉');
const nb = await p.$$eval('#flowlist .blk', (e) => e.length);
const nw = await p.$$eval('#wires .wire', (e) => e.length);
await p.keyboard.press('Shift+ArrowRight');
await p.waitForTimeout(400);
const nb2 = await p.$$eval('#flowlist .blk', (e) => e.length);
const nw2 = await p.$$eval('#wires .wire', (e) => e.length);
ok(nb2 === nb + 1, `⇧→ 多出一块（${nb} → ${nb2}）`);
ok(nw2 === nw + 1, `并且同时多出一条线（${nw} → ${nw2}）`);

console.log('\n▸ 3D 有厚度（负向对照：把厚度拿掉，像素必须变）');
await p.click('#flowstyle button[data-l="3d"]'); await p.waitForTimeout(600);
/**
 * ⚠️ 这一条换过三种问法，前两种都是**在测错的东西**：
 *    ① 量 `::before` 的计算值（高 26px / matrix3d）—— 全绿，可那面墙转到了
 *       背离镜头的一侧，截图里什么都没有。**计算值说不出"看得见没有"。**
 *    ② 在卡片 bbox 的中轴下方取样 —— 平面斜过来之后 bbox 的中轴**落在卡片外面**，
 *       取到的是背景。所以量出来"侧面 == 背景"。
 *    现在用负向对照 + 数"灰像素"：厚度的侧面是一块灰（亮度 120~215），
 *    而卡片和背景都接近白。把 box-shadow 拿掉，这块灰必须消失。
 */
const greyCount = async () => {
  const shot = (await p.screenshot()).toString('base64');
  return p.evaluate(async ({ shot }) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + shot; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const k = img.width / innerWidth;
    const b = document.querySelector('.lay-3d .blk').getBoundingClientRect();
    // 只数卡片**自身上下那一圈**，别把整屏的点阵算进来
    const x0 = Math.round((b.x - 10) * k), y0 = Math.round((b.top - 10) * k);
    const w = Math.round((b.width + 20) * k), h = Math.round((b.height + 70) * k);
    const d = g.getImageData(x0, y0, w, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (L > 110 && L < 218) n += 1;
    }
    return n;
  }, { shot });
};
const withThick = await greyCount();
await p.addStyleTag({ content: '.lay-3d .blk{box-shadow:none !important}' });
await p.waitForTimeout(350);
const without = await greyCount();
ok(withThick > 400, `卡片下方确实有一片侧面（灰像素 ${withThick}）`);
ok(withThick > without * 2.2, `⚠️ 负向对照：拿掉 box-shadow 后那片灰没了（${withThick} → ${without}）`);
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(900);
await p.click('.thumb[data-m="flow"]'); await p.waitForTimeout(600);
await p.click('#flowstyle button[data-l="3d"]'); await p.waitForTimeout(600);
await p.screenshot({ path: 'out/flow2-3d.png' });
await p.click('#flowstyle button[data-l="default"]'); await p.waitForTimeout(300);

console.log('\n▸ 帮助弹窗');
await p.click('#flowHelp'); await p.waitForTimeout(300);
ok(!(await p.$eval('#flowhelp', (e) => e.hidden)), '「?」打得开');
// ⚠️ 这里原来是 `$eval('.mbox.wide', …)` —— 匹配**第一个**宽弹窗。
//    2026-10-09 加了「同步」弹窗（也是 `.mbox wide`，DOM 里排在前面）之后，
//    这条断言就一直在读**同步弹窗**的文字，7 条全部假红。
//    ⇒ 断言的判据要钉在自己那个弹窗上，不能靠"页面上只有它一个"。
const ht = await p.$eval('#flowhelp .mbox', (e) => e.textContent);
for (const kw of ['主谓宾', '每个接口有类型', '数据流', '顺序', '条件', '分叉', '会动到外面']) {
  ok(ht.includes(kw), `讲清楚了「${kw}」`);
}
await p.screenshot({ path: 'out/flow2-help.png' });
await p.click('#helpClose'); await p.waitForTimeout(200);
ok(await p.$eval('#flowhelp', (e) => e.hidden), '关得掉');

console.log(`\n${pass} 通过 / ${fail} 失败` + (errs.length ? '\n⚠️ 页面报错: ' + errs.slice(0, 4).join(' ;; ') : '\n✅ 无页面报错'));
await b.close();
process.exit(fail ? 1 : 0);
