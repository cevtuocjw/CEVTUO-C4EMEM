/**
 * 检索质量评测 —— 用**真实笔记**当夹具，不造数据。
 *
 * 起因：`search "纸牌游戏怎么玩"` 的 top-1 虽然是正确的那条，但第 1 名和第 3 名
 * （一条相机镜头）的分数只差 3%（0.0164 vs 0.0159）—— 这在噪声范围内。
 * 「碰巧对了」和「真的在区分」是两件事，必须量出来。
 *
 * 判据：top-1 命中率 / top-3 命中率。每一个用例的 `expect` 都是**笔记里真实
 * 存在、且别处不会出现的字符串**。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config';
import { openDb } from '../src/store/db';
import { createEmbedder } from '../src/embed';
import { retrieve } from '../src/retrieve/hybrid';

const cfg = loadConfig();

/** query → 命中时 top-k 里必然出现的字符串 */
const CASES: { q: string; expect: string; note: string }[] = [
  { q: '纸牌游戏怎么玩', expect: 'Crapette', note: '语义跨措辞（原文无"纸牌游戏怎么玩"）' },
  { q: '乔治亚·欧姬芙的作品', expect: "O'Keeffe", note: '中文问 → 英文内容' },
  { q: '大家保险集团是一家什么公司', expect: '大家保险', note: '中文实体' },
  { q: '厄尔尼诺现象是什么', expect: 'El Niño', note: '中英混合专名' },
  { q: 'Product Content Engineer 这个职位', expect: 'Product Content Engineer', note: '英文专名（关键词腿该出力）' },
  // ⚠️ 夹具本身错过一次：原来写的是「一**本**令人羡慕的好工作」，而笔记里是
  //    「一**份**」。那是**夹具的错，不是产品的错** —— 夹具必须先证明它真的是
  //    它声称的东西，否则就是在拿一个假问题去判产品有罪。
  { q: '一份令人羡慕的好工作 英文怎么说', expect: 'plum job', note: '口语化问法 → 词条' },
];

const K = 5;
const db = openDb(cfg.dataDir);
const embedder = await createEmbedder(cfg);

let top1 = 0;
let top3 = 0;

console.log(`\n评测 ${CASES.length} 个用例（top-${K} 里找 expect）\n`);

for (const c of CASES) {
  const hits = await retrieve(db, embedder, c.q, {
    topK: K,
    candidates: cfg.retrieval.candidates,
    rrfK: cfg.retrieval.rrfK,
  });
  const rank = hits.findIndex((h) => h.text.includes(c.expect));
  const ok1 = rank === 0;
  const ok3 = rank >= 0 && rank < 3;
  if (ok1) top1 += 1;
  if (ok3) top3 += 1;

  const mark = ok1 ? '✅ top-1' : ok3 ? '🟡 top-3' : '❌ 未命中';
  console.log(`${mark}  「${c.q}」 → 期望含 "${c.expect}"  排名=${rank < 0 ? '无' : rank + 1}`);
  console.log(`        ${c.note}`);
  // ⚠️ 显示**余弦**而不是 RRF 分。RRF 分只是排名的函数，一条腿时每个查询都
  //    得到同样的 0.0164/0.0161/…，看着像坏了，而且它**不含相似度信息**。
  console.log(
    `        余弦 ${hits.map((h) => (h.sim === undefined ? '—' : h.sim.toFixed(4))).join(' / ')}  ` +
      `(via ${hits.map((h) => h.via[0]).join(',')})`,
  );
  console.log();
}

console.log('─'.repeat(52));
console.log(`top-1 ${top1}/${CASES.length}   top-3 ${top3}/${CASES.length}`);
const verdict = top3 === CASES.length ? '✅ 可用' : top3 >= CASES.length - 1 ? '🟡 勉强' : '❌ 需要换模型/加 reranker';
console.log(verdict);
console.log('\n⚠️ 样本只有 6 条 —— 这是"有没有明显坏掉"的冒烟测试，不是基准。');
