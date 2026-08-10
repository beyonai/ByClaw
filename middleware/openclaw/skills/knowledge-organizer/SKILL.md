---
name: knowledge-organizer
description: 将本地 Markdown、文本或 JSON 资料登记到授权知识对象，并按需发现文档对象、丰富或构建对象知识。用于用户要求新建或继续知识整理任务，以及提到“知识整理”“资料入库”“文档对象发现”“知识丰富”或“知识构建”等意图时。
allowed-tools: read, exec
---

# 整理知识

只通过本 Skill 自带的 CLI 执行操作。不得阅读 CLI 源码、直接调用服务接口或采用其他脚本绕过 CLI。

## 锁定本轮操作范围

具体动作词优先于“知识整理”等概括描述。根据当前输入选择本轮操作：

| 当前输入的明确意图 | 允许执行 |
|---|---|
| 入库、导入、登记、附加源文件 | 新任务先执行 `init`，然后只执行 `ingest` |
| 发现、识别、提取文档对象 | 新任务先执行 `init`，然后只执行 `organize` |
| 丰富、融合、构建对象知识 | 新任务先执行 `init`，然后只执行 `build` |
| 只初始化或查看授权范围 | 只执行 `init` |

- 用户要求“入库”时，`ingest` 成功后立即停止；不得追加 `organize` 或 `build`。
- “后台任务”“开始操作”“尽量推进”只改变交互方式，不会扩大操作范围。
- 只有当前输入同时明确要求多个阶段，或明确要求“完整链路”“全流程”时，才按用户点名的阶段逐项执行。不要把“知识整理”单独理解为完整链路授权。
- `init` 只是新任务的必要前提，不代表用户授权执行其余三个命令。

## 判断任务类型

1. 只依据**当前用户输入**判断是否为后台任务：
   - 输入明确写有“后台任务”“定时任务”“异步任务”“运营任务”等描述，或包含除会话 ID 外的 `taskId`、`jobId`、`scheduleTaskId`、`requirementId` 等任务标识时，按后台任务处理；初始化时使用会话共享范围，不传 `--digital-employee-resource-id`。
   - 普通对话请求按交互任务处理；初始化时使用数字员工权限范围，传入 `--digital-employee-resource-id`。
   - 上下文中是否存在数字员工资源 ID 不能用来判断任务类型。
2. 确认任务上下文：
   - 新任务：选择一个简短且有业务含义的新目录路径，再执行 `init`；目录由 CLI 创建。
   - 已有任务：沿用当前上下文中的准确任务目录。无法确定或存在多个候选时先询问用户，不要猜测，也不要重复初始化。
3. 只阅读 `init`（新任务时）和本轮目标操作对应的子 Skill：

| 用户意图 | 阅读 |
|---|---|
| 新建任务或确定授权对象范围 | [`knowledge-organizer-init/SKILL.md`](knowledge-organizer-init/SKILL.md) |
| 登记本地源文件 | [`knowledge-organizer-ingest/SKILL.md`](knowledge-organizer-ingest/SKILL.md) |
| 发现文档所表达的对象 | [`knowledge-organizer-organize/SKILL.md`](knowledge-organizer-organize/SKILL.md) |
| 丰富或构建对象知识 | [`knowledge-organizer-build/SKILL.md`](knowledge-organizer-build/SKILL.md) |

如果第 1 步已判断为后台任务，还必须阅读 [`knowledge-organizer-update-task-status/SKILL.md`](knowledge-organizer-update-task-status/SKILL.md)，并只按其中的终态矩阵更新状态。普通交互任务不得读取或调用任务状态更新子 Skill。

初始化后，`ingest`、`organize`、`build` 相互独立。一个命令成功不构成执行下一个命令的授权。

## 确定输入

- 从当前任务上下文取得会话 ID，不要猜测。
- 从初始化结果的 `objects/ods/` 和 `objects/ads/` 目录读取对象定义：
  - `ingest` 只能选择 `ods/` 中的对象。
  - `organize` 的发现来源只能选择 `ods/` 中的对象，发现目标只能选择 `ads/` 中的对象；用户未指定对应范围时，分别使用当前全部 ODS 来源和全部 ADS 目标。
  - `build` 只能选择 `ads/` 中的对象；用户未指定范围时使用当前全部 ADS 对象。
- 同一个知识整理任务的所有操作始终使用同一任务目录。

## 控制交互

- 交互任务：缺少关键输入，或多个合理选择会显著改变结果时，及时询问用户。
- 后台任务：不要为每个文件或对象频繁询问。在已锁定的操作范围和权限范围内推进；确实无法处理时跳过或停止，最后一次性汇报。
- 安全默认值不包括追加未要求的命令、切换权限范围、扩大对象范围或绕过 CLI。

## 汇报结果

说明完成了哪些初始化、登记或提交操作，并列出所选对象和失败项。异步操作只能表述为**已受理/已提交**，不能表述为**已完成**。

CLI 执行失败时，如实报告错误并停止当前操作。不得改用其他命令、切换权限范围或绕过 CLI 补救。后台任务只允许按任务状态更新子 Skill 的规则设置终态；交互任务不得修改任务状态。
