/**
 * C4emem 界面逻辑。
 *
 * 结构：三栏 —— 导航 / **记录（工作区看板，底层）** / 内容。
 * 记录是底层：语音、文字、流程**最终都落在这里**，并且从这里能一键开新的三种。
 *
 * 三个模式用 `~` 循环。玻璃货架（像 Dropover）接住从任何地方拖过来的一段。
 */
import { createOrb } from '/ui/orb.js';
import { createKeyer } from '/ui/vkey.js';
import { icon, iconFor, mountIcons } from '/ui/icons.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const api = async (p, o) => (await fetch(p, o)).json();
const post = (p, b) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) });

/**
 * 一句话的反馈条。
 *
 * 为什么必须有：读者 2026-10-09 的原话是「**点击接入和同步没有反馈**」——
 * 同步那条路是 `spawn(..., {detached:true})` 起个后台进程、接口立刻返回，
 * 界面上**一个字都不说**；接入那次是两次 `fetch` 之后直接换 `innerHTML`，
 * 慢的时候看着就像"点了没反应"。凡是有等待的地方，都要先说话。
 * ⚠️ 这是**提示**不是日志：2.6 秒后自己消失，不挡操作；同一条重复出现只刷新计时。
 */
let toastTimer = null;
function toast(msg, kind = '') {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

/**
 * 来源。左下角那颗按钮展开的扇区照这个排。
 *
 * ⚠️ `spaces` 用的是**库里的 space 键**（learn / techai / techlearn / shopping），
 *    不是界面上的标签（"TECH AI" / "tech-learn"）。写错的表现是
 *    「选了某个来源，结果一条都搜不到」—— 不报错，只是空。
 */
const SOURCES = [
  { id: 'blend',  nm: '融合',   g: 'summarize', c: '#6b7280', tint: '#9aa3b2', spaces: [] },
  // ⚠️⚠️ Notion 的 **4 个库合成一格** —— 读者 2026-10-10：
  //    「tech-learn 什么这 4 种也是**合在一起，都是 notion 的**」。
  //    分成 4 格的时候，用户要在 4 个几乎一样的名字里挑，而它们本来就是**同一个软件里的库**；
  //    而"按软件来"这件事在扇区里同样成立。
  { id: 'notion', nm: 'Notion', g: 'notion', c: '#111111',
    spaces: ['learn', 'techai', 'techlearn', 'shopping'] },
  // ⚠️ `spaces` 要**把两条邮件路都列上**：IMAP 那条写进去的 space 是 `exmail`，
  //    官方 API 那条是 `wecom`。只写一个的话，从另一条同步进来的邮件**搜不到**，
  //    而表现是"这个来源里没有内容"—— 和"本来就没有"长得一模一样。
  { id: 'exmail', nm: '邮件',   g: 'mail',   c: '#2b7cd3', spaces: ['exmail', 'wecom'] },
  { id: 'feishu', nm: '飞书',   g: 'feishu', c: '#3370ff', spaces: ['feishu'] },
  { id: 'figma',  nm: 'Figma',  g: 'pen',    c: '#a259ff', spaces: ['figma'] },
  { id: 'adb',    nm: '手机',   g: 'phone',  c: '#22b07d', spaces: ['adb'] },
];

/**
 * 扇区槽位：r = 半径，a = 角度（从「水平向右」逆时针量，0°→90° 正好是那半区）。
 *
 * ⚠️ 融合放 45° @ 内圈 —— 这是**唯一**同时满足「正中最中」和「离按钮最近」的位置。
 *    只按角度取中，是 45°；只按距离取近，是内圈。两个都要，交集只有这一格。
 * ⚠️ 半径是算过的，不是随便填：相邻两格中心距必须 ≥ 瓦片直径，否则会叠在一起。
 *    把这个数组改大改小之前先算一遍 `2r·sin(Δa/2)`。
 */
const SLOTS = [
  { r: 86,  a: 45, core: true },
  { r: 108, a: 12 },
  { r: 108, a: 78 },
  { r: 172, a: 5 },
  { r: 172, a: 22 },
  { r: 172, a: 39 },
  { r: 172, a: 56 },
  { r: 172, a: 73 },
  { r: 172, a: 90 },
];

/**
 * 扇区槽位**按格子数算出来** —— 不再写死那 9 个。
 *
 * ⚠️ 为什么要算：读者 2026-10-10 让 Notion 的 4 个库合成一格（9 → 6），
 *    而"接上一个新软件，左下角也要多一格"意味着**格子数是会变的**。
 *    写死的槽位表一遇到数量变化就只有两种下场：留出空洞，或者几格叠在一起 ——
 *    **两种都不报错**，看起来只是"摆得有点怪"。
 *
 * 算法：按环从内往外摆，每环能放几格由**弧长 / 瓦片间距**决定。
 *    一圈 90°、半径 r 的弧长是 `rπ/2`；间距取瓦片直径 + 一点缝。
 *    ⚠️ 半径 86 / 108 / 172 这三档不是随便定的 —— 它们正好让
 *      「1 内 + 2 中 + 4 外」= 9 格排得下（原来那张写死的表就是这么来的）。
 */
function fanSlots(n) {
  const out = [{ r: 86, a: 45, core: true }];   // 融合：正中最中 + 离按钮最近
  const GAP = 62;                               // 瓦片直径 + 一点缝
  for (const r of [108, 172, 236, 300]) {
    if (out.length >= n) break;
    const max = Math.max(1, Math.floor((r * Math.PI) / 2 / GAP));
    const take = Math.min(max, n - out.length);
    for (let i = 0; i < take; i += 1) {
      // 1 格就摆正中；多格就均分 5°~90° 这段弧
      out.push({ r, a: take === 1 ? 45 : 5 + 85 * (i / (take - 1)) });
    }
  }
  return out;
}

let srcId = localStorage.getItem('c4emem.src') || 'blend';
if (!SOURCES.some((x) => x.id === srcId)) srcId = 'blend';
const curSrc = () => SOURCES.find((x) => x.id === srcId) || SOURCES[0];
/** 给 /api/ask 和 /api/search 的来源过滤参数。融合 = 空 = 全库。 */
const curSpaces = () => curSrc().spaces;

function paintSources() {
  const src = curSrc();
  // ⭐ 「只有融合的时候全列全展开」的另一半：选了某个来源，**别的分区收起来**。
  //    ⚠️ 只改 class、不动 localStorage —— 用户手动折过的那几个分区记的是**他自己的**偏好，
  //      被"切个来源"覆盖掉的话，那个记忆功能就等于废了。
  if ($('#navsections')) {
    $$('#navsections .navsec').forEach((sec) => {
      const keep = src.id === 'blend' || sec.dataset.g === src.id || sec.dataset.g === 'proactive';
      sec.classList.toggle('closed', !keep);
    });
  }
  const side = $('#side');
  if (side) {
    side.classList.toggle('blend', src.id === 'blend');
    side.style.setProperty('--tint', src.id === 'blend' ? '#7c8598' : src.c);
    side.style.setProperty('--tint2', src.tint || src.c);
  }
  if ($('#srclabel')) $('#srclabel').textContent = src.id === 'blend' ? '融合 · 全部来源' : src.nm + ' · 只看它';
  if ($('#fangle')) $('#fangle').innerHTML = icon(src.g);
  $$('#fanitems .fani').forEach((b) => b.classList.toggle('on', b.dataset.s === src.id));
  paintNavAvailability();
}

// ══════════════════════════════════════════════════════════
// 功能按「来源」放行
// ══════════════════════════════════════════════════════════
/**
 * 读者 2026-10-09 定的规矩（原话）：
 *   「如果我选择的源**有**这个功能，这个功能才能点击；没有的话，这个功能就**灰色点不了**，
 *     而且提示**现在的知识库（源）不支持这个功能**。」
 *
 * 怎么算"有"：一个功能如果**读的是知识库**，而当前来源在库里**一条内容都没有**，
 * 那它点开只会是一片空白 —— 空白和"坏了"长得一模一样，所以宁可不给点，并说清为什么。
 *
 * ⚠️ 只有**读知识库**的那几个（推荐/搜索/主题/词条/链接）受这条约束。
 *    语音 / 文字 / 结构流 / 主动 / 用量 / 工作区**不**受约束 ——
 *    它们不是"没有就不干活"，只是检索的面窄一点，把它们灰掉是过度惩罚。
 * ⚠️ 「融合」= 全部来源 ⇒ 永远算"有"（它是所有库的并集）。
 */
const KB_FEATURES = { rec: '推荐', search: '搜索', tax: '主题', vocab: '词条', links: '链接' };
let spaceCount = null;               // { learn: 307, … } —— /api/stats 的 bySpace；null = 还不知道

function srcHasKb(src = curSrc()) {
  if (!src.spaces.length) return true;                       // 融合 = 全部来源
  // ⚠️ 还没读到统计（或读失败了）⇒ **不拦**。反过来的话，
  //    统计接口抖一下就会把半栏功能灰掉，而那是**静默的过度惩罚**：
  //    用户只会觉得"这软件又坏了"，不会知道是没读到数。
  if (!spaceCount) return true;
  return src.spaces.some((sp) => (spaceCount[sp] ?? 0) > 0);
}

/** 这个功能现在能不能点？不能就返回**为什么**（一句给人看的话）。 */
function navBlocked(v) {
  if (!(v in KB_FEATURES)) return null;
  if (srcHasKb()) return null;
  const s = curSrc();
  return '现在的知识库（' + s.nm + '）里还没有内容 ——「' + KB_FEATURES[v] + '」读的就是它。' +
    '先点上面的「同步」把内容取回来，或者点左下角那颗按钮切回「融合」。';
}

/**
 * ⭐⭐ 读者 2026-10-10：「只有**融合**的时候这些全列全展开；如果是选择别的，
 *    例如 notion 的时候只显示 notion 自己的那些功能拉开、以及**必要的那些例如主动那些**，
 *    但是**其他的都点不动**」。
 *
 * ⚠️ 「主动」那块**永远放行** —— 他点名了它。除此之外只亮当前来源自己的。
 * ⚠️ 判据是**分区**（`data-sec`），不是视图名 —— 用视图名的话以后加一个功能就得回来补一处。
 */
const ALWAYS_OK = new Set(['proactive']);
function srcBlocked(section) {
  const s = curSrc();
  if (s.id === 'blend') return null;                 // 融合 = 全部来源 ⇒ 全放行
  if (!section || ALWAYS_OK.has(section)) return null;
  if (section === s.id) return null;
  return '现在只看「' + s.nm + '」—— 这个功能属于别的地方。点左下角那颗按钮切回「融合」就都能用了。';
}

function paintNavAvailability() {
  $$('.nv[data-v]').forEach((b) => {
    const why = srcBlocked(b.dataset.sec) || navBlocked(b.dataset.v);
    b.classList.toggle('na', !!why);
    // ⚠️ **不要**给 `aria-disabled="true"`。
    //    它确实点不了**事**（点一下只会告诉你为什么），但它**能点** —— 而
    //    `aria-disabled` 的语义是"这个控件不可用"，屏幕阅读器会跳过它、自动化工具会拒绝点它
    //    （实测 Playwright 直接超时），于是那句"为什么不给点"就永远说不出口了。
    //    灰靠 `.na` 这个类表达，原因靠 `title` + 点一下的 toast 表达。
    if (why) b.title = why; else b.removeAttribute('title');
  });
}

async function loadSpaceCount() {
  try {
    const s = await api('/api/stats');
    spaceCount = Object.fromEntries((s.bySpace || []).map((x) => [x.space, x.n]));
  } catch { spaceCount = null; }    // 取不到就保持"不知道"
  paintNavAvailability();
}

/** 连接器 id → 瓦片 id（两边的名字对不上：连接器叫 `wecom`，瓦片叫 `exmail`）。 */
const TILE_OF_CONNECTOR = { exmail: 'exmail', wecom: 'exmail', figma: 'figma', feishu: 'feishu', adb: 'adb' };

/**
 * 扇区里的瓦片 —— 位置按 `fanSlots()` 算成 x/y 偏移写在 CSS 变量上。
 *
 * ⭐ 读者 2026-10-10：「**安装之后要反馈到左下角和侧边栏**」
 *    ⇒ 这里除了内置的那几个数据来源，还会**长出只有功能、没有数据的瓦片**
 *      （比如你从一个本机软件那儿装了个功能，它本身不是可检索的来源）。
 *      ⚠️ 那种瓦片**不能**静静地点一下就变成"融合" —— 那会让用户以为"这个来源里没内容"。
 *         它标成"只带来功能"，点它**说出来**，不偷偷改当前来源。
 */
async function renderSources() {
  const box = $('#fanitems');
  if (!box) return;
  // 哪些软件带功能（按软件分组的那份表）—— 用它给瓦片加角标，也用它长出新的瓦片
  let bySoft = {};
  try {
    const f = await api('/api/features');
    for (const g of f.groups || []) bySoft[g.id] = { name: g.name, icon: g.icon, n: (g.items || []).length };
  } catch { /* 拿不到就不加角标，别让整颗按钮崩 */ }

  const tiles = SOURCES.slice();
  // ⚠️ 这几个是功能的**归属**，不是**可搜的数据来源** —— 放进来只会让人点一下
  //    然后被告知"它不是来源"，纯属添乱。（它们各自的功能在侧栏里都有。）
  const NOT_A_SOURCE = new Set(['blend', 'all', 'local', 'builtin', 'user']);
  for (const [id, g] of Object.entries(bySoft)) {
    if (tiles.some((t) => t.id === id) || NOT_A_SOURCE.has(id)) continue;
    tiles.push({ id, nm: g.name, g: g.icon, c: '#6b7280', spaces: [], onlyFeature: true });
  }
  const sl = fanSlots(tiles.length);
  box.innerHTML = tiles.map((x, i) => {
    const s = sl[i] ?? { r: 236, a: 45 };
    // ⚠️ 这两个数不要叫 x / y —— 上面 map 的参数就叫 x，`const x` 会
    //    「Identifier 'x' has already been declared」，而那是**加载期**报错：
    //    整个 app.js 一行都不执行，页面看起来只是"空"，不是"崩"。
    const ox = Math.round(s.r * Math.cos((s.a * Math.PI) / 180));
    const oy = Math.round(s.r * Math.sin((s.a * Math.PI) / 180));
    const n = bySoft[x.id]?.n ?? 0;
    return '<button class="fani' + (s.core ? ' core' : '') + (x.onlyFeature ? ' nofeed' : '') +
      '" data-s="' + x.id + '"' + (x.onlyFeature ? ' data-only="1"' : '') +
      ' style="--c:' + x.c + ';--x:' + ox + 'px;--y:' + oy + 'px;--i:' + i + '"' +
      ' title="' + esc(x.nm) + (x.onlyFeature ? '（只带来功能，还不是一个数据来源）' : '') + '">' +
      '<span class="g">' + icon(x.g) + '</span><i>' + esc(x.nm) + '</i>' +
      (n ? '<b class="fcnt">' + n + '</b>' : '') + '</button>';
  }).join('');
  $$('#fanitems .fani').forEach((b) => (b.onclick = () => {
    if (b.dataset.only) {
      // ⚠️ 说出来，别偷偷当成"融合" —— 那会让人以为"这个来源里一条都没有"
      return toast(b.textContent.trim() + ' 还不是一个数据来源，它只带来功能', 'bad');
    }
    srcId = b.dataset.s;
    localStorage.setItem('c4emem.src', srcId);
    paintSources();
    toggleFan(false);            // 选完就收回去，不然一直挡着
  }));
  paintSources();
  // 能接但还没配的，瓦片上给个提示（**不是**灰掉就算 —— 灰掉不说明缺什么）
  try {
    const r = await api('/api/sources');
    for (const it of r.items ?? []) {
      const b = $('#fanitems .fani[data-s="' + (TILE_OF_CONNECTOR[it.id] ?? it.id) + '"]');
      if (b && !it.ok) { b.classList.add('off'); b.title = it.label + '：' + it.why; }
    }
  } catch { /* 接口不在不该让整颗按钮崩 */ }
}

// ══════════════════════════════════════════════════════════
function toggleFan(open) {
  const f = $('#fan');
  if (!f) return;
  const next = open ?? !f.classList.contains('open');
  f.classList.toggle('open', next);
  document.body.classList.toggle('fanopen', next);
  $('#fanbtn')?.setAttribute('aria-expanded', String(next));
}
function bindFan() {
  const veil = document.createElement('div');
  veil.className = 'fanveil';
  document.body.appendChild(veil);
  veil.onclick = () => toggleFan(false);
  $('#fanbtn').onclick = (e) => { e.stopPropagation(); toggleFan(); };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleFan(false);
  });
}

// ═══ 两栏都能收起（收起后全铺内容）═══════════════════════
function paintCollapse() {
  const railOff = localStorage.getItem('c4emem.rail') === 'off';
  const recOff = localStorage.getItem('c4emem.rec') === 'off';
  document.body.classList.toggle('rail-off', railOff);
  document.body.classList.toggle('rec-off', recOff);
  const bar = $('#restorebar');
  if (bar) bar.hidden = !(railOff || recOff);
  if ($('#rsRail')) $('#rsRail').hidden = !railOff;
  if ($('#rsRec')) $('#rsRec').hidden = !recOff;
  // ⚠️ 恢复条钉在 `.main` 左上角，而结构流工具栏也从那儿开始 —— 不让位就叠在一起
  //    （读者截图里「卡片」被压掉一半）。让位量必须**量**出来：条里是 1 颗还是 2 颗按钮，
  //    宽度差一倍，写死任何一个都会在另一种情况下又不准。
  requestAnimationFrame(() => {
    const w = bar && !bar.hidden ? bar.getBoundingClientRect().width : 0;
    document.body.style.setProperty('--restorew', Math.round(w) + 'px');
  });
  if (orb) setTimeout(() => orb.resize?.(), 60);
}
function bindCollapse() {
  // ⚠️ 窄屏时这两个 `‹` 的语义**不一样**：抽屉是滑出来的蒙层，
  //    这一下要的是"关上它"，而不是"把这栏永久收掉"
  //    （后者会让抽屉再也滑不出来 —— 而且窄屏上看不出区别）。
  $('#railBtn').onclick = () => {
    if (NARROW.matches) return closeDrawers();
    localStorage.setItem('c4emem.rail', 'off'); paintCollapse();
  };
  $('#recBtn').onclick = () => {
    if (NARROW.matches) return closeDrawers();
    localStorage.setItem('c4emem.rec', 'off'); paintCollapse();
  };
  $('#rsRail').onclick = () => { localStorage.removeItem('c4emem.rail'); paintCollapse(); };
  $('#rsRec').onclick = () => { localStorage.removeItem('c4emem.rec'); paintCollapse(); };
  paintCollapse();
}

// ═══ 窄屏：两栏变抽屉（<900px）═══════════════════════════
//
// ⚠️ 和上面那套 `rail-off` / `rec-off` 是**两回事**：那套是「整栏 display:none」，
//    这套是「滑进滑出 + 遮罩」。断点 900 的依据写在 app.css 末尾。
// ⚠️ 为什么必须有这套：`.side` 186 + `.dash` 312 = 498 固定宽，
//    视口窄过它 `.main` 就被挤成 0 宽 —— 实测 390px 时工作区整个在屏幕外，
//    而 `.modes` 是 `.main` 里的 absolute ⇒ 直接画到记录栏上面去了
//    （读者截图里那排「语音/文字/结构流」压在记录栏标题上）。
const NARROW = window.matchMedia('(max-width: 899px)');

function paintDrawerBtns() {
  const n = $('#navOpen');
  if (n) n.classList.toggle('on', document.body.classList.contains('navopen'));
  const r = $('#recOpen');
  if (r) r.classList.toggle('on', document.body.classList.contains('recopen'));
}
function closeDrawers() {
  document.body.classList.remove('navopen', 'recopen');
  paintDrawerBtns();
}
function toggleDrawer(which) {
  const wasOpen = document.body.classList.contains(which + 'open');
  // ⚠️ 先全关再开 —— 两个抽屉都是 `left:0`，同时开会互相盖住
  document.body.classList.remove('navopen', 'recopen');
  if (!wasOpen) document.body.classList.add(which + 'open');
  paintDrawerBtns();
  if (orb) setTimeout(() => orb.resize?.(), 240);
}
function paintNarrow() {
  document.body.classList.toggle('narrow', NARROW.matches);
  // ⚠️ 回到宽屏时**一定要把 open 类摘掉**：不摘的话 body 上还留着 `navopen`
  //    （宽屏没有对应规则，所以完全看不出来），等再切回窄屏抽屉就自己开着 ——
  //    中间那一步一切正常，坏的是**隔一次**才显形。
  if (!NARROW.matches) closeDrawers();
  if (orb) setTimeout(() => orb.resize?.(), 60);
}
function bindNarrow() {
  NARROW.addEventListener('change', paintNarrow);
  $('#navOpen').onclick = () => toggleDrawer('nav');
  $('#recOpen').onclick = () => toggleDrawer('rec');
  $('#drawerscrim').onclick = closeDrawers;
  // 在抽屉里点了一个导航项 ⇒ 把抽屉收回去（窄屏上不收的话，
  // 你得先手动关掉才看得见刚打开的那一屏）
  $('#side').addEventListener('click', (e) => {
    if (e.target.closest('.nv')) closeDrawers();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawers();
  });
  paintNarrow();
}

// ⚠️ 这里原来有一份 KINDS（voice/text/flow 那种扁平列表）。
//    现在 KINDS 在下面的结构流模块里，带着 in/out 端口类型 —— **只能有一份**，
//    留两份的后果是 `Identifier 'KINDS' has already been declared`，
//    而那是**加载期**语法错误：整个 app.js 一行都不执行，页面看起来只是"空的"。


// ══════════════════════════════════════════════════════════
// 内容栏：三种模式 + 知识视图，共用这一栏
// ══════════════════════════════════════════════════════════
const MODES = ['voice', 'text', 'flow'];
let mode = 'voice';
let kbView = null; // 非空时内容栏显示知识视图而不是模式
// 「自我改进」里选中的那个软件。⚠️ 存在模块里、不是渲染时现算 ——
// 重画一遍（比如点了刷新）不该把你刚选的软件忘掉。
let siAppSel = null;

