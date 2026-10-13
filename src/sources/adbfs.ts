/**
 * **通过 ADB 操作手机上的文件** —— 不只是"读这个软件的日志"。
 *
 * 读者 2026-10-10 深夜原话：
 *   「andromeld 当我尝试去做功能的时候它做不了通过 **ADB 去读取手机的文件然后处理操作手机文件**
 *     的功能，但是**这也是我希望有的**」
 *
 * ⚠️⚠️ 为什么上一版提案说"接不了"：那个提案问的是「把 AndroMeld 的**数据**接进知识库当来源」，
 *    而 AndroMeld 是**工具**不是**内容源** —— 那个结论对**那个问题**是对的。
 *    但读者要的是另一件事：**拿 ADB 当一双手**，去够手机上的文件。
 *    ⇒ 这两件事必须分开：
 *      · «当来源» = 它有没有"一段一段的内容"可以抽（工具类没有）
 *      · «当能力» = 它能不能**替你去读/写别的数据**（ADB 能，而且能得很彻底）
 *    把这两个问题混成一个，就会得到"接不了"这种看着有道理、其实答错了的结论。
 *
 * ⚠️⚠️ 写和删**必须先确认**（`confirm: true`），而且**每一步都记进 activity**：
 *    这是**别人手机上的文件**，一个静默的 rm 是不可逆的。
 */

export interface AdbFile {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  mtime: string;
}

const ADB = 'adb';

async function run(args: string[], timeout = 20000): Promise<{ ok: boolean; out: string; err: string }> {
  const { execFile } = await import('node:child_process');
  return new Promise((res) => {
    execFile(ADB, args, { timeout, maxBuffer: 8 << 20 }, (e, out, errOut) => {
      res({ ok: !e, out: String(out ?? ''), err: String(errOut ?? '') || (e ? e.message : '') });
    });
  });
}

/** 连的是哪台。⚠️ 没有它就一切免谈，而报错必须说清"没连线/没授权"—— */
export async function pickDevice(serial?: string): Promise<{ ok: true; serial: string } | { ok: false; error: string }> {
  const r = await run(['devices']);
  const lines = r.out.split('\n').slice(1).map((l) => l.trim()).filter((l) => l && !l.startsWith('*'));
  const ready = lines.filter((l) => /\sdevice$/.test(l)).map((l) => l.split(/\s+/)[0]);
  const unauthorized = lines.filter((l) => /unauthorized/.test(l)).map((l) => l.split(/\s+/)[0]);
  if (serial && ready.includes(serial)) return { ok: true, serial };
  if (ready.length) return { ok: true, serial: serial && ready.includes(serial) ? serial : ready[0] };
  if (unauthorized.length) return { ok: false, error: `手机没授权：${unauthorized.join(', ')}。手机上会弹一个"允许 USB 调试"，点允许。` };
  if (!r.ok) return { ok: false, error: 'adb 起不来：' + r.err.slice(0, 120) };
  return { ok: false, error: '没有连着的手机（adb devices 是空的）' };
}

/**
 * ⚠️⚠️ **路径要包在单引号里**再交给 adb —— 手机上的文件名里空格、`(`、`&`、中文都很常见，
 *    不引的话 shell 会替我们拆词，报的是"no such file"，
 *    看起来像"文件不存在"，其实是**我们把自己的命令拆坏了**。
 * ⚠️ 反过来，引号里的单引号要按 shell 的规矩转义（`'` → `'\''`），不然可以直接越出引号。
 */
