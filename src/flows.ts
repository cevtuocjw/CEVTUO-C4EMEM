/**
 * 结构流的存储 —— 落到**用户自己选的文件夹**。
 *
 * 为什么要有这一层：画布本来只活在浏览器的 localStorage 里，
 * 换台机器、清一次缓存就没了。而结构流是**攒出来、要反复跑**的东西，丢了很疼。
 *
 * 目录是可配的（设置页 flow.dir）：
 *   - 留空 ⇒ 默认 `<dataDir>/flows`（正常跑就是 `~/.c4emem/flows`）
 *   - 填了 ⇒ 用填的（支持 `~`）
 * 于是用户可以把它放进 iCloud / Dropbox / 自己的笔记目录，**天然就同步了** ——
 * 这比自己再写一套同步靠谱得多。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const FLOW_VERSION = 1;

export interface FlowState {
  version: number;
  blocks: unknown[];
  wires: unknown[];
  layout: string;
  lastKind: string;
  savedAt: string;
}

const expandHome = (p: string) => (p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p);

/**
 * 画布存哪个文件夹：设置里填了就用填的，没填就跟 **dataDir** 走。
 *
 * ⚠️⚠️ **默认值必须由 `dataDir` 推出来，不能写死 `~/.c4emem`。**
 *     2026-10-12 实测：起一个 `C4EMEM_CONFIG=/tmp/c4tour.json`（dataDir=/tmp/c4tourd）的
 *     "沙盒"实例，**知识库在副本里、画布却直接写进了真的 `~/.c4emem/flows/flow.json`**。
 *     ⇒ 一个"沙盒"只沙了一半 = **比不沙盒更危险**：你会放心地在上面试破坏性操作。
 *     正常跑时 dataDir 就是 `~/.c4emem`，所以写出来的路径和以前一字不差。
 *     （同族的坑：`pkill -f "src/server.ts"` 会把**两个**实例一起杀掉 —— 见 FACT。）
 */
export function flowDir(settings: Record<string, any>, dataDir?: string): string {
  const raw = String(settings?.flow?.dir ?? '').trim();
  if (raw) return expandHome(raw);
  return join(dataDir || join(homedir(), '.c4emem'), 'flows');
}

export const flowFile = (settings: Record<string, any>, dataDir?: string): string =>
  join(flowDir(settings, dataDir), 'flow.json');

export type LoadResult =
  | { ok: true; exists: true; state: FlowState; file: string; dir: string }
  | { ok: true; exists: false; state: null; file: string; dir: string }
  | { ok: false; reason: string; file: string; dir: string };

/**
 * 读画布。
 *
 * ⚠️⚠️ 判据是「**它真的是结构流**」，不是「`JSON.parse` 没抛」。
 *     密文、settings.json、随便一个合法 JSON 都能 parse 成功 ——
 *     不验的话下面会把它当**空画布**，症状是「我的画布没了」，
 *     而看起来像产品坏了。所以失败要**如实回报**，不能悄悄返回空。
 *     （FACT 纪律 7：夹具要验「它真的是它声称的东西」。）
 */
export function loadFlow(settings: Record<string, any>, dataDir?: string): LoadResult {
  const dir = flowDir(settings, dataDir);
  const file = join(dir, 'flow.json');
  if (!existsSync(file)) return { ok: true, exists: false, state: null, file, dir };

  let raw: any;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { ok: false, reason: '读不出来（不是合法 JSON）：' + (e as Error).message, file, dir };
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.blocks) || !Array.isArray(raw.wires)) {
    return { ok: false, reason: '这个 JSON 不是结构流（没有 blocks / wires 两个数组）—— 没动它', file, dir };
  }
  return {
    ok: true,
    exists: true,
    file,
    dir,
    state: {
      version: Number(raw.version ?? 0),
      blocks: raw.blocks,
      wires: raw.wires,
      layout: typeof raw.layout === 'string' ? raw.layout : 'default',
      lastKind: typeof raw.lastKind === 'string' ? raw.lastKind : 'act.ask',
      savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
    },
  };
}

/**
 * 写画布（原子替换）。
 *
 * ⚠️ **先写 `.tmp` 再 `rename`**：直接覆写的话，写到一半崩了留下的就是半截 JSON，
 *    下次读出来整个文件作废 —— 用户看到的还是「画布丢了」。
 *    rename 在同一文件系统内是原子的，所以要么是旧的完整版，要么是新的完整版。
 */
export function saveFlow(
  settings: Record<string, any>,
  state: Partial<FlowState>,
  dataDir?: string,
): { ok: true; file: string; dir: string; bytes: number; savedAt: string } {
  const dir = flowDir(settings, dataDir);
  const file = join(dir, 'flow.json');
  mkdirSync(dir, { recursive: true });

  const savedAt = new Date().toISOString();
  const body = JSON.stringify(
    {
      version: FLOW_VERSION,
      blocks: Array.isArray(state.blocks) ? state.blocks : [],
      wires: Array.isArray(state.wires) ? state.wires : [],
      layout: typeof state.layout === 'string' ? state.layout : 'default',
      lastKind: typeof state.lastKind === 'string' ? state.lastKind : 'act.ask',
      savedAt,
    },
    null,
    2,
  );

  const tmp = file + '.tmp';
  writeFileSync(tmp, body, 'utf8');
  renameSync(tmp, file); // ← 原子
  return { ok: true, file, dir, bytes: Buffer.byteLength(body), savedAt };
}
