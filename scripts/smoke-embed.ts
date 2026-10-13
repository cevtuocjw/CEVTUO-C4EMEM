/**
 * 冒烟测试：本地嵌入能不能在 Bun 里跑起来。
 *
 * 这一条决定了 C4emem 的 P0 要不要依赖任何外部 API key —— 跑通就说明
 * "零 key、纯本地" 的知识核心成立。
 */
import { pipeline, env } from '@huggingface/transformers';

// ⚠️ huggingface.co 在国内打不通（实测超时），必须走镜像。
// transformers.js 不认 `HF_ENDPOINT` 环境变量，只能从它自己的 env 对象改。
env.remoteHost = process.env.HF_ENDPOINT || 'https://hf-mirror.com';

const MODEL = 'Xenova/bge-small-zh-v1.5';

const t0 = Date.now();
console.log(`[1/3] 加载模型 ${MODEL} …`);
const extract = await pipeline('feature-extraction', MODEL, { dtype: 'fp32' });
console.log(`      加载完成 ${Date.now() - t0}ms`);

const t1 = Date.now();
const texts = ['今天在看量子纠缠的实验', '晚饭吃了番茄炒蛋', 'Notion 的 API 限速是每秒三次'];
const out = await extract(texts, { pooling: 'cls', normalize: true });
console.log(`[2/3] 三条文本编码完成 ${Date.now() - t1}ms  dims=${JSON.stringify(out.dims)}`);

// 相似度自检：第 1 条和第 3 条都偏"技术"，应当比和第 2 条更近。
const [a, b, c] = out.tolist();
const cos = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
console.log(`[3/3] cos(技术, 技术)=${cos(a, c).toFixed(4)}  cos(技术, 吃饭)=${cos(a, b).toFixed(4)}`);
console.log(cos(a, c) > cos(a, b) ? '✅ 本地嵌入可用，且语义方向正确' : '❌ 语义方向不对');
