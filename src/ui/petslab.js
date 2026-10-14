/**
 * 「给一张 2D 图做厚度」——**只有这一份**（pet.js 桌面那只 + app.js 主界面那只都用它）。
 *
 * 读者 2026-10-13：「我希望如果是 2D 的，你能够**给它一点厚度让它旋转**」。
 *
 * ⚠️ 这是**叠层**，不是 3D —— 侧面看还是有"一叠纸"的感觉。
 *    ⭐ 真 3D 在 `pet3d.js`（那个要跑深度模型）。两者的关系是**降级**：
 *    有深度图 ⇒ `3d`；没有 ⇒ 退回这里，而**画面照样是好的**（不是空白）。
 *    读者 2026-10-14：「把 2D 的转化为 3D，**不是仅仅加厚**」——
 *    这一步现在是**兜底**，不再是主路。
 *
 * ⚠️ 不叠层的话，转起来就是**一张纸侧过去**（转到 90° 直接消失），
 *    看起来像"坏了"，而不是"它在转身"。
 * ⚠️ 层数不能太多：每层都是一次合成，48 个面那种教训就在 FACT 里
 *    （折射玻璃 48 面 ⇒ 从 60fps 掉到 4.7fps）。16 层在这个尺寸下没压力。
 */
export const SLAB_LAYERS = 16;

export function buildSlab(el, src) {
  if (!el) return;
  if (!src) { el.innerHTML = ''; return; }   // ⚠️ 没图就留空，别塞一个 <i> 让 CSS 去请求 undefined
  let html = '';
  for (let i = 0; i < SLAB_LAYERS; i += 1) {
    const z = -2.6 + (5.2 * i) / (SLAB_LAYERS - 1);
    // ⚠️ 压暗系数**别给大** —— 16 层叠起来，边上那几层一暗，整体就发灰，
    //    看起来像换了个材质而不是原来的图有了厚度。实测 0.45 就偏灰了。
    const k = (1 - Math.abs(z / 2.6) * 0.24).toFixed(3);
    html += `<i class="sl" style="transform:translateZ(${z.toFixed(2)}px);filter:brightness(${k});`
      + `background-image:url('${src}')"></i>`;
  }
  el.innerHTML = html;
}
