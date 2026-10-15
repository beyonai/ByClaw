# Agent Note: devflow——LLM 准入门禁

Status: implemented

[English](2026-08-27-devflow-agent-gate-llm-admission.md) | 中文

## 问题

产物契约止步于结构：`dsh-devflow-artifact-gate` 证明 design 存在且章节齐备，证明不了 design 回答了 PRD。评判内容需要一个读者，而无人值守时唯一可用的读者是模型——但让产出的 agent 给自己的交付物盖章等于什么都没盖，而 checker 可能 fail *open*（provider 挂了、裁决乱码、报告丢失）的门禁比没有门禁更糟，因为它把故障变成了无人给出的放行。此前也没有地方记录一次通过的检查：S1 给 transition 条目加 `gate.checks`，正是为了让准入事实与人工 `approvedBy` 同处一条。

## 决策

**`devflow/transition` 瀑布上的一个只读函数插件**，`@zhchxiao123/dsh-devflow-agent-gate`。配置的边经 `ctx.subagents` 派发一个**一次性 checker 子会话**——逐样复用 driver 的派发表面：每个 root 一个注册过的合成父代理锚定谱系与工作区，`ctx.agentDefaultModel.currentSelection()` 路由模型，等待 `run.result` 且 run 必被 dispose。prompt 由部署的检查指令、卡片、各配置 input kind 的最新登记（以 `--- artifact <kind> (rev N) ---` 分隔内联）与要求一个 fenced JSON 裁决块的固定契约组成；最后一个可解析的块才是裁决。

**放行是被记录的事实，不是裸放行。**门禁委派下游，并把 `{ by: { kind: 'agent' }, verdict: 'allowed', summary }` 追加进下游 decision 的 `checks`——合并、绝不覆盖，人工审批与 agent 检查共享同一条 journal 条目——下游的否决原样透传。**否决先是一个文件**：完整报告（summary、findings、检查时的 `kind:rev` 清单）落入正在流转的卡片的 devflow root 之下（曾是必填的 `reportDir`），理由点名路径。报告不能走 `attachArtifact`：store 按卡串行，本瀑布跑在持有该卡回合的 transition 内部（gates 包记录了同一死锁）。

**checker 的每种故障都 fail closed，姿态照 gates 的停驻。**provider 未注册、运行时未组合、start 被拒、超时、异常退出、裁决不可解析、input 读不到、报告写不进去：否决并点名故障，外加排在被否决 transition 之后的 `blocked` 停驻——与 `devflow-gates` 停驻无人应答的审批完全一样：对 attempt revision 发起 fire-and-forget 的 `devflow.transition`，失败只告警。与 driver 不同，本门禁绝不等待迟到的 provider：有一个 transition 正堵在这个裁决上，缺席就是当下的故障。

**缓存的是裁决，不是故障。**键为（边、root、卡片、排序后的 input `kind:rev` 对、指令 hash）——设计草案的键没写卡片与 root，但必须加：input revision 是按卡的事实，跨卡共享裁决会让一张卡的放行放走另一张卡的移动。`<devflow root>/cache/agent-gate/` 下的文件(曾是可选的 `verdictCacheDir`,现由正在流转的卡片派生)存完整键明细，供命中时逐字段核对与人工审计；损坏按告警未命中；缓存的放行在 journal 标 `[cached] `，缓存的否决指向原报告。

**已发布表面允许时收紧 checker 工具面。**`SubagentStartRequest.toolFilter` 存在，按 provider 的 `capabilities.toolFilter` 门控；门禁发送 devflow 变更工具与文件写工具的 deny 清单，并与实际注册的工具求交集，因为 `tools.restrict()` 拒绝未知名字。不支持该能力的 provider 不受限派发——记入 Known Limitations，由裁决契约要求只读行事。

## Alternatives considered

**让产出会话在移动前自检。**省掉派发成本，但生产者给自己的工作打分正是父 PRD 点名的失败；独立性正是单独一次性会话（不共享前缀）的意义。

**checker 基础设施故障时 fail open（委派）。**流水线不停摆，但把每次故障变成无人给出的放行。人工审批的先例早已选了另一边：否决并停驻 `blocked`，由人有意识地恢复。

**像 driver 一样等待迟到的 provider。**driver 停驻工件、可以永远等；本门禁位于有人正在等待的 transition 内部。等待会把 store 的按卡串行链挂死在一个可能永不到来的事件上。

**用（边、input revs、prompt）作键、不含卡片身份。**设计草案的字面键。被否决：两张卡可以共享同一条边与相同的 revision 数字，正文与产物内容却不同——缓存会把一张卡的裁决抹到另一张卡上。

**在瀑布内同步停驻。**死锁：停驻是对正持有串行回合的那张卡的 store 写。gates 包的排队 fire-and-forget 停驻是获准的机制，逐样复用。

**不写否决报告，让裁决留在 reason 里。**reason 是拒绝消息里被截断的散文；findings 需要一个耐久、完整、返工 agent 读得到的家，且报告位置由正在流转的卡片派生（曾是必填的 `reportDir`），使部署无法把门禁配置成悄悄丢弃它们。

## Consequences

- 缓存未命中的一次受检尝试花费一个完整子会话请求，长度与卡片加全部内联 inputs 成正比；命中零花费。README 的 Model Experience 一节如实记账。
- 部署顺序重要且无强制：本门禁应在 `artifact-gate` 之后（先机械后 token）、`gates` 审批之前（先 agent 后人）；由组合的行序决定。
- fail-closed 路径就是评审面：四组故障（provider 缺失、派发失败、超时、裁决不可解析）在 `tests/fail-closed.spec.ts` 各有一条命名测试，报告写失败与 input 读失败经共享的 fs-fault 注入器测试。
- 不带 `toolFilter` 能力的 provider 把 checker 工具面留给部署——是指令，不是强制。
- 每次基础设施故障都停驻 `blocked` 意味着抖动的 provider 会停卡而不是重试；这是有意的（无人值守的运行要响亮地停下），恢复就是正常解锁加重试。
