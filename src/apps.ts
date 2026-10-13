/**
 * 本机装了哪些软件 —— 「自我改进」那一屏要的那份列表。
 *
 * 读者 2026-10-10 原话：
 *   「我需要对于其他的软件也有操作……那个页面也有一个可以拉取 APP 的列表
 *     （我的电脑里的，我可以选择应用），然后你给推荐我们做的功能，
 *     或者我对话来说想要做的功能」
 *
 * ⚠️ 为什么要有这一层：**用户记不住自己电脑里装了什么**（更记不住哪些能接），
 *    而"能接什么"恰恰决定了这个软件还能长出什么功能。
 *    让人凭记忆敲应用名，等于把最有价值的那批候选直接丢掉。
 *
 * ⚠️ 只扫**应用目录**，不去翻进程 / 用户目录 ——
 *    这里只需要"清单"，而清单越确定越好。扫得越宽，误报越多，
 *    用户看到一堆系统组件反而不知道该选哪个。
 */
import { readdirSync, existsSync, statSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';

export interface AppInfo {
  name: string;
  path: string;
  /** 我们已经接过的来源（能对上才填）—— 界面上要能一眼看出来"这个不用再接了" */
  known?: string;
  /** 它大概是干什么的（从名字猜，**只是给个分组的线索**，不是事实） */
  group: string;
}

/** 扫哪些目录。⚠️ `/System/Applications` 里是系统自带的，一般**接不了**，但列出来无害。 */
const DIRS = [
  '/Applications',
  join(homedir(), 'Applications'),
  '/System/Applications',
  '/System/Applications/Utilities',
];

/**
 * 我们已经接过的那些 —— 名字对上就标出来。
 * ⚠️ 这是**给界面看的**，不是"发现了就能接"：标出来的意思是
 *    「这个来源已经有了，你点它也不会多出什么」。
 */
const KNOWN: [RegExp, string][] = [
  [/^notion/i, 'notion'],
  [/^figma/i, 'figma'],
  [/企业微信|wecom|wework/i, 'wecom'],
  [/^飞书|lark/i, 'feishu'],
  [/kindle|calibre/i, 'kindle'],
  [/cherry\s*studio/i, 'cherry'],
  [/^chatgpt|codex/i, 'codex'],
  // ⭐⭐ **AndroMeld 就是「手机」那一个源**（读者 2026-10-10 深夜：
  //   「如果我跟他对话让 andromeld 和手机这两个源**作为同一个**的时候它也能处理好合并」）。
  //   ⚠️ 它们本来就是**同一双手**：AndroMeld 是 ADB 的前端，而我们走的就是 ADB。
  //      分成两个源的话，会出现"从 AndroMeld 看到手机"和"从手机看到手机"两套东西，
  //      而它们背后是同一台设备 —— 那正是读者说的"乱套"。
  [/andromeld/i, 'phone'],
  [/^adb\b/i, 'phone'],
];

/**
 * **不列出来的那些**。
 * ⚠️ 现在只有一条：AndroMeld（见 `scanApps` 里那段）。它是**同一台手机的另一个前端**，
 *    而手机我们**自己就走 ADB**（`src/sources/adbfs.ts`）——
 *    留着它 = 界面上出现"两个手机"，用户还得想"要不要再接一个"。
 */
const EXCLUDE: RegExp[] = [/^andromeld$/i];

/** 按名字猜个大概的分组 —— **只是排序用的**，别当结论。 */
function groupOf(name: string): string {
  if (/^Microsoft|^WPS|^Pages|^Numbers|^Keynote|^Word|^Excel|^PowerPoint/i.test(name)) return '办公';
  if (/Chrome|Safari|Edge|Firefox|Arc|Brave/i.test(name)) return '浏览器';
  if (/WeChat|QQ|Telegram|Slack|Discord|Feishu|飞书|企业微信|DingTalk|钉钉/i.test(name)) return '沟通';
  if (/Code|Xcode|Terminal|iTerm|Docker|Postman|Sourcetree|Git/i.test(name)) return '开发';
  if (/Photoshop|Illustrator|Sketch|Figma|Affinity|Blender|Final Cut|Premiere|IINA|VLC/i.test(name)) return '创意';
  if (/Finder|System|Settings|Console|Activity|Disk|Preview|TextEdit|Calculator/i.test(name)) return '系统';
  return '其他';
}

export function scanApps(opts: { dirs?: string[]; limit?: number } = {}): { apps: AppInfo[]; scanned: string[] } {
  const dirs = opts.dirs ?? DIRS;
  const limit = Math.max(1, opts.limit ?? 400);
  const seen = new Set<string>();
  const apps: AppInfo[] = [];
  const scanned: string[] = [];

  for (const d of dirs) {
    if (!existsSync(d)) continue;
    scanned.push(d);
    let entries: string[] = [];
    try {
      entries = readdirSync(d);
    } catch {
      continue; // 没权限的目录不该让整件事失败
    }
    for (const e of entries) {
      if (!e.endsWith('.app')) continue;
      const full = join(d, e);
      const name = basename(e, '.app');
      // ⚠️ 按**名字**去重（不是按路径）：同一个 app 常常同时躺在
      //    `/Applications` 和 `~/Applications` 里，列两遍会让用户以为装了两份。
      if (seen.has(name)) continue;
      // 打不开的（坏软链 / 没权限）直接跳过 —— 列出来点不动才是真的烦
      try { if (!statSync(full).isDirectory()) continue; } catch { continue; }
      seen.add(name);
      // ⚠️⚠️ **同一台手机不列两个**。读者 2026-10-11：
      //    「**手机现在有两个**你合并，你要合并都是**用 ADB 的，不需要 andromeld 这个**」。
      //    AndroMeld 是 ADB 的前端 —— 我们**自己就是走 ADB 的**（`src/sources/adbfs.ts`），
      //    它在这儿只是一条绕远路的重复项：列出来用户会以为"还要再接一次手机"。
      //    ⚠️ 这不是"静默吞掉"：是**明确不要它**（他要的就是一台手机），
      //       而且日志里会说一声，免得下次有人问"AndroMeld 跑哪去了"。
      if (EXCLUDE.some((re) => re.test(name))) {
        console.log(`[apps] 跳过 ${name}（和「手机」是同一双手，我们直接用 ADB）`);
        continue;
      }
      const known = KNOWN.find(([re]) => re.test(name))?.[1];
      apps.push({ name, path: full, known, group: groupOf(name) });
      if (apps.length >= limit) return { apps: sorted(apps), scanned };
    }
  }
  return { apps: sorted(apps), scanned };
}

/** 我们自己排一下：有归属的（已接过的）沉到底 —— 上面留给"还没接的"。 */
function sorted(apps: AppInfo[]): AppInfo[] {
  return apps.sort((a, b) => (a.known ? 1 : 0) - (b.known ? 1 : 0) || a.name.localeCompare(b.name, 'zh'));
}

// ── 每天自己重扫一遍 ────────────────────────────────────────
/**
 * ⭐⭐ 读者 2026-10-10：「软件获取能力也应该是**跟着每天更新一下获取一遍用户的电脑**，
 *    而不是写死的」。
 *
 * ⚠️⚠️ 为什么"每次现扫"不算解决了：现扫一次要 100ms+，而**"这个功能能不能做"
 *    这件事应该在打开界面之前就有答案**（推荐功能要按它来算）。所以是**缓存 + 每天过期**，
 *    不是"每次现扫"、也不是"写死一份"。
 * ⚠️ 过期判据是 **24 小时**（按 `scannedAt` 算），不是"进程启动时扫一次"——
 *    这个服务常年开着，进程级缓存等于永远不更新（装了个新软件它一辈子看不见）。
 * ⚠️ 缓存永远是**有就用、坏就重扫**：读不出来（文件被删/写坏）不该让整个界面打不开。
 */
export interface AppsSnapshot { apps: AppInfo[]; scanned: string[]; scannedAt: number; fromCache: boolean }
const DAY = 24 * 3600 * 1000;
/**
 * ⚠️⚠️ **改了扫描规则就必须动这个数**。
 *    缓存是"24 小时内直接用"，规则改了但版本没动 ⇒ 用户**一整天都看不到改动**，
 *    而且看不出来是缓存（表现像"这个改动没生效"）。
 */
const CACHE_V = 2;

export function cachedApps(dataDir: string, opts: { force?: boolean } = {}): AppsSnapshot {
  const file = join(dataDir, 'apps-cache.json');
  const now = Date.now();
  if (!opts.force && existsSync(file)) {
    try {
      const j = JSON.parse(readFileSync(file, 'utf8'));
      // ⚠️ 判据是「**它真的是一份应用清单**」不是「JSON.parse 没抛」
      if (Array.isArray(j?.apps) && j?.v === CACHE_V && typeof j?.scannedAt === 'number' && now - j.scannedAt < DAY) {
        return { apps: j.apps, scanned: Array.isArray(j.scanned) ? j.scanned : [], scannedAt: j.scannedAt, fromCache: true };
      }
    } catch { /* 坏文件当作没有，下面重扫 */ }
  }
  const r = scanApps();
  const snap: AppsSnapshot & { v: number } = { apps: r.apps, scanned: r.scanned, scannedAt: now, fromCache: false, v: CACHE_V };
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(snap), 'utf8');
    renameSync(`${file}.tmp`, file);   // 原子替换：写一半崩了不会留半截 JSON
  } catch { /* 存不下去也不该让这次扫描白扫 */ }
  return snap;
}
