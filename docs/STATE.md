# C4emem 状态压缩 —— **从这里开始读**

> 这份是 2026-10-10 傍晚对整个项目的**压缩**。更细的历史在
> `docs/HANDOFF.md`（很长，按时间倒着读）和 `docs/handoff-2026-10-09*.md`。
> 项目：`~/Documents/Cevtuo-C4emem`（**不是 git 仓库**，没有 `.git`）。

---

## 0. 怎么跑

```bash
cd ~/Documents/Cevtuo-C4emem
lsof -nP -iTCP:8770 -sTCP:LISTEN                                # 在不在
nohup bun run src/server.ts > /tmp/c4emem-server.log 2>&1 &     # ⭐ server.ts，不是 cli.ts
curl -s -m 3 http://127.0.0.1:11434/api/tags | head -c 40       # ollama（没起就只剩关键词腿）
```

- ⭐ **`src/ui/*` 每次请求现读** ⇒ 改了刷页面就生效；**改 `src/server.ts` / `src/*.ts` 必须重起**。
- 跑浏览器验证：`env -u HTTPS_PROXY … NO_PROXY='*' bun scripts/verify-XXX.mjs`（**代理全关**）。
  ⚠️ **一轮最多跑 2 个套件**（多了被 SIGKILL，exit 137）。
- 截图脚本：`scripts/shot-pet.mjs`（语音屏 + Pet）、`scripts/shot-app.ts`。
- **一轮的工具调用上限是 150**（不是 Claude Code 设置，是 `~/.costguard/guard.py`）。

---

## 1. 它是什么

本地优先的**个人知识库 AI 助手**。两段式：
**Bun 核心 HTTP 服务（127.0.0.1:8770）** + **Swift 菜单栏 App**（`app/C4ememApp.swift`，薄壳，只负责拉服务 / 开窗口 / 常驻菜单栏）。

知识源：Notion 四库 891 段、企业邮箱（腾讯企业邮 IMAP）、Figma / 手机(ADB) / 飞书（**诚实的桩**）。
检索：FTS5(trigram) + 向量（本机 ollama `qwen3-embedding:0.6b`）两条腿，RRF 融合。

**四个界面模式**（右上角三颗灯 + 结构流）：**语音 / 文字 / 结构流**（都在 `#m-voice` `#m-text` `#m-flow`），
其余知识类视图落在 `#m-kb` 里。

---

## 2. 文件地图（改了要重起服务的那几个标 ★）

| 路径 | 是什么 |
|---|---|
| ★ `src/server.ts` | 所有 HTTP 路由（1291 行 → 现在更多）。`/api/**` 全在这一个文件里，按 `if (p === '/api/xxx')` 排 |
| ★ `src/features.ts` | **功能注册表**：内置功能 / 可装目录 / 暂时关闭 / 卸载保留 30 天 / 主动式标记 / 断开来源 |
| ★ `src/running.ts` | 正在运行的桌面 App（`lsappinfo` 的 `type="Foreground"`）+ 切过去 + 图标缓存（`sips` 转一次落盘） |
| ★ `src/panel.ts` | 工作区「主动给你留的」待办板（`panel` 表，状态 new/done/skipped） |
| ★ `src/proactive.ts` | 主动式三层：检测(原生) / 决策(规则) / 生成(LLM) |
| ★ `src/store/db.ts` | SQLite：`activity`（流水，只增）/ `panel`（待办板）/ `blocks` / 会话 |
| `src/ui/app.js` | **前端全部**（4000+ 行）。`navBtn`/`renderNav`、`renderKb`、`panelCard`、`renderPet`、`KINDS`（结构流块） |
| `src/ui/app.css` | 全站样式（1500+ 行） |
| `src/ui/app.html` | 骨架（侧栏/记录栏/三个模式/货架/Pet/设置抽屉） |
| `src/ui/icons.js` | **48 张手绘黑描边 SVG sprite**（不用 emoji 的理由见 FACT） |
| `src/ui/orb.js` | 语音光球（WebGL 着色器那一路） |
| `src/ui/vkey.js` | **矿物白底抠图**（一帧一次 WebGL，按到白色的距离） |

---

## 3. 已完成（近期，都验证过）

