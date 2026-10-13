#!/usr/bin/env bun
/**
 * C4emem CLI —— P0「知识核心」的入口。
 *
 *   c4emem sync [--only learn] [--force]   把 Notion 拉下来建库
 *   c4emem search "问题" [--space learn]   只检索，给带出处的片段（不需要任何 key）
 *   c4emem ask "问题"                      检索 + 让 LLM 给一段带引用的答案
 *   c4emem stats                           库里有什么
 *   c4emem doctor                          自检：配置 / 密钥 / 网络 / 模型
 */
import { existsSync, readFileSync } from 'node:fs';
import { loadConfig, expandHome, type Config } from './config';
import { runSync } from './sync';
import { openDb, stats } from './store/db';
import { createEmbedder } from './embed';
import { retrieve } from './retrieve/hybrid';
import { createReranker } from './retrieve/rerank';
import { createLlm, buildAnswerPrompt } from './llm';

// ── 参数 ─────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'help';
const flag = (f: string) => argv.includes(f);
const after = (f: string): string | null => {
  const i = argv.indexOf(f);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};

const argsWithValues = new Set(['--only', '--space', '--config', '-n']);
/** 位置参数（跳过命令名和所有 --flag 及其值） */
const positional = (() => {
  const out: string[] = [];
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      if (argsWithValues.has(argv[i])) i += 1;
      continue;
    }
    out.push(argv[i]);
  }
  return out;
})();

