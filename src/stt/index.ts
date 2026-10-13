/**
 * 本地语音转文字 —— 调 `scripts/stt.py`（mlx-whisper，跑在 Apple Silicon 的 Metal 上）。
 *
 * ⚠️ 为什么是"起一个 python 子进程"而不是纯 JS：
 *    whisper 的权重 + Metal 后端在 JS 里没有同等成熟的实现，
 *    而自己拿 WebAssembly 跑一遍既慢又难调。子进程的代价是冷启动，
 *    但实测热跑一段 4 秒的语音只要 2~3 秒，够用。
 *
 * ⚠️ 为什么**在这个模块里**清代理：
 *    这台机器的 proxy 变量写在 shell profile 里，谁都会带进来；
 *    而 hf-mirror.com（模型源）恰恰是**不带代理才通**，与 GitHub 相反。
 *    清在子进程的 env 上，和调用方的环境无关。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homedir } from 'node:os';

const STT_DIR = join(homedir(), '.c4emem', 'stt');
export const STT_PY = join(STT_DIR, 'venv', 'bin', 'python');

/** 环境是否就绪 —— 界面上要能区分「没装」和「识别失败」。 */
export function sttReady() {
  return existsSync(STT_PY) && existsSync(join(process.cwd(), 'scripts', 'stt.py'));
}

export interface SttResult { text: string; ms: number }

/**
 * 转写一段 WAV（16kHz 单声道）。
 * ⚠️ 失败时**把 stderr 原样带出去** —— 只回一个"识别失败"的话，
 *    "模型没下全"和"音频是空的"长得一模一样。
 */
export async function transcribe(wav: Buffer, model?: string, lang?: string, timeoutMs = 180000): Promise<SttResult> {
  if (!sttReady()) throw new Error(`本地语音识别还没装好（缺 ${STT_PY}）。见 ~/.c4emem/stt/`);
  if (wav.length < 1000) throw new Error('音频太短，像是没录到东西');

  const dir = mkdtempSync(join(tmpdir(), 'c4stt-'));
  const file = join(dir, 'in.wav');
  writeFileSync(file, wav);
  const t0 = Date.now();
  try {
    const args = [join(process.cwd(), 'scripts', 'stt.py'), file];
    if (model) args.push(model);
    const env = { ...process.env };
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_PROXY', 'no_proxy', 'grpc_proxy']) delete (env as any)[k];
    if (model) env.C4EMEM_STT_MODEL = model;
    if (lang) env.C4EMEM_STT_LANG = lang;
    const r = await new Promise<{ code: number; out: string; err: string }>((res) => {
      const c = spawn(STT_PY, args, { env });
      let out = '', err = '';
      // ⚠️ 没有 timeout 的话，一个卡住的子进程会把请求挂到天荒地老
      const timer = setTimeout(() => { try { c.kill('SIGKILL'); } catch {} }, timeoutMs);
      c.stdout.on('data', (d) => (out += d));
      c.stderr.on('data', (d) => (err += d));
      c.on('close', (code) => { clearTimeout(timer); res({ code: code ?? -1, out, err }); });
      c.on('error', (e) => { clearTimeout(timer); res({ code: -1, out, err: String(e.message) }); });
    });
    if (r.code !== 0) throw new Error(r.err.trim().split('\n').pop() || `识别进程退出码 ${r.code}`);
    return { text: r.out.trim(), ms: Date.now() - t0 };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
