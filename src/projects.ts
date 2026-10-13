/**
 * 项目档案 —— 把一个项目相关的**邮件 + 笔记 + 报价**聚到一处。
 *
 * 读者 2026-10-10 排的第二件：「按项目聚合邮件 + 笔记 + 报价
 * （埃及 7 台 RTG / 西安轨道吊 / 越南·马来）」。
 *
 * ⚠️⚠️ **先量再设计**，这一步把第一版设计直接推翻了 ——
 *    我本来打算按"地名 + 设备"从正文里抽项目名。实测：
 *    **「西安」在全库命中 12 条，而真正跟西安轨道吊有关的只有 1 条**
 *    （其余 11 条命中的是通知 / 值班安排里的地址之类模板文字）。
 *    也就是说"西安"在这份语料里是个**地名**，不是项目名 ——
 *    按它聚会把一堆无关通知塞进同一个档案，而那个档案**单看很像回事**。
 *    ⇒ 中文自由文本里靠地名/名词聚项目**不可靠**，不能当主判据。
 *
 * ⭐ 最后只认**四类可解释的信号**，每一类都说得出"这条凭什么归到这里"：
 *    ① `code`   项目编号（`XS001203` / `INVP-4719112`）—— 出现即强信号，正则可靠
 *    ② `org`    对方机构（按邮件域名）—— 一个客户一块，这是这份语料里最实的一类
 *    ③ `event`  会展 / 活动（`TOC Asia 2026`）—— 标题里的大写词组 + 年份
 *    ④ `manual` **你自己建的** —— "埃及 7 台 RTG"这种名字**自动抽不出来，别硬抽**，
 *               交给用户定名字和关键词，才是唯一能抓准的办法
 *
 * ⚠️ `org` 严格说不是"项目"而是"客户 / 机构"—— **分开展示、分别标名**。
 *    把两种东西标成同一个词，用户就没法据此判断该先看哪个。
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import type { Thread } from './threads';

export type ProjectKind = 'code' | 'org' | 'event' | 'manual';

export interface ProjectItem {
  id: string;
  space: string;
  date: string;
  title: string;
  /**
   * 正文第一行 —— **标题为空时的兜底**。
   * ⚠️ 实测 `learn` 里 **291/307 条笔记没有 title**（Notion 那边抽出来就是空的），
   *    不兜底的话「埃及 7 台 RTG」那块档案 5 条里 4 条只有日期和来源，**看起来像渲染坏了**。
   * ⚠️ 不把兜底值写进 `title`：`title` 要保持**如实**，是空的就是空的。
   */
  snippet: string;
  /** 命中哪些词 —— **可解释**是这一块能不能被信任的全部 */
  hit: string[];
  quote: boolean;
  /** 这条落在一个"来回几条"的线程里（>1 才有意义） */
  threadN: number;
  threadSubject: string;
}

export interface Project {
  key: string;
  name: string;
  kind: ProjectKind;
  /** 靠什么聚起来的（一句话，摆给用户看） */
  basis: string;
  keywords: string[];
  n: number;
  mail: number;
  note: number;
  quotes: number;
  bySpace: { space: string; n: number }[];
  first: string;
  last: string;
  /** 其中有多少条落在一个"来回好几封"的线程里 */
  inThreads: number;
  items: ProjectItem[];
  /**
   * **弱命中**：提到过、但不像是"在讲这件事"的那些（见 `kwBelongs`）。
   *
   * ⚠️ 为什么不直接丢掉：丢掉的话，用户看到"笔记 0"会以为功能没连上，
   *    而真相是"你的笔记里确实只在边上提过一句"。**把取舍权交回给人** ——
   *    这和本项目检索那边 `weakBelow` 的思路是同一条（那条的语义是
   *    "这条不太可信"，不是"没有"）。
   */
  maybe: ProjectItem[];
  maybeN: number;
}

export interface ManualProject {
  id: string;
  name: string;
  keywords: string[];
  note?: string;
}

interface Store { projects: ManualProject[] }

const fileOf = (dataDir: string) => join(dataDir, 'projects.json');

