# Agent Note: devflow — 阶段执行器取得模型与工作区路由

Status: implemented

[English](2026-08-27-devflow-driver-model-routing.md) | 中文

## Problem

**当前状态。**本 note 修复的包已不在发布线中；当前边界归[由 Harness 所有的执行决策](../architecture/2026-08-29-harness-owned-workflow-execution.zh.md)所有。本 note 继续保持 active，因为其中的路由故障和被否决方案会约束未来任何后台编排器的重新引入。

devflow driver 创建合成父 agent，只用于锚定 child 谱系与工作区元数据。进程内 child 从父 agent 的 session header 继承工作区；start request 未提供 `agentOptions` 时，还会从父 agent 继承 provider/model 路由。因此，没有 `cwd` 的父 agent 加上不带这些 options 的派发，会创建同时缺少两项运行时输入的 child。部署 persona 引用 `{{model}}` 或 `{{cwd}}` 时，严格 prompt 组装会在 child 发起模型请求或调用工具之前失败；child 随后以 `stopReason: 'error'` 结束，driver 把卡片停驻 `blocked`。

部署已经通过已发布的 `ctx.agentDefaultModel` 服务拥有当前 provider/model 对。每张卡片也携带已解析的 devflow 状态 root，其父目录就是该看板代表的工作区。在 driver 配置中重复模型选择或使用进程级统一工作区，会丢弃这些既有权威来源。

## Decision

driver 除 agent、subagent 和 devflow 服务外，还要求 `agentDefaultModel`。每次调用 `ctx.subagents.start()` 前，它读取 `ctx.agentDefaultModel.currentSelection()`，并把 provider/model 对复制到 request 的 `agentOptions`。child 因而在 prompt 组装前取得完整模型路由。

driver 为每个卡片 root 拥有一个已注册且从不接收 prompt 的合成父 agent。该父 agent 的 session `cwd` 是已解析 devflow root 的父目录，进程内 child 因而继承包含其卡片的工作区。父 agent 注册是 driver fiber 拥有的 effect，会在卸载时消失。不同 root 的卡片绝不共享工作区锚点。

模型选择发生在每次派发时，而非 driver 激活时。之后发生的部署模型变更会影响之后的阶段执行器，无需重建 driver 插件或修改其阶段配置。

## Alternatives considered

- **在 driver 配置中增加 provider 与 model 字段。** 这会让 driver 成为部署模型选择的另一个所有者，并可能与普通 Web agent 使用的 settings-backed 默认值发生分歧。某个具体部署确实需要独立执行器模型时，仍可增加专用选项。
- **把路由放在合成父 agent 上并依赖继承。** 继承能让 child 运行，但会在 driver 激活时固定路由，并让偶然存在的谱系对象承担 request 路由所有权。在派发边界传入 `agentOptions` 可直接表达 child 的需求。
- **使用一个以进程工作目录为 `cwd` 的合成父 agent。** 单一工作区只能让默认 root 正常运行，却会把其他 root 的卡片送入错误的文件系统范围。按 root 区分父 agent 可保留 driver 既有的多工作区契约。
- **让 harness 为所有无路由 agent 构造默认路由。** harness 会保留空 agent options，由各入口声明模型所有权。修改该规则会影响所有合成 agent 消费者；driver 可以在本地满足已发布的 child-start 契约。
- **从部署 persona 删除 `{{model}}`。** 这只会在一个 prompt section 隐藏缺失路由，child 仍无法发出有效模型请求。

## Consequences

driver 激活会等待基础 harness bundle 提供的默认模型服务。每个被接受的阶段执行器 request 都携带明确的 provider/model 对，其父 agent session 也声明卡片工作区，因此感知模型与工作区的 persona 组装会在 child turn 开始前完成解析。真实组合的 driver 测试会记录 provider 收到的两项输入，证明第二个 root 取得自己的工作区，并证明 driver 卸载时会注销父 agent。
