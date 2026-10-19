---
title: 'devflow: 基于文件的研发状态流转能力缝'
labels: [kind/feature, ready-for-agent]
date: 2026-08-25
design-doc: assets/dsh-devflow-file-based-design.html
---

# PRD — devflow：基于文件的研发状态流转

## Problem Statement

用户希望用 dsh 承载端到端研发流程（需求 → 设计 → 开发 → 评审 → 验证 → 交付），但 dsh 目前没有任何跨会话、跨 agent 的"任务状态"概念：todo 是会话内的，goal 是单会话单目标的，workflow/Ralph 是一次前台运行。没有一个地方能回答"这张卡现在到哪一步了、谁在做、门禁过了没、谁批准的"。用户还要求状态载体必须是**文件**——人可以直接读改、git 可以携带、CI 与编辑器无需接入任何服务即可参与，同时每次流转都要可审计、可回放。

## Solution

新增一条 capability seam（能力缝）`ctx.devflow`：任务卡是工作区内 `.devflow/` 目录下的文件（`card.md` frontmatter 状态投影 + `journal.jsonl` 追加式权威历史），流转是经 waterfall 门禁管线守卫的原子操作。三类消费者按操作面分工：模型工具承载带意图的语义操作（聊天面）、阶段驱动器把状态变化翻译为按 preset 组合的 agent 派发（自动化面）、Web 聊天页右上角的只读浮层面板展示进度并应答人工审批（interaction 面）。人工审批走 `ctx.interaction` 应答通道（与工具权限确认同道），journal 记 `by: human`，审计链完整。

## User Stories

1. 作为开发者，我想把一个需求写成一张文件形式的任务卡，以便它不依赖任何服务就能被人、git、CI 和 agent 共同读写。
2. 作为开发者，我想让任务卡有明确的阶段（draft / designing / ready / developing / reviewing / testing / done），以便任何时刻都能回答"这件事到哪了"。
3. 作为开发者，我想让每次阶段流转都追加进 journal，以便事后审计是谁、在何时、以什么理由推进或打回了这张卡。
4. 作为开发者，我想让 `card.md` 里的阶段字段只是投影、journal 才是权威，以便投影损坏或被手改时可以从 journal 重建。
5. 作为开发者，我想在聊天里让 agent 列出、查看、认领、推进任务卡，以便研发流程的语义操作留在对话上下文里并自动进入 session log。
6. 作为开发者，我想让 agent 推进卡片前必须通过该边配置的门禁命令（如跑测试），以便"完成"是被验证过的而不是被宣称的。
7. 作为流程管理者，我想在关键边（如 designing→ready、testing→done）上配置人工审批门禁，以便 agent 的产出必须经人签字才能通过。
8. 作为流程管理者，我想让人工审批以 interaction 请求的形式出现、由我在 UI 上点按应答，以便审批不经过被检查的 agent 转译、journal 里签字人是我而不是 agent。
9. 作为开发者，我想让进入 developing 的卡片自动派发给按 preset 组合的开发 agent，以便流程自己往前走而不需要我逐张卡吩咐。
10. 作为流程管理者，我想为不同阶段配置不同的 agent 组合（设计阶段只读工具集、评审阶段独立只读 agent），以便各阶段的权限与人格互相隔离。
11. 作为流程管理者，我想给自动派发配并发上限与轮次预算（复用 goal-round 上限），以便 agent 不会失控空转烧钱。
12. 作为开发者，我想让两个 agent 竞争同一张卡时后到者收到明确拒绝（租约 + revision CAS），以便并发协作不会静默互相覆盖。
13. 作为开发者，我想让评审 agent 打回时附理由并记入 journal，以便开发 agent 下一轮知道要改什么。
14. 作为开发者，我想让任意非终态卡片可以进入 blocked 并保留来源阶段，以便外部依赖解除后恢复到原地而不是从头再来。
15. 作为 Web 用户，我想在聊天页右上角看到一枚常驻胶囊徽标（进行中数量 + 待审批数），以便边聊边掌握流程状态而不被打断。
16. 作为 Web 用户，我想展开右上角浮层看到焦点卡的阶段进度、门禁状态、变更统计与分支，以便不离开会话就了解细节。
17. 作为 Web 用户，我想在待审批项到达时面板自动展开一次、处理完自动收起，以便重要事项主动找我而噪音不常驻。
18. 作为 Web 用户，我想通过「查看全部」进入全量看板（多卡列表、与本会话相关过滤、历史），以便面板保持聚焦而全景仍可达。
19. 作为 Web 用户，我想让面板除审批应答外完全只读，以便我的每个语义操作都发生在 agent 看得见的聊天面里。
20. 作为运维/高级用户，我想有 `/devflow` human command 做确定性干预（强制流转、恢复 blocked、接管过期租约），以便异常处置不消耗模型 turn、不依赖模型转译。
21. 作为开发者，我想让 agent 触发的流转在聊天流里渲染为工具卡，以便会话内痕迹与面板视图同源一致。
22. 作为开发者，我想让流程定义（阶段、边、门禁、审批点）来自 schema 校验的配置，以便按部署裁剪流程且配错即加载失败。
23. 作为插件作者，我想让文件存储只是 `ctx.devflow` 的一种 Provider，以便未来换 GitHub Issues 或 SQLite 时所有 Consumer 一行不改。
24. 作为插件作者，我想让第三方策略插件能挂 transition waterfall 监听器否决流转，以便在不改 devflow 代码的情况下叠加组织级策略。
25. 作为开发者，我想让 headless 运行遇到人工门禁时挂起并把卡片置为 blocked，以便无人值守场景安全停驻而不是绕过审批。
26. 作为开发者，我想让人直接手改文件导致的投影漂移被检测并按 journal 收敛（告警而非崩溃），以便文件的开放性不破坏一致性。
27. 作为开发者，我想让 done 卡片按月归档，以便活跃目录保持小、watch 开销可控。
28. 作为开发者，我想让 journal 出现坏行时 fail loud 而不是静默跳过，以便数据损坏在第一时间暴露。

