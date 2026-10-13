/**
 * **正在运行的桌面 App** —— CEVTUO Pet 点一下，围着它弹出一圈，点一个就切过去。
 *
 * 读者 2026-10-10 原话：
 *   「cevtuopet 可以不只是打开一个软件，是**点击之后弹出来桌面正在打开了的软件**，
 *     选择就可以切换，**聚集在周围的感觉**，再次点击收回」。
 *
 * ⚠️⚠️ 为什么不用 AppleScript / System Events：
 *    读进程列表那几条路（`System Events` 的 `get name of every process`）
 *    要**辅助功能授权**，没授权时报的是"脚本错误" —— 看起来像"这个功能坏了"，
 *    其实是权限没给。`ps` 不需要任何授权，读出来还更全（Dock 里没有的也算）。
 *
 * ⚠️ **只认 `.app/Contents/MacOS/...` 这种路径** —— 那是"有界面的应用"的形状。
 *    不过滤的话，列表里会混进几十个 `com.apple.WebKit.*` 后台进程，
 *    而它们**点了什么都不会发生**（点不动 = 看起来像坏了）。
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';

export interface RunningApp {
  name: string;
  /** `.app` 包目录的绝对路径 —— 激活和取图标都用它 */
  path: string;
  pid: number;
}

const run = (cmd: string, args: string[], timeout = 4000) =>
  new Promise<string>((res) => {
    execFile(cmd, args, { timeout, maxBuffer: 4 << 20 }, (err, out) => res(err ? '' : String(out)));
  });

/** 带 stderr 的版本 —— ⚠️ 成功/失败**必须分得开**：
 *  上一版 `run()` 失败时返回空串，`activateApp` 于是**永远返回 ok**
 *  （"点了没反应"和"点成功了但窗口没到前面"在界面上长得一模一样）。 */
const runFull = (cmd: string, args: string[], timeout = 8000) =>
  new Promise<{ ok: boolean; out: string; err: string }>((res) => {
    execFile(cmd, args, { timeout, maxBuffer: 4 << 20 }, (err, out, errOut) => {
      res({ ok: !err, out: String(out ?? ''), err: String(errOut ?? '') || (err ? err.message : '') });
    });
  });

/** 从一条可执行文件路径里认出 `.app` 包；认不出就返回 null。 */
function bundleOf(execPath: string): string | null {
  const i = execPath.indexOf('.app/Contents/MacOS/');
  if (i < 0) return null;
  return execPath.slice(0, i + 4); // 含 '.app'
}

