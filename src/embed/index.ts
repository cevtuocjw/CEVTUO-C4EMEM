/**
 * 嵌入 —— 可插拔，两种 provider。
 *
 *   local              用 transformers.js 在本机跑（默认，**不需要任何 key**）
 *   openai-compatible  打任何 OpenAI 兼容端点（硅基流动 / OpenAI / …）
 *
 * ⚠️ 换 provider 会让**维度变化**，旧向量作废 —— 所以维度记在 meta 里，
 *    对不上就明确要求重新 sync，而不是算出一堆垃圾相似度。
 */
import type { Config } from '../config';
import { requireEnv, optionalEnv } from '../config';

/** 本地端点（ollama / LM Studio）不需要 API key。 */
const isLocalEndpoint = (base: string) =>
  /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(base);

export interface Embedder {
  readonly id: string;
  readonly dims: number;
  embed(texts: string[], kind: 'doc' | 'query'): Promise<Float32Array[]>;
}

export async function createEmbedder(cfg: Config, onProgress?: (msg: string) => void): Promise<Embedder> {
  if (cfg.embedding.provider === 'openai-compatible') return createApiEmbedder(cfg);
  return createLocalEmbedder(cfg, onProgress);
}

// ── 本地 ─────────────────────────────────────────────────────
async function createLocalEmbedder(cfg: Config, onProgress?: (m: string) => void): Promise<Embedder> {
  // 动态 import：不跑本地嵌入时不必付加载 onnxruntime 的代价。
  const { pipeline, env } = await import('@huggingface/transformers');

  // ⚠️ huggingface.co 在国内实测超时。transformers.js 不认 HF_ENDPOINT
  //    环境变量，只能从它自己的 env 对象改。
  if (cfg.embedding.hfEndpoint) env.remoteHost = cfg.embedding.hfEndpoint;

  onProgress?.(`加载本地嵌入模型 ${cfg.embedding.model} …（首次会下载，之后走缓存）`);
  const extract = await pipeline('feature-extraction', cfg.embedding.model, { dtype: 'fp32' });

  const run = async (texts: string[]): Promise<Float32Array[]> => {
    const out = await extract(texts, { pooling: 'cls', normalize: true });
    const dims = out.dims.at(-1)!;
    const flat = out.data as Float32Array;
    const res: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 1) {
      res.push(flat.slice(i * dims, (i + 1) * dims));
    }
    return res;
  };

  return {
    id: `local:${cfg.embedding.model}`,
    dims: cfg.embedding.dims,
    async embed(texts, kind) {
      // bge 系列：query 要加指令前缀，document 不加。少这一句检索质量掉得厉害。
      const prefixed = kind === 'query' && cfg.embedding.queryPrefix
        ? texts.map((t) => cfg.embedding.queryPrefix + t)
        : texts;
      const out: Float32Array[] = [];
      for (let i = 0; i < prefixed.length; i += cfg.embedding.batchSize) {
        out.push(...(await run(prefixed.slice(i, i + cfg.embedding.batchSize))));
      }
      return out;
    },
  };
}

// ── API ──────────────────────────────────────────────────────
function createApiEmbedder(cfg: Config): Embedder {
  const base = (cfg.embedding.baseUrl ?? '').replace(/\/$/, '');
  if (!base) throw new Error('embedding.baseUrl 没设');

  // 本地端点（ollama）不校验 key；外部端点必须给。
  const key = optionalEnv(cfg.embedding.apiKeyEnv);
  if (!key && !isLocalEndpoint(base)) {
    throw new Error(
      `嵌入走外部端点 ${base} 但没有 key。\n` +
        `在 .env 里设置 ${cfg.embedding.apiKeyEnv ?? 'C4EMEM_EMBED_API_KEY'}，` +
        `或者把 baseUrl 指向本地 ollama（http://127.0.0.1:11434/v1）。`,
    );
  }

  return {
    id: `api:${base}:${cfg.embedding.model}`,
    dims: cfg.embedding.dims,
    async embed(texts) {
      const res = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers: {
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: cfg.embedding.model, input: texts, encoding_format: 'float' }),
      });
      if (!res.ok) {
        throw new Error(`嵌入 API ${res.status}：${(await res.text()).slice(0, 300)}`);
      }
      const body = (await res.json()) as { data: { embedding: number[] }[] };
      return body.data.map((d) => Float32Array.from(d.embedding));
    },
  };
}
