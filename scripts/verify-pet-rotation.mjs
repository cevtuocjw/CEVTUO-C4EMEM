/**
 * ⭐⭐ 转速/转法的验收（读者 2026-10-14）：
 *   「由于你旋转的不是 360 度，所以你转的不是一圈……最快的 4 秒档位也是」
 *   「给出来 120 度转回还是连续 360 度转的选项，然后最快一圈是 2 秒」
 *
 * ⚠️⚠️ 这一条**必须量角度**，不能看"它好像在动"：
 *    旧的实现是 `sin(t) * 26°` —— 它**确实在动**，看起来完全正常，
 *    但一个 period 只走 52°，而且两端还减速 ⇒ "18 秒一圈"是**假的**。
 *
 * 跑：C4EMEM_BASE=http://127.0.0.1:8791 bun scripts/verify-pet-rotation.mjs
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
const B = process.env.C4EMEM_BASE || 'http://127.0.0.1:8791';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };
const br = await chromium.launch({ args: ['--no-proxy-server', '--proxy-bypass-list=*', '--enable-unsafe-swiftshader'] });
const p = await br.newPage({ viewport: { width: 260, height: 260 } });
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)));

async function sample(mode, period, ms) {
  await p.goto(B + '/ui/pet.html', { waitUntil: 'load' });
  await p.evaluate(([m, per]) => localStorage.setItem('c4emem.pet', JSON.stringify({ form: 'silver', spin: true, spinMode: m, period: per })), [mode, period]);
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => { const c = document.querySelector('#pet3dc'); return c && c.__pet3d; }, { timeout: 60000 });
  await p.waitForTimeout(300);
  const out = await p.evaluate((ms) => new Promise((res) => {
    const c = document.querySelector('#pet3dc').__pet3d;
    const s = []; const t0 = performance.now();
    const tick = () => { s.push([Math.round(performance.now() - t0), c.angle]); if (performance.now() - t0 < ms) requestAnimationFrame(tick); else res(s); };
    tick();
  }), ms);
  return out;
}

console.log('① 「连续转」：一个 period 里真的走满 360°，而且**匀速**');
{
  const s = await sample('full', 4, 8500);
  // 角度是累进的（可能超过 2π），换算成"相对于起点转过的度数"
  /* ⚠️⚠️ **必须"解包"，不能直接累加相邻差。**
     实测教训：我第一版就是直接累加 —— 而连续旋转每转满一圈，`rotation.y` 会
     从 2π **回绕到 0**，那一帧的差是 **−2π**，正好把前面攒的 +2π 抵掉
     ⇒ **连续旋转被记成"净位移为零"**，于是三条断言全红，看起来像产品坏了。
     ⇒ 判据：把相邻差映射到 **(−π, π]** 再累加（每帧步长远小于半圈时才成立）。
        ⚠️ 这就是「量具的毛病伪装成被测对象的毛病」那一族 —— 先怀疑探针。 */
  const wrap = (d) => ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  let acc = 0, prev = s[0][1];
  const rel = s.map(([t, a]) => { acc += wrap(a - prev); prev = a; return [t, acc * 180 / Math.PI]; });
  const per = (rel[rel.length - 1][1] - rel[0][1]) / (rel[rel.length - 1][0] - rel[0][0]) * 1000; // 度/秒
  const degPerCycle = per * 4;
  ok(Math.abs(degPerCycle - 360) < 30, `4 秒档位实测一圈 = ${degPerCycle.toFixed(0)}°（要 360°）`);
  /* ⚠️⚠️ 匀速要按**时间窗口**量，不能按"每帧"量。
     实测教训：4 秒一圈 = 90°/s，60fps 下**每帧只走 1.5°** ——
     除以一个抖动的 dt（16ms±）就把定时器噪声放大了十倍，
     p10/p90 直接变成 65/136（比值 2.1）。**那不是产品不匀，是尺子在抖。**
     ⇒ 取 500ms 的窗口：窗口里少算一两帧无所谓，比值才有意义。 */
  const WIN = 500;
  const speeds = [];
  for (let i = 0; i < rel.length; i++) {
    const j = rel.findIndex(([t]) => t >= rel[i][0] + WIN);
    if (j > i) speeds.push((rel[j][1] - rel[i][1]) / (rel[j][0] - rel[i][0]) * 1000);
  }
  speeds.sort((a, b) => a - b);
  const p10 = speeds[0], p90 = speeds[speeds.length - 1];
  ok(p90 / p10 < 1.25, `匀速（500ms 窗口：${p10.toFixed(0)} → ${p90.toFixed(0)}°/s，比值 ${(p90 / p10).toFixed(2)} < 1.25）`);
  ok(speeds.every((v) => v > -1), '一直是同一个方向（没有回摆）');
}

