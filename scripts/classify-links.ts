/**
 * 链接归类：每个域名是什么、属于哪一类、大概为什么被记下来。
 *
 * 输入 = 域名 + 抓到的标题 + （前 300 个热门域名）一条真实上下文
 * 输出 = out/link-taxonomy.json + out/links.md
 *
 * ⚠️ 分批送，每批用**编号**回接（不要用域名当键 —— 上一轮就是栽在
 *    "拿给模型看的字符串当联结键"上，会静默丢数据）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config';
import { createLlm } from '../src/llm';

const outDir = join(process.cwd(), 'out');
const links = JSON.parse(readFileSync(join(outDir, 'links.json'), 'utf8'));
const titles: Record<string, any> = JSON.parse(readFileSync(join(outDir, 'link-titles.json'), 'utf8'));

const cfg = loadConfig();
const llm = createLlm(cfg);
if (!llm) throw new Error('需要 LLM key');

// 每个域名配一条真实上下文（优先用出现最多的那个 URL 的那一行）
const ctx = new Map<string, string>();
for (const l of links.links) {
  if (ctx.has(l.domain)) continue;
  const t = [l.line, l.prev].filter(Boolean).join(' / ').trim();
  if (t) ctx.set(l.domain, t.slice(0, 110));
}

const rows = links.domainTable.map((d: any, i: number) => ({
  i,
  domain: d.domain,
  n: d.urlCount,
  title: titles[d.domain]?.ok ? titles[d.domain].title : '',
  ctx: d.urlCount >= 3 ? ctx.get(d.domain) ?? '' : '',
}));

const CANDIDATES = [
  '前端/网页设计灵感', '开发/代码/开源', 'AI/大模型', '资讯/新闻', '百科/参考',
  '论文/研究', '社交/视频/图片站', '购物/品牌/时尚', '工具/在线服务', '学习/课程',
  '设计/艺术/摄影', '金融/商业', '其他',
];

/**
 * ⚠️ 批大小是有上限的，而且是**输出**那一侧的上限。
 *
 * 第一版用 55 个/批 → 每项 JSON 约 40 token → 一批要 2000+ token，
 * 而 `llm.maxTokens` 是 1200 ⇒ **输出被截断、JSON 解不开**，
 * 1826 个域名里 **440 个直接没归类**。
 * 症状是"部分成功"，很容易被当成随机失败；真因是确定的算术。
 * ⇒ 批降到 24，并且失败时**对半再试**（而不是整批丢掉）。
 */
async function classifyBatch(batch: any[]): Promise<{ i: number; cat: string; what: string }[]> {
  const list = batch
    .map((r) => `${r.i}|${r.domain}|${r.title || '(没抓到标题)'}${r.ctx ? '|' + r.ctx : ''}`)
    .join('\n');
  const raw = await llm!.chat([
    {
      role: 'system',
      content:
        '你在给一个中文用户的收藏链接做归类。这个用户主要记录：AI/科技、网页前端与设计灵感、购物时尚、艺术。只输出 JSON 数组。',
    },
    {
      role: 'user',
      content: `给下面每个链接判断：它是什么网站、属于哪一类。

格式：编号|域名|标题|（可选）用户当时的上下文
${list}

类别请从这里选：
${CANDIDATES.join('、')}

⚠️ 特别注意区分：
· "前端/网页设计灵感" = 网页做得好看、动效、作品集、设计工作室官网、获奖网站
· "设计/艺术/摄影"   = 图片素材、平面、艺术史、摄影作品

只输出 JSON 数组，每项：
{"i":编号,"cat":"类别","what":"这个链接是什么（不超过18字）"}

必须覆盖给出的每一个编号，一个都不能少。`,
    },
  ]);
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('no json array');
  const arr = JSON.parse(m[0]);
  const out: { i: number; cat: string; what: string }[] = [];
  for (const o of arr) {
    if (typeof o.i === 'number' && rows[o.i]) out.push({ i: o.i, cat: o.cat || '其他', what: o.what || '' });
  }
  // 数量对不上也当失败 —— 否则会**静默少几个**
  if (out.length < batch.length) throw new Error(`只回了 ${out.length}/${batch.length}`);
  return out;
}

