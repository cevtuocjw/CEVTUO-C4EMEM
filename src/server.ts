#!/usr/bin/env bun
/**
 * C4emem 本地界面 —— 一个文件里同时是**服务端**和**界面**。
 *
 * 为什么做成界面（用户原话）：
 *   「我希望的功能希望你都能在这个助手里面有按钮或者界面展示出来，让我一键调用，
 *     因为我记不住那么多功能和提示」
 *
 * 所以界面不是装饰，是**入口**：检索 / 提问 / 主题分布 / 词条 / 链接 /
 * 同步 / 每日推荐 / 写回 Notion —— 全部一个按钮。
 *
 * ⚠️ 只监听 127.0.0.1。这是个人知识库，永远不上云。
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, expandHome } from './config';
import { openDb, stats, addActivity, listActivity, deleteActivity, usageSummary, addBlock, listBlocks, deleteBlock, recentKinds, turnsOfSession, recentSessions } from './store/db';
import { loadSettings, saveSettings, maskSettings, connected, SCHEMA as SETTINGS_SCHEMA } from './settings';
import { loadFlow, saveFlow } from './flows';
import { loadProactive, saveProactive, decide, recordPush, history as proHistory, buildProactivePrompt, DEFAULT_PROACTIVE } from './proactive';
import { ALL as CONNECTORS } from './sources/connectors';
import { webSearch, fetchPage, webCfg, type WebHit } from './web/search';
import { transcribe, sttReady } from './stt';
import { createEmbedder } from './embed';
import { retrieve } from './retrieve/hybrid';
import { createReranker } from './retrieve/rerank';
import { createLlm, buildAnswerPrompt } from './llm';
import { indexDocs } from './sync';
import { loadManual, addManual, removeManual, mergeVocab, mergeLinks, mergeTax, vocabExistsIn, type ManualKind, type ManualStore } from './kbmanual';
import { installCustom, navModel, catalogFor, manageModel, installFeature, removeFeature, restoreFeature, setFeatureOff, setFeatureProactive, proactiveMarks, disconnectSource, sourceFeatureCount, BUILTIN, CATALOG, loadStore, settingsModel } from './features';
import { runningApps, activateApp, appIcon, quitApps } from './running';
import { pickDevice, ls as adbLs, read as adbRead, pull as adbPull, rm as adbRm, info as adbInfo, photos as adbPhotos } from './sources/adbfs';

/**
 * 把模型给的一整份方案，按它自己的 `## 功能N：名字` 标题**拆成几条独立的提案**。
 *
 * ⚠️⚠️ 读者 2026-10-13：「我让它自动给出来我几个功能（**不同功能**），我一键安装」
 *    —— 原来是**一整坨 markdown 塞进一张卡**：里面三四个功能混在一起，
 *    既没法一个一个装，也看不出「这是几个不同的东西」。拆开之后每个功能一条，
 *    各带自己的对话和安装键。
 * ⚠️ 拆不出来（模型没按格式写）就**原样返回一条** —— 宁可一条大的，也不要丢内容。
 */
/** 能力/权限清单 —— 单独一个小文件，读了就用，坏了就当空的（不要把整个服务带崩）。 */
const capsFile = () => join(cfg.dataDir, 'permissions.json');
function loadCaps(): { folders: string[]; note?: string } {
  try {
    const o = JSON.parse(readFileSync(capsFile(), 'utf8'));
    return { folders: Array.isArray(o?.folders) ? o.folders.filter((x: unknown) => typeof x === 'string') : [] };
  } catch { return { folders: [] }; }
}
function saveCaps(o: { folders: string[] }) {
  try { writeFileSync(capsFile(), JSON.stringify(o, null, 2)); } catch { /* 写不下去也不能让服务挂 */ }
}