## Implementation Decisions

- **一条新 seam，三角色齐备**（glossary《capability-seam》定义）：
  - Service Definition `dsh-devflow`：抽象类 `DevflowStore extends Service` 占有 `ctx.devflow`，拥有词汇类型（`DevCard`、`DevStage`、`TransitionRequest/Spec/Result`、`ClaimOwner/Handle`）与 `devflow/*` 事件声明。默认值补全走显式 `resolve(request): Spec`（`dsh-shell` 的 request/spec 拆分是模板）。
  - Service Provider `dsh-devflow-filesystem`：经 `ctx.fs` 能力（而非直接 node:fs）实现读写、watch（防抖 + 轮询降级）、原子替换、journal 追加、租约、revision 校验；watcher 注册为 effect，disposer 关停。
  - Consumers：`dsh-tool-devflow`（模型工具）、`dsh-devflow-gates`（waterfall 门禁监听器）、`dsh-devflow-driver`（阶段驱动）、`dsh-client-ui-devflow`（浏览器面板）。
- **文件模型**：`.devflow/tasks/<seq>-<slug>/` 含 `card.md`（YAML frontmatter 投影 + Markdown 正文）、`journal.jsonl`（追加式权威历史，rev 单调连续）、`claim.json`（O_CREAT|O_EXCL 租约 + 心跳，过期可接管并记 journal）、`artifacts/`（各阶段产物）。目录创建后不改名。`done` 卡按月移入 `archive/`。
- **状态机**：`DevStage` 闭合联合 `draft | designing | ready | developing | reviewing | testing | done`，switch 以 `assertNever` 收尾；`blocked` 为旁路态，journal 保留 `from`，恢复回原阶段。评审/验证可打回 developing。
- **流转执行顺序**（全部在 `DevflowStore.transition()` 内，决策在做出它的操作里强制执行）：revision CAS → `devflow/transition` waterfall（门禁命令经 `ctx.shell`、人工审批经 `ctx.interaction`，任一监听器不调 `next()` 即带理由否决）→ journal 追加（唯一 commit point）→ 投影原子替换（失败仅告警，可重建）→ `devflow/stage-changed` emit + session 事件。通知只在成功之后发布。
- **事件契约**：`devflow/stage-changed` 为 `@mode emit`；`devflow/transition` 为 `@mode waterfall` 单决策事件，短路即否决是设计本身。均以 declaration merging 声明并带 payload JSDoc。
- **操作面三分法**：聊天面 = 模型工具 `devflow_list / show / take / transition / attach_artifact`（带意图的语义操作，自动 model-visible 且入 session log）；interaction 面 = 人工审批应答（面板按钮，与权限确认同通道，journal 记 `by: human`）；命令面 = `/devflow` human command（强制流转、恢复 blocked、接管租约，不产生模型 turn）。面板不拥有任何 devflow mutation 动词。
- **阶段驱动**：`dsh-devflow-driver` 监听 `stage-changed`，按配置将阶段映射到 `{preset, executor}`：designing/reviewing/testing 用一次性 subagent 委派，developing 默认 goal（同会话长目标）、卡片 frontmatter 可 opt-in Ralph。工具集裁剪用 `tools.restrict`（scope 交集过滤）。`maxConcurrentCards` 与轮次上限为必备配置；引用的 preset 不存在则加载即失败。
- **Web 面板**：`dsh-client-ui-devflow` 注册进会话区右上角覆盖层槽位（无合适子槽则按 ui-slots 规则同步声明，declaration = render authorization）；数据经 host 端 `devflow` 投影（`useProjection`，浏览器零领域 store，与 ui-goal 同构）；胶囊/面板为同一组件两个受控状态，披露规则沿用 ui-workflow-run（异常展开一次、完成收起一次、手动选择不被覆盖）；焦点卡选择：待审批 > 本会话在推进 > 最近变更；窄视口退化为底部抽屉。
- **模型可见性**：agent 触发的流转写入 `SessionEventMap`（新事件按 required-on-read 规则声明），聊天流按事件渲染 `generic` 工具卡，`locations` 指向卡片文件；面板与聊天卡同源于 journal。
- **配置与校验**：流程定义（阶段、边、门禁、审批点）与 Provider 参数（root、心跳、watch 防抖/轮询）均为 schemastery 校验的 Config 字段；文件读入按 durable 边界逐行校验，坏 journal 行 fail loud；卡片 id 用 `Branded` 类型。
- **组合**：整套打包为 devflow bundle patch（一个 insert，行 id 可被上层 patch 整行覆盖），叠加于 dsh-base；headless 场景不装 UI 插件，人工门禁挂起 → 卡片 blocked。

