/**
 * 设置 —— 让**别人也能用**的那一层。
 *
 * 分三层，优先级从低到高：
 *   1. `c4emem.config.json`  进阶配置（模型、检索参数）
 *   2. `.env`                程序员的习惯
 *   3. `~/.c4emem/settings.json`  **界面上填的**（在最外层，覆盖前两者）
 *
 * 为什么要有第 3 层：用户明确要求「我的 notion 接入要填哪些 api，要给别的用户也好用」。
 * 配置文件放在项目里，别人 clone 下来得改代码目录；settings.json 放在数据目录，
 * **界面上填一遍就生效，不用碰任何文件**。
 *
 * ⚠️ 密钥只写在这个文件里（它是 0600，在用户自己的家目录下），不写进仓库。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

export interface Field {
  key: string;
  label: string;
  hint?: string;
  secret?: boolean;
  placeholder?: string;
  /**
   * 在输入框旁边挂一个按钮（目前只有「选择文件夹…」用）。
   * 点了 POST 到 `action`，把返回里的 `dir`（或 `value`）填进这个框 ——
   * **只填框、不直接存**，用户还得点「保存」才生效。这样"我选好了"和"我决定用它"
   * 是两件事，误点一下不会立刻改掉存储位置。
   */
  button?: { label: string; action: string };
}

export interface Section {
  id: string;
  title: string;
  /** 界面上那句"这是干嘛的" */
  desc: string;
  /** 接上之后能干什么（没有就是还没接） */
  fields: Field[];
  docs?: string;
}

/**
 * 接入清单 —— **界面直接照这个渲染**。
 * 加一个新接入口只要往这里加一段，UI 不用改。
 */
