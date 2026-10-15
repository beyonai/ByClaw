# Agent Note: devflow —— workflow 执行归 Harness 所有

Status: implemented

[English](2026-08-29-harness-owned-workflow-execution.md) | 中文

## Problem

devflow 曾有两套 workflow 执行器。交互式 Harness agent 可以读取卡片、编写交付物并通过模型工具推进；`dsh-devflow-driver` 同时监听阶段事件，派发独立子代理完成同一类工作。第二套执行器引入 provider 生命周期、模型路由、租约、prompt 与并发所有权，却没有增加状态或策略能力。部署必须决定下一次移动归哪个 agent 所有，同时启用两者还会让推进来源难以判断。

产物策略向交互式执行器暴露要求的时机也太晚。artifact gate 能正确约束 transition，但模型往往只有先尝试移动并收到 veto，才知道所需 kind 与结构。被拒绝的 transition 因此成了普通发现流程的一部分。

## Decision

**Harness agent 是唯一的 workflow 执行器。**driver 包、bundle 行与依赖、workspace 引用、包测试和当前安装文档全部删除。bundle 只组合状态、模型工具、策略、命令与视图，不启动第二套后台编排器。现有 profile 同时删除 driver 包和 loader 条目，不保留 disabled 兼容行或空壳包。

**产物策略通过可选只读服务提前发现。**核心 devflow Definition 拥有不可变的 `ArtifactContract` inspection 词汇及其工具输出 schema。artifact gate 提供 `devflowArtifactContract`；它的 `inspectOutgoing(card)` 报告已配置且当前合法的出边，并运行 transition enforcement 所用的同一份结构检查器。tool 插件通过 `ctx.get()` 读取服务，把当下结果加入 create、show、attach 和成功改变阶段的结果。没有该 Provider 的部署保持原有输出。

**语义准入仍是独立策略，不是执行器。**agent gate 可以在裁决 transition 时派发一次性 checker，但不会认领阶段工作或推进卡片。其合成父 agent 携带 child runtime 所需的显式 `agents` injection，因此不再需要 profile 级 injection 覆盖。

历史 Agent Note 保留已删除实现当时的决策依据。它们记录本次删除前曾交付的决定，不构成可安装面或兼容面；当前执行边界由本 note 所有。

## Alternatives considered

**保留安装但默认禁用 driver。**休眠包仍会在 manifest、文档、配置和维护工作里保留两套所有权模型。当前场景不需要无人值守消费队列，因此兼容空壳只会保留成本，不会保留必要行为。

**只为无人值守操作保留 driver。**这仍是一套独立 agent 生命周期，拥有自己的路由、prompt、租约与恢复语义。如果无人值守调度成为具体需求，应另行论证一套编排设计，而不是始终发布备用执行器。

**卡片进入阶段时生成空 artifact。**空文件不能很好地表达需求，还可能在内容具备证据前看起来像交付物。报告准确契约可以让 Harness agent 有意编写文档，同时 gate 继续拒绝缺失或畸形内容。

**让模型通过失败 transition 发现要求。**拒绝对于 enforcement 仍然必要，但把它当作普通读 API 会制造可避免的失败动作。inspection 服务在尝试之前给出完全相同的缺陷，不复制检查器。

## Consequences

- 聊天驱动工作只有一个可归因的所有者：当前 Harness session。想继续推进时，用户需要保持或恢复该 agent；devflow 不再在后台消费排队卡片。
- 发布线现在包含十二个包。删除 driver 对启用它的 profile 是破坏性打包/配置变更；这些 profile 必须删除依赖与 loader 条目。
- 产物要求会在移动前以及每次相关提交后可见，而 transition enforcement 仍然 fail closed 且保持权威。
- 核心 Definition 现在拥有共享 inspection wire 词汇。Provider 与 Consumer 通过可选 Cordis 服务协作，不相互导入运行时值。
- 仓库验证通过 44 个测试文件、382 个测试；十二个 tarball 全部通过 preflight，本地安装的无 driver bundle 成功启动。一次新的 Harness 聊天创建卡片、观察并修正 artifact preflight、通过 `draft -> designing` agent gate 且没有 injection 错误，最后在未派发 workflow child 的情况下把卡片停靠于 `blocked`。
