# Online Search 检索信源

普通热度发现会向子进程传入总预算（外层超时的 75%，最多 90 秒）和单适配器最多 10 秒超时。
runtime 的版本/catalog 查询、bridge-bootstrap 与适配器都受同一个剩余预算限制；启动 bridge 前也检查预算与早停条件。
父进程对子进程设置递减超时，子进程为输出保留最多 250ms（不超过其预算的 5%）。耗尽后保留已完成候选，
未调度来源标记为 `skipped_total_budget`，结果为 `status=partial`、`stopReason=budget_exhausted`，不是登录或桥接故障。

### hot-discovery runtime 与部分结果诊断

Runner 自动在本会话 `.collection-inputs/` 中管理运行级 runtime 缓存和逐来源原子快照，不需要根 Agent 手工传内部路径。
同一 `public-discover` 的各波共享缓存；`public-collect` 使用相同 run ID 跨发现调用复用。
缓存最多有效 5 分钟，并校验 schema、run ID、适配器声明指纹、本地 byCLI 可执行文件/包身份及 catalog 字段。
失效、损坏、版本未知或无法确认可执行文件身份时重新读取 runtime，来源与排序保持原逻辑。缓存不包含认证状态，
不复用 bridge readiness，不跨 run 共享。失效回退本身不触发来源重试。

诊断读取顺序：

1. 查看 `channels.hotDiscovery.status`：`partial` 表示发现未完整结束，候选可继续验证，但不能称为全部来源已覆盖。
2. `channels.hotDiscovery.timing.runtimeMs/bridgeMs` 是实际准备耗时；单波 `runtimeCacheHit` 或合并波次的 `runtimeCacheHits` 表示 runtime 复用，不表示登录有效。
3. 子进程失败时只读取匹配 run、wave 和请求指纹的快照。`recoveredFromCheckpoint=true` 表示恢复了部分结果；`exitCode/timedOut` 保留进程故障事实，原始 hot 快照的 `processDiagnostic` 提供对应诊断。没有匹配快照时按原有通道失败处理。
4. `stopReason=requires_user_action` 优先于超时原因；后续 hot 波次停止。`public-collect` 以 `DISCOVERY_REQUIRES_USER_ACTION` 暂停，保留已发现候选，但当前发现预约仍未完成，不再启动正文 probe 或 fallback query。人工处理后用原 run ID `--resume` 重试同一查询、通道和未完成来源；hot 保留原 wave ID/cursor，重放已结束来源的证据，不重复执行已完成来源，也不永久重放旧挑战。恢复不会重建已接受的来源计划。
5. 发现阶段的 `--skip` 跳过当前受阻单元：online 跳过当前通道；hot 跳过 checkpoint 标识的受阻来源，继续同波其他未执行来源。已授权候选仍进入原正文验证流程。无效跳过在清除暂停前拒绝；它不会增加发现轮数、补充授权或更换备用查询。普通正文 probe 的跳过仍须先清理该尝试拥有的浏览器 session；清理失败保留暂停和剩余预算，后续可重试。
6. 已恢复部分证据的 hot 基础设施中断使 `public-collect` 进入 `infrastructure-blocked`；只有显式 `--resume` / `--skip` 才继续未完成来源。普通快照重放不会自动重试中断。整个 run 与单个 wave 的剩余预算均递减，恢复不会重置预算；人工暂停等待时间不计入运行预算，清理耗时照常扣除。预算耗尽仍按原 partial 规则停止。

runtime 缓存、预算与恢复使用既有确定性规则。逐来源快照只是发现证据，不是全文验证或完整覆盖证明。
尚未运行联网提速基准。

`online-search` 是知识采集技能的公共网页检索通道（由统一路由层 [agent-reach.md](agent-reach.md) 的公共工作流使用）。
它并发调用当前已配置的腾讯联网搜索 API（WSA）和 Search1API，并合并成功 provider 的 URL 命中证据。
两者均未配置或均发生通道级故障时，online-search 通道失败，后续仍由既有 hot-discovery 逻辑补充候选。
合法空结果不得改写为基础设施故障。**本通道只负责发现 URL，不得直接抓取网页；取内容一律委派来源执行器（公共网页 `bycli`）。**

WSA 从运行环境读取 `TENCENTCLOUD_SECRET_ID` 和 `TENCENTCLOUD_SECRET_KEY`；两者齐全时自动启用，
`TENCENT_WSA_ENABLED=false` 可显式关闭。凭据不得出现在命令参数、快照、会话状态或日志中。

Search1API 从运行环境读取 `SEARCH1API_API_KEY`，可用 `SEARCH1API_ENABLED=false` 显式关闭，
`SEARCH1API_BASE_URL` 仅用于受控端点覆盖。凭据不得出现在命令参数、快照、会话状态或日志中。