export const SCHEMA: Section[] = [
  {
    id: 'notion',
    title: 'Notion（知识库主源）',
    desc: '把你 Notion 里的页面当知识库读进来，也能把结果写回页面。',
    docs: 'https://www.notion.so/my-integrations',
    fields: [
      { key: 'token', label: 'Internal Integration Token', secret: true, hint: 'ntn_ 或 secret_ 开头。建好后必须去每个页面 → … → 连接 → 把这个集成加上，否则 404' },
      { key: 'page.TECH AI', label: '页面 ID · TECH AI', hint: '页面链接里最后 32 位十六进制' },
      { key: 'page.tech-learn', label: '页面 ID · tech-learn' },
      { key: 'page.Shopping', label: '页面 ID · Shopping' },
      { key: 'page.Learn', label: '页面 ID · Learn' },
    ],
  },
  {
    id: 'llm',
    title: '对话模型（回答用）',
    desc: '任何 OpenAI 兼容端点都行：DeepSeek / 硅基流动 / OpenAI / 本机 ollama。',
    fields: [
      { key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.deepseek.com/v1' },
      { key: 'model', label: '模型名', placeholder: 'deepseek-chat' },
      { key: 'apiKey', label: 'API Key', secret: true, hint: '本机 ollama 可以留空' },
    ],
  },
  {
    id: 'embedding',
    title: '嵌入模型（检索用）',
    desc: '默认走本机 ollama，**不需要 key**。换成云端才填下面这些。',
    fields: [
      { key: 'provider', label: 'provider', placeholder: 'openai-compatible | local', hint: '留空 = 用配置文件里的' },
      { key: 'baseUrl', label: 'Base URL', placeholder: 'http://127.0.0.1:11434/v1' },
      { key: 'model', label: '模型名', placeholder: 'qwen3-embedding:0.6b' },
      { key: 'apiKey', label: 'API Key', secret: true },
    ],
  },
  {
    id: 'rerank',
    title: '重排模型（可选，质量更好）',
    desc: '把检索结果重新排序。留空就是关闭 —— 实测在 1602 块的规模下它不是必需。',
    fields: [
      { key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.siliconflow.cn/v1' },
      { key: 'model', label: '模型名', placeholder: 'BAAI/bge-reranker-v2-m3' },
      { key: 'apiKey', label: 'API Key', secret: true },
    ],
  },
  {
    id: 'exmail',
    title: '企业邮箱（IMAP）—— ⭐ 不需要管理员',
    desc: '读你自己那个邮箱的收件箱。**这条路成员自己就能开**：登录邮箱网页版（exmail.qq.com）→ 设置 → 客户端设置 → 开启 IMAP/SMTP → 生成「客户端专用密码」。' +
      '⚠️ 只有一种情况它也会被挡住：管理员在后台把整个企业的 IMAP 关了 —— 那只能找他开。',
    fields: [
      { key: 'email', label: '邮箱地址', placeholder: 'changjw@pingfang.net' },
      { key: 'authCode', label: '客户端专用密码', secret: true, hint: '⚠️ 不是登录密码。是邮箱设置里生成的那一串' },
      { key: 'host', label: 'IMAP 服务器', placeholder: 'imap.exmail.qq.com', hint: '腾讯企业邮箱就填这个；留空即默认' },
      { key: 'folders', label: '读哪些文件夹', placeholder: '*', hint: '默认 * = **所有**文件夹（自动跳过垃圾箱 / 已删除）。填 *all 连垃圾箱一起读；也可以点名，例如「INBOX,Sent Messages」' },
      { key: 'sinceDays', label: '往回读多少天', placeholder: '365', hint: '默认 365。这个数只决定一趟要跑多久，**不是"就这么多信"**' },
      { key: 'max', label: '每个文件夹最多取几封', placeholder: '1000', hint: '超了会只取**最近的**，并在同步日志里写明截断了' },
    ],
  },
  {
    id: 'wecom',
    title: '企业微信邮件（官方 API）—— 要管理员',
    desc: '⚠️ 这条路要 **corpId + 邮件应用 Secret**，而 Secret **只有管理员**能在管理后台拿到。' +
      '而且它只能读「应用绑定的那个邮箱账号」的收件箱，读不了成员个人邮箱。' +
      '**不是管理员的话，用上面那条 IMAP。**',
    docs: 'https://developer.work.weixin.qq.com/document/path/97369',
    fields: [
      { key: 'corpId', label: '企业 ID（corpid）' },
      { key: 'secret', label: '应用 Secret', secret: true },
      { key: 'agentId', label: 'AgentId' },
      { key: 'mailbox', label: '绑定邮箱地址', hint: '邮件要转发到这个邮箱才能被读到' },
    ],
  },
  {
    id: 'figma',
    title: 'Figma',
    desc: '把设计稿当知识源。一个项目里的文件会全部进来，含页面名和最后修改时间。',
    docs: 'https://www.figma.com/developers/api#access-tokens',
    fields: [
      { key: 'token', label: 'Personal Access Token', secret: true, hint: 'Figma → Settings → Security → Personal access tokens' },
      { key: 'projectId', label: '项目 ID', hint: '打开项目，URL 里 /project/<这串>/… ；⚠️ 不是文件 key' },
    ],
  },
  {
    id: 'adb',
    title: '手机（ADB）',
    desc: '通过 USB 连着的安卓手机：读通知流和设备状态。**不需要任何云服务**，数据不出本机。',
    fields: [
      { key: 'serial', label: '设备序列号', hint: '留空 = 自动挑第一台。用 adb devices 看序列号。⚠️ 手机要开 USB 调试并授权' },
    ],
  },
  {
    id: 'stt',
    title: '本地语音识别（whisper）',
    desc: '音频只发到本机 127.0.0.1，不上传。⚠️ **模型是空的话，认出来的会是繁体、专名也会错** —— 别用 base。',
    fields: [
      { key: 'model', label: '模型', placeholder: 'mlx-community/whisper-small-mlx', hint: 'small 起步。tiny/base 快但中文夹英文专名会听错（实测 base 把 C4emem 听成「４c,4m」）' },
      { key: 'lang', label: '语言', placeholder: 'zh', hint: '留空 = 自动检测（短句检测不准，中文建议就填 zh）' },
    ],
  },
  {
    id: 'web',
    title: '联网兜底（笔记里没有的时候）',
    desc: '知识库里查不到时会问你要不要上网找。开了「自动」就直接去找，不再弹窗。',
    fields: [
      { key: 'auto', label: '自动联网', placeholder: 'false', hint: '填 true = 笔记里没有就自己去搜，不再问。默认关 —— 联网拿到的答案不是你自己的笔记，混在一起会分不清。' },
      { key: 'provider', label: '检索来源', placeholder: 'duckduckgo', hint: 'duckduckgo（免 key，但国内直连常打不通）/ searxng（填自己的实例）/ tavily（要 key）' },
      { key: 'baseUrl', label: 'SearXNG 实例地址', placeholder: 'https://searx.example.com', hint: '只有 provider=searxng 时用' },
      { key: 'apiKey', label: 'API Key', secret: true, hint: 'tavily 才需要；duckduckgo 留空' },
    ],
  },
  {
    id: 'feishu',
    title: '飞书',
    desc: '文档 / 云盘当知识源，或把结果写回飞书。',
    docs: 'https://open.feishu.cn/document',
    fields: [
      { key: 'appId', label: 'App ID' },
      { key: 'appSecret', label: 'App Secret', secret: true },
      { key: 'folderToken', label: '要读的文件夹 token', hint: '可留空' },
    ],
  },
  {
    id: 'flow',
    title: '结构流（画布存哪）',
    desc: '画布现在**存在你自己的文件夹里**，不再是浏览器缓存 —— 换台机器、清一次缓存都还在。指到 iCloud / Dropbox / 笔记目录就等于自动同步了。',
    fields: [
      {
        key: 'dir',
        label: '存放文件夹',
        placeholder: '~/.c4emem/flows',
        hint: '留空 = 用默认（~/.c4emem/flows）。⚠️ **换文件夹不会自动搬旧画布** —— 新目录里没有就从空的开始，要带走请自己把 flow.json 拷过去。',
        button: { label: '选择文件夹…', action: '/api/flow/pick' },
      },
    ],
  },
];

const fileOf = (dataDir: string) => join(dataDir, 'settings.json');

export function loadSettings(dataDir: string): Record<string, any> {
  const f = fileOf(dataDir);
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return {};
  }
}

export function saveSettings(dataDir: string, patch: Record<string, any>): Record<string, any> {
  const cur = loadSettings(dataDir);
  // 只做一层深合并 —— 够用，而且不会有意外
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) cur[k] = { ...(cur[k] ?? {}), ...v };
    else cur[k] = v;
  }
  mkdirSync(dataDir, { recursive: true });
  const f = fileOf(dataDir);
  writeFileSync(f, JSON.stringify(cur, null, 2), 'utf8');
  try {
    chmodSync(f, 0o600); // 里面有密钥
  } catch {}
  return cur;
}