function show(v) {
  if (MODES.includes(v)) {
    kbView = null;
    mode = v;
    $('#m-kb').hidden = true;
    MODES.forEach((x) => ($('#m-' + x).hidden = x !== v));
    if (v === 'voice') { ensureOrb(); requestAnimationFrame(orbRecenter); }
    if (v === 'flow') { renderFlow(); bindCanvas(); if (!didFit) { didFit = true; setTimeout(fitFlow, 50); } }
    if (v === 'text') setTimeout(() => $('#tinput')?.focus(), 30);
  } else {
    kbView = v;
    renderKb();
  }
  $$('.nv').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  // ⚠️⚠️ 右上角那三个 thumb 用的是 `data-m`，**不是** `data-v` —— 上面那句只覆盖侧栏。
  //    漏掉这句的后果：thumb 的 `.on` 从来不动，而 app.html 里写死的是 `class="thumb on"`
  //    在**语音**那颗上 ⇒ **语音永远亮着**，看起来像"点了文字/结构流，还是语音被选中"。
  //    （它就是坏了很久没人发现：切模式功能是好的，只有这颗灯不跟着走。）
  $$('#modes .thumb').forEach((b) => b.classList.toggle('on', b.dataset.m === v));
}
const cycle = () => show(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
$$('#modes .thumb').forEach((b) => (b.onclick = () => show(b.dataset.m)));
// ══════════════════════════════════════════════════════════
// 侧栏 = 功能注册表的投影（见 src/features.ts 开头）
// ══════════════════════════════════════════════════════════
//
// 读者三条要求，都落在这里：
//   ① 「抽屉式样的，以时间顺序或者以软件来分区…因为每个软件（源）的功能和接的越来越多」
//      ⇒ `.navsec` 是可折叠的**分区**，折叠状态记在 localStorage
//   ② 「所有的功能都有归属…把功能的后边对应加上—来源的图标，不然会乱套」
//      ⇒ 每一行右边那个 `.srcbadge`（图标来自注册表的 `source`）
//   ③ 「所有的功能都有删除的能力」⇒ 装进来的那些带 `.fdel`

/**
 * ⚠️⚠️ **每次重画之后必须重新接事件。**
 *    `onclick` 是挂在**元素**上的，`innerHTML = …` 会把它们连同旧元素一起扔掉。
 *    症状是"点了没反应"，而且**不报错、控制台干净** —— 和"这个功能坏了"长得一样。
 */
let navGroups = [];

/** 角标那句话。⚠️ 别都用"来自 X" —— 三种归属的**意思**完全不一样。 */
function srcHint(it) {
  if (it.source === 'builtin') return '不依赖任何来源 —— 接不接东西它都一样用';
  if (it.source === 'all') return '靠全部已接入的来源吃饭 —— 少接一个，它就少看一块';
  return '来自 ' + (it.sourceLabel || it.source) + '：接上它才有这个功能';
}

function navBtn(it) {
  return '<button class="nv" data-v="' + esc(it.view) + '" data-fid="' + esc(it.id) +
    '" data-sec="' + esc(it.section || it.source) + '" title="' + esc(it.hint || it.name) + '">' +
    icon(it.icon) +
    '<span class="nvl">' + esc(it.name) + '</span>' +
    // ⚠️ 角标要说清是**哪种归属** —— 第一版只写"来自 内置"，读起来像一句废话。
    //    「不依赖来源」和「靠全部来源」是两件完全不同的事，别用同一句话糊过去。
    '<span class="srcbadge src-' + esc(it.source) + '" title="' + esc(srcHint(it)) + '">' + icon(it.sourceIcon) + '</span>' +
    // ⭐ 读者 2026-10-10：「所有功能如果点 × 之前要**确认是暂时关闭不显示还是卸载**」
    //    ⇒ × 不再是"直接删"，而是**打开一个二选一**（见 openFeatureMenu）。
    //    内置的也有这个 ×（它只能"暂时关闭"）—— 没有 × 的话用户会以为"内置的动不了"。
    '<span class="fdel" data-feat-menu="' + esc(it.id) + '" data-feat-name="' + esc(it.name) +
      '" data-feat-removable="' + (it.removable ? '1' : '') + '" title="关掉它 / 卸载它">×</span>' +
    '</button>';
}

/**
 * ⭐⭐ 点 × 之后的那一步 —— **暂时关闭**还是**卸载**（读者 2026-10-10）。
 *
 * ⚠️⚠️ 为什么不直接删：这两件事的**后果完全不同**，而用户看不出区别的话
 *    会默认"× = 删掉"，于是再也不敢点（这个项目里"可逆但看不出可逆"栽过）。
 *    · 暂时关闭 —— 还在，只是从侧栏收起来；这里一个开关就打开。
 *    · 卸载     —— 进「待安装」，**保留 30 天**，一键装回来。
 * ⚠️ 内置功能**只给"暂时关闭"**，而且**说明为什么** ——
 *    它的代码在仓库里，给一个按下去没用的"卸载"比不给更糟。
 */
function openFeatureMenu(id, name, removable) {
  const back = document.createElement('div');
  back.className = 'modal';
  back.id = 'featmenu';
  back.innerHTML =
    '<div class="mbox"><div class="mtitle">' + esc(name) + '</div>' +
    '<div class="mbody">' +
      '<div class="k" style="line-height:1.9">这一下有两种做法，它们不一样：</div>' +
      '<div class="opt"><b>暂时关闭</b><div class="k">从侧栏收起来，功能还在。想用了到「自我改进 → 功能管理」一按就回来。</div>' +
        '<button class="go sm" id="fmOff">暂时关闭</button></div>' +
      (removable
        ? '<div class="opt"><b>卸载</b><div class="k">从"已装"里移走，进「待安装」<b>保留 30 天</b>，一键就能装回来。过了 30 天才真没。</div>' +
          '<button class="go sm warn" id="fmDel">卸载</button></div>'
        : '<div class="opt"><b>卸载</b><div class="k">⚠️ 这是<b>内置功能</b>，代码在程序里，卸不掉 —— 所以只给它「暂时关闭」。' +
          '上面那一下就能让它从侧栏消失。</div></div>') +
    '</div>' +
    '<div class="macts"><button class="ghost" id="fmCancel">算了</button></div></div>';
  document.body.appendChild(back);
  const close = () => back.remove();
  back.onclick = (e) => { if (e.target === back) close(); };
  back.querySelector('#fmCancel').onclick = close;
  back.querySelector('#fmOff').onclick = async () => {
    close();
    const r = await post('/api/features/toggle', { id, off: true });
    if (r.error) return toast(r.error, 'bad');
    toast('「' + name + '」已从侧栏收起来 —— 想用了在「自我改进 → 功能管理」里打开', 'good');
    await renderNav();
    if (kbView === id) show('voice');
  };
  const del = back.querySelector('#fmDel');
  if (del) del.onclick = async () => { close(); await removeFeature(id, name); };
}

/**
 * ⭐⭐ 「把这个软件**全部断联**」（读者 2026-10-10）。
 *
 * ⚠️⚠️ 这不是"卸载你电脑上的那个软件"，也不是"删掉那些数据" ——
 *    拿掉的是**我们这个软件里**为了用它而装的那些功能。
 *    文案里必须把这三件事分开说，否则用户不敢按（或者按了之后以为数据没了）。
 * ⚠️ 按之前先去问一句"要动几个" —— 断一个来源可能一次动十几个功能，
 *    而这个数字只有服务端算得准（界面手里那份是按分区分的，不是按归属）。
 */
async function openDisconnect(source, name) {
  const info = await api('/api/features/source?source=' + encodeURIComponent(source)).catch(() => null);
  const back = document.createElement('div');
  back.className = 'modal';
  back.id = 'discmenu';
  back.innerHTML =
    '<div class="mbox"><div class="mtitle">断开「' + esc(name) + '」</div>' +
    '<div class="mbody">' +
      '<div class="k" style="line-height:1.9">' +
      '要拿掉的是它带来的 ' + (info?.total ?? '?') + ' 个功能' +
      (info?.names?.length ? '（' + esc(info.names.join('、')) + '）' : '') + '。<br>' +
      '⚠️ <b>不动你电脑上的那个软件，也不删已经收进来的数据。</b><br>' +
      '装进来的那些进「待安装」，<b>保留 30 天</b>，一键装回来；' +
      '内置的从侧栏收起来（代码在程序里，卸不掉）。</div>' +
    '</div>' +
    '<div class="macts"><button class="go warn" id="dcGo">断开</button>' +
    '<button class="ghost" id="dcNo">算了</button></div></div>';
  document.body.appendChild(back);
  const close = () => back.remove();
  back.onclick = (e) => { if (e.target === back) close(); };
  back.querySelector('#dcNo').onclick = close;
  back.querySelector('#dcGo').onclick = async () => {
    close();
    const r = await post('/api/features/disconnect', { source });
    if (r.error) return toast('没断掉：' + r.error, 'bad');
    toast('断开了「' + name + '」：卸载 ' + (r.removed || []).length + ' 个（保留 30 天）· 收起 ' + (r.off || []).length + ' 个', 'good');
    await renderNav(); await renderSources();
    renderKb();
  };
}

const navClosed = () => {
  try { return JSON.parse(localStorage.getItem('c4emem.navclosed') || '{}'); } catch { return {}; }
};

async function renderNav() {
  const host = $('#navsections');
  if (!host) return;
  let d;
  try { d = await api('/api/features'); } catch { return; }
  navGroups = d.groups || [];
  const closed = navClosed();
  host.innerHTML = navGroups.map((g) =>
    '<div class="navsec' + (closed[g.id] ? ' closed' : '') + '" data-g="' + esc(g.id) + '">' +
      '<button class="sech" data-sec="' + esc(g.id) + '" aria-expanded="' + (closed[g.id] ? 'false' : 'true') + '">' +
        // ⭐ 读者 2026-10-10：「侧边栏要按照软件（zen 的侧边栏那种**一个一个的软件图标**）」
        //    ⇒ 每一节的头是「软件图标 + 软件名 + 有几个功能」，点开在**下边**列出功能。
        '<svg class="ic chev"><use href="#i-right"/></svg>' +
        '<span class="si">' + icon(g.icon || 'help') + '</span>' +
        '<span>' + esc(g.name) + '</span>' +
        '<span class="n">' + g.items.length + '</span></button>' +
      '<div class="secb">' + g.items.map(navBtn).join('') + '</div>' +
    '</div>').join('');
  bindNav();
  // ⚠️ 重画之后要**重新算一遍灰不灰** —— 它按 `.nv[data-v]` 找元素，
  //    旧元素已经没了，不补这一下新画出来的全是亮的。
  paintNavAvailability();
}

function bindNav() {
  $$('#navsections .nv').forEach((b) => (b.onclick = (e) => {
    // ⚠️ 点到「×」要**先拦下来**，否则会连带把这个功能打开。
    //    ⭐ 现在它开的是**二选一**（暂时关闭 / 卸载），不是直接删。
    const del = e.target.closest && e.target.closest('[data-feat-menu]');
    if (del) { e.stopPropagation(); e.preventDefault(); return openFeatureMenu(del.dataset.featMenu, del.dataset.featName, del.dataset.featRemovable === '1'); }
    // ⚠️ 用 `.na` 类而**不是** `disabled`：禁用的按钮连 click 都不发，
    //    于是"点不动"和"点了没反应"就分不开了 —— 而这里恰恰要**说出为什么点不动**。
    const why = navBlocked(b.dataset.v);
    if (why) { toast(why, 'bad'); return; }
    show(b.dataset.v);
  }));
  $$('#navsections .sech').forEach((h) => (h.onclick = () => {
    const sec = h.closest('.navsec');
    const nowClosed = !sec.classList.contains('closed');
    sec.classList.toggle('closed', nowClosed);
    h.setAttribute('aria-expanded', String(!nowClosed));
    // ⚠️ 折叠状态要**记着** —— 每次重画都弹回展开，这个按钮就等于没用
    const st = navClosed();
    st[h.dataset.sec] = nowClosed;
    localStorage.setItem('c4emem.navclosed', JSON.stringify(st));
  }));
}

async function installFeature(id) {
  const r = await post('/api/features/install', { id });
  if (r.error) return toast('装不了：' + r.error, 'bad');
  toast(r.already ? '已经装过了' : '装好了，看左边那一栏', 'good');
  await renderNav();
}

/**
 * 卸载。⚠️ 确认那一步在 `openFeatureMenu` 里（读者要求"点 × 之前要确认"），
 *    所以这里**不再弹第二个框** —— 连着弹两个确认，第二个会被无视。
 */
async function removeFeature(id, name) {
  const r = await api('/api/features/' + encodeURIComponent(id), { method: 'DELETE' });
  if (r.error) {
    // ⚠️ 内置的**不许卸载**：这时要说清"你还能用暂时关闭"，而不是只丢一句报错
    return toast(r.builtin ? '「' + id + '」是内置的，卸不掉 —— 用「暂时关闭」让它从侧栏消失' : '没卸掉：' + r.error, 'bad');
  }
  toast('「' + (name || id) + '」卸载了 —— 保留 30 天，随时能一键装回来', 'good');
  if (kbView === id) show('voice');
  await renderNav();
}

/** ⭐ 一键装回来（「待安装」那一栏） */
async function restoreFeature(id, name) {
  const r = await post('/api/features/restore', { id });
  if (r.error) return toast('装不回来：' + r.error, 'bad');
  toast('「' + (name || id) + '」装回来了', 'good');
  await renderNav();
}

/** ⭐ 暂时关闭 / 打开这个开关 */
async function toggleFeatureOff(id, off, name) {
  const r = await post('/api/features/toggle', { id, off });
  if (r.error) return toast(r.error, 'bad');
  toast(off ? '「' + (name || id) + '」收起来了' : '「' + (name || id) + '」打开了', 'good');
  await renderNav();
}

// ══════════════════════════════════════════════════════════
// 语音
// ══════════════════════════════════════════════════════════
let sid = null;   // 当前会话 —— 续聊靠它
/**
 * ⚠️ 请求序号：**恢复会话/新建对话时要把还在飞的请求作废**。
 *    不然会出现：你点了历史记录，旧的回答才回来，往刚铺好的对话里插一个"…"气泡 ——
 *    看起来像"恢复出来的内容错了"。这是我自己引入的竞态，靠它挡掉。
 */
let reqSeq = 0;
let orb = null, audioCtx = null, micStream = null, analyser = null, raf = 0, micOn = false, muted = false;
const hasSTT = () => typeof window.webkitSpeechRecognition === 'function' || typeof window.SpeechRecognition === 'function';

/**
 * ⭐⭐ 光球的两个来源（读者 2026-10-10 原话：
 *    「我给你的那几个 3D 的珍珠玻璃、岩石……**你自己去获取到链接然后一模一样拿下来，
 *      而不要自己渲染**，你现在渲染的这几个球非常难看，替换好」）。
 *
 *  · `pearl` / `stone` —— **真素材**：那两个 Dribbble shot 里的原始 mp4。
 *     我们只做了两件事：**裁成正方形**（按实测出来的球体/面板包围盒）+ **转码压小**。
 *     **一个像素都没有重画。** 来源与做法见 `src/ui/assets/README.md`。
 *  · `lime` —— 仍是着色器：它参考的是 Deepgram，本来就不在这两段素材里。
 *
 * ⚠️ 这两段素材是**别人的作品**（两个 shot 都标 All rights reserved）。
 *    自己用没问题；这个软件要是发给别人，先把 `ORB_VIDEO` 清空 ——
 *    清空之后会自动回落到着色器，不需要改别的地方。
 */
// ⚠️ `crystal` 取代了原来的 `stone` —— 读者 2026-10-10：「找一个好的岩石 3D，
//    就一块岩石或者**水晶也可以，可以转动**，**现在的不好**」。
//    新素材是 Pixabay 上的一块**黑底水晶**（素材页 gemstone 那个 shot），
//    裁剪框是**按整段旋转的并集包围盒**量的（不是只看一帧 —— 只看一帧会把它转出框切掉）。
//    来源/许可/裁法见 src/ui/assets/README.md。
// ⭐ 2026-10-10：读者「岩石改为 https://www.cominvi.com.mx/ 这个网站上直接获取，
//    我想 silver lead zinc 的 3D 都要，你要完全一模一样，**分成三份**」。
//    ⇒ 那三个**真素材**（见 assets/README.md 的出处与取法）。
//    ⚠️ `crystal` **拿下了**（它就是被替换掉的那块"岩石"）—— 文件还在 assets 里，
//       只是不再出现在选择器里；要回退把它加回这张表 + app.html 的 <option> 即可。
const ORB_VIDEO = {
  pearl: '/ui/assets/pearl-orb.mp4',
  // ⚠️⚠️ 矿物这三个用的是 **`-loop.mp4`**，不是当初拆出来的那份原片。
  //    原片（`-orig`，还留着）**每一帧的时间戳都是同一个值**（`pkt_pts_time` 全是
  //    0.041667，实测）—— 那个自制 `.af` 容器拆出来的时候没有时间轴。
  //    浏览器只能猜着放 ⇒ **后段越来越快、抽风、和下一轮接不上**（读者就是这么报的）。
  //    `-loop.mp4` 重新给了 24fps 的规整时间轴，而且做成**正放+倒放的来回**
  //    ⇒ 循环点天然无缝（结尾那一帧就是开头那一帧）。见 assets/README.md。
  silver: '/ui/assets/mineral-silver-loop.mp4',
  lead: '/ui/assets/mineral-lead-loop.mp4',
  zinc: '/ui/assets/mineral-zinc-loop.mp4',
};
/**
 * ⭐ 这三个的素材是**白底**的，要**抠掉白底**再显示（读者 2026-10-10：
 *   「银铅锌要都没有背景抠出来」）。
 * ⚠️ 显示出来的是 `#orbkey` 那块画布，`<video>` 仍**照常播**（它是纹理源，变速也靠它）
 *    —— 不能改成"事先转一个带 alpha 的动图"，那样就没有 `playbackRate` 可改了。
 *    完整理由见 src/ui/vkey.js 的文件头。
 */
const ORB_KEYED = { silver: 1, lead: 1, zinc: 1 };
let orbKeyer = null;
// ⚠️ 这三种是「矿物标本」：素材自带**近白底**（实测四角都是 253,253,253）。
//    我们**没有去抠它** —— 抠一张有损压缩过的近白底会在边缘留下一圈白毛
//    （贴到深色界面上就是一道白光），比留着底难看；
//    而且原站自己也是把它们摆在米白卡片上的 —— 跟着它，不做二次加工。
//    ⇒ 样式靠 app.css 里 `[data-form="silver|lead|zinc"]` 那组规则，
//      JS 这边**不需要**再记一份名单（两份名单必然会漂移）。
/**
 * 「CEVTUO 卡片」—— **主形态**（读者 2026-10-10：「柠檬绿盘不要了改为 cevtuoforecard，
 * 这个作为主选项，它要有一点厚度和打光，像真实的一样」）。
 * 卡面用的是他给的那张原图的**裁剪**（`src/ui/assets/card.png`，按量出来的卡边
 * x39→688 / y38→1049 切的），不是重画的。
 */
const ORB_CARD = 'card';
let orbVariantName = ORB_CARD;
let orbReady = false;

// ── 卡片的厚度 / 旋转 ─────────────────────────────────────────
// ⚠️ 厚度是**叠层**叠出来的：同一个圆角矩形沿 Z 轴放 10 层、每层暗一点点。
//    只放正反两面的话，转到侧面就是一张**没有边**的纸。
// ⚠️ 读者 2026-10-10：「卡片的质感不太好，**可能太薄了**」
//    ⇒ 层数 10→18、半厚 4px→**6px**（总厚 12px），而且**越靠外压得越暗**（0.22→0.30）——
//      亮度梯度才是"一块实心材料"，原来那点梯度看着像一张纸。
// ⚠️ 厚度必须能**按尺寸缩放**（`--ckz`，见 app.css）：Pet 里那张卡只有 58px 宽，
//    同样 12px 的边就是一块砖。
const CARD_LAYERS = 18;
const CARD_HALF = 6;
let ckAngle = 0, ckLast = 0, ckSpeed = 5, ckRunning = false, ckLevel = 0;
function buildCard(el = $('#ck'), half = CARD_HALF, layers = CARD_LAYERS) {
  if (!el || el.dataset.built) return;
  el.dataset.built = '1';
  let html = '<div class="sh"></div>';
  for (let i = 0; i < layers; i += 1) {
    const z = -half + (2 * half * i) / (layers - 1);
    // 越靠外的那一层越暗 —— 侧过来看就是一条从亮到暗的卡边
    const k = (1 - Math.abs(z / half) * 0.30).toFixed(3);
    html += `<i class="ed" style="transform:translateZ(${z.toFixed(2)}px);filter:brightness(${k})"></i>`;
  }
  html += '<i class="fr"></i><i class="bk"></i><i class="gl"></i>';
  el.innerHTML = html;
}
function ckTick(now) {
  if (!ckRunning) return;
  const dt = ckLast ? Math.min(0.05, (now - ckLast) / 1000) : 0;
  ckLast = now;
  // ⚠️ 转速：读者原话「当说话或者打字的时候可以旋转，但**速度不要太快**，
  //    现在跟飞起一样」。所以待机很慢（约 40 秒一圈），说话时才明显快起来，
  //    而且**音量越大转得越快一点点** —— 但封顶，不给人"失控"的感觉。
  const speed = ckSpeed + ckLevel * 14;
  ckAngle = (ckAngle + speed * dt) % 360;
  const el = $('#ck');
  if (el) {
    el.style.setProperty('--ry', ckAngle.toFixed(2) + 'deg');
    // 高光**不跟着卡转**：它按角度在一小段范围内来回扫 —— 这才像"光在左边没动，是卡在转"
    const gl = el.querySelector('i.gl');
    if (gl) gl.style.backgroundPosition = (50 + 46 * Math.sin((ckAngle * Math.PI) / 180)).toFixed(1) + '% 50%';
    // ⭐ 地面投影跟着角度走：正面（|cos| 大）时宽而淡，侧过来时窄而深。
    //    ⚠️ 少了这一条，卡片转一整圈投影纹丝不动 —— 那是"贴纸"，不是"立在桌上"。
    const c = Math.abs(Math.cos((ckAngle * Math.PI) / 180));
    const sh = el.querySelector('.sh');
    if (sh) {
      sh.style.setProperty('--shw', (0.34 + 0.66 * c).toFixed(3));
      sh.style.setProperty('--sho', (0.20 + 0.42 * c).toFixed(3));
    }
  }
  requestAnimationFrame(ckTick);
}
function ckStart(on) {
  buildCard();
  ckRunning = !!on;
  ckLast = 0;
  if (on) { $('#ck')?.classList.add('breathe'); requestAnimationFrame(ckTick); }
  else $('#ck')?.classList.remove('breathe');
}

function setOrbVariant(name) {
  orbVariantName = name;
  orb?.setVariant(name);
  const box = document.querySelector('.orbbg');
  const vid = $('#orbvid');
  if (!box || !vid) return;
  const card = name === ORB_CARD;
  const src = card ? '' : ORB_VIDEO[name];
  box.dataset.form = name;          // CSS 按它决定要不要羽化（见 app.css）
  // ⚠️ 类名是 `ckon` 而**不是** `card` —— `.card` 撞上了知识库那条通用卡片样式
  //    （白底 + padding），会把光球那一层悄悄改掉。见 app.css 里的长注释。
  box.classList.toggle('ckon', card);
  ckStart(card);
  if (src) {
    if (!String(vid.src).endsWith(src)) vid.src = src;
    box.classList.add('vid');
    // ⚠️ 带声音的视频会被浏览器拦下来。素材本来也没有音轨，静音是**如实**的。
    vid.play().catch(() => {});
  } else {
    box.classList.remove('vid');
    vid.pause();
  }
  // ⭐ 矿物标本：白底在这一层被抠掉。`<video>` 不隐藏、只是被 `#orbkey` 盖住
  //    —— 它还得继续播，纹理和变速率都从它身上来。
  const cv = $('#orbkey');
  if (ORB_KEYED[name] && cv) {
    // ⚠️ 建不起来（老机器/没 WebGL）不能把整颗球弄没：落回**原样显示那段视频**
    //    （白底还在，但至少看得见）。"降级"和"坏掉"必须长得不一样。
    if (!orbKeyer) {
      try {
        orbKeyer = createKeyer(cv, vid);
        // 自检挂钩：`stats()` 是**唯一**能读回那一帧像素的入口（见 vkey.js 的注释）
        window.__orbKeyer = orbKeyer;
      } catch (e) { console.warn('抠图起不来，这一段按原样显示：' + e.message); box.dataset.keyfail = '1'; }
    }
    orbKeyer?.start();
  } else {
    orbKeyer?.stop();
  }
}
/** 状态：WebGL 那边改着色器，视频那边只加一个类（**不碰它的画面内容**）。 */
function orbState(name) {
  orb?.setState(name);
  document.querySelector('.orbbg')?.classList.toggle('think', name === 'thinking');
  // 卡片的转速按状态给：待机 5°/s（约 72 秒一圈，肉眼几乎察觉不到），
  // 说话 26°/s，在想 34°/s —— **都封在"能看清卡面"的范围内**。
  ckSpeed = name === 'listening' ? 26 : name === 'thinking' ? 34 : 5;
}
/**
 * 音量：⚠️ 对视频**只做整体缩放**，不去改它的纹理/颜色/形变 ——
 * 改了就不是那段素材了，而那正是读者要的"一模一样"。
 */
/**
 * 音量 → 动得快慢。
 *
 * ⭐ 读者 2026-10-10：「**即使是视频你也要做成变速**，card 更是，**根据语音的速度来调整**，
 *    **最快速度不要过快**」。
 * ⚠️ 所以两头都要封：
 *    · 视频 `playbackRate` 只走 **0.55 ~ 1.6** —— 低于 0.5 会卡成幻灯片，高于 2 就是"飞起"；
 *    · 卡片转速的**基础值仍按状态给**（待机本来就是慢的），音量只**加一点点**（封顶 +14°/s）。
 *    "封顶"不是保守 —— 读者上一句刚说过"现在跟飞起一样"。
 */
function orbLevel(v) {
  orb?.setLevel(v);
  const lvl = Math.min(1, Math.max(0, v));
  ckLevel = lvl;
  const vid = $('#orbvid');
  if (vid) {
    vid.style.setProperty('--orbl', String(1 + lvl * 0.06));
    // ⚠️ 别在 `pause()` 的时候去写 rate —— 有些浏览器会顺手把它 play 起来
    // ⚠️ 上限压到 **0.95**（原来 1.6）：读者 2026-10-10「后边太快很抽风」。
    //    时间轴修好之后，再让它跑到 1.6 倍就是"我加出来的快"，不是素材的问题了。
    //    下界 0.45 是因为再慢会看成幻灯片。
    if (!vid.paused) vid.playbackRate = 0.45 + lvl * 0.5;
  }
}

function ensureOrb() {
  if (!orb) {
    try { // stage:true —— 光球铺满整屏当背景，面板浮在它上面，所以要用暗舞台
      orb = createOrb($('#orb'), { variant: orbVariantName, stage: true });
    } catch (e) { $('#vstate').textContent = '光球起不来：' + e.message; }
  }
  // ⚠️⚠️ 这一段**必须在外层、而且不受 `orb` 是否建成功影响**：
  //    WebGL 起不来的机器上 `orb` 永远是 null，把视频也一起挡在外面的话，
  //    表现是"光球整个没了"，而真相是"只是着色器那一路起不来"。
  if (!orbReady) {
    orbReady = true;
    setOrbVariant(orbVariantName);
    orbState('idle');
  }
}
async function toggleMic() {
  if (micOn) return stopMic();
  try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { return logLine('ai', '拿不到麦克风权限：' + e.message); }
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser(); analyser.fftSize = 1024;
  audioCtx.createMediaStreamSource(micStream).connect(analyser);
  micOn = true;
  $('#mic').classList.add('live');
  $('#vstate').textContent = '聆听中…';
  orbState('listening');
  const buf = new Uint8Array(analyser.fftSize);
  const tick = () => {
    if (!micOn) return;
    analyser.getByteTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
    orbLevel(Math.min(1, Math.sqrt(s / buf.length) * 4.2));
    raf = requestAnimationFrame(tick);
  };
  tick();
  startRecog();
}
function stopMic() {
  micOn = false; cancelAnimationFrame(raf);
  // ⚠️ **先 stop 录音机、后停轨道**。反过来的话最后那几百毫秒会丢，
  //    而丢掉的多半正好是句尾 —— 听起来像"识别不准"，其实是采样早停了。
  try { if (recorder && recorder.state !== 'inactive') return recorder.stop(); } catch {}
  reallyStopMic();
}
function reallyStopMic() {
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null; analyser = null;
  $('#mic')?.classList.remove('live');
  if ($('#vstate')) $('#vstate').textContent = '待机 · 点一下开始说话';
  orbState('idle'); orbLevel(0);
  recorder = null;
}
let recorder = null, recChunks = [];

/** 本地识别装没装好 —— 界面上要能把「没装」和「识别失败」分开说。 */
let sttOk = null;
async function sttReady() {
  if (sttOk !== null) return sttOk;
  try { sttOk = !!(await api('/api/stt/status')).ready; } catch { sttOk = false; }
  return sttOk;
}

/**
 * 把录到的音频转成 **16kHz 单声道 WAV** —— whisper 只吃这个。
 * ⚠️ 重采样交给 `OfflineAudioContext`，不自己写线性插值：
 *    自己写的那版在 48k→16k 上会有可听的混叠，而它**不报错**，
 *    只是识别率悄悄掉一截（听起来像"模型不行"）。
 * ⚠️ `OfflineAudioContext(1, …)` 会自动把立体声下混成单声道。
 */
async function toWav16k(blob) {
  const ac = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  const buf = await ac.decodeAudioData(await blob.arrayBuffer());
  const sr = 16000;
  const n = Math.max(1, Math.round(buf.duration * sr));
  const off = new OfflineAudioContext(1, n, sr);
  const src = off.createBufferSource();
  src.buffer = buf; src.connect(off.destination); src.start();
  const out = await off.startRendering();
  const ch = out.getChannelData(0);
  const dv = new DataView(new ArrayBuffer(44 + ch.length * 2));
  const str = (o, x) => { for (let i = 0; i < x.length; i++) dv.setUint8(o + i, x.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + ch.length * 2, true); str(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, ch.length * 2, true);
  for (let i = 0; i < ch.length; i += 1) {
    const v = Math.max(-1, Math.min(1, ch[i]));
    dv.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([dv.buffer], { type: 'audio/wav' });
}

/**
 * 开始录。**本地识别，不上传** —— 音频只发到 127.0.0.1:8770。
 *
 * ⚠️⚠️ **先把录音机开起来，再去查环境** —— 顺序反了会吃掉开头的话。
 *    上一版是 `await sttReady()`（一次 `/api/stt/status` 的网络往返）**之后**才
 *    `new MediaRecorder(...).start()`，而麦克风从 getUserMedia 成功那一刻就在出数据了。
 *    实测：夹具是一段「今天下午三点开会…」，录回来只剩「点开会…」——
 *    **开头一秒多没了**，而它看起来像"识别不准"。
 *    真用户说第一句话时，被切掉的就是句子的主语。
 */
function startRecog() {
  recChunks = [];
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
  recorder = new MediaRecorder(micStream, mime ? { mimeType: mime } : undefined);
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  recorder.onstop = async () => {
    const blob = new Blob(recChunks, { type: mime || 'audio/webm' });
    reallyStopMic();
    // ⚠️ 太短的直接丢掉：点一下麦克风就松手会产生几十毫秒的杂音，
    //    送去识别只会得到一句幻觉出来的话，比什么都不做更糟。
    if (blob.size < 1200) return;
    const node = logLine('you', '（识别中…）', 'cur');
    if ($('#vstate')) $('#vstate').textContent = '识别中…';
    orbState('thinking');
    // ⚠️⚠️ **识别和提问必须分成两个 try**。
    //    合成一个的后果：识别明明成功了、是"提问"那一步炸了，
    //    界面上却报「识别失败」—— 而这两个问题要去完全不同的地方查。
    //    （实测就这么误导过一次：真实错误是 ask 里的
    //    `Cannot set properties of null`，报出来却是"识别失败"。）
    let text = '';
    try {
      const wav = await toWav16k(blob);
      const r = await fetch('/api/stt', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      text = String(r.text || '').trim();
    } catch (e) {
      node.remove();
      logLine('ai', '识别失败：' + e.message);
      orbState('idle'); orbLevel(0);
      if ($('#vstate')) $('#vstate').textContent = '待机 · 点一下开始说话';
      return;
    }
    if (node.isConnected) {
      node.innerHTML = '<b>你</b>　' + esc(text || '（没听清）');
      node.classList.remove('cur');
    }
    if (text) {
      try { await ask(text, 'voice'); }
      catch (e) { logLine('ai', '（识别好了，但提问那一步出错了：' + e.message + '）'); }
    }
    orbState('idle'); orbLevel(0);
    if ($('#vstate')) $('#vstate').textContent = '待机 · 点一下开始说话';
  };
  recorder.start();
  // 环境没装好的话，等它回来再把录音停掉并说清楚（**这时候已经来不及"别丢开头"了**，
  // 但那本来就不是用户的问题 —— 是没装好）。
  sttReady().then((okd) => {
    if (!okd) {
      logLine('ai', '⚠️ 本地语音识别还没装好（看 ~/.c4emem/stt/）—— 先直接打字吧。');
      stopMic();
    }
  });
}

function logLine(kind, text, cls = '') {
  const d = document.createElement('div');
  d.className = kind + ' ' + cls;
  // ⚠️⚠️ 语音那一屏的每一行（`.you` / `.ai`）以前**没有 draggable**，
  //    而 dragstart 里只认 `.msg` 和 `.item` —— 所以读者说的
  //    「也不能把语音或者任何一段拖动到货架上」是真的：**语音这一段根本起不了拖**。
  //    对话和记录能拖、语音不能，纯粹是两处各写了一份。
  d.draggable = true;
  d.innerHTML = kind === 'you' ? '<b>你</b>　' + esc(text) : esc(text);
  $('.vlognone')?.remove();          // 有第一句话之后那句占位就该走
  $('#vlog').appendChild(d);
  $('#vlog').scrollTop = $('#vlog').scrollHeight;
  // ⭐ 桌面 Pet 那顶泡泡跟着走（读者：「可以讲声音但是要把文字用**一个泡泡**一样出来」）
  petSay(kind, text);
  return d;
}

/** 问一次。语音/文字/流程都走这里 —— 记录里靠 source 区分 icon。 */
async function ask(q, source) {
  const isVoice = source === 'voice';
  const myReq = ++reqSeq;
  const host = isVoice ? logLine('ai', '…') : pushMsg('ai', '…');
  orbState('thinking');
  if (isVoice && $('#vstate')) $('#vstate').textContent = '在想…';
  let r;
  try { r = await post('/api/ask', { q, source, sessionId: sid, spaces: curSpaces() }); }
  catch (e) { if (myReq === reqSeq) setBody(host, isVoice, '出错：' + e.message); return; }
  if (myReq !== reqSeq) { host.remove(); return; }   // 已经被作废了（用户切走了）
  if (r.sessionId) sid = r.sessionId;     // 服务端回话里带着会话号

  // ── 笔记里没有 ────────────────────────────────────────
  // ⚠️ 以前这里直接显示一句写死的「你的笔记里没有相关内容」，用户没有别的路。
  //    现在**交回给人决定**：要不要上网。设置里开了「自动」就不会走到这儿
  //    （服务端那条分支已经自己去搜了）。
  if (r.empty) {
    setBody(host, isVoice, '');
    orbState(micOn ? 'listening' : 'idle');
    if (isVoice && $('#vstate')) $('#vstate').textContent = micOn ? '聆听中…' : '待机 · 点一下开始说话';
    showAskModal(q, async () => {
      setBody(host, isVoice, '正在联网…');
      const w = await post('/api/web', { q, sessionId: sid });
      if (w.sessionId) sid = w.sessionId;
      setBody(host, isVoice, w.answer || '（没有回答）');
      // ⚠️ 只在**真的拿到网页**时才加那条标记 —— 报错时正文自己已经写了，
      //    再加一条同样的提示就是同一句话说两遍。
      if (w.web?.length) addWebNote(host, isVoice, w.web);
      refreshDash();
    });
    return;
  }

  setBody(host, isVoice, r.answer || '（没有回答）', r.sources);
  // 有答案、但顶条余弦很低 ⇒ 如实说「这条不太靠得住」，而不是假装答上了
  if (r.weak) addWeakChip(host, isVoice, q);
  if (!muted && window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(String(r.answer || '').slice(0, 400));
    u.lang = 'zh-CN'; speechSynthesis.speak(u);
  }
  orbState(micOn ? 'listening' : 'idle');
  if (isVoice && $('#vstate')) $('#vstate').textContent = micOn ? '聆听中…' : '待机 · 点一下开始说话';
  await post('/api/blocks', { kind: isVoice ? 'voice' : 'text', label: q });
  refreshDash();
}
function setBody(el, isVoice, text, sources) {
  if (isVoice) el.textContent = text;
  else el.querySelector('.body').textContent = text;
  if (sources?.length) {
    const s = document.createElement('div');
    s.className = 'srcs';
    s.textContent = '依据：' + sources.slice(0, 3).map((x) => x.space + ' ' + x.date).join(' · ');
    (isVoice ? el : el.querySelector('.body')).appendChild(s);
  }
}


/** 弱相关的那条提示 —— 答案照给，但要说清它有多靠不住。 */
function addWeakChip(host, isVoice, q) {
  const target = isVoice ? host : host.querySelector('.body');
  if (!target) return;
  const d = document.createElement('div');
  d.className = 'weakchip';
  d.innerHTML = '<span>笔记里只有弱相关的几条，这条答案不太靠得住。</span>' + icon('globe') + ' 上网再查一遍</button>';
  d.querySelector('button').onclick = async () => {
    d.remove();
    const w = await post('/api/web', { q, sessionId: sid });
    if (w.sessionId) sid = w.sessionId;
    setBody(host, isVoice, w.answer || '（没有回答）');
    if (w.web?.length) addWebNote(host, isVoice, w.web);
    refreshDash();
  };
  target.appendChild(d);
}

/** ⚠️ 网上来的东西**必须**自己带一条明显的标记 —— 不然和你的笔记混在一起分不清哪句能信。 */
function addWebNote(host, isVoice, web = [], err) {
  const target = isVoice ? host : host.querySelector('.body');
  if (!target) return;
  const d = document.createElement('div');
  d.className = 'webnote';
  d.innerHTML = err
    ? '⚠️ 没能联网：' + esc(err)
    : icon('globe') + ' 以下是<b>网上</b>找的，不是你笔记里的：' +
      web.slice(0, 5).map((x, i) => '<a href="' + esc(x.url) + '" target="_blank">[' + (i + 1) + '] ' + esc(String(x.title).slice(0, 36)) + '</a>').join(' · ');
  target.appendChild(d);
}

/**
 * 通用确认框 → Promise<boolean>。
 * ⚠️ 用 Promise 不用回调：调用它的地方是**执行器中间的一步**（一串 await），
 *    回调会把它拆成两段，中间的执行顺序就不好读了。
 */
function confirmBox(title, html) {
  return new Promise((res) => {
    $('#cfTitle').textContent = title;
    $('#cfBody').innerHTML = html;
    const m = $('#confirmmodal');
    m.hidden = false;
    const done = (v) => { m.hidden = true; $('#cfOk').onclick = null; $('#cfNo').onclick = null; m.onclick = null; res(v); };
    $('#cfOk').onclick = () => done(true);
    $('#cfNo').onclick = () => done(false);
    m.onclick = (e) => { if (e.target.id === 'confirmmodal') done(false); };
  });
}

let modalWebCb = null;
function showAskModal(q, onWeb) {
  modalWebCb = onWeb;
  // ⭐⭐ 读者 2026-10-10：「**你在语音这边你要做回复，你不仅仅是弹窗问怎么查，要在这里**」
  //    ⇒ 语音那一屏**直接在对话流里**给两个按钮。弹窗会把"正在说话"这件事打断 ——
  //      用户盯着球，突然眼前糊一个遮罩，那是另一种交互。
  //    ⚠️ 文字那一屏**还是弹窗**：那边本来就是一块平整的对话区，就地展开反而会把上下文挤走。
  if (mode === 'voice') {
    const box = $('#vlog');
    if (!box) return;
    const d = document.createElement('div');
    d.className = 'ai askline';
    d.innerHTML = '你问的是 <b>' + esc(String(q).slice(0, 90)) + '</b> —— 笔记里没有。' +
      '<div class="askacts">' +
      '<button class="go sm" data-web="1">' + icon('globe') + ' 上网找</button>' +
      '<button class="ghost sm" data-nope="1">算了</button></div>' +
      '<div class="k">⚠️ 网上的内容<b>不是你自己的笔记</b>，答案里会标出来。</div>';
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    d.querySelector('[data-web]').onclick = async () => { modalWebCb = null; d.remove(); if (onWeb) await onWeb(); };
    d.querySelector('[data-nope]').onclick = () => { modalWebCb = null; d.remove(); };
    return;
  }
  $('#mbody').innerHTML = '你问的是 <code>' + esc(String(q).slice(0, 90)) + '</code>。<br>要不要上网找找？' +
    '⚠️ <b>网上的内容不是你自己的笔记</b>，答案里会明确标出来。';
  $('#askmodal').hidden = false;
}

// ── 语音框的高度：拖得动、有上限、记得住 ──────────────────
const VLOG_KEY = 'c4emem.vlogh';
const VLOG_MIN = 96;
const vlogMax = () => Math.round(innerHeight * 0.42);
function applyVlogH(h) {
  const v = Math.max(VLOG_MIN, Math.min(vlogMax(), Math.round(h)));
  document.documentElement.style.setProperty('--vlogh', v + 'px');
  orbRecenter();          // ⚠️ 框一高一矮，"上方那块空地"就变了，光球得跟着重新定心
  return v;
}

/** 让光球在**上面那块空地**里居中，而不是在整个 pane 里居中。
 *
 *  ⭐ 为什么非这样不可（读者 2026-10-10 之后暴露出来的）：
 *     语音这一屏下面那一摞（状态条 + 记录框 + 输入条 + 提示）占了小半屏，
 *     而 `.orbbg` 是 `inset:0` —— 光球按整屏 50% 居中就正好落在记录框上。
 *     ⚠️ 以前看不出来：珍珠/水晶是**圆**的、边缘还羽化过，压住一点像是"浮在上面"；
 *        换成**白底标本卡**之后一眼就是"一张白纸盖住了输入区"（截图为证）。
 *     ⚠️ 所以这不是给矿物标本打的补丁 —— 是那个位置本来就错，只是现在才看得见。
 *
 *  ⚠️ 用 `getBoundingClientRect()` **现量**，不写死像素：
 *     记录框的高度是用户拖出来的（`--vlogh`），窗口大小也随时变。
 */
function orbRecenter() {
  const pane = document.querySelector('.vpane');
  const bg = pane && pane.querySelector('.orbbg');
  if (!pane || !bg) return;
  // 「下面那一摞」的第一块 —— 取 flex 列里第一个真正占位的孩子
  const first = [...pane.querySelectorAll('.vfloat > *')]
    .find((e) => e.offsetParent !== null && e.getBoundingClientRect().height > 0);
  if (!first) return;
  const top = first.getBoundingClientRect().top - pane.getBoundingClientRect().top;
  // ⚠️⚠️ 定心点就是 `top/2`，**不许再往下挪那 16px**。
  //    第一版写的是 `top/2 + 16`（想"离顶栏远一点"），在空地宽裕时看着没问题；
  //    可一旦空地矮到光球要缩小（见下），球高就等于空地的高 ⇒ 那 16px 平移
  //    直接变成 **4px 压住**（实测：`top/2+16 + (top-24)/2 = top+4`）。
  //    ⇒ 居中就是居中，想要留白得靠 `--orbfree` 把两边一起收，不能只推一边。
  bg.style.setProperty('--orbmid', Math.max(60, top / 2).toFixed(1) + 'px');
  // ⚠️⚠️ 光球还得**跟着空地缩小**，不能只挪位置。
  //    记录框的上限是 42vh —— 拉到顶时（880 高的窗口上 370px）加上输入条那一行，
  //    上面只剩 ~320px；而标本卡本身就有 326px ⇒ **它根本装不下**，
  //    再怎么定心都会压住 19px（这是实测出来的数，不是估的）。
  //    ⇒ 给一个"可用高度"变量，尺寸取 `min(原来的尺寸, 这个)`。
  //      ⚠️ 不带这个的话，"拖高记录框"就变成一个会把界面弄坏的开关。
  bg.style.setProperty('--orbfree', Math.max(120, top - 24).toFixed(1) + 'px');
}
function initVlogGrip() {
  const grip = $('#vloggrip');
  if (!grip) return;
  applyVlogH(Number(localStorage.getItem(VLOG_KEY)) || 136);
  let dragging = false, startY = 0, startH = 0;
  grip.addEventListener('pointerdown', (e) => {
    dragging = true;
    grip.classList.add('on');
    grip.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startH = $('#vlog').getBoundingClientRect().height;
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    // 往上拖 = 变高（所以是 startY − clientY）
    applyVlogH(startH + (startY - e.clientY));
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    grip.classList.remove('on');
    grip.releasePointerCapture?.(e.pointerId);
    // ⚠️ 存的是**夹过之后**的值，不是鼠标算出来的原始值 ——
    //    存原始值的话，下次打开会弹回一个比上限还大的高度，而上限看着就像没生效。
    localStorage.setItem(VLOG_KEY, String(applyVlogH($('#vlog').getBoundingClientRect().height)));
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}
function closeAskModal() { $('#askmodal').hidden = true; }
$('#mWeb').onclick = async () => { const cb = modalWebCb; modalWebCb = null; closeAskModal(); if (cb) await cb(); };
$('#mNo').onclick = () => { modalWebCb = null; closeAskModal(); };
$('#askmodal').onclick = (e) => { if (e.target.id === 'askmodal') { modalWebCb = null; closeAskModal(); } };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#askmodal').hidden) { modalWebCb = null; closeAskModal(); } });
// 那个小勾 = 设置里的 web.auto。写进去之后服务端那条分支才认。
$('#mAuto').onchange = async (e) => { await post('/api/settings', { web: { auto: e.target.checked } }); };

// ══════════════════════════════════════════════════════════
// 文字
// ══════════════════════════════════════════════════════════
function pushMsg(who, body, srcs) {
  const d = document.createElement('div');
  d.className = 'msg ' + who;
  d.draggable = true;                       // 消息可拖到货架
  d.innerHTML =
    '<div class="who">' + (who === 'me' ? icon('hand') : icon('work')) + '</div>' +
    '<div class="body">' + esc(body) + (srcs ? '<div class="srcs">' + esc(srcs) + '</div>' : '') + '</div>';
  $('#thread').appendChild(d);
  $('#thread').scrollTop = $('#thread').scrollHeight;
  return d;
}
async function sendText() {
  const q = $('#tinput').value.trim();
  if (!q) return;
  $('#tinput').value = '';
  pushMsg('me', q);
  await ask(q, 'text');
}
$('#tsend').onclick = sendText;
$('#tinput').onkeydown = (e) => e.key === 'Enter' && sendText();

// ══════════════════════════════════════════════════════════
// 流程
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// 结构流 —— 主谓宾 + 有类型的线 + 自由画布
//
// ⭐⭐ 这一段的**核心主张**（别的都从它推出来）：
//     连线之所以有意义，是因为**端口有类型**。
//     如果每个口什么都收，线就只是装饰 —— 那种"流程图"谁都会画，
//     但它画完什么也不能保证。所以这里：
//       每个块 = 输入类型[] → 输出类型[]
//       一条线 = 一个输出接一个**兼容**的输入
//     限制只加在**类型**上，不加在**内容**上（内容爱写什么写什么）。
//
// ⭐ 映射到 Tuna 的 subject → action → target：
//     主语 = 来源（你的笔记 / 网页 / 文件 / 剪贴板 / 邮件 / Figma）
//     谓语 = 动作（问 AI / 总结 / 翻译 / 归类 / 抽要点 / 判断）
//     宾语 = 去处（写回 Notion / 放货架 / 存文件 / 弹通知 / 打开 / 念出来 / 发手机）
//     另有第四类不在这条链上：**事件**（定时 / 切应用 / 剪贴板变了 / 手机来通知）
//     —— 它是点火的那一下，不是句子的一部分。
//
// ⚠️⚠️ 两条**必须**成立，否则类型系统是空的、线也只是装饰：
//    · 来源要收 `event` —— 不然「切到某应用」这种触发器**一个口都接不上**，
//      事件线是死的（第一版就是这样，我自己写完才发现）。
//    · 去处要收 `action` —— 不然「存成文件 → 弹个通知」这种串接连不起来。
//    这两条一加，"什么口收什么"才真的有差别：事件进不去「总结」（它不是材料），
//    动作也进不去「总结」（它不是文字）；而「判断」吐的 flag 只有「弹通知」和条件线收。
//
// ⚠️ 为什么不用"文本"当唯一的类型：那样"写回 Notion"和"念出来"就长得一样了，
//    可一个是**不可撤销的写操作**，一个只是出声。类型在这里同时是**安全边界**。
// ══════════════════════════════════════════════════════════

/** 端口类型。颜色是给眼睛用的 —— 一眼看出这条线在传什么。 */
const TYPES = {
  event:  { nm: '事件', c: '#7c5cff' },
  text:   { nm: '文本', c: '#4b8bf5' },
  notes:  { nm: '笔记', c: '#0f9d63' },
  web:    { nm: '网页', c: '#0e8ea8' },
  flag:   { nm: '判断', c: '#d97706' },
  action: { nm: '动作', c: '#e2593f' },
};
/** 兼容规则：同名通吃；笔记和网页可以当文本用（它们本来就能拼成字）。 */
const canFlow = (out, inn) => out === inn || ((out === 'notes' || out === 'web') && inn === 'text');

/**
 * 块的定义。`in` / `out` 就是端口。
 * ⚠️ 改这里等于改**这套语言的语法** —— 加一个新动词就加一条，别去改执行器。
 */
const KINDS = {
  // ── 事件：点火的那一下 ──
  'ev.manual':   { ic: 'play', nm: '手动跑',   grp: '事件', out: ['event'] },
  'ev.schedule': { ic: 'clock', nm: '到点了',   grp: '事件', out: ['event'] },
  'ev.app':      { ic: 'window', nm: '切到某应用', grp: '事件', out: ['event'] },
  'ev.clip':     { ic: 'clip', nm: '复制了新东西', grp: '事件', out: ['event'] },
  'ev.phone':    { ic: 'pod', nm: '手机来通知', grp: '事件', out: ['event'] },

  // ── 主语：来源 ──
  'src.notes':  { ic: 'notes', nm: '我的笔记',   grp: '主语 · 来源', out: ['notes'], in: ['event', 'text'] , kb: true, notion: true},
  'src.web':    { ic: 'globe', nm: '上网找',     grp: '主语 · 来源', out: ['web'],   in: ['event', 'text'] , kb: true},
  'src.file':   { ic: 'file', nm: '读文件',     grp: '主语 · 来源', out: ['text'] , kb: true},
  'src.clip':   { ic: 'clip', nm: '当前剪贴板', grp: '主语 · 来源', out: ['text'] , kb: true},
  'src.email':  { ic: 'mail', nm: '企业微信邮件', grp: '主语 · 来源', out: ['notes'], in: ['event', 'text'] , kb: true},
  'src.figma':  { ic: 'pen', nm: 'Figma 设计稿', grp: '主语 · 来源', out: ['notes'] , kb: true},
  'src.phone':  { ic: 'pod', nm: '手机通知流', grp: '主语 · 来源', out: ['notes'] , kb: true},

  // ── 谓语：动作 ──
  'act.ask':     { ic: 'chat', nm: '问 AI',      grp: '谓语 · 动作', in: ['notes', 'web', 'text'], out: ['text'] },
  'act.summary': { ic: 'summarize', nm: '总结',       grp: '谓语 · 动作', in: ['notes', 'web', 'text'], out: ['text'] },
  'act.words':   { ic: 'translate', nm: '查词 / 翻译', grp: '谓语 · 动作', in: ['text'], out: ['text'] },
  'act.class':   { ic: 'tag', nm: '归类',       grp: '谓语 · 动作', in: ['text'], out: ['text'] },
  'act.extract': { ic: 'magnet', nm: '抽要点 / 待办', grp: '谓语 · 动作', in: ['text', 'notes'], out: ['text'] },
  'act.judge':   { ic: 'scale', nm: '判断一下',    grp: '谓语 · 动作', in: ['text'], out: ['flag'] },

  // ── 宾语：去处（只有这一类会**动到外面的世界**）──
  'out.notion': { ic: 'notion', nm: '写回 Notion', grp: '宾语 · 去处', in: ['text', 'action'], out: ['action'], dangerous: true , notion: true, write: true},
  'out.shelf':  { ic: 'spark',  nm: '放到货架',    grp: '宾语 · 去处', in: ['text', 'notes', 'web'], out: ['action'] },
  'out.note':   { ic: 'save', nm: '存成文件',    grp: '宾语 · 去处', in: ['text', 'action'], out: ['action'] },
  'out.notify': { ic: 'bell', nm: '弹个通知',    grp: '宾语 · 去处', in: ['text', 'flag', 'action'], out: ['action'] },
  'out.open':   { ic: 'rocket', nm: '打开它',      grp: '宾语 · 去处', in: ['text'], out: ['action'] },
  'out.say':    { ic: 'speaker', nm: '念出来',      grp: '宾语 · 去处', in: ['text', 'action'], out: ['action'] },
  'out.phone':  { ic: 'send', nm: '发到手机',    grp: '宾语 · 去处', in: ['text', 'action'], out: ['action'] },
};
/**
 * 「照着填」—— 每一格该填什么，**直接写在那一格的占位符上**。
 *
 * ⚠️ 顺序是**语法**（事件 → 主语 → 谓语 → 宾语），所以 ①②③④ 是**组的属性**，
 *    不是某一类块的属性 —— 手加一块「来源」它也还是第 2 格。
 *    ⇒ 从 `grp` 前缀推，别在二十来类块上各抄一遍（抄了就会漂）。
 * ⚠️ 在这之前只有事件格写了「什么条件」，其余三格都是「写点什么」——
 *    而"照着填"正是 ⑧ 要补的那件事，等于三格没讲要填什么。
 */
const SLOT_PH = [
  [/^事件/, '① 什么时候开始？（例：我按下运行）'],
  [/^主语/, '② 去哪一份东西里找？（例：这一周的笔记）'],
  [/^谓语/, '③ 让谁做什么？（例：把重复的合并成三条）'],
  [/^宾语/, '④ 结论放到哪？（例：放进货架）'],
];
const slotPh = (k) => (SLOT_PH.find(([re]) => re.test(k?.grp || '')) || [, '写点什么'])[1];

/** 老数据（这一版之前的 flow 存在 localStorage 里）用的名字，认出来别丢。 */
const LEGACY_KIND = {
  text: 'act.ask', voice: 'src.clip', clip: 'src.clip', link: 'src.clip', file: 'src.file',
  image: 'src.file', kb_search: 'src.notes', notion_read: 'src.notes', notion_write: 'out.notion',
  recommend: 'act.ask', output: 'out.shelf', llm_answer: 'act.ask', llm_summary: 'act.summary',
  llm_words: 'act.words', llm_class: 'act.class', wecom_mail: 'src.email', feishu_doc: 'src.file',
};
/**
 * 这段内容该进哪个板块。
 * ⚠️ 只让它回**一个词**，然后本地做白名单匹配 —— 让模型自由发挥再解析长句，
 *    出错的方式会有很多种，而每一种看起来都像"路由成功了"。
 */
const ROUTEABLE = ['learn', 'techai', 'techlearn', 'shopping'];
const PAGE_CN = { learn: 'Learn', techai: 'TECH AI', techlearn: 'tech-learn', shopping: 'Shopping' };

/**
 * 一批内容各归哪个板块。
 *
 * ⚠️ **一次调用判一批**，不是每条一次 —— 除了省 token，更重要的是**一致性**：
 *    分开判的时候，同一段文字会被判到不同板块，而这种不一致看起来"每次都对"。
 * ⚠️ 只让它回 `序号:板块`，本地做白名单匹配 —— 让模型自由发挥再解析长句，
 *    出错的方式有很多种，而每一种看起来都像"路由成功了"。
 */
async function classifyBatch(items) {
  if (!items.length) return [];
  try {
    const list = items.map((t, i) => `${i + 1}. ${String(t).replace(/\s+/g, ' ').slice(0, 220)}`).join('\n');
    const r = await post('/api/ask', {
      q: '给下面每一条判断属于哪个板块。**只输出行**，每行 `序号:板块`，不要解释、不要多余的字。\n' +
         '板块只能从这四个里选：learn / techai / techlearn / shopping\n' +
         '规则：编程与 AI 工具→techai；前端、设计、动效、排版、Figma→techlearn；' +
         '要买的东西、测评、比价→shopping；其余知识、语言、艺术、健康、生活→learn\n\n' + list,
      source: 'flow',
    });
    const out = items.map(() => null);
    for (const m of String(r.answer || '').matchAll(/(\d+)\s*[:：.、]\s*(tech[-\s]?learn|tech\s*ai|shopping|learn)/gi)) {
      const k = Number(m[1]) - 1;
      if (k >= 0 && k < out.length) {
        const w = m[2].toLowerCase().replace(/[\s-]/g, '');
        out[k] = w === 'techlearn' ? 'techlearn' : w === 'techai' ? 'techai' : w === 'shopping' ? 'shopping' : 'learn';
      }
    }
    // ⚠️ 没判到的**不能静默补个默认值就当判过了** —— 留 null，界面上显示「? 选一个」让人自己决定。
    //    补默认值的后果是"它替你做了个你没同意的决定"，而这正是读者要避免的。
    return out;
  } catch {
    return items.map(() => null);
  }
}

/** 把上游那一坨切成「条目」。摘要/要点这种本来就一行一条，切出来正好。 */
function splitItems(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  let parts = t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) parts = t.split(/\n+/).map((x) => x.replace(/^[-*•·]\s*/, '').replace(/^\d+[.、)]\s*/, '').trim()).filter((x) => x.length >= 6);
  return parts.slice(0, 20);
}

/**
 * 复核台。**每一次写回都走这里** —— 读者 2026-10-09 定：
 * 「我需要每次都自己选择然后再写入」。所以这里**故意没有**"以后别问"的勾：
 * 复核本身就是这个功能的用法，去掉它等于把"我选了才写"变成"它替我选了"。
 */
function openWriteReview(items, autoPages) {
  return new Promise((res) => {
    const m = $('#writemodal'), list = $('#wrList');
    const miss = autoPages.filter((p) => !p).length;
    $('#wrTitle').textContent = `写回 Notion · ${items.length} 条`;
    $('#wrHint').innerHTML =
      '逐条看：要写的打勾，页面不对的可以改。' +
      (miss ? ` <b style="color:#b3261e">有 ${miss} 条没判出来</b>（标着「?」）—— 它拿不准，请你自己选。` : '') +
      ' 正文前会自动加上 <code>（by cevtuo c4emem AI）</code>。';
    list.innerHTML = items.map((t, i) => {
      const p = autoPages[i];
      return '<label class="wrrow" data-i="' + i + '">' +
        '<input type="checkbox" checked>' +
        '<span class="wnum">' + (i + 1) + '</span>' +
        '<span class="wtxt">' + esc(String(t).slice(0, 400)) + '</span>' +
        '<select class="' + (p ? 'auto' : '') + '">' +
        (p ? '' : '<option value="" selected>? 选一个</option>') +
        ROUTEABLE.map((k) => '<option value="' + k + '"' + (k === p ? ' selected' : '') + '>' + PAGE_CN[k] + '</option>').join('') +
        '</select></label>';
    }).join('');
    const rows = () => $$('#wrList .wrrow');
    // ⚠️ 按钮上写**选了几条**。读者要的是"我自己选哪些"，那就必须有一个
    //    随勾选实时变的数 —— 否则点下去之前根本不知道要写几条。
    const refreshCount = () => {
      const n = rows().filter((r) => r.querySelector('input').checked).length;
      const b = $('#wrWrite');
      b.textContent = n ? `写入 ${n} 条` : '选一个再写';
      b.disabled = !n;
    };
    rows().forEach((r) => (r.querySelector('input').onchange = (e) => {
      r.classList.toggle('off', !e.target.checked); refreshCount();
    }));
    $('#wrAll').onclick = () => { rows().forEach((r) => { r.querySelector('input').checked = true; r.classList.remove('off'); }); refreshCount(); };
    $('#wrNone').onclick = () => { rows().forEach((r) => { r.querySelector('input').checked = false; r.classList.add('off'); }); refreshCount(); };
    refreshCount();
    const done = (v) => {
      m.hidden = true;
      ['#wrWrite', '#wrCancel', '#wrAll', '#wrNone'].forEach((x) => ($(x).onclick = null));
      m.onclick = null; res(v);
    };
    $('#wrCancel').onclick = () => done(null);
    m.onclick = (e) => { if (e.target.id === 'writemodal') done(null); };
    $('#wrWrite').onclick = () => {
      const picked = rows().map((r, i) => ({ r, i })).filter((x) => x.r.querySelector('input').checked)
        .map((x) => ({ text: items[x.i], page: x.r.querySelector('select').value }))
        .filter((x) => x.page);
      if (!picked.length) return;
      done({ items: picked });
    };
    m.hidden = false;
  });
}

/** 「知识库」那一类 —— 用户要的是**把它们聚成一块**列出来，而不是散在「来源」里。 */
const KB_KINDS = ['src.notes', 'src.email', 'src.figma', 'src.phone', 'src.file', 'src.clip', 'src.web'];

const normKind = (k) => (KINDS[k] ? k : LEGACY_KIND[k] ?? 'act.ask');
const K = (b) => KINDS[normKind(b.kind)] ?? KINDS['act.ask'];

/** 线的三种含义 —— 这是"不同事件之间的关系"那个问题的答案。 */
const EDGES = {
  data: { nm: '数据流', dash: '', desc: '把 A 的输出当 B 的输入（最常用）' },
  seq:  { nm: '顺序',   dash: '9 7', desc: 'A 跑完再跑 B，但不传数据 —— 只是先后' },
  cond: { nm: '条件',   dash: '2 6', desc: 'A 的结果为真才跑 B' },
};

let flow = JSON.parse(localStorage.getItem('c4emem.flow') || '[]');
let wires = JSON.parse(localStorage.getItem('c4emem.wires') || '[]');
let sel = null;
let lastKind = normKind(localStorage.getItem('c4emem.lastKind') || 'act.ask');
const WKEY = 'c4emem.wires';

// ── 画布要落到「文件夹」里（服务端那份）────────────────────
// ⚠️⚠️ `flowReady` 这个闸门是**必须的**：下面补 x/y 的那个循环会调 `saveFlow()`，
//     而它跑在**从服务端加载之前**。没有闸门的话，就会先拿一份空画布
//     把服务端存着的那份**覆盖掉** —— 症状是「一打开画布全没了」，而且不可恢复。
let flowReady = false;
let pushTimer = null;
const pushFlow = async () => {
  try {
    const r = await post('/api/flow', { blocks: flow, wires, layout: flowLayout, lastKind });
    if (r && r.ok === false) { console.warn('画布没存上：' + (r.error || '')); return null; }
    return r;
  } catch (e) {
    console.warn('画布没存上：', e);
    return null; // ⚠️ 返回 null 而不是吞掉 —— 调用方要能如实告诉用户"没搬过去"
  }
};
// 防抖：拖一块会连着触发几十次 saveFlow，不防抖就是几十次写盘。
const queuePushFlow = () => {
  if (!flowReady) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushFlow, 500);
};

// ⚠️ 这两个是**全站唯一**的存盘入口（17 处调用点都走它），
//    所以把「推给服务端」挂在这里，每一处编辑就自动持久化了，不用逐个去改。
const saveFlow = () => { localStorage.setItem('c4emem.flow', JSON.stringify(flow)); queuePushFlow(); };
const saveWires = () => { localStorage.setItem(WKEY, JSON.stringify(wires)); queuePushFlow(); };

// ⚠️ **必须补这一步**：没有 x/y 的老块会被画在 (60,60) —— 看起来像"只存下来一块"。
//    （第一版就是这样，我还是靠断言报「1 列 / 1 行」才发现的。）
if (ensureSpots()) saveFlow();

let cam = { x: 60, y: 40, z: 1 };
const ZMIN = 0.28, ZMAX = 2.6;
let flowLayout = localStorage.getItem('c4emem.flowLayout') || 'default';
if (!['default', 'nuggets', '3d'].includes(flowLayout)) flowLayout = 'default';
let didFit = false;
const clampZ = (z) => Math.min(ZMAX, Math.max(ZMIN, z));

/** 一条会自己消失的提示条（不依赖 app.css 里任何类名，免得改样式时把它改没）。 */
function flowNotice(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText =
    'position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:9999;' +
    'background:#3a2d1f;color:#ffd9a0;border:1px solid #8a6a3a;border-radius:10px;' +
    'padding:10px 14px;font-size:13px;max-width:70vw;box-shadow:0 8px 30px rgba(0,0,0,.4)';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 9000);
}

/**
 * 从「文件夹」那份加载画布。
 *
 * ⚠️ 顺序是**先用 localStorage 起来，再去问服务端** —— 等网络的话首屏就是一块空画布，
 *    而画布正是这个模式的全部内容。网络回来了再对齐即可。
 *
 * 四种情况必须分开，尤其后两种（合起来就会变成"画布丢了"）：
 *   ① 服务端有   ⇒ 以它为准（它才是持久的），本地那份同步过来；
 *   ② 服务端没有 ⇒ 把本地这份**搬上去**（迁移）。不搬的话，
 *                  老用户第一次升级就会看到画布没了 —— 从此读的是文件夹，而它是空的；
 *   ③ 读不出来   ⇒ **绝不能当成空的！** 那会诱使我们用空画布把它盖掉。
 *                  如实报出来，并且**不开自动存**（第一次编辑就覆盖了）；
 *   ④ 服务端连不上 ⇒ 静默继续用本地那份，什么都不动。
 */
async function hydrateFlow() {
  let r;
  try { r = await api('/api/flow'); } catch { return; } // ④

  if (r && r.ok && r.exists && r.state) {
    flow = r.state.blocks;
    wires = r.state.wires;
    flowLayout = ['default', 'nuggets', '3d'].includes(r.state.layout) ? r.state.layout : 'default';
    lastKind = normKind(r.state.lastKind);
    localStorage.setItem('c4emem.flow', JSON.stringify(flow));
    localStorage.setItem(WKEY, JSON.stringify(wires));
    localStorage.setItem('c4emem.flowLayout', flowLayout);
    flowReady = true;
    // ⚠️ 服务端那份**可能没有 x/y**（别的机器/别的工具写进去的）——
    //    不补就会全叠在同一点、互相挡住、点都点不到。补完把坐标存回去。
    if (ensureSpots()) queuePushFlow();
    renderFlow();
    return;
  }

  if (r && r.ok && !r.exists) {
    flowReady = true; // ② 先开闸门，pushFlow 才发得出去
    if (flow.length || wires.length) {
      const saved = await pushFlow();
      // ⚠️ 搬没搬成功要**如实说** —— 说"已存到"而其实没存上，
      //    用户就会放心地清缓存，然后真的丢了。
      flowNotice(saved ? '画布已搬进文件夹：' + (r.dir || '') : '⚠️ 画布没搬过去，目前还只在浏览器里');
    }
    return;
  }

  if (r && r.ok === false) {
    // ③ 保持 flowReady=false ⇒ 不会自动写盘，那个文件原样留着等人处理。
    console.warn('[flow] 文件有问题，没敢动它：', r.reason);
    flowNotice('⚠️ 画布文件读不出来，这次没自动保存（文件没动）：' + (r.reason || '未知原因'));
  }
}

/**
 * 新块的落点。
 * ⚠️ 上一版是「上一块 +30x +96y」—— 而卡片有 300px 宽，加 30 等于**两块直接摞上**。
 *    症状是后加的那块的来源标签盖住了前一块的，点都点不到。
 *    现在扫格子找第一个空位，尺寸用卡片实际尺寸，所以**不会重叠**。
 */
/**
 * 给没有坐标的块补落点。返回"补过没有"。
 *
 * ⚠️⚠️ 必须在**两个**地方都跑：模块加载时（本地那份）、以及 `hydrateFlow()` 之后
 *     （**服务端那份**）。
 *     只在加载时跑是不够的 —— 从文件夹读来的块可能压根没有 x/y，
 *     那样它们**全叠在同一个点**上，互相挡住，**点都点不到**；
 *     而看起来只是"排布有点怪"。这个 bug 是 verify-flow 崩在
 *     「click 被另一个块的按钮挡住」上才暴露的。
 */
function ensureSpots() {
  let moved = false;
  for (const b of flow) if (b.x == null || b.y == null) { const pt = spotFor(); b.x = pt.x; b.y = pt.y; moved = true; }
  return moved;
}

function spotFor() {
  const W = 380, H = 180, COLS = 3;
  const taken = new Set(flow.map((b) => `${Math.round((b.x ?? 0) / W)},${Math.round((b.y ?? 0) / H)}`));
  for (let r = 0; r < 60; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      if (!taken.has(`${c},${r}`)) return { x: 60 + c * W, y: 60 + r * H };
    }
  }
  return { x: 60, y: 60 };
}
function newBlock(kind, text = '', extra = {}) {
  const k = normKind(kind);
  const p = spotFor();
  return { id: 'b' + Math.random().toString(36).slice(2, 9), kind: k, text, src: null, x: p.x, y: p.y, ...extra };
}

function applyCam() {
  const g = $('#flowgrid'), w = $('#flowworld');
  if (!g || !w) return;
  const step = 26 * cam.z;
  g.style.setProperty('--gz', step.toFixed(2) + 'px');
  g.style.setProperty('--gpx', cam.x.toFixed(1) + 'px');
  g.style.setProperty('--gpy', cam.y.toFixed(1) + 'px');
  w.style.setProperty('--px', cam.x.toFixed(1) + 'px');
  w.style.setProperty('--py', cam.y.toFixed(1) + 'px');
  w.style.setProperty('--z', cam.z);
  if ($('#zoomPct')) $('#zoomPct').textContent = Math.round(cam.z * 100) + '%';
  drawWires();
}
function zoomAt(factor, cx, cy) {
  const c = $('#flowcanvas'); if (!c) return;
  const r = c.getBoundingClientRect();
  const px = (cx ?? r.width / 2) - r.left, py = (cy ?? r.height / 2) - r.top;
  const z2 = clampZ(cam.z * factor), k = z2 / cam.z;
  cam.x = px - (px - cam.x) * k; cam.y = py - (py - cam.y) * k; cam.z = z2;
  applyCam();
}
function fitFlow() {
  const c = $('#flowcanvas'), l = $('#flowlist'); if (!c || !l) return;
  const cw = c.clientWidth, ch = c.clientHeight;
  // ⚠️ 用 scrollWidth/scrollHeight 而不是 offsetWidth：网格里卡片可能溢出，
  //    offsetWidth 只报布局盒子，溢出的那截算不进去。
  let lw = l.scrollWidth || 1, lh = l.scrollHeight || 1;
  // ⚠️ 3D 版式整个平面被斜过来，**包围盒比布局盒子大一圈** ——
  //    不补这一下，边上那几块会被画布裁掉（而断言量的是布局尺寸，一切"正常"）。
  if (flowLayout === '3d') { lw *= 1.5; lh *= 1.75; }
  if (cw < 10 || ch < 10) return;
  const m = 46;
  cam.z = clampZ(Math.min((cw - m * 2) / lw, (ch - m * 2) / lh, 1.4));
  cam.x = (cw - lw * cam.z) / 2; cam.y = (ch - lh * cam.z) / 2;
  applyCam();
}
const toWorld = (clientX, clientY) => {
  const r = $('#flowcanvas').getBoundingClientRect();
  return { x: (clientX - r.left - cam.x) / cam.z, y: (clientY - r.top - cam.y) / cam.z };
};

function srcChip(b) {
  const own = b.src ? SOURCES.find((x) => x.id === b.src) : null;
  const s = own || curSrc();
  return '<button class="bsrc' + (own ? '' : ' inherit') + '" data-id="' + b.id + '" style="--c:' + s.c + '"' +
    ' title="这一块按哪个来源找（点一下换一个）">' + icon(s.g) + ' ' + esc(s.nm) + (own ? '' : ' ·跟随') + '</button>';
}

/** 端口小圆点。类型写在 data-t 上，连线和发光都靠它。 */
function ports(b, dir) {
  const k = K(b);
  const list = k[dir] ?? [];
  return list.map((t) =>
    '<span class="port ' + dir + '" data-b="' + b.id + '" data-t="' + t + '" data-d="' + dir + '"' +
    ' style="--c:' + TYPES[t].c + '" title="' + TYPES[t].nm + '"></span>').join('');
}

function renderFlow() {
  const host = $('#flowlist'), pane = $('#m-flow');
  if (!host || !pane) return;
  pane.classList.remove('lay-default', 'lay-nuggets', 'lay-3d');
  pane.classList.add('lay-' + flowLayout);
  $$('#flowstyle button').forEach((b) => b.classList.toggle('on', b.dataset.l === flowLayout));

  if (!flow.length) {
    host.innerHTML = '<div class="flowempty">还没有块。<br>按 <b>＋</b> 加一块，或者从左下角那颗按钮上面的「?」看一眼怎么用。</div>';
  } else {
    host.innerHTML = flow.map((b, i) => {
      const k = K(b);
      const tags =
        (k.notion ? '<span class="tag notion">Notion</span>' : '') +
        ((k.grp ?? '').includes('宾语') && k.dangerous ? '<span class="tag danger">会动到外面</span>' : '');
      return '<div class="blk' + (b.id === sel ? ' sel' : '') + (k.grp?.includes('事件') ? ' evt' : '') + '"' +
        ' data-id="' + b.id + '" style="left:' + (b.x ?? 60) + 'px;top:' + (b.y ?? 60) + 'px">' +
        '<div class="pcol in">' + ports(b, 'in') + '</div>' +
        '<div class="kb"><span class="ic">' + icon(k.ic) + '</span><span class="nm">' + esc(k.nm) + '</span></div>' +
        '<div class="c"><div class="txt" contenteditable="true" data-id="' + b.id + '" data-ph="' +
        esc(slotPh(k)) + '">' + esc(b.text || '') + '</div>' +
        '<div class="tags">' + srcChip(b) + tags + '</div></div>' +
        '<div class="pcol out">' + ports(b, 'out') + '</div>' +
        '<span class="bstat" data-stat="' + b.id + '"></span>' +
        '</div>';
    }).join('');
  }
  // ⚠️ 卡片是绝对定位的 ⇒ .flowlist 自己是 0 高。不撑开的话 fitFlow 量到 0×0，
  //    表现是「适应」按下去把画布缩成一个点。
  if (flowLayout === 'default' && flow.length) {
    const mx = Math.max(...flow.map((b) => (b.x ?? 0) + 320));
    const my = Math.max(...flow.map((b) => (b.y ?? 0) + 210));
    host.style.width = mx + 'px'; host.style.height = my + 'px';
  } else { host.style.width = ''; host.style.height = ''; }
  host.insertAdjacentHTML('beforeend', '<div class="addrow" id="addrow">＋ 添加一块</div>');
  $('#addrow').onclick = () => addBlock(lastKind);
  applyCam();
  requestAnimationFrame(drawWires);
}

/** 世界坐标里两个端口的连线。端点用**屏幕矩形换算**，这样三种版式都不用另写一份。 */
function drawWires() {
  const svg = $('#wires'), c = $('#flowcanvas');
  if (!svg || !c) return;
  const r = c.getBoundingClientRect();
  // ⚠️ 用**屏幕坐标**画，不用世界坐标 —— 否则缩放时线的粗细会跟着缩，
  //    缩到 30% 就细成一根头发、放大又糊成一条带子。线和点阵一样，是按缩放重画的。
  const P = (id, t, d) => {
    const el = document.querySelector('.port.' + d + '[data-b="' + id + '"][data-t="' + t + '"]');
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2 - r.left, y: b.y + b.height / 2 - r.top };
  };
  const parts = [];
  for (const w of wires) {
    let a = null, b2 = null;
    if (w.port) a = P(w.from, w.port, 'out');
    if (a && w.in) b2 = P(w.to, w.in, 'in');
    // 端口找不到（换了类型 / 块被删）就先不画，但**保留这条线** —— 静默删掉才是真的丢东西
    if (!a || !b2) {
      const ea = document.querySelector('.blk[data-id="' + w.from + '"]');
      const eb = document.querySelector('.blk[data-id="' + w.to + '"]');
      if (ea && eb) {
        const ra = ea.getBoundingClientRect(), rb = eb.getBoundingClientRect();
        a = { x: ra.right - r.left, y: ra.y + ra.height / 2 - r.top };
        b2 = { x: rb.left - r.left, y: rb.y + rb.height / 2 - r.top };
      }
    }
    if (!a || !b2) continue;
    const dx = Math.max(30, Math.abs(b2.x - a.x) * 0.45);
    const d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b2.x - dx} ${b2.y}, ${b2.x} ${b2.y}`;
    const col = TYPES[w.t ?? 'data'] ? '#8b93a3' : '#8b93a3';
    parts.push('<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2"' +
      (EDGES[w.type]?.dash ? ' stroke-dasharray="' + EDGES[w.type].dash + '"' : '') +
      ' data-w="' + w.id + '" class="wire' + (w.id === hotWire ? ' hot' : '') + '"/>');
  }
  svg.setAttribute('viewBox', `0 0 ${Math.max(1, r.width)} ${Math.max(1, r.height)}`);
  svg.innerHTML = parts.join('');
}
let hotWire = null;

/** 跑的时候用哪些来源：块上标了的优先，都没标就跟随左下角那颗全局按钮。 */
function flowSpaces() {
  const own = [...new Set(flow.map((b) => b.src).filter(Boolean))]
    .map((id) => SOURCES.find((x) => x.id === id)).filter(Boolean).flatMap((s) => s.spaces);
  return own.length ? [...new Set(own)] : curSpaces();
}

/**
 * ⭐⭐ **「照着填」的骨架**：一次把四块摆好 —— 事件 → 来源 → 动作 → 去处 —— 并按类型连好。
 *
 * 读者 2026-10-10 对结构流的要求：「固定格子按 **事件 → 主语 → 谓语 → 宾语** 填」。
 * 原来只有"一块一块自己加"，等于把「这条流该怎么搭」这件事留给用户从零想。
 *
 * ⚠️⚠️ 骨架**不绕过类型规则**：连线仍然按 `KINDS[..].out` 和 `KINDS[..].in` 对，
 *    对不上就**不连**，而且把"哪一对没连上"**说出来** ——
 *    静默少一条线，用户只会以为"这软件连不上"。
 * ⚠️ 位置**不是随手摆** —— 骨架的价值就在于**一眼看出顺序**。
 *    格子约定沿用 `spotFor` 那套（`W=380 / H=180`）。
 *
 * ⚠️⚠️ 2026-10-13 修（第一次真去驱动这颗按钮时量出来的）：
 *     原来是 `b.x = 60 + (i % 3) * 380` —— **按三块一行折行**。可这四块是**一条直线**的任务链
 *     （事件 → 来源 → 动作 → 去处），第 4 块于是折回最左边一行，接它的那根线**横穿整张画布**：
 *     实测 **1167px，而画布才 962 宽**，截图里一眼就是坏的。
 *     ⚠️ 上面那句"三块一行……一眼看出顺序"当时是**意图**，不是事实：折行恰好把顺序读没了。
 *     ⇒ 改成**一排走完**（挑一整行连续空着的，不挑单个空格子 —— 四块必须挨着）。
 * ⚠️⚠️ 还有第二条（同一次量出来的）：摆完**不碰镜头**。位置写死在世界坐标 (60,60)，
 *     用户平移过画布之后就**什么都看不到** —— 而"在屏幕外"和"没摆出来"长得一模一样。
 *     实测：第 3 块右边缘 **1627 > 视口 1460**，被右边缘切掉。⇒ 摆完 `frameBlocks(made)`。
 */
function makeSkeleton() {
  const seq = ['ev.manual', 'src.notes', 'act.summary', 'out.shelf'];
  const W = 380, H = 180;
  const taken = new Set(flow.map((b) => `${Math.round((b.x ?? 0) / W)},${Math.round((b.y ?? 0) / H)}`));
  let row = 0;
  for (; row < 60; row += 1) if (seq.every((_, c) => !taken.has(`${c},${row}`))) break;
  const made = seq.map((kind, i) => {
    const b = newBlock(kind, '');
    b.x = 60 + i * W;
    b.y = 60 + row * H;
    return b;
  });
  flow.push(...made);
  let wired = 0;
  const missed = [];
  for (let i = 0; i < made.length - 1; i += 1) {
    const a = made[i], b2 = made[i + 1];
    const port = (KINDS[a.kind]?.out || []).find((o) => (KINDS[b2.kind]?.in || []).includes(o));
    if (!port) { missed.push((KINDS[a.kind]?.nm || a.kind) + ' → ' + (KINDS[b2.kind]?.nm || b2.kind)); continue; }
    wires.push({ id: 'w' + Math.random().toString(36).slice(2, 9), from: a.id, port, to: b2.id, in: port, type: 'data' });
    wired += 1;
  }
  saveFlow(); renderFlow(); frameBlocks(made);
  toast('摆好 ' + made.length + ' 块，连了 ' + wired + ' 条' +
    (missed.length ? '；这几对类型对不上、没连：' + missed.join('、') : '。往里填字就行'),
    missed.length ? 'bad' : 'good');
}
if ($('#flowskel')) $('#flowskel').onclick = makeSkeleton;
if ($('#flowlib')) $('#flowlib').onclick = (e) => openLib(e.currentTarget);

/**
 * 把镜头对准这一组块（摆完骨架之后用）。
 *
 * ⚠️ 卡片宽高是**量出来的**，不写死数字 —— 版式（卡片 / Nuggets / 3D）换一套就不一样，
 *    而写死的那个数**不会报错，只会让"适应"适应到错的地方**。
 * ⚠️ 和 `fitFlow()` 的区别：那个适应的是**全部**内容。画布上已经有几十块时再调它，
 *    新摆的四块会被缩成一粒沙 ⇒ 这里只框这一组。
 */
function frameBlocks(list) {
  const c = $('#flowcanvas');
  if (!c || !list.length) return;
  const el = $('#flowworld .blk');
  const bw = el ? el.offsetWidth : 290, bh = el ? el.offsetHeight : 70;
  const x0 = Math.min(...list.map((b) => b.x)), y0 = Math.min(...list.map((b) => b.y));
  const x1 = Math.max(...list.map((b) => b.x)) + bw, y1 = Math.max(...list.map((b) => b.y)) + bh;
  const cw = c.clientWidth, ch = c.clientHeight;
  if (cw < 10 || ch < 10) return;
  const m = 56;
  cam.z = clampZ(Math.min((cw - m * 2) / (x1 - x0), (ch - m * 2) / (y1 - y0), 1));
  cam.x = (cw - (x1 - x0) * cam.z) / 2 - x0 * cam.z;
  cam.y = (ch - (y1 - y0) * cam.z) / 2 - y0 * cam.z;
  applyCam();
}

function addBlock(kind, at) {
  const b = newBlock(kind);
  if (at) { b.x = at.x; b.y = at.y; }
  flow.push(b); sel = b.id;
  saveFlow(); renderFlow();
  focusText(b.id);
}
function focusText(id) {
  const el = document.querySelector('.blk[data-id="' + id + '"] .txt');
  if (!el) return;
  el.focus();
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}

// ── 选块 / 点来源 / 拖端口起线 ──────────────────────────────
$('#flowlist').addEventListener('click', (e) => {
  const chip = e.target.closest('.bsrc');
  if (chip) {
    e.stopPropagation(); e.preventDefault();
    const b = flow.find((x) => x.id === chip.dataset.id);
    if (!b) return;
    const seq = [null, ...SOURCES.filter((s) => s.id !== 'blend').map((s) => s.id)];
    b.src = seq[(seq.indexOf(b.src ?? null) + 1) % seq.length];
    saveFlow(); renderFlow();
    return;
  }
  const blk = e.target.closest('.blk');
  if (blk) { sel = blk.dataset.id; glow(sel); }
});
/** ⭐ 选中发光 —— 用户要的那一下。整块亮起来，不是只描个边。 */
function glow(id) {
  $$('#flowlist .blk').forEach((e) => e.classList.toggle('sel', e.dataset.id === id));
}

$('#flowlist').addEventListener('input', (e) => {
  const t = e.target.closest('.txt'); if (!t) return;
  const b = flow.find((x) => x.id === t.dataset.id);
  if (b) { b.text = t.textContent.trim(); saveFlow(); }
});

// ── 连线：拖着走 **或者** 点两下 ─────────────────────────────
// ⚠️⚠️ 原来**只支持拖**（按下起点、松手在终点）。读者的原话是
//    「我点击蓝色，其他蓝色确实显示，但是我却不能连接任何的」——
//    兼容高亮在**按下**那一刻就出现了，而"点击式"根本不生效，
//    于是看起来像"能连的东西全摆出来了，却一个都连不上"。
//    现在两条路都走：位移 > 5px 算拖；**原地一点就松手 ⇒ 把这根线举着**，等第二次点击。
//    （举线时再点同一颗出端口 = 取消；点空白 = 取消；Esc = 取消。）
let pendingWire = null;
let wireMoved = false;
let wireDownAt = null;

/** 真把线接上。 */
function connectWire(toB, toT) {
  if (!pendingWire) return false;
  if (!compatible(pendingWire.port, toT)) return false;   // 类型不合就是不合，不静默接上
  if (toB === pendingWire.from) return false;             // 自己连自己没意义
  wires.push({ id: 'w' + Math.random().toString(36).slice(2, 9), from: pendingWire.from, port: pendingWire.port, to: toB, in: toT, type: pendingWire.type });
  saveWires();
  return true;
}
/** 举着线时画布该有的样子：兼容的**亮**、不兼容的**压暗**（这就是"限制"在界面上的样子）。 */
function paintWiring() {
  document.body.classList.add('wiring');
  if (pendingWire) markCompat(pendingWire.port);
}
function dropWire() {
  pendingWire = null; wireMoved = false; wireDownAt = null;
  clearCompat(); document.body.classList.remove('wiring');
}
const wiring = () => !!pendingWire;

function bindPorts() {
  const host = $('#flowlist');
  if (!host || host.dataset.ports) return;
  host.dataset.ports = '1';

  host.addEventListener('pointerdown', (e) => {
    // ① 按在**出**端口上 —— 起一根线
    const p = e.target.closest('.port.out');
    if (p) {
      e.stopPropagation(); e.preventDefault();
      // 同一颗再点一次 = 收起这根线（不然举起来就撤不掉了）
      if (pendingWire && pendingWire.from === p.dataset.b && pendingWire.port === p.dataset.t) {
        dropWire(); renderFlow(); return;
      }
      pendingWire = { from: p.dataset.b, port: p.dataset.t, type: e.shiftKey ? 'seq' : e.altKey ? 'cond' : 'data' };
      wireMoved = false; wireDownAt = { x: e.clientX, y: e.clientY };
      paintWiring();
      return;
    }
    // ② 已经举着一根线时按在**入**端口上 —— 接上（这就是「点击式连线」）
    const t = e.target.closest('.port.in');
    if (t && pendingWire) {
      e.stopPropagation(); e.preventDefault();
      const done = connectWire(t.dataset.b, t.dataset.t);
      dropWire(); renderFlow();
      if (!done) toast('这两个端口类型对不上，连不了');
    }
  });

  const finish = (e) => {
    if (!pendingWire) return;
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.port.in');
    const done = t ? connectWire(t.dataset.b, t.dataset.t) : false;
    if (done || wireMoved) dropWire();   // 接上了 / 拖到别处松手 ⇒ 这一笔结束
    else wireDownAt = null;              // 原地一点 ⇒ 线**继续举着**，等第二次点击
    renderFlow();
    // ⚠️ renderFlow 把端口**整批换成了新元素**，wiring 的高亮类全没了
    //    —— 不补这一下，举着线的样子会在重画之后消失（看起来像"点了没反应"）。
    if (pendingWire) paintWiring();
  };
  host.addEventListener('pointerup', finish);
  window.addEventListener('pointerup', finish);

  // 按下之后挪过就不算"点击"了 —— 拖出去又拖回来松手，不该把这根线留在手里
  window.addEventListener('pointermove', (e) => {
    if (!pendingWire || wireMoved || !wireDownAt) return;
    if (Math.hypot(e.clientX - wireDownAt.x, e.clientY - wireDownAt.y) > 5) wireMoved = true;
  });
}
const compatible = (out, inn) => canFlow(out, inn);
function markCompat(outT) {
  $$('#flowlist .port.in').forEach((p) => {
    const okk = compatible(outT, p.dataset.t);
    p.classList.toggle('ok', okk); p.classList.toggle('no', !okk);
  });
}
function clearCompat() { $$('#flowlist .port').forEach((p) => p.classList.remove('ok', 'no')); }

// ── 画布：拖空白 = 平移；拖卡片 = 挪卡片；⌘/Ctrl + 滚 = 缩放 ──
function bindCanvas() {
  const c = $('#flowcanvas');
  if (!c || c.dataset.bound) return;
  c.dataset.bound = '1';
  let mode = null, sx = 0, sy = 0, ox = 0, oy = 0, moving = null;
  c.addEventListener('pointerdown', (e) => {
    // 举着一根线时点空白 = 取消。不取消的话它会一直举着，看起来像"卡住了"。
    if (pendingWire) { dropWire(); renderFlow(); return; }
    const port = e.target.closest('.port');
    if (port) return;                                   // 端口归上面的连线逻辑管
    const blk = e.target.closest('.blk');
    // ⚠️ 卡片上除了文字和按钮，**别处都能拖着走** —— 这是"卡片可以拖成各种样子"的前提
    if (blk && !e.target.closest('.txt, button, [contenteditable="true"]')) {
      const b = flow.find((x) => x.id === blk.dataset.id);
      if (!b) return;
      if (flowLayout !== 'default') { sel = b.id; glow(sel); return; }   // 自动版式里不拖动
      mode = 'move'; moving = b; const w0 = toWorld(e.clientX, e.clientY);
      ox = w0.x - (b.x ?? 0); oy = w0.y - (b.y ?? 0);
      sel = b.id; glow(sel); c.setPointerCapture(e.pointerId);
      return;
    }
    if (e.target.closest('button, .addrow, [contenteditable="true"]')) return;
    mode = 'pan'; sx = e.clientX; sy = e.clientY; ox = cam.x; oy = cam.y;
    c.classList.add('panning'); c.setPointerCapture(e.pointerId);
  });
  c.addEventListener('pointermove', (e) => {
    if (mode === 'pan') { cam.x = ox + (e.clientX - sx); cam.y = oy + (e.clientY - sy); applyCam(); }
    else if (mode === 'move' && moving) {
      const w0 = toWorld(e.clientX, e.clientY);
      moving.x = Math.round(w0.x - ox); moving.y = Math.round(w0.y - oy);
      const el = document.querySelector('.blk[data-id="' + moving.id + '"]');
      if (el) { el.style.left = moving.x + 'px'; el.style.top = moving.y + 'px'; }
      drawWires();
    }
  });
  const stop = (e) => {
    if (mode === 'move') { saveFlow(); }
    mode = null; moving = null;
    c.classList.remove('panning');
    try { c.releasePointerCapture(e.pointerId); } catch {}
  };
  c.addEventListener('pointerup', stop);
  c.addEventListener('pointercancel', stop);
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
    else { cam.x -= e.deltaX; cam.y -= e.deltaY; applyCam(); }
  }, { passive: false });
  $$('#flowstyle button').forEach((b) => (b.onclick = () => {
    flowLayout = b.dataset.l; localStorage.setItem('c4emem.flowLayout', flowLayout);
    queuePushFlow();
    renderFlow(); fitFlow();
  }));
  $$('.zoomctl button').forEach((b) => (b.onclick = () => {
    const z = b.dataset.z;
    if (z === 'in') zoomAt(1.22); else if (z === 'out') zoomAt(1 / 1.22); else fitFlow();
  }));
  bindPorts();
}

// ── 键盘：不拖也能把线连起来 ────────────────────────────────
function nearestIn(dir, from) {
  const others = flow.filter((b) => b.id !== from.id);
  const dx = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
  const dy = dir === 'down' ? 1 : dir === 'up' ? -1 : 0;
  let best = null, bs = Infinity;
  for (const b of others) {
    const vx = (b.x ?? 0) - (from.x ?? 0), vy = (b.y ?? 0) - (from.y ?? 0);
    if (dx && Math.sign(vx) !== dx) continue;
    if (dy && Math.sign(vy) !== dy) continue;
    const s = Math.hypot(vx, vy);
    if (s < bs) { bs = s; best = b; }
  }
  return best;
}
function arrowAction(dir, mod) {
  const me = flow.find((b) => b.id === sel);
  if (!me) { if (flow[0]) { sel = flow[0].id; glow(sel); } return; }
  const D = 250;
  const at = { x: (me.x ?? 0) + (dir === 'right' ? D : dir === 'left' ? -D : 0), y: (me.y ?? 0) + (dir === 'down' ? 170 : dir === 'up' ? -170 : 0) };
  if (mod === 'alt') {
    // ⌥ + 方向 = 只连一条线，不新建
    const t = nearestIn(dir, me);
    if (!t) return;
    const k = K(t), port = (k.in ?? [])[0];
    if (!port) return;
    wires.push({ id: 'w' + Math.random().toString(36).slice(2, 9), from: me.id, port: (K(me).out ?? ['text'])[0], to: t.id, in: port, type: 'seq' });
    saveWires(); renderFlow();
    return;
  }
  const nb = newBlock(lastKind, '', at);
  flow.push(nb); sel = nb.id;
  wires.push({ id: 'w' + Math.random().toString(36).slice(2, 9), from: me.id, port: (K(me).out ?? ['text'])[0], to: nb.id, in: (K(nb).in ?? ['text'])[0], type: mod === 'meta' ? 'cond' : 'data' });
  saveFlow(); saveWires(); renderFlow(); focusText(nb.id);
}

// ── 执行 ───────────────────────────────────────────────────
// ⚠️ 只有「宾语 · 去处」那一类会动到**外面**（写 Notion / 发通知 / 打开东西）。
//    其余的都在本机算。所以执行到那一步要能看出来它做了什么、做了什么失败。
const RUNNERS = {
  'src.notes': async (b) => {
    const r = await api('/api/search?n=6&q=' + encodeURIComponent(b.text || '') +
      (b.src ? '&space=' + encodeURIComponent((SOURCES.find((s) => s.id === b.src) || {}).spaces?.[0] ?? '') : ''));
    const hits = r.hits ?? [];
    return { out: hits.length ? hits.map((h) => h.text).join('\n\n') : '', note: hits.length ? `命中 ${hits.length} 段笔记` : '笔记里没有' };
  },
  'src.web': async (b) => {
    const r = await post('/api/web', { q: b.text || '', sessionId: sid });
    return { out: r.answer || '', note: r.web?.length ? `网上 ${r.web.length} 条` : (r.webError || '没结果') };
  },
  'src.clip': async () => ({ out: await navigator.clipboard.readText().catch(() => ''), note: '剪贴板' }),
  'act.ask':     async (b, up) => ({ out: (await post('/api/ask', { q: (up ? up + '\n\n' : '') + (b.text || ''), source: 'flow', sessionId: sid, spaces: flowSpaces() })).answer || '', note: 'AI' }),
  'act.summary': async (b, up) => ({ out: (await post('/api/ask', { q: '把下面这段总结成几条：\n\n' + (up || b.text || ''), source: 'flow', sessionId: sid })).answer || '', note: '总结' }),
  'act.words':   async (b, up) => ({ out: (await post('/api/ask', { q: '翻译并解释：' + (up || b.text || ''), source: 'flow', sessionId: sid })).answer || '', note: '翻译' }),
  'act.class':   async (b, up) => ({ out: (await post('/api/ask', { q: '把下面这段归类，说出类别和一个理由：\n\n' + (up || b.text || ''), source: 'flow', sessionId: sid })).answer || '', note: '归类' }),
  'act.extract': async (b, up) => ({ out: (await post('/api/ask', { q: '从下面这段里抽出要点和待办，逐条列：\n\n' + (up || b.text || ''), source: 'flow', sessionId: sid })).answer || '', note: '抽要点' }),
  'act.judge':   async (b, up) => {
    const a = (await post('/api/ask', { q: '只回答「是」或「否」：' + (b.text || '') + '\n\n' + (up || ''), source: 'flow' })).answer || '';
    return { out: a, flag: /^是/.test(a.trim()), note: /^是/.test(a.trim()) ? '真' : '假' };
  },
  'out.shelf':  async (b, up) => { shelfAdd(up || b.text || '', 'clip', '✦'); return { note: '已放货架' }; },
  'out.say':    async (b, up) => { const u = new SpeechSynthesisUtterance(String(up || b.text || '').slice(0, 400)); u.lang = 'zh-CN'; speechSynthesis.speak(u); return { note: '念了' }; },
  'out.notify': async (b, up) => {
    if (!('Notification' in window)) return { note: '这个环境没有通知' };
    if (Notification.permission !== 'granted') { try { await Notification.requestPermission(); } catch {} }
    if (Notification.permission === 'granted') { new Notification('C4emem', { body: String(up || b.text || '').slice(0, 120) }); return { note: '发了通知' }; }
    return { note: '通知没授权' };
  },
  'out.open':   async (b, up) => {
    const m = /https?:\/\/\S+/.exec(String(up || b.text || ''));
    if (!m) return { note: '没找到链接' };
    window.open(m[0], '_blank'); return { note: '打开了 ' + m[0].slice(0, 40) };
  },
  // ⚠️ 四段式，顺序不能换：**切条 → 分类 → 你来勾 → 才写**。
  //    读者 2026-10-09 定的：「我需要每次都自己选择然后再写入」。
  //    所以这里**故意没有**"以后别问"的选项 —— 复核本身就是它的用法。
  'out.notion': async (b, up) => {
    const items = splitItems(up || b.text);
    if (!items.length) return { note: '没有内容可写' };
    // 块上自己标了来源 ⇒ 那一条就听它的（用户明确选过，别拿模型去覆盖他的决定）
    const auto = b.src && ROUTEABLE.includes(b.src) ? items.map(() => b.src) : await classifyBatch(items);
    const picked = await openWriteReview(items, auto);
    if (!picked) return { note: `你取消了，${items.length} 条都没写` };
    let good = 0;
    const failed = [];
    for (const it of picked.items) {
      const r = await post('/api/notion/append', { cat: it.page, text: it.text, dryRun: false });
      if (r.ok) good += 1;
      else failed.push(PAGE_CN[it.page] + ':' + String(r.output || '').slice(0, 40));
    }
    return { note: failed.length ? `写了 ${good} 条，${failed.length} 条失败（${failed[0]}）` : `写了 ${good} 条，各回各自的页面` };
  },
  'out.note':   async (b, up) => {
    const blob = new Blob([String(up || b.text || '')], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'c4emem-' + Date.now() + '.md'; a.click();
    return { note: '存成文件了' };
  },
};

async function runFlow() {
  const out = $('#flowout');
  if (!flow.length) return (out.textContent = '结构流里还没有内容');
  // 拓扑：只按"数据线"推进入度；顺序线只影响先后，条件线不阻塞
  const indeg = new Map(flow.map((b) => [b.id, 0]));
  for (const w of wires) if (w.type === 'data' && indeg.has(w.to)) indeg.set(w.to, indeg.get(w.to) + 1);
  const done = new Set();
  const prod = new Map();
  const order = [];
  for (let guard = 0; guard < flow.length * flow.length + 8; guard += 1) {
    const ready = flow.filter((b) => !done.has(b.id) && (indeg.get(b.id) ?? 0) === 0);
    if (!ready.length) break;
    for (const b of ready) { done.add(b.id); order.push(b); }
    for (const b of ready) for (const w of wires) if (w.from === b.id && indeg.has(w.to)) indeg.set(w.to, indeg.get(w.to) - 1);
  }
  if (order.length < flow.length) {
    const left = flow.filter((b) => !done.has(b.id));
    out.textContent = '⚠️ 这几块连成了环，跑不了：' + left.map((b) => K(b).nm).join(' → ');
    return;
  }
  const log = [];
  // ⭐ 除了给人看的字符串，还要一份**结构化的** —— 它要落库、要被追问引用。
  //    ⚠️ 只存那段 join 出来的文本的话，"哪一步失败了"就再也还原不出来了。
  const steps = [];
  const t0 = Date.now();
  for (const b of order) {
    const st = document.querySelector('[data-stat="' + b.id + '"]');
    if (st) { st.textContent = '跑…'; st.className = 'bstat run'; }
    const ups = wires.filter((w) => w.to === b.id && w.type === 'data').map((w) => prod.get(w.from)).filter(Boolean);
    const up = ups.join('\n\n');
    const kind = normKind(b.kind);
    const nm = `${K(b).nm}${b.text ? '（' + b.text.slice(0, 18) + '）' : ''}`;
    // ⚠️⚠️ 事件块是**触发器**，不是"要执行的一步" —— 它没有 RUNNERS 是设计如此。
    //    2026-10-13 实测：原来它落进「没有执行器」那一支 ⇒ `ok:false` ⇒ 汇总行报
    //    「✗ 1 块失败」，而**同一块自己的角标是绿的**（角标只看有没有抛异常）——
    //    **同一个块，两处给出的结论相反**。而「搭一条骨架 → 运行」正是默认路径，
    //    等于一按就是红的（其实没有任何东西失败）。
    const trig = /^事件/.test(K(b).grp || '');
    try {
      const fn = RUNNERS[kind];
      const r = fn ? await fn(b, up) : { note: trig ? '触发器' : '这类块还没有执行器' };
      if (r.out) prod.set(b.id, r.out);
      if (st) { st.textContent = r.note || '✓'; st.className = 'bstat ' + (trig && !fn ? 'trig' : 'ok'); }
      log.push(`${nm} — ${r.note || '完成'}`);
      // ⚠️ 触发器不计进「失败」，但**也不冒充 ✓** —— 它是第三种状态（`trig`），
      //    日志那边画一个「·」而不是打勾：`ev.phone`（手机来通知）手动跑时并没真的发生。
      steps.push({ name: nm, ok: !!fn || trig, note: r.note || '完成', trig: trig && !fn });
    } catch (e) {
      if (st) { st.textContent = '失败'; st.className = 'bstat bad'; }
      log.push(`${K(b).ic} ${nm} — ✗ ${e.message}`);
      steps.push({ name: nm, ok: false, note: '✗ ' + (e?.message ?? e) });
    }
  }
  // ⚠️ 底栏只留**一行摘要**，明细在下面那块面板里。
  //    两处都铺全文的结果是：底栏那行被挤成一坨，而用户不知道该看哪个。
  const bad = steps.filter((s) => !s.ok).length;
  out.textContent = `${bad ? '✗ ' + bad + ' 块失败 · ' : '✓ '}${steps.length} 块 · ${((Date.now() - t0) / 1000).toFixed(1)}s` +
    (bad ? '（失败原因在下面「记录」里）' : '');
  const last = [...order].reverse().find((b) => prod.get(b.id));
  const result = (last && prod.get(last.id)) || log.join('\n');
  // ⚠️ 结果**留在结构流自己这一屏**（见下面 renderRun），不再往右边那条对话里塞。
  //    读者原话：「动作在对话这里，也不是不可以，但是最好在自己那里有 log
  //    有之后的后续处理和对话」—— 塞两处的话，翻回去看时**不知道哪条是哪次跑的**。
  await renderRun({
    steps,
    output: String(result),
    ms: Date.now() - t0,
    title: flow.map((b) => b.text).filter(Boolean).join(' → ').slice(0, 120),
  });
  await post('/api/blocks', { kind: 'flow', label: flow.map((b) => b.text).filter(Boolean).join(' → ').slice(0, 120) });
  refreshDash();
}

/**
 * 把「这一次跑了什么」落到服务端，并画进结构流自己的面板。
 *
 * ⚠️ 为什么必须落库：跑完一次结果就只活在内存里的话，
 *    刷新一下、或者切走再回来，**这次跑过什么就没了** ——
 *    而用户恰恰是"过一会儿才想起来要处理它"。
 */
let frRun = null; // 当前这次运行 { id, steps, output }
async function renderRun(run) {
  const box = $('#flowruns');
  box.hidden = false;
  $('#frwhen').textContent = '';
  $('#frlog').innerHTML = run.steps.map((s) =>
    '<div class="st"><span class="' + (s.ok ? 'ok' : 'bad') + '">' + (s.ok ? '✓' : '✗') + '</span>' +
    '<span>' + esc(s.name) + '</span><span class="k" style="margin-left:auto">' + esc(s.note) + '</span></div>').join('') +
    (run.output ? '<div class="frout">' + esc(run.output) + '</div>' : '');
  $('#frchat').innerHTML = '';
  try {
    const r = await post('/api/flow/run', { steps: run.steps, output: run.output, ms: run.ms, title: run.title });
    if (r.error) { toast(r.error, 'bad'); return; }
    frRun = { id: r.id, steps: run.steps, output: run.output };
    $('#frwhen').textContent = `刚跑完 · ${run.steps.length} 块 · ${(run.ms / 1000).toFixed(1)}s`;
    const t = await api('/api/flow/ask?runId=' + r.id).catch(() => ({ turns: [] }));
    paintAsk(t.turns || []);
  } catch (e) {
    toast('这次运行没能存下来：' + (e?.message ?? e), 'bad');
  }
}

function paintAsk(turns) {
  const box = $('#frchat');
  if (!turns.length) return;
  box.innerHTML = turns.map((t) =>
    '<div class="q">' + esc(t.q) + '</div><div class="a">' + esc(t.a || '（没有回答）') + '</div>').join('');
  box.scrollIntoView({ block: 'nearest' });
}

async function askFlow() {
  const q = $('#frq').value.trim();
  if (!q) return;
  if (!frRun) return toast('先点上面的「运行」跑一次，再问', 'bad');
  $('#frq').value = '';
  const box = $('#frchat');
  box.insertAdjacentHTML('beforeend', '<div class="q">' + esc(q) + '</div><div class="a" id="frwaiting">在想…</div>');
  const r = await post('/api/flow/ask', { runId: frRun.id, q });
  $('#frwaiting')?.remove();
  if (r.error) { box.insertAdjacentHTML('beforeend', '<div class="a">⚠️ ' + esc(r.error) + '</div>'); return; }
  box.insertAdjacentHTML('beforeend', '<div class="a">' + esc(r.answer) + '</div>');
  box.scrollIntoView({ block: 'nearest' });
}

/**
 * ⭐ 块库（可增删）—— 读者 ⑧ 清单里的最后一条。
 *
 * 解释取**能收能放**：库里有二十来种块，真正常用的就那几个，选择器于是越拉越长。
 * ⚠️⚠️ **收起来 = 从选择器里隐藏，不是删掉那种块** —— 画布上已经有的照跑不误。
 *    「删了」和「收起来」在界面上长得一模一样，但后者**不会让旧图失效**。
 * ⚠️ 存 localStorage（和 `lastKind` 同一处）：这是**结构流这一屏的偏好**，不是引擎级设置
 *    —— 引擎级的那批按 `features.ts` 的规矩走注册表（见 ⑨）。
 */
const LIB_KEY = 'c4emem.flowlib.hidden';
const hiddenKinds = () => { try { return new Set(JSON.parse(localStorage.getItem(LIB_KEY) || '[]')); } catch { return new Set(); } };
const saveHiddenKinds = (s) => localStorage.setItem(LIB_KEY, JSON.stringify([...s]));

async function openPicker(anchorEl) {
  $('.kpick')?.remove();
  const recent = (await api('/api/blocks')).recentKinds || [];
  const hid = hiddenKinds();
  const keep = (k) => !!KINDS[k] && !hid.has(k);          // ⭐ 块库里收起来的，这里就不再出现
  const groups = {};
  for (const k of [...new Set([...recent.map(normKind), ...Object.keys(KINDS)])].filter(keep)) {
    (groups[KINDS[k]?.grp ?? '其他'] ??= []).push(k);
  }
  // ⚠️ Notion 相关的功能**要一眼看得出来** —— 它会动到你的真笔记，
  //    和"在本机算一下"代价不对称，混在一起选错不是一回事。
  const btn = (k) => '<button data-k="' + k + '">' + icon(KINDS[k].ic) + '<span>' + esc(KINDS[k].nm) + '</span>' +
    (KINDS[k].notion ? '<b class="nb">N</b>' : '') + '</button>';
  const el = document.createElement('div');
  el.className = 'kpick';
  el.innerHTML =
    (recent.length ? '<div class="hd">最近用过</div>' + [...new Set(recent.map(normKind))].filter(keep).map(btn).join('') : '') +
    // ⚠️ 「来源」这一组**不再单列** —— 知识库那几项全部聚到最上面一块。
    //    同一批东西列两遍，等于让人在两个地方做同一个决定。
    '<div class="hd">知识库 · 全部来源</div>' + KB_KINDS.filter(keep).map(btn).join('') +
    Object.entries(groups).filter(([g]) => g !== '主语 · 来源').map(([g, ks]) => '<div class="hd">' + g + '</div>' + ks.map(btn).join('')).join('');
  document.body.appendChild(el);
  const r = anchorEl.getBoundingClientRect();
  el.style.left = Math.min(r.left + 56, innerWidth - el.offsetWidth - 12) + 'px';
  el.style.top = Math.min(r.bottom + 4, innerHeight - el.offsetHeight - 12) + 'px';
  el.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const cur = flow.find((x) => x.id === sel);
    if (cur) { cur.kind = b.dataset.k; lastKind = b.dataset.k; localStorage.setItem('c4emem.lastKind', lastKind); saveFlow(); renderFlow(); }
    el.remove();
  };
  setTimeout(() => document.addEventListener('click', function off(ev) {
    if (!el.contains(ev.target)) { el.remove(); document.removeEventListener('click', off); }
  }), 0);
}

/**
 * 「块库」面板：把不用的块**收起来**、把收起来的**放出来**。
 * ⚠️ 只影响**选择器**，不动执行器 —— 画布上已有的那种块照跑（同 openPicker 上面那段）。
 * ⚠️ 每点一下就重开一次面板，而不是就地改那一个字：面板里还有分组和「全部放出」，
 *    就地改的话这几处很容易只改了一半（**一半新一半旧**比整个不刷新还难发现）。
 */
function openLib(anchorEl) {
  $('.kpick')?.remove();
  const hid = hiddenKinds();
  const groups = {};
  for (const k of Object.keys(KINDS)) (groups[KINDS[k].grp ?? '其他'] ??= []).push(k);
  const row = (k) => {
    const off = hid.has(k);
    return '<button data-h="' + esc(k) + '"' + (off ? ' class="off"' : '') + '>' + icon(KINDS[k].ic) +
      '<span>' + esc(KINDS[k].nm) + '</span><b class="st">' + (off ? '放出' : '收起') + '</b></button>';
  };
  const el = document.createElement('div');
  el.className = 'kpick lib';
  el.innerHTML =
    '<div class="hd">收起的不再出现在「换类型」里（画布上已有的照跑）</div>' +
    Object.entries(groups).map(([g, ks]) => '<div class="hd">' + esc(g) + '</div>' + ks.map(row).join('')).join('') +
    '<div class="hd">　</div><button data-h="__all__"><span>把收起来的全部放出</span></button>';
  document.body.appendChild(el);
  const r = anchorEl.getBoundingClientRect();
  el.style.left = Math.max(12, Math.min(r.left, innerWidth - el.offsetWidth - 12)) + 'px';
  el.style.top = Math.max(12, Math.min(r.bottom + 4, innerHeight - el.offsetHeight - 12)) + 'px';
  el.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.h;
    const s = hiddenKinds();
    if (k === '__all__') s.clear();
    else if (s.has(k)) s.delete(k);
    else s.add(k);
    saveHiddenKinds(s);
    el.remove();
    openLib(anchorEl);            // 重开：分组、按钮文案、「全部放出」一起跟着变
    toast(s.size ? '块库里收起了 ' + s.size + ' 种（随时能放出来）' : '块库全部放出来了');
  };
  setTimeout(() => document.addEventListener('click', function off(ev) {
    if (!el.contains(ev.target)) { el.remove(); document.removeEventListener('click', off); }
  }), 0);
}

// ══════════════════════════════════════════════════════════
// 桌面 CEVTUO Pet（读者 2026-10-10）
// ══════════════════════════════════════════════════════════
/**
 * ⚠️ 说清它现在**不是**什么：它是**应用窗口里的一个浮层**，
 *    关掉窗口它也就没了 —— 真"关掉软件还留在桌面"要 Swift 那边另开一个置顶窗口
 *    （那是一件独立的事，见 docs/HANDOFF.md §6）。设置页里也是这么写的，不吹。
 */
/**
 * ⚠️⚠️ 这份清单**必须和 `#vorb` 那个下拉对齐**（读者 2026-10-10：
 *   「形态选择新的这几种，添加银铅锌，**没有的删除**」）。
 *   以前这里多了个 `crystal`，而 `ORB_VIDEO` 里**没有**它
 *   ⇒ `renderPet()` 会把 `src="undefined"` 塞进 `<video>` —— Pet 换成那个形态就是一片空白。
 *   ⇒ 判据是「**每一个 id 都能在 ORB_VIDEO 里查到文件**」，见 verify-pet.mjs。
 *   `珍珠玻璃` 也一并按读者的话改成 `珍珠`。
 */
const PET_FORMS = [
  { id: 'card', nm: 'CEVTUO 卡片' },
  { id: 'pearl', nm: '珍珠' },
  { id: 'silver', nm: '银' },
  { id: 'lead', nm: '铅' },
  { id: 'zinc', nm: '锌' },
];
const BG_KEY = 'c4emem.bg';
const bgPref = () => { try { return JSON.parse(localStorage.getItem(BG_KEY) || '{}'); } catch { return {}; } };
/**
 * 把背景偏好写到 `:root` 上（CSS 那边读 `--bg-voice` / `--bg-text`）。
 * ⚠️ 空字符串要**清掉那个变量**，不能写成 `url('')` ——
 *    那是一个会去请求当前目录的**无效请求**，表现是控制台一条 404 + 背景变成透明。
 */
function applyBg(patch, reset) {
  const cur = reset ? {} : { ...bgPref(), ...patch };
  if (!reset) localStorage.setItem(BG_KEY, JSON.stringify(cur));
  const put = (name, v) => {
    if (v) document.documentElement.style.setProperty(name, `url('${v.replace(/'/g, '%27')}')`);
    else document.documentElement.style.removeProperty(name);
  };
  put('--bg-voice', cur.voice);
  put('--bg-text', cur.text);
}
const PET_KEY = 'c4emem.pet';
const petPref = () => { try { return JSON.parse(localStorage.getItem(PET_KEY) || '{}'); } catch { return {}; } };
const petSave = (p) => localStorage.setItem(PET_KEY, JSON.stringify({ ...petPref(), ...p }));

function renderPet() {
  const p = petPref();
  const form = PET_FORMS.some((f) => f.id === p.form) ? p.form : 'card';
  const body = $('#petbody');
  if (!body) return;
  // ⚠️ 类名 `ptcard` 而不是 `card` —— 见 app.css 里 `.orbbg.ckon` 那段（撞上通用 `.card`）
  body.className = 'petbody' + (form === 'card' ? ' ptcard' : ORB_KEYED[form] ? ' mono' : '');
  // ⚠️ 卡片形态用**同一张原图**（src/ui/assets/card.png），不是重画的
  //
  // ⭐ 矿物三种在 Pet 里用**已经抠好白底的动图 webp**（`*-mini.webp`），不是那段原视频：
  //    · Pet 只有 104px，**不需要变速**（那是语音屏那颗大球的特性），
  //      所以这里用图最省事；
  //    · 用原视频的话，这个圆里就是**一块白饼** —— 白底在这层没法抠。
  //    抠的做法见 src/ui/assets/README.md。
  body.innerHTML = form === 'card'
    // ⭐ 卡片形态在 Pet 里**不是一张平铺的图**，而是和语音屏那颗同构的**多层卡**
    //   （同一个 card.png + 同一套层叠厚度），靠 CSS `scale(.305)` 缩下来、慢慢左右摆。
    //   读者 2026-10-10：「在 cevtuopet 时候卡片不动要改变，**要旋转**」。
    ? '<div class="ck" id="petck"></div>'
    : (ORB_KEYED[form]
      ? `<img src="/ui/assets/mineral-${form}-mini.webp" alt="">`
      : `<video src="${ORB_VIDEO[form]}" muted loop autoplay playsinline></video>`);
  // ⚠️ 先挂进 DOM 再 buildCard —— 游离的元素上 `$('#petck')` 查不到（这个坑记过）
  if (form === 'card') buildCard($('#petck'), 2, 10);
  const pet = $('#pet');
  if (pet) pet.dataset.form = form;
  if (p.x != null && p.y != null) {
    // 存的是左上角坐标；贴边了要夹回可视区，不然换分辨率之后它会跑到屏幕外
    pet.style.left = Math.min(Math.max(4, p.x), innerWidth - 110) + 'px';
    pet.style.top = Math.min(Math.max(4, p.y), innerHeight - 120) + 'px';
    pet.style.right = 'auto'; pet.style.bottom = 'auto';
  }
}
function petOn(on) {
  petSave({ on: !!on });
  document.body.classList.toggle('pet-on', !!on);
  if (on) renderPet();
}
/** 说话的文字进泡泡。⚠️ 「你」说青色、它说白色，一眼分得出谁在说。 */
function petSay(kind, text) {
  if (!document.body.classList.contains('pet-on')) return;
  const b = $('#petbubble');
  if (!b) return;
  b.textContent = String(text || '').slice(0, 300);
  b.classList.add('on');
  b.style.borderColor = kind === 'you' ? 'rgba(215,242,74,.85)' : 'rgba(0,0,0,.08)';
  clearTimeout(petSay._t);
  // ⚠️ 气泡**自己会收**（12 秒）—— 不收的话它就变成一块永远挂在那儿的白板
  petSay._t = setTimeout(() => b.classList.remove('on'), 12000);
}
// ── Pet 那一圈：**正在运行的桌面 App** ────────────────────────
/**
 * ⭐ 读者 2026-10-10：「点击之后**弹出来桌面正在打开了的软件**，选择就可以切换，
 *    **聚集在周围的感觉**，再次点击收回」。
 *
 * ⚠️ 摆放是**算出来的**（角度 → 坐标），不是手工写死十几个位置：
 *    App 数量本来就不定，写死的话开了第 7 个它就会叠在别人身上。
 *    两圈：里圈弧 176°→300°，每圈最多 6 个，外圈再往后排。
 * ⚠️ 图标走 `/api/appicon`（服务端 `sips` 转过一次、**落盘缓存**）——
 *    十来个图标现转是半秒白屏，而这一圈要"点一下就出现"。
 */
let petApps = null;
/** 收起那一圈的延时器（指针从 Pet 移到圈里的图标上时会先离开 Pet） */
let petRingTimer = 0;
/**
 * 右键 Pet 打开的**那一整套设置** —— 打开抽屉并滚到 Pet 那一段。
 * ⚠️ 光打开抽屉是不够的：抽屉很长（接口 / 用量 / 外观 / Pet …），
 *    不滚过去的话打开之后还得自己找，而"找不到"和"没有这一项"长得一样。
 */
async function openPetSettings() {
  await openSettings();
  const sec = $('#secpet');
  if (!sec) return;
  sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
  sec.classList.add('flash');
  setTimeout(() => sec.classList.remove('flash'), 1200);
}
/** 那个首字母角标露不露（设置里的开关，默认露） */
const petPaintLetters = () => document.body.classList.toggle('pet-letters-off', petPref().letters === false);
const petRingOpen = () => document.body.classList.contains('petring-on');
function petCloseRing() { document.body.classList.remove('petring-on'); }
function petOpenSelf() {
  // 有原生桥就走原生（真的把那个窗口叫到前面），没有就切到语音那一屏 —— **不装样子**
  if (window.c4native?.show) return window.c4native.show();
  show('voice');
}
async function petOpenApp(path) {
  if (!path) return toast('还没选要打开哪个软件 —— 去设置里挑一个', 'bad');
  const r = await post('/api/apps/activate', { path });
  if (r.error) return toast(r.error, 'bad');
  toast('切过去了', 'good');
}
function petPaintRing() {
  const host = $('#petring');
  if (!host) return;
  const apps = petApps || [];
  const per = 6, R0 = 116, DR = 76, a0 = 176, a1 = 300;
  host.innerHTML = apps.map((a, i) => {
    const tier = Math.floor(i / per), k = i % per;
    const cnt = Math.min(per, apps.length - tier * per);
    const ang = (a0 + (a1 - a0) * (cnt <= 1 ? 0.5 : k / (cnt - 1))) * (Math.PI / 180);
    const r = R0 + tier * DR;
    const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
    return '<button data-app-path="' + esc(a.path) + '" title="' + esc(a.name) + '"' +
      ' style="left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;animation-delay:' + (i * 24) + 'ms">' +
      '<span class="rl">' + esc((a.name || '?')[0]) + '</span>' +
      '<img src="/api/appicon?path=' + encodeURIComponent(a.path) + '" alt="" onerror="this.style.display=\'none\'">' +
      '<i>' + esc(a.name) + '</i></button>';
  }).join('');
  host.querySelectorAll('[data-app-path]').forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    await petOpenApp(b.dataset.appPath);
    petCloseRing();
  }));
}
async function petOpenRing() {
  const host = $('#petring');
  if (!host) return;
  document.body.classList.add('petring-on');
  // ⚠️ 先用**上一次那份**画出来（点一下立刻有东西），再去刷新 ——
  //    等请求回来才画的话，那一下就是空白的，看着像"没反应"
  if (petApps?.length) petPaintRing();
  else host.innerHTML = '<div class="ringwait">读正在运行的软件…</div>';
  const r = await api('/api/running').catch(() => ({ apps: [] }));
  petApps = r.apps || [];
  if (!petApps.length) { toast('没读到正在运行的软件', 'bad'); return petCloseRing(); }
  petPaintRing();
}
/** 设置里那个「打开指定软件」的候选清单（本机 .app） */
async function loadPetApps() {
  const box = $('#petapplist');
  if (!box) return;
  box.dataset.done = '1';
  const r = await api('/api/apps').catch(() => ({ apps: [] }));
  const apps = (r.apps || []).filter((a) => !a.known);
  box.innerHTML = apps.length
    ? '<div style="max-height:120px;overflow:auto">' + apps.map((a) =>
        '<button class="ghost sm appick" style="margin:3px 4px 0 0" data-p="' + esc(a.path) + '">' + esc(a.name) + '</button>').join('') + '</div>'
    : '没扫到应用';
  box.querySelectorAll('.appick').forEach((b) => (b.onclick = () => {
    $('#petapp').value = b.dataset.p;
    petSave({ appPath: b.dataset.p });
    toast('记下了：' + b.textContent);
  }));
}

