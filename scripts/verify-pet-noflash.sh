#!/bin/bash
# ⭐⭐⭐ **点一个软件的时候，宠物一次都不许从屏幕上消失。**
#
# 读者 2026-10-14：「我点击周围的 app 时候，中间这个 pet，**又开始闪一下**，
#                   我希望**完全不闪，一直在**，这个要写死，**让你改过很多次了**」。
#
# ⚠️⚠️ 为什么旧的 `verify-pet-keeps.sh` **是绿的却挡不住它**：
#    它只在**点前 / 点后各看一次**（`wincheck` 报个 COUNT）。
#    而宠物消失的那一下是 **0.55 秒**（`yieldActivation` 里 `orderOut` + 延时放回）——
#    一头一尾两次采样**必然都采到 1**。
#    ⇒ 这一版改成**连续采样**（每 40ms 一次），一次 0 都不允许出现。
#
# ⚠️ 用真鼠标（AppKit 的窗口 Playwright 驱动不了），而且**fail-closed**：
#    桥里没发生 `launch` 就报「测试无效」，不是"通过"。
#
# 跑法：bash scripts/verify-pet-noflash.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

APP=${PET_APP:-/Applications/cevtuo-pet.app}
[ -d "$APP" ] || { echo "❌ 没装 $APP —— 先跑 bash app/pet/build.sh"; exit 1; }
# ⚠️⚠️ 工具本身的存在要先查 —— 我第一版把路径写成了 `app/pet/mvtool.swift`（实际在
#      `scripts/`），而调用处 `>/dev/null 2>&1` ⇒ **报错被吞掉**，
#      表现是"一次都没打中扇区"，看起来像产品的问题。工具链的毛病最爱伪装成被测对象的毛病。
MV=scripts/mvtool.swift
[ -f "$MV" ] || { echo "❌ 找不到 $MV"; exit 2; }
[ -f app/pet/wincheck.swift ] || { echo "❌ 找不到 app/pet/wincheck.swift"; exit 2; }

echo "· 起一个新的实例（免得被试到一半用户手动点过它）"
pkill -f "MacOS/cevtuo-pet" 2>/dev/null; sleep 1
open -a "$APP"; sleep 8
PID=$(pgrep -f "MacOS/cevtuo-pet" | head -1)
[ -n "${PID:-}" ] || { echo "❌ 没起来"; exit 1; }

read -r WX WY WW WH < <(swift app/pet/wincheck.swift "$PID" | grep 'layer=3' | head -1 \
  | sed -E 's/.* ([0-9]+),([0-9]+) ([0-9]+)x([0-9]+).*/\1 \2 \3 \4/')
[ -n "${WW:-}" ] || { echo "❌ 没找到宠物那个窗（layer=3）"; exit 1; }
PX=$(( WX + WW - 26 - 52 )); PY=$(( WY + WH - 96 - 52 ))
echo "· 宠物窗口 ${WX},${WY} ${WW}x${WH} · 本体中心约 ($PX,$PY)"

# ⚠️ 采样先跑起来，**再**点 —— 反过来的话消失那一下正好落在采样开始之前
swift app/pet/onscreen-sampler.swift "$PID" 9 40 > /tmp/noflash-samples.txt 2>/dev/null &
SAMPLER=$!
sleep 1.2

N0=$(grep -c "launch .* ok" ~/.c4emem/pet.log 2>/dev/null || echo 0)
O0=$(grep -ac "OPEN" ~/.c4emem/client.log 2>/dev/null || echo 0)
# ⚠️ 轮盘扇区是按**角度**分的，而"点在哪个角度"取决于宠物停在哪 ⇒ 多试几个位置
for off in "-200,0" "-141,-141" "-141,141" "0,-200" "-230,0" "200,0" "-245,-60" "0,200"; do
  DX="${off%,*}"; DY="${off#*,}"
  swift "$MV" move "$PX" "$PY" >/dev/null 2>&1; sleep 1.3
  swift "$MV" click "$(( PX + DX ))" "$(( PY + DY ))" left >/dev/null 2>&1; sleep 1.6
  N1=$(grep -c "launch .* ok" ~/.c4emem/pet.log 2>/dev/null || echo 0)
  [ "$N1" -gt "$N0" ] && break
done
wait $SAMPLER 2>/dev/null

LAUNCHED=$(( $(grep -c "launch .* ok" ~/.c4emem/pet.log 2>/dev/null || echo 0) - N0 ))
SAMPLES=$(grep -c . /tmp/noflash-samples.txt 2>/dev/null || echo 0)
ZEROS=$(awk '$2==0' /tmp/noflash-samples.txt 2>/dev/null | wc -l | tr -d ' ')

OPENED=$(( $(grep -ac "OPEN" ~/.c4emem/client.log 2>/dev/null || echo 0) - O0 ))
echo "· 采样 $SAMPLES 次（每 40ms）· 其中不在屏幕上的 $ZEROS 次 · 轮盘展开过 $OPENED 次 · 桥里 launch 成功 $LAUNCHED 次"

# ── 三条都要成立，缺一条这个测试就是空的 ───────────────────────────
if [ "$SAMPLES" -lt 100 ]; then
  echo "⚠️ 采样太少（$SAMPLES）—— 测试无效，不是通过"; exit 2
fi
if [ "$OPENED" = "0" ]; then
  echo "⚠️ 鼠标压根没让轮盘展开（client.log 里没有 OPEN）—— 测试无效，不是通过"; exit 2
fi
if [ "$LAUNCHED" = "0" ]; then
  echo "⚠️ 这一轮没打中扇区（桥里没有 launch）—— 测试无效，不是通过"; exit 2
fi
# ⚠️ 尾巴上那一段可能是"点完之后窗口正好还在动"，只看总和会误判 ——
#    所以把 0 出现的**时间点**也打出来，人能一眼看出它是不是集中在点击那一刻。
if [ "$ZEROS" != "0" ]; then
  echo "❌ 宠物在点软件的期间从屏幕上消失过 $ZEROS 次（每次约 40ms，合计约 $(( ZEROS * 40 ))ms）"
  echo "   出现的时间点（毫秒）：$(awk '$2==0{printf "%s ", $1}' /tmp/noflash-samples.txt)"
  echo "   ⇒ 一定是某处又去动那只窗口了。grep 一下："
  echo "     grep -n 'orderOut\|NSApp.hide\|hidesOnDeactivate\|alphaValue' app/pet/PetApp.swift"
  exit 1
fi
echo "✅ 点了软件，宠物**一次都没有消失**（$SAMPLES 次采样全是 1）"
exit 0
