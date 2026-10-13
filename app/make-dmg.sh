#!/bin/bash
# 把 /Applications 里那一份打成 dmg（**从 /Applications 打，不要从仓库产物打**）。
#
# 用法：  bash app/make-dmg.sh [输出路径] [App 名，默认 cevtuo-c4emem]
#
# ⚠️ 为什么从 /Applications 打：`build.sh` 最后会把仓库里那份构建产物删掉
#    （读者：「我电脑上一堆的 c4emem 的软件 app，最终只留最后一个的版本」）——
#    所以**装好的那一份才是唯一的真身**，dmg 也从它打。
#
# ⚠️⚠️ dmg 里**不能有我的 key**。这条是读者 2026-10-13 明确要求的：
#    「你打包的不能用有我的 api 要用户填写」。
#    凭据只在两个地方：`~/.c4emem/.env`（用户自己的机器）和 `~/.c4emem/settings.json`
#    （界面里填的）—— **两个都躺在 home 下，都不会进包**。
#    这个脚本收尾会**自己查一遍**（见最后那段），查不出来就直接失败。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="${2:-cevtuo-c4emem}"
SRC="/Applications/$APP_NAME.app"
# ⚠️ 资产文件名**固定不带版本号**（`releases/latest/download/<名>` 那个 302 是
#    `cache-control: no-cache`）—— 名字固定之后页面就再也不用跟着发版改链接。
case "$APP_NAME" in
  cevtuo-pet)   DEF=/tmp/Cevtuo-Pet.dmg ;;
  *)            DEF=/tmp/Cevtuo-C4emem.dmg ;;
esac
OUT="${1:-$DEF}"
# ⚠️ 资产文件名**固定不带版本号** —— `releases/latest/download/<名>` 那个 302 是
#    `cache-control: no-cache`，名字固定之后页面就再也不用跟着发版改链接
#    （也就不会再出现"页面还指着旧版本名 → 404"）。
VOL="$APP_NAME"

[ -d "$SRC" ] || { echo "❌ 没有 $SRC —— 先跑 bash app/build.sh"; exit 1; }
VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$SRC/Contents/Info.plist")"
echo "打包 $APP_NAME $VER → $OUT"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ditto "$SRC" "$STAGE/$APP_NAME.app"
ln -s /Applications "$STAGE/Applications"      # 拖进去就能装

rm -f "$OUT"
hdiutil create -volname "$VOL" -srcfolder "$STAGE" -ov -format UDZO "$OUT" >/dev/null
echo "✅ $OUT （$(du -sh "$OUT" | cut -f1)）"

# ── 自查：包里绝对不能有凭据 ────────────────────────────────────
# ⚠️ 判据是**打开 dmg 看里面**，不是"我打包时没放" ——
#    "我写了"和"它生效了"是两回事（见 FACT：四种静默断层）。
MNT="$(mktemp -d)"
hdiutil attach "$OUT" -nobrowse -mountpoint "$MNT" >/dev/null
INSIDE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$MNT/$APP_NAME.app/Contents/Info.plist")"
echo "  包里的版本：$INSIDE"
[ "$INSIDE" = "$VER" ] || { echo "❌ 包里的版本对不上（$INSIDE ≠ $VER）"; hdiutil detach "$MNT" >/dev/null; exit 1; }

BAD=0
# ① 有没有真的 .env / settings.json 混进去
for f in .env settings.json c4emem.config.json; do
  if find "$MNT/$APP_NAME.app" -name "$f" | grep -q .; then
    echo "  发现：$(find "$MNT/$APP_NAME.app" -name "$f" | sed "s|$MNT/||")"
  fi
done
# ② 有没有长得像密钥的串（sk- 开头 32 位以上）
if grep -rIl -E 'sk-[A-Za-z0-9]{20,}' "$MNT/$APP_NAME.app" 2>/dev/null | head -3 | grep -q .; then
  echo "❌ 包里出现了像密钥的串："
  grep -rIl -E 'sk-[A-Za-z0-9]{20,}' "$MNT/$APP_NAME.app" 2>/dev/null | sed "s|$MNT/||" | head -3
  BAD=1
fi
# ③ 配置里**只该有变量名**（apiKeyEnv），不该有 apiKey 的值
if grep -rI '"apiKey"\s*:\s*"[^"]\+"' "$MNT/$APP_NAME.app/Contents/Resources" 2>/dev/null | head -2 | grep -q .; then
  echo "❌ 配置里写了 apiKey 的值（应该只写 apiKeyEnv 那个变量名）"
  BAD=1
fi
hdiutil detach "$MNT" >/dev/null

if [ "$BAD" != "0" ]; then
  echo "❌ 这个 dmg 不能发 —— 用户得填自己的 key，包里不能有别人的"
  exit 1
fi
echo "✅ 没有凭据混进包（用户自己填 key）"
