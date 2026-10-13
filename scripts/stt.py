#!/usr/bin/env python3
"""本地语音转文字（mlx-whisper，跑在 Apple Silicon 的 Metal 上）。

用法：  stt.py <wav 路径> [模型名]
约定：  **stdout 只打印识别出来的文字**，其余一切（进度条、警告）都走 stderr。
        这样调用方直接读 stdout 就行，不用去解析日志。

⚠️ 为什么把模型名和语言都做成参数，以及**为什么默认是 small 不是 base**：
   实测 base（137MB）把 `C4emem` 听成「４c,4m」、`Notion` 听成「Note」——
   中文夹英文专名是这种对话的常态，base 撑不住。
   small（480MB）才把「设计稿」听对。模型文件是几百 MB，所以做成可换的。
"""
import os
import sys

# ⚠️⚠️ 必须**在 import huggingface_hub 之前**把代理清掉，两个原因：
#   ① 这台机器的 proxy 变量是写在 shell profile 里的，任何调用方都会带进来，
#      而 hf-mirror.com 恰恰是**不带代理才通**（带代理 000）—— 和 GitHub 正好相反。
#   ② 更糟的是 NO_PROXY 里含 `[::1]`，huggingface_hub 会把它当 URL 解析，
#      直接抛 `InvalidURL: Invalid port: ':1]'` —— 看起来像"模型名写错了"。
#    放在脚本里，就与谁来调、环境干不干净无关了。
for _k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy",
           "all_proxy", "NO_PROXY", "no_proxy", "grpc_proxy"):
    os.environ.pop(_k, None)

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")   # 国内直连 huggingface.co 不通

def main() -> int:
    if len(sys.argv) < 2:
        print("用法: stt.py <wav 路径> [模型名]", file=sys.stderr)
        return 2
    path = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) > 2 else os.environ.get(
        "C4EMEM_STT_MODEL", "mlx-community/whisper-small-mlx")
    lang = os.environ.get("C4EMEM_STT_LANG", "zh") or None
    if not os.path.exists(path):
        print(f"读不到音频：{path}", file=sys.stderr)
        return 3
    try:
        import mlx_whisper
        r = mlx_whisper.transcribe(
            path,
            path_or_hf_repo=model,
            language=lang,
            verbose=False,
            # ⚠️ 关掉"用上一段的结果去猜下一段"。短语音里它会把上一句的用词
            #    硬套到下一句上，听起来像"识别得很连贯"，其实是串了。
            condition_on_previous_text=False,
            # ⚠️ 给一个**简体**的提示语。whisper 对中文默认出繁体
            #    （实测：「设计稿」出来是「設計搞」的繁体版）。
            #    提示语能把输出往简体拉，但**不能全指望它** —— 所以下面还有一道转换。
            initial_prompt=os.environ.get("C4EMEM_STT_PROMPT", "以下是普通话的句子，用简体中文。"),
        )
    except Exception as e:      # 模型没下全 / 音频坏了，都要能一眼看出是哪种
        print(f"识别失败：{type(e).__name__}: {e}", file=sys.stderr)
        return 4
    text = (r.get("text") or "").strip()
    # ⚠️ 繁→简**必须自己做**，不能靠 whisper 自觉：同一个模型对同一段话，
    #    有时出简体有时出繁体（取决于前面听到什么），而这件事**不报错**，
    #    只是每次结果长得不一样。opencc 是确定性的。
    try:
        from opencc import OpenCC
        text = OpenCC("t2s").convert(text)
    except Exception as e:
        print(f"（繁简转换不可用，原样输出：{e}）", file=sys.stderr)
    sys.stdout.write(text)
    return 0

sys.exit(main())
