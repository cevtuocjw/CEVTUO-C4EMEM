/**
 * 把「对话里说好的一个功能」**真的做出来** —— 不是出个步骤就完了。
 *
 * 读者 2026-10-13 原话：
 *   「你要能接 api deepseek 然后做出来一个对话反复处理，**最终能帮我做出来这个功能**」
 *
 * ⚠️⚠️ 这个项目**刻意拒绝过"自动写代码再自动上线"**（见 `proposals.ts` 开头）——
 *    理由是失败时是静默的：页面照常、只是新功能点开是空的。
 *    **那个判断是对的**，所以这里也不写代码。
 *
 * ⇒ **走确定性的那条路**：模型只负责产出一份**结构化的定义**（`SourceSpec`），
 *   由这个文件把它**应用**到真实数据上 —— 读真的文件、进真的库、回真的条数。
 *
 * ⭐ 判据从来不是"模型说它做好了"，是**`docsAdded` / `chunksAdded` 这两个真数**，
 *   外加"装完之后去搜，真能搜到"。
 *
 * ⚠️ 表达不了的，**如实拒绝**并说清能做的是哪一半 —— 不假装。
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import type { Database } from 'bun:sqlite';
import type { Doc } from './notion/extract';
import type { Embedder } from './embed';
import { indexDocs } from './sync';

/** 模型给出的、可执行的一份定义。**能被应用，也能被拒绝。** */
export interface SourceSpec {
  /** 现在只认真这两种 —— 别的会**如实拒绝**，不猜 */
  kind: 'folder' | 'url';
  /** 这个功能叫什么（用户说了算，模型不许改） */
  name: string;
  /** kind=folder：读哪一棵树 */
  path?: string;
  /** kind=url：读哪个网址 */
  url?: string;
  /** 收哪些后缀（空 = 一份默认表） */
  exts?: string[];
  /** 落到哪个 space（空 = 从 name 生成） */
  space?: string;
}

/**
 * 默认收哪些后缀。
 * ⚠️ 只收**纯文本类**：本机没有 PDF/Office 解码器，
 *    收进来会得到一坨二进制噪声 —— 而"读到了但全是乱码"和"读到了"在计数上一样。
 */
const TEXT_EXT = [
  '.md', '.markdown', '.txt', '.text', '.json', '.csv', '.log', '.yml', '.yaml',
  '.ts', '.tsx', '.js', '.jsx', '.py', '.sh', '.css', '.html', '.sql', '.toml', '.ini', '.conf',
];

/** 不进去的目录（这些地方进去了也全是噪声，而且很深）。 */
const SKIP_DIR = new Set([
  'node_modules', '.git', '.svn', 'dist', 'build', '.next', '.cache', '__pycache__',
  'Library', '.Trash', 'venv', '.venv', 'target', 'Pods', '.gradle',
]);

const MAX_FILES = 400;          // ⚠️ 有上限，而且**要把丢了多少说出去**，不能静默截断
const MAX_BYTES = 200 * 1024;   // 单文件 200KB —— 超过的当"不是给人看的"
const MAX_DEPTH = 8;

export interface WalkResult { docs: Doc[]; scanned: number; skipped: number; truncated: number; errors: string[] }

