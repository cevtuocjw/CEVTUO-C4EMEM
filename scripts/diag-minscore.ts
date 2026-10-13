/**
 * 诊断：minScore 到底有没有生效。
 * 上一轮从 `search` 的输出看，余弦 0.3133 的条目没被过滤掉 —— 但它低于 0.4。
 */
import { loadConfig } from '../src/config';
import { openDb } from '../src/store/db';
import { createEmbedder } from '../src/embed';
import { retrieve } from '../src/retrieve/hybrid';

const cfg = loadConfig();
console.log('配置里的 minScore =', cfg.retrieval.minScore, '（类型', typeof cfg.retrieval.minScore, '）');

const db = openDb(cfg.dataDir);
const embedder = await createEmbedder(cfg);
const q = 'Crapette 是什么，怎么玩';

for (const min of [0, cfg.retrieval.minScore]) {
  const hits = await retrieve(db, embedder, q, {
    topK: 8,
    candidates: cfg.retrieval.candidates,
    rrfK: cfg.retrieval.rrfK,
    minScore: min,
  });
  console.log(`\nminScore=${min} → 返回 ${hits.length} 条`);
  for (const h of hits) {
    console.log(`   sim=${h.sim === undefined ? '—' : h.sim.toFixed(4)}  via=${h.via}`);
  }
}
