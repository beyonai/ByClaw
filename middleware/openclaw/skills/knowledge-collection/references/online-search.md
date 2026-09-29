# Online Search 检索信源（可选 WSA/Search1API、SearXNG 降级）

部署时必须在沙箱镜像中安装 SearXNG；仅同步技能文件不会安装 Python 运行时。
实际使用的 DSH 镜像由 `byclaw-harness/Dockerfile` 构建；其 `scripts/install-search-runtime.sh` 安装固定版本及约束依赖，并在构建时检查普通用户能运行 `searxng-cli`。已有沙箱需更新该镜像以获得降级通道。
安装后以 Agent 用户通过 `online-search` 验证实际查询；`--list-engines` 只验证运行时加载，不证明联网搜索成功。

普通热度发现会向子进程传入总预算（外层超时的 75%，最多 90 秒）和单适配器最多 10 秒超时。
runtime 的版本/catalog 查询、bridge-bootstrap 与适配器都受同一个剩余预算限制；启动 bridge 前也检查预算与早停条件。
父进程对子进程设置递减超时，子进程为输出保留最多 250ms（不超过其预算的 5%）。耗尽后保留已完成候选，
未调度来源标记为 `skipped_total_budget`，结果为 `status=partial`、`stopReason=budget_exhausted`，不是登录或桥接故障。
Jev 的 HTTP 故障集成测试位于 `scripts/jev/http-integration.test.mjs`：隔离 HTTP 服务注入 401/403/402/429/500/503 和响应体超时，验证规划和排序回退；它不表示真实服务端曾发生限流。

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
4. `stopReason=requires_user_action` 优先于超时原因；后续 hot 波次停止。`public-collect` 以 `DISCOVERY_REQUIRES_USER_ACTION` 暂停，保留已发现候选，但当前发现预约仍未完成，不再启动正文 probe 或 fallback query。人工处理后用原 run ID `--resume` 重试同一查询、通道和未完成来源；hot 保留原 wave ID/cursor，重放已结束来源的证据，不重复执行已完成来源，也不永久重放旧挑战。恢复过程中关闭 Jev 不会重建已接受的来源计划。
5. 发现阶段的 `--skip` 跳过当前受阻单元：online 跳过当前通道；hot 跳过 checkpoint 标识的受阻来源，继续同波其他未执行来源。已授权候选仍进入原正文验证流程。无效跳过在清除暂停前拒绝；它不会增加发现轮数、补充授权或更换备用查询。普通正文 probe 的跳过仍须先清理该尝试拥有的浏览器 session；清理失败保留暂停和剩余预算，后续可重试。
6. 已恢复部分证据的 hot 基础设施中断使 `public-collect` 进入 `infrastructure-blocked`；只有显式 `--resume` / `--skip` 才继续未完成来源。普通快照重放不会自动重试中断。整个 run 与单个 wave 的剩余预算均递减，恢复不会重置预算；人工暂停等待时间不计入运行预算，清理耗时照常扣除。预算耗尽仍按原 partial 规则停止。

这些基础优化不依赖 Jev；Jev 无效或失败时仍使用现有来源选择和排序。有效来源计划可以使用下面的有界波次调度；
逐来源快照只是发现证据，不是全文验证或完整覆盖证明。尚未运行联网提速基准。

`online-search` 是知识采集技能的公共网页检索通道（由统一路由层 [agent-reach.md](agent-reach.md) 的公共工作流使用）。
它并发调用当前已配置的腾讯联网搜索 API（WSA）和 Search1API；两者均未配置或均发生通道级故障时，
降级到 OpenClaw 镜像内置的 `searxng-cli`。合法空结果不得改写为基础设施故障，后续仍由既有
hot-discovery 逻辑补充候选。**本通道只负责发现 URL，不得直接抓取网页；取内容一律委派来源执行器（公共网页 `bycli`）。**

WSA 从运行环境读取 `TENCENTCLOUD_SECRET_ID` 和 `TENCENTCLOUD_SECRET_KEY`；两者齐全时自动启用，
`TENCENT_WSA_ENABLED=false` 可强制使用 SearXNG。凭据不得出现在命令参数、快照、会话状态或日志中。