function petInit() {
  const pet = $('#pet');
  if (!pet) return;
  if (petPref().on) document.body.classList.add('pet-on');
  petPaintLetters();
  renderPet();
  // 拖
  let dragging = false, dx = 0, dy = 0, moved = 0;
  pet.addEventListener('pointerdown', (e) => {
    dragging = true; moved = 0;
    pet.classList.add('dragging');
    pet.setPointerCapture(e.pointerId);
    const r = pet.getBoundingClientRect();
    dx = e.clientX - r.left; dy = e.clientY - r.top;
  });
  pet.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    moved = Math.max(moved, Math.abs(e.movementX) + Math.abs(e.movementY));
    const x = Math.min(Math.max(4, e.clientX - dx), innerWidth - 110);
    const y = Math.min(Math.max(4, e.clientY - dy), innerHeight - 120);
    pet.style.left = x + 'px'; pet.style.top = y + 'px';
    pet.style.right = 'auto'; pet.style.bottom = 'auto';
  });
  pet.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    pet.classList.remove('dragging');
    pet.releasePointerCapture?.(e.pointerId);
    const r = pet.getBoundingClientRect();
    petSave({ x: Math.round(r.left), y: Math.round(r.top) });
  });
  // 点：按**设置里选的那件事**做。⚠️ 拖完那一下不算点击（否则挪个位置就会误触发）
  pet.addEventListener('click', () => {
    if (moved > 6) { moved = 0; return; }
    const m = petPref().mode || 'apps';
    if (m === 'voice') return toggleMic();
    if (m === 'c4emem') return petOpenSelf();
    if (m === 'open') return petOpenApp(petPref().appPath);
    // apps：**再点一下收回**（读者原话）
    return petRingOpen() ? petCloseRing() : petOpenRing();
  });
  /**
   * ⭐⭐ 读者 2026-10-10 深夜：「当多软件那个的时候应该是**鼠标放上去它就展示**
   *    当前窗口打开的软件出现」。
   * ⚠️ 收起要有**延迟**：指针从 Pet 移到那一圈里的图标上时会先离开 Pet，
   *    立刻收的话你永远点不到（那一圈会在你手底下消失）——
   *    而"点不到"看起来就像"这个功能没做"。
   */
  /**
   * ⚠️⚠️ 展开/收起**不能用 `mouseenter` / `mouseleave`**（读者 2026-10-10：
   *   「鼠标移动过去会**反复跳**，去触摸软件那些图标的时候」）。
   *   根因：指针从 Pet 移到那一圈里的图标上时，会**穿出 `#pet` 的边界**（那一圈是
   *   `position:absolute` 悬在外面的）⇒ `mouseleave` 立刻关 ⇒ 指针还在圈里又碰到 Pet ⇒ 再开……
   *   一秒钟能开合好几次。
   * ⇒ 判据换成**几何**：指针离 Pet 中心的距离 < 280px 就算"在它这一带"，
   *   无论中间穿过多少个元素边界都不会误判。
   */
  // ⚠️ **滞回**：开的半径 ≠ 关的半径。同一个值时指针停在边界上会一直开-关-开-关。
  const R_OPEN = 240, R_CLOSE = 360;
  let openedAt = 0;
  document.addEventListener('mousemove', (e) => {
    if ((petPref().mode || 'apps') !== 'apps') return;
    const r = pet.getBoundingClientRect();
    const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    if (!petRingOpen()) {
      if (d < R_OPEN) { clearTimeout(petRingTimer); petOpenRing(); openedAt = Date.now(); }
      return;
    }
    if (d < R_CLOSE) { clearTimeout(petRingTimer); return; }
    clearTimeout(petRingTimer);
    petRingTimer = setTimeout(() => { if (Date.now() - openedAt > 700) petCloseRing(); }, 320);
  });
  // 点别的地方 / Esc 也要收 —— 只靠"再点它"收的话，那一圈会一直挂在屏幕上
  document.addEventListener('click', (e) => {
    if (!petRingOpen()) return;
    if (pet.contains(e.target)) return;
    petCloseRing();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') petCloseRing(); });
  /**
   * ⭐⭐ 右键 = **Pet 的全套设置**（读者 2026-10-10 深夜：
   *   「右键应该是设置功能（**所有的跟 cevtupet 相关的功能，也包括切换**）而不是切换」）。
   * ⚠️ 原来右键是"换下一个形态" —— 那是**一个**动作，而现在要的是**入口**：
   *    形态、点它做什么、字母角标、开关，全在那个抽屉里。右键直接把它叫出来。
   */
  pet.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    petCloseRing();
    openPetSettings();
  });
  // 说话时它自己会亮起来
  const mo = new MutationObserver(() => {
    const live = document.querySelector('#mic.live');
    $('#pet')?.classList.toggle('talking', !!live);
  });
  const mic = $('#mic');
  if (mic) mo.observe(mic, { attributes: true, attributeFilter: ['class'] });
}

