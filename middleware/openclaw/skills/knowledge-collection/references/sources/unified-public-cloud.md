# 公共互联网与云盘统一搜索

V2 统一入口是 `unified-search`：默认并行执行公共互联网发现和云盘 metadata 检索。公共侧仍使用既有 WSA、SearXNG 和 `hot_discovery` 链路；云盘侧只使用已授权的 `cloudDiscoveryScope`。

云盘授权范围来自 `init --cloud-discovery-scope`，或由 Agent 将可信 `project-context basic` 返回的 `cloudResourceId` 传给 `--cloud-resource-id`。统一搜索会把后者派生出的实际 `cloudDiscoveryScope` 保存回主会话，供随后同会话云盘物化使用。如果没有可信资源 ID，云盘状态为 `unavailable`，公共搜索仍继续。多个用户地址必须分别解析成资源 ID 与目录前缀，不得用另一个资源 ID 代替。

候选统一归一化、按查询意图评分、同源去重、跨源保留来源记录后写入主会话 inventory。选择候选后运行 `unified-materialize --item-ids`：公共候选走 `acquire-web` 与 `materialize-web`；专用 materializer 返回完整正文载荷后，该命令会立即调用 `collect` 登记 canonical 正文。云盘候选走 cloud adapter。选择的 item ID 先按当前 inventory、来源范围和任务目标验证，再以 `task.selectedDelivery` 累积保存；后续调用不会取消之前选中但失败的条目。inventory 和来源诊断始终完整保留；只有全部已选条目达到要求的正文粒度，且没有已知来源失败或其他原有门禁缺口时，`status.collection.deliveryComplete` 才能为 true。`status.downstreamInput.files` 与 `publish` 只交付已选且验证通过的 Markdown。未选择任何条目的旧会话继续沿用原有完成规则。

来源状态必须可观察：一侧失败不伪装成整体成功，`sourceMetadata.sources` 分别记录 `complete`、`failed` 或 `unavailable` 及错误码。统一排序只决定展示和选择顺序，不绕过任一来源自己的授权校验。

云盘物化失败后可在原会话再次运行 `unified-materialize --item-ids`。云盘投影与结果记录保留 `source=cloud-knowledge`；兼容已有仅保留 `sourceSkill=project-cloud-knowledge` 的失败记录，来源冲突或越出原资源/目录授权范围的条目在保存选择和执行下载前拒绝。重复选择已成功的云盘条目不会重新下载；失败条目重试成功后，交付仍包含此前累积选中的有效正文。
