/**
 * 主动式层。
 *
 * 三层架构（这是唯一能同时做到"有用"和"不烧钱"的结构）：
 *   ① **检测** —— 原生侧（Swift App）盯住系统事件：前台应用切换、剪贴板变化、
 *      定时、日历临近、文件打开。**这一层零 token**，全是本地事件。
 *   ② **决策** —— 就是本文件：预算、间隔、静默时段、去重。**零 token**，
 *      纯规则。绝大多数事件会死在这一层 —— 这是刻意的。
 *   ③ **生成** —— 只有真的该推的时候，才检索 + 调 LLM。**这一层才花钱**。
 *
 * ⚠️ 为什么监听不放网页里：网页拿不到系统级事件（窗口焦点、剪贴板历史、
 *    日历）。所以检测必须在 App 那一侧，通过 HTTP 把事件报到核心来。
 */
import type { Database } from 'bun:sqlite';
import { addActivity, listActivity } from './store/db';
import { loadSettings, saveSettings } from './settings';

export interface TriggerCfg {
  on: boolean;
  minGapMin: number;
  note?: string;
}

export interface ProactiveCfg {
  enabled: boolean;
  quietFrom: string;
  quietTo: string;
  perDay: number;
  triggers: Record<string, TriggerCfg>;
  /** 开口之后替你做什么（界面上的「功能」那一块） */
  features: Record<string, boolean>;
  /** 用户最近标记"这条有用/没用" —— 个性化数据飞轮的起点 */
  stats: { pushed: number; useful: number; useless: number };
}

export const DEFAULT_PROACTIVE: ProactiveCfg = {
  enabled: false, // ⚠️ 默认关。主动推送是打扰性的，必须由用户显式打开。
  quietFrom: '23:00',
  quietTo: '08:00',
  perDay: 20,
  triggers: {
    appSwitch: { on: true, minGapMin: 30, note: '切到某个应用时，看看你的笔记里有没有相关的东西' },
    clipboard: { on: true, minGapMin: 45, note: '复制了一段文字 —— 也许你记过它' },
    schedule: { on: true, minGapMin: 120, note: '每天固定时间回顾一次' },
    fileOpen: { on: false, minGapMin: 30, note: '打开某个文件（需要原生侧监听，默认关）' },
    calendar: { on: false, minGapMin: 10, note: '日历事件临近（需要授权日历，默认关）' },
  },
  /**
   * 功能开关 —— 和 `triggers` 分开：
   *   triggers = **什么时候**开口；features = 开口之后**替你做什么**。
   * 合成一个对象的话，界面就分不出「功能」和「设置」两块（用户明确要求分开）。
   */
  features: { notionAppend: false, autoTag: true, weeklyDigest: false },
  stats: { pushed: 0, useful: 0, useless: 0 },
};

/**
 * ⚠️ 触发器要**逐个键合并**，不能 `{...a, ...b}`。
 *    界面上改一个开关只发 `{appSwitch:{on:false}}`，整体覆盖会把同一格的
 *    `minGapMin` 和 `note` 一起抹掉 —— 表现是「改了一下开关，间隔就变成空的」，
 *    而且**不报错**（读回来是 undefined，输入框只是空了）。
 */
function mergeTriggers(base: Record<string, TriggerCfg>, over?: Record<string, Partial<TriggerCfg>>) {
  const out: Record<string, TriggerCfg> = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) out[k] = { ...(base[k] ?? { on: false, minGapMin: 30 }), ...v };
  return out;
}

export function loadProactive(d: string): ProactiveCfg {
  const s = loadSettings(d).proactive ?? {};
  return {
    ...DEFAULT_PROACTIVE,
    ...s,
    triggers: mergeTriggers(DEFAULT_PROACTIVE.triggers, s.triggers),
    features: { ...DEFAULT_PROACTIVE.features, ...(s.features ?? {}) },
    stats: { ...DEFAULT_PROACTIVE.stats, ...(s.stats ?? {}) },
  };
}
export function saveProactive(d: string, patch: Partial<ProactiveCfg>) {
  const cur = loadProactive(d);
  const next = {
    ...cur,
    ...patch,
    triggers: mergeTriggers(cur.triggers, patch.triggers),
    features: { ...cur.features, ...(patch.features ?? {}) },
    stats: patch.stats ?? cur.stats,
  };
  saveSettings(d, { proactive: next });
  return next;
}

