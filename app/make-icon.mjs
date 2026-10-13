/**
 * 生成 `app/AppIcon.icns`（App 图标 = 那张 CEVTUO 卡片）。
 *
 * ⚠️⚠️ 为什么要绕浏览器这一圈：**本机没有任何 PNG 编解码器**（pngjs / sharp / jimp 都没有），
 *    而 `sips` 只能缩放、不能合成。所以"把卡片摆到一块深色圆角底上"这件事
 *    只能在浏览器里做（这也是这个项目一直以来的做法）。
 *    ⚠️ `sips` **不能**处理 APNG、也不能合成 —— 别指望它。
 *
 * 跑：bun app/make-icon.mjs
 *     出了新的 AppIcon.icns 之后 `bash app/build.sh` 会把它拷进 Resources。
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';

const HERE = '/Users/cjw/Documents/Cevtuo-C4emem/app';
const SET = HERE + '/AppIcon.iconset';
const PNG = HERE + '/icon-1024.png';

rmSync(SET, { recursive: true, force: true });
mkdirSync(SET, { recursive: true });

// ① 渲染 1024×1024（透明底，圆角是图里画出来的）
const br = await chromium.launch();
const p = await br.newPage({ viewport: { width: 1024, height: 1024 } });
await p.goto('file://' + HERE + '/icon.html', { waitUntil: 'load' });
await p.waitForTimeout(400);          // 等 card.png 解码
await p.screenshot({ path: PNG, omitBackground: true });
await br.close();

// ② 拆成 iconset（名字是 iconutil 要的那套，写错一个它就不认）
const SIZES = [
  [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png'],
];
for (const [px, name] of SIZES) {
  execFileSync('sips', ['-z', String(px), String(px), PNG, '--out', SET + '/' + name], { stdio: 'ignore' });
}

// ③ 拼成 .icns
execFileSync('iconutil', ['-c', 'icns', SET, '-o', HERE + '/AppIcon.icns'], { stdio: 'inherit' });
rmSync(SET, { recursive: true, force: true });
rmSync(PNG, { force: true });
console.log(existsSync(HERE + '/AppIcon.icns') ? '✅ app/AppIcon.icns 生成好了' : '❌ 没生成出来');
