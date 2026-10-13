/**
 * LLM —— 只实现 OpenAI 兼容的 /chat/completions。
 *
 * 一个协议覆盖 DeepSeek / 硅基流动 / OpenAI / 阿里云 / 本地 Ollama / LM Studio。
 * 不做「一家一个适配器」—— 那是把简单事情复杂化，而这些服务全都提供
 * OpenAI 兼容端点。
 */
import type { Config } from '../config';
import { optionalEnv } from '../config';

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmUsage {
  in: number;
  out: number;
  total: number;
}
export interface LlmResult {
  text: string;
  /** 有些端点不返回 usage —— 那就没有，别编一个 0 当真实值 */
  usage?: LlmUsage;
  ms: number;
}

export interface Llm {
  readonly id: string;
  chat(messages: ChatMsg[]): Promise<string>;
  /** 带用量和耗时的那一版。工作区要显示 token 和对话时间，靠它。 */
  chatFull(messages: ChatMsg[]): Promise<LlmResult>;
}

/** 本地端点（ollama / LM Studio）不需要 API key。 */
const isLocalEndpoint = (base: string) =>
  /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(base);

export function createLlm(cfg: Config): Llm | null {
  if (cfg.llm.provider === 'none') return null;

  const base = (cfg.llm.baseUrl ?? '').replace(/\/$/, '');
  if (!base) return null;

  const key = optionalEnv(cfg.llm.apiKeyEnv);
  // ⚠️ 本地 ollama 不需要 key —— 以前这里 `if (!key) return null` 会把
  //    「本机跑模型」这条路也一并关掉，而它恰恰是零成本的那条。
  if (!key && !isLocalEndpoint(base)) return null; // 外部端点没 key → 降级成只给检索结果

  return {
    id: `${base}:${cfg.llm.model}`,
    async chat(messages) {
      return (await this.chatFull(messages)).text;
    },
    async chatFull(messages) {
      const t0 = Date.now();
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: cfg.llm.model,
          messages,
          temperature: cfg.llm.temperature,
          max_tokens: cfg.llm.maxTokens,
          stream: false,
        }),
      });
      if (!res.ok) throw new Error(`LLM ${res.status}：${(await res.text()).slice(0, 400)}`);
      const body = (await res.json()) as any;
      const u = body?.usage;
      return {
        text: body?.choices?.[0]?.message?.content ?? '',
        usage: u
          ? { in: u.prompt_tokens ?? 0, out: u.completion_tokens ?? 0, total: u.total_tokens ?? 0 }
          : undefined,
        ms: Date.now() - t0,
      };
    },
  };
}

/**
 * 组装 prompt。
 *
 * ⚠️ 只注入检索到的片段，**绝不**把整个知识库塞进去 —— 那是 token 爆炸的唯一来源。
 * ⚠️ 明确要求「只用给的材料回答，材料里没有就说没有」—— 否则模型会用训练记忆
 *    编出你笔记里根本没有的东西，而那是最难发现的错。
 */
export function buildAnswerPrompt(question: string, context: { label: string; date: string; text: string }[]) {
  const materials = context
    .map((c, i) => `【材料 ${i + 1}｜${c.label}｜${c.date}】\n${c.text}`)
    .join('\n\n');

  return {
    system:
      '你是 C4emem，一个只根据用户**自己的笔记**回答的助手。\n' +
      '规则：\n' +
      '1. 只使用下面给出的「材料」回答。材料里没有的，直接说「你的笔记里没有相关内容」，不要用你自己的知识补。\n' +
      '2. 每个结论后面标出材料编号，例如 [材料 2]。\n' +
      '3. 如果材料之间有时间跨度，指出这是哪一天的笔记。\n' +
      '4. 用中文，简短直接，不要客套。',
    user: `我的问题：${question}\n\n---\n以下是检索到的我的笔记：\n\n${materials}`,
  };
}
