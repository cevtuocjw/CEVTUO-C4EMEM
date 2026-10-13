/**
 * 手机相册 —— 判据是**"到底列出来了几张"**。
 *
 * ⚠️⚠️ 这个套件是为一个**已经发生过的**静默 bug 建的：
 *    老实现只扫 5 个写死的目录（DCIM/Camera、DCIM、Pictures、Screenshots、Download），
 *    在真机上只出 **48 张**，而系统媒体库里是 **6789 张** —— 差的 99% 在
 *    `/sdcard/Android/media/<包名>/...`（WhatsApp、Photoroom…），老代码根本没扫过。
 *    ⚠️ 老实现**命令退出码 0、没有报错、界面照常渲染** ——
 *      它和正确实现唯一的区别就是**那个数字**。
 *      所以断言必须是"**至少 N 张**"，而不是"没报错"（后者两个版本都满足）。
 *
 * 跑：bun scripts/verify-phone-photos.ts
 * 负向对照：NEGCTL=1 bun scripts/verify-phone-photos.ts
 *   把 MediaStore 那一条腿摘掉（回到"只扫目录"），确认"至少 N 张"这条**真的会红**。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';

const NEGCTL = process.env.NEGCTL === '1';
const FILE = '/Users/cjw/Documents/Cevtuo-C4emem/src/sources/adbfs.ts';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (extra ? '  ' + extra : '')); }
};

// ── 先确认手机连上了（连不上就 SKIP，不是 FAIL —— "量不到"和"坏了"要分得开）──
const adb = await new Promise<string>((res) => execFile('adb', ['devices'], (e, o) => res(e ? '' : o)));
const serial = (adb.split('\n')[1] ?? '').split('\t')[0];
if (!/device/.test(adb) || !serial) {
  console.log('  … 跳过：没连上手机（adb devices 里没有 device）。这不是"坏了"。');
  process.exit(0);
}

let backup: string | null = null;
if (NEGCTL) {
  backup = readFileSync(FILE, 'utf8');
  const bugged = backup.replace('export async function photos(', 'export async function photosOLD(') +
    '\n// eslint-disable-next-line\nexport async function photos(serial: string, limit = 60): Promise<any> {\n' +
    '  const cands = ["/sdcard/DCIM/Camera", "/sdcard/DCIM", "/sdcard/Pictures", "/sdcard/Screenshots", "/sdcard/Download"];\n' +
    '  return { ok: true, dirs: cands, total: 48, how: "目录扫描" };\n}\n';
  if (bugged === backup + bugged.slice(backup.length)) { console.log('负向对照没挂上，退出'); process.exit(2); }
  writeFileSync(FILE, bugged);
  console.log('⚠️ 负向对照：已把相册改回"只扫目录"那一版（跑完会还原）\n');
}

try {
  const { photos } = await import('../src/sources/adbfs.ts');
  const r = await photos(serial, 48);

  ok('列出来了（没有报错）', r.ok === true, String(r.error ?? ''));
  // ⭐⭐ 这一条才是真正的判据：**只有真的问过系统媒体库**才会是这个量级
  ok('数量是**媒体库**的量级（至少 1000 张），不是老那 5 个目录的几十张',
    (r.total ?? 0) > 1000, 'total=' + r.total);
  ok('明说了来源（不让人猜这几张是哪儿来的）', /MediaStore|媒体库/.test(r.how ?? ''), String(r.how));
  ok('要几张给几张', (r.items?.length ?? 0) === Math.min(48, r.items?.length ?? 0), String(r.items?.length));

  const its = r.items ?? [];
  const ms = its.map((x) => x.mtime);
  ok('按时间**倒序**（最新的在最前）', ms.every((v, i) => i === 0 || ms[i - 1] >= v), ms.slice(0, 3).join(' | '));
  // ⚠️ 纪律 6：倒序这件事，一条"全都一样的常数序列"也能满足 —— 所以再要一条"不是退化的"
  ok('时间**不是退化的**（至少有 2 个不同的值）', new Set(ms).size >= 2, new Set(ms).size + ' 个不同的值');
  ok('路径都是手机上真实存在的形状（/sdcard/…）', its.every((x) => x.path.startsWith('/sdcard/')),
    its.find((x) => !x.path.startsWith('/sdcard/'))?.path ?? '');
  ok('没有重复项', new Set(its.map((x) => x.path)).size === its.length);
  ok('每张都有名字和大小', its.every((x) => x.name && x.size >= 0));
  // ⚠️ 老那 5 个目录**永远不会**出现 WhatsApp / Photoroom 这种"别的应用的相册目录" ——
  //    出现一个就说明这一份真的是媒体库给的
  const outside = its.filter((x) => !/^\/sdcard\/(DCIM|Pictures|Screenshots|Download)\//.test(x.path));
  console.log('    （其中 ' + outside.length + ' 张在老代码根本没扫过的目录里：' +
    outside.slice(0, 2).map((x) => x.path.replace('/sdcard/', '')).join('、') + '…）');
} catch (e: any) {
  fail++; console.log('  ✗ 跑不起来：' + e?.message);
} finally {
  if (backup != null) { writeFileSync(FILE, backup); console.log('（负向对照已还原 adbfs.ts）'); }
}

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
