/**
 * 三个来源连接器：企业微信邮件 / Figma / 手机(ADB)。
 * 每个都实现 `Connector`：能不能用 + 怎么取一批文档。
 */
import { spawn } from 'node:child_process';
import { mkDoc, day, type Connector, type Doc } from './types';
import { exmail } from './exmail';
export { exmail };

const run = (cmd: string, args: string[], timeoutMs = 20000) =>
  new Promise<{ code: number; out: string }>((res) => {
    let out = '';
    let done = false;
    try {
      const c = spawn(cmd, args);
      const timer = setTimeout(() => {
        if (!done) { done = true; try { c.kill(); } catch {} res({ code: -1, out: out + '\n(超时)' }); }
      }, timeoutMs);
      c.stdout.on('data', (d) => (out += d));
      c.stderr.on('data', (d) => (out += d));
      c.on('close', (code) => {
        if (done) return;
        done = true; clearTimeout(timer); res({ code: code ?? -1, out });
      });
      c.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); res({ code: -1, out: String(e.message) }); } });
    } catch (e) {
      res({ code: -1, out: (e as Error).message });
    }
  });

// ══════════════════════════════════════════════════════════
// 企业微信邮件
// ══════════════════════════════════════════════════════════
export const wecom: Connector = {
  id: 'wecom',
  label: '企业微信邮件',
  icon: '✉️',
  color: '#2b7cd3',
  need: ['corpId', 'secret'],
  ready: (s) => {
    const w = s.wecom ?? {};
    const miss = ['corpId', 'secret'].filter((k) => !String(w[k] ?? '').trim());
    return miss.length ? { ok: false, why: '还缺 ' + miss.join(' / ') } : { ok: true, why: '' };
  },
  async fetch({ settings, log }) {
    const w = settings.wecom ?? {};
    const t = await (
      await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(w.corpId)}&corpsecret=${encodeURIComponent(w.secret)}`,
      )
    ).json() as any;
    if (t.errcode) throw new Error(`取 access_token 失败 ${t.errcode}：${t.errmsg}`);
    const at = t.access_token as string;

    const end = Math.floor(Date.now() / 1000);
    const begin = end - 30 * 86400; // 最近 30 天
    const ids: string[] = [];
    let cursor = '';
    for (let g = 0; g < 30; g += 1) {
      const r = (await (
        await fetch(`https://qyapi.weixin.qq.com/cgi-bin/exmail/app/get_mail_list?access_token=${at}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ begin_time: begin, end_time: end, cursor, limit: 200 }),
        })
      ).json()) as any;
      if (r.errcode) throw new Error(`拉邮件列表失败 ${r.errcode}：${r.errmsg}`);
      ids.push(...((r.mail_list ?? []) as any[]).map((x) => x.mail_id));
      if (!r.has_more || !r.next_cursor) break;
      cursor = r.next_cursor;
    }
    log(`  邮件列表 ${ids.length} 封，逐封取正文…`);

    const docs: Doc[] = [];
    for (const id of ids) {
      try {
        const r = (await (
          await fetch(`https://qyapi.weixin.qq.com/cgi-bin/exmail/app/get_mail_content?access_token=${at}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mail_id: id }),
          })
        ).json()) as any;
        if (r.errcode) continue;
        const m = r.mail_data ?? r;
        const subject = String(m.subject ?? '(无主题)');
        const from = String(m.from?.address ?? m.from ?? '');
        const ts = Number(m.date ?? m.sent_time ?? 0);
        const when = day(new Date((ts || Date.now() / 1000) * 1000));
        const body = String(m.content ?? m.text ?? m.digest ?? '').trim();
        if (!body && !subject) continue;
        docs.push(
          mkDoc('wecom', id, when, subject, `主题：${subject}\n发件人：${from}\n\n${body}`.slice(0, 20000), ''),
        );
      } catch {
        /* 单封失败不影响其它 */
      }
    }
    return docs;
  },
};

// ══════════════════════════════════════════════════════════
// Figma
// ══════════════════════════════════════════════════════════
export const figma: Connector = {
  id: 'figma',
  label: 'Figma',
  icon: '🎨',
  color: '#a259ff',
  need: ['token', 'projectId'],
  ready: (s) => {
    const f = s.figma ?? {};
    const miss = ['token', 'projectId'].filter((k) => !String(f[k] ?? '').trim());
    return miss.length ? { ok: false, why: '还缺 ' + miss.join(' / ') } : { ok: true, why: '' };
  },
  async fetch({ settings, log }) {
    const f = settings.figma ?? {};
    const H = { 'X-Figma-Token': String(f.token) };
    const list = (await (
      await fetch(`https://api.figma.com/v1/projects/${encodeURIComponent(f.projectId)}/files`, { headers: H })
    ).json()) as any;
    if (list.err) throw new Error(`Figma 报错：${list.err}`);
    const files = (list.files ?? []) as any[];
    log(`  项目里有 ${files.length} 个文件`);

    const docs: Doc[] = [];
    for (const it of files) {
      let pages = '';
      // 只取到页面层（depth=1）—— 再往下会非常慢，而且对检索价值不大
      try {
        const d = (await (await fetch(`https://api.figma.com/v1/files/${it.key}?depth=1`, { headers: H })).json()) as any;
        pages = (d.document?.children ?? []).map((c: any) => String(c.name)).join(' / ');
      } catch {
        /* 拿不到就把文件本身记下 */
      }
      docs.push(
        mkDoc(
          'figma',
          it.key,
          day(it.last_modified ?? new Date()),
          String(it.name ?? '(未命名设计稿)'),
          [
            `设计文件：${it.name}`,
            `最后修改：${it.last_modified ?? ''}`,
            pages ? `页面：${pages}` : '',
            `链接：https://www.figma.com/file/${it.key}`,
          ]
            .filter(Boolean)
            .join('\n'),
          `https://www.figma.com/file/${it.key}`,
        ),
      );
    }
    return docs;
  },
};

// ══════════════════════════════════════════════════════════
// 手机（ADB）
// ══════════════════════════════════════════════════════════
export const adb: Connector = {
  id: 'adb',
  label: '手机 (ADB)',
  icon: '📱',
  color: '#22b07d',
  need: ['adb 已安装', '手机已连线并授权'],
  ready: (s) => {
    const ser = String(s.adb?.serial ?? '').trim();
    return { ok: true, why: ser ? '' : '没指定序列号 —— 会自动挑第一台已连接设备' };
  },
  async fetch({ settings, log }) {
    const want = String(settings.adb?.serial ?? '').trim();
    const dev = await run('adb', ['devices']);
    const lines = dev.out.split('\n').slice(1).map((l) => l.trim()).filter((l) => l && !l.startsWith('*'));
    const alive = lines.filter((l) => l.endsWith('device')).map((l) => l.split(/\s+/)[0]);
    if (!alive.length) {
      const st = lines.map((l) => l.split(/\s+/)[0] + '(' + (l.split(/\s+/)[2] ?? '?') + ')').join(', ');
      throw new Error(`没有可用设备。adb 看到：${st || '（空）'}。⚠️ 没授权过的话手机上要弹"允许 USB 调试"`);
    }
    const S = want && alive.includes(want) ? want : alive[0];
    const a = (args: string[]) => run('adb', ['-s', S, ...args]);
    log(`  设备 ${S}`);

    const docs: Doc[] = [];

    // ① 设备状态（电池/网络/型号）—— 一行话，但很有用
    const [bat, props] = await Promise.all([
      a(['shell', 'dumpsys', 'battery']),
      a(['shell', 'getprop', 'ro.product.model']),
    ]);
    const lvl = /level:\s*(\d+)/.exec(bat.out)?.[1] ?? '?';
    const model = props.out.trim() || 'Android';
    docs.push(
      mkDoc('adb', `dev-${S}-${day(new Date())}`, day(new Date()), `手机状态 ${model}`, `型号：${model}\n电量：${lvl}%\n序列号：${S}`, ''),
    );

    // ② 通知流 —— 手机上刚收到的东西，是这里最有价值的一块
    const n = await a(['shell', 'dumpsys', 'notification', '--noredact']);
    if (n.code === 0 && n.out.length > 500) {
      const titles = [...n.out.matchAll(/android\.title=String \((.*?)\)/g)].map((m) => m[1]);
      const texts = [...n.out.matchAll(/android\.text=String \((.*?)\)/g)].map((m) => m[1]);
      const pairs: string[] = [];
      for (let i = 0; i < Math.max(titles.length, texts.length); i += 1) {
        const t = (titles[i] ?? '').trim();
        const x = (texts[i] ?? '').trim();
        if (t || x) pairs.push(`· ${t}${t && x ? '：' : ''}${x}`);
      }
      if (pairs.length) {
        docs.push(
          mkDoc('adb', `notif-${S}-${day(new Date())}-${Math.floor(Date.now() / 3600000)}`, day(new Date()),
            `手机通知 ${pairs.length} 条`, pairs.slice(0, 200).join('\n'), ''),
        );
      }
      log(`  通知 ${pairs.length} 条`);
    }

    return docs;
  },
};

// ══════════════════════════════════════════════════════════
// 飞书
// ⚠️ 这里**故意**让 fetch 抛错，而不是返回空数组。
//    返回空数组的后果是：界面上「同步飞书」跑完显示成功、取到 0 条 ——
//    和「飞书里本来就什么都没有」长得一模一样。宁可它明说还没做。
// ══════════════════════════════════════════════════════════
export const feishu: Connector = {
  id: 'feishu',
  label: '飞书',
  icon: '📘',
  color: '#3370ff',
  need: ['appId', 'appSecret'],
  ready: (s) => {
    const f = s.feishu ?? {};
    const miss = ['appId', 'appSecret'].filter((k) => !String(f[k] ?? '').trim());
    if (miss.length) return { ok: false, why: '还缺 ' + miss.join(' / ') };
    return { ok: false, why: '凭据有了，但拉取还没实现 —— 先别指望它' };
  },
  async fetch() {
    throw new Error('飞书的文档拉取还没实现（凭据能存，取数没写）。');
  },
};

export const ALL: Connector[] = [exmail, wecom, figma, feishu, adb];
