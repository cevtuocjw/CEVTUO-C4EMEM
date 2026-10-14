#!/bin/bash
# 把 C4ememApp.swift 编译成 C4emem.app（菜单栏 App）。
#
# 只用 Command Line Tools 里的 swiftc —— **不需要 Xcode 工程、不需要 Rust**。
# 产物：app/C4emem.app，几百 KB。
#
# 用法：  bash app/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(cd "$HERE/.." && pwd)"
# ⭐⭐ 2026-10-13 读者：「这个软件应该叫做 cevtuo-c4emem，就改 app 名称就可以」。
# ⇒ 产物、bundle 名、可执行文件名、菜单栏标题全跟着这一个变量走。
# ⚠️ **bundle identifier（com.cevtuo.c4emem）不动** —— 改它会丢掉已存的偏好设置。
NAME="cevtuo-c4emem"
APP="$HERE/$NAME.app"
BIN="$APP/Contents/MacOS/$NAME"

echo "项目目录：$PROJECT"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# ── 把项目路径烧进源码 ───────────────────────────────────────
# App 得知道核心在哪。做成构建期常量，省得运行期到处找。
SRC="$HERE/.build.swift"
sed "s|__PROJECT_DIR__|$PROJECT|g" "$HERE/C4ememApp.swift" > "$SRC"

# ── Info.plist ───────────────────────────────────────────────
# ⚠️ LSUIElement **2026-10-13 起是 false**（读者要在 Dock 里看见它）—— 见下面那段说明。
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
  <key>CFBundleExecutable</key><string>$NAME</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>com.cevtuo.c4emem</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.30</string>
  <key>CFBundleVersion</key><string>31</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <!-- ⭐⭐ 2026-10-13 读者：「我点击这个软件，**没有 logo 在我的 dock 栏里展示**」。
       原来是 `LSUIElement=true`（纯菜单栏 App，Dock 里没有图标）—— 那是当初的设计，
       读者现在明确要**在 Dock 里看得见**。
       ⇒ 关掉它。副作用（都是好的）：Dock 图标 + 应用切换器里有它，
         而且**点 Dock 图标本质就是 `reopen` 事件** ⇒ 直接走
         `applicationShouldHandleReopen` 把主界面叫出来。 -->
  <key>LSUIElement</key><false/>
  <key>NSHighResolutionCapable</key><true/>
  <!-- ⚠️ 没有这一段，App 连不上 http://127.0.0.1:8770：
       ATS 默认拦明文 HTTP ⇒ 状态一直显示 "C4×"，而且内嵌窗口会是一片空白。
       实测踩到过。 -->
  <key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSExceptionDomains</key><dict>
      <key>127.0.0.1</key><dict><key>NSExceptionAllowsInsecureHTTPLoads</key><true/></dict>
      <key>localhost</key><dict><key>NSExceptionAllowsInsecureHTTPLoads</key><true/></dict>
    </dict>
  </dict>
</dict></plist>
PLIST

# ── 编译 ─────────────────────────────────────────────────────
echo "编译中…"
# -swift-version 5：Swift 6 的严格并发检查对一个 AppDelegate 型的小工具太吵
# ⚠️ Carbon 是为了 `RegisterEventHotKey`（全局快捷键）—— 它**不要辅助功能授权**，
#    而 NSEvent 的全局键盘监视要，且没授权时是静默失效的。
swiftc -O -swift-version 5 \
  -framework Cocoa -framework WebKit -framework Carbon \
  -o "$BIN" "$SRC"

rm -f "$SRC"

# ── 核心跟着打包（读者：「打包好 macos 软件然后传上去」）──────────
# ⚠️⚠️ 核心是**运行时读盘**找 `src/ui/*` 和 `scripts/*.py` 的（用 `process.cwd()`）——
#    光把 server.ts 编译成单文件，起来是**一片空白**（找不到 app.html）。
#    ⇒ 编译出的 `c4core` 放 Resources/，而**工作目录设成 Resources/app**，
#      那一份里带着 src/ui（含 assets）和 scripts。
RES="$APP/Contents/Resources"
mkdir -p "$RES/app"
rm -rf "$RES/app/src" "$RES/app/scripts"
cp -R "$PROJECT/src" "$RES/app/src"
cp -R "$PROJECT/scripts" "$RES/app/scripts"
# 源码里那几份 .ts 搬过去没用（核心已经是编译好的二进制），删掉省体积
find "$RES/app/src" -name '*.ts' -delete 2>/dev/null || true
# ⚠️ 包里带的是**模板**（不带任何人的 token）—— 壳会把它当"用户配置不存在时"的兜底
cp "$PROJECT/c4emem.config.example.json" "$RES/app/c4emem.config.json"
echo "编译核心（约 1 分钟）…"
if bun build --compile --minify "$PROJECT/src/server.ts" --outfile "$RES/c4core" >/dev/null 2>&1; then
  chmod +x "$RES/c4core"
  echo "核心：$(du -sh "$RES/c4core" | cut -f1)"
