/**
 * 「功能管理」那一套 —— 暂时关闭 / 卸载 / 保留 30 天 / 一键装回来 / 主动式标记，
 * 外加「处理了 vs 略过」到底有没有区别。
 *
 * ⚠️⚠️ **这个脚本会先拍快照、收尾按快照还原。**
 *    上一个套件（verify-features）就是收尾 `del(...)` 把读者真装着的功能删光了，
 *    而且**全绿、零提示**。这里不许再发生一次。
 *
 * ⚠️ 判据是**服务端真的变了 + 界面真的不同**，不是"DOM 里有那个类"：
 *    · 「暂时关闭」⇒ 它从 `groups` 里消失，但进 `offItems`（关了 ≠ 删了）
 *    · 「卸载」   ⇒ 进 `removed` 且 daysLeft≈30，而且从 catalog 里消失（不许两处都出现）
 *    · 「处理了 / 略过」⇒ 三条 computed style 直接对比（背景/左边框/删除线）
 *
 * 跑：env -u HTTPS_PROXY … NO_PROXY='*' bun scripts/verify-manage.mjs
 * 负向对照：NEGCTL=1（把 CSS 里略过那条规则去掉 ⇒ "两者不同"必须红）
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'http://127.0.0.1:8770';
const CSS = '/Users/cjw/Documents/Cevtuo-C4emem/src/ui/app.css';
let restored = null;
if (process.env.NEGCTL) {
  const src = readFileSync(CSS, 'utf8');
  restored = src;
  // 把"略过"那条压成和"处理了"一模一样 ⇒ 「两者不同」那条断言必须红
  writeFileSync(CSS, src.replace(
    '.pcard.skipped{opacity:.55;border-style:dashed}',
    '.pcard.skipped{opacity:.55;border-left:3px solid var(--lime);border-style:solid}',
  ).replace('.pcard.skipped .pdetail{display:none}', '').replace(
    '.pcard.skipped .pdet{display:none}', '.pcard.skipped .pdet{display:block}',
  ).replace('.pcard.skipped .prowtop b{font-weight:400}', '.pcard.skipped .prowtop b{text-decoration:line-through;font-weight:400;opacity:.62}'));
}
const j = async (p, opt) => (await fetch(API + p, opt)).json();
const post = (p, body) => j(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

let pass = 0, fail = 0, skipNote = false;
const ok = (n, c, extra = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (extra ? '  ' + extra : '')); } };

// ── 快照：进来时装着什么，收尾就还原成什么 ──────────────────────
const snap = await j('/api/features');
const snapInstalled = [...(snap.installed || [])];
const snapOff = [...(snap.occupancy?.off ?? []), ...(snap.offItems || []).map((x) => x.id)];
const snapRemoved = (snap.removed || []).map((r) => r.id);
console.log('进来时：装着 ' + snapInstalled.join('/') + ' · 暂关 ' + (snapOff.join('/') || '无'));

try {
  // ── ① 数据形状 ────────────────────────────────────────────────
  ok('有 manage（内置 / 已装 分开列）', Array.isArray(snap.manage?.builtins) && Array.isArray(snap.manage?.installed));
  ok('保留期是 30 天', snap.retentionDays === 30, 'retentionDays=' + snap.retentionDays);
  ok('每个功能都带 off / proactive 两位',
    (snap.manage?.builtins || []).every((f) => typeof f.off === 'boolean' && typeof f.proactive === 'boolean'));
  ok('只读的功能不给"主动式"（links 有、但 subscribe 那种没做的不算）',
    (snap.manage?.builtins || []).find((f) => f.id === 'links')?.proactive === true &&
    (snap.manage?.builtins || []).find((f) => f.id === 'search')?.proactive !== true);

  // ── ② 暂时关闭（内置也能关）──────────────────────────────────
  await post('/api/features/toggle', { id: 'vocab', off: true });
  const a = await j('/api/features');
  ok('暂时关闭后：从侧栏的 groups 里消失', !a.groups.some((g) => g.items.some((i) => i.id === 'vocab')));
  ok('暂时关闭后：出现在 offItems 里（关 ≠ 删）', (a.offItems || []).some((i) => i.id === 'vocab'));
  ok('暂时关闭后：manage 里那个开关是 off', (a.manage.builtins.find((f) => f.id === 'vocab') || {}).off === true);
  await post('/api/features/toggle', { id: 'vocab', off: false });
  const b = await j('/api/features');
  ok('再打开：回到侧栏', b.groups.some((g) => g.items.some((i) => i.id === 'vocab')));
  ok('再打开：offItems 里没有了', !(b.offItems || []).some((i) => i.id === 'vocab'));

  // ── ③ 内置不许卸载（但要说明为什么）──────────────────────────
  const r1 = await fetch(API + '/api/features/vocab', { method: 'DELETE' }).then((x) => x.json());
  ok('内置功能卸载会被拒', !!r1.error);
  ok('拒绝时**说清它是内置的**（界面拿这句去提示"用暂时关闭"）', r1.builtin === true, JSON.stringify(r1));

  // ── ④ 卸载 → 保留 30 天 → 一键装回来 ─────────────────────────
  const victim = snapInstalled[snapInstalled.length - 1];
  ok('有可卸载的功能可测（读者确实装着几个）', !!victim, '装着=' + snapInstalled.join('/'));
  if (victim) {
    const name1 = (await fetch(API + '/api/features/' + encodeURIComponent(victim), { method: 'DELETE' }).then((x) => x.json()));
    ok('卸载成功', name1.ok === true, JSON.stringify(name1));
    const c = await j('/api/features');
    const rec = (c.removed || []).find((x) => x.id === victim);
    ok('卸载后进「待安装」', !!rec, JSON.stringify(c.removed));
    ok('保留期还剩约 30 天', rec && rec.daysLeft >= 29 && rec.daysLeft <= 30, 'daysLeft=' + rec?.daysLeft);
    ok('卸载后不带名字的话会只显示 id —— 这里带上了人话名字', rec && rec.name && rec.name !== victim, 'name=' + rec?.name);
    ok('卸载后**不再**出现在「可装」里（不许两处都有）', !(c.catalog || []).some((x) => x.id === victim));
    ok('卸载后侧栏没有它', !c.groups.some((g) => g.items.some((i) => i.id === victim)));
    const rr = await post('/api/features/restore', { id: victim });
    ok('一键装回来成功', rr.ok === true, JSON.stringify(rr));
    const d = await j('/api/features');
    ok('装回来之后：又在 installed 里', d.installed.includes(victim));
    ok('装回来之后：不在「待安装」里了', !(d.removed || []).some((x) => x.id === victim));
    ok('装回来之后：侧栏里也有了', d.groups.some((g) => g.items.some((i) => i.id === victim)));
  }

  // ── ⑤ 主动式标记 ─────────────────────────────────────────────
  await post('/api/features/proactive', { id: 'rec', on: false });
  const e = await j('/api/features');
  ok('内置功能的主动式可以关掉', e.manage.builtins.find((f) => f.id === 'rec').proactiveOn === false);
  const bad = await post('/api/features/proactive', { id: 'search', on: true });
  ok('做不了主动式的功能**明确拒绝**（不许默默接受）', !!bad.error, JSON.stringify(bad));
  ok('拒绝时说明了原因', /主动/.test(bad.error || ''), bad.error);
  await post('/api/features/proactive', { id: 'rec', on: true, note: '验收用的临时备注' });

  // ── ⑥ 界面：× 打开的是"二选一"，不是直接删 ──────────────────
  const br = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const p = await br.newPage({ viewport: { width: 1460, height: 920 } });
  const errs = [];
  p.on('pageerror', (e2) => errs.push(e2.message));
  await p.goto(API + '/', { waitUntil: 'load' });
  await p.waitForTimeout(1600);
  const del = p.locator('#navsections .fdel').first();
  ok('侧栏里每个功能都有那个「×」', await del.count() > 0);
  await del.click();
  await p.waitForTimeout(300);
  ok('点 × 弹出的是**二选一**', await p.locator('#featmenu').count() === 1);
  ok('里面有「暂时关闭」', await p.locator('#featmenu #fmOff').count() === 1);
  const menuText = await p.locator('#featmenu').innerText();
  ok('里面提到了"保留 30 天"或"内置卸不掉"这两件事之一', /30 天|内置/.test(menuText), menuText.slice(0, 80));
  await p.locator('#featmenu #fmCancel').click();

  // ── ⑦ 处理了 vs 略过：三条 computed style 必须不同 ───────────
  await p.evaluate(() => window.__app?.show ? window.__app.show('home') : null);
  // ⚠️ 等**条件**，不等秒数 —— `/api/stats` 在 891 篇上要算一会儿，
  //    固定等 1.2s 拿到 0 张卡时，"没等够"和"面板坏了"在输出里长得一模一样（纪律 18）。
  try { await p.waitForSelector('.pcard', { timeout: 10000 }); } catch { /* 下面会报出来 */ }
  // ⚠️ 先把筛选切到「全部」：默认那个"待处理"筛会把改成 done/skipped 的卡片 `hidden`，
  //    而**隐藏元素的 `.pdet` 也算 `display:none`** ⇒ "略过把细节收起来"那条会假绿。
  await p.locator('#pfilter button[data-f="all"]').click().catch(() => {});
  await p.waitForTimeout(200);
  // ⚠️⚠️ 必须走**真的按钮**（它会 renderKb），不能自己 fetch 之后读 DOM ——
  //    自己 fetch 的话 DOM 根本没重画，两边读到的是**同一张卡**，
  //    于是"两者不同"要么假红要么假绿（我第一版就是这么写的）。
  const styles = await p.evaluate(async () => {
    const read = (c) => {
      const t = c.querySelector('.prowtop b');
      const cs = getComputedStyle(c), ts = getComputedStyle(t);
      const det = c.querySelector('.pdet');
      return { op: cs.opacity, bl: cs.borderLeftColor + '/' + cs.borderLeftWidth,
        td: ts.textDecorationLine, det: det ? getComputedStyle(det).display : '(没有细节行)' };
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const cards = [...document.querySelectorAll('.pcard')];
    const target = cards.find((c) => c.dataset.pst === 'new');
    if (!target) return { none: true, total: cards.length, psts: cards.map((c) => c.dataset.pst) };
    const id = target.dataset.pid;
    const find = () => [...document.querySelectorAll('.pcard')].find((c) => c.dataset.pid === id);
    const press = async (st, cls) => {
      const el = find(); if (!el) return null;
      const btn = el.querySelector('[data-st="' + st + '"]');
      if (!btn) return null;
      btn.click();
      for (let i = 0; i < 40 && !find().classList.contains(cls); i += 1) await wait(100);
      return read(find());
    };
    const done = await press('done', 'done');
    await press('new', 'new');            // ⚠️ 还原成"待处理"，不动读者的数据
    const skip = await press('skipped', 'skipped');
    await press('new', 'new');            // ⚠️ 再还一次
    return { done, skip, total: cards.length, back: find()?.dataset.pst };
  });
  if (styles.none) { console.log('  ⚠️ 没有“待处理”的卡片可试 —— 跳过那三条（记成跳过，不算通过）'); skipNote = true; }
  else {
    ok('「处理了」和「略过」的透明度/左边框**不一样**', styles.done.bl !== styles.skip.bl || styles.done.op !== styles.skip.op,
      `done=${JSON.stringify(styles.done)} skip=${JSON.stringify(styles.skip)}`);
    ok('「处理了」是划掉的', styles.done.td.includes('line-through'));
    ok('「略过」**没有**划掉（它没完成）', !styles.skip.td.includes('line-through'));
    ok('「略过」把细节收起来了', styles.skip.det === 'none' && styles.done.det !== 'none', `skip.det=${styles.skip.det} done.det=${styles.done.det}`);
  }
  ok('没有页面报错', errs.length === 0, errs.slice(0, 2).join(' | '));
  await br.close();
} catch (e) {
  fail++;
  console.log('  ✗ 跑不起来：' + e.message);
} finally {
  if (restored) writeFileSync(CSS, restored);
  // ── 还原：先恢复"暂时关闭"，再按快照对齐 installed ──────────────
  try {
    const now = await j('/api/features');
    for (const it of now.offItems || []) {
      if (!snapOff.includes(it.id)) await post('/api/features/toggle', { id: it.id, off: false });
    }
    for (const id of snapOff) await post('/api/features/toggle', { id, off: true });
    for (const id of (now.installed || [])) {
      if (!snapInstalled.includes(id)) await fetch(API + '/api/features/' + encodeURIComponent(id), { method: 'DELETE' });
    }
    for (const id of snapInstalled) {
      if (!(now.installed || []).includes(id)) await post('/api/features/restore', { id });
    }
    for (const id of snapRemoved) {
      if (!(await j('/api/features')).removed.some((r) => r.id === id)) await post('/api/features/restore', { id });
    }
    const back = await j('/api/features');
    console.log('\n还原后：装着 ' + back.installed.join('/') + ' · 暂关 ' + ((back.offItems || []).map((x) => x.id).join('/') || '无'));
  } catch (e) { console.log('⚠️ 还原失败（要手工看一眼）：' + e.message); }
}

console.log(`\n${pass}/${pass + fail} 通过` + (skipNote ? ' · 1 组跳过（面板里没有待处理条目）' : ''));
process.exit(fail ? 1 : 0);
