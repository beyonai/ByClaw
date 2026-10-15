# Agent Note：devflow——root 跟随调用方

Status: implemented

[English](2026-08-26-devflow-root-follows-caller.md) | 中文

## 问题

devflow store 的根曾是按 host 进程 cwd 解析的一个全局配置值，而 dsh 会话归属于工作区（canonical 目录路径）。在工作区 A 工作的会话经工具、`/devflow` 与看板看到的是工作区 B（或启动目录）的卡；并行项目共享一张偶然的板。PRD（`.agents/prd/2026-08-26-devflow-workspace-binding-and-chat-creation.md`）要求根成为按调用方解析的每次调用维度。

## 决策

root 是缝上的维度，不是卡片字段：

- `DevflowStore` 的每个操作携带显式 root——读取用可选尾参，请求用可选 `root` 字段并经既有的显式默认值补全步骤（`resolve`、`resolveCreate`，以及供无 spec 操作使用的 provider 内 `resolveRoot` 汇聚点）解析进 spec，租约经 `ClaimOptions`。省略的 root 即配置的默认根，所有单根部署与 Remote 读取面因此不变。`DevCard` 增加只读 `root`（已解析的绝对路径），事件消费者仅凭载荷就能跟对目录。
- 文件系统 Provider 用一个实例服务任意多个根：每卡串行化与 driver 的记账以 root + id 为 key（不同根下的相同 id 是不同的卡），创建链按根串行，并行工作区不会互抢顺序号。
- 工作区到目录的映射在消费方，绝不进 Definition。模型工具与 `/devflow` 从发起 agent 的会话头部推导 `<会话 cwd>/.devflow`；没有 cwd 的会话回退默认根，一个会话的聊天面与命令面因此永远看到同一张板。门禁监听器在 `dirname(attempt.root)`（卡片的工作区）里运行命令、把等待审批的卡停驻在 attempt 的根里；driver 在被移动卡片自己的根里认领、心跳、读取与停驻。
- Remote 面接收的是**查看会话的 id**，不是 workspace id：看板本就是会话视图，分组会话的会话头部 cwd 就是工作区的 canonical 路径，一条 host 侧解析（先活跃注册表、再持久化头部，未知会话稳定拒绝）同时覆盖分组与未分组会话——浏览器发送的是它到处都持有的 id，线上不引入第二套标识词汇。看板客户端在每次真实的选择变化时重拉，每个会话得到自己工作区的板。

## 曾考虑的替代方案

- **卡片上加 `workspace` 字段** — 拒绝：卡片的归属就是它所在的目录；存一个 workspace id 会是随仓库移动而漂移的第二真相源。
- **缝内做工作区解析**（Definition 依赖 `workspaceRegistry`）— 拒绝：缝保持只认目录，Provider 无须了解工作区实体；每个消费方把自己的调用方概念（今天是会话 cwd，下一步是 Remote 面的浏览器 workspace id）映射到目录。
- **root 走 `CardFilter`** — 拒绝：filter 会过 Remote 线，而浏览器绝不能发送文件路径；root 走独立参数，Remote 适配器干脆不转发它。

## 后果

多项目 host 不再串台：工具、命令、门禁、driver 与看板全部跟随调用方或卡片的根，由多根 store 测试、双工作区工具/命令组合测试、门禁 workdir 断言、跨根 driver 派发与双工作区真实浏览器 e2e（会话间看板隔离，加一次 `/devflow` 移动实时更新打开的面板）验证。driver 的激活扫描仍只覆盖默认根，其他根经各自的 `stage-changed` 事件派发。
