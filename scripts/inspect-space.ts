/**
 * 诊断：一个 Notion 源的树到底长什么样。
 *
 * 起因：sync 只抽出 16 段、跨度 5 周，而 FACT 里记着 Learn 有 ~7121 个子块。
 * 说明**大部分内容没被走到**，先看清楚树形再改代码 —— 不要瞎猜。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NotionClient } from '../src/notion/client';

const cfg = JSON.parse(readFileSync(join(process.cwd(), 'c4emem.config.json'), 'utf8'));
for (const f of cfg.envFiles ?? []) {
  for (const raw of readFileSync(f.replace('~', homedir()), 'utf8').split('\n')) {
    const s = raw.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i > 0) process.env[s.slice(0, i).trim()] ||= s.slice(i + 1).trim();
  }
}

const target = process.argv[2] ?? 'learn';
const space = cfg.notion.spaces.find((s: any) => s.key === target);
if (!space) throw new Error(`没有这个源：${target}`);

const client = new NotionClient(process.env[cfg.notion.apiKeyEnv], cfg.notion.version, cfg.notion.minGapMs);
const types = new Map<string, number>();
const childPages: string[] = [];
const childDbs: string[] = [];
let maxDepth = 0;
let total = 0;
let dateMarkers = 0;

// ⚠️ child_database 的 title 是**字符串**不是富文本数组 —— 不判 Array 会炸。
const richOf = (b: any) => {
  const raw = b[b.type]?.rich_text ?? b[b.type]?.title ?? [];
  return Array.isArray(raw) ? raw : [];
};
const textOf = (b: any) =>
  richOf(b).map((r: any) => r.plain_text ?? '').join('').trim() ||
  (typeof b[b.type]?.title === 'string' ? b[b.type].title : '');

async function walk(id: string, depth: number) {
  if (depth > 15) return;
  maxDepth = Math.max(maxDepth, depth);
  let kids: any[];
  try {
    kids = await client.children(id);
  } catch (e) {
    console.log(`  ! ${depth} 层读不动：${(e as Error).message}`);
    return;
  }
  for (const b of kids) {
    total += 1;
    types.set(b.type, (types.get(b.type) ?? 0) + 1);
    if (b.type === 'child_page') childPages.push(`${'  '.repeat(depth)}└ ${textOf(b)}`);
    if (b.type === 'child_database') childDbs.push(textOf(b));
    for (const r of richOf(b) ?? []) {
      if (r?.type === 'mention' && r.mention?.type === 'date') dateMarkers += 1;
    }
    // ⚠️ 这里**故意**连 child_page 也下去 —— 就是要看它里面有什么。
    if (b.has_children) await walk(b.id, depth + 1);
  }
}

console.log(`▸ ${space.label}（${space.pageId}）`);
await walk(space.pageId, 0);

console.log(`\n块总数 ${total} · 最大深度 ${maxDepth} · 日期 mention ${dateMarkers} · 请求 ${client.calls}`);
console.log('\n块类型分布（前 20）：');
[...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([t, n]) => console.log(`  ${t.padEnd(24)} ${n}`));
console.log(`\nchild_page（子页面）共 ${childPages.length} 个：`);
childPages.slice(0, 25).forEach((t) => console.log('  ' + t));
if (childPages.length > 25) console.log(`  … 还有 ${childPages.length - 25} 个`);
console.log(`\nchild_database 共 ${childDbs.length} 个：${childDbs.join(', ') || '（无）'}`);
