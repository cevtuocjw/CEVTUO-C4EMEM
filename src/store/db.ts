/**
 * 本地存储 —— bun:sqlite（Bun 内置，不用装任何东西）。
 *
 * 三张表 + 一张 FTS5 虚拟表：
 *   docs    一份「一天」的笔记（按 @date 切开）
 *   chunks  文档切块（检索的最小单位）
 *   vec     向量（Float32Array 存成 BLOB）
 *   chunks_fts  FTS5 —— 中文按「字」而不是按词，所以用 unicode61 + trigram 都试过，
 *              最终用 trigram：中文检索在 trigram 下才稳定。
 *
 * ⚠️ 向量检索是**暴力余弦**，不是 ANN。几千条 chunk 量级下
 * 50 万次浮点乘加 ≈ 几毫秒，引 ANN 索引只会先把事情搞复杂。
 * 等 chunk 数过 5 万再考虑 sqlite-vec。
 */
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface DocRow {
  id: string;
  space: string;
  date: string;
  title: string;
  text: string;
  url: string | null;
  hash: string;
  syncedAt: string;
}

export interface ChunkRow {
  id: string;
  docId: string;
  space: string;
  date: string;
  ord: number;
  text: string;
}

export interface Hit extends ChunkRow {
  /** RRF 融合分。⚠️ 它是**排名**的函数（1/(k+rank)），不是相似度 —— 一条腿时
   *  所有查询都会得到一模一样的 0.0164/0.0161/…，看着像坏了。要判断相关性看 `sim`。 */
  score: number;
  /** 向量余弦（只有向量腿命中时有）。**这个数才是"有多像"。** */
  sim?: number;
  /** 命中来自哪一路：向量 / 关键词 / 两路都有 */
  via: 'vector' | 'keyword' | 'both';
  docTitle: string;
}

