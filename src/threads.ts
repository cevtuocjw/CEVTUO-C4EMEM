/**
 * 线程未结提醒 —— 一条来回很多封的邮件线程，**到底有没有结论**。
 *
 * 读者 2026-10-10 排的第一个：现成抓手就是 Informa / TOC Asia 那串
 * 来回十几封、到今天没结的付款线程。
 *
 * ⚠️⚠️ 这一版和 `mailtodo.ts` 一样是**规则**做的，不是模型，理由也一样：
 *    ① 可解释 —— 每条结论旁边能写出"我凭什么这么说"（最后一封是谁发的、命中了哪个词）；
 *    ② 可验证 —— 同一份输入永远给同一份结论，`opts.now` 还能注进去；
 *    ③ 不花钱、不联网。
 *    ⚠️ 它**会判错**。所以界面上每条都把**最后一封的新内容**摆出来，
 *       让你一眼看出"它是不是看错了地方" —— 只给结论不给依据，用户只能信或不信。
 *
 * ⭐⭐ 判「有没有结论」真正的难点**不是措辞，是球在谁那边**：
 *    · 最后一封是**对方发的、里面有事要你做** ⇒ 你欠人一封回信 ⇒ **未结，该提醒**
 *    · 最后一封是**你发的** ⇒ 球在对方那边 ⇒ 只有**隔了很久**才值得提醒
 *    · 最后一封是一句「收到 / 谢谢」⇒ 结了，**别去打扰**
 *    所以下面所有信号都是围着"最后一封"算的。
 *
 * ⚠️⚠️ 词表和过滤器**从 `mailtodo.ts` 复用**，不在这边再抄一份 ——
 *    「这封在不在要我做点什么」两个功能问的是同一个问题，
 *    各抄一份的结果是同一封邮件在「待办」里算请求、在「线程」里不算，
 *    而两个页面各自看起来都正常。
 */
import type { Database } from 'bun:sqlite';
import { ACTIONS, ASK, AUTO_WORDS, DISCLAIMER, RULE_WORDS, sentences, stripQuoted } from './mailtodo';

export interface ThreadMsg {
  /** docs.id */
  id: string;
  /** Message-ID（去掉尖括号） */
  mid: string;
  subject: string;
  email: string;
  name: string;
  to: string;
  cc: string;
  /** ISO 时刻 —— ⚠️ 顺序判定靠它，不能靠 `date`（只到天） */
  ts: string;
  date: string;
  mine: boolean;
  /** 砍掉引用历史之后的**新内容** —— 判断只看这一段 */
  fresh: string;
}

export type ThreadStatus = 'waiting_me' | 'waiting_them' | 'closed' | 'quiet';

export interface Thread {
  id: string;
  /** 用来显示的标题（去掉 Re:/回复：前缀） */
  subject: string;
  n: number;
  first: string;
  last: string;
  lastTs: string;
  /** 最后一封距今多少天 */
  days: number;
  /** 靠什么分到一组的：refs=引用链就接全了／subject=中间断过，靠标题缝的 */
  via: ThreadVia;
  lastFrom: string;
  lastFromName: string;
  lastFromMe: boolean;
  status: ThreadStatus;
  /** 一句话结论 */
  heading: string;
  /** 凭什么这么判 —— 界面上要摆出来 */
  why: string[];
  /** 该不该提醒你（不是所有未结都值得打扰） */
  remind: boolean;
  /** 最后一封里认出来的"要你做的事"，原文 */
  asks: string[];
  participants: { name: string; email: string; n: number }[];
  msgs: ThreadMsg[];
}

/** 一股脑认下来的"确认/致谢"口气。⚠️ 只在**没有请求**时才算结案，见下面。 */
const ACK: RegExp[] = [
  /收到/, /好的/, /谢谢/, /感谢/, /明白/, /知悉/, /辛苦了/, /没问题/, /不用了/,
  /已(确认|处理|完成|安排|收到|付|支付|汇)/, /无需回复/, /请忽略/, /不用回复/,
  /\bnoted\b/i, /\bthanks\b/i, /\bthank you\b/i, /\bwell received\b/i, /\breceived with thanks\b/i,
  /\bno action (needed|required)\b/i, /\bresolved\b/i, /\bwill do\b/i, /\bunderstood\b/i, /\bclose(d)? (this|the) (case|thread)\b/i,
];

