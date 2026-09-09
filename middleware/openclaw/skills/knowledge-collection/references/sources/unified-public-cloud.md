# 公共互联网与云盘统一搜索

V2 统一入口是 `unified-search`：默认并行执行公共互联网发现和云盘 metadata 检索。公共侧仍使用既有 WSA、SearXNG 和 `hot_discovery` 链路；云盘侧只使用已授权的 `cloudDiscoveryScope`。

云盘授权范围来自 `init --cloud-discovery-scope`，或由 Agent 将可信 `project-context basic` 返回的 `cloudResourceId` 传给 `--cloud-resource-id`。如果没有可信资源 ID，云盘状态为 `unavailable`，公共搜索仍继续。多个用户地址必须分别解析成资源 ID 与目录前缀，不得用另一个资源 ID 代替。

候选统一归一化、按查询意图评分、同源去重、跨源保留来源记录后写入主会话 inventory。选择候选后运行 `unified-materialize --item-ids`：公共候选走 `acquire-web` 与 `materialize-web`，云盘候选走 cloud adapter。成功条目保持稳定物化路径；pending/failed 条目允许重试，失败条目不会从 inventory 删除。全部物化完成后使用既有 `status` 和 `publish`。

来源状态必须可观察：一侧失败不伪装成整体成功，`sourceMetadata.sources` 分别记录 `complete`、`failed` 或 `unavailable` 及错误码。统一排序只决定展示和选择顺序，不绕过任一来源自己的授权校验。
