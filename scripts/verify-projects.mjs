/**
 * 项目档案的**契约**（2026-10-10）。
 *
 * ⚠️ 用**内存库 + 临时目录**喂夹具，不碰真数据 —— 判据要的是
 *    「编号算不算数 / 主码子码折不折 / 客户档案收不收我那一半」，
 *    这些三行夹具就能验死；依赖真实数据的话换个邮箱就全红，
 *    而红的原因和代码对不对**没关系**。
 *
 * ⭐ 每一条都对应一个**真的量出来的错**，而且**成对**（正例 + 反例）：
 *    只验"该成的成了"，不验"不该成的不成"，那是在测运气。
 */
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverProjects, addProject, loadProjects, removeProject } from '../src/projects.ts';
import { threads } from '../src/threads.ts';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

const SELF = 'changjw@pingfang.net';

function fixture() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE docs (id TEXT PRIMARY KEY, space TEXT, date TEXT, title TEXT, text TEXT, url TEXT, hash TEXT, synced_at TEXT)');
  /** 造一封邮件。`body` 里的编号**不进标题**就绝不该被算成项目编号。 */
  const mail = ({ id, title, from, to = SELF, date = '2026-10-01', body = '', root = '', parent = '' }) => {
    const head = `主题：${title}\n发件人：${from}\n收件人：${to}\n时间：${date}T02:00:00.000Z\n线索：root=${root || id} parent=${parent}`;
    db.query('INSERT INTO docs VALUES (?,?,?,?,?,?,?,?)').run('exmail:' + id, 'exmail', date, title, `${head}\n\n${body}`, null, 'h', 'x');
  };
  /** 造一条笔记（Notion 来的，没有邮件头）。 */
  const note = ({ id, title, space = 'learn', date = '2026-10-01', body = '' }) =>
    db.query('INSERT INTO docs VALUES (?,?,?,?,?,?,?,?)').run(id, space, date, title, body, null, 'h', 'x');
  return { db, mail, note };
}

let dirI = 0;
function tmpDataDir() {
  dirI += 1;
  return mkdtempSync(join(tmpdir(), `c4emem-pj-${dirI}-`));
}
const run = (db, o = {}) => discoverProjects(db, { minN: 2, limit: 10, selfDomain: 'pingfang.net', ...o });
const find = (ps, kind, name) => ps.find((p) => p.kind === kind && (name ? p.name.includes(name) : true));

console.log('\n── ① 编号：**只有标题算数**（真 bug 的护栏）──────');
{
  // ⚠️ 实测：`ACC89972` 在标题和正文里出现 **0 次**、只出现在**头部 2 次** ——
  //    它是从 `线索：root=<Message-ID>` 里抠出来的一段十六进制。
  //    按它立档 = **把随机串当项目名**，而且每条看起来都很正常。
  const { db, mail } = fixture();
  mail({ id: 'a1', title: '西安轨道吊项目(XS001203)工具辅材申请', from: '贺姗 <hes@pingfang.net>' });
  const p1 = run(db);
  ok(!!find(p1, 'code', 'XS001203'), `标题里的编号立成了档案（${p1.map((x) => x.name).join('/')}）`);

  const { db: db2, mail: mail2 } = fixture();
  mail2({ id: 'b1', title: 'RE: 关于付款的安排', from: 'A <a@informa.com>', body: 'Reference: XS001203.' });
  ok(!find(run(db2), 'code'), '⚠️ 对照：编号只在**正文**里 ⇒ **不立档**（那是引用，不是项目）');

  const { db: db3, mail: mail3 } = fixture();
  // 标题干净，但 Message-ID 里**恰好**含一个编号样式的串
  mail3({ id: 'ACC89972ZZ99', title: 'RE: 关于付款的安排', from: 'A <a@informa.com>', root: 'ACC89972', parent: '' });
  ok(!find(run(db3), 'code'),
     '⚠️ 对照：编号只出现在**线索行的 Message-ID** 里 ⇒ **不立档**（实测 `ACC89972` 就是这么冒出来的）');
}

console.log('\n── ② 主码 / 子码折叠成一块 ────────────────────');
{
  const { db, mail } = fixture();
  mail({ id: 'c1', title: '西安轨道吊安全防护及智能装卸项目(XS001203/XS001203-1)工具辅材申请', from: 'A <a@pingfang.net>' });
  const ps = run(db);
  const codes = ps.filter((p) => p.kind === 'code');
  ok(codes.length === 1, `主码子码只出一块（实得 ${codes.length} 块：${codes.map((c) => c.name).join('、')}）`);
  ok(codes[0]?.name === 'XS001203', `留的是**短的那个**当主码（实得 ${codes[0]?.name}）`);
}

