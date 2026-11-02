# Agent Note: spec 生命周期从门禁边迁到会话

Status: implemented

## Problem

spec 缝的内容机制——anchor、三值裁决、由 [anchor 模型 Agent Note](2026-09-02-devflow-spec-anchor-model.zh.md) 拥有的结构化写入契约——是健全的，但*生命周期*挂错了宿主。入口（`spec-refs`）、出口（`spec-delta`）与健康期望（`specScopes`）全都吊在 artifact-gate 的边配置上，而 artifact gate 在 bundle 里默认是关的：什么都不配的部署得到的不是一个更弱的 spec 生命周期，而是没有，且无声无息。何况 spec 的相关性是按文件、不是按卡片——多数卡根本不碰任何挂锚文件，边契约分辨不出这两种卡。

推荐的入口配置就其自身标准而言也是有缺陷的。把 `spec-refs` 配在 `draft->designing` 只约束标准路线：`express` 与 `emergency` 卡经 `draft->developing` 进入工作，根本不经过那条边——于是恰恰是跳过设计的那些卡（最可能什么都跳过的卡）被豁免了「声明自己触及什么」的义务，而且没有任何地方报告这次豁免。

## Decision

**默认生命周期挂在会话与代码事件上，落在新包 [`dsh-devflow-spec-sentinel`](../../../../packages/devflow-spec-sentinel/README.zh.md) 里；产物路线保留为 opt-in 的纸面记录。** 三个宿主取代那条边：

- `tools/result` 收集一个 turn 的一方 `write`/`edit` 落下的文件路径（按 agent 归属、以 `WeakMap` 为键；`read` 的路径只喂索引的 scope 层）。与一方工具名及 `file_path` 参数形状的耦合是明说并接受的——与 `dsh-devflow-iron-rules` 的脏位门禁承担的是同一种耦合。
- `agent/turn-stopping` 把本 turn 的写集与各文档的锚文件求交（经新的 `SpecSummary.anchorRefs` 面，从 `list()` 本来就要求值的数据中暴露），只对命中文档求值，然后带完整分诊 steer 一次：经 `replaces` 重写、替换一篇本来就错的文档、经合并退休、或显式 defer。
- `agent/pre-step` 刷新 `devflow-spec-map` 运行时上下文——anchor 声称的文件被触及的文档（尖锐层，只看写入）与被触包的其余文档（宽层，读也算）的索引行，有字节上限，由 harness 做 diff。

**Steered-once、没有 `maxRetries`——与 iron-rules 的刻意分歧。** 铁律违规是义务：每个脏 turn 都拦，直到修复或到达上限。过期的 spec 文档是参考：读者欠它一次知情的过目，而重构中途的一次改名让文档过期多个 turn 是正当状态。因此哨兵在 steer 之前先记 per-(agent, document) 的 steered 集，再清写集（只有新的写入才会重新武装它），同一会话内绝不因同一篇文档打断两次；那一次打断（或一次显式 defer）之后，过期改在 pre-step 索引里保持可见。重试上限在这里是范畴错误：没有什么可重试。

**churn 按各层能诚实承诺什么，分给三层。** 哨兵排除 `churn` anchor——未提交的编辑翻不动它，只与 churn 重叠的命中所能浮出的只会是早于本 turn 的过期。索引的命中测试包含它——awareness 不是打断，churn anchor 仍然点名了一个文档所声称的文件。census 整体兜底 churn 的健康。

**覆盖先发现、后配置。** 哨兵发布可选的 `devflowSpecWorkspace` 值服务（fiber 作用域，`devflowArtifactStructures` 先例）：根清单到成员包再到 scope id——最初只读 `pnpm-workspace.yaml`，后已扩为[多生态探测器链](../feature/2026-09-13-spec-discovery-multi-ecosystem.md)。`/devflow spec` 用 `ctx.get` 读取，并把 `specScopes` 降级为整集覆盖——配置的 scope 整体取代发现结果而非并入，保留「只问这些」的能力。同一张布局表同时服务索引的 scope 层与 census，这正是解析器只存在一份的原因。

**独立成包，不做既有包的功能。** 本线用 profile 行当策略开关（114 行的 `dsh-devflow-fs-guard` 独立成包是现成先例），而 steer 是全线最具侵入性的模型体验——部署必须能用一行 `disabled: true` 恰好关掉它，其 fiber 销毁把全部监听器一并带走。接受这个新包之前，复用已被推到最大：bootstrap skill 归了 `devflow-guidance`，seam 扩展归了两个 spec 包，census 的发现优先归了 `devflow-command`。留在哨兵里的只有在别处没有诚实归宿的东西。

