---
name: content-to-outline
description: >
  将任意内容（GitHub URL、微信文章、关键词、博客、研究报告）转化为结构化的 slide-outline.json，
  作为播客视频流水线的「单一真相来源」，同时驱动 pptx-generator（幻灯片视觉内容）和
  podcast-script-generator（播客对话内容），从架构上保证音画一致。
  当用户想要制作播客视频、把内容变成幻灯片+对话脚本、或者提到"先做个大纲"时触发此 skill。
  也适用于已经有 wechat-tech-article 输出想接着做播客视频的场景。
  这是播客视频流水线的第一步，必须在 pptx-generator 和 podcast-script-generator 之前运行。
---

# Content to Slide Outline

这个 skill 将任意内容转化为 `slide-outline.json`——一份同时驱动幻灯片和播客脚本的结构化大纲。

**为什么需要它？**  
如果 PPTX 和播客脚本分别独立生成，它们很容易"聊的"和"显示的"不一致。通过共享同一份大纲：
- `pptx-generator` 从大纲的 `key_points` 构建幻灯片
- `podcast-script-generator` 从大纲的 `speaker_notes` 展开对话
- 两者在同一套 `slide: N` 编号下对齐

一致性由架构保证，不靠人工核对。

---

## Step 1：理解输入内容

根据用户给的内容类型做相应处理：

| 输入类型 | 处理方式 |
|---|---|
| GitHub URL | 克隆或直接 WebFetch README、核心文档，提取技术定位 + 核心亮点 + 架构概览 |
| 微信文章 / Markdown | 解析各章节标题和核心论点，提取数据/案例/结论 |
| URL（博客/论文） | WebFetch 全文，提取论点结构 |
| 关键词 / 主题 | 自行构建内容框架，覆盖该主题的核心问题、现状、争议、洞见 |

重点提取：
- 核心主张或价值（一句话能说清楚的）
- 3-5 个关键主题或论点
- 支撑性数据、案例、对比
- 目标受众和他们最关心的问题

---

## Step 2：规划幻灯片结构

目标：**8-12 张幻灯片，对应 10-15 分钟播客**。

标准结构（灵活调整）：

| 位置 | 类型 | 说明 |
|---|---|---|
| 第 1 张 | `cover` | 吸引人的标题 + 一句话 hook |
| 第 2 张 | `toc` 或 `intro` | 本集要聊的 2-4 个核心问题 |
| 第 3-N-1 张 | `content` | 每张聚焦一个主题，深入不浅尝 |
| 第 N 张 | `summary` | 精华回顾 + 行动建议或引发思考的问题 |

**分配原则：**
- 每个主题独立成张，不要把 3 个话题塞到一张
- 高信息密度主题给 `depth: "long"`，过渡性内容给 `depth: "short"`
- `key_points` 是幻灯片上展示的文字（精炼、可视化）
- `speaker_notes` 是音频里要讨论的角度（深入、有故事、有争议）

`key_points` 和 `speaker_notes` 应该**互补而非重复**：幻灯片展示结论，音频解释为什么。

---

## Step 3：生成 slide-outline.json

严格按此 schema 输出，每个字段都必须填写：

```json
{
  "meta": {
    "topic": "原始主题的一句话概括",
    "suggested_title": "建议的播客标题（具体、有吸引力）",
    "total_slides": 10,
    "estimated_duration_min": 12
  },
  "slides": [
    {
      "slide": 1,
      "type": "cover",
      "title": "幻灯片展示标题",
      "subtitle": "副标题（cover/toc 类型填写，其他留空字符串）",
      "key_points": [],
      "speaker_notes": "开场对话要点：背景、为什么今天要聊这个、听众能从中得到什么",
      "depth": "short"
    },
    {
      "slide": 2,
      "type": "content",
      "title": "主题一：XXX",
      "subtitle": "",
      "key_points": [
        "幻灯片要点1（简洁，可视化）",
        "要点2（数据或关键事实）",
        "要点3（核心洞见或结论）"
      ],
      "speaker_notes": "围绕这张幻灯片，主持人和嘉宾应该展开：具体案例是什么、数据背后的含义、听众可能有的疑问、可以形成的争议点",
      "depth": "medium"
    }
  ]
}
```

