/**
 * **桌面那个 CEVTUO Pet** —— `pet.html` 用的脚本。
 *
 * ⭐⭐ 2026-10-10 深夜**按 Launchy（com.heavylightapps.Launchy 1.3.2）重做**。
 *    读者原话：「你学习 Launchy 1.3.2 来做这个 cevtuopet 那个**多软件打开**的那个功能，强制要求」。
 *
 * ── 从 Launchy 里学来的那个模型（反编译它的字符串表看出来的）──────────────
 *   它叫自己 "Wheel launcher（轮盘启动器）"，核心就这几件事，这一版**照搬**：
 *   ① **扇区（segment）不是一个一个圆点**：`RadialSegment` / `RadialSegmentBackground`
 *      —— 一圈连续的环带，每个 App 占**一个扇区**。悬停 → 该扇区高亮、中心给出预览
 *      (`RadialMenuPreviewSection`)。这比"十几个圆点飘在外面"稳得多：圆点之间有空隙，
 *      指针穿过空隙时会出现"什么都没有"的那一下，看起来就是**闪**。
 *   ② **命中是按"角度 + 半径"算的**（它的设置项叫 `Selection distance` / `Selection tolerance`）
 *      —— 不是靠 DOM 的 :hover。所以指针只要在那个扇区的角度范围里就一定选中，
 *      不会因为两个元素挨着而抖。
 *   ③ **A–Z 直接切**：它的卖点原话 "Power user keyboard shortcuts (A-Z) for instant app switching"。
 *      每个扇区角上一个字母，敲字母**立刻切过去**。
 *   ④ **"我的应用" 与 "运行中" 是两个来源**：`Running apps` / `My other apps` / `User-defined apps`
 *      —— 读者要的「**多软件打开**」正是指这个：不只是"已经开着的"，而是"能开的都在这儿"。
 *   ⑤ 菜单大小 / 图标大小 / 环的**厚度**(`Thickness`) / 显示应用名 / 启动后是否收起，都是旋钮。
 *
 * ── 和 Swift 那侧必须对上（少一件就是"看着像坏的"）────────────────────
 *   ① **窗口大小**：关着时很小，展开那一圈前要先让 Swift 把窗放大
 *      （不放大 ⇒ 扇区被窗裁掉，而"被裁掉"和"没有"在屏幕上一样）。
 *      放大时**锚点**要算对（`right/bottom` 定位 + 左/下不动），不然小家伙会跳。
 *   ② **拖**：网页挪不动原生窗口，只能把位移 post 给 Swift。
 *   ③ **右键**：**不再**直接叫 Swift 开设置（读者 2026-10-10 深夜：「右键不要是打开设置了，
 *      是一个勾选列表」）—— 右键 = 运行中清单 → 勾选 → 批量退。设置挪到面板底部那颗
 *      「Pet 设置…」按钮上（`#pwqset`，走 `{cmd:'settings'}` → Swift `openUI` +
 *      `window.__app.openPetSettings()` → 打开抽屉并滚到 `#secpet`）。
 *   ④ ⭐ **鼠标位置由 Swift 喂进来**（`window.__petMouse(x,y)`，窗口坐标系）——
 *      WKWebView 在非 key 窗口里**收不到 hover**（`NSTrackingArea` 是 `.activeInKeyWindow`），
 *      而这个窗刻意是 `.nonactivatingPanel`（不抢焦点）。所以几何判断必须我们自己做。
 *      两端都往这里喂：Swift 的定时器（指针在窗外）和本页的 mousemove（指针在窗内）。
 */
const api = (p, o) => fetch(p, o).then((r) => r.json());
const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const $ = (s) => document.querySelector(s);
const native = (msg) => {
  try {
    const h = window.webkit?.messageHandlers?.c4;
    if (!h) { report('native 桥不存在：' + JSON.stringify(msg)); return; }
    h.postMessage(msg);
  } catch (e) { report('native 抛了：' + e.message); }
};
// ⚠️ 这个独立小窗**没有控制台可看** —— 出什么问题都要能回报到服务端，
//    不然"桥没通"和"功能没做"在外表上一模一样。
function report(m) {
  try { fetch('/api/client-log?m=' + encodeURIComponent('pet: ' + m)); } catch { /* 连不上就算了 */ }
}
addEventListener('error', (e) => report('页面报错 ' + (e.message || '')));
report('起：bridge=' + !!window.webkit?.messageHandlers?.c4 + ' ua=' + navigator.userAgent.slice(0, 60));

