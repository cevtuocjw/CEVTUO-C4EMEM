/**
 * 给每个域名抓一个标题 —— 这才是"这个链接到底是什么"的权威答案。
 *
 * 光看域名判不出来：`studio-xyz.com` 是设计工作室还是五金店？
 * 标题（`Studio XYZ — Brand & Web Design`）一看就明白。
 *
 * 设计要点：
 *   · **边抓边存盘**（每批写一次）—— 中断了也不用从头再来
 *   · 有缓存就跳过 —— 重跑几乎不花时间
 *   · 并发 + 超时 + 单域名失败不影响整体
 *   · ⚠️ 国内网络下会有一批抓不到（Instagram / Medium 等）；**失败要如实记下**，
 *     不能当成"没有标题"
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const outDir = join(process.cwd(), 'out');
const links = JSON.parse(readFileSync(join(outDir, 'links.json'), 'utf8'));
const cachePath = join(outDir, 'link-titles.json');

type Rec = { domain: string; title: string; ok: boolean; note?: string };
const cache: Record<string, Rec> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};

const targets: string[] = links.domainTable
  .map((d: any) => d.domain)
  .filter((d: string) => !cache[d]);

const CONC = 24;
const TIMEOUT = 8000;
console.log(`域名 ${links.domainTable.length} 个，待抓 ${targets.length} 个（已有缓存 ${Object.keys(cache).length}）`);

async function fetchTitle(domain: string): Promise<Rec> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const res = await fetch(`https://${domain}/`, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36' },
    });
    const html = await res.text();
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = (m?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
    return { domain, title, ok: Boolean(title), note: title ? undefined : 'no <title>' };
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message.slice(0, 60);
    return { domain, title: '', ok: false, note: msg };
  } finally {
    clearTimeout(t);
  }
}

let done = 0;
let cursor = 0;
async function worker() {
  while (cursor < targets.length) {
    const d = targets[cursor++];
    cache[d] = await fetchTitle(d);
    done += 1;
    if (done % 100 === 0) {
      writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
      const okN = Object.values(cache).filter((r) => r.ok).length;
      console.log(`  … ${done}/${targets.length}（成功 ${okN}）`);
    }
  }
}

await Promise.all(Array.from({ length: CONC }, worker));
writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');

const all = Object.values(cache);
const ok = all.filter((r) => r.ok);
console.log(`\n✅ 抓完 ${all.length} 个域名：成功 ${ok.length}，失败 ${all.length - ok.length}`);
console.log('\n标题抽样 25 个（看它到底是不是"好看的前端"那类）：');
for (const r of ok.filter((x) => x.title.length > 6).slice(0, 25)) {
  console.log(`  ${r.domain.padEnd(30).slice(0, 30)} ${r.title.slice(0, 70)}`);
}
