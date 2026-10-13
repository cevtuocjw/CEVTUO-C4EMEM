/**
 * 把四个板块的内容**自动归类**，产出主题树。
 *
 * 做法（不是"让大模型读一遍全部内容"——那既慢又贵）：
 *   1. 用已有的**文档向量**做 k-means 聚类 —— 分组这一步是**零成本**的本地计算
 *   2. 每个簇只抽出**离质心最近的几条**当代表，交给 LLM 起名字 + 提关键词
 *   3. 再把簇名交给 LLM 归成若干**大类**
 *
 * ⚠️ 为什么是"先聚类再命名"而不是"让 LLM 逐条分类"：
 *    18 条/簇 × 30 簇 ≈ 550 次调用；而聚类是本地免费算出来的，
 *    LLM 只需要给 30 个簇起名（外加 1 次归大类）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config';
import { openDb } from '../src/store/db';
import { createLlm } from '../src/llm';

const K = Number(process.argv[2] ?? 30);

/**
 * 固定种子的伪随机 —— k-means 的初始化必须可复现。
 * ⚠️ 用 rng() 的话，同一份数据每次跑出**不同**的簇，
 *    这份报告就没法复现、也没法比较两次调整的好坏。
 */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261008);
const cfg = loadConfig();
const db = openDb(cfg.dataDir);
const outDir = join(process.cwd(), 'out');
mkdirSync(outDir, { recursive: true });

// ── 1. 取文档 + 文档向量（块向量的均值）──────────────────────
const docs = db
  .query<{ id: string; space: string; date: string; text: string }, []>(
    'SELECT id, space, date, text FROM docs',
  )
  .all();

const chunkRows = db
  .query<{ doc_id: string; v: Uint8Array }, []>('SELECT c.doc_id, v.v FROM chunks c JOIN vec v ON v.chunk_id = c.id')
  .all();

const acc = new Map<string, { sum: Float32Array; n: number }>();
for (const r of chunkRows) {
  const f = new Float32Array(r.v.buffer, r.v.byteOffset, r.v.byteLength / 4);
  let e = acc.get(r.doc_id);
  if (!e) {
    e = { sum: new Float32Array(f.length), n: 0 };
    acc.set(r.doc_id, e);
  }
  for (let i = 0; i < f.length; i += 1) e.sum[i] += f[i];
  e.n += 1;
}

const items = docs
  .map((d) => {
    const e = acc.get(d.id);
    if (!e || e.n === 0) return null;
    const v = new Float32Array(e.sum.length);
    for (let i = 0; i < v.length; i += 1) v[i] = e.sum[i] / e.n;
    // L2 归一化，让欧氏距离等价于余弦
    let norm = 0;
    for (let i = 0; i < v.length; i += 1) norm += v[i] * v[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < v.length; i += 1) v[i] /= norm;
    return { ...d, v };
  })
  .filter((x): x is NonNullable<typeof x> => x !== null);

console.log(`文档 ${items.length} 条，维度 ${items[0]?.v.length ?? 0}，聚类 k=${K}`);

// ── 2. k-means（自己实现，不引依赖）──────────────────────────
const dim = items[0].v.length;
// k-means++ 初始化：分散选种子，避免全部挤在一坨
const centroids: Float32Array[] = [];
{
  const used = new Set<number>();
  const first = Math.floor(rng() * items.length);
  used.add(first);
  centroids.push(Float32Array.from(items[first].v));
  while (centroids.length < K) {
    const d2 = items.map((it) => {
      let best = Infinity;
      for (const c of centroids) {
        let s = 0;
        for (let i = 0; i < dim; i += 1) {
          const d = it.v[i] - c[i];
          s += d * d;
        }
        if (s < best) best = s;
      }
      return best;
    });
    const total = d2.reduce((a, b) => a + b, 0);
    let t = rng() * total;
    let pick = 0;
    for (let i = 0; i < d2.length; i += 1) {
      t -= d2[i];
      if (t <= 0) {
        pick = i;
        break;
      }
    }
    if (used.has(pick)) pick = (pick + 1) % items.length;
    used.add(pick);
    centroids.push(Float32Array.from(items[pick].v));
  }
}

