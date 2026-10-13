/**
 * Notion 页面 → 文档。按 `@日期` 切段，**全量**，不截窗口。
 *
 * 和 CEVTUO-Z 的 cnsr-extract.mjs 的关键区别：
 *   · 那边是给网页看的「最近 5 天、每天最多 10 行」—— 是给眼睛的；
 *   · 这边是给检索用的**全部内容**—— 少一天就是少一段记忆。
 *
 * `@日期` 的语义（沿用用户既有的约定）：日期是一个**分隔符**，不是容器标题。
 * 一个日期标记一个点，它之后的内容属于它，直到下一个日期。
 */
import type { NotionBlock, NotionClient } from './client';
import type { SpaceConfig } from '../config';

export interface Doc {
  id: string;
  space: string;
  date: string;
  title: string;
  text: string;
  url: string;
  /** 行数，用来判断这一段是不是空壳。 */
  lines: number;
}

/**
 * ⚠️ 只把 child_database 当「另一个对象」—— **child_page 必须下去**。
 *
 * 这是踩过的坑，写在最显眼的地方：
 * 第一版 sync 只抽出 16 段、跨度 5 周，而这一页**实际有 7297 个块**。
 * 根因就是子页面被当成"别的对象"跳过（`SEPARATE_OBJECT` 里带着 child_page），
 * 而内容的大头恰恰在子页面里 —— 一个整本的 Gutenberg 电子书、`BF相关`、
 * `f1schedule2025`、`飞秒 半飞秒`……
 *
 * 教训：CEVTUO-Z 那边跳过 child_page 是对的（它只要主页面最近 5 天），
 * 但「照抄一个正确的实现到另一个目的下」正是出错的来源。
 */
const SEPARATE_OBJECT = new Set(['child_database']);
const IGNORED = new Set(['table_of_contents', 'breadcrumb', 'divider', 'unsupported', 'synced_block']);

const richOf = (b: NotionBlock): any[] => {
  const raw = b[b.type]?.rich_text ?? b[b.type]?.title ?? [];
  return Array.isArray(raw) ? raw : [];
};

/** ⚠️ child_page / child_database 的 `title` 是**字符串**，不是富文本数组 —— 不判会崩。 */
const textOf = (b: NotionBlock): string => {
  const fromRich = richOf(b)
    .map((r: any) => r.plain_text ?? '')
    .join('')
    .trim();
  if (fromRich) return fromRich;
  const raw = b[b.type]?.title;
  return typeof raw === 'string' ? raw.trim() : '';
};

/** 从块里找日期 —— 优先 Notion 的 date mention，退回文本里的 `23.10.11` 式写法。 */
export function dateOf(b: NotionBlock): { date: string; rendered: string } | null {
  for (const r of richOf(b)) {
    if (r?.type === 'mention' && r.mention?.type === 'date' && r.mention.date?.start) {
      return { date: String(r.mention.date.start).slice(0, 10), rendered: r.plain_text ?? '' };
    }
  }
  const t = textOf(b);
  // 「-23.10.11」「2023-10-11」「2023/10/11」都认
  const m =
    t.match(/(?:^|[\s\-–—@|])(\d{4})[-./](\d{1,2})[-./](\d{1,2})/) ??
    t.match(/(?:^|[\s\-–—@|])(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})(?!\d)/);
  if (m) {
    const y = m[1].length === 4 ? m[1] : `20${m[1]}`;
    const yr = Number(y);
    // ⚠️ 必须卡年份范围。两段式写法（`45.2.8`）会把版本号、比分、编号认成日期，
    //    实测把时间轴拉到了 **2045-02-08** —— 而它混在 300 个真日期里，
    //    不做范围检查根本看不见。认不出就**不当日期**（内容仍留在上一段，不会丢）。
    const maxYear = new Date().getFullYear() + 1;
    if (yr < 2000 || yr > maxYear) return null;
    const iso = `${y}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if (!Number.isNaN(Date.parse(iso))) return { date: iso, rendered: m[0].trim() };
  }
  return null;
}

/** 一个块渲染成一行文本（带一点结构提示，但不要变成 markdown 生成器）。 */
function lineOf(b: NotionBlock): string {
  const t = textOf(b);
  // 子页面：标题本身是内容的一部分，进正文；随后 walk 会下去收它里面
  if (b.type === 'child_page') return t ? `【子页面】${t}` : '';
  // 图片：保留 alt / caption，正文不保留 URL（Notion 的 S3 链接一小时后失效）
  if (b.type === 'image') {
    const cap = textOf(b);
    return cap ? `[图片] ${cap}` : '';
  }
  if (b.type === 'bookmark' || b.type === 'link_preview' || b.type === 'embed') {
    const url = b[b.type]?.url ?? '';
    const cap = textOf(b);
    return cap ? `[链接] ${cap}` : url ? `[链接] ${url}` : '';
  }
  if (!t) return '';
  switch (b.type) {
    case 'heading_1': return `# ${t}`;
    case 'heading_2': return `## ${t}`;
    case 'heading_3': return `### ${t}`;
    case 'bulleted_list_item':
    case 'numbered_list_item':
    case 'to_do': return `- ${t}`;
    case 'quote': return `> ${t}`;
    case 'code': return `\`\`\`\n${t}\n\`\`\``;
    case 'callout': return `> ${t}`;
    default: return t;
  }
}

