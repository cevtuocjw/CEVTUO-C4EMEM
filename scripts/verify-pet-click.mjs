/**
 * 读者 2026-10-13：「**点击，并不能让这个软件的窗口抬到最前面来，没有反应**」。
 *
 * 这一支只回答一件事：**在扇里真点一下，原生桥到底收没收到 `launch`。**
 * 两种点法都要收到：
 *   ① 正好点在图标上；
 *   ② **点歪一点点**（落在同一格里，但没压在图标上）—— 这一条是这次新加的兜底，
 *      以前是**静默什么都不做**，而"点不动"和"功能坏了"在用户眼里一样。
 *
 * ⚠️ 打桩两处，都是为了**不碰读者机器上的真软件**：
 *   ① `window.webkit.messageHandlers.c4` —— 把发出去的消息记下来（有桥就不会走 HTTP activate）；
 *   ② `/api/running` —— 换成假数据。
 */
import { chromium } from '/Users/cjw/Documents/DSP Deepseek/pingfang-factcheck/node_modules/playwright-core/index.js';

const API = 'http://127.0.0.1:8770';
const FAKE = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((n, i) => ({
  name: n, path: `/Applications/${n}.app`, pid: 100 + i,
}));

let fails = 0, passes = 0;
const ok = (c, label, extra = '') => {
  if (c) { passes += 1; console.log('  ✓ ' + label); }
  else { fails += 1; console.log('  ✗ ' + label + (extra ? '  ' + extra : '')); }
};

const b = await chromium.launch({ args: ['--no-proxy-server', '--proxy-bypass-list=*'] });

/** 打开一轮轮盘，返回扇里的每颗（含坐标）和 Pet 中心 */
async function openWheel() {
  const p = await b.newPage({ viewport: { width: 820, height: 820 }, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => console.log('  PAGEERROR ' + e.message));
  await p.addInitScript(() => {
    window.__sent = [];
    window.webkit = window.webkit || {};
    window.webkit.messageHandlers = window.webkit.messageHandlers || {};
    window.webkit.messageHandlers.c4 = { postMessage: (m) => window.__sent.push(m) };
  });
  await p.goto(API + '/ui/pet.html', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.evaluate((apps) => {
    const of = window.fetch.bind(window);
    window.fetch = (u, o) => (String(u).includes('/api/running')
      ? Promise.resolve(new Response(JSON.stringify({ apps }), { headers: { 'content-type': 'application/json' } }))
      : of(u, o));
  }, FAKE);
  await p.evaluate(() => window.__petOpen());
  await p.waitForTimeout(600);
  const info = await p.evaluate(() => {
    const pr = document.querySelector('#pet').getBoundingClientRect();
    return {
      pet: { x: Math.round(pr.left + pr.width / 2), y: Math.round(pr.top + pr.height / 2) },
      items: [...document.querySelectorAll('#pwwheel .pwic')].map((e) => {
        const r = e.getBoundingClientRect();
        return {
          i: e.dataset.i,
          path: decodeURIComponent(String(e.querySelector('img')?.getAttribute('src') || '').replace(/^.*path=/, '')),
          cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2),
        };
      }),
    };
  });
  return { p, info };
}

const realClick = async (p, x, y) => {
  await p.mouse.move(x, y); await p.waitForTimeout(60);
  await p.mouse.down(); await p.waitForTimeout(40); await p.mouse.up();
  await p.waitForTimeout(350);
};

console.log('① 正好点在图标上（Bravo）');
{
  const { p, info } = await openWheel();
  ok(info.items.length === 4, '扇里 4 颗', JSON.stringify(info.items.map((i) => i.path.split('/').pop())));
  const t = info.items.find((s) => s.path.includes('Bravo'));
  await realClick(p, t.cx, t.cy);
  const sent = await p.evaluate(() => window.__sent);
  const L = sent.filter((m) => m && m.cmd === 'launch');
  ok(L.length === 1 && L[0].path.includes('Bravo'), '桥收到了 launch Bravo', JSON.stringify(sent));
  await p.screenshot({ path: '/tmp/pet-click-1.png' });
  await p.close();
}

console.log('② 点偏一点：落在**同一格的扇形带上**（没压在图标上）—— 也必须能中');
{
  const { p, info } = await openWheel();
  const t = info.items.find((s) => s.path.includes('Charlie'));
  const dx = t.cx - info.pet.x, dy = t.cy - info.pet.y;
  const len = Math.hypot(dx, dy) || 1;
  // ⚠️ 半径要**扫**出来，不能写死一个数：图标多大是随档位（s/m/l）变的，
  //    写死 16px 的时候它**仍然压在图标上** ⇒ 兜底那一段根本没被跑到，
  //    而断言照样是绿的（"测的是运气，不是契约"）。
  let pt = null, off = 0;
  // ⚠️ 判据是 **`.pwsg`（扇形带）且不是 `.pwic`（图标）** —— 这条是真的会红的：
  //    把选择器里的 `.pwsg` 去掉（负向对照），落在带上的那一下立刻什么都不发生。
  //    （第一版我找的是"落在 svg 空白处"，那种点**本来就没有对应的格**，
  //      负向对照不红 ⇒ 说明那条断言测的是运气。）
  for (const k of [16, 20, 24, 28, 32, 36]) {
    for (const sgn of [-1, 1]) {                     // 先往里、再往外
      const x = Math.round(t.cx + (dx / len) * k * sgn);
      const y = Math.round(t.cy + (dy / len) * k * sgn);
      const kind = await p.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'none';
        if (el.closest?.('.pwic')) return 'icon';
        return el.closest?.('.pwsg') ? 'band' : 'other';
      }, [x, y]);
      if (kind === 'band') { pt = { x, y }; off = k * sgn; break; }
    }
    if (pt) break;
  }
  if (!pt) {
    console.log('  ⚠️ SKIP —— 找不到"落在扇形带上、但没压在图标上"的落点');
    passes += 0;
  } else {
    console.log('   （落点沿半径 ' + (off > 0 ? '往外' : '往里') + Math.abs(off) + 'px —— 在扇区带上，不在图标上）');
    await realClick(p, pt.x, pt.y);
    const sent = await p.evaluate(() => window.__sent);
    const L = sent.filter((m) => m && m.cmd === 'launch');
    ok(L.length === 1 && L[0].path.includes('Charlie'), '桥收到了 launch Charlie（点歪也中了）', JSON.stringify(sent));
  }
  await p.screenshot({ path: '/tmp/pet-click-2.png' });
  await p.close();
}

