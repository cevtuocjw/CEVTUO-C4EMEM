/**
 * Notion 客户端 —— 带节流和 Retry-After 处理。
 *
 * ⚠️ 这里是整个 sync 唯一会碰网络的地方，所以「礼貌」只在这一处实现：
 *   · 所有请求串成一条链，最小间隔 minGapMs（默认 350ms ≈ 3 req/s）
 *   · 429 / 529 读 Retry-After，指数退避重试
 *   · 5xx 也重试
 *
 * 这套逻辑是从 CEVTUO-Z 的 cnsr-extract.mjs 拿过来的 —— 那边已经线上跑过，
 * 别在这里重新发明一遍。
 */

export interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  [k: string]: any;
}

export class NotionError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'NotionError';
  }
}

export class NotionClient {
  private tail: Promise<unknown> = Promise.resolve();
  private lastAt = 0;
  /** 统计用：这一轮一共打了多少次 Notion。 */
  public calls = 0;

  constructor(
    private readonly token: string,
    private readonly version: string,
    private readonly minGapMs = 350,
    private readonly log: (msg: string) => void = () => {},
    /**
     * ⚠️ 每个请求的硬超时。
     *
     * 这条是踩出来的：Bun 的 `fetch` **默认没有超时**，一个卡住的连接会
     * 永远挂着 —— 实测进程跑了 46 分钟、只用了 1.23 秒 CPU、卡在一条
     * ESTABLISHED 上，而日志因为缓冲什么都看不出来，看起来像"同步很慢"。
     * 没有超时，「网络抖一下」就等于「任务永久静默失联」。
     */
    private readonly timeoutMs = 30_000,
  ) {}

  private paced<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const wait = this.minGapMs - (Date.now() - this.lastAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastAt = Date.now();
      return fn();
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async request<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      this.calls += 1;

      // ⚠️⚠️ 超时必须罩住**整个请求**，不只是 fetch()。
      //
      // 第一版只把 `fetch()` 包进 AbortController，并在 `finally` 里立刻
      // clearTimeout —— 于是 `await res.json()`（读响应体）落在保护之外。
      // 实测：Notion 给完响应头之后 **body 流卡住**，进程 6 分钟只用了 1.04 秒
      // CPU、卡在一条 ESTABLISHED 上，而"超时"永远不触发。
      // ⇒ 一次断流 = 整个任务永久静默失联，而且日志因为缓冲什么都看不出来。
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);

      try {
        const res = await this.paced(() =>
          fetch(`https://api.notion.com/v1${path}`, {
            ...init,
            signal: ac.signal,
            headers: {
              Authorization: `Bearer ${this.token}`,
              'Notion-Version': this.version,
              'Content-Type': 'application/json',
              ...(init.headers ?? {}),
            },
          }),
        );

        if (res.status === 429 || res.status === 529) {
          clearTimeout(timer);
          const ra = Number(res.headers.get('retry-after'));
          const waitMs = (Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt) + 500;
          this.log(`  · ${res.status} 被限速，等 ${(waitMs / 1000).toFixed(1)}s（第 ${attempt}/5 次）`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }

        if (res.status >= 500 && attempt < 5) {
          clearTimeout(timer);
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          continue;
        }

        // 读 body —— 这一句也在超时保护之内（就是它卡住的）
        const body = (await res.json().catch(() => ({}))) as any;

        if (!res.ok) {
          throw new NotionError(
            `Notion ${res.status} ${body?.code ?? ''}：${String(body?.message ?? '').slice(0, 200)}`,
            res.status,
            body?.code,
          );
        }
        return body as T;
      } catch (e) {
        // 4xx 这类**真错误**不该重试 —— 重试只会把同一个错误重复五遍
        if (e instanceof NotionError) throw e;

        // 超时 / 连接被掐 → 当成一次可重试的失败
        const msg =
          (e as Error).name === 'AbortError' ? `超时 ${this.timeoutMs}ms` : (e as Error).message;
        if (attempt === 5) {
          throw new NotionError(`连续 5 次请求失败（最后一次：${msg}）`, 0, 'fetch_failed');
        }
        this.log(`  · 请求失败（${msg}），第 ${attempt}/5 次，重试…`);
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new NotionError('Notion 连续 5 次被限速，放弃', 429, 'rate_limited');
  }

  /** 取一个 block 的全部直接子块（自动翻页）。 */
  async children(blockId: string): Promise<NotionBlock[]> {
    const out: NotionBlock[] = [];
    let cursor: string | null = null;
    do {
      const body = await this.request<any>(
        `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`,
      );
      out.push(...(body.results ?? []));
      cursor = body.has_more ? body.next_cursor : null;
    } while (cursor);
    return out;
  }

  /** 取页面标题 —— 用来在报告里显示「这个知识源叫什么」。 */
  async pageTitle(pageId: string): Promise<string> {
    try {
      const page = await this.request<any>(`/pages/${pageId}`);
      const props = page.properties ?? {};
      for (const v of Object.values<any>(props)) {
        if (v?.type === 'title') return (v.title ?? []).map((r: any) => r.plain_text).join('').trim();
      }
      return '';
    } catch {
      return '';
    }
  }
}
