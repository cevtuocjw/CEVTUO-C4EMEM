/**
 * 录**分发页**用的演示 —— 直接录 **webm**，不再走 GIF。
 *
 * ⚠️ 两条读者定过的规矩，这个文件就是为它们存在的：
 *   ① **不要录整个软件，只录那个功能点**（读者：「你的录制很多的需要那种只录功能点的地方，
 *      不是录整个软件，你要改进好，**通篇**」）⇒ 见下面的「摄影机」`cam()`。
 *      做法：给 `documentElement` 上 `zoom`，再 `scrollIntoView({block:'center'})` ——
 *      镜头就推近到那个面板/那一行。⚠️ 实测 `zoom` **不会**弄丢 `position:fixed` 的东西
 *      （货架球、来源扇区照样钉在角上），所以"镜头推到货架"这条能成立。
 *      ⚠️ 别自己算 `scrollBy(rect - innerWidth/2)`：`zoom` 之后 `innerWidth` 和
 *      `getBoundingClientRect()` **不在同一个坐标系里**（实测差一倍多），算出来永远偏。
 *      `scrollIntoView` 让浏览器处理这件事。
 *   ② **隐私第 0 秒就要挡住**（读者：「依旧有 Cherry Studio 被漏出来没挡住后边才挡住，
 *      要第 0 秒就开始挡住」）⇒ 右键清单/货架都是**后来才渲染**的，
 *      所以标记**每 350ms 重打一次**，不能只在开头打一遍。
 *
 * 跑：`bun scripts/record-demos.mjs [clipName ...]`（不给名字就全录）
 * 出：`/tmp/c4demos/<name>.webm` 和 `still-<name>.png`（静帧，用来**看图**判断录到没有）
 */
import { chromium } from '/Users/cjw/Documents/CEVTUO-Z/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync, unlinkSync, copyFileSync } from 'node:fs';

const BASE = process.env.C4_BASE || 'http://127.0.0.1:8770';
const OUT = '/tmp/c4demos';
const W = 1440, H = 900;
mkdirSync(OUT, { recursive: true });

const PRIVACY_CSS = `
  .__hide { visibility: hidden !important; }
  .__blur { filter: blur(7px) !important; }
  #shelfbadge, #shelfcount { visibility: hidden !important; }
`;

/**
 * 在页面里跑：给命中隐私规则的块打标记。⚠️ 只看**叶子**，容器不算（纪律 15）。
 * ⚠️ `closest()` 上爬**必须限高**：第一版爬上 `.card/.row/li/.blk` 这几个太通用的类，
 *    于是一整栏都被糊掉，看着像被审查过。规矩是「**只模糊 Cherry Studio（含它的图标）**，
 *    其余可以露」⇒ ① Cherry Studio 只糊它自己那一处、不爬行；② 真正该整块不拍的，
 *    上爬到"一行"就停，且行本身太大就不爬。
 */
const markPrivate = () => {
  const HIDE = /邮件|联系人|项目档案|待办|线程|公司|企业微信/;
  const rowOf = (el) => {
    const b = el.closest('.recrow, .lv, .item, li') || el;
    if (b === el) return el;
    const r = b.getBoundingClientRect();
    return (r.height > 220 || r.width > 760) ? el : b;
  };
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('#c4-icons')) continue;
    if (el.children.length !== 0) continue;
    const t = (el.textContent || '').trim();
    if (!t) continue;
    if (HIDE.test(t)) rowOf(el).classList.add('__hide');
    if (/Cherry Studio/i.test(t)) {
      el.classList.add('__blur');
      const img = el.parentElement && el.parentElement.querySelector('img');
      if (img) img.classList.add('__blur');
    }
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 每一个 locator 动作都给死短的 timeout —— 默认 30 秒会把一支录成 37 秒废片 */
const T = 2200;