const q = (p: string) => `'${String(p).replace(/'/g, `'\\''`)}'`;

export async function ls(serial: string, path: string): Promise<{ ok: boolean; items?: AdbFile[]; error?: string }> {
  // `ls -l` 的列宽随系统变，所以只取「权限 / 名字」这两件确定的事，别的用 stat 补
  // ⚠️ 用 `--` 分隔符：以 `-` 开头的文件名否则会被当成选项
  const r = await run(['-s', serial, 'shell', `ls -la -- ${q(path)}`]);
  if (!r.ok) return { ok: false, error: r.err.slice(0, 200) || 'ls 失败' };
  const items: AdbFile[] = [];
  for (const line of r.out.split('\n')) {
    const m = line.match(/^([dl-])\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+([\d-]+ [\d:]+)\s+(.+)$/);
    if (!m) continue;
    const name = m[4].trim();
    if (name === '.' || name === '..') continue;
    items.push({
      name, path: path.replace(/\/$/, '') + '/' + name, dir: m[1] === 'd',
      size: Number(m[2]) || 0, mtime: m[3],
    });
  }
  return { ok: true, items };
}

/**
 * 读一个文本文件。
 * ⚠️ **有上限**：手机上的文件可能是几百 MB 的日志/视频，整个读进来会把服务撑爆。
 *    超了就**如实截断并在返回里说**（`truncated: true`）—— 悄悄截一半比直接报错更坏。
 */
export async function read(serial: string, path: string, maxBytes = 256 * 1024): Promise<{ ok: boolean; text?: string; truncated?: boolean; bytes?: number; error?: string }> {
  const sz = await run(['-s', serial, 'shell', `stat -c %s -- ${q(path)}`]);
  const bytes = Number(sz.out.trim());
  const limit = Number.isFinite(bytes) && bytes > 0 ? Math.min(bytes, maxBytes) : maxBytes;
  const r = await run(['-s', serial, 'shell', `head -c ${limit} -- ${q(path)}`]);
  if (!r.ok) return { ok: false, error: r.err.slice(0, 200) || '读不了' };
  return { ok: true, text: r.out, truncated: Number.isFinite(bytes) && bytes > limit, bytes: Number.isFinite(bytes) ? bytes : undefined };
}

/** ⚠️ 落盘目录固定在一个地方，不接受任意路径 —— 否则等于让网页往磁盘任意位置写 */
export async function pull(serial: string, remote: string, localDir: string): Promise<{ ok: boolean; file?: string; error?: string }> {
  const name = String(remote).split('/').filter(Boolean).pop() || 'file';
  const { mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  mkdirSync(localDir, { recursive: true });
  const dest = join(localDir, name.replace(/[/\\]/g, '_'));
  const r = await run(['-s', serial, 'pull', remote, dest], 120000);
  if (!r.ok) return { ok: false, error: r.err.slice(0, 200) || '拉不下来' };
  return { ok: true, file: dest };
}

/**
 * 删除。⚠️⚠️ **必须显式 confirm**，而且**删之前先看一眼它在不在** ——
 *    `rm -rf` 对着一个拼错的路径也是"成功"的（退出码 0），
 *    于是"删错了东西"和"删成了"在日志里长得一模一样。
 */
export async function rm(serial: string, path: string, confirm: boolean): Promise<{ ok: boolean; existed?: boolean; error?: string }> {
  if (!confirm) return { ok: false, error: '没有确认 —— 删手机上的文件必须显式 confirm' };
  const ex = await run(['-s', serial, 'shell', `[ -e ${q(path)} ] && echo yes || echo no`]);
  if (!/yes/.test(ex.out)) return { ok: false, existed: false, error: '这个路径在手机上不存在（什么都没做）' };
  const r = await run(['-s', serial, 'shell', `rm -rf -- ${q(path)}`]);
  return r.ok ? { ok: true, existed: true } : { ok: false, error: r.err.slice(0, 200) };
}

/** 写上去也一样要 confirm */
export async function push(serial: string, local: string, remote: string, confirm: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!confirm) return { ok: false, error: '没有确认 —— 往手机上写文件必须显式 confirm' };
  const r = await run(['-s', serial, 'push', local, remote], 120000);
  return r.ok ? { ok: true } : { ok: false, error: r.err.slice(0, 200) };
}

// ── 手机信息 / 手机图片（读者 2026-10-10：「手机图片、手机信息这几个部分功能至少」）──

/** 机型 / 系统 / 电量 / 存储 —— 一次问全，别让界面发四次 */
export async function info(serial: string): Promise<Record<string, string>> {
  const prop = async (k: string) => (await run(['-s', serial, 'shell', `getprop ${k}`])).out.trim();
  const [model, brand, ver, sdk, battery] = await Promise.all([
    prop('ro.product.model'), prop('ro.product.brand'), prop('ro.build.version.release'),
    prop('ro.build.version.sdk'), run(['-s', serial, 'shell', 'dumpsys battery']),
  ]);
  const lvl = battery.out.match(/level:\s*(\d+)/)?.[1] ?? '?';
  // ⚠️ `df -h /sdcard` 在 Android 上**数据行里根本没有 `/sdcard` 这三个字**
  //    （挂载点是 `/data/media`）⇒ 第一版按 `/sdcard|data/` 找那一行，一个都没匹配上，
  //    存储这一格就一直是空的（而"空"和"没读到"在界面上长得一样）。
  //    ⇒ 改成：跳过表头，取**最后一条数据行**，列 2 = 总量、列 4 = 可用。
  const df = await run(['-s', serial, 'shell', 'df -h /sdcard']);
  const rows = df.out.split('\n').map((l) => l.trim()).filter((l) => l && !/^Filesystem/i.test(l));
  const parts = (rows[rows.length - 1] ?? '').split(/\s+/);
  return {
    model: `${brand} ${model}`.trim(), android: `Android ${ver} (SDK ${sdk})`,
    battery: lvl + '%',
    storage: parts.length >= 4 && /\d/.test(parts[1]) ? `${parts[3]} 可用 / 共 ${parts[1]}` : '',
  };
}

/**
 * 相册里的图片。
 *
 * ⚠️⚠️ **只列清单，不拉文件**：一张照片两三 MB，一屏 24 张就是 50 MB、
 *    走 ADB 要几十秒 —— 那看着像"卡死了"。点开某一张时才真的 `pull` 回来（见 /api/phone/file）。
 * ⚠️ 按**修改时间倒序**：相册列表不排序的话，用户看到的是 file system 的随机顺序，
 *    而"最近拍的"才是他真正要找的东西。
 *
 * ⭐⭐ 2026-10-10 改：**问 MediaStore，不再猜目录**。
 *    读者原话：「图片不只是几十张，**可能是你没找对图库的地址**」—— 他是对的：
 *    老那 5 个目录（DCIM/Camera、DCIM、Pictures、Screenshots、Download）在真机上
 *    只扫到 **48 张**，而 `content://media/external/images/media` 里是 **6788 张**。
 *    差的那 99% 在 `/sdcard/Android/media/<包名>/...`（WhatsApp、Photoroom…）——
 *    **老代码根本没扫过那些地方**，而且它们是"应用自己的相册目录"，
 *    只有系统媒体库知道有哪些。
 *    ⚠️ 为什么不是 `find /sdcard -iname '*.jpg'`：
 *      ① 扫全盘要几十秒；② `/sdcard/Android/data/**` 普通用户**读不到**（find 也进不去），
 *      而 MediaStore 是**系统给的**清单，权限那条路它自己走通了。
 *    ⚠️ 判据是"**列出来了几张**"，不是"命令退出码 0" —— 老实现两条都满足，
 *      差别只有数量（48 vs 6788），而数量这件事**不写断言就永远发现不了**。
 */
