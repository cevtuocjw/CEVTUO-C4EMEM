/**
 * ⭐ 「2D 的给它一点厚度让它旋转」+「所有形态都能一键选转/不转，默认转」（读者 2026-10-13）。
 *
 * ⚠️ 三条判据都是**会撒谎的那种**，各配一条真的：
 *   · 层数   —— 全叠在同一个 z 上 = 16 层但**没有厚度** ⇒ 必须断言 Z **各不相同**
 *   · 停没停 —— `animation:none` 之后 computed 的 `animationName` **还是那个名字**
 *               ⇒ 必须看 `getAnimations()` 里**在跑的还有几个**（我第一版就是这么假绿的）
 *   · 视频   —— 不吃 CSS 动画，只加类它**还在播** ⇒ 必须断言 `video.paused === true`
 *
 * 跑法：bun scripts/verify-petspin.mjs
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
const B = 'http://127.0.0.1:8770';
const made = ((await (await fetch(B + '/api/pet/forms')).json()).items || [])[0];
if (!made) { console.log('❌ 没有"你造的"那只 —— 先跑 /tmp/mk_try.mjs'); process.exit(2); }
const b = await chromium.launch();
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

async function open(form, spin) {
  const ctx = await b.newContext({ viewport: { width: 440, height: 520 } });
  const p = await ctx.newPage();
  await p.goto(B + '/ui/pet.html', { waitUntil: 'load' });
  await p.evaluate(([f, sp]) => localStorage.setItem('c4emem.pet', JSON.stringify(sp === null ? { form: f } : { form: f, spin: sp })), [form, spin]);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1000);
  return { ctx, p };
}

console.log('① 2D 形态的厚度（叠层）与默认旋转');
{
  const { ctx, p } = await open('u-' + made.id, null);
  const r = await p.evaluate(() => {
    const slab = document.querySelector('#petslab');
    const layers = slab ? slab.querySelectorAll('.sl').length : 0;
    const cs = slab ? getComputedStyle(slab) : null;
    const zs = slab ? [...slab.querySelectorAll('.sl')].map(e => e.style.transform) : [];
    return {
      layers, ps: cs?.transformStyle, anim: cs?.animationName,
      // ⚠️ 判据是**真的错开了 Z**，不是"层数对" —— 全在同一个 z 上等于没厚度
      distinctZ: new Set(zs).size,
      still: document.querySelector('#petbody').classList.contains('pstill'),
      bg: slab?.querySelector('.sl')?.style.backgroundImage?.slice(0, 40) || '',
    };
  });
  ok(r.layers >= 12, `叠了 ${r.layers} 层（厚度）`);
  ok(r.distinctZ >= 12, `★ 各层真的错开了 Z（${r.distinctZ} 个不同的位置）—— 全同 z 就是没厚度`);
  ok(r.ps === 'preserve-3d', '容器是 preserve-3d（不然各层被拍平，而且不报错）');
  ok(r.anim === 'slabspin', '在转（' + r.anim + '）');
  ok(!r.still, '★ **默认是转的**（没存过 spin 也不该定住）');
  ok(/pet-/.test(r.bg), '画的是那张图：' + r.bg);
  await p.screenshot({ path: '/tmp/slab-on.png', omitBackground: true });
  await ctx.close();
}

console.log('\n② 关掉旋转');
{
  const { ctx, p } = await open('u-' + made.id, false);
  const r = await p.evaluate(() => {
    const slab = document.querySelector('#petslab');
    return {
      still: document.querySelector('#petbody').classList.contains('pstill'),
      // ⚠️ 判据不能用 `animationName` —— `animation:none !important` 之后
      //    computed 的 animationName 还是那个名字，**看不出来停没停**
      //    （我第一次就是这么写的，绿了但什么都没测）。要看**动画到底在不在跑**。
      running: slab ? slab.getAnimations().filter(a => a.playState === 'running').length : -1,
      layers: slab ? slab.querySelectorAll('.sl').length : 0,
    };
  });
  ok(r.still, '加上了 .pstill');
  ok(r.running === 0, `★ 动画真的停了（在跑的动画 ${r.running} 个）`);
  ok(r.layers >= 12, '层还在（只是不动，不是被删掉）');
  await ctx.close();
}

console.log('\n③ 视频形态关掉旋转 ⇒ 视频必须真的暂停');
{
  const { ctx, p } = await open('pearl', false);
  const r = await p.evaluate(() => {
    const v = document.querySelector('#petbody video');
    return { has: !!v, paused: v ? v.paused : null, still: document.querySelector('#petbody').classList.contains('pstill') };
  });
  ok(r.has, '珍珠那个是 <video>');
  ok(r.still, '加了 .pstill');
  ok(r.paused === true, '★ 视频真的 pause 了（只加类的话它还在播，用户会以为开关坏了）');
  await ctx.close();
}

console.log('\n④ 打开的时候视频要在播（否则"默认转"是假的）');
{
  const { ctx, p } = await open('pearl', null);
  await p.waitForTimeout(600);
  const r = await p.evaluate(() => { const v = document.querySelector('#petbody video'); return v ? v.paused : null; });
  ok(r === false, '视频在播（paused=' + r + '）');
  await ctx.close();
}

await b.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