/** 界面上展示用：把密钥打码。 */
export function maskSettings(s: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(s)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = {};
      for (const [k2, v2] of Object.entries(v)) {
        const secret = /key|secret|token|pass/i.test(k2);
        out[k][k2] = secret && typeof v2 === 'string' && v2 ? v2.slice(0, 4) + '••••' + v2.slice(-3) : v2;
      }
    } else out[k] = v;
  }
  return out;
}

/** 哪些接上了 —— 界面上的小圆点靠它。 */
export function connected(s: Record<string, any>): Record<string, boolean> {
  const has = (id: string, keys: string[]) =>
    keys.every((k) => {
      const v = (s[id] ?? {})[k];
      return typeof v === 'string' && v.trim().length > 0;
    });
  return {
    notion: has('notion', ['token']),
    llm: has('llm', ['baseUrl', 'model']),
    embedding: has('embedding', ['baseUrl', 'model']),
    rerank: has('rerank', ['baseUrl', 'model']),
    wecom: has('wecom', ['corpId', 'secret']),
    figma: has('figma', ['token', 'projectId']),
    feishu: has('feishu', ['appId', 'appSecret']),
    // 联网兜底永远「可用」—— duckduckgo 免 key；配没配好由 provider 自己决定
    web: true,
    // 本地语音识别：venv 在就可用（模型按需下载）
    stt: true,
    // 结构流的存储永远「可用」—— 没填就用默认目录（~/.c4emem/flows）
    flow: true,
  };
}