// ── 货架：点一下看它到底是什么 ────────────────────────────
const KIND_CN = { clip: '剪贴板', file: '文件', link: '链接', img: '图片', flow: '结构流', text: '文字', voice: '语音' };
function openShelfPreview(i) {
  const it = shelf[i];
  if (!it) return;
  shelfPrevIdx = i;
  $('#spTitle').textContent = (KIND_CN[it.kind] || '这一段') + ' · ' + String(it.text).length + ' 字';
  $('#spBody').innerHTML =
    (it.url ? '<img src="' + esc(it.url) + '" alt="">' : '') + esc(it.text);
  $('#shelfprev').hidden = false;
}
let shelfPrevIdx = -1;

// ── 搜索命中：点开看**全文** + 一键跳回那个软件 ──────────────────
/**
 * ⭐⭐ 读者 2026-10-10 傍晚：「有一些**看不完全，但是我点击也看不完全**……
 *    **点击也能全览那里的内容**才行，不能只有半截的但是我什么都做不了」。
 * ⚠️ 所以这里是**全文**（不截断、可滚动），而且给一条"我走了"的路：
 *    那个软件本来就装着的话，一键把它打开。
 */
let lastHits = [];
let hitApps = null;
async function appForSpace(space) {
  // space → 大概该开哪个软件。⚠️ 只列**真的可能装着**的，对不上就不给这个键 ——
  //    给一个按下去没反应的键，比不给更糟。
  const want = /^(learn|techai|techlearn|shopping|tech-|notion)/i.test(String(space)) ? /^notion$/i
    : /^(exmail|wecom|mail)/i.test(String(space)) ? /企业微信|WeCom|QQ|邮箱|Mail|Outlook|Foxmail/i
      : /^(figma)/i.test(String(space)) ? /^figma$/i
        : null;
  if (!want) return null;
  if (!hitApps) hitApps = (await api('/api/apps').catch(() => ({ apps: [] }))).apps || [];
  return hitApps.find((a) => want.test(a.name)) || null;
}
async function openHit(i) {
  const h = (lastHits || [])[i];
  if (!h) return;
  $('#hvTitle').textContent = h.space + ' · ' + h.date + (h.sim != null ? ' · 余弦 ' + h.sim.toFixed(3) : '');
  // ⚠️ `textContent` 不是 `innerHTML`：这是**笔记原文**，拿它当 HTML 解析等于把内容当代码跑
  $('#hvBody').textContent = h.text || '（空）';
  $('#hvMeta').textContent = String(h.text || '').length + ' 字' + (h.via ? ' · 命中方式：' + h.via : '');
  const btn = $('#hvOpen');
  const app = await appForSpace(h.space).catch(() => null);
  btn.hidden = !app;
  if (app) {
    btn.textContent = '打开 ' + app.name;
    btn.onclick = async () => {
      const r = await post('/api/apps/activate', { path: app.path });
      toast(r.error ? r.error : '把 ' + app.name + ' 叫到前面了', r.error ? 'bad' : 'good');
    };
  }
  $('#hitview').hidden = false;
}
$('#hvClose').onclick = () => { $('#hitview').hidden = true; };
$('#hitview').onclick = (e) => { if (e.target.id === 'hitview') $('#hitview').hidden = true; };
$('#hvCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('#hvBody').textContent); toast('复制好了'); }
  catch { toast('浏览器不给复制 —— 手动选一下吧', 'bad'); }
};
$('#hvShelf').onclick = () => { shelfAdd($('#hvBody').textContent, 'clip', 'clip'); toast('放进货架了', 'good'); };
$('#hvUse').onclick = () => {
  const box = mode === 'text' ? $('#tinput') : $('#vinput');
  if (box) { box.value = $('#hvBody').textContent; box.focus(); }
  $('#hitview').hidden = true;
};
$('#shelfbody').addEventListener('click', (e) => {
  // ⚠️ 「×」（删）要**先拦掉**，不然点删除会连带弹一次预览 —— 那看着像删错了。
  if (e.target.closest && e.target.closest('.x')) return;
  const row = e.target.closest && e.target.closest('.sitem');
  if (!row) return;
  openShelfPreview(Number(row.dataset.i));
});
$('#spClose').onclick = () => { $('#shelfprev').hidden = true; };
$('#shelfprev').onclick = (e) => { if (e.target.id === 'shelfprev') $('#shelfprev').hidden = true; };
$('#spUse').onclick = () => {
  const it = shelf[shelfPrevIdx];
  if (!it) return;
  const box = mode === 'text' ? $('#tinput') : $('#vinput');
  if (box) { box.value = it.text; box.focus(); }
  $('#shelfprev').hidden = true;
};
$('#spCopy').onclick = async () => {
  const it = shelf[shelfPrevIdx];
  if (!it) return;
  try { await navigator.clipboard.writeText(it.text); toast('复制好了'); }
  catch { toast('浏览器不给复制 —— 手动选一下吧', 'bad'); }
};

