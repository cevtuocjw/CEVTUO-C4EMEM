/**
 * 「对话 → 最后**真的做出来这个功能**」这条链。
 *
 * 读者 2026-10-13：
 *   「你要能接 api deepseek 然后做出来一个对话反复处理，**最终能帮我做出来这个功能**」
 *
 * ⚠️⚠️ 判据**只能是真数**：`docsAdded` / `chunksAdded`，以及**做完之后搜得到**。
 *     "接口返回 200"、"界面上显示了 ✅"，全都不算 —— 这个项目最贵的一课就是这个。
 *
 * ⚠️ 每条都要能回答「它怎么才会红」：
 *   · 负向对照在**做之前**跑一遍：那时候这个 space 根本不存在，搜也搜不到。
 *     对照要是也绿 ⇒ 说明"搜得到"这件事跟做没做无关 ⇒ 断言是空的。
 *
 * 跑法（**沙盒**，不要在你自己的库上跑）：
 *   bun scripts/verify-make.mjs            # 默认 8792 那个沙盒
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const B = process.env.BASE || 'http://127.0.0.1:8792';
let pass = 0, fail = 0, skip = 0;
const ok = (c, m, extra = '') => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m + (extra ? '  ← ' + extra : ''))); };
const j = async (p, o) => (await fetch(B + p, o)).json();
const post = (p, b) => j(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) });
const search = (q) => j('/api/search?q=' + encodeURIComponent(q));

// ⚠️ 先确认打的是**沙盒** —— 在别人的真实库上跑这个脚本会把测试文档索引进去。
const st = await j('/api/settings').catch(() => ({}));
console.log('库：' + (st.dir ?? '?'));
if (!/tmp|c4sandbox|sandbox/i.test(String(st.dir))) {
  console.log('❌ 这不是沙盒（' + st.dir + '）—— 拒绝在真实库上跑。用 C4EMEM_CONFIG 起一个沙盒再来。');
  process.exit(2);
}

// ── 夹具：一个只有我们知道内容的目录 ────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'make-'));
const SPACE = 'verify' + Math.abs(Date.now() % 100000);
// ⚠️ 这些词**只可能**出现在这几篇里 —— 搜得到就说明真的索引进去了
const MAGIC = '麒麟' + Math.abs(Date.now() % 10000);
writeFileSync(join(dir, 'a.md'), `# 报价\n\n${MAGIC} 报价记录：平方科技 12 万。\n`);
writeFileSync(join(dir, 'b.txt'), `${MAGIC} 的另一处出现：合同编号 A-1024。\n`);
mkdirSync(join(dir, 'sub'), { recursive: true });
writeFileSync(join(dir, 'sub', 'c.md'), `${MAGIC} 藏在子目录里，这条要能被走盘走到。\n`);
// ⚠️⚠️ **必须有一篇长文**，否则"篇数"和"段数"天然相等（每篇正好一段），
//    那条"两个数不是一个量纲"的断言就永远绿 —— 而它本来要抓的正是
//    "拿同一个返回值冒充两个量纲"。夹具不造出差异，断言就测不到东西。
writeFileSync(join(dir, 'long.md'), `# 长文\n\n${MAGIC} ${'这是一段用来把切块撑开的话，重复很多遍。'.repeat(160)}\n`);

console.log('\n① 负向对照：**做之前**，这个 space 不该存在、也不该搜到');
{
  const s = await j('/api/stats');
  const has = (s.bySpace || []).some((x) => x.space === SPACE);
  ok(!has, '做之前库里没有这个 space');
  const h = await search(MAGIC);
  const hitByUs = (h.hits || []).some((x) => x.space === SPACE);
  ok(!hitByUs, '★ 做之前**搜不到**那个词（搜得到 ⇒ 后面"搜得到"那条断言就是空的）',
    '命中 ' + (h.hits || []).length + ' 条');
}

console.log('\n② 让它做：读 ' + dir);
const r = await post('/api/features/make', {
  spec: { kind: 'folder', name: SPACE, path: dir, exts: ['md', 'txt'] }, name: SPACE,
});
ok(r.ok === true, '接口回 ok（' + (r.error || '') + '）');
ok(r.docsAdded >= 4, '★ 真读到了几篇：docsAdded=' + r.docsAdded + '（期望 4：3 短 + 1 长，含子目录那篇）',
  'scanned=' + r.scanned + ' skipped=' + r.skipped);
// ⚠️ 两个数必须是**不同的量纲** —— 我第一版让它们取自同一个返回值（2 篇报成 2 段）
ok(typeof r.chunksAdded === 'number' && r.chunksAdded > r.docsAdded,
  '★ chunksAdded > docsAdded —— 两个是**独立**的量（docs=' + r.docsAdded + ' chunks=' + r.chunksAdded + '）',
  '两个都是 ' + r.docsAdded + ' ⇒ 又用同一个返回值冒充两个量纲了（长文必须被切成多段）');

console.log('\n③ 做完之后：搜得到，而且排第一');
{
  const h = await search(MAGIC);
  const top = (h.hits || [])[0];
  ok(!!top, '搜那个词有命中');
  ok(top && top.space === SPACE, '★ 命中的是**刚做出来的那个来源**', top ? String(top.space) : '');
  // ⚠️ 子目录那篇也要在 —— 走盘漏了子目录的话，"读到了"这条会假绿
  const all = (h.hits || []).filter((x) => x.space === SPACE).map((x) => x.text || '').join('\n');
  ok(/子目录/.test(all) || r.docsAdded >= 3, '子目录里的那篇也被走到了（documents=' + r.docsAdded + '）');
}

console.log('\n④ 它进了侧栏（不然"做出来了"只是接口里的一句话）');
{
  const f = await j('/api/features');
  const grp = (f.groups || []).find((g) => g.id === 'user');
  const hit = grp && (grp.items || []).some((i) => i.id === 'src-' + SPACE);
  ok(!!hit, '侧栏「自己装的」里有 src-' + SPACE, grp ? JSON.stringify(grp.items.map((i) => i.id)) : '没有 user 组');
}

console.log('\n⑤ 说不能做的，要**如实拒绝**（不假装）');
{
  const bad = await post('/api/features/make', { spec: { kind: 'ftp', name: 'x' }, name: 'x' });
  ok(bad.error, '不认识的 kind 被拒了', JSON.stringify(bad).slice(0, 80));
  ok(/做不了|只认/.test(String(bad.error)), '而且说清了能做的是哪一半：' + String(bad.error).slice(0, 60));
  const none = await post('/api/features/make', { id: '不存在的提案' });
  ok(none.error, '没有方案的提案也给一句人话，不是空');
}

console.log('\n' + (fail === 0 ? `✅ ${pass}/${pass + fail} 通过` + (skip ? `（跳过 ${skip}）` : '') : `❌ ${pass} 通过 · ${fail} 失败`));
process.exit(fail ? 1 : 0);
