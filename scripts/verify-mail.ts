/**
 * 企业邮箱（IMAP）两条腿：
 *   ① **离线**：一封真实形状的中文邮件（RFC2047 主题 + GBK 正文 + base64 + multipart）
 *      解析出来**不许乱码**、不许丢字段。中文乱码是这条路最容易坏的地方，而且它
 *      跟网络无关 —— 用夹具就能验掉，不用等真密码。
 *   ② **在线**：真的连一次 imap.exmail.qq.com，用**故意错的密码**，
 *      断言它落到「登录被拒」这个分类里（而不是"连不上"）。
 *      ⚠️ 这一步证明的是 TLS + LOGIN + **错误分类**三件事都通。
 *      它证明不了"用对密码就能读到信"—— 那个要等读者给真密码，别当成已经验过。
 */
import { simpleParser } from 'mailparser';

import { docFromParsed, exmail } from '../src/sources/exmail';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

// ═══════════ ① 离线：中文邮件解析 ═══════════
console.log('\n▸ ① 中文邮件解析（离线夹具）');

const GBK_BODY = '你好，附件是本周的报价单，请查收。\n另外周四下午三点开会。';
// GBK 字节（避免依赖 Node 的 gbk 编码器，用手写的）
const gbkBytes = new Uint8Array([
  0xc4, 0xe3, 0xba, 0xc3, 0xa3, 0xac, 0xb8, 0xbd, 0xbc, 0xfe, 0xca, 0xc7, 0xb1, 0xbe, 0xd6, 0xdc,
  0xb5, 0xc4, 0xb1, 0xa8, 0xbc, 0xdb, 0xb5, 0xa5, 0xa3, 0xac, 0xc7, 0xeb, 0xb2, 0xe9, 0xca, 0xd5,
]);
const b64 = Buffer.from(gbkBytes).toString('base64');

const raw = Buffer.from(
  [
    'From: =?utf-8?B?5byg5LiJ?= <zhangsan@pingfang.net>',
    'To: changjw@pingfang.net',
    // ⚠️ 这串 base64 是 `printf '关于报价单的会议安排' | iconv -f UTF-8 -t GBK | base64` 出来的。
    //    我第一版是**手写字节**的 —— 解出来是"锅于辫伺单的存发件"，
    //    看起来像"解析器坏了"，其实是**夹具坏了**。（差一点就去改产品代码。）
    'Subject: =?GBK?B?udjT2rGovNu1pbXEu+HS6bCyxcU=?=',
    'Date: Wed, 8 Oct 2026 09:12:00 +0800',
    'Message-ID: <test-abc-123@pingfang.net>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="BOUND1"',
    '',
    '--BOUND1',
    'Content-Type: text/plain; charset="GBK"',
    'Content-Transfer-Encoding: base64',
    '',
    b64,
    '--BOUND1',
    'Content-Type: text/html; charset="GBK"',
    'Content-Transfer-Encoding: base64',
    '',
    b64,
    '--BOUND1--',
    '',
  ].join('\r\n'),
);

const parsed = await simpleParser(raw);
const doc = docFromParsed(parsed, 'INBOX', 42);

console.log('    解析出的主题：' + JSON.stringify(doc.title));
console.log('    解析出的正文前 40 字：' + JSON.stringify(doc.text.slice(0, 40)));
ok(doc.title.includes('报价') , 'RFC2047 的 GBK 主题解出来了（不是 =?GBK?B?...?= 原样）');
ok(!/=\?/.test(doc.title), '主题里没有残留的编码标记');
ok(doc.title.length > 2 && !/[�]/.test(doc.title), '主题里没有替换字符（乱码的标志）');
ok(/你好/.test(doc.text) && /报价单/.test(doc.text), 'GBK 正文解出来了（没乱码）');
ok(!/�/.test(doc.text), '正文里没有替换字符');
ok(/zhangsan@pingfang\.net/.test(doc.text), '发件人进了正文的头部');
ok(doc.id === 'exmail:test-abc-123@pingfang.net', `用 Message-ID 当 id（实得 ${doc.id}）`);
ok(doc.space === 'exmail', '写进 exmail 这个 space（否则按来源搜不到）');
ok(doc.date === '2026-10-08', `日期取邮件自己的 Date（实得 ${doc.date}）`);

// multipart 优先 text/plain；只有 html 时要剥标签
const htmlOnly = await simpleParser(Buffer.from(
  ['Subject: hi', 'Content-Type: text/html; charset=utf-8', '', '<p>第一行</p><p>第二行</p>'].join('\r\n')));
const d2 = docFromParsed(htmlOnly, 'INBOX', 1);
ok(/第一行/.test(d2.text) && /第二行/.test(d2.text) && !/<p>/.test(d2.text), '只有 html 时会剥掉标签留下文字');

// ═══════════ ② 在线：IMAP 链路 + 错误分类 ═══════════
console.log('\n▸ ② 在线：真连一次 imap.exmail.qq.com（故意用错密码）');
ok(exmail.ready({}).ok === false, '没配时不放行（ready=false）');
ok(exmail.ready({ exmail: { email: 'a@b.c' } }).why.includes('客户端专用密码'), '缺哪一样就说哪一样');

