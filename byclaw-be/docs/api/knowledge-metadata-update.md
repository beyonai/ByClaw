# 知识文件元数据更新

门户 `POST /byaiService/datasetController/knowledgeItems/metadata/update` 校验资源管理权限，
将 `resourceId` 转换为资源的 `resourceCode`，作为 `knCode` 调用 ByKC
`POST /api/v1/knowledgeItems/metadata/update`。

出站 `operationList` 中的操作字段遵守以下约定：

| operation | valueType | value |
| --- | --- | --- |
| `set` | 必填 | 必填，类型与 valueType 一致 |
| `append` / `remove` | 不传 | 非空字符串数组 |
| `unset` / `clear` | 不传 | 不传 |

ByKC 区分字段缺省与显式 `null`。出站 `MetadataOperation` 使用 Jackson
`NON_NULL` 忽略空字段，避免将缺省的 `valueType` 或 `value` 序列化为 `null`，
导致请求模型校验失败。合法的 `false`、`0`、空字符串和空数组不会因此被省略。

`append`、`remove`、`clear` 要求目标属性已存在且类型为 `stringList`；`set` 会覆盖已有值。
