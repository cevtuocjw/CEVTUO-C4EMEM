#!/usr/bin/env -S uv run --with pillow python
"""
菜单栏那颗图标：**一枚细圈 + 里面那朵小花的剪影**（模板图）。

读者 2026-10-14：「记得你的导航栏的那个 logo 也换了，现在是一个**圆规**」
—— 他说得对：菜单栏原来挂的是 SF Symbol `pencil.tip`，那支笔看着就是圆规。

⚠️ 菜单栏要的是**单色模板图**（`isTemplate = true`，macOS 自己按深浅色反色）：
   把那张彩色照片塞进来会变成一块糊的黑方块，深浅色下也都不自适应。
   ⇒ 这一张是**另画**的，不是把 App 图标缩一缩。
⚠️ 22px 上只放得下"一个圈 + 一团花头"。整支玫瑰（含长长的茎）缩到 22px 是一根糊线。
跑：`uv run --with pillow python app/make-menubar.py`
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "pet")
FLOWER = os.path.join(HERE, "logo-src", "flower.png")


def flower_head() -> Image.Image:
    """小花抠白底，只留上面那一截（花头）—— 下面那条长茎在这个尺寸上读不出来。"""
    im = Image.open(FLOWER).convert("RGBA")
    new = Image.new("RGBA", im.size, (0, 0, 0, 0))
    n, p = new.load(), im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = p[x, y]
            if min(255 - r, 255 - g, 255 - b) < 34:
                continue
            n[x, y] = (r, g, b, a)
    box = new.getbbox()
    new = new.crop(box)
    return new.crop((0, 0, new.width, int(new.height * 0.42)))


def build(px: int, head: Image.Image) -> Image.Image:
    S = px * 4                              # 先大后缩，边缘才干净
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w = max(2, int(S * 0.062))
    d.ellipse([w / 2, w / 2, S - w / 2, S - w / 2], outline=(0, 0, 0, 255), width=w)
    target = int(S * 0.56)
    k = target / max(head.size)
    h = head.resize((max(1, int(head.width * k)), max(1, int(head.height * k))), Image.LANCZOS)
    sil = Image.new("RGBA", h.size, (0, 0, 0, 0))
    sil.putalpha(h.getchannel("A").point(lambda v: 255 if v > 110 else 0))
    img.alpha_composite(sil, ((S - h.width) // 2, (S - h.height) // 2))
    return img.resize((px, px), Image.LANCZOS)


if __name__ == "__main__":
    head = flower_head()
    for px in (22, 44):
        name = "menubar@2x.png" if px == 44 else "menubar.png"
        build(px, head).save(os.path.join(OUT, name))
        print(f"✅ app/pet/{name}  {px}px")
