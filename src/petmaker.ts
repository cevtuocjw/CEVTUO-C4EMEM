/**
 * **一起造一只新的 Pet** —— 读者 2026-10-13：
 *   「我希望的是**我给你一个链接你对话跟我然后我们一起制作好一个新的 pet**」
 *   「你现在的只有一个 card pet，你的切换呢，你需要能切换珍珠铅等，都拿过来」
 *
 * ⚠️⚠️ 判据**不是"生成了"**，是**"它真的没有背景、而且真的装上了"** ——
 *    所以这里的每一步都回**真数**（原图多大、主体占多少、抠掉了多少），
 *    而不是一个"已完成"。
 *
 * ⚠️⚠️ **抠图必须在浏览器里做**（canvas），本机**没有任何 PNG 编解码器**
 *    （pngjs / sharp / jimp 都没有）。所以这个文件只做三件事：
 *      ① 把一个**网页**里有什么图/视频列出来（供用户挑）
 *      ② 把挑中的那张图**取回来**（以 `data:` URL 交出去 —— ⚠️ 跨域图直接喂 canvas 会
 *         污染画布，`getImageData` 会抛 SecurityError；`data:` 不会）
 *      ③ 把浏览器抠好的结果**存下来并登记成一个形态**
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface MadePet { id: string; nm: string; file: string; w: number; h: number; cover: number; ts: string; from: string }

const dirOf = (dataDir: string) => join(dataDir, 'pets');
const regOf = (dataDir: string) => join(dataDir, 'pets.json');

export function loadPets(dataDir: string): { items: MadePet[]; removed: string[] } {
  const p = regOf(dataDir);
  if (!existsSync(p)) return { items: [], removed: [] };
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return { items: Array.isArray(j?.items) ? j.items : [], removed: Array.isArray(j?.removed) ? j.removed : [] };
  } catch {
    // ⚠️ 坏文件**不装作没有**（照这个项目的老规矩：留档再说）
    try { renameSync(p, `${p}.bad-${Date.now()}`); } catch { /* 留档失败也不能当成空表 */ }
    return { items: [], removed: [] };
  }
}

function saveReg(dataDir: string, s: { items: MadePet[]; removed: string[] }) {
  mkdirSync(dataDir, { recursive: true });
  const p = regOf(dataDir);
  writeFileSync(`${p}.tmp`, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
  renameSync(`${p}.tmp`, p);
}

const slug = (s: string) => {
  const a = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  return a || `pet-${Math.random().toString(36).slice(2, 7)}`;
};

/**
 * 把浏览器抠好的一张图存成一个形态。
 * ⚠️ `cover`（主体占画布的比例）**要一起存** —— 它是"抠过头了没有"的唯一现成判据。
 */
export function savePet(dataDir: string, body: { name?: string; dataUrl?: string; cover?: number; w?: number; h?: number; from?: string }) {
  const name = String(body.name || '').trim().slice(0, 24);
  if (!name) return { ok: false as const, error: '先给它起个名字' };
  const m = String(body.dataUrl || '').match(/^data:image\/png;base64,(.+)$/);
  if (!m) return { ok: false as const, error: '图不对 —— 只收抠好底的 PNG' };
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 400) return { ok: false as const, error: `这张图太小了（${buf.length} 字节）—— 多半是抠空了` };
  if (buf.length > 6 * 1024 * 1024) return { ok: false as const, error: '图太大了（超过 6MB）—— 先缩小一点' };

  const dir = dirOf(dataDir);
  mkdirSync(dir, { recursive: true });
  // ⚠️ id 撞了就加个后缀 —— **不要覆盖**：那会让用户"又做了一只、上一只没了"，
  //    而且**没有任何提示**（这个项目栽过同形状的）。
  let id = slug(name);
  const reg = loadPets(dataDir);
  let n = 1;
  while (reg.items.some((x) => x.id === id)) id = `${slug(name)}-${++n}`;

  const file = join(dir, `${id}.png`);
  writeFileSync(file, buf);
  const item: MadePet = {
    id, nm: name, file, w: Number(body.w || 0), h: Number(body.h || 0),
    cover: Number(body.cover || 0), ts: new Date().toISOString(), from: String(body.from || ''),
  };
  reg.items.unshift(item);
  reg.removed = reg.removed.filter((x) => x !== id);
  saveReg(dataDir, reg);
  return { ok: true as const, item };
}