Search1API 从运行环境读取 `SEARCH1API_API_KEY`，可用 `SEARCH1API_ENABLED=false` 显式关闭，
`SEARCH1API_BASE_URL` 仅用于受控端点覆盖。TypeSafe Jev 从 `TYPESAFE_API_KEY` 读取凭据，并支持
`TYPESAFE_MODEL` 可选，缺省使用 `jev-latest`；有 `TYPESAFE_API_KEY` 时启用，`TYPESAFE_ENABLED=false`（或 `0`、`off`）可显式关闭，单次调用上限固定为 10 秒。规划与排序各自最多使用剩余发现预算的 10%（且不超过 10 秒），排序的全部批次共享该预算，并受 `public-collect` 总剩余预算约束。凭据缺失、预算耗尽或调用失败时，规划和排序保持现有逻辑；
诊断只记录能力状态，不记录凭据。Jev 只提供规划与排序证据，不能授权 URL，也不能充当正文或 full-text evidence。

Tencent WSA SDK 是可选运行依赖。部署未提供 `tencentcloud-sdk-nodejs` 时，WSA 返回
`WSA_SDK_UNAVAILABLE`，随后继续使用 Search1API 或 SearXNG；Agent 不在采集过程中安装依赖。

显式指定的分类和时间范围不会被规划覆盖；改写后的检索词不改变原始发现预约标识，保证结果回写、重试和恢复使用同一工作流身份。排序输入会限制字段长度和来源数量。

`public-collect` 的 online 通道在执行前把有效查询、分类、语言、时间范围和来源偏好保存到 `publicCollectRun.onlineDiscoveryExecution`，绑定运行 ID、发现轮次、原始请求与主题/来源授权。挑战或基础设施中断后显式 `--resume` 使用同一有效请求，即使 Jev 已关闭、不可用或会给出不同建议也不会重规划该未完成单元。恢复时重新校验绑定身份与参数范围；不匹配则停止执行。新一轮发现不会复用旧执行参数，新的规划失败仍遵循原有确定性降级。

## Jev 采集效率策略

- **规划**：只有一个选项的字段不发送选择题；所有字段确定时完全跳过请求。多选字段的 confidence 必须至少为 0.8，否则保留原始规划。`public-collect` 在一次执行内复用相同输入的规划，online/hot 不重复请求。中文文章 profile 允许在既有五个来源中选出优先来源，调整尝试顺序，保留其余来源及原有数量/预算停止条件。
- **交付排序（P0）**：公网发现使用 `ranking.version=2.0`，在同一批请求中获取相关性、全文可能性和免登录可访问性。原相关性排序分乘以 `0.25 + 0.75 × fullText × accessible`，再结合本轮同站点的成功率平滑值及历史耗时调整。分数是排序启发式，不是经校准的成功概率。所有批次成功且分数合法才应用重排。
- **失败反馈（P0）**：每新增至少两次已结束尝试、最近两次均未成功交付且还有多个候选时，批量重排剩余候选。每次最多 2 秒且不超过剩余预算的 5%；用户直链、已有 probePriority 和授权约束优先。`publicCollectRun.scheduling` 保存最近一次决策状态、尝试计数与候选 ID。没有可用 Jev 时保持原顺序。
- **前置近似去重（P1）**：每批最多 40 个候选。以本次前 120 个候选和会话最近 40 个已物化公网条目为比较池，先用标题二元字符集合的 Jaccard 相似度（至少 0.65）筛出最多 40 对，再把跨批次/已采集副本比较并入评分请求。分数至少 0.9 时把次优副本延后，仍保留为备用。超出比较窗口或低相似度副本继续由获取后的正文指纹去重。
- **模糊正文复核（P2）**：仅处理“正文结构足够但缺标题”或“结构已通过、主题状态 unknown”。Jev 只能选择 Markdown 中已有的一级标题或有界正文片段；confidence 至少 0.9，随后重新执行本地结构和主题规则。验证码、错误页、导航页、段落不足、不完整 arXiv、明确主题不匹配均不能覆盖。每次最多 1.5 秒且不超过传入剩余预算的 5%，成功证据写入 `verification.json.semanticReview`。Jev 不生成正文、不签发全文证明。

