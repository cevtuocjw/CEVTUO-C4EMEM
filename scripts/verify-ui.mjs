/**
 * 界面验证：来源扇区 / 两栏收起 / 货架挪位。
 *
 * ⚠️ 判据都是**读出来的几何和契约**，不是「看起来对」：
 *    · 扇区里相邻两格的中心距必须 ≥ 瓦片直径（不然是叠在一起，而截图里只是"挤"）
 *    · 融合必须同时是「最近的」和「最靠弧中」的 —— 两个条件都要测
 *    · 货架收起来时必须**不压住**右上角那三个缩略图（矩形不相交）
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

let pass = 0, fail = 0, skip = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };
const rect = (s) => p.$eval(s, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
const vis = (s) => p.$eval(s, (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }).catch(() => false);

await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
await p.waitForTimeout(900);

console.log('\n▸ 扇区：收起态');
const tiles = await p.$$eval('#fanitems .fani', (e) => e.map((x) => x.dataset.s));
// ⚠️ 2026-10-10：读者让 Notion 的 **4 个库合成一格**（「tech-learn 什么这 4 种也是合在一起，
//    都是 notion 的」）⇒ 格子数从 9 变成 6。所以这里**不能写死 9**。
//    真正的契约有两条：① 每个来源**只出现一次**；② Notion 那四个库**不再各占一格**。
ok(tiles.length >= 5 && tiles.length === new Set(tiles).size, `来源瓦片：一个来源一格、不重复（${tiles.join('、')}）`);
ok(tiles.includes('notion') && !tiles.some((t) => ['learn', 'techai', 'techlearn', 'shopping'].includes(t)),
   '⚠️ Notion 的 4 个库**合成了一格**（不再各占一格）');
ok(await vis('#fanbtn'), '左下角那颗按钮在');
const foldOpacity = await p.$$eval('#fanitems .fani', (e) => e.map((x) => Number(getComputedStyle(x).opacity)));
ok(foldOpacity.every((o) => o < 0.05), '收起时瓦片全透明（实得 ' + foldOpacity.join('/') + '）');
await p.screenshot({ path: 'out/ui-1-closed.png' });

console.log('\n▸ 扇区：展开');
await p.click('#fanbtn');
await p.waitForTimeout(800);
ok(await vis('#fanitems .fani'), '展开后瓦片可见');
// ⚠️ 契约不是「全部不透明」——**没配好的来源本来就该变淡**（那是提示，不是坏了）。
//    真正的契约是：融合永远全亮；没配好的那几颗**确实**比配好的淡；
//    而且淡的那些必须正好是 /api/sources 报 not ok 的那几个（不是随便淡几颗）。
const op = await p.$$eval('#fanitems .fani', (e) => Object.fromEntries(e.map((x) => [x.dataset.s, Number(getComputedStyle(x).opacity)])));
ok(op.blend > 0.95, `融合始终全亮（${op.blend}）`);
// ⚠️ 瓦片的 id 现在是**软件**（notion / exmail / …），不再是库（learn / techai / …）
ok(op.notion > 0.95, `已经接上的来源全亮（notion ${op.notion}）`);
const dim = Object.entries(op).filter(([, v]) => v < 0.95).map(([k]) => k).sort();
// ⚠️ 连接器的 id 和瓦片的 id 对不上（连接器叫 `wecom`，瓦片叫 `exmail`）——
//    和 `app.js` 里那张 `TILE_OF_CONNECTOR` 是同一份映射，改一处要改两处。
const ALIAS = { exmail: 'exmail', wecom: 'exmail', figma: 'figma', feishu: 'feishu', adb: 'adb' };
const notReady = [...new Set((await (await fetch('http://127.0.0.1:8770/api/sources')).json()).items
  .filter((i) => !i.ok).map((i) => ALIAS[i.id] ?? i.id))].filter((k) => k in op).sort();
// ⚠️⚠️ 这里原来写的是「淡的**正好等于**接口说没配好的那几颗」—— **那条判据是错的**。
//    实测（两态都量过）：展开后 blend 1 / notion 1 / adb 1，
//    exmail·feishu·figma 0.45（没配好），而 **proactive 0.55**。
//    `proactive`（主动）也是淡的，但**不是**因为没配好 —— 它是 `nofeed`：
//    那颗瓦片**只带功能、不是数据来源**（点了会说清楚），所以**故意**做得淡一点。
//    ⇒ 正确的契约是「淡的 = 没配好的 ∪ nofeed 的」，而且这两拨要**看得出是两回事**。
const nofeed = await p.$$eval('#fanitems .fani.nofeed', (e) => e.map((x) => x.dataset.s).sort());
const expectDim = [...new Set([...notReady, ...nofeed])].sort();
ok(JSON.stringify(dim) === JSON.stringify(expectDim),
   `变淡的正好是「没配好的 ∪ 只带功能的」（淡=${dim.join(',')} / 期望=${expectDim.join(',')}）`);
// ⚠️ 而且两拨的"淡"必须是**两个不同的值** —— 同一个值就分不出"没配好"和"只带功能"了，
//    那颗 nofeed 瓦片也就失去了它的提示作用。
ok(new Set(notReady.map((k) => op[k])).size === 1 &&
   nofeed.every((k) => op[k] !== op[notReady[0]]),
   `⚠️ 两拨淡得不一样：没配好的 ${notReady[0]} = ${op[notReady[0]]}，只带功能的 ${nofeed[0]} = ${op[nofeed[0]]}`);
ok(dim.every((k) => op[k] > 0.3), '但它们仍然看得见、点得动（不是藏起来）');
// ⚠️ 契约：扇区展开时，栏内核心导航必须**让开**（连点击一起）。
//    这条是量出来的 —— 上一版扇区压在导航上 6/9 格，而截图里只显得"挤"。
const navGone = await p.$eval('#navsections', (e) => { const cs = getComputedStyle(e); return { op: Number(cs.opacity), pe: cs.pointerEvents }; });
ok(navGone.op < 0.05, `展开时核心导航淡出（opacity=${navGone.op}）`);
ok(navGone.pe === 'none', `而且点不到（pointer-events=${navGone.pe}）`);
await p.screenshot({ path: 'out/ui-2-fan.png' });

const rs = await p.$$eval('#fanitems .fani', (e) => e.map((x) => { const r = x.getBoundingClientRect(); return { s: x.dataset.s, x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }));
// ① 相邻不叠：任何两格中心距 ≥ (r1+r2)
let minGap = 1e9, worst = '';
for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
  const d = Math.hypot(rs[i].cx - rs[j].cx, rs[i].cy - rs[j].cy) - (rs[i].w + rs[j].w) / 2;
  if (d < minGap) { minGap = d; worst = rs[i].s + '/' + rs[j].s; }
}
ok(minGap > -3, `瓦片互不重叠（最挤的一对 ${worst} 余量 ${minGap.toFixed(1)}px）`);

// ② 全都在视口内
const outside = rs.filter((r) => r.x < 0 || r.y < 0 || r.x + r.w > 1440 || r.y + r.h > 900);
ok(outside.length === 0, `九格全在视口内（跑出去的：${outside.map((r) => r.s).join(',') || '无'}）`);

// ③ 融合：最近的 + 最靠弧中的，两个条件都要
const btn = await rect('#fanbtn');
const dist = rs.map((r) => ({ s: r.s, d: Math.hypot(r.cx - btn.cx, r.cy - btn.cy), ang: Math.atan2(btn.cy - r.cy, r.cx - btn.cx) * 180 / Math.PI }));
const core = dist.find((d) => d.s === 'blend');
const nearest = dist.slice().sort((a, b) => a.d - b.d)[0];
ok(nearest.s === 'blend', `融合离按钮最近（实得最近的=${nearest.s} ${nearest.d.toFixed(0)}px）`);
ok(Math.abs(core.ang - 45) < 6, `融合正落在扇区中轴 45°（实得 ${core.ang.toFixed(1)}°）`);
const angs = dist.filter((d) => d.s !== 'blend').map((d) => d.ang);
ok(Math.min(...angs) > -8 && Math.max(...angs) < 98, `其余八个都落在这 90° 半区内（${Math.min(...angs).toFixed(0)}°~${Math.max(...angs).toFixed(0)}°）`);

console.log('\n▸ 收回去');
await p.click('#fanbtn');
await p.waitForTimeout(600);
const closed = await p.$$eval('#fanitems .fani', (e) => e.map((x) => Number(getComputedStyle(x).opacity)));
ok(closed.every((o) => o < 0.05), '再点一下全部收回');
const navBack = await p.$eval('#navsections', (e) => { const cs = getComputedStyle(e); return { op: Number(cs.opacity), pe: cs.pointerEvents }; });
ok(navBack.op > 0.95 && navBack.pe !== 'none', `收回去之后导航原样回来（opacity=${navBack.op} / ${navBack.pe}）`);

console.log('\n▸ 货架：默认收起 + 不压内容');
const modes = await rect('#modes');
ok(await vis('#shelfToggle'), '货架药丸在');
const bodyVis = await p.$eval('#shelfbody', (e) => e.getBoundingClientRect().height > 0);
ok(!bodyVis, '默认是收起的（列表不占地方）');
const pr = await rect('#shelfToggle');
const rightHalf = pr.cx > 1440 * 0.5, bottomHalf = pr.cy > 900 * 0.5;
ok(rightHalf && bottomHalf, `货架在右下角（cx=${pr.cx.toFixed(0)} cy=${pr.cy.toFixed(0)}）`);
const overlap = !(pr.x > modes.x + modes.w || pr.x + pr.w < modes.x || pr.y > modes.y + modes.h || pr.y + pr.h < modes.y);
ok(!overlap, '收起的货架和右上角缩略图不重叠');
// ⚠️ 这条是**用户报上来的那个毛病**：货架盖住别的东西。
//    上一版只验了右上角，而它真正压住的是**右下角的语音输入条** —— 漏测的那一侧。
const hit = (a, b) => !(a.x + a.w <= b.x || a.x >= b.x + b.w || a.y + a.h <= b.y || a.y >= b.y + b.h);
for (const [sel, nm] of [['.vbar', '语音输入条'], ['.vfloat .vlog', '语音记录框'], ['.vstate', '状态条']]) {
  const r = await rect(sel);
  ok(!hit(pr, r), `收起的货架不和${nm}打架（球 ${pr.x.toFixed(0)}..${(pr.x + pr.w).toFixed(0)} / 条 ${r.x.toFixed(0)}..${(r.x + r.w).toFixed(0)}）`);
}
await p.click('.thumb[data-m="text"]'); await p.waitForTimeout(350);
const tb = await rect('.tbar');
ok(!hit(pr, tb), '也不和文字输入条打架');
await p.click('.thumb[data-m="voice"]'); await p.waitForTimeout(250);
// 药丸也不能压住正文/主输入
// ⚠️ 2026-10-10：光球换成了**真素材视频**（珍珠玻璃 / 岩石），WebGL 那个 canvas 只在
//    「柠檬绿盘」时才露脸 ⇒ 判据改成"**两者有一个可见**"，不然这条测的是"实现方式"而不是"光球在不在"。
// ⚠️ 2026-10-10 起**默认形态是「CEVTUO 卡片」**（读者：「柠檬绿盘不要了改为 cevtuoforecard，
//    这个作为主选项」）⇒ 三种形态里任一个可见就算数。写死某一种的话，
//    下次换主形态这条又会假红 —— 而它测的本来就不是"用的哪种实现"。
const orbShown = (await vis('#orb'))
  || await p.$eval('#orbvid', (e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 40)
  || await p.$eval('#ck', (e) => getComputedStyle(e.closest('.orbcard')).display !== 'none' && e.getBoundingClientRect().width > 40);
ok(orbShown, '语音光球在（卡片 / 视频 / canvas 任一个可见）');
// ⭐ 卡片的契约：**得真的有厚度**（叠层），不是一张平图 —— 那是读者要求的"像真实的一样"。
const layers = await p.$$eval('#ck i', (e) => e.length);
ok(layers >= 12, `卡片是**叠层**做的厚度（${layers} 层 = 卡面 + 卡背 + 高光 + 10 层卡边）`);
await p.screenshot({ path: 'out/ui-3-shelf.png' });

console.log('\n▸ 两栏收起 → 全铺');
await p.click('#recBtn');
await p.click('#railBtn');
await p.waitForTimeout(400);
ok(!(await vis('#side')), '来源栏收起了');
ok(!(await vis('#dash')), '记录栏收起了');
ok(await vis('#restorebar'), '左上角出现了叫回来的玻璃条');
const main = await rect('.main');
ok(main.w > 1440 * 0.95 && main.x < 40, `内容真的全铺了（宽 ${main.w.toFixed(0)} / 视口 1440，起点 x=${main.x.toFixed(0)}）`);
await p.screenshot({ path: 'out/ui-4-fullbleed.png' });
await p.click('#rsRail'); await p.click('#rsRec');
await p.waitForTimeout(300);
ok(await vis('#side') && await vis('#dash'), '叫得回来');

console.log('\n▸ 玻璃浮层');
const vlogBg = await p.$eval('#vlog', (e) => getComputedStyle(e).backdropFilter || getComputedStyle(e).webkitBackdropFilter);
ok(/blur/.test(vlogBg), `语音的记录框是玻璃（${vlogBg}）`);
await p.click('.thumb[data-m="text"]');
await p.waitForTimeout(400);
const tbarBg = await p.$eval('.tbar', (e) => getComputedStyle(e).backdropFilter || getComputedStyle(e).webkitBackdropFilter);
ok(/blur/.test(tbarBg), `文字的输入条是玻璃（${tbarBg}）`);
await p.screenshot({ path: 'out/ui-5-text.png' });

// ⚠️⚠️ 这一组是**回归**：右上角那三颗模式灯曾经从来不跟着走 ——
//     `show()` 里只 toggle 了 `.nv`（侧栏，data-v），**漏了 `#modes .thumb`（data-m）**，
//     而 app.html 里写死把 `on` 挂在 voice 那颗上 ⇒ **语音永远亮着**。
//     症状看起来像"点了文字/结构流，还是语音被选中"（读者的原话）。
console.log('\n▸ 右上角三颗模式灯跟着走（回归）');
for (const m of ['text', 'flow', 'voice']) {
  await p.click('#modes .thumb[data-m="' + m + '"]');
  await p.waitForTimeout(260);
  const lit = await p.$$eval('#modes .thumb', (es) => es.filter((e) => e.classList.contains('on')).map((e) => e.dataset.m));
  // ⚠️ 判据是**恰好一颗亮、而且是点的那颗**。
  //    只断言"点的那颗亮"会漏掉原始 bug（voice 还亮着 ⇒ 两颗同时亮）。
  ok(lit.length === 1 && lit[0] === m, `点「${m}」之后只有它亮（实得 [${lit.join(',')}]）`);
}

console.log('\n▸ 端口颜色有图例（不用 hover 才猜得出）');
await p.click('#modes .thumb[data-m="flow"]');
await p.waitForTimeout(300);
const lg = await p.$eval('#plegend', (e) => ({ n: e.querySelectorAll('i').length, txt: e.textContent }));
ok(lg.n === 6, `图例列了 6 种端口类型（实得 ${lg.n}）`);
ok(['笔记', '文本', '事件'].every((k) => lg.txt.includes(k)), `图例写了类型名（${lg.txt.slice(0, 46)}…）`);

// ══════════════════════════════════════════════════════════
// 主页面必须能滚（2026-10-09 补的护栏）
//
// ⚠️ 这条是真的坏过：`.kbwrap` 写着 `flex:1;overflow:auto`，但它爸 `#kbmount`
//    没被约束 ⇒ 跟着内容一起长高（实测 1704px），而 `body` 是 `overflow:hidden`
//    ⇒ 多出来的部分**直接被裁掉，滚不动**。内容短的时候完全看不出来。
// 判据是**真的滚一下**（scrollTop 变了），不是"scrollHeight > clientHeight" ——
// 后者在 overflow:visible 时也成立，而那时根本滚不了。
console.log('\n▸ 主页面能滚');
for (const v of ['tax', 'home', 'links']) {
  await p.evaluate((x) => window.__app.show(x), v);
  await p.waitForTimeout(1300);
  const r = await p.evaluate(() => {
    const w = document.querySelector('.kbwrap');
    if (!w) return null;
    w.scrollTop = 99999;
    const moved = w.scrollTop;
    w.scrollTop = 0;
    return { moved, need: w.scrollHeight - w.clientHeight };
  });
  ok(r && (r.need <= 2 ? true : r.moved > 0),
     `「${v}」能滚（内容高出 ${r?.need ?? '?'}px，滚下去 ${r?.moved ?? '?'}px）`);
}

console.log(`\n${pass} 通过 / ${fail} 失败` + (skip ? ` / ${skip} 跳过` : '') + (errs.length ? '\n⚠️ 页面报错: ' + errs.slice(0, 5).join(' ;; ') : '\n✅ 无页面报错'));
await b.close();
process.exit(fail ? 1 : 0);