| 事 | 判据 / 套件 |
|---|---|
| **卡片"有背景+宽高比错"** | 根因：`.petbody.card`/`.orbbg.card` 撞上第 213 行**通用** `.card{background;padding:14px 16px}` ⇒ 改类名 `ptcard`/`ckon` |
| **银铅锌白底抠掉** | `src/ui/vkey.js`；`verify-mineral-key.mjs` **25/25** + 负向对照 6 红 |
| **矿物动画"后边太快/抽风/接不上"** | 真因：原 mp4 **每帧 `pkt_pts_time` 都是同一个值**（没时间轴）⇒ 重建 24fps + **正放倒放来回**，文件 `mineral-*-loop.mp4` |
| **卡片质感/厚度** | 层数 10→18、半厚 4→6px、亮度梯度 .22→.30；厚度走 `--ckz` **按尺寸缩放** |
| **Pet 卡片** | 72×112→**58×90**；复用大球多层卡 `scale(.305)`，±26° 慢慢摆 |
| **功能管理** | 点 × = 二选一（暂时关闭 / 卸载）；卸装保留 30 天一键装回；内置只给"暂时关闭"；`verify-manage.mjs` **34/34** + 负向对照 2 红 |
| **处理了 vs 略过** | 根因：CSS 里**两个状态共用一条规则**。现在 done=划掉+柠檬绿+✓，skipped=不划掉+收成一行+灰虚边 + 四段筛 |
| **主动式标记** | `Feature.proactive/proactiveOn/proactiveNote`；只读功能**不给勾**；勾了会**真的进生成提示词**（`proactiveMarks`） |
| **Pet 点一下弹一圈正在运行的软件** | `lsappinfo` 过滤（`ps` 给 71 个，大半是后台代理）⇒ 实测 12 个；图标 `/api/appicon`。`verify-pet.mjs` **31/31** |
| **拖东西到 Pet = 进货架** | drop 抽成 `shelfDropHandler`，货架和 Pet 共用一份 |
| **记录栏搜索 + 批量删除** | `POST /api/activity/delete`（**只删流水不删会话**）；本地按词筛 |
| **搜索归 Notion** ⚠️ **读者要求改回「跨来源」** | `features.ts` 里 `{id:'search', source:'notion'}` ← **要改回 `'all'`** |
| `让它想办法` → `让我想办法` | ✅ |
| `verify-ui` **44/44** | 无回归 |

---

## 3.5 已完成（2026-10-10 傍晚这一批）

- ✅ **背景设置**：加了「保存」键 + 回车保存 + 就地提示（原来只挂 `onchange`＝失焦才存）
- ✅ **窄屏遮罩**：`body.narrow .tbar,.flowbar{padding:0 68px}` —— 语音那屏早就修过，文字/结构流这两条是漏的（三份底栏各写各的）
- ✅ **Pet**：银铅锌**底色去掉了**（`.petbody.mono img{background:none}`，上一版我理解成"换个好看的底色"，错了）；卡片**地面投影去掉**（`.petbody.ptcard .ck .sh{display:none}`）；首字母角标改成**右下角小角标** + 设置里开关 `petletters`
- ✅ **搜索**：`source` 改回 `'all'`（跨来源）；**点命中卡 → 弹全文**（`#hitview`，不截断可滚动）+ 「打开 Notion / 企业微信」一键跳回去
- ✅ 顺带修掉一个**我自己引入的**静默 bug：`lastHits = xs` 写到了 `hitCards` 外面 ⇒ 整个搜索视图抛 `xs is not defined`，页面永远停在「搜「…」…」
- ⚠️ **未验证**：`activateApp` 改成 `osascript … activate` + `open -a` 两条一起下（原来只 `open -a`，而且**把错误吞掉了**）—— 逻辑对但**没有真的在一个 App 上按过**，下次试一下"能不能把窗口提到最前"。

---

## 4. 本轮待办（读者 2026-10-10 傍晚，按他给的顺序）

1. ~~背景设置~~ ✅ 已做（见 3.5）
2. ~~窄屏遮罩~~ ✅ 已做（见 3.5）
3. **Pet**：
   - 银铅锌**底色还是黑的**（应该完全没底色）—— 现在 `.petbody.mono img{background:radial-gradient(...)}`，读者要的是**没有底色**；
   - **卡片底部阴影别加**（`.petbody.ptcard` 已经 `filter:none`，但 `.ck .sh` 那个地面投影还在）；
   - 那一圈的**字母标记看不清 logo** ⇒ 改小，或**设置里给一个开关**关掉；
   - ⚠️ **点那些软件跳不过去**（`/api/apps/activate` 用 `open -a`，实测没把窗口调到最前）。