### P0/P1/P2 扩展（2026-09-23）

- **通用来源波次（P0）**：有 requested-count、非 `all` 时，从声明表按 category（含原有 general 兜底）、tiers 和显式来源约束生成完整合法排列；中文 profile 仍限于原五个来源。已授权的 tier/维度元数据可追加完整排列模板，不能删减来源。Jev 只能选择排列 ID，confidence ≥0.8，预算最多 2 秒且不超过剩余预算 5%。每波最多 3 个来源，所有剩余来源仍在计划中。运行时 catalog/参数/登录检查仍由 hot runner 执行，不把声明等同于可用性。online-only 模式不创建完整来源计划；online-only 或成功创建完整来源计划时，跳过未使用的 `hotSource` 单题。首次完整来源计划失败且中文 profile 仍需热源时，仅补问 `hotSource`，保留先前确定的 query/category/timeRange/source。无效计划直接使用原来的 generic/profile 分支。
- `publicCollectRun.hotSourcePlan` 保存与 run/查询/声明/约束绑定的计划、固定 wave IDs 和 cursor。这是活动工作流状态，不是跨任务推理缓存：恢复时先校验原计划，校验通过后即使 Jev 被关闭、不可用或模型改变，也沿用该计划的剩余顺序与进度，不重新询问或从头执行；新决策仍按失败降级规则处理。校验失败时不信任旧 ID，回到原有发现分支。首次来源列表按实际选定分类生成，包含该分类与 general 的合法来源。每波候选与 cursor 一起回写，已保存的匹配 wave 快照在重放时先消费，不重复执行已结束来源。每波之后 `public-collect` 验证候选正文，未达到唯一全文数量才继续；门禁或 partial 停止后续波次，数量、总预算、两轮上限仍由本地状态机控制。独立 `public-discover` 只按候选数早停，不能声称交付全文完成。
- **故障熔断与复用（P0）**：顶层 Runner 调用链通过内存 run context 共享结果；最多 128 项、60 秒有效，键包含完整 payload、模型和策略。同一运行内并发相同请求共享在途推理，但每个等待者独立遵守自己的取消和超时；完整合法的推理与组件评分才可缓存。缓存命中前仍检查当前 Jev 门控。字段/反馈/模型变化不命中，任一批次失败也不应用部分排序。服务超时、网络错误、HTTP 故障或坏响应结构打开本次调用链的熔断，后续立即降级，不循环重试。新调用链重新检查服务。关闭、缺凭据、私有资料未授权、取消或预算耗尽时不能绕过检查复用结果。低置信度不缓存，单候选不调用排序。
- 共享 Jev 包装层在复用或应用建议前校验每个请求字段：`choice` 必须是题目 `criteria` 中的字符串键，且 `confidence` 是 0 到 1 的有限数值；`noul` 必须是 0 到 1 的有限数值，无需 `confidence`。成功响应缺项、类型错误或越界时统一返回 `TYPESAFE_INVALID_RESPONSE`，并打开本次运行的熔断；部分批量答案不可应用或缓存。合法的低置信度答案以及题目中明确定义的 `unsure` 选项仍按调用者原有降级规则处理，不视为响应损坏。
- **第二轮查询（P1）**：只有已有获取反馈且备用查询保留主题时，选择原 fallbackQuery 或只追加“全文/案例实践”等的固定模板；不自由生成、不改变主题、不增加第三轮。选择失败、缺项或低置信度时使用精确的原 fallbackQuery。已预约的查询在恢复时保持不变。
- **增量证据（P2）**：有已采集文章或显式证据上下文时，在同一排序批次中加入增量价值评分（未覆盖子题、独立来源、反例），不额外发请求；已有研究分支的覆盖/缺失子题也可作为上下文，混合或企业资料需显式启用 `TYPESAFE_ENTERPRISE_ENABLED=true`。最多 40 个已采集标题/来源和各 12 个有界子题。仅以 `0.8 + 0.2 × incrementalValue` 软调分，不剔除候选；任一新增评分无效则整体恢复原顺序。
- **提供商组合实验（P2，默认关闭）**：仅 `JEV_PROVIDER_SELECTION_ENABLED=true` 且两个商业提供商都配置时，才允许选择 WSA、Search1API 或 both；`all` 不启用。选择失败恢复原双路并行。选中提供商通道失败后仍尝试未执行的商业备选，最后保留 SearXNG 降级；合法空结果不触发故障降级。该实验尚无实网 A/B 性能结论。