else
  echo "⚠️ 核心编译失败 —— 这一版只能在这台机器上（靠仓库里的 bun）跑"
fi

# ── 图标 ─────────────────────────────────────────────────────
# ⚠️ 之前**根本没有这一步** —— plist 里写了 CFBundleIconFile 却没有那个文件，
#    表现是 Finder 里一个白纸图标（而"长得丑"和"没做"在界面上是一样的）。
# 图标本体是 `app/AppIcon.icns`（= 那张 CEVTUO 卡片，见 `app/icon.html`）。
# ⚠️ 它是在**浏览器里**渲染出来的：本机没有 PNG 编解码器，sips 只能缩放不能合成。
#    重新生成：`bun app/make-icon.mjs`
if [ -f "$HERE/AppIcon.icns" ]; then
  cp "$HERE/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
else
  echo "⚠️ 没有 app/AppIcon.icns（跑一下 bun app/make-icon.mjs）—— 这一版会是个白纸图标"
fi

# 菜单栏那颗模板图 —— 和 AppIcon **互不依赖**（AppIcon 没了它也得在，
# 不然菜单栏会退回文字，而且**没人会发现**）。@2x 是同名带后缀，两个都要拷。
cp "$HERE/CardTemplate.png" "$RES/CardTemplate.png" 2>/dev/null || echo "⚠️ 少了 CardTemplate.png，菜单栏会退回文字 C4"
cp "$HERE/CardTemplate@2x.png" "$RES/CardTemplate@2x.png" 2>/dev/null || true

# 免得 Gatekeeper 因为"没有签名"就拦；本机自用够了
codesign --force --deep --sign - "$APP" 2>/dev/null || echo "（codesign 跳过）"

# ── 装到 /Applications ───────────────────────────────────────
# ⚠️⚠️ 不做这一步的后果（读者 2026-10-13 报的原话）：
#    「为什么我电脑上没有可以搜到的 c4emem 可以使用的 app」
#    —— 因为**从来没有装过**，只有这个构建产物躺在 `~/Documents/` 里。
#    Spotlight 的"应用程序"只认 /Applications（和 ~/Applications），
#    放在文档目录里的 .app **搜不到、Launchpad 里也没有**，
#    而"搜不到"和"它不存在"在使用者眼里是同一件事。
# ⚠️ `lsregister -f` 是必须的：光拷贝不刷新，LaunchServices 数据库里还是旧那条
#    （而且这次会有**两个同 bundle id 的副本**，不刷新的话 `open -a` 认哪个全凭运气）。
# 本机自用，直接覆盖装，不做版本比对。
DST="/Applications/$(basename "$APP")"
rm -rf "$DST"
ditto "$APP" "$DST"
# ⚠️ 改名之后（C4emem.app → cevtuo-c4emem.app）**旧的必须删掉** ——
#    留一个同 bundle id 的旧副本在 /Applications 里，`open -a` / LaunchServices
#    认哪个全凭运气，表现是"点了图标没反应"（打开的其实是另一个）。
if [ -d "/Applications/C4emem.app" ]; then
  rm -rf "/Applications/C4emem.app"
  echo "（已删掉改名前的 /Applications/C4emem.app）"
fi
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DST" >/dev/null 2>&1 || true

echo "✅ 生成 $APP  （$(du -sh "$APP" | cut -f1)）"
echo "✅ 已装到 $DST"
echo "   打开： open '$DST'"
echo "   以后开机自启：系统设置 → 通用 → 登录项 → 添加这个 App"

# ⚠️⚠️ **最后一步**才把构建产物删掉 —— 读者 2026-10-13：「我电脑上一堆的 c4emem 的软件 app,
#     最终只留最后一个的版本」。留两份的后果不只是占地方：**两个同 bundle id 的副本**
#     会让 Spotlight / 启动台里出现两个图标，而且 `open -a` 认哪个全凭运气。
#     要打 dmg 就从 /Applications 那一份打。
#     ⚠️ 必须放在最后：`du -sh` 报尺寸那行在上面，先删了它就只剩一个空括号。
# ⚠️⚠️ **一次性把凭据放到 App 自己的目录里**（读者：「这个软件要完全独立」）。
#    配置里密钥走**环境变量**，而 App 起的核心工作目录是包里的 `Resources/app`，
#    那里没有 `.env` ⇒ `hasLlm=false` ⇒ 一切要用模型的功能全挂，界面上就是"点了没反应"。
if [ -f "$PROJECT/.env" ] && [ ! -f "$HOME/.c4emem/.env" ]; then
  mkdir -p "$HOME/.c4emem"
  cp "$PROJECT/.env" "$HOME/.c4emem/.env"
  echo "✅ 已把 .env 复制到 ~/.c4emem/.env（第一次才做）"
fi

rm -rf "$APP"
rm -rf "$HERE/C4emem.app"          # 改名之前留下的那个产物，也一并清掉
echo "✅ 已清掉构建产物（机器上只剩 $DST 这一份）"
