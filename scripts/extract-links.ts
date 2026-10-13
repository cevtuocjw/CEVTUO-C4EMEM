/**
 * 链接提取与归类。
 *
 * 用户的诉求：「很多只是粘贴的链接 / mention url / bookmark，
 * 你需要分析它们是什么样的链接、想明白我为什么加它们、应该归到哪一类」。
 *
 * 分两步，先做**便宜且确定**的那一步：
 *   ① 把所有 URL 抠出来，连同**它周围的上下文**（人为什么记它，答案就在上下文里）
 *   ② 按域名聚合成表 —— 这一步零成本，而且立刻能看出大头在哪
 * 然后才去补需要联网的那一步（抓标题）和需要 LLM 的那一步（归类）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config';
import { openDb } from '../src/store/db';

const cfg = loadConfig();
const db = openDb(cfg.dataDir);
const outDir = join(process.cwd(), 'out');
mkdirSync(outDir, { recursive: true });

const URL_RE = /https?:\/\/[^\s<>"'）)】\]]+/g;

export interface LinkRec {
  url: string;
  domain: string;
  space: string;
  date: string;
  /** 这一行（去掉 URL 本身） */
  line: string;
  /** 上一行 —— 常常是"我为什么记它" */
  prev: string;
}

const docs = db
  .query<{ space: string; date: string; text: string }, []>(
    'SELECT space, date, text FROM docs ORDER BY date',
  )
  .all();

const links: LinkRec[] = [];
for (const d of docs) {
  const lines = d.text.split('\n');
  lines.forEach((raw, i) => {
    const found = raw.match(URL_RE);
    if (!found) return;
    for (const u of found) {
      let domain = '';
      try {
        domain = new URL(u).hostname.replace(/^www\./, '');
      } catch {
        continue;
      }
      links.push({
        url: u,
        domain,
        space: d.space,
        date: d.date,
        line: raw.replace(URL_RE, '').replace(/\s+/g, ' ').replace(/^\[链接\]\s*/, '').trim().slice(0, 200),
        prev: (lines[i - 1] ?? '').replace(URL_RE, '').replace(/\s+/g, ' ').trim().slice(0, 200),
      });
    }
  });
}

// 去重（同一 URL 多次出现只留第一次，但计数）
const byUrl = new Map<string, LinkRec & { count: number }>();
for (const l of links) {
  const e = byUrl.get(l.url);
  if (e) e.count += 1;
  else byUrl.set(l.url, { ...l, count: 1 });
}
const uniq = [...byUrl.values()];

const byDomain = new Map<string, { count: number; urlCount: number; samples: string[] }>();
for (const l of uniq) {
  const e = byDomain.get(l.domain) ?? { count: 0, urlCount: 0, samples: [] };
  e.count += l.count;
  e.urlCount += 1;
  if (e.samples.length < 3) e.samples.push(l.url);
  byDomain.set(l.domain, e);
}

const domains = [...byDomain.entries()]
  .map(([domain, v]) => ({ domain, ...v }))
  .sort((a, b) => b.urlCount - a.urlCount);

writeFileSync(
  join(outDir, 'links.json'),
  JSON.stringify({ totalLinks: links.length, uniqueUrls: uniq.length, domains: domains.length, links: uniq, domainTable: domains }, null, 2),
  'utf8',
);

console.log(`共 ${links.length} 条链接出现 · 去重后 ${uniq.length} 个 URL · ${domains.length} 个域名\n`);
console.log('域名 Top 30：');
for (const d of domains.slice(0, 30)) {
  console.log(`  ${String(d.urlCount).padStart(4)}  ${d.domain}`);
}
console.log('\n长尾：只出现 1 次的域名有', domains.filter((d) => d.urlCount === 1).length, '个');