$('#flowrun').onclick = runFlow;
// ── 运行记录面板上的那几个键（读者要的「后续处理」）──────────────
$('#flowrunsBtn').onclick = () => { const b = $('#flowruns'); b.hidden = !b.hidden; };
$('#frClose').onclick = () => { $('#flowruns').hidden = true; };
$('#frask').onclick = askFlow;
$('#frq').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); askFlow(); } };
$('#frShelf').onclick = () => {
  if (!frRun?.output) return toast('还没有结果可以放', 'bad');
  shelfAdd(frRun.output, 'flow', 'flow');
  toast('放进货架了');
};
$('#frCopy').onclick = async () => {
  if (!frRun?.output) return toast('还没有结果可以复制', 'bad');
  try { await navigator.clipboard.writeText(frRun.output); toast('复制好了'); }
  catch { toast('浏览器不给复制 —— 手动选一下吧', 'bad'); }
};
$('#frHist').onclick = async () => {
  const r = await api('/api/flow/run?limit=12').catch(() => ({ items: [] }));
  const items = r.items || [];
  if (!items.length) return toast('还没有跑过');
  $('#frlog').innerHTML = '<div class="k">以前跑过的（点一条看它当时的结果）</div>' + items.map((x) =>
    '<div class="st hp" data-run="' + x.id + '" style="cursor:pointer">' +
    '<span class="k">' + esc(String(x.ts).slice(5, 16).replace('T', ' ')) + '</span>' +
    '<span style="flex:1">' + esc(x.title || '（无标题）') + '</span>' +
    '<span class="k">' + x.steps.length + ' 块 · ' + x.steps.filter((s) => !s.ok).length + ' 失败</span></div>').join('');
  $$('.hp').forEach((el) => (el.onclick = () => {
    const it = items.find((x) => String(x.id) === el.dataset.run);
    if (!it) return;
    frRun = { id: it.id, steps: it.steps, output: it.output };
    $('#frwhen').textContent = '历史 · ' + String(it.ts).slice(5, 16).replace('T', ' ');
    $('#frlog').innerHTML = it.steps.map((s) =>
      '<div class="st"><span class="' + (s.trig ? 'trig' : s.ok ? 'ok' : 'bad') + '">' + (s.trig ? '·' : s.ok ? '✓' : '✗') + '</span>' +
      '<span>' + esc(s.name) + '</span><span class="k" style="margin-left:auto">' + esc(s.note) + '</span></div>').join('') +
      '<div class="frout">' + esc(it.output || '（这次没留下结果）') + '</div>';
    api('/api/flow/ask?runId=' + it.id).then((t) => paintAsk(t.turns || [])).catch(() => paintAsk([]));
  }));
};
// 「?」—— 用户要的那个提示按钮
$('#flowHelp').onclick = () => { $('#flowhelp').hidden = false; };
$('#helpClose').onclick = () => { $('#flowhelp').hidden = true; };
$('#flowhelp').onclick = (e) => { if (e.target.id === 'flowhelp') $('#flowhelp').hidden = true; };
$('#flowclear').onclick = () => { flow = []; wires = []; sel = null; saveFlow(); saveWires(); renderFlow(); };

// ══════════════════════════════════════════════════════════
// 玻璃货架 —— 拖任何一段进来
// ══════════════════════════════════════════════════════════
let shelf = [];
const SHELF_KEY = 'c4emem.shelf';
try { shelf = JSON.parse(localStorage.getItem(SHELF_KEY) || '[]'); } catch {}
const saveShelf = () => localStorage.setItem(SHELF_KEY, JSON.stringify(shelf.slice(-40)));

function renderShelf() {
  $('#shelfbody').innerHTML = shelf.length
    ? shelf.map((s, i) => '<div class="sitem" draggable="true" data-i="' + i + '">' +
        (s.url ? '<img class="sthumb" src="' + esc(s.url) + '" alt="">' : '') +
      '<span class="ic">' + icon(s.ic) + '</span><span class="tx">' + esc(s.text) + '</span>' +
        '<span class="x" data-del="' + i + '">×</span></div>').join('')
    : '<div class="shelfempty">空着。把记录里的任意一段、或对话里的任意一句拖进来。</div>';
  $('#shelfcount').textContent = shelf.length ? shelf.length + ' 段' : '拖动任一段到这儿';
  // 收起来也要看得见有几段 —— 不然「收着但有东西」和「空的」长得一模一样
  const bd = $('#shelfbadge');
  if (bd) { bd.hidden = !shelf.length; bd.textContent = String(shelf.length); }
  $('#shelffoot').hidden = !shelf.length;
}
/**
 * 往货架上放东西。**这是唯一的入口** —— 拖拽、粘贴、拖文件都走它，
 * 所以"能放什么"这件事只有一个地方要维护。
 * ⚠️ `url` 是给图片/文件用的：有它就在卡片上显示缩略图，而不是显示一串文件名。
 */
function shelfAdd(text, kind = 'clip', ic = 'clip', url = '') {
  const t = String(text || '').trim();
  if (!t || shelf.some((s) => s.text === t && s.url === url)) return;
  shelf.push({ text: t, kind, ic, url });
  learnShelf();
  saveShelf(); renderShelf();
  $('#shelf').classList.add('over');
  setTimeout(() => $('#shelf').classList.remove('over'), 260);
}
/**
 * 落点处理 —— ⚠️ **货架和桌面 Pet 共用这一个函数**。
 *    读者 2026-10-10：「**不论怎么样都应该拖动内容到这里就作为 shelf 的功能**」。
 *    写成两份的话，两边迟早不一样（"货架收、Pet 不收"），而那正是这条要求的反面。
 */
function shelfDropHandler(e) {
  e.preventDefault();
  $('#shelf')?.classList.remove('over');
  $('#pet')?.classList.remove('over');
  const dt = e.dataTransfer;
  const t = dt?.getData('text/plain') || '';
  const kind = dt?.getData('application/x-c4emem-kind') || 'clip';
  if (!t.trim()) return;
  const n0 = shelf.length;
  shelfAdd(t, kind === 'ask' ? 'clip' : kind, kind === 'ask' ? 'chat' : (KINDS[normKind(kind)]?.ic || 'clip'));
  // ⭐ 收了东西要说话。原来收下是静默的 —— 而"收下了"和"没收到"在界面上只差一个数字。
  toast(shelf.length > n0 ? '已放进货架' : '货架上已经有这一段了', shelf.length > n0 ? 'good' : '');
}
const shelfEl = $('#shelf');
for (const el of [shelfEl, $('#pet')]) {
  if (!el) continue;
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
  el.addEventListener('drop', shelfDropHandler);
}
/* Pet 收到东西时也亮一下（同一个 `.over` 类的观感） */
if ($('#pet')) $('#pet').addEventListener('drop', () => toast('放进货架了', 'good'));
$('#shelfbody').onclick = (e) => {
  const d = e.target.closest('[data-del]');
  if (!d) return;
  shelf.splice(Number(d.dataset.del), 1);
  saveShelf(); renderShelf();
};
/**
 * 收起/展开发货架。**顺便**：如果现在有选中的文字，先把它收进去。
 *
 * ⭐ 这是个**万能入口**，也是"什么都要能放"最后的一块：
 *    拖动在某些地方天生起不来（浏览器不给、元素不可拖、够不着），
 *    而「**选中一段 → 点一下货架**」到处都成立 —— 不挑元素、不挑位置、不挑浏览器。
 */
$('#shelfToggle').onclick = () => {
  const s = window.getSelection();
  const sel = s && !s.isCollapsed ? s.toString().trim() : '';
  if (sel) {
    const n0 = shelf.length;
    shelfAdd(sel.slice(0, 20000), 'clip', 'clip');
    expandShelf();
    toast(shelf.length > n0 ? '已把选中的那一段放进货架' : '这一段已经在货架上了', shelf.length > n0 ? 'good' : '');
    return;
  }
  const folded = shelfEl.classList.toggle('folded');
  $('#shelfToggle').setAttribute('aria-expanded', String(!folded));
};
// 剪贴板：直接点一颗按钮收进来。
// ⚠️ 为什么要有这颗：⌘V 那条路**只在焦点不在输入框里**才收（在输入框里按 ⌘V 是粘字，
//    抢了它才是真的坏）。而人脑记不住"现在焦点在哪"。给一颗按钮，就不需要记。
if ($('#shelfPaste')) $('#shelfPaste').onclick = async () => {
  try {
    const t = ((await navigator.clipboard.readText()) || '').trim();
    if (!t) return toast('剪贴板里没有文字', 'bad');
    const n0 = shelf.length;
    shelfAdd(t.slice(0, 20000), 'clip', 'clip');
    expandShelf();
    toast(shelf.length > n0 ? '已从剪贴板放进货架' : '剪贴板这一段已经在架子上了', shelf.length > n0 ? 'good' : '');
  } catch (e) {
    // ⚠️ 读剪贴板会被权限拦（浏览器会弹一次"允许读取剪贴板吗"）。被拒不是"坏了"，
    //    要说清**还有哪条路**：点一下页面空白处再按 ⌘V 一样能收。
    toast('读剪贴板被拦了（' + (e?.message || e) + '）—— 点一下页面空白处再按 ⌘V 也一样能收', 'bad');
  }
};
$('#shelfClear').onclick = () => { shelf = []; saveShelf(); renderShelf(); };

// ══════════════════════════════════════════════════════════
// 货架：什么都能往上放
// ⚠️ 所有入口都走 shelfAdd 一个函数 —— "能放什么"只有一个地方要维护。
//    上一版只有拖拽一条路，于是"能拖的"和"能放的"迟早会漂成两回事。
// ══════════════════════════════════════════════════════════
function expandShelf() {
  $('#shelf').classList.remove('folded');
  $('#shelfToggle').setAttribute('aria-expanded', 'true');
}

const MAX_INLINE = 1.5 * 1024 * 1024;   // 图片转 dataURL 存 localStorage，太大就不收

async function addFiles(files) {
  let skipped = 0;
  for (const f of files.slice(0, 8)) {
    if (f.type.startsWith('image/')) {
      if (f.size > MAX_INLINE) { skipped += 1; continue; }
      const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      shelfAdd(f.name || '图片', 'image', 'image', String(url));
    } else {
      shelfAdd(f.name || '文件', 'file', 'file');
    }
  }
  if (skipped) shelfAdd(`（${skipped} 张图太大，没收 —— 本地存不下）`, 'clip', 'warn');
  expandShelf();
}

// ── 粘贴 ──
document.addEventListener('paste', async (e) => {
  const ae = document.activeElement;
  // ⚠️ 在输入框里按 ⌘V 是"粘文字"，不是"放进货架"。
  //    抢这个会把用户最常用的操作吃掉，而他会以为是粘贴坏了。
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
  const dt = e.clipboardData; if (!dt) return;
  const files = Array.from(dt.files || []);
  if (files.length) { e.preventDefault(); return addFiles(files); }
  const text = (dt.getData('text/plain') || '').trim();
  if (text) {
    e.preventDefault();
    const n0 = shelf.length;
    shelfAdd(text.slice(0, 20000), 'clip', 'clip');
    expandShelf();
    if (shelf.length > n0) toast('已从剪贴板放进货架', 'good');
  }
});

// ── 拖文件 / 图片 / 链接 ──
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
});
window.addEventListener('drop', async (e) => {
  if (e.target.closest && e.target.closest('#shelf')) return;   // 货架自己那份处理过了
  const dt = e.dataTransfer; if (!dt) return;
  const files = Array.from(dt.files || []);
  if (files.length) { e.preventDefault(); return addFiles(files); }
  const uri = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').trim();
  if (/^https?:\/\//.test(uri)) { e.preventDefault(); shelfAdd(uri.slice(0, 300), 'link', 'link'); expandShelf(); return; }
  // ⚠️⚠️ 从**别的 app 拖一段普通文字**进来：这里原来只认「文件」和「链接」，
  //     一段普通文字落在页面上**什么都不发生** —— 而读者要的是「什么都要能放」。
  //     判据：只要带 text/plain，不管落在页面的哪个位置，都收。
  const text = (dt.getData('text/plain') || '').trim();
  if (text) {
    e.preventDefault();
    const n0 = shelf.length;
    shelfAdd(text.slice(0, 20000), 'clip', 'clip');
    expandShelf();
    if (shelf.length > n0) toast('已放进货架', 'good');
  }
});

// ── 每 10 秒跳一秒的手绘指针 ──
// ⚠️ 用过一次就不再打扰。一直闪的提示等于没有提示。
function startShelfHint() {
  if (localStorage.getItem('c4emem.shelfLearned')) return;
  const el = $('#shelfHint'); if (!el) return;
  setInterval(() => {
    if (!['voice', 'text', 'flow'].includes(mode)) return;   // 只在三个工作模式里指
    if (document.hidden || !$('#askmodal').hidden || !$('#confirmmodal').hidden) return;
    el.hidden = false;
    el.classList.remove('on');
    void el.offsetWidth;   // ⚠️ 强制重排：不这样的话连续两次加同一个 class，动画**不会重放**
    el.classList.add('on');
    setTimeout(() => { el.hidden = true; el.classList.remove('on'); }, 1050);
  }, 10000);
}
function learnShelf() {
  localStorage.setItem('c4emem.shelfLearned', '1');
  const el = $('#shelfHint'); if (el) el.hidden = true;
}

// ── 货架自己的「?」──
$('#shelfHelp').onclick = (e) => { e.stopPropagation(); $('#shelfhelp').hidden = false; };
$('#shelfhelpClose').onclick = () => { $('#shelfhelp').hidden = true; };
$('#shelfhelp').onclick = (e) => { if (e.target.id === 'shelfhelp') $('#shelfhelp').hidden = true; };
$('#shelfSend').onclick = async () => {
  const q = shelf.map((s) => s.text).join('\n\n');
  if (!q) return;
  show('text');
  pushMsg('me', '【货架】' + q);
  await ask(q, 'text');
};
$('#shelfFlow').onclick = () => {
  for (const s of shelf) flow.push(newBlock(s.kind === 'clip' ? 'act.ask' : s.kind, s.text));
  saveFlow(); show('flow');
};

/**
 * 拖拽源。
 *
 * ⚠️⚠️ 读者的原话：「我并不能够**随便选中**就拖动到货架上，也不能把**语音**或者
 *      **任何一段**拖动到货架上」。两个都是真的，原因各是一个：
 *   ① 语音那一行（`.you`/`.ai`）**没有 draggable**，而这里只认 `.msg`/`.item`
 *      ⇒ 语音**根本起不了拖**。对话能拖、语音不能，纯粹是两处各写了一份；
 *   ② 目标只有 `.msg`/`.item` 两种。想拖一段**别处**的文字（画布的块、知识库的卡片、
 *      弹窗里的说明…）就落空 —— 而浏览器自带的"拖选中文字"在 WKWebView 里并不可靠。
 * ⇒ 现在的判据是**内容**不是**容器类型**：只要拖起来的时候带着文本（选中的那一段优先，
 *    否则整个"段"），就认。跟具体是哪种元素无关。
 */
/** dragstart 时"这一段是哪一段"的判据（范围宽一点没关系，认不出就走选中文本那条）。 */
const SHELF_SRC = '.msg, .item, #vlog > div, .blk, .push, .card';
/** ⚠️ 这个才是**标成可拖**的范围。
 *  读者 2026-10-09 的原话是「我需要**所有的**都可以拖到货架，语音也要，**什么都要**」——
 *  所以这里要的是**覆盖面**，不是"挑几个重要的"。
 *  排掉的只有两类：① 货架自己（它的项本来就 draggable，往外拖是另一条路）；
 *  ② 接入设置抽屉里那一堆**表单**（拖它的价值是零，而把表单变成可拖会碍着选字）。 */
const SHELF_DRAGGABLE = '.msg, .item, #vlog > div, .blk, .push, .card, .sitem, .hsec';
let shelfWasFolded = false;

/**
 * ⚠️⚠️ **在 dragstart 里"认"元素是不够的 —— 不可拖的元素根本起不了拖。**
 *     上面那张列表里，只有 `.msg` 和 `.item` 被显式标了 `draggable`；
 *     `.card`（知识库的卡片）、`.blk`（画布的块）、`.push`（主动推的）都**没有** ——
 *     于是"随便选一段拖过去"在这些地方完全落空，而且**不报错、看不出**。
 *     用 observer 兜底：只要这类元素被渲染出来就补上 `draggable`，
 *     以后再加新视图也不用记得回来改这里（"要记得改的地方"迟早会被忘掉）。
 */
function markShelfable(root) {
  if (root.nodeType !== 1) return;
  if (root.matches?.(SHELF_DRAGGABLE)) root.draggable = true;
  root.querySelectorAll?.(SHELF_DRAGGABLE).forEach((e) => { e.draggable = true; });
}
new MutationObserver((muts) => {
  for (const m of muts) for (const n of m.addedNodes) markShelfable(n);
}).observe(document.body, { childList: true, subtree: true });
markShelfable(document.body);

document.addEventListener('dragstart', (e) => {
  // 架子上自己那几项要能**拖出去**，别拦（它的默认拖拽就是对的）
  if (e.target.closest?.('.sitem')) return;
  const host = e.target.closest?.(SHELF_SRC) || null;
  const s = window.getSelection();
  // ⭐ 选中了就用选中的那一段 —— 只要没选到"另一个段"里去
  const selOk = s && !s.isCollapsed && s.toString().trim() && (!host || !s.anchorNode || host.contains(s.anchorNode));
  const selTxt = selOk ? s.toString() : '';
  let full = '';
  if (host) {
    full = host.matches('.msg') ? host.querySelector('.body')?.innerText || ''
      : host.matches('.item') ? host.dataset.text || ''
        : host.innerText || '';
  }
  const carry = (selTxt || full).trim();
  if (carry) {
    e.dataTransfer.setData('text/plain', carry.slice(0, 20000));
    e.dataTransfer.setData('application/x-c4emem-kind', host && host.matches('.msg') ? 'ask' : 'clip');
    e.dataTransfer.effectAllowed = 'copy';
  }
  // ⭐ 一拖起来就把货架**展开**。
  //    ⚠️ 收起状态它只有 58×58 —— 拖过去差几个像素就什么都不发生，
  //    而"差几个像素"和"这个功能不能用"在界面上长得**一模一样**（读者就是这么报的）。
  //    展开之后是一块 326px 宽的面板，掉进去的概率和可见性都完全不同。
  shelfWasFolded = shelfEl.classList.contains('folded');
  if (shelfWasFolded) expandShelf();
  document.body.classList.add('dragging');
});
document.addEventListener('dragend', () => {
  document.body.classList.remove('dragging');
  // 只是路过的话，把刚才为了拖拽展开的面板收回去（架子上有东西就一直开着）
  if (shelfWasFolded && !shelf.length) $('#shelf').classList.add('folded');
  shelfWasFolded = false;
});

// ══════════════════════════════════════════════════════════
// 记录（工作区看板 = 底层）
// ══════════════════════════════════════════════════════════
let logKind = '';
let lastItems = [];
const multi = new Set();

$('#loglist').addEventListener('click', (e) => {
  const it = e.target.closest('.item');
  if (!it) return;
  const id = it.dataset.id;
  // ⭐ 多选态下点击 = **勾选**，不是打开那一条（读者要的批量删除）。
  //    ⚠️ 不拦的话，"选了 3 条"和"打开了第 3 条"会同时发生 —— 而那正是误删的来源。
  if (recPicking || e.metaKey || e.ctrlKey) {
    multi.has(id) ? multi.delete(id) : multi.add(id);
    paintRecBulk();
    $('#shelfcount').textContent = multi.size ? '已选 ' + multi.size + ' 段 · 拖到货架' : (shelf.length ? shelf.length + ' 段' : '拖动任一段到这儿');
    if (multi.size) {                       // 多选 → 直接可以拖到货架
      const txt = lastItems.filter((x) => multi.has(String(x.id))).map((x) => x.title + ' ' + (x.detail || '')).join('\n');
      $('#shelf').dataset.multi = txt;
    } else delete $('#shelf').dataset.multi;
    return;
  }
  multi.clear();
  $$('#loglist .item').forEach((x) => x.classList.remove('sel', 'on'));
  it.classList.add('on');
  const src = lastItems.find((x) => String(x.id) === id);
  if (!src) return;
  // ⚠️ 这里以前是"跳过去 + 把问题重问一遍" —— 那会**又花一次钱**，而且答出来的
  //    是新的一次，不是原来那次。现在改成**恢复那次对话**：把整个会话的轮次铺回来，
  //    你可以在尾巴上接着聊。
  if (src.session_id) return restoreSession(src.session_id);

  const map = { voice: 'voice', text: 'text', ask: 'text', flow: 'flow', recommend: 'rec' };
  const to = map[src.kind] || 'text';
  show(to);
  if (to === 'text') { pushMsg('me', src.title); ask(src.title, 'text'); }
});

/** 把一次会话恢复成可续聊的样子（不再重新问一遍）。 */
async function restoreSession(id) {
  const r = await api('/api/session/' + encodeURIComponent(id));
  if (!r.turns?.length) return;
  reqSeq += 1;        // 作废还在飞的请求
  sid = id;
  $('#thread').innerHTML = '';
  for (const t of r.turns) {
    pushMsg(t.q && t.a ? 'me' : 'me', t.q);
    if (t.a) pushMsg('ai', t.a);
  }
  pushMsg('ai', '—— 以上是这次对话。接着往下问就行。');
  show('text');
  $('#tinput').focus();
}

/** ⭐ 记录栏的搜索词（本地筛）+ 多选态。⚠️ 存模块里 —— 每次 refreshDash 都要保持住。 */
let recQuery = '';
let recPicking = false;
function recMatch(it, q) {
  if (!q) return true;
  const hay = ((it.title || '') + ' ' + (it.detail || '') + ' ' + (it.kind || '')).toLowerCase();
  // ⚠️ 按**词**筛（空格分开，全都要命中）而不是整串匹配 —— 整串匹配时
  //    "骑行 心率" 这种两段的写法永远搜不到。
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
async function refreshDash() {
  const [r, u] = await Promise.all([api('/api/activity?limit=150' + (logKind ? '&kind=' + logKind : '')), api('/api/usage')]);
  lastItems = (r.items || []).filter((it) => recMatch(it, recQuery));
  $('#loglist').innerHTML = lastItems.length
    ? lastItems.map((it) => {
        const t = new Date(it.ts);
        const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
        const bits = [hh];
        if (it.ms) bits.push((it.ms / 1000).toFixed(1) + 's');
        if (it.tok_sum) bits.push(it.tok_sum.toLocaleString() + ' tok');
        return '<div class="item" draggable="true" data-id="' + it.id + '" data-sid="' + (it.session_id || '') + '" data-text="' +
          esc(((it.title || '') + ' ' + (it.detail || '')).slice(0, 2000)) + '">' +
          '<div class="r1"><span class="ic">' + iconFor(it.icon) + '</span><span class="ttl">' + esc(it.title) + '</span></div>' +
          '<div class="r2">' + bits.join('<span>·</span>') + '</div></div>';
      }).join('')
    : '<div class="k" style="padding:14px 9px">' +
      (recQuery ? '没有匹配「' + esc(recQuery) + '」的记录 —— 换个词，或者清掉搜索框。'
        : '还没有记录。点上面任意一个「新…」开始。') + '</div>';
  // ⚠️ 选中集**不能**在重画时整体清掉（原来就是 `multi.clear()`）：
  //    多选之后按一下筛选/搜索就全没了，而界面上那行"选了 N 条"还写着旧数字 ——
  //    按删除会一条都不删，**且不报错**。改成按当前这一份收敛。
  for (const id of [...multi]) if (!lastItems.some((x) => String(x.id) === id)) multi.delete(id);
  paintRecBulk();

  const tot = u.total || { tsum: 0, n: 0, ms: 0 };
  const days = (u.byDay || []).slice(0, 14).reverse();
  const mx = Math.max(1, ...days.map((d) => d.tsum));
  $('#usagebar').innerHTML =
    '<div>累计 <b>' + Number(tot.tsum).toLocaleString() + '</b> tokens · ' + tot.n + ' 次 · ' + (tot.ms / 1000).toFixed(1) + 's</div>' +
    (days.length ? '<div class="spark">' + days.map((d) => '<i style="height:' + Math.max(2, Math.round((d.tsum / mx) * 18)) + '" title="' + d.day + ' · ' + d.tsum + '"></i>').join('') + '</div>' : '');
}
$$('.flt').forEach((b) => (b.onclick = () => {
  $$('.flt').forEach((x) => x.classList.toggle('on', x === b));
  logKind = b.dataset.k;
  refreshDash();
}));
// ── 记录的搜索 / 多选 / 批量删除 ────────────────────────────────
function paintRecBulk() {
  const bar = $('#recBulk');
  if (bar) bar.hidden = !recPicking;
  const n = $('#recSelN');
  if (n) n.textContent = '选了 ' + multi.size + ' 条';
  const del = $('#recDel');
  if (del) del.disabled = multi.size === 0;
  $$('#loglist .item').forEach((x) => {
    x.classList.toggle('sel', multi.has(x.dataset.id));
    x.classList.toggle('pick', recPicking);
  });
}
$('#recq').oninput = (e) => { recQuery = e.target.value.trim(); refreshDash(); };
$('#recPick').onclick = () => {
  recPicking = !recPicking;
  $('#recPick').classList.toggle('on', recPicking);
  $('#recPick').textContent = recPicking ? '退出多选' : '选择';
  if (!recPicking) multi.clear();
  paintRecBulk();
};
$('#recAll').onclick = () => {
  const allOn = multi.size === lastItems.length;
  multi.clear();
  if (!allOn) lastItems.forEach((x) => multi.add(String(x.id)));
  paintRecBulk();
};
$('#recCancel').onclick = () => { recPicking = false; multi.clear(); $('#recPick').classList.remove('on'); $('#recPick').textContent = '选择'; paintRecBulk(); };
$('#recDel').onclick = async () => {
  const ids = [...multi].map(Number).filter(Number.isFinite);
  if (!ids.length) return;
  const r = await post('/api/activity/delete', { ids });
  if (r.error) return toast('没删掉：' + r.error, 'bad');
  multi.clear();
  toast('删了 ' + (r.deleted ?? ids.length) + ' 条记录', 'good');
  refreshDash();
};
$$('.newrow [data-new]').forEach((b) => (b.onclick = () => startNew(b.dataset.new)));
function startNew(kind) {
  reqSeq += 1;                      // 作废还在飞的请求
  sid = null;                       // 新对话 = 断开旧会话，否则会串到上一次里
  if (kind === 'voice') { show('voice'); $('#vlog').innerHTML = ''; toggleMic(); }
  else if (kind === 'text') { show('text'); $('#thread').innerHTML = ''; }
  else { show('flow'); flow = []; sel = null; saveFlow(); renderFlow(); addBlock('text'); }
}

// ══════════════════════════════════════════════════════════
// 知识视图
// ══════════════════════════════════════════════════════════
const mkText = (it) => '【C4emem 推荐 · ' + it.kind + '】' + it.title + '\n' + it.detail;

// ══════════════════════════════════════════════════════════
// 手写条目 —— 「主题 / 词条 / 链接」三个视图共用
// ══════════════════════════════════════════════════════════

/**
 * ⚠️ 手写的住 out/manual.json，**读取时**合并进那三份生成产物。
 *    为什么不直接写进 out/vocab.json：那是**整份覆盖**的产物，
 *    下一次重跑就把人写的东西抹掉了 —— 而且一点都不报错。
 */
const MANUAL_FIELDS = {
  vocab: [['en', '英文', 'a plum job'], ['zh', '中文', '一份令人羡慕的好工作'], ['note', '备注', '可不填']],
  links: [['url', '链接', 'https://…'], ['cat', '归到哪类', '留空＝「手动添加」'], ['what', '这是什么', '一句话']],
  tax: [['name', '主题名', '不超过 8 个字'], ['keywords', '关键词', '逗号分开，可不填'], ['note', '说明', '可不填']],
};

function manualBlock(kind, items, error) {
  const rows = (items || []).map((m) => {
    const label = kind === 'vocab' ? esc(m.en) + '　' + esc(m.zh)
      : kind === 'links' ? esc(m.domain || m.url)
      : esc(m.name);
    const sub = kind === 'vocab' ? m.note : kind === 'links' ? m.what : (m.keywords || []).join(' · ');
    return '<div class="mrow"><span class="badge bman">手动</span><b>' + label + '</b>' +
      (sub ? ' <span class="k">' + esc(sub) + '</span>' : '') +
      '<button class="xdel" data-del="' + esc(m.id) + '" title="删掉这一条">' + icon('close') + '</button></div>';
  }).join('');
  const form = MANUAL_FIELDS[kind]
    .map((f) => '<input data-mf="' + f[0] + '" placeholder="' + esc(f[1] + '：' + f[2]) + '">')
    .join('');
  return '<div class="card">' +
    '<div class="m">手写' + (items && items.length ? ' · ' + items.length + ' 条' : '') +
    '<button class="go sm" id="manAdd" style="margin-left:auto">＋ 手动添加</button></div>' +
    (error ? '<div class="k" style="color:#a33">⚠️ 手写那份读不了：' + esc(error) + '</div>' : '') +
    '<div id="manForm" hidden><div class="row">' + form + '</div>' +
    '<div class="row" style="margin:0"><button class="go sm" id="manSave">保存</button>' +
    '<button class="ghost sm" id="manCancel">取消</button></div></div>' +
    (rows || '<div class="k">还没有手写的。这里加的条目<b>重跑生成脚本也冲不掉</b>。</div>') +
    '</div>';
}

/**
 * ⚠️ 保存/删除之后**重新从服务端拉一次**，不是往 DOM 里塞一行。
 *    判据是「刷新之后它还在」（服务端那份才算数），不是「点了有反应」——
 *    只改 DOM 的话，服务端没存上你也看不出来。
 */
async function paintManual(host, kind, after) {
  const r = await api('/api/kb/manual?kind=' + kind);
  host.innerHTML = manualBlock(kind, r.items, r.error);
  const form = host.querySelector('#manForm');
  host.querySelector('#manAdd').onclick = () => {
    form.hidden = !form.hidden;
    // ⚠️ 展开后要 `hidden` 已经变成 false 再取元素，否则拿不到
    if (!form.hidden) { const i = form.querySelector('input'); if (i) i.focus(); }
  };
  host.querySelector('#manCancel').onclick = () => { form.hidden = true; };
  host.querySelector('#manSave').onclick = async () => {
    const item = {};
    form.querySelectorAll('[data-mf]').forEach((i) => { item[i.dataset.mf] = i.value.trim(); });
    const res = await post('/api/kb/manual', { kind, item });
    if (res.error) return toast('没存上：' + res.error, 'bad');
    // ⚠️ 三种结果要说成**三句不同的话** —— 说成一样，用户就分不清
    //    「刚存进去」「你早就手写过一条」「自动提取里本来就有一条」。
    //    最后那种最坑：表里会并排出现两行长得一模一样的。
    if (res.deduped) toast('你已经手写过一条一模一样的了', 'good');
    else if (res.existing) toast('存了。不过自动提取里本来就有一条一样的（' + (res.existing.space || '') + ' ' + (res.existing.date || '') + '）', '');
    else toast('存好了（重跑生成冲不掉它）', 'good');
    await paintManual(host, kind, after);
    if (after) after();
  };
  host.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const res = await api('/api/kb/manual?kind=' + kind + '&id=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
      if (res.error) return toast('没删掉：' + res.error, 'bad');
      toast('删了', 'good');
      await paintManual(host, kind, after);
      if (after) after();
    };
  });
}

/**
 * 工作区那条「主动」卡片。⚠️ 时间必须显眼 —— 没有时间就分不出"今天要办"还是"上周的"。
 *
 * ⚠️⚠️ 三种状态**渲染出来必须不同**（读者：「处理了和略过没有什么区别」）：
 *    · 待处理 —— 正常
 *    · 处理了 —— 划掉 + 柠檬绿 + ✓（**做完了**）
 *    · 略过   —— 不划掉 + 收成一行 + 灰虚边（**不打算做**，但没完成）
 *    两个按钮也**不只是颜色不同**：按钮下面带一句 title 说清后果。
 */
function panelCard(it) {
  const st = it.state === 'done' ? 'done' : it.state === 'skipped' ? 'skipped' : 'new';
  const label = st === 'new' ? '待处理' : st === 'done' ? '✓ 处理了' : '略过 · 不做';
  const bcls = st === 'done' ? 'bdone' : st === 'skipped' ? 'bskip' : '';
  return '<div class="card pcard ' + st + '" data-pid="' + it.id + '" data-pst="' + st + '">' +
    '<div class="prowtop">' +
      (it.due ? '<span class="badge blime">' + esc(it.due) + '</span>' : '') +
      '<span class="badge ' + bcls + '">' + label + '</span>' +
      (it.kind === 'todo' ? '<span class="badge bman">待办</span>' : '') +
      '<b>' + esc(it.title) + '</b></div>' +
    (it.detail ? '<div class="k pdet">' + esc(it.detail) + '</div>' : '') +
    '<div class="prowbot"><span class="k">' + esc(tsLabel(it.ts)) + '</span>' +
      (st === 'new'
        ? '<button class="go sm" data-st="done" title="这件事我办完了 —— 划掉收起来">处理了</button>' +
          '<button class="ghost sm" data-st="skipped" title="我不打算做它 —— 收成一行，不再催你">略过</button>'
        : '<button class="ghost sm" data-st="new" title="放回待处理">撤回</button>') +
    '</div></div>';
}

/** 时间：既给"几天前"（一眼看出紧不紧），也给绝对时刻（能对得上邮件）。 */
function tsLabel(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const d = new Date();
  const days = Math.floor((d - t) / 86400000);
  const rel = days <= 0 ? '今天' : days === 1 ? '昨天' : days < 30 ? days + ' 天前' : Math.floor(days / 30) + ' 个月前';
  const hm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  return rel + ' ' + hm;
}

/** 待处理 / 处理了 / 略过 三段筛。⚠️ 存在模块里 —— 每次重画都要保持住，
 *  弹回"全部"的话，点一下处理就跳到别的地方去了（像"点了没反应"）。 */
let panelFilter = 'new';
function applyPanelFilter(root) {
  if (!root) return;
  root.querySelectorAll('.pcard').forEach((c) => {
    c.hidden = panelFilter !== 'all' && c.dataset.pst !== panelFilter;
  });
  root.querySelectorAll('#pfilter button').forEach((b) => b.classList.toggle('on', b.dataset.f === panelFilter));
}
function bindPanel(root) {
  root.querySelectorAll('.pcard [data-st]').forEach((b) => (b.onclick = async () => {
    const id = Number(b.closest('.pcard').dataset.pid);
    const r = await post('/api/panel/state', { id, state: b.dataset.st });
    if (r.error) return toast(r.error, 'bad');
    // ⚠️ 说清刚才那一下**意味着什么** —— 两个按钮都只是"变灰"的话，
    //    用户根本不知道它们做了不一样的事（读者就是这么报的）。
    toast(b.dataset.st === 'done' ? '记下了：办完了（在「处理了」那一栏）'
      : b.dataset.st === 'skipped' ? '跳过了 —— 它不会再催你（在「略过」那一栏）'
      : '放回待处理了', 'good');
    renderKb(); // 重画：状态立刻反映，而且**服务端也真的改了**（不是只改 DOM）
  }));
  root.querySelectorAll('#pfilter button').forEach((b) => (b.onclick = () => {
    panelFilter = b.dataset.f;
    applyPanelFilter(root);
  }));
  applyPanelFilter(root);
}

/** 三个视图共用的开头：手写那一块**放最上面** —— 打开就能看见自己写的。 */
function mountManual(v, kind, after) {
  const host = document.createElement('div');
  v.insertBefore(host, v.firstChild);
  paintManual(host, kind, after);
}

