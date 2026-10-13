/**
 * 本地语音识别：浏览器录 → 转 16k 单声道 WAV → 本机 whisper → 出字。
 *
 * ⚠️ 用 Chromium 的**假麦克风**（`--use-file-for-fake-audio-capture`）把一段
 *    已知内容的 wav 喂进去，所以这条路是真的端到端：
 *    真 MediaRecorder、真 decodeAudioData、真重采样、真 WAV 编码、真子进程识别。
 *    比"mock 一个接口返回固定文本"强得多 —— 后者测不到重采样和编码那两个坑。
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// ⚠️⚠️ 夹具在 /tmp，而 /tmp 会被系统清掉。以前缺了就直接 `process.exit(0)` ——
//     那是**跳过伪装成通过**：退出码和真通过一模一样，任何包装脚本都会当成验过了。
//     而且它在打印汇总行**之前**就退了，所以连「跳过了几条」都看不到。
//     ⇒ 现在缺了先**现重建**；重建失败才跳过，而且跳过要长得和通过不一样
//       （单独一行汇总 + 非 0 退出码）。命令固化在 scripts/mk-stt-fixture.sh。
const WAV = '/tmp/stt-test.wav';
if (!existsSync(WAV)) {
  console.log('夹具不在（' + WAV + '），现重建：bash scripts/mk-stt-fixture.sh');
  const r = spawnSync('bash', ['scripts/mk-stt-fixture.sh', WAV], { stdio: 'inherit' });
  if (r.status !== 0 || !existsSync(WAV)) {
    console.log('\n⏭ 跳过（0 通过 / 0 失败 / 1 跳过）：夹具既不在、也重建不出来。');
    console.log('   ⚠️ 这次**什么都没验证** —— 这是跳过，不是通过。');
    console.log('   手动重建：bash scripts/mk-stt-fixture.sh ' + WAV);
    process.exit(2); // ← 2 = 跳过。绝不能是 0，否则和「全绿」长得一样。
  }
}

const b = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${WAV}%noloop`,
  ],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

await p.addInitScript(() => localStorage.clear());
await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
await p.waitForTimeout(1000);

console.log('\n▸ 环境');
const st = await p.evaluate(() => fetch('/api/stt/status').then((r) => r.json()));
ok(st.ready === true, '服务端说本地识别装好了');

console.log('\n▸ 提示语如实反映状态');
const hint = await p.$eval('#vhint', (e) => e.textContent);
ok(/本地识别/.test(hint) && /不出本机/.test(hint), `提示语说清了是本地、不出本机（${hint.slice(0, 30)}）`);

console.log('\n▸ 录一段（假麦克风在放夹具音频）');
await p.click('#mic');
// ⚠️ getUserMedia 是异步的（实测约 800ms 才进录音态），点完立刻读会读到 false ——
//    那是探针太急，不是按钮坏了。等条件，并且把实得值打出来。
await p.waitForFunction(() => document.querySelector('#mic').classList.contains('live'), null, { timeout: 20000 }).catch(() => {});
const cls = await p.$eval('#mic', (e) => e.className);
ok(/\blive\b/.test(cls), `点了之后进入录音态（class=${cls}）`);
await p.waitForTimeout(6000);
await p.click('#mic');
const notLive = await p.$eval('#mic', (e) => e.classList.contains('live'));
ok(!notLive, '再点一下退出录音态');

console.log('\n▸ 识别');
await p.waitForFunction(() => {
  const t = document.querySelector('#vlog').textContent;
  return /今天|设计|开会|识别失败|没听清/.test(t);
}, null, { timeout: 90000 }).catch(() => {});
await p.waitForTimeout(400);
// ⚠️ 这一条**只验通路**：录到了 → 转成 WAV → 本机认出字 → 送进提问。
//    不在这里断言"听出来的字对不对" —— 那取决于假麦克风的启动缝和合成语音的怪读法，
//    是**夹具**的性质，不是产品的性质。准确度在命令行里量（见报告里 base/small 的对照）。
// ⚠️ 不用 `#vlog .you` 选 —— logLine 给的是 `class="you "`（末尾带空格），
//    选择器能中；但气泡是**逐个 append** 的，用子元素数组更稳，还能顺便看见结构。
const lines = await p.$$eval('#vlog > *', (es) => es.map((e) => e.className.trim() + '|' + e.textContent));
const heard = (lines.find((x) => x.startsWith('you|')) || 'you|').split('|').slice(1).join('|').replace(/^你[\s\u3000]*/, '').trim();
if (!heard) console.log('    vlog 结构：' + JSON.stringify(lines.map((x) => x.slice(0, 44))));
ok(heard.length >= 4, `录到的话变成了文字（${heard.slice(0, 30)}）`);
ok(!/没听清|识别失败/.test(heard), '而且不是「没听清」或「识别失败」');
ok(!/…$/.test(heard.trim()) && !/^\(识别中/.test(heard), '也不是还停在「识别中…」');
await p.screenshot({ path: 'out/stt-1.png' });

console.log('\n▸ 认出来的话要继续往下走（进记录、进提问）');
await p.waitForTimeout(8000);
// ⚠️ 判据用**有没有那一行**，不用"字数变多了" —— 后者是个运气断言：
//    识别结果本身长短不定，它偶尔会因为答得短而误报。
const after = await p.$$eval('#vlog > *', (es) => es.map((e) => e.className.trim()));
ok(after.includes('ai'), `识别出来的话被当成一次真实提问发出去了（vlog 里有 ai 那一行：${after.join(',')}）`);
const act = await p.evaluate(() => fetch('/api/activity?limit=6').then((r) => r.json()));
const kinds = (act.items || []).map((x) => x.kind);
ok(kinds.includes('voice'), `记录里记了一条 voice（${kinds.slice(0, 4).join(',')}）`);

// ⚠️ 汇总行**永远带跳过数**（哪怕 0）：不写的话，「N/N 通过」读起来像「全都验过了」，
//    而跳过的那几条既不是 ✓ 也不是 ✗ —— 它们在输出里是**消失了**。见 FACT 纪律 8。
console.log(`\n${pass} 通过 / ${fail} 失败 / 0 跳过` + (errs.length ? '\n⚠️ 页面报错: ' + errs.slice(0, 4).join(' ;; ') : '\n✅ 无页面报错'));
await b.close();
process.exit(fail ? 1 : 0);
