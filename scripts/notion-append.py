#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
写回 Notion —— **复用**你 `~/Library/Scripts/notion-clip.py` 里已经写好、
已经在用的那套逻辑，不重写。

为什么不干脆命令行调 notion-clip.py：
⚠️ 它的内容取自**剪贴板**。命令行调它 = 把你正在复制的东西冲掉。
   所以我们改成 **import 它的函数**（找页面 / 找 @Today 折叠块 / 追加子块），
   只把「内容从哪来」换掉，其余一行不改。

用法
  python3 scripts/notion-append.py --pages
  python3 scripts/notion-append.py --page "TECH AI" --text "内容" --dry-run
  python3 scripts/notion-append.py --page "TECH AI" --text "内容"

⚠️ 默认就是 dry-run。要真写必须显式加 --write。
   （往真实笔记里写东西，默认值应该是"不写"。）


═══ 2026-10-10：同一天只留一个 @Today 块 ═════════════════════════════
读者原话：「写回 notion 时候如果是这样的**同一天或者已经有这一天，就不要另外起一个日期**」。

实测到的现状（在读者真的笔记上量的，不是猜的）：
    TECH AI   顶层 22 块 / 带日期的 toggle 16 个 / **重复的日期 3 个**
               （2026-09-08、2026-09-20、2026-10-09 各有两个）
    Learn     顶层 18 块 / 带日期的 toggle 17 个 / 重复的日期 1 个（2026-09-20）
    Shopping  无重复
    tech-learn 无重复
    ⇒ 「TECH AI · 2026-10-09」那两个块的 `created_time` **是同一秒 06:18:00**，
      而其中一块里塞着 **同一篇内容重复四遍**（3×3+1 个段落，四组标记）。

两条各自独立的病根，都要治：

  (1) ⚠️⚠️ **find → create 之间没有护栏，也没有锁。**
      本脚本每条内容都**起一个新进程**（`/api/notion/append` 是一次 spawn），
      所以"上一条刚建好的块"在进程之间没有任何记忆。
      而 notion-clip 自己那条路是**有**护栏的（`_today_cache_get/_put` 缓存 +
      命中就用缓存直接追加）——**我们这条路把它整个绕过去了**，只调了
      `find_today_toggle`（每次全页扫描）。
      同一秒里建出两个块，说明第 2 次扫描**没有看见**第 1 次刚建的块
      （写入后立刻读，Notion 那边不一定马上可见），于是又建了一个。

      治：① **文件锁**，两次调用不可能同时停在 find-or-create 里；
          ② **复用 notion-clip 的持久缓存**（`state.json` 的 `today_toggle`），
             刚建好的块 id 记在盘上，跨进程有效；用之前 `GET /blocks/<id>` 验活；
          ③ 缓存和扫描都落空时，**建之前再确认一次**。

  (2) ⚠️⚠️ **写完之后勾还在。**（`src/server.ts` 的「每日推荐」②那段）
      点一次②写一 遍、再点一次又写一遍同一批 —— 这就是"同一篇重复四遍"的来源。
      ⇒ 写完把勾清掉并在卡片上标「已写入」。

⚠️ 发现同一天已经有多个块时**不自动删**。那是读者的笔记，删是要他点头的事。
   本脚本只做两件：**追加到最后一个**、并且**把"发现了几个重复"明说出来**。


═══ 版式：每个条目自己包一层 toggle ═════════════════════════════════
读者这次的截图里要的那种版式，就是**他自己笔记本里到处都是的那种**：
    @Today 折叠块
      └─ 折叠块「正文前 10 个字」
           正文…
而这正是 notion-clip 的 `write_to_page(collapse=True)` 产出的形状
（`make_toggle_title` 取正文前 `title_chars`=10 字）。
⚠️ 我们原来往 @Today 里**平铺段落** —— 一天写了四条就是十二段并排，
和笔记本里其余部分不一致，也正是"看起来很乱"的原因。
⇒ 这里改成和 notion-clip **同一个形状**（真的调用它的 `make_toggle_title`，
  不另写一份标题算法）。
