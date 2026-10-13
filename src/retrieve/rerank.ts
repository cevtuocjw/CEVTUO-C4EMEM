/**
 * Reranker —— 可插拔，默认关闭。
 *
 * 为什么需要它（实测出来的，不是照搬概念）：
 *   `乔治亚·欧姬芙的作品是什么风格` 的答案在**全库向量排名第 66**。
 *   嵌入模型把「艺术/时尚/女性」这一簇压得很密（前 10 名余弦 0.51→0.46，
 *   每名只差 0.004），所以候选里一堆同主题的块把正确答案挤到了 66。
 *
 * ⚠️ 但 reranker **只对候选重排，救不了没进候选的**。
 *    这就是为什么 `retrieval.candidates` 必须先够大（现在 200）——
 *    先让第 66 名进得来，reranker 才有得排。
 *
 * 为什么主力是 API 而不是本地：
 *   ollama 不做 cross-encoder。本地想 rerank 只能拿小 LLM 硬排，又慢又不准。
 *   而重排正是「最终分析」那一层 —— 按既定方向，这一层本来就该用 API。
 *   所以本地只保留 `none`（RRF 顺序），要质量就接 API。
 */
import type { Config } from '../config';
import { optionalEnv } from '../config';

export interface RerankDoc {
  id: string;
  text: string;
}

export interface Reranker {
  readonly id: string;
  /** 返回按相关性降序的 id 列表（只含被打了分的）。 */
  rerank(query: string, docs: RerankDoc[]): Promise<string[]>;
}

export function createReranker(cfg: Config): Reranker | null {
  const rc = cfg.rerank;
  if (!rc || rc.provider === 'none') return null;

  const base = (rc.baseUrl ?? '').replace(/\/$/, '');
  const key = optionalEnv(rc.apiKeyEnv);
  if (!base || !key) {
    // 没配好就当没开 —— 静默降级成 RRF 顺序，不要让检索整个失败
    return null;
  }

  return {
    id: `${base}:${rc.model}`,
    async rerank(query, docs) {
      if (!docs.length) return [];
      const res = await fetch(`${base}/rerank`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: rc.model,
          query,
          documents: docs.map((d) => d.text),
          top_n: docs.length,
        }),
      });
      if (!res.ok) throw new Error(`rerank ${res.status}：${(await res.text()).slice(0, 300)}`);
      const body = (await res.json()) as { results: { index: number; relevance_score: number }[] };
      return (body.results ?? [])
        .sort((a, b) => b.relevance_score - a.relevance_score)
        .map((r) => docs[r.index]?.id)
        .filter((x): x is string => Boolean(x));
    },
  };
}
