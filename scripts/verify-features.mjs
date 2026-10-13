/**
 * 功能注册表 + 侧栏抽屉（2026-10-09 晚）。
 *
 * 读者三条要求，每条一个判据：
 *   ① 「抽屉式样的，以软件来分区」⇒ 侧栏有**可折叠的分区**，而且折叠状态**记得住**
 *   ② 「所有的功能都有归属…加上来源的图标，不然会乱套」
 *      ⇒ 每个功能后面有来源图标，而且是**看得见**的（不是 DOM 里有、被 CSS 藏了）
 *      ⚠️ 还钉一条：**行图标 ≠ 来源图标** —— 第一版「内置」用了 rocket，
 *         而「自我改进」的行图标也是 rocket，两枚一样的并排像渲染错了
 *   ③ 「所有的功能都有删除的能力」⇒ 装进来的能删、内置的删不掉（要**说得出为什么**）
 *
 * 还有一条**防"点开一片空白"**：没写完的功能不给装 —— 空白和"坏了"长得一模一样。
 *
 * 跑法：env -u HTTPS_PROXY … NO_PROXY='*' bun scripts/verify-features.mjs
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';

const B = 'http://127.0.0.1:8770';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };
const j = async (p, o) => (await fetch(B + p, o)).json();
const post = (p, b) => j(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) });
const del = (p) => j(p, { method: 'DELETE' });

// ⚠️⚠️ 收尾**只能还原自己动过的**，不能删光。
//    第一版是 `for (const id of f.installed) del(...)` —— 那会把**读者自己装的**
//    功能也一起卸掉。实测就是这么把他刚装好的「联系人 / 待办抽取」清掉的，
//    而且**没有任何提示**：套件全绿，人打开软件发现功能没了。
//    ⇒ 先拍一张"进来时是什么样"，收尾时按那张照片**逐个还原**。
let initial = [];
/**
 * ⚠️⚠️ **中途崩了也必须还原。**
 * 原来 `restore()` 只在最后一行 `await` —— 套件只要在中途抛一次（断言红了、
 * 浏览器起不来、被 SIGKILL），读者**自己装的功能就永久没了**，而且**没有任何提示**。
 * 实测就是这么把「项目档案」删掉的（`~/.c4emem/features.json` 里留下了 `dismissed:["projects"]`），
 * 而读者是**自己发现侧栏里少了一样东西**才来问的。
 */
async function guard(e) {
  try { await restore(); } catch { /* 还原也失败就只能靠快照了 */ }
  console.error('\n⚠️ 套件中途出错，已先按快照还原：', e?.message ?? e);
  process.exit(1);
}
process.on('uncaughtException', guard);
process.on('unhandledRejection', guard);

async function snapshot() {
  initial = (await j('/api/features')).installed.slice();
}
/** 这一套要测"装"，所以先确保 contacts 没装 —— 但**只动它一个**。 */
async function ensureClean() {
  if (initial.includes('contacts')) await del('/api/features/contacts').catch(() => {});
}
/** 还原成进来时的样子：多出来的删掉，少掉的装回去。 */
async function restore() {
  const now = (await j('/api/features')).installed;
  for (const id of now) if (!initial.includes(id)) await del('/api/features/' + encodeURIComponent(id)).catch(() => {});
  const after = (await j('/api/features')).installed;
  for (const id of initial) if (!after.includes(id)) await post('/api/features/install', { id }).catch(() => {});
}