/** 走一棵文件夹，产出能进库的 Doc。**同步返回真数**。 */
export function walkFolder(spec: SourceSpec): WalkResult {
  const root = String(spec.path || '').trim();
  const exts = (spec.exts?.length ? spec.exts : TEXT_EXT).map((e) => (e.startsWith('.') ? e : '.' + e)).map((e) => e.toLowerCase());
  const space = spaceOf(spec);
  const out: Doc[] = [];
  const errors: string[] = [];
  let scanned = 0, skipped = 0, truncated = 0;

  let rootStat;
  try { rootStat = statSync(root); } catch { return { docs: [], scanned: 0, skipped: 0, truncated: 0, errors: [`读不到这个目录：${root}`] }; }
  if (!rootStat.isDirectory()) return { docs: [], scanned: 0, skipped: 0, truncated: 0, errors: [`不是一个目录：${root}`] };

  const walk = (dir: string, depth: number) => {
    if (out.length >= MAX_FILES) { truncated++; return; }
    if (depth > MAX_DEPTH) return;
    let names: string[];
    try { names = readdirSync(dir); } catch (e) { errors.push(`${dir}: ${String(e).slice(0, 80)}`); return; }
    for (const nm of names) {
      if (out.length >= MAX_FILES) { truncated++; return; }
      if (nm.startsWith('.')) continue;
      const full = join(dir, nm);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { if (!SKIP_DIR.has(nm)) walk(full, depth + 1); continue; }
      if (!st.isFile()) continue;
      scanned++;
      if (!exts.includes(extname(nm).toLowerCase())) { skipped++; continue; }
      if (st.size > MAX_BYTES) { skipped++; continue; }
      let text: string;
      try { text = readFileSync(full, 'utf8'); } catch { skipped++; continue; }
      // ⚠️ 二进制伪装成 .txt 是常有的事 —— NUL 一多就当它不是文本。
      //    不挡的话，库里会多一堆不可搜的噪声，而**计数看着完全正常**。
      const nul = (text.match(/\u0000/g) || []).length;
      if (nul > text.length / 100) { skipped++; continue; }
      if (text.trim().length < 20) { skipped++; continue; }
      const rel = full.slice(root.length).replace(/^\/+/, '');
      out.push({
        id: `src:${space}:${rel}`,
        space,
        date: new Date(st.mtimeMs).toISOString().slice(0, 10),
        title: basename(nm, extname(nm)),
        // ⚠️ 路径要写进正文：用户记得的是"那个文件在哪"，不是它的内容
        text: `[${spec.name}] ${rel}\n\n${text}`,
        url: `file://${full}`,
        lines: text.split('\n').length,
      });
    }
  };
  walk(root, 0);
  if (out.length >= MAX_FILES) truncated = Math.max(truncated, 1);
  return { docs: out, scanned, skipped, truncated, errors };
}

/** 抓一个网址，抽成一段能进库的文本。 */
export async function fetchUrlDoc(spec: SourceSpec): Promise<{ docs: Doc[]; error?: string }> {
  const url = String(spec.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return { docs: [], error: '这不是一个 http/https 网址' };
  const space = spaceOf(spec);
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (c4emem sourcekit)' }, redirect: 'follow' });
    if (!r.ok) return { docs: [], error: `抓不到（HTTP ${r.status}）` };
    const html = await r.text();
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url).trim().slice(0, 120);
    // ⚠️ 剥标签这一步**只做到"够读"**：脚本/样式整段去掉，其余标签换行。
    //    认真做要一个解析器 + 一个可读性算法，而那是另一件事。
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    if (text.length < 40) return { docs: [], error: '抓到了，但里面几乎没有能读的文字（大概是纯前端渲染的页面）' };
    return {
      docs: [{
        id: `src:${space}:${url}`, space,
        date: new Date().toISOString().slice(0, 10),
        title, text: `[${spec.name}] ${url}\n\n${text}`, url,
        lines: text.split('\n').length,
      }],
    };
  } catch (e) {
    // ⚠️ 网络错误**照原样带出去** —— 只回一个 null 让人对着空白猜（FACT 里那条）
    return { docs: [], error: `抓取失败：${String(e).slice(0, 120)}` };
  }
}

/** space 只能用小写字母数字和下划线（`spaces` 是库里的键） */
export function spaceOf(spec: SourceSpec): string {
  const raw = String(spec.space || spec.name || 'src').toLowerCase();
  const s = raw.replace(/[^a-z0-9_]/g, '').slice(0, 24);
  return s || 'src';
}

