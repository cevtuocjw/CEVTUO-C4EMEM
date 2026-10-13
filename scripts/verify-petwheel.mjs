/**
 * 桌面 CEVTUO Pet 的**轮盘**（照 Launchy 1.3.2 重做的那一版）。
 *
 * 为什么另开一个套件（`verify-pet.mjs` 管的是**主窗口里**那个浮层版 Pet）：
 *   这一版是**另一个页面**（`src/ui/pet.html`，活在 Swift 的置顶透明窗里），
 *   几何、命中、键盘全是新写的，而它**没有控制台可看** —— 出问题只能靠这里。
 *
 * ⚠️⚠️ 它盯的是**读者报过的那三件事**，不是"看着还行"：
 *   ① 点击没反馈 ② 点一下别的就乱闪 ③ 右键不进设置
 *   （③ 的那一半在 Swift 侧，见 `app/C4ememApp.swift` 的 `jsWhenApp`；
 *     这一套只能验"桥收到了 settings"这一半。）
 *
 * 判据全部是**契约**（FACT 纪律 15）：
 *   · 「指针压到第 i 个扇区上 ⇒ 中轴写出第 i 个 App 的名字」——
 *     而不是"hub 里有字"。后一种内容对不对都通过。
 *   · 还要加一条**非退化**判据（纪律 6）：不同扇区给出的名字必须**至少有两种**，
 *     否则一个"永远显示同一个名字"的实现照样全绿。
 *
 * 负向对照：`NEGCTL=n bun scripts/verify-petwheel.mjs` —— **把 bug 放回去，确认那几条真的会红**。
 *   `1` = `hitTest` 永远返回 -1（命中那一路坏掉）· `2` = 右键改回"直接开设置" ·
 *   `3` = 按下不再进入拖拽 · **`4` = 方块放大回 12 的边距**（几何契约那两组）·
 *   **`5` = 「Pet 设置…」不再发 `{cmd:settings}`**（⑩.2 那条路）·
 *   **`6` = 摘掉修饰键过滤**（"⌘C 不许切软件"那两条）。
 *   ⚠️ 只动**被测的那一侧**（第 4 条动的是 `pet.html` 的宽度，要还原的就是它），
 *      改完 `finally` 里还原 —— 不还原会留下一个改坏的构建，而**没人会知道**。
 *
 * 跑：env -u HTTPS_PROXY -u https_proxy -u ALL_PROXY -u all_proxy -u HTTP_PROXY -u http_proxy NO_PROXY='*' bun scripts/verify-petwheel.mjs
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const NEGCTL = process.env.NEGCTL === '1';
const PETJS = '/Users/cjw/Documents/Cevtuo-C4emem/src/ui/pet.js';
const BASE = 'http://127.0.0.1:8770';

let pass = 0, fail = 0, skip = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (extra ? '  ' + extra : '')); }
};
const sk = (n, why) => { skip++; console.log('  … 跳过 ' + n + '（' + why + '）'); };

// ── 负向对照：把 bug 放回去，确认那几条断言**真的会红** ──────────────
// ⚠️ 只动**被测的那一侧**，`finally` 里还原。
const NEG = process.env.NEGCTL || '';
const PETH = '/Users/cjw/Documents/Cevtuo-C4emem/src/ui/pet.html';
let backup = null, backupHtml = null;
if (NEG) {
  backup = readFileSync(PETJS, 'utf8');
  let bugged = backup;
  let what = '';
  if (NEG === '1') {
    // 命中永远失败（= 几何那一路坏掉）
    bugged = backup.replace(
      'function hitTest(mx, my) {\n  const L = W.lay;\n  if (!L) return -1;',
      'function hitTest(mx, my) {\n  const L = W.lay;\n  if (L) return -1;\n  if (!L) return -1;');
    what = 'hitTest 永远返回 -1';
  } else if (NEG === '2') {
    // 右键走回"开设置"那条老路（= 读者说"不要这个"的那一版）
    bugged = backup.replace(
      "  if (Q.open) return qClose();\n  qOpen();",
      "  if (Q.open) return qClose();\n  native({ cmd: 'settings' });");
    what = '右键改回"直接叫 Swift 开设置"';
  } else if (NEG === '3') {
    // 拖拽那条路：按下不再进入拖拽状态（= "拖不动"的老样子）
    bugged = backup.replace(
      "  dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; accX = 0; accY = 0;",
      "  dragging = false; moved = 0; lastX = e.clientX; lastY = e.clientY; accX = 0; accY = 0;");
    what = '按下不再开始拖拽';
  } else if (NEG === '4') {
    // ⭐ 2026-10-12 加：**方块放回 12 的边距**（= 修之前那一版）——
    //    几何契约那几条（真实那一组 + 三档夹具那一组）必须**同时红**。
    //    红不了就说明那几条断言没在测几何（"全绿"只是没人让它红过）。
    backupHtml = readFileSync(PETH, 'utf8');
    // ⚠️⚠️ 必须 **两个都换**（width 和 height）：只换 width 会得到 38×30 的方块，
    //    而 38×30 恰好**躲开**那条 AABB 判据（相邻 dy=32 > 30）⇒ 对照**不会红**，
    //    看起来像"断言空跑"（第一次写这条时就这么栽的 —— `String.replace` 只换第一处）。
    const buggedHtml = backupHtml.replace(/calc\(var\(--pwic,28px\) \+ 4px\)/g, 'calc(var(--pwic,28px) + 12px)');
    if (!/\+ 12px\)/.test(buggedHtml) || (buggedHtml.match(/\+ 12px\)/g) || []).length < 2) {
      console.log('负向对照 4：只换到一处（宽/高没换全）⇒ 对照不成立，退出'); process.exit(2);
    }
    if (buggedHtml === backupHtml) { console.log('负向对照 4：锚点没匹配上 ⇒ 对照没生效，退出'); process.exit(2); }
    writeFileSync(PETH, buggedHtml);
  } else if (NEG === '5') {
    // ⭐ 2026-10-12 加：面板底部那颗「Pet 设置…」**不再叫 Swift 开设置** ——
    //    ⑩.2 那三条必须红。
    bugged = backup.replace(
      "$('#pwqset').onclick = () => { qClose(); native({ cmd: 'settings' }); };",
      "$('#pwqset').onclick = () => { qClose(); };");
    what = '「Pet 设置…」不再发 {cmd:settings}';
  } else if (NEG === '6') {
    // ⭐ 2026-10-12 加：把**修饰键过滤**摘掉（= 修之前那一版）——
    //    "⌘C 不许切软件"那两条必须红。
    bugged = backup.replace(
      '  if (e.metaKey || e.ctrlKey || e.altKey) {',
      '  if (false && (e.metaKey || e.ctrlKey || e.altKey)) {');
    what = '修饰键过滤被摘掉（⌘C 会被当成字母）';
  }
  if (NEG !== '4') {
    if (bugged === backup) { console.log('负向对照：锚点没匹配上 ⇒ 对照没生效，退出'); process.exit(2); }
    writeFileSync(PETJS, bugged);
  }
  console.log('⚠️ 负向对照 ' + NEG + '：已把「' + (NEG === '4' ? '方块放大回 12 的边距' : what) + '」放回去（跑完会还原）\n');
}

// ⚠️ 视口**必须和 Swift 那个窗一样大**（`kPetIdle` / `kPetRing` 都是 440×520）——
//    窗一旦比视口大/小，"页面坐标 ↔ 窗口坐标"就对不上，而那正是上一版"乱闪"的根因。
//    这里不写死 420×500 那种"差不多"的数：要写就跟 `C4ememApp.swift` 里那两个常量一致。
const VW = 440, VH = 520;
const br = await chromium.launch();
const p = await br.newPage({ viewport: { width: VW, height: VH } });
const errs = [], bad = [], activated = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
// ⚠️ `/api/appicon` 的 404 是**正常情况**（有些 App 的图标只活在 Assets.car 里，
//    `sips` 取不到）—— 产品那边退成首字母。所以它不进"坏请求"，
//    而是单列一条断言"每一格都**看得见东西**"（见下面 ②）。
p.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('/api/client-log') && !r.url().includes('/api/appicon')) {
    bad.push(r.status() + ' ' + r.url());
  }
});
// ⚠️ 真的去 activate 会把读者的软件来回切 —— 拦下来只记路径
await p.route('**/api/apps/activate', async (route) => {
  try { activated.push(JSON.parse(route.request().postData() || '{}').path); } catch { activated.push('?'); }
  await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
});

