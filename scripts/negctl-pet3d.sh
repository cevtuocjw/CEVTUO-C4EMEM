#!/usr/bin/env bash
# 负向对照：**把 bug 放回去，那条断言真的会红吗？**
#
# 读者 2026-10-14 点名说「转不转还是没处理好」⇒ 这一轮新加的断言必须证明自己有鉴别力。
# 全绿本身什么都说明不了（FACT 纪律 15）。
#
# 两条配方，都打在**产品**那一侧（不是断言那一侧）：
#   ① 把 `spin` 关掉之后**照样重排 rAF** ⇒ 「帧数不再增长」必须红
#   ② 把起伏幅度设成 0（= 一块平板）⇒ 「真的鼓起来了」必须红
#
# ⚠️ 配方①**只动被测的那一侧**（`raf` 的重排条件），不去碰 `on` 这个状态本身 ——
#    那样会变成恒等操作（改了两边 ⇒ 差没变 ⇒ 对照静默"通过"）。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
F="$ROOT/src/ui/pet3d.js"
BK="/tmp/negctl-pet3d.bak"
cp "$F" "$BK"
# ⚠️ 还原放 EXIT，而且**只复制、不删备份** —— 备份删掉之后再 restore 就是静默失败，
#    源码会一直留在"改坏了"的状态（FACT 里记过两次）。
cleanup() { cp "$BK" "$F"; rm -f "$BK"; }
trap cleanup EXIT

run() {  # $1 = 这次对照的名字
  echo "── 对照：$1"
  out=$(cd "$ROOT" && env -u HTTPS_PROXY -u https_proxy -u ALL_PROXY -u all_proxy NO_PROXY='*' bun scripts/verify-pet3d.mjs 2>&1)
  echo "$out" | grep -E "✗|✅|❌" | sed 's/^/   /'
  if echo "$out" | grep -q "❌"; then echo "   ⇒ ✅ 对照成立（红过）"; return 0
  else echo "   ⇒ ❌ **对照没红** —— 那条断言在空跑"; return 1; fi
}

bad=0
# ① 关掉之后还在画 —— 这正是读者报的那个症状
python3 - "$F" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
a="    if (on) raf = requestAnimationFrame(draw);"
assert s.count(a)==1, ('锚点不唯一', s.count(a))
s=s.replace(a, "    raf = requestAnimationFrame(draw);   // NEGCTL：关掉之后照样重排")
open(p,'w').write(s)
PY
run "① 不转的时候照样重排 rAF" || bad=1
cp "$BK" "$F"

# ② 起伏设成 0（一片平板）
python3 - "$F" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
a="export const DEPTH_AMP = 0.30;"
assert s.count(a)==1, ('锚点不唯一', s.count(a))
s=s.replace(a, "export const DEPTH_AMP = 0.0;   // NEGCTL：平板")
open(p,'w').write(s)
PY
run "② 起伏幅度 = 0（一块平板）" || bad=1

# ③ ⭐ **把「银」的深度图摘掉** —— 这正是读者碰到的那一版（静态图，没东西可转）。
#    判据是 `verify-petspin-all` 的「① silver 在动」，它必须红。
cp "$BK" "$F"
FB="$ROOT/src/ui/petforms.js"; BK2="/tmp/negctl-pet3d.petforms.bak"; cp "$FB" "$BK2"
trap 'cp "$BK" "$F"; cp "$BK2" "$FB"; rm -f "$BK" "$BK2"' EXIT
python3 - "$FB" <<'PY2'
import sys
p=sys.argv[1]; s=open(p).read()
a="""    img: '/ui/assets/mineral-silver-mini.webp', depth: '/ui/assets/mineral-silver.depth.png' },"""
assert s.count(a)==1, ('锚点不唯一', s.count(a))
s=s.replace(a, """    img: '/ui/assets/mineral-silver-mini.webp' },""")   # NEGCTL：摘掉深度图
open(p,'w').write(s)
PY2
echo "── 对照：③ 「银」摘掉深度图（= 读者碰到的那一版）"
out2=$(cd "$ROOT" && env -u HTTPS_PROXY -u https_proxy -u ALL_PROXY -u all_proxy NO_PROXY='*' bun scripts/verify-petspin-all.mjs 2>&1)
echo "$out2" | grep -E "silver|✅|❌" | sed 's/^/   /'
if echo "$out2" | grep -q "❌"; then echo "   ⇒ ✅ 对照成立（红过）"; else echo "   ⇒ ❌ **对照没红**"; bad=1; fi

echo
if [ "$bad" = 0 ]; then echo "✅ 负向对照全部成立 —— 这两条断言是真的在测东西"; else echo "❌ 有对照没红，那几条断言是空的"; fi
exit "$bad"
