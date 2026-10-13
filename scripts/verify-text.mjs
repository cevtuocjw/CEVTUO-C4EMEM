/**
 * 界面上**不许出现字面的 markdown 星号**（`**粗体**`）。
 *
 * ⚠️⚠️ 这是**同一个坑栽的第三次**：
 *   · 部署页（`apps.cevtuogrnd.com/c4emem/`）栽过 **31 处**（见 HANDOFF-NEXT §6.4）
 *   · 2026-10-12 真机截图里，设置抽屉的「桌面 CEVTUO Pet」那一块又露出 **9 个星号**
 *     （`**鼠标放上去**` 就这么原样显示）。
 *   根因永远一样：**那些字符串是 HTML，不是 markdown**，浏览器按字面渲染。
 *   ⇒ 靠"我这次记住了"没用（记过两次），得**让机器每次扫一遍**。
 *
 * 为什么是**静态扫源码**而不是打开页面看：
 *   这些文案散在 19 个地方（抽屉 / 断开确认 / 主动式 / 相册 / 按软件 / 自我改进 / 同步…），
 *   好几个要先把某个弹窗点出来才渲染。静态扫一趟全覆盖，而且**不依赖任何状态**。
 *
 * ⚠️ 判据只打在**会渲染的那一类行**上，所以三条排除规则都要写清楚（不然全是假红）：
 *   ① 注释行（`//` / `*` / `/*`）—— 注释里写 `**` 是**故意的**（这个项目的注释风格）；
 *   ② `**` 出现在 `//` **之后**的行（行尾注释）；
 *   ③ 发给模型的提示词（`q:` / `prompt:` 那种）—— 那里的 markdown 是**要**给模型看的。
 *
 * 跑：`bun scripts/verify-text.mjs`
 * 负向对照：`NEGCTL=1 bun scripts/verify-text.mjs` —— 把一处 `**` 放回去，必须**报红**。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const DIR = '/Users/cjw/Documents/Cevtuo-C4emem/src/ui';
const NEGCTL = process.env.NEGCTL === '1';
/** 负向对照要动的那个文件/那一行（挑一处**确定会渲染**的文案） */
const NEG_FILE = DIR + '/app.js';
const NEG_FROM = '<div class="d">在桌上放一个小家伙：<b>鼠标放上去</b>';
const NEG_TO = '<div class="d">在桌上放一个小家伙：**鼠标放上去**';
/** 提示词那类属性名 —— 它们里面的 markdown 是给模型看的，不算 bug */
const PROMPT_PROP = /^\s*(q|prompt|sys|system|instruction|instructions|messages?|body)\s*:/;

let backup = null;
if (NEGCTL) {
  backup = readFileSync(NEG_FILE, 'utf8');
  if (!backup.includes(NEG_FROM)) { console.log('负向对照：锚点没匹配上 ⇒ 对照没生效，退出'); process.exit(2); }
  writeFileSync(NEG_FILE, backup.replace(NEG_FROM, NEG_TO));
  console.log('⚠️ 负向对照 1：已把一处字面 ** 放回「桌面 CEVTUO Pet」那块文案里（跑完会还原）\n');
}

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (extra ? '  ' + extra : '')); }
};

/** 一行要不要当"会渲染的文案"来查 */
function rendered(line) {
  const s = line.trim();
  if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*') || s.startsWith('<!--')) return false;
  if (PROMPT_PROP.test(line)) return false;
  const at = line.indexOf('**');
  if (at < 0) return false;
  const slashes = line.indexOf('//');
  if (slashes >= 0 && slashes < at) return false;      // 行尾注释
  if (!/[一-鿿]/.test(line)) return false;     // 去掉 `**/glob` 那种纯代码
  if (/\*\*\/|\s\*\*\s*[0-9(]/.test(line)) return false;
  return true;
}

try {
  const files = readdirSync(DIR).filter((f) => /\.(js|html)$/.test(f));
  ok('扫到了 ui 目录下的源码（不是空扫）', files.length >= 5, files.length + ' 个文件');
  let total = 0;
  const bad = [];
  for (const f of files) {
    const lines = readFileSync(DIR + '/' + f, 'utf8').split('\n');
    let inHtmlComment = false, inBlockComment = false;
    lines.forEach((line, i) => {
      // 多行注释都要**带状态**跳（开、闭常常不在同一行）：
      //   `.html` 里两种 —— `<!-- -->`（页面注释）和 `/* */`（`<style>` 里的）；
      //   `.js` 里一种 —— `/* */` 块注释。
      // ⚠️ 不跳的话，`pet.html` 讲几何的 CSS 注释、`pet.js` 头部的模型说明
      //    会**整段被当成文案报红**（第一次跑就是 19 处假红 —— 检查器自己的 bug，
      //    别去调判据）。
      // ⚠️⚠️ JS 那边**只认"整行以 `/*` 开头"**那一种（这个项目的写法）：要是把字符串里的
      //    `/*` 也当成注释开头，认错一次之后**后面整段都被跳过 ⇒ 真的 `**` 会被静默漏掉**。
      //    漏报比误报危险得多（"全绿"读起来像"查过了"）。
      if (f.endsWith('.html')) {
        if (inHtmlComment) { if (line.includes('-->')) inHtmlComment = false; return; }
        if (inBlockComment) { if (line.includes('*/')) inBlockComment = false; return; }
        if (line.includes('<!--') && !line.includes('-->')) { inHtmlComment = true; return; }
        if (line.includes('/*') && !line.includes('*/')) { inBlockComment = true; return; }
      } else {
        if (inBlockComment) { if (line.includes('*/')) inBlockComment = false; return; }
        if (line.trimStart().startsWith('/*') && !line.includes('*/')) { inBlockComment = true; return; }
      }
      if (rendered(line)) { total += 1; bad.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 80)); }
    });
  }
  // ⭐ 汇总行要**带数**：只写"通过"的话，"一处都没有"和"根本没扫到"长得一样
  ok('会渲染的文案里没有字面的 **（扫了 ' + files.length + ' 个文件）', total === 0,
    total + ' 处，前几处：\n      ' + bad.slice(0, 6).join('\n      '));
} catch (e) {
  fail++;
  console.log('  ✗ 跑不起来：' + e.message);
} finally {
  if (backup != null) { writeFileSync(NEG_FILE, backup); console.log('（负向对照已还原 app.js）'); }
}

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
