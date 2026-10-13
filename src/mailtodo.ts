/**
 * 待办抽取 —— 从邮件正文里找「谁要我做什么、什么时候要」。
 *
 * ⚠️⚠️ 这一版是**规则**做的，不是模型。原因不是省事：
 *   ① 规则**可解释**：每条待办旁边能写出"我为什么觉得这是待办"（命中了哪个词）。
 *      模型给不出一致的理由，而用户要判断的就是"它说得对不对"。
 *   ② 规则**可验证**：同一份邮件永远给同一份结果，套件才写得出来。
 *   ③ 它跑得动：不用 API key，不花钱，装完就能用。
 *   ⚠️ 但它**一定会漏、也一定会错**。所以界面上必须写明这一点，
 *      并且**每条都把原文那一句带出来**让用户自己看 ——
 *      只给一句"你要回复 Gemma"而不给原文，用户没法判断，只能信或不信。
 *
 * ⭐ 「邮件优先用 API 模型」是读者定的方向：下一步是拿这里抽出的**候选**
 *    交给模型再筛一遍（候选很少，比把每封邮件都送进去便宜得多）。
 *    现在这一版先把候选抽准，别急着上模型。
 *
 * ⭐⭐ 下面几个词表 / 函数是 **export 出去的**，`src/threads.ts`（线程未结）在用同一份。
 *    「这封在不在要我做点什么」两边问的是同一个问题 ⇒ **必须同源**，
 *    各抄一份的结果是同一封邮件在「待办」里算请求、在「线程」里不算，
 *    而两个页面各自看起来都正常。
 */
import type { Database } from 'bun:sqlite';

export interface Todo {
  id: string;
  subject: string;
  from: string;
  date: string;
  /** 抽出来的**原句**（去掉了引用的历史消息） */
  sentence: string;
  /** 什么时候要 —— 抽得到才填，抽不到就是空（**不猜**） */
  due: string;
  /** 为什么判成待办：命中了哪些词 */
  why: string[];
  score: number;
}

/** 要你动手的动词。⚠️ 这些都是**别人对你**的请求，不是"我们做了什么"。 */
export const ACTIONS = [
  '申请', '提交', '回复', '确认', '支付', '付款', '安排', '整改', '跟进', '提供',
  '补充', '联系', '登记', '上报', '填写', '签字', '处理', '完成', '反馈', '参加',
  '报名', '核对', '回复邮件', '答复', '寄', '发回', '更新', 'check', 'confirm',
  // ⚠️ 实测漏掉的：中文里"把 X 发我 / 给我 / 回我"是最常见的派活方式，
  //    而上面那串全是书面动词，一个都命中不了 ⇒ 真话被门槛挡在外面。
  '发我', '给我', '回我', '发过来', '传我', '发一份', '填', '做', '发',
  'provide', 'send', 'reply', 'submit', 'review',
];

/** 请求语气 —— 没有它，光有动词多半只是叙述（"我们已提交了报价"）。 */
export const ASK = ['请', '务必', '需要', '需', '麻烦', '记得', '不要忘记', '别忘', '要求', '烦请', '希望', 'please', 'kindly', 'need'];

/** 已经做完的口气 —— 命中要**降分**，不是丢掉（"已完成的请忽略"这种也常见）。 */
export const DONE = ['已完成', '已提交', '已处理', '已确认', '已经处理', '不需', '无需', '不用', '忽略'];

/**
 * 保密/环保页脚 —— **直接丢掉，不是降分**。
 *
 * ⚠️ 实测：11 条里 3 条是这种（"If you have received this electronic message in error,
 *    please destroy it immediately, and notify the sender"）。它们**每一封**企业邮件里都有，
 *    而且全都长得像"请你做一件事"（有 please、有动词）。放进待办列表里，
 *    真正的那几条就被淹没了。
 */
export const DISCLAIMER = [
  'confidential', 'privileged', 'in error', 'destroy it', 'notify the sender', 'unsubscribe',
  'intended recipient', 'viruses', 'think before you print', 'do not print',
  '此邮件', '本邮件', '邮件及附件', '仅供', '保密', '请勿转发', '请勿打印', '病毒',
];