function splitFeatures(md: string): { name: string; plan: string }[] {
  const text = String(md || '');
  const lines = text.split('\n');
  const idx: number[] = [];
  lines.forEach((l, i) => { if (/^\s*#{1,4}\s*功能\s*[一二三四五六七八九十\d]/.test(l)) idx.push(i); });
  if (idx.length === 0) return [{ name: '', plan: text.trim() }];
  const out: { name: string; plan: string }[] = [];
  for (let k = 0; k < idx.length; k++) {
    const start = idx[k];
    const end = k + 1 < idx.length ? idx[k + 1] : lines.length;
    const head = lines[start];
    const name = (head.split(/[：:]/).slice(1).join('：') || head.replace(/^[#\s]+/, '')).trim().slice(0, 60);
    out.push({ name, plan: lines.slice(start, end).join('\n').trim() });
  }
  return out;
}

/** 给取回来的手机图片猜一个 content-type —— 猜不出就交给浏览器嗅探 */
const guessMime = (f: string) => (/\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp'
  : /\.(heic|heif)$/i.test(f) ? 'image/heic' : 'image/jpeg');
import { contacts } from './contacts';
import { extractTodos } from './mailtodo';
import { threads, linkStats } from './threads';
import { discoverProjects, loadProjects, addProject, removeProject } from './projects';
import { cachedApps } from './apps';
import { loadProposals, addProposal, patchProposal, appendMsg, removeProposal } from './proposals';
import { applySource, parseSpec, type SourceSpec } from './sourcekit';
import { loadPets, attachDepth, savePet, removePet, probeUrl, fetchImage } from './petmaker';
import { refreshPanel, listPanel, setPanelState } from './panel';

const cfg = loadConfig();
for (const f of cfg.envFiles ?? []) {
  const p = expandHome(f);
  if (!existsSync(p)) continue;
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
    const s = raw.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i > 0 && !process.env[s.slice(0, i).trim()]) {
      process.env[s.slice(0, i).trim()] = s.slice(i + 1).trim();
    }
  }
}

const PORT = Number(process.env.C4EMEM_PORT ?? 8770);
const OUT = join(process.cwd(), 'out');

/**
 * 把界面里填的设置盖到配置上。
 *
 * ⚠️ 密钥是**注入到环境变量**的 —— 因为 createLlm / createEmbedder 是从 env 取
 * key 的，这样就不用把密钥在各处传一遍。改完设置重新调一次即可生效，不用重启。
 */
function applySettings() {
  const s = loadSettings(cfg.dataDir);
  if (s.llm) {
    if (s.llm.baseUrl) cfg.llm.baseUrl = s.llm.baseUrl;
    if (s.llm.model) cfg.llm.model = s.llm.model;
    if (s.llm.apiKey) process.env[cfg.llm.apiKeyEnv || 'C4EMEM_LLM_API_KEY'] = s.llm.apiKey;
  }
  if (s.embedding) {
    if (s.embedding.provider) cfg.embedding.provider = s.embedding.provider;
    if (s.embedding.baseUrl) cfg.embedding.baseUrl = s.embedding.baseUrl;
    if (s.embedding.model) cfg.embedding.model = s.embedding.model;
    if (s.embedding.apiKey) process.env[cfg.embedding.apiKeyEnv || 'C4EMEM_EMBED_API_KEY'] = s.embedding.apiKey;
  }
  if (s.rerank) {
    if (s.rerank.baseUrl) { cfg.rerank.provider = 'api'; cfg.rerank.baseUrl = s.rerank.baseUrl; }
    if (s.rerank.model) cfg.rerank.model = s.rerank.model;
    if (s.rerank.apiKey) process.env[cfg.rerank.apiKeyEnv || 'C4EMEM_RERANK_API_KEY'] = s.rerank.apiKey;
  }
  if (s.notion?.token) process.env[cfg.notion.apiKeyEnv || 'NOTION_TOKEN'] = s.notion.token;
}
applySettings();

/**
 * 接没接上，要看**实际能不能用**，不是看设置文件里填没填。
 *
 * ⚠️ 第一版直接返回 settings.json 的填写状态 —— 结果用户明明已经能用
 * （token 在 .env 里、模型在 config 里），界面却全显示"未接入"。
 * 判据要落在"这条链路通不通"上，不是"那个文件里有没有字"。
 */
function effectiveConnected() {
  return {
    notion: Boolean(process.env[cfg.notion.apiKeyEnv || 'NOTION_TOKEN']),
    llm: Boolean(createLlm(cfg)),
    embedding: cfg.embedding.provider !== 'openai-compatible' || Boolean(cfg.embedding.baseUrl),
    rerank: Boolean(createReranker(cfg)),
    wecom: Boolean(process.env.C4EMEM_WECOM_SECRET),
    feishu: Boolean(process.env.C4EMEM_FEISHU_SECRET),
  };
}

const db = openDb(cfg.dataDir);
let embedderPromise: ReturnType<typeof createEmbedder> | null = null;
const embedder = () => (embedderPromise ??= createEmbedder(cfg));

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

const readOut = (f: string) => {
  const p = join(OUT, f);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};

const KB_LABEL: Record<string, string> = { vocab: '词条', links: '链接', tax: '主题' };

/**
 * 手写条目。⚠️ `manual.json` 坏掉时**不能**让整个视图 500 ——
 * 但更不能装作没事（那就变成"我写的东西不见了，而界面说一切正常"）。
 * ⇒ 退回空表，同时把原因带回前端，界面上要看得见。
 */
const manualSafe = (): { s: ManualStore; error: string } => {
  try {
    return { s: loadManual(OUT), error: '' };
  } catch (e) {
    return { s: { vocab: [], links: [], tax: [] }, error: (e as Error).message };
  }
};

/**
 * 前端最左栏选了哪几个来源 —— 从查询串里读。
 * ⚠️ 用 URLSearchParams 而不是 split(',')：来源名里有空格（"TECH AI"），
 *    split 出来的东西看起来对、实际少一格，而且**不报错**。
 */
function spacesOf(url: URL): string[] | undefined {
  const v = new URLSearchParams(url.search).getAll('space').flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);
  return v.length ? v : undefined;
}

let retrieveWarn: string | null = null;
async function doRetrieve(query: string, topK = 8, spaces?: string[]) {
  retrieveWarn = null;
  // ⚠️ 必须 await：createEmbedder 返回的是 Promise<Embedder>。
  // 上一版写成 `embedder() as any` —— 那个 **`as any` 把编译器的类型报错捂住了**，
  // 于是躲过类型检查、到运行时才炸（embedder.embed is not a function）。
  // 教训：为了消一个红字而加的 `as any`，往往是把红字推迟成 500。
  const e = await embedder();
  return retrieve(db, e, query, {
    topK,
    candidates: cfg.retrieval.candidates,
    rrfK: cfg.retrieval.rrfK,
    reranker: createReranker(cfg),
    rerankTopN: cfg.rerank.topN,
    minScore: cfg.retrieval.minScore,
    spaces,
    onWarn: (m) => { retrieveWarn = m; },
  });
}


/**
 * 联网兜底 —— 笔记里查不到时走这条。
 *
 * ⚠️ 返回里**一定带 `via:'web'`**，界面据此把「网上找的」和「你自己记的」分开显示。
 *    混在一起显示的后果不是不好看，是**你分不清哪句能信**。
 * ⚠️ 联网失败要**把原因说出来**，不能退化成一个空数组 ——
 *    「网上没有」和「没连上」长得一模一样的话，你会以为是前者。
 */
async function webAnswer(q: string, sid: string, source?: string) {
  const t0 = Date.now();
  const w = webCfg(loadSettings(cfg.dataDir));
  const llm = createLlm(cfg);
  let hits: WebHit[];
  try {
    hits = await webSearch(q, w, 6);
  } catch (e) {
    const msg = (e as Error).message;
    addActivity(db, { kind: 'web', icon: '🌐', title: q, detail: `联网失败（${w.provider}）：${msg.slice(0, 110)}`, ms: Date.now() - t0, sessionId: sid });
    return { answer: `⚠️ 没能联网（${w.provider}）：${msg}`, sources: [], web: [], via: 'web' as const, webError: msg, sessionId: sid };
  }
  const pages = await Promise.all(hits.slice(0, w.maxPages).map(async (h) => ({ ...h, body: await fetchPage(h.url) })));
  if (!llm) {
    return { answer: '⚠️ 没配 LLM key —— 网页搜到了但读不了。', sources: [], web: hits.map((h) => ({ title: h.title, url: h.url })), via: 'web' as const, sessionId: sid };
  }
  const ctx = pages
    .map((p, i) => `[网页${i + 1}] ${p.title}\n${p.url}\n${(p.body || p.snippet).slice(0, 2500)}`)
    .join('\n\n');
  const r = await llm.chatFull([
    { role: 'system', content: '你用中文回答。资料来自公开网页，不是你用户的笔记。' },
    { role: 'user', content:
      `下面是从网上搜到的资料。
` +
      `⚠️ 开头第一句必须说明「以下是网上找的，不是你笔记里的」。
` +
      `每说完一条结论，在后面用 [网页N] 标出依据。资料里没有的就说没有，不要编。

` +
      `问题：${q}\n\n资料：\n${ctx}` },
  ]);
  addActivity(db, {
    kind: 'web', icon: '🌐', title: q, detail: r.text.slice(0, 160), ms: r.ms,
    tokIn: r.usage?.in, tokOut: r.usage?.out, sessionId: sid,
    meta: { answer: r.text, via: 'web', web: hits.map((h) => h.url) },
  });
  return { answer: r.text, sources: [], web: hits.map((h) => ({ title: h.title, url: h.url })), via: 'web' as const, usage: r.usage, ms: r.ms, sessionId: sid };
}

/**
 * 弹 macOS 原生的「选择文件夹」。
 *
 * ⚠️ 它会**阻塞到用户点为止**，所以必须有超时 —— 没人的时候这个进程会一直挂着，
 *    而且占住一次 HTTP 请求不放。
 * ⚠️ 用户点「取消」时 `osascript` 是**非 0 退出**（stderr 里是 `User canceled`）。
 *    那不是错误，是正常取消 —— 要区分开，否则界面会弹一个吓人的红字。
 * ⚠️ 这是**本机**才有的能力（对话框弹在跑服务的那台机器上）。
 *    拿不到就把 null 交回去，让调用方如实说"没选"，不要假装选了个默认目录。
 */
function pickFolder(): Promise<string | null> {
  return new Promise((resolve) => {
    const ps = spawn('osascript', ['-e', 'POSIX path of (choose folder with prompt "把结构流存到这个文件夹")'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => (out += String(d)));
    ps.stderr.on('data', (d) => (err += String(d)));
    const timer = setTimeout(() => {
      try { ps.kill(); } catch {}
      resolve(null);
    }, 120_000);
    ps.on('close', (code) => {
      clearTimeout(timer);
      const p = out.trim().replace(/\/+$/, '');
      if (code !== 0 || !p) {
        if (!/User canceled|用户已取消|-128/.test(err)) console.error('[flow/pick] 选文件夹失败:', err.trim() || `exit ${code}`);
        return resolve(null);
      }
      resolve(p);
    });
  });
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;

    try {
      if (p === '/api/stats') {
        const s = stats(db);
        return json({
          ...s,
          spaces: cfg.notion.spaces.map((sp) => ({
            key: sp.key,
            label: sp.label,
            n: db.query<{ n: number }, [string]>('SELECT COUNT(*) n FROM docs WHERE space = ?').get(sp.key)?.n ?? 0,
          })),
          llm: cfg.llm.model ?? null,
          hasLlm: Boolean(createLlm(cfg)),
        });
      }

      if (p === '/api/search') {
        const q = url.searchParams.get('q') ?? '';
        if (!q.trim()) return json({ hits: [] });
        const _t = Date.now();
        const hits = await doRetrieve(q, Number(url.searchParams.get('n') ?? 10), spacesOf(url));
        addActivity(db, { kind: 'search', icon: '🔍', title: q, detail: `命中 ${hits.length} 条`, ms: Date.now() - _t });
        return json({
          hits: hits.map((h) => ({
            space: h.space, date: h.date, text: h.text, sim: h.sim, via: h.via, docId: h.docId,
          })),
        });
      }

      if (p === '/api/ask' && req.method === 'POST') {
        const { q, source, sessionId, spaces } = (await req.json()) as { q: string; source?: string; sessionId?: string; spaces?: string[] };
        // 没有会话就开一个新的 —— 这样"记录 → 续聊"才接得上
        const sid = sessionId || 's' + Date.now().toString(36);
        const t0 = Date.now();
        // ⚠️⚠️ **续聊时，检索的查询词也要带上文**，不能只用当前这句。
        //    实测：「Crapette 是什么」→ 答对；接着问「那怎么玩」→ **检索捞不到**，
        //    因为"那怎么玩"这四个字本身没有任何检索信号 —— 而笔记里明明有。
        //    （模型那侧是诚实的，它说"材料里没有"，问题在检索这一层。）
        const prev = sessionId ? turnsOfSession(db, sid) : [];
        const lastQ = prev.length ? prev[prev.length - 1].title : '';
        const retrieveQ = lastQ && lastQ !== q ? `${lastQ} ${q}` : q;
        const hits = await doRetrieve(retrieveQ, cfg.retrieval.topK, spaces);
        if (!hits.length) {
          // ── 笔记里没有 ────────────────────────────────────
          // ⚠️ 这里以前是**直接返回一句写死的「笔记里没有」**，用户没有任何别的路可走。
          //    现在分成两支：设置里开了「自动联网」就直接去搜；没开就把它交回界面，
          //    由界面弹窗问「要不要上网找」——**决定权在人手里**，不在默认值手里。
          const w = webCfg(loadSettings(cfg.dataDir));
          if (w.auto) return json(await webAnswer(q, sid, source));
          addActivity(db, { kind: source ?? 'ask', icon: source === 'voice' ? '🎙' : '💬', title: q, detail: '笔记里没有相关内容', ms: Date.now() - t0, sessionId: sid, meta: { answer: '你的笔记里没有相关内容。' } });
          return json({
            answer: '你的笔记里没有相关内容。',
            sources: [], sessionId: sid,
            empty: true,              // ← 界面看到它就弹窗
            webProvider: w.provider,
          });
        }
        // ⚠️ 检索**没空手而归**不代表答得上来。顶条余弦低于 weakBelow 时，
        //    这是"弱相关"，要如实标出来 —— 不然用户以为笔记里真讲过。
        const weak = (hits[0]?.sim ?? 1) < cfg.retrieval.weakBelow;
        const llm = createLlm(cfg);
        if (!llm) {
          addActivity(db, { kind: source ?? 'ask', icon: '⚠️', title: q, detail: '未配 LLM key', ms: Date.now() - t0 });
          return json({ answer: '⚠️ 没配 LLM key，下面只给检索结果。', sources: hits.map(summarize), noLlm: true, weak });
        }
        const { system, user } = buildAnswerPrompt(
          q,
          hits.map((h) => ({ label: h.space, date: h.date, text: h.text })),
        );
        // ⚠️ **续聊的关键**：把同一个会话里前面几轮带上。
        //    不带的话，"那怎么玩"这种指代就完全没上下文 ——
        //    实测会答成"你的笔记里没有相关内容"，而其实上一轮刚说过。
        const msgs: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
          { role: 'system', content: system },
        ];
        if (sessionId) {
          for (const t of turnsOfSession(db, sid).slice(-6)) {
            let prev = '';
            try { prev = JSON.parse(t.meta ?? '{}').answer ?? ''; } catch { prev = ''; }
            msgs.push({ role: 'user', content: t.title });
            if (prev) msgs.push({ role: 'assistant', content: prev });
          }
        }
        msgs.push({ role: 'user', content: user });
        const r = await llm.chatFull(msgs);
        const isVoice = source === 'voice';
        addActivity(db, {
          kind: isVoice ? 'voice' : 'ask',
          icon: isVoice ? '🎙' : '💬',
          title: q,
          detail: r.text.slice(0, 160),
          ms: r.ms,
          tokIn: r.usage?.in,
          tokOut: r.usage?.out,
          sessionId: sid,
          // ⚠️ 完整回答存进 meta —— detail 只有 160 字，拿它恢复对话会缺内容
          meta: { sources: hits.length, model: llm.id, answer: r.text, materials: hits.map((h) => ({ space: h.space, date: h.date })) },
        });
        return json({ answer: r.text, sources: hits.map(summarize), usage: r.usage, ms: r.ms, sessionId: sid, weak, topSim: hits[0]?.sim ?? null, degraded: retrieveWarn });
      }

      // ── 本地语音识别 ──────────────────────────────────
      if (p === '/api/stt/status') return json({ ready: sttReady() });
      if (p === '/api/stt' && req.method === 'POST') {
        // ⚠️ 直接收**原始字节**（audio/wav），不走 JSON/base64 ——
        //    base64 会把体积撑大 33%，而这段音频是刚从麦克风录的，没必要多一道编解码。
        try {
          const buf = Buffer.from(await req.arrayBuffer());
          const t0 = Date.now();
          const se = loadSettings(cfg.dataDir).stt ?? {};
          // ⚠️ 模型和语言**从设置里读**，不是写死 —— 中文夹英文专名对模型大小极其敏感，
          //    别人克隆下来该能自己换。
          const r = await transcribe(buf, url.searchParams.get('model') || se.model || undefined, se.lang);
          addActivity(db, { kind: 'voice', icon: '🎙', title: r.text.slice(0, 80) || '（没听清）', detail: `本地识别 ${(r.ms / 1000).toFixed(1)}s`, ms: r.ms });
          return json({ text: r.text, ms: r.ms, model: url.searchParams.get('model') ?? 'default' });
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      }

      // 显式联网（界面上点了「上网找」）
      if (p === '/api/web' && req.method === 'POST') {
        const { q, sessionId, spaces: _sp } = (await req.json()) as { q: string; sessionId?: string; spaces?: string[] };
        const sid2 = sessionId || 's' + Date.now().toString(36);
        return json(await webAnswer(q, sid2));
      }

      // 设置里那几项（联网兜底也走这个）
      if (p === '/api/web/status') {
        const w = webCfg(loadSettings(cfg.dataDir));
        return json({ provider: w.provider, auto: !!w.auto, hasKey: !!w.apiKey, baseUrl: !!w.baseUrl });
      }

      // 统一记录 + 用量
      // ⭐ 记录栏的**批量删除**（读者 2026-10-10）。⚠️ 只删记录流水，不删会话。
      if (p === '/api/activity/delete' && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
        const ids = Array.isArray(body.ids) ? (body.ids as number[]) : [];
        const n = deleteActivity(db, ids);
        return json({ ok: true, deleted: n });
      }
      // ── 能力 / 权限（读者 2026-10-13：「要给这个软件更多的权限，例如给文件读取等权限，
      //    也有蓝牙、adb、usb……**但是要让用户来选择**」）──
      //   ⚠️ macOS 上"读文件"的正解**不是**让 App 要一个全局开关，而是
      //      **用户亲自挑目录**（NSOpenPanel）⇒ 那个目录就对这个 App 开放了。
      //      所以这里的模型是：**一张用户自己加的"可读目录"清单**。
      //   ⚠️ 单独一个文件，别塞进 `settings.json` —— 那个 schema 是 `z.object`，
      //      **会静默剥掉没声明的键**（FACT 里记过这条）。
      if (p === '/api/caps') {
        const caps = loadCaps();
        return json({ folders: caps.folders, platform: process.platform, note: caps.note });
      }
      if (p === '/api/caps/folders' && req.method === 'POST') {
        const b = (await req.json().catch(() => ({}))) as { path?: string };
        // ⚠️ 之前那个"清空全部内容"的接口我踩过：**探活不能发一个参数合法的 POST**。
        //    这里只接受一个**真实存在的目录**，别的一律 400，并且把原因说清。
        const raw = String(b.path ?? '').trim();
        if (!raw) return json({ error: '没有给目录' }, 400);
        const full = expandHome(raw);
        let st;
        try { st = statSync(full); } catch { return json({ error: '这个路径不存在：' + full }, 400); }
        if (!st.isDirectory()) return json({ error: '这不是一个目录：' + full }, 400);
        const caps = loadCaps();
        if (!caps.folders.includes(full)) caps.folders.push(full);
        caps.folders = caps.folders.slice(0, 24);
        saveCaps(caps);
        addActivity(db, { kind: 'feature', icon: '📁', title: `允许读一个目录：${full}` });
        return json({ ok: true, folders: caps.folders });
      }
      if (p === '/api/caps/folders' && req.method === 'DELETE') {
        const q = decodeURIComponent(String(url.searchParams.get('path') ?? ''));
        const caps = loadCaps();
        caps.folders = caps.folders.filter((f) => f !== q);
        saveCaps(caps);
        return json({ ok: true, folders: caps.folders });
      }
      // ⭐⭐ CEVTUO Pet：**正在运行的桌面 App**（点一下围着它弹出来选一个切过去）
      if (p === '/api/running') {
        // ⚠️ 传**全小写**：`running.ts` 那边是大小写不敏感比较，
        //    这样旧名（`C4emem.app`）和新名（`cevtuo-c4emem.app`）都能排掉。
        return json({ apps: await runningApps({ self: 'c4emem' }) });
      }
      // ⭐ 批量退出（Pet 右键那个勾选列表）。⚠️ 这是**破坏性**动作：
      //    只接受明确的 paths 数组，空数组直接回 400（"什么都没选"不能当成"全退"）。
      if (p === '/api/apps/quit' && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { paths?: unknown };
        const paths = Array.isArray(body.paths) ? body.paths.map(String).filter(Boolean).slice(0, 40) : [];
        if (!paths.length) return json({ error: '没有勾选任何软件（什么都没做）' }, 400);
        const r = await quitApps(paths);
        addActivity(db, {
          kind: 'app', icon: '🪟',
          title: `退出 ${r.done.length} 个软件${r.failed.length ? `（${r.failed.length} 个没退成）` : ''}`,
        });
        return json(r);
      }
      // ⭐ 只**记账**，不启动。Pet 现在由原生 `NSWorkspace` 直接开（几毫秒，见
      //   `app/C4ememApp.swift` 的 `launchFast`）—— 走这条 HTTP 只会多绕一圈，
      //   而"点一下要等一下才切过去"正是那么来的。
      if (p === '/api/apps/used' && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { path?: string };
        const name = String(body.path ?? '').split('/').pop()?.replace('.app', '') ?? '';
        if (name) addActivity(db, { kind: 'app', icon: '🪟', title: `切到了 ${name}` });
        return json({ ok: true });
      }
      if (p === '/api/apps/activate' && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { path?: string };
        const r = await activateApp(String(body.path ?? ''));
        if (!r.ok) return json({ error: r.error }, 400);
        addActivity(db, { kind: 'app', icon: '🪟', title: `切到了 ${String(body.path ?? '').split('/').pop()?.replace('.app', '')}` });
        return json({ ok: true });
      }
      // App 图标（缓存过的 PNG）—— 那一圈要"点一下就出现"，现转是来不及的
      if (p === '/api/appicon') {
        const r = await appIcon(cfg.dataDir, url.searchParams.get('path') ?? '');
        if ('error' in r) return new Response('', { status: 404 });
        return new Response(Bun.file(r.file), { headers: { 'content-type': 'image/png', 'cache-control': 'max-age=86400' } });
      }
      // ⭐ 「手机信息 / 手机图片」两个视图（读者 2026-10-10）走这里
      if (p === '/api/phone/info') {
        const d = await pickDevice(url.searchParams.get('serial') ?? '');
        if (!d.ok) return json({ error: d.error }, 400);
        return json({ serial: d.serial, ...(await adbInfo(d.serial)) });
      }
      if (p === '/api/phone/photos') {
        const d = await pickDevice(url.searchParams.get('serial') ?? '');
        if (!d.ok) return json({ error: d.error }, 400);
        return json({ serial: d.serial, ...(await adbPhotos(d.serial, Number(url.searchParams.get('n') ?? 60))) });
      }
      // 点开某一�张时才真的拉回来（一屏 24 张全拉要几十秒，那看着像卡死）
      if (p === '/api/phone/file') {
        const remote = url.searchParams.get('path') ?? '';
        const d = await pickDevice(url.searchParams.get('serial') ?? '');
        if (!d.ok) return json({ error: d.error }, 400);
        if (!remote) return json({ error: '要一个文件路径' }, 400);
        const dir = join(cfg.dataDir, 'phone');
        // ⚠️ 缓存文件名用**远端路径的哈希** —— 用 basename 的话，两个目录下的
        //    `IMG_0001.jpg` 会互相覆盖（看着像"取回来的图不对"）
        const key = Bun.hash(remote).toString(36);
        const local = join(dir, key + (remote.match(/\.[a-z0-9]+$/i)?.[0] ?? ''));
        if (!existsSync(local)) {
          const r = await adbPull(d.serial, remote, dir);
          if (!r.ok) return json({ error: r.error }, 400);
          const { renameSync: rn } = await import('node:fs');
          try { rn(r.file!, local); } catch { /* 已经在那就行 */ }
        }
        if (!existsSync(local)) return json({ error: '拉下来了但找不到那份文件' }, 500);
        return new Response(Bun.file(local), { headers: { 'content-type': guessMime(local), 'cache-control': 'max-age=3600' } });
      }
      // ⭐⭐ 手机文件（ADB）—— 读者 2026-10-10 深夜要的"**一双手**"，
      //    而不是"再接一个内容源"。见 src/sources/adbfs.ts 开头那段。
      if (p.startsWith('/api/adb/')) {
        const serial = url.searchParams.get('serial') ?? '';
        const dev = await pickDevice(serial);
        if (p === '/api/adb/status') {
          return json(dev.ok ? { ok: true, serial: dev.serial } : { ok: false, error: dev.error });
        }
        if (!dev.ok) return json({ error: dev.error }, 400);
        const q = url.searchParams.get('path') ?? '';
        if (p === '/api/adb/ls') {
          if (!q) return json({ error: '要一个路径（比如 /sdcard/Download）' }, 400);
          return json({ serial: dev.serial, ...(await adbLs(dev.serial, q)) });
        }
        if (p === '/api/adb/read') {
          if (!q) return json({ error: '要一个文件路径' }, 400);
          const r = await adbRead(dev.serial, q);
          addActivity(db, { kind: 'adb', icon: '📱', title: `读手机文件 ${q.split('/').pop()}`, detail: r.ok ? `${r.text?.length ?? 0} 字${r.truncated ? '（截断）' : ''}` : r.error });
          return json({ serial: dev.serial, ...r });
        }
        if (p === '/api/adb/pull' && req.method === 'POST') {
          const b = (await req.json().catch(() => ({}))) as { path?: string };
          const r = await adbPull(dev.serial, String(b.path ?? ''), join(cfg.dataDir, 'phone'));
          addActivity(db, { kind: 'adb', icon: '📥', title: `从手机取回 ${b.path}`, detail: r.file ?? r.error ?? '' });
          return json(r);
        }
        if (p === '/api/adb/rm' && req.method === 'POST') {
          const b = (await req.json().catch(() => ({}))) as { path?: string; confirm?: boolean };
          const r = await adbRm(dev.serial, String(b.path ?? ''), !!b.confirm);
          // ⚠️ 删**必须留痕** —— 这是别人手机上的文件，事后要能查出"什么时候删了什么"
          addActivity(db, { kind: 'adb', icon: '🗑', title: `${r.ok ? '删了' : '没删'}手机上的 ${b.path}`, detail: r.error ?? '' });
          if (!r.ok) return json({ error: r.error }, 400);
          return json(r);
        }
      }
      // ⭐ 网页侧的报错口子（一直缺）。⚠️ 网页里的异常**不会**出现在服务端日志里，
      //    于是"前端坏了"看起来像"服务端没反应"。Pet 那个独立小窗尤其需要它 ——
      //    它没有控制台可看。写到一个固定文件，排查时直接 tail。
      if (p === '/api/client-log') {
        const m = String(url.searchParams.get('m') ?? '').slice(0, 400);
        try {
          const { appendFileSync } = await import('node:fs');
          appendFileSync(join(cfg.dataDir, 'client.log'), new Date().toISOString() + ' ' + m + '\n');
        } catch { /* 记不下去也不能让页面挂 */ }
        return json({ ok: true });
      }
      if (p === '/api/activity') {
        return json({
          items: listActivity(db, Number(url.searchParams.get('limit') ?? 120), url.searchParams.get('kind') ?? undefined),
        });
      }
      if (p === '/api/usage') return json(usageSummary(db));

      // 设置 / 接入
      // ⭐⭐ 首次启动引导
      //   判据用**显式标记**，不用"有没有填凭据"去猜：填了一半的人不该每次开都被弹一遍。
      if (p === '/api/onboarding') {
        const st = loadSettings(cfg.dataDir);
        const first = !existsSync(join(cfg.dataDir, 'settings.json')) || st._onboarded !== true;
        return json({ first });
      }
      if (p === '/api/onboarding/done' && req.method === 'POST') {
        // ⚠️ `saveSettings` 是**深合并**，所以这一步不会碰到用户已经填好的凭据
        saveSettings(cfg.dataDir, { _onboarded: true });
        return json({ ok: true });
      }
      // ⭐⭐ 恢复最初版本（读者：「也有一键恢复在设置里，就变为最初版本这样（**但是问用户是否保留数据**）」）
      if (p === '/api/reset' && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { keepData?: boolean };
        // ⚠️ 默认**保留数据**：这个开关写反一次就是删库，宁可少删、不可多删。
        const keepData = body.keepData !== false;
        const cleared: string[] = [];
        // ① 界面上填的凭据与行为偏好 —— 清成空文件，不是删文件（回到"什么都没填"）
        try {
          const f = join(cfg.dataDir, 'settings.json');
          if (existsSync(f)) { writeFileSync(f, '{}\n', 'utf8'); cleared.push('设置与凭据'); }
        } catch { /* 权限问题别把整条恢复带崩 */ }
        // ② 功能注册表（装过 / 关过 / 标过主动式）③ 应用缓存 —— 删掉即回出厂
        for (const [name, file] of [['功能注册表', 'features.json'], ['应用缓存', 'apps-cache.json']] as const) {
          const f = join(cfg.dataDir, file);
          if (existsSync(f)) { unlinkSync(f); cleared.push(name); }
        }
        // ④ **只有明确说"连数据一起清"** 时才动库
        if (!keepData) {
          for (const t of ['activity', 'panel', 'blocks', 'docs', 'chunks', 'vec']) {
            try { db.exec('DELETE FROM ' + t); } catch { /* 表可能还没建 */ }
          }
          cleared.push('全部内容、待办与流水');
        }
        // ⚠️ 留痕要放在 DELETE **之后** —— 放前面的话，"连数据一起清"会把这条记录本身删掉，
        //    于是"操作者以为留了痕，其实什么都没有"。
        addActivity(db, {
          kind: 'flag', icon: '↺', title: '恢复最初版本',
          detail: (keepData ? '保留数据' : '数据一并清空') + '：' + (cleared.join('、') || '没有可清的东西'),
        });
        return json({ ok: true, keepData, cleared });
      }
      if (p === '/api/settings/schema') return json({ schema: SETTINGS_SCHEMA });
      if (p === '/api/settings') {
        if (req.method === 'POST') {
          const patch = (await req.json()) as Record<string, any>;
          saveSettings(cfg.dataDir, patch);
          applySettings(); // 立刻生效，不用重启
          const cur = loadSettings(cfg.dataDir);
          return json({ ok: true, values: maskSettings(cur), connected: effectiveConnected() });
        }
        const cur = loadSettings(cfg.dataDir);
        return json({ values: maskSettings(cur), connected: effectiveConnected(), dir: cfg.dataDir });
      }

      // 块（workflow 积木 / 最近输入）
      if (p === '/api/blocks') {
        if (req.method === 'POST') {
          const b = (await req.json()) as any;
          if (!b.kind || !b.label) return json({ error: '缺 kind 或 label' }, 400);
          const id = addBlock(db, b);
          return json({ ok: true, id, items: listBlocks(db), recentKinds: recentKinds(db) });
        }
        if (req.method === 'DELETE') {
          deleteBlock(db, Number(url.searchParams.get('id')));
          return json({ ok: true, items: listBlocks(db) });
        }
        return json({ items: listBlocks(db), recentKinds: recentKinds(db), keep: 50 });
      }

      // ── 结构流的存储（落到用户选的文件夹）────────────────
      if (p === '/api/flow') {
        if (req.method === 'POST') {
          const body = (await req.json()) as any;
          // ⚠️ 存之前先验形状。空数组是**合法**的（用户就是想清空画布），
          //    但「根本没有 blocks/wires 字段」不是 —— 那多半是调用方写错了，
          //    照存会**把一份好好的画布换成空的**。
          if (!Array.isArray(body?.blocks) || !Array.isArray(body?.wires)) {
            return json({ ok: false, error: '要存的东西必须有 blocks / wires 两个数组' }, 400);
          }
          return json(saveFlow(loadSettings(cfg.dataDir), body, cfg.dataDir));
        }
        return json(loadFlow(loadSettings(cfg.dataDir), cfg.dataDir));
      }

      // ── 结构流跑完之后的那些事（读者 2026-10-10）─────────────────
      //
      // 他原话：「结构流的动作在对话这里，也不是不可以，但是**最好在自己那里有 log
      //          有之后的后续处理和对话**我觉得这样比较好」
      // ⇒ 跑一次 = 一条**运行记录**（落库，能翻回去看）+ 一个**可以就着它接着问的会话**。
      //   ⚠️ 会话 id 是 `flow:<runId>`：**每次运行一个** ——
      //      共用一条的话，上上次跑的结果会混进这次的追问里，而模型照样答得像模像样。
      const runSid = (id: number | string) => `flow:${id}`;
      if (p === '/api/flow/run' && req.method === 'POST') {
        const b = (await req.json().catch(() => ({}))) as { steps?: any[]; output?: string; ms?: number; title?: string };
        const steps = Array.isArray(b.steps) ? b.steps.slice(0, 60) : [];
        if (!steps.length) return json({ error: '这次运行没有步骤' }, 400);
        const out = String(b.output ?? '');
        const id = addActivity(db, {
          kind: 'flow', icon: '🧩',
          title: String(b.title ?? '').slice(0, 120) || `跑了结构流（${steps.length} 块）`,
          // ⚠️ 结果正文存 `detail`，**步骤存 meta** —— 两者缺一，
          //    "翻回去看那次到底跑了什么"就只剩半截。
          detail: out.slice(0, 4000), ms: b.ms, meta: { steps },
        });
        return json({ ok: true, id, sid: runSid(id), steps, output: out });
      }
      if (p === '/api/flow/run') {
        const rows = db
          .query<{ id: number; title: string; detail: string | null; ts: string; ms: number | null; meta: string | null }, [number]>(
            "SELECT id, title, detail, ts, ms, meta FROM activity WHERE kind = 'flow' AND meta IS NOT NULL ORDER BY id DESC LIMIT ?",
          )
          .all(Math.min(50, Number(url.searchParams.get('limit') ?? 12) || 12));
        return json({
          items: rows.map((r) => {
            let steps: any[] = [];
            try { steps = JSON.parse(r.meta ?? '{}')?.steps ?? []; } catch { /* 坏 meta 不该让整页打不开 */ }
            return { id: r.id, title: r.title, output: r.detail ?? '', ts: r.ts, ms: r.ms, steps };
          }),
        });
      }
      if (p === '/api/flow/ask' && req.method === 'POST') {
        const b = (await req.json().catch(() => ({}))) as { runId?: number; q?: string };
        const q = String(b.q ?? '').trim().slice(0, 500);
        const runId = Number(b.runId);
        if (!q) return json({ error: '先说要问什么' }, 400);
        const row = db
          .query<{ id: number; title: string; detail: string | null; meta: string | null }, [number]>(
            'SELECT id, title, detail, meta FROM activity WHERE id = ? AND kind = ?',
          )
          .get(runId, 'flow');
        if (!row) return json({ error: '找不到这次运行记录' }, 404);
        const llm = createLlm(cfg);
        if (!llm) return json({ error: '还没配 LLM key' }, 400);
        const sid = runSid(runId);
        let steps: any[] = [];
        try { steps = JSON.parse(row.meta ?? '{}')?.steps ?? []; } catch { /* 同上 */ }
        const prev = turnsOfSession(db, sid).slice(-6)
          .map((t) => `问：${t.title}\n答：${(() => { try { return JSON.parse(t.meta ?? '{}')?.answer ?? ''; } catch { return ''; } })()}`)
          .join('\n\n');
        const t0 = Date.now();
        const ans = await llm.chat([
          { role: 'system', content: '用户在跟你讨论他刚跑的一次「结构流」的结果。只依据下面给的材料回答，材料里没有的就说没有。中文，说人话。' },
          {
            role: 'user',
            content:
              `结构流跑了 ${steps.length} 步：\n` +
              steps.map((s, i) => `${i + 1}. ${s.name ?? ''} — ${s.ok ? '✓' : '✗'} ${s.note ?? ''}`).join('\n') +
              `\n\n最终结果：\n${String(row.detail ?? '').slice(0, 3000)}` +
              (prev ? `\n\n之前的往来：\n${prev}` : '') +
              `\n\n现在他问：${q}`,
          },
        ]);
        addActivity(db, { kind: 'flow', icon: '💬', title: q, detail: '结构流追问', ms: Date.now() - t0, sessionId: sid, meta: { answer: String(ans) } });
        return json({ ok: true, q, answer: String(ans) });
      }
      if (p === '/api/flow/ask') {
        const sid = runSid(Number(url.searchParams.get('runId')));
        const turns = turnsOfSession(db, sid)
          .filter((t) => t.detail === '结构流追问')
          .map((t) => {
            let a = '';
            try { a = JSON.parse(t.meta ?? '{}')?.answer ?? ''; } catch { /* 同上 */ }
            return { q: t.title, a, ts: t.ts };
          });
        return json({ turns });
      }

      // 弹原生「选择文件夹」。只把路径**交回去**，不直接改设置 ——
      // 用户还得点「保存」。选目录和决定用它分成两步，误点一下不会搬走存储位置。
      if (p === '/api/flow/pick' && req.method === 'POST') {
        const dir = await pickFolder();
        if (!dir) return json({ ok: false, error: '没有选文件夹（取消了，或者这台机器弹不出对话框）' });
        return json({ ok: true, dir });
      }

      // ── 主动式 ────────────────────────────────────────────
      if (p === '/api/proactive') {
        if (req.method === 'POST') {
          const patch = (await req.json()) as any;
          return json({ ok: true, cfg: saveProactive(cfg.dataDir, patch) });
        }
        return json({
          cfg: loadProactive(cfg.dataDir),
          defaults: DEFAULT_PROACTIVE,
          history: proHistory(db, 40),
          canGenerate: Boolean(createLlm(cfg)),
          // ⭐ 被标成主动式的功能（在「自我改进」里勾的）—— 这一页要能看见
          //   "我勾了哪些"，否则勾了之后这里一个字都不变，用户只能怀疑没生效。
          marks: proactiveMarks(cfg.dataDir),
        });
      }

      // 原生侧（Swift App）把系统事件报到这里。**这一层是零 token 的**。
      if (p === '/api/proactive/event' && req.method === 'POST') {
        const ev = (await req.json()) as { type: string; context?: string; key?: string };
        const pc = loadProactive(cfg.dataDir);
        const d = decide(pc, db, ev.type, ev.key || ev.context || '');
        if (!d.ok) return json({ push: false, reason: d.reason });
        const llm = createLlm(cfg);
        if (!llm) return json({ push: false, reason: '没配 LLM key' });
        // ⭐ 把用户**标记成主动式**的那些功能一起交给生成层（读者 2026-10-10：
        //   「自我改进里的功能可以标记是否为主动式，然后在对话去沟通怎么作为主动式」）。
        //   ⚠️⚠️ 标了不喂给模型的话，那一下就是**纯装饰** —— 用户勾了、写了"什么时候来找我"，
        //      而推送跟以前一模一样，且**不报任何错**。所以这里必须真的把它带进去。
        const proMarks = proactiveMarks(cfg.dataDir);
        const hits = await doRetrieve(ev.context || '', 4);
        const q = buildProactivePrompt(
          ev.type,
          (ev.context || '(没有现场信息)') +
            (proMarks.length
              ? '\n\n用户把这几件设成了主动式（按他写的来，别的不提）：\n' +
                proMarks.map((m) => `· ${m.name}：${m.note || m.hint || '（没写具体规矩）'}`).join('\n')
              : ''),
          hits.map((h) => ({ label: h.space, date: h.date, text: h.text })),
        );
        const r = await llm.chatFull([
          { role: 'system', content: q.system },
          { role: 'user', content: q.user },
        ]);
        // ⚠️ 允许模型说"没有相关的" —— 这是控制噪声最重要的一环。
        //    不允许它说"没有"，它就会硬凑一句话，而硬凑的推送正是用户会关掉功能的原因。
        if (!r.text.trim() || /没有相关|無相關|无相关/.test(r.text)) {
          return json({ push: false, reason: '材料里没有值得推的东西' });
        }
        const title = (ev.context || ev.type).slice(0, 40);
        const id = recordPush(db, {
          type: ev.type, title, detail: r.text.slice(0, 300),
          ms: r.ms, tokIn: r.usage?.in, tokOut: r.usage?.out, dedupeKey: ev.key,
        });
        return json({ push: true, id, title, body: r.text, type: ev.type });
      }

      // 用户对推送的反馈 —— 个性化数据飞轮的起点
      if (p === '/api/proactive/feedback' && req.method === 'POST') {
        const { useful } = (await req.json()) as { useful: boolean };
        const pc = loadProactive(cfg.dataDir);
        saveProactive(cfg.dataDir, {
          stats: {
            ...pc.stats,
            useful: pc.stats.useful + (useful ? 1 : 0),
            useless: pc.stats.useless + (useful ? 0 : 1),
          },
        });
        return json({ ok: true });
      }

      // 会话 —— 「记录能续聊」的两个口子
      if (p === '/api/sessions') return json({ items: recentSessions(db, Number(url.searchParams.get('limit') ?? 40)) });
      if (p.startsWith('/api/session/')) {
        const sid = decodeURIComponent(p.slice('/api/session/'.length));
        const turns = turnsOfSession(db, sid).map((t) => {
          let answer = '';
          try { answer = JSON.parse(t.meta ?? '{}').answer ?? t.detail ?? ''; } catch { answer = t.detail ?? ''; }
          return { id: t.id, q: t.title, a: answer, ts: t.ts, icon: t.icon, ms: t.ms, tok: t.tok_sum };
        });
        return json({ sessionId: sid, turns });
      }

      // ── 来源连接器（企业微信邮件 / Figma / 手机）────────────
      if (p === '/api/sources') {
        const st = loadSettings(cfg.dataDir);
        return json({
          items: CONNECTORS.map((c) => {
            const r = c.ready(st);
            return { id: c.id, label: c.label, icon: c.icon, color: c.color, need: c.need, ok: r.ok, why: r.why };
          }),
        });
      }
      if (p === '/api/sources/sync' && req.method === 'POST') {
        const { id } = (await req.json()) as { id: string };
        const c = CONNECTORS.find((x) => x.id === id);
        if (!c) return json({ error: '没有这个来源' }, 404);
        const st = loadSettings(cfg.dataDir);
        const r = c.ready(st);
        if (!r.ok) return json({ error: `${c.label} 还没配好：${r.why}` }, 400);
        const t0 = Date.now();
        try {
          const logs: string[] = [];
          const docs = await c.fetch({ settings: st, log: (m) => logs.push(m) });
          const n = await indexDocs(db, await embedder(), c.label, docs, (m) => logs.push(m), {
            chunkChars: cfg.retrieval.chunkChars, overlapChars: cfg.retrieval.overlapChars, force: true,
          });
          addActivity(db, { kind: 'sync', icon: c.icon, title: `同步 ${c.label}`, detail: `取到 ${docs.length} 条 / 写入 ${n} 段`, ms: Date.now() - t0 });
          return json({ ok: true, fetched: docs.length, indexed: n, log: logs.join('\n') });
        } catch (e) {
          const msg = (e as Error).message;
          addActivity(db, { kind: 'sync', icon: '⚠️', title: `同步 ${c.label} 失败`, detail: msg.slice(0, 200), ms: Date.now() - t0 });
          return json({ error: msg }, 500);
        }
      }

      // ── 主题 / 词条 / 链接：**生成产物 + 手写条目，读取时合并** ──
      //
      // ⚠️ 合并必须发生在**读取**这一侧，不能发生在生成那一步：
      //    out/*.json 是整份覆盖的产物，手写件混进去就会被下一次重跑抹掉。
      //    见 src/kbmanual.ts 开头。
      if (p === '/api/taxonomy') {
        const { s, error } = manualSafe();
        return json({ ...(mergeTax(readOut('taxonomy.json'), s) as object), manualError: error });
      }
      if (p === '/api/link-taxonomy') {
        const { s, error } = manualSafe();
        return json({ ...(mergeLinks(readOut('link-taxonomy.json'), s) as object), manualError: error });
      }

      if (p === '/api/vocab') {
        const { s, error } = manualSafe();
        const v = mergeVocab(readOut('vocab.json'), s);
        const q = (url.searchParams.get('q') ?? '').toLowerCase();
        const entries = q
          ? v.entries.filter((e: any) => String(e.en).toLowerCase().includes(q) || String(e.zh).includes(q))
          : v.entries;
        return json({ total: v.total, manualCount: v.manualCount, manualError: error, entries: entries.slice(0, 300) });
      }

      // ── 手写条目的增 / 删 ─────────────────────────────────
      if (p === '/api/kb/manual' && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { kind?: ManualKind; item?: Record<string, unknown> };
        try {
          const r = addManual(OUT, body.kind as ManualKind, body.item ?? {});
          if (!r.ok) return json({ error: r.error }, 400);
          const e = r.entry as any;
          addActivity(db, {
            kind: 'kb',
            icon: '✍️',
            title: `手写了一条${KB_LABEL[body.kind as ManualKind] ?? '条目'}`,
            detail: String(e.en || e.zh || e.domain || e.name || '').slice(0, 120),
            meta: { kind: body.kind, id: e.id, deduped: r.deduped },
          });
          // ⚠️ `deduped` 要带出去 —— 「已经有一条一模一样的」和「存进去了」
          //    在前端长得一样，用户会以为加了两次是两条。
          // ⚠️ `existing` 同理：自动提取里已经有一条一样的时，表里会**并排出现两行**
          //    （一条手写、一条自动），用户只看到"重复"，不知道是自己刚加的。
          const existing =
            body.kind === 'vocab' && !r.deduped
              ? vocabExistsIn(readOut('vocab.json'), String(e.en ?? ''), String(e.zh ?? ''))
              : null;
          return json({ ok: true, entry: r.entry, deduped: r.deduped, existing });
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      }
      if (p === '/api/kb/manual' && req.method === 'DELETE') {
        try {
          const r = removeManual(OUT, url.searchParams.get('kind') as ManualKind, String(url.searchParams.get('id')));
          if (!r.ok) return json({ error: r.error }, 400);
          return json(r);
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      }
      if (p === '/api/kb/manual') {
        const { s, error } = manualSafe();
        const kind = url.searchParams.get('kind') as ManualKind;
        return json({ kind, items: (s as Record<string, unknown>)[kind] ?? [], error });
      }

      // ── 功能注册表：侧栏**不再写死在 HTML 里**，由这一份生成 ──
      //    见 src/features.ts 开头（读者的三条要求：分区 / 归属图标 / 能删）。
      if (p === '/api/features') {
        return json({
          ...navModel(cfg.dataDir),
          catalog: catalogFor(cfg.dataDir),
          manage: manageModel(cfg.dataDir),
          // ⭐ 设置页要的那份**扁平**清单（与侧栏分组无关，见 features.ts 的注释）
          settingsModel: settingsModel(cfg.dataDir),
        });
      }
      if (p === '/api/features/install' && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { id?: string };
        const r = installFeature(cfg.dataDir, String(body.id ?? ''));
        if (!r.ok) return json({ error: r.error }, 400);
        addActivity(db, { kind: 'feature', icon: '🚀', title: `装了功能：${r.feature.name}`, detail: r.feature.hint ?? '' });
        return json(r);
      }
      // ⭐ 一键装回来（卸载后保留 30 天里那个入口）
      if (p === '/api/features/restore' && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { id?: string };
        const r = restoreFeature(cfg.dataDir, String(body.id ?? ''));
        if (!r.ok) return json({ error: r.error }, 400);
        addActivity(db, { kind: 'feature', icon: '↩️', title: `把功能装回来了：${body.id}` });
        return json(r);
      }
      // ⭐ 暂时关闭 / 打开（**不卸载**）—— 内置的只能走这条路
      if (p === '/api/features/toggle' && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { id?: string; off?: boolean };
        const r = setFeatureOff(cfg.dataDir, String(body.id ?? ''), !!body.off);
        if (!r.ok) return json({ error: r.error }, 400);
        addActivity(db, { kind: 'feature', icon: r.off ? '🌙' : '☀️', title: `${r.off ? '暂时关掉' : '打开'}了功能：${body.id}` });
        return json(r);
      }
      // ⭐ 标记为「主动式」（读者 2026-10-10）
      if (p === '/api/features/proactive' && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { id?: string; on?: boolean; note?: string };
        const r = setFeatureProactive(cfg.dataDir, String(body.id ?? ''), !!body.on, typeof body.note === 'string' ? body.note.slice(0, 500) : undefined);
        if (!r.ok) return json({ error: r.error }, 400);
        addActivity(db, { kind: 'feature', icon: '📣', title: `${r.on ? '把功能设成主动式' : '取消主动式'}：${body.id}`, detail: body.note ?? '' });
        return json(r);
      }
      // 「或者你直接说」—— 对话式的第一步。
      // ⚠️ 它**只给方案，不落代码**：自动写代码再自动上线，失败时是**静默**的
      //    （页面照常、只是新功能点开是空的）。先让人看一眼方案，再决定要不要做。
      // ⭐⭐ 对话改功能（读者 2026-10-10：「我在自我改进那里跟它对话**他就能根据我的描述去做这些功能**，
      //    对话它也能**卸载功能**，对话也能直接**哪些作为主动、哪些去除**」）
      //    ⚠️ 这里只管**改配置**（装/卸/关/开/标主动式）—— 那类事"直接做"是安全的，因为可逆。
      //    ⚠️ **改代码**不在这里（那是 `/propose`：只出方案）。
      if (p === '/api/features/command' && req.method === 'POST') {
        const llm = createLlm(cfg);
        if (!llm) return json({ error: '还没配 LLM key —— 这一条要模型才听得懂' }, 400);
        const body = (await req.json().catch(() => ({}))) as { say?: string; apply?: boolean };
        const say = String(body.say ?? '').trim().slice(0, 200);
        if (!say) return json({ error: '先说一句要改什么' }, 400);

        // 把**真实的功能清单**喂进去，并要求 id 只能从里面抄。
        const nav = navModel(cfg.dataDir);
        const known = nav.groups.flatMap((g) => (g.items ?? []).map((i) => ({
          id: i.id, name: i.name, soft: g.name, off: !!i.off,
          installed: i.origin === 'installed', removable: !!i.removable, proactive: !!i.proactiveOn,
        })));
        const cat = (catalogFor(cfg.dataDir) as any[]).map((c) => ({ id: c.id, name: c.name, ready: !!c.ready }));
        // ⚠️⚠️ **必须把"已经关掉"的那些也列出来**。它们不在 `navModel` 里（关掉的功能不画进侧栏），
        //    于是模型**看不见它们** ⇒ 用户说「把推荐开回来」时，它只能去挑一个"看着像"的 id。
        //    实测就是这么把「推荐」开成了「主动」—— 而且回执写着 `applied:true`，一片祥和。
        const offIds: string[] = loadStore(cfg.dataDir).off ?? [];
        const offMenu = offIds
          .filter((id) => !known.some((k) => k.id === id))
          .map((id) => ({
            id,
            name: (BUILTIN as any[]).find((x) => x.id === id)?.name ?? (CATALOG as any[]).find((x) => x.id === id)?.name ?? id,
            soft: '已关闭', off: true, installed: false, removable: false, proactive: false,
          }));
        const knownAll = [...known, ...offMenu];
        const menu = knownAll.map((k) => `- ${k.id} | ${k.name}｜分区 ${k.soft}｜${k.off ? '已关闭（可以用 on 打开）' : '开着'}｜${k.installed ? '已安装' : '内置'}｜${k.removable ? '可卸载' : '内置不可卸'}｜主动式=${k.proactive ? '是' : '否'}`).join('\n');
        const catMenu = cat.map((c) => `- ${c.id} | ${c.name}｜${c.ready ? '可安装' : '尚未就绪'}`).join('\n');
        const t0 = Date.now();
        const raw = await llm.chat([
          { role: 'system', content: '你把用户的一句中文，翻译成**一条**对功能注册表的操作。只输出一个 JSON，不要解释、不要 markdown 代码块。' },
          { role: 'user', content:
            `可用的 op 只有这些：\n` +
            `  off 关闭一个开着的内置功能（可再开回来）\n` +
            `  on 重新打开一个被关闭的功能\n` +
            `  install 从"可安装"里装一个\n` +
            `  remove 卸载一个"可卸载"的（进待安装，保留 30 天）\n` +
            `  proactive_on 把某个功能标成主动式\n` +
            `  proactive_off 取消主动式\n` +
            `  none 这句话不是要改配置（比如是想让软件**长一个新功能**）\n\n` +
            `现在真实存在的功能：\n${menu}\n\n` +
            `可安装的：\n${catMenu || '（无）'}\n\n` +
            `用户说：「${say}」\n\n` +
            `⚠️ id **必须**从上面两份清单里原样抄，不许自己编；找不到合适的就返回 {"op":"none"}。\n` +
            `只输出这一个 JSON：{"op":"...","id":"...","why":"一句话说明你理解成了什么"}`,
          },
        ]);
        const txt = String(raw ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        let cmd: any = null;
        try { cmd = JSON.parse(txt); } catch { return json({ error: '模型没给出可解析的结果：' + txt.slice(0, 120) }, 502); }
        const op = String(cmd?.op ?? 'none');
        const id = String(cmd?.id ?? '');
        const why = String(cmd?.why ?? '').slice(0, 200);
        // ⚠️⚠️ **不信模型给的 id** —— 只在真实清单里认。模型编一个 id 出来，
        //    底下那堆 setFeatureOff / installFeature 会静默地什么都不做（或者做错事）。
        const inKnown = knownAll.find((k) => k.id === id);
        const inCat = cat.find((c) => c.id === id);
        const allowed = ['off', 'on', 'install', 'remove', 'proactive_on', 'proactive_off', 'none'];
        if (!allowed.includes(op) || (op !== 'none' && !(inKnown || (op === 'install' && inCat)))) {
          return json({ ok: true, op: 'none', id, why, applied: false, note: '没能把这句话对上一条真操作' });
        }
        // ⚠️⚠️ `none` 要**在这就走掉**。留着它往下走的话会掉进最后那个 `: { ok: true }` 分支
        //    ⇒ 返回 `applied:true`，而**什么都没发生**。这正是本项目最忌的那件事：
        //    "操作者收到成功回执、事情没发生"。实测就是这么报的。
        if (op === 'none') {
          return json({
            ok: true, op: 'none', id: '', applied: false,
            note: '这句话没对上任何一条现成的操作。想让它长一个新功能，走「给选中的软件想功能」那条路。',
          });
        }
        const name = (inKnown as any)?.name ?? (inCat as any)?.name ?? id;
        // 没让执行就**只给方案**（和"改代码只出方案"对齐：能直接做的也先让人看一眼）
        if (body.apply !== true) return json({ ok: true, op, id, name, why, applied: false });
        const r: any =
          op === 'off' ? setFeatureOff(cfg.dataDir, id, true)
          : op === 'on' ? setFeatureOff(cfg.dataDir, id, false)
          : op === 'install' ? installFeature(cfg.dataDir, id)
          : op === 'remove' ? removeFeature(cfg.dataDir, id)
          : op === 'proactive_on' ? setFeatureProactive(cfg.dataDir, id, true)
          : op === 'proactive_off' ? setFeatureProactive(cfg.dataDir, id, false)
          : { ok: true };
        const ok = r?.ok !== false;
        addActivity(db, {
          kind: 'feature', icon: '🪄', title: '对话改功能：' + say.slice(0, 24),
          detail: op + ' ' + name + (ok ? '' : '（' + (r?.error ?? '没成') + '）'), ms: Date.now() - t0,
        });
        return json({ ok, op, id, name, why, applied: ok, error: ok ? undefined : r?.error });
      }
      if (p === '/api/features/propose' && req.method === 'POST') {
        const llm = createLlm(cfg);
        if (!llm) return json({ error: '还没配 LLM key —— 这一条要模型才能想' }, 400);
        const body = (await req.json().catch(() => ({}))) as { wish?: string; app?: string; known?: string };
        const wish = String(body.wish ?? '').trim().slice(0, 300);
        // ⭐ 从「我电脑里的软件」点进来的：这时**用户还没说要什么**，
        //    是让我们**替他想**。所以 wish 可以空，但 app 必须有。
        const app = String(body.app ?? '').trim().slice(0, 80);
        if (!wish && !app) return json({ error: '先说一句你想要什么，或者先在下面点一个软件' }, 400);
        const s = stats(db);
        const cur = navModel(cfg.dataDir).groups.map((g) => `${g.name}：${g.items.map((i) => i.name).join('、')}`).join('\n');
        const t0 = Date.now();
        const plan = await llm.chat([
          { role: 'system', content: '你在给一个本机的个人知识库软件设计新功能。用户说想要什么，你给一份能直接落地的方案。中文，说人话，不要客套也不要写代码。' },
          {
            role: 'user',
            content:
              `这个软件现在有的功能：\n${cur}\n\n` +
              `它能看到的数据：${s.bySpace.map((x) => `${x.space} ${x.n} 条`).join('、')}（共 ${s.docs} 段）\n\n` +
              (app
                ? `用户电脑里装着「${app}」${body.known ? `（我们已经接了它的数据：${body.known}）` : '（我们**还没接**它）'}。\n` +
                  `请针对「${app}」想 **2~3 个**这个知识库软件能做的功能：` +
                  `比如把它接成来源、或者从它已经产出的东西里提炼内容。\n` +
                  (wish ? `另外用户补了一句：${wish}\n` : '') +
                  // ⚠️⚠️ 这一段是**修一个真实答错**的：AndroMeld 那条提案，模型回的是
                  //    "工具类软件的正确接法是不接"—— 对**它被问的那个问题**（接成内容源）是对的，
                  //    但读者真正想要的是「**通过 ADB 去读写手机文件**」。
                  //    两个问题混成一个，就会得到"看着有道理、其实答错了"的结论。
                  `⚠️ **先分清两件事，别混**：\n` +
                  `  ① **当来源** —— 它有没有"一段一段的内容"可以抽进知识库（笔记/邮件/聊天记录有）。\n` +
                  `  ② **当能力** —— 它能不能**替用户去读写别的数据**（ADB 能操作手机文件；` +
                  `Chrome 扩展能抓网页；AppleScript / CLI 能驱动别的 App；导出器能把私有格式变成文本）。\n` +
                  `  ⇒ **工具类软件的价值几乎全在第②类**。所以**不要**因为"它没有内容"就回"接不了"，` +
                  `先找它有没有 CLI / API / 自动化接口 / 导出能力，然后设计"**能操作什么**"的功能。\n` +
                  `  ⇒ 只有**两样都想不到**才说接不了，而且要写明是"没有内容可读"还是"没有任何可驱动的地方"。\n\n`
                : `用户想要：${wish}\n\n`) +
              `每个功能给：① 一句话说它是什么 ② 读哪份数据 ③ 界面上长什么样、放哪个分区 ` +
              `④ 归属哪个来源 ⑤ 大概怎么实现（2~3 步）。`,
          },
        ]);
        addActivity(db, { kind: 'feature', icon: '🚀', title: app ? `给「${app}」想功能` : '它想了一个功能', detail: app || wish, ms: Date.now() - t0 });
        // ⭐ 一起把**拆好的几条**带回去（前端据此每条建一条提案）
        const feats = splitFeatures(String(plan));
        return json({ ok: true, wish, app, plan: String(plan), features: feats });
      }
      // ⭐⭐ 「**把这个软件全部断联**」—— 不是卸载你电脑上的那个软件，
      //    是把**我们这个软件里**为了用它而装的那些功能拿掉（读者 2026-10-10）。
      //    装进来的 → 卸载（进待安装，保留 30 天）；内置的 → 暂时关闭（卸不掉，代码在仓库里）。
      if (p === '/api/features/disconnect' && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { source?: string };
        const src = String(body.source ?? '');
        const before = sourceFeatureCount(cfg.dataDir, src);
        const r = disconnectSource(cfg.dataDir, src);
        if (!r.ok) return json({ error: r.error }, 400);
        addActivity(db, {
          kind: 'feature', icon: '🔌',
          title: `断开了「${src}」的全部连接`,
          detail: `卸载 ${r.removed.length} 个（保留 30 天）+ 暂时关闭 ${r.off.length} 个`,
        });
        return json({ ...r, before });
      }
      // 「断开它要动几个功能」—— 点之前先说清楚，别让人按一下才知道
      if (p === '/api/features/source' ) {
        const src = url.searchParams.get('source') ?? '';
        return json(sourceFeatureCount(cfg.dataDir, src));
      }
      if (p.startsWith('/api/features/') && req.method === 'DELETE') {
        const id = decodeURIComponent(p.slice('/api/features/'.length));
        const r = removeFeature(cfg.dataDir, id);
        if (!r.ok) return json({ error: r.error, builtin: r.builtin ?? false }, 400);
        addActivity(db, { kind: 'feature', icon: '🗑', title: `卸载了功能：${r.name}`, detail: '保留 30 天，可以一键装回来' });
        return json(r);
      }

      // ── 功能提案 —— 「沟通 / 开始制作 / 安装」三步的那个东西 ──
      //    见 src/proposals.ts（它为什么必须落盘、为什么只有三个状态，都写在那儿）。
      if (p === '/api/proposals' && req.method === 'POST') {
        const b = (await req.json().catch(() => ({}))) as { app?: string; plan?: string; title?: string };
        const r = addProposal(cfg.dataDir, { app: b.app, plan: String(b.plan ?? ''), title: b.title });
        if (!r.ok) return json({ error: r.error }, 400);
        return json(r);
      }
      if (p === '/api/proposals') {
        return json(loadProposals(cfg.dataDir));
      }
      if (p === '/api/proposals/chat' && req.method === 'POST') {
        const b = (await req.json().catch(() => ({}))) as { id?: string; q?: string };
        const q = String(b.q ?? '').trim().slice(0, 500);
        if (!q) return json({ error: '先说要问什么' }, 400);
        const item = loadProposals(cfg.dataDir).items.find((x) => x.id === String(b.id));
        if (!item) return json({ error: '找不到这条提案' }, 404);
        const llm = createLlm(cfg);
        if (!llm) return json({ error: '还没配 LLM key' }, 400);
        const t0 = Date.now();
        const ans = await llm.chat([
          { role: 'system', content: // ⚠️⚠️⚠️ 读者 2026-10-13：「它非常笨，**完全不懂我的意思**……为什么它还是这么不聪明呢」。
          //    查下来**不是模型笨**（Key 和模型都对），是**它拿到的上下文太少 + 没人告诉它它是谁**：
          //    原来只丢给它一段方案正文，于是它退回成"我只是个聊天机器人"，
          //    开始回「我看不到你的文件系统」「我没有访问权限」——**这些在这个场景里是错的**：
          //    能不能扫盘是**这个软件**决定的，而它的活就是**把这个功能该怎么扫写清楚**。
          //    ⇒ 补三样：它是什么身份、这软件现在有什么、这条提案是什么。
          `你是「C4emem」——一个**本机的个人知识库软件**——里面的**功能设计助手**。\n` +
          `用户正在和你一起打磨**一条还没做、做出来要装进这个软件的功能**。\n` +
          `你的活是**跟他把"这个功能到底怎么设计"聊清楚**（读哪份数据、扫哪里、界面上长什么样）。\n\n` +
          `⚠️⚠️ **绝对不要**说「我只是一个对话助手」「我看不到你的文件系统」「我没有访问权限」——\n` +
          `   在这个场景里那些话是**错的**：能不能读盘、能不能扫目录，是**这个软件**的能力，\n` +
          `   而你要做的就是把「读什么、怎么读」写清楚，让它落地。\n` +
          `⚠️ 说话要**短**：先给结论，再给两三条要点。**不要输出一大段自我限制**。\n` +
          `⚠️ 拿不准的地方**问一句**（例如「是 C:\\Users\\<你>\\OneDrive\\zr 还是企业版路径？」），\n` +
          `   但先把已经能定的部分说清楚。\n` +
          `⚠️ **名字以用户说的为准**：他起什么名就叫什么，不要说「材料里没有这个名字」。\n` +
          `⚠️ 不要写长篇代码；要说的是"要做什么"。中文。\n` +
          `\n这个软件现在有的功能：\n` + navModel(cfg.dataDir).groups.map((g) => `${g.name}：${g.items.map((i) => i.name).join('、')}`).join('\n') +
          `\n\n它能看到的数据：` + stats(db).bySpace.map((x) => `${x.space} ${x.n} 条`).join('、') + `\n` +
          // ⚠️⚠️⚠️ 读者 2026-10-13：「我告诉它制作的这个功能叫做 zronedrive，但是它听不懂」。
          //    真因就是原来那句「材料里没有的就说没有」—— 模型拿**用户起的名字**去材料里查，
          //    查不到就回「材料里没有 zronedrive 这个功能名称，我不能替它编一个出来」。
          //    ⇒ 名字是**用户起的**，不是你从材料里查的。
          '⚠️⚠️ **名字以用户说的为准**：他给这个功能起什么名字（比如「zronedrive」），就叫这个名字 —— '
          + '不要因为「材料里没出现这个词」就说「没有」「不能编」。**那名字是他起的，不是你查的**；把它接过来，继续讨论怎么做。\n'
          + '⚠️ 只有**事实**（这个软件现在有什么功能、数据里有什么）才说「材料里没有」；'
          + '**用户提的新需求、新命名、新做法，一律照他说的办。**\n'
          // ══════════════════════════════════════════════════════════════
          // ⭐⭐ 2026-10-13 读者：「你要能接 api deepseek 然后做出来一个对话反复处理，
          //    **最终能帮我做出来这个功能**」——
          //    而在此之前，这里**只出文字**（`/api/proposals/plan` 明确写着"不写代码"）。
          // ⇒ 现在让它在**表达得了**的时候，把那份定义吐成一段结构化 JSON；
          //    服务端把它抠出来 → 由 `sourcekit.applySource` **确定性地**做出来。
          // ⚠️ 这不是"让模型写代码"（那条路这个项目刻意否掉了，理由见 proposals.ts 开头），
          //    是**让模型填一张表**：读哪里、读什么、叫什么。
          //    做出来的是真东西 —— 索引真的文件、进真的库、回真的条数。
          + '\n\n【重要】如果你已经把这件事想清楚了，**在回答的最后**附一段（只在最后，只附一次）：\n'
          + '```spec\n{"kind":"folder","name":"<他给的名字>","path":"<要读的目录，知道就写，不知道就留空>","exts":["md","txt"]}\n```\n'
          + '其中 `kind` 只能是 `folder`（读一个本地文件夹）或 `url`（读一个网址）。\n'
          + '⚠️ **不确定就先别附** —— 先把他问清楚（比如目录到底在哪）。附了就代表你建议**现在就这么做**。\n'
          + '⚠️ 如果这件事**不是**这两种（比如要连一个在线服务、要调一个 API），'
          + '就**不要附** spec，并用一句话说清「这一步现在做不了，能做的是哪一半」。\n'
          + '⚠️ 附的时候**不要**在正文里重复那段 JSON。\n' },
          {
            role: 'user',
            content:
              (item.app ? `这条是给「${item.app}」提的。\n` : '') +
              `提案方案：\n${item.plan.slice(0, 3000)}\n` +
              (item.msgs.length
                ? `\n之前的往来：\n${item.msgs.slice(-4).map((m) => `问：${m.q}\n答：${m.a}`).join('\n\n')}\n`
                : '') +
              `\n现在他问：${q}`,
          },
        ]);
        // ⚠️ 那段 ```spec 是**给机器看的**，不该出现在气泡里（用户要看的是"它打算做什么"）。
        //    抠出来存进提案，正文是洗掉之后的那份。
        const { spec, prose } = parseSpec(String(ans));
        const r = appendMsg(cfg.dataDir, item.id, q, prose);
        if (spec) patchProposal(cfg.dataDir, item.id, { spec });
        addActivity(db, { kind: 'feature', icon: '💬', title: `聊提案：${item.title}`, detail: q, ms: Date.now() - t0 });
        return json({ ...r, spec });
      }
      // ⭐⭐⭐ 2026-10-13：「**最终能帮我做出来这个功能**」。
      //   ⚠️⚠️ 判据**只有两个真数**：`docsAdded` / `chunksAdded`。
      //       "模型说它做好了"不算，界面上的 ✅ 也不算。
      //   ⚠️ 做不成就**如实说做不成** + 能做的是哪一半，不假装（这个项目最贵的一课）。
      // ══════════════════════════════════════════════════════════════
      //  ⭐⭐ 一起造一只新的 Pet（读者 2026-10-13）
      //  「我给你一个链接你对话跟我然后我们一起制作好一个新的 pet」
      //
      //  ⚠️⚠️ 抠图**在浏览器里做**（canvas）—— 本机没有任何 PNG 编解码器。
      //     这里只负责：列页面上的图 / 把图取成 data:URL / 存下抠好的结果。
      //  ⚠️ 判据不是"生成了"，是**真的存下来了、而且主体占比正常**。
      // ══════════════════════════════════════════════════════════════
      if (p === '/api/pet/probe' && req.method === 'POST') {
        const b = (await req.json().catch(() => ({}))) as { url?: string };
        const url = String(b.url || '').trim();
        if (!/^https?:\/\//i.test(url)) return json({ error: '给一个 http/https 的链接' }, 400);
        const r = await probeUrl(url);
        if (!r.ok) return json({ error: r.error }, 400);
        return json(r);
      }
      if (p === '/api/pet/fetch' && req.method === 'POST') {
        const b = (await req.json().catch(() => ({}))) as { url?: string };
        const r = await fetchImage(String(b.url || '').trim());
        if (!r.ok) return json({ error: r.error }, 400);
        return json(r);
      }
      if (p === '/api/pet/save' && req.method === 'POST') {
        const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const r = savePet(cfg.dataDir, b as never);
        if (!r.ok) return json({ error: r.error }, 400);
        addActivity(db, { kind: 'feature', icon: '🌹', title: `做了一只新 Pet：${r.item.nm}`, detail: `主体占 ${(r.item.cover * 100).toFixed(0)}%` });
        return json(r);
      }
      if (p === '/api/pet/depth' && req.method === 'POST') {
        // ⭐ 给已经做好的一只**补上深度图**（老的那些是在 3D 这条路存在之前做的）
        const b = (await req.json().catch(() => ({}))) as { id?: string; depth?: string; depthW?: number; depthH?: number };
        const r = attachDepth(cfg.dataDir, String(b.id || ''), b);
        if (!r.ok) return json({ error: r.error }, 400);
        return json(r);
      }
      if (p === '/api/pet/remove' && req.method === 'POST') {
        const b = (await req.json().catch(() => ({}))) as { id?: string };
        const r = removePet(cfg.dataDir, String(b.id || ''));
        if (!r.ok) return json({ error: r.error }, 400);
        return json({ ok: true });
      }
      if (p === '/api/pet/forms') {
        const reg = loadPets(cfg.dataDir);
        // ⚠️ 对外**只给 URL，不给磁盘路径**（`file` 是绝对路径，页面用不上它）。
        //    `depth` 有值 = 这只是**真 3D**；没有 = 退回叠层。
        //    两种都要**如实带出去** —— 页面上"这只没有 3D"和"3D 坏了"必须分得开。
        const items = reg.items.filter((x) => !reg.removed.includes(x.id)).map((x) => ({
          id: x.id, nm: x.nm, w: x.w, h: x.h, cover: x.cover, ts: x.ts, from: x.from,
          img: `/pets/${x.id}.png`,
          ...(x.depth ? { depth: `/pets/${x.id}.depth.png`, depthW: x.depthW || 512, depthH: x.depthH || 512 } : {}),
          ...(x.depth && x.tune ? { tune: x.tune } : {}),
        }));
        return json({ items });
      }

      if (p === '/api/features/make' && req.method === 'POST') {
        const b = (await req.json().catch(() => ({}))) as { id?: string; spec?: SourceSpec; name?: string };
        const item = b.id ? loadProposals(cfg.dataDir).items.find((x) => x.id === String(b.id)) : undefined;
        // 名字：**用户填的那个优先**（他说叫什么就叫什么），其次提案存的，最后是 spec 里的
        const name = String(b.name || item?.title || b.spec?.name || '新来源').trim().slice(0, 60);
        const spec: SourceSpec | null = b.spec ?? item?.spec ?? null;
        if (!spec) {
          return json({ error: '这条还没有能执行的方案 —— 先跟它聊清楚「读哪里」，它会附一份可执行的定义' }, 400);
        }
        if (spec.kind === 'folder' && !spec.path) {
          // ⚠️ 这个空**必须说清去哪儿填**，不然它就是一句"缺参数"（而这个项目的规矩是：
          //    沉默的空 = 无法诊断）。
          return json({ error: '它还不知道要读哪个目录。去「设置 → 这个软件能用你的什么」把那个文件夹授权给它，然后告诉我路径。' }, 400);
        }
        // ⚠️⚠️ `createEmbedder` 是**异步**的（我第一版写成同步调用，于是 `embedder` 拿到一个
        //    Promise ⇒ `embedder.embed is not a function` ⇒ 整条路直接崩）。
        //    而且这里要用**模块级缓存的那一个**（`embedder()`），不要再建一个：
        //    每次新建都会重连一次 ollama，而它是个几百 MB 的模型。
        let emb;
        try { emb = await embedder(); } catch (e) {
          return json({ error: '嵌入模型连不上（本机 ollama 起了吗）：' + String(e).slice(0, 120) }, 400);
        }
        const t0 = Date.now();
        const res = await applySource({ ...spec, name }, db, emb, (m) => console.log(m));
        if (!res.ok) {
          addActivity(db, { kind: 'feature', icon: '⚠️', title: `没做成：${name}`, detail: res.error, ms: Date.now() - t0 });
          return json({ error: res.error, ...res }, 400);
        }
        // ⭐ 真做成了才登记进侧栏 —— 先登记后索引的话，失败时侧栏会多一个点开是空的条目，
        //    而"点开是空的"和"这个功能没做"长得一模一样。
        const fid = `src-${res.space}`;
        const cand = installCustom(cfg.dataDir, {
          id: fid, name, view: 'search', spec,
          hint: spec.kind === 'folder' ? `读 ${spec.path}` : `读 ${spec.url}`,
        });
        if (item) patchProposal(cfg.dataDir, item.id, {
          state: 'installed', featureId: fid,
          made: { docs: res.docsAdded, chunks: res.chunksAdded, scanned: res.scanned, truncated: res.truncated, space: res.space, at: new Date().toISOString() },
        });
        addActivity(db, { kind: 'feature', icon: '🚀', title: `做出来了：${name}`, detail: `${res.docsAdded} 篇`, ms: Date.now() - t0 });
        return json({
          ok: true, featureId: fid, feature: cand.feature, space: res.space,
          docsAdded: res.docsAdded, chunksAdded: res.chunksAdded,
          scanned: res.scanned, skipped: res.skipped, truncated: res.truncated, warnings: res.warnings,
          ms: Date.now() - t0,
        });
      }
      if (p === '/api/proposals/plan' && req.method === 'POST') {
        const b = (await req.json().catch(() => ({}))) as { id?: string };
        const item = loadProposals(cfg.dataDir).items.find((x) => x.id === String(b.id));
        if (!item) return json({ error: '找不到这条提案' }, 404);
        const llm = createLlm(cfg);
        if (!llm) return json({ error: '还没配 LLM key' }, 400);
        const s = stats(db);
        const t0 = Date.now();
        const plan = await llm.chat([
          { role: 'system', content: '你在给一个本机的个人知识库软件写**实现步骤**。中文，说人话，不要客套。⚠️ 不要贴整段代码，给"改哪个文件、加什么、怎么证明它对了"就够了。' },
          {
            role: 'user',
            content:
              `这个软件现在的数据：${s.bySpace.map((x) => `${x.space} ${x.n} 条`).join('、')}（共 ${s.docs} 段）\n` +
              `它现在的功能：${navModel(cfg.dataDir).groups.map((g) => `${g.name}(${g.items.map((i) => i.name).join('、')})`).join('；')}\n\n` +
              `要做的功能（已经有方案了）：\n${item.plan.slice(0, 2500)}\n\n` +
              `请给一份能照着做的步骤：① 读哪份数据、从哪儿拿 ② 新建/改哪个文件 ` +
              `③ 界面上长什么样、放在哪个软件下面 ④ **怎么证明它是对的**（要能红的判据，不是"看起来对"）` +
              ` ⑤ 会踩的坑（2~3 条）。`,
          },
        ]);
        patchProposal(cfg.dataDir, item.id, { plan: `${item.plan}\n\n──── 实现步骤 ────\n${plan}`, state: 'planned' });
        addActivity(db, { kind: 'feature', icon: '🛠', title: `出了实现步骤：${item.title}`, ms: Date.now() - t0 });
        return json({ ok: true, plan: String(plan) });
      }
      if (p === '/api/proposals/install' && req.method === 'POST') {
        const b = (await req.json().catch(() => ({}))) as { id?: string; featureId?: string };
        const item = loadProposals(cfg.dataDir).items.find((x) => x.id === String(b.id));
        if (!item) return json({ error: '找不到这条提案' }, 404);
        const fid = String(b.featureId ?? '').trim();
        // ⚠️ **装不了就直接说**，不要"记一笔已安装"糊过去 —— 那是最坏的一种错：
        //    操作者收到成功回执，而侧栏里什么都没有。
        if (!fid) return json({ error: '这条提案还没有对应的功能可以装 —— 先「开始制作」' }, 400);
        const r = installFeature(cfg.dataDir, fid);
        if (!r.ok) return json({ error: r.error }, 400);
        patchProposal(cfg.dataDir, item.id, { state: 'installed', featureId: fid });
        addActivity(db, { kind: 'feature', icon: '🚀', title: `装着提案里的功能：${r.feature.name}` });
        return json({ ok: true, feature: r.feature });
      }
      // ⭐ 改这条提案的**名字**（读者 2026-10-13：「直接给用户一个地方可以填写功能的名字就好了」）。
      //   ⚠️ 名字是**用户说了算**的：他写什么就是什么，不去"材料"里查。
      if (p.startsWith('/api/proposals/') && req.method === 'PATCH') {
        const id = decodeURIComponent(p.slice('/api/proposals/'.length));
        const b = (await req.json().catch(() => ({}))) as { title?: string; spec?: SourceSpec };
        // ⚠️⚠️ **只应用"真给了的"字段。**
        //    第一版是 `{ title: String(b.title ?? '').trim() }` ——
        //    于是**任何不带 title 的 PATCH 都会把标题抹成空**，
        //    而它**不报错、界面看起来也正常**（标题栏空着，用户只会以为是自己没起名字）。
        //    我是发一条只带 `spec` 的请求时当场看见 `"title": ""` 才发现的。
        const patch: { title?: string; spec?: SourceSpec } = {};
        if (typeof b.title === 'string') patch.title = b.title.trim().slice(0, 80);
        if (b.spec && typeof b.spec === 'object') patch.spec = b.spec;
        if (!Object.keys(patch).length) return json({ error: '这条请求里没有要改的东西（title 或 spec）' }, 400);
        const r = patchProposal(cfg.dataDir, id, patch);
        if (!r.ok) return json({ error: r.error }, 404);
        return json(r);
      }
      if (p.startsWith('/api/proposals/') && req.method === 'DELETE') {
        const id = decodeURIComponent(p.slice('/api/proposals/'.length));
        const r = removeProposal(cfg.dataDir, id);
        if (!r.removed) return json({ error: '没这条提案' }, 400);
        return json(r);
      }

      // ── 本机装了哪些软件 —— 「自我改进」那一屏的候选清单 ──
      //    ⚠️ 给的是**应用目录里真实的那些**，不是我们支持的清单：
      //      用户记不住自己装了什么，而"能接什么"决定了还能长出什么功能。
      if (p === '/api/apps') {
        // ⭐ 缓存 + **每天过期**（读者：「跟着每天更新一下获取一遍用户的电脑，而不是写死的」）。
        //    `?refresh=1` 强制重扫（设置页那个「重新扫一遍」按钮走它）。
        const r = cachedApps(cfg.dataDir, { force: url.searchParams.get('refresh') === '1' });
        return json({ total: r.apps.length, apps: r.apps, scanned: r.scanned, scannedAt: r.scannedAt, fromCache: r.fromCache });
      }

      // ── 按软件看：每个软件一块，内容 + 它带来的功能 ────────
      //    读者：「也要有另外的按照软件的版式样，给知识库功能都列一起的那种视图方式每个软件」
      if (p === '/api/bysource') {
        const st = stats(db);
        const feats = navModel(cfg.dataDir).groups.flatMap((g) => g.items.map((i) => ({ ...i, groupName: g.name })));
        const bySpace = new Map(st.bySpace.map((x) => [x.space, x.n]));
        const labelOf = new Map(cfg.notion.spaces.map((sp) => [sp.key, sp.label]));
        // ⚠️ 这张表是「**软件 → 它管的 space**」。它和 UI 里那份 SOURCES 是**两边**，
        //    不一致的症状是"某个软件下面一条内容都没有"，而它明明有 —— 所以放服务端算。
        const MAP: [string, string, string[], string][] = [
          ['notion', 'Notion', cfg.notion.spaces.map((s) => s.key), 'notion'],
          ['exmail', '企业邮箱（IMAP）', ['exmail'], 'exmail'],
          ['wecom', '企业微信邮件', ['wecom'], 'mail'],
          ['figma', 'Figma', ['figma'], 'pen'],
          ['adb', '手机 (ADB)', ['adb'], 'phone'],
          ['feishu', '飞书', ['feishu'], 'feishu'],
        ];
        const items = MAP.map(([key, label, spaces, icon]) => ({
          key, label, icon,
          docs: spaces.reduce((a, s) => a + (bySpace.get(s) ?? 0), 0),
          spaces: spaces.map((s) => ({ space: s, label: labelOf.get(s) ?? s, n: bySpace.get(s) ?? 0 })),
          features: feats.filter((f) => f.source === key),
        }));
        return json({ total: st.docs, items });
      }

      // ── 工作区的「主动」那一块 ────────────────────────────
      if (p === '/api/panel') {
        // ⚠️ 每次读之前刷新一下，但用 `INSERT OR IGNORE` ⇒
        //    **已经处理过的条目不会被重置成"待处理"**（那就没人会再点它了）。
        let added = 0;
        // ⚠️ `self` 要传进去 —— 线程那边靠它判"球在谁那边"。不传的话它会自己去推，
        //    而推出来的那个地址和设置里填的不一样时，**两边会给出不同的结论**。
        const panelSelf = String(loadSettings(cfg.dataDir)?.exmail?.email ?? '');
        try { added = refreshPanel(db, { self: panelSelf }); } catch (e) { /* 拉数失败不该让面板打不开 */ }
        return json({ ...listPanel(db), added });
      }
      if (p === '/api/panel/state' && req.method === 'POST') {
        const b = (await req.json().catch(() => ({}))) as { id?: number; state?: string };
        const r = setPanelState(db, Number(b.id), String(b.state) as any);
        if (!r.ok) return json({ error: r.error }, 400);
        return json(r);
      }

      // ── 待办抽取 —— 第二个「装进来的」功能（见 src/mailtodo.ts）──
      if (p === '/api/mailtodo') {
        const items = extractTodos(db, { spaces: ['exmail', 'wecom'] });
        return json({ total: items.length, items });
      }

      // ── 线程未结提醒 —— 第三个「装进来的」功能（见 src/threads.ts）──
      //    ⚠️ 判别「有没有结论」全靠 `线索：` 那行（References）——
      //       2026-10-10 之前入库的邮件**没有**这行，它们只能退回按标题分组，
      //       于是同一条线程会被拆成好几条。这里把"退化了多少"如实报出去，
      //       不静默 —— 否则用户看到的是"线程就这么短"，而不是"该重新同步了"。
      if (p === '/api/mailthread') {
        const st = loadSettings(cfg.dataDir);
        const self = String(st?.exmail?.email ?? '');
        const min = Math.max(2, Number(url.searchParams.get('min') ?? 2) || 2);
        const items = threads(db, { spaces: ['exmail', 'wecom'], self, minMsgs: min });
        const noLink = items.filter((t) => t.via === 'subject').length;
        return json({
          total: items.length,
          remind: items.filter((t) => t.remind).length,
          byStatus: items.reduce((a, t) => ({ ...a, [t.status]: (a[t.status] ?? 0) + 1 }), {}),
          /** 中间断过、靠标题缝起来的线程有几条 */
          viaSubject: noLink,
          /** 线索链的体检：多少封压根没有 In-Reply-To（说明"短线程"可能是缝出来的） */
          links: linkStats(db, ['exmail', 'wecom']),
          self: self || '(没配，从数据里推的)',
          items,
        });
      }

      // ── 项目档案 —— 把一个项目的邮件 + 笔记 + 报价聚到一处 ──
      //    ⚠️ `threads` 先算一次传进去：档案要给"这条属于一串对话"打标，
      //       而 `threads()` 是全库扫描 —— 在每块档案里各跑一遍是白烧。
      // ⚠️ POST 必须排在 GET 前面 —— 两边的路径完全一样（`/api/projects`），
      //    只靠 method 区分。写反了的话新建项目会被 GET 那条先吃掉，
      //    表现是"点新建没反应"，**而且不报错**。
      if (p === '/api/projects' && req.method === 'POST') {
        const b = (await req.json().catch(() => ({}))) as { name?: string; keywords?: string[] | string; note?: string };
        const kws = Array.isArray(b.keywords) ? b.keywords : String(b.keywords ?? '').split(/[,，、\s]+/);
        const r = addProject(cfg.dataDir, String(b.name ?? ''), kws, String(b.note ?? ''));
        if (!r.ok) return json({ error: r.error }, 400);
        addActivity(db, { kind: 'project', icon: '📁', title: `建了项目：${r.project.name}`, detail: r.project.keywords.join(' / ') });
        return json(r);
      }
      if (p === '/api/projects') {
        const st2 = loadSettings(cfg.dataDir);
        const me = String(st2?.exmail?.email ?? '');
        const ths = threads(db, { spaces: ['exmail', 'wecom'], self: me });
        const items = discoverProjects(db, {
          dataDir: cfg.dataDir, threads: ths,
          selfDomain: me.split('@')[1] ?? '', minN: 2, limit: 8,
        });
        return json({ total: items.length, items, manual: loadProjects(cfg.dataDir).projects, self: me });
      }
      if (p.startsWith('/api/projects/') && req.method === 'DELETE') {
        const id = decodeURIComponent(p.slice('/api/projects/'.length));
        const r = removeProject(cfg.dataDir, id);
        if (!r.removed) return json({ error: '没这个自建项目（自动发现的档案删不掉，它们是从数据里算出来的）' }, 400);
        addActivity(db, { kind: 'project', icon: '🗑', title: `删了项目：${id}` });
        return json(r);
      }

      // ── 联系人 / 公司 —— 第一个「装进来的」功能 ──────────
      if (p === '/api/contacts') {
        const st = loadSettings(cfg.dataDir);
        // ⚠️ 「自己是谁」从设置里读，**不写死** —— 这软件是给任何人用的
        const items = contacts(db, { spaces: ['exmail', 'wecom'], self: String(st?.exmail?.email ?? '') });
        return json({ total: items.length, items });
      }

      // ── 每日推荐：让 LLM 看着你的语料给「延伸 / 缺口 / 重访」 ──
      if (p === '/api/recommend' && req.method === 'POST') {
        const llm = createLlm(cfg);
        if (!llm) return json({ error: '需要 LLM key' }, 400);
        // ⭐ 「换一批」：把上一批的标题带回来当排除项。
        //    ⚠️ 不这么做的后果不是"结果差一点"，而是**一模一样** ——
        //    同样的语料 + 同样的提示词，模型会稳定地给回那八条，
        //    于是「换一批」看起来像按钮坏了。（读者 2026-10-09 提的。）
        const body = (await req.json().catch(() => ({}))) as { exclude?: string[] };
        const exclude = (body?.exclude ?? []).map((x) => String(x)).filter(Boolean).slice(0, 40);
        const tax = readOut('taxonomy.json');
        const recent = db
          .query<{ space: string; date: string; text: string }, []>(
            "SELECT space, date, substr(text,1,400) t, text FROM docs WHERE date != '0000-00-00' ORDER BY date DESC LIMIT 40",
          )
          .all();
        const sample = recent.map((d) => `[${d.space} ${d.date}] ${String((d as any).text).slice(0, 260)}`).join('\n\n');
        const cats = tax ? tax.groups.map((g: any) => `${g.name}(${g.size})`).join('、') : '';
        const excludeBlock = exclude.length
          ? `\n\n⚠️ 我已经看过这一批了，**不要再给这些**（标题一模一样的算重复）：\n${exclude.map((t) => '· ' + t).join('\n')}\n换一些别的角度、别的板块、更冷门一点的。`
          : '';
        const _t = Date.now();
        const _rr = await llm.chatFull([
          {
            role: 'system',
            content:
              '你在给一个中文用户做每日知识推荐。他的笔记偏 AI/科技、前端设计、购物时尚、艺术。只输出 JSON。',
          },
          {
            role: 'user',
            content: `这是我笔记的类别分布：${cats}

这是我最近记的内容：
${sample}

请基于我的**既有兴趣**，给我 8 条推荐，分三类：
· "延伸"：我记过的东西的新进展 / 顺着往下该知道的
· "缺口"：我这类记得多，但有个明显没碰过的方向
· "重访"：我很久以前记的、现在该回看的

只输出 JSON 数组：
{"id":1,"kind":"延伸","title":"不超过22字","why":"为什么推荐给我（不超过40字）","cat":"归到哪个板块（TECH-AI/tech-learn/Shopping/Learn）","detail":"两句话展开"}${excludeBlock}`,
          },
        ]);
        const m = _rr.text.match(/\[[\s\S]*\]/);
        const items = m ? JSON.parse(m[0]) : [];
        addActivity(db, {
          kind: 'recommend', icon: '✦', title: `每日推荐 · ${items.length} 条`,
          detail: items.slice(0, 3).map((x: any) => x.title).join(' / '),
          ms: _rr.ms, tokIn: _rr.usage?.in, tokOut: _rr.usage?.out,
        });
        return json({ items, usage: _rr.usage, ms: _rr.ms });
      }

      if (p === '/api/sync' && req.method === 'POST') {
        const { only, force } = (await req.json().catch(() => ({}))) as any;
        const args = ['run', 'src/cli.ts', 'sync'];
        if (only) args.push('--only', only);
        if (force) args.push('--force');
        const child = spawn('bun', args, { cwd: process.cwd(), detached: true, stdio: 'ignore' });
        child.unref();
        addActivity(db, { kind: 'sync', icon: '⟳', title: `同步 ${only ?? '全部'}`, detail: '已在后台开始' });
        return json({ started: true, only: only ?? '全部' });
      }

      // ── 写回 Notion（借 notion-clip 的机制，dry-run 优先）──
      if (p === '/api/notion/append' && req.method === 'POST') {
        const { page, cat, text, dryRun } = (await req.json()) as any;
        // 按类别自动路由到板块（用户定的）
        const ROUTE: Record<string, string> = {
          'TECH-AI': 'TECH AI', 'TECH AI': 'TECH AI', techai: 'TECH AI',
          'tech-learn': 'tech-learn', techlearn: 'tech-learn',
          Shopping: 'Shopping', shopping: 'Shopping',
          Learn: 'Learn', learn: 'Learn',
        };
        const target = page ?? ROUTE[cat ?? ''] ?? 'Learn';
        if (!text) return json({ error: '缺 text' }, 400);
        const helper = join(process.cwd(), 'scripts', 'notion-append.py');
        if (!existsSync(helper)) return json({ error: '还没接上写回助手' }, 501);
        // ⚠️ 默认 dry-run。只有显式 dryRun:false 才真写 —— 往真笔记里写东西，
        //    默认值必须是"不写"。
        const real = dryRun === false;
        const args = [helper, '--page', target, '--text', text];
        // ⚠️ 不传 --write 就是预览（那是脚本的默认值）。
        // 上一版这里传了 `--dry-run` —— 而脚本根本没这个参数，argparse 直接报错，
        // 偏偏接口还回 ok:true，于是**预览"成功"了但什么都没发生**（假绿）。
        if (real) args.push('--write');
        const r = await new Promise<{ code: number; out: string }>((res) => {
          const c = spawn('python3', args, { cwd: process.cwd() });
          let buf = '';
          c.stdout.on('data', (d) => (buf += d));
          c.stderr.on('data', (d) => (buf += d));
          c.on('close', (code) => res({ code: code ?? -1, out: buf }));
        });
        // ⚠️ ok 必须看**退出码**。只看"拿到了输出"的话，报错输出也算成功。
        addActivity(db, {
          kind: 'notion', icon: real ? '📥' : '📋',
          title: (real ? '写回 ' : '预览 ') + target,
          detail: text.slice(0, 120), ms: 0,
        });
        return json({
          ok: r.code === 0,
          page: target,
          wrote: real,
          code: r.code,
          output: r.out.trim().slice(0, 3000),
        });
      }

      // 静态文件：/out/* 和 /ui/*（光球模块、演示页、树图 html 都从这里走）
      // ⭐ 用户自己造出来的 Pet 图。⚠️ 根是 **dataDir**（不是 cwd）——
      //    它们是**用户的数据**，不是程序的一部分；装在包里的话，升级一次就全没了。
      if (p.startsWith('/pets/')) {
        const id = p.slice('/pets/'.length).replace(/[^a-zA-Z0-9._-]/g, '');
        const f = join(expandHome(cfg.dataDir), 'pets', id);
        if (existsSync(f) && f.startsWith(join(expandHome(cfg.dataDir), 'pets'))) return new Response(Bun.file(f));
        return json({ error: '没有这张' }, 404);
      }
      if (p.startsWith('/ui/') || p.startsWith('/out/')) {
        const rel = p.startsWith('/ui/') ? join('src', p.slice(1)) : p.slice(1);
        const f = join(process.cwd(), rel);
        if (existsSync(f) && f.startsWith(process.cwd())) return new Response(Bun.file(f));
      }

      // 界面已经拆成 src/ui/ 下的文件（原来是塞在这个文件里的一个大字符串 —— 没法维护）
      if (p === '/' || p === '/index.html') {
        return new Response(Bun.file(join(process.cwd(), 'src/ui/app.html')), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
  },
});

function summarize(h: any) {
  return { space: h.space, date: h.date, text: String(h.text).replace(/\s+/g, ' ').slice(0, 220), sim: h.sim };
}

// ─────────────────────────────────────────────────────────────
// ⚠️⚠️ **这段是死代码 —— 改它不会生效。**
//     `const UI` 在整个仓库里**只出现这一处**（`grep -n "\bUI\b" src/server.ts`
//     只剩这一行），没有任何地方引用它；真正被服务出去的是
//     `p === '/'` 那条 → `src/ui/app.html`（+ app.css / app.js）。
//
//     2026-10-10 我就是照着**这里**改了「每日推荐 · 写回之后清勾」，
//     跑验证 5/11 全红 —— 因为浏览器跑的是 app.js 那一份。
//     界面一旦拆成 src/ui/ 就别再在这个大字符串里留第二份：
//     **两份实现里改动只落在没跑的那一份上**，症状是"改了没反应"。
//     ⇒ 要动界面，一律去 src/ui/。留在这里只为对照历史版式。
const UI = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>C4emem</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#0e1014;--panel:#151922;--line:#242a36;--fg:#e8eaf0;--dim:#8b93a7;--acc:#4f7cff;--ok:#22b07d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.65 -apple-system,"PingFang SC",sans-serif;display:flex;height:100vh}
nav{width:172px;flex:none;background:var(--panel);border-right:1px solid var(--line);padding:14px 10px;overflow:auto}
nav h1{font-size:15px;margin:4px 6px 14px;font-weight:600;letter-spacing:.3px}
nav button{display:block;width:100%;text-align:left;background:none;border:0;color:var(--fg);
  padding:9px 11px;border-radius:8px;cursor:pointer;font-size:13.5px;margin-bottom:2px}
nav button:hover{background:#1e2533}
nav button.on{background:var(--acc);color:#fff;font-weight:600}
nav .sep{margin:12px 10px 6px;color:var(--dim);font-size:11px;letter-spacing:.5px}
main{flex:1;overflow:auto;padding:22px 26px}
h2{margin:0 0 4px;font-size:18px}
.sub{color:var(--dim);font-size:12.5px;margin-bottom:16px}
input,button.go,textarea{font:inherit}
input[type=text],textarea{width:100%;background:#0b0e13;border:1px solid var(--line);color:var(--fg);
  border-radius:9px;padding:11px 13px;outline:none}
input[type=text]:focus,textarea:focus{border-color:var(--acc)}
button.go{background:var(--acc);color:#fff;border:0;border-radius:9px;padding:10px 18px;cursor:pointer;font-weight:600}
button.go:disabled{opacity:.5;cursor:default}
.row{display:flex;gap:9px;margin-bottom:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:13px 15px;margin-bottom:10px}
.card .m{color:var(--dim);font-size:11.5px;margin-bottom:5px}
.hit{font-size:13px;color:#cfd4e0}
.badge{display:inline-block;background:#222a38;color:#9fb2d8;border-radius:5px;padding:1px 7px;font-size:11px;margin-right:6px}
.bar{height:9px;background:var(--acc);border-radius:3px;display:inline-block;vertical-align:middle}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--dim);font-weight:500;font-size:12px}
.k{color:var(--dim);font-size:12px}
.pill{background:#1c2432;border:1px solid var(--line);border-radius:20px;padding:4px 11px;font-size:12px;cursor:pointer;display:inline-block;margin:0 6px 6px 0}
.pill:hover{border-color:var(--acc)}
#spin{color:var(--dim);font-size:12.5px;margin-left:10px}
.ans{white-space:pre-wrap;font-size:14.5px;line-height:1.75}
.kind{font-size:11px;padding:1px 7px;border-radius:5px;margin-right:6px}
.k-延伸{background:#1c3a2c;color:#5fd39b}
.k-缺口{background:#3a2a1c;color:#e0a93b}
.k-重访{background:#2a2140;color:#b48cf5}
</style></head><body>
<nav>
  <h1>C4emem</h1>
  <button data-v="ask" class="on">💬 问它</button>
  <button data-v="search">🔍 搜索</button>
  <button data-v="rec">✨ 每日推荐</button>
  <div class="sep">我的知识库</div>
  <button data-v="tax">📊 主题分布</button>
  <button data-v="vocab">🔤 词条</button>
  <button data-v="links">🔗 链接库</button>
  <div class="sep">维护</div>
  <button data-v="sync">🔄 同步 Notion</button>
</nav>
<main id="main"></main>
<script type="module">
const $=s=>document.querySelector(s), main=$('#main');
let view='ask';
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('nav button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); view=b.dataset.v; render();
});
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const busy=(on,txt)=>{$('#spin')&&($('#spin').textContent=on?txt||'处理中…':'');};
function bar(n,max){const w=Math.max(3,Math.round(n/max*120));return '<span class="bar" style="width:'+w+'px"></span>';}

async function render(){
  if(view==='ask'){
    main.innerHTML='<h2>💬 问它</h2><div class="sub">只用你自己笔记里的内容回答，并标出处</div>'+
      '<div class="row"><input id="q" type="text" placeholder="例如：Crapette 是什么？/ 我记过哪些前端灵感？"><button class="go" id="go">提问</button><span id="spin"></span></div><div id="out"></div>';
    const ask=async()=>{const q=$('#q').value.trim(); if(!q)return; busy(1,'思考中…');
      $('#out').innerHTML=''; const r=await (await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q})})).json();
      busy(0);
      $('#out').innerHTML='<div class="card"><div class="ans">'+esc(r.answer)+'</div></div>'+
        '<div class="k" style="margin:14px 0 6px">依据</div>'+
        (r.sources||[]).map(s=>'<div class="card"><div class="m"><span class="badge">'+s.space+'</span>'+s.date+(s.sim?' · 余弦 '+s.sim.toFixed(3):'')+'</div><div class="hit">'+esc(s.text)+'</div></div>').join('');};
    $('#go').onclick=ask; $('#q').onkeydown=e=>{if(e.key==='Enter')ask();};
  }

  if(view==='search'){
    main.innerHTML='<h2>🔍 搜索</h2><div class="sub">只检索，不生成 —— 看原文和相似度</div>'+
      '<div class="row"><input id="q" type="text" placeholder="关键词或一句话"><button class="go" id="go">搜索</button><span id="spin"></span></div><div id="out"></div>';
    const go=async()=>{const q=$('#q').value.trim(); if(!q)return; busy(1);
      const r=await (await fetch('/api/search?q='+encodeURIComponent(q))).json(); busy(0);
      $('#out').innerHTML=(r.hits||[]).map(h=>'<div class="card"><div class="m"><span class="badge">'+h.space+'</span>'+h.date+' · '+
        (h.via==='both'?'向量+关键词':h.via==='vector'?'向量':'关键词')+(h.sim?' · 余弦 '+h.sim.toFixed(3):'')+'</div><div class="hit">'+esc(h.text)+'</div></div>').join('')||'<div class="k">没有命中</div>';};
    $('#go').onclick=go; $('#q').onkeydown=e=>{if(e.key==='Enter')go();};
  }

  if(view==='rec'){
    main.innerHTML='<h2>✨ 每日推荐</h2><div class="sub">勾选你要的再写回 —— <b>没勾的一律不写</b>。写进对应板块「今天」那个 @Today 折叠块。</div>'+
      '<div class="row"><button class="go" id="gen">生成今天的推荐</button>'+
      '<button class="go" id="prev" disabled>① 预览选中的</button>'+
      '<button class="go" id="push" disabled>② 确认写回</button><span id="spin"></span></div>'+
      '<div id="out"></div><div id="out2" style="margin-top:16px"></div>';
    const upd=()=>{const n=document.querySelectorAll('#out input[type=checkbox]:checked').length;
      const a=$('#prev'),b=$('#push');
      if(a){a.disabled=!n;a.textContent='① 预览选中的'+(n?' ('+n+')':'');}
      if(b){b.disabled=!n;b.textContent='② 确认写回'+(n?' ('+n+')':'');}};
    const checked=()=>Array.from(document.querySelectorAll('#out input[type=checkbox]:checked')).map(c=>window.__rec[Number(c.dataset.i)]);
    const send=async(dry)=>{
      // ⚠️ 走过的坑：写完之后**勾还留着** ⇒ ②还是亮的 ⇒ 再点一次就把同一批又写一遍。
      //    读者那边真实的后果是：一天里同一篇内容在 Notion 里出现了**四遍**
      //    （2026-10-09 TECH AI 那个块，实测 3×3+1 个段落）。
      //    ⇒ 写完必须**把确实写进去的那些勾掉**，并且卡片上标「已写入」。
      //    ⚠️ 只勾掉成功的：失败的那条留着，好让他改完重试。
      const sel=Array.from(document.querySelectorAll('#out input[type=checkbox]:checked'));
      const items=sel.map(c=>window.__rec[Number(c.dataset.i)]); if(!items.length)return;
      busy(1, dry?'预览中…':'写入中…'); const out=[];
      for(let k=0;k<items.length;k++){
        const it=items[k];
        const r=await (await fetch('/api/notion/append',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({cat:it.cat,text:mkText(it),dryRun:dry})})).json();
        const good=r.wrote&&r.ok;
        if(good){ sel[k].checked=false; sel[k].disabled=true;
          const c=sel[k].closest('.card'); if(c) c.style.opacity='.62'; }
        out.push('<div class="card"><div class="m">'+(good?'✅ 已写入':dry?'📋 预览':'⚠️ 没写成功')+' · '+esc(r.page||it.cat)+' · '+esc(it.title)+'</div>'+
          '<pre style="white-space:pre-wrap;font-size:12.5px;color:#c8cee0;margin:0">'+esc(r.error||r.output||'')+'</pre></div>');
      }
      busy(0); $('#out2').innerHTML=out.join('');
      upd();
      const left=document.querySelectorAll('#out input[type=checkbox]:checked').length;
      if(!dry&&!left) $('#push').textContent='② 全部写完了';};
    $('#gen').onclick=async()=>{busy(1,'看着你的笔记想…'); $('#out').innerHTML=''; $('#out2').innerHTML='';
      const r=await (await fetch('/api/recommend',{method:'POST'})).json(); busy(0);
      if(r.error){$('#out').innerHTML='<div class="card">'+esc(r.error)+'</div>';return;}
      window.__rec=r.items||[];
      $('#out').innerHTML=window.__rec.map((it,i)=>'<div class="card"><div class="m">'+
        '<input type="checkbox" data-i="'+i+'" style="margin-right:9px;transform:scale(1.3);vertical-align:middle">'+
        '<span class="kind k-'+esc(it.kind)+'">'+esc(it.kind)+'</span><span class="badge">'+esc(it.cat)+'</span></div>'+
        '<div style="font-weight:600;margin:3px 0">'+esc(it.title)+'</div><div class="k">'+esc(it.why)+'</div>'+
        '<div class="hit" style="margin-top:6px">'+esc(it.detail)+'</div></div>').join('');
      upd();};
    $('#out').onchange=upd;
    $('#prev').onclick=()=>send(true);
    $('#push').onclick=()=>send(false);
  }

  if(view==='tax'){
    const t=await (await fetch('/api/taxonomy')).json();
    if(!t){main.innerHTML='<h2>📊 主题分布</h2><div class="sub">还没生成。跑 scripts/taxonomy.ts</div>';return;}
    const mx=Math.max(...t.groups.map(g=>g.size));
    main.innerHTML='<h2>📊 主题分布</h2><div class="sub">共 '+t.totalDocs+' 段 · '+t.groups.length+' 大类</div>'+
      '<div class="card"><table><tr><th>大类</th><th>段数</th><th>占比</th><th></th></tr>'+
      t.groups.map(g=>'<tr><td><b>'+esc(g.name)+'</b></td><td>'+g.size+'</td><td>'+(g.size/t.totalDocs*100).toFixed(1)+'%</td><td>'+bar(g.size,mx)+'</td></tr>').join('')+
      '</table></div><div class="sub">完整树图：<a style="color:var(--acc)" href="/taxonomy.html" target="_blank">打开 taxonomy.html</a></div>'+
      t.groups.map(g=>'<div class="card"><div style="font-weight:600;margin-bottom:6px">'+esc(g.name)+' <span class="k">'+g.size+'</span></div>'+
        g.clusters.map(c=>'<div style="padding:3px 0"><span class="badge">'+c.size+'</span>'+esc(c.name)+' <span class="k">'+(c.keywords||[]).join(' · ')+'</span></div>').join('')+'</div>').join('');
  }

  if(view==='vocab'){
    main.innerHTML='<h2>🔤 词条</h2><div class="sub">从笔记里按结构提炼的中英对照</div>'+
      '<div class="row"><input id="q" type="text" placeholder="查词条（中英文都行）"><span id="spin"></span></div><div id="out"></div>';
    const load=async()=>{const q=$('#q').value.trim(); const r=await (await fetch('/api/vocab?q='+encodeURIComponent(q))).json();
      $('#out').innerHTML='<div class="k" style="margin:8px 0">共 '+r.total+' 条，显示 '+r.entries.length+'</div><div class="card"><table><tr><th>英文</th><th>中文</th><th>出处</th></tr>'+
        r.entries.map(e=>'<tr><td>'+esc(e.en)+'</td><td>'+esc(e.zh)+'</td><td class="k">'+esc(e.space)+' '+esc(e.date)+'</td></tr>').join('')+'</table></div>';};
    let t; $('#q').oninput=()=>{clearTimeout(t);t=setTimeout(load,250);}; load();
  }

  if(view==='links'){
    const d=await (await fetch('/api/link-taxonomy')).json();
    if(!d){main.innerHTML='<h2>🔗 链接库</h2><div class="sub">还没生成。跑 scripts/classify-links.ts</div>';return;}
    const mx=Math.max(...d.categories.map(c=>c.urlCount));
    main.innerHTML='<h2>🔗 链接库</h2><div class="sub">按域名归类，' + d.categories.reduce((a,c)=>a+c.domainCount,0) + ' 个域名</div>'+
      d.categories.map(c=>'<div class="card"><div class="m">'+esc(c.cat)+' · '+c.urlCount+' 条 / '+c.domainCount+' 域名</div>'+bar(c.urlCount,mx)+
        '<div style="margin-top:8px">'+c.items.slice(0,25).map(it=>'<div style="padding:2px 0;font-size:13px"><span class="badge">'+it.n+'×</span>'+esc(it.domain)+' <span class="k">'+esc(it.what)+'</span></div>').join('')+'</div></div>').join('');
  }

  if(view==='sync'){
    const s=await (await fetch('/api/stats')).json();
    main.innerHTML='<h2>🔄 同步 Notion</h2><div class="sub">把四个板块的最新内容拉进本地库</div>'+
      '<div class="card"><table><tr><th>板块</th><th>段数</th></tr>'+
      s.spaces.map(x=>'<tr><td>'+esc(x.label)+'</td><td>'+x.n+'</td></tr>').join('')+
      '<tr><td><b>合计</b></td><td><b>'+s.docs+'</b></td></tr></table>'+
      '<div class="k" style="margin-top:8px">切块 '+s.chunks+' · 向量 '+s.vecs+' · LLM '+(s.hasLlm?esc(s.llm||'已配'):'未配')+'</div></div>'+
      '<div class="row">'+cfgSpaces.map(x=>'<button class="pill" onclick="syn(\\''+x.key+'\\')">同步 '+esc(x.label)+'</button>').join('')+
      '<button class="pill" onclick="syn()">全部</button></div><div id="out"></div>';
  }
}
const cfgSpaces = await (await fetch('/api/stats')).json().then(s=>s.spaces);
async function syn(only){
  const r=await (await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({only})})).json();
  $('#out').innerHTML='<div class="card">已开始同步：'+esc(r.only||'全部')+'。⚠️ 全量要 10 分钟以上，跑完刷新这页看数字。</div>';
}
function mkText(it){return '【C4emem 推荐 · '+it.kind+'】'+it.title+'\\n'+it.detail;}
render();
</script></body></html>`;

console.log(`C4emem 界面 → http://127.0.0.1:${PORT}`);
console.log(`库：${cfg.dataDir} · 文档 ${stats(db).docs} 段`);
