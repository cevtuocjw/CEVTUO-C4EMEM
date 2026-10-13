/**
 * 每个 Pet 形态**都要真的渲染出来**（不是"名单里有"）。
 *
 * ⚠️ 判据要打在"**画出来了没有**"上：有元素但尺寸为 0 / 图没解码 = 空白，
 *    而"空白"和"这个形态坏了"长得一模一样。
 * ⚠️ 而 card 形态**本来就没有 img**（18 层 `<i>` 叠出来的）—— 拿"有没有 img"判它，
 *    红的是断言不是产品（第一版就是这么红的）。
 *
 * 跑法：bun scripts/verify-petforms.mjs
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
// ⚠️ 形态名单**从服务端现取** —— 写死的话，加一个/去掉一个（比如"银玫瑰"从内置
//    改成"必须自己做"）就会让这个脚本去找一个**不存在的 id**，
//    而"找不到"和"这个形态坏了"在输出里长得一样。
const F = await (await fetch('http://127.0.0.1:8770/api/pet/forms')).json();
const BUILTIN = (await (await fetch('http://127.0.0.1:8770/ui/petforms.js')).text())
  .match(/id: '([a-z]+)'/g).map((x) => x.slice(5, -1));
const IDS = [...BUILTIN, ...(F.items || []).map((x) => 'u-' + x.id)];
if (!IDS.length) { console.log('❌ 一个形态都没有'); process.exit(2); }
const b = await chromium.launch();
let pass = 0, fail = 0;
for (const id of IDS) {
  const ctx = await b.newContext({ viewport: { width: 440, height: 520 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8770/ui/pet.html', { waitUntil: 'load' });
  // 预置偏好（**必须在 pet.js 跑之前** —— 所以设完 reload 一次）
  await p.evaluate((i) => localStorage.setItem('c4emem.pet', JSON.stringify({ form: i })), id);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const r = await p.evaluate(() => {
    const b = document.querySelector('#petbody');
    const img = b.querySelector('img, video');
    const box = b.getBoundingClientRect();
    return {
      cls: b.className,
      tag: img ? img.tagName.toLowerCase() : '(没有)',
      // ⚠️ 判据要打在**真的画出来了没有**上：有元素但尺寸为 0 / 图没解码 = 空白
      w: Math.round(box.width), h: Math.round(box.height),
      ready: img ? (img.tagName === 'IMG' ? (img.naturalWidth > 0) : (img.readyState >= 1)) : false,
      src: img ? (img.getAttribute('src') || '').split('/').pop() : '',
      // ⚠️ `card` 形态**本来就没有 img/video** —— 它是 18 层 `<i>` 叠出来的。
      //    拿"有没有 img"去判它，红的是断言不是产品（第一版就是这么红的）。
      layers: document.querySelectorAll('#petck .ed').length,
      // ⚠️ **自己做的那几种渲染的是"叠层"**（`#petslab .sl`，2D 图给厚度的那个），
      //    它**没有 img** —— 拿"有没有 img"判它会红，而红的是断言不是产品。
      slab: document.querySelectorAll('#petslab .sl').length,
      form: document.querySelector('#pet')?.dataset.form,
    };
  });
  const isCard = id === 'card';
  const isSlab = r.slab > 0;
  const painted = isCard ? r.layers >= 12 : isSlab ? r.slab >= 12 : r.ready;
  const okk = r.w > 10 && r.h > 10 && painted && r.form === id;
  okk ? pass++ : fail++;
  console.log(`  ${okk ? '✓' : '✗'} ${id.padEnd(7)} form=${r.form} ${r.tag.padEnd(5)} ${String(r.w)+'×'+String(r.h)} painted=${isCard ? r.layers+'层' : isSlab ? r.slab+'层厚' : r.ready} ${r.src}`);
  if (errs.length) { console.log('     报错：' + errs[0]); fail++; }
  await ctx.close();
}
await b.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} 个形态都真的渲染出来了`);
process.exit(fail ? 1 : 0);
