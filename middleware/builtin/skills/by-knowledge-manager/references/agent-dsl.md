# Agent DSL 过滤规则

只在 `search` 或 `search-file` 使用 `--where-json` 时读取本文。DSL 是传给后端 `where` 字段的 JSON AST，不是 SQL，也不是本体查询语言。

## 目录

- [表达式结构](#表达式结构)
- [字段类型与操作符](#字段类型与操作符)
- [系统文件属性](#系统文件属性)
- [值与复杂度约束](#值与复杂度约束)
- [常用示例](#常用示例)
- [错误修正](#错误修正)

## 表达式结构

每个节点必须是恰好包含一个操作符的对象。

布尔操作符：

- `and`：值必须是非空子表达式数组。
- `or`：值必须是非空子表达式数组。
- `not`：值必须是单个子表达式对象，不能是数组。

叶子操作符：

- `eq`、`ne`、`in`
- `contains`、`exists`
- `gt`、`gte`、`lt`、`lte`
- `prefix`、`wildcard`

除 `exists` 外，叶子值采用：

```json
{"eq": {"fieldName": "status", "value": "active"}}
```

`exists` 只传字段名：

```json
{"exists": {"fieldName": "status"}}
```

## 字段类型与操作符

| 字段类型 | 支持的操作符 | 不支持的操作符 |
|---|---|---|
| `string` | `eq`、`ne`、`in`、`exists`、`prefix`、`wildcard` | `contains`、数值比较 |
| `stringList` | `contains`、`exists` | `eq`、`ne`、`in`、数值比较、`prefix`、`wildcard` |
| `number` | `eq`、`ne`、`in`、`exists`、`gt`、`gte`、`lt`、`lte` | `contains`、`prefix`、`wildcard` |
| `boolean` | `eq`、`ne`、`in`、`exists` | `contains`、数值比较、`prefix`、`wildcard` |
| `datetime` | `eq`、`ne`、`in`、`exists`、`gt`、`gte`、`lt`、`lte` | `contains`、`prefix`、`wildcard` |

关键语义：

- `contains` 表示 `stringList` 包含一个元素，不是字符串子串匹配。
- `prefix` 只适用于 `string`，表示值以指定文本开头。
- `wildcard` 只适用于 `string`；`*` 匹配零个或多个字符，`?` 匹配一个字符。
- `gt`、`gte`、`lt`、`lte` 只适用于 `number` 和 `datetime`。
- `datetime` 使用 ISO 8601 字符串，建议显式携带时区偏移。

## 系统文件属性

以下字段无需注册，可直接用于 `where` 或通过 `--metadata-field` 请求返回：

| 字段 | 类型 | 含义 |
|---|---|---|
| `fileName` | `string` | 包含扩展名的文件名 |
| `fileType` | `string` | 小写扩展名，不含前导点 |
| `fileSize` | `number` | 原始文件字节数 |
| `mimeType` | `string` | MIME 类型 |
| `createdAt` | `datetime` | 文件记录创建时间 |
| `updatedAt` | `datetime` | 文件记录更新时间 |
| `fileSignature` | `string` | 原始内容 SHA-256 |
| `filePath` | `string` | 以 `/` 开头的知识库完整路径 |

不要使用 `createTime`、`updateTime` 等别名，也不要在自定义元数据中复用这些保留字段。

## 值与复杂度约束

- `string` 的值必须是字符串。
- `number` 的值必须是数值，布尔值不视为数值。
- `boolean` 的值必须是 JSON 布尔值。
- `datetime` 的值必须是 ISO 8601 字符串。
- 时间返回值会转换到后端 `DB_TIMEZONE`，默认时区为 `Asia/Shanghai`；输入建议显式携带时区偏移。
- `contains.value` 必须是单个字符串。
- `exists` 不得携带 `value`。
- `in.value` 必须是非空数组；`stringList` 不支持 `in`，应使用 `contains`。
- 最大布尔嵌套深度为 3。
- 最大叶子条件数为 12。
- 不支持 `between`、`regex`、脚本表达式或其他未列出的操作符。

## 常用示例

精确匹配：

```json
{"eq": {"fieldName": "status", "value": "active"}}
```

文件类型集合：

```json
{"in": {"fieldName": "fileType", "value": ["md", "pdf"]}}
```

列表包含元素：

```json
{"contains": {"fieldName": "tags", "value": "contract"}}
```

数值与时间组合：

```json
{
  "and": [
    {"gte": {"fieldName": "priority", "value": 3}},
    {"gte": {"fieldName": "updatedAt", "value": "2026-01-01T00:00:00+08:00"}}
  ]
}
```

嵌套组合：

```json
{
  "and": [
    {
      "or": [
        {"eq": {"fieldName": "status", "value": "active"}},
        {"eq": {"fieldName": "status", "value": "pending"}}
      ]
    },
    {"not": {"eq": {"fieldName": "archived", "value": true}}}
  ]
}
```

## 错误修正

CLI 先校验通用 AST 结构和复杂度；后端根据实际元数据定义校验字段、类型与操作符。

后端返回 `DSL_VALIDATION_ERROR` 时，依次检查：

- `errorList[].path`：错误所在 AST 路径。
- `errorList[].code`：例如未知字段、值类型错误或条件过多。
- `errorList[].message`：具体修正提示。

不要删除用户要求的过滤条件后静默重试。先修正字段名、操作符或值类型。
