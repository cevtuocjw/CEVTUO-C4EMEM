/**
 * 「选中一个软件之后，还有没有按键让我继续」。
 *
 * 读者 2026-10-13 原话（附了一张截图）：
 *   「我选中了一个软件，然后准备制作，但是**没有任何按键让我继续跟它处理功能**」
 *
 * ⚠️⚠️ 真因是一行：`$$('[data-prop]')` 把**方向行**（`.proprow`）也抓进来了，
 *     而方向行上**没有 `data-app`** ⇒ `undefined !== 'Terminal'` **永远成立**
 *     ⇒ 一选软件，方向行**全被隐藏** ⇒ 那一格变成空的。
 *     ⚠️ 而"空着"和"这个功能还没做"在界面上长得一模一样 —— 所以它活到了现在。
 *
 * ⚠️ 每条断言都要能回答「它怎么才会红」：
 *   · ① 去掉 propRow 里的 data-app ⇒ 立刻红（就是那个 bug）。
 *   · ② 去掉 paintPick 里那段空态 ⇒ 立刻红。
 *   · ③ 是 ② 的**负向对照**：选一个**本来就没有提案**的软件，必须说出下一步去哪点。
 *
 * 跑法：bun scripts/verify-prop-pick.mjs   （对着仓库版的开发服务器 8791）
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';

const B = process.env.BASE || 'http://127.0.0.1:8791';
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (extra ? '  ← ' + extra : ''))); };

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1380, height: 900 } })).newPage();
p.on('pageerror', (e) => console.log('  ⚠️ 页面报错：' + e.message));
await p.goto(B + '/', { waitUntil: 'load' });
await p.waitForTimeout(1200);

// ── 进「自我改进」那一屏 ──────────────────────────────────────
const entered = await p.evaluate(async () => {
  const btn = document.querySelector('.nv[data-v="selfimprove"]');
  if (btn) { btn.click(); return true; }
  return false;
});
if (!entered) { console.log('  ⚠️ 侧栏里没有 selfimprove —— 可能被"功能按来源放行"挡住了'); }
await p.waitForTimeout(2500);

const rows = await p.$$('.apick');
ok(rows.length > 0, '软件列表出来了（' + rows.length + ' 个）');

// ── ① 选一个有提案的软件（Terminal），方向行必须**还在** ────────
const term = await p.$('.apick[data-app="Terminal"]');
ok(!!term, '列表里有 Terminal');
if (term) {
  await term.click();
  await p.waitForTimeout(400);
  const seen = await p.evaluate(() => {
    const all = [...document.querySelectorAll('[data-prop]')];
    const visible = all.filter((c) => !c.hidden);
    return {
      total: all.length,
      visible: visible.length,
      rowsWithApp: [...document.querySelectorAll('.proprow')].map((r) => r.dataset.app ?? null),
      head: document.querySelector('#prophead')?.textContent || '',
    };
  });
  ok(seen.rowsWithApp.length === 0 || seen.rowsWithApp.every((a) => a !== null),
    '★ 每个方向行都带 data-app（不带 ⇒ 一选软件就全被隐藏）', JSON.stringify(seen.rowsWithApp));
  ok(seen.visible > 0, '★ 选中 Terminal 之后**还有东西显示**（' + seen.visible + '/' + seen.total + '）',
    '全被隐藏了 = 那个 bug');
  ok(/只看「Terminal」/.test(seen.head), '标题写着只看谁：' + seen.head);
}

// ── ② 点「就做它」⇒ 必须出现**能继续的动作键** ──────────────────
const pick = await p.$('.proprow[data-app="Terminal"] [data-pick]');
if (!pick) {
  // 方向行在，但可能已经被选过（PROP_ACTIVE 存在）⇒ 直接看块
  const hasBlock = await p.$('.propblock[data-app="Terminal"]');
  ok(!!hasBlock, '（已经选中过了，直接看块）');
} else {
  await pick.click();
  await p.waitForTimeout(700);
}
const block = await p.evaluate(() => {
  const el = document.querySelector('.propblock[data-app="Terminal"]');
  if (!el) return null;
  const btns = [...el.querySelectorAll('button')].map((b) => b.textContent.trim());
  return {
    hidden: el.hidden,
    hasChat: !!el.querySelector('[data-pq]'),
    hasSend: !!el.querySelector('[data-pask]'),
    hasPlan: !!el.querySelector('[data-pplan]') || !!el.querySelector('[data-pinst]'),
    hasName: !!el.querySelector('[data-pname]'),
    btns,
  };
});
ok(!!block, '选中之后出现那**一个块**');
if (block) {
  ok(!block.hidden, '块没被隐藏');
  ok(block.hasChat, '有一个可以接着说话的输入框（你说的"继续跟它处理"）', JSON.stringify(block.btns));
  ok(block.hasSend, '有「发送」');
  ok(block.hasPlan, '有「先出实现步骤」或「安装」', JSON.stringify(block.btns));
  ok(block.hasName, '名字是个可以自己写的输入框');
}

// ── ③ ★ 负向对照：选一个**本来就没有提案**的软件 ⇒ 空态必须说话 ──
const other = await p.$('.apick[data-app="Activity Monitor"]') || await p.$('.apick:not([data-app="Terminal"]):not([data-app="京麦"])');
if (other) {
  const name = await other.getAttribute('data-app');
  await other.click();
  await p.waitForTimeout(400);
  const st = await p.evaluate(() => {
    const pend = document.querySelector('#propend');
    const visible = [...document.querySelectorAll('[data-prop]')].filter((c) => !c.hidden).length;
    return { has: !!pend, hidden: pend?.hidden ?? true, text: pend?.textContent || '', visible };
  });
  if (st.visible === 0) {
    ok(st.has && !st.hidden, '★ 一条都不剩时，空态**替用户说了下一步**（' + name + '）');
    ok(/给选中的软件想功能/.test(st.text), '空态指向了那颗键', st.text.slice(0, 60));
  } else {
    console.log('  ⏭ 「' + name + '」本来就有提案，空态这条不适用（不是失败）');
  }
} else {
  console.log('  ⏭ 没有别的软件可选，空态这条跳过');
}

// ── ④ 截图存档（看图才算数） ─────────────────────────────────
await p.evaluate(() => { const r = document.querySelector('.apick[data-app="Terminal"]'); r && r.click(); });
await p.waitForTimeout(500);
await p.evaluate(() => {
  const c = document.querySelector('.card:has(#prophead)') || document.querySelector('#prophead')?.closest('.card');
  c && c.scrollIntoView({ block: 'center' });
});
await p.waitForTimeout(300);
await p.screenshot({ path: '/tmp/proppick.png' });
console.log('  📷 /tmp/proppick.png');

await b.close();
console.log('\n' + (fail === 0 ? `✅ ${pass}/${pass + fail} 通过` : `❌ ${pass} 通过 · ${fail} 失败`));
process.exit(fail ? 1 : 0);
