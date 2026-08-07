---
name: knowledge-organizer
description: Use when users ask to organize documents, materials, or knowledge through the complete initialization, ODS ingestion, ADS organization, and build workflow.
allowed-tools: read, exec
---

# 知识整理总编排

本 skill 是知识整理的总编排入口。只有新任务或执行 `init` 时才生成唯一且有业务含义的任务目录；同一任务的后续阶段必须沿用该目录，再按用户意图读取并执行对应子 skill：

| 阶段 | 子 skill | 适用意图 |
|---|---|---|
| 初始化授权对象快照 | `knowledge-organizer-init/SKILL.md` | 新任务、对象范围确认 |
| 原始文档入库 | `knowledge-organizer-ingest/SKILL.md` | 将 `.md`/`.txt` 资料写入 ODS |
| 知识碎片整理 | `knowledge-organizer-organize/SKILL.md` | 从成功入库文档抽取并关联 ADS 知识 |
| 对象文档构建 | `knowledge-organizer-build/SKILL.md` | 提交本任务相关 ADS 实例构建 |

每个子 skill 都必须完整阅读后执行。单阶段请求只执行对应子 skill；完整整理请求按 `init -> ingest -> organize -> build` 顺序串联。后续阶段不得绕过前置阶段或直接调用底层接口。

## 全局执行边界

- 所有副作用只能通过 `knowledge-organizer/scripts/knowledge_organizer.py` 发起；除本目录规定的四个子 skill 外，禁止使用其他 skill、直接调用 HTTP/RPC、临时脚本或手工修改状态文件。
- CLI 只允许 `init`、`ingest`、`organize`、`build` 四个命令；失败时如实报告 CLI 返回内容，不得补调接口或声称成功。
- 任务状态唯一来源是任务目录下的 `knowledge-organizer/state.json`。新任务不得猜测、复用或覆盖其他任务目录；同一任务的后续阶段必须沿用已初始化目录。
- `init` 阶段必须提供 `USER_CODE`、`BE_DOMAINNAME`、`DATACLOUD_DOMAINNAME`、已登录态和数字员工资源 ID；其他阶段从已有 `state.json` 读取任务上下文。
- 数字员工资源 ID 仅是 init 阶段的前置条件。
- 用户指定对象时，初始化后锁定且只使用匹配的对象编码；未匹配立即终止，不得扩大或替换范围。

## 交付与恢复

子 skill 返回的结果和 `state.json` 是阶段事实来源。初始化失败或状态损坏终止整个任务；文件、碎片或构建批次的局部失败由 CLI 记录，使用对应子 skill 的恢复参数重试。最终交付应汇总成功项、失败项、失败原因、实例/碎片 ID 和构建提交状态。
