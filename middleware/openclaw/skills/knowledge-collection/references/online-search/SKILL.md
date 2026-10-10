---
name: online-search
description: 公共网页 URL 发现通道；用于腾讯 WSA、Search1API 与 hot-discovery 的受控检索场景。
---

# Online Search

> `knowledge-collection public-discover` 必须通过统一 online-search provider 调用本能力。
> 已配置的腾讯 WSA 与 Search1API 并发执行并合并结果；合法空结果不得改写为基础设施故障，
> 后续仍由 hot-discovery 判断是否补充候选。

本技能只负责发现 URL。正文获取一律委派来源执行器，公共网页使用 `bycli`。禁止把技能名当作
平台工具名直接调用；公共互联网采集应使用 `knowledge-collection public-discover`。

## Provider

统一 provider 并发调用以下来源：

| Provider | 启用条件 | 显式关闭 |
|---|---|---|
| 腾讯 WSA | `TENCENTCLOUD_SECRET_ID` 与 `TENCENTCLOUD_SECRET_KEY` 均存在 | `TENCENT_WSA_ENABLED=false` |
| Search1API | `SEARCH1API_API_KEY` 存在 | `SEARCH1API_ENABLED=false` |

每个 provider 的超时不超过 15 秒。任一 provider 成功即保留其结果；两者均成功时按规范化 URL
去重并记录 provider agreement。两者均未配置或均失败时，online-search 通道失败，
`public-discover` 仍可继续使用 hot-discovery 的结果。

凭据不得出现在命令参数、快照、会话状态、日志或错误详情中。采集过程中不得安装缺失的 SDK。

## 调用

```bash
node scripts/knowledge-collection.mjs public-discover \
  --session-dir <会话目录> \
  --query "AI agent framework" \
  --category it \
  --language zh-CN \
  --max-results 20
```

主要参数：

| 参数 | 说明 | 默认 |
|---|---|---|
| `--query` | 搜索关键词，必填 | - |
| `--category` | 搜索类别，如 `general`、`news`、`science`、`it` | `general` |
| `--language` | 语言，如 `zh-CN`、`en`、`all` | `all` |
| `--time-range` | `day`、`week`、`month`、`year` | 不限 |
| `--pageno` | 结果页码 | `1` |
| `--max-results` | 最多返回条数 | `20` |
| `--requested-count` | 期望的合格文章数量；不足时触发 hot-discovery | 未设置 |
| `--timeout` | public-discover 外层超时，秒 | `60` |

检索使用请求中的查询、分类和时间范围；候选过滤与排序使用既有确定性规则。

## 结果契约

统一结果至少包含：

```json
{
  "query": "AI agent framework",
  "provider": "multi",
  "providers": ["tencent-wsa", "search1api"],
  "fallbackUsed": false,
  "providerDiagnostics": {
    "tencentWsa": {"status": "success", "durationMs": 120, "resultCount": 10},
    "search1api": {"status": "success", "durationMs": 180, "resultCount": 8}
  },
  "results": []
}
```

`providerDiagnostics` 只记录能力状态、错误类别、耗时和结果数量，不记录凭据或未经清洗的异常文本。
搜索结果只用于发现和授权 URL，不能充当正文或全文证据。

## Hot Discovery

online-search 提供相关性候选，hot-discovery 补充平台原生热度字段。需要公共互联网发现时由
`public-discover` 统一编排，不手工拆分两个通道。任一逻辑通道失败时保留另一通道的快照与候选；
只有 online-search 与 hot-discovery 均失败才判定本次发现失败。

合并器中的 `searxngTop`、`--searxng-file` 等名称是历史快照契约，为兼容已有会话暂时保留；
它们现在承载统一 online-search 结果，不表示运行时仍安装或调用 SearXNG。

调用 hot-discovery 前必须完整阅读
[references/hot_discovery/SKILL.md](references/hot_discovery/SKILL.md)。
