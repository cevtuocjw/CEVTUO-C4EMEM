/**
 * 窄屏布局 —— 两栏收成抽屉，主内容占满（<900px）。
 *
 * 判据照 docs/handoff-2026-10-09-pm.md §3.4 写的，全是**量出来的**：
 *   · 390 / 768 / 899：`.main` 宽度 > 0，且**不许横向滚动**（docScrollW <= innerWidth）
 *   · 900 / 1440：三栏都在（断点**两边都测** —— 只测窄的那边，
 *     "把三栏全关掉了"也能全绿）
 *   · 抽屉要真的滑出来（判据是**矩形在屏幕内**，不是"宽度 > 0" ——
 *     关着的时候它宽度也是 186，只是 translateX(-100%) 挪到屏幕外了）
 *   · ⭐ 负向对照：把 `narrow` 类摘掉（= 断点没生效）⇒ 390px 那条**必须变红**。
 *     **对照不红 = 这条断言没在测东西。**
 *
 * 跑法：env -u HTTPS_PROXY … NO_PROXY='*' bun scripts/verify-narrow.mjs
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';

const B = 'http://127.0.0.1:8770';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await p.goto(B + '/', { waitUntil: 'load' });
await p.waitForTimeout(900);

/** 量一份现场：三栏宽度 + 有没有横向滚动 + body 上挂了哪些类 */
const measure = () => p.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width) }; };
  return {
    main: r('.main'), side: r('.side'), dash: r('.dash'),
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    cls: document.body.className,
    drawersShown: getComputedStyle(document.querySelector('#navdrawers')).display !== 'none',
  };
});

const at = async (w, h = 900) => { await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(420); };

console.log('\n── 窄屏：主内容必须看得见，且不许横向滚 ──────────');
for (const w of [390, 768, 899]) {
  await at(w);
  const m = await measure();
  ok(m.main.w > 0, `${w}px ⇒ .main 宽度 > 0（实得 ${m.main.w}）—— 原来这里是 0，工作区整个在屏幕外`);
  ok(m.scrollW <= m.innerW + 1, `${w}px ⇒ 没有横向滚动（scrollW ${m.scrollW} <= ${m.innerW}）`);
  ok(m.cls.includes('narrow'), `${w}px ⇒ body 挂上了 narrow`);
  ok(m.drawersShown, `${w}px ⇒ 抽屉把手出现了`);
}

console.log('\n── 宽屏：三栏照旧并排（断点另一边也要测）──────────');
for (const w of [900, 1440]) {
  await at(w);
  const m = await measure();
  ok(!m.cls.includes('narrow'), `${w}px ⇒ 不是 narrow`);
  ok(m.side.w > 0 && m.dash.w > 0 && m.main.w > 0,
     `${w}px ⇒ 三栏都在（side ${m.side.w} / dash ${m.dash.w} / main ${m.main.w}）`);
  ok(!m.drawersShown, `${w}px ⇒ 抽屉把手收起来（宽屏不需要它）`);
}

