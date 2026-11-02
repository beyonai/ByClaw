# Agent Note：devflow——经能力缝的聊天建卡

Status: implemented

[English](2026-08-26-devflow-chat-card-creation.md) | 中文

## 问题

创建一张 devflow 卡意味着按 Provider 的磁盘格式手写 `card.md` 加一行 journal——与 PRD（`.agents/prd/2026-08-26-devflow-workspace-binding-and-chat-creation.md`）瞄准的工作流脱节：需求在聊天里商定，应当不离开聊天就落成被跟踪的任务。格式抄错（rev、时间戳、actor）还会让整个看板读取 fail-loud。

## 决策

创建是缝上的操作，不是工具侧的文件写入器：

- `DevflowStore` 新增 `resolveCreate(request): CreateSpec`（显式默认值补全步骤：slug 省略时由标题推导，加创建时间戳）与 `create(spec)`，沿用缝的领域结果姿势——稳定 code `empty-title`、`invalid-slug`、`exists`；仅基础设施故障才 reject。
- 文件系统 Provider 越过所有活跃卡**与归档卡**分配下一个顺序号（id 永不复用，之后的 `archiveDone` 不会在月份目录里相撞），以独占的非递归 `mkdir` 预定 `tasks/<seq>-<slug>/`；预定输给其他进程时重扫取新号——连输五次解析为 `exists`。进程内创建者在一条链上串行，同 host 的 agent 不会互抢号；跨进程同瞬不同 slug 的角落保持 id 唯一但可能共号，记为 Provider 限制，而不是用裸目录再改名的舞步买下顺序号级别的锁。
- journal 首条 `created`（带创建 actor）是唯一提交点；`card.md` 随后经标准投影路径写入，投影写失败的降级与丢失卡片文件完全一致，不会留下半创建的卡。
- `devflow/card-created` 是独立的 emit 而非 `stage-changed` 变体，创建不过 `devflow/transition` waterfall：draft 卡无害，治理从它的第一次移动开始。Definition 的不变量伴生插件校验新流（新 draft、revision 1、从未见过的 id）。该事件进入 Remote 转发白名单，看板客户端收到即重拉，聊天建的卡无需刷新即出现。
- `devflow_create`（标题、Markdown 正文、可选 slug）要求归属的 agent 会话，提交时追加 `devflow/created` Session 事件——model-visible ⟺ logged。手写建卡继续有效；工具只是同一 journal 格式上的第二个生产者。

## 曾考虑的替代方案

- **`/devflow new` 子命令** — 拒绝：命令面是单行输入，装不下带验收标准的 Markdown 正文；创建归聊天面，干预归 `/devflow`。
- **创建走 transition waterfall** — 拒绝：门禁按既有卡的 `from -> to` 边裁决；创建没有出发位置，否决一张 draft 保护不了任何东西。
- **工具侧写文件（不加缝操作）** — 拒绝：顺序号分配与 journal 先行的提交点应在缝后，命令面、driver 或未来的 Provider 才能复用；工具侧写入还会绕开 Provider 的串行化。

## 后果

看板"无法建卡"的缺口端到端闭合（store → 工具 → 会话日志 → 转发事件 → 面板重拉），而 journal 回放契约不变——`created` 本就是强制的首条，存量卡与新路径折叠一致。创建后卡片仍不能经缝编辑；改正文依旧是直接编辑 `card.md`。
