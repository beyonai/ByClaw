---
name: project-cloud-knowledge-metadata
description: "查看或修改 ByClaw 知识库、项目云盘中文件或目录的标签和其他属性。用于查标签、打标签、追加或移除标签，以及查看或修改状态、负责人、日期等文件属性；这些属性在接口中统称元数据。"
---

# 管理标签和其他文件属性

这里的“元数据”就是文件或目录附带的标签和其他属性，例如状态、负责人、日期。使用父 Skill 的 Python CLI 执行 `metadata-get` 或 `metadata-update`；不要让用户编写 JSON 操作列表。

## 查标签和其他属性

省略 `--metadata-field` 时返回文件或目录的全部自定义元数据和系统属性：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py metadata-get \
  --resource-id RESOURCE_ID \
  --file-path /制度/人事/续签流程.md
```

只查看标签时传 `--metadata-field tags`；查看多个属性时重复传入 `--metadata-field`：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py metadata-get \
  --resource-id RESOURCE_ID \
  --file-path /制度/人事/续签流程.md \
  --metadata-field status \
  --metadata-field tags
```

返回的每个属性都包含 `valueType` 和 `value`；不存在或未请求的属性不会出现在 `metadata` 中。

## 打标签、改标签和更新其他属性

第一次给条目设置标签时使用 `--set-string-list tags`：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py metadata-update \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --file-path /制度/人事/续签流程.md \
  --set-string-list tags contract renewal
```

已有 `tags` 属性时，使用 `--append tags` 追加标签、`--remove tags` 移除指定标签、`--clear tags` 清空标签。要连同标签属性本身一起删除时使用 `--unset tags`。

标签和其他属性可以在一次命令中组合修改，整批原子提交：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py metadata-update \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --file-path /制度/人事/续签流程.md \
  --set-string status active \
  --append tags renewal \
  --unset owner
```

可用操作：

- `--set-string PROPERTY VALUE`
- `--set-string-list PROPERTY [VALUE ...]`
- `--set-number PROPERTY VALUE`
- `--set-boolean PROPERTY true|false`
- `--set-datetime PROPERTY ISO_8601_VALUE`
- `--append PROPERTY VALUE [VALUE ...]`
- `--remove PROPERTY VALUE [VALUE ...]`
- `--unset PROPERTY`
- `--clear PROPERTY`

每个参数都可重复用于不同属性，但同一命令中一个属性只能出现一次。`append`、`remove` 和 `clear` 只适用于已经存在的 `stringList`；`unset` 删除整个属性，属性不存在时也成功；`clear` 保留属性并把值设为 `[]`。`set` 可以新增、覆盖或显式改变类型。需要先校验计划时传 `--dry-run`。

不要修改系统只读字段：`fileName`、`fileType`、`fileSize`、`mimeType`、`createdAt`、`updatedAt`、`fileSignature`、`filePath`。更新成功只表示整批操作已提交；响应不携带最新值，需要确认时再执行 `metadata-get`。
