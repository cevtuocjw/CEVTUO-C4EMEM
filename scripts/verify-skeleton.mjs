/**
 * 结构流骨架 —— **「摆好 4 块、连上 3 条」那个按钮**（`#flowskel`）。
 *
 * 为什么单独一支：2026-10-12 交接时我把它标成「🟡 只 grep 到按钮在，**没驱动过它**」。
 * ⚠️ **"元素存在"和"它做成了事"是两件事** —— 这一支就是来补中间那一步的。
 *
 * 判据全是**契约**，不是运气（纪律 15）：
 *   · 块要**真的多出来 4 块**，而且 kind 顺序是固定的那四步；
 *   · 新块**不能压住**画布上已有的块（`makeSkeleton` 会去找一行没占的）；
 *   · 连线要**真的连上**，而且每条的两端**端口名都在两端各自的表里**（类型兼容）；
 *   · 相机要**真的动了**（`frameBlocks` 把这一组框进视口）—— 不是"加了个 class"；
 *   · 再来一次要落到**另一行**（不是原地盖一遍）。
 *
 * ⚠️ 种画布走 `_flowseed.mjs`：它会把 `flow.dir` 临时指到 `/tmp/c4emem-seed-<pid>`，
 *    跑完还原 ⇒ **读者的画布不会被这套件换掉**。本文件另外在 `finally` 里再兜一次。
 *
 * ⚠️⚠️ `_flowseed.mjs` 里的 `U` **写死 8770** —— 所以套件**只能对着 8770 跑**。
 *    把端口改成别的（比如对着沙盒），会出现"页面在沙盒、种的东西进了真服务"，
 *    表现是**页面上一块都没有**、然后断言超时 —— 看起来像产品坏了，其实是套件自己的事。
 *
 * 跑：`bun scripts/verify-skeleton.mjs`
 * 负向对照：`NEGCTL=1 bun scripts/verify-skeleton.mjs` —— 把 `#flowskel` 的 onclick 摘掉，
 *          "块多出来 4 块"那条**必须报红**。
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { seedFlow } from './_flowseed.mjs';

const U = 'http://127.0.0.1:8770';
const NEGCTL = process.env.NEGCTL === '1';
const B = await chromium.launch();
const p = await B.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (extra ? '  ' + extra : ''))); };

/** 画布上现在是什么样（一律现读，不写死） */
const snap = () => p.evaluate(() => {
  const a = window.__app || {};
  const boxes = Array.from(document.querySelectorAll('#flowworld .blk')).map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.id || '', l: r.left, t: r.top, r: r.right, b: r.bottom };
  });
  const world = document.querySelector('#flowworld');
  return {
    n: (a.flow || []).length,
    kinds: (a.flow || []).map((x) => x.kind),
    wires: (a.wires || []).map((w) => ({ from: w.from, to: w.to, port: w.port, in: w.in })),
    boxes,
    tf: world ? getComputedStyle(world).transform : 'none',
    toast: (document.querySelector('#toast') || {}).innerText || '',
  };
});
const overlap = (a, b) => !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);

// ⚠️ 先种 4 块**已经在用的**画布 —— 空画布上跑，`makeSkeleton` 找不找空行都一样，
//    那条"不压住别人"的断言就成了空跑（纪律 6：退化的数据骗得过断言）。
await seedFlow(
  [
    { id: 'seed1', kind: 'ev.manual', text: '口述一件要做的事', x: 60, y: 60 },
    { id: 'seed2', kind: 'src.notes', text: '去笔记里找', x: 440, y: 60 },
    { id: 'seed3', kind: 'act.summary', text: '合一段结论', x: 820, y: 60 },
    { id: 'seed4', kind: 'out.shelf', text: '放进货架', x: 1200, y: 60 },
  ],
  [
    { id: 'sw1', from: 'seed1', port: 'event', to: 'seed2', in: 'event', type: 'data' },
    { id: 'sw2', from: 'seed2', port: 'notes', to: 'seed3', in: 'notes', type: 'data' },
  ],
);

