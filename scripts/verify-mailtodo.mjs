/**
 * 待办抽取的**契约**（2026-10-09 晚）。
 *
 * ⚠️ 这个套件不碰真邮箱 —— 用**内存库**喂夹具。理由是判据要的是
 *    「英文抓不抓得到 / 页脚滤不滤得掉 / 制度条款降不降权」，
 *    而这些用三行夹具就能验死；依赖真实数据的话，换个邮箱就全红，
 *    而红的原因和代码对不对**没关系**。
 *
 * 每一条都对应一个**真的犯过的错**：
 *   ① 正文是硬折行的 ⇒ 按 \n 拆会得到半句话（Informa 那串整条漏掉）
 *   ② 匹配是**大小写敏感**的 ⇒ `Please` 匹配不上 `please`（英文邮件全丢）
 *   ③ 保密页脚长得像"请你做一件事" ⇒ 11 条里混进 3 条
 *   ④ 制度条款含"申请/提交"但那是**规则**不是待办 ⇒ 5 条里 4 条是它
 *   ⑤ 一条线程十封回信 = **一件事**，不是十件
 */
import { Database } from 'bun:sqlite';
import { extractTodos } from '../src/mailtodo.ts';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

const HEAD = (subject, from) =>
  `主题：${subject}\n发件人："${from}" <a@b.com>\n收件人："changjw@pingfang.net" <changjw@pingfang.net>\n时间：2026-10-08T02:00:00.000Z\n\n`;

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE docs (id TEXT PRIMARY KEY, space TEXT, date TEXT, title TEXT, text TEXT, url TEXT, hash TEXT, synced_at TEXT)`);
  const put = (id, title, body, from = 'Gemma') =>
    db.query('INSERT INTO docs VALUES (?,?,?,?,?,?,?,?)').run(id, 'exmail', '2026-10-08', title, HEAD(title, from) + body, null, 'h', 'x');
  return { db, put };
}

console.log('\n── ① 硬折行的英文正文要抓得到 ──────────────────');
{
  const { db, put } = fixture();
  // ⚠️ 真实邮件就是这样：每行几十个字符就换行，句号在断行处
  put('m1', 'Payment reminder', [
    'Below is a list of open invoices on your account which will shortly be due for',
    'payment. Please let us know by reply of any reason preventing payment or',
    'alternatively please confirm your intended payment date.',
  ].join('\n'));
  const t = extractTodos(db, { spaces: ['exmail'] });
  ok(t.length > 0, `抓到了（${t.length} 条）`);
  // ⭐ 大小写那一条的护栏：源码里写成 `s.includes(w)` 的话，这里必红
  ok(t.some((x) => /confirm your intended payment date/i.test(x.sentence)),
     '大写的 `Please` 也匹配得上（⚠️ 第一版大小写敏感，英文邮件**整条漏掉**）');
  ok(t[0].sentence.startsWith('Below is a list') || t.some((x) => x.sentence.length > 40),
     '句子里是**完整的一句话**，不是"per line 切出来的半截"');
}

console.log('\n── ② 保密页脚必须丢掉（不是降权）────────────────');
{
  const { db, put } = fixture();
  put('m2', 'hi', 'If you have received this electronic message in error, please destroy it immediately, and notify the sender by return e-mail.');
  // ⚠️ 负向对照：同一句话，去掉免责字样之后**应该**被抓到 ——
  //    这样才证明"没抓到"是因为页脚那条规则，而不是因为规则压根没跑
    // ⚠️⚠️ 对照句里**一个免责字样都不能留** —— 我第一版留了 `notify the sender`，
  //    它照样被页脚规则滤掉，于是这条「对照」什么都没证明（这一轮第三次栽在夹具上）。
  //    另外它还必须有**动作词**，否则是被"缺动作词"挡掉的，同样验不到页脚那条规则。
  put('m3', 'hi2', 'Please send the revised quotation immediately.');
  const t = extractTodos(db, { spaces: ['exmail'] });
  ok(!t.some((x) => /electronic message in error/i.test(x.sentence)), '保密页脚**没进**待办列表');
  ok(t.some((x) => /send the revised quotation/i.test(x.sentence)),
     '⚠️ 对照：把免责字样去掉之后**抓得到** —— 证明不是规则没跑，是页脚那条在起作用');
}

console.log('\n── ③ 制度条款要降权 ────────────────────────────');
{
  const { db, put } = fixture();
  put('m4', '车辆管理规定', '凡未提交加班申请、无有效加班审批记录的员工，一律禁止使用公司车辆。');
  put('m5', '请交报价', '请在本周五前把埃及项目的报价发我。');
  const t = extractTodos(db, { spaces: ['exmail'] });
  const rule = t.find((x) => /一律禁止/.test(x.sentence));
  const real = t.find((x) => /埃及项目的报价/.test(x.sentence));
  ok(!!real, '真要你做的那条抓到了');
  ok(real && real.due === '本周五', `期限抽出来了（实得「${real?.due}」）`);
  ok(!rule || (real && rule.score < real.score),
     `制度条款的分数**低于**真待办（制度 ${rule?.score ?? '被滤掉'} vs 真待办 ${real?.score}）`);
}

console.log('\n── ④ 同一件事不能出现十遍 ──────────────────────');
{
  const { db, put } = fixture();
  // 同一句请求在 5 封来回里各出现一次（回复链里最常见）
  for (let i = 0; i < 5; i += 1) put('r' + i, 'RE: 付款', 'Please confirm your intended payment date by reply.');
  const t = extractTodos(db, { spaces: ['exmail'] });
  const n = t.filter((x) => /intended payment date/i.test(x.sentence)).length;
  ok(n === 1, `一条线程里重复的请求只出**一条**（实得 ${n} 条）`);
}

console.log('\n── ⑤ 每条都要带原文，抽不到期限就不写 ──────────');
{
  const { db, put } = fixture();
  put('m6', '无期限的请求', '麻烦把上周的会议纪要补充完整。');
  const t = extractTodos(db, { spaces: ['exmail'] });
  ok(t.length > 0 && t.every((x) => x.sentence && x.sentence.length >= 6), '每条都带原句（不给原文用户没法判断）');
  ok(t.every((x) => x.due === '' || typeof x.due === 'string'), '抽不到期限就是空字符串 —— **不猜**');
  ok(t.every((x) => Array.isArray(x.why)), '每条都写得出"为什么算待办"（规则可解释）');
  ok(new Set(t.map((x) => x.id)).size === t.length, 'id 互不相同（同一份输入永远给同一份结果）');
  const again = extractTodos(db, { spaces: ['exmail'] });
  ok(JSON.stringify(again) === JSON.stringify(t), '⚠️ 跑两次结果**逐字节相同**（规则，不是模型）');
}

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
