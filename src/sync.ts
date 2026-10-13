/**
 * 同步：Notion → 文档 → 切块 → 向量 → 本地库。
 *
 * 三件事按这个顺序，不能换：
 *   1. 抽内容（网络，慢，会失败）
 *   2. 切块 + 算 hash，**没变的文档不重算**（增量）
 *   3. 嵌入 + 落库
 *
 * ⚠️ 增量靠 hash：文档文本没变就直接跳过嵌入。全量重嵌一次几百条没问题，
 *    但每天同步都全量重嵌就是白烧 CPU —— 而且这个浪费会一直涨。
 */
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import type { Database } from 'bun:sqlite';
import type { Config } from './config';
import { requireEnv } from './config';
import { NotionClient } from './notion/client';
import { extractSpace, type Doc } from './notion/extract';
import { createEmbedder, type Embedder } from './embed';
import {
  openDb, upsertDoc, deleteChunksOfDoc, insertChunk, docHash, setMeta, getMeta, stats,
} from './store/db';

/** 把一批文档切块/嵌入/落库 —— Notion 之外的来源（邮件/Figma/手机）也走这里。 */
export async function indexDocs(
  db: Database,
  embedder: Embedder,
  label: string,
  docs: Doc[],
  log: (m: string) => void,
  opts: { chunkChars: number; overlapChars: number; force?: boolean } = { chunkChars: 420, overlapChars: 80 },
): Promise<number> {
  const pending: { doc: Doc; chunks: string[] }[] = [];
  for (const doc of docs) {
    if (!opts.force && docHash(db, doc.id) === sha1(doc.text)) continue;
    pending.push({ doc, chunks: chunkText(doc.text, opts.chunkChars, opts.overlapChars) });
  }
  if (!pending.length) {
    log('  内容没变，跳过嵌入');
    return 0;
  }
  let n = 0;
  for (const { doc, chunks } of pending) {
    const headed = chunks.map((c) => `[${label} ${doc.date}] ${c}`);
    const vectors = await embedder.embed(headed, 'doc');
    deleteChunksOfDoc(db, doc.id);
    upsertDoc(db, {
      id: doc.id, space: doc.space, date: doc.date, title: doc.title,
      text: doc.text, url: doc.url, hash: sha1(doc.text), syncedAt: new Date().toISOString(),
    });
    chunks.forEach((c, i) =>
      insertChunk(db, { id: `${doc.id}#${i}`, docId: doc.id, space: doc.space, date: doc.date, ord: i, text: headed[i] }, vectors[i]),
    );
    n += 1;
    if (n % 20 === 0) log(`  … ${n}/${pending.length}`);
  }
  log(`  ✓ 写入 ${n} 段`);
  return n;
}

export function chunkText(text: string, size: number, overlap: number): string[] {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.length);
  const out: string[] = [];
  let cur = '';
  for (const line of lines) {
    const next = cur ? `${cur}\n${line}` : line;
    if (next.length > size && cur) {
      out.push(cur);
      // 重叠：把上一块的尾巴带进下一块，避免答案正好被切在缝上
      const tail = cur.slice(-overlap).replace(/^[^\n]*\n?/, '');
      cur = tail ? `${tail}\n${line}` : line;
    } else {
      cur = next;
    }
  }
  if (cur.trim()) out.push(cur);
  return out.length ? out : [text];
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

export interface SyncOpts {
  only?: string[];
  force?: boolean;
  log?: (m: string) => void;
}

