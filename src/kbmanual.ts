/**
 * 手动输入 —— 「主题 / 词条 / 链接」这三个视图里由**人**写进去的条目。
 *
 * 为什么单独存一份，而不是塞进 out/vocab.json 那些：
 *   那三份是**生成产物** —— 跑一次脚本整份覆盖。手写的东西只要和它们住在一起，
 *   下一次重跑就被**静默抹掉**，而"我加的条目不见了"和"我压根没加过"
 *   在界面上长得一模一样，连报错都没有。
 *   ⇒ 手写的住 `out/manual.json`；**读取时合并**；生成脚本永远不碰这个文件。
 *
 * ⚠️ 判据是「重跑生成脚本之后，手写条目还在」—— **不是**「保存成功」。
 *    保存成功只说明写进去了，不说明它活得下来。见 scripts/verify-kbmanual.mjs。
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type ManualKind = 'vocab' | 'links' | 'tax';

export interface ManualEntry {
  id: string;
  ts: string;
  manual: true;
  /** 各 kind 自己的字段，见 normalize() */
  [k: string]: unknown;
}

export interface ManualStore {
  vocab: ManualEntry[];
  links: ManualEntry[];
  tax: ManualEntry[];
}

const KINDS: ManualKind[] = ['vocab', 'links', 'tax'];
const empty = (): ManualStore => ({ vocab: [], links: [], tax: [] });

export const manualPath = (outDir: string) => join(outDir, 'manual.json');

/**
 * ⚠️ 用**本地**日期，不是 `toISOString().slice(0,10)`。
 *    后者是 UTC —— 在东八区，本地 00:00~08:00 写进去的条目会**记成前一天**。
 *    这种错很难发现：日期看着像个正常日期，只是差了「昨天」。
 */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 读。⚠️ 文件坏了**不要装作没有** —— 返回空表的话，下一次添加会把它整份覆盖掉，
 *    于是"手写的东西没了"变成不可恢复。所以坏的先改名留档，再返回空表。
 */
export function loadManual(outDir: string): ManualStore {
  const p = manualPath(outDir);
  if (!existsSync(p)) return empty();
  const raw = readFileSync(p, 'utf8');
  if (!raw.trim()) return empty();
  try {
    const j = JSON.parse(raw);
    const s = empty();
    for (const k of KINDS) if (Array.isArray(j?.[k])) s[k] = j[k] as ManualEntry[];
    return s;
  } catch {
    const bak = `${p}.bad-${Date.now()}`;
    try {
      renameSync(p, bak);
    } catch {
      /* 留档失败也不能把它当成空表继续写 */
    }
    // 抛给调用方：**看得见的失败**比"悄悄地空了"好
    throw new Error(`out/manual.json 解析失败，原文件已留档到 ${bak}`);
  }
}

/** 先写临时文件再 rename —— 半截写入会让下一次读取拿到坏 JSON。 */
export function saveManual(outDir: string, s: ManualStore): void {
  mkdirSync(outDir, { recursive: true });
  const p = manualPath(outDir);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
  renameSync(tmp, p);
}

const rid = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const str = (v: unknown, max = 300) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/** 去重用的键 —— 和生成脚本里那条归一化规则一致（否则手写的和自动的会重复出现的"两条一样"）。 */
const vocabKey = (en: string, zh: string) =>
  `${en.toLowerCase().replace(/[^a-z0-9]/g, '')}|${zh.replace(/\s/g, '')}`;

/**
 * 手写一条**自动提取里本来就有**的词条时，要说出来。
 *
 * ⚠️ 这是截图上发现的：写了一条 a plum job / 一份令人羡慕的好工作，
 *    结果表里**并排出现两条长得一模一样** —— 一条是手写的、一条是自动的
 *    （出处不同而已）。用户看到的只是"重复"，不知道是自己刚加的。
 * ⇒ 不拦（他可能就是想给自己的版本加个备注），但**要说明白**。
 */
export function vocabExistsIn(v: any, en: string, zh: string) {
  const k = vocabKey(en, zh);
  return (
    ((v?.entries ?? []) as any[]).find(
      (e) => e.manual !== true && vocabKey(String(e.en ?? ''), String(e.zh ?? '')) === k,
    ) ?? null
  );
}