/** 从模型那段文字里把 ```spec 那一块抠出来。抠不到就返回 null（**不猜**）。 */
export function parseSpec(text: string): { spec: SourceSpec | null; prose: string } {
  const m = String(text).match(/```spec\s*([\s\S]*?)```/i);
  if (!m) return { spec: null, prose: String(text) };
  let spec: SourceSpec | null = null;
  try {
    const j = JSON.parse(m[1].trim());
    if (j && (j.kind === 'folder' || j.kind === 'url') && j.name) {
      spec = { kind: j.kind, name: String(j.name).slice(0, 60), path: j.path, url: j.url, exts: j.exts, space: j.space };
    }
  } catch { spec = null; }
  // 那段 JSON 不该显示给用户看（他是要看"它打算做什么"，不是看一串括号）
  return { spec, prose: String(text).replace(m[0], '').trim() };
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  /** ⭐⭐ 这两个是**真数** —— 判据只有它们，没有"模型说做好了" */
  docsAdded: number;
  chunksAdded: number;
  scanned: number;
  skipped: number;
  truncated: number;
  warnings: string[];
  space: string;
}

/**
 * 把一份 spec **应用**到真实数据上。
 *
 * ⚠️ 这个函数**只做确定的事**：走盘 / 抓网页 → 切块 → 嵌入 → 落库。
 *    它不认识"帮我做个连 OneDrive 的功能"这种话 —— 那是模型翻译成 spec 的活。
 */
export async function applySource(
  spec: SourceSpec, db: Database, embedder: Embedder, log: (m: string) => void,
): Promise<ApplyResult> {
  const space = spaceOf(spec);
  const base: ApplyResult = { ok: false, docsAdded: 0, chunksAdded: 0, scanned: 0, skipped: 0, truncated: 0, warnings: [], space };

  let docs: Doc[] = [];
  if (spec.kind === 'folder') {
    if (!spec.path) return { ...base, error: '这个功能要读一个文件夹，但没说读哪个 —— 去「设置 → 这个软件能用你的什么」里先给它授权一个目录' };
    const w = walkFolder(spec);
    if (!w.docs.length) {
      return { ...base, scanned: w.scanned, skipped: w.skipped, warnings: w.errors,
        error: `在这个目录里没找到能读的文本文件（看了 ${w.scanned} 个，跳过 ${w.skipped} 个）` };
    }
    docs = w.docs;
    Object.assign(base, { scanned: w.scanned, skipped: w.skipped, truncated: w.truncated, warnings: w.errors.slice(0, 3) });
  } else if (spec.kind === 'url') {
    const r = await fetchUrlDoc(spec);
    if (!r.docs.length) return { ...base, error: r.error || '没抓到内容' };
    docs = r.docs;
  } else {
    return { ...base, error: `现在还做不了「${(spec as { kind: string }).kind}」这类 —— 目前只认「读一个文件夹」和「读一个网址」` };
  }

  log(`[sourcekit] ${spec.name} → ${docs.length} 篇`);
  // ⚠️⚠️ `indexDocs` 返回的是**写进去的"文档"数**，**不是切块数**。
  //    我第一版把两个数取自同一个返回值 ⇒ 报出来"2 篇 / 2 段"，
  //    而实际是"2 篇 / 若干段" —— 这种数**看着完全正常**，
  //    正是这个项目最贵的那一课（同一个返回值冒充两个量纲）。
  // ⇒ 切块数**另数一次**，从库里按 space 查。
  const n = await indexDocs(db, embedder, spec.name, docs, log, { chunkChars: 420, overlapChars: 80 });
  let chunks = 0;
  try {
    const row = db.query('SELECT COUNT(*) AS n FROM chunks WHERE space = ?').get(space) as { n?: number } | null;
    chunks = Number(row?.n ?? 0);
  } catch { chunks = 0; }
  return { ...base, ok: true, docsAdded: n, chunksAdded: chunks };
}