## 0.1.5-rc.2 上的 turn-stopping 窗口

实现之前先实测（实验留档于 `.scratch/devflow/steer-composition/`）：两个都 steer 的 `agent/turn-stopping` 监听器产生**一个**续跑步，两条消息按监听器顺序同批送达——不丢失、不覆盖——且 `turn-stopping` 在那一步之后会再次 dispatch，这正是哨兵在 steer *之前*先记 steered 集的原因。

同一实验发现，turn-stopping 窗口内的 `inject()` 与 `steer()` 投喂同一个 next-step 列表：它同样把 turn 撑开并强制一个立即送达的续跑步。两个后果刻意记录在此。其一，哨兵的 defer 降级*不能*做成「turn 末注入一条更安静的通知」——在那个窗口里，诚实的选择只有一次 steer 或什么都不做，因此非打断通道是 pre-step 索引（硬约束，不是偏好）。其二，**`dsh-devflow-iron-rules` 的 give-up 注释与钉住版本 harness 的实际行为不符**：它说放弃通知「保持 pending……下一个 turn 到达模型，而本 turn 结束」，但在 `0.1.5-rc.2` 上那次 inject 同样会触发一个续跑步。本任务刻意未动 iron-rules（超出范围）；调和那条注释——或那个行为——需要单开一张卡。

## Alternatives considered

**把反应挂在转移 waterfall 上**（前两轮设计假定的形状）。否决：转移发生在造成漂移的编辑很久之后，能做分诊的上下文早已散去，而判定「什么是*因这张卡*而过期的」需要在卡片开始时对裁决拍一份基线快照。turn 末宿主完全不需要快照——anchor 模型的 born-stale 规则意味着每个 `stale` 裁决本身就是 delta（「这在文档写下之后动了」），因此本 turn 写集与锚文件求交就是全部计算。

**在编辑落地前经 `fs/edit-intent` 提醒。** 双重否决。类型上就没有通道：那条 waterfall 返回的是版本守卫，监听器只能 throw 拒绝（fs-guard 模式）——它返回的任何东西都到不了模型上下文。而变通做法——第一次拒绝并附消息、重试放行——是训练模型重发调用的减速带；记为将来可能的*严格模式*，不做默认。

**并入 `dsh-devflow-spec-tool` 或 `dsh-devflow-guidance`。** 否决。工具包是模型侧工具平面；塞进一个 turn-stopping 策略会让一个包的 Model Experience 小节描述两个不相干的面，而且关掉 steer 会连唯一写路径一起关掉。guidance 的章程说其各层被抑制时失去的是「引导，从不是保证」——强制续跑步是干预，把它藏进那个包会让其 README 变成谎言。

**与 iron-rules 同包，共享 hook 管线。** 否决：两者在每个要紧的轴上都相反——常驻的义务正文对索引化的参考、每个脏 turn 都拦对 told-once、有 `maxRetries` 对没有——同包会诱使共享恰恰必须不同的那些常量。它们共享 hook 的*形状*、零代码；两包 README 互相点名对方并记录合成的双 steer 行为。

## Consequences

它**换来**零配置即存在的 spec 生命周期——bundle 默认启用地挂载哨兵，没有缝或没有文档的工作区不付任何代价——并让 express/emergency 的豁免在默认路径上失去意义：哨兵从不过问一张卡经过了哪些边。产物路线的文档现在如实陈述其定位（opt-in 纸面记录、样例只覆盖标准路线），不再暗示它承重。

它**付出**了第二处对一方工具名与参数形状的明示耦合、一个会话内存承诺（「told once」随进程重启清零，这是对会话承诺的正确读法），以及一个显式的不承诺：经 `bash` 的文件读写对收集不可见——与 iron-rules 接受的暴露面相同。读工具名单只有 `read`，收在一处带注释的集合里，harness bump 时只需查一处。

real-composition 测试端到端钉住行为：写一篇文档、经真实工具平面编辑被锚符号、观察到恰好一次点名文档与 anchor 的 steer 且没有第二次打断；观察到两个索引层各自出现；观察到与 iron-rules 的双 steer 合并。工作区解析器、渲染器与收集各带单元覆盖，达到仓库的 per-file 100% 门槛。
