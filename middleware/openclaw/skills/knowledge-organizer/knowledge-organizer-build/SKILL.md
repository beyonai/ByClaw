---
name: knowledge-organizer-build
description: 在指定 ByClaw 知识库中发起 KnowledgeEntity 补全。适用于知识整理流程中的丰富、融合、补全或知识构建阶段。
allowed-tools: read, exec
---

# 补全知识实体

加载并遵循 `project-cloud-knowledge` skill，使用 `entity-enrich` 执行本阶段。不得上传文件或发起实体发现。

## 选择范围

- 使用父 Skill 已确定的知识库 `resourceId`。
- 用户指定知识实体文件时，原样使用 `/KnowledgeEntity/` 下的 `filePath`。
- 用户明确要求处理全部知识实体或未限定范围时，可以省略文件路径，处理 `/KnowledgeEntity/` 下全部合格实体文档。
- 当前上下文有会话 ID 时显式传入。只有用户明确要求重新处理时才使用强制处理选项。

此阶段不要求先执行资料入库或实体发现，也不能自动补做这些阶段。

## 完成标准

只有 `entity-enrich` 返回批次受理或复用结果时，才算提交成功。按 `project-cloud-knowledge` 的规则汇报范围、批次、任务、文件路径和状态，并明确说明补全任务**已提交**，不能声称已经完成。
