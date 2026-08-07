---
name: knowledge-organizer
description: 将用户资料整理为授权范围内的知识对象。适用于新建或继续知识整理任务、登记源文件、从文档发现对象、丰富对象知识，或组合执行这些操作。
allowed-tools: read, exec
---

# 整理知识

只通过本 Skill 自带的 CLI 执行操作。正常使用时，不要阅读 CLI 源码，也不要直接调用服务接口。

## 判断任务和操作

1. 判断本次输入是否为后台任务。只依据**当前用户输入**判断：
   - 输入明确写有“后台任务”“定时任务”“异步任务”“运营任务”等描述，或包含除会话 ID 外的 `taskId`、`jobId`、`scheduleTaskId`、`requirementId` 等任务标识时，按后台任务处理；初始化时使用会话共享范围，不传 `--digital-employee-resource-id`。
   - 普通对话请求按交互任务处理；初始化时使用数字员工权限范围，传入 `--digital-employee-resource-id`。
   - 上下文中是否存在数字员工资源 ID 不能用来判断任务类型。
2. 确认任务上下文：
   - 新任务：选择一个简短且有业务含义的新目录路径，再执行 `init`；目录由 CLI 创建。
   - 已有任务：沿用当前上下文中的准确任务目录。无法确定或存在多个候选时先询问用户，不要猜测，也不要重复初始化。
3. 只阅读用户当前操作对应的子 Skill：

| 用户意图 | 阅读 |
|---|---|
| 新建任务或确定授权对象范围 | [`knowledge-organizer-init/SKILL.md`](knowledge-organizer-init/SKILL.md) |
| 登记本地源文件 | [`knowledge-organizer-ingest/SKILL.md`](knowledge-organizer-ingest/SKILL.md) |
| 发现文档所表达的对象 | [`knowledge-organizer-organize/SKILL.md`](knowledge-organizer-organize/SKILL.md) |
| 丰富或构建对象知识 | [`knowledge-organizer-build/SKILL.md`](knowledge-organizer-build/SKILL.md) |

`init` 是唯一前提。初始化后，`ingest`、`organize`、`build` 相互独立。只执行用户要求的操作，不要自行添加顺序依赖。

## 确定输入

- 从当前任务上下文取得会话 ID，不要猜测。
- 从初始化结果的 `objects/ods/` 和 `objects/ads/` 目录读取对象定义：
  - `ingest` 只能选择 `ods/` 中的对象。
  - `organize`、`build` 只能选择 `ads/` 中的对象；用户未指定范围时使用当前全部 ADS 对象。
- 同一个知识整理任务的所有操作始终使用同一任务目录。

## 控制交互

- 交互任务：缺少关键输入，或多个合理选择会显著改变结果时，及时询问用户。
- 后台任务：不要为每个文件或对象频繁询问。先执行所有能够可靠推进的操作；对无法确定的项采用安全默认值，确实无法处理时跳过并记录，最后一次性汇报结果、待确认项和失败原因。

## 汇报结果

说明完成了哪些初始化、登记或提交操作，并列出所选对象和失败项。异步操作只能表述为**已受理/已提交**，不能表述为**已完成**。

CLI 执行失败时，如实报告错误并停止当前操作。不要通过修改任务状态或绕过 CLI 来补救。