/** config 里声明的额外 .env（例如复用 CEVTUO-Z 的那份），不覆盖已存在的变量。 */
function loadEnvFiles(cfg: Config) {
  for (const f of cfg.envFiles ?? []) {
    const p = expandHome(f);
    if (!existsSync(p)) {
      console.warn(`⚠️ envFiles 里这个文件不存在，跳过：${p}`);
      continue;
    }
    for (const raw of readFileSync(p, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (k && v && !process.env[k]) process.env[k] = v;
    }
  }
}

function cfgOrDie(): Config {
  try {
    const cfg = loadConfig(after('--config') ?? undefined);
    loadEnvFiles(cfg);
    return cfg;
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  }
}

const short = (s: string, n = 90) => (s.length > n ? s.slice(0, n) + '…' : s);

// ── 命令 ─────────────────────────────────────────────────────
async function cmdSync() {
  const cfg = cfgOrDie();
  const only = after('--only')?.split(',').map((s) => s.trim());
  await runSync(cfg, { only, force: flag('--force') });
}

async function cmdSearch(queryArg?: string) {
  const cfg = cfgOrDie();
  const query = (queryArg ?? positional.join(' ')).trim();
  if (!query) throw new Error('用法：c4emem search "你的问题"');
  const db = openDb(cfg.dataDir);
  const embedder = await createEmbedder(cfg);
  const hits = await retrieve(db, embedder, query, {
    topK: Number(after('-n') ?? cfg.retrieval.topK),
    candidates: cfg.retrieval.candidates,
    rrfK: cfg.retrieval.rrfK,
    space: after('--space') ?? undefined,
    reranker: createReranker(cfg),
    rerankTopN: cfg.rerank.topN,
    minScore: cfg.retrieval.minScore,
  });
  if (!hits.length) {
    console.log('没有命中。先跑 `c4emem sync` 建库？');
    return;
  }
  console.log(`\n命中 ${hits.length} 条：\n`);
  hits.forEach((h, i) => {
    const tag = h.via === 'both' ? '向量+关键词' : h.via === 'vector' ? '向量' : '关键词';
    const sim = h.sim === undefined ? '—' : h.sim.toFixed(4);
    console.log(`── [${i + 1}] ${h.space} · ${h.date} · ${tag} · 余弦 ${sim}`);
    console.log(`   ${short(h.text.replace(/\n/g, ' '), 260)}\n`);
  });
}

async function cmdAsk() {
  const cfg = cfgOrDie();
  const query = positional.join(' ').trim();
  if (!query) throw new Error('用法：c4emem ask "你的问题"');
  const db = openDb(cfg.dataDir);
  const embedder = await createEmbedder(cfg);
  const hits = await retrieve(db, embedder, query, {
    topK: cfg.retrieval.topK,
    candidates: cfg.retrieval.candidates,
    rrfK: cfg.retrieval.rrfK,
    space: after('--space') ?? undefined,
    reranker: createReranker(cfg),
    rerankTopN: cfg.rerank.topN,
    minScore: cfg.retrieval.minScore,
  });
  if (!hits.length) {
    console.log('没有命中。先跑 `c4emem sync` 建库？');
    return;
  }

  const llm = createLlm(cfg);
  if (!llm) {
    // 没配 LLM 不是错误 —— 降级成「只给检索结果」，这正是 search 干的事
    console.log('ℹ️ 没配 LLM key（config.llm.apiKeyEnv / .env），降级为只给检索结果。\n');
    await cmdSearch(query);
    return;
  }

  const context = hits.map((h) => ({ label: h.space, date: h.date, text: h.text }));
  const { system, user } = buildAnswerPrompt(query, context);
  const answer = await llm.chat([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
  console.log(`\n${answer}\n`);
  console.log('── 依据 ──');
  hits.forEach((h, i) =>
    console.log(`  [材料 ${i + 1}] ${h.space} · ${h.date} · ${short(h.text.replace(/\n/g, ' '), 80)}`),
  );
}

function cmdStats() {
  const cfg = cfgOrDie();
  const db = openDb(cfg.dataDir);
  const s = stats(db);
  console.log(`\n库：${cfg.dataDir}/c4emem.db`);
  console.log(`文档 ${s.docs} 段 · 切块 ${s.chunks} · 向量 ${s.vecs}\n`);
  if (s.bySpace.length) {
    console.log('按知识源：');
    for (const r of s.bySpace) console.log(`  ${r.space.padEnd(12)} ${r.n} 段`);
  }
}

async function cmdDoctor() {
  const cfg = cfgOrDie();
  console.log(`\n配置：${cfg._path}`);
  console.log(`数据目录：${cfg.dataDir}`);
  console.log(`知识源：${cfg.notion.spaces.map((s) => s.label).join(' / ')}`);

  const token = process.env[cfg.notion.apiKeyEnv];
  console.log(`\nNotion token（${cfg.notion.apiKeyEnv}）：${token ? '✅ 已设置' : '❌ 未设置'}`);

  const llmKey = cfg.llm.apiKeyEnv ? process.env[cfg.llm.apiKeyEnv] : undefined;
  console.log(
    `LLM（${cfg.llm.provider}）：` +
      (cfg.llm.provider === 'none'
        ? '— 未启用'
        : llmKey
          ? `✅ 已设置 ${cfg.llm.model}`
          : '⚠️ 没 key（ask 会降级成检索）'),
  );

  console.log(`\n嵌入：${cfg.embedding.provider} · ${cfg.embedding.model}`);
  const t0 = Date.now();
  try {
    const e = await createEmbedder(cfg);
    const [v] = await e.embed(['自检'], 'query');
    console.log(`✅ 嵌入可用，${v.length} 维，${Date.now() - t0}ms`);
  } catch (err) {
    console.log(`❌ 嵌入不可用：${(err as Error).message}`);
  }

  const dbFile = `${expandHome(cfg.dataDir)}/c4emem.db`;
  console.log(`\n本地库：${existsSync(dbFile) ? `✅ ${dbFile}` : '— 还没建（跑 c4emem sync）'}`);
}

function usage() {
  console.log(`C4emem —— 本地优先的个人知识库助手（P0 知识核心）

  c4emem sync [--only learn,techai] [--force]   拉 Notion 建库
  c4emem search "问题" [--space learn] [-n 8]   只检索（不需要任何 key）
  c4emem ask "问题"                              检索 + LLM 带引用回答
  c4emem stats                                   库里有什么
  c4emem doctor                                  自检

  第一次用：cp c4emem.config.example.json c4emem.config.json && cp .env.example .env`);
}

switch (cmd) {
  case 'sync': await cmdSync(); break;
  case 'search': await cmdSearch(); break;
  case 'ask': await cmdAsk(); break;
  case 'stats': cmdStats(); break;
  case 'doctor': await cmdDoctor(); break;
  default: usage();
}
