/**
 * 生成 `app/pet/AppIcon.icns`（那支铅笔）。
 *
 * ⚠️⚠️ 为什么要绕浏览器这一圈：**本机没有任何 PNG 编解码器**（pngjs / sharp / jimp 都没有），
 *    而 `sips` **只能缩放、不能合成**。所以"把铅笔摆到一块圆角底上"这件事
 *    只能在浏览器里做完再截。
 *    ⚠️ `sips` 也**不能**处理 APNG —— 别指望它。
 *
 * 跑：bun app/pet/make-icon.mjs
 *     出了 icns 之后 `bash app/pet/build.sh` 会把它拷进 Resources。
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const HERE = '/Users/cjw/Documents/Cevtuo-C4emem/app/pet';
const SET = HERE + '/AppIcon.iconset';
const PNG = HERE + '/icon-1024.png';

rmSync(SET, { recursive: true, force: true });
mkdirSync(SET, { recursive: true });

const br = await chromium.launch();
const p = await br.newPage({ viewport: { width: 1024, height: 1024 } });
await p.goto('file://' + HERE + '/icon.html', { waitUntil: 'load' });
await p.waitForTimeout(300);
await p.screenshot({ path: PNG, omitBackground: true });
await br.close();

// ⚠️ iconset 里那几张尺寸**名字是固定的**，少一张 icns 就少一档，
//    而那在 Dock 里表现为"某个尺寸下图标糊了"—— 而它不会报错。
const SIZES = [16, 32, 64, 128, 256, 512, 1024];
for (const s of SIZES) {
  execFileSync('sips', ['-z', String(s), String(s), PNG, '--out', `${SET}/icon_${s}x${s}.png`], { stdio: 'ignore' });
  if (s <= 512) {
    execFileSync('sips', ['-z', String(s * 2), String(s * 2), PNG, '--out', `${SET}/icon_${s}x${s}@2x.png`], { stdio: 'ignore' });
  }
}
execFileSync('iconutil', ['-c', 'icns', SET, '-o', `${HERE}/AppIcon.icns`]);
rmSync(SET, { recursive: true, force: true });
rmSync(PNG, { force: true });
console.log('✅ app/pet/AppIcon.icns');
