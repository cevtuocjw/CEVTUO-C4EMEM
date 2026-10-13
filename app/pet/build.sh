#!/bin/bash
# 把 PetApp.swift 编成 **cevtuo-pet.app**（独立的桌面宠物 App）。
#
# 用法：  bash app/pet/build.sh
#
# ⚠️⚠️ 它和 `cevtuo-c4emem` **共用同一个核心**（也就是同一个"对话 → 真的做出来"的引擎）——
#    读者原话：「你看我想让你做的 cevtuopet app 以及现在的 c4emem app **都是这个路子**」。
#    ⇒ 不另写一套。**同一个 `~/.c4emem`，同一个 c4core，只换外壳和界面。**
#    ⚠️ 两个 App 同时跑时**核心只能有一个**（先探 8770，活着就复用）——
#       各起一个就是**两个写入方抢同一个库**，而这个项目栽过。
#
# ⚠️ 只用 Command Line Tools 里的 swiftc —— **不需要 Xcode 工程、不需要 Rust**。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(cd "$HERE/../.." && pwd)"
NAME="cevtuo-pet"
APP="$HERE/$NAME.app"
BIN="$APP/Contents/MacOS/$NAME"

echo "项目目录：$PROJECT"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

SRC="$HERE/.build.swift"
sed "s|__PROJECT_DIR__|$PROJECT|g" "$HERE/PetApp.swift" > "$SRC"

# ── Info.plist ───────────────────────────────────────────────
# ⚠️ `LSUIElement` 这里写 true —— 但**真正生效的是运行时的 `setActivationPolicy`**
#    （PetApp.swift 里按 `pet.dockOn` 那个偏好定）。写 true 是为了"第一次、还没有偏好时"
#    不会在 Dock 里闪一下。⚠️ 只改 plist 是**没有用**的，这个坑照抄别人配置时最容易踩。
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>CEVTUO Pet</string>
  <key>CFBundleExecutable</key><string>$NAME</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <!-- ⚠️ 和 c4emem **不能一样** —— 同 bundle id 的两份副本会让
       LaunchServices / `open -a` 认哪个全凭运气（表现是"点了图标没反应"）。 -->
  <key>CFBundleIdentifier</key><string>com.cevtuo.pet</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.1</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <!-- ⚠️ 没有这一段，App 连不上 http://127.0.0.1:8770：
       ATS 默认拦明文 HTTP ⇒ 内嵌窗口一片空白。 -->
  <key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSExceptionDomains</key><dict>
      <key>127.0.0.1</key><dict><key>NSExceptionAllowsInsecureHTTPLoads</key><true/></dict>
      <key>localhost</key><dict><key>NSExceptionAllowsInsecureHTTPLoads</key><true/></dict>
    </dict>
  </dict>
</dict></plist>
PLIST

echo "编译中…"
swiftc -O -swift-version 5 \
  -framework Cocoa -framework WebKit -framework Carbon \
  -o "$BIN" "$SRC"
rm -f "$SRC"

# ── 核心跟着打包（Pet 和 c4emem 用的是**同一个**）────────────
RES="$APP/Contents/Resources"
mkdir -p "$RES/app"
rm -rf "$RES/app/src" "$RES/app/scripts"
cp -R "$PROJECT/src" "$RES/app/src"
cp -R "$PROJECT/scripts" "$RES/app/scripts"
find "$RES/app/src" -name '*.ts' -delete 2>/dev/null || true
# ⚠️ 包里带的是**模板**（不带任何人的 token）。密钥只能住在 `~/.c4emem/`。
cp "$PROJECT/c4emem.config.example.json" "$RES/app/c4emem.config.json"

# ⚠️ 核心二进制**优先拿 c4emem 已经编好的那一份** —— 它俩本来就是同一个东西，
#    重编一次要一分钟，而且两份会漂移（"两个 App 行为不一样"最难查）。
#    没有就自己编。
C4CORE="/Applications/cevtuo-c4emem.app/Contents/Resources/c4core"
# ⚠️⚠️ **核心比源码旧就必须先重建 c4emem** —— 这是踩出来的：
#    我加了新路由、只重建了 pet，而 pet 的核心是**从已装的 c4emem 里拷的**
#    （那份早于新路由）⇒ 新接口一律 404，而**打包全绿、一个字都没报**。
#    "拷现成的"省的是时间，代价是**两份核心会悄悄不同步**。
#    ⇒ 把顺序变成脚本自己的事，别指望人记得。
STALE=0
[ -f "$C4CORE" ] || STALE=1
if [ "$STALE" = 0 ] && find "$PROJECT/src" -name '*.ts' -newer "$C4CORE" 2>/dev/null | head -1 | grep -q .; then STALE=1; fi
if [ "$STALE" = 1 ]; then
  echo "核心比源码旧（或还没有）—— 先重建 c4emem（两个 App 的核心必须**是同一份**）…"
  bash "$PROJECT/app/build.sh" >/dev/null 2>&1 || echo "⚠️ c4emem 重建失败，继续用现有核心"
fi

if [ -f "$C4CORE" ]; then
  cp "$C4CORE" "$RES/c4core"
  chmod +x "$RES/c4core"
  echo "核心：从已装的 c4emem 拿来（同一份）"
else
  echo "编译核心（约 1 分钟）…"
  if bun build --compile --minify "$PROJECT/src/server.ts" --outfile="$RES/c4core" >/dev/null 2>&1; then
    chmod +x "$RES/c4core"
  else
    echo "⚠️ 核心编译失败 —— 这一版只能靠已经在跑的那个核心"
  fi
fi

# ── 图标（那支铅）────────────────────────────────────────────
# ⚠️ 没有这一步的后果：plist 里写了 CFBundleIconFile 却没有那个文件 ⇒
#    Finder 里一个白纸图标（而"长得丑"和"没做"在界面上是一样的）。
if [ -f "$HERE/AppIcon.icns" ]; then
  cp "$HERE/AppIcon.icns" "$RES/AppIcon.icns"
else
  echo "⚠️ 没有 app/pet/AppIcon.icns（跑一下 bun app/pet/make-icon.mjs）—— 这一版会是白纸图标"
fi

codesign --force --deep --sign - "$APP" 2>/dev/null || echo "（codesign 跳过）"

# ── 装到 /Applications ───────────────────────────────────────
# ⚠️⚠️ 不装的话 Spotlight 搜不到 —— 而"搜不到"和"它不存在"在使用者眼里是同一件事。
# ⚠️ `lsregister -f` 是必须的：光拷贝不刷新，LaunchServices 里还是旧那条。
DST="/Applications/$(basename "$APP")"
rm -rf "$DST"
ditto "$APP" "$DST"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DST" >/dev/null 2>&1 || true

echo "✅ 生成 $APP  （$(du -sh "$APP" | cut -f1)）"
echo "✅ 已装到 $DST"
echo "   打开： open '$DST'"

rm -rf "$APP"
echo "✅ 已清掉构建产物（机器上只剩 $DST 这一份）"