export async function runningApps(opts: { self?: string } = {}): Promise<RunningApp[]> {
  // ⚠️⚠️ `ps` 不够 —— 实测它给出 **71 个**，其中大部分是
  //    `AccessibilityUIServer` / `AppSSOAgent` / `AdobeIPCBroker` 这种**后台代理**，
  //    它们点了什么都不会发生（点不动 = 看起来像坏了）。
  //    `lsappinfo` 给每个 App 标了 `type=`，实测三类：
  //      BackgroundOnly 47 / **Foreground 12** / UIElement 59
  //    ⇒ 只有 `Foreground` 才是"桌面上真的开着的那个窗口"。
  const out = await run('lsappinfo', ['list']);
  const apps: RunningApp[] = [];
  const seen = new Set<string>();
  for (const block of out.split(/\n\s*\d+\)\s/)) {
    if (!/type="Foreground"/.test(block)) continue;
    const path = block.match(/bundle path="([^"]+)"/)?.[1];
    if (!path || !path.endsWith('.app')) continue;
    if (opts.self && path.includes(opts.self)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    const named = block.match(/"(?:[^"]*)" ASN|^"?([^"\n]+)"? ASN/);
    const pid = Number(block.match(/pid\s*=\s*(\d+)/)?.[1] ?? 0);
    apps.push({ name: basename(path, '.app') || (named?.[1] ?? '?'), path, pid });
  }
  // `lsappinfo` 一条都读不到时（权限/版本变了）退回 `ps` + 只认 /Applications 那几个目录 ——
  // **降级也要能出东西**，空列表在界面上就是"这个功能没做"
  if (!apps.length) {
    const ps = await run('ps', ['-Aww', '-o', 'pid=,comm=']);
    for (const line of ps.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!m) continue;
      const path = bundleOf(m[2]);
      if (!path || !/^\/(Applications|System\/Applications|Users\/[^/]+\/Applications)\//.test(path)) continue;
      if (opts.self && path.includes(opts.self)) continue;
      if (seen.has(path)) continue;
      seen.add(path);
      apps.push({ name: basename(path, '.app'), path, pid: Number(m[1]) });
    }
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

/**
 * 切到那个 App —— **要真的把它的窗口提到最前面**。
 *
 * ⚠️⚠️ 读者 2026-10-10 傍晚：「如果最近这些软件**不论是快捷字母还是点击都没有跳过去**
 *    那个窗口放到最前面」。真因是上一版只 `open -a <path>`：
 *    · 对一个**已经开着**的 App，`open -a` 有时只是"确保它在跑"，窗口不一定提到前面；
 *    · 而且上一版**把错误吞掉了**（`run()` 失败返回空串）⇒ 点没点成，界面上一模一样。
 *
 * ⇒ 现在两条路一起下，而且**如实回报**：
 *   ① `osascript -e 'tell application id "<bundleId>" to activate'` —— `activate` 不需要
 *      任何系统授权（只有 System Events 那类"点坐标/读其它 App 的界面"才要）；
 *   ② 再补一次 `open -a <path>`（没在跑的时候靠它启动）。
 *   ⚠️ **不看 osascript 的退出码当唯一判据** —— 有些 App 没注册 AppleScript 支持，
 *      它会报错但 `open -a` 那一下是成的。所以判据是"**至少有一条成功**"。
 */
/** bundleId 缓存（同一个 .app 一辈子不变，别每次都起 plutil）*/
const bidCache = new Map<string, string>();

export async function activateApp(path: string): Promise<{ ok: boolean; error?: string; how?: string }> {
  if (!path || !path.endsWith('.app') || !existsSync(path)) return { ok: false, error: '找不到这个应用：' + path };
  // ⚠️ bundleId 缓存：`plutil` 每次要起一个进程（~40ms），而同一个 App 一辈子不会变
  let bundleId = bidCache.get(path) ?? '';
  if (!bundleId) {
    bundleId = (await run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(path, 'Contents', 'Info.plist')])).trim();
    if (bundleId) bidCache.set(path, bundleId);
  }
  // ⚠️ 两条**并行**发（原来是串行 await，白等一倍）。谁成谁算 —— 不看单条的退出码。
  const [a, b] = await Promise.all([
    bundleId ? runFull('osascript', ['-e', `tell application id "${bundleId}" to activate`]) : Promise.resolve({ ok: false, out: '', err: '' }),
    runFull('open', ['-a', path]),
  ]);
  let how = '';
  if (a.ok) how = 'activate';
  if (b.ok) how = how ? how + '+open' : 'open';
  if (!how) return { ok: false, error: (b.err || '系统没让打开它').slice(0, 200) };
  return { ok: true, how };
}

/**
 * ⭐ App 的图标。
 *
 * ⚠️⚠️ 为什么要**落盘缓存**：`sips` 把 .icns 转成 PNG 一次要几十毫秒，
 *    而这一圈图标是**点一下就要立刻出现**的 —— 十来个图标现转就是半秒白屏。
 *    缓存目录用 `~/.c4emem/icons/<bundle 名字>.png`，名字里带 bundle 路径的哈希，
 *    所以同一个 App 换版本（图标变了）会自然失效。
 */
export function iconCacheDir(dataDir: string) { return join(dataDir, 'icons'); }

