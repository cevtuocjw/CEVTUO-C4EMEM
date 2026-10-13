/**
 * 功能提案 —— 「自我改进」那一屏里，**还没变成功能**的那些想法。
 *
 * 读者 2026-10-10 原话：
 *   「然后选中的软件之后，自动就应该它给的功能建议就更新（**只列这个软件可以做的功能**），
 *    然后这个功能有**沟通，开始制作，安装**这样的功能」
 *   「你直接说，也是，处理完之后就在上边列出来这个新增的功能，然后可以沟通，制作安装」
 *
 * ⚠️⚠️ 为什么**必须落盘**：提案是模型当场生成的一段文字。
 *    不存的话，切走再回来、或者刷新一下，它就没了 —— 而"想清楚要做什么"
 *    和"决定开始做"之间**隔着好几天**。存不住的提案等于没有提案。
 *
 * ⚠️ 状态只有三个，别再加：
 *    `idea`      = 刚想出来，还没想清楚怎么做
 *    `planned`   = 已经让它出了实现步骤（**还是没写代码**）
 *    `installed` = 真的装上侧栏了
 *    ⚠️ **没有 `building` / `done` 这种中间态。** 自动写代码再自动上线，
 *      失败时是**静默**的（页面照常，只是新功能点开是空的）——
 *      所以这里宁可不假装"正在做"，让人看着方案自己决定。
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ProposalMsg { q: string; a: string; ts: string }

export interface Proposal {
  id: string;
  /** 针对哪个软件（空字符串 = 用户直接说想要什么，没指定软件） */
  app: string;
  /** 一句话：这个功能是什么 */
  title: string;
  /** 方案正文 */
  plan: string;
  state: 'idea' | 'planned' | 'installed';
  /** 真装上侧栏之后，记下装的是哪个功能 —— 卸载按钮要用它 */
  featureId?: string;
  msgs: ProposalMsg[];
  ts: string;
}

interface Store { items: Proposal[] }

const fileOf = (dataDir: string) => join(dataDir, 'proposals.json');

export function loadProposals(dataDir: string): Store {
  const p = fileOf(dataDir);
  if (!existsSync(p)) return { items: [] };
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return { items: Array.isArray(j?.items) ? j.items : [] };
  } catch {
    // ⚠️ 坏文件**不装作没有** —— 直接当空表继续写的话，用户攒的提案会被静默抹掉。
    try { renameSync(p, `${p}.bad-${Date.now()}`); } catch { /* 留档失败也不能当成空表 */ }
    return { items: [] };
  }
}

function save(dataDir: string, s: Store) {
  mkdirSync(dataDir, { recursive: true });
  const p = fileOf(dataDir);
  writeFileSync(`${p}.tmp`, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
  renameSync(`${p}.tmp`, p);
}

/** 从模型给的那段文字里抠出一句话当标题 —— 不另花一次调用。 */
function titleOf(text: string, app: string): string {
  const first = String(text).split('\n').map((s) => s.replace(/^[\s#*\d.、）-]+/, '').trim()).find((s) => s.length >= 6);
  return (first ?? (app ? `给「${app}」加个功能` : '一个新功能')).slice(0, 80);
}

export function addProposal(dataDir: string, p: { app?: string; plan: string; title?: string }) {
  const plan = String(p.plan ?? '').trim();
  if (!plan) return { ok: false as const, error: '方案是空的' };
  const app = String(p.app ?? '').trim().slice(0, 60);
  const s = loadProposals(dataDir);
  // ⚠️ 同一个软件、同一段方案**不要存两遍** —— 连点两次"想功能"会得到两条一样的，
  //    而列表里看起来像"它给了两个一样的建议"。
  if (s.items.some((x) => x.plan === plan && x.app === app)) {
    return { ok: true as const, item: s.items.find((x) => x.plan === plan && x.app === app)!, dup: true };
  }
  const item: Proposal = {
    id: `p${Date.now().toString(36)}`,
    app,
    title: String(p.title ?? '').trim() || titleOf(plan, app),
    plan, state: 'idea', msgs: [],
    ts: new Date().toISOString(),
  };
  s.items.unshift(item);
  save(dataDir, s);
  return { ok: true as const, item, dup: false };
}

/** 改一条提案（状态 / 方案 / 关联的功能 id）。 */
export function patchProposal(dataDir: string, id: string, patch: Partial<Proposal>) {
  const s = loadProposals(dataDir);
  const it = s.items.find((x) => x.id === id);
  if (!it) return { ok: false as const, error: '找不到这条提案（可能已经被删了）' };
  Object.assign(it, patch, { id: it.id, msgs: patch.msgs ?? it.msgs });
  save(dataDir, s);
  return { ok: true as const, item: it };
}

/** 往一条提案的对话里追加一轮。 */
export function appendMsg(dataDir: string, id: string, q: string, a: string) {
  const s = loadProposals(dataDir);
  const it = s.items.find((x) => x.id === id);
  if (!it) return { ok: false as const, error: '找不到这条提案' };
  it.msgs.push({ q, a, ts: new Date().toISOString() });
  save(dataDir, s);
  return { ok: true as const, item: it };
}

export function removeProposal(dataDir: string, id: string) {
  const s = loadProposals(dataDir);
  const before = s.items.length;
  s.items = s.items.filter((x) => x.id !== id);
  if (s.items.length !== before) save(dataDir, s);
  return { ok: true as const, removed: before - s.items.length };
}