console.log('\n── 抽屉：滑出来 / 遮罩 / Esc 关 ────────────────');
await at(390, 844);
{
  const closed = (await measure()).side;
  // ⚠️ 关着的时候宽度**也不是 0**（186，只是被 translateX(-100%) 挪到屏幕外）——
  //    所以判据是「矩形在不在屏幕里」，用宽度会把"关着"判成"开着"。
  ok(closed.x + closed.w <= 1, `点之前来源栏在屏幕外（右边到 ${closed.x + closed.w}px）`);

  await p.click('#navOpen');
  await p.waitForTimeout(420);
  const open = (await measure()).side;
  ok(open.x >= -1, `点了把手 ⇒ 来源栏滑进屏幕（left = ${open.x}）`);
  ok(await p.evaluate(() => document.body.classList.contains('navopen')), 'body 挂上 navopen');

  // 遮罩要真的能接住点击（历史坑：z-index 太低 ⇒ 既不挡也点不到）
  const scrimHits = await p.evaluate(() => {
    const s = document.querySelector('#drawerscrim');
    const cs = getComputedStyle(s);
    const r = s.getBoundingClientRect();
    const el = document.elementFromPoint(Math.round(r.width) - 12, Math.round(r.height) - 12);
    return { z: cs.zIndex, op: cs.opacity, pe: cs.pointerEvents, hit: el ? el.id || el.className : '' };
  });
  ok(Number(scrimHits.z) > 100 && scrimHits.pe === 'auto' && scrimHits.hit === 'drawerscrim',
     `遮罩盖住了内容、也接得住点击（z=${scrimHits.z} pe=${scrimHits.pe} 命中「${scrimHits.hit}」）`);

  // 遮罩要真的接得住点击（点它 = 关抽屉）
  // 取一个不在抽屉、也不在右上角模式灯上的点
  await p.mouse.click(315, 300);
  await p.waitForTimeout(420);
  ok((await measure()).side.x + (await measure()).side.w <= 1, '点遮罩能关掉抽屉');

  await p.click('#recOpen');
  await p.waitForTimeout(420);
  const m = await measure();
  ok(m.dash.x >= -1 && m.side.x + m.side.w <= 1,
     `记录栏滑出来、来源栏是关的（dash.left=${m.dash.x}, side 右边到 ${m.side.x + m.side.w}）`);
  ok(!(m.cls.includes('navopen') && m.cls.includes('recopen')), '两个抽屉不会同时开着（都是 left:0，会互相盖住）');

  // 抽屉自己的 `‹` 在窄屏是"关上"，**不是**"把这栏永久收掉"
  await p.click('#recBtn');
  await p.waitForTimeout(420);
  const after = await measure();
  ok(after.dash.x + after.dash.w <= 1, '抽屉里的 ‹ 能关上它');
  ok(await p.evaluate(() => localStorage.getItem('c4emem.rec')) === null,
     '⚠️ 而且**没有**顺手把这一栏永久收掉（那样抽屉就再也滑不出来了）');

  await p.click('#navOpen');
  await p.waitForTimeout(420);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(420);
  ok((await measure()).side.x + (await measure()).side.w <= 1, 'Esc 能关掉抽屉');

  // 在抽屉里点一个导航项 ⇒ 自动收回（不然你得手动关才看得见刚打开的那一屏）
  await p.click('#navOpen');
  await p.waitForTimeout(320);
  await p.click('.side .nv[data-v="usage"]');
  await p.waitForTimeout(420);
  const nav = await measure();
  ok(nav.side.x + nav.side.w <= 1, '在抽屉里点了一个导航项 ⇒ 抽屉自己收回去');
}

console.log('\n── 负向对照：断点没生效时必须变红 ────────────────');
{
  // 摘掉 `narrow` 类 = 断点那条规则不再命中（等价于"把断点去掉"）。
  await p.evaluate(() => document.body.classList.remove('narrow'));
  await p.waitForTimeout(300);
  const m = await measure();
  ok(m.main.w <= 0,
     `⚠️ 摘掉 narrow ⇒ .main 宽度塌成 0（实得 ${m.main.w}）—— 这就是上面那条断言真的在测的东西`);
  ok(m.scrollW > m.innerW, `⚠️ 同时冒出横向滚动（scrollW ${m.scrollW} > ${m.innerW}）—— 和读者截图对上了`);
  await p.evaluate(() => location.reload());
  await p.waitForTimeout(1000);
}

console.log('\n── 宽窄来回切：状态不能残留 ────────────────────');
{
  await at(390, 844);
  await p.click('#navOpen');
  await p.waitForTimeout(320);
  await at(1440, 900);
  ok(!(await measure()).cls.includes('navopen'),
     '从窄屏转回宽屏 ⇒ open 类被摘掉（不摘的话宽屏看不出来，切回窄屏抽屉会自己开着）');
  await at(390, 844);
  const m = await measure();
  ok(m.side.x + m.side.w <= 1, '再切回窄屏 ⇒ 抽屉是关着的（不是"自己开着"）');
}

console.log('\n── 两个下角的圆钮不许压住正文 ──────────────────');
{
  // ⚠️ 这是**布局契约**，不是"看起来还行"：右下货架、左下来源各 58px，
  //    而 .vfloat 原来的留边是按桌面算的不对称值（左 26 / 右 116），
  //    窄屏正文只剩 269 宽 ⇒ 底部那行提示被来源钮压住左边 47px（量出来的）。
  //    判据是**矩形相交**：内容最多碰到角钮的边，不能进去。
  await at(390, 844);
  const clash = await p.evaluate(() => {
    const R = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    const hit = (a, b) => a && b && a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
    const out = [];
    for (const [nm, sel] of [['底部提示(.vhint)', '.vhint'], ['输入条(.vbar)', '.vbar'], ['记录框(.vlog)', '.vlog']]) {
      const e = R(sel);
      if (!e || e.width === 0) continue;
      for (const [cn, cs] of [['左下来源钮(.fan)', '.fan'], ['右下货架(#shelf)', '#shelf']]) {
        const c = R(cs);
        if (hit(e, c)) out.push(`${nm} × ${cn}`);
      }
    }
    return out;
  });
  ok(clash.length === 0, '窄屏下正文不被两个角钮压住' + (clash.length ? '：' + clash.join('、') : ''));
}

ok(errs.length === 0, '没有页面报错' + (errs.length ? '：' + errs.slice(0, 2).join(' | ') : ''));

console.log(`\n${pass}/${pass + fail} 通过`);
await b.close();
process.exit(fail ? 1 : 0);
