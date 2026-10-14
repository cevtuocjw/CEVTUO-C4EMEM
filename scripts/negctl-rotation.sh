#!/bin/bash
# 负向对照：**转速/转法那几条断言，把 bug 放回去真的会红吗？**
#
# 读者 2026-10-14：「由于你旋转的不是 360 度，所以你转的不是一圈……最快的 4 秒档位也是」
# 这一轮新加的断言必须证明自己有鉴别力（全绿本身什么都说明不了）。
#
# ⚠️⚠️ 这个跑台第一版有个**自己的**毛病：验证器**崩了**（一行没输出）时，
#    它 `grep ❌` 找不到就报"对照没红" —— **"跑台坏了"被读成"断言是对的"**。
#    现在分三种结果：红 / 绿 / **跑台自己坏了**（exit 2），三者长得不一样。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
F="$ROOT/src/ui/pet3d.js"; BK=/tmp/pet3d-neg.bak
cp "$F" "$BK"
cleanup(){ cp "$BK" "$F"; rm -f "$BK"; }
trap cleanup EXIT

run(){
  echo "── 对照：$1"
  out=$(cd "$ROOT" && C4EMEM_BASE=http://127.0.0.1:8791 \
        env -u HTTPS_PROXY -u https_proxy -u ALL_PROXY -u all_proxy NO_PROXY='*' \
        bun scripts/verify-pet-rotation.mjs 2>&1)
  echo "$out" | grep -E "✗|✅ [0-9]|❌ [0-9]" | sed 's/^/   /'
  if ! echo "$out" | grep -qE "✅ [0-9]+/|❌ [0-9]+/"; then
    echo "   ⇒ ⚠️ **跑台自己坏了**（验证器没出汇总行）—— 这次对照无效，不是通过"; return 2
  fi
  if echo "$out" | grep -q "❌"; then echo "   ⇒ ✅ 对照成立（红过）"; return 0; fi
  echo "   ⇒ ❌ 没红 —— 那几条断言在空跑"; return 1
}

bad=0
python3 - "$F" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
a=": mode === 'full' ? ph * 360 "
assert s.count(a)==1, ('锚点不唯一', s.count(a))
open(p,'w').write(s.replace(a, ": false ? ph * 360 "))   # NEGCTL：'full' 退化成摆
PY
run "① 「连续转」退化成摆 —— 就是读者报的那个毛病"; [ $? = 0 ] || bad=1
cp "$BK" "$F"

python3 - "$F" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
a="mode = 'swing', deg = 60,"
assert s.count(a)==1, ('锚点不唯一', s.count(a))
open(p,'w').write(s.replace(a, "mode = 'swing', deg = 26,"))   # NEGCTL：退回 ±26°
PY
run "② 摆幅退回 ±26°（旧实现，总共才 52°）"; [ $? = 0 ] || bad=1

echo
if [ "$bad" = 0 ]; then echo "✅ 负向对照全部成立 —— 转速那几条断言是真的在测东西"
else echo "❌ 有对照没红（或跑台坏了）"; fi
[ "$(grep -c NEGCTL "$F")" = 0 ] || { echo "❌ 源码里还有 NEGCTL 残留！"; bad=1; }
exit "$bad"