const PET_KEY = 'c4emem.pet';
/** 诊断：谁调的开/关（"乱闪"那次就是靠它定到具体那一句的） */
const who = () => (new Error().stack || '').split('\n').slice(1, 4)
  .map((l) => (l.match(/([A-Za-z_$][\w$]*)\s*\(/) || [, l.trim().slice(0, 40)])[1]).join('<');
const petPref = () => { try { return JSON.parse(localStorage.getItem(PET_KEY) || '{}'); } catch { return {}; } };
const petSave = (p) => localStorage.setItem(PET_KEY, JSON.stringify({ ...petPref(), ...p }));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PET_FORMS = [
  { id: 'card', nm: 'CEVTUO 卡片' },
  { id: 'pearl', nm: '珍珠' },
  { id: 'silver', nm: '银' },
  { id: 'lead', nm: '铅' },
  { id: 'zinc', nm: '锌' },
];
const ORB_VIDEO = {
  pearl: '/ui/assets/pearl-orb.mp4',
  silver: '/ui/assets/mineral-silver-loop.mp4',
  lead: '/ui/assets/mineral-lead-loop.mp4',
  zinc: '/ui/assets/mineral-zinc-loop.mp4',
};
const ORB_KEYED = { silver: 1, lead: 1, zinc: 1 };
/** ⚠️ 和主界面那份**必须一样**（两份名单漂移的症状是"Pet 换到某个形态就空白"） */
const CARD_LAYERS = 18;

/** 卡片：和大球那颗同构的多层卡（同一张 card.png、同一套层叠厚度），整体缩小 */
function buildCard(el) {
  if (!el) return;
  let html = '<div class="sh"></div>';
  for (let i = 0; i < CARD_LAYERS; i += 1) {
    const z = -2 + (4 * i) / (CARD_LAYERS - 1);
    const k = (1 - Math.abs(z / 2) * 0.30).toFixed(3);
    html += `<i class="ed" style="transform:translateZ(${z.toFixed(2)}px);filter:brightness(${k})"></i>`;
  }
  html += '<i class="fr"></i><i class="bk"></i><i class="gl"></i>';
  el.innerHTML = html;
}

function renderPet() {
  const p = petPref();
  const form = PET_FORMS.some((f) => f.id === p.form) ? p.form : 'card';
  const body = $('#petbody');
  body.className = 'petbody' + (form === 'card' ? ' ptcard' : ORB_KEYED[form] ? ' mono' : '');
  body.innerHTML = form === 'card' ? '<div class="ck" id="petck"></div>'
    : (ORB_KEYED[form] ? `<img src="/ui/assets/mineral-${form}-mini.webp" alt="" draggable="false">`
      : `<video src="${ORB_VIDEO[form]}" muted loop autoplay playsinline></video>`);
  if (form === 'card') buildCard($('#petck'));
  $('#pet').dataset.form = form;
  document.body.classList.toggle('pet-letters-off', p.letters === false);
}

/* ══ 轮盘 ═══════════════════════════════════════════════════════════
   几何全部在这里算，**不进 CSS**（CSS 只能写死一个位置，而 App 的个数不定）。
   角度用**屏幕直觉**：0°=右、90°=下、180°=左、270°=上（和 cos/sin 一致）。 */

/**
 * 三档大小（Launchy 的 Tiny/Small/Medium/Large 收成三档，够用）。
 *
 * ⚠️⚠️ 2026-10-11 读者：「现在的这种**太分散了**，应该做得**更靠近一些**」。
 *    上一版内圈中线跑到 **97~112**，再加上第二圈在 **190** ⇒ 两环之间一大片空白。
 *    ⇒ 半径整体收回（内圈中线 m 档 **84**），`RING_STEP` 10 → 8，两环贴在一起。
 *    这一组数是**按弦长算的**，不是拍脑袋：见 `PER_RING` 那段。
 */
const SIZES = {
  s: { rIn: 56, thick: 38, icon: 22, fs: 9.5 },
  m: { rIn: 62, thick: 44, icon: 26, fs: 10 },
  l: { rIn: 70, thick: 52, icon: 30, fs: 10.5 },
};
/**
 * ⚠️⚠️ 弧**只在"左下 → 左 → 上"这一片里**，不能开全圆 ——
 *    Pet 钉在屏幕右下角（窗 440×520，宠物中心在页面的 (362, 372)），
 *    往右/往下长就直接出窗（出窗 = 看不见 = 点不到），而"看不见"和"没做"长得一模一样。
 *
 * ⭐ 2026-10-11 把弧**从 118° 张到 144°**：弧越宽，同一圈就能塞下越多、越靠里 ——
 *    这正是"更靠近一些"要的东西（118° 时 6 格要摆到 r≈117 才不挤，144° 时 r≈84 就够）。
 *    上界 292°（不是 300）：`cos(292°)=0.375`，最外圈半径 177 时右沿到 362+66=428 < 440 ✓；
 *    再往右挪 8° 就顶到窗口边，最外面那一格会被裁掉。
 */
const ARC0 = 148, ARC1 = 292;
/**
 * 一圈最多几个。
 * ⚠️ 判据是**弦长 ≥ 方块宽度**（相邻两格中心距 = `2r·sin(Δa/2)`）：
 *    Δa = 144°/5 = 28.8°。m 档内圈中线 r = 62+22 = **84** ⇒ 弦长 `2*84*sin(14.4°) ≈ 41.8`，
 *    方块宽 `26+12 = 38` ⇒ 刚好不碰 ✓（s 档 37.3 vs 34 ✓，l 档 47.8 vs 42 ✓）。
 * ⚠️ 摆不下的**不静默丢**：`#pwmore` 会写"筛出 12 / 115"，打字就能筛。
 */
const PER_RING = 6;
const MAX_RINGS = 2;
/** 轮盘一次最多画这么多（= 12）。多的靠打字筛，绝不闷声不响地吞掉。 */
const CAP = PER_RING * MAX_RINGS;
/** 第二圈半径再加这么多（原来是 10，缩到 8 —— 两环贴紧一点） */
const RING_STEP = 8;

const PETC = { x: 0, y: 0 };              // Pet 中心（在 #pet 的坐标系里 = 轮盘原点）
const W = {
  open: false, src: 'running', apps: [], vis: [], sel: -1,
  q: '', qAt: 0, keys: {}, lay: null, openedAt: 0, cool: 0,
  /** 钉住（快捷键开出来的）：指针走远也不收 */
  pinned: false,
  /** 这一轮有没有真的切走某个软件（决定收起后要不要把焦点还回去） */
  justPicked: false,
  /** 键盘通没通（原生推过来的）；**没通的时候按的字母先存着**，通了立刻补跑。
   *  ⚠️ 默认必须是 **true**：浏览器/没有原生桥的时候没人来推这个状态，
   *     默认 false 的话**每一个字母都会被存着然后永远不执行**（套件实测掉了 5 条）。 */
  kbReady: true,
};

/** 布局：把 vis 里的 App 摊到 1~2 圈扇区上。返回每一项的角度/半径和它的 path 数据。 */
function layout() {
  const sz = SIZES[petPref().size || 'm'] || SIZES.m;
  const list = W.vis;
  const n = list.length;
  const rings = Math.min(MAX_RINGS, Math.max(1, Math.ceil(n / PER_RING)));
  const per = n ? Math.ceil(n / rings) : 1;
  const span = ARC1 - ARC0;
  const out = [];
  let rOutMax = sz.rIn + sz.thick;
  for (let i = 0; i < n; i += 1) {
    const ring = Math.floor(i / per);
    const k = i % per;
    const cnt = Math.max(1, Math.min(per, n - ring * per));
    // 单个时摆正中间；否则按 cnt 等分（**用 cnt 不是 per**，最后一圈不满也不会偏）
    const ang = ARC0 + span * (cnt <= 1 ? 0.5 : k / (cnt - 1));
    const rIn = sz.rIn + ring * (sz.thick + RING_STEP);
    const rOut = rIn + sz.thick;
    if (rOut > rOutMax) rOutMax = rOut;
    // 扇区半宽 = 一格的 43%（留 14% 的缝）—— 缝太小两个扇区看着就是一整块
    const half = (span / cnt) * 0.43;
    out.push({ i, ring, ang, rIn, rOut, mid: (rIn + rOut) / 2, a0: ang - half, a1: ang + half, app: list[i] });
  }
  return { sz, out, rings, rOutMax };
}

const rad = (deg) => (deg * Math.PI) / 180;
const pol = (r, deg) => [Math.cos(rad(deg)) * r, Math.sin(rad(deg)) * r];

/** 环带扇形的 path（SVG，原点在 Pet 中心，所以坐标可以是负的） */
function segPath(rIn, rOut, d0, d1) {
  const [x0, y0] = pol(rOut, d0);
  const [x1, y1] = pol(rOut, d1);
  const [x2, y2] = pol(rIn, d1);
  const [x3, y3] = pol(rIn, d0);
  const big = d1 - d0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${rOut} ${rOut} 0 ${big} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}` +
    `L${x2.toFixed(2)} ${y2.toFixed(2)}A${rIn} ${rIn} 0 ${big} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z`;
}

/**
 * ⭐⭐ 命中 = **角度 + 半径**（Launchy 的 `Selection distance / tolerance`），
 *    不是 DOM 的 :hover。指针落在哪个扇区的角度带里就选它 ——
 *    两个扇区挨着的时候也不会在中间那一下"谁都不选"（那就是读者说的**闪**）。
 * ⚠️ 半径容差给 6px：指针刚好压在内外边缘上时仍然算选中。
 */
function hitTest(mx, my) {
  const L = W.lay;
  if (!L) return -1;
  const dx = mx - PETC.x, dy = my - PETC.y;
  const r = Math.hypot(dx, dy);
  let a = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (a < 0) a += 360;
  for (const s of L.out) {
    if (r >= s.rIn - 6 && r <= s.rOut + 6 && a >= s.a0 - 1.5 && a <= s.a1 + 1.5) return s.i;
  }
  return -1;
}

/**
 * A–Z 快捷键。
 *
 * ⚠️⚠️ 上一版是"**先来先得**"：按列表顺序取名字里的第一个空闲字母。
 *    结果 `Clash Party` 排在前头把 **C** 拿走了，`Google Chrome` 只能退而拿 **G**
 *    —— 读者原话「**按住 c 就能打开 chrome**」，按 C 打开的是 Clash Party。
 *
 * ⇒ 改成**按字母轮询、谁最配谁拿**：
 *    ① 名字先洗掉厂商前缀（`Google Chrome` → `Chrome`）；
 *    ② 对每个字母（A→Z），在所有**还没分到字母**、且名字里有这个字母的 App 里选一个，
 *       优先级 = **首字母就是它** > **词数少** > **名字短**（Chrome 1 个词 6 个字母，
 *       赢过 Clash Party 的 2 个词 11 个字母）；
 *    ③ 还没分到的一律顺延字母表（保证**每一个 App 都有键**，不会出现"这个点不了"）。
 */
function assignKeys(apps) {
  const clean = apps.map((a) => String(a.name || '?')
    .replace(/^(google|microsoft|apple|adobe|tencent|bytedance|meta)\s+/i, '').toUpperCase());
  const taken = new Array(apps.length).fill('');
  const map = {};
  const rank = (i) => clean[i].split(/\s+/).length * 10 + clean[i].length;
  // ① 每个字母先给"**首字母就是它**"的那一个（同字母里挑词少、名短的）
  for (let k = 0; k < 26; k += 1) {
    const ch = String.fromCharCode(65 + k);
    const pool = clean.map((_, i) => i).filter((i) => !taken[i] && clean[i][0] === ch);
    if (!pool.length) continue;
    pool.sort((a, b) => rank(a) - rank(b) || a - b);
    taken[pool[0]] = ch;
    map[ch] = pool[0];
  }
  // ② 没拿到首字母的：**在它自己名字里**找一个还空着的字母（Clash Party → L，比硬塞个 A 好认）
  for (let i = 0; i < apps.length; i += 1) {
    if (taken[i]) continue;
    for (const ch of clean[i]) {
      if (/[A-Z]/.test(ch) && !map[ch]) { taken[i] = ch; map[ch] = i; break; }
    }
  }
  // ③ 实在没有的顺延字母表 —— **每一个 App 都必须有键**（缺一个就是"这个按不出来"）
  for (let i = 0; i < apps.length; i += 1) {
    if (taken[i]) continue;
    for (let k = 0; k < 26; k += 1) {
      const ch = String.fromCharCode(65 + k);
      if (!map[ch]) { taken[i] = ch; map[ch] = i; break; }
    }
  }
  return map;
}

// ── 画 ────────────────────────────────────────────────────────────
function paintWheel() {
  const host = $('#pwwheel');
  if (!host) return;
  const matched = W.q
    ? W.apps.filter((a) => String(a.name || '').toLowerCase().includes(W.q))
    : W.apps;
  W.vis = matched.slice(0, CAP);
  const L = layout();
  W.lay = L;
  W.keys = assignKeys(W.vis);

  const R = Math.ceil(L.rOutMax + 14);
  const segs = L.out.map((s) => (
    '<path class="pwsg' + (s.i === W.sel ? ' on' : '') + '" data-i="' + s.i + '" d="' +
      segPath(s.rIn, s.rOut, s.a0, s.a1) + '"/>'
  )).join('');
  const icons = L.out.map((s) => {
    const [x, y] = pol(s.mid, s.ang);
    const kk = Object.keys(W.keys).find((k) => W.keys[k] === s.i) || '';
    return '<div class="pwic' + (s.i === W.sel ? ' on' : '') + '" data-i="' + s.i + '" style="transform:translate(' +
      x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-50%)">' +
      '<img src="/api/appicon?path=' + encodeURIComponent(s.app.path) + '" alt="" draggable="false">' +
      // ⚠️ 有些 App **根本没有独立的 .icns**（图标只活在 `Assets.car` 里，`sips` 取不到 ⇒
      //    `/api/appicon` 回 404）。上一版把 `<img>` 悄悄隐藏 ⇒ 那颗就**空的**，
      //    看起来像"这个软件没装上"。⇒ 取不到就退成**首字母**（永远有东西）。
      '<b class="pwmono" style="display:none">' + esc(String(s.app.name || '?').trim()[0] || '?') + '</b>' +
      (petPref().letters === false || !kk ? '' : '<b class="pwkk">' + esc(kk) + '</b>') +
      '</div>';
  }).join('');
  host.style.setProperty('--pwic', L.sz.icon + 'px');
  // ⚠️⚠️ 这里**没有底衬了**（2026-10-11 读者：「最好做成**不要扇形的底**，可以是透明的就好了，
  //    还是回归我们这种」——"我们这种" = 一颗一颗的玻璃小方块，底是透的）。
  //    上一版那条弧形的底衬还有个更直接的毛病：**它比扇区短一截，两侧都露出来** ——
  //    因为余量写的是 `ARC0-5`，而最外面那两个扇区的半宽是 `span/cnt*0.43 ≈ 8.5°`，
  //    5 < 8.5 ⇒ 两头各露 3.5°（读者截图里那条"短一截"就是这个）。
  //    ⇒ 整条底衬撤掉，**视觉交给每一颗方块**，命中仍然走「角度 + 半径」（功能不变）。
  host.innerHTML =
    '<svg class="pwsvg" width="' + R * 2 + '" height="' + R * 2 + '" viewBox="' + (-R) + ' ' + (-R) + ' ' + (R * 2) + ' ' + (R * 2) + '">' +
      segs + '</svg>' +
    icons;
  // 图标取不到（404）就翻成首字母 —— 挂监听必须在 innerHTML 之后，
  // 而且要补一次"已经失败了"的检查（图片可能在监听挂上之前就 404 了）
  host.querySelectorAll('.pwic img').forEach((im) => {
    const fall = () => {
      im.style.display = 'none';
      const m = im.parentElement.querySelector('.pwmono');
      if (m) m.style.display = 'grid';
    };
    im.addEventListener('error', fall);
    if (im.complete && im.naturalWidth === 0) fall();
  });
  const hub = $('#pwhub');
  const sel = W.sel >= 0 ? W.vis[W.sel] : null;
  hub.textContent = sel ? sel.name : (W.vis.length ? '选一个…' : (W.q ? '没有匹配的' : '没有可打开的'));
  hub.classList.toggle('none', !sel);
  paintSrc();
  // 提示：数量对不上时说清楚（**不静默截断**）
  const shown = W.vis.length, all = W.apps.length;
  // ⚠️ 只显示了一部分就**照实说**（静默截断看起来和"全都在这儿"一模一样）
  $('#pwmore').textContent = shown < all ? ('筛出 ' + shown + ' / ' + all) : (all ? all + ' 个' : '');
}

function paintSrc() {
  const chip = $('#pwsrc');
  const n = W.apps.length;
  chip.textContent = (W.src === 'running' ? '正在运行' : '全部应用') + ' · ' + n + (W.q ? ' · 筛“' + W.q + '”' : '');
  chip.dataset.src = W.src;
}

// ── 数据源（Launchy 的 "Running apps" / "My other apps"）─────────
// ⚠️⚠️ `running` 那一份**每次现读，绝不从缓存里拿**。
//    读者 2026-10-13 报的：「软件已经关掉了（右键那个列表里已经没了），
//    可是摸一下 Pet 弹出来的扇里**还有它的图标**」—— 根因就在这里：
//    `openWheel` 那次 `setSrc(src)` **不带 force**，而缓存一旦填过就永远命中
//    ⇒ 那一圈**再也不会变**（除非整页重载），退掉的软件一直留在扇里。
//    代价：`/api/running` 是一条 `lsappinfo list`，本地几十毫秒 —— 现读得起。
//    贵的是 `all`（要重新扫盘 + 读每个 bundle 的名字）⇒ **它**才需要缓存和 force。
//    ⚠️ 别顺手把 `all` 也改成现读：`openWheel` 是**悬停就触发**的，那会让每次
//       路过 Pet 都扫一遍盘。
let srcCache = { running: null, all: null };
async function loadSrc(src, force) {
  if (src !== 'running' && !force && srcCache[src]) return srcCache[src];
  const url = src === 'running' ? '/api/running' : '/api/apps' + (force ? '?refresh=1' : '');
  const r = await api(url).catch(() => ({ apps: [] }));
  const apps = (r.apps || []).filter((a) => a && a.path && a.name);
  // 运行中那份已经把 C4emem 自己排掉了；全部应用那份把"我们已知的来源"排在后面
  srcCache[src] = apps;
  return apps;
}

async function setSrc(src, force) {
  W.src = src;
  W.sel = -1; W.q = '';
  // ⚠️⚠️ 这里**刻意不先 `W.apps = []; paintWheel()`**：那一下会画出一帧"空的轮盘"。
  //    以前看不出（缓存命中时 await 只跨一个微任务，浏览器根本不重画），
  //    但 `running` 现在是**真的要走一次 fetch** ⇒ 那一帧空会露出来，
  //    看着就是"摸上去先空一下才出图标"。换源（Tab）时旧图标多留几十毫秒，
  //    比整圈空一下好看得多。
  const apps = await loadSrc(src, force);
  if (W.src !== src) return;   // 期间又换过源 ⇒ 别拿上一份的旧结果盖回去
  W.apps = apps;
  paintWheel();
  // ⭐ 运行中一个都没有（开机就点它）⇒ 自动退到全部应用，并**说出来**
  if (src === 'running' && !W.apps.length) {
    report('running 为空，退到 all');
    await setSrc('all');
  }
}

// ── 交互 ──────────────────────────────────────────────────────────
const wheelOpen = () => W.open;
function openWheel() {
  if (W.open) return;
  report('OPEN ' + JSON.stringify(W.dbg) + ' @' + who());
  parked = false;
  W.open = true; W.openedAt = Date.now(); W.sel = -1; W.q = '';
  // ⚠️ 乐观地先当键盘是通的：原生 50ms 内会推真实状态纠正。写死 false 会让**没有原生桥**时每个字母都被存着、永不执行。
  W.kbReady = true;
  document.body.classList.add('pw-on');
  native({ cmd: 'resize', open: true });
  // ⚠️⚠️ 读者 2026-10-11：「**必须点击一下这个球才能锁定它、然后快捷键才管用**……
  //    我的目标是**在任何地方、没有选中这个球**，鼠标放上去展开了这些应用，
  //    然后就按字母就能打开，**全程不用鼠标或者触摸板点击按压**」。
  //    ⇒ 键盘焦点**在展开的那一刻就要拿到**，不能等用户点一下。
  //    （实测：点一下就能用字母 = 那一下让面板成了 key window ⇒ 这里主动做同一件事。）
  native({ cmd: 'focus' });
  W.apps = srcCache[W.src] || [];
  paintWheel();                       // 先用缓存那份画（点一下立刻有东西）
  setSrc(W.src).then(() => { if (W.open) paintWheel(); });
}
function closeWheel() {
  if (!W.open) return;
  report('CLOSE ' + JSON.stringify(W.dbg) + ' @' + who());
  W.open = false; W.sel = -1; W.q = ''; W.pinned = false;
  W.pendingKey = '';
  document.body.classList.remove('pw-on');
  native({ cmd: 'resize', open: false });
  // ⭐ 告诉原生"这一轮收了、有没有切走一个软件" —— 它据此决定要不要把键盘焦点还给
  //    你原来那个 App（**切走过就不还**，否则会把人家刚点开的那个又踢下去）。
  native({ cmd: 'closed', picked: !!W.justPicked });
  W.justPicked = false;
}
function pick(i) {
  const a = W.vis[i];
  // ⚠️ 静默 return 是这里最糟的一种写法：读者看到的是"点了没反应"，
  //    而日志里**一个字都没有** ⇒ 分不清"点歪了 / 列表刚换过 / 功能坏了"。
  if (!a) { report('点了第 ' + i + ' 格，但那一格没有对应的 App（列表刚换过？vis=' + W.vis.length + '）'); return; }
  W.justPicked = true;          // "这一轮是切走了某个软件"，焦点不还回去
  // ⚠️⚠️ 读者 2026-10-11：「打开软件的**速度太慢太慢，加速，要飞速打开**」。
  //    走 HTTP 那条路要**起三个进程**（`plutil` 读 bundleId → `osascript ... activate` → `open -a`），
  //    每一个都是几十到几百毫秒，串起来就是"点了要等一下才切过去"。
  //    ⇒ 有原生桥就走**进程内**的 `NSWorkspace`（几毫秒）；记账回服务端但**不参与等待**。
  //    没桥（浏览器调试）才退回 HTTP 那条。
  // ⚠️⚠️ 打开软件**走原生**（`launchFast`）：它内部先 `orderOut + deactivate` 让位，
  //    再去 activate —— 实测目标 App **真的到前台并且待住**（+0.3s / +1.2s 两个探针都验过）。
  //    ⚠️ 让位这一步是必须的：**我们占着"活动 App"时，谁都不许把别的 App 叫到前面**
  //    （in-process activate / osascript / open -a 三条路全试过，一条都不生效）。
  //    没有原生桥（浏览器调试）才退回 HTTP。
  if (window.webkit?.messageHandlers?.c4) native({ cmd: 'launch', path: a.path });
  else post('/api/apps/activate', { path: a.path }).then((r) => {
    if (r?.error) report('切不过去：' + r.error);
  }).catch((e) => report('切不过去：' + e.message));
  // Launchy 的 "Hides after launch"：默认切成之后收起（设置里可关）
  // ⚠️⚠️ 切完**必须门住**（`parked`），不能只靠 1.2 秒冷却 ——
  //    读者的鼠标**本来就停在刚点的那个格子上**（还在宠物这一带），冷却一过轮盘就重新展开，
  //    `openWheel` → `native({cmd:'focus'})` **把前台又抢回来** ⇒ 目标 App 刚上来 1 秒就被顶下去，
  //    用户眼里就是"点了什么也没发生"。要挪开（d>200）才允许再展开。
  if (petPref().keepOpen !== true) { parked = true; closeWheel(); W.cool = Date.now() + 1200; }
}
function selectAt(i) {
  if (i === W.sel) return;
  W.sel = i;
  const L = W.lay;
  if (!L) return;
  // 只改 class，不整块重画（重画会让图标闪一下 —— 那一下就是"乱闪"的一部分）
  const host = $('#pwwheel');
  host.querySelectorAll('.pwsg').forEach((p) => p.classList.toggle('on', Number(p.dataset.i) === i));
  host.querySelectorAll('.pwic').forEach((p) => p.classList.toggle('on', Number(p.dataset.i) === i));
  const sel = i >= 0 ? W.vis[i] : null;
  const hub = $('#pwhub');
  hub.textContent = sel ? sel.name : '选一个…';
  hub.classList.toggle('none', !sel);
}

/** ⭐ Swift 定时器（指针在窗外）和本页 mousemove（指针在窗内）都往这里喂 */
function mouseAt(x, y) {
  // 清单面板开着的时候，轮盘让位（不然鼠标一蹭到宠物就弹出一圈压在上面）
  if (Q.open) { hoverClose.cancel(); return; }
  const L = W.lay;
  {
    const r = $('#pet').getBoundingClientRect();
    PETC.x = r.left + r.width / 2;
    PETC.y = r.top + r.height / 2;
  }
  const d = Math.hypot(x - PETC.x, y - PETC.y);
  // 诊断用（"乱闪"的时候要看的就是这几个数）
  W.dbg = { x: Math.round(x), y: Math.round(y), px: Math.round(PETC.x), py: Math.round(PETC.y), d: Math.round(d), vw: innerWidth, vh: innerHeight };
  // ⭐ 快捷键开出来的轮盘是"钉住"的：指针不在附近也**不收**（读者按 ⌥⌘C 时手指在键盘上，
  //    鼠标可能在屏幕另一头；不钉住的话它开出来不到一秒就自己没了）。
  if (W.pinned) { selectAt(hitTest(x, y)); return; }
  if (!W.open) {
    // ⚠️⚠️ `parked`：**人手动关掉的那一次**（Esc / 点一下宠物收回）不许被悬停立刻又弹回来。
    //    不设这一条的话，"点一下收回"之后 **50ms** 下一个 `__petMouse` 又把它开出来
    //    （指针本来就还在宠物身上）⇒ 屏幕上就是闪一下 —— 这正是读者说的"乱闪"。
    //    要再开得**先离开再回来**（d > 200 才算真的走开）。
    if (parked) { if (d > 200) parked = false; return; }
    // 靠过去就开（读者：「鼠标放上去它就展示」）
    // ⚠️ 刚切完那 1.2 秒里也不许重开：切过去之后被切的那个软件会到最前面，
    //    而指针还停在宠物身上 ⇒ 立刻又弹一个轮盘出来。
    //    （Launchy 的 "Hides after launch" 真正在挡的就是这件事。）
    // ⚠️ 只有 apps 模式才"路过往上就开" —— 另外三种模式下鼠标路过弹一圈软件出来是**驴唇不对马嘴**
    if ((petPref().mode || 'apps') === 'apps' && d < 96 && Date.now() > (W.cool || 0)) openWheel();
    return;
  }
  // ⚠️⚠️ 这个"还在 Pet 身上"的半径**只能是 Pet 自己那么大（~56）**，不能拍一个大数。
  //    上一版写了 132，而内圈扇区的内沿半径才 60~78 ⇒ **整条内圈都被它挡在外面**，
  //    指针压在内圈上永远选不中（看起来就是"里圈点不动"）。
  //    ⇒ 判据必须比被挡的那个东西**小**。
  if (d < 56) { selectAt(-1); hoverClose.cancel(); return; }
  selectAt(hitTest(x, y));
  const keep = (L ? L.rOutMax : 200) + 40;
  if (d < keep) { hoverClose.cancel(); return; }
  // 出了轮盘这一带 ⇒ 延时收（指针从 Pet 挪到扇区的路上会先出到外面一点）
  hoverClose.arm(Math.max(0, 520 - (Date.now() - W.openedAt)));
}

/** 人手动关掉之后"不许悬停重开"的门闩 —— 见 `mouseAt` 里那段注释 */
let parked = false;

/** ⚠️⚠️ 收起要有**延时 + 滞回**：指针从 Pet 移到扇区上时会穿出各种边界，
 *    立刻收的话那一圈会一直在你手底下消失-出现（读者报的"乱闪"）。 */
const hoverClose = (() => {
  let t = 0;
  return {
    cancel() { clearTimeout(t); t = 0; },
    arm(ms) { if (t) return; t = setTimeout(() => { t = 0; closeWheel(); }, Math.max(180, ms)); },
  };
})();

/** 键盘：A–Z 直接切（Launchy 的招牌）；其它字符当筛选；Esc 收 */
function handleKey(k) {
  // ⚠️ 键盘还没接通时，字母**先存着**（展开后头 300ms 就是这个状态）
  if (W.open && !W.kbReady && k.length === 1 && /[a-zA-Z]/.test(k)) {
    W.pendingKey = k; report('键盘还没接通，先存下 ' + k); return;
  }
  if (k === 'Escape') { if (Q.open) return qClose(); parked = true; closeWheel(); return; }
  if (!W.open) return;
  if (k === 'Tab') { setSrc(W.src === 'running' ? 'all' : 'running'); return; }
  if (k === 'Backspace') { W.q = W.q.slice(0, -1); paintWheel(); return; }
  if (k === 'Enter') { if (W.sel >= 0) pick(W.sel); else if (W.vis.length) pick(0); return; }
  if (k.length !== 1 || !/[ -~]/.test(k)) return;
  const up = k.toUpperCase();
  // A–Z 且这个字母有主 ⇒ 直接切（**不筛选**，这就是"秒切"的意思）
  if (/[A-Z]/.test(up) && !W.q && W.keys[up] != null) { pick(W.keys[up]); return; }
  W.q = (W.q + k.toLowerCase()).slice(0, 24);
  paintWheel();
}
function onKey(e) {
  // ⚠️⚠️ 带 ⌘ / ⌃ / ⌥ 的**一律不管**。原生那条本地监视器是这么过滤的
  //    （`startPetKeyMonitor`：`guard ev.modifierFlags.intersection([...]).isEmpty`），
  //    而**网页这条路漏了** —— 两条路各写各的，就差这一条。
  //    轮盘是"**鼠标悬停就展开 + 当场抢键盘焦点**"的，所以用户在别处按 ⌘C / ⌘F 的那一下
  //    会落到这里。2026-10-12 真机实测（`~/.c4emem/client.log`）：
  //      `key="Meta"` 紧跟 `key="c"` ⇒ **一个 ⌘C 把 Chrome 叫起来了**（`launch ok=true`）。
  //    那些是用户自己的快捷键，不是"按住字母开软件"。
  if (e.metaKey || e.ctrlKey || e.altKey) {
    if (W.open) report('key=' + JSON.stringify(e.key) + '（带修饰键 ⇒ 忽略）');
    return;
  }
  // ⚠️ 每个按键都记一笔（只在轮盘开着时）—— 日志里**有没有这一行**就能分清
  //    "按键没进来"（焦点问题）还是"进来了但没匹配上"（字母问题）。
  if (W.open) report('key=' + JSON.stringify(e.key));
  if (e.key === 'Tab') e.preventDefault();
  handleKey(e.key);
}

// ── 拖 / 点 / 右键 ────────────────────────────────────────────────
const pet = $('#pet');
let dragging = false, moved = 0, lastX = 0, lastY = 0, accX = 0, accY = 0;

pet.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  // 点轮盘上的任何东西（扇区 / 图标 / 中轴 / 来源药丸）= 用轮盘，**不是拖 Pet**
  // ⚠️ 这里一定不能漏 —— `setPointerCapture` 会把 pointerup/click **重定向到 `#pet`**，
  //    扇区上那些 click 监听就永远收不到（"点药丸没反应""点扇区没反应"同一个根因）。
  if (e.target.closest?.('.pw')) return;
  dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; accX = 0; accY = 0;
  pet.setPointerCapture(e.pointerId);
});
pet.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
  // ⚠️ 累加零头再取整发出去 —— 直接 Math.round(每帧 0.x px) 全被抹掉，慢速拖会"不动"
  accX += dx; accY += dy;
  const sx = Math.trunc(accX), sy = Math.trunc(accY);
  if (sx || sy) { accX -= sx; accY -= sy; native({ cmd: 'drag', dx: sx, dy: sy }); }
});
pet.addEventListener('pointerup', (e) => {
  if (!dragging) return;
  dragging = false;
  pet.releasePointerCapture?.(e.pointerId);
  if (moved > 5) return;                     // 拖完那一下不算点击
  // ⚠️ `setPointerCapture` 会把后续事件的 target **重定向到 #pet** ——
  //    所以不能用 `e.target` 找扇区，要按坐标现问（这个坑让"点扇区"整整失效过一次）
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const seg = el?.closest?.('.pwic, .pwsg');
  if (seg) { pick(Number(seg.dataset.i)); return; }
  // ⭐⭐ 单击 = 设置里那一项「**点它做什么**」。
  //    ⚠️⚠️ 这一条在此之前**根本没实现**：`pet.js` 从来不读 `mode`，
  //       于是"桌面 Pet"那张卡片上的「点它做什么」**是个谎** ——
  //       选了"开始 / 结束说话"，在桌面上点它什么也不会发生（只有窗口里那个浮层 Pet 认这个设置）。
  //    ⇒ 四种模式在桌面这一侧全部接上（都走现成的原生桥）。
  const md = petPref().mode || 'apps';
  if (md === 'voice') { native({ cmd: 'voice' }); return; }
  if (md === 'c4emem') { native({ cmd: 'show' }); return; }
  if (md === 'open') {
    const path = petPref().appPath;
    // ⚠️ 没选软件就**说出来**，别静默什么都不做
    if (path) native({ cmd: 'launch', path });
    else report('「点它做什么」选了打开指定软件，但还没选是哪个');
    return;
  }
  // 默认（apps）：开关轮盘
  // ⚠️ "点一下收回"要**门住**（`parked`）—— 不然 50ms 后悬停又把它开出来（= 一闪）
  if (wheelOpen()) { parked = true; closeWheel(); }
  // ⭐ 点开的时候顺手**要一次键盘焦点**：`.nonactivatingPanel` 天生拿不到按键，
  //   不主动要的话"敲字母切软件"这一条在真机上永远不工作（浏览器里测不出来）。
  else { parked = false; openWheel(); native({ cmd: 'focus' }); }
});
// ── 右键：正在运行的软件清单（勾选 → 一起退掉）──────────────────
/**
 * 读者 2026-10-10 深夜：「右键**不要是打开设置了**，是一个**勾选列表**，
 * 目前所有的软件，可以勾选然后点 delete 就都退出掉」。
 * ⚠️ 所以右键**不再**直接叫 Swift 开设置（那个入口挪到面板底部那颗小按钮上）。
 * ⚠️ 判据是**回执对着事实**：退完**重新读一遍** `/api/running` 再画，
 *    而不是把"我发出去的那几个"从列表里划掉 —— 后者在"App 弹了保存对话框没退成"
 *    的时候会显示成"退成功了"。
 */