/** 从 URL 里取域名 —— 用户可能只贴 url 不填域名。 */
function domainOf(url: string): string {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * 校验 + 归一化。**缺什么就说缺什么** —— 静默存一条空条目比报错更坏。
 * 返回 null 时第二项是原因。
 */
function normalize(kind: ManualKind, item: Record<string, unknown>): { e: ManualEntry } | { err: string } {
  const ts = new Date().toISOString();
  if (kind === 'vocab') {
    const en = str(item.en, 120);
    const zh = str(item.zh, 120);
    if (!en && !zh) return { err: '至少填一个：英文 或 中文' };
    return { e: { id: rid(), ts, manual: true, en, zh, note: str(item.note, 400), date: today(), space: '手动' } };
  }
  if (kind === 'links') {
    const url = str(item.url, 800);
    const domain = str(item.domain, 200) || domainOf(url);
    if (!url && !domain) return { err: '至少填一个：链接 或 域名' };
    return { e: { id: rid(), ts, manual: true, url, domain, what: str(item.what, 200), cat: str(item.cat, 40) || '手动添加' } };
  }
  // tax
  const name = str(item.name, 60);
  if (!name) return { err: '主题名不能为空' };
  const kw = Array.isArray(item.keywords)
    ? (item.keywords as unknown[]).map((x) => str(x, 30)).filter(Boolean).slice(0, 8)
    : str(item.keywords, 200).split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
  return { e: { id: rid(), ts, manual: true, name, keywords: kw, note: str(item.note, 400) } };
}

/** 按 kind 去重用的键。同一件事手写两次 = 两条一样的东西，那不是"存下来了"是"存脏了"。 */
function dedupeKey(kind: ManualKind, e: ManualEntry): string {
  if (kind === 'vocab') return vocabKey(String(e.en ?? ''), String(e.zh ?? ''));
  if (kind === 'links') return String(e.domain ?? '') || String(e.url ?? '');
  return String(e.name ?? '');
}

export function addManual(outDir: string, kind: ManualKind, item: Record<string, unknown>) {
  if (!KINDS.includes(kind)) return { ok: false as const, error: `没有这一类：${kind}` };
  const r = normalize(kind, item);
  if ('err' in r) return { ok: false as const, error: r.err };
  const s = loadManual(outDir);
  const key = dedupeKey(kind, r.e);
  const dup = key ? s[kind].find((x) => dedupeKey(kind, x) === key) : null;
  if (dup) return { ok: true as const, entry: dup, deduped: true };
  s[kind].unshift(r.e);
  saveManual(outDir, s);
  return { ok: true as const, entry: r.e, deduped: false };
}

export function removeManual(outDir: string, kind: ManualKind, id: string) {
  if (!KINDS.includes(kind)) return { ok: false as const, error: `没有这一类：${kind}` };
  const s = loadManual(outDir);
  const before = s[kind].length;
  s[kind] = s[kind].filter((x) => x.id !== id);
  const removed = before - s[kind].length;
  if (removed) saveManual(outDir, s);
  return { ok: true as const, removed };
}

// ── 合并进三份生成产物 ────────────────────────────────────────
// ⚠️ 合并发生在**读取时**，不是生成时 —— 这才是"重跑冲不掉"的原因。

export function mergeVocab(v: any, s: ManualStore) {
  const man = s.vocab.map((m) => ({
    en: m.en, zh: m.zh, date: m.date, space: '手动', line: String(m.note ?? ''), kind: '手动',
    manual: true, id: m.id,
  }));
  const auto = (v?.entries ?? []) as any[];
  // 手写的排前面 —— 打开就能看见自己写的
  const entries = [...man, ...auto];
  return { ...(v ?? {}), total: entries.length, manualCount: man.length, entries };
}

export function mergeLinks(d: any, s: ManualStore) {
  if (!s.links.length) return d;
  // ⚠️ 生成产物还没跑过（`link-taxonomy.json` 不存在）时也要能手写 ——
  //    否则"我加一条"会没有任何地方显示出来，看起来像没保存。
  const cats = ((d?.categories ?? []) as any[]).map((c) => ({ ...c, items: [...(c.items ?? [])] }));
  for (const m of s.links) {
    const item = { i: -1, domain: m.domain, n: 1, title: '', ctx: '', what: m.what, url: m.url, manual: true, id: m.id };
    const c = cats.find((x) => x.cat === m.cat);
    if (c) c.items.unshift(item);
    else cats.push({ cat: m.cat, urlCount: 0, domainCount: 0, items: [item], manual: true });
  }
  // ⚠️ 计数要**重算**，不能只把条目塞进去 —— 否则表头写着 "465 条 / 285 域名"
  //    而列表里多出来的那几条不在数里。数字和列表对不上，比数字少一点更坏。
  for (const c of cats) {
    c.items.sort((a: any, b: any) => (b.manual ? 1 : 0) - (a.manual ? 1 : 0) || (b.n ?? 0) - (a.n ?? 0));
    c.domainCount = c.items.length;
    c.urlCount = c.items.reduce((a: number, b: any) => a + (Number(b.n) || 0), 0);
  }
  cats.sort((a: any, b: any) => (b.manual ? 1 : 0) - (a.manual ? 1 : 0) || b.urlCount - a.urlCount);
  return { generatedAt: d?.generatedAt ?? null, manualOnly: !d, ...(d ?? {}), manualCount: s.links.length, categories: cats };
}

export function mergeTax(t: any, s: ManualStore) {
  // ⚠️ 生成产物还没跑过时，手写的主题也要看得见（同 mergeLinks）。
  if (!t && !s.tax.length) return t;
  if (t && !s.tax.length) return t;
  const groups = ((t.groups ?? []) as any[]).map((g) => ({ ...g }));
  for (const m of s.tax) {
    groups.push({
      name: String(m.name),
      size: 0, // ⚠️ 诚实的 0：它下面确实没有任何被归类的文档
      manual: true,
      id: m.id,
      clusters: [{ id: -1, size: 0, name: String(m.name), desc: String(m.note ?? ''), keywords: m.keywords ?? [], manual: true }],
    });
  }
  return { generatedAt: t?.generatedAt ?? null, totalDocs: t?.totalDocs ?? 0, k: t?.k ?? 0, manualOnly: !t, ...(t ?? {}), manualCount: s.tax.length, groups };
}
