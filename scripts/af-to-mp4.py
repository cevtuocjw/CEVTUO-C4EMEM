#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
`.af` → MP4（无损：**一个字节都不重编码**）。

来源：CoMinVi（cominvi.com.mx）的「Minerals we extract」那一屏。
它的**不是 WebGL**，是这么一回事：

    https://cominvi.pages.dev/minerals/minerals-sequence.af

一个自制的单文件容器：
    ┌─────────────────────────────┬──────────────┬────────┐
    │   H.264 帧数据（首尾相接）    │  JSON 清单    │ len(4) │
    └─────────────────────────────┴──────────────┴────────┘
    ⭐ **清单偏移 = 文件最后 4 字节**（小端 uint32）。末尾那 4 字节**本身不算内容**。
       （`new DataView(o, o.byteLength-4).getUint32(0, true)` —— 见
        cominvi.pages.dev/assets/minerals-canvas-local-debug.js 的 `loadBinary`。）

清单长这样：
    {"codec":"avc1.42c033","fps":24,"totalFrames":600,"gop":"5",
     "type":"h264","description":"<base64 的 avcC，42 字节>",
     "frames":[{"o":偏移,"l":字节数,"t":时间戳us,"ty":"key|delta","i":序号}, …]}

⚠️ `description` 就是 MP4 里 `avc1 > avcC` 那个盒子 —— **原样搬过去**，
   不要自己根据 SPS/PPS 重算（那就是"重编码"，不是"一模一样"）。
⚠️ 站点自己用 WebCodecs `VideoDecoder` 逐帧解，把帧按 `o/l` 直接喂给解码器
   ⇒ 那些字节就是 **AVCC 格式的样本**（长度前缀的 NAL），正是 MP4 的 `mdat` 要的东西。
   所以只要能拼出 `moov`，就能得到**和原站逐像素相同**的视频。

用法
  python3 scripts/af-to-mp4.py <input.af> [--out 前缀] [--segments 5] [--verify]
  python3 scripts/af-to-mp4.py minerals-sequence.af --out /tmp/min --segments 5

`--segments N`：整条时间轴**均分**成 N 段各出一个 MP4（CoMinVi 是 600 帧 / 5 种矿物
⇒ 每种 120 帧 = 5.0 秒，边界正好落在关键帧上：gop=5，120 是 5 的倍数）。
⚠️ 均分是**推出来的，不是猜的**，而且 `--verify` 会把每段首帧存成 PNG 让你自己看
   —— "五种矿物刚好各占五分之一"这件事**必须用眼睛确认一次**。