const Q = { open: false, apps: [], sel: new Set() };
function qCount() {
  const go = $('#pwqgo'), n = Q.sel.size;
  go.textContent = n ? '退出勾选的 ' + n + ' 个' : '退出勾选的';
  go.disabled = !n;
}
function qPaint() {
  $('#pwqn').textContent = '正在运行 · ' + Q.apps.length;
  $('#pwqlist').innerHTML = Q.apps.length ? Q.apps.map((a) => (
    '<label class="pwqrow"><input type="checkbox" data-p="' + esc(a.path) + '"' +
    (Q.sel.has(a.path) ? ' checked' : '') + '>' +
    '<img src="/api/appicon?path=' + encodeURIComponent(a.path) + '" alt="" draggable="false">' +
    '<span class="nm">' + esc(a.name) + '</span></label>'
  )).join('') : '<div class="pwqempty">没读到正在运行的软件</div>';
  $('#pwqlist').querySelectorAll('input[data-p]').forEach((i) => {
    i.onchange = () => { if (i.checked) Q.sel.add(i.dataset.p); else Q.sel.delete(i.dataset.p); qCount(); };
  });
  qCount();
}
async function qRefresh(msg) {
  const r = await api('/api/running').catch(() => ({ apps: [] }));
  Q.apps = r.apps || [];
  // 已经不在列表里的，从勾选里剔掉（不留"勾着一个已经退了的"那种假状态）
  const live = new Set(Q.apps.map((a) => a.path));
  for (const p of [...Q.sel]) if (!live.has(p)) Q.sel.delete(p);
  // ⚠️ 顺手把轮盘那份缓存也纠正过来：`openWheel` 会先拿它画一帧再现读，
  //    不纠正的话，退完之后**第一次摸 Pet**，退掉的那一格会先闪一下才消失
  //    （"它明明退了怎么还在"的第一帧）。这里拿到的就是刚读的事实，直接用。
  srcCache.running = (Q.apps || []).filter((a) => a && a.path && a.name);
  qPaint();
  if (msg != null) $('#pwqmsg').textContent = msg;
}
async function qOpen() {
  Q.open = true; Q.sel = new Set();
  closeWheel();
  $('#pwqmsg').textContent = '读…';
  document.body.classList.add('pwq-on');
  native({ cmd: 'modal', on: true });      // ⚠️ 告诉 Swift"现在整窗都要收点击"
  qPaint();
  await qRefresh('');
}
function qClose() {
  if (!Q.open) return;
  Q.open = false;
  document.body.classList.remove('pwq-on');
  native({ cmd: 'modal', on: false });
}
async function qGo() {
  const paths = [...Q.sel];
  if (!paths.length) return;
  $('#pwqgo').disabled = true;
  $('#pwqmsg').textContent = '退…';
  const r = await post('/api/apps/quit', { paths }).catch((e) => ({ error: String(e) }));
  if (r?.error) { $('#pwqmsg').textContent = '失败：' + r.error; qCount(); return; }
  const bad = r.failed || [];
  Q.sel = new Set(bad.map((f) => f.path));
  await qRefresh('退了 ' + (r.done || []).length + ' 个' +
    (bad.length ? '；' + bad.length + ' 个没退成（' + (bad[0].error || '') + '）' : ''));
}
$('#pwqx').onclick = qClose;
$('#pwqset').onclick = () => { qClose(); native({ cmd: 'settings' }); };
$('#pwqall').onclick = () => { Q.apps.forEach((a) => Q.sel.add(a.path)); qPaint(); };
$('#pwqnone').onclick = () => { Q.sel = new Set(); qPaint(); };
$('#pwqgo').onclick = qGo;

