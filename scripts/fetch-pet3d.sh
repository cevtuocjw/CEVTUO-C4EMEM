#!/usr/bin/env bash
# 把「2D 图 → 真 3D」那条路要用的三方件拉到 src/ui/vendor/。
#
# ⭐ 为什么是拉下来而不是放进仓库：
#    这一坨 ~35MB（wasm 14M + 模型 19M + three 1.2M），进 git 只会让每次提交都拖二进制，
#    而且**没有任何人会在 code review 里看它们**。⇒ 仓库里只留这个脚本，
#    `app/pet/build.sh` 打包前调它一次（已经有了就跳过）。
#
# ⚠️ 两个源都在国内直连不稳：
#    · npm 包 —— 不带代理反而通（FACT：带 127.0.0.1:7890 会 ECONNRESET）
#    · HuggingFace —— **必须走 hf-mirror.com**，官方站 19MB 拉了 5 分钟没下来
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V="$ROOT/src/ui/vendor"
MODEL="onnx-community/depth-anything-v2-small"
MK="$V/depth-anything-v2-small"
NOPROXY=(env -u HTTPS_PROXY -u https_proxy -u ALL_PROXY -u all_proxy
             -u HTTP_PROXY -u http_proxy -u npm_config_proxy -u npm_config_https_proxy)

mkdir -p "$V" "$MK/onnx"
cd "$V"

copy_if_new() {  # $1 源 $2 目标
  if [ ! -f "$2" ] || ! cmp -s "$1" "$2"; then cp "$1" "$2"; echo "  + $(basename "$2")"; fi
}

# ── ① 三个脚本件（npm）────────────────────────────────────────────
# ⚠️ **先看四个目标文件在不在，在就一步都不联网** —— 不然每次打包都要重装一遍
#    （实测 bun add 在这台机器上要 130 秒，而且装完还会把 vendor 里多出一堆没用的东西）。
NEED_NPM=0
for f in transformers.min.js three.module.js ort-wasm-simd-threaded.wasm ort-wasm-simd-threaded.mjs; do
  [ -s "$V/$f" ] || NEED_NPM=1
done
if [ "$NEED_NPM" = 1 ]; then
  if [ ! -d node_modules ]; then
    echo "· 装 npm 件（@huggingface/transformers + three + onnxruntime-web）"
    [ -f package.json ] || printf '{"name":"pet3d-vendor","private":true,"type":"module"}\n' > package.json
    "${NOPROXY[@]}" bun add @huggingface/transformers three onnxruntime-web >/dev/null
  fi
  copy_if_new node_modules/@huggingface/transformers/dist/transformers.min.js transformers.min.js
  copy_if_new node_modules/three/build/three.module.js                         three.module.js
  # ⚠️ 只用**不带 asyncify / jsep 的那一份**（14.2MB）。
  #    默认会去抓 asyncify（26.8MB）—— 实测两者算出来的深度一模一样、耗时也一样
  #    （4.35s vs 4.6s），所以没理由多带 12.6MB。
  #    代价：必须显式把 `wasmPaths` 指成 {wasm,mjs} 两个路径（见 src/ui/pet3d.js）。
  copy_if_new node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm    ort-wasm-simd-threaded.wasm
  copy_if_new node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs     ort-wasm-simd-threaded.mjs
fi

# ── ② 模型本体（hf-mirror）────────────────────────────────────────
MIRROR="${HF_MIRROR:-https://hf-mirror.com}"
get() {  # $1 仓库内路径
  local out="$MK/$1"
  [ -s "$out" ] && return 0
  mkdir -p "$(dirname "$out")"
  echo "· 拉 $1"
  "${NOPROXY[@]}" curl -fsSL --max-time 900 -o "$out" "$MIRROR/$MODEL/resolve/main/$1"
}
get config.json
get preprocessor_config.json
get onnx/model_q4f16.onnx

# ── ③ 自检：四个件齐全 + 模型不是半截的 ──────────────────────────
miss=0
for f in transformers.min.js three.module.js ort-wasm-simd-threaded.wasm ort-wasm-simd-threaded.mjs \
         depth-anything-v2-small/config.json depth-anything-v2-small/preprocessor_config.json \
         depth-anything-v2-small/onnx/model_q4f16.onnx; do
  [ -s "$V/$f" ] || { echo "❌ 缺 $f"; miss=1; }
done
[ "$miss" = 0 ] || exit 1
# ⚠️ "文件在"不等于"下全了" —— 断线会留下一个几 KB 的 JSON 错误页
sz=$(wc -c < "$MK/onnx/model_q4f16.onnx" | tr -d ' ')
[ "$sz" -gt 15000000 ] || { echo "❌ 模型只有 $sz 字节（应当是 19M 左右）—— 半截的，删掉重来"; exit 1; }
echo "✅ vendor 齐了：$(du -sh "$V" | cut -f1) / $(find "$V" -type f \( -name '*.wasm' -o -name '*.onnx' -o -name '*.js' -o -name '*.json' \) | wc -l | tr -d ' ') 个文件"