console.log('\n── ③ 客户 / 机构：按域名 ──────────────────────');
{
  const { db, mail } = fixture();
  for (const i of [1, 2]) mail({ id: 'd' + i, title: `Re: invoice ${i}`, from: `G <g${i}@informa.com>`, date: `2026-10-0${i}` });
  ok(!!find(run(db), 'org', 'informa.com'), '同一域名 ≥2 封 ⇒ 成一块');

  const { db: db2, mail: mail2 } = fixture();
  mail2({ id: 'e1', title: 'one off', from: 'X <x@rare.com>' });
  ok(!find(run(db2), 'org', 'rare.com'), '⚠️ 对照：只有 1 封 ⇒ **不立档**（否则列表全是"只含一条"的机构）');

  const { db: db3, mail: mail3 } = fixture();
  for (const i of [1, 2]) mail3({ id: 'f' + i, title: `我发的 ${i}`, from: SELF, date: `2026-10-0${i}` });
  ok(!find(run(db3), 'org', 'pingfang.net'), '⚠️ 对照：**自己的域名**不算"对方机构"');

  const { db: db4, mail: mail4 } = fixture();
  for (const i of [1, 2]) mail4({ id: 'g' + i, title: `私人邮件 ${i}`, from: `P <p${i}@gmail.com>`, date: `2026-10-0${i}` });
  ok(!find(run(db4), 'org', 'gmail.com'), '⚠️ 对照：**免费邮箱**不当机构（gmail 不是一家公司）');
}

console.log('\n── ④ 客户档案要收**我回过去的那一半** ──────────');
{
  // ⚠️ 实测：`informa.com` 一开始只收到 9 条，而那串对话其实有 12 封 ——
  //    我发出去的那一半，发件人是我（域名 pingfang.net），按域名根本收不到。
  const { db, mail } = fixture();
  // ⚠️ 得先有 **2 封对方来的**，这块机构档案才立得起来（minN=2）——
  //    第一版只放了一封，于是整块档案压根不存在，三条断言全红，
  //    而红的原因跟"扩不扩展"一点关系都没有。**夹具得先满足它的前提。**
  mail({ id: 'h1', title: 'Payment reminder', from: 'G <g@informa.com>' });
  mail({ id: 'h9', title: 'Statement of account', from: 'G <g@informa.com>', date: '2026-10-02' });
  mail({ id: 'h2', title: 'Re: Payment reminder', from: SELF, root: 'h1', parent: 'h1' });
  const ths = threads(db, { spaces: ['exmail'], self: SELF, now: new Date('2026-10-10T00:00:00Z') });
  const withExpand = discoverProjects(db, { minN: 2, limit: 10, selfDomain: 'pingfang.net', threads: ths });
  const org = withExpand.find((p) => p.kind === 'org' && p.name === 'informa.com');
  ok(org?.n === 3, `客户的档案里**包含我回的那封**（实得 ${org?.n} 条，对方 2 + 我 1）`);
  ok(org?.items.some((i) => /同一条线索/.test(i.hit.join())),
     '而且**说得出来**它是"同一串对话里的"才被收进来的');
  // ⚠️ 负向对照：**不传 threads** ⇒ 就没有扩展 ⇒ 只剩对方那两封。
  //    这一半证明的是"扩展真的在起作用"，而不是"碰巧都在"。
  const noThreads = discoverProjects(db, { minN: 2, limit: 10, selfDomain: 'pingfang.net' });
  ok(noThreads.find((p) => p.kind === 'org')?.n === 2,
     `⚠️ 对照：不给线程信息 ⇒ 只剩对方那一半（实得 ${noThreads.find((p) => p.kind === 'org')?.n} 条）`);
}