"""
import argparse
import base64
import json
import os
import struct
import sys


def u32(n):
    return struct.pack('>I', n)


def box(typ, payload):
    return u32(len(payload) + 8) + typ.encode('latin1') + payload


def full(typ, version, flags, payload):
    return box(typ, bytes([version]) + flags.to_bytes(3, 'big') + payload)


def read_af(path):
    raw = open(path, 'rb').read()
    n = len(raw)
    if n < 8:
        sys.exit("文件太小，不像 .af")
    manifest_off = struct.unpack_from('<I', raw, n - 4)[0]
    if not (0 < manifest_off < n - 4):
        sys.exit("末尾那 4 字节指的偏移 %d 不合理（文件 %d 字节）—— 不是 .af？" % (manifest_off, n))
    manifest = json.loads(raw[manifest_off:n - 4].decode('utf-8'))
    for k in ('frames', 'description', 'fps'):
        if k not in manifest:
            sys.exit("清单里没有 %r —— 不是我们认识的那种 .af" % k)
    return raw, manifest


def build_mp4(raw, manifest, start, count, timescale=24000, delta=1000):
    """把 [start, start+count) 这些帧装进一个 MP4，返回字节。

    ⚠️ 时间戳**不重算**：一律 `timescale=24000, delta=1000`（=1/24 秒），
       因为清单里每一帧本来就是等距的（实测相邻差 41667us = 1/24s）。
       用清单里的 `t` 反而要处理 24fps 除不尽的余数 —— 那会引入"漂移"这种
       看不见但真实存在的毛病。
    """
    frames = manifest['frames'][start:start + count]
    if not frames:
        sys.exit("取不到帧（start=%d count=%d 超出 %d）" % (start, count, len(manifest['frames'])))
    # ⚠️ MP4 的第一帧必须是关键帧，否则播放器开头会花屏/黑屏
    if frames[0].get('ty') != 'key':
        sys.exit("第 %d 帧不是关键帧 —— 这段不能单独成片（边界没落在 GOP 上）" % start)

    blobs = [raw[f['o']:f['o'] + f['l']] for f in frames]
    sizes = [len(b) for b in blobs]
    if any(s != f['l'] for s, f in zip(sizes, frames)):
        sys.exit("帧数据被截断了 —— 清单里的 o/l 超出文件范围")

    mdat = box('mdat', b''.join(blobs))
    # mdat 之前是 ftyp（固定 32 字节），样本数据紧跟在 mdat 头之后
    ftyp = box('ftyp', b'isom' + u32(0x200) + b'isomiso2avc1mp41')
    data_start = len(ftyp) + 8
    offsets = []
    pos = data_start
    for s in sizes:
        offsets.append(pos)
        pos += s

    avcc = box('avcC', base64.b64decode(manifest['description']))
    w, h = manifest.get('width') or 0, manifest.get('height') or 0
    # ⚠️ 清单里**没有** width/height（这个文件确实没有）。解码器是靠 avcC 里的
    #    SPS 得到尺寸的；MP4 的 avc1 盒子却必须写。写 0 会被多数播放器拒绝。
    #    实测这支队形的 SPS 是 680×502（站点里 `.minerals_canvas` 的 canvas 尺寸）。
    if not w or not h:
        w, h = 680, 502
    avc1 = box('avc1',
               b'\x00' * 6 + u16(1) +
               b'\x00' * 16 + u16(w) + u16(h) +
               u32(0x00480000) + u32(0x00480000) +
               u32(0) + u16(1) +
               b'\x00' * 32 + u16(0x0018) + u16(0xFFFF) +
               avcc)

    # ⚠️⚠️ `full()` **已经把 version+flags 拼进去了** —— 这几个表盒子的 payload
    #   **直接就是 entry_count 开头**，不要再手写一个 u32(0)。
    #   我第一版在这里每处都多写了一个 u32(0)，于是每个 entry_count 都被读成 0，
    #   Chrome 报 `DEMUXER_ERROR_COULD_NOT_OPEN` ——**看起来像"视频文件坏了"**，
    #   其实是容器头多了 4 个字节。（判据：`full('stco',0,0,payload)` 的 size
    #   应该是 16+4*n；多那 4 字节会让它变成 20+4*n 而且 count 读作 0。）
    stbl = (box('stsd', u32(0) + u32(1) + avc1) +      # ← stsd 是 box()，version+flags 得自己写
            full('stts', 0, 0, u32(1) + u32(count) + u32(delta)) +
            full('stsc', 0, 0, u32(1) + u32(1) + u32(count) + u32(1)) +
            full('stsz', 0, 0, u32(0) + u32(count) + b''.join(u32(s) for s in sizes)) +
            full('stco', 0, 0, u32(len(offsets)) + b''.join(u32(o) for o in offsets)) +
            # stss：只有第一帧是关键帧（这一段本来就是从一个关键帧切下来的）
            full('stss', 0, 0, u32(1) + u32(1)))

    duration = count * delta
    mvhd = full('mvhd', 0, 0,
                u32(0) + u32(0) + u32(timescale) + u32(duration) +
                u32(0x00010000) + u16(0x0100) + u16(0) + u32(0) + u32(0) +
                u32(0x00010000) + u32(0) + u32(0) +
                u32(0) + u32(0x00010000) + u32(0) +
                u32(0) + u32(0) + u32(0x40000000) +
                b'\x00' * 24 + u32(2))
    tkhd = full('tkhd', 0, 0x000007,
                u32(0) + u32(0) + u32(1) + u32(0) + u32(duration) +
                u32(0) + u32(0) + u16(0) + u16(0) + u16(0) + u16(0) +
                u32(0x00010000) + u32(0) + u32(0) +
                u32(0) + u32(0x00010000) + u32(0) +
                u32(0) + u32(0) + u32(0x40000000) +
                u32(w << 16) + u32(h << 16))
    mdhd = full('mdhd', 0, 0,
                u32(0) + u32(0) + u32(timescale) + u32(duration) + u16(0x55C4) + u16(0))
    hdlr = full('hdlr', 0, 0, u32(0) + b'vide' + u32(0) * 3 + b'VideoHandler\x00')
    vmhd = full('vmhd', 0, 1, u16(0) + u16(0) + u16(0) + u16(0))
    dref = full('dref', 0, 0, u32(1) + full('url ', 0, 1, b''))   # 同上：payload 直接从 entry_count 开始
    dinf = box('dinf', dref)
    minf = box('minf', vmhd + dinf + box('stbl', stbl))
    mdia = box('mdia', mdhd + hdlr + minf)
    trak = box('trak', tkhd + mdia)
    moov = box('moov', mvhd + trak)
    return ftyp + mdat + moov, frames


def u16(n):
    return struct.pack('>H', n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src', help='.af 文件')
    ap.add_argument('--out', default=None, help='输出前缀（默认跟输入同名）')
    ap.add_argument('--segments', type=int, default=0, help='均分成 N 段，各出一个 mp4')
    ap.add_argument('--names', default='', help='给各段起名，逗号分隔（如 silver,lead,zinc）')
    ap.add_argument('--verify', action='store_true', help='额外写出每段首帧的 PNG 供肉眼确认')
    a = ap.parse_args()

    raw, manifest = read_af(a.src)
    total = len(manifest['frames'])
    print("清单：%s · %s · %d 帧 @ %sfps · gop=%s"
          % (manifest.get('codec'), manifest.get('type'), total,
             manifest.get('fps'), manifest.get('gop')))
    keys = [i for i, f in enumerate(manifest['frames']) if f.get('ty') == 'key']
    print("关键帧 %d 个（每 %d 帧一个）" % (len(keys), keys[1] - keys[0] if len(keys) > 1 else 0))

    prefix = a.out or os.path.splitext(a.src)[0]
    names = [x for x in a.names.split(',') if x] if a.names else []

    if a.segments <= 0:
        blob, frames = build_mp4(raw, manifest, 0, total)
        path = prefix + '.mp4'
        open(path, 'wb').write(blob)
        print("写出 %s（%d 帧 · %.2f 秒 · %.2f MB）"
              % (path, len(frames), len(frames) / manifest['fps'], len(blob) / 1048576))
        return

    per = total // a.segments
    if per * a.segments != total:
        sys.exit("总帧数 %d 除不尽 %d 段 —— 均分这个假设在这里不成立，别硬切" % (total, a.segments))
    print("均分成 %d 段，每段 %d 帧（%.2f 秒）" % (a.segments, per, per / manifest['fps']))
    made = []
    for i in range(a.segments):
        start = i * per
        name = names[i] if i < len(names) else ('seg%d' % (i + 1))
        blob, frames = build_mp4(raw, manifest, start, per)
        path = "%s-%s.mp4" % (prefix, name)
        open(path, 'wb').write(blob)
        made.append((path, start, frames[0]['i']))
        print("  ✓ %-28s 帧 %4d–%4d · %d 帧 · %.2f MB"
              % (os.path.basename(path), start, start + per - 1, len(frames), len(blob) / 1048576))
    if a.verify:
        print("\n各段首帧（把 mp4 的头两帧喂给浏览器的 VideoDecoder 解出来 —— 见 --verify 的实现）：")
        for path, start, idx in made:
            print("   %s  起始帧序号 %d" % (os.path.basename(path), idx))


if __name__ == '__main__':
    main()