const assign = new Int32Array(items.length).fill(-1);
for (let iter = 0; iter < 30; iter += 1) {
  let moved = 0;
  for (let i = 0; i < items.length; i += 1) {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < centroids.length; c += 1) {
      let s = 0;
      const cv = centroids[c];
      for (let j = 0; j < dim; j += 1) {
        const d = items[i].v[j] - cv[j];
        s += d * d;
      }
      if (s < bestD) {
        bestD = s;
        best = c;
      }
    }
    if (assign[i] !== best) {
      assign[i] = best;
      moved += 1;
    }
  }
  const sums = Array.from({ length: centroids.length }, () => new Float32Array(dim));
  const counts = new Int32Array(centroids.length);
  for (let i = 0; i < items.length; i += 1) {
    const c = assign[i];
    counts[c] += 1;
    for (let j = 0; j < dim; j += 1) sums[c][j] += items[i].v[j];
  }
  for (let c = 0; c < centroids.length; c += 1) {
    if (!counts[c]) continue;
    let norm = 0;
    for (let j = 0; j < dim; j += 1) {
      sums[c][j] /= counts[c];
      norm += sums[c][j] * sums[c][j];
    }
    norm = Math.sqrt(norm) || 1;
    for (let j = 0; j < dim; j += 1) sums[c][j] /= norm;
    centroids[c] = sums[c];
  }
  if (!moved) break;
}

// ── 3. 每簇抽样：离质心最近的几条当代表 ─────────────────────
const clusters = Array.from({ length: centroids.length }, (_, c) => {
  const members = items
    .map((it, i) => ({ it, i, d: assign[i] === c ? dist(it.v, centroids[c]) : Infinity }))
    .filter((x) => x.d < Infinity)
    .sort((a, b) => a.d - b.d);
  return { c, size: members.length, members };
})
  .filter((cl) => cl.size > 0)
  .sort((a, b) => b.size - a.size);

function dist(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

const strip = (t: string) => t.replace(/^\[[^\]]*\]\s*/, '').replace(/\s+/g, ' ').trim();

// ── 4. 让 LLM 给每个簇起名 + 提关键词 ───────────────────────
const llm = createLlm(cfg);
if (!llm) throw new Error('需要 LLM key 才能给簇起名（.env 里的 C4EMEM_LLM_API_KEY）');

const spaceName: Record<string, string> = Object.fromEntries(cfg.notion.spaces.map((s) => [s.key, s.label]));

console.log(`\n给 ${clusters.length} 个簇起名…`);
const labeled: any[] = [];
for (const cl of clusters) {
  const reps = cl.members.slice(0, 6);
  const sample = reps
    .map((m, i) => `[${i + 1}] (${spaceName[m.it.space] ?? m.it.space} ${m.it.date}) ${strip(m.it.text).slice(0, 320)}`)
    .join('\n');
  const prompt = `下面是一组来自个人笔记的片段，它们语义上属于同一类。请给这一类起个名字并提取关键词。

${sample}

只输出 JSON，不要解释，不要 markdown 代码块：
{"name":"不超过8个字的中文类别名","keywords":["关键词1","关键词2","关键词3","关键词4","关键词5"],"desc":"一句话说明这类内容是什么"}  `;

  let name = '未命名';
  let keywords: string[] = [];
  let desc = '';
  try {
    const raw = await llm.chat([
      { role: 'system', content: '你是一个给笔记语料做主题归类的中文助手。只输出 JSON。' },
      { role: 'user', content: prompt },
    ]);
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      name = j.name ?? name;
      keywords = Array.isArray(j.keywords) ? j.keywords.slice(0, 8) : [];
      desc = j.desc ?? '';
    }
  } catch (e) {
    console.warn(`  ! 簇 ${cl.c} 起名失败：${(e as Error).message.slice(0, 80)}`);
  }
  labeled.push({
    id: cl.c,
    size: cl.size,
    name,
    desc,
    keywords,
    spaces: [...new Set(cl.members.map((m) => m.it.space))],
    dateMin: cl.members.map((m) => m.it.date).sort()[0],
    dateMax: cl.members.map((m) => m.it.date).sort().slice(-1)[0],
    examples: reps.slice(0, 4).map((m) => ({ space: m.it.space, date: m.it.date, text: strip(m.it.text).slice(0, 140) })),
  });
  process.stdout.write('.');
}
console.log();

