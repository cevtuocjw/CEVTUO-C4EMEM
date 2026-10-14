#!/usr/bin/env uv run --with pillow python
"""
⭐⭐ CEVTUO-PET 的字标 —— **银戒指（silverring） + 中间那朵小花（完全不变）**。

读者 2026-10-14：
  「logo 你用 silverring 这个，然后中间插入我的小花（完全不变）作为 logo，
    软件名字叫做 CEVTUO-PET」
  「这个是小花 logo，你自己抠图自己合在一起去」

素材在 `app/logo-src/`（进 git —— 产物可以重生成，素材丢了就真没了）：
  · silverring.jpg  扭花银戒指的照片（米色底 + 投影）
  · flower.png      那朵银色玫瑰（白底）

⚠️⚠️ 两条钉在这里的教训（都吃过）：
  ① **别去"清洗"一个标签/一段 HTML 的属性**：2026-10-14 我把 `<svg ...>` 整个替换掉，
     连带删了 `fill="none" stroke="currentColor"` ⇒ 图标变成**一团黑剪影**，还打进了 dmg。
  ② **生成完先看图，再打包。**「我生成了」和「它长对了」是两件事。

⚠️ 本机原来**没有任何图像库**（pngjs / sharp / jimp 都没有），所以才一直绕浏览器截图。
   现在改用 `uv run --with pillow` —— 能合成、能编码 GIF，比浏览器那条路快也稳。
   跑：`uv run --with pillow python app/make-logo.py`（shebang 已经写好了，`./app/make-logo.py` 也行）
"""
import os
import subprocess
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "logo-src")
OUT_PET = os.path.join(HERE, "pet")
SIZES = [1024, 512, 256, 128, 64, 32, 16]

PLATE_ROUND = 0.2227          # 圆角比例（macOS 图标那套）