try {
  await p.goto(U + '/', { waitUntil: 'load' });
  await p.waitForFunction(() => !!window.__app, null, { timeout: 20000 });
  await p.waitForTimeout(600);
  if (NEGCTL) {
    const had = await p.evaluate(() => { const e = document.querySelector('#flowskel'); if (!e || !e.onclick) return false; e.onclick = null; return true; });
    console.log(had ? '⚠️ 负向对照：已把 `#flowskel` 的 onclick 摘掉（跑完会刷页面还原）\n'
      : '负向对照：锚点没匹配上 ⇒ 对照没生效，退出\n');
    if (!had) { await B.close(); process.exit(2); }
  }
  // ⚠️ 点按钮一律**在页面里 el.click()** —— Playwright 的可点性检查在这类按钮上
  //    只买来一种失败（2026-10-12 录演示时实测超时）。
  const hit = (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel);
  const inFlow = () => p.evaluate(() => document.querySelector('#m-flow').classList.contains('on') ||
    getComputedStyle(document.querySelector('#m-flow')).display !== 'none');
  await hit('.thumb[data-m="flow"]');
  await p.waitForTimeout(700);

  const before = await snap();
  ok(before.n === 4, '种下去的 4 块在页面上（不是 0）', '实际 ' + before.n);
  ok(await inFlow(), '结构流那一屏是开着的');

  // ── 第一次点 ─────────────────────────────────────────────
  ok(await hit('#flowskel'), '「骨架」那颗按钮点得到');
  await p.waitForTimeout(900);
  const a1 = await snap();

  ok(a1.n === before.n + 4, '点一下真的多出 4 块', `实际 +${a1.n - before.n}`);
  const seq = ['ev.manual', 'src.notes', 'act.summary', 'out.shelf'];
  ok(seq.every((k, i) => a1.kinds[before.n + i] === k),
    '那 4 块的种类是固定的四步（事件→取材→加工→去处）', a1.kinds.slice(before.n).join(','));
  ok(a1.wires.length === before.wires.length + 3, '连上 3 条线', `实际 +${a1.wires.length - before.wires.length}`);

  // 端口名要对得上**页面上真渲染出来的那两枚端口**（`data-b`=哪块、`data-t`=端口名）。
  // ⚠️ 不要去够 `window.__app.KINDS` —— 它没往外挂（第一版这么写，三条线全报"拿不到"，
  //    看起来像产品坏了，其实是探针伸错了地方）。
  //    对着渲染出来的端口验**更硬**：那是用户真能拖的那两枚。
  const portOk = await p.evaluate(() => {
    const app = window.__app || {};
    return (app.wires || []).map((w) => {
      const o = document.querySelector('#flowworld .port.out[data-b="' + w.from + '"][data-t="' + w.port + '"]');
      const i2 = document.querySelector('#flowworld .port.in[data-b="' + w.to + '"][data-t="' + w.in + '"]');
      if (o && i2) return 'ok';
      return (o ? '' : '起点没有那个出口: ') + (i2 ? '' : '终点没有那个入口: ') + w.port + '→' + w.in;
    });
  });
  const badPorts = portOk.filter((x) => x !== 'ok');
  ok(badPorts.length === 0, '每条线两端的端口名在各自表里（不是画条线就算连上）', badPorts.slice(0, 3).join(' ; '));

  // ── 不压住已有的块 ────────────────────────────────────────
  const oldBoxes = a1.boxes.slice(0, before.n);
  const newBoxes = a1.boxes.slice(before.n);
  // ⚠️ 守卫：下面两条"不重叠"在**空集合上恒真** —— 负向对照里它们照样绿，
  //    看起来像"验过了"。（这就是纪律 6：退化的数据骗得过断言。）先把长度钉住。
  ok(newBoxes.length === 4 && oldBoxes.length === before.n,
    '两组都真的有块可比（不然"不重叠"是空跑）', `新 ${newBoxes.length} / 旧 ${oldBoxes.length}`);
  const hits = [];
  for (const nw of newBoxes) for (const od of oldBoxes) if (overlap(nw, od)) hits.push(nw.id + '×' + od.id);
  ok(hits.length === 0, '新摆的 4 块没有压住画布上已有的块', hits.slice(0, 4).join(', '));

  // ── 相机真的动了 ─────────────────────────────────────────
  ok(a1.tf !== before.tf, '镜头真的对准了新那一组（不是只加了个 class）');
  // ── 说出来了 ─────────────────────────────────────────────
  ok(/摆好\s*4\s*块/.test(a1.toast), '收尾有话说（"摆好 4 块…"）', JSON.stringify(a1.toast.slice(0, 60)));

  // ── 再来一次 ⇒ 落到另一行 ────────────────────────────────
  await hit('#flowskel');
  await p.waitForTimeout(900);
  const a2 = await snap();
  ok(a2.n === before.n + 8, '再点一次是"再加 4 块"，不是原地盖一遍', `实际 ${a2.n}`);
  // ⚠️ 第一版这条写反了（要求"一行里 ≥2 个不同的 top"= 要求它们**不在一行**），
  //    于是它必然红 —— 那不是产品的问题，是我把契约写反了。真正的契约是：
  //    **同一批 4 块共用一个顶边**（它们是一行），而这一行的顶边**和上一批不同**。
  const tops = (from, to) => new Set(a2.boxes.slice(from, to).map((b) => Math.round(b.t)));
  const batch1 = tops(before.n, before.n + 4), batch2 = tops(before.n + 4, before.n + 8);
  ok(batch1.size === 1 && batch2.size === 1, '每一批自己的 4 块共用一个顶边（是真的摆成一行）',
    `batch1 ${[...batch1]} / batch2 ${[...batch2]}`);
  ok([...batch1][0] !== [...batch2][0], '第二批落在**另一行**（不是把第一批盖掉）',
    `batch1 top=${[...batch1]} / batch2 top=${[...batch2]}`);
  const cross = [];
  for (const n2 of a2.boxes.slice(before.n + 4)) for (const o1 of a2.boxes.slice(before.n, before.n + 4)) if (overlap(n2, o1)) cross.push('重叠');
  ok(cross.length === 0, '两批之间也不重叠');

  await p.screenshot({ path: '/tmp/c4demos/skeleton.png' });
} catch (e) {
  fail++;
  console.log('  ✗ 跑不起来：' + String(e.message).split('\n')[0]);
} finally {
  // ⚠️ 兜底：`_flowseed` 在 exit 里还原，但那是"正常退出"才走得到；这里再补一次。
  try {
    await fetch(U + '/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flow: { dir: '' } }),
    });
  } catch { /* 服务没了就算了 */ }
}

console.log(`\n${pass} 通过 / ${fail} 失败` + (errs.length ? '\n⚠️ 页面报错: ' + errs.slice(0, 3).join(' ;; ') : '\n✅ 无页面报错'));
await B.close();
process.exit(fail ? 1 : 0);
