# C4emem 交接 —— **下一次从这里开始**

> 项目：`~/Documents/Cevtuo-C4emem`（**不是 git 仓库**，别指望 `git diff`）
> 更细的历史和 34 条踩坑：`docs/HANDOFF-NOW.md`（很长，需要时再翻）
> 这份只讲**现在的状态**和**接下来做什么**。

---

## 1. 现状一句话

**软件能跑、能打包、能分发、有介绍页了。** 剩下的全是"把演示和分发做得更好"。

| 东西 | 在哪 |
|---|---|
| 介绍页（**已上线**） | <https://apps.cevtuogrnd.com/c4emem/> |
| 发行包（**已发布**） | <https://github.com/cevtuocjw/CEVTUO-C4EMEM/releases/latest/download/Cevtuo-C4emem-0.1.0.dmg> |
| 站点仓库 | `/Users/cjw/Library/Application Support/CEVTUO-RWP-build/usersite`（远端 `cevtuocjw/cevtuocjw.github.io`） |
| 页面源文件 | 上面仓库里的 `c4emem/index.html` + `c4emem/assets/*.gif` |
| 发行包仓库 | `cevtuocjw/CEVTUO-C4EMEM`（**只有 README**，源码不在这） |

---

## 2. 怎么跑 / 怎么发（照抄）

```bash
cd ~/Documents/Cevtuo-C4emem

# 起核心（开发用；打包版会用自带的 c4core）
nohup bun run src/server.ts > /tmp/c4emem-server.log 2>&1 &

# 重新打包 + 出 dmg
bash app/build.sh
hdiutil create -quiet -volname "Cevtuo C4emem" -srcfolder app/C4emem.app \
  -ov -format UDZO /tmp/Cevtuo-C4emem-0.1.0.dmg

# 发版（⚠️ 必须带代理；直连 github 75 秒超时）
export HTTPS_PROXY=http://127.0.0.1:7890
~/bin/gh release create v0.1.1 /tmp/Cevtuo-C4emem-0.1.1.dmg \
  --repo cevtuocjw/CEVTUO-C4EMEM --title "..." --notes-file /tmp/rel-notes.md

# 推页面（⚠️ 同样必须带代理）
cd "/Users/cjw/Library/Application Support/CEVTUO-RWP-build/usersite"
git add -A c4emem && git commit -F /tmp/msg.txt
env HTTPS_PROXY=http://127.0.0.1:7890 git -c http.version=HTTP/1.1 push origin HEAD
```

**部署生效的判据**（三条都要看）：
```bash
gh api repos/cevtuocjw/cevtuocjw.github.io/pages/builds/latest --jq '{status,error:.error.message}'   # 要 built + null
curl -s -o /dev/null -w '%{http_code}\n' https://apps.cevtuogrnd.com/c4emem/                          # 要 200
curl -s -o /dev/null -w '%{http_code}\n' https://apps.cevtuogrnd.com/c4emem/assets/<新文件>            # 要 200
```
⚠️ Pages 要等 30~60 秒；只看第一次的 404 会误判成"没推上去"。

---

## 3. 已完成（这一批）

**打包（读者要求两次的那件）**
- `app/build.sh` 现在会：`bun build --compile` 出 `Resources/c4core`（62MB）＋ 把 `src/`（UI+assets）和 `scripts/` 拷进 `Resources/app/`
- 壳优先用自带核心（`Contents/Resources/c4core`），没有才回退到仓库里的 bun
- 配置：`C4EMEM_CONFIG` = 有 `~/.c4emem/c4emem.config.json` 就用它，否则用包里那份**模板**（不带任何 token）
- ✅ 实测：停掉仓库服务、只 `open app/C4emem.app` → 8770 起来、页面全 200、进程是 `c4core`
- App 82MB，dmg 50MB，已发 v0.1.0

**介绍页**
- 版式照 `odysseeclinic.com.au`（`#FFFCF8` 暖白 / 全字重 400 / 12px 大写眉标 / 48px 陈述句 / 编号式 ⑴⑵⑶ / 全屏字样 / 页脚）
- 顺序：Hero（"它自己进化"）→ ⑴自我进化（拿 Notion 举五步）→ ⑵主动式 → ⑶架构图 → ⑷语音/文字/结构流 → ⑸来源 → ⑹检索/记录/按软件/货架 → ⑺桌面 Pet
- 首页有 **macOS 下载**；页脚只留 `CEVTUO CLVNCHET` / `CEVTUOGRND`
- 术语统一成 **「知识及操作源」**；检索那段**只讲能做什么**（不暴露实现）
- 演示 GIF：不推近、真操作；**只模糊 Cherry Studio（文字+图标）**，只有邮件的/项目的整块不拍

---

## 4. ⚠️ 接下来要做的（按优先级，逐条写清"怎么算做完"）

### ① 补录 4 支演示（改脚本已经写好，只是没轮到）
`g-sources.gif` / `g-text.gif` / `g-wheel.gif` / `g-quit.gif` **还是上一版（带推近的）**。
- 脚本：`/tmp/gifpipe/rec2.mjs`（如果没了，见 §6 的配方重写）
- **做完的判据**：这 4 个文件的时间戳晚于 `index.html`，而且**画面里没有"从全局推近"的那一段**

