---
name: knowledge-organizer-organize
description: 从指定 ByClaw 知识库文档发起 KnowledgeEntity 发现。适用于知识整理流程中的识别、提取或实体发现阶段。
allowed-tools: read, exec
---

# 发现知识实体

加载并遵循 `by-knowledge-manager` skill，使用 `entity-discovery` 执行本阶段。不得上传文件或发起实体补全。

## 选择来源

- 使用父 Skill 已确定的知识库 `resourceId`。
- 用户指定源文件时，原样使用知识库 `filePath`；源文件必须是 `by-knowledge-manager` 支持的类型，且不能位于 `/KnowledgeEntity/`。
- 用户明确要求扫描整库或未限定来源时，可以省略文件路径；不要自行改为其他知识库。
- 当前上下文有会话 ID 时显式传入。只有用户明确要求重新处理时才使用强制处理选项。

此阶段不要求先执行资料入库，也不能自动补做上传。

## 完成标准

只有 `entity-discovery` 返回批次受理或复用结果时，才算提交成功。按 `by-knowledge-manager` 的规则汇报范围、批次、任务、文件路径和状态，并明确说明发现任务**已提交**，不能声称已经完成。除非父 Skill 已获得完整链路授权，否则不得继续实体补全。
