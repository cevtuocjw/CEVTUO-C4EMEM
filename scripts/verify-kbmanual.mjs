/**
 * 手写条目（主题 / 词条 / 链接）—— 2026-10-09。
 *
 * 判据是**契约**，不是"点了有反应"：
 *   ① 手写的住一个**生成脚本不碰**的文件 ⇒ 重跑冲不掉它。
 *      最硬的一条：把 out/vocab.json **掏空**（模拟"重跑出来是空的"），
 *      手写那条**照样在**。这证明它不依赖产物，而不是"碰巧没被覆盖"。
 *   ② 保存之后**重新从服务端拉**才算数 ⇒ 断言的是"刷新之后还在"。
 *   ③ 负向对照：删掉之后**真的没了** —— 不然"列表里有一条"可能只是没重画。
 *
 * 跑法：env -u HTTPS_PROXY … NO_PROXY='*' bun scripts/verify-kbmanual.mjs
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const B = 'http://127.0.0.1:8770';
const OUT = new URL('../out/', import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };
const j = async (p, o) => (await fetch(B + p, o)).json();
const post = (p, b) => j(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const del = (p) => j(p, { method: 'DELETE' });

const TAG = 'zz-verify-' + Math.random().toString(36).slice(2, 6);
const created = { vocab: [], links: [], tax: [] };
/** 收尾：把这一轮加的东西全删掉，别把测试数据留在读者的库里。 */
async function cleanup() {
  for (const [kind, ids] of Object.entries(created)) {
    for (const id of ids) await del(`/api/kb/manual?kind=${kind}&id=${encodeURIComponent(id)}`).catch(() => {});
  }
}

console.log('\n── A. 服务端契约 ──────────────────────────────');

// A1 校验：空条目要被拒，且**说得出缺什么**
const bad = await fetch(B + '/api/kb/manual', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'vocab', item: {} }),
});
const badBody = await bad.json();
ok(bad.status === 400 && /至少填一个/.test(badBody.error || ''), `空词条被拒且说明原因（${bad.status}「${badBody.error}」）`);

// A2 加一条 → GET 能看到
const r1 = await post('/api/kb/manual', { kind: 'vocab', item: { en: TAG, zh: '验证用词条', note: '来自 verify-kbmanual' } });
ok(r1.ok && r1.entry?.manual === true, '加一条词条成功');
created.vocab.push(r1.entry.id);
const list1 = await j('/api/kb/manual?kind=vocab');
ok(list1.items.some((x) => x.id === r1.entry.id), 'GET /api/kb/manual 拿得到刚加的那条');

// A3 幂等：一模一样再加一次 ⇒ **不能变成两条**
const r2 = await post('/api/kb/manual', { kind: 'vocab', item: { en: TAG, zh: '验证用词条' } });
const list2 = await j('/api/kb/manual?kind=vocab');
ok(r2.deduped === true && r2.entry.id === r1.entry.id, '重复添加 ⇒ 认出来是重复（deduped）');
ok(list2.items.filter((x) => x.id === r1.entry.id).length === 1, '重复添加之后**仍然只有一条**');

// A4 合并：产物接口里看得到它，而且带 manual 标记
const v = await j('/api/vocab?q=' + encodeURIComponent(TAG));
ok(v.entries.some((e) => e.en === TAG && e.manual === true), '/api/vocab 里能看到手写那条（带 manual 标记）');
ok(v.manualCount >= 1, `manualCount 如实报出来（${v.manualCount}）`);

// A5 ⭐ 手写一条**自动提取里本来就有**的 ⇒ 要说出"早就在了"（截图上发现的：
//    两行一模一样并排出现，用户只看到"重复"，不知道是自己刚加的）
const auto = (await j('/api/vocab')).entries.find((e) => e.manual !== true && e.en && e.zh);
const r5 = await post('/api/kb/manual', { kind: 'vocab', item: { en: auto.en, zh: auto.zh } });
ok(r5.ok && r5.existing && r5.existing.space === auto.space,
   `手写一条自动里本来就有的 ⇒ 会告诉你早就在（来自 ${auto.space} ${auto.date}）`);
ok(!r5.deduped, '它和"你手写过一条"是两回事（deduped 为 false）—— 这两种要说成不一样的话');
created.vocab.push(r5.entry.id);

console.log('\n── B. 「重跑生成冲不掉」到底靠什么 ──────────────');

