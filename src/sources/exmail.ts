/**
 * 企业邮箱（IMAP）—— **成员自己就能开的那条路**。
 *
 * 为什么不做「企业微信邮件 API」而做这个（2026-10-09 查清）：
 *   · API 那条路要 **corpId + 邮件应用 Secret**，而 Secret **只有管理员**能在管理后台拿到。
 *     读者不是「深圳市平方科技」的管理员 ⇒ 那条路对他**根本关着**，不是没配好。
 *   · 而腾讯企业邮箱（企业微信里那个「邮件」就是它）**每个成员自己**就能开 IMAP：
 *     登录邮箱网页版 → 设置 → 客户端设置 → 开启 IMAP/SMTP → 生成**客户端专用密码**。
 *     不需要管理员，不需要后台。
 *   ⇒ 所以走 IMAP：用自己的邮箱地址 + 那串专用密码，读的就是**自己收件箱**。
 *
 * ⚠️ 只有一种情况这条路也会被挡住：**管理员在后台把整个企业的 IMAP 关了**。
 *    那种情况下本人也开不了 —— 只能找管理员开，或者让他给你 Secret。
 *    报错要能分辨这两种（见 fetch 里对 `AUTHENTICATIONFAILED` 的处理）。
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { mkDoc, day, type Connector, type Doc } from './types';

/** 没装 html 解析器 —— 邮件里的 html 版只是兜底，粗剥一下就够检索用了。 */
function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 把一封解析好的邮件变成一条可索引的文档。
 *
 * ⚠️ 抽成**导出的纯函数**是为了能测：中文邮件最容易坏的地方就是这里
 *    （RFC2047 主题、GBK 正文、base64、multipart），而它跟网络无关 ——
 *    用一份夹具就能把"会不会乱码"验掉，不用等真密码。
 */
/** `References` 在 mailparser 里可能是数组，也可能是空格分隔的一串 —— 两种都认。 */
function refList(v: any): string[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[\s,]+/);
  return arr.map((x) => String(x).replace(/[<>]/g, '').trim()).filter(Boolean);
}

/** 收件人/抄送可能是数组也可能是单个对象 —— 统一成一行显示文本。 */
function addrList(v: any): string {
  if (!v) return '';
  return (Array.isArray(v) ? v : [v]).map((t: any) => t?.text ?? String(t)).filter(Boolean).join(', ');
}

export function docFromParsed(p: any, folder: string, uid: number) {
  const subject = String(p.subject || '(无主题)').slice(0, 300);
  const from = p.from?.text || '';
  const to = addrList(p.to);
  const cc = addrList(p.cc);
  const body = String(p.text || '').trim() || stripHtml(String(p.html || ''));
  // ⚠️ 用 Message-ID 当 key（跨文件夹稳定）；它缺了才退回 uid。
  const key = String(p.messageId || `${folder}-uid${uid}`).replace(/[<>]/g, '');

  // ── 线索（线程）────────────────────────────────────────────────
  // ⚠️⚠️ **这是「线程未结提醒」唯一的可靠依据**，而 2026-10-10 之前**一个字都没存**。
  //    只按主题分组是不够的：实测那条 Informa 催款线程的标题被各家客户端改得
  //    面目全非（`Enquire Payment way 回复：回复：Re: 回复：Communication from Credit
  //    Control for Informa Markets Limited, an Informa Business`）—— 「回复：」长在
  //    **句子中间**，按前缀剥根本剥不掉，于是**同一条线程被拆成三堆**。
  //    而 References 是客户端必须维护的：每一封回信都带着**完整的祖先链**，
  //    所以取**第一条**就是这条线程的根，同一条线里所有信算出同一个值。
  // ⚠️ 没有 References 就退到 In-Reply-To（拿它当父节点，靠并查集接起来），
  //    再没有就自己当根。
  const refs = refList(p.references);
  const parent = refList(p.inReplyTo)[0] ?? '';
  const root = refs[0] || parent || key;

  // ⚠️ 存哪儿：**只能存在正文头里**。docs 表只有 text 一个自由字段会被持久化，
  //    而 `Doc` 的契约里也没有第二个口袋。代价是这一行进检索语料 ——
  //    很小（一行、且是 Message-ID 这种没人会搜的串），换来的是
  //    「线程」这件事**跟着数据走**，不用每次重连 IMAP 现算。
  //    消费方（mailtodo / contacts）本来就会把 `\n\n` 之前那一整块头部丢掉。
  const head =
    `主题：${subject}\n发件人：${from}\n收件人：${to}` +
    (cc ? `\n抄送：${cc}` : '') +
    `\n时间：${p.date ? p.date.toISOString() : ''}` +
    (p.attachments?.length ? `\n附件：${p.attachments.map((a: any) => a.filename).filter(Boolean).join('、')}` : '') +
    `\n线索：root=${root} parent=${parent}`;
  return mkDoc('exmail', key, p.date ? day(p.date) : day(new Date()), subject, `${head}\n\n${body}`.slice(0, 20000), '');
}