export interface ExtractResult {
  docs: Doc[];
  skipped: number;
  calls: number;
  /** 走到的块数 —— 用来和 inspect-space 的块总数对账。对不上就是走漏了。 */
  visited: number;
  /** 每个深度各走了多少块，走漏时一眼看出停在哪一层。 */
  byDepth: Record<number, number>;
}

/**
 * 正序深度优先走完整棵树，边收边切段。
 *
 * ⚠️ 为什么是正序（而 cnsr 那边是倒序）：那边要「最近 5 天」所以从最新的
 *    开始读、读够就停；这边要**全部**，倒序只会让文档顺序乱掉。
 */
export async function extractSpace(
  client: NotionClient,
  space: SpaceConfig,
  opts: { skipTitles: RegExp | null; maxDepth: number; log?: (m: string) => void },
): Promise<ExtractResult> {
  const log = opts.log ?? (() => {});
  const docs: Doc[] = [];
  let skipped = 0;
  let visited = 0;
  const byDepth: Record<number, number> = {};

  let seg = { date: '', title: '', lines: [] as string[], blockId: space.pageId };
  let seq = 0;

  const flush = () => {
    const lines = seg.lines.filter(Boolean);
    if (!lines.length) return;
    docs.push({
      id: `${space.key}:${seg.date || 'undated'}:${String(seq++).padStart(3, '0')}`,
      space: space.key,
      date: seg.date || '0000-00-00',
      title: seg.title,
      text: lines.join('\n'),
      url: `https://www.notion.so/${seg.blockId.replace(/-/g, '')}`,
      lines: lines.length,
    });
  };

  async function walk(blockId: string, depth: number): Promise<void> {
    if (depth > opts.maxDepth) return;
    let children: NotionBlock[];
    try {
      children = await client.children(blockId);
    } catch (e) {
      log(`  ! 跳过 ${blockId.slice(0, 8)}…：${(e as Error).message}`);
      return;
    }

    for (const b of children) {
      visited += 1;
      byDepth[depth] = (byDepth[depth] ?? 0) + 1;
      const title = textOf(b);
      if (opts.skipTitles?.test(title)) {
        skipped += 1;
        // ⚠️ 一定要把「跳了什么、它有多大」打出来。跳过一整棵子树是**静默**的：
        // 数字小了你只会以为"内容本来就少"，而真因是被这里吃掉的。
        log(
          `  · 跳过【${b.type}】${JSON.stringify(title.slice(0, 60))}` +
            (b.has_children ? ' ⚠️它带子树' : ''),
        );
        continue; // 整棵子树，不只是这个块
      }

      const marker = dateOf(b);
      if (marker) {
        // 日期块可能自己带标题（"@2026-10-04 周二"）也可能只是个光秃秃的日期
        const rest = title.replace(marker.rendered, '').replace(/^[\s\-–—:：|@]+/, '').trim();
        flush();
        seg = { date: marker.date, title: rest, lines: [], blockId: b.id };
        // 日期块自己若还有正文，也算这一天的第一行
        const own = lineOf(b);
        const ownClean = own.replace(marker.rendered, '').replace(/^[\s\-–—:：|@]+/, '').trim();
        if (ownClean) seg.lines.push(ownClean);
      } else if (!IGNORED.has(b.type)) {
        const line = lineOf(b);
        if (line) seg.lines.push(line);
      }

      if (b.has_children && !SEPARATE_OBJECT.has(b.type)) {
        await walk(b.id, depth + 1);
      }
    }
  }

  await walk(space.pageId, 0);
  flush();

  return { docs, skipped, calls: client.calls, visited, byDepth };
}