console.log('\n── ⑤ 自建项目：跨来源、不设门槛、不做扩展 ──────');
{
  const dir = tmpDataDir();
  const { db, mail, note } = fixture();
  mail({ id: 'i1', title: '埃及7台RTG 新机子系统报价及方案', from: 'A <a@x.com>' });
  note({ id: 'n1', space: 'learn', title: '埃及项目现场记录', body: 'RTG 的安装注意事项' });
  note({ id: 'n2', space: 'techai', title: '无关的笔记', body: '完全不相干' });
  const r = addProject(dir, '埃及 7 台 RTG', ['埃及', 'RTG']);
  ok(r.ok, '建得起来');
  const ps = run(db, { dataDir: dir });
  const p = find(ps, 'manual', '埃及');
  ok(p?.n === 2, `邮件 + 笔记**都收进来**（实得 ${p?.n} 条：${p?.items.map((i) => i.space).join(',')}）`);
  ok(p?.items.every((i) => i.hit.length), '每条都写得出命中了哪个词（可解释）');

  // ⚠️ 对照：**暂时一条都没有**的自建项目也要留着 —— 它要是"自己消失"，
  //    用户只会以为是自己记错了。
  addProject(dir, '还没开始的项目', ['火星', '基地']);
  // ⚠️ 按**项目名**找，不是按关键词找 —— 第一版写成 `find(..., '火星')`，
  //    而"火星"是关键词、不是名字，于是永远找不到，红了还以为是产品问题。
  ok(!!find(run(db, { dataDir: dir }), 'manual', '还没开始'),
     '⚠️ 一条都没命中的自建项目**照样留着**（不静默消失）');

  // ⚠️ 对照：自建项目**不做线索扩展**（用户圈的就是"只有这些"）
  const { db: db2, mail: mail2 } = fixture();
  mail2({ id: 'j1', title: 'PFT 询价', from: 'A <a@progress-epc.ru>' });
  mail2({ id: 'j2', title: 'Re: PFT 询价', from: SELF, root: 'j1', parent: 'j1', body: 'PFT 的事我看了' });
  const dir2 = tmpDataDir();
  addProject(dir2, '只圈第一封', ['询价']);
  // 两封都含"询价"⇒ 都会被关键词收到，这里用**只命中一封**的关键词
  removeProject(dir2, loadProjects(dir2).projects[0].id);
  addProject(dir2, '只圈第一封', ['PFT 询价']);
  const ths2 = threads(db2, { spaces: ['exmail'], self: SELF, now: new Date('2026-10-10T00:00:00Z') });
  const m2 = find(discoverProjects(db2, { minN: 2, limit: 10, selfDomain: 'pingfang.net', threads: ths2, dataDir: dir2 }), 'manual', '只圈第一封');
  ok(!m2?.items.some((i) => /同一条线索/.test(i.hit.join())),
     '⚠️ 对照：自建项目**不**被线索扩展塞东西 —— 用户圈的就是"只有这些"');

  rmSync(dir, { recursive: true, force: true });
  rmSync(dir2, { recursive: true, force: true });
}

console.log('\n── ⑥ 单字关键词 = 灾难 ⇒ 必须拦住 ─────────────');
{
  const dir = tmpDataDir();
  const bad = addProject(dir, '宽得离谱', ['西']);
  ok(!bad.ok, `单字被拒：${bad.error?.slice(0, 30)}…`);
  // ⚠️ 对照：两个字就通过 —— 证明拦的是"长度"，不是"关键词里有汉字"。
  const good = addProject(dir, '正常项目', ['西安']);
  ok(good.ok, '⚠️ 对照：两个字就通过（拦的是长度，不是别的）');
  // ⚠️ 也必须有对照证明**这条闸门真的在挡东西**：把"西"放行会匹配一大片。
  const { db, mail } = fixture();
  mail({ id: 'k1', title: '西边的通知', from: 'A <a@x.com>' });
  mail({ id: 'k2', title: '东西已收到', from: 'A <a@x.com>' });
  const noKw = run(db, { dataDir: dir });
  ok(!find(noKw, 'manual', '宽得离谱'), '被拒的那个**没有**落盘（不是只回了句错误）');
  rmSync(dir, { recursive: true, force: true });
}