"""
import argparse
import contextlib
import importlib.util
import os
import sys

CLIP = os.path.expanduser("~/Library/Scripts/notion-clip.py")

# 写进去的每一段前面都要带这个标记 —— 用户要求，**带括号**。
MARKER = "（by cevtuo c4emem AI）"


def load_notion_clip():
    if not os.path.exists(CLIP):
        sys.exit("找不到 %s" % CLIP)
    spec = importlib.util.spec_from_file_location("notion_clip", CLIP)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # 模块级只有 os.environ.setdefault，import 是安全的
    return mod


def resolve_page(nc, token, want):
    """按标题找页面，返回 **(page_id, 标题)**。

    ⚠️ 必须返回 id 而不是那个 page 对象。
    `nc.search_pages()` 给的是富对象；下面 find_today_toggle / api() 要的是 id 字符串。
    我第一版把整个对象传了进去，报错是
    `URL can't contain control characters` —— 因为那一坨 JSON 被拼进了 URL 路径。
    """
    pages = nc.search_pages(token)
    titled = [(p, nc.page_title(p)) for p in pages]
    for p, t in titled:
        if t.strip().lower() == want.strip().lower():
            return p["id"], t
    for p, t in titled:
        if want.strip().lower() in t.strip().lower():
            return p["id"], t
    avail = "、".join(t for _, t in titled if t)
    sys.exit("找不到页面 %r。集成能访问的有：%s" % (want, avail))


# ── 锁 ────────────────────────────────────────────────────────────
# ⚠️ 为什么需要它：`/api/notion/append` 每条内容 spawn 一个新进程。
#   「先查再建」中间只要插进另一个进程，两边的查询就会**同时**答"没有"，
#   于是各建一个 —— 这正是那两个 created_time 相同的块。
#   锁的作用范围就是这一整段（查 → 建 → 记缓存），不让第二个人挤进来。
@contextlib.contextmanager
def locked(nc):
    import fcntl
    nc.ensure_dirs()
    path = os.path.join(nc.DATA_DIR, "c4emem-append.lock")
    fh = open(path, "a+")
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        finally:
            fh.close()


# ── 找"今天那个块"：缓存优先，扫描兜底 ────────────────────────────
def find_today(nc, token, page_id, today, state):
    """返回 (块 id 或 None, 说明, 今天一共有几个)。

    ⚠️ **先扫描，不是先查缓存** —— 看起来反了，但这是故意的：
       「今天到底有几个」只有扫描能回答，而"有几个"是要告诉读者的东西。
       缓存在这里的价值**不是省掉扫描**（顶层就十几块，一次 GET 的事），
       而是**扫描暂时看不见的时候兜住**——见下。

    ① 全页扫描：拿到今天所有的块。
       发现 >1 个 ⇒ 追加到最后一个，并且**把数量带出去**（重复是这个功能的老毛病，
       "只找到一个"和"其实有三个、我挑了最后一个"在输出里必须长得不一样）。
    ② 扫描一个都没看见时，看盘上的缓存：上一次（很可能是**一秒前**）
       刚建的那个 id。用之前 `GET /blocks/<id>` 验活，被删了 / 改过日期就不要。

    ⭐ ②这一条治的正是读者那边量到的病：**写完立刻读，Notion 不一定马上看得见**
       ⇒ 扫描答"没有" ⇒ 于是又建一个 ⇒ 同一天出现两个 @Today。
       缓存是上一个进程亲手记下的，不依赖"刚写的能不能读到"。
    """
    matches = [b["id"] for b in nc.list_children(token, page_id)
               if nc._toggle_matches_today(b, today)]

    if matches:
        note = "扫描找到"
        if len(matches) > 1:
            note = "⚠️ 扫描发现今天有 %d 个块（历史遗留），追加到最后一个" % len(matches)
        return matches[-1], note, len(matches)

    cached = nc._today_cache_get(state, page_id, today)
    if cached:
        try:
            blk = nc.api(token, "GET", "/blocks/%s" % cached)
            if nc._toggle_matches_today(blk, today):
                # ⚠️ 说明必须如实说是"扫描没看见、缓存兜住" ——
                #    写成"缓存命中"会让人以为扫描真的看过一遍。
                return cached, "扫描没看见、但缓存里那个还活着（写入后立刻读的滞后）⇒ 用它", 1
        except nc.NotionError:
            pass  # 缓存里的块没了 —— 正常回落，不是错误

    return None, "没有 → 会新建一个", 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--page")
    ap.add_argument("--text")
    ap.add_argument("--pages", action="store_true", help="列出集成能访问的页面")
    ap.add_argument("--write", action="store_true", help="真的写（不加则只预览）")
    ap.add_argument("--no-marker", action="store_true", help="不加 C4emem 标记")
    ap.add_argument("--flat", action="store_true",
                    help="不包 toggle，平铺写进 @Today（旧版的样子）")
    a = ap.parse_args()

    nc = load_notion_clip()
    cfg = nc.load_config()
    token = cfg.get("notion_token")
    if not token:
        sys.exit("notion-clip 没配 token。先跑：./notion-clip.py --set-token <token>")

    if a.pages:
        for p in nc.search_pages(token):
            print("%-40s %s" % (nc.page_title(p), p.get("id")))
        return 0

    if not a.page or not a.text:
        sys.exit("需要 --page 和 --text（或用 --pages 列页面）")

    marker_on = not a.no_marker

    with locked(nc):
        page, title = resolve_page(nc, token, a.page)
        today = nc.today_str()
        state = nc.load_state()

        exist, how, n_today = find_today(nc, token, page, today, state)

        # ── 要写进去的块 ──
        body_blocks = nc.text_to_blocks(a.text)
        if not body_blocks:
            sys.exit("内容为空")
        write_blocks = ([{"type": "paragraph", "runs": [nc._new_run(MARKER, {})]}] if marker_on else []) \
            + body_blocks

        # ── 版式：包一层 toggle（和 notion-clip 一致），除非 --flat ──
        item_title = nc.make_toggle_title(body_blocks, cfg.get("title_chars", 10))
        nest = (not a.flat) and len(write_blocks) < nc.MAX_CHILDREN
        if not nest:
            item_title = None

        print("目标页面 : %s" % title)
        print("日期块   : @Today → %s" % today)
        print("标记     : %s" % (MARKER if marker_on else "无"))
        print("版式     : %s" % (('@Today → toggle「%s」→ 正文' % item_title) if nest else "@Today → 正文（平铺）"))
        print("将写入的块：")
        for b in write_blocks:
            print("  [%s] %s" % (b["type"], nc.blocks_plain_text([b])[:100]))
        print("今天的 @Today 折叠块：%s" % how)
        if n_today > 1:
            print("⚠️ 今天有 %d 个日期块 —— 这是历史遗留，本次**只追加到最后一个**，"
                  "不会自动删（要删得你自己在 Notion 里点）" % n_today)

        if not a.write:
            print("\n（这是预览。要真写，加 --write）")
            return 0

        payload_children = nc.build_child_blocks(write_blocks, token)
        if not payload_children:
            sys.exit("内容为空，没东西可写")
        if nest:
            payload_children = [{
                "object": "block", "type": "toggle",
                "toggle": {"rich_text": nc.runs_to_rich_text([nc._new_run(item_title, {})]),
                           "children": payload_children[:nc.MAX_CHILDREN]}}]

        if exist:
            nc.append_children(token, exist, payload_children)
            where = "追加到已存在的 @Today"
            parent = exist
        else:
            # 创建前**再确认一次**：缓存和上一次扫描之间可能插进来一个新块
            # （锁挡住了我们自己人，但挡不住 notion-clip 自己或你手动建的）
            again = [b["id"] for b in nc.list_children(token, page)
                     if nc._toggle_matches_today(b, today)]
            if again:
                nc.append_children(token, again[-1], payload_children)
                where = "⚠️ 建之前又扫到今天的块，改用追加（避免又起一个日期）"
                parent = again[-1]
            else:
                # 与 notion-clip 完全一致的建法：一次请求把 toggle 和内容一起建出来
                payload = {"children": [{
                    "object": "block", "type": "toggle",
                    "toggle": {"rich_text": [nc.date_mention_block(today)],
                               "children": payload_children}}]}
                r = nc.api(token, "PATCH", "/blocks/%s/children" % page, payload)
                res = r.get("results") or []
                if not res:
                    sys.exit("新建 @Today 失败：%s" % r)
                parent = res[0]["id"]
                where = "新建了 @Today 并写入"

        # ⚠️ 把刚用到的块 id 记到盘上 —— 下一秒的另一个进程靠它，
        #    就不必"写完立刻读"（那一下 Notion 未必看得见，正是重复的来源）。
        nc._today_cache_put(state, page, today, parent)

    print("\n✅ 已写入「%s」的 %s（%s）" % (title, today, where))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:
        sys.exit("出错：%s: %s" % (type(e).__name__, e))
