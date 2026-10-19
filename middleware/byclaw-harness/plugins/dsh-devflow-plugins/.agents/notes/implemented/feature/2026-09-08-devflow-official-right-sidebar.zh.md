# Agent Note：devflow — 接入 Harness 官方右侧栏

Status: implemented

## Problem

Devflow 看板最初必须自带导航界面，因为 Harness 当时没有对应能力。后来安装外部底座 `dsh-better-sidebar` 时优先使用其侧栏，否则在对话页渲染悬浮控件。当前 Harness Web 已经拥有第一方右侧栏、用于打开页签类型的开始页，以及承载页签主体的 keyed 槽位。继续保留兼容选择器会留下两套相互竞争的导航系统、额外安装步骤，以及大量只为过时宿主边界服务的代码。

## Decision

Devflow 面向 Harness `0.1.3-alpha.2` 的官方右侧栏。插件通过 `ctx.sidebarRightTabs` 注册一个 `devflow` 页签类型，并以实现 id 为 key 把主体注册到 `sidebar.right.pane.tab`。槽位提供的 `sessionId` 决定看板绑定作用域，页签实时的 `visible` 状态决定是否拉取。开始页入口、页签生命周期、面板尺寸、关闭行为与全屏状态全部由 Harness 管理。普通形态沿用堆叠详情流程；全屏形态沿用看板与详情并排布局。

悬浮入口、可选底座适配器、动态界面选择器、角标与可用性回调，以及底座专属的持久化并列设置全部删除。现在只有一套界面与一条生命周期。

Harness 源码中已经存在官方 `@deepseek-ai/dsh-client-ui-sidebar-right`，但它尚未发布到 npm。为了让独立插件仍可安装，本仓库只重述所消费的注册表与 keyed 槽位类型，就像此前外部集成重述服务边界一样；既不 import，也不声明这个尚未发布的包。运行行为仍归 Harness 所有，测试则把这份类型边界固定在当前源码使用的注册与槽位形状上。

本决策取代[双界面记录](2026-08-26-devflow-board-sidebar-surface.zh.md)中的宿主集成部分。其界面无关视图和按会话绑定决策仍然有效，[阶段中心 Kanban](2026-08-31-devflow-stage-centric-kanban.zh.md)也继续有效。

## Alternatives considered

- **保留 `dsh-better-sidebar` 作为降级方案** — 拒绝；受支持 Harness 已经提供宿主，降级只会保留第二套导航系统和安装矩阵。
- **官方服务缺失时继续显示悬浮控件** — 拒绝；静默改变信息架构会掩盖组合错误。插件安装到不受支持的 Harness 时，现在会通过声明的注入失败暴露问题。
- **直接依赖官方包** — 拒绝，直到该包真正发布到 npm；今天这样做会让原本有效的独立安装无法完成。
- **把官方实现复制进插件** — 拒绝；页签状态、布局与宿主 UI 必须只有一个所有者，Devflow 只消费扩展边界。

## 验证

- 浏览器组件测试运行真实 Cordis context 与 SlotRegistry，只替换尚未发布的官方注册表边界；覆盖页签注册、keyed 主体挂载、会话隔离、可见性拉取门、全屏状态传递与释放。
- 移除 `dsh-better-sidebar` 后，19 个 Devflow 打包产物全部安装进真实 Harness `0.1.3-alpha.2` Web profile。运行中的浏览器在官方侧栏开始页与页签条中显示 Devflow，并实测真实看板、卡片详情与返回导航；旧悬浮入口不存在。
- 官方侧栏包尚未发布，也不在本仓库中，因此暂时无法进入可移植的自动组合测试。上述真实 profile 回归就是宿主半边的兼容证据；官方包发布后，应删除本地类型重述并把它加入自动组合 fixture。

## Consequences

用户只需安装 `@zhchxiao123/dsh-devflow-bundle`，Devflow 入口会与 Files 等第一方页面一起出现在标准右侧栏中。看板不再覆盖对话内容，并遵循宿主的页签、关闭与全屏行为。移除旧兼容路径也会移除它的页签角标、底座专属可用性计算和持久化并列偏好；页面工具栏仍展示看板数量，全屏则提供明确的宽布局。

兼容范围被有意限定为已经组合 `sidebarRightTabs` 与 `sidebar.right.pane.tab` 的 Harness Web 版本。官方包可以从 npm 安装后，应以其导出类型替换本地声明，而不改变运行行为。重新引入另一套界面需要独立产品需求，以及受支持 Harness 组合确实缺少官方宿主的证据。
