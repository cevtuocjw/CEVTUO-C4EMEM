/**
 * Pet 有哪几种「形态」—— **只有这一份**。
 *
 * ⚠️⚠️ 为什么必须抽出来：pet.js（桌面上那个窗口）和 petsettings.html（设置页）**都要它**。
 *    各写一份的症状是"漂移" —— 而漂移在这个场景里的表现是
 *    **「设置里能选，选了之后 Pet 变空白」**（那个形态的 id 在另一份名单里没有，
 *    渲染那一支就落到 `else` 上），而且**一个错都不报**。
 *
 * ⚠️ `kind` 决定怎么画，四种：
 *    · `card`   —— 多层卡（`card.png` 叠出来的，见 pet.js 的 buildCard）
 *    · `orb`    —— 有大动图（`/ui/assets/mineral-<id>-mini.webp`，已经抠好白底）
 *    · `slab`   —— 一张静态图，**叠 16 层**假装有厚度（转起来还是有"纸"感）
 *    · `3d`     —— ⭐ **真 3D**：那张图 + 一张深度图（Depth Anything V2 算的），
 *                  在 three.js 里做成位移网格。见 `src/ui/pet3d.js`（唯一一份）。
 *                  读者 2026-10-14：「把 2D 的转化为 3D 的，**不是仅仅加厚**」。
 *      ⚠️ 用户自己造的走 `3d`（有深度图时）或 `slab`（没有时）。
 *         **两种都要能选** —— 没有深度图不是错误，是"这一只还没做成 3D"。
 */
export const PET_FORMS = [
  { id: 'card',   nm: 'CEVTUO 卡片', kind: 'card' },
  { id: 'pearl',  nm: '珍珠',        kind: 'orb', video: '/ui/assets/pearl-orb.mp4' },
  /* ⭐⭐ 这三种**在桌面上本来是静态图**（`*-mini.webp`）—— 于是**没有任何东西可转**
     ⇒ 读者把「不转」开关打开又关掉，画面**一模一样**，那个开关看起来就是坏的。
     （2026-10-14 实测：他的 pref 正是 `{"form":"silver","spin":false}`。）
     ⇒ 现在它们带一张**预先算好的深度图**（`scripts/make-pet-depths.mjs` 生成，
        每张 20 来 KB，进 git），走和用户自造那几只**同一条 3D 流水线**。
     ⚠️ 为什么预置而不是现算：现算要 4 秒 + 19MB 模型 ⇒ 每开一次 Pet 都卡一下。
     ⚠️⚠️ **这三张 `*-mini.webp` 是动图 WebP**（1~2.5MB，无限循环，`ANIM` 头实测）。
        ⇒ 它们**根本停不下来**：CSS `animation:none` 对动图无效（和 `<video>` 同一个坑，
          只是更隐蔽 —— 看上去就是一张"图"）。
        这正是读者 2026-10-14 那句「转不转还是没处理好」的真身。
        ⇒ 走 3D 这条路的另一个好处是顺带修掉它：three 的贴图只上传**一帧**。 */
  { id: 'silver', nm: '银',          kind: 'orb', video: '/ui/assets/mineral-silver-loop.mp4', keyed: 1,
    img: '/ui/assets/mineral-silver-mini.webp', depth: '/ui/assets/mineral-silver.depth.png' },
  { id: 'lead',   nm: '铅',          kind: 'orb', video: '/ui/assets/mineral-lead-loop.mp4',   keyed: 1,
    img: '/ui/assets/mineral-lead-mini.webp',   depth: '/ui/assets/mineral-lead.depth.png' },
  { id: 'zinc',   nm: '锌',          kind: 'orb', video: '/ui/assets/mineral-zinc-loop.mp4',   keyed: 1,
    img: '/ui/assets/mineral-zinc-mini.webp',   depth: '/ui/assets/mineral-zinc.depth.png' },
  // ⚠️ 这里**故意没有**"银玫瑰"。
  //    读者 2026-10-13 给的那张图是「**我们一起要造的另一只**的外观」——
  //    内置一只同名的会变成列表里**两个都叫银玫瑰**（一个我给的、一个你造的），
  //    而"哪个是哪个"在界面上分不出来。
  //    ⇒ 那一只只能**通过「一起造一只新的」造出来**（走 `/api/pet/save`，
  //      存在 `~/.c4emem/pets/`），这样它从一开始就是"你做的"。
];

export const formOf = (id) => PET_FORMS.find((f) => f.id === id) || PET_FORMS[0];

/**
 * ⭐ 一次性修数据（2026-10-14 我自己造的坑）。
 *
 * ⚠️⚠️ 我给「转法」存的是 `c4emem.pet.mode` —— 而 **`mode` 本来就是宠物的工作模式**
 *    （`'apps'` = 那一圈软件 / `'single'` = 只认一个）。**一个键当两个用**，于是：
 *      存了 `mode: 'swing'` 之后，悬停那句 `if (petPref().mode === 'apps')` 永不成立
 *      ⇒ **指针放上去不再自动展开，必须点一下**（读者 2026-10-14 报的正是这个）。
 *    ⇒ 现在转法存 `spinMode`；这里把已经被写坏的 `mode` 还原成 `'apps'`。
 *
 * ⚠️ 修数据要**只认那两个值**（'swing' / 'full'）—— 别把用户真的设成 'single' 也改掉。
 */
export function migratePetPrefs() {
  try {
    const k = 'c4emem.pet';
    const p = JSON.parse(localStorage.getItem(k) || '{}');
    if (p.mode === 'swing' || p.mode === 'full') {
      if (!p.spinMode) p.spinMode = p.mode;
      p.mode = 'apps';
      localStorage.setItem(k, JSON.stringify(p));
      return true;
    }
  } catch { /* 坏 JSON 不管 —— 后面读的地方自己会兜底 */ }
  return false;
}