// B1 结构性保证：三个生成脚本**从来不开** manual.json
const scripts = ['taxonomy.ts', 'extract-vocab.ts', 'classify-links.ts'];
const touching = scripts.filter((f) => /manual\.json|kbmanual/.test(readFileSync(OUT + '../scripts/' + f, 'utf8')));
ok(touching.length === 0, `三个生成脚本都不碰 manual.json（碰了的：${touching.join(',') || '无'}）`);

// B2 真重跑一次词条提取 —— 最便宜的生成器（不花 LLM）
const before = JSON.parse(readFileSync(OUT + 'vocab.json', 'utf8')).entries.length;
let reran = '';
try {
  reran = execSync('bun scripts/extract-vocab.ts', { cwd: OUT + '..', encoding: 'utf8', stdio: 'pipe' });
} catch (e) { reran = 'FAILED: ' + e.message; }
const after = JSON.parse(readFileSync(OUT + 'vocab.json', 'utf8')).entries.length;
const v2 = await j('/api/vocab?q=' + encodeURIComponent(TAG));
ok(!/FAILED/.test(reran), '真重跑 scripts/extract-vocab.ts 成功');
ok(v2.entries.some((e) => e.en === TAG), `重跑之后手写那条还在（产物 ${before} → ${after} 条）`);
// ⚠️ 它**不该**出现在产物文件里 —— 那才是它冲不掉的原因
ok(!JSON.parse(readFileSync(OUT + 'vocab.json', 'utf8')).entries.some((e) => e.en === TAG),
   '手写那条**不在** out/vocab.json 里（住别处，所以覆盖写碰不到它）');

// B3 ⭐ 最强的对照：把产物**掏空**，手写那条必须照样在
const backup = readFileSync(OUT + 'vocab.json');
try {
  writeFileSync(OUT + 'vocab.json', JSON.stringify({ total: 0, scannedLines: 0, entries: [] }), 'utf8');
  const v3 = await j('/api/vocab?q=' + encodeURIComponent(TAG));
  ok(v3.entries.some((e) => e.en === TAG), '⚠️ 产物被掏空 ⇒ 手写那条**照样在**（它不依赖产物）');
  const v4 = await j('/api/vocab');
  ok(v4.total === v4.manualCount, `掏空后总数＝手写数（${v4.total} = ${v4.manualCount}），没混进别的东西`);
} finally {
  // ⚠️ 恢复必须在 finally —— 否则会留下一份空产物，而没人会知道
  writeFileSync(OUT + 'vocab.json', backup);
}
const vBack = await j('/api/vocab');
ok(vBack.total > 500, `产物已恢复（${vBack.total} 条）`);

console.log('\n── C. 界面（三个视图都能手写）──────────────────');

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(B + '/', { waitUntil: 'load' });
// 「融合」= 全部来源 ⇒ 读知识库那五个不会灰（不然点进去是"为什么不能点"）
await p.evaluate(() => localStorage.setItem('c4emem.src', 'blend'));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(900);

const openView = async (v) => {
  await p.click(`.nv[data-v="${v}"]`);
  await p.waitForTimeout(700);
};
const mrows = () => p.$$eval('.mrow', (els) => els.map((e) => e.textContent));
const toastTxt = () => p.evaluate(() => document.querySelector('#toast')?.textContent || '');

// C1 三个视图都有手写块
for (const v of ['vocab', 'tax', 'links']) {
  await openView(v);
  ok(await p.$('#manAdd') !== null, `「${v}」视图里有「＋ 手动添加」`);
}

// C2 在词条视图里真的加一条
await openView('vocab');
const rows0 = (await mrows()).length;
await p.click('#manAdd');
await p.waitForTimeout(200);
await p.fill('[data-mf="en"]', TAG + '-ui');
await p.fill('[data-mf="zh"]', '界面加的词条');
await p.click('#manSave');
await p.waitForTimeout(900);
const rows1 = await mrows();
ok(rows1.length === rows0 + 1, `保存后列表多了一条（${rows0} → ${rows1.length}）`);
ok(rows1.some((t) => t.includes(TAG + '-ui')), '列表里能看到刚写的那条');
ok(await p.$('.badge.bman') !== null, '手写条目标着「手动」角标');
// ⚠️ 参数要**传进去** —— 回调是在浏览器里跑的，那里没有 Node 这边的 TAG
ok(await p.$eval('#out', (e, tag) => e.textContent.includes(tag), TAG + '-ui'), '下面的词条表里也有它（合并生效）');

