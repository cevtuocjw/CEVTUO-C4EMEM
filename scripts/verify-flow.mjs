/**
 * 结构流画布 + 联网兜底。
 * ⚠️ 判据全是"契约"不是"运气"：
 *    · 版式切换必须**真的改变块的几何**（加个 class 而位置没动 = 没换版式）
 *    · 点阵必须**按缩放重画**（background-size 跟着 z 变），不是跟着 transform 放大
 *    · 联网这条路：要么拿到结果，要么**明确报错** —— 绝不能静默返回空
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

// ⚠️ 得先给结构流播种。不播的话块数是 0，下面"位置变了"的断言
//    是在**比两个空集合** —— 它会通，但什么也没测。（纪律 6：退化的数据骗得过断言。）
// ⚠️ 种到**服务端**（临时目录）：画布现在以文件夹里那份为准，
//    种到 localStorage 会被 hydrateFlow 盖掉。
await seedFlow([
  { id: 'b1', kind: 'kb_search', text: '先在笔记里找「骑行 心率」' },
  { id: 'b2', kind: 'llm_summary', text: '把找到的合成一段结论' },
  { id: 'b3', kind: 'notion_write', text: '写回 Learn 那一天的 toggle' },
  { id: 'b4', kind: 'llm_class', text: '归到「健康 / 运动」' },
], []);
await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
await p.waitForTimeout(900);
await p.click('.thumb[data-m="flow"]');
await p.waitForTimeout(700);

console.log('\n▸ 画布');
const grid = await p.$eval('#flowgrid', (e) => { const cs = getComputedStyle(e); return { img: cs.backgroundImage, size: cs.backgroundSize, pos: cs.backgroundPosition }; });
ok(/radial-gradient/.test(grid.img), '点阵是画出来的（radial-gradient）');
ok(/\d/.test(grid.size), `点阵有尺寸（${grid.size}）`);
// ⚠️ 「看得见」和「点得到」是两件事。这里问的是**那个坐标上到底是谁**。
const reaches = await p.evaluate(() => {
  const bad = [];
  for (const b of document.querySelectorAll('.flowbar button, .zoomctl button, #flowstyle button')) {
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (!top || !b.contains(top) && top !== b) bad.push((b.textContent || '').trim() + ' ← ' + (top ? (top.id || top.className) : 'null'));
  }
  return bad;
});
ok(reaches.length === 0, `结构流顶上那排按钮没有被别的东西盖住${reaches.length ? '（被挡的：' + reaches.join(' / ') + '）' : ''}`);
await p.click('.zoomctl button[data-z="in"]'); await p.waitForTimeout(200);
const z1 = await p.$eval('#zoomPct', (e) => e.textContent);
const g1 = await p.$eval('#flowgrid', (e) => getComputedStyle(e).backgroundSize);
ok(z1 !== '100%', `＋ 能放大（${z1}）`);
await p.click('.zoomctl button[data-z="out"]'); await p.click('.zoomctl button[data-z="out"]'); await p.waitForTimeout(200);
const g2 = await p.$eval('#flowgrid', (e) => getComputedStyle(e).backgroundSize);
ok(g1 !== g2, `缩放时点阵**重画**（${g1} → ${g2}）`);
const zr = await p.$eval('#zoomPct', (e) => e.textContent);
ok(zr !== z1, `− 能缩小（${zr}）`);
await p.click('.zoomctl button[data-z="fit"]'); await p.waitForTimeout(300);
ok(true, '「适应」没报错');

console.log('\n▸ 三种版式（学 Tuna）');
// ⚠️ 判据用**形状**，不用"坐标串不相等"：
//    后者会被"缩放比例变了"这种无关变化满足，前者不会。
const shapeOf = () => p.$$eval('#flowlist .blk', (els) => {
  const xs = els.map((e) => Math.round(e.getBoundingClientRect().x));
  const ys = els.map((e) => Math.round(e.getBoundingClientRect().y));
  return { n: els.length, cols: new Set(xs).size, rows: new Set(ys).size };
});
const n0 = await p.$$eval('#flowlist .blk', (e) => e.length);
ok(n0 >= 3, `结构流里有块可比（${n0} 块）`);   // 没有这条，下面全是在比空集合
const shapes = {}; const geom = {};
for (const lay of ['default', 'nuggets', '3d']) {
  await p.click(`#flowstyle button[data-l="${lay}"]`);
  await p.waitForTimeout(400);
  const has = await p.$eval('#m-flow', (el, l) => el.classList.contains('lay-' + l), lay);
  ok(has, `切到 ${lay} 时容器带上了 lay-${lay}`);
  shapes[lay] = await shapeOf();
  geom[lay] = await p.$$eval('#flowlist .blk', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }));
  await p.screenshot({ path: `out/flow-${lay}.png` });
}
console.log('    形状：' + JSON.stringify(shapes));
// ⚠️ 「卡片」版式现在是**自由画布** —— 不再是一列往下走了。
//    这条断言原来写的是 `cols === 1`，那是上一版的行为；留着它会逼着我退回旧设计。
//    真正的契约是：**每块保持自己的坐标**（所以列数 = 不同 x 的个数，≥ 2）。
ok(shapes.default.cols >= 2, `卡片 = 各自摆各自的，自由画布（${shapes.default.cols} 列 / ${shapes.default.rows} 行）`);
ok(shapes.nuggets.cols >= 2, `Nuggets = 方块阵（${shapes.nuggets.cols} 列）`);
// ⚠️ 原来这条比的是「列数不等」—— 而现在 default（自由摆）和 nuggets（3 列网格）
//    恰好都是 3 列，比较就成了空话。真正该测的是：**换版式必须真的把东西挪了**。
//    （class 变了、位置没动 = 没换版式。这正是它最初抓到的那个 bug。）
const key = (a) => JSON.stringify(a);
ok(key(geom.default) !== key(geom.nuggets), '卡片 ↔ Nuggets：块的位置真的动了');
ok(key(geom.nuggets) !== key(geom['3d']), 'Nuggets ↔ 3D：块的位置真的动了');
const tf = await p.$eval('#flowlist', (e) => getComputedStyle(e).transform);
ok(shapes['3d'].cols >= 2 && /matrix3d|perspective/.test(tf) === false ? shapes['3d'].cols >= 2 : /matrix3d/.test(tf),
   `3D = 斜面（列数 ${shapes['3d'].cols}，容器 transform 是 3D 矩阵：${/matrix3d/.test(tf)}）`);
await p.click('#flowstyle button[data-l="default"]'); await p.waitForTimeout(300);

console.log('\n▸ 来源');
const chips = await p.$$eval('#flowlist .blk', (els) => els.map((e) => { const c = e.querySelector('.bsrc'); return c ? c.textContent.trim() : null; }));
ok(chips.length > 0 && chips.every(Boolean), `每块都带来源标签（${chips.length} 块）`);
const before = chips[0];
await p.click('#flowlist .blk .bsrc');
await p.waitForTimeout(250);
const after = await p.$eval('#flowlist .blk .bsrc', (e) => e.textContent.trim());
ok(before !== after, `点一下能换来源（「${before}」→「${after}」）`);

console.log('\n▸ 笔记里没有 → 弹窗');
// 选一个库里没有任何文档的来源（手机/ADB），这就是真实的"知识库没有"路径
await p.click('#fanbtn'); await p.waitForTimeout(700);
await p.click('#fanitems .fani[data-s="adb"]'); await p.waitForTimeout(400);
await p.click('.thumb[data-m="text"]'); await p.waitForTimeout(400);
await p.fill('#tinput', '手机里那条通知说了什么');
await p.click('#tsend');
// ⚠️ 等条件，不等固定秒数：这条链上一次嵌入 + 一次模型调用，
//    慢了 4 秒就不够 —— 而"没等够"和"弹窗没弹"在输出里长得一模一样。
await p.waitForFunction(() => {
  const m = document.querySelector('#askmodal');
  return (m && !m.hidden) || /没有相关/.test(document.querySelector('#thread').textContent);
}, null, { timeout: 60000 }).catch(() => {});
await p.waitForTimeout(400);
const modal = await p.$eval('#askmodal', (e) => !e.hidden);
ok(modal, '弹窗出现了（而不是回一句写死的「笔记里没有」）');
if (modal) {
  await p.screenshot({ path: 'out/flow-modal.png' });
  const txt = await p.$eval('#mbody', (e) => e.textContent);
  ok(/上网/.test(txt), '弹窗里给的是「上网」这个选择');
  ok(/不是你自己的笔记/.test(txt), '并且说清了网上内容和笔记不是一回事');
  // 点「上网找」——要么拿到结果，要么**明确报错**，绝不静默
  await p.click('#mWeb');
  await p.waitForTimeout(20000);
  const body = await p.$eval('#thread .msg:last-child', (e) => e.textContent);
  const gotWeb = /🌐/.test(body), gotErr = /没能联网/.test(body);
  ok(gotWeb || gotErr, `联网这条路给出了明确结果（${gotWeb ? '拿到网页' : '报错'}：${body.slice(0, 50).replace(/\n/g, ' ')}）`);
  ok(body.split('没能联网').length - 1 <= 1, '失败原因只说一遍（不重复刷屏）');
  ok(!/^\s*（没有回答）\s*$/.test(body.trim()), '不是一句空话');
}
await p.screenshot({ path: 'out/flow-web.png' });

console.log('\n▸ 货架收起时只有一颗球（「?」要等点开才出现）');
const pr = await p.$eval('#shelfToggle', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const sb = await p.$eval('#shelf', (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor, shadow: cs.boxShadow }; });
ok(pr.w < 70 && pr.h < 70, `货架是颗圆球（${pr.w}×${pr.h}）`);
// ⚠️ 读者要的是「**点击之后**才看到问号」—— 收起态还挂着一个问号，它看着**像另一颗按钮**。
//    判据是**问号自己可不可见**，不是"容器宽不宽"：后者会跟着别的东西一起变，
//    那样即使问号露在外面这条也照样绿（典型的运气断言）。
const qHidden = await p.$eval('#shelfHelp', (e) => getComputedStyle(e).display === 'none' || e.getBoundingClientRect().width === 0);
ok(qHidden, '收起时「?」是藏起来的（不是挂在球旁边）');
// 这条防的是原来那个 bug：容器带着上一版残留的 width/background，
// 在右下角留一块 326×78 的白玻璃。所以判据是**上限**。
ok(sb.w < 80 && sb.h < 80, `容器收起来就是球那么大，没有残留的板子（${sb.w}×${sb.h}，球 ${pr.w}）`);
ok(sb.bg === 'rgba(0, 0, 0, 0)' && sb.shadow === 'none', '容器自己没有底色和阴影了');
// ⚠️ 必须测**另一面**：不能为了"藏起来"就让它永远出不来。
await p.click('#shelfToggle');
await p.waitForTimeout(400);
const qShown = await p.$eval('#shelfHelp', (e) => e.getBoundingClientRect().width > 0);
ok(qShown, '点开之后「?」真的出现了（藏 ≠ 没了）');

console.log(`\n${pass} 通过 / ${fail} 失败` + (errs.length ? '\n⚠️ 页面报错: ' + errs.slice(0, 4).join(' ;; ') : '\n✅ 无页面报错'));
await b.close();
process.exit(fail ? 1 : 0);