console.log('\n── ① 服务端：装 / 删 / 两道护栏 ────────────────');
{
  await snapshot();
  await ensureClean();
  const before = await j('/api/features');
  // ⚠️ 这里只能要 ≥3：**空的分区不返回**（不然侧栏会挂一排空标题），
  //    而此刻「邮件」那一区还没装东西 ⇒ 它本来就不该出现。
  ok(before.groups.length >= 3, `分区 ≥ 3（实得 ${before.groups.length}：${before.groups.map((g) => g.name).join('、')}）`);
  // ⚠️ 判据要挑一个**永远为空**的分区；拿有内容的分区名验的话，内容一变就假红（栽过一次）。
  //    ⚠️ 2026-10-10：分组依据换成了**软件**（读者：「不要按照知识库这种写法，要按照软件来」），
  //       所以这里不再写死 `custom` 这种旧 id，改成"**没有任何一个分区是空着的**"。
  ok(before.groups.every((g) => g.items.length > 0), '**没有任何成员的分区不出现**（每个分区都有人）');
  // ⚠️ 这不再是"分组对不对"，而是**沉底那条规矩**：`内置`（工作区/语音/文字/结构流）
  //    必须排在最后 —— 那是拇指够得到的位置，换分组方式时最容易顺手丢掉。
  ok(before.groups.at(-1).id === 'builtin',
     `「内置」排在**最后**（实得最后一个是「${before.groups.at(-1).name}」）—— 拇指够得到的位置，别挪到顶上`);
  // ⚠️ 分组的依据是**软件**：每个分区的 id 必须是一个真实的软件名，而且
  //    **该分区里每个功能的 `source` 都等于这个 id** —— 不相等就说明有人又按别的维度分了。
  ok(before.groups.every((g) => g.items.every((i) => i.source === g.id)),
     `分区就是软件：每一区里的功能归属都等于这一区的名字（${before.groups.map((g) => g.id).join('、')}）`);
  ok(before.groups.every((g) => g.items.every((i) => i.sourceIcon && i.sourceLabel)),
     '每个功能都带**来源**（图标 + 名字）—— 归属那一条');

  const ins = await post('/api/features/install', { id: 'contacts' });
  ok(ins.ok && ins.feature?.removable === true, '能装：装进来的功能标了 removable');
  const after = await j('/api/features');
  // ⚠️ 2026-10-10 起分区 = **软件**，联系人那个功能的归属是 `exmail`（企业邮箱）。
  const mail = after.groups.find((g) => g.id === 'exmail');
  ok(!!mail && mail.items.some((i) => i.id === 'contacts'), '装完出现在「企业邮箱」那一节里（分区**按软件**归位）');
  ok(!!mail && after.groups.length >= before.groups.length, `「企业邮箱」这一节在（${before.groups.length} → ${after.groups.length} 个分区，本来就装着的不会重复出现）`);

  // 重复装 ⇒ 认出来，不变成两条
  const again = await post('/api/features/install', { id: 'contacts' });
  const n = (await j('/api/features')).groups.flatMap((g) => g.items).filter((i) => i.id === 'contacts').length;
  ok(again.already === true && n === 1, '重复装 ⇒ 认出来，侧栏里仍然只有一条');

  // ⚠️ 没写完的功能不给装 —— 装上去点开是一片空白，而空白和"坏了"长得一样。
  // ⚠️⚠️ 例子必须**从目录里现挑**：第一版写死了 `mailtodo`，而它**第二天就做完了** ⇒
  //    这条断言变成"装成功了却断言应该失败"，红得莫名其妙。
  //    （和 verify-1009 那条"邮件还没接入"是同一个毛病：**硬编码的前提会被世界改掉**。）
  const f0 = await j('/api/features');
  const notReady = (f0.catalog || []).find((c) => !c.ready);
  ok(!!notReady, `目录里还有一个"还没做"的功能可以做这条判据（${notReady?.name ?? '一个都没有'}）`);
  if (notReady) {
    const bad = await fetch(B + '/api/features/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: notReady.id }) });
    const badBody = await bad.json();
    ok(bad.status === 400 && /还没做/.test(badBody.error || ''), `没写完的功能装不上，而且说得出为什么（「${String(badBody.error).slice(0, 34)}」）`);
    ok((await j('/api/features')).groups.flatMap((g) => g.items).every((i) => i.id !== notReady.id), '被拒之后侧栏里**没有**多出来');
  }

  const delBuiltin = await fetch(B + '/api/features/rec', { method: 'DELETE' });
  ok(delBuiltin.status === 400, '内置的删不掉（400）');
}

console.log('\n── ② 界面：分区 / 来源图标看得见 / 能折叠 ──────');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(B + '/', { waitUntil: 'load' });
await p.evaluate(() => localStorage.removeItem('c4emem.navclosed'));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(1300);

const rows = () => p.$$eval('#navsections .nv', (els) => els.map((e) => ({
  name: e.querySelector('.nvl')?.textContent ?? '',
  view: e.dataset.v,
  rowIcon: e.querySelector(':scope > svg use')?.getAttribute('href') ?? '',
  srcIcon: e.querySelector('.srcbadge svg use')?.getAttribute('href') ?? '',
  srcVisible: (() => { const s = e.querySelector('.srcbadge'); return !!s && s.getBoundingClientRect().width > 0; })(),
  del: !!e.querySelector('[data-del-feat]'),
})));

{
  const rs = await rows();
  ok(rs.length >= 10, `侧栏有 ${rs.length} 个功能（都由注册表生成）`);
  ok(rs.every((r) => r.srcIcon), '每一行后面都有来源图标（DOM 里）');
  ok(rs.every((r) => r.srcVisible), '而且**真的看得见**（宽度 > 0）—— 藏在 CSS 里不算');
  // ⭐ 撞车护栏
  const clash = rs.filter((r) => r.rowIcon && r.rowIcon === r.srcIcon).map((r) => r.name);
  ok(clash.length === 0, `没有"行图标 == 来源图标"的行${clash.length ? '：' + clash.join('、') : ''}（那次两枚火箭的护栏）`);
  // ⭐⭐ 这一条才是读者真正在说的那件事：
  //   「**所有的**左边栏的来源logo都一样，感觉不太合理」——
  //   第一版 12 行里 10 行都标「内置」，同一个角标出现在几乎所有行上
  //   **那个角标就等于没说话**。判据不是"每行都有角标"，是"**角标能把功能分开**"。
  const tally = {};
  for (const r of rs) tally[r.srcIcon] = (tally[r.srcIcon] || 0) + 1;
  const kinds = Object.keys(tally).length;
  const worst = Math.max(...Object.values(tally));
  ok(kinds >= 3, `角标至少分得出 3 类来源（实得 ${kinds} 类：${Object.entries(tally).map(([k, v]) => k + '×' + v).join(' ')}）`);
  ok(worst / rs.length <= 0.6, `没有任何一类占了超过 6 成（最多的是 ${worst}/${rs.length}）—— 否则那个角标又等于没说话`);
  // 可删的只有装进来的
  // ⚠️ 用**相对**判据：读者本来就装着几个，写死 1 会假红
  const installedN = (await j('/api/features')).installed.length;
  ok(rs.filter((r) => r.del).length === installedN,
     `带删除的正好是"装进来的"那些（界面 ${rs.filter((r) => r.del).length} 条 vs 服务端 ${installedN} 条）`);
}

{
  // 分区折叠 + **记得住**
  const secs = await p.$$eval('#navsections .navsec', (els) => els.map((e) => e.dataset.g));
  // ⚠️ 不写死名字 —— 分组依据会变（2026-10-10 从「知识库/邮件/…」换成了**软件**）。
  //    要的是"界面上的分区和服务端给的一模一样"，那才是契约。
  // ⚠️ `before` 是上面那个块里的 `const`，这里**看不见它** —— 直接现拉一份。
  //    （第一次就栽在这：`before is not defined`，而它长得像"产品坏了"。）
  const want = (await j('/api/features')).groups.map((g) => g.id);
  ok(secs.join('、') === want.join('、'), `界面分区与服务端一致：${secs.join('、')}`);
  // ⭐ 读者 2026-10-10：「侧边栏要按照软件（zen 的侧边栏那种**一个一个的软件图标**）」
  const icons = await p.$$eval('#navsections .sech .si', (els) => els.filter((e) => e.querySelector('svg, use')).length);
  ok(icons === secs.length, `每一节的头都有**软件图标**（${icons}/${secs.length}）`);
  // ⚠️⚠️ **不要写死分区的名字。** 原来这里写的是 `kb`（知识库）——
  //    2026-10-10 分组依据换成软件之后，`kb` 不复存在，于是这条**点了个不存在的元素**、
  //    30 秒超时、整个套件崩在中间。而它看起来像"产品坏了"。
  //    ⇒ 拿界面**自己报出来的**第一个分区来验。
  const first = secs[0];
  await p.click(`#navsections .sech[data-sec="${first}"]`);
  await p.waitForTimeout(300);
  const hidden = await p.$eval(`#navsections .navsec[data-g="${first}"] .secb`, (e) => e.getBoundingClientRect().height === 0);
  ok(hidden, `点分区标题 ⇒ 这一区收起来（拿「${first}」验）`);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const stillHidden = await p.$eval(`#navsections .navsec[data-g="${first}"] .secb`, (e) => e.getBoundingClientRect().height === 0);
  ok(stillHidden, '刷新之后**仍然收着**（折叠状态记得住，不然这个按钮等于没用）');
  await p.click(`#navsections .sech[data-sec="${first}"]`);
  await p.waitForTimeout(300);
}

console.log('\n── ③ 装进来的那个功能真的能用 ──────────────────');
{
  // 侧栏里点开
  const r = (await rows()).find((x) => x.view === 'contacts');
  ok(!!r, '侧栏里有「联系人 / 公司」');
  await p.click('#navsections .nv[data-v="contacts"]');
  await p.waitForTimeout(1500);
  const txt = await p.$eval('#kbmount', (e) => e.innerText);
  ok(/个人 \/ 组织|联系人/.test(txt), '点开有内容（不是一片空白）');
  ok(/@/.test(txt), '真的列出了邮箱地址（读的是真数据，不是占位）');
  const nContacts = await p.evaluate(async () => (await (await fetch('/api/contacts')).json()).total);
  ok(nContacts > 0 && new RegExp(String(nContacts)).test(txt), `界面上的人数和服务端一致（${nContacts} 个）`);
}

console.log('\n── ④ 删除：点一下真的没了 ──────────────────────');
{
  const before = (await rows()).length;
  await p.click('#navsections .nv[data-v="contacts"] [data-del-feat]');
  await p.waitForTimeout(1200);
  const after = await rows();
  ok(after.length === before - 1 && !after.some((r) => r.view === 'contacts'),
     `删掉之后侧栏里真的没了（${before} → ${after.length}）`);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1200);
  ok(!(await rows()).some((r) => r.view === 'contacts'), '刷新之后也确认没了（不是只从 DOM 里抹掉）');
  const canReinstall = await post('/api/features/install', { id: 'contacts' });
  ok(canReinstall.ok, '而且**还能再装回来**（删除是可逆的）');
}

console.log('\n── ⑤ 负向对照：把来源图标藏掉，② 必须变红 ──────');
{
  await p.addStyleTag({ content: '#navsections .srcbadge{display:none !important}' });
  await p.waitForTimeout(300);
  const rs = await rows();
  const visible = rs.filter((r) => r.srcVisible).length;
  ok(visible === 0,
     `⚠️ 把来源图标藏掉 ⇒ **一个都看不见了**（实得 ${visible} 个可见）—— 说明 ② 那条"看得见"真的在量渲染`);
}

ok(errs.length === 0, '没有页面报错' + (errs.length ? '：' + errs.slice(0, 2).join(' | ') : ''));

await b.close();
await restore();
const end = await j('/api/features');
ok(JSON.stringify(end.installed.slice().sort()) === JSON.stringify(initial.slice().sort()),
   `收尾：还原成进来时的样子（${initial.length} 个）—— **不是删光**，别把人自己装的也卸了`);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