### 字段说明

| 字段 | 填写规则 |
|---|---|
| `type` | `cover` / `toc` / `content` / `section` / `summary` 之一 |
| `key_points` | 幻灯片上展示的文字，每条 ≤20 字；`cover`、`toc`、`section` 类型**必须为空数组 `[]`**，内容幻灯片通常 3-5 条 |
| `speaker_notes` | 播客对话提示，要具体到"讨论X案例"、"对比A和B"、"提出Y问题"，不要写"介绍该主题"；`toc` 类型写"快速预告本集结构+让听众建立预期" |
| `depth` | `short`（1-2轮）/ `medium`（3-4轮）/ `long`（5-6轮，必须有对立观点或追问） |
| `subtitle` | 仅 `cover` 和 `toc` 类型使用，其他填空字符串 `""` |

**各类型幻灯片规范：**

| type | key_points | speaker_notes | depth |
|---|---|---|---|
| `cover` | `[]`（空） | 开场钩子：痛点/问题/今天能得到什么 | `short` |
| `toc` | `[]`（空） | 快速预告各段结构，让听众建立预期 | `short` |
| `section` | `[]` 或 1条（章节主题词） | 章节过渡：承上启下，引出下一部分 | `short` |
| `content` | 3-5条精炼要点 | 具体对话角度：案例、争议、对比、追问 | `medium` 或 `long` |
| `summary` | 3-4条核心结论 | 总结洞见 + 开放性问题或行动建议 | `short` 或 `medium` |

---

## Step 4：输出

将 `slide-outline.json` 保存到用户指定位置，或默认保存到：
```
<工作目录>/slide-outline.json
```

输出后，向用户展示大纲摘要（幻灯片列表 + 每张标题 + depth），并确认是否满意，再继续后续步骤。

---

## Step 5：指导用户后续步骤

大纲确认后，告知用户接下来的完整流程：

```
✅ slide-outline.json 已生成

接下来的步骤：

1. 生成幻灯片 (pptx-generator)
   → 将使用 slide-outline.json 中的 key_points 构建幻灯片视觉内容

2. 生成播客脚本 (podcast-script-generator)
   → 将使用 slide-outline.json 中的 speaker_notes 展开对话
   → 每个对话轮次自动标注 "slide": N，与幻灯片一一对应

3. 生成配音 (podcast-tts)
   → 建议使用 --sentence-mode 获得句子级字幕精度

4. 合成视频 (podcast-video-composer)
   → 输入 PPTX + MP3 + script.json + _durations.json → 输出 MP4

⚠️  pptx-generator 和 podcast-script-generator 必须读取同一份 slide-outline.json，
   这是保证幻灯片内容与播客对话一致的关键。
```

---

## 自检清单

输出前确认：
- [ ] 每张幻灯片都有清晰的 `title`
- [ ] `cover`、`toc`、`section` 类型的 `key_points` 是空数组 `[]`
- [ ] `content` 类型的 `key_points` 每条 ≤20 字，是幻灯片展示内容而非完整句子
- [ ] `speaker_notes` 比同张幻灯片的 `key_points` 更长、更具体，不是 `key_points` 的复述
- [ ] `depth: "long"` 的幻灯片，`speaker_notes` 中明确包含对立观点/争议点/可能的反驳
- [ ] `depth` 分配合理：`cover`/`toc`/`section` 为 `short`，核心内容 `medium` 或 `long`，`summary` 为 `short` 或 `medium`
- [ ] 幻灯片总数在 8-12 张之间
- [ ] `total_slides` 与实际 `slides` 数组长度一致
- [ ] `slide` 编号从 1 开始连续递增，无跳号
