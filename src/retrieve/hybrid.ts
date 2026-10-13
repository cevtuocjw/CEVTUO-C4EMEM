/**
 * 混合检索 —— 向量腿 + 关键词腿，用 RRF 融合。
 *
 * 为什么两条腿都要：
 *   · 只有向量 —— 专有名词（"Crapette"、型号、人名）容易被近义词淹掉；
 *   · 只有关键词 —— 问法和原文措辞不一样就搜不到。
 * 两条腿的结果用 **RRF（Reciprocal Rank Fusion）** 融合：只看排名不看分数，
 * 所以不需要把「余弦相似度」和「BM25」这两种量纲不同的分数调到可比 —— 那件事
 * 永远调不对。
 */
import type { Database } from 'bun:sqlite';
import { keywordSearch, vectorSearch, hydrate, allowedChunks, type Hit } from '../store/db';
import type { Embedder } from '../embed';
import type { Reranker } from './rerank';

export interface RetrieveOpts {
  topK: number;
  candidates: number;
  rrfK: number;
  space?: string;
  /** 只要这些来源（多选）。空 = 全库。 */
  spaces?: string[];
  /** 可选重排。给了就把融合结果的前 N 条送去重排。 */
  reranker?: Reranker | null;
  rerankTopN?: number;
  /** 余弦下限；低于它的向量命中丢掉。关键词命中不参与（它们没有余弦）。 */
  minScore?: number;
  /** 降级时叫人一声（比如嵌入服务连不上，这一次只有关键词腿）。 */
  onWarn?: (msg: string) => void;
}

export async function retrieve(
  db: Database,
  embedder: Embedder,
  query: string,
  opts: RetrieveOpts,
): Promise<Hit[]> {
  // ⚠️⚠️ 嵌入服务挂掉**不该让整个问答 500**。
  //    实测过一次：本机 ollama 没起来 ⇒ /api/ask 直接返回
  //    `Unable to connect`，界面上看起来像"这个应用整个坏了"，
  //    而其实关键词腿（FTS5）完全能用，只是少了一条腿。
  //    所以这里退化成只有关键词腿，并且**把这件事说出来** ——
  //    两条腿都在和只有一条腿，结果的质量差很多，不能让用户以为是一样的。
  // ⚠️ 这一行必须在两条腿**之前**算 —— 上一次改的时候被顺手删掉了，
  //    而报错是运行期的 `allow is not defined`，看起来像"检索整个坏了"。
  const allow = allowedChunks(db, opts.spaces);

  let vec = new Map<string, number>();
  try {
    const [qv] = await embedder.embed([query], 'query');
    vec = vectorSearch(db, qv, opts.candidates, allow);
  } catch (e) {
    opts.onWarn?.(`嵌入服务不可用（${(e as Error).message.slice(0, 80)}）—— 这次只用了关键词检索，结果会差一些`);
  }

  // ⚠️ 两条腿用**同一份**允许集合 —— 分开算会出现「向量腿漏了、关键词腿没漏」这种
  //    只在一半数据上成立的怪结果，而且它看起来完全正常。
  const kw = keywordSearch(db, query, opts.candidates, allow);

  // RRF：每个 doc 的得分 = Σ 1/(k + 它在某一路里的排名)
  const scores = new Map<string, { s: number; via: Set<string> }>();
  const add = (ids: Iterable<string>, tag: string) => {
    let rank = 1;
    for (const id of ids) {
      const e = scores.get(id) ?? { s: 0, via: new Set<string>() };
      e.s += 1 / (opts.rrfK + rank);
      e.via.add(tag);
      scores.set(id, e);
      rank += 1;
    }
  };
  // Map 的迭代顺序已经是按分数降序（上游排过），这里当排名用
  add(vec.keys(), 'vector');
  add(kw.keys(), 'keyword');

  const ranked = [...scores.entries()].sort((a, b) => b[1].s - a[1].s);

  const rows = hydrate(db, ranked.map(([id]) => id));
  const hits: Hit[] = [];
  for (const [id, { s, via }] of ranked) {
    const row = rows.get(id);
    if (!row) continue; // 向量/ FTS 里有、chunks 里没有 = 数据不一致，跳过而不是崩
    if (opts.space && row.space !== opts.space) continue;
    if (opts.spaces?.length && !opts.spaces.includes(row.space)) continue;
    hits.push({
      ...row,
      score: s,
      sim: vec.get(id),
      via: via.size === 2 ? 'both' : via.has('vector') ? 'vector' : 'keyword',
    });
  }

  // ── 相似度下限：把噪声挡在 prompt 之外 ────────────────────
  // ⚠️ 只过滤**向量**命中（有关键词命中的说明字面就对得上，保留）。
  const min = opts.minScore ?? 0;
  const kept = min > 0 ? hits.filter((h) => h.sim === undefined || h.sim >= min) : hits;
  if (kept.length === 0) {
    // 全都低于下限 —— 与其硬塞 8 条噪声让模型编，不如**明说没有**
    return [];
  }

  // ── 可选重排 ───────────────────────────────────────────────
  // ⚠️ 重排**只对候选重排**。所以 `candidates` 必须先够大 —— 实测正确答案
  //    可能在全库排到第 66 名，候选不够就连排的机会都没有。
  const ordered: Hit[] = [];
  const poolSize = Math.min(opts.rerankTopN ?? 40, kept.length);
  if (opts.reranker && kept.length > 1) {
    const pool = kept.slice(0, poolSize);
    try {
      const order = await opts.reranker.rerank(query, pool.map((h) => ({ id: h.id, text: h.text })));
      const byId = new Map(pool.map((h) => [h.id, h]));
      const seen = new Set<string>();
      for (const id of order) {
        const h = byId.get(id);
        if (h && !seen.has(id)) {
          ordered.push(h);
          seen.add(id);
        }
      }
      for (const h of pool) if (!seen.has(h.id)) ordered.push(h); // 没被打分的补在后面
      ordered.push(...kept.slice(poolSize));
    } catch (e) {
      // ⚠️ 重排挂了不该让检索整个挂 —— 退回 RRF 顺序，但**要说出来**（别静默）
      console.error(`⚠️ rerank 失败，已退回 RRF 顺序：${(e as Error).message}`);
      ordered.push(...kept);
    }
  } else {
    // ⚠️ 这里必须也用 `kept`。
    // 之前这里是 `hits` —— 而 reranker 默认是关的，也就是**永远走这个分支**，
    // 于是 minScore 的过滤一次都没生效过。而 `replace_all` 当时只匹配到了
    // 6 空格缩进的那一处，这一处是 4 空格，被漏了：**看起来改了，其实没改。**
    ordered.push(...kept);
  }

  return ordered.slice(0, opts.topK);
}
