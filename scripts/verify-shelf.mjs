/**
 * 货架：新图标 / 引导指针 / 什么都能放 / 自己的帮助弹窗 / Notion 自动归页。
 * ⚠️ 负向对照都要有：粘贴**在输入框里**不能被抢；引导指针用过一次就该闭嘴。
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { seedFlow } from './_flowseed.mjs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

// ⚠️ 画布以**服务端那份**为准：种到 localStorage 会被 hydrateFlow 盖掉（套件会崩）。
await seedFlow(
  [
    { id: 'b1', kind: 'src.notes', text: '骑行 心率', x: 60, y: 60 },
    { id: 'b2', kind: 'out.notion', text: '', x: 430, y: 60 },
  ],
  [{ id: 'w1', from: 'b1', port: 'notes', to: 'b2', in: 'text', type: 'data' }],
);
await p.addInitScript(() => localStorage.clear());
await p.goto('http://127.0.0.1:8770/', { waitUntil: 'load' });
await p.waitForTimeout(1000);

console.log('\n▸ 货架换了图标');
const href = await p.$eval('#shelfToggle use', (u) => u.getAttribute('href'));
ok(href === '#i-shelf', `是货架那张图（${href}）`);
ok(href !== '#i-spark', '不再是原来那张（那张其实是个提袋）');
const segs = await p.$eval('#i-shelf path', (e) => (e.getAttribute('d').match(/M/g) || []).length);
ok(segs >= 6, `是真货架不是提袋：两侧立柱 + 两层板 + 板上放着东西（${segs} 段）`);

console.log('\n▸ 引导指针');
// ⚠️⚠️ **不要断言"此刻它是不是收着的"** —— 它每 10 秒跳出来 1 秒，
//     任何瞬时读数都在跟那个定时器抢时机，跑得快/慢都会误报。
//     契约拆成三条**可确定的**，一条都不依赖"现在几点"：
// ⚠️ **先把 .on 清掉再读** —— 直接读的话，只要这一瞬正好落在它跳出来的那一秒里，
//    就会读到 animation=hintpop 而误报。清掉之后测的是**样式表的默认值**，
//    与那个 10 秒的定时器完全无关。
const d0 = await p.evaluate(() => {
  const e = document.querySelector('#shelfHint');
  e.classList.remove('on'); e.hidden = true;
  const cs = getComputedStyle(e);
  return { op: cs.opacity, anim: cs.animationName };
});
ok(d0.op === '0' && d0.anim === 'none', `不带 .on 时是看不见的（opacity=${d0.op} animation=${d0.anim}）`);
// ⚠️ 几何必须在**看得见的时候**量：`display:none` 的元素矩形是 0×0×0×0，
//    量出来永远是 0 —— 上一版就是先把它藏了再量，于是三条全错。
const hint = await p.evaluate(() => {
  const e = document.querySelector('#shelfHint');
  e.hidden = false; e.classList.add('on');
  const anim = getComputedStyle(e).animationName;
  // ⚠️⚠️ 量几何之前**必须把动画冻住**：`.on` 一加上就开始跑 hintpop（1s），
  //    元素正在被 translate/scale ⇒ 量到的是**某一帧**的位置。
  //    同一个页面两次跑会给出不同的数（实测同一条缝隙量到过 45 和 48），
  //    而「读数在抖」和「布局真的不对」在输出里长得一模一样。
  const keep = e.style.animation;
  e.style.animation = 'none';
  const i = document.querySelector('.hinticon').getBoundingClientRect();
  const pill = document.querySelector('#shelfToggle').getBoundingClientRect();
  e.style.animation = keep;
  const hasUse = !!document.querySelector('.hinticon use');
  e.classList.remove('on'); e.hidden = true;      // ⚠️ 用完必须还原，否则污染后面的断言
  return { anim, hasUse, iconW: Math.round(i.width), 在左: i.left < pill.left, 缝隙: Math.round(pill.left - i.right) };
});
ok(hint.anim === 'hintpop', `加上 .on 会跑「跳出来」那套动画（${hint.anim}）`);
ok(hint.hasUse && hint.iconW > 10, `指针是手绘那支图标、而且真的画出来了（${hint.iconW}px）`);
ok(hint.在左 && hint.缝隙 < 30, `指针在货架**左边**并且挨着它（缝隙 ${hint.缝隙}px）—— 指向货架，不是指离它`);

console.log('\n▸ 粘贴：外面复制的东西直接进得来');
const before = await p.$$eval('#shelfbody .sitem', (e) => e.length);
await p.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/plain', '从外面粘进来的一段话');
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await p.waitForTimeout(400);
const after = await p.$$eval('#shelfbody .sitem', (e) => e.length);
ok(after === before + 1, `粘一下多了一项（${before} → ${after}）`);
ok(!(await p.$eval('#shelf', (e) => e.classList.contains('folded'))), '而且货架自己展开了（不用再点一下）');
// ⚠️ 负向对照：在输入框里按 ⌘V 是「粘文字」，不是「放货架」。抢了它，用户会觉得粘贴坏了。
await p.click('.thumb[data-m="text"]'); await p.waitForTimeout(300);
await p.click('#tinput'); await p.waitForTimeout(150);
const n2 = await p.$$eval('#shelfbody .sitem', (e) => e.length);
await p.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/plain', '这段应该老老实实粘进输入框');
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await p.waitForTimeout(300);
const n3 = await p.$$eval('#shelfbody .sitem', (e) => e.length);
ok(n3 === n2, `⚠️ 负向对照：光标在输入框里时**不抢**粘贴（${n2} → ${n3}，没变）`);

console.log('\n▸ 拖文件 / 图片进来');
await p.evaluate(() => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const f = new File([png], '被拖进来的图.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(f);
  document.querySelector('.flowcanvas, #flowcanvas, body').dispatchEvent(
    new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
});
await p.waitForTimeout(700);
const thumbs = await p.$$eval('#shelfbody .sthumb', (e) => e.length);
ok(thumbs >= 1, `图片进了货架并且带缩略图（${thumbs} 张）`);

console.log('\n▸ 用过一次就不再打扰');
const learned = await p.evaluate(() => localStorage.getItem('c4emem.shelfLearned'));
ok(learned === '1', '「学会了」这个标记被写了下来');
const hintHidden = await p.evaluate(() => document.querySelector('#shelfHint').hidden);
ok(hintHidden, '指针立刻收起来了');

console.log('\n▸ 货架自己的帮助弹窗');
await p.click('#shelfHelp'); await p.waitForTimeout(400);
ok(!(await p.$eval('#shelfhelp', (e) => e.hidden)), '「?」打得开');
const ht = await p.$eval('#shelfhelp .mbox', (e) => e.textContent);
for (const kw of ['拖', '复制', '图片', '结构流', '送去回答', '只在本机']) ok(ht.includes(kw), `讲清楚了「${kw}」`);
await p.screenshot({ path: 'out/s1-shelfhelp.png' });
await p.keyboard.press('Escape'); await p.waitForTimeout(250);
ok(await p.$eval('#shelfhelp', (e) => e.hidden), 'Esc 关得掉');

console.log('\n▸ 写回 Notion：一列条目、自己勾、各回各自的页面（绝不真的写）');
await p.click('.thumb[data-m="flow"]'); await p.waitForTimeout(500);
const noSrc = await p.$eval('#flowlist .blk[data-id="b2"]', (e) => e.querySelector('.bsrc').classList.contains('inherit'));
ok(noSrc, '「写回 Notion」没标来源 —— 正是要走自动分类的情形');
await p.click('#flowrun');
// ⚠️ 等条件不等固定秒数：「没等够」和「功能坏了」在输出里长得一模一样。
await p.waitForFunction(() => {
  const m = document.querySelector('#writemodal');
  const out = document.querySelector('#flowout');
  return (m && !m.hidden) || /失败|取消|没写/.test(out.textContent);
}, null, { timeout: 120000 }).catch(() => {});
await p.waitForTimeout(500);

const wm = await p.$eval('#writemodal', (e) => !e.hidden);
ok(wm, '复核台弹出来了（不是直接写、也不是一句"确认吗"）');
if (wm) {
  const rows = await p.$$eval('.wrrow', (els) => els.map((r) => ({
    checked: r.querySelector('input').checked,
    page: r.querySelector('select').value,
    opts: [...r.querySelectorAll('select option')].length,
  })));
  ok(rows.length >= 1, `列出了 ${rows.length} 条待写内容`);
  ok(rows.every((r) => r.checked), '默认全勾上（要排除的自己取消）');
  ok(rows.every((r) => r.opts >= 4), `每条都能改页面（选项数 ${rows[0].opts}）`);
  // ⚠️ 负向对照的反面：**判不出来的不能偷偷补个默认值**，要留空让人选
  const blank = rows.filter((r) => !r.page).length;
  const hint = await p.$eval('#wrHint', (e) => e.textContent);
  ok(blank === 0 || /没判出来/.test(hint), `判不出来的会如实标出来（${blank} 条留空 / 提示里${/没判出来/.test(hint) ? '有' : '没有'}说明）`);
  ok(/by cevtuo c4emem AI/.test(await p.$eval('#wrHint', (e) => e.textContent)), '讲明正文前会自动加标记');
  await p.screenshot({ path: 'out/s1-writeback.png' });

  // 全不选 / 全选
  const lbl0 = await p.$eval('#wrWrite', (e) => e.textContent.trim());
  ok(/写入 \d+ 条/.test(lbl0), `按钮上写着要写几条（${lbl0}）`);
  await p.click('#wrNone'); await p.waitForTimeout(200);
  const lblN = await p.$eval('#wrWrite', (e) => e.textContent.trim());
  ok(lblN === '选一个再写', `全不选之后按钮不许写（${lblN}）`);
  ok((await p.$$eval('.wrrow input', (es) => es.filter((e) => e.checked).length)) === 0, '「全不选」真的全不选');
  await p.click('#wrAll'); await p.waitForTimeout(200);
  ok(/写入 6 条/.test(await p.$eval('#wrWrite', (e) => e.textContent)), '全选之后计数跟着回来了');
  ok((await p.$$eval('.wrrow input', (es) => es.filter((e) => e.checked).length)) === rows.length, '「全选」真的全选');

  // 取消 → 一条都不许写
  await p.click('#wrCancel'); await p.waitForTimeout(1200);
  // ⚠️⚠️ 判据读的地方换过一次，这里说明白：
  //    `#flowout`（底栏那行）**按设计只有一句摘要** —— `✓ N 块 · X.Xs`，
  //    "你取消了，N 条都没写"这句在**运行记录面板**里（`#frlog`）。
  //    原来的断言死盯 `#flowout` 找「取消」，于是产品明明说对了它也红
  //    （实测：底栏就是 `✓ 2 块 · 3.8s`，一个字都不差）。
  //    ⇒ 判据要打在**那句话真正待着的地方**。
  const st = await p.$eval('#flowout', (e) => e.textContent);
  const log = await p.$eval('#frlog', (e) => e.textContent);
  const all = st + '\n' + log;
  ok(/取消/.test(all), `取消之后如实说一条都没写（底栏「${st.replace(/\s+/g, ' ').slice(0, 30)}」· 记录里「${(log.match(/[^✓✗]*取消[^✓✗]*/) || [''])[0].trim().slice(0, 40)}」）`);
  ok(!/已写回|写了 \d+ 条/.test(all), '⚠️ 负向对照：取消的路径上确实没有写入');
  // ⚠️ 再钉一条：这句话**必须落在记录面板里**（底栏只有摘要是有意为之，
  //    不是为了把"没说"混过去）。少了这条，"取消"可能跑到别处而没人管。
  ok(/取消/.test(log), '⚠️ 而且它就在「这次跑了什么」那块记录里（不是散在别处）');
}

console.log(`\n${pass} 通过 / ${fail} 失败` + (errs.length ? '\n⚠️ 页面报错: ' + errs.slice(0, 4).join(' ;; ') : '\n✅ 无页面报错'));
await b.close();
process.exit(fail ? 1 : 0);
