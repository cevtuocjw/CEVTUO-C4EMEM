/**
 * 工作区的「主动」那一块 —— 它给出来的东西 + **你处理了没有**。
 *
 * 读者 2026-10-09 原话：
 *   「工作区这里要给主动工作区一大块，给出来主动给出来的信息或者分析，
 *     要标记出来时间，是否去处理等这样来处理」
 *
 * ⚠️⚠️ 和 `activity` 是**两回事**，别合并：
 *    · `activity` 是**流水**（每问一句就多一条，只增不改）
 *    · `panel` 是**待办板**（同一件事只出现一次，而且**状态会被你改**）
 *    混在一起的话，改状态就会改到历史流水上 —— 那是一条你事后没法还原的写入。
 *
 * ⚠️ 刷新用 `INSERT OR IGNORE`（靠 `key` 唯一）：
 *    **已经处理过的条目再刷新一次不能被重置成"待处理"**。
 *    这条是这一块能不能用的分水岭 —— 状态会被刷掉的话，用户就不会再去点它。
 */
import type { Database } from 'bun:sqlite';
import { extractTodos } from './mailtodo';
import { threads } from './threads';

export type PanelState = 'new' | 'done' | 'skipped';

export interface PanelItem {
  id: number;
  key: string;
  kind: string;
  icon: string;
  title: string;
  detail: string;
  src: string;
  ts: string;
  due: string;
  state: PanelState;
}

/** 待办进面板的门槛：分数高的才进 —— 面板是"要我处理的"，不是"可能相关的"。 */
const TODO_BAR = 5;

export function refreshPanel(db: Database, opts: { self?: string } = {}): number {
  const rows: { key: string; kind: string; icon: string; title: string; detail: string; src: string; ts: string; due: string }[] = [];

  // ① 邮件里抽出来的待办
  for (const t of extractTodos(db, { spaces: ['exmail', 'wecom'], limit: 40 })) {
    if (t.score < TODO_BAR) continue;
    rows.push({
      key: `todo:${t.id}`, kind: 'todo', icon: 'check',
      title: t.sentence, detail: `${t.from} · ${t.subject}`.slice(0, 120),
      src: 'exmail', ts: `${t.date}T00:00:00.000Z`, due: t.due ?? '',
    });
  }

  // ② 线程未结 —— 「球在你那边」的那种提醒（见 src/threads.ts）
  //
  // ⚠️ **只有 `remind` 的才进面板**。判成「已结」或「看不出要你做什么」的
  //    留在功能页里自己看 —— 全往待办板上堆的话，真正要你处理的那几条
  //    会被"可能相关"淹掉，而用户看不出来区别，只会不再看这块板。
  try {
    for (const th of threads(db, { spaces: ['exmail', 'wecom'], self: opts.self ?? '' })) {
      if (!th.remind) continue;
      rows.push({
        key: `thread:${th.id}`,
        kind: 'thread',
        icon: 'clock',
        title: th.heading,
        detail: `${th.subject} · ${th.n} 封 · 最后一封是 ${th.lastFromName || th.lastFrom}${th.asks.length ? ` · 「${th.asks[0].slice(0, 60)}」` : ''}`.slice(0, 400),
        src: 'exmail',
        ts: th.lastTs,
        due: '',
      });
    }
  } catch { /* 判线程失败不该让整个面板打不开 */ }

  // ③ 主动推过的东西 —— 那是它**主动**给出的分析和提醒
  for (const a of db
    .query<{ id: number; icon: string; title: string; detail: string | null; ts: string }, []>(
      "SELECT id, icon, title, detail, ts FROM activity WHERE kind = 'proactive' ORDER BY id DESC LIMIT 60",
    )
    .all()) {
    rows.push({
      key: `pro:${a.id}`, kind: 'proactive', icon: 'bell',
      title: a.title, detail: String(a.detail ?? '').slice(0, 400),
      src: 'builtin', ts: a.ts, due: '',
    });
  }

  let added = 0;
  const ins = db.query(
    `INSERT OR IGNORE INTO panel (key, kind, icon, title, detail, src, ts, due, state)
     VALUES ($key,$kind,$icon,$title,$detail,$src,$ts,$due,'new')`,
  );
  for (const r of rows) {
    // ⚠️ 用 `changes` 判断是不是**新插入**的 —— 别去 `COUNT(*)` 两次比大小，
    //    那是 O(n²) 的写法，而且并发下会数错。
    const res = ins.run({
      $key: r.key, $kind: r.kind, $icon: r.icon, $title: r.title.slice(0, 400),
      $detail: r.detail, $src: r.src, $ts: r.ts, $due: r.due,
    });
    if (Number(res.changes ?? 0) > 0) added += 1;
  }
  return added;
}

export function listPanel(db: Database, limit = 80): { items: PanelItem[]; counts: Record<string, number> } {
  const items = db
    .query<PanelItem, [number]>(
      // ⚠️ 排序：**没处理的排前面**（状态权重 > 时间）。处理过的压到底下，
      //    不然一周之后面板上全是"已处理"，你得翻半天才看到今天该干的。
      `SELECT * FROM panel
        ORDER BY CASE state WHEN 'new' THEN 0 ELSE 1 END,
                 CASE WHEN due != '' THEN 0 ELSE 1 END,
                 ts DESC
        LIMIT ?`,
    )
    .all(limit);
  const counts: Record<string, number> = { new: 0, done: 0, skipped: 0 };
  for (const r of db.query<{ state: string; n: number }, []>('SELECT state, COUNT(*) n FROM panel GROUP BY state').all()) {
    counts[r.state] = r.n;
  }
  return { items: items.map((i) => ({ ...i, due: i.due ?? '', detail: i.detail ?? '' })), counts };
}

export function setPanelState(db: Database, id: number, state: PanelState) {
  if (!['new', 'done', 'skipped'].includes(state)) return { ok: false as const, error: `没有这个状态：${state}` };
  const r = db.query('UPDATE panel SET state = ? WHERE id = ?').run(state, id);
  return { ok: true as const, changed: Number(r.changes ?? 0) };
}