4. ~~搜索放回跨来源 + 点开全览~~ ✅ 已做（见 3.5）
5. **结构流大改**（最大的一块）：
   - 学 Tuna：**给固定格子**，按 **事件 → 主语 → 谓语 → 宾语** 顺序填，用户照着填；
   - **快捷键切换框架块**；
   - **没填完也能跑**能跑的部分；最后 **Enter 就开跑**；
   - **块之间可以连线**（这一块的输出接到下一块）；
   - 能**再起一张工作表**（另一组事件/主/谓/宾）；
   - 有**自我改进能力**：一部分默认块 + **可增删的块库**。
6. **接入不该是默认的**：Notion / 模型 / 本地模型都要**像新用户那样自己填**（他要打包成 app 给各种人用）。
   ⇒ 现在 `c4emem.config.json` / `~/.c4emem/settings.json` 里已经有他的真实值，要不要**清成模板**由他定。

---

## 5. 关键决定（别推翻）

- **归属照实写，分区另外指定**：`source`（角标，只用来显示）和 `section`（侧栏分区）是**两个字段**。
  新加的 schema 字段必须在 `features.ts` 的 `loadStore` 里**显式读出来** —— 漏一行就是"写完立刻读就没了"，且不报错。
- **`navHidden`**：语音/文字/结构流/用量**不上侧栏**（前三个有右上角三颗灯，用量在设置里）。
- **面板 ≠ 流水**：`activity` 只增不改，`panel` 是待办板（`INSERT OR IGNORE`，状态不被刷新重置）。
- **卸载可逆、关闭可逆**：卸载 → 待安装 30 天；暂时关闭 → 仍算装着，只是侧栏不画。
- **内置功能只能"暂时关闭"**，给"卸载"是在撒谎（代码在仓库里）。
- **删除永远不静默**：能删的都要能一键装回来；删了就说删了什么。

---

## 6. 反复踩的坑（写代码前扫一眼）

1. **同特异型看顺序** —— 栽过**七次**。加覆盖规则先去 dist/文件里 `grep` 那个选择器有几条、谁最后。
2. **改一条已有规则时，没重声明的属性等于没动** —— 不想继承的**全部显式重置**。
3. **类名撞车**：`.card` / `.petbody.card` 那种通用类，会被别处的通用规则静默改掉。
4. **量具坏了会被读成产品坏了**：
   - `canvas.toDataURL()` 从外面读 = **已被合成器清空的缓冲**（`preserveDrawingBuffer:false`）⇒ 只能在同一 JS 任务里 `readPixels`；
   - 祖先上的 `filter` **把 3D 压平**、`backdrop-filter` 会成为 fixed 后代的**包含块**；
   - `display:none` 的祖先会让子元素的 computed `display` 也变成 none（过滤器容易被假绿）。
5. **网格隐式行按内容撑** ⇒ 比格子大的子元素会**掉到容器外面**（Pet 卡片就是这么"消失"的）。
6. **断言全绿 ≠ 在测东西**：每条断言都要能回答"**它怎么才会红**"；负向对照**只动被测那一侧**。
7. **退化的数据骗得过"单调/在范围内"**：常数序列必须再加一条"它至少有 2 个不同的值"。
8. **自制容器拆出来的媒体要验时间轴**，不能只看"能播"。


---

## 3.6 已完成（2026-10-10 深夜这一批）

- ✅ **Pet 改成"鼠标放上去展开"**：`mouseenter` 开、`mouseleave` **延时 260ms** 再关
  （⚠️ 不延时的话，指针从 Pet 移到圈里图标上时会先离开 Pet ⇒ 那一圈在你手底下消失 ⇒ 看起来像"没做"）。
  **点**仍然能开关，右键不再切形态。
- ✅ **右键 Pet = 那一整套设置**：`openPetSettings()` 打开抽屉 + 滚到 `#secpet` + 闪一下。
  已挂到 `window.__app.openPetSettings`，**原生桥也会调它**。
- ✅ **⭐ CEVTUO Pet 真的到桌面了**（不再是窗口里的浮层）：
  - 新页 `src/ui/pet.html` + `src/ui/pet.js`（**自足**，不依赖 app.js）
  - Swift 侧 `togglePet()`：**无边框 / 透明 / `.floating` / 跟 Space 走** 的独立窗；
    菜单栏新增「桌面 CEVTUO Pet」（⌘P）
  - 透明**三处一起**才成立：`isOpaque=false` + `backgroundColor=.clear` + WebView `drawsBackground=false`；
    `hasShadow=false`（无边框窗的投影会围出一个方框）
  - 窗口**两种尺寸**：平时 300×440（它 + 头顶泡泡），展开那一圈时 520×560。
    ⚠️ 锚点是"**左下角原点不动、宽高变大**"（`.pet` 贴的是 right/bottom），
    只改 y 会让小家伙在展开的一瞬间往下跳。
  - 拖 = 网页把**位移** postMessage 给 Swift（网页挪不动原生窗口）；`dy` 要**取反**
  - `bash app/build.sh` 编译通过（128K）