pet.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (Q.open) return qClose();
  qOpen();
});
/** 面板外面点一下也收（它俩是兄弟，所以"外面"就是这块窗里其余的地方） */
document.addEventListener('pointerdown', (e) => {
  if (!Q.open) return;
  if (e.target.closest?.('.pwq') || e.target.closest?.('#pet')) return;
  qClose();
});
/**
 * ⚠️⚠️ 点扇区**必须单走一条 click**，不能塞进上面那个 `pointerup` ——
 *    `pointerup` 里第一句是 `if (!dragging) return`（拖拽状态机），
 *    而点扇区时我们**根本没有开始拖**（见 pointerdown 那一句提前 return）⇒
 *    那条路永远走不到。"点扇区没反应"就是这么来的。
 */
$('#pwwheel').addEventListener('click', (e) => {
  // ⭐ **两个都算选中**：压在图标上、或压在它那一段扇形带（`.pwsg`）上 —— 判据和悬停一致，
  //    都是"落在这一个扇区的角度 + 半径范围里"。图标只有 22~30px，而扇区带宽 38~52px，
  //    **只认图标**会让"看着点准了、其实点偏一点"直接落空。
  const seg = e.target.closest?.('.pwic, .pwsg');
  if (seg) { pick(Number(seg.dataset.i)); return; }
  // ⚠️ 2026-10-13 加：落在空白处（内圈那个洞里 / 两颗之间的缝）时**别静默**。
  //    读者看到的是"点了没反应"，而日志里一个字都没有 ⇒ 分不清
  //    "点歪了"和"这个功能坏了"。有一条 report，下一次就能一眼定位。
  //    ⚠️ 我试过在这里用 `hitTest` 按坐标"补中"最近的一格 —— **负向对照证明那段代码
  //    从来没被跑到**（点偏之后落点要么在 `.pwsg` 上、要么已经出了扇区范围），
  //    所以**删掉了**：留一段测不到的兜底，只会让人以为它救人，其实它不干活。
  report('点的位置没有对应任何一格（' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + '）');
});
/** 点窗里的空白处也收（SVG 上那些没画到的地方） */
document.addEventListener('click', (e) => {
  if (!W.open) return;
  const t = e.target;
  if (t.closest?.('#pet') || t.closest?.('#pwsrc')) return;
  closeWheel();
});