Tencent WSA SDK 是可选运行依赖。部署未提供 `tencentcloud-sdk-nodejs` 时，WSA 返回
`WSA_SDK_UNAVAILABLE`，随后继续使用 Search1API；Agent 不在采集过程中安装依赖。

新发现使用请求中的查询、分类、语言、时间范围和来源约束，候选过滤与排序使用既有确定性规则。

`public-collect` 的 online 通道在执行前把有效查询、分类、语言、时间范围和来源偏好保存到 `publicCollectRun.onlineDiscoveryExecution`，绑定运行 ID、发现轮次、原始请求与主题/来源授权。挑战或基础设施中断后显式 `--resume` 使用同一已接受请求，不重建该未完成单元。恢复时重新校验绑定身份与参数范围；不匹配则停止执行。新一轮发现不会复用旧执行参数。

## 确定性采集与恢复

- **来源顺序**：新发现使用既有 generic 分支或中文文章 profile 的自然顺序，遵守 category、general 兜底、tiers 与显式来源约束。运行时 catalog、参数和登录检查仍由 hot runner 执行，不把声明等同于可用性。
- **历史来源计划**：已有 `publicCollectRun.hotSourcePlan` 保存与 run、查询、声明及约束绑定的计划、固定 wave IDs 和 cursor。恢复时先校验已接受的计划；校验通过后沿用其剩余顺序与进度，不从头执行。校验失败时不信任旧 ID，回到既有 generic/profile 分支。每波候选与 cursor 一起回写，已保存的匹配 wave 快照在重放时先消费，不重复执行已结束来源。每波之后 `public-collect` 验证候选正文，未达到唯一全文数量才继续；门禁或 partial 停止后续波次，数量、总预算、两轮上限仍由本地状态机控制。新发现不创建模型来源计划；独立 `public-discover` 只按候选数早停，不能声称交付全文完成。
- **候选与正文**：候选保持本地分类和排序，用户直链、已有 `probePriority` 与授权约束优先。重复正文由既有指纹规则处理；标题、正文结构、主题与全文要求仍由本地验证规则判定。
- **第二轮查询**：使用已预约的原始 `fallbackQuery`，不自由改写主题，不增加第三轮；恢复时保持已预约的查询。
- **跨工作流**：`unified-search` 使用 `mergeUnifiedCandidates` 的关键词排序并完整保留候选与来源记录。云盘、IMA、钉钉目录与站点队列遵循既有遍历顺序、页数/深度/条数限制和授权边界。研究 follow-up 保持登记顺序；上下文超出词数预算时按既有规则裁剪，引用与分支记录保持不变。

效率验收应固定任务和来源环境，比较首篇交付耗时、完成 N 篇耗时、抓取次数/交付篇数及最终完成率。离线夹具不代表真实公网耗时已改善。

## knowledge-collection 调用方式

```bash
node scripts/knowledge-collection.mjs public-discover --session-dir <会话目录> --query "查询词" \
  [--category <类别>] [--language zh-CN] [--pageno 1] [--max-results N] [--timeout 60] \
  [--tiers 1,2,3] [--limit N]
```

不带 `--requested-count` 时，该命令在 online-search 检索时并行运行 `hot_discovery`，并把 category 传为热度发现维度；
`hot_discovery` 会额外补充 `general`。带 `--requested-count N` 时采用自适应路径：先运行 online-search，并按 URL、标题与摘要把候选确定性分类为
`article`、`weak` 或 `reject`。中文文章 profile 会并发启动 online-search 与限定来源的 `hot_discovery`，共享 60 秒软预算和 90 秒硬上限；
停止阈值为 `max(N*3, 5)`，且至少尝试前三个运行时可用来源。已有且校验通过的历史来源计划按其保存的波次继续执行。其他 requested-count 请求保持先 online-search、候选不足再运行 hot-discovery 的行为。任一逻辑通道失败时保留另一通道的快照与候选，
只有 online-search 与 hot-discovery 均失败才判定本次发现失败。命令输出的 `candidateQuality`、`pageTypeReasons` 和 `timing` 是候选选择与阶段耗时的权威诊断。
合并输出中的 `searxngTop`、`--searxng-file` 等名称属于历史兼容契约，现在承载统一
online-search 结果，不表示镜像中仍包含 SearXNG CLI。

## 检索源分工（与内置路由层）

- **时间敏感**（周报/新闻/最新动态）：优先 `online-search --category news|general --time-range week|day`；
- **学术/标准**：优先 `online-search --category science`（不带 time-range）；
- **英文技术/代码**：优先内置路由层的 Exa（擅长英文技术文档与代码上下文）与 `gh`（搜 GitHub）；
- **通用发现**：使用 `public-discover`，它会并行运行 online-search 与 hot-discovery 并生成合并快照；
- **取内容**：一律委派来源执行器，通用公共网页按 [agent-reach.md](agent-reach.md) → `acquire-web` → `materialize-web`；不得手工重定向 stdout 或构造 payload。
