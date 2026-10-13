#!/bin/bash
# ⭐⭐ **点一个软件之后，宠物必须还在屏幕上**。
#
# 读者 2026-10-13：「我点击中间软件 logo 之后**所有的一起消失了，连同中间的 pet，
#                   pet 不应该消失才对**」
#
# ⚠️⚠️ 真因一行：`yieldActivation()` 里写的是 `NSApp.hide(nil)` ——
#    那是**整个 App 的所有窗口**，而 pet 就是这个 App 的窗口。
#    而"让位"要的是**把激活状态让出去**，不是把自己藏起来
#    （正解是 `orderOut` → `NSApp.deactivate()` → 0.55s 后 `order(.above, relativeTo: 0)`，
#      这一版在 `C4ememApp.swift` 里**早就有**）。
#
# ⚠️ 为什么必须**用真鼠标**：Playwright 驱动不了 AppKit 的窗口，
#    而"窗口还在不在"是纯原生的事 —— 网页那边看起来一切正常。
#
# ⚠️ 为什么不用截图判：宠物是一块**透明**小窗，截图上有没有它取决于背景色，
#    而"它不见了"和"它正好压在深色东西上"在缩略图里长得一样。
#
# 跑法：bash scripts/verify-pet-keeps.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

APP=/Applications/cevtuo-pet.app
[ -d "$APP" ] || { echo "❌ 没装 $APP —— 先跑 bash app/pet/build.sh"; exit 1; }

# 宠物的默认位置（右下角）。⚠️ 用户拖过就换地方了 —— 所以先从窗口列表里读回来。
pkill -f "MacOS/cevtuo-pet" 2>/dev/null; sleep 1
open -a "$APP"; sleep 8
PID=$(pgrep -f "MacOS/cevtuo-pet" | head -1)
[ -n "${PID:-}" ] || { echo "❌ 没起来"; exit 1; }

read -r WX WY WW WH < <(swift app/pet/wincheck.swift "$PID" | grep 'layer=3' | head -1 \
  | sed -E 's/.* ([0-9]+),([0-9]+) ([0-9]+)x([0-9]+).*/\1 \2 \3 \4/')
[ -n "${WW:-}" ] || { echo "❌ 没找到宠物那个窗（layer=3）"; exit 1; }
echo "宠物窗口 ${WX},${WY} ${WW}x${WH}"
# 宠物本体在窗口的右下角（`pet.html` 里 `right:26px;bottom:96px`，本体约 104px）
PX=$(( WX + WW - 26 - 52 )); PY=$(( WY + WH - 96 - 52 ))
echo "宠物中心大约在 ($PX,$PY)"

BEFORE=$(swift app/pet/wincheck.swift "$PID" | grep COUNT | cut -d= -f2)
echo "点之前 ONSCREEN=$BEFORE"

# ⚠️ 悬停展开 → 点一个扇区。
#    轮盘的扇区是**按角度分的**，而"点在哪个角度上"取决于宠物当前停在屏幕哪里
#    —— 所以**多试几个位置**，别指望一个写死的偏移每次都命中。
#    ⚠️ 而"没命中"必须**看得出来**：下面会判 launch 有没有真的发生。
N0=$(grep -c "launch .* ok" ~/.c4emem/pet.log 2>/dev/null || echo 0)
for off in "-120,0" "-85,-85" "-85,85" "0,-120" "-150,0"; do
  DX="${off%,*}"; DY="${off#*,}"
  swift scripts/mvtool.swift move "$PX" "$PY" >/dev/null 2>&1; sleep 1.3
  swift scripts/mvtool.swift click "$(( PX + DX ))" "$(( PY + DY ))" left >/dev/null 2>&1; sleep 1.6
  N1=$(grep -c "launch .* ok" ~/.c4emem/pet.log 2>/dev/null || echo 0)
  [ "$N1" -gt "$N0" ] && break
done

AFTER=$(swift app/pet/wincheck.swift "$PID" | grep COUNT | cut -d= -f2)
LAUNCHED=$(( $(grep -c "launch .* ok" ~/.c4emem/pet.log 2>/dev/null || echo 0) - N0 ))
echo "点之后 ONSCREEN=${AFTER}（这一轮桥里 launch 成功 ${LAUNCHED} 次）"

# ⚠️ 两条都要成立，缺一条这个测试就是空的：
#    ① 真的触发了一次 launch（不然什么都没测 —— 点空了而已）
#    ② 宠物还在屏幕上
if [ "$LAUNCHED" = "0" ]; then
  echo "⚠️ 这一轮没打中扇区（桥里没有 launch）—— 测试无效，不是通过"
  exit 2
fi
if [ "$AFTER" -ge 1 ]; then
  echo "✅ 宠物还在（点软件不会把它一起藏起来）"
  exit 0
fi
echo "❌ 宠物不见了 —— 就是那个 bug（去查 yieldActivation 里有没有 NSApp.hide）"
exit 1