export function loadProjects(dataDir: string): Store {
  const p = fileOf(dataDir);
  if (!existsSync(p)) return { projects: [] };
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return { projects: Array.isArray(j?.projects) ? j.projects : [] };
  } catch {
    // ⚠️ 坏文件**不装作没有** —— 直接当空表继续写的话，用户建过的项目会**被静默抹掉**。
    //    留档再重来（和 features.json 同一套做法）。
    try { renameSync(p, `${p}.bad-${Date.now()}`); } catch { /* 留档失败也不能当成空表 */ }
    return { projects: [] };
  }
}

function saveProjects(dataDir: string, s: Store) {
  mkdirSync(dataDir, { recursive: true });
  const p = fileOf(dataDir);
  writeFileSync(`${p}.tmp`, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
  renameSync(`${p}.tmp`, p);
}

/**
 * ⚠️ 关键词**至少 2 个字符**。
 *    单字当关键词的后果是灾难性的：`西` 会匹配到半个库（"东西 / 西部 / 西安 / 西班牙"…），
 *    而用户以为自己只圈了一个项目。这条不是洁癖 —— 它是"圈得准不准"的分水岭。
 */
export function addProject(dataDir: string, name: string, keywords: string[], note = '') {
  const nm = String(name ?? '').trim().slice(0, 60);
  if (!nm) return { ok: false as const, error: '项目要有个名字' };
  const kws = [...new Set((keywords ?? []).map((k) => String(k).trim()).filter(Boolean))];
  const bad = kws.filter((k) => [...k].length < 2);
  if (bad.length) return { ok: false as const, error: `关键词太短（至少要 2 个字）：${bad.join('、')} —— 单字会匹配一大片，圈不准` };
  if (!kws.length) return { ok: false as const, error: '至少要给一个关键词，不然认不出哪些内容属于这个项目' };
  const s = loadProjects(dataDir);
  if (s.projects.some((p) => p.name === nm)) return { ok: false as const, error: `已经有一个叫「${nm}」的项目了` };
  const id = `m${Date.now().toString(36)}`;
  const proj: ManualProject = { id, name: nm, keywords: kws, note: String(note ?? '').slice(0, 200) };
  s.projects.push(proj);
  saveProjects(dataDir, s);
  return { ok: true as const, project: proj };
}

export function removeProject(dataDir: string, id: string) {
  const s = loadProjects(dataDir);
  const before = s.projects.length;
  s.projects = s.projects.filter((p) => p.id !== id);
  if (s.projects.length !== before) saveProjects(dataDir, s);
  return { ok: true as const, removed: before - s.projects.length };
}

// ── 自动发现 ───────────────────────────────────────────────────────

/** 项目编号：`XS001203` / `INVP-4719112` / `XS001203-1`。 */
const CODE_RE = /\b[A-Z]{2,4}[-_]?\d{5,}(?:[-/]\d{1,4})*\b/g;
/** 会展 / 活动：标题里的大写词组 + 年份（`TOC Asia 2026`）。 */
const EVENT_RE = /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,3})\s+(\d{4})\b/g;
/** 报价类内容 —— 读者特意点了名的"报价"。 */
const QUOTE_RE = /报价|询价|招标|quotation|\bquotes?\b|RFQ|offer sheet/i;
/** 免费邮箱 / 自家 —— 这些**不能**当"对方机构"。 */
const FREEMAIL = /^(gmail|qq|163|126|outlook|hotmail|foxmail|sina|sohu|aliyun|icloud|yahoo|exmail\.qq)\./i;

/**
 * 关键词命中判断。
 *
 * ⚠️⚠️ 纯英文/数字的关键词**必须按词边界匹配**，不能当子串。
 *    实测：自建项目「埃及 7 台 RTG」用 `RTG` 当子串匹配，把
 *    「爱丁堡公爵奖」「全球贸易逆差」「北爱尔兰」都收了进来 ——
 *    因为它们正文里的**网址/单词里含 `rtg`**。5 条里 4 条是噪声，
 *    而档案**看起来完全正常**（有条目、有日期、有来源）。
 *    中文没有词边界这回事，只能子串 —— 但中文关键词本身也少见这种误伤。
 */
