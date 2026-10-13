/**
 * 四角统一 + 中间区对齐（2026-10-09 晚）。
 *
 * 读者原话：
 *   「界面左上角和右上角非常不协调，虽然是两种东西，但是看着很别扭，而且下边还有
 *    左下角右下角，这4个角落是否应该给出来的感觉要差不多」
 *   「中间区域的在窄屏幕下非常的不居中」
 *
 * 判据全是**量出来的数**，不是"看着齐了"：
 *   ① 四个角离边的距离**同一个数**（原来 17/14、18/15、15/15、18/18 —— 没有两个是齐的）
 *   ② 四个角用**同一套玻璃**（同一个 backdrop-filter、同一个底、同一个描边）
 *   ③ 上面一对**同高**、下面一对**同直径**（读者说了"虽然是两种东西" ⇒ 不要求长一样）
 *   ④ **同一屏只有一条中心线**：光球中心 == 内容盒中心
 *      （原来 970 vs 924 —— 差 45px，因为 `.vfloat` 的留边是不对称的）
 *   ⑤ 负向对照：把 `--cn-inset` 改掉 ⇒ ① 必须变红。对照不红 = 这条断言没在测东西。
 *
 * 跑法：env -u HTTPS_PROXY … NO_PROXY='*' bun scripts/verify-corners.mjs
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';

const B = 'http://127.0.0.1:8770';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m}（${a} vs ${b}，容差 ${tol}）`);

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(B + '/', { waitUntil: 'load' });
await p.waitForTimeout(1200);
/** 每次测量前把动画冻住 —— 那几个角有 transition，读数会在动。 */
const freeze = () => p.addStyleTag({ content: '*{transition:none !important;animation:none !important}' });

const probe = () => p.evaluate(() => {
  const box = (s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const c = getComputedStyle(e);
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      l: Math.round(r.left), r: Math.round(innerWidth - r.right),
      t: Math.round(r.top), bo: Math.round(innerHeight - r.bottom),
      cx: Math.round(r.left + r.width / 2),
      blur: (c.backdropFilter || c.webkitBackdropFilter || 'none').replace(/\s+/g, ''),
      img: c.backgroundImage.replace(/\s+/g, '').slice(0, 60),
      bd: c.borderTopColor.replace(/\s+/g, ''),
      radius: c.borderTopLeftRadius,
    };
  };
  return {
    vw: innerWidth,
    /** 四个角：左上/右上/左下/右下 各自的**可见那一个** */
    // ⚠️ 左上角要看 **.brand**（那行字本身），不是 `.shead`（它的容器，会一直贴到栏边）。
    //    量错的话会得到 9 这种数，然后误判成"左上和别的角差 6px"。
    tl: box('.brand'),
    // ⚠️ 右上那一对是「3 颗 thumb 装在一个 .modes 里」：
    //    外沿要看 **.modes**（`.thumb` 是其中**最左**那颗，量它会算出 141 这种假红）；
    //    尺寸/描边要看**未选中的那颗**（选中的那颗按设计就带一圈墨色边）。
    trWrap: box('.modes'),
    tr: box('.thumb:not(.on)'),
    bl: box('.fanbtn'), br: box('.shelfpill'),
    orb: box('.orbbg'), bar: box('.vbar'), log: box('.vlog'),
  };
});

const grab = async () => { await freeze(); await p.waitForTimeout(250); return probe(); };

console.log('\n── ① 四个角离边的距离必须是同一个数 ──────────────');
{
  const m = await grab();
  // ⚠️ 左上角**故意不在这一组里**：它是文字（读者 2026-10-09 明确要求
  //    「logo 那里不要这么改和难堪，改回去、别套容器」），
  //    所以它只能"接近"，不可能和另外三个相等 —— 这是决定，不是遗漏。
  const got = { '右上 .modes': m.trWrap.r, '左下 .fanbtn': m.bl.l, '右下 .shelfpill': m.br.r };
  const vals = Object.values(got);
  const spread = Math.max(...vals) - Math.min(...vals);
  console.log('    ' + Object.entries(got).map(([k, v]) => `${k}=${v}`).join('  ') + `   ／ 左上 .brand=${m.tl.l}（文字，不参与）`);
  ok(spread <= 1, `三个「块」的水平离边**同一个数**（极差 ${spread}px）—— 原来是 18/15/18`);
  const vt = { '右上': m.trWrap.t, '左下': m.bl.bo, '右下': m.br.bo };
  const vs = Object.values(vt);
  const vspread = Math.max(...vs) - Math.min(...vs);
  console.log('    ' + Object.entries(vt).map(([k, v]) => `${k}=${v}`).join('  '));
  ok(vspread <= 1, `竖直方向也是同一个数（极差 ${vspread}px）—— 原来是 15/15/18`);
  ok(Math.abs(m.tl.l - m.bl.l) <= 3, `左上那行字和左下那颗钮**离边接近**（${m.tl.l} vs ${m.bl.l}）`);
  // ⭐ 这一条是**读者的决定的护栏**：下次谁"顺手统一"又把 logo 套进玻璃条里，它会红。
  ok(m.tl.blur === 'none', `左上角**没有容器**（backdrop-filter=${m.tl.blur}）—— 读者要求改回去的就是这一处`);
}