/**
 * 问句的**说法**（不只是问号）。
 *
 * ⚠️ 只认末尾的问号会漏掉最常见的一种催问：
 *    「Any update on the PO?」这种英文里 `update` 是动作词，可**没有** please/kindly，
 *    于是 ask+action 那条规则一条都命中不了 —— 而它恰恰是"球在你这边"的典型。
 *    中文同理：「是否已安排」「有没有收到」。
 *    ⇒ 把这些**问法**本身列出来，比猜标点可靠。
 */
const INTERROGATIVE: [RegExp, string][] = [
  [/\b(any|some)\s+(update|news|progress|feedback|comment|reply)\b/i, 'any update'],
  [/\b(could|can|would|will|shall)\s+(you|we)\b/i, 'could you'],
  [/\bwhat\s+about\b/i, 'what about'],
  [/\bhow\s+about\b/i, 'how about'],
  [/\bany\s+chance\b/i, 'any chance'],
  [/\bis\s+it\s+possible\b/i, 'is it possible'],
  [/\bwhen\s+(will|can|do|shall)\b/i, 'when will'],
  [/\bplease\s+(advise|confirm|let\s+us\s+know|inform)\b/i, 'please advise'],
  [/有没有/, '有没有'],
  [/是否/, '是否'],
  [/能不能/, '能不能'],
  [/可否/, '可否'],
  [/什么时候/, '什么时候'],
  [/多久/, '多久'],
];

/**
 * 群发通知的地址特征。
 *
 * ⚠️ 实测这条**必须**有：`公司车辆使用及专人管理通知` 发到
 *    `"全体组" <all@pingfang.net>`，正文里那句「遇车辆故障…需第一时间上报行政管理部」
 *    命中了 `需`+`上报`，于是**整条群发通知被报成"等你回"**。
 *    而"球在你这边"的前提是**单独找你要东西** —— 群发给全体组的时候，
 *    这件事压根不成立（是不是要你办，得你自己看内容）。
 */
const BROADCAST_NAME = /全体|所有人|各位|同事们|各部门|公告|通知组|all\b|everyone|all[-_ ]?staff|announce/i;
const BROADCAST_LOCAL = /^(all|everyone|everybody|allstaff|all-staff|notice|announce|announcements|group|company)$/i;

function isBroadcast(to: string, cc: string): boolean {
  const line = `${to} ${cc}`;
  if (BROADCAST_NAME.test(line)) return true;
  for (const a of emailsIn(line)) if (BROADCAST_LOCAL.test(a.split('@')[0])) return true;
  return emailsIn(line).length >= 6; // 一次发几十个人的，也不是单独找你
}

/**
 * 系统通知 —— **不是信**，没人等你回话。
 *
 * ⚠️ 实测第二次被它骗：`发件人已撤回邮件：2026年中秋节、国庆假放假通知`
 *    是**撤回回执**（正文是系统的"已撤回"说明），却被当成一封正常来信判了请求。
 *    读者自己那条关键词订阅需求里也点了名：「**撤回邮件**」。
 */
const SYSTEM_SUBJECT = /发件人已撤回邮件|撤回邮件|已撤回|^(\s*(re|fw|回复)\s*[:：]\s*)?(recall|undeliverable|delivery status notification|mail delivery (failed|subsystem)|退信|自动回复|auto[- ]?reply|out of office)/i;

const HEAD_RE = {
  subject: /主题：([^\n]*)/,
  from: /发件人：([^\n]*)/,
  to: /收件人：([^\n]*)/,
  cc: /抄送：([^\n]*)/,
  time: /时间：([^\n]*)/,
  link: /线索：root=(\S*)\s+parent=(\S*)/,
};