/** 中轴那一行写的是什么 */
const hub = () => p.$eval('#pwhub', (e) => e.textContent.trim());
/** 原生桥那一侧都收到了什么（页面里那个桩记的） */
const bridgedNow = () => p.evaluate(() => (window.__bridge || []).slice());
/**
 * 打开一个软件**发出去的是什么**。
 * ⚠️ 2026-10-11 起有**两条路**：有原生桥走 `{cmd:'launch'}`（进程内，几毫秒），
 *    没桥才走 HTTP `/api/apps/activate`。上面那个 `activated` 数组只看得见**第二条**，
 *    所以"点了有没有发出去"必须**两边都看**，否则断言的是一条已经不走的路（假红/假绿都可能）。
 */
const launchedViaBridge = async () => {
  const ms = await bridgedNow();
  return ms.filter((m) => m && m.cmd === 'launch').map((m) => m.path);
};
/** 每个扇区图标的**屏幕坐标**（从 inline transform 里读出来，不写死）*/
const segPts = () => p.evaluate(() => {
  const r = document.querySelector('#pet').getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  return [...document.querySelectorAll('#pwwheel .pwic')].map((el) => {
    const m = el.getAttribute('style').match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    return { i: Number(el.dataset.i), x: cx + Number(m[1]), y: cy + Number(m[2]) };
  });
});
const petCenter = () => p.evaluate(() => {
  const r = document.querySelector('#pet').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
/** 把"鼠标位置"喂给页面（Swift 那条定时器走的就是这个口） */
const feed = (x, y) => p.evaluate(([a, b]) => window.__petMouse(a, b), [x, y]);
/**
 * 把指针放到 Pet 上并**等它真的开**。
 * ⚠️ 不能"喂一下、sleep 200ms、就当它开了" —— 切完一个 App 之后有 **1.2 秒冷却**
 *    （不许立刻弹回来，见 pet.js 里那段注释），死等就会假红。
 */
const ensureOpen = async (c) => {
  // ⚠️ 先**离开一下**：手动关掉（Esc / 点宠物收回）之后有一道门闩（`parked`），
  //    要"走开再回来"才允许重开 —— 不先走开就会永远等不到，假红。
  await feed(c.x - 400, c.y - 400);
  await p.waitForTimeout(60);
  for (let i = 0; i < 40; i += 1) {
    if (await p.evaluate(() => document.body.classList.contains('pw-on'))) return true;
    await feed(c.x, c.y);
    await p.waitForTimeout(120);
  }
  return false;
};

try {
  await p.goto(BASE + '/ui/pet.html', { waitUntil: 'load' });
  await p.waitForFunction(() => !!window.__petMouse, null, { timeout: 8000 });
  ok('页面装起来了（__petMouse 存在）', true);

  // ⭐ 全程把"网页 → 原生桥"换成**记事情的桩**：这样"拖动了没有""右键走没走 settings"
  //    都变成可断言的事实，而不是"看着像动了"。
  //    ⚠️ 这一步也顺手替掉了原来那段临时的 ⑨ 桩（两处各打一个桩迟早会漂）。
  await p.evaluate(() => {
    window.__bridge = [];
    window.webkit = { messageHandlers: { c4: { postMessage: (m) => window.__bridge.push(m) } } };
  });

  // ── ① 靠过去就开 / 位置就是 Pet 的中心 ─────────────────────
  const c = await petCenter();
  ok('Pet 的中心落在窗口里（没被挤出可视区）',
    c.x > 40 && c.x < VW - 8 && c.y > 40 && c.y < VH - 8, JSON.stringify(c));
  await feed(c.x + 400, c.y + 400);            // 先离远
  ok('离得远时是收着的', !(await p.evaluate(() => document.body.classList.contains('pw-on'))));
  await feed(c.x, c.y);
  await p.waitForTimeout(150);
  ok('鼠标靠到 Pet 上 ⇒ 轮盘弹出', await p.evaluate(() => document.body.classList.contains('pw-on')));
  // ⭐⭐ 读者 2026-10-11：「**必须点击一下这个球才能锁定它**，然后快捷键才管用……
  //    我的目标是鼠标放上去展开了这些应用，然后就按字母就能打开」。
  //    ⇒ 判据是"**展开的那一刻**就向原生要了键盘焦点"（不是"点过之后才要"）。
  ok('悬停展开的那一刻就去要键盘焦点了（不用先点一下）',
    (await bridgedNow()).some((m) => m && m.cmd === 'focus'));

  // ── ② 扇区画出来了，而且**个数对得上** ────────────────────
  await p.waitForFunction(() => document.querySelectorAll('#pwwheel .pwsg').length > 0, null, { timeout: 6000 });
  const drawing = await p.evaluate(() => ({
    segs: document.querySelectorAll('#pwwheel .pwsg').length,
    icons: document.querySelectorAll('#pwwheel .pwic').length,
    d0: document.querySelector('#pwwheel .pwsg')?.getAttribute('d') || '',
    more: document.querySelector('#pwmore').textContent.trim(),
  }));
  ok('扇区画出来了', drawing.segs > 0, JSON.stringify(drawing.segs));
  ok('每个扇区都有一个图标', drawing.icons === drawing.segs, drawing.icons + ' vs ' + drawing.segs);
  ok('扇区的 path 是真环带（有弧、有内圈）',
    /^M[-\d.]+ [-\d.]+A\d+.+A\d+/.test(drawing.d0), drawing.d0.slice(0, 46));
  // ⭐ 「每一格都看得见东西」：要么图标真的解出来了，要么退成了首字母。
  //    ⚠️ 光数 `.pwic` 有多少个是**测不到东西**的（元素在、里面是空的照样算过）。
  const vis = await p.evaluate(() => {
    const out = { icon: 0, mono: 0, blank: [] };
    for (const el of document.querySelectorAll('#pwwheel .pwic')) {
      const im = el.querySelector('img');
      const mo = el.querySelector('.pwmono');
      const iconOk = im && im.style.display !== 'none' && im.complete && im.naturalWidth > 0;
      const monoOk = mo && mo.style.display !== 'none' && mo.offsetParent !== null;
      if (iconOk) out.icon++; else if (monoOk) out.mono++;
      else out.blank.push(el.dataset.i);
    }
    return out;
  });
  ok('每一格都看得见东西（图标，或退成的首字母）',
    vis.blank.length === 0, '图标 ' + vis.icon + ' / 首字母 ' + vis.mono + ' / 空的 ' + JSON.stringify(vis.blank));

  // ⭐⭐ 几何契约：「靠得近」把半径收小之后，**反面就是互相压住**。
  //    ⚠️ 这一条是 2026-10-11 加断言的原因：读者说"太分散"，我把内圈从 97 收到 84、
  //       `PER_RING` 从 5 提到 6 —— 而"弦长 ≥ 方块宽"这件事**没有任何断言在盯**，
  //       再改小一点就会两块叠在一起，而"叠在一起"在截图里看着还挺正常。
  const boxes = await p.evaluate(() => {
    const r = document.querySelector('#pet').getBoundingClientRect();
    return [...document.querySelectorAll('#pwwheel .pwic')].map((el) => {
      const b = el.getBoundingClientRect();
      return { i: Number(el.dataset.i), l: b.left, t: b.top, r: b.right, b: b.bottom };
    });
  });
  const overlaps = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const A = boxes[i], B = boxes[j];
      if (A.l < B.r - 1 && B.l < A.r - 1 && A.t < B.b - 1 && B.t < A.b - 1) overlaps.push(A.i + '↔' + B.i);
    }
  }
  ok('方块之间**不重叠**（靠得近不等于挤在一起）', overlaps.length === 0, overlaps.join(' '));
  const outside = boxes.filter((b) => b.l < -0.5 || b.t < -0.5 || b.r > VW + 0.5 || b.b > VH + 0.5);
  ok('每一块都完整落在窗口里（出窗 = 看不见 = 点不到）', outside.length === 0,
    JSON.stringify(outside.map((b) => b.i)));

  // ⭐ 非退化（纪律 6）：扇区不能全叠在同一个角度上（那会是一条线）
  const distinct = await p.evaluate(() => {
    const set = new Set([...document.querySelectorAll('#pwwheel .pwic')]
      .map((e) => (e.getAttribute('style').match(/translate\(([-\d.]+)px/) || [])[1]));
    return set.size;
  });
  ok('扇区是**散开**的，不是全叠在一个角度上（非退化）', distinct >= 2, '不同的 x 有 ' + distinct + ' 个');

  // ── ③ 命中：压到第 i 个扇区 ⇒ 中轴写第 i 个 App 的名字 ─────
  const pts = await segPts();
  const names = [];
  // 每一格对应的 .app 路径（从图标的 src 里读出来 —— 不写死任何路径）
  const paths = await p.evaluate(() => [...document.querySelectorAll('#pwwheel .pwic')].map((el) => {
    const s = el.querySelector('img')?.getAttribute('src') || '';
    return decodeURIComponent(s.split('path=')[1] || '');
  }));
  for (const pt of pts) {
    await feed(pt.x, pt.y);
    await p.waitForTimeout(30);
    const h = await hub();
    names.push(h);
    const onCount = await p.evaluate(() => document.querySelectorAll('#pwwheel .pwsg.on').length);
    ok('压到第 ' + pt.i + ' 个扇区：中轴写出它的名字（不是"选一个…"）', h !== '选一个…' && h.length > 0, '→ ' + h);
    ok('压到第 ' + pt.i + ' 个扇区：**只有一个**亮着', onCount === 1, '亮着 ' + onCount + ' 个');
  }
  ok('不同扇区给出**不同**的名字（不是在显示同一个）',
    new Set(names).size >= Math.min(2, pts.length), names.slice(0, 4).join(' / '));

  // ── ④ 点扇区 = 切过去（读者报的"点击没反馈"）──────────────
  activated.length = 0;
  const target = pts[pts.length - 1];
  const wantPath = paths[paths.length - 1];
  await p.evaluate(() => { window.__bridge.length = 0; });
  await p.mouse.click(target.x, target.y);
  await p.waitForTimeout(220);
  const viaBridge = await launchedViaBridge();
  ok('点扇区真的发出去了（原生桥那条）', viaBridge.length === 1, '发了 ' + viaBridge.length + ' 次');
  ok('切的是**被点的那一个**（按路径比，不是按名字猜）', viaBridge[0] === wantPath,
    viaBridge[0] + ' vs ' + wantPath);
  ok('切完轮盘自己收起（默认）', !(await p.evaluate(() => document.body.classList.contains('pw-on'))));
  // ⭐ 没有原生桥的时候（浏览器 / 网页版）必须**退回 HTTP** ——
  //    否则"在浏览器里点了没反应"，而那条路是网页版唯一的活路。
  await ensureOpen(c);
  await p.evaluate(() => { window.webkit = undefined; });
  activated.length = 0;
  await p.mouse.click(target.x, target.y);
  await p.waitForTimeout(300);
  ok('没有原生桥时退回 HTTP /api/apps/activate', activated.length === 1, '发了 ' + activated.length + ' 次');
  await p.evaluate(() => {
    window.__bridge = [];
    window.webkit = { messageHandlers: { c4: { postMessage: (m) => window.__bridge.push(m) } } };
  });
  // ⭐⭐ 切完**不许马上又弹回来** —— 指针还停在宠物身上，不设冷却的话
  //    它会立刻重开，读者看到的正是「点了没反应 + 它自己乱闪」。
  await feed(c.x, c.y);
  await p.waitForTimeout(300);
  ok('切完 0.3 秒内不会自己又弹回来（冷却生效）',
    !(await p.evaluate(() => document.body.classList.contains('pw-on'))));

  // ── ⑤ A–Z：角上那个字母**直接切**（Launchy 的招牌）────────
  ok('冷却过了以后靠过去还能开', await ensureOpen(c));
  await p.waitForFunction(() => document.querySelectorAll('#pwwheel .pwic .pwkk').length > 0, null, { timeout: 4000 });
  const kk = await p.evaluate(() => {
    const el = document.querySelector('#pwwheel .pwic .pwkk');
    const s = el.closest('.pwic').querySelector('img')?.getAttribute('src') || '';
    return { letter: el.textContent.trim(), path: decodeURIComponent(s.split('path=')[1] || ''), i: Number(el.closest('.pwic').dataset.i) };
  });
  await p.evaluate(() => { window.__bridge.length = 0; });
  await p.keyboard.press(kk.letter);
  await p.waitForTimeout(200);
  const byKey = await launchedViaBridge();
  ok('敲角上那个字母 ' + kk.letter + ' ⇒ 直接切过去（不用鼠标、不用点）', byKey.length === 1, '发了 ' + byKey.length + ' 次');
  ok('切过去的是**那个字母对应的那个** App', byKey[0] === kk.path, byKey[0] + ' vs ' + kk.path);
  // ⭐⭐ **第二条通路**：原生的本地按键监视器直接调 `__petKey`（不经过网页的 keydown）。
  //    ⚠️ 存在的理由：网页那条要"App 活动 / 窗口 key / 网页是 first responder / 网页有焦点"
  //      四件同时成立，任何一件没到位都是**静默失灵**（读者就撞上了）。
  //      两条路都要有断言 —— 只测一条，另一条坏了没人知道。
  await ensureOpen(c);
  const letter2 = await p.evaluate(() => {
    const el = document.querySelector('#pwwheel .pwic .pwkk');
    const L = el.textContent.trim();
    window.__bridge.length = 0;
    window.__petKey(L);
    return L;
  });
  await p.waitForTimeout(200);
  ok('原生那条通路（__petKey ' + letter2 + '）也能切过去',
    (await launchedViaBridge()).length === 1, '发了 ' + (await launchedViaBridge()).length + ' 次');
  // ⭐⭐ 带修饰键的字母**不许**开软件：轮盘是"悬停展开 + 当场抢键盘焦点"的，
  //    用户在别处按 ⌘C / ⌘F 的那一下会落到这一页。原生那条监视器已经过滤修饰键了，
  //    网页这条路曾经漏了（2026-10-12 真机日志：`key="Meta"` 紧跟 `key="c"` ⇒ 叫起了 Chrome）。
  ok('再开一次（验修饰键）', await ensureOpen(c));
  await p.evaluate(() => { window.__bridge.length = 0; });
  await p.keyboard.press('Meta+c');
  await p.waitForTimeout(220);
  ok('⌘C 落进来时**不切软件**（那是用户自己的快捷键，不是"按住字母开软件"）',
    (await launchedViaBridge()).length === 0, '发了 ' + (await launchedViaBridge()).length + ' 次');
  ok('⌘C 之后轮盘还开着（没被当成一次选择）',
    await p.evaluate(() => document.body.classList.contains('pw-on')));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(120);

  // ── ⑥ 打字 = 筛选（Launchy 的 RadialMenuSearchCoordinator）─
  ok('再开一次（冷却过后）', await ensureOpen(c));
  const all = (await p.$$('#pwwheel .pwsg')).length;
  // ⚠️⚠️ 原来这里是 `p.keyboard.type('st')` —— **那是一条运气断言**：
  //    `handleKey` 的契约是「**A–Z 里"有主"的字母直接切走，不筛选**」，
  //    所以按 's' 只有在"这一屏没有哪个 App 分了 S"时才轮到筛选。
  //    今天恰好没有 S（所以它绿了）；哪天多开一个 Safari 就**永远红** ——
  //    而它看起来像"筛选坏了"，其实是我把契约理解错了。
  //    ⇒ 判据改成**契约**：从页面上读出**已经分掉的字母**，敲一个**没分掉的**。
  const taken = await p.evaluate(() => [...document.querySelectorAll('#pwwheel .pwic .pwkk')]
    .map((e) => e.textContent.trim()));
  const free = 'ZQJXKVWY'.split('').find((ch) => !taken.includes(ch)) || 'Z';
  await p.keyboard.press(free);
  await p.waitForTimeout(180);
  const filtered = await p.evaluate(() => ({
    n: document.querySelectorAll('#pwwheel .pwsg').length,
    more: document.querySelector('#pwmore').textContent.trim(),
    on: document.body.classList.contains('pw-on'),
  }));
  ok('敲一个**没分给任何 App** 的字母 ' + free + ' ⇒ 走的是筛选（扇区被筛掉，不是"没反应"）',
    filtered.on && filtered.n < all, all + ' → ' + filtered.n + '（已分掉：' + taken.join('') + '）');
  ok('筛完照实说"筛出 N / M"（不静默截断）', /筛出/.test(filtered.more), filtered.more);
  // ⭐ 契约的另一半：一旦筛起词来（`q` 非空），**有主的字母也不再抢**，继续筛 ——
  //    不然后面敲的每一个字母都会变成"又切走了某个软件"（那就没法输第二个字母了）。
  await p.keyboard.press(taken[0] || 'A');
  await p.waitForTimeout(160);
  const filtered2 = await p.evaluate(() => ({
    n: document.querySelectorAll('#pwwheel .pwsg').length,
    src: document.querySelector('#pwsrc').textContent,
    on: document.body.classList.contains('pw-on'),
  }));
  ok('已经筛着词的时候，有主的字母 ' + (taken[0] || 'A') + ' 不再抢（继续筛，不是又切软件）',
    filtered2.on && filtered2.n <= filtered.n, filtered.n + ' → ' + filtered2.n);
  ok('筛的是什么**当场看得见**（药丸上写着）', /筛/.test(filtered2.src), filtered2.src.trim());
  await p.keyboard.press('Escape');

  // ── ⑦ 来源药丸：正在运行 ↔ 全部应用（"多软件打开"）────────
  ok('第三次打开', await ensureOpen(c));
  const runN = (await p.$$('#pwwheel .pwsg')).length;
  const chipBefore = await p.$eval('#pwsrc', (e) => e.textContent.trim());
  await p.click('#pwsrc');
  await p.waitForTimeout(600);
  const chipAfter = await p.$eval('#pwsrc', (e) => e.textContent.trim());
  const allN = Number((chipAfter.match(/·\s*(\d+)/) || [])[1] || 0);
  ok('药丸换了来源（文字跟着变）', chipAfter !== chipBefore, chipBefore + ' → ' + chipAfter);
  ok('"全部应用"里真的比"正在运行"多', allN > runN, runN + ' → ' + allN);
  // 全部应用有 100+，轮盘只画得下 12 个 ⇒ 必须**说出来**
  const moreAll = await p.$eval('#pwmore', (e) => e.textContent.trim());
  ok('画不下的那些有交代（不是静默丢弃）', moreAll.length > 0 && /\d/.test(moreAll), moreAll);

  // ── ⑧ Esc / 走远 ⇒ 收起 ────────────────────────────────────
  await p.keyboard.press('Escape');
  await p.waitForTimeout(120);
  ok('Esc 收起', !(await p.evaluate(() => document.body.classList.contains('pw-on'))));
  // ⭐⭐ 手动关掉之后**不许被悬停立刻弹回来** —— 指针本来就还停在它身上，
  //    没有门闩的话下一个 `__petMouse`（50ms 后）就又开了 ⇒ 屏幕上一闪。
  await feed(c.x, c.y);
  await p.waitForTimeout(450);
  ok('Esc 之后指针还停在它身上也不会自己弹回来（门闩生效）',
    !(await p.evaluate(() => document.body.classList.contains('pw-on'))));
  await ensureOpen(c);          // 走开再回来 ⇒ 又能开
  ok('走开再回来 ⇒ 又能开（不是被永久锁死）', true);
  await feed(c.x - 300, c.y - 300);
  await p.waitForTimeout(1100);
  ok('鼠标走远 ⇒ 自己收起（不会永远挂在桌上）',
    !(await p.evaluate(() => document.body.classList.contains('pw-on'))));

  // ── ⑨ 拖得动（读者报的「拖动卡片不动」）────────────────────
  // ⚠️⚠️ 这条盯的是**桥里有没有 `drag`**，不是"看着挪了没有"。
  //    真机上的那次故障是：非 key 窗口的第一次鼠标按下被 AppKit 吞掉
  //    ⇒ `pointerdown` 从来没发生 ⇒ 后面一路 pointermove 全被
  //    `if (!dragging) return` 挡掉 ⇒ **零条 drag**，而画面上什么都看不出来。
  //    （原生那一半的修法是 `PetWebView.acceptsFirstMouse`，浏览器里测不到；
  //      这里测的是网页这一半：按下→移动**确实**会发位移。）
  await p.evaluate(() => { window.__bridge.length = 0; });
  const c2 = await petCenter();
  await p.mouse.move(c2.x, c2.y);
  await p.mouse.down();
  await p.mouse.move(c2.x - 60, c2.y - 50, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(120);
  const dragMsgs = (await bridgedNow()).filter((m) => m && m.cmd === 'drag');
  const dragSum = dragMsgs.reduce((s, m) => s + m.dx, 0);
  ok('拖着 Pet 走 ⇒ 桥里真的收到 drag 位移（>0 条）', dragMsgs.length > 0, dragMsgs.length + ' 条');
  ok('位移是**真的往左**（不是一堆 0）', dragSum < -20, 'Σdx=' + dragSum);
  await p.waitForTimeout(150);

  // ── ⑩ 右键 = 运行中清单（勾选 → 批量退出）──────────────────
  // 读者：「右键**不要是打开设置了**，是一个勾选列表，可以勾选然后点 delete 就都退出掉」。
  await p.evaluate(() => { window.__bridge.length = 0; });
  await p.evaluate(() => document.querySelector('#pet')
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  // ⚠️ 等条件也要**有上限、而且不许把整条套件带走** ——
  //    写成 `await waitForFunction(...)` 的话，面板没开就是**抛异常**，
  //    后面几十条断言全都不跑了（"跑不起来"淹掉了真正的红）。实测 NEGCTL=2 就是这样。
  const panelOpened = await p.waitForFunction(() => document.body.classList.contains('pwq-on'), null, { timeout: 5000 })
    .then(() => true).catch(() => false);
  ok('右键弹出的是**清单面板**（不是设置）', panelOpened);
  ok('右键**不再**去叫 Swift 开设置', !(await bridgedNow()).some((m) => m && m.cmd === 'settings'));
  if (!panelOpened) {
    sk('清单面板那一组（列出/勾选/退出）', '面板没打开 —— 上面那条已经红了');
  } else {
    await p.waitForFunction(() => document.querySelectorAll('#pwqlist .pwqrow').length > 0, null, { timeout: 6000 }).catch(() => {});
    const rows = await p.$$eval('#pwqlist .pwqrow input', (e) => e.map((x) => x.dataset.p));
    ok('清单里列出了正在运行的软件', rows.length > 0, rows.length + ' 个');
    ok('每一行都是可勾选的', rows.every((x) => x && x.endsWith('.app')), rows[0] || '');
    // ⚠️ 一个都没勾的时候**不能**让"退出"能点（那会变成"全退"）
    ok('没勾任何东西时「退出勾选的」是禁用+置灰的',
      await p.$eval('#pwqgo', (e) => e.disabled && /退出勾选的$/.test(e.textContent.trim())));
    await p.click('#pwqall');
    ok('「全选」把每一行都勾上',
      await p.$$eval('#pwqlist .pwqrow input', (e) => e.every((x) => x.checked) && e.length > 0));
    ok('勾上之后按钮写出数量（不会让人猜要退几个）',
      await p.$eval('#pwqgo', (e) => /退出勾选的\s*\d+\s*个/.test(e.textContent)), await p.$eval('#pwqgo', (e) => e.textContent.trim()));
    await p.click('#pwqnone');
    // 只勾一个 → 点退出 → 看**发出去的是不是那一个**
    await p.click('#pwqlist .pwqrow:nth-child(2) input');
    const wantPath = rows[1];
    let sentBody = null;
    await p.route('**/api/apps/quit', async (route) => {
      sentBody = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"done":[],"failed":[]}' });
    });
    await p.click('#pwqgo');
    await p.waitForTimeout(400);
    ok('点了「退出勾选的」会真的发出去', !!sentBody, String(sentBody));
    ok('发出去的就是**勾中的那一个**', sentBody && sentBody.paths && sentBody.paths.length === 1 && sentBody.paths[0] === wantPath,
      JSON.stringify(sentBody) + ' vs ' + wantPath);
    ok('退完会**照实**说退没退成（不是把请求当成结果）',
      await p.$eval('#pwqmsg', (e) => /退了\s*0\s*个/.test(e.textContent)), await p.$eval('#pwqmsg', (e) => e.textContent.trim()));
    await p.keyboard.press('Escape');
    await p.waitForTimeout(120);
    ok('Esc 关掉清单面板', !(await p.evaluate(() => document.body.classList.contains('pwq-on'))));
  }
  ok('面板关掉之后轮盘还能正常用', await ensureOpen(c));

  // ── ⑩.2 设置那条路（读者点名"上一轮没验证过"的那一条）────────
  // ⚠️ 这一段盯的是**入口还在不在**：右键改成清单之后，设置挪到面板底部那颗
  //    「Pet 设置…」按钮上 —— 而此前**没有任何断言**盯着它（只测了"右键**不再**开设置"，
  //    那是"没做"；"做了没有"这半边是空的）。
  // ⚠️ Swift 那半边（`case "settings"` → `openUI()` + `jsWhenApp("…openPetSettings()")`）
  //    浏览器里测不到，只能靠真机跑一遍；这里管的是网页这半边。
  await p.evaluate(() => document.querySelector('#pet')
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  const q2 = await p.waitForFunction(() => document.body.classList.contains('pwq-on'), null, { timeout: 5000 })
    .then(() => true).catch(() => false);
  if (!q2) sk('设置那条路（面板底部的「Pet 设置…」）', '清单面板没打开');
  else {
    ok('清单面板底部有「Pet 设置…」（设置没被删掉，只是挪了位置）',
      await p.$eval('#pwqset', (e) => /设置/.test(e.textContent)),
      await p.$eval('#pwqset', (e) => e.textContent.trim()));
    await p.evaluate(() => { window.__bridge.length = 0; });
    await p.click('#pwqset');
    await p.waitForTimeout(220);
    const sent = await bridgedNow();
    ok('点它 ⇒ 桥里收到 {cmd:settings}（Swift 据此开抽屉并滚到 Pet 那一段）',
      sent.some((m) => m && m.cmd === 'settings'), JSON.stringify(sent.map((m) => m && m.cmd)));
    ok('点完面板自己收起来（不然设置抽屉被它盖着）',
      !(await p.evaluate(() => document.body.classList.contains('pwq-on'))));
  }

  // ── ⑩.5 快捷键那条路：钉住（指针走远也不收）──────────────
  // 读者：「**全电脑不选中这个球**，我希望 C 和 4 这个组合键就能让 cevtuopet 调用了」。
  // ⚠️ 焦点开出来的轮盘必须**钉住** —— 手指在键盘上时鼠标可能在屏幕另一头，
  //    不钉住的话它开出来不到一秒就自己没了（而"没了"看起来像"快捷键没反应"）。
  await p.evaluate(() => { window.__bridge.length = 0; });
  await p.evaluate(() => window.__petOpen && window.__petOpen());
  await p.waitForTimeout(250);
  ok('快捷键能把轮盘叫出来', await p.evaluate(() => document.body.classList.contains('pw-on')));
  await feed(c.x - 1400, c.y - 1400);
  await p.waitForTimeout(900);
  ok('快捷键开出来的轮盘**钉住**：指针在屏幕另一头也不收',
    await p.evaluate(() => document.body.classList.contains('pw-on')));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  ok('Esc 之后收起（钉住不是"关不掉"）', !(await p.evaluate(() => document.body.classList.contains('pw-on'))));

  // ── ⑩.9 几何契约：**三档大小 × 12 格（= CAP，最挤的那一档）**用夹具钉死 ────
  // ⚠️⚠️ 上面那条"方块不重叠"吃的是**真实** `/api/running` —— 今天这台机器恰好开着 15 个
  //    （画满 12 格）才覆盖到最坏情况；哪天只开 8 个 ⇒ `per` 从 6 掉到 5、弦长变宽
  //    ⇒ **那条断言会静默地不再测最挤的布局**（"全绿"读起来像"验过了"）。
  //    2026-10-12 就是靠这条把 12 格时的真重叠（11.1×6.0 px）抓出来的。
  // ⚠️ 只动**这个无头浏览器**的 localStorage 和路由，碰不到读者真机上的偏好。
  const CAPFIX = 12;
  await p.route('**/api/running', (r) => r.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      apps: Array.from({ length: CAPFIX }, (_, i) => ({
        name: 'Fixture ' + String.fromCharCode(65 + i),
        path: '/Applications/Fixture' + (i + 1) + '.app',
      })),
    }),
  }));
  for (const size of ['s', 'm', 'l']) {
    await p.evaluate((sz) => localStorage.setItem('c4emem.pet', JSON.stringify({ on: true, size: sz })), size);
    await p.reload({ waitUntil: 'load' });
    await p.waitForFunction(() => !!window.__petMouse, null, { timeout: 8000 });
    await p.evaluate(() => {
      window.__bridge = [];
      window.webkit = { messageHandlers: { c4: { postMessage: (m) => window.__bridge.push(m) } } };
    });
    const cc = await petCenter();
    await p.evaluate(([a, b]) => window.__petMouse(a, b), [cc.x, cc.y]);
    const up = await p.waitForFunction(() => document.body.classList.contains('pw-on'), null, { timeout: 6000 })
      .then(() => true).catch(() => false);
    ok(size + ' 档 · 靠过去能把轮盘打开（夹具 12 格）', up);
    // ⚠️ 打不开时**照样量**（量到空集合 → 下面两条会自己红），不要 `if` 包起来静默跳过
    const g = await p.evaluate(() => {
      const bx = [...document.querySelectorAll('#pwwheel .pwic')].map((el) => {
        const b = el.getBoundingClientRect();
        return { i: Number(el.dataset.i), l: b.left, t: b.top, r: b.right, b: b.bottom };
      });
      const ov = [];
      for (let i = 0; i < bx.length; i += 1) {
        for (let j = i + 1; j < bx.length; j += 1) {
          const A = bx[i], B = bx[j];
          if (A.l < B.r - 1 && B.l < A.r - 1 && A.t < B.b - 1 && B.t < A.b - 1) ov.push(A.i + '↔' + B.i);
        }
      }
      const out = bx.filter((x) => x.l < -0.5 || x.t < -0.5 || x.r > innerWidth + 0.5 || x.b > innerHeight + 0.5);
      return { n: bx.length, ov, out: out.map((x) => x.i) };
    });
    ok(size + ' 档 · 12 格全都画出来了', g.n === CAPFIX, '画了 ' + g.n + ' 格');
    ok(size + ' 档 · 方块两两不重叠（最挤的那一档真的有断言在盯）', g.ov.length === 0, g.ov.join(' '));
    ok(size + ' 档 · 每一块都完整落在窗里', g.out.length === 0, JSON.stringify(g.out));
    await p.keyboard.press('Escape');
    await p.waitForTimeout(120);
  }
  await p.unroute('**/api/running');

  // ── ⑪ 环境 ────────────────────────────────────────────────
  ok('没有 404 / 坏请求', bad.length === 0, bad.slice(0, 3).join(' | '));
  // ⚠️ 两种是**已知且无害**的，不算报错：① 浏览器里没有原生桥（这条套件本来就在浏览器跑）
  //    ② 图标 404 的那条控制台噪声（浏览器自己打的，不带 URL）——
  //    真正的 404 由上面那条**带 URL 的**坏请求断言盯着，所以这里滤掉不会漏东西。
  const real = errs.filter((e) => !/native 桥不存在/.test(e) &&
    !/^console: Failed to load resource: the server responded with a status of 404/.test(e));
  ok('没有页面报错', real.length === 0, real.slice(0, 2).join(' | '));
} catch (e) {
  fail++; console.log('  ✗ 跑不起来：' + e.message);
} finally {
  await br.close();
  if (backup != null) { writeFileSync(PETJS, backup); console.log('（负向对照已还原 pet.js）'); }
  if (backupHtml != null) { writeFileSync(PETH, backupHtml); console.log('（负向对照已还原 pet.html）'); }
}

console.log(`\n${pass}/${pass + fail} 通过${skip ? '，跳过 ' + skip : ''}`);
process.exit(fail ? 1 : 0);