function kwMatch(text: string, kw: string): boolean {
  const k = String(kw).trim();
  if (!k) return false;
  if (/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(k)) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)`, 'i').test(text);
  }
  return text.toLowerCase().includes(k.toLowerCase());
}

/** 数它出现了几次（英文照样按词边界）。 */
function countOccur(text: string, kw: string): number {
  const k = String(kw).trim();
  if (!k) return 0;
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(k)
    ? new RegExp(`(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)`, 'gi')
    : new RegExp(esc, 'gi');
  return (text.match(re) ?? []).length;
}

/**
 * 一条内容到底算不算"**关于**"这个关键词。
 *
 * ⚠️⚠️ 光"提到过"**远远不够** —— 这条也是量出来的：
 *    实测「埃及 7 台 RTG」按"提过就算"圈进来 5 条，其中 4 条是
 *    爱丁堡公爵奖、北爱尔兰、全球贸易逆差这类**综合长笔记**，
 *    里面 `埃及` 出现 1~2 次、`RTG` 出现在网址里。真命中那封邮件是 **T(标题命中)**。
 *    ⇒ 判据：**标题里写着** ⇒ 一定是；否则正文里要**反复提**（≥3 次）
 *      或者它本来就是条**短内容**（≤800 字，提一次就够说明它在讲这个）。
 *    一句话：**一条内容"关于"某个项目的时候，它会反复提到它。**
 */
function kwBelongs(title: string, body: string, kw: string): boolean {
  if (kwMatch(title, kw)) return true;
  const text = `${title}\n${body}`;
  if (!kwMatch(text, kw)) return false;
  return countOccur(text, kw) >= 3 || text.length <= 800;
}

const cutHead = (t: string) => {
  const i = String(t).indexOf('\n\n');
  return i >= 0 ? String(t).slice(0, i) : String(t).slice(0, 1200);
};

interface Row { id: string; space: string; date: string; title: string; text: string }

function rowsOf(db: Database, spaces?: string[]): Row[] {
  if (!spaces?.length) return db.query<Row, []>('SELECT id, space, date, title, text FROM docs').all();
  const ph = spaces.map(() => '?').join(',');
  return db.query<Row, any[]>(`SELECT id, space, date, title, text FROM docs WHERE space IN (${ph})`).all(...spaces);
}

/** 邮件发件人那一行的域名（拿它当"对方机构"）。 */
function senderDomain(r: Row): string {
  if (r.space !== 'exmail' && r.space !== 'wecom') return '';
  const from = cutHead(r.text).match(/发件人：([^\n]*)/)?.[1] ?? '';
  const d = (from.match(/@([a-z0-9.-]+)/i)?.[1] ?? '').toLowerCase();
  return d && !FREEMAIL.test(d) ? d : '';
}

export interface ProjectOpts {
  /** 一份内容至少要几条命中才立成"项目"（默认 2）—— 见下面那条注释 */
  minN?: number;
  /** 我的邮箱域名（自己的域名不算"对方机构"） */
  selfDomain?: string;
  /** 每块档案里最多列几条明细（默认 8） */
  limit?: number;
  spaces?: string[];
  /** 读自建项目要它；不给就只做自动发现 */
  dataDir?: string;
  /** `threads()` 的结果 —— 用来标出"这条是一串对话里的" */
  threads?: Thread[];
}

export function discoverProjects(db: Database, opts: ProjectOpts = {}): Project[] {
  const minN = Math.max(1, opts.minN ?? 2);
  const limit = Math.max(1, opts.limit ?? 8);
  const rows = rowsOf(db, opts.spaces);
  if (!rows.length) return [];

  const byId = new Map(rows.map((r) => [r.id, r]));
  // 哪条内容落在哪条线程里（docId → 线程）—— 用 `threads()` 的结果，不重算一遍
  const threadOf = new Map<string, Thread>();
  for (const t of opts.threads ?? []) for (const m of t.msgs) threadOf.set(m.id, t);

  /** 信号 → (docId → 命中的那个词)。用 Map 而不是 Set：**要能把"命中什么"说出来**。 */
  const codeHits = new Map<string, Map<string, string>>();
  const orgHits = new Map<string, Map<string, string>>();
  const eventHits = new Map<string, Map<string, string>>();
  const put = (m: Map<string, Map<string, string>>, k: string, id: string, word: string) => {
    const inner = m.get(k) ?? new Map<string, string>();
    inner.set(id, word);
    m.set(k, inner);
  };

  for (const r of rows) {
    // ⚠️⚠️ 编号**只认标题**，不认头部、更不认正文 —— 这条是量出来的：
    //    · 正文里的编号多半是引用别的东西（订单号 / 发票号 / 券号）；
    //    · **头部里那更糟**：`线索：root=…` 那一行装的是 Message-ID，
    //      实测 `ACC89972` 在标题和正文里出现 **0 次**、头部 **2 次** ——
    //      它是从 Message-ID 中间抠出来的一段十六进制。
    //      按它立档案，等于**把随机串当项目名**，而且每条看起来都很正常。
    //    ⇒ 标题是唯一"人故意写上去"的位置。
    for (const m of r.title.matchAll(CODE_RE)) put(codeHits, m[0].toUpperCase(), r.id, m[0]);
    for (const m of r.title.matchAll(EVENT_RE)) put(eventHits, `${m[1]} ${m[2]}`, r.id, `${m[1]} ${m[2]}`);
    const d = senderDomain(r);
    if (d && d !== (opts.selfDomain ?? '')) put(orgHits, d, r.id, `@${d}`);
  }

  /**
   * ⭐⭐ 把**同一条线索里的其它信**也算进来。
   *
   * ⚠️ 这一步是实测逼出来的：`informa.com` 一开始只收到 **9 条**，而那串对话其实有 12 封 ——
   *    因为**我发出去的那一半，发件人是我**（域名 pingfang.net），按"来自该域名"根本收不到。
   *    而"这个客户我们聊了什么"本来就应该包含**双方**：只有对方那一半，
   *    读起来像一份"对方说了什么"的清单，而不是一段往来。
   */
  const expand = (ids: Map<string, string>, label: string) => {
    const out = new Map(ids);
    for (const id of [...ids.keys()]) {
      const th = threadOf.get(id);
      if (!th || th.n < 2) continue;
      for (const m of th.msgs) if (!out.has(m.id)) out.set(m.id, `与「${label}」同一条线索`);
    }
    return out;
  };

  const mk = (key: string, name: string, kind: ProjectKind, basis: string, keywords: string[], ids: Map<string, string>): Project =>
    summarize(key, name, kind, basis, keywords,
      [...ids.entries()].map(([id, word]) => buildItem(byId.get(id)!, [word], keywords, threadOf)), limit);

  const out: Project[] = [];
  // ⚠️ 一串编号的**主码 + 子码要合成一块**。实测那封标题里写着
  //    `西安轨道吊安全防护及智能装卸项目(XS001203/XS001203-1)工具辅材申请`，
  //    正则老老实实抽出两个 ⇒ 列表里并排出现**两块内容一模一样的档案**。
  //    折叠规则：短的当主码，谁以它开头就并进它。
  const folded = new Map<string, Map<string, string>>();
  for (const c of [...codeHits.keys()].sort((a, b) => a.length - b.length)) {
    const base = [...folded.keys()].find((k) => c.startsWith(k));
    if (base) {
      const tgt = folded.get(base)!;
      for (const [id] of codeHits.get(c)!) if (!tgt.has(id)) tgt.set(id, base);
      continue;
    }
    folded.set(c, new Map(codeHits.get(c)!));
  }
  for (const [code, ids] of folded) {
    // ⚠️ 编号**只要出现就立档案**（不设 minN）—— 因为它必须出现在**标题**里才算数，
    //    而人往主题行里写编号，是**故意的**（"这个项目的事"）。
    //    跟"正文里被引用一次的订单号"完全不是一回事。
    out.push(mk(`code:${code}`, code, 'code', `主题里带项目编号 ${code} 的内容`, [code], ids));
  }
  for (const [dom, ids] of orgHits) {
    if (ids.size < minN) continue;
    out.push(mk(`org:${dom}`, dom, 'org', `所有来自 @${dom} 的内容（含我回过去的那一半）`, [dom], expand(ids, dom)));
  }
  for (const [ev, ids] of eventHits) {
    if (ids.size < minN) continue;
    out.push(mk(`event:${ev}`, ev, 'event', `所有提到「${ev}」的内容`, [ev], ids));
  }
  for (const p of opts.dataDir ? loadProjects(opts.dataDir).projects : []) {
    const kws = p.keywords;
    const ids = new Map<string, string>();
    const weak = new Map<string, string>();
    for (const r of rows) {
      const strong = kws.find((k) => kwBelongs(r.title, r.text, k));
      if (strong) { ids.set(r.id, strong); continue; }
      const faint = kws.find((k) => kwMatch(`${r.title}\n${r.text}`, k));
      if (faint) weak.set(r.id, faint);
    }
    // ⚠️ 自建的**不设门槛**：用户自己圈的项目哪怕暂时一条都没有也要留着 ——
    //    不然它会"自己消失"，而用户只会以为是自己记错了。
    // ⚠️ 也**不做线索扩展**：这些条目是用户用关键词自己圈出来的，
    //    多塞进去的东西违背他的本意（他要的就是"只有这些"）。
    const proj = mk(`manual:${p.id}`, p.name, 'manual', `含关键词 ${kws.join(' / ')} 的内容`, kws, ids);
    proj.maybe = [...weak.entries()]
      .map(([id, w]) => buildItem(byId.get(id)!, [w], kws, threadOf))
      .sort((x, y) => (x.date < y.date ? 1 : -1));
    proj.maybeN = proj.maybe.length;
    proj.maybe = proj.maybe.slice(0, limit);
    out.push(proj);
  }

  return out.sort((a, b) => b.n - a.n || (a.last < b.last ? 1 : -1));
}

function buildItem(r: Row, words: string[], keywords: string[], threadOf: Map<string, Thread>): ProjectItem {
  if (!r) return { id: '', space: '', date: '', title: '', snippet: '', hit: words, quote: false, threadN: 0, threadSubject: '' };
  const cut = r.text.indexOf('\n\n');
  const snippet = (cut >= 0 ? r.text.slice(cut + 2) : r.text)
    .split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
  const text = `${r.title}\n${r.text}`;
  const auto = keywords.filter((k) => kwBelongs(r.title, r.text, k));
  const th = threadOf.get(r.id);
  // ⚠️ 去掉"被更长的那个包含"的词：机构档案里 `@informa.com`（信号）和
  //    `informa.com`（关键词自动匹配）会**并排显示两遍** ——
  //    而它们说的是同一件事，读起来像"命中了两条不同的规则"。
  const merged = [...new Set([...words, ...auto])];
  const hit = merged
    .filter((w) => !merged.some((o) => o !== w && o.length > w.length && o.toLowerCase().includes(w.toLowerCase())))
    // ⭐ 出现多次的把次数带上（`埃及×4`）—— 用户一眼能看出"它是反复提到的"
    //    还是"只在边上带了一句"，**这正是它被收进来的理由**。
    .map((w) => { const n = countOccur(text, w); return n > 1 ? `${w}×${n}` : w; });
  return {
    id: r.id, space: r.space, date: r.date, title: r.title, snippet,
    hit,
    // ⚠️ 「报价」只看**标题**。正文里出现"报价"太常见了（"贵司报价已收到"这种回信也算），
    //    按正文算的话**每一条**都会被标成报价，那个标记就等于没说话。
    quote: QUOTE_RE.test(r.title),
    threadN: th ? th.n : 0,
    threadSubject: th ? th.subject : '',
  };
}

function summarize(
  key: string, name: string, kind: ProjectKind, basis: string,
  keywords: string[], items: ProjectItem[], limit: number,
): Project {
  const nice = items
    .filter((i) => i.id)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const bySpace = new Map<string, number>();
  for (const i of nice) bySpace.set(i.space, (bySpace.get(i.space) ?? 0) + 1);
  const dates = nice.map((i) => i.date).filter((d) => d && d !== '0000-00-00').sort();
  const isMail = (s: string) => s === 'exmail' || s === 'wecom';
  return {
    key, name, kind, basis, keywords,
    n: nice.length,
    mail: nice.filter((i) => isMail(i.space)).length,
    note: nice.filter((i) => !isMail(i.space)).length,
    quotes: nice.filter((i) => i.quote).length,
    bySpace: [...bySpace].map(([space, n]) => ({ space, n })).sort((a, b) => b.n - a.n),
    first: dates[0] ?? '', last: dates[dates.length - 1] ?? '',
    inThreads: nice.filter((i) => i.threadN > 1).length,
    items: nice.slice(0, limit),
    maybe: [], maybeN: 0,
  };
}
