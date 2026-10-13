/**
 * Pet 有哪几种「形态」—— **只有这一份**。
 *
 * ⚠️⚠️ 为什么必须抽出来：pet.js（桌面上那个窗口）和 petsettings.html（设置页）**都要它**。
 *    各写一份的症状是"漂移" —— 而漂移在这个场景里的表现是
 *    **「设置里能选，选了之后 Pet 变空白」**（那个形态的 id 在另一份名单里没有，
 *    渲染那一支就落到 `else` 上），而且**一个错都不报**。
 *
 * ⚠️ `kind` 决定怎么画，三种：
 *    · `card`   —— 多层卡（`card.png` 叠出来的，见 pet.js 的 buildCard）
 *    · `orb`    —— 有大动图（`/ui/assets/mineral-<id>-mini.webp`，已经抠好白底）
 *    · `static` —— 一张静态图（**转不了**，如实说：它是张图，不是模型）
 *      ⚠️ 用户自己造的也走这一支（id 是 `u-<名字>`，图在 `/pets/` 下）。
 */
export const PET_FORMS = [
  { id: 'card',   nm: 'CEVTUO 卡片', kind: 'card' },
  { id: 'pearl',  nm: '珍珠',        kind: 'orb', video: '/ui/assets/pearl-orb.mp4' },
  { id: 'silver', nm: '银',          kind: 'orb', video: '/ui/assets/mineral-silver-loop.mp4', keyed: 1 },
  { id: 'lead',   nm: '铅',          kind: 'orb', video: '/ui/assets/mineral-lead-loop.mp4',   keyed: 1 },
  { id: 'zinc',   nm: '锌',          kind: 'orb', video: '/ui/assets/mineral-zinc-loop.mp4',   keyed: 1 },
  // ⚠️ 这里**故意没有**"银玫瑰"。
  //    读者 2026-10-13 给的那张图是「**我们一起要造的另一只**的外观」——
  //    内置一只同名的会变成列表里**两个都叫银玫瑰**（一个我给的、一个你造的），
  //    而"哪个是哪个"在界面上分不出来。
  //    ⇒ 那一只只能**通过「一起造一只新的」造出来**（走 `/api/pet/save`，
  //      存在 `~/.c4emem/pets/`），这样它从一开始就是"你做的"。
];

export const formOf = (id) => PET_FORMS.find((f) => f.id === id) || PET_FORMS[0];
