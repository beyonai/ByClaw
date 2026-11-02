# Agent Note: devflow — 驱动器等待 subagent provider 激活

Status: implemented

[English](2026-08-27-devflow-driver-provider-lifecycle.md) | 中文

## Problem

**当前状态。**本 note 修复的包已不在发布线中；当前边界归[由 Harness 所有的执行决策](../architecture/2026-08-29-harness-owned-workflow-execution.zh.md)所有。本 note 继续保持 active，因为并发 provider 激活会约束未来任何后台编排器的生命周期。

Cordis Loader 条目并发激活。因此，独立挂载的 provider 插件注册名称之前，`subagents` 服务就可能已经满足驱动器的注入。加载时调用 `getProvider()` 会让有效组合依赖激活顺序：基础 bundle 已声明 `spawn`，但启用的 devflow driver 可能先观察注册表，并以 `unregistered subagent provider "spawn"` 使整个 profile 加载失败。

配置顺序无法建立 provider 就绪关系。Provider 与驱动器注入的是同一个注册表服务，而 provider 名称是该服务内部的动态条目，不是独立的 Cordis 服务。

## Decision

Provider 可用性属于运行时生命周期状态。卡片位于已配置阶段但对应 provider 缺失时，会进入以 root 和 id 为键的等待 map。后续状态事件会替换这份待定值；卡片移动到未驱动阶段时会移除它。每个 provider 的首次等待记录一条 `debug` 日志。

驱动器监听 `subagent/provider-added`。Provider 注册后，所有匹配的待定卡片经现有 `enqueue()` 路径释放，从而保留并发上限、engaged 卡片排除、租约认领和子代理退出后重新进入等行为。入队时已经存在的 provider 直接走普通路径，不进入等待 map。

## Alternatives considered

- **依赖 bundle 条目顺序。** Loader 并发启动同级条目，因此文本顺序可以说明组合，却不能串行化激活。
- **删除检查并让 `ctx.subagents.start()` 失败。** 激活扫描可能在有效 provider 完成注册前认领并停驻卡片，把启动竞态转化成持久任务状态。
- **等待 provider 注册超时后失败。** 超时会增加随部署变化的启动延迟，仍会与较慢的 provider 初始化竞态，还需要新增调优项，却不会改善派发正确性。

## Consequences

冷启动和热添加 provider 具有相同行为：卡片在不认领租约的情况下等待，并在 provider 出现后派发。拼错的 provider 名不再造成加载期错误；对应卡片会保持待定，debug 日志会指名未解析名称。对于缺少“组合已经稳定”事件的动态注册表，这两种状态无法区分。

真实组合的驱动器测试会先于 provider 加载驱动器，证明 provider 缺失时不会启动子代理，再注册 provider 并观察待定卡片得到派发。该测试固定了暴露缺陷的 profile 启动顺序。
