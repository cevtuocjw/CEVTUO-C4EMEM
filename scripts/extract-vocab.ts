/**
 * 词条 / 单词提炼（用户点名的 B）。
 *
 * 为什么单独做：词条文本**太短**，在 1024 维向量里区分度弱，
 * 聚类时被长文笔记的语义盖过去了 —— 实测它们散在「学习笔记杂录 52」里看不见。
 * 所以这一遍不靠向量，靠**结构**：中英对照的书写习惯是有格式的。
 *
 * 认得的几种写法（都来自真实笔记）：
 *   a plum job = 一份令人羡慕的好工作
 *   - with an extravaganza. 盛会
 *   - Til you see the decor and you peep the decorum直到你看到装饰，窥视礼仪
 *   crappy things 糟糕的事情
 *   El Niño 气候现象
 *
 * ⚠️ 宁可漏，不可错：误报会把整段叙述性英文都当成词条。
 *    所以每条都打过质量分，低分的丢掉，并且**输出时保留原文行**便于人复核。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config';
import { openDb } from '../src/store/db';

const cfg = loadConfig();
const db = openDb(cfg.dataDir);
const outDir = join(process.cwd(), 'out');
mkdirSync(outDir, { recursive: true });

const CJK = /[一-鿿]/;
const cjkCount = (s: string) => (s.match(/[一-鿿]/g) ?? []).length;
const latCount = (s: string) => (s.match(/[A-Za-z]/g) ?? []).length;
const isMostlyCJK = (s: string) => cjkCount(s) >= 2 && cjkCount(s) > latCount(s);
const isMostlyLatin = (s: string) => latCount(s) >= 3 && latCount(s) > cjkCount(s);

export interface Entry {
  en: string;
  zh: string;
  date: string;
  space: string;
  line: string;
  kind: string;
}

function stripDecor(l: string): string {
  return l
    .replace(/^[\s>*\-–—•·]+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function candidatesFromLine(line: string): { en: string; zh: string; kind: string; score: number }[] {
  const out: { en: string; zh: string; kind: string; score: number }[] = [];
  const l = stripDecor(line);
  if (!l || l.length > 200) return out;
  if (CJK.test(l) === false) return out; // 没有中文，不可能是中英对照

  // ① `英文 = 中文` / `中文 = 英文` / 冒号版
  const mSep = l.match(/^(.{2,70}?)\s*[=＝]\s*(.{2,70})$/);
  if (mSep) {
    const [, a, b] = mSep;
    if (isMostlyLatin(a) && isMostlyCJK(b)) out.push({ en: a, zh: b, kind: '等式', score: 3 });
    else if (isMostlyCJK(a) && isMostlyLatin(b)) out.push({ en: b, zh: a, kind: '等式', score: 3 });
  }

  // ② 英文紧跟中文（无分隔符）—— 最常见的写法
  //    `crappy things 糟糕的事情`
  const mAdj = l.match(/^([A-Za-z][A-Za-z0-9\s'’.,\-–()/&]{1,70}?)\s*([一-鿿][\s\S]{0,60})$/);
  if (mAdj) {
    const en = mAdj[1].trim();
    const zh = mAdj[2].trim();
    const words = en.split(/\s+/).filter(Boolean);
    // 英文部分必须像"词或短语"：不超过 8 个词、不含句末标点
    if (words.length <= 8 && !/[.!?]$/.test(en) && latCount(en) >= 3) {
      out.push({ en, zh, kind: '紧邻', score: words.length <= 4 ? 3 : 2 });
    }
  }

  // ③ 中文紧跟英文
  const mAdj2 = l.match(/^([一-鿿][\s\S]{1,40}?)\s*([A-Za-z][A-Za-z0-9\s'’.,\-–]{2,60})$/);
  if (mAdj2) {
    const zh = mAdj2[1].trim();
    const en = mAdj2[2].trim();
    if (en.split(/\s+/).length <= 8 && latCount(en) >= 3) {
      out.push({ en, zh, kind: '紧邻', score: 2 });
    }
  }

  // ④ `英文：中文` / `英文-中文`
  const mColon = l.match(/^([A-Za-z][A-Za-z0-9\s'’.,\-–()/&]{1,60}?)\s*[:：\-–]\s*([一-鿿][\s\S]{0,60})$/);
  if (mColon) {
    const en = mColon[1].trim();
    if (en.split(/\s+/).length <= 6) out.push({ en, zh: mColon[2].trim(), kind: '冒号', score: 2 });
  }

  return out;
}

/**
 * 质量闸门 —— 第一遍没过滤，1080 条里抽样一看**大约一半是误报**：
 *   `Acronym → 最无可替代的品牌图腾`（英文是品牌名，中文是后文的碎片）
 *   `Adobe → 破解`、`AI Agent → 千问 Qoder：`
 * 特征很一致：**中文那一侧是整句话**，或者**中文里还夹着成串英文**。
 * ⇒ 词条的中文侧应当短、干净、不含句末标点、不含长英文串。
 */