console.log('\n── ② 四个角必须是同一套玻璃 ────────────────────');
{
  const m = await grab();
  // ⚠️ 左上那个角是**文字**，没有材质可比 —— 见 ① 的注释
  const corners = { '右上': m.tr, '左下': m.bl, '右下': m.br };
  const blurs = new Set(Object.values(corners).map((c) => c.blur));
  ok(blurs.size === 1 && !blurs.has('none'),
     `三个「块」同一个 backdrop-filter（实得 ${[...blurs].join(' | ')}）—— 原来右上那对是 none`);
  // ⚠️ 只比**未选中**的那颗 thumb —— 选中的那颗按设计带一圈墨色边，
  //    把它算进来会得到一条永远红的假断言。
  const bds = new Set(Object.values(corners).map((c) => c.bd));
  ok(bds.size === 1, `四个角同一个描边色（实得 ${[...bds].join(' | ')}）`);
  const onBd = await p.evaluate(() => getComputedStyle(document.querySelector('.thumb.on')).borderTopColor.replace(/\s+/g, ''));
  ok(onBd !== [...bds][0], `选中的那颗**故意**不一样（墨色 ${onBd}）—— 那是"选中"的判据`);
}

console.log('\n── ③ 上面一对同高、下面一对同直径 ───────────────');
{
  const m = await grab();
  // ⚠️ 宽屏左上角是文字（没有容器），所以「上面一对同高」这条**只对窄屏成立**
  //    （窄屏那个角是抽屉把手，仍然是玻璃条）—— 见 ⑤。
  ok(m.tr.h === 44, `右上那对「条」用的是统一高度（实得 ${m.tr.h}）`);
  near(m.bl.w, m.br.w, 1, '下面两颗「圆钮」同直径（横）');
  near(m.bl.h, m.br.h, 1, '下面两颗「圆钮」同直径（竖）');
  ok(m.bl.w === m.bl.h && m.br.w === m.br.h, '下面两颗是正圆（宽=高）');
}

console.log('\n── ④ 同一屏只能有一条中心线 ────────────────────');
{
  const m = await grab();
  near(m.orb.cx, m.bar.cx, 2, '光球中心 == 输入条中心');
  near(m.orb.cx, m.log.cx, 2, '光球中心 == 记录框中心');
}

console.log('\n── ⑤ 窄屏也要齐（四个角 + 中心线）──────────────');
{
  await p.setViewportSize({ width: 411, height: 891 });
  await p.waitForTimeout(600);
  const m = await grab();
  // 窄屏左上角是抽屉把手（.navdrawers），不是 .shead
  const tl = await p.evaluate(() => {
    const e = document.querySelector('.navdrawers');
    const r = e.getBoundingClientRect();
    return { l: Math.round(r.left), t: Math.round(r.top), h: Math.round(r.height) };
  });
  console.log(`    左上把手 l=${tl.l} t=${tl.t} h=${tl.h} ／ 右上 .modes r=${m.trWrap.r} t=${m.trWrap.t} h=${m.tr.h}`);
  const gaps = [tl.l, m.trWrap.r, m.bl.l, m.br.r];
  ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `窄屏四个角水平离边也齐（极差 ${Math.max(...gaps) - Math.min(...gaps)}px）`);
  ok(tl.t === m.trWrap.t && tl.h === m.tr.h, `窄屏上面两颗同高、同顶边（${tl.h} vs ${m.tr.h}，top ${tl.t} vs ${m.trWrap.t}）`);
  near(m.orb.cx, m.bar.cx, 2, '窄屏光球中心 == 输入条中心');
  near(m.bar.cx, Math.round(m.vw / 2), 2, '窄屏输入条在**屏幕正中**（不是内容区正中）');
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.waitForTimeout(400);
}

console.log('\n── ⑥ 负向对照：把一侧挪开，① 必须变红 ────────────');
{
  // ⚠️⚠️ **只能动一侧**。第一版是把 `--cn-inset` 从 15 改成 40 —— 那是**恒等操作**：
  //    三个角读的是同一个 token，改了它们**一起动**，极差仍然是 0，对照**红不了**。
  //    （"对照要打在被测的那一侧"这个坑已经记过五次。）
  await p.evaluate(() => { document.querySelector('.fan').style.left = '40px'; });
  await p.waitForTimeout(400);
  const m = await grab();
  const got = [m.trWrap.r, m.bl.l, m.br.r];
  ok(Math.max(...got) - Math.min(...got) > 1,
     `⚠️ 只把左下那颗挪到 40 ⇒ **立刻不齐**（${got.join('/')}）—— 说明 ① 真的在量"齐不齐"`);
  await p.evaluate(() => { document.querySelector('.fan').style.left = ''; });
  await p.waitForTimeout(300);
  const back = await grab();
  ok(Math.abs(back.bl.l - 15) <= 1, `改回来 ⇒ 左下回到 15（实得 ${back.bl.l}）`);
  ok(Math.abs(back.tl.l - back.bl.l) <= 3, `左上那行字回到"接近"（${back.tl.l} vs ${back.bl.l}）`);
}

ok(errs.length === 0, '没有页面报错' + (errs.length ? '：' + errs.slice(0, 2).join(' | ') : ''));
console.log(`\n${pass}/${pass + fail} 通过`);
await b.close();
process.exit(fail ? 1 : 0);