const MS_URI = 'content://media/external/images/media';
/** `/storage/emulated/0/...` 和 `/sdcard/...` 是同一个地方；统一成后者（仓库里到处都是它） */
const toSdcard = (p: string) => p.replace(/^\/storage\/emulated\/0/, '/sdcard');

export async function photos(serial: string, limit = 60): Promise<{ ok: boolean; items?: { name: string; path: string; size: number; mtime: string }[]; dirs?: string[]; total?: number; how?: string; error?: string }> {
  let items: { name: string; path: string; size: number; mtimeMs: number }[] = [];
  let how = '';
  let scanned: string[] = [];

  // ① 权威来源：MediaStore（已按修改时间倒序，所以 `head` 拿到的就是**最新的那几张**）
  // ⚠️ 这个变量**不能叫 `q`** —— 那个名字是上面那个"给 shell 参数加引号"的工具函数，
  //    遮蔽了它，下面降级那一段的 `q(d)` 就变成"调用一个字符串"了（跑起来才知道）。
  const msCmd = `content query --uri ${MS_URI} --projection _data:_size:date_modified --where "is_trashed=0" --sort "date_modified DESC" 2>/dev/null | head -n ${Math.max(limit, 1)}`;
  const r = await run(['-s', serial, 'shell', msCmd], 30000);
  if (r.ok && r.out.trim()) {
    how = 'MediaStore 媒体库';
    for (const line of r.out.split('\n')) {
      // `Row: 0 _data=/sdcard/a b.jpg, _size=123, date_modified=1791601253`
      const d = line.match(/_data=(.*?)(?:,\s*_size=|,\s*date_modified=|$)/);
      if (!d) continue;
      const path = toSdcard(d[1].trim());
      const size = Number(line.match(/_size=(\d+)/)?.[1] ?? 0);
      const t = Number(line.match(/date_modified=(\d+)/)?.[1] ?? 0);
      items.push({ name: path.split('/').pop() ?? '', path, size, mtimeMs: t * 1000 });
    }
  }

  // ② 降级：老那套目录扫描。**降级也要能出东西**（MediaStore 被禁 / 老系统没有 content 命令时）
  if (!items.length) {
    const cands = ['/sdcard/DCIM/Camera', '/sdcard/DCIM', '/sdcard/Pictures', '/sdcard/Screenshots', '/sdcard/Download'];
    scanned = cands;
    const cmd = cands
      .map((d) => `[ -d ${q(d)} ] && find ${q(d)} -maxdepth 2 -type f \\( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.heic' -o -iname '*.webp' \\) -printf '%T@\\t%s\\t%p\\n' 2>/dev/null`)
      .join('; ');
    const r2 = await run(['-s', serial, 'shell', cmd], 30000);
    if (!r2.ok && !r.ok) return { ok: false, error: (r.err || r2.err).slice(0, 160) || '列不出来' };
    how = '目录扫描（MediaStore 没给东西，已降级）';
    items = r2.out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [t, s, ...rest] = l.split('\t');
      const path = rest.join('\t');
      return { name: path.split('/').pop() ?? '', path, size: Number(s) || 0, mtimeMs: Number(t) * 1000 };
    }).filter((x) => x.path);
  }

  // 去重（媒体库里同一张图可能有两行）+ 排序（降级那一路没排序）
  const seen = new Set<string>();
  items = items.filter((x) => (seen.has(x.path) ? false : (seen.add(x.path), true)))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  // 媒体库里**一共**有多少张 —— 读者以为"就几十张"，这个数字就是答案
  let total = items.length;
  if (how === 'MediaStore 媒体库') {
    const c = await run(['-s', serial, 'shell', `content query --uri ${MS_URI} --projection _id 2>/dev/null | wc -l`], 20000);
    const n = Number(c.out.trim());
    if (Number.isFinite(n) && n > 0) total = n;
  }

  return {
    ok: true, dirs: scanned, total, how: how + (total > items.length ? `（共 ${total} 张）` : ''),
    items: items.slice(0, limit).map((x) => ({
      name: x.name, path: x.path, size: x.size,
      // ⚠️ 用**本地时区**（`sv-SE` 正好是 `YYYY-MM-DD HH:mm` 这个形状）。
      //    `toISOString()` 是 UTC —— 实测手机上 11:00 拍的照在这儿写 03:00，
      //    和手机对不上就会让人以为"时间读错了"。
      mtime: new Date(x.mtimeMs).toLocaleString('sv-SE').slice(0, 16),
    })),
  };
}