export const exmail: Connector = {
  id: 'exmail',
  label: '企业邮箱（IMAP）',
  icon: '✉️',
  color: '#2b7cd3',
  need: ['email', 'authCode'],
  ready: (s) => {
    const m = s.exmail ?? {};
    const miss = ['email', 'authCode'].filter((k) => !String(m[k] ?? '').trim());
    if (miss.length) {
      return { ok: false, why: '还缺 ' + miss.map((k) => (k === 'email' ? '邮箱地址' : '客户端专用密码')).join(' / ') +
        '（登录邮箱网页版 → 设置 → 客户端设置 里生成）' };
    }
    return { ok: true, why: '' };
  },

  async fetch({ settings, log }) {
    const m = settings.exmail ?? {};
    // ⭐ 「能读多少就读多少」（读者 2026-10-09）：下面这几个上限只是**防止一次跑太久**，
    //    不是"就这么多"。原来分别是 30 天 / 200 封 / 只读 INBOX —— 实测那台邮箱
    //    INBOX 才 36 封，而 Sent 和其余文件夹一封都没进来。
    const days = Math.max(1, Math.min(3650, Number(m.sinceDays) || 365));
    const since = new Date(Date.now() - days * 86400000);
    const cap = Math.max(1, Math.min(5000, Number(m.max) || 1000));
    // '*' = 所有**可选择**的文件夹（默认）／'*all' = 连垃圾箱一起／否则逗号分隔的名单。
    // ⚠️ 兼容老配置里的单数 `folder`。
    const spec = String(m.folders ?? m.folder ?? '*').trim() || '*';

    const client = new ImapFlow({
      host: String(m.host || 'imap.exmail.qq.com').trim(),
      port: Number(m.port) || 993,
      secure: true,
      auth: { user: String(m.email).trim(), pass: String(m.authCode).trim() },
      logger: false,
    });

    const docs: Doc[] = [];
    let seen = 0, failed = 0;
    try {
      await client.connect();
    } catch (e) {
      // ⚠️⚠️ 这里踩过一次：`(e as Error).message` 是 **`Command failed`** ——
      //    服务器真正说的话在 `responseText` 里。只看 message 的话，
      //    "密码不对"会被报成「连不上 imap.exmail.qq.com：Command failed」，
      //    于是人跑去查网络 —— **工具把原因伪装成了另一个原因**。
      const any = e as any;
      const said = String(any?.responseText || any?.message || e);
      // ImapFlow 自己会标这个（实测为 true），比正则可靠。
      const authFailed = any?.authenticationFailed === true ||
        /AUTHENTICATIONFAILED|Login fail|Invalid credentials|LOGIN failed|authentication/i.test(said);
      if (authFailed) {
        // ⚠️ 服务器那句话本身就把几种可能列全了："Account is abnormal, service is not open,
        //    password is incorrect, login frequency limited, or system is busy."
        //    其中 **service is not open** 就是"管理员把 IMAP 关了"—— 那一种本人开不了。
        throw new Error(
          '登录被拒（**不是网络问题**）。逐条排除：\n' +
          '  ① **专用密码不对或过期** —— 最常见。回邮箱网页版 → 设置 → 客户端设置，重新生成一串；\n' +
          '     注意**不是登录密码**，也不是企业微信的登录密码。\n' +
          '  ② **管理员把整个企业的 IMAP/SMTP 关了** —— 这条你自己开不了，只能找他开。\n' +
          '  ③ **试太多次被限流了** —— 停一会儿再来，别连着猛试。\n' +
          `服务器原话：${said}`);
      }
      throw new Error(`连不上 ${m.host || 'imap.exmail.qq.com'}：${said}`);
    }

    try {
      // ── 读哪些文件夹（读者 2026-10-09：「企业邮件能读多少就读多少」）──
      //
      // ⚠️ 原来只读**一个**文件夹（`m.folder`，默认 INBOX）。
      //    实测那台邮箱：INBOX 36 封，而 Sent / 其他文件夹里的信**一封都没进来**。
      // ⇒ 现在默认 `*` = **所有可选中的文件夹**，只按语义跳过垃圾箱和已删除
      //    （那两类不是知识，是噪音）。
      // ⚠️ **跳过了什么必须说出来** —— 静默跳过读起来就像"本来就没有"。
      //    想连垃圾箱一起读，把「文件夹」填成 `*all`。
      const boxes = (await client.list()).filter((b) => b.path);
      const special = (b: { specialUse?: string }) => String(b.specialUse ?? '');
      let targets: string[];
      if (spec === '*') {
        const skip = new Set(['\\Trash', '\\Junk']);
        targets = boxes.filter((b) => !skip.has(special(b))).map((b) => b.path);
        const dropped = boxes.filter((b) => skip.has(special(b))).map((b) => b.path);
        if (dropped.length) {
          log(`  默认跳过「${dropped.join('、')}」（垃圾箱/已删除不算知识）—— 要一起读就把文件夹填 *all`);
        }
      } else if (spec === '*all') {
        targets = boxes.map((b) => b.path);
        log(`  读**全部** ${targets.length} 个文件夹（含垃圾箱）`);
      } else {
        targets = spec.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
      }
      if (!targets.length) throw new Error('没有匹配到任何文件夹（IMAP 列出来是空的？）');
      log(`  要读 ${targets.length} 个文件夹：${targets.join('、')}`);

      for (const folder of targets) {
        let lock;
        try {
          lock = await client.getMailboxLock(folder);
        } catch (e) {
          // ⚠️ 某一个文件夹打不开（权限 / 名字变了）不该让整趟同步失败
          log(`  ⚠️ 跳过 ${folder}：${(e as Error).message}`);
          continue;
        }
        try {
          // ⚠️ IMAP 的 SINCE **只精确到天**，所以同一天的信会被重复读到。
          //    不能靠它去重 —— 去重靠 doc id（下面用 Message-ID / uid），索引那层是幂等的。
          const uids = (await client.search({ since }, { uid: true })) || [];
          if (!uids.length) {
            log(`  ${folder}：${since.toISOString().slice(0, 10)} 之后没有信`);
            continue;
          }
          const take = uids.slice(-cap);
          log(`  ${folder}：${since.toISOString().slice(0, 10)} 之后 ${uids.length} 封${uids.length > take.length ? `，只取最近 ${take.length}` : ''}`);
          if (uids.length > take.length) {
            // ⚠️ 截断必须说出来。静默截断读起来就像"只有这么多信"。
            log(`    （超过单文件夹上限 ${cap}，想多取就把「单次最多取几封」调大）`);
          }
          for await (const msg of client.fetch(take, { uid: true, source: true }, { uid: true })) {
            seen += 1;
            if (!msg.source) continue;
            try {
              docs.push(docFromParsed(await simpleParser(msg.source), folder, msg.uid));
            } catch (e) {
              failed += 1;
              log(`    ⚠️ ${folder} 第 ${msg.uid} 封解析失败：${(e as Error).message}`);
            }
          }
        } finally {
          lock.release();
        }
      }
    } finally {
      await client.logout().catch(() => {});
    }

    // ⚠️ 有失败就说出来。不然"取到 9 封"和"本来只有 9 封"长得一模一样。
    log(`  取到 ${docs.length} 封${failed ? `，${failed} 封解析失败` : ''}（扫描 ${seen} 封）`);
    return docs;
  },
};
