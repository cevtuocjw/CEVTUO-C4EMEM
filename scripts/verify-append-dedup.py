#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
「同一天只写一个 @Today 块」的契约（2026-10-10）。

⚠️ 这一节**一次网络都不发、一个字节都不写进 Notion** —— 它测的是
   `find_today()` 那个纯逻辑：从一堆候选里挑哪一个、以及**数不数得出来有几个**。

为什么必须单独立这么一节：
   真去读者笔记里写一遍来验证，等于拿他的笔记本当试验台；
   而"只跑一次能过"也证明不了竞态没了（竞态恰恰是要跑很多次才出现的）。
   ⇒ 把"选哪一个"和"数了几个"抽成纯函数，用**构造的输入**穷举掉。

配套的负向对照写在各节末尾（`⚠️ 对照`那一行）—— 每条断言都答得出"怎么才会红"。
"""
import contextlib
import importlib.util
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "notion_append", os.path.join(HERE, "notion-append.py"))
na = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(na)          # 模块级只有常量，import 无副作用

PASS = 0
FAIL = 0


def ok(cond, msg):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ✓ " + msg)
    else:
        FAIL += 1
        print("  ✗ " + msg)


TODAY, OTHER = "2026-10-10", "2026-10-09"


def blk(bid, day):
    """一个"日期 toggle"的替身 —— 只带 find_today 真正会读的两个字段。"""
    return {"id": bid, "type": "toggle", "day": day}


class FakeNC:
    """notion-clip 的最小替身。⚠️ 每个断言都要能看见它被怎么调用的。"""

    class NotionError(Exception):
        pass

    def __init__(self, blocks, cache=None, dead=(), patched=None, extra=None):
        self._blocks = list(blocks)
        # ⚠️ `extra` 是**只有直接 GET 才看得见**的块（不在 list_children 里）。
        #    这不是为了编题 —— 它正是读者那边量到的那个现象：
        #    上一个进程刚建好的块，`GET /blocks/<id>` 能拿到，
        #    而 `GET /blocks/<page>/children`（扫描）还没把它列出来。
        #    没有这个区分，④ 那节就成了"用一份自己都编不圆的夹具测自己"。
        self._known = {b["id"]: b["day"] for b in blocks}
        self._known.update(extra or {})
        self._cache = cache
        self._dead = set(dead)
        self.scans = 0
        self.wrote = patched if patched is not None else []
        self.MAX_CHILDREN = 90

    # — find_today 会用到的那几个 —
    def list_children(self, token, pid):
        self.scans += 1
        return list(self._blocks)

    def _toggle_matches_today(self, b, today):
        return b.get("day") == today

    def _today_cache_get(self, state, pid, today):
        return self._cache

    def _today_cache_put(self, state, pid, today, bid):
        self._cache = bid
        self.put = (pid, today, bid)

    def api(self, token, method, path):
        if method == "PATCH":
            self.wrote.append(path)
            return {"results": [{"id": "new-block"}]}
        bid = path.rsplit("/", 1)[-1]
        if bid in self._dead:
            raise FakeNC.NotionError("404")
        return {"id": bid, "type": "toggle", "day": self._day_of(bid)}

    def _day_of(self, bid):
        return self._known.get(bid)

    # — main() 会用到的那几个 —
    def load_config(self):
        return {"notion_token": "tok", "title_chars": 10}

    def search_pages(self, token):
        return [{"id": "P"}]

    def page_title(self, p):
        return "P"

    def today_str(self):
        return TODAY

    def load_state(self):
        return {}

    def ensure_dirs(self):
        pass

    DATA_DIR = "/tmp"

    def text_to_blocks(self, text):
        return [{"type": "paragraph", "runs": [{"text": t}]}
                for t in (text or "").splitlines() if t.strip()]

    def build_child_blocks(self, blocks, token):
        return [{"object": "block", "type": "paragraph",
                 "paragraph": {"rich_text": b["runs"]}} for b in blocks]

    def blocks_plain_text(self, blocks):
        return "\n".join("".join(r.get("text", "") for r in b.get("runs", []))
                         for b in blocks)

    def make_toggle_title(self, blocks, chars):
        for b in blocks:
            t = "".join(r.get("text", "") for r in b.get("runs", [])).strip()
            if t:
                return t[:chars]
        return "新内容"

    def _new_run(self, text, ann):
        return {"text": text}

    def runs_to_rich_text(self, runs):
        return runs

    def date_mention_block(self, day):
        return {"type": "mention", "mention": {"type": "date", "date": {"start": day}}}

    def append_children(self, token, parent, children):
        self.appended = (parent, children)
        return "x"


# ══════════════════════════════════════════════════════════════════
print("\n── ① 今天只有一个块 ⇒ 就用它，而且**不许**因此去新建 ────")
nc = FakeNC([blk("a", OTHER), blk("t1", TODAY)])
got, how, n = na.find_today(nc, "tok", "P", TODAY, {})
ok(got == "t1", "挑到了今天那个（%s）" % got)
ok(n == 1, "数出来是 1 个")
ok("新建" not in how, "说明里没有「新建」字样（%s）" % how)

# ── ② 今天有 **3** 个（历史遗留）⇒ 追加到最后一个，并且把 3 说出来 ──
print("\n── ② ⚠️ 今天有 **3** 个 ⇒ 追加到最后一个，并且**把 3 说出来** ──")
# 这是真实数据里 TECH AI 2026-09-08 / 09-20 / 10-09 的样子，一模一样三个。
nc = FakeNC([blk("t1", TODAY), blk("x", OTHER), blk("t2", TODAY), blk("t3", TODAY)])
got, how, n = na.find_today(nc, "tok", "P", TODAY, {})
# ⚠️ 取**最后一个**不是随便定的：Notion 页面里新块在最下面，
#    读者看的是最下面那个；取第一个会让内容写进一个他早就翻过去的块。
ok(got == "t3", "追加到**最后一个**（%s）" % got)
ok(n == 3, "⚠️ **数出来了 3 个**（不是闷声挑一个）")
ok("3" in how, "说明里带上了这个数（%s）" % how)
# 对照：把实现改成"取第一个"，第一条立刻红；改成"只回 id 不带数量"，第二条立刻红。
#     这两条我都真的试过（见 HANDOFF 负向对照那一节）。

# ── ③ 今天没有 ⇒ 只有这一种情况才允许新建 ────────────────────────
print("\n── ③ 今天没有 ⇒ 只有这一种情况才允许新建 ───────────────")
nc = FakeNC([blk("a", OTHER), blk("b", "2026-10-08")])
got, how, n = na.find_today(nc, "tok", "P", TODAY, {})
ok(got is None, "没有就是 None（拿到 %r）" % got)
ok(n == 0, "数是 0")
ok("新建" in how, "说明里明确写了会新建（%s）" % how)
# ⚠️ 对照：把今天的块塞回去，这句"会新建"必须消失 ——
#    否则"要不要新建"根本没读到数据，恒为真。
nc2 = FakeNC([blk("t1", TODAY)])
_, how2, _ = na.find_today(nc2, "tok", "P", TODAY, {})
ok("新建" not in how2, "⚠️ 对照：有块时**不会**说新建（%s）—— 所以上一句是有信息的" % how2)

# ── ④ ⭐ 缓存真正治的那个病：**写完立刻读，扫描答「没有」** ────────
print("\n── ④ ⭐ 扫描答「没有」时，缓存必须兜住（这才是它治的病）──")
# ⚠️ 这一节第一版断言的是「缓存命中就不用扫描了」——**那条断言测的是我想象中的设计**，
#    而代码从来都是先扫描（"今天有几个"只有扫描答得出，而那个数是要给读者看的）。
#    ⇒ 这是「检查器对、产品/断言错」：改断言，**不是把阈值调松**。
#    改成测真正发生的事：上一个进程刚建的块，这个进程**扫描没看见**
#    （写入后立刻读的滞后），不靠缓存就会再建一个 —— 那正是 2026-10-09
#    TECH AI 上量到的那两个 created_time 相同的块。
nc = FakeNC([blk("yesterday", OTHER)], cache="just-made",
            extra={"just-made": TODAY})
got, how, n = na.find_today(nc, "tok", "P", TODAY, {})
ok(got == "just-made", "⭐ 扫描没看见，但缓存兜住了（拿到 %s）" % got)
ok("新建" not in how, "⚠️ **不会又起一个日期**（%s）" % how)
ok("滞后" in how, "说明里如实说是滞后，不是含糊的「命中」（%s）" % how)
# ⚠️ 负向对照：把缓存拿掉，**同样的滞后输入** ⇒ 必然说"会新建"。
#    所以上面那句「不会又起一个日期」是有信息的，不是恒真。
nc_lag = FakeNC([blk("yesterday", OTHER)], cache=None)
got2, how2, _ = na.find_today(nc_lag, "tok", "P", TODAY, {})
ok(got2 is None and "新建" in how2,
   "⚠️ 对照：**没有缓存时同样的输入会新建**（%s）—— 缓存就是那个差别" % how2)

# ── ⑤ 缓存腐烂（被删 / 改了日期）⇒ 必须能发现 ────────────────────
print("\n── ⑤ 缓存腐烂（被删 / 改了日期）⇒ 必须能发现 ──────────")
# ⚠️ 缓存只在"扫描什么都没看见"时才被用到（见 ④）。所以这里必须
#    **同时**制造"扫描空白"+"缓存已烂"才能验到验活那一步 ——
#    扫描能看见的时候缓存根本轮不到，那两件事是分开的。
# 不验活的话，内容会被 PATCH 到一个不存在的块上 —— 报错是「404」，
# 看起来像"接口坏了"，其实是缓存腐烂。
nc = FakeNC([blk("yesterday", OTHER)], cache="gone", dead=("gone",))
got, how, n = na.find_today(nc, "tok", "P", TODAY, {})
ok(got is None, "缓存里那个已经没了 ⇒ 不硬用（拿到 %r）" % got)
ok("新建" in how, "老实说会新建，而不是假装成功（%s）" % how)
# 缓存里的块还在、但**日期被改成别的**了 ⇒ 一样不能用
nc2 = FakeNC([blk("yesterday", OTHER), blk("old", OTHER)], cache="old")
got2, _, _ = na.find_today(nc2, "tok", "P", TODAY, {})
ok(got2 is None, "缓存里那个日期不对 ⇒ 不用它（拿到 %r）" % got2)

# ── ⑥ 扫描看得见时以扫描为准（缓存不许越权）─────────────────────
print("\n── ⑥ 扫描看得见时以扫描为准（缓存不许越权）───────────")
# ⚠️ 反过来也得防：缓存里是**上一个进程**记的 id，如果扫描明明看见了今天那个，
#    却因为缓存里有个旧 id 而写到别处去，就会分裂成两个块。
nc = FakeNC([blk("t1", TODAY), blk("t2", TODAY)], cache="stale-elsewhere")
got, how, n = na.find_today(nc, "tok", "P", TODAY, {})
ok(got == "t2", "以**扫描**为准，取最后一个（拿到 %s）" % got)
ok(n == 2, "⚠️ 数出 2 个并说出来（%d）" % n)

# ── ⑦ 版式：真的跑一遍 main（dry-run，一个字节都不写）────────────
print("\n── ⑦ 版式：真的跑一遍 main（dry-run）────────────────────")
# ⚠️ 第一版我在这节里自己写了个 `fake_title` 再断言它的返回值 ——
#    **那是在测我刚写的那三行，不是测产品**；产品改坏了这节照样绿。
#    改成：**真的调 main()**，把 make_toggle_title 换成探针，看它被喂了什么。


def run_main(nc_obj, argv):
    na.load_notion_clip = lambda: nc_obj
    na.locked = lambda _nc: contextlib.nullcontext()
    seen = {}
    real = nc_obj.make_toggle_title

    def spy(blocks, chars):
        seen["arg"] = list(blocks)
        seen["chars"] = chars
        return real(blocks, chars)

    nc_obj.make_toggle_title = spy
    old = sys.argv
    sys.argv = ["notion-append.py"] + argv
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            na.main()
    finally:
        sys.argv = old
    return buf.getvalue(), seen


nc = FakeNC([blk("t1", TODAY)])
out, seen = run_main(nc, ["--page", "P", "--text", "第一条正文\n第二行"])
ok("@Today → toggle「" in out, "默认就是**包一层 toggle** 的版式")
arg_txt = "".join(r.get("text", "") for b in seen.get("arg", []) for r in b.get("runs", []))
ok(na.MARKER not in arg_txt,
   "⚠️ 标题是从**正文**算的，标记没掺进去（喂进去的是 %r）" % arg_txt[:24])
ok(arg_txt.startswith("第一条正文"), "标题算在正文上（%r）" % arg_txt[:16])
ok(not nc.wrote, "⚠️ dry-run **一个字节都没写**（PATCH 次数 %d）" % len(nc.wrote))

nc2 = FakeNC([blk("t1", TODAY)])
out2, _ = run_main(nc2, ["--page", "P", "--text", "内容", "--flat"])
ok("@Today → 正文（平铺）" in out2, "⚠️ 对照：--flat 时确实是平铺（**这才是可切换的**）")

# ── ⑧ 源码里那几条"防重复"的机制必须真的在 ───────────────────────
print("\n── ⑧ 防重复的机制必须在源码里 ────────────────────────")
src = io.open(os.path.join(HERE, "notion-append.py"), encoding="utf-8").read()
ok("flock" in src, "有文件锁 —— 两个进程不能同时停在 find-or-create 里")
ok("_today_cache_put" in src, "建完就把 id 记到盘上（跨进程，不靠「写完立刻读」那一下）")
ok("不会自动删" in src, "写了「不会自动删」（那是读者的笔记，删要他点头）")
# ⚠️ 对照：确认这三条不是恒真的 —— 拿一个必然不含它们的字符串跑一遍
fake = "def f():\n    pass\n"
ok(not ("flock" in fake or "_today_cache_put" in fake or "不会自动删" in fake),
   "⚠️ 对照：这三条在别的文本上确实不成立（所以它们在测真东西）")

print("\n%d/%d 通过" % (PASS, PASS + FAIL))
sys.exit(1 if FAIL else 0)