## Testing Decisions

- **好测试只断言外部行为**：给定文件系统内容与配置，断言 transition 的返回值、journal 追加的行、投影文件内容、发出的事件与派发请求；不窥探 Provider 私有状态、不 mock ctx.devflow 自己。
- **单测（Definition + Provider）**：状态机全部合法/非法边；revision CAS 冲突双方结局；租约创建/心跳过期/接管；journal 回放重建与坏行 fail loud；投影漂移收敛；waterfall 否决路径（含"绕过工具直接调 transition 同样被拒"——经 executor 测拒绝，非 schema 省略）。
- **HMR 安全**：每个注册贡献按 packages/AGENTS.md 要求做 dispose-fiber-then-observe-removal 测试；watcher 停止、工具与 prompt 节注销。
- **包不变量**（`./invariant`）：journal rev 单调连续、terminal 态无 open claim；装进 runtime-diagnostics 清单。
- **REAL 组合 keyless snapshot**（testing.md 强制）：test-only cordis.yml 经 Loader 启动完整应用，脚本化模型跑一次 take → transition（含一次门禁命令、一次打回），断言转写与工具卡渲染；macOS/Linux 可重放。
- **e2e**：一张卡完整生命周期 draft→done，含人工审批应答与 driver 派发（真实 subagent，DEEPSEEK_API_KEY 缺失自跳过）。
- **SDK 快照同步**：新 SessionEventMap 成员在同一 PR 更新 TS 与 Python SDK expected outputs。
- **先例参照**：dsh-shell/bash-local 的 request/spec 与执行语义测试；dsh-goal 的 event-sourced 状态与投影测试；tool-workflow 的 session 事件不变量（重复 start / 未配对成员拒绝）；ui-goal 的投影消费与 ui-workflow-run 的披露状态测试。

## Out of Scope

- 非文件 Provider（GitHub Issues、SQLite、远端服务）——seam 为其留位，本期不实现。
- 跨仓库/多工作区任务卡；`.devflow/` 是否纳入 git 及分支同步策略（开放问题，另行决策）。
- 全量看板的拖拽流转、甘特/统计视图；看板本期只读列表 + 过滤。
- CI 场景豁免人工门禁的配置形态及其 journal 标注（切片 3 设计时收窄决策）。
- 卡片间依赖关系（blocks/depends-on）与自动排程。
- 通知渠道（邮件、IM）；待审批只在面板与胶囊徽标呈现。

## Further Notes

- 完整设计（含状态机图、数据流图、面板双态样稿、四切片里程碑、风险矩阵）见 [assets/dsh-devflow-file-based-design.html](assets/dsh-devflow-file-based-design.html)。
- 实施按四个可独立合并的 PR 切片：① seam + 文件 Provider ② 模型工具 + session 事件 ③ 门禁 + 驱动 ④ Web 面板 + `/devflow` + 收尾。每个非平凡切片按仓库规矩附 Agent Note 与双语 README；GUI 行为变更附真实服务录制的 GIF。
- 风险与对策（并发覆盖、agent 失控、watch 不可靠、手改漂移、门禁被篡改、分支切换跳变）已在设计文档 §09 编目，实施时逐条落为测试用例。
