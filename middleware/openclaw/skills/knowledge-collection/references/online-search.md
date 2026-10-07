# Online Search 检索信源

`online-search` 是知识采集技能的公共网页检索通道。它并发调用当前已配置的腾讯联网搜索 API
（WSA）和 Search1API，合并成功 provider 的 URL 命中证据。合法空结果不是基础设施故障，
后续仍由 hot-discovery 判断是否补充候选。本通道只负责发现 URL；正文获取一律委派来源执行器。

## 配置

- WSA：读取 `TENCENTCLOUD_SECRET_ID` 和 `TENCENTCLOUD_SECRET_KEY`；
  `TENCENT_WSA_ENABLED=false` 可显式关闭。
- Search1API：读取 `SEARCH1API_API_KEY`；`SEARCH1API_ENABLED=false` 可显式关闭；
  `SEARCH1API_BASE_URL` 仅用于受控端点覆盖。
- TypeSafe Jev：读取 `TYPESAFE_API_KEY`，可用 `TYPESAFE_MODEL` 指定模型，默认 `jev-latest`。

凭据不得出现在命令参数、快照、会话状态或日志中。Tencent WSA SDK 缺失时返回
`WSA_SDK_UNAVAILABLE`；采集过程中不安装依赖。两个 provider 均未配置或均失败时，online-search
通道失败，但 `public-discover` 仍可保留 hot-discovery 的有效结果。

## 调用

```bash
node scripts/knowledge-collection.mjs public-discover \
  --session-dir <会话目录> \
  --query "查询词" \
  [--category <类别>] [--language zh-CN] [--pageno 1] [--max-results N] [--timeout 60] \
  [--tiers 1,2,3] [--limit N]
```

不带 `--requested-count` 时，online-search 与 hot-discovery 并行运行。带 `--requested-count N` 时，
先按 URL、标题和摘要把候选分类为 `article`、`weak` 或 `reject`，候选不足时再运行
hot-discovery。中文文章 profile 会并发启动两个通道，共享 60 秒软预算和 90 秒硬上限。

显式分类和时间范围不会被 Jev 覆盖；Jev 只提供规划与排序证据，不能授权 URL，也不能充当正文。
命令输出中的 `providerDiagnostics`、`candidateQuality`、`pageTypeReasons` 和 `timing` 是诊断依据。

合并输出中的 `searxngTop`、`--searxng-file` 等名称属于历史兼容契约，现在承载统一
online-search 结果，不表示镜像中仍包含 SearXNG CLI。
