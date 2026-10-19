# Agent Note: devflow — 能力缝后的文件任务卡

Status: implemented

[English](2026-08-25-devflow-file-based-task-cards.md) | 中文

## Problem

Harness 没有任何跨会话、跨 agent 的研发工作记录：todo 是会话内的，goal 是单会话单目标，workflow run 是一次前台执行。没有东西能以"人、git、CI 与 agent 都无需服务即可读写"的形式回答"这件工作在哪个阶段、谁持有、历史如何"。PRD（`.agents/prd/2026-08-25-devflow-file-based-dev-state.md`）要求状态载体是带可审计、可回放历史的文件。

## Decision

`packages/devflow/` 下的新能力缝 `ctx.devflow`，自始三角色齐备：

- `dsh-devflow`（Service Definition）拥有词汇——`DevCard`、闭合的 `DevStage` 联合（`draft | designing | ready | developing | reviewing | testing | done`，`blocked` 为记住来源阶段的旁路位置）、branded 的 `DevflowCardId`、journal 条目联合——以及所有消费者共用的 journal 解码/回放与抽象 `DevflowStore`。
- `dsh-devflow-filesystem`（Service Provider）把卡片映射到 `<root>/tasks/<id>/` 目录：`card.md`（YAML frontmatter 投影 + Markdown 正文）与追加式 `journal.jsonl`。
- `dsh-tool-devflow`（Consumer）注册模型工具：读取（`devflow_list` / `devflow_show`）、取租约与带 revision 校验的移动（`devflow_take` / `devflow_transition`）、产物登记（`devflow_attach_artifact`）。
- `dsh-devflow-gates`（策略 Consumer）在 `devflow/transition` waterfall 上经 `ctx.shell` 运行部署配置的门禁命令；失败的命令在提交前以有界输出摘要否决。门禁命令只存在于配置（全局按边列表加按卡片 id 覆盖），绝不在卡片文件里，开发中的 agent 无法改写自己的门禁。`approvals` 边额外要求经 `ctx.approval` 的一次性人工决定——交互面而非模型对话，因为门禁的存在就是为了检查 agent——获批的提交在 journal 条目携带 `gate.approvedBy`。无可达应答者时（非 agent 发起者、服务缺席、或 fail-closed 的 `unavailable`）移动被否决且卡片由 `command devflow-gates` actor 停驻 `blocked`，无人值守运行干净退出，人稍后恢复。

journal 是权威、frontmatter 是投影：读取回放 journal（`foldJournal` 强制 revision 连续、created 首条、从当前位置出发、blocked 精确恢复），结构非法的 journal 以指明文件与行号的错误使读取失败，投影漂移被告警并覆盖。这与 session log 的 event-sourcing 姿势同构，后续切片可以在"model-visible ⟺ logged"不破的前提下记录 agent 触发的流转。

写路径在 journal 追加处提交：`transition` 依次执行 revision CAS、边合法性与 `devflow/transition` waterfall（门禁扩展点），随后追加、重写投影（失败仅告警）并 emit `devflow/stage-changed`，其 revision 单调不变量由 Definition 伴生插件拥有。领域拒绝以稳定 code 解析而非 reject，镜像 shell 缝的结果姿态。`claim` 是带心跳与幂等释放的 `O_EXCL` 租约文件——跨进程互斥机制，因为 journal 追加本身没有文件锁。模型侧变更工具（`devflow_take`、`devflow_transition`）要求归属 agent 会话，并把每次已提交移动记录为 `devflow/transition` Session 事件，在 `.devflow` journal 保持权威的同时维持"model-visible ⟺ logged"。按仓库的 dead-vocabulary 门禁，事件词汇与它的第一个 dispatcher 同切片声明。阶段驱动器（`dsh-devflow-driver`）是 subagent 缝之上的排队 Consumer：每个卡片 root 对应一个合成且从不接收 prompt 的父 agent，用于锚定谱系与工作区；每个被派发子代理取得当前部署模型路由、卡片目标与固定工具契约，子代理运行期间租约心跳续约，失败把卡片停驻 `blocked`，revision 倒退触发静默重扫。本期交付单一执行体（一次性 subagent）；PRD 的 `goal` 与 Ralph 执行体推迟到驱动器能为每张卡拥有活跃宿主 agent。读取面经 Remote BFF 抵达浏览器：`DevflowStore` 继承 `TypertRemoteService` 并以 `@Remote` 适配 `list`/`read`，API 层转发 `devflow/stage-changed`，`dsh-client-ui-devflow` 贡献一个只读的看板控件、位于会话头部右对齐工具簇（设计稿的右上角锚点）——激活依赖已挂载的 `remote.devflow` 命名空间子服务（所有 Remote 消费方共用的 `remote.<namespace>` 注入模式），激活时取一次、每次连接建立（`connection/reset`）取一次、每次转发事件再取一次——没有写通道，因为审批应答已经走既有的审批 composer，而所有变更都属于模型工具或命令平面。这个确定性平面是 `dsh-command-devflow`：`/devflow`（看板）、`show`、`move`（按卡片当前 revision 经普通执行器，门禁照常裁决）、`takeover`（任何过去的心跳都算过期；驱逐以 `claim-expired` 入 journal，过期持有者的下一次提交过不了 CAS）、以及经能力缝 `archiveDone` 的 `archive`——它把每张 `done` 卡的目录按最后一条 journal 的月份整体 rename 进 `archive/<YYYY-MM>/<id>/`。所有命令效果都携带 `command devflow` journal actor。

## Alternatives considered

- **按阶段分目录（在阶段文件夹间移动卡片文件）** — 拒绝：改名破坏 watcher 身份与 git 连续性，且状态流转会落在一次无法携带校验管线的文件系统移动里。
- **frontmatter 作权威、无 journal** — 拒绝：没有审计链，损坏或手改后无法回放，并发写入者会静默互相覆盖。
- **单一包** — 拒绝：缝的三角色独立演化（未来的 GitHub Issues 或 SQLite Provider 不得触碰工具包），glossary 的 capability-seam 规则要求完整三元组。

## Consequences

人可以手改卡片，Provider 以 journal 收敛而非信任编辑——换来了可审计性，代价是每张卡必须有 journal 文件，且 fail-loud 读取会让畸形 journal 阻塞该卡直到修复。把所有拒绝放进 executor（CAS、边、打回理由、门禁否决）换来了无法绕过的强制执行，代价是每次移动都要经过 waterfall 分发。驱动器的单执行体范围换来了尽早贯通的端到端流水线，同时推迟了按卡宿主 agent；在那之前缺少 devflow 工具的被驱动子代理只能汇报，卡片原地不动。归档只写不读——没有缝操作能列出或恢复归档卡——而强制接管的过期判断是严格的年龄比较，同一毫秒或未来时间戳的心跳仍算存活。