console.log('③ 展开之后**不能重画**（列表和上次一样时）—— 这是"点击调取不到窗口"的真因');
{
  const { p, info } = await openWheel();
  // 先收起再展开一次 ⇒ 这次 `srcCache.running` 已经有东西，展开时会先拿它画一帧。
  await p.evaluate(() => window.__petHover(false));
  await p.waitForTimeout(450);

  // ⚠️ 在同一次 evaluate 里"展开 + 立刻打标记"：打标记之后那次 fetch 才回来，
  //    所以能精确回答"它有没有在展开后把这一圈重建掉"。
  const tagged = await p.evaluate(() => {
    window.__petOpen();
    const els = [...document.querySelectorAll('#pwwheel .pwic')];
    els.forEach((e) => { e.__mine = true; });
    return els.length;
  });
  await p.waitForTimeout(900);                    // 远超那次 fetch 的时间
  const after = await p.evaluate(() => {
    const els = [...document.querySelectorAll('#pwwheel .pwic')];
    return { now: els.length, survived: els.filter((e) => e.__mine === true).length };
  });
  ok(tagged > 0, '展开的第一帧就有 ' + tagged + ' 格（用的是上一次的缓存那份）');
  ok(after.now > 0 && after.survived === after.now,
    '那一圈没有被重建（重画 = 换节点 = 按下和抬起落在不同元素上 ⇒ click 丢）',
    JSON.stringify(after));

  // 而且等它一会儿之后再点，照样能中
  const t = info.items.find((s) => s.path.includes('Delta'));
  await realClick(p, t.cx, t.cy);
  const L = (await p.evaluate(() => window.__sent)).filter((m) => m && m.cmd === 'launch');
  ok(L.length === 1 && L[0].path.includes('Delta'), '展开后等一会儿再点，仍然能中', JSON.stringify(L));
  await p.close();
}

await b.close();
console.log('\n通过 ' + passes + ' / 失败 ' + fails);
process.exit(fails ? 1 : 0);
