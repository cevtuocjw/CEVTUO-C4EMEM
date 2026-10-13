/**
 * 嵌入模型横向评测 —— 用**真实失败用例**当夹具。
 *
 * 假设：`bge-small-zh-v1.5` 是**纯中文**模型，而用户的笔记里大量是英文
 * （英文歌词、英文人名、英文文章）。纯中文模型无法把「乔治亚·欧姬芙」对齐到
 * "Georgia O'Keeffe" —— 这就是跨语言失败的原因。
 *
 * 判据：正确答案的相似度必须**高出干扰项**一个可见的余量。
 * ⚠️ 只看「正确答案排第一」不够 —— 实测过：前 3 名的分差只有 3%，那在噪声里，
 *    正确的排第一可能只是碰巧。所以这里同时打印**余量**。
 */
import { pipeline, env } from '@huggingface/transformers';

env.remoteHost = 'https://hf-mirror.com';

// 实测：bge-m3（~2GB fp32）经镜像下载会拖到十几分钟，且它一旦卡住整轮都看不到
// 进度。所以按需筛：ONLY=multilingual-e5-small bun run scripts/eval-embed-models.ts
const ALL_MODELS = [
  { id: 'Xenova/bge-small-zh-v1.5', q: '', d: '', pooling: 'cls' as const },
  { id: 'Xenova/multilingual-e5-small', q: 'query: ', d: 'passage: ', pooling: 'mean' as const },
  { id: 'Xenova/bge-m3', q: '', d: '', pooling: 'cls' as const },
];
const MODELS = process.env.ONLY
  ? ALL_MODELS.filter((m) => m.id.includes(process.env.ONLY!))
  : ALL_MODELS;

/** [问题, 正确答案, 干扰项] */
const CASES: [string, string, string][] = [
  ['乔治亚·欧姬芙的作品是什么风格', "She came across Georgia O'Keeffe's work. O'Keeffe engaged with the natural world", 'Sigma 45mm F2.8 DG DN 镜头技术规格'],
  ['纸牌游戏怎么玩', 'Crapette 是一个法语词，最常见的含义是一种双人纸牌游戏，也称为 Russian Bank', '大家保险集团是一家综合性保险集团，注册资本203.6亿元'],
  ['一本令人羡慕的好工作 英文怎么说', 'a plum job = 一份令人羡慕的好工作', 'carnivore diet Lux is exhilarating in its refusal to settle'],
];

const cos = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
};

for (const m of MODELS) {
  process.stdout.write(`\n▸ ${m.id} … `);
  let extract;
  try {
    extract = await pipeline('feature-extraction', m.id, { dtype: 'fp32' });
  } catch (e) {
    console.log(`\n  ❌ 加载失败（可能镜像上没有这个模型）：${(e as Error).message.slice(0, 120)}`);
    continue;
  }
  const enc = async (texts: string[], prefix: string) => {
    const out = await extract(texts.map((t) => prefix + t), { pooling: m.pooling, normalize: true });
    const dims = out.dims.at(-1)!;
    const flat = out.data as Float32Array;
    return texts.map((_, i) => flat.slice(i * dims, (i + 1) * dims));
  };
  console.log('ok');

  for (const [q, right, wrong] of CASES) {
    const [qv] = await enc([q], m.q);
    const [rv, wv] = await enc([right, wrong], m.d);
    const a = cos(qv, rv);
    const b = cos(qv, wv);
    const margin = a - b;
    const mark = margin > 0.03 ? '✅' : margin > 0 ? '🟡' : '❌';
    console.log(
      `   ${mark} 「${q.slice(0, 14)}」 对=${a.toFixed(4)} 错=${b.toFixed(4)} 余量=${margin >= 0 ? '+' : ''}${margin.toFixed(4)}`,
    );
  }
}