/** `"名字" <a@b.c>` / `名字 <a@b.c>` / `a@b.c` 三种写法都要认。 */
function parseAddr(s: string): { name: string; email: string } {
  const m = String(s).match(/^\s*"?([^"<]*?)"?\s*<([^>\s]+@[^>\s]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  const m2 = String(s).match(/([^\s<>,;@]+@[^\s<>,;.]+\.[^\s<>,;]+)/);
  if (m2) {
    const email = m2[1].trim().toLowerCase();
    // 名字取 `@` 前面那段（"changjw@pingfang.net" ⇒ changjw）
    return { name: email.split('@')[0], email };
  }
  return { name: String(s).trim().slice(0, 60), email: '' };
}

/** 一行里可能有多个地址，全部取出来。 */
function emailsIn(s: string): string[] {
  return (String(s).match(/[^\s<>,;@]+@[^\s<>,;.]+\.[^\s<>,;]+/g) ?? []).map((x) => x.toLowerCase());
}

const RE_PREFIX = /^\s*((re|fw|fwd|aw|sv)\s*[:：]|(回复|答复|转发|轉發|回覆|回信)\s*[:：])\s*/i;
const RE_ANY = /(re|fw|fwd|aw|sv)\s*[:：]|(回复|答复|转发|轉發|回覆|回信)\s*[:：]/gi;

export type ThreadVia = 'refs' | 'subject';