console.log('② 「连续转」最快 2 秒也能到');
{
  const s = await sample('full', 2, 5200);
  /* ⚠️⚠️ **必须"解包"，不能直接累加相邻差。**
     实测教训：我第一版就是直接累加 —— 而连续旋转每转满一圈，`rotation.y` 会
     从 2π **回绕到 0**，那一帧的差是 **−2π**，正好把前面攒的 +2π 抵掉
     ⇒ **连续旋转被记成"净位移为零"**，于是三条断言全红，看起来像产品坏了。
     ⇒ 判据：把相邻差映射到 **(−π, π]** 再累加（每帧步长远小于半圈时才成立）。
        ⚠️ 这就是「量具的毛病伪装成被测对象的毛病」那一族 —— 先怀疑探针。 */
  const wrap = (d) => ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  let acc = 0, prev = s[0][1];
  const rel = s.map(([t, a]) => { acc += wrap(a - prev); prev = a; return [t, acc * 180 / Math.PI]; });
  const per = (rel[rel.length - 1][1] - rel[0][1]) / (rel[rel.length - 1][0] - rel[0][0]) * 1000;
  ok(Math.abs(per * 2 - 360) < 35, `2 秒档位实测一圈 = ${(per * 2).toFixed(0)}°（要 360°）`);
}

console.log('③ 「摆」：幅度是 ±60°（120° 的弧），不是旧的 ±26°');
{
  const s = await sample('swing120', 4, 4600);
  const a = s.map((x) => x[1] * 180 / Math.PI);
  const mx = Math.max(...a), mn = Math.min(...a);
  ok(Math.abs(mx - 60) < 8, `最大摆到 +${mx.toFixed(1)}°（要 +60°）`);
  ok(Math.abs(mn + 60) < 8, `最小摆到 ${mn.toFixed(1)}°（要 −60°）`);
  ok(mx - mn > 100, `总弧度 ${(mx - mn).toFixed(1)}°（旧实现只有 52°）`);
}

console.log('③b 90° / 60° 也要真的按那幅度摆');
for (const [m, half] of [['swing90', 45], ['swing60', 30]]) {
  const s2 = await sample(m, 4, 4600);
  const a = s2.map((x) => x[1] * 180 / Math.PI);
  const mx = Math.max(...a);
  ok(Math.abs(mx - half) < 6, `${m} 摆到 +${mx.toFixed(1)}°（要 +${half}°）`);
}

console.log('④ 「不转」还是**正对着**（这一条别被模式改动弄坏）');
{
  await p.goto(B + '/ui/pet.html', { waitUntil: 'load' });
  await p.evaluate(() => localStorage.setItem('c4emem.pet', JSON.stringify({ form: 'silver', spin: false, spinMode: 'full', period: 2 })));
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => { const c = document.querySelector('#pet3dc'); return c && c.__pet3d; }, { timeout: 60000 });
  await p.waitForTimeout(900);
  const a1 = await p.evaluate(() => document.querySelector('#pet3dc').__pet3d.angle);
  await p.waitForTimeout(700);
  const a2 = await p.evaluate(() => document.querySelector('#pet3dc').__pet3d.angle);
  ok(Math.abs(a1) < 1e-6 && Math.abs(a2) < 1e-6, `不转时角度恒为 0（${a1.toFixed(4)} / ${a2.toFixed(4)}）`);
}

await br.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
