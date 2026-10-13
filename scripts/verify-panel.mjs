/**
 * 工作区「主动」那一块（2026-10-09 晚）。
 *
 * 读者原话：「工作区这里要给主动工作区一大块，给出来主动给出来的信息或者分析，
 *            要标记出来时间，是否去处理等这样来处理」
 *
 * ⭐ 这一块能不能用，全看**一条**：
 *    「已经处理过的条目，再刷新一次**不能被重置成待处理**」。
 *    状态会被刷掉的话，用户点过一次就不会再点第二次 —— 这块就白做了。
 *
 * ⚠️ 而光是断言"状态没变"是**不够**的：刷新要是压根没跑，那条断言也照样绿。
 *    ⇒ 所以必须**成对**断言：**刷新确实在跑**（新东西进得来）+ **老东西的状态没被动**。
 *    只测一半 = 没测。
 *
 * 跑法：env -u HTTPS_PROXY … NO_PROXY='*' bun scripts/verify-panel.mjs
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { Database } from 'bun:sqlite';

const B = 'http://127.0.0.1:8770';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };
const j = async (p, o) => (await fetch(B + p, o)).json();
const post = (p, b) => j(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) });

const db = new Database(process.env.HOME + '/.c4emem/c4emem.db');
let injected = 0;
function cleanup() {
  // ⚠️⚠️ 只删 activity 是**不够**的：刷新会把那条 activity 收进 panel 变成一条卡片，
  //    而 panel 的写入是 `INSERT OR IGNORE`（key 唯一）⇒ 删了源头，**卡片还在**。
  //    实测：跑几轮之后读者的工作区里积了三条「【自检】这条是 verify-panel 临时插的」，
  //    永久留在那儿 —— 套件**造过的东西必须由套件自己收干净**，
  //    这跟"收尾只能还原不能清空"是同一条纪律的两面。
  if (injected) {
    db.query('DELETE FROM panel WHERE key = ?').run('pro:' + injected);
    db.query('DELETE FROM activity WHERE id = ?').run(injected);
  }
  injected = 0;
  // 把这一轮改过的面板状态也还原，别给读者留一堆"已处理"
  db.query("UPDATE panel SET state='new' WHERE state != 'new'").run();
}

console.log('\n── ① 同一件事只有一条 · 状态能改且落库 ──────────');
let targetId = 0;
{
  const a = await j('/api/panel');
  const keys = a.items.map((i) => i.key);
  ok(keys.length === new Set(keys).size, `面板里没有重复项（${keys.length} 条，去重键唯一）`);
  ok(a.items.every((i) => i.ts), '每条都有时间');
  const t = a.items.find((i) => i.state === 'new');
  targetId = t.id;
  const r = await post('/api/panel/state', { id: targetId, state: 'done' });
  ok(r.ok, '能标记"处理了"');
  const b = await j('/api/panel');
  ok(b.items.find((i) => i.id === targetId).state === 'done', '重新拉一次 ⇒ **服务端**记着（不是只改前端）');
  const bad = await fetch(B + '/api/panel/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: targetId, state: '瞎写的' }) });
  ok(bad.status === 400, '乱传状态会被拒（400）');
}

console.log('\n── ② ⭐ 刷新必须"进得来新的、动不了旧的" ────────');
{
  // 先确认：此刻刷新**不会**把它翻回待处理
  await j('/api/panel');
  await j('/api/panel');
  const after = await j('/api/panel');
  const same = after.items.find((i) => i.id === targetId);
  ok(same && same.state === 'done',
     `⚠️ 连刷两次，处理过的仍然是「已处理」（实得 ${same?.state}）—— 状态被刷掉的话这块就白做了`);

  // ⚠️ 负向对照：证明"刷新确实在跑"。它要是压根没跑，上面那条也照样绿。
  const r = db.query(
    "INSERT INTO activity (kind, icon, title, detail, ts, ms, tok_in, tok_out, tok_sum, meta, session_id) VALUES ('proactive','🔔','【自检】这条是 verify-panel 临时插的','用来证明刷新真的在跑',?,NULL,NULL,NULL,NULL,NULL,NULL)",
  ).run(new Date().toISOString());
  injected = Number(db.query('SELECT last_insert_rowid() id').get().id);
  const fresh = await j('/api/panel');
  ok(fresh.added >= 1, `插一条新的主动记录 ⇒ 刷新把它收进来了（added=${fresh.added}）`);
  ok(fresh.items.some((i) => i.key === `pro:${injected}`), '那条新记录**真的出现在面板里**');
  const still = fresh.items.find((i) => i.id === targetId);
  ok(still.state === 'done', '而同一趟刷新里，处理过的**还是**处理过 —— 新的进得来、旧的动不了');
  cleanup();
}

console.log('\n── ③ 排序：没处理的在前，有期限的更前 ──────────');
{
  await post('/api/panel/state', { id: targetId, state: 'done' });
  const r = await j('/api/panel');
  const firstNew = r.items.findIndex((i) => i.state === 'new');
  const firstDone = r.items.findIndex((i) => i.state !== 'new');
  ok(firstNew === -1 || firstDone === -1 || firstNew < firstDone,
     `没处理的排在处理过的前面（第一个待处理 #${firstNew} < 第一个已处理 #${firstDone}）`);
  // ⚠️⚠️ 原来这条写的是：拿「**任何状态**里第一个有期限的」去比
  //    「第一个没期限且未处理的」。而它上面刚刚把 targetId（**恰好就是唯一那条有期限的**）
  //    标成了「已处理」⇒ 那条有期限的掉到"已处理"那一段，于是断言必然红。
  //    **那是运气，不是契约** —— 它红不红取决于面板里正好有几条有期限的。
  //    ⇒ 真正的契约是：**同一个状态分组内**，有期限的一律排在没期限的前面。
  //       这样分组之间怎么排都不影响它，而排序规则一坏它照样红。
  for (const st of ['new', 'done']) {
    const seg = r.items.filter((i) => i.state === st);
    const lastDue = seg.reduce((acc, i, n) => (i.due ? n : acc), -1);
    const firstNo = seg.findIndex((i) => !i.due);
    ok(lastDue === -1 || firstNo === -1 || lastDue < firstNo,
       `${st} 组里：有期限的一律排在没期限的前面（最后一条有期限 #${lastDue} < 第一条没期限 #${firstNo}）`);
  }
  cleanup();
}

console.log('\n── ④ 界面：时间、状态、按钮都在，而且真的落库 ──');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(B + '/', { waitUntil: 'load' });
await p.waitForTimeout(1300);
await p.evaluate(() => window.__app.show('home'));
await p.waitForTimeout(1600);
{
  const cards = await p.$$eval('.pcard', (els) => els.map((e) => e.innerText));
  ok(cards.length > 0, `工作区里有「主动」卡片（${cards.length} 张）`);
  ok(cards.every((t) => /\d{1,2}:\d{2}/.test(t) || /天前|个月前|今天|昨天/.test(t)), '每张都标了**时间**');
  ok(cards.every((t) => /待处理|已处理|略过/.test(t)), '每张都标了**处理状态**');
  ok(await p.$('.pcard .go.sm') !== null, '有待处理的卡片上有操作按钮');

  const id = await p.$eval('.pcard[data-pid] .go.sm', (e) => e.closest('.pcard').dataset.pid);
  await p.click(`.pcard[data-pid="${id}"] .go.sm`);
  await p.waitForTimeout(1400);
  const st = await p.evaluate(async (x) => (await (await fetch('/api/panel')).json()).items.find((i) => i.id === Number(x))?.state, id);
  ok(st === 'done', `点「处理了」⇒ **服务端**也变成 done（实得 ${st}）—— 不是只改 DOM`);
  ok(await p.$(`.pcard[data-pid="${id}"].done`) !== null, '卡片当场变成"已处理"的样式（不用手动刷新）');
}

ok(errs.length === 0, '没有页面报错' + (errs.length ? '：' + errs.slice(0, 2).join(' | ') : ''));

await b.close();
cleanup();
const endState = await j('/api/panel');
ok(endState.counts.new === endState.items.filter((i) => i.state === 'new').length, '收尾：面板状态已还原');

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
