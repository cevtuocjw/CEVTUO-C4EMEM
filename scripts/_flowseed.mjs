/**
 * 给验证套件种一份**服务端**的画布。
 *
 * ⚠️⚠️ 为什么不能再用 localStorage 种：结构流现在以**文件夹里那份为准**。
 *     往 localStorage 里塞一份，hydrateFlow 会立刻用服务端那份把它盖掉 ——
 *     于是 `.blk[data-id="b1"]` **根本不存在**，套件**直接崩**（不是变红）。
 *     ⚠️ 而「崩」会把「套件过期了」伪装成「产品坏了」—— 同一个形状坑过好几次。
 *
 * ⚠️⚠️ 必须用**临时目录**：默认目录是读者真实的画布，
 *     套件往那儿写 = 把人家的画布换掉。
 *     （我第一次手工冒烟就踩了这个，所以这里写死成临时目录，不给选。）
 *
 * 用法：在 `p.goto(...)` **之前** `await seedFlow([...blocks], [...wires])`。
 * 进程退出时自动把 flow.dir 还原 —— 用 `spawnSync` 是因为 `exit` 事件里只能同步。
 */
import { rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const U = 'http://127.0.0.1:8770';
const TMP = '/tmp/c4emem-seed-' + process.pid;
let saved = null;

const J = (p, body) =>
  fetch(U + p, body === undefined
    ? undefined
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json());

export async function seedFlow(blocks, wires = [], layout = 'default', lastKind = 'act.ask') {
  if (saved === null) {
    const cur = await J('/api/settings').catch(() => null);
    saved = cur?.values?.flow?.dir ?? '';
    mkdirSync(TMP, { recursive: true });
    process.on('exit', () => {
      try {
        spawnSync('curl', [
          '-s', '-m', '5', '-X', 'POST', U + '/api/settings',
          '-H', 'Content-Type: application/json',
          '-d', JSON.stringify({ flow: { dir: saved } }),
        ]);
      } catch {}
      try { rmSync(TMP, { recursive: true, force: true }); } catch {}
    });
  }
  await J('/api/settings', { flow: { dir: TMP } });
  await J('/api/flow', { blocks, wires, layout, lastKind });
  return TMP;
}