### ② 演示换成视频（读者：「不要两条腿…效果好就行，不是非要 gif」）
现在全是 **GIF（256 色调色板）** ⇒ 有颗粒。
- 本机**没有 ffmpeg**，但 **Playwright 能直接录 webm**（`newContext({recordVideo})`），全帧率、无调色板损失
- 页面上 `<video autoplay muted loop playsinline>` 即可
- **做完的判据**：页面上的演示肉眼看着**没有色带/颗粒**；文件是 `.webm` 且能被 `https://apps.cevtuogrnd.com/c4emem/assets/xxx.webm` 200 取到

### ③ 录一支**完整功能演示视频**（放在页面最后）
读者要的是"一个完整的功能介绍视频"，用**一个软件做例子跑完整个进化流程**。
- **做完的判据**：视频能播、时长 ≥ 60 秒、里面**至少完整跑完一次结构流**（不是只打开界面）

### ④ 首次启动引导界面
现在只做到"不带 token 的模板 + 用户配置优先"。**引导界面本身没有**。
- 目标：第一次打开时让用户填自己的来源凭据（设置 → 接入 已经有了，缺的是"第一次把他领过去"）
- **做完的判据**：删掉 `~/.c4emem/`，重开 App，它会**主动**把设置抽屉打开并停在「接入」那一段

### ⑤ 签名 + 公证
**需要读者的 Apple Developer ID**（我没有）。没有它，别人下载要走一次"右键 → 打开"。
- 现状：`codesign --force --deep --sign -`（自签）

### ⑥ 数据目录挪到 `~/Library/Application Support/Cevtuo C4emem`
现在是 `~/.c4emem`。**这是破坏性迁移**，做之前先确认读者同意、并留一条回头的路。

---

## 5. 关键决定（别推翻）

- **所有"知识库"一律叫「知识及操作源」**（读者 2026-10-11 定）
- **检索那段只讲"能做什么"，不写实现**（读者：「不希望让用户知道这些」）
- **演示不要推近**（读者：「大部分都不适合推近，主要还是展示功能」）
- **隐私边界**：**只模糊 Cherry Studio（含它的 logo）**；**只有邮件的 / 项目的整块不拍**；
  其余内容**可以露**（读者原话：「不然真的什么都模糊了」）
- 页脚 contact **只留 `CEVTUO CLVNCHET` / `CEVTUOGRND`**
- 桌面 Pet 是**最后一节**（读者：「轮转这个不是最重要的」）
- **发行包里绝不能带开发者的 token** —— 模板 + `~/.c4emem/settings.json` 覆盖
- 站点仓库 `usersite/` 自成一个 git，**别把它 add 进别的仓库**（嵌套仓库会让 Pages 构建 failed）

---

## 6. 这一批新踩的坑（更全的见 `HANDOFF-NOW.md` §6）

1. ⭐⭐⭐ **`bun build --compile` 出来的核心仍然是用 `process.cwd()` 读盘的** ——
   只编译不带 `src/ui`，起来是**一片空白**。壳里必须设 `currentDirectoryURL = Resources/app`。
2. ⭐⭐⭐ **推送 github 必须带代理**（直连 75 秒超时）；`env -u HTTPS_PROXY git push` 会失败。
   ⚠️ 这条和 FACT 里旧记录**相反**，别照旧的来。
3. ⭐⭐ **`gh release create` 对空仓库会 422**（先推一个 README 进去）。
4. ⭐⭐ **正文里不能用 markdown 的 `**粗体**`** —— HTML 会原样显示（我栽过两次，共 31 处）。
5. ⭐⭐ **`dragTo` 在 Locator 上，ElementHandle 没有这个方法**（拖拽演示录不出来就是这个）。
6. ⭐ **`page.click('#fanbtn')` 会被它自己里面的 `<svg>` 挡住** ⇒ 用 `evaluate(el => el.click())`。
7. ⭐ **演示 GIF 的配方**（脚本丢了照这个重写）：
   Playwright 逐帧 `screenshot()` → `PNG.sync.read()` → 抽成 1x 的 rgba →
   `quantize(rgba,256)` → `applyPalette` → `enc.writeFrame(..., {delay})` → `enc.bytes()`。
   透明底用 `format:'rgba4444'` + `transparent:true` + `transparentIndex:0`。
   ⚠️ `gifenc` **没有默认导出**，必须 `import { GIFEncoder, quantize, applyPalette } from 'gifenc'`。

---

## 7. 验证清单（改完这些才敢说"好了"）

| 套件 | 管什么 |
|---|---|
| `bun scripts/verify-petwheel.mjs` | 桌面 Pet 轮盘（62 条，含 `NEGCTL=1\|2\|3` 负向对照） |
| `bun scripts/verify-pet.mjs` | 主窗口里的浮层版 Pet（31 条） |
| `bun scripts/verify-phone-photos.ts` | 手机相册走的是不是媒体库（9 条） |

⚠️ 跑浏览器套件用：`env -u HTTPS_PROXY -u https_proxy -u ALL_PROXY -u all_proxy -u HTTP_PROXY -u http_proxy NO_PROXY='*' bun scripts/xxx.mjs`
⚠️ **一轮最多跑 2 个浏览器套件**（多了被系统 SIGKILL）；**工具调用上限 150**（`~/.costguard/guard.py`）