// 来源那颗药丸：点一下换（Launchy 的 "Next display mode"）
$('#pwsrc').addEventListener('click', (e) => {
  e.stopPropagation();
  setSrc(W.src === 'running' ? 'all' : 'running');
});

// ⭐ 快捷键（⌥⌘C / ⌥⌘4）那条路：原生已经把窗叫到前面、也抢到键盘焦点了，这里只管把轮盘打开。
//    ⚠️ 是**钉住**的 —— 手指在键盘上时鼠标可能在屏幕另一头，不钉住它一秒就自己没了。
window.__petOpen = () => {
  try { parked = false; W.pinned = true; W.sel = -1; W.q = ''; openWheel(); }
  catch (e) { report('__petOpen ' + e.message); }
};

// ⭐⭐ 原生推过来的"键盘通没通"（App 活动 / 窗口 key / 网页是 first responder 三件同时成立）。
//    ⚠️ 显示出来，因为"敲了没反应"有几个完全不同的原因，光看屏幕分不出来。
window.__petFocus = (ok, hasFocus) => {
  try {
    document.body.classList.toggle('pw-kb', !!ok);
    const el = document.getElementById('pwkb');
    if (el) el.textContent = ok ? '⌨ 已接通 · 直接敲字母就开' : '⌨ 未接通 · 先点一下它';
    report('键盘状态 ' + (ok ? '已接通' : '未接通') + ' / 网页有焦点=' + hasFocus);
    // ⭐⭐ **补跑**：展开的那 250~300ms 里键盘还没接通，这段时间按的字母先存着，
    //   接通的那一刻立刻补跑 —— 否则"看到展开了就敲"会掉在缝里（实测过这个缝）。
    if (ok && W.pendingKey) { const k = W.pendingKey; W.pendingKey = ''; report('补跑存下的按键 ' + k); handleKey(k); }
  } catch (e) { report('__petFocus ' + e.message); }
};

