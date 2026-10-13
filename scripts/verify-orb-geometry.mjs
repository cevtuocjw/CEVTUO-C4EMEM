/**
 * 光球**不许压住下面那一摞**（2026-10-10）。
 *
 * 起因：把语音屏的光球换成 cominvi 的白底矿物标本卡之后，一眼看出
 * 它盖住了「待机 · 点一下开始说话」和记录框 —— 截图里那张白纸就横在输入区上。
 *
 * ⚠️⚠️ 但这**不是矿物标本带来的 bug**。`.orbbg` 是 `inset:0`，光球按**整屏 50%**
 *    居中；而语音这一屏下面那一摞（状态条 + 记录框 + 输入条 + 提示）占了小半屏
 *    ⇒ 那个位置**本来就错**，只是以前珍珠/水晶是圆形、边缘还羽化过，
 *      "压住一点"看着像"浮在上面"，没人发现。
 *    换成不透明的白卡之后，同一件事立刻变成"一张纸盖住了输入区"。
 *
 * ⇒ 所以这一节测的是**布局契约**（球底必须在那一摞的顶之上），
 *   不是"矿物标本好不好看"；对**所有形态**都成立。
 *
 * ⚠️ 这也是"「画出来了」和「看得见」是两件事"那一族 ——
 *    位置错了两周没人报，直到有个不透明的东西放上去。
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';

const B = 'http://127.0.0.1:8770';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

const FORMS = ['card', 'pearl', 'silver', 'lead', 'zinc'];

const b = await chromium.launch({ channel: 'chrome', args: ['--no-proxy-server', '--proxy-bypass-list=*'] });
const p = await b.newPage({ viewport: { width: 1360, height: 880 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));

await p.goto(B + '/', { waitUntil: 'load' });
await p.waitForTimeout(1800);
await p.evaluate(() => window.__app.show('voice'));
await p.waitForTimeout(1200);

/** 量：光球的底 vs「下面那一摞」的顶。返回正数 = 压住了多少像素。 */
const measure = () => p.evaluate(() => {
  // ⚠️⚠️ 必须挑**当前真的显示出来的**那个。第一版写的是
  //    `querySelector('#orbvid') || querySelector('#ck')` —— 而 `#orbvid` 在卡片形态下
  //    是 `display:none`，它的 rect **全是 0**，于是"卡片那行"拿到 球底=0、
  //    得出 -554px 的"余量"，**报绿**。那正是这一节要防的那件事：
  //    **量不到被当成了合格**。判据：`getBoundingClientRect().height > 0`。
  const cands = [document.querySelector('#orbvid'), document.querySelector('#ck'),
                 document.querySelector('#orb')];
  const orb = cands.find((e) => e && e.getBoundingClientRect().height > 0);
  const stack = [...document.querySelectorAll('.vpane .vfloat > *')]
    .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height > 0);
  if (!orb || !stack.length) return { err: '量不到光球或那一摞' };
  const o = orb.getBoundingClientRect();
  const top = Math.min(...stack.map((e) => e.getBoundingClientRect().top));
  return { orbBottom: Math.round(o.bottom), stackTop: Math.round(top), overlap: Math.round(o.bottom - top) };
});

console.log('\n── ① 每一种形态，光球都在上面那块空地之下缘 ──────');
const results = {};
for (const f of FORMS) {
  await p.selectOption('#vorb', f);
  await p.waitForTimeout(1400);
  const m = await measure();
  results[f] = m;
  ok(m.overlap !== undefined && m.overlap <= 0,
     `${f.padEnd(7)} 球底 ${m.orbBottom} vs 那一摞顶 ${m.stackTop} → 余量 ${m.overlap}px`);
  ok(m.orbBottom > 0, `${f.padEnd(7)} ⚠️ 量到的是一个**真的显示着**的元素（球底 ${m.orbBottom} ≠ 0）`);
}

console.log('\n── ② 记录框拉高之后仍然不许压（高度是用户拖出来的）──');
{
  // ⚠️ 这条是关键：`--orbmid` 是**现量**出来的，记录框一变高就必须重算。
  //    不重算的话，拖高记录框 = 球被压住 —— 而"拖高之后才坏"最难被发现。
  await p.selectOption('#vorb', 'silver');
  await p.waitForTimeout(900);
  const before = (await measure()).overlap;
  await p.evaluate(() => {
    // 模拟拖把手：直接写那个变量 + 触发一次重算（走产品自己的入口）
    document.documentElement.style.setProperty('--vlogh', Math.round(innerHeight * 0.42) + 'px');
    window.dispatchEvent(new Event('resize'));
  });
  await p.waitForTimeout(900);
  const after = (await measure()).overlap;
  ok(after <= 0, `记录框拉到上限后：余量 ${before}px → ${after}px（仍然是负的/零）`);
}

console.log('\n── ③ ⚠️ 负向对照：把定心点退回整屏 50% ⇒ 这一节必须变红 ──');
{
  // ⚠️ 必须**撤掉产品写的那条**（它是 `.orbbg` 上的内联属性，优先级最高），
  //    退回样式表里的兜底 `50%` —— 也就是"把 bug 放回去"。
  //    只加一条 style 规则是**打不过**内联属性的，那样对照就成了恒等操作
  //    （这个坑本项目踩过不止一次）。
  await p.evaluate(() => {
    document.querySelector('.vpane .orbbg').style.removeProperty('--orbmid');
  });
  await p.waitForTimeout(900);
  const m = await measure();
  ok(m.overlap > 0,
     `⚠️ 退回 50% 之后确实压住了（余量 ${m.overlap}px）—— 所以这一节的断言是**有区分力的**`);
  // 收尾：把产品那条写回去，别把页面留在坏的态
  await p.evaluate(() => window.dispatchEvent(new Event('resize')));
  await p.waitForTimeout(700);
  const back = await measure();
  ok(back.overlap <= 0, `写回去之后又好了（余量 ${back.overlap}px）`);
}

console.log('\n── ④ 顺带：那一摞的文字没有被盖住（看得见才算数）──');
{
  await p.selectOption('#vorb', 'silver');
  await p.waitForTimeout(1200);
  // ⚠️ `getBoundingClientRect()` **不受 overflow 影响**，也不管谁盖在谁上面 ——
  //    所以这里用**命中测试**：那颗状态药丸的中心点，点下去应该命中它自己。
  const hit = await p.evaluate(() => {
    const el = document.querySelector('#vstate');
    if (!el) return { err: '没有 #vstate' };
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return { hit: top ? (top.id || top.className || top.tagName) : null, isSelf: !!(top && el.contains(top)) };
  });
  ok(hit.isSelf, `状态药丸的中心点命中的是它自己（拿到 ${hit.hit}）`);
}

ok(!errs.length, `全程没有页面报错${errs.length ? '：' + errs[0] : ''}`);

await b.close();
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