const tools = (p) => ({
  async nav(name) {
    // ⚠️ 必须是 `button.nv`（导航项），不能只写 `button` —— 侧栏里还有**分区标题**
    //    （`button.sech`，文字像「主动 4」）。只写 button + hasText:'主动' 会先匹配到标题，
    //    点它只是折叠分组 ⇒ 画面纹丝不动，而日志里一点错都没有。
    await p.locator('#navsections button.nv', { hasText: name }).first().click({ timeout: T });
    await sleep(600);
  },
  /**
   * ⚠️⚠️ **用 `data-m` 定位 + 在页面里 `el.click()`，不做可点性检查。**
   *    2026-10-12 实测：`#modes .thumb` 单跑三次全过，可在录制里 `click()` 会
   *    **超时 2200ms**（`waiting for locator`）—— 它是普通按钮，`onclick` 就挂在上面，
   *    Playwright 那套「可点性」在这里只买来一种失败。
   *    按名字找也有坑：`hasText` 是**子串**匹配，`'语音'` 会连标题里的字一起算。
   */
  async mode(name) {
    const M = { 语音: 'voice', 文字: 'text', 结构流: 'flow' };
    const id = M[name] || name;
    const ok = await p.evaluate((m) => {
      const b = document.querySelector('#modes .thumb[data-m="' + m + '"]');
      if (!b) {
        // ⚠️ 量不到的时候**把看到的东西原样带出去**，别只回一个 false 让人对着空白猜
        return {
          err: 1,
          url: location.href,
          modesN: document.querySelectorAll('#modes').length,
          thumbsN: document.querySelectorAll('#modes .thumb').length,
          anyThumb: document.querySelectorAll('.thumb').length,
          mAttrs: Array.from(document.querySelectorAll('.thumb')).slice(0, 5).map((x) => x.dataset.m || '(无)'),
          app: !!window.__app,
          bodyHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 70),
        };
      }
      b.click();
      return { ok: 1 };
    }, id).catch((e) => ({ err: 2, why: String(e.message).slice(0, 80) }));
    if (!ok || ok.err) throw new Error('模式按钮 data-m=' + id + ' ⇒ ' + JSON.stringify(ok));
    await sleep(700);
  },

  /** ⭐ 每一步都报名字 —— 片子死掉时，日志里要说得出**死在第几步**。 */
  async step(label, fn) {
    const r = await Promise.resolve().then(fn).then(() => true).catch((e) => {
      console.log('   ⚠️ 第「' + label + '」步失败：' + String(e.message || e).split('\n')[0]);
      return false;
    });
    if (!r) throw new Error('死在这一步：' + label);
    return r;
  },
  async tryClick(sel, opts = {}) {
    return p.locator(sel, opts).first().click({ timeout: T }).then(() => true).catch(() => false);
  },
  async tryFill(sel, text) {
    return p.locator(sel).first().fill(text, { timeout: T }).then(() => true).catch(() => false);
  },
  /** ⚠️ `page.click()` 点的是元素中心，会被它自己的 `<svg>` 挡住 ⇒ 直接在页面里 `el.click()` */
  async forceClick(sel) {
    return p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel).catch(() => false);
  },
  /**
   * ⭐⭐ 摄影机：把镜头推近到某个元素上。
   * `z` 越大越近（1 = 原样，2 = 放大一倍）。
   */
  async cam(sel, z = 1.9) {
    await p.evaluate(([s, zz, w]) => {
      const root = document.documentElement;
      root.style.transition = 'zoom .55s cubic-bezier(.32,.72,0,1)';
      root.style.zoom = String(zz);
      const el = document.querySelector(s);
      // ⚠️ 比视口还高的元素（记录栏那种）就别追了 —— `block:'center'` 会把它顶到负座标，
      //    看起来像"镜头飘了"。这种只对齐上沿。
      if (!el) return;
      const r = el.getBoundingClientRect();
      const tooTall = r.height > w * 0.8;
      el.scrollIntoView({ block: tooTall ? 'start' : 'center', inline: 'center', behavior: 'smooth' });
    }, [sel, z, H]);
    await sleep(1000);
  },
});

/* ── 每一支的重头戏 ───────────────────────────────────────────────
   ⚠️ 步骤一律 `try` 包住：某一支的某一步不成立，**不该把整轮带走**。 */