export async function runSync(cfg: Config, opts: SyncOpts = {}) {
  // ⚠️ 重定向到文件时 stdout 会**缓冲**：实测长任务里日志文件一直停在 22 字节，
  //    于是「在跑但没输出」和「卡死了」长得一模一样 —— 这个坑我因此多查了两轮。
  //    所以额外往 C4EMEM_PROGRESS 指的路径**同步 append**，它是立刻落盘的。
  const progressPath = process.env.C4EMEM_PROGRESS;
  const log =
    opts.log ??
    ((m: string) => {
      console.log(m);
      if (progressPath) {
        try {
          appendFileSync(progressPath, `${m}\n`);
        } catch {
          /* 进度日志写不了不该影响同步 */
        }
      }
    });
  const db = openDb(cfg.dataDir);
  const token = requireEnv(cfg.notion.apiKeyEnv, '同步 Notion 需要');
  const client = new NotionClient(token, cfg.notion.version, cfg.notion.minGapMs, log);

  const embedder = await createEmbedder(cfg, log);

  // ⚠️ 嵌入模型换了 = 旧向量全作废。与其算出一堆垃圾相似度，不如明说。
  const prevEmbed = getMeta(db, 'embedding.id');
  if (prevEmbed && prevEmbed !== embedder.id && !opts.force) {
    throw new Error(
      `嵌入模型变了：库里是 ${prevEmbed}，配置是 ${embedder.id}。\n` +
        `旧向量不可比，必须重建：  c4emem sync --force`,
    );
  }

  const targets = cfg.notion.spaces.filter((s) => !opts.only || opts.only.includes(s.key));
  if (!targets.length) throw new Error(`--only 没匹配到任何知识源：${opts.only?.join(',')}`);

  let totalDocs = 0;
  let totalChunks = 0;
  let embedded = 0;
  const t0 = Date.now();

  for (const space of targets) {
    log(`\n▸ ${space.label}（${space.key}）`);
    const tSpace = Date.now();
    const { docs, skipped, visited, byDepth } = await extractSpace(client, space, {
      // ⚠️ 空字符串 = 什么都别跳。
      //
      // CEVTUO-Z 那边跳过 `before` 是对的：那是个**公开看板**，你的归档不该出现在上面。
      // C4emem 是**个人知识库** —— 你自己的历史恰恰是「知识时间机器」最需要的。
      // 实测那一棵 `before` 子树占 Learn 全部 7297 块里的 6861 块（94%）。
      skipTitles: cfg.notion.skipTitles ? new RegExp(cfg.notion.skipTitles, 'i') : null,
      maxDepth: cfg.notion.maxDepth,
      log,
    });
    log(`  抽到 ${docs.length} 段（跳过 ${skipped} 个归档子树，${client.calls} 次请求，${((Date.now() - tSpace) / 1000).toFixed(1)}s）`);
    log(`  走访 ${visited} 块 · 各层分布 ${JSON.stringify(byDepth)}`);

    // 只对变了的文档做嵌入，先把要做的挑出来
    const pending: { doc: Doc; chunks: string[] }[] = [];
    for (const doc of docs) {
      totalDocs += 1;
      const h = sha1(doc.text);
      if (!opts.force && docHash(db, doc.id) === h) continue;
      const chunks = chunkText(doc.text, cfg.retrieval.chunkChars, cfg.retrieval.overlapChars);
      pending.push({ doc, chunks });
      totalChunks += chunks.length;
    }

    if (!pending.length) {
      log('  内容没变，跳过嵌入');
      continue;
    }

    let done = 0;
    for (const { doc, chunks } of pending) {
      // 每块带上「来源 + 日期」头 —— 两条检索腿都能用上，尤其时间类问题
      const headed = chunks.map((c) => `[${space.label} ${doc.date}] ${c}`);
      const vectors = await embedder.embed(headed, 'doc');

      deleteChunksOfDoc(db, doc.id);
      upsertDoc(db, {
        id: doc.id, space: doc.space, date: doc.date, title: doc.title,
        text: doc.text, url: doc.url, hash: sha1(doc.text), syncedAt: new Date().toISOString(),
      });
      chunks.forEach((c, i) => {
        insertChunk(db, { id: `${doc.id}#${i}`, docId: doc.id, space: doc.space, date: doc.date, ord: i, text: headed[i] }, vectors[i]);
      });

      embedded += 1;
      done += 1;
      if (done % 25 === 0) log(`  … ${done}/${pending.length}`);
    }
    log(`  ✓ 写入 ${pending.length} 段 / ${totalChunks} 块`);
  }

  setMeta(db, 'embedding.id', embedder.id);
  setMeta(db, 'embedding.dims', String(embedder.dims));
  setMeta(db, 'lastSync', new Date().toISOString());

  const s = stats(db);
  log(
    `\n✅ 完成 ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
      `本次更新 ${embedded} 段；库内共 ${s.docs} 段 / ${s.chunks} 块 / ${s.vecs} 向量`,
  );
  db.close();
}

export { openDb, getMeta };
export type { Database };