export function removePet(dataDir: string, id: string) {
  const reg = loadPets(dataDir);
  const it = reg.items.find((x) => x.id === id);
  if (!it) return { ok: false as const, error: '没有这只' };
  reg.items = reg.items.filter((x) => x.id !== id);
  if (!reg.removed.includes(id)) reg.removed.push(id);
  saveReg(dataDir, reg);
  try { rmSync(it.file, { force: true }); } catch { /* 文件删不掉也别把登记回滚 */ }
  return { ok: true as const };
}

/**
 * 抓一个网页，把它**有的图/视频**列出来。
 * ⚠️ 只列**页面 HTML 里真的写了的**（`<img src>` / `<video src|poster>` / `og:image`）——
 *    不执行 JS，所以纯前端渲染的站会列得很空。
 *    ⇒ 那种情况要**如实说"这个页面里我没找到图"**，而不是回一个空数组让人对着空白猜。
 */
export async function probeUrl(url: string) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (cevtuo-pet maker)' }, redirect: 'follow' });
    if (!r.ok) return { ok: false as const, error: `抓不到（HTTP ${r.status}）` };
    const html = await r.text();
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url).trim().slice(0, 120);
    const base = r.url || url;
    const abs = (u: string) => { try { return new URL(u, base).href; } catch { return ''; } };
    const seen = new Set<string>();
    const out: { url: string; kind: 'image' | 'video'; w?: number; h?: number }[] = [];
    const push = (u: string, kind: 'image' | 'video') => {
      const a = abs(u);
      if (!a || seen.has(a)) return;
      if (!/^https?:/i.test(a)) return;
      seen.add(a);
      out.push({ url: a, kind });
    };
    for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) push(m[1], 'image');
    for (const m of html.matchAll(/<video[^>]+(?:src|poster)=["']([^"']+)["']/gi)) push(m[1], 'video');
    for (const m of html.matchAll(/<source[^>]+src=["']([^"']+)["']/gi)) push(m[1], 'image');
    for (const m of html.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi)) push(m[1], 'image');
    // ⚠️ 顺手把 svg 排除掉 —— 它们是图标，不是"外观"
    const items = out.filter((x) => !/\.svg(\?|$)/i.test(x.url)).slice(0, 60);
    return { ok: true as const, title, url: base, items, total: out.length };
  } catch (e) {
    // ⚠️ 网络错误**照原样带出去**（只回 null 让人对着空白猜，是 FACT 里记过的那条）
    return { ok: false as const, error: `抓取失败：${String(e).slice(0, 140)}` };
  }
}

/**
 * 把一张**远程图**取回来，以 `data:` URL 交出去。
 *
 * ⚠️⚠️ 为什么非要绕这一圈：跨域图直接 `img.src = 'https://…'` 再 `getImageData`
 *    会 **污染画布**，抛 `SecurityError: tainted canvases`。而 `data:` URL **不会**。
 *    实测踩过（C4emoto 那次）。⇒ 服务端取、转 data URL、交给页面。
 */
export async function fetchImage(url: string) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (cevtuo-pet maker)' }, redirect: 'follow' });
    if (!r.ok) return { ok: false as const, error: `取不到（HTTP ${r.status}）` };
    const type = r.headers.get('content-type') || '';
    if (!/^image\//.test(type)) return { ok: false as const, error: `这不是一张图（${type || '不知道类型'}）` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 12 * 1024 * 1024) return { ok: false as const, error: `图太大了（${(buf.length / 1048576).toFixed(1)}MB）` };
    if (buf.length < 200) return { ok: false as const, error: '这张图几乎是空的' };
    return { ok: true as const, dataUrl: `data:${type.split(';')[0]};base64,${buf.toString('base64')}`, bytes: buf.length, type };
  } catch (e) {
    return { ok: false as const, error: `取图失败：${String(e).slice(0, 140)}` };
  }
}