// C3 ⭐ 刷新之后还在 —— 判据是**服务端那份**，不是 DOM 里那行
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(900);
// ⚠️ 刷新之后视图会回到默认那一屏 —— 不重开的话 `.mrow` 是空的，
//    那会是一条**假红**："刷新之后不见了"和"我没在看那一屏"长得一模一样。
await openView('vocab');
ok((await mrows()).some((t) => t.includes(TAG + '-ui')), '刷新之后它还在（说明真存到服务端了）');

// C4 重复添加 ⇒ 说明白是重复，且不变成两条
const beforeDup = (await mrows()).length;
await p.click('#manAdd');
await p.waitForTimeout(200);
await p.fill('[data-mf="en"]', TAG + '-ui');
await p.fill('[data-mf="zh"]', '界面加的词条');
await p.click('#manSave');
await p.waitForTimeout(900);
ok((await mrows()).length === beforeDup, '重复添加不会变成两条');
ok(/手写过一条一模一样的/.test(await toastTxt()), `重复时会说清楚（实得「${(await toastTxt()).slice(0, 24)}」）`);

// C5 空输入 ⇒ 说得出为什么，且**没有**多出一条
const beforeBad = (await mrows()).length;
await p.click('#manAdd');
await p.waitForTimeout(200);
await p.click('#manSave');
await p.waitForTimeout(900);
ok((await mrows()).length === beforeBad, '空输入不会存进去一条空的');
ok(/至少填一个/.test(await toastTxt()), `空输入会说明原因（实得「${(await toastTxt()).slice(0, 24)}」）`);

// C6 ⭐ 负向对照：删掉之后**真的没了**（不然"有一条"可能只是没重画）
const beforeDel = (await mrows()).length;
await p.click('.mrow .xdel');
await p.waitForTimeout(900);
const afterDel = await mrows();
ok(afterDel.length === beforeDel - 1 && !afterDel.some((t) => t.includes(TAG + '-ui')),
   `删掉之后真的没了（${beforeDel} → ${afterDel.length}）`);
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(900);
await openView('vocab');
ok(!(await mrows()).some((t) => t.includes(TAG + '-ui')), '刷新之后也确认没了（不是只从 DOM 里抹掉）');

// C7 另外两个视图也能加
// ⚠️ 链接那一行显示的是**域名**（服务端从 url 里取出来的），所以标记要放进域名里 ——
//    放路径里的话列表上根本看不见它，断言就会假红。
for (const [v, field, val] of [['links', 'url', `https://${TAG}.example.com/`], ['tax', 'name', TAG + '-主题']]) {
  await openView(v);
  const n0 = (await mrows()).length;
  await p.click('#manAdd');
  await p.waitForTimeout(200);
  await p.fill(`[data-mf="${field}"]`, val);
  await p.click('#manSave');
  await p.waitForTimeout(900);
  const n1 = await mrows();
  ok(n1.length === n0 + 1 && n1.some((t) => t.includes(TAG)), `「${v}」视图里加得进去`);
  const lst = await j(`/api/kb/manual?kind=${v === 'links' ? 'links' : 'tax'}`);
  const mine = lst.items.find((x) => JSON.stringify(x).includes(TAG));
  if (mine) created[v].push(mine.id);
}

// C8 手写的链接要真的进到类别列表里
const lt = await j('/api/link-taxonomy');
const hasLink = JSON.stringify(lt).includes(TAG);
ok(hasLink, '手写的链接进到了链接库的类别里（不是只挂在「手写」那一块）');

// ⚠️ C5 **故意**发了一次会被拒的请求（400 是预期行为）。
//    所以不能简单地说"零报错" —— 那要么假红、要么把真报错一起静音掉。
//    判据收紧成：400 **恰好一次**，且除此之外一条都不许有。
const bad400 = errs.filter((e) => /400 \(Bad Request\)/.test(e));
const other = errs.filter((e) => !/400 \(Bad Request\)/.test(e));
ok(bad400.length === 1, `只有 C5 那次故意的 400（实得 ${bad400.length} 次）`);
ok(other.length === 0, '没有别的页面报错' + (other.length ? '：' + other.slice(0, 2).join(' | ') : ''));

await b.close();
await cleanup();

// 收尾后再确认一次：测试数据清干净了
const vEnd = await j('/api/vocab?q=' + encodeURIComponent(TAG));
ok(vEnd.entries.length === 0, '收尾：测试加的词条都删干净了');

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