function renderKb() {
  MODES.forEach((x) => ($('#m-' + x).hidden = true));
  $('#m-kb').hidden = false;
  const v = $('#kbmount');
  v.innerHTML = '';

  // ── 工作区：**主动那一大块**（读者 2026-10-09：「给出来主动给出来的信息或者分析，
  //    要标记出来时间，是否去处理」）──
  if (kbView === 'home') {
    Promise.all([api('/api/panel'), api('/api/stats')]).then(([pn, s]) => {
      const items = pn.items || [];
      const c = pn.counts || {};
      v.innerHTML = '<div class="kbwrap">' +
        '<div class="secH"><b>主动给你留的</b><span class="k">' +
          '「处理了」= 办完了，划掉 · 「略过」= 不打算做，收成一行</span></div>' +
        // ⭐ 「处理了」和「略过」是**两张单子**，不是同一堆里的两种灰。
        //    读者原话：「这个感觉处理了和略过没有什么区别」—— 分开列出是最直接的差别。
        '<div class="pfilter" id="pfilter">' +
          [['new', '待处理'], ['done', '处理了'], ['skipped', '略过']].map(([k, nm]) =>
            '<button data-f="' + k + '"' + (panelFilter === k ? ' class="on"' : '') + '>' + nm +
            '<span class="n">' + (c[k] || 0) + '</span></button>').join('') +
          '<button data-f="all"' + (panelFilter === 'all' ? ' class="on"' : '') + '>全部<span class="n">' + items.length + '</span></button>' +
        '</div>' +
        (items.length
          ? items.map(panelCard).join('')
          : '<div class="card"><div class="k">还没有。接了源、同步过之后，这里会出现它替你盯着的那些事。</div></div>') +
        '<div class="card" style="margin-top:16px"><div class="m">知识库</div>' +
          '<div style="font-size:24px;font-weight:640">' + s.docs + ' <span style="font-size:13px;color:#767d8a">段</span></div>' +
          '<div class="k">' + s.chunks + ' 切块 · ' + s.vecs + ' 向量 · ' + s.spaces.length + ' 个来源 · LLM ' +
          (s.hasLlm ? esc(s.llm || '已配') : '未配') + '</div></div>' +
        '<div class="k" style="margin:12px 2px;line-height:1.8">左边是<b>记录</b> —— 语音、文字、流程最终都落到那里。</div>' +
        '</div>';
      bindPanel(v);
    });
    return;
  }
  if (kbView === 'usage') {
    api('/api/usage').then((u) => {
      const t = u.total || { tsum: 0, n: 0, ms: 0, tin: 0, tout: 0 };
      const mx = Math.max(1, ...u.byDay.map((d) => d.tsum));
      v.innerHTML = '<div class="kbwrap">' +
        '<div class="card"><div class="m">累计</div><div style="font-size:26px;font-weight:640">' + t.tsum.toLocaleString() + ' <span style="font-size:14px;color:#767d8a">tokens</span></div>' +
        '<div class="k">输入 ' + t.tin.toLocaleString() + ' · 输出 ' + t.tout.toLocaleString() + ' · ' + t.n + ' 次 · ' + (t.ms / 1000).toFixed(1) + 's</div></div>' +
        '<div class="card"><table><tr><th>类型</th><th>次数</th><th>tokens</th></tr>' +
        u.byKind.map((k) => '<tr><td>' + esc(k.kind) + '</td><td>' + k.n + '</td><td>' + k.tsum.toLocaleString() + '</td></tr>').join('') + '</table></div>' +
        '<div class="card"><div class="m">按天</div>' +
        u.byDay.map((d) => '<div style="display:flex;align-items:center;gap:9px;padding:2px 0"><span class="k" style="width:80px">' + d.day + '</span><span class="bar" style="width:' +
          Math.max(2, Math.round((d.tsum / mx) * 180)) + 'px"></span><span class="k">' + d.tsum.toLocaleString() + '</span></div>').join('') + '</div></div>';
    });
    return;
  }
  if (kbView === 'rec') {
    v.innerHTML = '<div class="kbwrap"><div class="row"><button class="go" id="gen">生成今天的推荐</button>' +
      '<button class="ghost" id="regen" disabled>换一批</button>' +
      '<button class="ghost" id="prev" disabled>① 预览</button><button class="ghost" id="push" disabled>② 写回</button></div>' +
      '<div id="out"></div><div id="out2"></div></div>';
    let items = [];
    const upd = () => {
      const n = $$('#out .chk:checked').length;
      $('#prev').disabled = $('#push').disabled = !n;
      $('#prev').textContent = '① 预览' + (n ? ' (' + n + ')' : '');
      $('#push').textContent = '② 写回' + (n ? ' (' + n + ')' : '');
    };
    const send = async (dry) => {
      // ⚠️ 走过的坑：写完之后**勾还留着** ⇒ ②还是亮的 ⇒ 再点一次就把同一批又写一遍。
      //    读者那边真实的后果，是在 Notion 里量到的：
      //    2026-10-09 TECH AI 那个日期块里，**同一篇内容出现了四遍**
      //    （段落 3×3+1、四组标记 —— 见 scripts/verify-append-dedup.py 的抬头）。
      //    ⇒ 写完必须**把确实写进去的那些勾掉**，卡片上也要看得出来。
      //    ⚠️ 只勾掉成功的那几条：失败的要留着，好让他改完重试
      //       （一刀切全清 = 失败的那条也被当成写过了）。
      const boxes = $$('#out .chk:checked');
      const list = boxes.map((c) => items[Number(c.dataset.i)]);
      if (!list.length) return;
      const out = [];
      for (let k = 0; k < list.length; k++) {
        const it = list[k];
        const r = await post('/api/notion/append', { cat: it.cat, text: mkText(it), dryRun: dry });
        const good = r.wrote && r.ok;
        if (good) {
          boxes[k].checked = false;
          // ⚠️ 用 disabled 而不是把勾藏起来：藏起来的话下一眼分不清
          //    "这条已经写过了"和"这一批里本来就没有这条"。
          boxes[k].disabled = true;
          const card = boxes[k].closest('.card');
          if (card) card.style.opacity = '.62';
        }
        out.push('<div class="card"><div class="m"><span class="badge">' +
          (good ? '已写入' : dry ? '预览' : '⚠️ 没写成功') + '</span>' + esc(r.page) +
          '</div><pre>' + esc(r.error || r.output || '') + '</pre></div>');
      }
      $('#out2').innerHTML = out.join('');
      upd();
      if (!dry) refreshDash();
    };
    // 「换一批」= 拿**这一批已经给出的标题**当排除项再要一次。
    // ⚠️ 只是"再点一次生成"是不行的 —— 同样的语料 + 同样的提示词，
    //    模型会给回一模一样（或只差一两个字）的八条，看起来就像按钮没生效。
    const gen = async (again) => {
      $('#out').innerHTML = '<div class="k" style="padding:8px 2px">' + (again ? '换一批…' : '生成中…') + '</div>';
      $('#out2').innerHTML = '';
      const exclude = again ? items.map((x) => x.title).filter(Boolean) : [];
      const r = await post('/api/recommend', exclude.length ? { exclude } : {});
      if (r.error) return ($('#out').innerHTML = '<div class="card">' + esc(r.error) + '</div>');
      if (!(r.items || []).length) return ($('#out').innerHTML = '<div class="card k">这次没生成出东西来，再点一次试试。</div>');
      items = r.items;
      $('#out').innerHTML = items.map((it, i) =>
        '<div class="card"><div class="m"><input class="chk" type="checkbox" data-i="' + i + '"><span class="kind k-' + esc(it.kind) + '">' + esc(it.kind) + '</span>' +
        '<span class="badge">' + esc(it.cat) + '</span></div><div style="font-weight:640;margin:4px 0">' + esc(it.title) + '</div>' +
        '<div class="k">' + esc(it.why) + '</div><div style="margin-top:6px;font-size:12.5px">' + esc(it.detail) + '</div></div>').join('');
      $('#regen').disabled = false;
      upd(); refreshDash();
    };
    $('#gen').onclick = () => gen(false);
    $('#regen').onclick = () => gen(true);
    $('#out').onchange = upd;
    $('#prev').onclick = () => send(true);
    $('#push').onclick = () => send(false);
    return;
  }
  if (kbView === 'search') {
    v.innerHTML = '<div class="kbwrap"><div class="row"><input id="q" type="text" placeholder="关键词或一句话"><button class="go" id="go">搜索</button></div><div id="out"></div></div>';
    const run = async () => {
      const q = $('#q').value.trim();
      if (!q) return;
      // ⚠️ 先说话：这个词要过嵌入模型，慢的时候一两秒 —— 不说的话看着像"没反应"
      $('#out').innerHTML = '<div class="k" style="padding:8px 2px">搜「' + esc(q) + '」…</div>';
      const r = await api('/api/search?q=' + encodeURIComponent(q) + curSpaces().map((x) => '&space=' + encodeURIComponent(x)).join(''));
      // ⚠️⚠️ 结果原来是**整段原文照贴**。笔记里有一种块是"一串链接"
      //    （`[链接] https://…` 连十几个，实测 shopping 那条淘宝 URL 有 600 多字符），
      //    它们一命中就把整屏占满 —— 而读者要的是**搜笔记**，不是看 URL。
      //    ⇒ 显示时把长 URL 折掉，只留域名 + 计数；关键词高亮。
      const snip = (text, q) => {
        const urls = String(text).match(/https?:\/\/\S+/g) || [];
        let t = String(text).replace(/https?:\/\/\S+/g, ' ').replace(/\[\s*链接\s*\]/g, ' ').replace(/\s{2,}/g, ' ').trim();
        if (!t) t = '（这一段就是一串链接，正文没有别的字）';
        // ⚠️ 一律从**第 0 个字**开始截是没用的：笔记块动辄几千字，命中的那个词
        //    往往在 3000 字之后 —— 于是每条摘出来都是"开头那段"，十条看着一模一样。
        //    ⇒ 命中就从命中处**开窗**（前后各留一点），这样一眼看得出为什么它被搜出来。
        const terms = String(q).split(/[\s,，、]+/).filter((x) => x.length >= 2);
        let from = 0;
        const low = t.toLowerCase();
        for (const w of terms) { const i = low.indexOf(w.toLowerCase()); if (i >= 0) { from = Math.max(0, i - 90); break; } }
        let html = esc(t.slice(from, from + (from ? 520 : 520)));
        if (from) html = '…' + html;
        // ⚠️ 高亮要**先转义再替换**，而且替换的是转义后的词 —— 直接拿原词去 replace
        //    会在词里有 `<` `&` 时高亮不到（看起来像"高亮坏了"）。
        for (const w of String(q).split(/[\s,，、]+/).filter((x) => x.length >= 2).slice(0, 4)) {
          html = html.split(esc(w)).join('<mark>' + esc(w) + '</mark>');
        }
        return { html, nUrls: urls.length };
      };
      // ⭐ 读者 2026-10-10 傍晚：「搜索结果里有一些**看不完全，点击也看不完全**……
      //    **点击也能全览那里的内容**才行，不能只有半截的但是我什么都做不了」。
      //    ⇒ 每条都挂上 `data-hit`，点一下弹**完整原文**（可滚动），并且给
      //      「打开那个软件」—— 他原话：「如果是哪个软件的我可以一键跳转到那里去」。
      // ⚠️ 这一句**必须在 `hitCards` 里面**（它拿得到 `xs`）。
      //    我第一版把它写成了外面的一条顶层语句 —— 那里**没有 `xs`** ⇒
      //    整个搜索视图抛 `xs is not defined`，页面上永远停在「搜「…」…」，
      //    而**别的地方一切正常**（看起来像"搜索卡住了"，不是"代码错了"）。
      const hitCards = (xs) => (lastHits = xs) && xs.map((h, i) => {
        const s = snip(h.text, $('#q')?.value.trim() || '');
        return '<div class="card hcard" data-hit="' + i + '" title="点开看全文">' +
          '<div class="m"><span class="badge">' + esc(h.space) + '</span>' + esc(h.date) +
          (h.sim != null ? ' · 余弦 ' + h.sim.toFixed(3) : '') +
          (s.nUrls ? '<span class="k">· 含 ' + s.nUrls + ' 个链接（已折起）</span>' : '') +
          '<span class="k" style="margin-left:auto">点开看全文 ›</span>' +
          '</div><div class="snip">' + s.html + '</div></div>';
      }).join('');
      const hits = r.hits || [];
      if (hits.length) {
        $('#out').innerHTML = hitCards(hits);
        $$('#out .hcard').forEach((c) => (c.onclick = () => openHit(Number(c.dataset.hit))));
      } else {
        // ⭐ 「没有命中」这四个字什么都没说。
        //    读者 2026-10-09 报「搜索全部没有命中」—— 而服务端当时是好的，
        //    真正的原因只可能是**当前来源那一栏没有数据**（左下角那颗按钮切的）。
        //    ⇒ 把"这次到底搜了哪几个库"写出来，并且给一条一步就能回到全库的路。
        const src = curSrc();
        $('#out').innerHTML = '<div class="card"><div class="m">没有命中</div>' +
          '<div class="k" style="line-height:1.9">' +
          (r.error ? '⚠️ 接口报错：' + esc(r.error) + '<br>' : '') +
          '这次只搜了：<b>' + esc(src.nm) + '</b>' +
          (src.spaces.length ? '（库里的 space = ' + esc(src.spaces.join('、')) + '）' : '（全部来源）') + '<br>' +
          (src.spaces.length
            ? '换的只是<b>来源</b>，搜索本身没变 —— 这个来源里可能本来就没有这类内容。'
            : '这几个库里确实没有。换个说法试试，或者去「词条 / 主题」看看这一块到底有没有数据。') +
          '</div>' +
          (src.spaces.length ? '<button class="go" id="searchAll" style="margin-top:10px">在全部来源里再搜一次</button>' : '') +
          '</div>';
        const all = $('#searchAll');
        if (all) all.onclick = () => { srcId = 'blend'; localStorage.setItem('c4emem.src', srcId); paintSources(); run(); };
      }
      refreshDash();
    };
    $('#go').onclick = run;
    $('#q').onkeydown = (e) => e.key === 'Enter' && run();
    $('#q').focus();
    return;
  }
  if (kbView === 'proactive') {
    api('/api/proactive').then((d) => {
      const c = d.cfg, st = c.stats || {}, h = d.history || [], feats = c.features || {};
      // 「功能」是**它替你做什么**（区别于「设置」= 什么时候许它开口）
      const FEATS = [
        { k: 'notionAppend', nm: '勾选的内容写回 Notion', note: '推荐/搜索里勾过的条目可以一键写回，正文前自动加（by cevtuo c4emem AI）' },
        { k: 'autoTag', nm: '推送自动标来源', note: '每条推送都标出它引用了哪几段、什么日期 —— 好判断该不该信' },
        { k: 'weeklyDigest', nm: '每周主题小结', note: '把一周里新冒出来的主题聚成一段，周日推一次' },
      ];
      const rows = Object.entries(c.triggers)
        .map(([k, t]) => {
          const nm = { appSwitch: '前台应用切换', clipboard: '剪贴板变化', schedule: '定时回顾', fileOpen: '打开文件', calendar: '日历临近' }[k] || k;
          return '<div class="prow"><label class="sw"><input type="checkbox" data-tg="' + k + '"' + (t.on ? ' checked' : '') + '><span></span></label>' +
            '<div class="pc"><b>' + nm + '</b><div class="k">' + esc(t.note || '') + '</div></div>' +
            '<div class="k" style="flex:none">间隔 <input class="num" type="number" min="1" data-gap="' + k + '" value="' + t.minGapMin + '"> 分</div></div>';
        })
        .join('');
      v.innerHTML =
        '<div class="kbwrap">' +
        '<div class="card" style="display:flex;align-items:center;gap:14px">' +
        '<label class="sw big"><input type="checkbox" id="pOn"' + (c.enabled ? ' checked' : '') + '><span></span></label>' +
        '<div style="flex:1"><div style="font-weight:640;font-size:15px">主动式' + (c.enabled ? ' · 开着' : ' · 关着') + '</div>' +
        '<div class="k">检测在原生侧（零 token），只在真该推的时候才生成。默认关 —— 它会打扰你。</div></div></div>' +

        // ── 功能：它平时替你做什么 ─────────────────────────
        '<div class="secH"><b>功能</b><span class="k">它平时替你做什么</span></div>' +
        '<div class="card">' + FEATS.map((f) =>
          '<div class="prow"><label class="sw"><input type="checkbox" data-ft="' + f.k + '"' + (feats[f.k] ? ' checked' : '') + '><span></span></label>' +
          '<div class="pc"><b>' + f.nm + '</b><div class="k">' + f.note + '</div></div></div>').join('') +
        '<div class="k" style="margin-top:6px">写回 Notion 的每一段都会自动带上（by cevtuo c4emem AI），而且只有你勾过的才写。</div></div>' +

        // ── 标成主动式的功能（读者 2026-10-10）—— 在这里**看得见**，因为它真的在起作用 ──
        '<div class="card"><div class="m">你标成主动式的功能 · ' + ((d.marks || []).length) + ' 个</div>' +
        ((d.marks || []).length
          ? (d.marks || []).map((m) => '<div class="frow"><span class="fi">' + icon('bell') + '</span><b>' + esc(m.name) +
              '</b><span class="k mhint">' + esc(m.note || m.hint || '') + '</span></div>').join('')
          : '<div class="k">还没有。到「自我改进 → 主动式」那一栏勾几个 —— 勾了它才会按那件事来找你。</div>') +
        '<div class="k" style="margin-top:8px">⚠️ 这几条会真的进生成提示词（不是只显示在这儿）—— ' +
        '所以"什么时候该来找我"那句话写得越具体越有用。</div></div>' +

        (d.canGenerate ? '' : '<div class="card k">⚠️ 没配 LLM key，主动式没法生成内容（决策层照常工作，只是推不出东西）。</div>') +

        '<div class="card"><div class="m">推过的</div>' +
        (h.length
          ? h.map((x) => '<div class="push"><div class="t">' + icon('bell') + ' ' + esc(x.title) + '</div><div class="b">' + esc(x.detail || '') + '</div>' +
              '<div class="k">' + esc(x.ts.slice(5, 16).replace('T', ' ')) + (x.tok_sum ? ' · ' + x.tok_sum + ' tok' : '') + '</div></div>').join('')
          : '<div class="k">还没有推过。</div>') +
        '</div>' +

        // ── 设置：什么时候许它开口 ─────────────────────────
        '<div class="secH" style="margin-top:18px"><b>设置</b><span class="k">什么时候许它开口</span></div>' +
        '<div class="card"><div class="m">预算与安静</div>' +
        '<div style="display:flex;gap:18px;flex-wrap:wrap">' +
        '<div>每天最多 <input class="num" type="number" min="0" id="pPerDay" value="' + c.perDay + '"> 条</div>' +
        '<div>静默 <input class="num" type="time" id="pFrom" value="' + c.quietFrom + '"> – <input class="num" type="time" id="pTo" value="' + c.quietTo + '"></div>' +
        '</div><div class="k" style="margin-top:8px">今天已推 <b>' + h.filter((x) => x.ts.slice(0, 10) === new Date().toISOString().slice(0, 10)).length + '</b> 条 · ' +
        '累计有用 ' + (st.useful || 0) + ' / 没用 ' + (st.useless || 0) + '</div></div>' +

        '<div class="card"><div class="m">什么时候该开口</div>' + rows + '</div>' +
        '<div class="card"><div class="m">怎么让它更准</div><div class="k">每次推送觉得有用就点一下 👍（在 macOS 通知里，或这里）。' +
        '记录会用来调权重 —— 功能能被抄，<b>你的偏好抄不走</b>。</div></div>' +
        '</div>';

      const save = (patch) => post('/api/proactive', patch).then(() => renderKb());
      $('#pOn').onchange = (e) => save({ enabled: e.target.checked });
      $('#pPerDay').onchange = (e) => save({ perDay: Number(e.target.value) });
      $('#pFrom').onchange = (e) => save({ quietFrom: e.target.value });
      $('#pTo').onchange = (e) => save({ quietTo: e.target.value });
      v.querySelectorAll('[data-tg]').forEach((i) => (i.onchange = () => save({ triggers: { [i.dataset.tg]: { on: i.checked } } })));
      v.querySelectorAll('[data-ft]').forEach((i) => (i.onchange = () => save({ features: { [i.dataset.ft]: i.checked } })));
      v.querySelectorAll('[data-gap]').forEach((i) => (i.onchange = () => save({ triggers: { [i.dataset.gap]: { minGapMin: Number(i.value) } } })));
    });
    return;
  }

  // ── 按软件看（读者：「给知识库功能都列一起的那种视图方式每个软件」）──
  // ⭐⭐ 手机（ADB）：信息 + 相册。读者 2026-10-10：「手机图片、手机信息这几个部分功能至少」
  if (kbView === 'phone') {
    Promise.all([api('/api/phone/info').catch((e) => ({ error: String(e) })), api('/api/phone/photos?n=48').catch(() => ({ items: [] }))])
      .then(([info, ph]) => {
        const bad = info?.error || ph?.error;
        if (bad) {
          // ⚠️ 连不上手机**不是错误页**：要说清是哪一种（没插线 / 没授权 / adb 没装），
          //    因为它们要做的事完全不一样。
          v.innerHTML = '<div class="kbwrap"><div class="card"><div class="m">手机连不上</div>' +
            '<div class="k" style="line-height:1.9">' + esc(String(bad)) + '</div>' +
            '<div class="k" style="margin-top:8px">⚠️ 无线 ADB 会掉线，插上数据线再来一次也行。</div></div></div>';
          return;
        }
        const items = ph.items || [];
        v.innerHTML = '<div class="kbwrap">' +
          '<div class="card"><div class="m">' + icon('phone') + ' 手机 · ' + esc(info.serial || '') + '</div>' +
          '<div class="kv">' +
            ['model', 'android', 'battery', 'storage'].map((k) => info[k]
              ? '<div><span class="k">' + esc({ model: '机型', android: '系统', battery: '电量', storage: '存储' }[k]) +
                '</span><b>' + esc(info[k]) + '</b></div>' : '').join('') +
          '</div></div>' +
          // ⭐ 读者 2026-10-10：「图片不只是几十张，可能是你没找对图库的地址」——
          //   他是对的（48 → 6789）。所以这里**必须把"一共多少张"写出来**：
          //   只写"最近 48 张"的话，看起来就是"你手机里只有 48 张"。
          '<div class="card"><div class="m">相册 · 最新 ' + items.length + ' 张' +
          (ph.total > items.length ? '<span class="k" style="font-weight:400">· 媒体库里共 ' + ph.total + ' 张</span>' : '') + '</div>' +
          '<div class="k">⚠️ 这里只列清单：一张照片两三 MB，一屏几十张全拉回来要几十秒，' +
          '那看着像卡死。点哪张才拉哪张。</div>' +
          (ph.how ? '<div class="k" style="opacity:.7">来源：' + esc(ph.how) + '</div>' : '') +
          (items.length
            ? '<div class="pgrid" id="pgrid">' + items.map((p, i) =>
                '<button class="ptile" data-i="' + i + '" data-path="' + esc(p.path) + '" title="' + esc(p.name) + '">' +
                '<span class="pnm">' + esc(p.name) + '</span>' +
                '<span class="pk">' + (p.size / 1048576).toFixed(1) + 'MB · ' + esc(p.mtime.slice(5)) + '</span></button>').join('') + '</div>'
            : '<div class="k">没找到图片（看过的目录：' + esc((ph.dirs || []).join('、')) + '）</div>') +
          '</div></div>';
        // 点一张 → 拉回来 → 就地换成真图（不弹窗：**就地**才有"这就是我点的那张"的确定感）
        $$('.ptile').forEach((b) => (b.onclick = () => {
          b.classList.add('loading');
          b.innerHTML = '<span class="pk">取回来…</span>';
          const img = new Image();
          img.onload = () => { b.innerHTML = ''; b.appendChild(img); b.classList.add('on'); };
          // ⚠️ 取不回来要**说出来**（onerror 后把原来的名字放回去）——
          //    只留一个灰块的话，"拉不下来"和"点坏了"长得一样。
          img.onerror = () => { b.classList.remove('loading'); b.textContent = '取不回来：' + (b.title || ''); };
          img.src = '/api/phone/file?path=' + encodeURIComponent(b.dataset.path);
        }));
      });
    return;
  }

  if (kbView === 'bysource') {
    api('/api/bysource').then((d) => {
      v.innerHTML = '<div class="kbwrap">' +
        '<div class="card"><div class="m">全部 ' + d.total + ' 段，按软件分</div>' +
        '<div class="k">每个软件一块：它带来多少内容、以及它带来了哪些功能。' +
        '没接的会显示 0 —— 接上之后这一块自己会长出来。</div></div>' +
        (d.items || []).map((s) => '<div class="card">' +
          '<div class="m">' + icon(s.icon) + ' ' + esc(s.label) + ' · ' + s.docs + ' 段' +
            (s.docs ? '' : '<span class="k">（没接 / 还没内容）</span>') + '</div>' +
          (s.spaces.length > 1
            ? '<div class="k">' + s.spaces.map((x) => esc(x.label) + ' ' + x.n).join(' · ') + '</div>'
            : '') +
          (s.features.length
            ? '<div class="frow-wrap">' + s.features.map((f) =>
                '<div class="frow">' + icon(f.icon) + '<b>' + esc(f.name) + '</b>' +
                '<span class="k">' + esc(f.groupName) + '</span>' +
                (f.removable ? '<span class="k">可删</span>' : '') + '</div>').join('') + '</div>'
            : '<div class="k" style="margin-top:8px">还没有属于它的功能</div>') +
          '</div>').join('') + '</div>';
    });
    return;
  }

  // ── 待办抽取 —— 第二个「装进来的」功能（见 src/mailtodo.ts）──
  //
  // ⚠️ 界面上必须**主动说出它靠不住**：规则抽的，会漏也会错。
  //    只给结论不给原文的话，用户只能信或不信 —— 所以每条都把原句摆出来。
  if (kbView === 'mailtodo') {
    api('/api/mailtodo').then((d) => {
      const items = d.items || [];
      if (!items.length) return (v.innerHTML = '<div class="kbwrap"><div class="k">没有邮件，所以抽不出待办。先在上面点「同步」。</div></div>');
      v.innerHTML = '<div class="kbwrap">' +
        '<div class="card"><div class="m">抽到 ' + items.length + ' 条</div>' +
        '<div class="k">' + icon('warn') + ' 这是<b>规则</b>抽的，不是模型 —— 靠「请求语气 + 动作词 + 有没有写明期限」。' +
        '它<b>会漏、也会错</b>，所以每条都把原文摆给你自己判。制度条款和保密页脚已经尽量滤掉了。</div></div>' +
        items.map((t) => '<div class="card">' +
          '<div style="display:flex;gap:10px;align-items:baseline">' +
          (t.due ? '<span class="badge blime">' + esc(t.due) + '</span>' : '<span class="badge">没写期限</span>') +
          '<b style="flex:1;font-weight:560">' + esc(t.sentence) + '</b></div>' +
          '<div class="k" style="margin-top:6px">' + esc(t.from) + ' · ' + esc(t.date) + ' · ' + esc(String(t.subject).slice(0, 46)) + '</div>' +
          '<div class="k">为什么算待办：命中 ' + esc((t.why || []).join('、')) + '</div>' +
          '</div>').join('') + '</div>';
    });
    return;
  }

  // ── 线程未结提醒 —— 第三个「装进来的」功能（见 src/threads.ts）──
  //
  // ⚠️ 这个视图**必须把依据摆出来**。它给的是"这条还没结"这种判断，
  //    而判断依据只有一条：**最后一封是谁发的、里面有没有事要你做**。
  //    不给依据的话，用户面对一句"等你回"只能信或不信 ——
  //    而它判错的时候，用户会把整个功能关掉，不是因为错，是因为**没法查**。
  if (kbView === 'mailthread') {
    api('/api/mailthread').then((d) => {
      const items = d.items || [];
      const LAB = { waiting_me: '等你回', waiting_them: '等对方', closed: '已结', quiet: '看不出' };
      const CLS = { waiting_me: 'badge blime', waiting_them: 'badge bman', closed: 'badge', quiet: 'badge' };
      if (!items.length) {
        return (v.innerHTML = '<div class="kbwrap"><div class="card"><div class="k">' +
          '还没有来回两封以上的邮件线程。先在上面点「同步」。</div></div></div>');
      }
      v.innerHTML = '<div class="kbwrap">' +
        '<div class="card"><div class="m">' + items.length + ' 条线程 · 其中 ' + (d.remind || 0) + ' 条等着你</div>' +
        '<div class="k">' + icon('warn') + ' 这是<b>规则</b>判的，不是模型 —— 判据只有一条：' +
        '<b>最后一封是谁发的、里面有没有事要你做</b>。 ' +
        '判"球在你这边"的会同时进工作区的主动板；"已结"和"看不出"只在这里给你看一眼，不去打扰你。' +
        '<br>每条都把最后一封的<b>新内容</b>摆出来 —— 你自己看它有没有看错地方。</div>' +
        // ⚠️ 退化了要说出来。线索链断掉的时候，同一条对话**看起来就是好几个短线程** ——
        //    而这**不像故障**，像"本来就这么短"。所以把体检数字摆出来。
        //    ⚠️ 别再写"重新同步就准了"：实测过，这个邮箱的头是**发件方就没写**
        //    （腾讯企业邮箱的已发送副本不带 In-Reply-To），重同步多少次都一样。
        (d.links && d.links.noParent
          ? '<div class="k">' + icon('warn') + ' 这个邮箱 <b>' + d.links.noParent + '/' + d.links.docs +
            ' 封没有 In-Reply-To</b>（腾讯企业邮箱的「已发送」副本不写这个头）—— ' +
            '那些地方只能靠标题缝合：要求<b>标题互相包含</b>且有<b>共同联系人</b>。' +
            (d.viaSubject ? `其中 <b>${d.viaSubject} 条</b>是这么缝出来的，可能漏并。` : '') +
            '这跟重不重新同步无关。</div>'
          : '') +
        '</div>' +
        items.map((t) => {
          // ⚠️ 先算好再拼。写成 `cond ? A : '' + B + C` 的话，
          //    `+` 比 `?:` 结合得紧 ⇒ 真分支会把 B、C 整个吃掉，
          //    而页面**看着只是少了几行**，不报错。
          const asks = (t.asks || []).length
            ? '<div class="k" style="margin-top:6px">最后一封里要你做的事：<b>' + esc(t.asks[0]) + '</b></div>' : '';
          const why = '<div class="k" style="margin-top:6px">' + (t.why || []).map(esc).join('<br>') + '</div>';
          const who = '<div class="k">' + esc(t.first) + ' → ' + esc(t.last) + ' · 参与 ' +
            (t.participants || []).slice(0, 4).map((p) => esc(p.name) + '(' + p.n + ')').join('、') +
            (t.via === 'subject' ? ' · ⚠️ 只能按标题分的' : '') + '</div>';
          return '<div class="card">' +
            '<div style="display:flex;gap:10px;align-items:baseline">' +
              '<span class="' + (CLS[t.status] || 'badge') + '">' + esc(LAB[t.status] || t.status) + '</span>' +
              '<b style="flex:1;font-weight:560">' + esc(t.subject) + '</b>' +
              '<span class="k">' + t.n + ' 封</span></div>' +
            '<div class="k" style="margin-top:6px">' + esc(t.heading) + '</div>' +
            asks + why + who +
            '</div>';
        }).join('') + '</div>';
    });
    return;
  }

  // ── 项目档案 —— 见 src/projects.ts ──────────────────────────
  //
  // ⚠️ 这一屏必须**说清楚每一块是靠什么聚起来的**。项目名是**算出来的**，
  //    用户看到"西安轨道吊"里混进一堆车辆通知时会以为功能坏了 ——
  //    而它其实是**按标题里的编号**聚的，只是那封通知的标题里正好有这个编号。
  if (kbView === 'projects') {
    api('/api/projects').then((d) => {
      const KIND = { code: '编号', org: '客户 / 机构', event: '活动', manual: '自建' };
      const items = d.items || [];
      const head = '<div class="card"><div class="m">' + items.length + ' 块档案</div>' +
        '<div class="k">' + icon('warn') + ' 名字是<b>算出来的</b>，只认四类能说清来路的信号：' +
        '<b>主题里的项目编号</b> / <b>对方机构</b>（按邮件域名）/ <b>会展名</b> / <b>你自己建的</b>。' +
        '<br>⚠️ 试过按<b>地名</b>聚 —— 实测「西安」命中 12 条，其中只有 1 条真跟西安轨道吊有关，' +
        '其余是通知模板里的字 ⇒ <b>地名在中文里不是项目名</b>，所以没有拿它当判据。' +
        '<br>想按「埃及 7 台 RTG」「越南 · 马来」这种名字看，在下面<b>自己建一个</b>（自动抽不出来）。</div></div>';

      const form = '<div class="card"><div class="m">自己建一个</div>' +
        '<div class="k">给几个关键词就行（<b>别用单个字</b>，那会匹配到半个库）。' +
        '它会把<b>所有来源</b>里含这些词的内容都收进来。</div>' +
        '<div class="row"><input id="pjname" placeholder="项目名，例如 埃及 7 台 RTG">' +
        '<input id="pjkw" placeholder="关键词，逗号隔开，例如 埃及, RTG"></div>' +
        '<button class="go" id="pjadd">建这个项目</button></div>';

      const cards = items.map((p) => {
        const itemsHtml = (p.items || []).map((i) => '<div class="frow">' +
          '<span class="k" style="min-width:74px">' + esc(i.date) + '</span>' +
          (i.quote ? '<span class="badge blime">报价</span>' : '') +
          (i.threadN > 1 ? '<span class="badge bman">' + i.threadN + ' 封</span>' : '') +
          // ⚠️ 库里确实有**标题为空**的笔记（实测 learn 里 291/307 条）。
          //    不兜底的话那一行只剩日期和来源，看起来像"渲染坏了"。
          //    ⚠️ 兜底用**正文第一行**（`snippet`），不是写死一句"无标题" ——
          //       那句话对用户没有任何信息量，而正文第一行能让他认出这是哪条。
          '<b style="flex:1;font-weight:520">' + esc(String(i.title || i.snippet || '(无标题)').slice(0, 72)) + '</b>' +
          '<span class="k">' + esc(i.space) + (i.hit.length ? ' · ' + esc(i.hit.slice(0, 2).join(' ')) : '') + '</span>' +
          '</div>').join('');
        const more = p.n > (p.items || []).length ? '<div class="k">…还有 ' + (p.n - p.items.length) + ' 条</div>' : '';
        return '<div class="card">' +
          '<div style="display:flex;gap:10px;align-items:baseline">' +
            '<span class="badge">' + esc(KIND[p.kind] || p.kind) + '</span>' +
            '<b style="flex:1;font-weight:560">' + esc(p.name) + '</b>' +
            '<span class="k">' + p.n + ' 条</span>' +
            (p.kind === 'manual' ? '<button class="ghost sm" data-pjdel="' + esc(p.key.replace(/^manual:/, '')) + '">删</button>' : '') +
          '</div>' +
          '<div class="k" style="margin-top:6px">' + esc(p.basis) + '</div>' +
          '<div class="k">邮件 ' + p.mail + ' · 笔记 ' + p.note + (p.quotes ? ' · 报价 ' + p.quotes : '') +
            (p.inThreads ? ' · 其中 ' + p.inThreads + ' 条在来回多条线索里' : '') +
            ' · ' + esc(p.first) + ' → ' + esc(p.last) + '</div>' +
          (p.n ? '<div class="frow-wrap" style="margin-top:8px">' + itemsHtml + more + '</div>'
               : '<div class="k" style="margin-top:8px">暂时没有一条匹配 —— 项目留着，等有内容了自己会进来。</div>') +
          // ⚠️ 弱命中单列，**别混进上面那一栏** —— 混在一起的话，
          //    用户分不出"这条是它反复提到的"和"这条只在边上带了一句"，
          //    而这两件事的可信度差得远。也**别直接丢掉**：丢掉会让人以为功能没连上。
          (p.maybeN
            ? '<div class="k" style="margin-top:10px">' + icon('warn') + ' 还有 <b>' + p.maybeN +
                ' 条只是在边上提过一句</b>（不是"在讲这件事"）—— 算不算你定：</div>' +
              '<div class="frow-wrap">' + (p.maybe || []).map((i) => '<div class="frow">' +
                '<span class="k" style="min-width:74px">' + esc(i.date) + '</span>' +
                '<b style="flex:1;font-weight:400;opacity:.72">' + esc(String(i.title || i.snippet || '(无标题)').slice(0, 66)) + '</b>' +
                '<span class="k">' + esc(i.space) + '</span></div>').join('') + '</div>'
            : '') +
          '</div>';
      }).join('');

      v.innerHTML = '<div class="kbwrap">' + head + form + (cards || '<div class="card"><div class="k">还没有档案。上面的自动发现要有 ≥2 条命中才立一块；想马上看到，就在下面自己建一个。</div></div>') + '</div>';

      $('#pjadd').onclick = async () => {
        const name = $('#pjname').value.trim();
        if (!name) return toast('给它起个名字', 'bad');
        $('#pjadd').disabled = true;
        const r = await post('/api/projects', { name, keywords: $('#pjkw').value });
        $('#pjadd').disabled = false;
        if (r.error) return toast(r.error, 'bad');
        toast('建好了：' + r.project.name);
        renderKb();
      };
      $$('[data-pjdel]').forEach((b) => (b.onclick = async () => {
        const r = await fetch('/api/projects/' + encodeURIComponent(b.dataset.pjdel), { method: 'DELETE' }).then((x) => x.json());
        if (r.error) return toast(r.error, 'bad');
        toast('删了'); renderKb();
      }));
    });
    return;
  }

  // ── 联系人 / 公司 —— 第一个「装进来的」功能（见 src/contacts.ts）──
  if (kbView === 'contacts') {
    api('/api/contacts').then((d) => {
      const items = d.items || [];
      if (!items.length) {
        return (v.innerHTML = '<div class="kbwrap"><div class="k">还没有邮件，所以攒不出联系人。先在上面点「同步」。</div></div>');
      }
      v.innerHTML = '<div class="kbwrap">' +
        '<div class="card"><div class="m">共 ' + items.length + ' 个人 / 组织</div>' +
        '<div class="k">从邮件里攒的 —— 收发两边都算，你自己不在名单里。按来往次数排。</div></div>' +
        '<div class="card"><table><tr><th>人 / 组织</th><th>来往</th><th>最近</th><th>聊过什么</th></tr>' +
        items.map((c) =>
          '<tr><td><b>' + esc(c.name) + '</b><div class="k">' + esc(c.email) + (c.org ? ' · ' + esc(c.org) : '') + '</div></td>' +
          '<td>' + c.n + '<div class="k">收 ' + c.got + ' / 发 ' + c.sent + '</div></td>' +
          '<td class="k">' + esc(c.last) + '</td>' +
          '<td class="k">' + (c.subjects || []).map(esc).join('<br>') + '</td></tr>').join('') +
        '</table></div></div>';
    });
    return;
  }

  // ── 自我改进 —— 按软件推荐功能、沟通、开始制作、安装 ────────────
  //
  // ⭐ 读者 2026-10-10 定的这一屏该长什么样：
  //   · 我电脑里的软件列表，**我自己选**
  //   · 选中之后**自动**更新成"只列这个软件能做的功能"
  //   · 每条功能有 **沟通 / 开始制作 / 安装**
  //   · 「或者你直接说」的结果也**列在上面**，一样能沟通、制作、安装
  //   · 底下有一份"你现在所有的功能（按软件）"，可以**一键卸载**，别处也跟着没有
  if (kbView === 'selfimprove') {
    Promise.all([
      api('/api/features'), api('/api/stats'),
      api('/api/apps').catch(() => ({ apps: [] })),
      api('/api/proposals').catch(() => ({ items: [] })),
    ]).then(([f, s, a, pr]) => {
      const cats = (f.catalog || []).filter((c) => c.ready);
      const apps = a.apps || [];
      const props = pr.items || [];
      // 选中的那条（存 localStorage —— 刷新/重开还在那个块里，不然每次都要重挑）
      let PROP_ACTIVE = '';
      try { PROP_ACTIVE = localStorage.getItem('c4propActive') || ''; } catch { PROP_ACTIVE = ''; }
      const spaces = (s.bySpace || []).map((x) => '<span class="badge">' + esc(x.space) + ' ' + x.n + '</span>').join(' ');

      // 这个软件已经装了哪些功能（按 source 归）
      // ⚠️ 列**全部**，内置的也列出来 —— 读者要的是"你现在所有的功能（按软件）"。
      //    只列可卸载的那些会变成"说有 17 个，只看见 4 个"，而那两个数是同一个意思。
      //    内置的照常显示，只是没有卸载键（它本来就不该能卸）。
      const softs = (f.groups || []).map((g) => ({ id: g.id, name: g.name, items: g.items || [] }));
      const allItems = (f.groups || []).flatMap((g) => (g.items || []).map((i) => ({ ...i, soft: g.name })));

      // 提案能装到哪个现成功能上 —— **按软件的归属对**，对不上就是"还没做"
      const matchOf = (app) => {
        const k = app.toLowerCase();
        return cats.find((c) => c.source === k || (k && c.name.toLowerCase().includes(k)));
      };

      const appRows = apps.map((x) =>
        '<div class="frow apick" data-app="' + esc(x.name) + '" data-known="' + esc(x.known || '') + '">' +
        '<b>' + esc(x.name) + '</b>' + (x.known ? '<span class="badge">已接</span>' : '') +
        '<span class="k" style="margin-left:auto">' + esc(x.group) + '</span></div>').join('');

      // ═══ 功能提案：**先选方向 → 只剩一个块 → 块内气泡对话 → 合适了安装** ═══
      //   读者 2026-10-13 原话拆成六条：
      //     ·「你一开始的时候就**猜测好用户想要的功能方向，然后用户选择**」
      //     ·「**选择之后其他的都不要了**，除非用户点击**换一个功能制作**」
      //     ·「你要在这个块内**来回对话**，用户给你对话，你给用户对话，**都是气泡的形式**」
      //     ·「**直接给用户一个地方可以填写功能的名字**就好了」
      //     ·「沟通好了之后**制作**这个功能」「询问用户**是否没有问题了**，没有问题就可以点击安装」
      //     ·「这样让界面**简单**」
      //   ⚠️ 全部状态就一个：`PROP_ACTIVE`（选中的那条 id，存 localStorage）。
      //     它空 ⇒ 显示"方向"列表；它指向某条 ⇒ **只画那一条**。
      // ⚠️ 气泡里原来是 `esc()` 之后直接铺 —— 于是模型写的 `**重点**` 会**原样显示成星号**
      //    （读者 2026-10-13 的截图里满屏都是 `**`）。这里做一层极小的 markdown：
      //    先转义，再只认 **粗体** / `行内码` / 行首 `- ` 列表 —— 够用了，
      //    不要引一个 markdown 库进来（那会带来一整套 XSS 面）。
      const mdLight = (t) => esc(String(t ?? ''))
        .replace(/\*\*([^*\n]{1,80})\*\*/g, '<b>$1</b>')
        .replace(/`([^`\n]{1,60})`/g, '<code>$1</code>')
        .replace(/^\s*[-*]\s+/gm, '• ');
      const bubble = (who, text) =>
        '<div class="pb ' + (who === 'me' ? 'me' : 'it') + '"><div class="pbt">' +
          (who === 'me' ? esc(text) : mdLight(text)) + '</div></div>';
      // 一问一答 → 两条气泡（读者的：他给你对话、你给用户对话）
      const thread = (x) => (x.msgs || []).map((m) => bubble('me', m.q) + bubble('it', m.a)).join('');

      // ── 一个"方向"（还没选中的那条）：一排，点「就做它」 ──
      const propRow = (x) => {
        const one = String(x.plan || '').replace(/[#*`>\-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 78);
        return '<div class="frow proprow" data-prop="' + esc(x.id) + '">' +
          '<b style="flex:none">' + esc(x.title || '（没起名字）') + '</b>' +
          '<span class="k" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(one) + '</span>' +
          '<button class="go sm" data-pick="' + esc(x.id) + '">就做它</button>' +
          '<button class="ghost sm" data-pdel="' + esc(x.id) + '">删</button></div>';
      };

      // ── 选中的那一条：一个块，里面有名字、方案、气泡对话、和三个动作 ──
      const propBlock = (x) => {
        const m = matchOf(x.app);
        const badge = { idea: '还没做', planned: '有步骤了', installed: '已装上' }[x.state] || x.state;
        const said = (x.msgs || []).length
          ? thread(x)
          : bubble('it', '我按你这个方向想了一版方案（点下面「方案」能展开）。' +
              '哪里不对直接说；名字也能自己改 —— 改完没问题，就点最右边那颗安装。');
        return '<div class="card propblock" data-prop="' + esc(x.id) + '" data-app="' + esc(x.app || '') + '">' +
          '<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">' +
            '<span class="badge">' + esc(badge) + '</span>' +
            (x.app ? '<span class="k">' + esc(x.app) + '</span>' : '') +
            '<input data-pname="' + esc(x.id) + '" value="' + esc(x.title || '') + '" ' +
              'title="这个功能叫什么，你自己写 —— 写了就算数" ' +
              'style="flex:1;min-width:200px;font-weight:560;font-size:15px">' +
            '<button class="ghost sm" data-pdrop="1" title="回到那几个方向，重新挑一个">换一个功能制作</button>' +
            '<button class="ghost sm" data-pdel="' + esc(x.id) + '">删</button>' +
          '</div>' +
          '<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12.5px;color:var(--dim)">方案</summary>' +
            '<div class="pbody" style="white-space:pre-wrap;font-size:13px;margin-top:8px;max-height:300px;overflow:auto">' +
              esc(x.plan) + '</div></details>' +
          '<div class="pchat">' + said + '</div>' +
          '<div class="row" style="margin-top:10px">' +
            '<input data-pq="' + esc(x.id) + '" placeholder="接着说 —— 它按你说的改（名字也算，你说叫什么就叫什么）">' +
            '<button class="go sm" data-pask="' + esc(x.id) + '">发送</button>' +
            (x.state === 'installed'
              ? '<button class="ghost sm" disabled>已装上</button>'
              : '<button class="ghost sm" data-pplan="' + esc(x.id) + '">先出实现步骤</button>') +
            (m
              ? '<button class="go sm" data-pinst="' + esc(x.id) + '" data-fid="' + esc(m.id) + '">安装「' + esc(m.name) + '」</button>'
              : '<button class="ghost sm" disabled title="还没有对应的功能可以装 —— 先「先出实现步骤」">还没做</button>') +
          '</div>' +
          '<div class="k" style="margin-top:8px">聊到你觉得没问题了，就点上面那颗<b>安装</b>。</div>' +
        '</div>';
      };

      // ── 总入口：选过了就只画那一条，没选就画"方向"列表 ──
      const propList = () => {
        if (!props.length) return '';
        const cur = props.find((x) => x.id === PROP_ACTIVE);
        if (cur) {
          const others = props.length - 1;
          return (others > 0
            ? '<div class="k" style="margin-bottom:8px">还有 ' + others + ' 个方向，已经收起来了 —— 想换就点块里的「换一个功能制作」。</div>'
            : '') + propBlock(cur);
        }
        return '<div class="k" style="margin-bottom:8px">它猜了几个方向，**先挑一个**：挑完就只剩它一个，其余收起来。</div>' +
          props.map(propRow).join('');
      };

      // ⭐⭐ 功能管理（读者 2026-10-10）：
      //   「所有功能如果点 × 之前要确认是暂时关闭不显示还是卸载」「这些功能的管理在
      //     对应的要有暂时关闭还是打的开关以及卸载安装」「卸载之后的功能也要保留 30 天，
      //     可以重新安装回来，可以一键安装回来」
      const mg = f.manage || { builtins: [], installed: [], removed: [], retentionDays: 30 };
      const allMg = [...(mg.builtins || []), ...(mg.installed || [])];
      // ⚠️ 主动式那一栏**只列"做得到"的** —— 给"链接"这种纯只读的功能一个能勾的框，
      //    勾了只会得到沉默，那是在骗人（判据见 features.ts 的 BUILTIN_PROACTIVE）。
      const proCapable = allMg.filter((i) => i.proactive);
      const offItems = allMg.filter((i) => i.off);
      const onItems = allMg.filter((i) => !i.off);
      // 关（暂时关闭）→ 从侧栏消失；卸（卸载）→ 进待安装，保留 30 天。两条路都**可逆**，
      // 但**在哪找回来**不一样，所以界面上要分开写。
      const mrow = (i, mode) =>
        '<div class="frow" data-fid="' + esc(i.id) + '">' +
          '<span class="fi">' + icon(i.icon || 'help') + '</span>' +
          '<b>' + esc(i.name) + '</b>' +
          '<span class="k mhint">' + esc(i.hint || '') + '</span>' +
          (mode === 'gone'
            ? '<button class="go sm" data-restore="' + esc(i.id) + '" data-name="' + esc(i.name) + '">一键装回来</button>'
            : '<button class="ghost sm" data-offfeat="' + esc(i.id) + '" data-name="' + esc(i.name) + '" data-off="1">暂时关闭</button>' +
              (i.removable
                ? '<button class="ghost sm" data-rmfeat="' + esc(i.id) + '" data-name="' + esc(i.name) + '">卸载</button>'
                : '<span class="k" title="它的代码在程序里，卸不掉 —— 用「暂时关闭」">内置</span>')) +
        '</div>';
      const softBlock =
        '<div style="margin-top:8px"><div class="m" style="margin:0">在用 · ' + onItems.length + ' 个</div>' +
          (onItems.map((i) => mrow(i, 'on')).join('') || '<div class="k">一个都不在</div>') + '</div>' +
        (offItems.length
          ? '<div style="margin-top:12px"><div class="m" style="margin:0">暂时关闭着 · ' + offItems.length + ' 个（还在，只是不显示）</div>' +
            offItems.map((i) =>
              '<div class="frow off" data-fid="' + esc(i.id) + '"><span class="fi">' + icon(i.icon || 'help') + '</span>' +
              '<b>' + esc(i.name) + '</b><span class="k mhint">' + esc(i.hint || '') + '</span>' +
              '<button class="go sm" data-offfeat="' + esc(i.id) + '" data-name="' + esc(i.name) + '" data-off="0">打开</button></div>').join('') +
            '</div>'
          : '') +
        ((mg.removed || []).length
          ? '<div style="margin-top:12px"><div class="m" style="margin:0">待安装 · 卸载后保留 ' + (mg.retentionDays || 30) + ' 天</div>' +
            (mg.removed || []).map((r) =>
              '<div class="frow off" data-fid="' + esc(r.id) + '"><b>' + esc(r.name) + '</b>' +
              '<span class="k mhint">还剩 ' + r.daysLeft + ' 天</span>' +
              '<button class="go sm" data-restore="' + esc(r.id) + '" data-name="' + esc(r.name) + '">一键装回来</button></div>').join('') +
            '</div>'
          : '');

      // 主动式：能不能勾由注册表定，勾不勾由人定；旁边那句话就是"怎么主动"的起点。
      const proBlock = proCapable.map((i) =>
        '<div class="prow"><label class="sw"><input type="checkbox" data-pro="' + esc(i.id) + '"' + (i.proactiveOn ? ' checked' : '') + '><span></span></label>' +
        '<div class="pc"><b>' + esc(i.name) + '</b><div class="k">' + esc(i.proactiveHint || '') + '</div></div>' +
        '<input class="num pnote" data-pnote="' + esc(i.id) + '" placeholder="什么时候该来找我…" value="' + esc(i.proactiveNote || '') + '">' +
        '<button class="ghost sm" data-psave="' + esc(i.id) + '">存</button></div>').join('');

      v.innerHTML = '<div class="kbwrap">' +
        // ⭐ 对话改功能：读者要的「跟它对话就能卸功能 / 就能定哪些是主动式」。
        //    ⚠️ 分两步：**先解析成一条具体操作给你看，点"执行"才落** ——
        //    "它听懂了吗"和"它动手了吗"是两件事，混成一步就没法反悔。
        '<div class="card"><div class="m">对话改功能</div>' +
          '<div class="k">说一句中文，它翻成<b>一条</b>可执行的配置变更（装 / 卸 / 关 / 开 / 标主动式），' +
          '先给你看清楚是哪一条。⚠️ 改代码的事只会出方案，不会自己上线。</div>' +
          '<div class="row" style="margin-top:8px"><input id="sicmd" placeholder="比如：把推荐关掉 / 装回项目档案 / 让主题变成主动式"></div>' +
          '<div class="row" style="margin-top:6px;gap:8px;flex-wrap:wrap">' +
          '<button class="go" id="sicmdgo">解析</button>' +
          '<button class="go" id="sicmdapply" disabled>执行这条</button></div>' +
          '<div id="sicmdout" class="k" style="margin-top:8px"></div></div>' +
        '<div class="card"><div class="m">它现在能看到什么</div>' + spaces +
          '<div class="k" style="margin-top:8px">' + s.docs + ' 段 · ' + s.chunks + ' 切块 · ' +
          (s.hasLlm ? 'LLM 已配' : '⚠️ 还没配 LLM key（"让我想办法"用不了）') + '</div></div>' +

        '<div class="card"><div class="m">我电脑里的软件 · ' + apps.length + ' 个</div>' +
          '<div class="k">点一个，选中的软件下面就只列它能做的功能。标了「已接」的是已经有来源了。</div>' +
          '<div class="row" style="margin-top:8px"><input id="siapp" placeholder="找软件…（输入就筛）"></div>' +
          '<div id="siapps" style="max-height:200px;overflow:auto;margin-top:6px">' +
            (appRows || '<div class="k">没扫到应用</div>') + '</div>' +
          '<div id="sipick" class="k" style="margin-top:8px">还没选。上面点一个软件。</div>' +
          '<button class="go" id="siplan" disabled>给选中的软件想功能</button></div>' +

        '<div class="card"><div class="m" id="prophead">它想出来的功能 · ' + props.length + ' 条</div>' +
          (props.length ? '<div class="k">每条都能<b>沟通</b>（接着问）、<b>开始制作</b>（让它出实现步骤）、' +
            '<b>安装</b>（真的加进侧栏）。⚠️ 「开始制作」只出步骤，不写代码 —— ' +
            '自动写代码再自动上线，失败时是静默的（页面照常、只是点开是空的）。</div>'
            : '<div class="k">还没有。上面选个软件让它想，或者在下面直接说。</div>') +
          '<div style="margin-top:10px">' + propList() + '</div></div>' +

        // ── 主动式：打勾它才会主动来找你 ─────────────────────
        '<div class="card"><div class="m">主动式 · 让功能自己来找你 · ' + proCapable.length + ' 个可勾</div>' +
          '<div class="k">打勾的会主动生成内容推给你（推过什么在「主动」那一页）。' +
          '⚠️ 能勾的才有：只把东西列出来给你看的功能，主动起来没有东西可推 —— 那种这里不列。' +
          '右边那格写「什么时候该来找我」，它按这个来。</div>' +
          (proBlock || '<div class="k">还没有能做主动式的功能 —— 先在上面装几个。</div>') + '</div>' +

        '<div class="card"><div class="m">功能管理 · 共 ' + allMg.length + ' 个（还在 ' + onItems.length +
          ' · 暂关 ' + offItems.length + ' · 待安装 ' + ((mg.removed || []).length) + '）</div>' +
          '<div class="k">⭐ 两条路都可逆，区别在去哪找回来：' +
          '<b>暂时关闭</b> = 还在，就在下面这一栏，按一下就回来；' +
          '<b>卸载</b> = 进「待安装」，保留 ' + (mg.retentionDays || 30) + ' 天，一键装回来。' +
          '⚠️ 卸载之后侧栏、左下角扇区一起没有（它们照同一份注册表画）。</div>' +
          softBlock + '</div>' +

        // ⭐⭐ 「**把这个软件全部断联**」（读者 2026-10-10）——
        //    ⚠️ 不是卸载你电脑上的那个软件，是拿掉**我们这边**为了用它而装的功能。
        //    ⚠️ 断之前要说清"要动几个"，不然按一下才知道发生了什么。
        '<div class="card"><div class="m">按软件 · 全部断联</div>' +
          '<div class="k">断开一个来源 = 把它带来的那些功能一起拿掉：装进来的进「待安装」（保留 ' +
          (mg.retentionDays || 30) + ' 天，一键装回来），内置的只是从侧栏收起来。' +
          '⚠️ 不动你电脑上的那个软件，也不删数据 —— 重新装上就又能用。</div>' +
          (softs.length
            ? softs.map((g) => '<div class="frow"><span class="fi">' + icon(g.icon || 'help') + '</span><b>' + esc(g.name) + '</b>' +
                '<span class="k mhint">' + g.items.length + ' 个功能</span>' +
                '<button class="ghost sm" data-disc="' + esc(g.id) + '" data-name="' + esc(g.name) + '">全部断联</button></div>').join('')
            : '<div class="k">还没有可断的来源</div>') +
        '</div>' +

        '<div class="card"><div class="m">或者你直接说</div>' +
          '<div class="row"><input id="siq" placeholder="我想要一个…的功能"></div>' +
          '<button class="go" id="sig">让我想办法</button>' +
          '<div id="siout" class="k" style="margin-top:10px"></div></div>' +
        '</div>';

      // ── 事件 ──────────────────────────────────────────────
      let picked = siAppSel;
      const paintPick = () => {
        $$('.apick').forEach((r) => r.classList.toggle('on', r.dataset.app === picked));
        // ⭐ 读者 2026-10-10：「选中的软件之后，**自动**就应该它给的功能建议就更新
        //    （**只列这个软件可以做的功能**）」。
        //    ⚠️ 就地隐藏，**不重画** —— 重画会把筛选框里的字和滚动位置一起弄丢。
        const cards = $$('[data-prop]');
        cards.forEach((c) => { c.hidden = !!picked && c.dataset.app !== picked; });
        const head = $('#prophead');
        if (head) {
          head.textContent = picked
            ? `它想出来的功能 · 只看「${picked}」`
            : `它想出来的功能 · ${cards.length} 条`;
        }
        const box = $('#sipick'), btn = $('#siplan');
        if (picked) {
          const k = apps.find((x) => x.name === picked)?.known;
          box.innerHTML = '已选：<b>' + esc(picked) + '</b>' + (k ? '（已接入：' + esc(k) + '）' : '（还没接）');
          btn.disabled = false;
        } else { box.textContent = '还没选。上面点一个软件。'; btn.disabled = true; }
      };
      $$('.apick').forEach((r) => (r.onclick = () => {
        picked = r.dataset.app === picked ? null : r.dataset.app;
        siAppSel = picked; paintPick();
      }));
      $('#siapp').oninput = (e) => {
        const q = e.target.value.trim().toLowerCase();
        $$('.apick').forEach((r) => { r.hidden = !!q && !r.dataset.app.toLowerCase().includes(q); });
      };
      paintPick();

      const think = async (body, box) => {
        box.textContent = '在想…（要十几秒）';
        const r = await post('/api/features/propose', body);
        if (r.error) { box.textContent = ''; return toast(r.error, 'bad'); }
        box.textContent = '';
        const saved = await post('/api/proposals', { app: body.app || '', plan: r.plan || '' });
        if (saved.error) return toast(saved.error, 'bad');
        toast('想好了，在上面那条里');
        renderKb();
      };
      $('#siplan').onclick = () => {
        if (!picked) return toast('先在上面点一个软件', 'bad');
        const known = apps.find((x) => x.name === picked)?.known || '';
        think({ app: picked, known }, $('#siout'));
      };
      $('#sig').onclick = () => {
        const wish = $('#siq').value.trim();
        if (!wish && !picked) return toast('先说一句你想要什么，或者先点一个软件', 'bad');
        think({ wish, app: picked || '' }, $('#siout'));
      };
      // ⚠️ 卸载**先过 `openFeatureMenu` 那一步**（读者要求"点 × 之前要确认是
      //    暂时关闭还是卸载"）—— 管理页里的按钮同样走那条路，不然两处行为不一样。
      $$('[data-rmfeat]').forEach((b) => (b.onclick = () => {
        openFeatureMenu(b.dataset.rmfeat, b.dataset.name || b.dataset.rmfeat, true);
      }));
      $$('[data-disc]').forEach((b) => (b.onclick = () => openDisconnect(b.dataset.disc, b.dataset.name)));
      $$('[data-restore]').forEach((b) => (b.onclick = async () => {
        b.disabled = true;
        await restoreFeature(b.dataset.restore, b.dataset.name);
        await renderSources();
        renderKb();
      }));
      $$('[data-offfeat]').forEach((b) => (b.onclick = async () => {
        const off = b.dataset.off !== '0';
        await toggleFeatureOff(b.dataset.offfeat, off, b.dataset.name);
        await renderSources();
        renderKb();
      }));
      // ── 主动式：勾选 = 它能主动来找你；右边那格写的是"什么时候该来找我" ──
      $$('[data-pro]').forEach((i) => (i.onchange = async () => {
        const note = ($('[data-pnote="' + i.dataset.pro + '"]') || {}).value;
        const r = await post('/api/features/proactive', { id: i.dataset.pro, on: i.checked, note });
        if (r.error) { i.checked = !i.checked; return toast(r.error, 'bad'); }
        toast(i.checked ? '设成主动式了 —— 它会在「主动」那一页找你' : '不主动了', 'good');
      }));
      $$('[data-psave]').forEach((b) => (b.onclick = async () => {
        const id = b.dataset.psave;
        const box = $('[data-pnote="' + id + '"]');
        const on = ($('[data-pro="' + id + '"]') || {}).checked;
        const r = await post('/api/features/proactive', { id, on, note: (box || {}).value || '' });
        if (r.error) return toast(r.error, 'bad');
        toast('记下了 —— 它按这句话来决定什么时候来找你', 'good');
        renderKb();
      }));
      $$('[data-pdel]').forEach((b) => (b.onclick = async () => {
        const r = await fetch('/api/proposals/' + encodeURIComponent(b.dataset.pdel), { method: 'DELETE' }).then((x) => x.json());
        if (r.error) return toast(r.error, 'bad');
        renderKb();
      }));
      $$('[data-pask]').forEach((b) => (b.onclick = async () => {
        const id = b.dataset.pask;
        const inp = $('[data-pq="' + id + '"]');
        const q = inp.value.trim();
        if (!q) return toast('先说要问什么', 'bad');
        b.disabled = true; b.textContent = '…';
        const r = await post('/api/proposals/chat', { id, q });
        b.disabled = false; b.textContent = '发送';
        if (r && r.error) return toast(r.error, 'bad');
        // ⚠️⚠️ 这里**不要 `renderKb()`** —— 读者 2026-10-13：
        //    「我一跟它对话完它思考完它就跑到这个页面**最上面**去了」。
        //    整块重画会把滚动位置一起丢掉。⇒ 只把**这两条气泡**追加进这一块的会话区，
        //    再把会话区滚到底（这一条也不重画，所以不会跳）。
        const msgs = (r && r.item && r.item.msgs) || [];
        const ans = msgs.length ? msgs[msgs.length - 1].a : '';
        const box = document.querySelector('.propblock[data-prop="' + id + '"] .pchat');
        if (box) {
          box.insertAdjacentHTML('beforeend', bubble('me', q) + bubble('it', ans || '（没答上，再问一次试试）'));
          box.scrollTop = box.scrollHeight;
          inp.value = '';
        } else {
          renderKb();                     // 兜底：找不到那一块（比如刚被删了）
        }
      }));
      $$('[data-pplan]').forEach((b) => (b.onclick = async () => {
        b.disabled = true; b.textContent = '在想步骤…';
        const r = await post('/api/proposals/plan', { id: b.dataset.pplan });
        if (r.error) { b.disabled = false; b.textContent = '开始制作'; return toast(r.error, 'bad'); }
        toast('出步骤了，往下看');
        renderKb();
      }));
      // 「就做它」—— 选完其余收起来
      $$('[data-pick]').forEach((b) => (b.onclick = () => {
        PROP_ACTIVE = b.dataset.pick;
        try { localStorage.setItem('c4propActive', PROP_ACTIVE); } catch { /* 存不上也照样能用 */ }
        renderKb();
      }));
      // 「换一个功能制作」—— 回到方向列表（其余的**没删**，只是收起来了）
      $$('[data-pdrop]').forEach((b) => (b.onclick = () => {
        PROP_ACTIVE = '';
        try { localStorage.removeItem('c4propActive'); } catch { /* 同上 */ }
        renderKb();
      }));
      // 名字：**你写什么就是什么**（读者：「直接给用户一个地方可以填写功能的名字」）。
      // ⚠️ 之前这里是靠"猜"的 —— 模型拿用户起的名字去材料里查，查不到就回"没有"。
      //    现在名字是一个**可编辑的输入框**，回车或失焦就存。
      $$('[data-pname]').forEach((i) => {
        const save = async () => {
          const t = i.value.trim();
          if (t === (props.find((x) => x.id === i.dataset.pname)?.title || '')) return;  // 没改就别发
          const r = await fetch('/api/proposals/' + encodeURIComponent(i.dataset.pname), {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }),
          }).then((x) => x.json()).catch(() => ({ error: '存不上' }));
          if (r && r.error) toast(r.error, 'bad'); else toast('名字记下了：' + (t || '（空）'));
        };
        i.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } };
        i.onblur = save;
      });
      $$('[data-pinst]').forEach((b) => (b.onclick = async () => {
        b.disabled = true;
        const r = await post('/api/proposals/install', { id: b.dataset.pinst, featureId: b.dataset.fid });
        if (r.error) { b.disabled = false; return toast(r.error, 'bad'); }
        toast('装上了，看左边那一栏');
        await renderNav(); await renderSources();
        renderKb();
      }));
    });
    return;
  }

  if (kbView === 'tax') {
    api('/api/taxonomy').then((t) => {
      // ⚠️ `t` 非空但**没有任何大类**时也要能进 —— 手写主题就是这种情形
      //    （生成产物还没跑，或者跑出来是空的），别把它当成"还没生成"。
      const groups = (t && t.groups) || [];
      const mx = Math.max(1, ...groups.map((g) => g.size));
      // ⚠️ 分母要**兜住 0** —— 手写主题的 totalDocs 可能是 0，
      //    直接除会得到 NaN%，而 "NaN%" 会被当成"渲染坏了"。
      const tot = Math.max(1, t?.totalDocs || 0);
      const box = document.createElement('div');
      box.className = 'kbwrap';
      box.innerHTML = groups.map((g) =>
        '<div class="card"><div style="display:flex;align-items:center;gap:10px">' +
        (g.manual ? '<span class="badge bman">手动</span> ' : '') + '<b>' + esc(g.name) + '</b><span class="k">' + g.size + ' 段 · ' +
        ((g.size / tot) * 100).toFixed(1) + '%</span><span class="bar" style="width:' + Math.max(3, Math.round((g.size / mx) * 130)) + 'px"></span></div>' +
        '<div style="margin-top:6px">' + (g.clusters || []).map((c) => '<div style="padding:2px 0;font-size:12.5px"><span class="badge">' + c.size + '</span> ' + esc(c.name) +
        ' <span class="k">' + (c.keywords || []).join(' · ') + '</span>' + (c.desc ? '<span class="k"> · ' + esc(c.desc) + '</span>' : '') + '</div>').join('') + '</div></div>').join('') +
        '<div class="k" style="padding:0 2px">完整树图：<a href="/out/taxonomy.html" target="_blank">打开</a></div>';
      v.innerHTML = '';
      mountManual(box, 'tax', null);
      v.appendChild(box);
    });
    return;
  }
  if (kbView === 'vocab') {
    v.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'kbwrap';
    box.innerHTML = '<div class="row"><input id="q" type="text" placeholder="查词条（中英文都行）"></div><div id="out"></div>';
    const load = async () => {
      const r = await api('/api/vocab?q=' + encodeURIComponent($('#q').value.trim()));
      $('#out').innerHTML = '<div class="k" style="margin:8px 0">共 ' + r.total + ' 条' +
        (r.manualCount ? '（其中手写 ' + r.manualCount + ' 条）' : '') + '</div>' +
        (r.manualError ? '<div class="k" style="color:#a33">⚠️ 手写那份读不了：' + esc(r.manualError) + '</div>' : '') +
        '<div class="card"><table><tr><th>英文</th><th>中文</th><th>出处</th></tr>' +
        r.entries.map((e) => '<tr><td>' + esc(e.en) + '</td><td>' + esc(e.zh) + '</td><td class="k">' +
          (e.manual ? '<span class="badge bman">手动</span> ' : '') + esc(e.space) + ' ' + esc(e.date) + '</td></tr>').join('') + '</table></div>';
    };
    let t;
    // ⚠️⚠️ 顺序不能换：`$('#q')` 走的是 `document.querySelector`，
    //    而 box 这一刻**还没进 DOM** ⇒ 拿到 null、整个视图渲染中断，
    //    症状是「词条」那一屏空白 + 手写块也没有（看起来像没做这个功能）。
    v.appendChild(box);
    $('#q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
    mountManual(box, 'vocab', load);
    load();
    return;
  }
  if (kbView === 'links') {
    api('/api/link-taxonomy').then((d) => {
      if (!d) return (v.innerHTML = '<div class="kbwrap"><div class="k">还没生成</div></div>');
      const cats = d.categories || [];
      const mx = Math.max(1, ...cats.map((c) => c.urlCount));
      const box = document.createElement('div');
      box.className = 'kbwrap';
      box.innerHTML = cats.map((c) =>
        '<div class="card"><div class="m">' + esc(c.cat) + ' · ' + c.urlCount + ' 条 / ' + c.domainCount + ' 域名' +
        (c.manual ? ' <span class="badge bman">手动</span>' : '') + '</div>' +
        '<span class="bar" style="width:' + Math.max(3, Math.round((c.urlCount / mx) * 190)) + 'px"></span>' +
        '<div style="margin-top:7px">' + c.items.slice(0, 18).map((it) => '<div style="padding:2px 0;font-size:12.5px"><span class="badge">' + it.n + '×</span> ' +
          (it.manual ? '<span class="badge bman">手动</span> ' : '') + esc(it.domain) + ' <span class="k">' + esc(it.what) + '</span></div>').join('') + '</div></div>').join('');
      v.innerHTML = '';
      v.appendChild(box);
      mountManual(box, 'links', null);
    });
  }
}