- ✅ **ADB 文件能力**：`src/sources/adbfs.ts` + `/api/adb/{status,ls,read,pull,rm}`。
  **实测连到你手机**（无线 ADB），`/sdcard/Download` 列得出真文件。
  写/删**必须 `confirm:true`**，而且删之前先 `[ -e ]` 确认它在（`rm -rf` 对着拼错的路径也返回 0）。
- ✅ **提案提示词修了一个真实答错**：AndroMeld 那条回的是"工具类接不了" —— 对**"当来源"**是对的，
  但你要的是**"当能力"**（用 ADB 去读写手机文件）。现在提示词**明确分开这两件事**，
  并要求先找 CLI/API/自动化接口，只有两样都想不到才说接不了。
- ✅ **AndroMeld ≡ 手机（同一个源）**：`apps.ts` 的 KNOWN 加了 `/andromeld/i → 'phone'`，
  实测 `/api/apps` 里 AndroMeld 已标成 `phone`。

**验证**：`verify-pet` **31/31**（已按新口径改成"移上去展开 / 移开收回"）。

---

## 4. 还没做

1. **结构流大改**（最大的一块）：固定格子按 **事件→主语→谓语→宾语** 填、快捷键切换框架块、
   没填完也能跑、**Enter 开跑**、块之间**连线**、能**再起一张工作表**、块库可增删。
2. **接入不默认**：Notion / 模型 / 本地模型要像新用户那样自己填（打包成 app 给各种人用）。
3. 手机文件能力**还没接进界面**（现在只有 API；结构流里还没有"手机文件"这个块，
   界面上也没有一个"手机文件"的视图）。
4. `activateApp` 改成 `osascript activate + open -a` 之后**没有真的在一个 App 上验过**。


---

## 3.7 已完成（2026-10-10 深夜第二批）

- ✅ **Pet 拖拽"先拽出一张图片才跟上"** —— 根因是 **`<img>` 天生可拖**：
  按住 Pet 时浏览器先起了一个 HTML5 拖拽（拖着 card.png 的虚影）。
  修：`.petbody img,.ck,.petring img{-webkit-user-drag:none}`。
  **桌面那个小窗**再进一步：`pointerdown` 时把这次 mousedown **原样交给 AppKit**
  （`petWindow.performDrag(with: NSApp.currentEvent!)`）⇒ 零延迟；位移那条老路留作兜底。
- ✅ **鼠标移过去反复跳** —— 根因：那一圈悬在 `#pet` **外面**，指针移到图标上会**穿出边界**
  ⇒ `mouseleave` 立刻关 ⇒ 再进再开，一秒好几下。
  修：判据换成**几何**（离 Pet 中心 < 280px 就算在它这一带），主界面和桌面小窗同一套。
- ✅ **⭐ 桌面 Pet 真的在桌面上了（已实测确认）**：
  退出主窗口、只带 `--pet` 重启 ⇒ 截屏里那张卡**浮在别的 App 窗口上**，背景透明无白板。
  ⚠️ 关键是那行 `do { try wv.setValue(false, forKey: "drawsBackground") }` ——
  我第一版写成 `if wv.responds(to: Selector("setDrawsBackground:"))`，KVC 私有 key 对它**返回 false**
  ⇒ 整句被跳过 ⇒ WebView 留着白底 ⇒ **桌面上多一块白板**（而窗口确实开了，看着像"还是在窗口里"）。
- ✅ **软件清单每天自动重扫**：`apps.ts` 的 `cachedApps()` ——
  缓存落 `~/.c4emem/apps-cache.json`，**超过 24 小时自动重扫**；`?refresh=1` 强制。
  实测：第一次扫 115 个，第二次 `fromCache=true`。
  ⚠️ 判据是"24 小时"不是"进程启动时扫一次"——这服务常年开着，进程级缓存等于永远不更新。
