/**
 * 线程未结提醒的**契约**（2026-10-10）。
 *
 * ⚠️ 和 `verify-mailtodo` 一样用**内存库**喂夹具，不碰真邮箱 —— 判据要的是
 *    「标题被改烂了还归不归得到一起 / 球在谁那边 / 收尾认不认得出」，
 *    这些三行夹具就能验死；依赖真实数据的话，换个邮箱就全红，
 *    而红的原因和代码对不对**没关系**。
 *
 * ⭐ 每一条都对应一个**真的会犯的错**，而且大多是**成对**的（正例 + 反例）：
 *    只验"该提醒的提醒了"，不验"不该提醒的没提醒"，那是在测运气。
 *    ⚠️ 定过五次的那条纪律：**负向对照只动被测的那一侧**，而且**要真的红得起来**。
 */
import { Database } from 'bun:sqlite';
import { threads } from '../src/threads.ts';
import { docFromParsed } from '../src/sources/exmail.ts';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

const SELF = 'changjw@pingfang.net';
const NOW = new Date('2026-10-10T04:00:00.000Z');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE docs (id TEXT PRIMARY KEY, space TEXT, date TEXT, title TEXT, text TEXT, url TEXT, hash TEXT, synced_at TEXT)`);
  /** 造一封邮件。`root`/`parent` 就是 `线索：` 那一行 —— 不传就自己当根。 */
  const put = ({ id, subject, from, to = SELF, cc = '', ts, body, root = '', parent = '' }) => {
    const head =
      `主题：${subject}\n发件人：${from}\n收件人：${to}` +
      (cc ? `\n抄送：${cc}` : '') +
      `\n时间：${ts}` +
      `\n线索：root=${root || id} parent=${parent}`;
    db.query('INSERT INTO docs VALUES (?,?,?,?,?,?,?,?)').run(
      'exmail:' + id, 'exmail', ts.slice(0, 10), subject, `${head}\n\n${body}`, null, 'h', 'x',
    );
  };
  return { db, put };
}

const run = (db, o = {}) => threads(db, { spaces: ['exmail'], self: SELF, now: NOW, ...o });
const at = (d) => `2026-10-${String(d).padStart(2, '0')}T02:00:00.000Z`;

console.log('\n── ① References 才是线程的依据（标题被改烂也要归到一起）──');
{
  const { db, put } = fixture();
  // ⚠️ 真实那条 Informa 线程的标题就是这样被各家客户端改得面目全非：
  //    「回复：」长在**句子中间**，按前缀剥根本剥不掉。
  const ROOT = 'root-informa@cc.informa.com';
  put({ id: 'i1', root: '', subject: 'Communication from Credit Control for Informa Markets Limited', from: 'Informa Credit Control <creditcontrol@cc.informa.com>', ts: at(1), body: 'Below is a list of open invoices. Please let us know by reply of any reason preventing payment.' });
  put({ id: 'i2', root: ROOT, parent: 'i1', subject: 'Re: 回复：Communication from Credit Control for Informa Markets Limited', from: 'Gemma Knight <gemma.knight@informa.com>', ts: at(3), body: 'Please confirm your intended payment date.' });
  put({ id: 'i3', root: ROOT, parent: 'i2', subject: 'Enquire Payment way 回复：回复：Re: 回复：Communication from Credit Control for Informa', from: SELF, ts: at(5), body: 'Our finance team is checking. Will revert.' });
  put({ id: 'i4', root: ROOT, parent: 'i3', subject: 'Re: Enquire Payment way 回复：回复：Re: 回复：Communication from Credit Control', from: 'Gemma Knight <gemma.knight@informa.com>', ts: at(9), body: 'Any update on the payment? We need this closed before month end.' });
  const t = run(db);
  ok(t.length === 1, `四封归成**一条**线程（实得 ${t.length} 条）—— ⚠️ 按标题分的话这里会变成三四堆`);
  const th = t[0];
  ok(th.via === 'refs', '记着"是靠 References 分的"（不是靠标题蒙的）');
  ok(th.n === 4, `封数对（${th?.n}）`);
  ok(th.subject === 'Communication from Credit Control for Informa Markets Limited',
     `标题剥干净了（实得「${th?.subject}」）`);
  ok(th.status === 'waiting_me' && th.remind === true,
     `判成「等你回」并该提醒（实得 ${th?.status} / remind=${th?.remind}）`);
  ok(th.why.some((w) => /any update/.test(w)), `说得出凭什么：${th.why.find((w) => /any update/.test(w)) ?? '（没有）'}`);
}

console.log('\n── ② 链首那封信自己也在库里 ⇒ 要自动并进来 ────');
{
  const { db, put } = fixture();
  // i1 没有线索（它是线程的开头），i2 指向它 —— 并查集能不能把 i1 也收进来？
  put({ id: 'j1', root: '', parent: '', subject: 'Train system reference list', from: 'Ilia <ilia@progress-epc.ru>', ts: at(1), body: 'Attached the reference list.' });
  put({ id: 'j2', root: 'j1', parent: 'j1', subject: 'RE: PFT-enquire with the timeline', from: SELF, ts: at(2), body: '收到，我看一下。' });
  const t = run(db);
  ok(t.length === 1 && t[0].n === 2, `**开了头的那封没有线索，也要被收进同一条**（实得 ${t.length} 条 / ${t[0]?.n} 封）`);
}

console.log('\n── ③ 球在谁那边：成对判据 ──────────────────────');
{
  const { db, put } = fixture();
  // (a) 最后一封是**对方**发的、里面有事要你做 ⇒ 等你回
  put({ id: 'a1', subject: '报价单查收', from: SELF, ts: at(1), body: '附件是报价单，请查收。' });
  put({ id: 'a2', root: 'a1', parent: 'a1', subject: 'Re: 报价单查收', from: '陈工 <chen@pingfang.net>', ts: at(3), body: '麻烦把埃及 7 台 RTG 的分项报价补充完整，本周五前给我。' });
  // (b) 最后一封是**我**发的、里面有要对方回答的事 ⇒ 等对方
  //     ⚠️ 时间要离 NOW（10-10）**近**才测得到"不该提醒"那一半；
  //        第一版这里写的 `at(1)`/`at(3)` 是 10-01/10-03，实际差 7 天，
  //        于是"3 天不到"这句注释是假的，断言红得莫名其妙。
  put({ id: 'b1', subject: 'PFT enquiry', from: 'Ilia <ilia@progress-epc.ru>', ts: '2026-10-08T02:00:00.000Z', body: 'Could you send the timeline?' });
  put({ id: 'b2', root: 'b1', parent: 'b1', subject: 'Re: PFT enquiry', from: SELF, ts: '2026-10-09T02:00:00.000Z', body: 'Please confirm the delivery date by Friday.' });
  const t = run(db);
  const a = t.find((x) => x.id === 'a1');
  const b = t.find((x) => x.id === 'b1');
  ok(a?.status === 'waiting_me' && a?.remind === true, `对方的请求 ⇒ 等你回 + 提醒（${a?.status}）`);
  ok(b?.status === 'waiting_them', `我的提问 ⇒ 等对方（${b?.status}）`);
  ok(b?.remind === false, `⚠️ 才 3 天不到的"等对方"**不该提醒**（remind=${b?.remind}）—— 不然催得太勤就成了骚扰`);
}

console.log('\n── ④ 等对方**隔久了**才提醒（同一个判据的另一半）─');
{
  const { db, put } = fixture();
  put({ id: 'c1', subject: '埃及 7 台 RTG 报价', from: 'Mostafa <mostafa@egypt.com>', ts: '2026-09-01T02:00:00.000Z', body: 'Could you send the quotation?' });
  // ⚠️ 最后一封必须**真的带着一个要对方回答的问题** —— 第一版写的是
  //    "I will send it next week."（一句陈述），那按规则本来就该判「已结」，
  //    断言却期待「等对方」。**夹具没验到它声称的东西**（这个坑记过五次了）。
  put({ id: 'c2', root: 'c1', parent: 'c1', subject: 'Re: 埃及 7 台 RTG 报价', from: SELF, ts: '2026-09-02T02:00:00.000Z', body: 'Please confirm the quotation at your earliest convenience.' });
  const t = run(db);
  const c = t.find((x) => x.id === 'c1');
  // ⚠️ 和③(b)是**同一条代码路径**、只换了时间 —— 两边的结果不一样才证明
  //    "隔久了才提醒"这条规则真的在起作用，而不是恒真/恒假。
  ok(c?.status === 'waiting_them' && c?.remind === true,
     `将近 40 天的"等对方"**该**提醒了（${c?.status} / remind=${c?.remind}）`);
}

console.log('\n── ⑤ 收尾：一句「收到 / 谢谢」就是结了 ─────────');
{
  const { db, put } = fixture();
  put({ id: 'd1', subject: '发票寄出', from: SELF, ts: at(1), body: '发票今天寄出，单号 SF123。' });
  put({ id: 'd2', root: 'd1', parent: 'd1', subject: 'Re: 发票寄出', from: '贺姗 <hes@pingfang.net>', ts: at(2), body: '收到，谢谢！' });
  const t = run(db);
  const d = t.find((x) => x.id === 'd1');
  ok(d?.status === 'closed' && d?.remind === false, `「收到，谢谢！」⇒ 已结、不打扰（${d?.status}）`);
  // ⚠️ 反例：同样是"谢谢"，但**后面还跟着一件事** ⇒ 不能算结
  const { db: db2, put: put2 } = fixture();
  put2({ id: 'e1', subject: '发票寄出', from: SELF, ts: at(1), body: '发票今天寄出。' });
  put2({ id: 'e2', root: 'e1', parent: 'e1', subject: 'Re: 发票寄出', from: '贺姗 <hes@pingfang.net>', ts: at(2), body: '收到，谢谢！另外麻烦把上月的对账单也发我一份。' });
  const e = run(db2).find((x) => x.id === 'e1');
  ok(e?.status === 'waiting_me', `⚠️ 反例：「收到谢谢」+ 一件事 ⇒ 仍然**等你回**（${e?.status}）—— 致谢词不能盖过真请求`);
}

console.log('\n── ⑥ 保密页脚长得像请求 ⇒ 必须滤掉 ───────────');
{
  const { db, put } = fixture();
  put({ id: 'f1', subject: 'Newsletter', from: SELF, ts: at(1), body: '这是本月的行业简报。' });
  put({ id: 'f2', root: 'f1', parent: 'f1', subject: 'Re: Newsletter', from: 'Transport Events <iela@transportevents.com>', ts: at(2), body: 'If you have received this electronic message in error, please destroy it immediately, and notify the sender by return e-mail.' });
  const f = run(db).find((x) => x.id === 'f1');
  ok(f?.status === 'quiet' && f?.remind === false,
     `页脚**没**被当成请求（${f?.status}）—— ⚠️ 每封企业邮件都有这句，滤不掉的话**条条都变"等你回"**`);
  // ⚠️ 负向对照：同一句话，**去掉免责字样**之后应该变成"等你回"。
  //    没有这一半，上面那条只能证明"它没提醒"，证明不了"是页脚那条规则在起作用"。
  const { db: db2, put: put2 } = fixture();
  put2({ id: 'g1', subject: 'Newsletter', from: SELF, ts: at(1), body: '这是本月的行业简报。' });
  put2({ id: 'g2', root: 'g1', parent: 'g1', subject: 'Re: Newsletter', from: 'Transport Events <iela@transportevents.com>', ts: at(2), body: 'Please destroy the attached data immediately and send us the confirmation.' });
  const g = run(db2).find((x) => x.id === 'g1');
  ok(g?.status === 'waiting_me', `⚠️ 对照：去掉免责字样之后**就**判成等你回（${g?.status}）—— 证明是页脚那条在起作用`);
}

console.log('\n── ⑦ 引用历史必须砍掉（否则条条都"没结"）────');
{
  const { db, put } = fixture();
  put({ id: 'h1', subject: '报价', from: '陈工 <chen@pingfang.net>', ts: at(1), body: 'Please send the quotation by Friday.' });
  put({ id: 'h2', root: 'h1', parent: 'h1', subject: 'Re: 报价', from: SELF, ts: at(2), body: '好的，下午发你。' });
  // ⚠️ 最后一封的**新内容**只有四个字，可它底下**原样引着**前面那句请求。
  //    不砍引用的话，这里必然判成"等你回" —— 而它明明已经结了。
  put({
    id: 'h3', root: 'h1', parent: 'h2', subject: 'Re: 报价', from: '陈工 <chen@pingfang.net>', ts: at(3),
    body: '收到，谢谢！\n\n------------------ 原始邮件 ------------------\n发件人：常经纬\n\nPlease send the quotation by Friday.',
  });
  const h = run(db).find((x) => x.id === 'h1');
  ok(h?.status === 'closed' && h?.remind === false,
     `引文里的旧请求**没**把它算成未结（${h?.status}）—— ⚠️ 这是最容易让整条规则失效的地方`);
}

console.log('\n── ⑧ 不知道"我"是谁 ⇒ 一条都不能瞎提醒 ────────');
{
  const { db, put } = fixture();
  put({ id: 'k1', subject: 'Quote', from: 'A <a@x.com>', to: 'someone@y.com', ts: at(1), body: 'Please send the quote.' });
  put({ id: 'k2', root: 'k1', parent: 'k1', subject: 'Re: Quote', from: 'B <b@z.com>', to: 'other@w.com', ts: at(2), body: 'Please confirm the price.' });
  const t = threads(db, { spaces: ['exmail'], self: '', now: NOW });
  ok(t.length === 1 && t[0].status === 'quiet' && t[0].remind === false,
     `推不出"我"是谁 ⇒ 判不了、**不提醒**（${t[0]?.status}）`);
  // ⚠️ 失败的样子是**全绿且看起来很有道理**：不知道谁是我 ⇒ 每封都是"别人发的"
  //    ⇒ 条条"等你回"、条条提醒。这里必须是什么都不说。
  ok(/没配邮箱地址/.test(t[0]?.heading ?? ''), '而且**说得出**为什么判不了（沉默的空没法诊断）');
}

console.log('\n── ⑨ 分组的边界：不能乱并 ────────────────────');
{
  const { db, put } = fixture();
  // (a) 一封不成线程（通知类）
  put({ id: 'm1', subject: '8月份工资条', from: 'HR <hr@pingfang.net>', ts: at(1), body: '附件是你的工资条。' });
  ok(run(db).length === 0, '单封的**不算**线程（那是通知，不是来回）');

  // (b) 标题一模一样，但**各自带着指向不同根的线索** ⇒ 不能并
  const { db: db2, put: put2 } = fixture();
  put2({ id: 'n1', root: 'n1', parent: '', subject: '报价单', from: 'A <a@x.com>', ts: at(1), body: '报价见附件。' });
  put2({ id: 'n2', root: 'n2', parent: '', subject: '报价单', from: 'B <b@z.com>', ts: at(2), body: '报价见附件。' });
  put2({ id: 'n3', root: 'n1', parent: 'n1', subject: 'Re: 报价单', from: SELF, ts: at(3), body: '收到。' });
  const t2 = run(db2);
  ok(t2.length === 1 && t2[0].n === 2,
     `有可靠线索的**绝不**被标题拖进别的组（实得 ${t2.length} 条 / ${t2[0]?.n} 封）`);

  // (c) 都没有线索、标题也短 ⇒ 宁可分成两条，不并错
  const { db: db3, put: put3 } = fixture();
  put3({ id: 'p1', root: 'p1', parent: '', subject: '报价', from: 'A <a@x.com>', ts: at(1), body: '见附件。' });
  put3({ id: 'p2', root: 'p2', parent: '', subject: '报价', from: 'B <b@z.com>', ts: at(3), body: '见附件。' });
  // ⚠️ 这两封**没有** `线索：`（老数据的样子）—— 把头部那行抹掉再测
  db3.query("UPDATE docs SET text = replace(text, '线索：root=p1 parent=', '') WHERE id = ?").run('exmail:p1');
  db3.query("UPDATE docs SET text = replace(text, '线索：root=p2 parent=', '') WHERE id = ?").run('exmail:p2');
  ok(run(db3).length === 0 || run(db3).every((x) => x.n === 1),
     '⚠️ 没有线索 + 标题只有两个字 ⇒ **不并**（宁可分成两条，也不把无关的信并成一条）');
}

console.log('\n── ⑩ 入库时真的要写下线索头 ──────────────────');
{
  // ⚠️ 这条护栏是防**静默退化**的：`docFromParsed` 不写 `线索：` 的话，
  //    上面所有判据都会退回"按标题分"，而套件里那些夹具是手写的、照样绿。
  const doc = docFromParsed({
    subject: 'Re: 付款', messageId: '<child@x.com>',
    inReplyTo: '<parent@y.com>',
    references: '<root@z.com> <parent@y.com>',
    from: { text: 'Gemma <g@informa.com>' }, to: [{ text: 'me <me@pingfang.net>' }],
    cc: [{ text: 'cc1 <c@informa.com>' }],
    date: new Date('2026-10-09T02:00:00.000Z'), text: 'hello',
  }, 'INBOX', 1);
  ok(/线索：root=root@z\.com parent=parent@y\.com/.test(doc.text),
     `写下了 root/parent（实得「${doc.text.match(/线索：[^\n]*/)?.[0]}」）`);
  ok(doc.text.match(/线索：root=(\S+)/)?.[1] === 'root@z.com',
     `References 的**第一条**就是根（实得「${doc.text.match(/线索：root=(\S+)/)?.[1]}」，不是最后那条 parent@y.com）`);
  ok(/抄送：cc1 <c@informa.com>/.test(doc.text), '抄送也存下来了（判断"是不是只是抄送你"要用）');
  // 没有 References 的信：自己当根，parent 空 —— 不能因此丢出线程
  const solo = docFromParsed({ subject: 'x', messageId: '<solo@x.com>', date: new Date('2026-10-09T02:00:00.000Z'), text: 'hi' }, 'INBOX', 2);
  ok(/线索：root=solo@x\.com parent=\s*\n/.test(solo.text),
     `没有 References 时自己当根、parent 留空（实得「${solo.text.match(/线索：[^\n]*/)?.[0]}」）`);
}

console.log('\n── ⑫ 引用链断在半路 ⇒ 靠标题缝（实测逼出来的）──');
{
  // ⚠️⚠️ 这一节是被**真数据**逼出来的：这个邮箱 53 封里 **39 封没有 In-Reply-To**
  //    （腾讯企业邮箱的「已发送」副本根本不写这个头，原始邮件头里就没有）。
  //    于是**他每回一封，链条就断一次**，同一条付款对话被切成 4 段。
  const { db, put } = fixture();
  const BASE = 'Communication from Credit Control for Informa Markets Limited, an Informa Business';
  put({ id: 's1', subject: BASE, from: 'Informa Credit Control <creditcontrol@cc.informa.com>', ts: at(1), body: 'Below is a list of open invoices.' });
  put({ id: 's2', root: 's1', parent: 's1', subject: 'Re: ' + BASE, from: 'Gemma Knight <gemma.knight@informa.com>', ts: at(2), body: 'Please confirm your intended payment date.' });
  // ⚠️ 他这封是**回复**，可它的头里一个 References 都没有 ⇒ 在库里是"新开的一个根"
  put({ id: 's3', root: '', parent: '', subject: '回复：' + BASE, from: SELF, ts: at(3), body: '我们的财务在核，回头答复你。' });
  put({ id: 's4', root: 's3', parent: 's3', subject: 'Enquire Payment way 回复：回复：Re: 回复：' + BASE, from: 'Gemma Knight <gemma.knight@informa.com>', ts: at(4), body: 'Any update on the payment? We need this closed before month end.' });
  const t = run(db);
  ok(t.length === 1, `断成两截的引用链**缝回成一条**（实得 ${t.length} 条 —— 不缝的话是 2 条）`);
  ok(t[0]?.n === 4, `封数对（${t[0]?.n}）`);
  ok(t[0]?.via === 'subject', '⚠️ 而且**如实标注**是"靠标题缝的"，不是假装引用链接全了');
  ok(t[0]?.status === 'waiting_me' && t[0]?.remind === true, `该提醒还是提醒（${t[0]?.status}）`);

  // ⚠️ 负向对照 A：标题够得着，但**没有一个共同的联系人** ⇒ 绝不能缝。
  //    （两个不同客户的 "Re: Invoice" 标题一模一样，并起来就是把机密串了门。）
  const { db: db2, put: put2 } = fixture();
  const inv = 'Invoice 2026-0001 for project alpha';
  put2({ id: 'v1', subject: inv, from: 'Alice <alice@aaa.com>', ts: at(1), body: '见附件。' });
  put2({ id: 'v2', root: 'v1', parent: 'v1', subject: 'Re: ' + inv, from: SELF, ts: at(2), body: '收到。' });
  put2({ id: 'v3', subject: inv + ' revised', from: 'Bob <bob@bbb.com>', ts: at(3), body: '见附件。' });
  put2({ id: 'v4', root: 'v3', parent: 'v3', subject: 'Re: ' + inv + ' revised', from: SELF, ts: at(4), body: '收到。' });
  ok(run(db2).length === 2,
     `⚠️ 对照：没有共同联系人 ⇒ **不缝**（实得 ${run(db2).length} 条）—— 不然两个客户的往来会被并成一条`);

  // ⚠️ 负向对照 B：有共同联系人，但标题**太短** ⇒ 也绝不能缝
  const { db: db3, put: put3 } = fixture();
  put3({ id: 'w1', subject: '报价', from: 'Alice <alice@aaa.com>', ts: at(1), body: '见附件。' });
  put3({ id: 'w2', root: 'w1', parent: 'w1', subject: 'Re: 报价', from: SELF, ts: at(2), body: '收到。' });
  put3({ id: 'w3', subject: '报价 第二版', from: 'Alice <alice@aaa.com>', ts: at(3), body: '见附件。' });
  put3({ id: 'w4', root: 'w3', parent: 'w3', subject: 'Re: 报价 第二版', from: SELF, ts: at(4), body: '收到。' });
  ok(run(db3).length === 2,
     `⚠️ 对照：标题只有两个字（通用词）⇒ **不缝**（实得 ${run(db3).length} 条）—— 门槛是 10 个字符`);
}

console.log('\n── ⑬ 制度条款 / 自动回复：别把它们当成"等你回" ──');
{
  // ⚠️ 两条都是**真数据上判错的**，不是想出来的。
  const { db, put } = fixture();
  put({ id: 'z1', subject: '会议纪要', from: SELF, ts: at(1), body: '纪要见附件。' });
  put({ id: 'z2', root: 'z1', parent: 'z1', subject: 'Re: 会议纪要', from: '贺姗 <hes@pingfang.net>', ts: at(2), body: '1、2026年9月23日至10月9日期间，凡未提交加班申请、无有效加班审批记录的员工，一律禁止使用公司车辆。' });
  const z = run(db).find((x) => x.id === 'z1');
  ok(z?.status !== 'waiting_me' && z?.remind === false,
     `⚠️ 制度条款**不**算"要你做的事"（${z?.status}）—— 实测这条通知被误报成"等你回"过`);
  // 对照：同一封里换成一句真的请求 ⇒ 必须变成"等你回"
  const { db: db2, put: put2 } = fixture();
  put2({ id: 'y1', subject: '会议纪要', from: SELF, ts: at(1), body: '纪要见附件。' });
  put2({ id: 'y2', root: 'y1', parent: 'y1', subject: 'Re: 会议纪要', from: '贺姗 <hes@pingfang.net>', ts: at(2), body: '麻烦你把这周的会议纪要补充完整再发我。' });
  ok(run(db2).find((x) => x.id === 'y1')?.status === 'waiting_me', '对照：换成真请求 ⇒ 仍然判"等你回"');

  const { db: db3, put: put3 } = fixture();
  put3({ id: 'x1', subject: 'Enquire Payment way', from: SELF, ts: at(1), body: '请查收。' });
  put3({ id: 'x2', root: 'x1', parent: 'x1', subject: 'Re: Enquire Payment way', from: 'Customer Service Team <cs@informa.com>', ts: at(2), body: 'Rest assured, one of our representatives will be in touch with you within the next two working days. Please do not reply to this message.' });
  const x = run(db3).find((t) => t.id === 'x1');
  ok(x?.status !== 'waiting_me' && x?.remind === false,
     `⚠️ 机器回执**不**算"有人在等你回话"（${x?.status}）—— 实测也误报过`);

  // ③ 群发通知：`公司车辆使用及专人管理通知` → `"全体组" <all@pingfang.net>`
  const { db: db4, put: put4 } = fixture();
  const NOTICE = '遇车辆故障、车身损坏、违章事故、违规使用等异常情况需第一时间上报行政管理部。';
  put4({ id: 'u1', subject: '车辆管理', from: SELF, ts: at(1), body: '见附件。' });
  put4({ id: 'u2', root: 'u1', parent: 'u1', subject: 'Re: 车辆管理', from: '贺姗 <hes@pingfang.net>', to: '"全体组" <all@pingfang.net>', ts: at(2), body: NOTICE });
  const u = run(db4).find((t) => t.id === 'u1');
  ok(u?.status !== 'waiting_me' && u?.remind === false,
     `⚠️ 群发给「全体组」的通知**不**算"等你回"（${u?.status}）—— 实测这条被误报过`);
  // 对照：**同一句话**，只发给个人 ⇒ 必须变成"等你回"
  //   （只动被测的那一侧：收件人。不动正文 —— 否则不知道是哪条规则在起作用）
  const { db: db5, put: put5 } = fixture();
  put5({ id: 'r1', subject: '车辆管理', from: SELF, ts: at(1), body: '见附件。' });
  put5({ id: 'r2', root: 'r1', parent: 'r1', subject: 'Re: 车辆管理', from: '贺姗 <hes@pingfang.net>', ts: at(2), body: NOTICE });
  ok(run(db5).find((t) => t.id === 'r1')?.status === 'waiting_me',
     '对照：同样是那句话，**只发给你一个人**就还是"等你回" —— 证明是"群发"这条在起作用');

  // ④ 系统通知：撤回回执
  const { db: db6, put: put6 } = fixture();
  put6({ id: 't1', subject: '2026年中秋节、国庆假放假通知', from: '贺姗 <hes@pingfang.net>', ts: at(1), body: '假期安排如下。' });
  put6({ id: 't2', root: 't1', parent: 't1', subject: '发件人已撤回邮件：2026年中秋节、国庆假放假通知', from: 'hes@pingfang.net', ts: at(2), body: '发件人已撤回该邮件。请勿回复此邮件。' });
  const tt = run(db6).find((t) => t.id === 't1');
  ok(tt?.status === 'quiet' && /系统通知/.test(tt?.heading ?? ''),
     `⚠️ 撤回回执**不**当成来信判（${tt?.status} / ${tt?.heading?.slice(0, 20)}）—— 实测被误判过`);
}

console.log('\n── ⑭ 中文派活不写"请" ⇒ 祈使句也算请求 ────────');
{
  // ⚠️ 真漏过一条：「跟进付款及留位，准备今年展会。」
  const { db, put } = fixture();
  put({ id: 'i1', subject: 'TOC 展会', from: SELF, ts: at(1), body: '见附件。' });
  put({ id: 'i2', root: 'i1', parent: 'i1', subject: 'Re: TOC 展会', from: '平方张向辉 <zhangxh@pingfang.net>', ts: at(2), body: '跟进付款及留位，准备今年展会。' });
  ok(run(db).find((t) => t.id === 'i1')?.status === 'waiting_me',
     '⚠️ 以动作词开头的祈使句算请求（一个"请"字都没有）—— 实测这条漏过');

  // ⚠️ 负向对照：以动作词开头、但其实是**汇报**（句子里有"已/完成"）⇒ 绝不能算请求。
  //    只动被测的那一侧：把"派活"改成"汇报"，其余一模一样。
  //    ⚠️ 第一版这里写的控制句是「提交**申请**已于9月完成」—— 它**没测到祈使句那条路**：
  //       「申请」这个词里就含一个「请」，于是它先被"请求语气 + 动作词"那条规则命中，
  //       祈使句的护栏跑都没跑到。**夹具没验到它声称的东西**（这个坑记过六次了）。
  const { db: db2, put: put2 } = fixture();
  put2({ id: 'j1', subject: 'TOC 展会', from: SELF, ts: at(1), body: '见附件。' });
  put2({ id: 'j2', root: 'j1', parent: 'j1', subject: 'Re: TOC 展会', from: '平方张向辉 <zhangxh@pingfang.net>', ts: at(2), body: '提交记录已经归档了。' });
  const j = run(db2).find((t) => t.id === 'j1');
  ok(j?.status !== 'waiting_me',
     `⚠️ 对照：「提交记录已经归档了」是**汇报**不是派活 ⇒ 不算（${j?.status}）`);

  // ⚠️ 负向对照二：单字动作词（"发现…"）不能算祈使句 —— 否则误报立刻多起来
  const { db: db3, put: put3 } = fixture();
  put3({ id: 'k1', subject: '系统', from: SELF, ts: at(1), body: '见附件。' });
  put3({ id: 'k2', root: 'k1', parent: 'k1', subject: 'Re: 系统', from: '平方张向辉 <zhangxh@pingfang.net>', ts: at(2), body: '发现报表里有个数字对不上，回头再说。' });
  const k = run(db3).find((t) => t.id === 'k1');
  ok(k?.status !== 'waiting_me', `⚠️ 对照：「发现…」不能算指令（${k?.status}）—— 单字动作词不算`);
}

console.log('\n── ⑮ 标题不能挑错（别拿系统回执当信名）────────');
{
  const { db, put } = fixture();
  put({ id: 'l1', subject: '2026年中秋节、国庆节放假通知', from: '贺姗 <hes@pingfang.net>', ts: at(2), body: '放假安排如下。' });
  put({ id: 'l2', root: 'l1', parent: 'l1', subject: '发件人已撤回邮件：2026年中秋节、国庆节放假通知', from: 'hes@pingfang.net', ts: at(6), body: '发件人已撤回该邮件。' });
  const l = run(db).find((t) => t.id === 'l1');
  ok(!/发件人已撤回/.test(l?.subject ?? 'x'),
     `标题挑的是**信本身**的名字，不是那句系统回执（实得「${l?.subject}」）`);
}

console.log('\n── ⑪ 同一份输入永远给同一份结论 ──────────────');
{
  const { db, put } = fixture();
  put({ id: 'q1', subject: '付款确定', from: SELF, ts: at(1), body: '我们已经安排了。' });
  put({ id: 'q2', root: 'q1', parent: 'q1', subject: 'Re: 付款确定', from: 'Gemma <g@informa.com>', ts: at(4), body: 'Please advise the payment date.' });
  const a = JSON.stringify(run(db));
  const b = JSON.stringify(run(db));
  ok(a === b, '⚠️ 跑两次**逐字节相同**（是规则，不是模型）');
  ok(run(db).length > 0 && run(db)[0].remind === true, '顺带：`please advise` 这种没有问号的催问也认得出');
}

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