// ══════════════════════════════════════════════════════════
// 接入设置
// ══════════════════════════════════════════════════════════
async function openSettings() {
  const schemaRes = await api('/api/settings/schema');
  const setRes = await api('/api/settings');
  // ⭐ 设置里"功能自己那一块"要**从注册表生成**，所以这份也得取
  const featRes = await api('/api/features').catch(() => ({ groups: [] }));
  // ⚠️ 用**扁平清单**，不要从 `groups` 里找 —— 侧栏分组里没有语音/文字/结构流/Pet（见 features.ts）
  const featItems = [...(featRes.settingsModel || []), ...((featRes.groups || []).flatMap((g) => g.items || []))];
  const schema = schemaRes.schema || [];
  const connected = setRes.connected || {};
  const cur = setRes.values || {};
  // ⭐ 读者 2026-10-10：「所有跟设置相关的**全部都放到设置里，包括同步**」
  //    ⇒ 「同步」原来在顶栏，现在收到这一页最上面。
  //    ⚠️ 它不是"填凭据"，是"去各个来源拉一趟" —— 所以**放在凭据前面**，
  //      而且写清它慢、会失败、有配额，别让人以为点了立刻就完事。
  const syncCard = '<div class="sec"><h3>同步</h3>' +
    '<div class="d">去各个来源拉一趟新内容。⚠️ 慢（几十秒到几分钟）、会失败、而且有的来源有配额 ——' +
    '它跟上面那个 <b>⟳ 刷新</b> 不是一回事：刷新只是把这一屏按现在库里的东西重画一遍。</div>' +
    '<button class="go" id="dsync" style="width:100%">⇅ 现在同步</button>' +
    '<button class="go" id="dc4" style="width:100%;margin-top:8px">c4 · 搜索 / 改功能</button></div>';
  // ⭐ 读者 2026-10-10：「设置里要对于**语音的背景、文字的背景**可以更改才可以」
  //    ⚠️ 存在 localStorage（`c4emem.bg`）而不是 settings.json ——
  //      那是**这台机器的界面偏好**，不是"接哪个软件的凭据"，混进凭据那份里会让人以为要填密钥。
  const bg = bgPref();
  const lookCard = '<div class="sec"><h3>背景</h3>' +
    '<div class="d">填一个图片地址（http/https 都行），或者留空用默认。⚠️ 字和玻璃都在图片之上，' +
    '所以上面会压一层暗保证读得出来 —— 这是有意做的，不是图片没显示。</div>' +
    '<div class="fld"><label>语音那一屏</label><div class="row">' +
    '<input id="bgvoice" placeholder="留空 = 默认那张" value="' + esc(bg.voice || '') + '"></div></div>' +
    '<div class="fld"><label>文字那一屏</label><div class="row">' +
    '<input id="bgtext" placeholder="留空 = 纯色底" value="' + esc(bg.text || '') + '"></div></div>' +
    // ⚠️ 读者 2026-10-10 傍晚：「**输入了没有保存键，然后输入了 enter 也没有反应**」——
    //    原来只挂了 `onchange`（**失焦**才存），而且没有任何提示。两条一起加：
    //    一个明确的「保存」，和回车。存完说一声（不说的话"存了"和"没存"看不出区别）。
    '<div class="row" style="align-items:center">' +
    '<button class="go" id="bgsave" style="flex:none">保存</button>' +
    '<button class="ghost" id="bgreset" style="flex:none">恢复默认</button>' +
    '<span class="k" id="bgmsg" style="flex:1">改完按「保存」，或者直接按回车。</span></div></div>';
  // ⭐ 读者 2026-10-10：「在设置里有一个功能可以**一键开启桌面 cevtuopet**」
  //    ⚠️ 这一块**照实写它现在是什么**：应用窗口里的浮层，关掉窗口就没了。
  //       真"常驻桌面"要 Swift 那边另开一个置顶窗口 —— 把没做到的说成做到了，
  //       用户只会以为"开关坏了"。
  const pp = petPref();
  // ⭐⭐ Pet 点一下做什么（读者 2026-10-10：「设置里选择 cevtuopet 是语音还是点击…」
  //    后来又把"打开别的软件"细化成「**点击之后弹出来桌面正在打开了的软件，选择就可以切换，
  //    聚集在周围的感觉，再次点击收回**」）⇒ 四种模式，默认那个就是他最后要的。
  const PET_MODES = [
    { id: 'apps', nm: '弹出一圈正在运行的软件（再点收回）' },
    { id: 'voice', nm: '开始 / 结束说话' },
    { id: 'c4emem', nm: '打开 C4emem 的窗口' },
    { id: 'open', nm: '打开下面指定的那个软件' },
  ];
  const mode = pp.mode || 'apps';
  // ⭐⭐ 轮盘的三档大小（照 Launchy 的 Menu size / Thickness / App icon size 收成三档）。
  //    ⚠️ 这三档的**数值**在 `src/ui/pet.js` 的 `SIZES` 里，这里只给名字 ——
  //       两边各写一份数字的话，改一处另一处就漂了。
  const WHEEL_SIZES = [
    { id: 's', nm: '小' },
    { id: 'm', nm: '中' },
    { id: 'l', nm: '大' },
  ];
  /**
   * ⭐⭐ **从注册表生成一个功能的设置格子。**
   *    ⚠️ 判据：往 `features.ts` 里那个功能的 `settings` 加一条 ⇒ **设置里自己多一格**，
   *       这个函数一行都不用改。加不进来 = 它还是写死的。
   *    ⚠️ 动态的是**"有哪些设置"**；每个设置**做什么**仍然按 key 派发（见下面那个 change 监听）——
   *       那是副作用，本来就不该由数据描述。
   */
  const genFeatureSettings = (feat) => {
    if (!feat || !Array.isArray(feat.settings)) return '';
    const cur = feat.settings.some((c) => c.store === 'pet') ? petPref() : {};
    const out = [];
    for (const cfg of feat.settings) {
      for (const f of cfg.fields) {
        const has = Object.prototype.hasOwnProperty.call(cur, f.key);
        const v = has ? cur[f.key] : f.default;
        const attrs = ' data-fk="' + esc(f.key) + '" data-fstore="' + esc(cfg.store) + '"';
        if (f.type === 'check') {
          out.push('<div class="fld"><label>' + esc(f.label) + '</label><div class="row">' +
            '<label class="k" style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
            '<input type="checkbox"' + attrs + (v ? ' checked' : '') + ' style="width:auto"> ' +
            (f.hint || '') + '</label></div></div>');
        } else {
          out.push('<div class="fld"><label>' + esc(f.label) + '</label><div class="row">' +
            '<select class="vbtn" style="width:100%"' + attrs + '>' +
            (f.options || []).map((o) => '<option value="' + esc(o.v) + '"' +
              (String(v) === o.v ? ' selected' : '') + '>' + esc(o.t) + '</option>').join('') +
            '</select></div></div>');
        }
      }
    }
    return out.join('');
  };
  const petCard = '<div class="sec" id="secpet"><h3>桌面 CEVTUO Pet' + (pp.on ? '<span class="k" style="font-weight:400">已开启</span>' : '') + '</h3>' +
    // ⚠️⚠️ 这里**不能写 markdown 的 `**粗体**`** —— 这是 HTML，会原样显示成一串星号
    //    （2026-10-12 真机截图里 9 处星号就是它；部署页那次栽过 31 处，同一个坑）。
    // ⚠️ 也别再写「右键就是这一页」—— 右键 2026-10-10 深夜改成**运行中的软件清单**了，
    //    设置挪到了那张面板底部那颗「Pet 设置…」上。
    '<div class="d">在桌上放一个小家伙：<b>鼠标放上去</b>弹出一个<b>轮盘</b>（照 Launchy 做的）——' +
    '每个 App 占一个扇区、指针压到哪个哪个亮、中轴下面写着它的名字；' +
    '<b>敲角上那个字母直接切过去</b>，打别的字就筛选，' +
    '下面那颗药丸点一下在<b>「正在运行」和「全部应用」</b>之间换（这就是"多软件打开"）。' +
    '<b>拖着</b>挪位置，<b>Esc</b> 收起；<b>右键</b>弹的是<b>正在运行的软件清单</b>' +
    '（勾选 → 批量退出），设置在那张面板底部的「Pet 设置…」上。</div>' +
    // ⭐⭐ 这一整段**从注册表生成**（原来六格全是写死的）
    genFeatureSettings(featItems.find((x) => x.id === 'pet')) +
    '<div class="fld" id="petappfld"' + (mode === 'open' ? '' : ' hidden') + '><label>要打开哪个软件</label>' +
    '<div class="row"><input id="petapp" placeholder="选一个，或把 .app 拖进来" value="' + esc(pp.appPath || '') + '"></div>' +
    '<div id="petapplist" class="k" style="margin-top:6px">读本机应用里…</div></div>' +
    // ⚠️⚠️ 这段**原来写的是**"现在它是这个窗口里的浮层，关掉软件它也一起没了…（已经记进待办）"——
    //    那件事**早就做完了**（Swift 的 `PetPanel`：系统级置顶透明窗），留着就是**在骗用户**
    //    （"把没做到的说成做到了"的反面：把做到了的说成没做到，用户会以为开关坏了）。
    '<div class="hint">⚠️ 上面那个开关管的是<b>窗口里</b>那个小家伙（语音那一屏上的）。' +
    '<b>桌面上的那个</b>从菜单栏「桌面 CEVTUO Pet」切（⌘P），开关和位置它自己记着。' +
    '下面的形态 / 轮盘大小 / 字母角标 / 切完还留着，<b>两边共用</b>。</div></div>';
  // ⭐ 读者 2026-10-10：「**用量也放到设置里**」⇒ 它从侧栏挪进来（侧栏那边标了 navHidden）。
  const usageCard = '<div class="sec"><h3>用量</h3><div class="d">这些数字来自本机的 <code>activity</code> 表，' +
    '只有经过这个软件的调用才记得到。</div><div id="dusage" class="k">读…</div></div>';
  // ⭐ 恢复最初版本：读者要的「一键恢复」——**先问保不保留数据**，两条路分开走。
  const resetCard = '<div class="sec" id="secreset"><h3>恢复最初版本</h3>' +
    '<div class="d">把这一台机器上的设置装回出厂状态。<b>先选清楚：</b>只重置设置 —— ' +
    '凭据、装过哪些功能、关掉过哪些，全部回到出厂；<b>内容、邮件、手机缓存、流水都不动</b>。' +
    '或者连内容一起清空（不可逆）。</div>' +
    '<div class="fld"><div class="row" style="gap:8px;flex-wrap:wrap">' +
    '<button class="go" id="reskeep" style="flex:1;white-space:nowrap">恢复设置（保留数据）</button>' +
    '<button class="go" id="resall" style="flex:1;white-space:nowrap;background:#b52d2d">连数据一起清空</button>' +
    '</div></div><div class="k" id="resmsg"></div></div>';
  $('#dbody').innerHTML = syncCard + usageCard + lookCard + petCard + schema.map((s) => {
    const on = connected?.[s.id];
    // ⚠️ 给接入那几段一个**可寻址的 id**：首次启动引导要滚到第一段上（`#secpet` 那种
    //    命名会和它撞，所以这里用 `secsetup-` 前缀区分）。
    return '<div class="sec" id="secsetup-' + esc(s.id) + '"><h3><span class="dot' + (on ? ' on' : '') + '"></span>' + esc(s.title) +
      (on ? '<span class="k" style="font-weight:400">已接入</span>' : '') + '</h3>' +
      '<div class="d">' + esc(s.desc) + (s.docs ? ' <a href="' + s.docs + '" target="_blank">文档 →</a>' : '') + '</div>' +
      s.fields.map((f) => {
        const val = (cur[s.id] ?? {})[f.key] ?? '';
        return '<div class="fld"><label>' + esc(f.label) + '</label><div class="row">' +
          '<input data-sec="' + s.id + '" data-key="' + esc(f.key) + '" type="' + (f.secret ? 'password' : 'text') +
          '" value="' + esc(val) + '" placeholder="' + esc(f.placeholder || '') + '">' +
          (f.button
            ? '<button class="go" data-pick="' + esc(f.button.action) + '" data-target="' + esc(f.key) +
              '" style="flex:none;white-space:nowrap">' + esc(f.button.label) + '</button>'
            : '') +
          '</div>' + (f.hint ? '<div class="hint">' + esc(f.hint) + '</div>' : '') + '</div>';
      }).join('') + '</div>';
  }).join('') + '<button class="go" id="dsave" style="width:100%">保存</button><div class="k" id="dsaved" style="text-align:center;margin-top:7px"></div>' + resetCard;
  $('#drawer').hidden = false;
  $('#dsync').onclick = () => { try { openSync(); } catch (e) { toast(String(e?.message ?? e), 'bad'); } };
  // ⭐ 设置里也开一扇到**同一个** c4 输入框的门（不是新能力，只是多一个入口）
  try {
    const c4b = $('#dc4');
    if (c4b) c4b.onclick = () => { $('#drawer').hidden = true; const p = $('#c4pill'); if (p) p.click(); };
  } catch { /* 没有就算了 */ }
  // 恢复最初版本的两条路。⚠️ 破坏性的那条**问两次**。
  const postJson = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  $('#reskeep').onclick = async () => {
    const ok = await confirmBox('恢复最初版本',
      '凭据、功能安装状态、界面偏好会回到出厂。<br><b>你的内容、邮件、手机缓存、流水都不会动。</b><br><br>继续吗？');
    if (!ok) return;
    $('#resmsg').textContent = '恢复中…';
    const r = await postJson('/api/reset', { keepData: true }).catch((e) => ({ error: String(e) }));
    $('#resmsg').textContent = r?.error ? ('失败：' + r.error) : ('已恢复：' + ((r.cleared || []).join('、') || '没有可清的东西'));
    if (!r?.error) setTimeout(() => location.reload(), 1500);
  };
  $('#resall').onclick = async () => {
    const ok = await confirmBox('连数据一起清空',
      '⚠️ 这一步会<b>删掉全部内容</b>：知识库索引、流水、待办、会话。它<b>不可逆</b>。<br><br>确实要清空吗？');
    if (!ok) return;
    const ok2 = await confirmBox('再确认一次', '真的要删掉全部内容吗？没有回头的路。');
    if (!ok2) return;
    $('#resmsg').textContent = '清空中…';
    const r = await postJson('/api/reset', { keepData: false }).catch((e) => ({ error: String(e) }));
    $('#resmsg').textContent = r?.error ? ('失败：' + r.error) : ('已清空：' + ((r.cleared || []).join('、') || '没有可清的东西'));
    if (!r?.error) setTimeout(() => location.reload(), 1500);
  };
  // 用量：拉完了再填，别把整张设置页卡在等接口上
  api('/api/usage').then((u) => {
    const t = u.total || {};
    const kinds = (u.byKind || []).filter((k) => k.tsum).slice(0, 5)
      .map((k) => esc(k.kind) + ' ' + (k.tsum / 1000).toFixed(1) + 'k').join(' · ');
    $('#dusage').innerHTML = '累计 <b>' + (t.tsum ?? 0).toLocaleString() + '</b> tokens · ' +
      (t.n ?? 0) + ' 次调用 · 输入 ' + (t.tin ?? 0).toLocaleString() + ' / 输出 ' + (t.tout ?? 0).toLocaleString() +
      (kinds ? '<br>' + kinds : '') +
      '<br><button class="ghost sm" id="dusageMore" style="margin-top:6px">看详细</button>';
    $('#dusageMore').onclick = () => { $('#drawer').hidden = true; show('usage'); };
  }).catch(() => { const e = $('#dusage'); if (e) e.textContent = '读不到用量'; });

  // ⭐ 三条件一起：输入框失焦存（原来那样）、按回车存、按「保存」存。
  //   ⚠️ `applyBg` 是**写到 CSS 变量 + localStorage**，没有异步 —— 所以这里
  //      保存后就地更新提示，**不重画整个设置**（重画会把光标和滚动位置弄丢）。
  const bgSave = () => {
    const v = $('#bgvoice').value.trim();
    const t = $('#bgtext').value.trim();
    applyBg({ voice: v, text: t });
    const msg = $('#bgmsg');
    if (msg) msg.textContent = '已保存（' + new Date().toLocaleTimeString().slice(0, 8) + '）· 现在就能看到';
    toast('背景记下了', 'good');
  };
  $('#bgvoice').onchange = bgSave;
  $('#bgtext').onchange = bgSave;
  for (const id of ['#bgvoice', '#bgtext']) {
    $(id).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); bgSave(); } };
  }
  $('#bgsave').onclick = bgSave;
  $('#bgreset').onclick = () => {
    localStorage.removeItem('c4emem.bg');
    applyBg({}, true);
    $('#bgvoice').value = ''; $('#bgtext').value = '';
    toast('背景回到默认了');
  };
  // ⭐⭐ 注册表生成的设置项走**同一条**通路：存值 → 按 key 派发副作用。
  //    ⚠️ 动态的是"有哪些设置"；"每个设置做什么"仍然按 key 写（副作用本来就描述不了）。
  //    ⚠️ 用 `change` 委托挂在 document 上：设置抽屉是整块重画的，直接绑 id 会随重画丢掉。
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || !el.dataset || !el.dataset.fk) return;
    if (el.dataset.fstore !== 'pet') return;
    const key = el.dataset.fk;
    const val = el.type === 'checkbox' ? el.checked : el.value;
    petSave({ [key]: val });
    if (key === 'on') petOn(!!val);
    else if (key === 'form') { renderPet(); toast('换了个样子'); }
    else if (key === 'letters') { petPaintLetters(); toast('记下了'); }
    else if (key === 'size') toast('轮盘大小记下了');
    else if (key === 'keepOpen') toast('记下了');
    else if (key === 'mode') {
      const f = $('#petappfld'); if (f) f.hidden = val !== 'open';
      if (val === 'open' && $('#petapplist') && !$('#petapplist').dataset.done) loadPetApps();
      petCloseRing();
    }
  });
  // 应用选择器还是特例：它要现读本机应用清单，没法用一两行数据描述
  $('#petapp').onchange = (e) => petSave({ appPath: e.target.value.trim() });
  // ⚠️ 应用清单要**等选到「打开指定软件」才读** —— 每次开设置都扫一遍是白费（要 100ms+）
  if (mode === 'open') loadPetApps();

  // 「选择文件夹…」：**只把选到的路径填进框，不直接存** —— 用户还得点「保存」。
  // 选目录和决定用它分成两步，误点一下不会把存储位置搬走。
  $$('#dbody button[data-pick]').forEach((b) => {
    b.onclick = async () => {
      const t0 = b.textContent;
      b.disabled = true;
      b.textContent = '选…';
      const r = await post(b.dataset.pick, {});
      b.disabled = false;
      b.textContent = t0;
      if (r && r.ok && r.dir) {
        const inp = $('#dbody input[data-key="' + b.dataset.target + '"]');
        if (inp) inp.value = r.dir;
      } else {
        $('#dsaved').textContent = (r && r.error) || '没选';
      }
    };
  });

  $('#dsave').onclick = async () => {
    const patch = {};
    $$('#dbody input[data-sec]').forEach((i) => { (patch[i.dataset.sec] ??= {})[i.dataset.key] = i.value.trim(); });
    const r = await post('/api/settings', patch);
    $('#dsaved').textContent = r.ok ? '✅ 已保存并立即生效' : '出错：' + r.error;
    setTimeout(openSettings, 700);
  };
}
// ⚠️ 「接入」原来是 `onclick = openSettings` 直接换 innerHTML —— 两次 fetch 慢的时候
//    看起来就是"点了没反应"（读者同一条反馈里的前半句）。先说话，再打开。
$('#gear').onclick = async () => {
  const b = $('#gear');
  if (b.disabled) return;
  b.disabled = true;
  const t0 = b.textContent;
  b.textContent = '打开中…';
  toast('正在读接入配置…');
  try { await openSettings(); } finally { b.disabled = false; b.textContent = t0; }
};
$('#dclose').onclick = () => ($('#drawer').hidden = true);