const mins = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** 静默时段跨午夜要绕一圈判断，不能直接比大小。 */
export function inQuiet(cfg: ProactiveCfg, now = new Date()): boolean {
  const cur = now.getHours() * 60 + now.getMinutes();
  const a = mins(cfg.quietFrom), b = mins(cfg.quietTo);
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
}

export interface Decision {
  ok: boolean;
  reason: string;
}

/**
 * 决策层。**先看该不该推，再谈生不生成。**
 * 这条顺序不能反 —— 反了就是在噪声上花钱。
 */
export function decide(cfg: ProactiveCfg, db: Database, type: string, dedupeKey: string): Decision {
  if (!cfg.enabled) return { ok: false, reason: '主动式没开' };
  const t = cfg.triggers[type];
  if (!t?.on) return { ok: false, reason: `「${type}」这个触发没开` };
  if (inQuiet(cfg)) return { ok: false, reason: `静默时段 ${cfg.quietFrom}–${cfg.quietTo}` };

  const recent = listActivity(db, 500, 'proactive');
  const today = new Date().toISOString().slice(0, 10);
  const todayN = recent.filter((r) => r.ts.slice(0, 10) === today).length;
  if (todayN >= cfg.perDay) return { ok: false, reason: `今天已经推了 ${todayN} 条，到上限了` };

  const lastSame = recent.find((r) => (r.meta ?? '').includes(`"type":"${type}"`));
  if (lastSame) {
    const gap = (Date.now() - Date.parse(lastSame.ts)) / 60000;
    if (gap < t.minGapMin) return { ok: false, reason: `${type} 距上次只有 ${gap.toFixed(0)} 分钟（下限 ${t.minGapMin}）` };
  }
  // 去重：同一件事不要重复推
  if (dedupeKey && recent.some((r) => (r.meta ?? '').includes(dedupeKey.slice(0, 60)))) {
    return { ok: false, reason: '这件事已经推过了' };
  }
  return { ok: true, reason: '可以推' };
}

export function recordPush(
  db: Database,
  p: { type: string; title: string; detail?: string; ms?: number; tokIn?: number; tokOut?: number; dedupeKey?: string },
) {
  return addActivity(db, {
    kind: 'proactive',
    icon: '🔔',
    title: p.title,
    detail: p.detail,
    ms: p.ms,
    tokIn: p.tokIn,
    tokOut: p.tokOut,
    meta: { type: p.type, dedupeKey: p.dedupeKey },
  });
}

export function history(db: Database, limit = 60) {
  return listActivity(db, limit, 'proactive');
}

/** 给生成层的提示词 —— 要求短、要具体、不许编。 */
export function buildProactivePrompt(type: string, context: string, materials: { label: string; date: string; text: string }[]) {
  const mats = materials.map((m, i) => `【${i + 1}｜${m.label} ${m.date}】${m.text}`).join('\n');
  return {
    system:
      '你在做一个**主动式**的知识助手。用户没有问你任何问题 —— 是系统检测到了一个时机。\n' +
      '规则：\n' +
      '1. 只说**用户自己的笔记里有的**东西。材料里没有就说"（没有相关的）"，不要用你自己的知识补。\n' +
      '2. 最多两句话，像同事在旁边轻声提醒，不要客套、不要总结腔。\n' +
      '3. 如果材料里确实没什么值得说的，**就回"（没有相关的）"** —— 宁可不推，也不要凑一句废话。',
    user: `触发：${type}\n现场：${context}\n\n我笔记里可能相关的：\n${mats || '（没检索到）'}`,
  };
}
