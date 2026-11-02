---
name: project-cloud-knowledge-entity
description: "在 ByClaw 知识库或项目云盘中发起异步知识实体发现或补全。用于从单个原始文档、指定目录或整库生成 KnowledgeEntity 文档，或补全 KnowledgeEntity 文档中的实体信息、证据和关系。"
---

# 处理知识实体

这里的 `KnowledgeEntity` 指带有实体身份元数据的 Markdown 文档类型，不表示某个固定目录。Discovery 的“输出目录”和 Enrich 的“输入范围”是两套独立规则，分别按各自章节的优先级确定。两个命令都要求当前用户拥有知识库管理权限。

两个实体命令都支持可选参数 `--session-id SESSION_ID`。当前任务上下文存在会话 ID 时，必须显式传入 `--session-id`，不得省略，也不得依赖运行环境代为发现，以便向对应会话空间发送实体文件变更通知。只有当前任务上下文没有会话 ID 时才可省略；此时实体处理任务照常提交，但不会发送 `X-CHAT-SESSION-ID`，也不会向会话空间发送实体文件变更通知。

## 项目云盘授权与成本提示

项目云盘支持实体发现和实体补全，但不得主动触发：

- 只有用户当前输入明确要求实体发现、实体补全或包含相应阶段的完整链路时，才可提交对应命令。
- 用户只提出“知识整理”等概括目标，或阶段选择不明确时，先询问要执行实体发现、实体补全还是两者；询问中必须说明这些都是**高 Token 消耗、高耗时**的异步操作。
- 用户未明确选择前，不得把项目云盘入库、文件构建完成或其他阶段成功视为实体处理授权。

## 发现实体

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py entity-discovery \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --file-path /产品资料/a.md \
  --target-directory-path /领域知识/组织 \
  --max-entities 12 \
  --tag organization \
  --tag ai
```

实体发现支持三种范围：

- 传 `--file-path` 时只处理指定的单个原始文档。文件支持 `.csv`、`.htm`、`.html`、`.markdown`、`.md` 和 `.txt`。
- 传 `--directory-path` 时递归处理指定目录及其子目录中的合格原始文档。
- 两者都省略时扫描整库中的合格原始文档。

`--file-path` 与 `--directory-path` 不能同时传入。任何范围都不要把 `/KnowledgeEntity` 下的文件作为发现输入。

Discovery 输出目录优先级为：显式 `--target-directory-path` > 当前资源 `/.user_settings/_project.yaml` 中唯一且合法的 `素材.实体` 映射 > `/KnowledgeEntity`。也就是说，不传 `--target-directory-path` 时，有效映射就是输出目录；映射无效时才使用 `/KnowledgeEntity`。输出目录只控制本次生成或锚定的 KnowledgeEntity 位置，不改变输入扫描范围。

`--tag TAG` 中的 `TAG` 是要追加到 KnowledgeEntity 的 `tags` 属性中的一个字符串元素。每个标签重复传入一次 `--tag`；上例会把 `organization` 和 `ai` 作为两个元素追加到本次创建或锚定实体的 `tags` 列表，不会创建名为 `organization` 或 `ai` 的属性，也不会给被扫描的原始文档加标签。已有标签保持原顺序，新标签按参数顺序追加，重复值不会重复写入；不传 `--tag` 等价于不修改 `tags`。已有成功结果仅在输出位置和标签都满足当前请求时直接复用；否则后端会创建回放任务来移动实体或补充标签。

指定目录示例：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py entity-discovery \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --directory-path /产品资料 \
  --max-entities 12
```

## 补全实体

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py entity-enrich \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --file-path /KnowledgeEntity/示例实体.md \
  --top-k 20
```

Enrich 输入范围优先级为：显式 `--file-path` > 显式 `--directory-path` > 当前资源 `/.user_settings/_project.yaml` 中唯一且合法的 `素材.实体` 映射 > 整库。也就是说，两个显式路径都不传时，有效映射就是输入目录；映射无效时才对整库实体执行 Enrich。

各范围的处理方式：

- 传 `--file-path` 时只处理指定的单个 KnowledgeEntity 文档。
- 传 `--directory-path` 时递归处理指定目录及其子目录中的 KnowledgeEntity 文档。
- 显式路径都省略时，优先递归处理 `素材.实体` 映射目录；没有可用映射时扫描整库中的合格 KnowledgeEntity 文档，不限制实体所在目录。

`--file-path` 与 `--directory-path` 不能同时传入。

项目映射从 YAML 原文件读取，不依赖知识构建。映射值可以是单个字符串或只含一个路径的列表；路径必须以 `/` 开头且不能包含 `..`。文件不存在、无法读取、YAML 解析失败、键缺失、映射多个目录或路径非法时均忽略该默认值，不阻断实体任务。`--dry-run` 不读取远端文件，因此只展示显式参数；实际提交时才解析项目默认值。

## 控制与汇报

- 只在用户明确要求重新处理时传 `--force`；否则允许后端复用活动任务或新鲜结果。
- 成功响应只表示异步批次已受理或复用。汇报 `scope`、`targetPath`、`batchId`、`candidateCount`、`eligibleCount`、`acceptedCount`、`reusedCount`、`skippedCount`、`returnedTaskCount`、`tasksTruncated`，以及 `tasks` 中的 `taskId`、`status`、`filePath`、`reused` 和 `skipReason`。
- 不得把受理成功表述为实体处理已经完成。
- 每次提交或复用实体发现、实体补全批次后，都要明确告诉用户：如果已经配置可用的钉钉连接器并完成必要授权，任务完成后会推送通知到钉钉。