const BATCH = 24;
const results: { i: number; cat: string; what: string }[] = [];

async function runBatch(batch: any[], depth = 0): Promise<void> {
  if (!batch.length) return;
  try {
    results.push(...(await classifyBatch(batch)));
    process.stdout.write('.');
  } catch (e) {
    if (batch.length === 1 || depth > 3) {
      console.warn(`\n批内 ${batch.length} 个仍失败（${(e as Error).message.slice(0, 40)}），标为"其他"`);
      for (const r of batch) results.push({ i: r.i, cat: '其他', what: '' });
      return;
    }
    // 对半再试
    const mid = Math.floor(batch.length / 2);
    await runBatch(batch.slice(0, mid), depth + 1);
    await runBatch(batch.slice(mid), depth + 1);
  }
}

for (let s = 0; s < rows.length; s += BATCH) {
  await runBatch(rows.slice(s, s + BATCH));
}
console.log();

// 对账：每个域名都必须有归类
const got = new Set(results.map((r) => r.i));
const missing = rows.filter((r) => !got.has(r.i));
console.log(`归类 ${results.length}/${rows.length}${missing.length ? ` ⚠️ 缺 ${missing.length} 个` : ' ✅ 全覆盖'}`);

const byCat = new Map<string, any[]>();
for (const r of results) {
  const row = rows[r.i];
  const e = byCat.get(r.cat) ?? [];
  e.push({ ...row, what: r.what });
  byCat.set(r.cat, e);
}
const cats = [...byCat.entries()]
  .map(([cat, items]) => ({
    cat,
    urlCount: items.reduce((a, b) => a + b.n, 0),
    domainCount: items.length,
    items: items.sort((a, b) => b.n - a.n),
  }))
  .sort((a, b) => b.urlCount - a.urlCount);

writeFileSync(join(outDir, 'link-taxonomy.json'), JSON.stringify({ generatedAt: new Date().toISOString(), categories: cats }, null, 2), 'utf8');

// ── 报告 ──
const md: string[] = [];
md.push('# C4emem 链接归类');
md.push('');
md.push(`> ${links.totalLinks} 条链接出现 · ${links.uniqueUrls} 个唯一 URL · ${links.domains} 个域名（其中 ${rows.length - 0} 个已归类）`);
md.push('');
md.push('| 类别 | 链接数 | 域名数 |');
md.push('|---|---:|---:|');
for (const c of cats) md.push(`| **${c.cat}** | ${c.urlCount} | ${c.domainCount} |`);
md.push('');
const maxC = Math.max(...cats.map((c) => c.urlCount));
md.push('```');
for (const c of cats) md.push(`${String(c.urlCount).padStart(5)} ${'█'.repeat(Math.max(1, Math.round((c.urlCount / maxC) * 36)))} ${c.cat}`);
md.push('```');
md.push('');
for (const c of cats) {
  md.push(`## ${c.cat} — ${c.urlCount} 条 / ${c.domainCount} 个域名`);
  md.push('');
  md.push('| 域名 | 次数 | 这是什么 |');
  md.push('|---|---:|---|');
  for (const it of c.items.slice(0, 60)) md.push(`| ${it.domain} | ${it.n} | ${it.what} |`);
  if (c.items.length > 60) md.push(`\n… 另有 ${c.items.length - 60} 个域名`);
  md.push('');
}
writeFileSync(join(outDir, 'links.md'), md.join('\n'), 'utf8');

console.log('\n类别分布：');
for (const c of cats) console.log(`  ${String(c.urlCount).padStart(5)} 条 / ${String(c.domainCount).padStart(4)} 域名  ${c.cat}`);
console.log(`\n✅ out/links.md · out/link-taxonomy.json`);