console.log('\n── ⑦ 「报价」只看标题 ─────────────────────────');
{
  const { db, mail } = fixture();
  // ⚠️ 两条的**标题必须不一样**：第一版两条标题都是「Re: 报价单请查收」，
  //    于是"标题里没有报价"那条根本不存在，测的是一个恒真的东西。
  mail({ id: 'l1', title: 'Re: 报价单请查收', from: 'A <a@x.com>' });
  mail({ id: 'l2', title: 'Re: 单子请查收', from: 'A <a@x.com>', body: '贵司报价我们收到了，谢谢。' });
  const dir = tmpDataDir();
  addProject(dir, '报价线索', ['请查收']);
  const p = find(run(db, { dataDir: dir }), 'manual', '报价线索');
  ok(p?.n === 2, `两块都收进来了（${p?.n} 条）`);
  ok(p?.quotes === 1, `只有**标题**里有"报价"的那条被标成报价（实得 ${p?.quotes}）`);
  // ⚠️ 负向对照：正文里出现"报价"的那条**不算** —— 不然每一条回信都会被标上，
  //    那个标记就等于没说话。**判据要落在元素上，别落到标题上**（第一版就落错了）。
  const l2item = p?.items.find((i) => i.id === 'exmail:l2');
  ok(!!l2item && !l2item.quote, '⚠️ 对照：正文里出现"报价"的那条**没**被标成报价');
  rmSync(dir, { recursive: true, force: true });
}

console.log('\n── ⑧ 会展：标题里的大写词组 + 年份 ────────────');
{
  const { db, mail } = fixture();
  for (const i of [1, 2]) mail({ id: 'm' + i, title: `TOC Asia 2026 - notice ${i}`, from: `A <a${i}@x.com>`, date: `2026-10-0${i}` });
  ok(!!find(run(db), 'event', 'TOC Asia 2026'), '立成了「活动」档案');
  ok(find(run(db), 'event', 'TOC Asia 2026')?.kind === 'event', '而且**标成活动**，不混进"项目"里');
}

console.log('\n── ⑩ 弱命中：提到过 ≠ 在讲这件事 ───────────────');
{
  // ⚠️⚠️ 实测：自建项目「埃及 7 台 RTG」按"提过就算"圈进 5 条，
  //    4 条是爱丁堡公爵奖 / 北爱尔兰 / 全球贸易逆差这类**综合长笔记**，
  //    里面 `埃及` 出现 1~2 次、`RTG` 出现在网址里。真命中那封是**标题命中**。
  const dir = tmpDataDir();
  const { db, mail, note } = fixture();
  mail({ id: 'r1', title: '埃及7台RTG 新机子系统报价及方案', from: 'A <a@x.com>' });               // 标题命中
  note({ id: 'r2', title: '一条短笔记', space: 'learn', body: '埃及的港口项目' });                  // 短 ⇒ 算
  note({ id: 'r3', title: '长笔记', space: 'learn', body: '一带一路'.repeat(200) + '埃及' });       // 长 + 只提 1 次 ⇒ 弱
  addProject(dir, '埃及线', ['埃及']);
  const p = find(run(db, { dataDir: dir }), 'manual', '埃及线');
  ok(p?.n === 2, `标题命中 + 短内容算"确定"（实得 ${p?.n}：${p?.items.map((i) => i.id).join(',')}）`);
  ok(p?.maybeN === 1 && p?.maybe[0]?.id === 'r3',
     `长笔记里只提一次 ⇒ 进**弱命中**而不是丢掉（实得 ${p?.maybeN} 条）`);
  ok(p?.items.every((i) => i.id !== 'r3'), '⚠️ 弱命中的**没有**混进确定那一栏（两栏混在一起就分不出可信度了）');

  // ⚠️ 对照：**同一句话放进短笔记就算数** —— 证明拦的是"提到得够不够多/够不够短"，
  //    不是"凡是笔记一律不算"。
  const dir2 = tmpDataDir();
  const { db: db2, note: note2 } = fixture();
  note2({ id: 's1', title: '短', space: 'learn', body: '埃及' });
  addProject(dir2, '短笔记也算', ['埃及']);
  ok(find(run(db2, { dataDir: dir2 }), 'manual', '短笔记也算')?.n === 1,
     '⚠️ 对照：短笔记里提一次**就算**（不是"笔记一律不算"）');

  rmSync(dir, { recursive: true, force: true });
  rmSync(dir2, { recursive: true, force: true });
}

console.log('\n── ⑨ 同一份输入永远给同一份结果 ───────────────');
{
  const { db, mail } = fixture();
  mail({ id: 'o1', title: '埃及7台RTG 新机子系统报价及方案', from: 'A <a@progress-epc.ru>' });
  mail({ id: 'o2', title: 'Re: 埃及7台RTG', from: 'A <a@progress-epc.ru>', date: '2026-10-02' });
  const a = JSON.stringify(run(db));
  const b = JSON.stringify(run(db));
  ok(a === b, '⚠️ 跑两次**逐字节相同**（是规则，不是模型）');
}

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
