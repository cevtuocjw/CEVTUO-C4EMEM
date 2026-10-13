# C4emem

**Cevtuo C4emem** —— 本地优先的个人知识库助手。读你自己写下的东西（Notion），而不是要你为它重新记录。

> **Plaud 帮你记住你说过什么。Khoj 帮你查到你写下了什么。**
> **C4emem 做的，是在你还没问的时候，就告诉你你已经知道的。**

当前进度：**P0 知识核心**（同步 → 检索 → 带引用的回答）。语音、主动推送、多端在后面。

---

## 形态说明

不是网页，也不是纯 macOS 应用，而是：**本地常驻核心服务 + 薄客户端**。

- **核心**（本仓库）只监听 `127.0.0.1`，永远不上云
- macOS 菜单栏应用、Android、Galaxy 眼镜将来都只是「壳」，共用同一个核心
- 为什么不是网页：核心差异化是**主动推送**，它必须能看见窗口焦点、日历、剪贴板 —— 浏览器拿不到这些系统事件

**阿里云不需要。** P0/P1 纯本地；服务器只在以后「人在外面、手机要连家里的大脑」时才可能用到。

---

## 快速开始

```bash
# 1. 配置
cp c4emem.config.example.json c4emem.config.json
cp .env.example .env          # 填 NOTION_TOKEN

# 2. 自检
bun run src/cli.ts doctor

# 3. 建库（先跑一个源，快）
bun run src/cli.ts sync --only learn

# 4. 问它
bun run src/cli.ts search "笔记里有什么关于 X 的"
```

`search` **不需要任何 API key** —— 嵌入是本地跑的。只有 `ask` 需要 LLM key。

---

## 命令

| 命令 | 作用 |
|---|---|
| `c4emem sync [--only learn] [--force]` | 拉 Notion → 切块 → 嵌入 → 落本地库（按 hash 增量） |
| `c4emem search "问题" [--space learn] [-n 8]` | 混合检索，给带出处的片段。**零 key** |
| `c4emem ask "问题"` | 检索 + LLM 生成带引用的答案 |
| `c4emem stats` | 库里有多少段/块/向量 |
| `c4emem doctor` | 自检配置、密钥、网络、模型 |

---

## 架构

```
Notion ──▶ extract（按 @日期 切段，全量）
              │
              ▼
          chunk（420 字，80 重叠，带来源+日期头）
              │
      ┌───────┴────────┐
      ▼                ▼
  本地嵌入          FTS5 trigram
 (bge-small-zh)     (中文按字切)
      │                │
      └───────┬────────┘
              ▼
        RRF 融合检索 ──▶ 检索结果 / LLM 回答
```

### 几个刻意的选择

| 选择 | 为什么 |
|---|---|
| **bun:sqlite** | Bun 内置，不装任何东西；WAL 模式 |
| **FTS5 用 `trigram`** | `unicode61` 会把整句中文当一个 token，等于搜不到中文 |
| **向量暴力余弦** | 几千条 chunk 下几毫秒。引 ANN 索引是先把事情搞复杂，等过 5 万条再说 |
| **RRF 融合，不用分数加权** | 余弦和 BM25 量纲不同，加权系数永远调不对；RRF 只看排名 |
| **嵌入走本地** | 零 API key、零成本、数据不出本机 |
| **只在 `ask` 时注入 Top-K** | 绝不把整个知识库塞进 prompt —— token 爆炸的唯一来源 |

---

## 配置

一切可换的东西都在 `c4emem.config.json`：知识源、嵌入模型、LLM 端点、分块大小。

**密钥永远不在配置里** —— 配置只写「去哪个环境变量拿」（`apiKeyEnv`）。所以配置文件可以进仓库、可以给别人用，**他们接自己的 key 就能跑**。

### 国内必读

- `huggingface.co` **打不通**（实测 15s 超时）。配置里 `embedding.hfEndpoint` 默认已设成 `https://hf-mirror.com`
- ⚠️ transformers.js **不认 `HF_ENDPOINT` 环境变量**，只能从它自己的 `env.remoteHost` 改 —— 这件事已经在 `src/embed/index.ts` 里做了

### 换成 API 嵌入

```json
"embedding": {
  "provider": "openai-compatible",
  "baseUrl": "https://api.siliconflow.cn/v1",
  "model": "BAAI/bge-m3",
  "dims": 1024,
  "apiKeyEnv": "C4EMEM_EMBED_API_KEY"
}
```
⚠️ 换模型 = 维度变了 = 旧向量作废。库会检测到并**要求你 `sync --force`**，而不是算出一堆垃圾相似度。

---

## 复用已有的东西

不想把 Notion token 抄第二份？在配置里指过去：

```json
"envFiles": ["/Users/cjw/Documents/CEVTUO-Z/.env"]
```

C4emem 会读它，且**不覆盖**已存在的环境变量。

---

## 路线

- **P0 知识核心** ← 现在
- P1 流式低延迟语音 RAG（Stream RAG）+ 知识时间机器 + 单词灵感 + 邮件源
- P2 主动推送（三层：零 token 监测 / 小模型闸门 / 大模型生成）
- P3 macOS 菜单栏应用 + Android
- P4 Galaxy 眼镜（Android XR，音频眼镜）

---

## 许可

自有项目。核心依赖：`@huggingface/transformers`（Apache-2.0）。