/**
 * 面向**集体**的制度条款用词 —— 这些句子里也有"申请/提交/需"，但那是**规则**，
 * 不是"要你做一件事"。实测：`凡未提交加班申请…一律禁止使用公司车辆` 会被当成待办。
 * ⚠️ 导出给 `threads.ts` 共用（那边同样会被它骗到）。
 */
export const RULE_WORDS = ['凡', '所有员工', '各部门', '一律', '全体员工', '下属各', '制度', '规定', '本办法', '管理办法'];

/** 自动回复 / 机器人回执 —— 它长得像"我们会处理"，但**不是**有人在等你回话。 */
export const AUTO_WORDS = [
  '自动回复', '自动回复邮件', '此邮件为系统', '系统自动发送', '请勿回复此邮件', '不要回复此邮件',
  '已收到您的邮件', '您的邮件已收到', '我们会尽快', '会有专人与您联系', '工作时间为',
  'auto[- ]?reply', 'automatically generated', 'do not reply', 'no-?reply', 'out of office',
  'rest assured', 'will be in touch', 'ticket (number|id)', 'this is an automated',
];

/** 明确的截止表达。⚠️ 只认**写得出来的**；"尽快""有空"这种不算 —— 那是猜。 */
const DUE_PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/, (m) => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`],
  [/(\d{1,2})\s*月\s*(\d{1,2})\s*日/, (m) => `${m[1]}月${m[2]}日`],
  [/(\d{1,2})\s*月\s*(\d{1,2})\s*号/, (m) => `${m[1]}月${m[2]}号`],
  [/本周([一二三四五六日天])/, (m) => `本周${m[1]}`],
  [/下周([一二三四五六日天])/, (m) => `下周${m[1]}`],
  [/(\d{1,2})\s*点\s*前/, (m) => `${m[1]}点前`],
  [/(\d{1,2})\s*月\s*底/, (m) => `${m[1]}月底`],
];

/**
 * 拆句。
 *
 * ⚠️⚠️ 邮件正文是**硬折行**的（每行几十个字符就换行），所以**不能按 `\n` 拆** ——
 *    那样切出来的是 "Please let us know by reply of any reason preventing payment or"
 *    这种半句话，读不成句子，而且句子级的规则全都对不上。
 *    实测：Informa 那串英文催款信就是这么**整条漏掉**的。
 *    ⇒ 先把**空行**当分段，段内把换行**折成空格**，再按句末标点拆。
 */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const block of String(text).split(/\n\s*\n+/)) {
    const flat = block.replace(/\s*\n\s*/g, ' ').trim();
    if (!flat) continue;
    // 句末标点切分（英文的 `.` 只在后面跟空格/结尾时才算句末，免得切碎邮箱和缩写）
    for (const raw of flat.split(/(?<=[。！？!?；;])\s*|\.(?=\s|$)\s*/)) {
      const s = raw.trim();
      if (s.length >= 6 && s.length <= 260) out.push(s);
      // 太长的（英文一段话常见）按逗号再切一刀 —— 但不能切出太短的碎片
      else if (s.length > 260) for (const q of s.split(/[,，]\s*/)) if (q.trim().length >= 6) out.push(q.trim().slice(0, 260));
    }
  }
  return out;
}

/**
 * 砍掉引用的历史消息。
 *
 * ⚠️ 不砍的话，一条 10 封来回的线程里，**同一个请求会被抽 10 遍** ——
 *    而且每遍都记在不同日期下，看起来像十件待办。
 *    实测那串 Informa 的付款线程就是这样，一抽一大片。
 */
export function stripQuoted(text: string): string {
  let t = String(text);
  const cutMarkers = [
    /^\s*-{2,}\s*原始邮件\s*-{2,}/m,
    /^\s*在\s*\d{4}.*写道[:：]/m,
    /^\s*From:\s/m,
    /^\s*发件人[:：]\s/m,
    /^\s*_{10,}\s*$/m,
    /^\s*>{1,}/m,
  ];
  for (const re of cutMarkers) {
    const m = t.match(re);
    if (m && typeof m.index === 'number' && m.index > 0) t = t.slice(0, m.index);
  }
  return t;
}

/**
 * 稳定的 id。⚠️ 不能用 `Date.now()` 或者数组下标 —— 每次跑出来不一样，
 * "这条我看过了"就记不住，前端也没法拿它当 key。
 */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function extractTodos(db: Database, opts: { spaces?: string[]; limit?: number } = {}): Todo[] {
  const spaces = opts.spaces?.length ? opts.spaces : ['exmail'];
  const ph = spaces.map(() => '?').join(',');
  const rows = db
    .query<{ id: string; date: string; title: string; text: string }, any[]>(
      `SELECT id, date, title, text FROM docs WHERE space IN (${ph})`,
    )
    .all(...spaces);

  const out: Todo[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    const from = (r.text.match(/发件人：([^\n]*)/)?.[1] ?? '').trim().replace(/^"|"$/g, '');
    const body = stripQuoted(String(r.text).replace(/^[\s\S]*?\n\n/, '')); // 去掉我们自己拼的头部
    for (const s of sentences(body)) {
      // ⚠️ **必须大小写不敏感** —— 第一版这里是 `s.includes(w)`，
      //    于是 `Please …` 匹配不上小写的 `please`，英文邮件**整条漏掉**。
      //    而英文邮件恰恰是最该抓的那批（客户、供应商、催款）。
      const low = s.toLowerCase();
      const has = (w: string) => low.includes(w.toLowerCase());
      if (DISCLAIMER.some(has)) continue; // 页脚，直接丢
      const hits = ASK.filter(has);
      const acts = ACTIONS.filter(has);
      if (!hits.length || !acts.length) continue;

      let due = '';
      for (const [re, fmt] of DUE_PATTERNS) {
        const m = s.match(re);
        if (m) { due = fmt(m); break; }
      }

      // ⚠️ 去重键用**句子本身**，不用邮件 id：同一句话在十封回信里出现十次，
      //    那是**一件事**，不是十件。
      const compact = s.replace(/\s+/g, '');
      if (seen.has(compact)) continue;
      seen.add(compact);

      const done = DONE.filter(has);
      // ⚠️ 制度条款扣分 —— 实测第一版抽出来 5 条里 4 条是这种：
      //    「凡未提交加班申请…一律禁止使用公司车辆」「请假规则：按照考勤管理制度要求申请」。
      //    它们**含有"申请/提交"**，但那是**规则**，不是"要你做一件事"。
      //    特征很一致：面向集体的词（凡/所有员工/各部门/一律）+ 制度词（制度/规定/本办法）。
      const rule = RULE_WORDS.filter(has);
      // 指向"你"的加分 —— 这才是要你做
      const mine = ['你', '您', '贵司', 'your', 'you ', 'please may i', 'let us know'].filter(has);
      // 分数：有截止日期最值钱；其次命中几个请求词；做完的/制度条款扣分
      let score = 0;
      score += due ? 4 : 0;
      // ⚠️ 请求语气 + 动作词**各占 1.5**，不是各占 1。
      //    原来各占 1 ⇒「麻烦把上周的会议纪要补充完整」（没写期限）算出来是 2，
      //    被门槛 3 挡掉 —— **没有 deadline 的待办也是待办**，而现实里大多数正是这种。
      score += Math.min(hits.length, 2) * 1.5;
      score += Math.min(acts.length, 2) * 1.5;
      score += Math.min(mine.length, 2);
      score -= done.length * 3;
      score -= rule.length * 3;
      if (score < 3) continue; // 门槛 —— 宁可漏，不要一屏噪声

      out.push({
        id: `todo:${hash(compact)}`, subject: r.title, from, date: r.date,
        sentence: s.slice(0, 160), due, why: [...hits.slice(0, 2), ...acts.slice(0, 2)], score,
      });
    }
  }

  return out.sort((a, b) => b.score - a.score || (a.date < b.date ? 1 : -1)).slice(0, opts.limit ?? 60);
}