// 簇名去重 —— 实测有两簇都叫「技术学习资源」，展示时根本分不清
{
  const seen = new Map<string, number>();
  for (const l of labeled) {
    const n = (seen.get(l.name) ?? 0) + 1;
    seen.set(l.name, n);
    if (n > 1) l.name = `${l.name} (${n})`;
  }
}

// ── 5. 归大类 ────────────────────────────────────────────────
console.log('归大类…');
let groups: any[] = [];
try {
  // ⚠️⚠️ 用**编号**引用簇，绝不用名字。
  //
  // 第一版让 LLM 回簇名、再按名字对回去 —— 两种撞车都会**静默丢簇**：
  //   · 两个簇同名（实测「技术学习资源」出现两次）
  //   · LLM 写出来的名字和原名不是逐字相同
  // 结果是 **833 段只归进去 810，差的 23 段一点提示都没有**。
  // 拿一个「给别的模型看的字符串」当数据库主键，是这个错误的根源。
  const list = labeled
    .map((l, i) => `[${i}] ${l.name}（${l.size} 段；关键词：${l.keywords.join('、')}）`)
    .join('\n');
  const raw = await llm.chat([
    { role: 'system', content: '你是一个中文知识管理专家。只输出 JSON。' },
    {
      role: 'user',
      content: `下面是我个人笔记的 ${labeled.length} 个主题簇（方括号里是编号）。请把它们归成 8~14 个**大类**（大类名 2~6 个中文字）。

${list}

只输出 JSON，members 里放**编号**：
{"groups":[{"name":"大类名","members":[0,3,7]}]}
要求：编号 0 到 ${labeled.length - 1} 每个必须**恰好出现一次**，不能遗漏、不能重复。`,
    },
  ]);
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) groups = JSON.parse(m[0]).groups ?? [];
} catch (e) {
  console.warn(`! 归大类失败：${(e as Error).message.slice(0, 100)}`);
}

const usedIdx = new Set<number>();
const grouped = groups
  .map((g: any) => {
    const idxs = (g.members ?? [])
      .map((i: any) => (Number.isInteger(i) && labeled[i] ? (i as number) : -1))
      .filter((i: number) => i >= 0 && !usedIdx.has(i));
    const ms = idxs.map((i: number) => {
      usedIdx.add(i);
      return labeled[i];
    });
    return {
      name: g.name,
      size: ms.reduce((a: number, b: any) => a + b.size, 0),
      clusters: ms.sort((a: any, b: any) => b.size - a.size),
    };
  })
  .filter((g: any) => g.size > 0)
  .sort((a: any, b: any) => b.size - a.size);

// 没被任何大类收走的簇，单列出来（**绝不静默丢**）
const orphans = labeled.filter((_: any, i: number) => !usedIdx.has(i));
if (orphans.length) {
  console.warn(
    `⚠️ ${orphans.length} 个簇没被归进任何大类，单列出来：${orphans.map((o: any) => o.name).join('、')}`,
  );
  grouped.push({
    name: '（未归类）',
    size: orphans.reduce((a: number, b: any) => a + b.size, 0),
    clusters: orphans,
  });
}

// 对账：归类合计必须等于文档总数，否则说明又丢东西了
const reconciled = grouped.reduce((a: number, g: any) => a + g.size, 0);
if (reconciled !== items.length) {
  console.warn(`⚠️ 对账不平：归类合计 ${reconciled}，实际文档 ${items.length}，差 ${items.length - reconciled}`);
} else {
  console.log(`对账 ✅ 归类合计 ${reconciled} = 文档总数 ${items.length}`);
}

const payload = {
  generatedAt: new Date().toISOString(),
  totalDocs: items.length,
  k: K,
  spaces: cfg.notion.spaces.map((s) => ({ key: s.key, label: s.label, count: docs.filter((d) => d.space === s.key).length })),
  groups: grouped,
};
writeFileSync(join(outDir, 'taxonomy.json'), JSON.stringify(payload, null, 2), 'utf8');
console.log(`\n✅ 写入 out/taxonomy.json —— ${grouped.length} 个大类 / ${labeled.length} 个簇 / ${items.length} 段`);
for (const g of grouped) console.log(`   ${String(g.size).padStart(5)}  ${g.name}`);