效率验收应固定任务和来源环境，比较首篇交付耗时、完成 N 篇耗时、抓取次数/交付篇数及最终完成率。离线夹具验证排序和回退，不代表真实公网耗时已改善。

### 跨工作流选择与统一降级

- `unified-search` 在最终合并候选上执行一次统一选择；最终层能够处理数据时，公网和云盘子发现不再重复调用 Jev 排序。公网已有 `ranking` 信息在候选标准化时保留。统一选择失败时，返回原有 `mergeUnifiedCandidates` 的关键词排序，不丢失任何候选。
- 云盘独立 `search` 可在返回元数据候选时推荐优先下载的文件。IMA 元数据检索在列举知识库后、读取库内容前优先排序；钉钉元数据目录遍历在完整处理当前目录分页后，最多进行一次待遍历目录排序。显式 IMA 单库及企业 `all` 跳过。既有页数/深度/条数限制、下载路径和授权不变，模型不可删掉目录或指定新 ID。
- 内部资料（包括混合搜索、企业研究上下文）的模型请求默认关闭。仅 `TYPESAFE_ENTERPRISE_ENABLED=true` 且 Jev 本身可用时允许；启用前由部署方确认内部元数据可发送到 TypeSafe。该设置不改变检索授权。
- `plan` / `branch` 的 `suggestedFollowups` 是已有问题的优先级建议，`researchSelection` 记录是否采用 Jev。问题仍完整保存在原状态，深度、覆盖要求、停止与报告规则继续由原工作流控制。
- `aggregate` 仅在上下文超出词数预算时选择完整原文片段，成功时把全部原文保存在 `research.contextArchive`，引用与分支记录保持不变。失败时使用原有按顺序裁剪逻辑；`contextSelection` 提供诊断。
- `crawl-seed` 在容量准入前对范围内 URL 分组排序；`crawl-next` 对选取式采集的已入队 pending 页面排序，超过 96 个 URL 时按 host/首段路径分组。组内原序保持；97–500 组使用最多两层选择：先用真实组标题粗排稳定分桶，再只细排最高优先级桶，所有其余桶和组仍以完整顺序保留。两层共用最多 2 秒总预算；超过 500 组或任一阶段失败时，精确回退原数组。未入队部分仍记录 over-cap，不消失。全部归档 (`materializationTarget=all`) 跳过模型。状态或 seed 输入文件在请求期间变化时丢弃建议，使用现有逻辑读取当前输入；seed 内部还检查重排前后原始 URL 的完整多重集合相同。
- 普通选择器一次最多处理 96 项、每批 24 项、所有批次总预算最多 2 秒（受外层剩余预算进一步限制），每项必须返回白名单 choice 和至少 0.8 的 confidence。任何一批失败、缺项、非法枚举、低置信度、取消或超时都会丢弃全部部分结果，原数组与原顺序整体回退。超出输入上限时直接走原逻辑。
- `plan` / `branch` / `aggregate` / `crawl-seed` / `crawl-next` 的成功建议可在同一会话的私有权限 sidecar 中短时复用（60 秒）。sidecar 只保存完整会话与输入的哈希、合法索引排列和时间戳，不保存查询、URL、证据或可执行状态；模型、凭据摘要、策略、传输实现或会话内容变化均不命中。每次命中前重新检查配置、隐私授权、取消和预算；隐私退出清空旧建议。文件损坏、过期、权限异常或 I/O 失败时直接运行原建议逻辑，Jev 失败则保持原有回退。该优化不改变会话权威状态、授权、cursor 或完成判定。
- 所有 Jev 调用经 `safe-call.mjs` 隔离：未捕获异常转换成结构化失败，挂起请求在预算到期后中止并降级，错误消息不透传。`TYPESAFE_ENABLED=false` 仍是全局关闭开关；没有凭据时不发网络请求。