export async function appIcon(dataDir: string, appPath: string): Promise<{ file: string } | { error: string }> {
  if (!appPath.endsWith('.app') || !existsSync(appPath)) return { error: '找不到这个应用' };
  const dir = iconCacheDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const cache = join(dir, basename(appPath, '.app').replace(/[^\w一-龥-]/g, '_') + '.png');
  if (existsSync(cache) && Date.now() - statSync(cache).mtimeMs < 30 * 86400000) return { file: cache };

  // Info.plist 里的 CFBundleIconFile 就是资源目录里那个 .icns（常常**不带后缀**）
  const raw = (await run('plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', join(appPath, 'Contents', 'Info.plist')])).trim();
  const res = join(appPath, 'Contents', 'Resources');
  const cands: string[] = [];
  if (raw) cands.push(raw.endsWith('.icns') ? raw : raw + '.icns');
  cands.push('AppIcon.icns', 'app.icns');
  let icns = cands.map((c) => join(res, c)).find((p) => existsSync(p));
  if (!icns && existsSync(res)) {
    // 兜底：资源目录里随便找一个 .icns（有些 App 的 plist 里根本没写）
    icns = readdirSync(res).filter((f) => f.endsWith('.icns')).map((f) => join(res, f))[0];
  }
  if (!icns) return { error: '这个应用没带图标文件' };
  await run('sips', ['-s', 'format', 'png', '-Z', '128', icns, '--out', cache], 8000);
  return existsSync(cache) ? { file: cache } : { error: '图标转不出来' };
}

/**
 * ⭐ 退出若干个 App（读者 2026-10-10 深夜：「右键……是一个勾选列表，
 *    目前所有的软件，可以勾选然后点 delete 就都退出掉」）。
 *
 * ⚠️⚠️ **判据是"它真的不在了"，不是"quit 命令返回 0"** ——
 *    这一条是从 CAPPERR 那次学来的（`handleRebuild` 返回 202 而发布那段判 200，
 *    于是"操作者收到成功回执、数据没动"）。`osascript ... to quit` 对着一个
 *    **弹了"要保存吗"对话框**的 App 也是立刻返回成功的，而它根本没退。
 *    ⇒ 发完 `quit` 就**盯着 `lsappinfo` 看它消失没有**；超时了就如实说"还在"。
 *
 * ⚠️ 用 `quit`（优雅退出，等于点菜单里的"退出"）而不是 `kill`：
 *    后者对 GUI App 常常等于"直接断电"，没保存的东西就没了。
 *    只有优雅退出**真的没退成**时才补一记 SIGTERM，并在结果里标出来。
 */
export async function quitApps(paths: string[]): Promise<{
  ok: boolean;
  done: string[];
  failed: { path: string; name: string; error: string }[];
}> {
  const done: string[] = [];
  const failed: { path: string; name: string; error: string }[] = [];

  for (const path of paths) {
    const name = basename(String(path ?? ''), '.app') || String(path ?? '');
    if (!path || !path.endsWith('.app') || !existsSync(path)) {
      failed.push({ path, name, error: '找不到这个应用（路径不对）' });
      continue;
    }
    const bundleId = (await run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(path, 'Contents', 'Info.plist')])).trim();

    let asked = false;
    if (bundleId) {
      const a = await runFull('osascript', ['-e', `tell application id "${bundleId}" to quit`]);
      asked = a.ok;
    }
    if (!asked) {
      const b = await runFull('osascript', ['-e', `tell application "${name}" to quit`]);
      asked = b.ok;
    }
    if (!asked) {
      failed.push({ path, name, error: '系统不接受退出请求（这个 App 没注册 AppleScript，且名字也对不上）' });
      continue;
    }

    // ⭐ 等它**真的从运行列表里消失**（最多 ~3 秒）
    let gone = false;
    for (let i = 0; i < 10; i += 1) {
      await new Promise((r) => setTimeout(r, 300));
      const now = await runningApps();
      if (!now.some((x) => x.path === path)) { gone = true; break; }
    }
    if (gone) { done.push(path); continue; }

    // 优雅退出没成 ⇒ 补一记 SIGTERM，并**在回执里说清楚是硬关的**
    const pid = (await runningApps()).find((x) => x.path === path)?.pid ?? 0;
    if (pid > 0) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* 已经没了 */ }
      await new Promise((r) => setTimeout(r, 600));
      const still = (await runningApps()).some((x) => x.path === path);
      if (!still) { done.push(path); continue; }
    }
    failed.push({ path, name, error: '还开着（多半是弹了「要保存吗」的对话框在等它自己问）' });
  }
  return { ok: failed.length === 0, done, failed };
}

/** 兜底：用户手动给了一个 .app 路径（设置里挑的"点它就打开某个软件"） */
export function expandHome(p: string) { return p.startsWith('~') ? join(homedir(), p.slice(1)) : p; }
