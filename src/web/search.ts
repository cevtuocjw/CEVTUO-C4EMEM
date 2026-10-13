/**
 * 联网兜底：笔记里查不到的时候，去外面找。
 *
 * ⚠️ 为什么单开一个模块而不是塞进 retrieve：
 *    检索的输入输出是「向量 / 词频 / 分数」，而这里的输入输出是「别人的网页」——
 *    两者的**可信度完全不同**。混进同一条管线之后，答案里就分不出哪句是自己记的、
 *    哪句是网上抄的。所以这里的结果一律带 `via: 'web'`，界面上必须能看出来。
 *
 * ⚠️ 默认 provider 是 duckduckgo（免 key），但**国内直连多半打不通** ——
 *    所以它失败时抛错而不是返回空数组：空数组会让「网上没有」和「没连上」
 *    长得一模一样。要稳定就配 searxng（自己的实例）或 tavily（要 key）。
 */


export interface WebHit { title: string; url: string; snippet: string }
export interface WebCfg { provider: string; baseUrl?: string; apiKey?: string; maxPages: number }

/** ⚠️ Bun 的 fetch 没有超时 —— 不自己兜，一个卡住的站点能把整次回答挂死。 */
async function req(url: string, init: RequestInit = {}, ms = 12000): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

const decode = (s: string) =>
  s.replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/\s+/g, ' ').trim();

export function webCfg(settings: Record<string, any>): WebCfg {
  const w = settings.web ?? process.env;
  return {
    provider: String(w.provider || process.env.C4EMEM_WEB_PROVIDER || 'duckduckgo').toLowerCase(),
    baseUrl: w.baseUrl || process.env.C4EMEM_WEB_BASEURL || '',
    apiKey: w.apiKey || process.env.C4EMEM_WEB_KEY || '',
    maxPages: Number(w.maxPages ?? 3),
  };
}

export async function webSearch(q: string, c: WebCfg, n = 6): Promise<WebHit[]> {
  if (c.provider === 'searxng') {
    if (!c.baseUrl) throw new Error('searxng 没配实例地址（设置 → 联网兜底 → SearXNG 实例地址）');
    const r = await req(`${c.baseUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(q)}&format=json`, {}, 12000);
    if (!r.ok) throw new Error(`searxng 返回 ${r.status}`);
    const j = (await r.json()) as any;
    return ((j.results ?? []) as any[]).slice(0, n).map((x) => ({ title: String(x.title ?? ''), url: String(x.url ?? ''), snippet: decode(String(x.content ?? '')) }));
  }
  if (c.provider === 'tavily') {
    if (!c.apiKey) throw new Error('tavily 要 API Key（设置 → 联网兜底）');
    const r = await req('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: c.apiKey, query: q, max_results: n, search_depth: 'basic' }),
    }, 20000);
    if (!r.ok) throw new Error(`tavily 返回 ${r.status}`);
    const j = (await r.json()) as any;
    return ((j.results ?? []) as any[]).slice(0, n).map((x) => ({ title: String(x.title ?? ''), url: String(x.url ?? ''), snippet: decode(String(x.content ?? '')) }));
  }
  // duckduckgo
  const r = await req(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
  }, 12000);
  if (!r.ok) throw new Error(`duckduckgo 返回 ${r.status}`);
  const html = await r.text();
  const out: WebHit[] = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,900}?)(?=<a[^>]*class="result__a"|$)/g;
  for (const m of html.matchAll(re)) {
    let url = m[1];
    // DDG 把真实地址包在跳转里
    const u = /uddg=([^&]+)/.exec(url);
    if (u) { try { url = decodeURIComponent(u[1]); } catch {} }
    const sn = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(m[3]);
    out.push({ title: decode(m[2]), url, snippet: sn ? decode(sn[1]) : '' });
    if (out.length >= n) break;
  }
  if (!out.length) throw new Error('duckduckgo 没有解析出结果（多半是被挡了或者改版了）—— 换个 provider 试试');
  return out;
}

/** 抓正文。只取纯文本、截断 —— 这里是"看看人家怎么说"，不是建索引。 */
export async function fetchPage(url: string, cap = 4000): Promise<string> {
  try {
    const r = await req(url, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36' } }, 12000);
    if (!r.ok) return '';
    const ct = r.headers.get('content-type') || '';
    if (!/text\/html|text\/plain/.test(ct)) return '';
    const html = (await r.text()).replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ');
    return decode(html).slice(0, cap);
  } catch {
    return '';
  }
}