const CLIPS = {
  // (1) 自我进化 —— 镜头只给"它给方案"那一块
  'g-selfimprove': async (p, t) => {
    await t.nav('自我改进');
    await t.cam('#m-kb', 1.55);
    await t.tryFill('textarea', '我想让它把这一周的笔记按主题聚拢成一张卡片');
    await sleep(1800);
  },
  // (2) 主动式
  'g-proactive': async (p, t) => {
    await t.nav('主动');
    await t.cam('#m-kb', 1.55);
    await sleep(1600);
  },
  // 语音 —— 只给那颗光球
  'g-voice': async (p, t) => {
    await t.mode('语音');
    await t.cam('#orbcard', 1.75);
    await t.tryClick('#mic');
    await sleep(1500);
    await t.tryClick('#mic');
    await sleep(600);
  },
  // 文字 —— 从输入框推到它的回答
  'g-text': async (p, t) => {
    await t.mode('文字');
    await t.cam('#tinput', 1.7);
    await t.tryFill('#tinput', '我最近在笔记里记过什么关于玻璃质感的？');
    await sleep(400);
    await t.tryClick('#tsend');
    await p.waitForFunction(() => (document.querySelector('#thread')?.innerText || '').length > 80, null, { timeout: 9000 })
      .then(() => true).catch(() => false);
    await t.cam('#thread', 1.5);
    await sleep(1500);
  },
  // ── 结构流：四支各演一件事，镜头只在画布上 ──────────────────
  'g-flow-modes': async (p, t) => {
    await t.mode('结构流');
    await p.evaluate(() => ['ev.manual', 'src.notes', 'act.summary', 'out.shelf'].forEach((k) => window.__app.addBlock(k)));
    await sleep(1200);
    await t.cam('#flowcanvas', 1.35);
    for (const l of ['nuggets', '3d', 'default']) {
      await t.forceClick('#flowstyle button[data-l="' + l + '"]');
      await sleep(1500);
    }
  },
  // ⭐ 三种线：普通 = 数据流、**Shift = 顺序**、**Alt = 条件**（app.js 1862 那三目）
  'g-flow-lines': async (p, t) => {
    await t.mode('结构流');
    await p.evaluate(() => ['ev.manual', 'src.notes', 'act.summary', 'out.shelf'].forEach((k) => window.__app.addBlock(k)));
    await sleep(1200);
    await t.cam('#flowcanvas', 1.35);
    const ids = await p.evaluate(() => window.__app.flow.map((b) => b.id));
    const clickSel = async (sel, mods = []) => {
      const pt = await p.evaluate((q) => {
        const e = document.querySelector(q);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, sel);
      if (!pt) return false;
      await p.mouse.click(pt.x, pt.y, { modifiers: mods });
      return true;
    };
    for (const [a, b, mods] of [[ids[0], ids[1], []], [ids[1], ids[2], ['Shift']], [ids[2], ids[3], ['Alt']]]) {
      await clickSel('#flowlist .port.out[data-b="' + a + '"]', mods);
      await sleep(450);
      await clickSel('#flowlist .port.in[data-b="' + b + '"]');
      await sleep(800);
    }
    await sleep(1000);
  },
  // ⭐ 没填完也能跑
  'g-flow-run': async (p, t) => {
    await t.mode('结构流');
    await p.evaluate(() => ['ev.manual', 'src.notes', 'out.notify'].forEach((k) => window.__app.addBlock(k)));
    await sleep(1100);
    await t.cam('#flowlist', 1.45);
    await p.locator('#flowlist [contenteditable="true"]').nth(1).click({ timeout: T }).catch(() => {});
    await p.keyboard.type('这一周关于玻璃质感的笔记').catch(() => {});
    await sleep(600);
    await t.forceClick('#flowrun');
    await sleep(2200);
  },
  // ⭐⭐ 从头做到尾那一支（分发页拿它当**大版面的背景**）
  'g-flow-full': async (p, t) => {
    await t.mode('结构流');
    await p.evaluate(() => ['ev.manual', 'src.notes', 'act.summary', 'out.shelf'].forEach((k) => window.__app.addBlock(k)));
    await sleep(1200);
    await t.cam('#flowlist', 1.4);
    for (const [i, txt] of [[1, '这一周关于玻璃质感的笔记'], [2, '把重复的并成三条']]) {
      await p.locator('#flowlist [contenteditable="true"]').nth(i).click({ timeout: T }).catch(() => {});
      await p.keyboard.type(txt).catch(() => {});
      await sleep(560);
    }
    const ids = await p.evaluate(() => window.__app.flow.map((b) => b.id));
    const clickSel = async (sel, mods = []) => {
      const pt = await p.evaluate((q) => {
        const e = document.querySelector(q);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, sel);
      if (!pt) return false;
      await p.mouse.click(pt.x, pt.y, { modifiers: mods });
      return true;
    };
    for (const [a, b] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[3]]]) {
      await clickSel('#flowlist .port.out[data-b="' + a + '"]');
      await sleep(420);
      await clickSel('#flowlist .port.in[data-b="' + b + '"]');
      await sleep(620);
    }
    await sleep(700);
    await t.forceClick('#flowrun');
    await p.waitForFunction(() => !document.querySelector('#flowruns')?.hidden, null, { timeout: 25000 })
      .then(() => true).catch(() => false);
    // 跑完把镜头挪到"运行记录"上 —— 过程才是重点，结果不是
    await t.cam('#flowruns', 1.6);
    await sleep(2200);
  },
  // 来源扇区 —— 只给那颗按钮和扇出来的那圈
  'g-sources': async (p, t) => {
    await t.cam('#fanbtn', 2.3);
    await t.forceClick('#fanbtn');
    await sleep(1700);
  },
  // 检索 —— 只给结果那一栏
  'g-search': async (p, t) => {
    await t.nav('搜索');
    await t.cam('#m-kb', 1.55);
    await t.tryFill('#m-kb input', '玻璃');
    await sleep(1800);
  },

  // ── 货架：每一支都**先给那个东西一个特写，镜头再跟到货架上** ─────
  'g-shelf': async (p, t) => {
    await t.cam('#loglist > *', 2);
    await sleep(700);
    // ① 从记录栏真的拖一条到货架
    await p.locator('#loglist > *').first().dragTo(p.locator('#shelf'), { timeout: 6000 }).catch(() => {});
    await sleep(700);
    await t.cam('#shelf', 2.3);            // ② 镜头跟着东西到货架
    await sleep(900);
    await t.forceClick('#shelfToggle');
    await sleep(700);
    await t.forceClick('#shelfFlow');      // ③ 再从货架送进结构流
    await sleep(900);
    await t.cam('#flowlist', 1.5);
    await sleep(1200);
  },
  'g-shelf-file': async (p, t) => {
    await t.forceClick('#shelfToggle');
    await t.cam('#shelf', 2.4);
    await p.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])], '会议记录.docx',
        { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      for (const ty of ['dragenter', 'dragover', 'drop']) {
        document.querySelector('#shelf').dispatchEvent(new DragEvent(ty, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
    });
    await sleep(1800);
  },
  'g-shelf-image': async (p, t) => {
    await t.forceClick('#shelfToggle');
    await t.cam('#shelf', 2.4);
    await p.evaluate(() => {
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKUlEQVR42mP8z8Dwn4EIwDiqkL4K' +
        'GYkxjKqkL6ajKhlGFRKXTEcVAgB0VQ1/8yQ0YwAAAABJRU5ErkJggg==';
      const bin = atob(b64); const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([u8], '界面截图.png', { type: 'image/png' }));
      for (const ty of ['dragenter', 'dragover', 'drop']) {
        document.querySelector('#shelf').dispatchEvent(new DragEvent(ty, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
    });
    await sleep(1800);
  },
  'g-shelf-paste': async (p, t) => {
    await t.forceClick('#shelfToggle');
    await t.cam('#shelf', 2.4);
    await p.evaluate(() => navigator.clipboard.writeText('（复制来的）这一段先搁进去，等想法成形再决定')).catch(() => {});
    await sleep(500);
    await p.keyboard.press('Meta+v');
    await sleep(1700);
  },
  'g-shelf-select': async (p, t) => {
    await t.cam('#loglist > *', 2);
    await sleep(600);
    await p.evaluate(() => {
      const el = document.querySelector('#loglist > *');
      if (!el) return;
      const r = document.createRange(); r.selectNodeContents(el);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    });
    await sleep(600);
    await t.cam('#shelf', 2.3);
    await t.forceClick('#shelfToggle');
    await sleep(1500);
  },
  // ⭐⭐⭐ **整软件的完整演示**（HANDOFF-NEXT §4③）——
  //    判据有两条，而且**两条都要**：① **≥60 秒**；② 里面**真的从头到尾跑完一次结构流**
  //    （不是把界面点开给人看）。镜头一路跟着走，不把整个软件摊在那儿。
  'g-tour': async (p, t) => {
    // ① 说一句 / 打一句 → 拿到答案
    await t.mode('语音');
    await t.cam('#orbcard', 1.5);
    await sleep(3000);
    await t.mode('文字');
    await t.cam('#tinput', 1.45);
    await t.tryFill('#tinput', '笔记里记过什么关于玻璃质感的？');
    await sleep(600);
    await t.forceClick('#tsend');
    await p.waitForFunction(() => (document.querySelector('#thread')?.innerText || '').length > 60, null, { timeout: 14000 })
      .then(() => true).catch(() => false);
    await t.cam('#thread', 1.3);
    await sleep(4200);

    // ①.5 来源：左下角那颗按钮扇出九个来源
    await t.cam('#fanbtn', 2.0);
    await t.forceClick('#fanbtn');
    await sleep(3200);
    await t.forceClick('#fanbtn');
    await sleep(700);

    // ② 检索
    await t.nav('搜索');
    await t.cam('#m-kb', 1.5);
    await t.tryFill('#m-kb input', '玻璃');
    await sleep(3600);

    // ③ 结构流：四块 → 三根线 → 跑完（这一段的判据是"跑完了"，不是"点开了"）
    await t.mode('结构流');
    await p.evaluate(() => ['ev.manual', 'src.notes', 'act.summary', 'out.shelf'].forEach((k) => window.__app.addBlock(k)));
    await sleep(1200);
    await t.cam('#flowlist', 1.4);
    for (const [i, txt] of [[1, '这一周关于玻璃质感的笔记'], [2, '把重复的并成三条']]) {
      await p.locator('#flowlist [contenteditable="true"]').nth(i).click({ timeout: T }).catch(() => {});
      await p.keyboard.type(txt).catch(() => {});
      await sleep(560);
    }
    const ids = await p.evaluate(() => window.__app.flow.map((b) => b.id));
    const hit = async (q) => {
      const pt = await p.evaluate((s) => {
        const e = document.querySelector(s); if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, q);
      if (!pt) return false;
      await p.mouse.click(pt.x, pt.y);
      return true;
    };
    for (const [a, b] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[3]]]) {
      await hit('#flowlist .port.out[data-b="' + a + '"]'); await sleep(420);
      await hit('#flowlist .port.in[data-b="' + b + '"]'); await sleep(620);
    }
    await t.forceClick('#flowrun');
    await p.waitForFunction(() => !document.querySelector('#flowruns')?.hidden, null, { timeout: 28000 })
      .then(() => true).catch(() => false);
    await t.cam('#flowruns', 1.6);
    await sleep(4200);

    // ④ 货架：把一条记录真的拖进去，再送进结构流
    await t.cam('#loglist > *', 1.9);
    await sleep(700);
    await p.locator('#loglist > *').first().dragTo(p.locator('#shelf'), { timeout: 6000 }).catch(() => {});
    await t.cam('#shelf', 2.1);
    await sleep(3200);
    await t.forceClick('#shelfToggle');   // ⚠️ 收起来 —— 开着会盖住下一步的解析框
    await sleep(600);

    // ⑤ 自我进化：跟它说一句，看它翻成一条**真操作**（只给方案，不执行）
    await t.nav('自我改进');
    await t.cam('#sicmd', 1.7);
    await t.tryFill('#sicmd', '把推荐关掉');
    await sleep(500);
    await t.forceClick('#sicmdgo');
    await sleep(13000);
    await sleep(2000);
  },

};

/* ── 桌面 Pet：**另一个页面**（`pet.html`），按真实窗口大小 440×520 录 ── */
const PET_CLIPS = {
  'g-wheel': async (p) => {
    const c = await p.evaluate(() => {
      const r = document.querySelector('#pet').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await p.evaluate(([a, b]) => window.__petMouse(a, b), [c.x - 380, c.y - 380]);
    await sleep(350);
    await p.evaluate(([a, b]) => window.__petMouse(a, b), [c.x, c.y]);
    await sleep(1500);
    // ⚠️ 指针必须停在**某一个扇区上**：随手偏一个数会落到环外 ⇒ 180ms 后自己收起
    const pt = await p.evaluate(() => {
      const r = document.querySelector('#pet').getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const el = document.querySelectorAll('#pwwheel .pwic')[1];
      if (!el) return null;
      const m = el.getAttribute('style').match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      return m ? { x: cx + Number(m[1]), y: cy + Number(m[2]) } : null;
    });
    if (pt) { await p.evaluate(([a, b]) => window.__petMouse(a, b), [pt.x, pt.y]); await sleep(1500); }
  },
  'g-quit': async (p, t) => {
    await p.evaluate(() => document.querySelector('#pet')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    await sleep(1200);
    await t.tryClick('#pwqall');
    await sleep(1400);
  },
  // ⭐ 五种外观：**同一个窗口里连着变**（pet.js 的 storage 监听会重画）
  'g-pet-forms': async (p) => {
    const setForm = (f) => p.evaluate((form) => {
      const cur = JSON.parse(localStorage.getItem('c4emem.pet') || '{}');
      localStorage.setItem('c4emem.pet', JSON.stringify({ ...cur, on: true, form }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'c4emem.pet' }));
    }, f);
    for (const f of ['pearl', 'silver', 'lead', 'zinc', 'card']) {
      await setForm(f);
      await sleep(1700);
    }
  },
};

const want = process.argv.slice(2);
const run = async () => {
  const br = await chromium.launch();
  const made = [];
  for (const [name, fn] of Object.entries({ ...CLIPS, ...PET_CLIPS })) {
    if (want.length && !want.includes(name)) continue;
    const isPet = name in PET_CLIPS;
    // ⚠️ Pet 那几支按**真实窗口大小**（440×520）录：用 1440×900 录的话宠物只占右下角一小块。
    const V = isPet ? { w: 440, h: 520 } : { w: W, h: H };
    const ctx = await br.newContext({
      viewport: { width: V.w, height: V.h },
      colorScheme: 'dark',
      recordVideo: { dir: OUT, size: { width: V.w, height: V.h } },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('c4emem.pet', JSON.stringify({ on: true, form: 'card' })); } catch { /* 无所谓 */ }
    });
    // ⚠️⚠️ **先拿一张"预热页"把 App 跑起来**：录像是从**建页那一刻**开始的，
    //    不预热的话片子前一大半全是加载画面。
    const warm = await ctx.newPage();
    const warmVid = warm.video();
    await warm.goto(BASE + (isPet ? '/ui/pet.html' : '/'), { waitUntil: 'load' }).catch(() => {});
    await warm.waitForFunction((pet) => (pet ? !!window.__petMouse : !!window.__app), isPet, { timeout: 25000 }).catch(() => {});

    const p = await ctx.newPage();
    const t = tools(p);
    let digest = '';
    try {
      await p.goto(BASE + (isPet ? '/ui/pet.html' : '/'), { waitUntil: 'load' });
      // ⚠️⚠️ 谓词是序列化后在浏览器里跑的，Node 的变量它看不到 —— 要**当参数传进去**。
      await p.waitForFunction((pet) => (pet ? !!window.__petMouse : !!window.__app), isPet, { timeout: 20000 });
      if (isPet) {
        await p.evaluate(() => {
          window.__bridge = [];
          window.webkit = { messageHandlers: { c4: { postMessage: (m) => window.__bridge.push(m) } } };
          // 真机上"键盘通没通"是原生推的；无头里没人推 ⇒ 会挂一句红字，是**在误导**。
          window.__petFocus && window.__petFocus(true, true);
        });
      }
      await p.addStyleTag({ content: PRIVACY_CSS });
      if (isPet) await p.addStyleTag({ content: 'html,body{background:#FFFCF8 !important}' });
      await p.evaluate(markPrivate);
      // ⚠️⚠️ **反复打标记**：右键清单/货架是后来才渲染的，只在开头打一次 ⇒ 那些行没被糊过
      //    （读者：「要第 0 秒就开始挡住」）。
      const privTimer = setInterval(() => { p.evaluate(markPrivate).catch(() => {}); }, 350);
      await sleep(400);
      await fn(p, t);
      await p.evaluate(markPrivate).catch(() => {});
      await sleep(800);
      await p.screenshot({ path: OUT + '/still-' + name + '.png' }).catch(() => {});
      digest = await p.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 110));
      clearInterval(privTimer);
    } catch (e) {
      digest = '⚠️ 出错：' + e.message.slice(0, 90);
    }
    const vid = p.video();
    await ctx.close();                      // ⚠️ 必须 close，webm 是这时才落盘的
    const src = await vid.path();
    if (src) { copyFileSync(src, OUT + '/' + name + '.webm'); made.push([name, digest]); console.log('✓ ' + name); }
    else console.log('✗ ' + name + '  没出文件');
    try { await warmVid.path().then((w) => w && unlinkSync(w)); } catch { /* 没有就算了 */ }
  }
  // ⚠️⚠️ **先把成绩单落盘，再去关浏览器。**
  //    2026-10-12 实测：片子 17:35:16 就写好了，而脚本一直挂到 17:46 —— 挂在 `br.close()` 上。
  //    顺序反了的话，一次「关不掉的浏览器」会让整轮结果读不到（看起来像什么都没录）。
  const lines = made.map(([n, d]) => `${n}\n    画面文字： ${d || '（空）'}`).join('\n');
  writeFileSync(OUT + '/index.txt', lines + '\n');
  console.log('\n──── 收尾时画面上的字 ────\n' + (lines || '（什么都没录到）'));
  await Promise.race([br.close().catch(() => {}), sleep(6000)]);   // 关不掉也要走
  process.exit(made.length ? 0 : 1);
};
await run();
