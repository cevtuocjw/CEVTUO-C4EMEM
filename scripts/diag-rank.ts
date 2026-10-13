/**
 * 诊断：某个答案**在候选集里排第几**。
 *
 * 这一个数字决定该修哪一层：
 *   · 排在前 40 内  → 加 reranker 就能救（它只对候选重排）
 *   · 排在 40 之外 → reranker 也救不了，问题在嵌入/候选那一层
 *
 * 用法：bun run scripts/diag-rank.ts "问题" "答案里必有的字符串"
 */
import { loadConfig } from '../src/config';
import { openDb } from '../src/store/db';
import { createEmbedder } from '../src/embed';
import { vectorSearch, hydrate } from '../src/store/db';

const [query, needle] = process.argv.slice(2);
if (!query || !needle) throw new Error('用法：bun run scripts/diag-rank.ts "问题" "必含字符串"');

const cfg = loadConfig();
const db = openDb(cfg.dataDir);
const embedder = await createEmbedder(cfg);
const [qv] = await embedder.embed([query], 'query');

const all = vectorSearch(db, qv, 100000); // 全量排序
const ids = [...all.keys()];
const rows = hydrate(db, ids);

const qvArr = qv;
const cos = (id: string) => all.get(id)!;

let firstHit = -1;
let rank = 0;
for (const id of ids) {
  rank += 1;
  const r = rows.get(id);
  if (r && r.text.includes(needle)) {
    firstHit = rank;
    break;
  }
}

console.log(`\n问题：${query}`);
console.log(`找： "${needle}"`);
console.log(`库内总块数：${ids.length}`);
if (firstHit < 0) {
  console.log(`\n❌ 库里没有任何块包含 "${needle}" —— 是抽取/切块的问题，不是检索的`);
} else {
  const id = ids[firstHit - 1];
  const r = rows.get(id)!;
  console.log(`\n向量排名：第 ${firstHit} 名（候选集默认取前 ${cfg.retrieval.candidates}）`);
  console.log(`余弦：${cos(id).toFixed(4)}`);
  console.log(`内容：[${r.space} ${r.date}] ${r.text.slice(0, 140).replace(/\n/g, ' ')}`);
  console.log(
    firstHit <= cfg.retrieval.candidates
      ? `\n✅ 在候选集内 → **加 reranker 可以救**`
      : `\n❌ 在候选集外（第 ${firstHit} > ${cfg.retrieval.candidates}）→ reranker 救不了，得改嵌入模型或加大候选数`,
  );
}

console.log('\n前 10 名的余弦（看区分度）：');
for (let i = 0; i < Math.min(10, ids.length); i += 1) {
  const r = rows.get(ids[i]);
  console.log(`  ${String(i + 1).padStart(2)}. ${cos(ids[i]).toFixed(4)}  ${r ? r.text.slice(0, 60).replace(/\n/g, ' ') : '?'}`);
}