export function openDb(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'c4emem.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  migrate(db);
  return db;
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs (
      id        TEXT PRIMARY KEY,
      space     TEXT NOT NULL,
      date      TEXT NOT NULL,
      title     TEXT NOT NULL DEFAULT '',
      text      TEXT NOT NULL,
      url       TEXT,
      hash      TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_docs_space ON docs(space);
    CREATE INDEX IF NOT EXISTS idx_docs_date  ON docs(date);

    CREATE TABLE IF NOT EXISTS chunks (
      id     TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      space  TEXT NOT NULL,
      date   TEXT NOT NULL,
      ord    INTEGER NOT NULL,
      text   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);

    CREATE TABLE IF NOT EXISTS vec (
      chunk_id TEXT PRIMARY KEY,
      dim      INTEGER NOT NULL,
      v        BLOB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);

    -- 统一记录：不管来源是每日推荐 / workflow / 语音 / 普通对话，全都写这一张表。
    -- 用 icon + kind 区分（用户要求：记录在一起，但要能一眼看出这次是什么）。
    CREATE TABLE IF NOT EXISTS activity (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      kind     TEXT NOT NULL,      -- ask | search | recommend | sync | notion | voice | flow
      icon     TEXT NOT NULL,      -- 显示用，例如 '💬'
      title    TEXT NOT NULL,
      detail   TEXT,
      ts       TEXT NOT NULL,      -- ISO
      ms       INTEGER,            -- 这次花了多久
      tok_in   INTEGER,
      tok_out  INTEGER,
      tok_sum  INTEGER,
      meta     TEXT,
      session_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts DESC);

    -- 工作区「主动」那一块：它给出来的东西 + **你处理了没有**。
    -- ⚠️ 和 activity 是两回事：activity 是**流水**（每问一句就多一条，只增不改），
    --    这里是**待办板**（同一件事只出现一次，而且状态会被你改）。
    --    混在一起的话，改状态就会改到历史流水上。
    CREATE TABLE IF NOT EXISTS panel (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      key    TEXT NOT NULL UNIQUE,        -- 去重键：**同一件事只能有一条**
      kind   TEXT NOT NULL,               -- proactive | todo | note
      icon   TEXT NOT NULL DEFAULT '',
      title  TEXT NOT NULL,
      detail TEXT,
      src    TEXT NOT NULL DEFAULT '',    -- 归属来源（exmail / notion / …）
      ts     TEXT NOT NULL,               -- 什么时候出来的
      due    TEXT,                        -- 什么时候要（抽不到就是空，**不猜**）
      state  TEXT NOT NULL DEFAULT 'new'  -- new | done | skipped
    );
    CREATE INDEX IF NOT EXISTS idx_panel_state ON panel(state, ts DESC);

    -- workflow 的积木块 / 最近的输入片段。只保留最近 50 条。
    CREATE TABLE IF NOT EXISTS blocks (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      kind    TEXT NOT NULL,   -- voice | text | image | link | file | clip | notion | wecom | feishu | search | llm | output
      label   TEXT NOT NULL,
      payload TEXT,
      ts      TEXT NOT NULL
    );
  `);

  // 中文检索：trigram 分词器对中文比 unicode61 稳（unicode61 会把
  // 一整句中文当成一个 token，等于搜不到）。
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
    USING fts5(chunk_id UNINDEXED, text, tokenize='trigram');
  `);

  // ⚠️⚠️ 老库要补列，而且**必须在建索引之前**。
  //    CREATE TABLE IF NOT EXISTS 对**已存在**的表什么都不做 ⇒ 新列不会出现；
  //    而我在上面的大块里就写了 `CREATE INDEX ... ON activity(session_id)`，
  //    于是老库一启动就 `SQLiteError: no such column: session_id`，服务直接起不来。
  //    顺序：先补列，再依赖这一列。
  ensureColumn(db, 'activity', 'session_id', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_activity_session ON activity(session_id);');
}

// ── 写入 ─────────────────────────────────────────────────────
export function upsertDoc(db: Database, d: DocRow) {
  db.query(
    `INSERT INTO docs (id, space, date, title, text, url, hash, synced_at)
     VALUES ($id, $space, $date, $title, $text, $url, $hash, $syncedAt)
     ON CONFLICT(id) DO UPDATE SET
       space=excluded.space, date=excluded.date, title=excluded.title,
       text=excluded.text, url=excluded.url, hash=excluded.hash,
       synced_at=excluded.synced_at`,
  ).run({ $id: d.id, $space: d.space, $date: d.date, $title: d.title, $text: d.text, $url: d.url, $hash: d.hash, $syncedAt: d.syncedAt });
}

/** 换块时先清掉这个 document 的旧块（连同向量和 FTS 行）。 */
export function deleteChunksOfDoc(db: Database, docId: string) {
  const ids = db.query<{ id: string }, [string]>('SELECT id FROM chunks WHERE doc_id = ?').all(docId);
  for (const { id } of ids) {
    db.query('DELETE FROM vec WHERE chunk_id = ?').run(id);
    db.query('DELETE FROM chunks_fts WHERE chunk_id = ?').run(id);
  }
  db.query('DELETE FROM chunks WHERE doc_id = ?').run(docId);
}

export function insertChunk(db: Database, c: ChunkRow, vec: Float32Array) {
  db.query(
    `INSERT INTO chunks (id, doc_id, space, date, ord, text)
     VALUES ($id, $docId, $space, $date, $ord, $text)`,
  ).run({ $id: c.id, $docId: c.docId, $space: c.space, $date: c.date, $ord: c.ord, $text: c.text });

  db.query('INSERT INTO chunks_fts (chunk_id, text) VALUES (?, ?)').run(c.id, c.text);

  db.query('INSERT INTO vec (chunk_id, dim, v) VALUES (?, ?, ?)').run(
    c.id,
    vec.length,
    new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength),
  );
}

