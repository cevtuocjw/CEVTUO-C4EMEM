/**
 * 配置加载 —— 「不写死」在这一个文件里落实。
 *
 * 两条规矩：
 *   1. 配置里**永远不出现密钥**，只写「去哪个环境变量拿」（`apiKeyEnv`）。
 *      这样配置文件可以进仓库、可以给别人用，接自己的 key 就能跑。
 *   2. 任何可能换的东西（模型、端点、知识源、分块大小）都在配置里，
 *      代码里不许出现 magic value。
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

export interface SpaceConfig {
  key: string;
  label: string;
  pageId: string;
}

export interface Config {
  /** 配置文件的绝对路径（给错误信息用） */
  _path: string;
  /** 额外的 .env 文件（例如复用 CEVTUO-Z 的），最先加载的优先级最低 */
  envFiles?: string[];
  dataDir: string;

  notion: {
    version: string;
    apiKeyEnv: string;
    spaces: SpaceConfig[];
    skipTitles: string;
    maxDepth: number;
    minGapMs: number;
  };

  embedding: {
    provider: 'local' | 'openai-compatible';
    model: string;
    dims: number;
    hfEndpoint?: string;
    queryPrefix?: string;
    batchSize: number;
    baseUrl?: string;
    apiKeyEnv?: string;
  };

  llm: {
    provider: 'openai-compatible' | 'none';
    baseUrl?: string;
    model?: string;
    apiKeyEnv?: string;
    maxTokens: number;
    temperature: number;
  };

  /** 重排。默认关；要质量就接一个 /rerank API（硅基流动 / Cohere / Voyage）。 */
  rerank: {
    provider: 'none' | 'api';
    baseUrl?: string;
    model?: string;
    apiKeyEnv?: string;
    /** 把融合后的前几条送去重排。太少没意义，太多白花钱。 */
    topN: number;
  };

  retrieval: {
    topK: number;
    candidates: number;
    rrfK: number;
    chunkChars: number;
    overlapChars: number;
    /**
     * 相似度下限（余弦）。低于它的**向量**命中直接丢掉。
     * ⚠️ 实测：问「Crapette 是什么」，8 条材料里**只有 1 条有用**，
     *    其余 7 条是噪声 —— 而 ask 是按 token 计费的。噪声既浪费钱又干扰模型。
     * ⚠️ 关键词腿的命中没有余弦，**不参与这个过滤**（不该因为量不到就误杀）。
     */
    minScore: number;
    /** 低于它 = 「弱相关」：检索有结果，但不太可信。见 DEFAULTS 里的说明。 */
    weakBelow: number;
  };
}

export const expandHome = (p: string) =>
  p.startsWith('~') ? join(homedir(), p.slice(1)) : p;

const DEFAULTS = {
  notion: { version: '2022-06-28', apiKeyEnv: 'NOTION_TOKEN', skipTitles: '^\\s*(before|旧|old)\\b', maxDepth: 12, minGapMs: 350 },
  embedding: { provider: 'local' as const, model: 'Xenova/bge-small-zh-v1.5', dims: 512, hfEndpoint: 'https://hf-mirror.com', batchSize: 16 },
  llm: { provider: 'none' as const, maxTokens: 1200, temperature: 0.2 },
  rerank: { provider: 'none' as const, topN: 40 },
  retrieval: {
    topK: 8, candidates: 200, rrfK: 60, chunkChars: 420, overlapChars: 80,
    /**
     * 低于它就是噪声，直接丢掉。
     */
    minScore: 0.4,
    /**
     * 「弱相关」的线，比 minScore 高。
     *
     * ⚠️ 为什么要有这一条：0.4 太松 —— 实测**乱码问题**（"zzzqqq 这个词笔记里有吗"）
     *    都能捞到 8 条 0.43~0.49 的噪声，于是「知识库里没有」这个分支**几乎永远不触发**，
     *    而界面上显示得像"答上来了"。实测真问题 0.60~0.75，无关问题 0.44~0.49。
     *
     * ⚠️ 它的语义是「**这条答案不太可信**」，不是「没有」——
     *    所以界面上给的是"要不要再上网查一遍"，而不是抹掉已有答案。
     *    混为一谈的话，真记过的笔记会被判成没记过。
     */
    weakBelow: 0.55,
  },
};

/** 解析配置文件路径：显式参数 > $C4EMEM_CONFIG > ./c4emem.config.json */
export function resolveConfigPath(explicit?: string): string {
  const p = explicit ?? process.env.C4EMEM_CONFIG ?? 'c4emem.config.json';
  return resolve(expandHome(p));
}

export function loadConfig(explicit?: string): Config {
  const path = resolveConfigPath(explicit);
  if (!existsSync(path)) {
    throw new Error(
      `找不到配置文件：${path}\n` +
        `先复制一份模板：  cp ${join(dirname(path), 'c4emem.config.example.json')} ${path}`,
    );
  }

  let raw: any;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`配置文件不是合法 JSON：${path}\n${(e as Error).message}`);
  }

  const cfg: Config = {
    _path: path,
    envFiles: raw.envFiles,
    dataDir: expandHome(raw.dataDir ?? '~/.c4emem'),
    notion: { ...DEFAULTS.notion, ...(raw.notion ?? {}) },
    embedding: { ...DEFAULTS.embedding, ...(raw.embedding ?? {}) },
    llm: { ...DEFAULTS.llm, ...(raw.llm ?? {}) },
    rerank: { ...DEFAULTS.rerank, ...(raw.rerank ?? {}) },
    retrieval: { ...DEFAULTS.retrieval, ...(raw.retrieval ?? {}) },
  };

  // 校验 —— 早失败好过跑一半才发现
  if (!Array.isArray(cfg.notion.spaces) || cfg.notion.spaces.length === 0) {
    throw new Error('config.notion.spaces 至少要有一个知识源');
  }
  for (const s of cfg.notion.spaces) {
    if (!s.key || !s.pageId) throw new Error(`知识源缺 key 或 pageId：${JSON.stringify(s)}`);
    if (!/^[0-9a-f]{32}$/i.test(s.pageId.replace(/-/g, ''))) {
      throw new Error(`pageId 不是 32 位十六进制：${s.key} = ${s.pageId}`);
    }
  }
  if (cfg.embedding.provider === 'openai-compatible' && !cfg.embedding.baseUrl) {
    throw new Error('embedding.provider=openai-compatible 时必须给 baseUrl');
  }

  return cfg;
}

/**
 * 从「配置里写的环境变量名」取值。
 *
 * ⚠️ 报错必须说清楚**是哪个变量名**没设 —— 只说「缺 key」会让人去翻代码。
 */
export function requireEnv(name: string, why: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `环境变量 ${name} 没设（${why}）。\n` +
        `把它写进 .env，或者：  export ${name}=...`,
    );
  }
  return v.trim();
}

export function optionalEnv(name?: string): string | undefined {
  if (!name) return undefined;
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}
