/**
 * 量嵌入吞吐 —— 决定 ollama 能不能用来做全量建库。
 *
 * ⚠️ 必须在**模型已加载**之后量。第一次调用包含把模型读进内存的时间，
 *    拿它当吞吐会得出「慢 100 倍」的错误结论。
 */
const OLLAMA = 'http://127.0.0.1:11434/v1';
const model = process.argv[2] ?? 'qwen3-embedding:0.6b';
const N = Number(process.argv[3] ?? 64);
const BATCH = Number(process.argv[4] ?? 16);

const texts = Array.from({ length: N }, (_, i) =>
  `第 ${i} 段测试文本，混合中英文：这是用来量吞吐的句子 product content engineer 与设计。`,
);

async function embed(batch: string[]): Promise<number> {
  const res = await fetch(`${OLLAMA}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: batch }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const b = (await res.json()) as any;
  return b.data.length;
}

// 预热：把模型读进内存，不计入
process.stdout.write(`预热 ${model} … `);
const tWarm = Date.now();
await embed(['预热']);
console.log(`${Date.now() - tWarm}ms`);

const t0 = Date.now();
let done = 0;
for (let i = 0; i < texts.length; i += BATCH) {
  done += await embed(texts.slice(i, i + BATCH));
}
const ms = Date.now() - t0;
console.log(`${done} 条 / 批大小 ${BATCH} / ${ms}ms  →  ${(ms / done).toFixed(1)}ms 每条`);
console.log(`推算建库：1602 块 ≈ ${((ms / done) * 1602 / 1000 / 60).toFixed(1)} 分钟`);