export function setMeta(db: Database, k: string, v: string) {
  db.query('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v);
}
export function getMeta(db: Database, k: string): string | null {
  return db.query<{ v: string }, [string]>('SELECT v FROM meta WHERE k = ?').get(k)?.v ?? null;
}

export function docHash(db: Database, id: string): string | null {
  return db.query<{ hash: string }, [string]>('SELECT hash FROM docs WHERE id = ?').get(id)?.hash ?? null;
}

// ── 检索的两条腿 ─────────────────────────────────────────────

/**
 * 来源过滤：先取出这些来源下的 chunk id。
 *
 * ⚠️ 为什么不在 SQL 里直接 `AND space IN (...)`：FTS5 虚拟表不一定有 space 列，
 *    向量表压根没有。取一次 id 集合（实测 3183 块，一次查询）比给两条腿各写一个 JOIN
 *    更不容易出错，而且两条腿用的是**同一份**判据 —— 分开写迟早会漂。
 */
export function allowedChunks(db: Database, spaces?: string[]): Set<string> | null {
  if (!spaces || !spaces.length) return null;
  const ph = spaces.map(() => '?').join(',');
  const rows = db.query<{ id: string }, any[]>(`SELECT id FROM chunks WHERE space IN (${ph})`).all(...spaces);
  return new Set(rows.map((r) => r.id));
}

/** 关键词腿：FTS5 BM25。 */
export function keywordSearch(db: Database, query: string, limit: number, allow?: Set<string> | null): Map<string, number> {
  const out = new Map<string, number>();
  const q = sanitizeFts(query);
  if (!q) return out;
  try {
    const rows = db
      .query<{ chunk_id: string; score: number }, [string, number]>(
        `SELECT chunk_id, bm25(chunks_fts) AS score
         FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY score LIMIT ?`,
      )
      .all(q, limit);
    // bm25() 越小越相关 —— 取负号变成「越大越好」。
    for (const r of rows) if (!allow || allow.has(r.chunk_id)) out.set(r.chunk_id, -r.score);
  } catch {
    // FTS 语法错（用户输入里有特殊字符）不该让整个检索失败 —— 退化成只用向量腿。
  }
  return out;
}

/**
 * 把用户输入变成 FTS5 查询。
 *
 * ⚠️ 这里曾经是整条腿的致命 bug：原实现把**整句问题**包成一个短语
 * （`"Product Content Engineer 这个职位"`），于是永远匹配不到任何东西 ——
 * 关键词腿一次都没出过力，而这件事是**静默的**：检索照样有结果（向量腿给的），
 * 分数照样像个分数。是评测里 `via` 清一色是 `v` 才露的马脚。
 *
 * 现在：切成若干短语，用 OR 连。中文没空格 → 整句是一个短语，长问句多半命中不了，
 * 那由向量腿兜 —— 这是**有意的**，不是遗漏。
 */
function sanitizeFts(q: string): string {
  const parts = q
    .replace(/["'()*:^\-]/g, ' ')
    .split(/[\s,，。、？?！!；;：:·|/\\…—]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (!parts.length) return '';
  // 每个短语内部仍是"连续匹配"，但短语之间是 OR —— 至少专名/单词能命中
  return parts.map((t) => `"${t}"`).join(' OR ');
}

/** 向量腿：暴力余弦。 */
export function vectorSearch(db: Database, qv: Float32Array, limit: number, allow?: Set<string> | null): Map<string, number> {
  const out = new Map<string, number>();
  const rows = db.query<{ chunk_id: string; dim: number; v: Uint8Array }, []>('SELECT chunk_id, dim, v FROM vec').all();
  const scored: { id: string; s: number }[] = [];
  for (const r of rows) {
    if (allow && !allow.has(r.chunk_id)) continue;
    const f = new Float32Array(r.v.buffer, r.v.byteOffset, r.v.byteLength / 4);
    let s = 0;
    for (let i = 0; i < f.length; i += 1) s += f[i] * qv[i];
    scored.push({ id: r.chunk_id, s });
  }
  scored.sort((a, b) => b.s - a.s);
  for (const { id, s } of scored.slice(0, limit)) out.set(id, s);
  return out;
}

export function hydrate(db: Database, ids: string[]): Map<string, ChunkRow & { docTitle: string }> {
  const out = new Map<string, ChunkRow & { docTitle: string }>();
  if (ids.length === 0) return out;
  const ph = ids.map(() => '?').join(',');
  const rows = db
    .query<any, any[]>(
      `SELECT c.*, d.title AS doc_title FROM chunks c
       JOIN docs d ON d.id = c.doc_id
       WHERE c.id IN (${ph})`,
    )
    .all(...ids);
  for (const r of rows) {
    out.set(r.id, {
      id: r.id, docId: r.doc_id, space: r.space, date: r.date, ord: r.ord, text: r.text, docTitle: r.doc_title,
    });
  }
  return out;
}

// ── 块（workflow 的积木 / 最近的输入）────────────────────────
export interface BlockRow {
  id: number;
  kind: string;
  label: string;
  payload: string | null;
  ts: string;
}

/** 只保留最近 N 条 —— 用户要求「只保留最近 50 条 block」。 */
export const KEEP_BLOCKS = 50;

export function addBlock(
  db: Database,
  b: { kind: string; label: string; payload?: unknown },
): number {
  db.query('INSERT INTO blocks (kind, label, payload, ts) VALUES ($k,$l,$p,$t)').run({
    $k: b.kind,
    $l: b.label.slice(0, 300),
    $p: b.payload === undefined ? null : JSON.stringify(b.payload),
    $t: new Date().toISOString(),
  });
  const id = db.query<{ id: number }, []>('SELECT last_insert_rowid() id').get()?.id ?? 0;
  // 顺手裁剪 —— 不裁的话这张表会一直长
  db.query(
    `DELETE FROM blocks WHERE id NOT IN (SELECT id FROM blocks ORDER BY id DESC LIMIT ${KEEP_BLOCKS})`,
  ).run();
  return id;
}

export function listBlocks(db: Database, limit = KEEP_BLOCKS): BlockRow[] {
  return db
    .query<BlockRow, [number]>('SELECT * FROM blocks ORDER BY id DESC LIMIT ?')
    .all(Math.min(limit, KEEP_BLOCKS));
}

export function deleteBlock(db: Database, id: number) {
  db.query('DELETE FROM blocks WHERE id = ?').run(id);
}

/** 「最近用过的 kind」—— workflow 里按 `/` 时要按最近用过来排（用户要求有记忆）。 */
export function recentKinds(db: Database, limit = 6): string[] {
  return db
    .query<{ kind: string }, [number]>(
      'SELECT kind, MAX(id) m FROM blocks GROUP BY kind ORDER BY m DESC LIMIT ?',
    )
    .all(limit)
    .map((r) => r.kind);
}

// ── 统一记录 ─────────────────────────────────────────────────
export interface ActivityRow {
  id: number;
  kind: string;
  icon: string;
  title: string;
  detail: string | null;
  ts: string;
  ms: number | null;
  tok_in: number | null;
  tok_out: number | null;
  tok_sum: number | null;
  meta: string | null;
}

export function addActivity(
  db: Database,
  a: {
    kind: string;
    icon: string;
    title: string;
    detail?: string;
    ms?: number;
    tokIn?: number;
    tokOut?: number;
    meta?: unknown;
    sessionId?: string;
  },
): number {
  /*
   * ⚠️⚠️ **这里绝不能抛。**
   * 真实事故（2026-10-14 验收时撞上）：`/api/pet/save` 里 `savePet` **已经成功**、
   * 文件也写下去了，紧跟着这一行 `INSERT` 因为底层库 I/O 出错抛了 ⇒ 整个路由回 500。
   * 调用方看到的是"失败了"，而**东西其实已经存好了** ——
   * 和"收到成功回执、数据没动"是同一枚硬币的两面。
   *
   * ⭐ 活动流水是**附加信息**，不是关键路径 ⇒ 它挂掉只该少一条记录。
   * （这个项目的规矩：依赖挂掉要降级，不能 500。）
   */
  try {
    db.query(
      `INSERT INTO activity (kind, icon, title, detail, ts, ms, tok_in, tok_out, tok_sum, meta, session_id)
       VALUES ($kind,$icon,$title,$detail,$ts,$ms,$tin,$tout,$tsum,$meta,$sid)`,
    ).run({
      $kind: a.kind,
      $icon: a.icon,
      $title: a.title,
      $detail: a.detail ?? null,
      $ts: new Date().toISOString(),
      $ms: a.ms ?? null,
      $tin: a.tokIn ?? null,
      $tout: a.tokOut ?? null,
      $tsum: (a.tokIn ?? 0) + (a.tokOut ?? 0) || null,
      $meta: a.meta ? JSON.stringify(a.meta) : null,
      $sid: a.sessionId ?? null,
    });
    const r = db.query<{ id: number }, []>('SELECT last_insert_rowid() id').get();
    return r?.id ?? 0;
  } catch (e) {
    // ⚠️ 但要**留痕**（只喊一次）—— 静默吃掉的话，"流水里少了东西"永远查不出来
    if (!_addActivityWarned) {
      _addActivityWarned = true;
      console.warn(`[activity] 写不进去（只喊这一次）：${String(e).slice(0, 160)}`);
    }
    return 0;
  }
}
let _addActivityWarned = false;

/** 加一列（幂等）。SQLite 没有 ADD COLUMN IF NOT EXISTS，只能先问 PRAGMA。 */
function ensureColumn(db: Database, table: string, col: string, decl: string) {
  const cols = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}
export { ensureColumn };

/** 一次对话里的所有轮次（按发生顺序）。「记录能续聊」靠它。 */
/**
 * ⭐ 批量删记录（读者 2026-10-10：「记录也应该带搜索和**批量删除**功能」）。
 *
 * ⚠️⚠️ **只删"记录"这一栏，不删会话**：会话（`session`/轮次）是"你当时问过什么"，
 *    记录是"这件事发生过"的流水。删了记录，会话还接得上 —— 这是刻意的：
 *    一个批量删除按钮顺手把对话历史一起抹掉，那是不可逆的损失，而界面上看不出区别。
 * ⚠️ 参数化 `IN (…)` 占位符**按数组长度现拼** —— 这个是 SQL 参数的标准做法，
 *    拼的是占位符个数不是值本身，值仍然走绑定（别把 id 直接插进字符串）。
 */
export function deleteActivity(db: Database, ids: number[]): number {
  const list = ids.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  if (!list.length) return 0;
  const holes = list.map(() => '?').join(',');
  const r = db.query(`DELETE FROM activity WHERE id IN (${holes})`).run(...list);
  return Number(r.changes ?? 0);
}

export function turnsOfSession(db: Database, sessionId: string): ActivityRow[] {
  return db
    .query<ActivityRow, [string]>(
      'SELECT * FROM activity WHERE session_id = ? ORDER BY id ASC',
    )
    .all(sessionId);
}

/** 最近的会话（每个会话只取最新一轮的时间和首句，用来列出来）。 */
export function recentSessions(db: Database, limit = 40) {
  return db
    .query<{ session_id: string; turns: number; last: string; first: string }, [number]>(
      `SELECT session_id, COUNT(*) turns, MAX(ts) last, MIN(title) first
         FROM activity
        WHERE session_id IS NOT NULL AND session_id != ''
        GROUP BY session_id
        ORDER BY MAX(id) DESC
        LIMIT ?`,
    )
    .all(limit);
}

export function listActivity(db: Database, limit = 120, kind?: string): ActivityRow[] {
  return kind
    ? db.query<ActivityRow, [string, number]>('SELECT * FROM activity WHERE kind = ? ORDER BY id DESC LIMIT ?').all(kind, limit)
    : db.query<ActivityRow, [number]>('SELECT * FROM activity ORDER BY id DESC LIMIT ?').all(limit);
}

/** 用量汇总：总量 + 按类型 + 按天（最近 14 天）。 */
export function usageSummary(db: Database) {
  const tot = db
    .query<{ n: number; tin: number; tout: number; tsum: number; ms: number }, []>(
      'SELECT COUNT(*) n, COALESCE(SUM(tok_in),0) tin, COALESCE(SUM(tok_out),0) tout, COALESCE(SUM(tok_sum),0) tsum, COALESCE(SUM(ms),0) ms FROM activity WHERE tok_sum IS NOT NULL',
    )
    .get();
  const byKind = db
    .query<{ kind: string; n: number; tsum: number; ms: number }, []>(
      'SELECT kind, COUNT(*) n, COALESCE(SUM(tok_sum),0) tsum, COALESCE(SUM(ms),0) ms FROM activity GROUP BY kind ORDER BY tsum DESC',
    )
    .all();
  const byDay = db
    .query<{ day: string; n: number; tsum: number }, []>(
      "SELECT substr(ts,1,10) day, COUNT(*) n, COALESCE(SUM(tok_sum),0) tsum FROM activity GROUP BY day ORDER BY day DESC LIMIT 14",
    )
    .all();
  return { total: tot, byKind, byDay };
}

export function stats(db: Database) {
  const docs = db.query<{ n: number }, []>('SELECT COUNT(*) n FROM docs').get()?.n ?? 0;
  const chunks = db.query<{ n: number }, []>('SELECT COUNT(*) n FROM chunks').get()?.n ?? 0;
  const vecs = db.query<{ n: number }, []>('SELECT COUNT(*) n FROM vec').get()?.n ?? 0;
  const bySpace = db
    .query<{ space: string; n: number }, []>('SELECT space, COUNT(*) n FROM docs GROUP BY space ORDER BY n DESC')
    .all();
  return { docs, chunks, vecs, bySpace };
}
