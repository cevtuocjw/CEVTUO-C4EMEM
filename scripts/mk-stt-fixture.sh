#!/usr/bin/env bash
# 生成 verify-stt.mjs 用的「假麦克风」夹具音频（16k 单声道 WAV）。
#
# ⚠️ 为什么固化成一个脚本：夹具放在 /tmp，而 /tmp 会被系统清掉。
#    清掉之后 verify-stt 走的是「跳过」分支 —— 那是**跳过，不是通过**。
#    这条命令以前只活在对话记录里，于是每清一次就得重新问一遍。
#
# ⚠️⚠️ 输出路径只有一处权威：verify-stt.mjs 里的 WAV 常量。
#    这个默认值必须和它逐字一致。曾经出现过两个名字分家
#    （套件读 /tmp/stt-test.wav，而文档让人重建 /tmp/stt-fixture.wav）
#    —— 照文档重建出来的文件套件根本不读，于是「重建了还是跳过」。
#
# ⚠️ 不能用 `ffmpeg -f lavfi -i anullsrc` + concat 来拼静音：
#    那个源是无限长的，会挂死。用 `say "[[slnc N]]"` 在合成语音里插静音。
#
# 用法：bash scripts/mk-stt-fixture.sh [输出路径]
set -euo pipefail

OUT="${1:-/tmp/stt-test.wav}"
# ⚠️ 这句话必须含有 verify-stt.mjs 等待条件里的关键词（今天 / 设计 / 开会），
#    否则套件会在「等识别结果」那一步空等到超时。
TXT='今天下午三点开会，记得把设计稿带上'

TMP_AIFF="$(mktemp -t stt-fixture).aiff"
trap 'rm -f "$TMP_AIFF"' EXIT

# 前导静音不是装饰：getUserMedia 实测要约 800ms 才真的进录音态，
# 不垫这一段，开头会被切掉。
say -v Tingting "[[slnc 1200]]${TXT}" -o "$TMP_AIFF"
ffmpeg -nostdin -y -loglevel error -i "$TMP_AIFF" -ar 16000 -ac 1 "$OUT"

DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" 2>/dev/null || echo '?')"
echo "已生成 $OUT (${DUR}s)"