## knowledge-collection 调用方式

```bash
node scripts/knowledge-collection.mjs public-discover --session-dir <会话目录> --query "查询词" \
  [--category <类别>] [--language zh-CN] [--pageno 1] [--max-results N] [--timeout 60] \
  [--tiers 1,2,3] [--limit N]
```

不带 `--requested-count` 时，该命令在 online-search 检索时并行运行 `hot_discovery`，并把 category 传为热度发现维度；
`hot_discovery` 会额外补充 `general`。带 `--requested-count N` 时采用自适应路径：先运行 online-search，并按 URL、标题与摘要把候选确定性分类为
`article`、`weak` 或 `reject`。中文文章 profile 会并发启动 online-search 与限定来源的 `hot_discovery`，共享 60 秒软预算和 90 秒硬上限；
停止阈值为 `max(N*3, 5)`，且至少尝试前三个运行时可用来源。这是未启用有效来源计划时的兼容路径；有效计划按上述来源波次执行。其他 requested-count 请求保持先 online-search、候选不足再运行 hot-discovery 的行为。任一逻辑通道失败时保留另一通道的快照与候选，
只有 online-search 与 hot-discovery 均失败才判定本次发现失败。命令输出的 `candidateQuality`、`pageTypeReasons` 和 `timing` 是候选选择与阶段耗时的权威诊断。
直接运行 `searxng-cli` 仅适用于独立调试，不会自动启动热度发现。

- 默认按 `--category` 使用内置直连白名单（`searxng_pack_settings.yml` 的 `cli.default_engines`，120 个直连可用引擎），避免超时拖累；
- 白名单外的海外头部引擎（google/duckduckgo/wikipedia/brave 等）在无代理直连环境下不可用（2026-08-15 复测：50 个跳过引擎 47 个不可用，
  3 个可用者已在白名单），属预期行为，无需逐个重试；
- 输出 stdout 单个 JSON：`results[]`（url/title/content/engine/score）+ `engine_stats`（逐引擎耗时与错误）+ `elapsed_sec`；
- 错误时 stdout 输出 `{"error": "...", "exit_code": 1}`，退出码非 0；单引擎失败不影响主结果。

## 关键参数

| 参数 | 说明 |
|---|---|
| `--category` | general / news / science / it / images / videos / files / social media 等；science 含 arxiv/crossref/pubmed/openalex |
| `--time-range` | day / week / month / year；**仅 baidu/bing/sogou 等支持**；science 引擎不支持（传了会过滤为空） |
| `--engines` | 逗号分隔引擎白名单覆盖；海外引擎在无代理时不可用，勿依赖 |
| `--language` | zh-CN / en / all |
| `--pageno` / `--max-results` | 翻页 / 条数 |

## 检索源分工（与内置路由层）

- **时间敏感**（周报/新闻/最新动态）：优先 `online-search --category news|general --time-range week|day`；
- **学术/标准**：优先 `online-search --category science`（不带 time-range）；
- **英文技术/代码**：优先内置路由层的 Exa（擅长英文技术文档与代码上下文）与 `gh`（搜 GitHub）；
- **通用发现**：使用 `public-discover`，它会并行运行 online-search 与 hot-discovery 并生成合并快照；
- **取内容**：一律委派来源执行器，通用公共网页按 [agent-reach.md](agent-reach.md) → `acquire-web` → `materialize-web`；不得手工重定向 stdout 或构造 payload。

## 实测引擎可用性（2026-08-15 直连探测）

- 白名单内 121 实例：可用且有结果 30 / 可用但 0 结果 71 / 失败 20（timeout×13、KeyError×4、captcha×1、403×1、ConnectError×1）；
- science 全 7 引擎零失败（arxiv/crossref/openalex/pubmed 均命中）——学术检索首选；
- baidu 触发 captcha、pexels 403（上游风控，换词或稍后再试即可）；
- 4 个 KeyError（discuss.python/hackernews/radio browser/pkg.go.dev）为 SearXNG 解析层异常，非网络问题。