def plate(size: int) -> Image.Image:
    """深色圆角底盘（带一点从左上来的渐变，和原来那个图标一致）。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * PLATE_ROUND), fill=(24, 23, 28, 255))
    # 左上角那点高光：一层径向渐变，用椭圆近似
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    steps = 90
    for i in range(steps, 0, -1):
        t = i / steps
        rr = size * 0.80 * t
        cx, cy = size * 0.30, size * 0.20
        a = int(20 * (1 - t) ** 1.6)
        if a <= 0:
            continue
        gd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(70, 68, 78, a))
    img = Image.alpha_composite(img, glow)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * PLATE_ROUND), fill=255)
    img.putalpha(Image.composite(img.getchannel("A"), Image.new("L", (size, size), 0), mask))
    return img


def ring_bbox(im: Image.Image, thr: int = 62):
    """戒指的包围盒。

    ⚠️ 阈值**要高于投影**：投影和米色底的差只有 ~40，戒指本体差 >60。
       取 62 就正好把投影排除在外 —— 这是"怎么把投影甩掉"的正解
       （泛洪和边缘法我都试过，一个留下整片灰、一个把投影的软边描出来了）。
    """
    rgb = im.convert("RGB").resize((im.width // 2, im.height // 2))   # 半分辨率够准，快 4 倍
    px = rgb.load()
    w, h = rgb.size
    corners = [px[2, 2], px[w - 3, 2], px[2, h - 3], px[w - 3, h - 3]]
    bg = tuple(sorted(c[k] for c in corners)[1] for k in range(3))
    x0, y0, x1, y1 = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2])) > thr:
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
    k = 2
    return x0 * k, y0 * k, x1 * k, y1 * k


def cut_white(im: Image.Image, thr: int = 34) -> Image.Image:
    """把白底抠掉（小花那张自带白底）。⚠️ 只对"白底"成立 —— 别拿去抠照片。"""
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    a = im.getchannel("A").point(lambda v: 255 if v > 34 else 0)
    im.putalpha(a)
    # 白底 = 三个通道都接近 255
    new = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    np_, nn = new.load(), im.load()
    for y in range(h):
        for x in range(w):
            r, g, b, al = nn[x, y]
            if al and min(255 - r, 255 - g, 255 - b) < thr:
                continue                      # 白 ⇒ 透明
            np_[x, y] = (r, g, b, al)
    return new.crop(new.getbbox())


def compose(size: int, ring: Image.Image, flower: Image.Image,
            ring_scale=0.90, flower_fill=0.52, rotate=-8) -> Image.Image:
    base = plate(size)
    d = size * ring_scale
    # 圆牌：把戒指**裁成正方形**再裁圆
    med = ring.resize((int(d), int(d)), Image.LANCZOS)
    mask = Image.new("L", (int(d), int(d)), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, int(d) - 1, int(d) - 1], fill=255)
    base.paste(med, (int((size - d) / 2), int((size - d) / 2)), mask)

    # ⭐ 小花：**完全不变**（不调色、不裁剪），只按比例缩到戒指孔那么大
    k = min((d * flower_fill) / flower.width, (d * flower_fill * 1.4) / flower.height)
    fw, fh = max(1, int(flower.width * k)), max(1, int(flower.height * k))
    fl = flower.resize((fw, fh), Image.LANCZOS)
    if rotate:
        fl = fl.rotate(rotate, resample=Image.BICUBIC, expand=True)
    base.alpha_composite(fl, (int((size - fl.width) / 2), int((size - fl.height) / 2)))
    return base


def main():
    ring_src = Image.open(os.path.join(SRC, "silverring.jpg")).convert("RGB")
    flower_src = Image.open(os.path.join(SRC, "flower.png")).convert("RGBA")

    x0, y0, x1, y1 = ring_bbox(ring_src)
    cx, cy = (x0 + x1) / 2 + 105, (y0 + y1) / 2 - 42
    side = max(x1 - x0, y1 - y0) * 1.04
    sx = max(0, min(ring_src.width - side, cx - side / 2))
    sy = max(0, min(ring_src.height - side, cy - side / 2))
    ring = ring_src.crop((int(sx), int(sy), int(sx + side), int(sy + side)))
    print(f"戒指包围盒 {x0},{y0}–{x1},{y1} → 裁 ({int(sx)},{int(sy)}) 边长 {int(side)}")

    flower = cut_white(flower_src)
    print(f"小花抠完 {flower.size}")

    os.makedirs(OUT_PET, exist_ok=True)
    for s in SIZES:
        compose(s, ring, flower).save(os.path.join(OUT_PET, f"logo-{s}.png"))
    compose(1024, ring, flower).save(os.path.join(OUT_PET, "logo-1024.png"))
    compose(512, ring, flower).save(os.path.join(OUT_PET, "logo.png"))
    print(f"✅ app/pet/logo.png + logo-{{{'|'.join(map(str, SIZES))}}}.png")

    # App 图标源（make-icon.mjs 会截它）
    with open(os.path.join(OUT_PET, "icon.html"), "w") as f:
        f.write('<!doctype html>\n<html><head><meta charset="utf-8"><style>\n'
                '  html,body{margin:0;width:1024px;height:1024px;overflow:hidden;background:transparent}\n'
                '  img{width:1024px;height:1024px;display:block}\n'
                '</style></head>\n<body><img src="logo-1024.png" alt=""></body></html>\n')
    print("✅ app/pet/icon.html（图标源 —— 再跑 bun app/pet/make-icon.mjs 出 icns）")

    # 审核图：**先看它再打包**
    sheet = Image.new("RGBA", (1400, 640), (17, 17, 20, 255))
    dd = ImageDraw.Draw(sheet)
    big = compose(400, ring, flower)
    sheet.alpha_composite(big, (30, 30))
    dd.text((30, 12), "512（就是它）", fill=(140, 200, 255))
    dd.rectangle([470, 30, 869, 429], fill=(255, 255, 255, 255))
    sheet.alpha_composite(big, (470, 30))
    dd.text((470, 12), "白底上", fill=(140, 200, 255))
    x = 910
    for s in [256, 128, 64, 32, 16]:
        sheet.alpha_composite(compose(s, ring, flower), (x, 30 + (256 - s)))
        dd.text((x, 296), f"{s}px", fill=(140, 200, 255))
        x += s + 16
    sheet.convert("RGB").save("/tmp/logo-review.png")
    print("审核图 → /tmp/logo-review.png（**先看它再打包**）")

    # 分发页那几张（只在那个仓库存在时写）
    U = os.path.expanduser("~/Library/Application Support/CEVTUO-RWP-build/usersite/cevtuopet/assets")
    if os.path.isdir(U):
        compose(512, ring, flower).save(os.path.join(U, "logo.png"))
        compose(32, ring, flower).save(os.path.join(U, "favicon-32.png"))
        compose(16, ring, flower).save(os.path.join(U, "favicon-16.png"))
        compose(256, ring, flower).save(os.path.join(U, "apple-touch-icon.png"))
        print("✅ 分发页 logo / favicon 也更新了")


if __name__ == "__main__":
    main()