// ⚠️ 走**连接器本身**，不走裸的 ImapFlow —— 要测的是"报错会不会被说清楚"，
//    而那件事发生在连接器里。裸客户端只会给一句 `Command failed`。
let live = 'skip';
try {
  await exmail.fetch({
    settings: { exmail: { email: 'changjw@pingfang.net', authCode: 'deliberately-wrong-' + String(Date.now()).slice(-6) } },
    log: () => {},
  });
  live = 'unexpected-ok';
} catch (e) {
  live = String((e as Error).message || e);
}
console.log('    服务器回的：' + live.slice(0, 110));
ok(live !== 'unexpected-ok', '错密码不会"连上"（不然认证根本没在起作用）');
// ⚠️ 这里不能只看 `e.message` —— ImapFlow 把服务器原话放在 `responseText` 里，
//    而 message 只有一句 `Command failed`。连接器原来就是这么写的 ⇒ 会把
//    「密码不对」报成「连不上服务器」，让人跑去查网络。
ok(/Login fail|AUTHENTICATIONFAILED|authentication/i.test(live),
  '错密码落到**登录被拒**这一类（TLS+LOGIN 都真发出去了，不是"连不上"）');
ok(/Login fail/i.test(live), '并且带回了**服务器的原话**（不能只剩一句 Command failed）');

// ═══════════ ③ 真凭据：用对的密码**真读到信** ═══════════
//
// ⚠️ 这一段是 2026-10-09 补的。在那之前，这个套件 15 条全绿，
//    却**一条都没证明"能读到信"** —— ② 那节用的是**故意写错的密码**。
//    「离线解析对」+「错密码会被拒」合起来，和「密码对了能读到信」是**两回事**，
//    中间那一步（真去读一批信、把中文解出来）一直是空的。
//
// ⚠️ 凭据从 `~/.c4emem/settings.json` 读（界面里填的那份）。
//    **没配就报 SKIP，不算通过也不该算失败** —— 但必须**在汇总行里计数**，
//    否则「N/N 通过」读起来像"全都验过了"。
console.log('\n▸ ③ 真凭据：从 ~/.c4emem/settings.json 读 exmail，真取一批信');
const { readFileSync, existsSync } = await import('node:fs');
const { homedir } = await import('node:os');
const { join } = await import('node:path');
let skipped = 0;
let cred: any = null;
try {
  const f = join(homedir(), '.c4emem', 'settings.json');
  if (existsSync(f)) cred = JSON.parse(readFileSync(f, 'utf8'))?.exmail ?? null;
} catch { cred = null; }

if (!cred?.email || !cred?.authCode) {
  skipped += 1;
  console.log('  ⏭ SKIP —— 还没配 exmail（邮箱地址 / 客户端专用密码）。这一格**没验过**，不是通过。');
} else {
  const logs: string[] = [];
  const docs = await exmail.fetch({
    // ⚠️ 只取一小批：这是**验证**，不是同步 —— 别拿真邮箱当压力测试，
    //    也别把几百封的解析时间算进这个套件。
    // ⚠️ 但 `folders` 要留默认（`*` = 所有文件夹）—— 那正是要验的东西。
    settings: { exmail: { ...cred, sinceDays: 30, max: 5 } },
    log: (m) => { logs.push(m); console.log('    ' + m); },
  });
  ok(docs.length > 0, `真的取到了信（${docs.length} 封）`);
  ok(docs.every((d) => d.space === 'exmail'), '都写进 exmail 这个 space');
  ok(docs.every((d) => d.id.startsWith('exmail:')), 'id 都带 exmail: 前缀');

  // ⚠️ 空标题是最容易悄悄溜过去的：正文照样有，只是列表里没名字
  ok(docs.every((d) => d.title.trim().length > 0), '每一封都有标题（没有空标题）');
  ok(docs.every((d) => !/=\?/.test(d.title)), '标题里没有残留的 =?GBK?B?...?= 编码标记');
  ok(docs.every((d) => !/�/.test(d.title + d.text)), '标题和正文里都没有替换字符（乱码的标志）');
  ok(docs.every((d) => d.date !== '0000-00-00'), '日期都解出来了（不是 0000-00-00）');
  ok(docs.every((d) => d.text.includes('主题：')), '正文里拼上了「主题：」那一段头部');
  ok(docs.some((d) => /[一-鿿]/.test(d.title + d.text)), '至少一封里有中文（真解出来了，不是空壳）');
  console.log('    抽一封看看：' + docs[0].title.slice(0, 40));

  // ⭐ 「能读多少就读多少」（读者 2026-10-09）：默认要读**所有**可选文件夹，
  //   而不是原来那一个 INBOX。实测那台邮箱 INBOX 36 封，而 Sent 里还有 18 封
  //   一封都没进来过 —— 这条断言就是钉住那件事。
  const all = logs.join('\n');
  const mFolders = all.match(/要读 (\d+) 个文件夹/);
  ok(!!mFolders && Number(mFolders[1]) >= 2,
     `读的是**多个**文件夹，不是只读 INBOX（实得「${mFolders ? mFolders[1] + ' 个' : '没这行日志'}」）`);
  const counted = logs.filter((l) => /：\d{4}-\d{2}-\d{2} 之后 \d+ 封/.test(l));
  ok(counted.length >= 2, `至少两个文件夹真的报了信数（实得 ${counted.length} 个）`);
  // ⚠️ 跳过的文件夹必须**说出来** —— 静默跳过读起来就像"本来就没有那些信"
  ok(/跳过「[^」]+」/.test(all), '跳过了哪些文件夹是**说出来的**（垃圾箱/已删除）');
}

console.log(`\n${pass}/${pass + fail} 通过${skipped ? `，${skipped} 项跳过` : ''}`);
if (skipped) console.log('⚠️ 有跳过的项 —— 那不是"通过"，是"没验"。');
process.exit(fail ? 1 : 0);
