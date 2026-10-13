/**
 * 联系人 / 公司档案 —— 从**已经入库的邮件**里攒出来，不花一分钱 LLM。
 *
 * 这是「装进侧栏的第一个功能」，也是**自我改进那条闭环的第一个样板**：
 *   分析你的数据 → 提一个功能 → 你选中 → 装到侧栏 → 能用 → 能删。
 *   所以它刻意做得很小、很确定：**同一份输入永远给同一份输出**，没有模型参与。
 *
 * ⚠️ 两个决定，别改回去：
 *  ① **发件人和收件人都收**。只收发件人的话，"我发出去的那 18 封"里对应的人
 *     一个都不会出现 —— 而那些人恰恰是最重要的（客户、供应商、催款的）。
 *  ② **自己不出现在名单里**。判断"自己是谁"用设置里的邮箱地址，
 *     ⚠️ 别写死 —— 这个软件要给**任何人**用（读者原话：「不仅仅给我自己使用」）。
 */
import type { Database } from 'bun:sqlite';

export interface Contact {
  /** 显示名（没有名字就用邮箱前缀） */
  name: string;
  email: string;
  /** 从域名推出来的组织 —— 只是**推**出来的，界面上要标清楚 */
  org: string;
  n: number;
  first: string;
  last: string;
  /** 最近几封的主题，用来一眼想起"我们聊过什么" */
  subjects: string[];
  /** 邮件是收进来的还是发出去的 */
  got: number;
  sent: number;
}

/** 常见免费邮箱 —— 这些**不能**当公司名（`gmail.com` 不是一家公司）。 */
const FREEMAIL = new Set([
  'gmail.com', 'qq.com', '163.com', '126.com', 'outlook.com', 'hotmail.com',
  'foxmail.com', 'sina.com', 'sohu.com', 'aliyun.com', 'icloud.com', 'exmail.qq.com',
]);

/** `"名字" <a@b.c>` / `名字 <a@b.c>` / `a@b.c` 三种写法都要认。 */
function parseAddr(s: string): { name: string; email: string } | null {
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>\s]+@[^>\s]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  const m2 = s.match(/([^\s<>,;]+@[^\s<>,;.]+\.[^\s<>,;]+)/);
  if (m2) return { name: '', email: m2[1].trim().toLowerCase() };
  return null;
}

const orgOf = (email: string) => {
  const d = email.split('@')[1] ?? '';
  if (!d || FREEMAIL.has(d)) return '';
  // 去掉 www / mail 这种前缀，剩下的当组织名
  return d.replace(/^(www|mail|smtp|mx|ex)\d*\./i, '');
};

/**
 * ⚠️ 地址是从**已经拼好的正文头部**里读的（`发件人：…` / `收件人：…`），
 *    不是重新去连 IMAP —— 那样每看一次联系人都要重连一次邮箱，慢且没必要。
 *    （代价：这几个字段的格式变了这里就会读不到，所以下面**读不到要能看出来**：
 *     条数为 0 时返回空数组，界面自己会说"没有"，而不是编一个。）
 */
export function contacts(db: Database, opts: { spaces?: string[]; self?: string; limit?: number } = {}): Contact[] {
  const spaces = opts.spaces?.length ? opts.spaces : ['exmail'];
  const self = String(opts.self ?? '').trim().toLowerCase();
  const ph = spaces.map(() => '?').join(',');
  const rows = db
    .query<{ date: string; title: string; text: string; space: string }, any[]>(
      `SELECT date, title, text, space FROM docs WHERE space IN (${ph})`,
    )
    .all(...spaces);

  const acc = new Map<string, Contact>();
  const bump = (a: { name: string; email: string }, date: string, title: string, dir: 'got' | 'sent') => {
    if (self && a.email === self) return; // 自己不进名单
    let c = acc.get(a.email);
    if (!c) {
      c = { name: a.name || a.email.split('@')[0], email: a.email, org: orgOf(a.email), n: 0, first: date, last: date, subjects: [], got: 0, sent: 0 };
      acc.set(a.email, c);
    }
    // ⚠️ 名字后出现的覆盖前面的 —— "a@b.c"（没名字）先来、后来带名字的那封要能补上
    if (a.name && (!c.name || c.name === c.email.split('@')[0])) c.name = a.name;
    c.n += 1;
    c[dir] += 1;
    if (date < c.first) c.first = date;
    if (date > c.last) c.last = date;
    if (title && c.subjects.length < 4 && !c.subjects.includes(title)) c.subjects.push(title);
  };

  for (const r of rows) {
    const head = String(r.text).slice(0, 600);
    const fm = head.match(/发件人：([^\n]*)/);
    const tm = head.match(/收件人：([^\n]*)/);
    const from = fm ? parseAddr(fm[1]) : null;
    // 「我发出去的」= 发件人是我 ⇒ 这封里的收件人才是要记的人
    const mine = !!self && from?.email === self;
    if (mine) {
      for (const part of String(tm?.[1] ?? '').split(/[,，;；]/)) {
        const a = parseAddr(part);
        if (a) bump(a, r.date, r.title, 'sent');
      }
    } else if (from) {
      bump(from, r.date, r.title, 'got');
      // 收到的信里也把**其他**收件人算进来？—— 不算。
      // 群发的 `all@pingfang.net` 会把整公司的人塞满名单，那不是"我的联系人"。
    }
  }

  return [...acc.values()].sort((a, b) => b.n - a.n || (a.last < b.last ? 1 : -1)).slice(0, opts.limit ?? 300);
}