function accept(e: { en: string; zh: string; kind: string; score: number }): boolean {
  const zh = e.zh;
  const en = e.en;
  if (e.score < 2) return false;
  if (zh.length > 24 || en.length > 48) return false;
  if (/[。；;！!？?]/.test(zh)) return false; // 句末标点 = 多半是散文
  if (/[：:]/.test(zh)) return false; // 中文侧带冒号 = 多半是"标签：解释"
  if (/http/i.test(en) || /http/i.test(zh)) return false;
  if (/^\[链接\]/.test(en)) return false;
  if (/[A-Za-z]{3,}/.test(zh)) return false; // 中文里还夹长英文串 → 不是对照
  if (en.split(/\s+/).length > 6) return false;
  if (zh.split(/\s+/).filter(Boolean).length > 8) return false;
  return true;
}

const docs = db
  .query<{ id: string; space: string; date: string; text: string }, []>(
    'SELECT id, space, date, text FROM docs',
  )
  .all();

const entries: Entry[] = [];
const seen = new Set<string>();
let scanned = 0;

for (const d of docs) {
  for (const raw of d.text.split('\n')) {
    scanned += 1;
    const line = raw.trim();
    if (!line) continue;
    for (const c of candidatesFromLine(line)) {
      if (!accept(c)) continue;
      // 归一化去重
      const key = `${c.en.toLowerCase().replace(/[^a-z0-9]/g, '')}|${c.zh.replace(/\s/g, '')}`;
      if (key.length < 6) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        en: c.en.replace(/\s+/g, ' ').trim(),
        zh: c.zh.replace(/\s+/g, ' ').trim(),
        date: d.date,
        space: d.space,
        line: line.slice(0, 200),
        kind: c.kind,
      });
    }
  }
}

entries.sort((a, b) => (a.en.toLowerCase() < b.en.toLowerCase() ? -1 : 1));

writeFileSync(join(outDir, 'vocab.json'), JSON.stringify({ total: entries.length, scannedLines: scanned, entries }, null, 2), 'utf8');

// 文字版
const md: string[] = [];
md.push('# C4emem 词条 / 单词提炼');
md.push('');
md.push(`> 扫描 ${scanned} 行，提出 **${entries.length}** 条中英对照（已去重）`);
md.push('');
md.push('| 英文 | 中文 | 出处 | 日期 |');
md.push('|---|---|---|---|');
for (const e of entries.slice(0, 400)) {
  md.push(`| ${e.en.replace(/\|/g, '\\|')} | ${e.zh.replace(/\|/g, '\\|')} | ${e.space} | ${e.date} |`);
}
if (entries.length > 400) md.push(`\n… 还有 ${entries.length - 400} 条，见 vocab.json`);
writeFileSync(join(outDir, 'vocab.md'), md.join('\n'), 'utf8');

console.log(`扫描 ${scanned} 行 → 提出 ${entries.length} 条词条`);
// ⚠️ 抽样要**均匀撒开**，不能取前 25 条 —— 按字母排序时前 25 条全是 "a" 开头，
//    那样复核等于只看了一个字母，看不到后面的质量。
console.log('\n均匀抽样 24 条（人工复核用）：');
const step = Math.max(1, Math.floor(entries.length / 24));
for (let i = 0; i < entries.length; i += step) {
  const e = entries[i];
  console.log(`  ${e.en.slice(0, 40).padEnd(42)} ${e.zh.slice(0, 26)}   [${e.space} ${e.date}]`);
}
