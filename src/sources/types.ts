/**
 * 来源连接器的统一契约。
 *
 * ⚠️ 为什么要有这一层：Notion 是"页面 + 块树"，而企业微信邮件是"邮件列表"、
 *    Figma 是"文件 + 节点"、手机是"通知流" —— 结构完全不同。
 *    硬塞进 Notion 那套抽取器只会把两边都搞坏。
 *    统一成"给我一批文档"这一个接口，后面索引/检索那一层就完全不用改。
 */
export interface Doc {
  id: string;
  space: string;
  date: string;
  title: string;
  text: string;
  url: string;
  lines: number;
}

export interface ConnectorCtx {
  /** 界面里填的那些设置（含密钥） */
  settings: Record<string, any>;
  log: (m: string) => void;
}

export interface Connector {
  id: string;
  label: string;
  /** 最左侧栏那个瓦片用 */
  icon: string;
  color: string;
  /** 没配好时告诉用户缺什么 —— 不要只说"不可用" */
  need: string[];
  ready: (s: Record<string, any>) => { ok: boolean; why: string };
  fetch: (ctx: ConnectorCtx) => Promise<Doc[]>;
}

export const day = (d: Date | string) => {
  const t = typeof d === 'string' ? new Date(d) : d;
  return Number.isNaN(t.getTime()) ? '0000-00-00' : t.toISOString().slice(0, 10);
};

/** 一个通用的小工具：把长文本切成"文档"，顺便给出稳定的 id。 */
export function mkDoc(space: string, key: string, date: string, title: string, text: string, url = ''): Doc {
  return {
    id: `${space}:${key}`,
    space,
    date,
    title,
    text: text.trim(),
    url,
    lines: text.split('\n').filter(Boolean).length,
  };
}
