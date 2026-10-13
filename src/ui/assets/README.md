# 光球的真素材

⚠️⚠️ **这两个 mp4 不是我画的。** 它们是读者 2026-10-10 指定的两个 Dribbble shot 里
**原始的视频文件**，我只做了两件事：**裁成正方形**（按实测的包围盒）+ **转码压小**。
一个像素都没有重画。

读者原话：
> 「我给你的那几个 3D 的珍珠玻璃，岩石那几个在哪里，你自己去获取到链接然后一模一样拿下来，
>  而不要自己渲染，你现在渲染的这几个球非常难看，替换好」

## 来源

| 文件 | 原 shot | 作者 | 原始视频 |
|---|---|---|---|
| `pearl-orb.mp4` | [dribbble.com/shots/15520653](https://dribbble.com/shots/15520653)「AI voice assistant visual research」 | Gleb Kuznetsov / Milkinside | `cdn.dribbble.com/userupload/31449665/file/large-0914ab75f91dbc6e55eaafdac282218c.mp4` |
| `stone-orb.mp4` | [dribbble.com/shots/23020059](https://dribbble.com/shots/23020059)「Textures and Forms Study: Transitions Explorations」 | Zhenya Rynzhuk | `cdn.dribbble.com/userupload/11303734/file/original-419f44af178648874c6539f4bb524400.mp4` |

## 怎么裁的（都是**量出来**的，不是试出来的）

**珍珠** 原片 800×600。量出非背景像素（背景是纯 `#f2f2f0`）的包围盒是
`x 183→595, y 87→498` = **413×412**，中心 (389,293)，半径 206 —— 是个正圆。
⇒ `crop=412:412:183:87`，正好把球圈住，**不用抠图**（圆形裁切天然把四角去掉）。

**岩石** 原片 1600×1200，是**整页 UI 稿**，岩石只在右下角那块黑板里。
从亮度图上读出黑板范围 `x 896→1423, y 336→991`，取它下半部的正方形 `crop=520:520:900:468`。
⚠️ 原片是**过渡合集**：只有**前 2 秒**是那个黑底岩石，
之后会切到别的场景（还带 mock 界面的播放器时间码 `1:01`）⇒ 只取 `t=0→2s`。

## 重新生成

```bash
export PATH="$HOME/Library/Application Support/CherryStudio/Toolchain/mise/shims:$PATH"   # ffmpeg 在这
cd src/ui/assets
ffmpeg -y -i <原始 pearl.mp4> -vf "crop=412:412:183:87,scale=560:560:flags=lanczos" \
  -c:v libx264 -pix_fmt yuv420p -crf 23 -preset slow -an -movflags +faststart pearl-orb.mp4
ffmpeg -y -t 2 -i <原始 stone.mp4> -vf "crop=520:520:900:468,scale=560:560:flags=lanczos" \
  -c:v libx264 -pix_fmt yuv420p -crf 23 -preset slow -an -movflags +faststart stone-orb.mp4
```

## ⚠️ 版权

两个 shot 都标 **All rights reserved**（© Milkinside / Zhenya Rynzhuk）。
自己用没问题；**这个软件要发给别人之前必须换掉**。
换法：把 `src/ui/app.js` 里的 `ORB_VIDEO` 清空即可 —— 会自动回落到原来的着色器光球，
不用改别的地方。

---

# 全站字体：霞鹜文楷

`wenkai.woff2`（**1.5MB**）。

读者 2026-10-10：「全网站字体改的和你做的 icon 一种风格像手写的」。
图标是手绘单线，配印刷体（苹方/思源黑）气质是拧的；**楷体天生带笔锋**，和手绘描边是一路的。

| | |
|---|---|
| 字体 | [霞鹜文楷 LXGW WenKai](https://github.com/lxgw/LxgwWenKai) v1.522 Regular |
| 许可 | **OFL 1.1**（可自由使用/嵌入，保留许可即可） |
| 原件 | 24MB TTF（2 万多字）⇒ 切完 **1.5MB** woff2 |

## 怎么切的（可重做）

```bash
# 1) 取原件（⚠️ github release 资产的域名直连不通，**要走代理**）
HTTPS_PROXY=http://127.0.0.1:7890 curl -sL -o /tmp/wenkai.ttf \
  https://github.com/lxgw/LxgwWenKai/releases/download/v1.522/LXGWWenKai-Regular.ttf

# 2) 生成字表：GB2312 一级+二级汉字（6763）+ 拉丁 + 标点 = 7386 个
python3 - <<'PY'
chars = []
for hi in range(0xB0, 0xF8):
    for lo in range(0xA1, 0xFF):
        try: chars.append(bytes([hi, lo]).decode('gb2312'))
        except Exception: pass
extra = ''.join(chr(c) for c in list(range(0x20,0x7F))+list(range(0xA0,0x100))+
                list(range(0x2000,0x2070))+list(range(0x3000,0x3040))+list(range(0xFF00,0xFFF0)))
open('/tmp/chars.txt','w',encoding='utf-8').write(''.join(chars)+extra)
PY

# 3) 切子集（⚠️ 必须 --with brotli，否则报 No module named brotli）
uvx --from fonttools --with brotli pyftsubset /tmp/wenkai.ttf \
  --text-file=/tmp/chars.txt --flavor=woff2 --output-file=src/ui/assets/wenkai.woff2 \
  --layout-features='*' --no-hinting
```

⚠️ **不在那 7386 个字里的会回落到系统字体**（不是豆腐块，但看得出一点混排）。
要全量就把 24MB 的 ttf 放回来当 `src` 的第二个来源，代价是首屏多 22MB。
⚠️ `pre/code` 一律**不用**楷体 —— 比例宽的数字会让对齐的东西散架（CSS 里单独列了）。

---

# 水晶（取代原来的岩石）

`crystal-orb.mp4`。读者 2026-10-10：「找一个好的岩石 3D，就一块岩石或者**水晶也可以，可以转动**，**现在的不好**」。

| | |
|---|---|
| 素材 | [Pixabay「diamond crystal jewelry bright」](https://pixabay.com/videos/diamond-crystal-jewelry-bright-3121/)（作者 Vimeo-Free-Videos） |
| 直链 | `https://cdn.pixabay.com/video/2016/05/12/3121-166335819_large.mp4` |
| 许可 | **Pixabay Content License**（免费商用、**不必署名**）—— 比 Dribbble 那两个宽松 |
| 原片 | 1920×1080 / 13 秒 / 5.4MB ⇒ 裁完 **1.2MB**、520×520 |

## 怎么挑的（不是随便拿一个）

搜出来 4 个候选，**按"亮像素占比"筛**：一块孤立的水晶在暗底上，亮像素应该只占几个百分点。
实测 c4（钻石特写）**27.7%** —— 那是水面反光把整幅都算进去了，不是一块孤立的东西；
选中的这个只有 **1.1%**，盒子 216×221，**干干净净一块**。

## 怎么裁的

⚠️ 裁剪框取的是**整段旋转过程中的并集包围盒**，不是某一帧的 ——
只看一帧的话，它转出去的那几秒会被切掉（第一次就裁错了：宝石比量出来的还大，两边全切了）。

```bash
# 全段每 0.5 秒抽一帧，取亮像素(>26)的并集包围盒 ⇒ 960 宽下 x302→720 y119→363
ffmpeg -i 3121-166335819_large.mp4 -vf "fps=2,scale=960:-2" -frames:v 30 /tmp/g%02d.png
# 换算到原片 + 留 12% 余量 ⇒ crop=936:936:554:14
ffmpeg -i 3121-166335819_large.mp4 -vf "crop=936:936:554:14,scale=520:520:flags=lanczos" \
  -c:v libx264 -pix_fmt yuv420p -crf 27 -preset slow -an -movflags +faststart crystal-orb.mp4
```

---

# 矿物标本（`mineral-silver.mp4` / `mineral-lead.mp4` / `mineral-zinc.mp4`）

读者 2026-10-10：
> 「岩石改为 https://www.cominvi.com.mx/ 这个网站上直接获取，我想 silver lead zinc 的 3D 都要，
>  **你要完全一模一样，分成三份**」

## 它其实是什么（不是 WebGL）

CoMinVi 首页「S.03 MINERALS WE EXTRACT」那一屏看着像 3D，**实际是一个自制单文件容器**：

    https://cominvi.pages.dev/minerals/minerals-sequence.af     4.89 MB

    ┌──────────────────────────────┬───────────────┬────────┐
    │  H.264 帧数据（首尾相接）       │  JSON 清单     │ len(4) │
    └──────────────────────────────┴───────────────┴────────┘
    ⭐ 清单偏移就写在**文件最后 4 字节**（小端 uint32），末尾那 4 字节本身不算内容。
       （`new DataView(o, o.byteLength-4).getUint32(0, true)`
         —— cominvi.pages.dev/assets/minerals-canvas-local-debug.js 的 `loadBinary`）

清单：`{"codec":"avc1.42c033","fps":24,"totalFrames":600,"gop":"5","type":"h264",
       "description":"<base64 的 avcC>","frames":[{"o":偏移,"l":字节数,"t":us,"ty":"key|delta","i":序号}, …]}`

站点自己用 **WebCodecs `VideoDecoder`** 逐帧解（不是 `<video>`），
所以那些字节就是 **AVCC 格式的样本** —— 正是 MP4 的 `mdat` 要的东西。

## 怎么取出来的（无损，一个字节都没重编码）

```bash
curl -o /tmp/minerals-sequence.af https://cominvi.pages.dev/minerals/minerals-sequence.af
python3 scripts/af-to-mp4.py /tmp/minerals-sequence.af \
        --out src/ui/assets/mineral --segments 5 --names gold,silver,lead,copper,zinc
```

只保留读者要的三份，其余两份（gold / copper）删掉。

## ⭐ 「五种各占五分之一」是**量出来**的，不是猜的

- 总 600 帧 @24fps = 25.0 秒；关键帧每 5 帧一个（`gop=5`），120 个。
- 站点上那五行 `[ #79 #47 #82 #29 #30 ]` 是**装饰性的编号**，不是帧数
  （79+47+82+29+30 = 267 ≠ 600）。这一点差点把我带偏。
- 真正能站住的划分：**600 ÷ 5 种矿物 = 每种 120 帧 = 5.00 秒**，
  而且 120 是 5 的倍数 ⇒ **每段的头一帧正好是关键帧**（不然单独成片会开头花屏）。
- ⚠️ 这只是"讲得通"，**不等于对**。所以把五段各截一帧**并排摆出来看了**：

  | 段 | 画面 |
  |---|---|
  | 帧 0–119 | 灰白岩体带金色斑点 → **gold** ✓ |
  | 帧 120–239 | 苍白色带条纹 → **silver** ✓ |
  | 帧 240–359 | 近乎全黑 → **lead** ✓ |
  | 帧 360–479 | 绿色（孔雀石）+ 锈褐 → **copper** ✓ |
  | 帧 480–599 | 银亮金属条纹 → **zinc** ✓ |

  ⇒ 顺序和站点上 `Gold Silver Lead Copper Zinc` 一字不差。**对上了，才敢切。**

## ⚠️ 坑：`full()` 已经把 version+flags 拼进去了

`scripts/af-to-mp4.py` 第一版在 `stts/stsc/stsz/stco/stss/dref` 的 payload **各多写了一个
`u32(0)`**（把它们当成非 full box 了）⇒ 每个 `entry_count` 都读成 0 ⇒
Chrome 报 `DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed`。

⚠️ 那个报错**看起来完全像"视频文件坏了"**，其实是容器头多了 4 个字节。
判据：`full('stco',0,0,payload)` 的 size 应当是 `16 + 4n`；多那 4 字节会变成 `20 + 4n`
且 count 读作 0。

## 底是白的 —— 而且**故意不抠**

实测四角像素 `253,253,253`（近白），H.264 也带不了 alpha。
**我们没有抠它**，因为：抠一张**有损压缩过的近白底**，边缘那些半白不白的过渡像素
会在抠完之后留一圈**白毛**；而这块标本要贴的是深色界面 —— 那圈白毛就是一道白光，
比留着底刺眼得多。原站自己也是把它们摆在**米白卡片**上的。

⇒ 所以 `silver / lead / zinc` 三种走**「标本卡片」**样式（`border-radius:22px` + 白底 + 投影，
见 `app.css` 的 `.orbbg[data-form="silver|lead|zinc"]`），**不是圆**。
**卡面白底是设计的一部分，不是"没处理干净"。**

## ⚠️ 版权

素材版权属 **CoMinVi / Holographik®**。自己看没问题；
**这个软件要是发给别人，先按 `app.js` 里 `ORB_VIDEO` 那段注释把它清空**
（清空后会自动回落到着色器，不用改别的地方）。


---

## 矿物标本（银 / 铅 / 锌）—— 2026-10-10 重做

| 文件 | 是什么 |
|---|---|
| `mineral-{silver,lead,zinc}.mp4` | **原片**（从 cominvi.com.mx 那个自制 `.af` 容器里无损拆出来的 H.264）。⚠️ **别直接用它播** —— 见下 |
| `mineral-{silver,lead,zinc}-loop.mp4` | **真正在用的那份**（`ORB_VIDEO` 指的就是它） |
| `mineral-*-mini.webp` | Pet（104px）用的**抠好白底的动图**，208×208 / 20fps |
| `card.png` | CEVTUO 卡片那张原图的裁剪（390×607） |

### ⚠️⚠️ 原片为什么不能直接用

实测 `ffprobe -show_frames`：**每一帧的 `pkt_pts_time` 都是同一个值**（0.041667）。
那个自制容器拆出来的时候**没有时间轴** ⇒ 播放器只能自己猜 ⇒
读者看到的「**后边太快、抽风、和不连贯、和下一轮接不上**」。

重建命令（规整时间轴 + **正放倒放来回**，循环点天然无缝）：

```bash
ffmpeg -y -fflags +genpts -r 24 -i mineral-zinc.mp4 \
  -filter_complex "[0:v]setpts=N/(24*TB),split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[v]" \
  -map "[v]" -an -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart mineral-zinc-loop.mp4
```

### ⚠️ 白底是**运行时**抠的，不是转出来的

本机 ffmpeg 9.0.2 **编不出带 alpha 的 VP8/VP9 webm**
（`-pix_fmt yuva420p` 照收，出来的流 `pix_fmt` 仍是 `yuv420p`，试了三轮）。
动图 webp 能带 alpha，但**没有 `playbackRate`** —— 那个一换就丢了"视频跟着语速变速"。
⇒ 大球那边是 `src/ui/vkey.js` 一帧一次 WebGL 抠（`<video>` 继续放，只是藏起来当纹理源）；
Pet 那边不需要变速，所以用动图 webp：

```bash
ffmpeg -y -i mineral-zinc-loop.mp4 \
  -vf "format=rgba,colorkey=0xfdfdfd:0.15:0.08,fps=20,scale=208:208" \
  -c:v libwebp_anim -loop 0 -q:v 72 -pix_fmt yuva420p mineral-zinc-mini.webp
```

阈值 0.15 的依据：背景 (253,253,253) 到白色的距离 ≈ 0，
而标本最亮处 (230,228,222) ≈ 0.19 —— 卡在中间那道空档里，
所以银那块最亮的矿脉**不会被挖出洞**。