- ✅ **手机信息 / 手机图片 两个视图**（新的内置功能 `phone`）：
  `adbInfo()` + `adbPhotos()` + `/api/phone/{info,photos,file}` + `kbView==='phone'`。
  **实测连到你那台真机**：`samsung SM-F9660 · Android 16 · 56% · 319G/459G`，
  相册列出 **48 张**（连 `/sdcard/Download/AndroMeld/` 里的截图也在），
  点一张**真的拉回来显示**（1628×1720）。
  ⚠️ 只列清单不预拉（一屏几十张 = 几十秒，看着像卡死）；⚠️ 缓存文件名用**远端路径的哈希**
  （用 basename 的话两个目录下的 `IMG_0001.jpg` 会互相覆盖）。
  ⚠️ `df -h /sdcard` 在 Android 上**数据行里没有 `/sdcard` 这三个字**，第一版按它找 ⇒ 存储那格一直是空的。

---

## 5. 打包 macOS App 的现状（读者要的下一步）

现在能跑：`bash app/build.sh` ⇒ `app/C4emem.app`（128K，菜单栏 App，会自动拉起核心）。
**离"发给别人"还差四件事**（按重要性）：
1. **核心要跟着打包**：现在 App 只是 `spawn("bun run src/server.ts")`，依赖用户机器上有 bun。
   要么用 `bun build --compile` 打一个单文件可执行，要么把 bun 运行时一起塞进 `Contents/Resources`。
2. **配置不能带我的值**：`c4emem.config.json` / `~/.c4emem/settings.json` 里有读者的真实
   Notion token、邮箱密码。要改成**首次启动引导**（他说的"把我当成一个用户"）。
3. **签名 + 公证**：现在是 `codesign --sign -`（自签），别人下载会被 Gatekeeper 拦。
4. **数据目录**用 `~/Library/Application Support/C4emem` 而不是 `~/.c4emem`（符合 Mac 惯例）。


---

## 3.8 桌面 Pet 的三个真问题都修好了（2026-10-10 深夜第三批）

读者原话：「依旧还是 cevtupet 跳」「**必须焦点在这个 cevtupet 上时候它才能**」
「点击软件图标就打开那个软件的窗口，也不能快捷键就打开」。

### ⚠️ 根因只有一个：**WKWebView 的悬停追踪只在窗口是 key 时有效**
`NSTrackingArea` 默认是 `.activeInKeyWindow` ⇒ 我们是刻意不抢焦点的
`.nonactivatingPanel` ⇒ **不点它一下，hover 事件一个都不发**。
症状就同时是"必须焦点在它上面才行"＋"点了图标没反应"（因为那一圈根本没真的开起来）。

**排查路径（值得记）**：
1. 先测服务端那条路 —— `curl /api/apps/activate` 回 `{"ok":true}`，osascript 也成 ⇒ **不是后端**
2. 再测网页那条路 —— Playwright 里点圈里的 Terminal ⇒ activity 出现「切到了 Terminal」⇒ **不是 JS**
3. 加日志到桥（`pet-bridge.log`）⇒ 只有 `togglePet 开窗 handler=true`，**`didReceive` 一次都没来**
4. 让页面自己回报桥在不在（新加 `/api/client-log`，网页侧的错一直没地方报）⇒ **`bridge=true`**
   ⇒ 桥在、但没人调它 ⇒ **是页面收不到 mousemove**

**修法**：
- Swift 用 `NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved])` **自己盯鼠标**，
  只在**状态翻转**时 `evaluateJavaScript("window.__petHover(...)")` 一次。
  ⚠️ 鼠标类全局监视**不需要辅助功能授权**（只有键盘类才需要）。
- `becomesKeyOnlyIfNeeded = false`（true 的话"只有控件需要时才成为 key"，而那一圈的按钮恰恰需要）
- 滞回：`R_OPEN=240 / R_CLOSE=380`（开和关**不能是同一个半径**）
- **拖动期间停掉悬停判断**（`petDragging` 标志）—— 窗口跟着鼠标走，距离一会儿进一会儿出，
  那就是"反复跳"的另一半原因
- **点击穿透**：菜单栏「Pet 点击穿透」（⚠️ 必须放菜单栏 —— 穿透之后它自己收不到任何点击，
  只能从菜单栏关回来）

**实测**：`resize open:1` 只来**一次**（不再反复），截图里 11 个真图标整圈显示在桌面上。

**顺带**：加了 `/api/client-log`（网页侧报错口子）和 `pet-bridge.log`（桥的日志）——
这两个以后排查"前端坏了 / 桥没通"能省掉上面第 1~4 步。
