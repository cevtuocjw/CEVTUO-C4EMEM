/**
 * 用**同一套夹具**量 ollama 上的嵌入模型 —— 和 bge-small-zh 直接对比。
 *
 * 判据仍然是**余量**（正确 − 干扰），不是绝对相似度。
 * 已知基线（bge-small-zh-v1.5）：+0.1153 / +0.3600 / +0.2422
 *
 * 换模型要付一次全量重建库的代价，所以它必须比基线**明显更好**才换。
 */
const OLLAMA = 'http://127.0.0.1:11434/v1';

const CASES: [string, string, string][] = [
  ['乔治亚·欧姬芙的作品是什么风格', "She came across Georgia O'Keeffe's work. O'Keeffe engaged with the natural world", 'Sigma 45mm F2.8 DG DN 镜头技术规格'],
  ['纸牌游戏怎么玩', 'Crapette 是一个法语词，最常见的含义是一种双人纸牌游戏，也称为 Russian Bank', '大家保险集团是一家综合性保险集团，注册资本203.6亿元'],
  ['一本令人羡慕的好工作 英文怎么说', 'a plum job = 一份令人羡慕的好工作', 'carnivore diet Lux is exhilarating in its refusal to settle'],
];

const cos = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

async function embed(model: string, texts: string[]): Promise<number[][]> {
  const res = await fetch(`${OLLAMA}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as any;
  return body.data.map((d: any) => d.embedding);
}

const models = process.argv.slice(2);
if (!models.length) throw new Error('用法：bun run scripts/eval-ollama-embed.ts qwen3-embedding:0.6b [bge-m3]');

for (const m of models) {
  const t0 = Date.now();
  let dims = 0;
  console.log(`\n▸ ${m}`);
  for (const [q, right, wrong] of CASES) {
    try {
      const [qv, rv, wv] = await embed(m, [q, right, wrong]);
      dims = qv.length;
      const a = cos(qv, rv);
      const b = cos(qv, wv);
      const margin = a - b;
      const mark = margin > 0.03 ? '✅' : margin > 0 ? '🟡' : '❌';
      console.log(
        `   ${mark} 「${q.slice(0, 14)}」 对=${a.toFixed(4)} 错=${b.toFixed(4)} 余量=${margin >= 0 ? '+' : ''}${margin.toFixed(4)}`,
      );
    } catch (e) {
      console.log(`   ❌ ${(e as Error).message}`);
      break;
    }
  }
  console.log(`   dims=${dims}  用时 ${Date.now() - t0}ms`);
}
console.log('\n基线 bge-small-zh-v1.5：+0.1153 / +0.3600 / +0.2422');
