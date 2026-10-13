/**
 * 结构流存到「用户选的文件夹」—— 端到端。
 *
 * 要证的四件事（后两件才是花钱的地方）：
 *   ① 服务端有 ⇒ 页面**从文件夹加载**，不是只认 localStorage；
 *   ② 服务端没有而本地有 ⇒ **搬上去**（迁移）。不搬，老用户升级就"画布没了"；
 *   ③ 编辑之后 ⇒ 真的写进了那个文件（防抖之后）；
 *   ④ ⚠️ 文件坏了 ⇒ **一个字都不许动它**，也不许开自动存。
 *      这是最贵的一条：静默用空画布盖掉，等于**把用户的画布删了**。
 *
 * ⚠️ 全程把 `flow.dir` 指到 `/tmp` 下的临时目录，**绝不碰读者真实的画布**，
 *    而且 `finally` 里一定把原设置还回去（改坏了没人知道）。
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';

const U = 'http://127.0.0.1:8770';
const DIR = '/tmp/c4emem-flowstore-' + process.pid;
const FILE = DIR + '/flow.json';

let pass = 0, fail = 0, skip = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };
const J = async (p, o) => (await fetch(U + p, o)).json();
const post = (p, b) => J(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) });
const readFile = () => (existsSync(FILE) ? readFileSync(FILE, 'utf8') : null);

// 原设置先存下来，最后还回去
const before = (await J('/api/settings')).values?.flow ?? {};
mkdirSync(DIR, { recursive: true });

let b;
try {
  if (!(await J('/api/stats')).docs) { console.log('⏭ 跳过：服务端没起'); skip++; throw new Error('no server'); }
  await post('/api/settings', { flow: { dir: DIR } });
  b = await chromium.launch();
  const mk = async (init) => {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    if (init) await p.addInitScript(init);
    await p.goto(U + '/', { waitUntil: 'load' });
    return p;
  };
  const waitReady = (p, t = 15000) =>
    p.waitForFunction(() => window.__app && window.__app.flowReady === true, null, { timeout: t }).catch(() => {});

  // ① 服务端有 ⇒ 从文件夹加载
  console.log('\n▸ ① 服务端有，页面从文件夹加载');
  await post('/api/flow', { blocks: [{ id: 'srv1', kind: 'text', text: '这是文件夹里的', x: 60, y: 60 }], wires: [], layout: 'nuggets', lastKind: 'act.ask' });
  {
    const p = await mk(() => localStorage.clear());
    await waitReady(p);
    const got = await p.evaluate(() => window.__app.flow.map((x) => x.text));
    ok(got.includes('这是文件夹里的'), `画布来自文件夹（实得 ${JSON.stringify(got)}）`);
    const lay = await p.evaluate(() => document.querySelector('#flowstyle button[data-l="nuggets"]')?.classList.contains('on'));
    ok(lay === true, '版式也跟着从文件夹恢复（nuggets 高亮）');
    await p.close();
  }

  // ② 服务端没有 ⇒ 把本地那份搬上去
  console.log('\n▸ ② 服务端没有，本地有 ⇒ 迁移上去');
  rmSync(FILE, { force: true });
  {
    const p = await mk(() => {
      localStorage.clear();
      localStorage.setItem('c4emem.flow', JSON.stringify([{ id: 'loc1', kind: 'text', text: '这是本地的', x: 60, y: 60 }]));
      localStorage.setItem('c4emem.wires', '[]');
    });
    await waitReady(p);
    await p.waitForTimeout(1200);
    const raw = readFile();
    let migrated = false;
    try { migrated = (JSON.parse(raw ?? '{}').blocks ?? []).some((x) => x.text === '这是本地的'); } catch {}
    ok(migrated, '本地那份被搬进了文件夹（不搬 = 老用户升级后画布消失）');
    await p.close();
  }

  // ③ 编辑之后真的写进文件
  console.log('\n▸ ③ 编辑之后真的写盘');
  {
    const p = await mk(() => localStorage.clear());
    await waitReady(p);
    await p.evaluate(() => window.__app.show('flow'));
    const n0 = JSON.parse(readFile() ?? '{"blocks":[]}').blocks.length;
    await p.evaluate(() => window.__app.addBlock('text'));
    await p.waitForTimeout(1500); // 防抖 500ms，留裕量
    const n1 = JSON.parse(readFile() ?? '{"blocks":[]}').blocks.length;
    ok(n1 === n0 + 1, `加一块之后文件里多了一块（${n0} → ${n1}）`);
    await p.close();
  }

  // ⑤ 服务端那些块没有坐标 ⇒ 必须补落点，而且**不许全叠在一个点上**
  console.log('\n▸ ⑤ 服务端那份没坐标 ⇒ 补落点，不许叠在一起');
  {
    await post('/api/flow', {
      blocks: [
        { id: 'n1', kind: 'text', text: 'A' },
        { id: 'n2', kind: 'text', text: 'B' },
        { id: 'n3', kind: 'text', text: 'C' },
      ],
      wires: [],
    });
    const p = await mk(() => localStorage.clear());
    await waitReady(p);
    const pts = await p.evaluate(() => window.__app.flow.map((b) => [b.x, b.y]));
    ok(pts.length === 3 && pts.every((q) => q[0] != null && q[1] != null), `每个块都有坐标（${JSON.stringify(pts)}）`);
    // ⚠️ 「有坐标」还不够 —— 三个块全在 (60,60) 也算"有坐标"。
    //    叠在一起就会互相挡住、点都点不到（这是 verify-flow 崩出来的真 bug）。
    const uniq = new Set(pts.map((q) => q.join(',')));
    ok(uniq.size === pts.length, `而且各在各的位置，没叠在一起（${uniq.size}/${pts.length} 个不同的点）`);
    await p.close();
  }

  // ④ ⚠️ 文件坏了 ⇒ 一个字都不许动
  console.log('\n▸ ④ 负向：文件坏了，绝不能拿空画布盖掉它');
  {
    const junk = '{"这不是":"结构流","但":["是","合法","JSON"]}';
    writeFileSync(FILE, junk, 'utf8');
    const p = await mk(() => localStorage.clear());
    await p.waitForTimeout(2500);
    ok(readFile() === junk, '加载之后文件原样没动');
    const ready = await p.evaluate(() => window.__app.flowReady);
    ok(ready === false, '没开自动存（flowReady=false）');
    const warned = await p.evaluate(() => document.body.textContent.includes('画布文件读不出来'));
    ok(warned, '界面上如实说了出来，不是静默失败');
    // ⚠️⚠️ 关键一步：**真的去编辑一下**。
    //    只"加载完读一遍"证明不了什么 —— 危险的是「编辑 → 自动存 → 空画布盖掉它」这条路径。
    //    没有这一步，负向对照就是个**恒等操作**：不编辑就没人推盘，怎么改都全绿。
    await p.evaluate(() => window.__app.show('flow'));
    await p.evaluate(() => window.__app.addBlock('text'));
    await p.waitForTimeout(1500);
    ok(readFile() === junk, '而且**编辑之后**还是没动它（真契约：坏文件不会被覆盖）');
    await p.close();
  }
} catch (e) {
  if (String(e.message) !== 'no server') { fail++; console.log('  ✗ 套件崩了：' + e.message); }
} finally {
  // ⚠️ 恢复必须在 finally —— 不然会留下一份被改坏的设置，而没人知道
  try { await post('/api/settings', { flow: { dir: before.dir ?? '' } }); } catch {}
  try { if (b) await b.close(); } catch {}
  try { rmSync(DIR, { recursive: true, force: true }); } catch {}
}

console.log(`\n${pass} 通过 / ${fail} 失败 / ${skip} 跳过`);
process.exit(fail ? 1 : 0);
