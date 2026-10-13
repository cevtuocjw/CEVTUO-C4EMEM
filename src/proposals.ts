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
  /**
   * ⭐ 模型在对话里给出的**可执行定义**（读哪个目录/网址）。
   * ⚠️ 它和 `plan` 是两回事：`plan` 是给人读的散文，这个是给机器执行的。
   *    混成一个字段的话，"它说得多好"和"它真能做"就分不开了。
   */
  spec?: unknown;
  /**
   * ⭐ **做出来的结果**（真条数）。
   * ⚠️ 它必须**存下来**：界面整块重画一次就没了的数字，等于没报 ——
   *    我第一版把结果只写在那一行 DOM 上，`renderKb()` 一跑就变成
   *    「做出来了，去左边那一栏看看」——**真数被冲掉了**，而"报真数"正是这件事的意义。
   *    存下来之后，重开这一屏还能看见"上次读到 4 篇"。
   */
  made?: { docs: number; chunks: number; scanned: number; truncated: number; space: string; at: string };
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
  const lines = String(text).split('\n');
  // ⚠️⚠️ 原来的兜底是"取第一行够长的"，于是老提案的标题变成了
  //    `先说结论：**Clash Party 接不了` —— **把正文第一行当名字**，
  //    列表里一屏全是这种。读者 2026-10-13 说"看不出来是什么"。
  //    ⇒ ① 有 `## 功能N：名字` 这种标题就**优先用标题**（那才是给它起的名字）；
  //       ② 洗掉 markdown 记号和「先说结论：」这种开场白。
  const clean = (x: string) => x
    .replace(/^\s*#{1,4}\s*/, '')
    .replace(/^\s*功能\s*[一二三四五六七八九十\d]+\s*[：:]\s*/, '')
    .replace(/^\s*先说结论\s*[：:]\s*/, '')
    .replace(/[*`>]/g, '')
    .trim();
  const head = lines.find((l) => /^\s*#{1,4}\s+\S/.test(l));
  const fromHead = head ? clean(head) : '';
  if (fromHead.length >= 2) return fromHead.slice(0, 60);
  const first = lines.map(clean).find((x) => x.length >= 6);
  return (first ?? (app ? `给「${app}」加个功能` : '一个新功能')).slice(0, 60);
}

export function addProposal(dataDir: string, p: { app?: string; plan: string; title?: string }) {
  const plan = String(p.plan ?? '').trim();
  if (!plan) return { ok: false as const, error: '方案是空的' };
  const app = String(p.app ?? '').trim().slice(0, 60);
  const s = loadProposals(dataDir);
  const title = String(p.title ?? '').trim() || titleOf(plan, app);
  // ⚠️⚠️ 去重的判据**要按"人眼看的那个字段"**（标题），不是"整条数据相等"。
  //    只比 `plan` 实测**一条都拦不住**：模型每次生成的正文略有出入，
  //    于是"再点一次想功能"就多一条，读者看到的是**三个几乎一样的窗口**
  //    （`京麦能接，而且值得接。` × 3，正文后半段各不同）。
  //    ⇒ ① 整段方案一模一样 ⇒ 重复；② **同一个软件 + 标题前 8 个字一样** ⇒ 也算重复。
  // ⚠️⚠️ 但**必须先把软件名从标题头上摘掉**再比 —— 直接取"前 10 个字"是错的，
  //    而它错得很像对的：`Clash Party 接不了。` 和 `Clash Party 能接，但只能接流量日志`
  //    前 10 个字都是 `Clash Part` ⇒ **两条结论相反的被并成一条**。
  //    软件名有几个字是不固定的（「京麦」2 个、「Clash Party」11 个），
  //    所以"取前 N 个字"天生不稳。（这条是技能 `local-llm-chat` 自证时抓出来的。）
  const bare = (t: string, a: string) => {
    const s = String(t || '').replace(/\s+/g, ' ').trim();
    return a && s.toLowerCase().startsWith(a.toLowerCase()) ? s.slice(a.length).trim() : s;
  };
  const keyOf = (t: string, a: string) => { const b = bare(t, a); return b.length >= 8 ? b.slice(0, 8) : b; };
  const mine = keyOf(title, app);
  const dupOf = (x: Proposal) =>
    (x.plan === plan && x.app === app) ||
    (x.app === app && mine.length >= 2 && keyOf(x.title, x.app) === mine);
  if (s.items.some(dupOf)) {
    return { ok: true as const, item: s.items.find(dupOf)!, dup: true };
  }
  const item: Proposal = {
    id: `p${Date.now().toString(36)}`,
    app,
    title,
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
