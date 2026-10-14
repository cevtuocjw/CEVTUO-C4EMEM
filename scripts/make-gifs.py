#!/usr/bin/env -S uv run --with pillow python
"""
把 `scripts/make-demos.mjs` 逐帧截下来的 PNG 拼成 GIF。

⚠️ 为什么不从 webm 转：**本机没有 ffmpeg**（Playwright 那个 chromium 目录里也没有）
   ⇒ 视频那条路出不来 GIF。逐帧截图 + Pillow 是这里唯一能走通的一条。
⚠️ 裁掉四周空白：`#pet` 那个盒子比宠物本体大一圈，直接拼出来的 GIF 有一半是空的。
"""
import json, os, sys
from PIL import Image

TMP = "/tmp/pet-demos"
OUT = os.path.expanduser("~/Library/Application Support/CEVTUO-RWP-build/usersite/cevtuopet/assets")
tags = json.load(open(f"{TMP}/frames.json"))

def frames_for(tag):
    out = []
    for i, f in enumerate(tags):
        if f["tag"] != tag:
            continue
        p = f"{TMP}/f{i:03d}.png"
        if os.path.exists(p):
            out.append(Image.open(p).convert("RGBA"))
    return out

def trim(imgs, pad=6):
    """裁到所有帧的公共非空区域（不裁的话四周全是透明边）。"""
    box = None
    for im in imgs:
        a = im.split()[-1]
        b = a.getbbox()
        if not b:
            continue
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]),
                                     max(box[2], b[2]), max(box[3], b[3]))
    if not box:
        return imgs
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(imgs[0].width, x1 + pad), min(imgs[0].height, y1 + pad)
    return [im.crop((x0, y0, x1, y1)) for im in imgs]

def build(tag, name, size=200, dur=90):
    imgs = frames_for(tag)
    if not imgs:
        print(f"  ⚠️ {tag} 没有帧，跳过")
        return
    imgs = trim(imgs)
    W = size
    H = max(1, round(imgs[0].height * W / imgs[0].width))
    imgs = [im.resize((W, H), Image.LANCZOS) for im in imgs]
    # 透明底 → 深色底（GIF 只有 1 位透明，边缘会烂；铺深色底最干净）
    flats = []
    for im in imgs:
        bg = Image.new("RGBA", im.size, (22, 22, 26, 255))
        bg.alpha_composite(im)
        flats.append(bg.convert("P", palette=Image.ADAPTIVE, colors=128))
    path = os.path.join(OUT, name)
    flats[0].save(path, save_all=True, append_images=flats[1:], duration=dur, loop=0, optimize=True)
    print(f"  ✓ {name}  {W}×{H}  {len(flats)} 帧  {os.path.getsize(path)//1024}KB")

if __name__ == "__main__":
    print("拼 GIF：")
    build("spin", "demo-silver-3d.gif", size=200, dur=85)
    build("rose", "demo-rose-3d.gif", size=200, dur=85)