/** 去掉 Re:/RE:/回复：/转发： 这类前缀（可能叠好几层，最多剥 6 次）。 */
function bareSubject(s: string): string {
  let t = String(s);
  for (let i = 0; i < 6; i += 1) {
    const n = t.replace(RE_PREFIX, '');
    if (n === t) break;
    t = n;
  }
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * 用来比对的"标题核心" —— **把回复前缀从任何位置都抠掉**，不只是开头。
 *
 * ⚠️ 为什么不能只剥开头：这条邮箱里的标题是这样的 ——
 *    `Enquire Payment way 回复：回复：Re: 回复：Communication from Credit Control for…`
 *    「回复：」长在**句子中间**（各家客户端各写各的，谁也不管 RFC），
 *    只剥开头的话这几个标题互不相同，于是**同一条对话被拆成四段**。
 */
function coreSubject(s: string): string {
  return String(s)
    .replace(RE_ANY, ' ')
    .replace(/[\[\]【】()（）<>《》]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** 并查集 —— 信件之间的父子关系是一张**森林**，不是一条链。 */
function unionFind() {
  const p = new Map<string, string>();
  const find = (x: string): string => {
    const seen: string[] = [];
    let r = x;
    for (;;) {
      const nxt = p.get(r);
      if (!nxt || nxt === r) break;
      seen.push(r);
      r = nxt;
    }
    for (const s of seen) p.set(s, r);
    return r;
  };
  const union = (a: string, b: string) => {
    if (!a || !b || a === b) return;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) p.set(ra, rb);
  };
  return { find, union };
}

type ParsedMsg = ThreadMsg & { root: string; parent: string; hasLink: boolean };

/** 把一条 docs 行拆成"头部字段 + 新内容"。 */
function parseDoc(r: { id: string; date: string; title: string; text: string }): ParsedMsg {
  const text = String(r.text ?? '');
  const headEnd = text.indexOf('\n\n');
  const head = headEnd >= 0 ? text.slice(0, headEnd) : text.slice(0, 1200);
  const bodyRaw = headEnd >= 0 ? text.slice(headEnd + 2) : '';
  const f = parseAddr((head.match(HEAD_RE.from)?.[1] ?? '').trim());
  const link = head.match(HEAD_RE.link);
  const mid = r.id.startsWith('exmail:') ? r.id.slice(7) : r.id;
  return {
    id: r.id,
    mid,
    subject: (head.match(HEAD_RE.subject)?.[1] ?? r.title ?? '').trim(),
    email: f.email,
    name: f.name,
    to: (head.match(HEAD_RE.to)?.[1] ?? '').trim(),
    cc: (head.match(HEAD_RE.cc)?.[1] ?? '').trim(),
    ts: (head.match(HEAD_RE.time)?.[1] ?? '').trim() || `${r.date}T00:00:00.000Z`,
    date: r.date,
    mine: false,
    // ⚠️ 引用历史必须砍掉：不砍的话最后一封里**必然**带着前面所有的请求，
    //    于是**每一条线程都会看起来"还没结"** —— 而它还说得头头是道。
    fresh: stripQuoted(bodyRaw).trim(),
    root: link?.[1] ?? '',
    parent: link?.[2] ?? '',
    hasLink: !!link,
  };
}

/**
 * 哪一个地址是"我"。
 *
 * ⚠️ 设置里没填邮箱时**不能当成"没有一封是我发的"** —— 那会让每一条线程
 *    都变成"等你回"，而它看起来完全正常（真的有很多信在等你回）。
 *    ⇒ 退一步从数据里推：**收件箱里被寄得最多的那个地址就是我**。
 */
function inferSelf(msgs: ThreadMsg[]): string {
  const c = new Map<string, number>();
  for (const m of msgs) for (const a of emailsIn(m.to)) c.set(a, (c.get(a) ?? 0) + 1);
  let best = '', n = 0;
  for (const [a, k] of c) if (k > n) { best = a; n = k; }
  return n >= 2 ? best : '';
}

/**
 * 这一句是不是在要你做点什么。返回命中的信号（空数组 = 不是）。
 * ⚠️ 判断顺序：请求语气+动作词 → 问法 → **祈使句** → 问号。
 */
export function requestIn(sentence: string): string[] {
  const low = sentence.toLowerCase();
  const hits = ASK.filter((w) => low.includes(w.toLowerCase()));
  const acts = ACTIONS.filter((w) => low.includes(w.toLowerCase()));
  if (hits.length && acts.length) return [...hits.slice(0, 2), ...acts.slice(0, 2)];
  const q = INTERROGATIVE.find(([re]) => re.test(sentence));
  if (q) return [q[1]];

  // ⚠️⚠️ 中文派活**经常不写"请"**。实测真漏过一条：
  //    「跟进付款及留位，准备今年展会。」—— 老板发来的一句话，命中了动作词 `跟进`，
  //    可是一个请求语气词都没有，于是**整条漏掉**（而它正是"等你回"）。
  //    特征很明确：**句子以动作词开头** = 祈使句（中文祈使句没有形态变化，只能看语序）。
  // ⚠️ 两条护栏，缺一条就会开始乱报：
  //    ① 只认**两个汉字以上**的动作词 —— `发`/`填`/`做` 单字打头的句子
  //       大部分是"发现…/发送记录…"这种叙述，会让误报立刻多起来；
  //    ② 句子里有 `已/已经/完成/我/我们` 的一律不算 —— 那是**汇报**不是**派活**
  //       （"提交申请已于9月完成"就是这样被挡掉的）。
  const starter = ACTIONS.filter((w) => w.length >= 2).find((w) => low.startsWith(w.toLowerCase()));
  if (starter && !/已|已经|完成|我|我们|本人/.test(low)) return [`祈使句:${starter}`];

  if (/[?？]\s*$/.test(sentence.trim())) return ['问号'];
  return [];
}

/**
 * 邮件头里的线索链**到底全不全** —— 给界面用的体检数字。
 *
 * ⚠️ 为什么必须把这个数字报出来：这台邮箱 **53 封里 39 封没有 `In-Reply-To`**
 *    （腾讯企业邮箱的「已发送」副本不写它，原始头里就没有）。于是在用户眼里，
 *    同一条对话**看起来就是好几个短线程** —— 而这**不像故障**，像"本来就这么短"。
 *    ⇒ 不报出来的话，没人会知道那些线程是缝出来的。
 */
export function linkStats(db: Database, spaces: string[] = ['exmail', 'wecom']) {
  const ph = spaces.map(() => '?').join(',');
  const rows = db
    .query<{ text: string }, any[]>(`SELECT text FROM docs WHERE space IN (${ph})`)
    .all(...spaces);
  let noHeader = 0, noParent = 0;
  for (const r of rows) {
    const t = String(r.text ?? '');
    const cut = t.indexOf('\n\n');
    const head = cut >= 0 ? t.slice(0, cut) : t.slice(0, 1200);
    const m = head.match(/线索：root=(\S*)\s+parent=(\S*)/);
    if (!m) { noHeader += 1; continue; }
    if (!m[2]) noParent += 1;
  }
  return { docs: rows.length, noHeader, noParent, linked: rows.length - noHeader - noParent };
}

/** 挑一个能代表整条线程的标题：非系统通知的优先，然后挑最短的。 */
function pickSubject(g: ParsedMsg[]): string {
  const cands = g
    .map((m) => bareSubject(m.subject))
    .filter((s) => s.length >= 4)
    .map((s) => ({ s, sys: SYSTEM_SUBJECT.test(s) ? 1 : 0 }));
  if (!cands.length) return '';
  cands.sort((a, b) => a.sys - b.sys || a.s.length - b.s.length);
  return cands[0].s;
}

export interface ThreadOpts {
  spaces?: string[];
  /** 我的邮箱地址。⚠️ 空字符串 = 没配，会去数据里推 */
  self?: string;
  /** 至少几封才算"来回"（默认 2 —— 一封的那种是通知，不是线程） */
  minMsgs?: number;
  /** 我发出去之后隔几天没回音才提醒（默认 3） */
  staleDays?: number;
  /** 注入"现在"，让判据可复现（套件要用） */
  now?: Date;
}

export function threads(db: Database, opts: ThreadOpts = {}): Thread[] {
  const spaces = opts.spaces?.length ? opts.spaces : ['exmail'];
  const minMsgs = Math.max(2, opts.minMsgs ?? 2);
  const staleDays = Math.max(1, opts.staleDays ?? 3);
  const now = opts.now ?? new Date();
  const ph = spaces.map(() => '?').join(',');

  const rows = db
    .query<{ id: string; date: string; title: string; text: string }, any[]>(
      `SELECT id, date, title, text FROM docs WHERE space IN (${ph})`,
    )
    .all(...spaces);
  if (!rows.length) return [];

  const parsed = rows.map(parseDoc);
  const self = String(opts.self ?? '').trim().toLowerCase() || inferSelf(parsed);
  for (const p of parsed) p.mine = !!self && p.email === self;

  // ── 分组 ────────────────────────────────────────────────────────
  // ① 引用链（可靠）：每封回信都带着完整的祖先链，所以**所有信算出来的 root 是同一个**；
  //    而且**链首那封信自己也在库里**（它的 mid 就等于 root）⇒ 第一封会被自动并进来。
  const uf = unionFind();
  for (const p of parsed) {
    if (p.parent) uf.union(p.mid, p.parent);
    if (p.root && p.root !== p.mid) uf.union(p.mid, p.root);
  }

  // ② ⭐⭐ **缝合**（这一步是被真实数据逼出来的，不是设计出来的）
  //
  //    实测：这个邮箱里 **53 封有 39 封没有 In-Reply-To** ——
  //    腾讯企业邮箱的**已发送**副本根本不写 `In-Reply-To` / `References`
  //    （原始头里就是没有，不是我解析错了）。于是**他每回一封，链条就断一次**，
  //    同一条 Informa 付款对话被切成 **4 段**，而且每一段单看都很正常。
  //
  //    ⇒ 断了的地方只能靠标题缝，但**必须缝得紧**：
  //      · **一个是另一个的子串**，且短的那个 ≥ 10 个字符
  //        （"报价单"这种通用标题一律够不着门槛 ⇒ 宁可分成两条，也不并错）
  //      · **两个组件里得有共同的联系人**（不同客户的"Re: Invoice"标题一样但人不一样）
  const comps = new Map<string, ParsedMsg[]>();
  for (const p of parsed) {
    const key = uf.find(p.mid);
    const g = comps.get(key) ?? [];
    g.push(p);
    comps.set(key, g);
  }
  const info = [...comps.values()].map((g) => ({
    g,
    // ⚠️ **把我自己排除掉**再算共同联系人：每个组件里都有我（我参与过才在库里），
    //    算进去的话这个门槛恒真、等于没写 —— 而它恰恰是防"两个不同客户的
    //    `Re: Invoice` 被并成一条"的唯一那道闸。
    people: new Set(g.map((m) => m.email).filter((e) => e && e !== self)),
    cores: [...new Set(g.map((m) => coreSubject(m.subject)).filter((c) => c.length >= 10))],
  }));
  for (let i = 0; i < info.length; i += 1) {
    for (let j = i + 1; j < info.length; j += 1) {
      const A = info[i], B = info[j];
      if (uf.find(A.g[0].mid) === uf.find(B.g[0].mid)) continue;
      // 共同联系人：不同客户的 "Re: Invoice" 标题一样，但人不一样
      if (![...A.people].some((p) => B.people.has(p))) continue;
      // 一个是另一个的子串（短的那个 ≥10 字，见上面那条）
      if (!A.cores.find((a) => B.cores.some((b) => a.includes(b) || b.includes(a)))) continue;
      uf.union(A.g[0].mid, B.g[0].mid);
    }
  }

  const keep: ParsedMsg[][] = [];
  const merged = new Map<string, ParsedMsg[]>();
  for (const p of parsed) {
    const key = uf.find(p.mid);
    const g = merged.get(key) ?? [];
    g.push(p);
    merged.set(key, g);
  }
  for (const g of merged.values()) keep.push(g);

  // ── 逐条判定 ────────────────────────────────────────────────────
  const out: Thread[] = [];
  for (const g of keep) {
    if (g.length < minMsgs) continue;
    g.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : 1));
    const last = g[g.length - 1];
    const first = g[0];
    // ⚠️ 一条**完全接得上**的线程里，只有线程根那一封没有 parent。
    //    多于一封没有 ⇒ 中间断过（这台邮箱就断得到处都是，见上面②）。
    const viaRefs = g.filter((m) => !m.parent).length <= 1;
    const days = Math.max(0, Math.floor((now.getTime() - new Date(last.ts).getTime()) / 86400000));

    // 只看最后一封的**新内容**。⚠️ 免责声明必须先滤掉 ——
    // 每一封企业邮件都带 "please … notify the sender"，那是一句**请求**，
    // 留着的话**每一条线程都会判成"等你回"**（`mailtodo` 那边已经栽过一次）。
    const flat = last.fresh.replace(/\s+/g, ' ').trim();
    const sents = sentences(last.fresh).filter((s) => {
      const low = s.toLowerCase();
      // ⚠️ 保密页脚：每封企业邮件都有，而且**每一句都长得像请求** ⇒ 直接丢
      if (DISCLAIMER.some((w) => low.includes(w.toLowerCase()))) return false;
      // ⚠️ 制度条款也不是"要你做一件事"。实测被骗过一次：
      //    《公司车辆使用及专人管理通知》里那句「凡未提交加班申请…一律禁止使用公司车辆」
      //    命中了 请/申请/提交/需/上报，整条通知就被报成"等你回"。
      if (RULE_WORDS.some((w) => low.includes(w.toLowerCase()))) return false;
      return true;
    });
    // 自动回复 / 机器人回执 —— 长得像"我们会处理"，但**没有人在等你回话**
    const auto = AUTO_WORDS.filter((w) => new RegExp(w, 'i').test(flat));
    const sys = SYSTEM_SUBJECT.test(last.subject) ? last.subject.slice(0, 40) : '';
    const bcast = isBroadcast(last.to, last.cc);
    const hits = sents.map((s) => ({ s, sig: requestIn(s) }));
    const asks = hits.filter((h) => h.sig.length).map((h) => h.s.slice(0, 140));
    const sigs = [...new Set(hits.flatMap((h) => h.sig))];
    const request = asks.length > 0;
    // ⚠️ "收到/谢谢"这类判定用的是**扁平文本**，不是 `sentences()` ——
    //    sentences() 会把 6 个字以下的句子丢掉，而「收到」「谢谢」就那么长，
    //    用句子列表去找的话**永远找不到**（于是"已结"一条都判不出来）。
    const acks = ACK.filter((re) => re.test(flat));

    const why: string[] = [];
    let status: ThreadStatus;
    let heading: string;

    if (!self) {
      // 判不了就别装判得了 —— 不知道谁是我，"球在谁那边"整条逻辑都不成立
      status = 'quiet';
      heading = '判不了：没配邮箱地址，不知道哪几封是你发的';
      why.push('设置里没填邮箱地址，也没能从数据里推出来（收件人里没有重复出现的地址）');
    } else if (sys) {
      // ⚠️ 系统通知**不是信** —— 撤回回执 / 退信 / 自动回复。它照样有"请"有动词，
      //    但回它没有意义（撤回通知甚至没有内容可回）。
      status = 'quiet';
      heading = `系统通知：${sys}（不是要你回的信）`;
      why.push('标题就是系统通知（撤回 / 退信 / 自动回复），回它没有意义');
    } else if (auto.length && !last.mine) {
      status = 'quiet';
      heading = `自动回复：${last.name || last.email} 只是机器回执，还没有人真的看过`;
      why.push(`最后一封命中自动回复特征：${auto.join('、')}`);
    } else if (bcast && !last.mine) {
      // ⚠️ 群发通知也不能算"等你回"：发到 `全体组 <all@…>` 的时候，
      //    "球在你这边"这件事根本不成立 —— 是不是要你办得你自己看内容。
      status = 'quiet';
      heading = `群发通知：发给 ${last.to.slice(0, 30)}，不是单独找你要东西`;
      why.push('最后一封是群发（收件人里有全体组 / all@ 这类地址），不是你一个人的事');
    } else if (!request && acks.length) {
      status = 'closed';
      heading = `已结：最后一封是「${flat.slice(0, 22)}」这样的收尾`;
      why.push(`最后一封是 ${last.name || last.email}，命中收尾词，而且里面没有请求`);
    } else if (last.mine) {
      if (request) {
        status = 'waiting_them';
        heading = `等对方：你 ${days} 天前问出去的还没回`;
        why.push('最后一封是你发的，里面有要对方回答的事');
      } else {
        status = 'closed';
        heading = '已结：最后一封是你发出去的';
        why.push('最后一封是你发的，而且是陈述，不是提问');
      }
    } else if (request) {
      status = 'waiting_me';
      heading = `等你回：${last.name || last.email} ${days ? `${days} 天前` : '今天'}提了事，你还没回`;
      why.push(`最后一封是对方发的（${last.name || last.email}），而且里面有要你做的事`);
    } else {
      status = 'quiet';
      heading = '看不出要你做什么';
      why.push('最后一封是对方发的，但里面既没有请求、也没有问句');
    }
    if (asks.length) why.push(`最后一封里的原话：${asks[0]}`);
    if (sigs.length) why.push(`命中：${sigs.join('、')}`);
    why.unshift(`这条线程 ${g.length} 封，${first.date} → ${last.date}`);

    const remind = status === 'waiting_me' || (status === 'waiting_them' && days >= staleDays);

    const pmap = new Map<string, { name: string; email: string; n: number }>();
    for (const m of g) {
      const k = m.email || m.name;
      const e = pmap.get(k) ?? { name: m.name || m.email, email: m.email, n: 0 };
      e.n += 1;
      if (m.name && m.name !== e.email.split('@')[0]) e.name = m.name;
      pmap.set(k, e);
    }

    out.push({
      id: uf.find(last.mid),
      // 标题挑一个**有代表性的**：优先非系统通知的，再挑最短的。
      // ⚠️ 直接用 `first.subject` 会出事：实测那条「发件人已撤回邮件：2026年中秋节…」
      //    比被撤回的原通知**排得更早**，于是整条线程顶着"发件人已撤回邮件："当标题 ——
      //    而这是在拿**关于这封信的系统回执**当信本身的名字。
      subject: pickSubject(g) || '(无主题)',
      n: g.length,
      first: first.date,
      last: last.date,
      lastTs: last.ts,
      days,
      via: viaRefs ? 'refs' : 'subject',
      lastFrom: last.email,
      lastFromName: last.name,
      lastFromMe: last.mine,
      status,
      heading,
      why,
      remind,
      asks: asks.slice(0, 3),
      participants: [...pmap.values()].sort((a, b) => b.n - a.n),
      msgs: g.map((m) => ({ ...m, fresh: m.fresh.slice(0, 4000) })),
    });
  }

  return out.sort(
    (a, b) => Number(b.remind) - Number(a.remind) || b.n - a.n || (a.lastTs < b.lastTs ? 1 : -1),
  );
}
