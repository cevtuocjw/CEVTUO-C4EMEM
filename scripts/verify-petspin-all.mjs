/**
 * ⭐⭐ 「转 / 不转」对**每一种形态**都必须真的有区别。
 *
 * 读者 2026-10-14：「现在转不转还是没处理好这个功能」。
 * 实测他机器上的 pref 是 `{"form":"silver","spin":false}` ——
 * **而「银」在桌面上原本是一张静态图 ⇒ 根本没有东西可转**
 * ⇒ 他把这个开关开开关关，画面一模一样。**症状和"开关坏了"完全一样。**
 *
 * ⚠️⚠️ 这一条判据**不测机制，测结果**：同一个形态在两种设置下各截两张图（隔 400ms），
 *     · 转 ⇒ 两张**必须不一样**（像素真的变了）
 *     · 不转 ⇒ 两张**必须逐字节一样**
 *    这样写的好处：不管它是 CSS 动画 / video / WebGL，**判据都不变**；
 *    而"机制对了但没画出来"（本项目栽过三次的那种假绿）会被当场抓住。
 *
 * 跑：C4EMEM_BASE=http://127.0.0.1:8791 bun scripts/verify-petspin-all.mjs
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';

const B = process.env.C4EMEM_BASE || 'http://127.0.0.1:8791';
let pass = 0, fail = 0, skip = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

const forms = await (await fetch(B + '/ui/petforms.js')).text().then(() => null).catch(() => null);
// 形态名单直接从页面那边问（**不在这里再抄一份** —— 两份必然漂移）
const br = await chromium.launch({ args: ['--no-proxy-server', '--proxy-bypass-list=*', '--enable-unsafe-swiftshader'] });
const p = await br.newPage({ viewport: { width: 440, height: 520 } });
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
await p.goto(B + '/ui/pet.html', { waitUntil: 'load' });
const LIST = await p.evaluate(async () => {
  const m = await import('/ui/petforms.js');
  const out = m.PET_FORMS.map((f) => f.id);
  try {
    const r = await (await fetch('/api/pet/forms')).json();
    for (const x of (r.items || [])) out.push('u-' + x.id);
  } catch { /* 没有自己造的就只测内置的 */ }
  return out;
});
console.log(`形态清单（从页面那边问来的）：${LIST.join(' · ')}`);

/** 把 petbody 那一小块截两次，判"有没有在动" */
async function motion(form, spin) {
  await p.evaluate(([f, s]) => localStorage.setItem('c4emem.pet', JSON.stringify({ form: f, spin: s })), [form, spin]);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(2200);              // ⚠️ 3D 那条路要先把 three 和两张图拉起来
  // ⚠️⚠️ 截哪一块**必须现读**（`#pet` 的位置是存出来的偏好，不在左上角）。
  //    我第一版写死 `{0,0,180,180}` ⇒ 截到一片空地，五个形态全是 486 字节的空白 PNG，
  //    于是「不转」那五条**全绿**（"两张一样"当然成立）—— 差一点就把假绿当成结论。
  const box = await p.locator('#pet').boundingBox();
  if (!box || box.width < 20) throw new Error('#pet 没渲染出来（矩形 ' + JSON.stringify(box) + '）');
  const clip = { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: box.width + 12, height: box.height + 12 };
  const a = await p.screenshot({ clip });
  await p.waitForTimeout(420);
  const b = await p.screenshot({ clip });
  let diff = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) diff++;
  return { changed: !a.equals(b), diff, a, b };
}

console.log('\n① 每种形态：**转** 的时候画面真的在变');
for (const f of LIST) {
  const r = await motion(f, true);
  ok(r.changed, `${f.padEnd(14)} 在动（差异字节 ${r.diff}）`);
}
console.log('\n② 每种形态：**不转** 的时候画面**逐字节一样**');
for (const f of LIST) {
  const r = await motion(f, false);
  ok(!r.changed, `${f.padEnd(14)} 定住了（差异字节 ${r.diff}）`);
}
console.log('\n③ 而且"不转"那两张截图**不是同一张空图**（否则"定住"是假的）');
for (const f of LIST) {
  const r = await motion(f, false);
  // ⚠️ 一条全透明的空画布在"不转"下当然也"逐字节一样" —— 那是**假绿**。
  //    所以还要证明那一块**真的有东西**：PNG 长度明显大于纯色空图。
  ok(r.a.length > 2000, `${f.padEnd(14)} 那一块画了东西（PNG ${r.a.length} 字节，空白只有几百）`);
}

await br.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail}${skip ? ` · 跳过 ${skip}` : ''}`);
process.exit(fail ? 1 : 0);