// ⭐ Swift 定时器喂进来的鼠标位置（窗口坐标系，左上为原点）
// ⭐⭐ **第二条通路**：原生的本地按键监视器把键直接转过来。
//    ⚠️ 存在的理由：网页那条 `keydown` 要"App 活动 + 窗口 key + 网页是 first responder +
//      网页自己有焦点"**四件同时成立**，任何一件没到位就是**静默失灵**。
//      多一条从原生直接进来的路，"敲了没反应"就不再是单点故障。
window.__petKey = (k) => {
  try { report('petKey=' + JSON.stringify(k)); handleKey(k); }
  catch (e) { report('__petKey ' + e.message); }
};

window.__petMouse = (x, y) => { try { mouseAt(x, y); } catch (e) { report('mouseAt ' + e.message); } };
// 兼容旧桥：只看开/关
window.__petHover = (on) => { if (!on) hoverClose.arm(0); };

addEventListener('keydown', onKey);
// 主界面改了设置（形态 / 字母 / 大小）要跟上 —— 用 storage 事件同步
addEventListener('storage', (e) => { if (e.key === PET_KEY) { renderPet(); if (W.open) paintWheel(); } });

renderPet();
report('轮盘就绪 Launchy 模型：ARC ' + ARC0 + '~' + ARC1 + ' per=' + PER_RING);