// ══════════════════════════════════════════════════════════
// 同步 —— 做了没、做到哪一步、取到几条，都要看得见
// ══════════════════════════════════════════════════════════
/**
 * ⚠️ 这里原来只有一行：
 *      `$('#syncBtn').onclick = async () => { await post('/api/sync', {}); refreshDash(); };`
 *    三件事叠在一起，读者那头看到的就是「点击同步没有反馈」：
 *      ① `/api/sync` 是 `spawn(..., { detached: true })` —— 起个后台进程**立刻**返回，
 *         界面**永远不可能知道**它做完没有。不是慢，是没有这条路。
 *      ② 连"开始了"都不说：没有 spinner、没有 toast、按钮也不变。
 *      ③ 失败了只落一条记录进记录栏，弹窗里什么都没有。
 *    ⇒ 现在分两条路：
 *      · **单个来源**走 `/api/sources/sync` —— 那是个**同步**接口，真的返回「取到几条 / 写入几段」；
 *      · **全部**天生是后台任务，就按 activity 的 **id 轮询**，做到哪一步看得见，也有超时。
 */
let syncPolling = null;
function stopSyncPoll() { if (syncPolling) { clearInterval(syncPolling); syncPolling = null; } }

async function openSync() {
  const box = $('#syncmodal');
  if (!box) return;
  box.hidden = false;
  const body = $('#syncbody');
  body.innerHTML = '<div class="k">读来源状态…</div>';
  const d = await api('/api/sources').catch((e) => ({ error: String(e && e.message ? e.message : e) }));
  if (d.error) { body.innerHTML = '<div class="card k">读不到来源列表：' + esc(d.error) + '</div>'; return; }

  const items = d.items || [];
  body.innerHTML =
    '<div class="card"><div class="m">来源</div>' +
    (items.length
      ? items.map((s) => {
          const st = s.ok ? '<span class="sok">能同步</span>'
            : '<span class="sno">还差点东西</span><div class="k">' + esc(s.why || '') + '</div>';
          return '<div class="syncrow">' +
            '<div class="si">' + (s.icon || '·') + '</div>' +
            '<div class="sc"><b>' + esc(s.label) + '</b>' + st + '</div>' +
            '<button class="go sm" data-sync="' + esc(s.id) + '"' + (s.ok ? '' : ' disabled') + '>同步</button>' +
            '<div class="sr k" data-res="' + esc(s.id) + '"></div></div>';
        }).join('')
      : '<div class="k">没有可同步的来源。</div>') +
    (items.some((s) => !s.ok) ? '<div class="k" style="margin-top:8px">⚠️ 标着「还差点东西」的，去「接入」里把凭据填上再来。</div>' : '') +
    '</div>' +
    '<div class="card"><div class="m">同步记录</div><div id="syncLast" class="k">读取中…</div></div>';

  // 单个来源：接口是**同步的**，可以老实等它，并把结果写回那一行
  $$('#syncbody button[data-sync]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.sync;
      const res = $('#syncbody [data-res="' + id + '"]');
      b.disabled = true; b.textContent = '同步中…';
      if (res) res.textContent = '正在取数 → 切块 → 算嵌入…（第一次会慢）';
      const r = await post('/api/sources/sync', { id });
      b.disabled = false; b.textContent = '同步';
      if (r && r.ok) {
        if (res) res.textContent = '✅ 取到 ' + r.fetched + ' 条，写入 ' + r.indexed + ' 段\n' + (r.log || '');
        toast('已同步 ' + r.fetched + ' 条', 'good');
      } else {
        if (res) res.textContent = '⚠️ ' + ((r && r.error) || '失败');
        toast('同步失败：' + ((r && r.error) || '未知原因'), 'bad');
      }
      refreshDash(); loadSyncLast();
    };
  });
  loadSyncLast();
}

async function loadSyncLast() {
  const el = $('#syncLast');
  if (!el) return;
  const a = await api('/api/activity?kind=sync&limit=8').catch(() => ({ items: [] }));
  const xs = (a.items || []).slice(0, 6);
  el.innerHTML = xs.length
    ? xs.map((x) => '<div class="syncrow"><div class="si">' + x.icon + '</div><div class="sc"><b>' + esc(x.title) + '</b>' +
        '<div class="k">' + esc(String(x.ts || '').slice(5, 16).replace('T', ' ')) +
        (x.ms ? ' · ' + Math.round(x.ms / 1000) + 's' : '') +
        (x.detail ? ' · ' + esc(x.detail) : '') + '</div></div></div>').join('')
    : '<div class="k">还没有同步记录。</div>';
}

/** 「全部」：服务端是后台任务 ⇒ 只能轮询 activity 的 **id** 才知道它做完没有。 */
async function syncAll() {
  const btn = $('#syncAll');
  const el = $('#syncLast');
  const t0 = await api('/api/activity?kind=sync&limit=1').then((a) => a.items?.[0]?.id ?? 0).catch(() => 0);
  btn.disabled = true;
  btn.textContent = '同步中…（后台跑，这个窗可以关）';
  const started = await post('/api/sync', {});
  if (!started || !started.started) {
    btn.disabled = false; btn.textContent = '全部同步（Notion 四库 + 来源）';
    toast('没能开始同步：' + ((started && started.error) || '未知原因'), 'bad');
    return;
  }
  toast('同步已在后台开始 —— 做完这里会出现一条记录', 'good');
  if (el) el.innerHTML = '<div class="k">⏳ 后台正在跑…（Notion 四库逐页取，几分钟很正常）</div>';
  stopSyncPoll();
  const waitFrom = Date.now();
  syncPolling = setInterval(async () => {
    const a = await api('/api/activity?kind=sync&limit=6').catch(() => null);
    const fresh = a ? (a.items || []).filter((x) => (x.id ?? 0) > t0) : [];
    if (fresh.length) {
      stopSyncPoll();
      btn.disabled = false; btn.textContent = '全部同步（Notion 四库 + 来源）';
      toast('同步完成：' + fresh.length + ' 项', 'good');
      loadSyncLast(); refreshDash();
      return;
    }
    // ⚠️ 等条件，但也要有上限 —— 不然它会一直转，而"还在跑"和"根本没起来"长得一样
    if (Date.now() - waitFrom > 8 * 60 * 1000) {
      stopSyncPoll();
      btn.disabled = false; btn.textContent = '全部同步（Notion 四库 + 来源）';
      if (el) el.innerHTML = '<div class="k">⚠️ 8 分钟了还没看到记录。可能后台进程没起来 —— ' +
        '在终端里跑一次 <code>bun run src/cli.ts sync</code> 看它报什么。</div>';
      toast('等超时了，没看到同步记录', 'bad');
    }
  }, 3000);
}

/**
 * 刷新（读者 2026-10-10：「各个地方没有刷新的键」）。
 *
 * ⚠️⚠️ 它和「同步」**必须是两个键**：
 *    · **刷新** = 按现在库里的东西把这一屏重画一遍。快、不会失败、不联网。
 *    · **同步** = 去各个来源拉新内容。慢（几十秒）、会失败、有配额、还会花钱。
 *    把两件事塞进一个按钮，用户点"刷新"结果触发一次全量同步 ——
 *    那是最容易被骂的设计，而且**看起来只是"有点慢"**。
 */
async function refreshAll(quiet) {
  try {
    await Promise.all([refreshDash(), renderNav(), loadSpaceCount()]);
    if (kbView) renderKb();
    // 结构流那边自己会重画（画布是本地那份），不用在这里拉
    if (!quiet) toast('已刷新');
  } catch (e) {
    toast('刷新失败：' + (e?.message ?? e), 'bad');
  }
}
$('#refreshBtn').onclick = () => refreshAll();
// ⚠️⚠️ 这里**必须判空**：`#syncBtn` 已经从顶栏搬进设置里了（读者 2026-10-10）。
//    直接 `$('#syncBtn').onclick = …` 会在**加载期**抛
//    「Cannot set properties of null」—— 而那是**整个 app.js 一行都不执行**，
//    页面看起来只是"空白"，不像报错。（这个形状在本项目栽过至少一次。）
$('#syncBtn')?.addEventListener('click', openSync);
if ($('#syncClose')) $('#syncClose').onclick = () => { stopSyncPoll(); $('#syncmodal').hidden = true; };
if ($('#syncAll')) $('#syncAll').onclick = syncAll;

// ══════════════════════════════════════════════════════════
// 键盘
// ══════════════════════════════════════════════════════════
addEventListener('keydown', (e) => {
  const ae = document.activeElement;

  // ⚠️ 模式键**全局生效**。之前加了 `&& !typing` ⇒ 切到文字模式后自动聚焦输入框 ⇒ 再也切不回去。
  if (e.key === '~' || e.key === '`') { e.preventDefault(); return cycle(); }
  if (e.key === 'Escape') {
    if (wiring()) { dropWire(); renderFlow(); return; }   // 先放下举着的线，再管别的
    $('.kpick')?.remove();
    if ($('#shelfhelp') && !$('#shelfhelp').hidden) { $('#shelfhelp').hidden = true; return; }
    if ($('#syncmodal') && !$('#syncmodal').hidden) { stopSyncPoll(); $('#syncmodal').hidden = true; return; }
    if ($('#drawer')) $('#drawer').hidden = true;
    return;
  }

  const inInput = ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA');
  if (inInput || kbView || mode !== 'flow') return;
  // ⚠️ 正在块里打字时回车**不能**当运行 —— 那是输入的一部分
  if (ae && ae.isContentEditable) return;
  // ⭐ 读者要的「**Enter 开跑**」：没举着线、也没在编辑，回车就是运行
  if (e.key === 'Enter' && !wiring()) { e.preventDefault(); return runFlow(); }

  const editingTxt = ae?.classList?.contains('txt');
  if (editingTxt) {
    const empty = !ae.textContent.trim();
    const s = window.getSelection();
    const atStart = !s || s.anchorOffset === 0;
    if (e.key === '/' && (empty || atStart)) { e.preventDefault(); return openPicker(ae.closest('.blk')); }
    if (e.key === '+' && empty) { e.preventDefault(); return addBlock(lastKind); }
    return;
  }
  if (e.key === '+') { e.preventDefault(); addBlock(lastKind); }
  else if (e.key === '/' && sel) { e.preventDefault(); openPicker($('.blk.sel')); }
  // ── 方向键：不拖也能连线和分叉 ────────────────────────────
  //    ⚠️ 这三种修饰键的分工要一致，别在别处再定义一套：
  //      ⇧ = 新建一块并连上（分叉）    ⌥ = 只连线不新建    ⌘ = 连条件线
  else if (e.key.startsWith('Arrow') && sel) {
    const dir = e.key.slice(5).toLowerCase();
    e.preventDefault();
    if (e.metaKey) arrowAction(dir, 'meta');
    else if (e.altKey) arrowAction(dir, 'alt');
    else if (e.shiftKey) arrowAction(dir, 'shift');
    else {
      const me = flow.find((b) => b.id === sel);
      const t = me && nearestIn(dir, me);
      if (t) { sel = t.id; glow(sel); }
    }
  }
  else if (e.key === 'Tab' && sel) {
    e.preventDefault();
    const i = flow.findIndex((b) => b.id === sel);
    const n = flow[(i + (e.shiftKey ? -1 : 1) + flow.length) % flow.length];
    if (n) { sel = n.id; glow(sel); }
  }
  else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runFlow(); }
  else if (e.key === 'Enter' && sel) { e.preventDefault(); focusText(sel); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
    e.preventDefault();
    flow = flow.filter((x) => x.id !== sel);
    wires = wires.filter((w) => w.from !== sel && w.to !== sel);   // ⚠️ 连着的线也要一起清，否则留下两条指向空气的线
    sel = flow.length ? flow[flow.length - 1].id : null;
    saveFlow(); saveWires(); renderFlow();
  }
});

// ══════════════════════════════════════════════════════════
$('#mic').onclick = toggleMic;
$('#muteBtn').onclick = () => { muted = !muted; $('#muteBtn').innerHTML = muted ? icon('speaker', 'off') : icon('speaker'); if (muted) speechSynthesis?.cancel(); };
$('#vorb').onchange = (e) => setOrbVariant(e.target.value);
$('#vinput').onkeydown = (e) => {
  if (e.key !== 'Enter') return;
  const v = e.target.value.trim();
  if (!v) return;
  e.target.value = '';
  ask(v, 'voice');
};
// ⚠️ 这段文案以前是"没有识别，先打字吧" —— 现在装了本地 whisper，
//    要说清两件事：**能用**，而且**音频不出本机**。
sttReady();   // 预热：把那次往返挪到用户点麦克风之前
// ⚠️ 用 innerHTML 而不是 textContent —— 里面要放 SVG 图标，
//    textContent 会把 `<svg …>` 原样显示出来（这个坑今天已经踩过一次）。
api('/api/stt/status').then((s) => {
  $('#vhint').innerHTML = s.ready
    ? '本地识别，音频不出本机 · 点 ' + icon('mic') + ' 开始说，再点一下结束并转文字'
    : icon('warn') + ' 本地语音识别还没装好（~/.c4emem/stt/）—— 先直接打字';
}).catch(() => { $('#vhint').textContent = '打字也行，回车发送'; });

mountIcons();
renderShelf();
startShelfHint();
renderSources();
bindFan();
bindCollapse();
bindNarrow();
// 左上角那颗点 = **本地服务在不在跑**（它原来是个没有任何含义的柠檬绿装饰）。
async function pingBrand() {
  const d = $('.brand .dot');
  if (!d) return;
  try {
    const r = await api('/api/stats');
    const ok = r && r.docs != null;
    d.classList.toggle('live', !!ok);
    d.classList.toggle('dead', !ok);
    d.title = ok ? '本地服务：在跑' : '本地服务：应答不对';
  } catch {
    d.classList.add('dead');
    d.title = '本地服务：连不上（没在跑？）';
  }
}
pingBrand();
// 端口颜色 = 类型。⚠️ 从 TYPES 那张**唯一的表**渲染，绝不在这儿手抄一遍 —— 手抄必然漂。
if ($('#plegend')) {
  $('#plegend').innerHTML =
    Object.values(TYPES).map((t) => '<b><i style="--c:' + t.c + '"></i>' + esc(t.nm) + '</b>').join('') +
    '<span style="opacity:.7">颜色 = 端口类型 · 两边对得上才连得上</span>';
}
// 弹窗里那个勾要跟设置里的一致，不然"我明明勾过了"和"它没记住"会长得一样
api('/api/web/status').then((w) => { if ($('#mAuto')) $('#mAuto').checked = !!w.auto; }).catch(() => {});
show('voice');
refreshDash();
applyBg({});
petInit();
initVlogGrip();
// ⚠️ 窗口一变，"上面那块空地"的高度就变了 —— 不重算的话光球会重新压到记录框上。
//    用 rAF 合并：resize 一秒能来几十次，每次都量会抖。
let _orbRaf = 0;
addEventListener('resize', () => {
  cancelAnimationFrame(_orbRaf);
  _orbRaf = requestAnimationFrame(orbRecenter);
});
// ⭐ 侧栏由**功能注册表**生成（见 renderNav）。必须排在 loadSpaceCount 前面 ——
//    loadSpaceCount 完会调 paintNavAvailability，而那是按 `.nv[data-v]` 找元素的。
renderNav();
// 每个库有多少条 —— 「按来源放行功能」靠它。(fetch 完自己会重画一遍侧栏)
loadSpaceCount();
// 画布那份「存到文件夹」的：先用本地那份起来，网络回来再对齐 —— 见 hydrateFlow 的注释。
// ⚠️ 故意**不 await**：等它会把首屏卡住，而画布正是这个模式的全部内容。
hydrateFlow();
// ⭐⭐ 首次启动引导：第一次打开时，主动把人领到「接入」那一段。
//   ⚠️ 整段包在 try 里 —— 引导失败**不该拦住整个界面**（那会把"没引导"变成"用不了"）。
(async () => {
  try {
    const r = await api('/api/onboarding');
    if (!r?.first) return;
    await openSettings();
    const first = document.querySelector('#dbody .sec[id^="secsetup-"]');
    if (first) {
      first.scrollIntoView({ block: 'start' });
      first.classList.add('flash');
      setTimeout(() => first.classList.remove('flash'), 1600);
    }
    toast('第一次运行：先把来源接上。接错了随时能在设置里改。', 'good');
    post('/api/onboarding/done', {}).catch(() => {});
  } catch { /* 静默：引导不是关键路径 */ }
})();

// ⭐ 对话改功能的两个键。⚠️ 用**事件委托** —— 自我改进那一屏是整块 `innerHTML` 重画的，
//    直接 `$('#sicmdgo').onclick = …` 会随重画一起丢掉（点了没反应，而且看不出为什么）。
(() => {
  const OP_CN = { off: '关闭', on: '重新打开', install: '安装', remove: '卸载', proactive_on: '标成主动式', proactive_off: '取消主动式', none: '不改配置' };
  let pending = null;
  const out = (h) => { const el = document.getElementById('sicmdout'); if (el) el.innerHTML = h; };
  const btn = () => document.getElementById('sicmdapply');
  document.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.id !== 'sicmdgo' && t.id !== 'sicmdapply') return;
    const box = document.getElementById('sicmd');
    const say = (box?.value || '').trim();
    if (t.id === 'sicmdapply') {
      if (!pending) return;
      out('执行中…');
      const r = await post('/api/features/command', { say: pending.say, apply: true }).catch((err) => ({ error: String(err) }));
      if (r?.error) { out('⚠️ ' + esc(r.error)); toast('没做成：' + r.error, 'bad'); return; }
      // ⚠️⚠️ 回执**必须同时走浮层**：下面那句 `refreshAll()` 会把这一屏整块重画，
      //    而这行字就住在被重画的那块里 ⇒ 用户看到的是**空白**
      //    （"做完了但看不到回执"，正是本项目最忌的那种）。浮层不随重画消失。
      const line = r.applied
        ? '已' + (OP_CN[r.op] || r.op) + '：' + (r.name || r.id)
        : '没落成：' + (r.note || r.error || '这条操作没生效');
      out((r.applied ? '✅ ' : '⚠️ ') + esc(line) + (r.applied ? '（记了一笔流水）' : ''));
      pending = null; if (btn()) btn().disabled = true;
      // ⚠️⚠️ 顺序要紧：**先刷新、后报**。反过来试过 —— `refreshAll()` 自己会弹一句「已刷新」，
      //    而提示条是**同一个元素** ⇒ 我那句回执只活了 1.4 秒就被盖掉，
      //    用户看到的最后一句是「已刷新」，等于**没告诉他到底做成没做成**。
      setTimeout(async () => {
        try { await refreshAll(); } catch { /* 刷新失败无所谓 */ }
        toast(line, r.applied ? 'good' : 'bad');
      }, 500);
      return;
    }
    if (!say) { out('先说一句要改什么。'); return; }
    out('解析中…');
    const r = await post('/api/features/command', { say }).catch((err) => ({ error: String(err) }));
    if (r?.error) { out('⚠️ ' + esc(r.error)); return; }
    if (!r || r.op === 'none') {
      out('这句话我没对上一条现成的操作。想让它<b>长一个新功能</b>的话，上面那个「给选中的软件想功能」才是那条路。');
      pending = null; if (btn()) btn().disabled = true; return;
    }
    pending = { say };
    out('它理解成：<b>' + esc(OP_CN[r.op] || r.op) + ' —— ' + esc(r.name || r.id) + '</b>' +
      (r.why ? '<br><span class="k">' + esc(r.why) + '</span>' : '') +
      '<br>确认是要这件事，就点「执行这条」。');
    if (btn()) btn().disabled = false;
  });
})();

/* ⭐⭐ 全局 c4：一颗药丸 + 一个输入框（读者 2026-10-10：「有一个 c4 以及一个按钮，能够打开一个
   输入框，可以**自我改进也可以搜索**」）。
   ⚠️ 它**不是"又一个入口"** —— 读者当初就担心这个（语音/文字/结构流既有灯又在侧栏过一次）。
      这里两条路都**复用现成的实现**：改功能走 `/api/features/command`（和"对话改功能"同一个），
      搜索走原来那一屏（同一份检索）。这个框只负责"把一句话分派到该去的地方"。
   ⚠️ 判据：**先问它是不是一条改功能的指令**，不是才当搜索。反过来（先搜后改）会：
      想把"把推荐关掉"当搜索跑 —— 搜出 0 条，然后用户以为这句话没被听懂。
*/
(() => {
  const m = document.getElementById('c4modal');
  const inp = document.getElementById('c4input');
  const out = document.getElementById('c4out');
  if (!m || !inp || !out) return;
  const OP_CN = { off: '关闭', on: '重新打开', install: '安装', remove: '卸载', proactive_on: '标成主动式', proactive_off: '取消主动式' };
  let pending = null;
  const show1 = () => { m.hidden = false; inp.value = ''; out.innerHTML = ''; pending = null; setTimeout(() => inp.focus(), 30); };
  const hide1 = () => { m.hidden = true; };
  document.getElementById('c4pill').onclick = show1;
  document.getElementById('c4close').onclick = hide1;
  m.onclick = (e) => { if (e.target === m) hide1(); };

  addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') { e.preventDefault(); m.hidden ? show1() : hide1(); return; }
    if (e.key === 'Escape' && !m.hidden) { e.preventDefault(); hide1(); }
  }, true);

  const runSearch = async (q) => {
    hide1();
    try { show('search'); } catch { /* 没有这一屏就算了 */ }
    await new Promise((r) => setTimeout(r, 750));
    const box = document.querySelector('#m-kb input');
    if (!box) { toast('没找到搜索那一屏', 'bad'); return; }
    box.focus(); box.value = q;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };

  const go = async () => {
    const say = inp.value.trim();
    if (!say) return;
    out.innerHTML = '<span class="k">看一下这句话是要干嘛…</span>';
    const c = await post('/api/features/command', { say }).catch(() => null);
    if (c && c.op && c.op !== 'none') {
      pending = { say };
      out.innerHTML = '它理解成要改功能：<b>' + esc(OP_CN[c.op] || c.op) + ' —— ' + esc(c.name || c.id) + '</b>' +
        (c.why ? '<br><span class="k">' + esc(c.why) + '</span>' : '') +
        '<div class="row"><button class="go" id="c4apply">执行这条</button>' +
        '<button class="go" id="c4assearch">不对，当搜索跑</button></div>';
      return;
    }
    await runSearch(say);
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  out.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.id === 'c4assearch') { await runSearch(inp.value.trim()); return; }
    if (t.id !== 'c4apply' || !pending) return;
    out.innerHTML = '<span class="k">执行中…</span>';
    const r = await post('/api/features/command', { say: pending.say, apply: true }).catch((err) => ({ error: String(err) }));
    const line = r?.error ? ('没做成：' + r.error)
      : r?.applied ? ('已' + (OP_CN[r.op] || r.op) + '：' + (r.name || r.id))
      : ('没落成：' + (r?.note || '这条操作没生效'));
    hide1();
    pending = null;
    // ⚠️⚠️ **先刷新、后报**。反过来试过：`refreshAll()` 自己会弹一句「已刷新」，
    //    而提示条是同一个元素 ⇒ 我那句回执只活几百毫秒就被盖掉，
    //    用户最后看到的是「已刷新」—— **等于没告诉他到底做成没做成**。
    //    （同一个坑在「对话改功能」那张卡片上已经踩过一次了。）
    setTimeout(async () => {
      try { await refreshAll(); } catch { /* 无所谓 */ }
      toast(line, r?.applied ? 'good' : 'bad');
    }, 350);
  });
})();

window.__app = {
  show, cycle, addBlock, shelfAdd, hydrateFlow, pushFlow, refresh: refreshAll, askFlow,
  // ⭐ 原生桥会调它（`{cmd:'settings'}`）—— 桌面 Pet 右键 = 打开这一整套设置
  openPetSettings,
  get flowRun() { return frRun; },
  get mode() { return mode; }, get flow() { return flow; },
  get wires() { return wires; },
  get shelf() { return shelf; }, get kbView() { return kbView; },
  get flowReady() { return flowReady; },
};


// ── watchdog 看门狗（2026-10-13 临时加的，用来抓"整片变白"）────────
// ⚠️ 每 2 秒报一次：**现在有哪些元素几乎铺满视口**、body 底色是什么、路由在哪。
//    白屏那种故障看代码看不出来，只能让它自己说。
const wlog = (m) => { try { fetch('/api/client-log?m=' + encodeURIComponent('watch: ' + m)); } catch { /* 连不上就算了 */ } };
setInterval(() => {
  try {
    const vw = innerWidth, vh = innerHeight;
    const covers = [];
    document.querySelectorAll('body *').forEach((e) => {
      const cs = getComputedStyle(e);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return;
      const r = e.getBoundingClientRect();
      if (r.width >= vw * 0.9 && r.height >= vh * 0.9) {
        covers.push((e.id || (typeof e.className === 'string' ? e.className : e.tagName)) + '[' + cs.backgroundColor + ' op' + cs.opacity + ' z' + cs.zIndex + ']');
      }
    });
    const sprite = !!document.getElementById('c4-icons');
    const uses = document.querySelectorAll('use').length;
    const icons = document.querySelectorAll('svg.ic').length;
    // ⚠️ 这几项是读者 2026-10-13 给的线索：**同一个页面，浏览器里图标都在、App 里没有**。
    //    sprite 在不在、`<use>` 有几个、画出来的图标有几个 —— 一眼就能定位断在哪一环。
    wlog('vw=' + vw + 'x' + vh + ' sprite=' + sprite + ' uses=' + uses + ' svgIc=' + icons +
         ' htmlLen=' + document.body.innerHTML.length +
         ' text=' + document.body.innerText.trim().length + ' hash=' + (location.hash || '-') +
         ' bodyBg=' + getComputedStyle(document.body).backgroundColor +
         ' covers=' + (covers.length ? covers.slice(0, 5).join(' ; ') : '—'));
  } catch (e) { wlog('ERR ' + e.message); }
}, 30000);   // ⚠️ 原来是 2 秒一次 —— 排查完就降到 30 秒，别把 client.log 刷满
             //    （rAF 探针不受影响：它只在**真的停了**的时候才写一行）


// ── 一次性：把前几个图标的**真实几何**报出来（2026-10-13 查"App 里没图标"）──
//    读者线索：同一个页面，浏览器里图标都在、App 里没有。DOM 里有 216 个，
//    所以只能量"它到底占没占地方、描边算出来是什么"。
setTimeout(() => {
  try {
    const out = [];
    document.querySelectorAll('svg.ic').forEach((el, i) => {
      if (i > 4) return;
      const r = el.getBoundingClientRect();
      const u = el.querySelector('use');
      let bb = 'n/a';
      try { const b = u.getBBox(); bb = Math.round(b.width) + 'x' + Math.round(b.height); } catch (e) { bb = 'ERR'; }
      const cs = getComputedStyle(el);
      out.push('#' + i + ' rect=' + Math.round(r.width) + 'x' + Math.round(r.height) +
               ' useBBox=' + bb + ' color=' + cs.color + ' w=' + cs.width + ' fs=' + cs.fontSize);
    });
    fetch('/api/client-log?m=' + encodeURIComponent('icons: ' + out.join(' | ')));
  } catch (e) { fetch('/api/client-log?m=' + encodeURIComponent('icons ERR ' + e.message)); }
}, 4000);

// ── rAF 探针：合成器停了就自己重载（2026-10-13）────────────────────
// ⚠️⚠️ 读者报的"整片变白"查下来是**页面活着、但画不出来**：
//    看门狗（每 2 秒一次 `setInterval`）全程正常、DOM 完整、没有任何元素盖住视口，
//    可窗口就是白的 —— 说明 **JS 在跑、合成/绘制停了**（WebKit 的 GPU 侧出问题）。
//    ⚠️ 这种情况下**没有任何 App 层回调会响**（WebContent 进程好好的），
//      所以 App 那边无从知道，用户看到的就是"永远白着"。
//
//    ⇒ 用 `requestAnimationFrame` 当探针：**合成停的时候它就不回调了**
//      （rAF 是由显示刷新驱动的）。超过 3 秒没回调、而且文档是可见的 ⇒ 自己 reload。
//      ⚠️ 必须用 `document.visibilityState` 挡一下：窗口被遮住/最小化时 rAF 本来就不跑，
//         那不是故障，重载只会白白闪一下。
(function rafWatchdog() {
  let last = Date.now();
  const tick = () => { last = Date.now(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  setInterval(() => {
    if (document.visibilityState !== 'visible') { last = Date.now(); return; }
    const gap = Date.now() - last;
    if (gap > 3000) {
      try { fetch('/api/client-log?m=' + encodeURIComponent('rAF 停了 ' + gap + 'ms ⇒ 自动重载')); } catch { /* 连不上就算了 */ }
      location.reload();
    }
  }, 1500);
})();
