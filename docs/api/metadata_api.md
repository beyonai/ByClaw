# 知识模块元数据与检索扩展接口说明

## 文档范围

本文档定义知识模块中与文件元数据、纯元数据检索、Agent 检索和业务检索相关的扩展接口。

- Base URL：`/api/v1`
- 协议：`HTTP`
- 默认返回：`application/json`

## 通用约定

### 成功响应

除特殊说明外，接口统一使用如下响应信封：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {}
}
```

说明：

- `resultCode`：接口状态码，`0` 表示成功，`-1` 表示失败
- `resultMsg`：接口返回说明
- `resultObject`：业务返回体；无额外返回时返回空对象

### 失败响应

普通失败时统一返回：

```json
{
  "resultCode": "-1",
  "resultMsg": "request validation failed",
  "resultObject": {}
}
```

对于 DSL 校验失败的接口，返回：

```json
{
  "resultCode": "-1",
  "resultMsg": "request validation failed",
  "resultObject": {
    "errorCode": "DSL_VALIDATION_ERROR",
    "errorList": [
      {
        "path": "filter.and[1].contains.fieldName",
        "code": "UNKNOWN_FIELD",
        "message": "fieldName 'tagz' is not defined"
      }
    ]
  }
}
```

### 路径字段约定

- `knCode`：知识库编码
- `knCodeList`：知识库编码列表
- `filePath`：文件路径，以 `/` 开头，不包含知识库名称
- `propertyName`：全局唯一的元数据属性名

### 元数据类型约定

当前支持以下元数据类型：

- `string`
- `stringList`
- `number`
- `boolean`
- `datetime`

### 检索模式约定

当前支持以下检索模式：

- `fullTextRecall`
- `embedding`
- `mixedRecall`

### 返回粒度约定

当前支持以下返回粒度：

- `file`
- `chunk`

## DSL 使用说明

本文档当前实现范围中的检索接口只涉及 Agent DSL。

Business DSL 及其对应接口已从当前实现范围中抽离，并标记为废弃候选，当前阶段不做。

### Agent DSL 是什么

Agent DSL 是一套专门用于定义 `where` 的结构化过滤表达式。调用方通过 `where` 传入一棵 JSON AST，服务端会先做 DSL 校验，再把它编译成内部查询条件，最终落到 SQL、全文检索或向量检索链路上。

服务端处理链路如下：

```text
Agent DSL
  -> Internal Query Plan
  -> SQL / FTS / Vector Retrieval
```

本章节只定义 `where` 本身的语法、语义、约束和限制；具体哪些接口支持 `where`、`where` 是否必填、以及可用字段范围，请以各接口定义为准。

### Agent DSL 解决什么问题

它主要解决“先按结构化条件缩小范围，再做检索或直接返回结果”的问题，典型场景包括：

- 精确过滤：例如“只看 `status=active` 的对象”
- 组合条件过滤：例如“同时满足状态、时间、标签等多个条件”
- 在更大检索流程前先缩小候选范围

### 如何使用

最小示例：

1. 单个叶子条件

```json
{
  "where": {
    "eq": {"fieldName": "status", "value": "active"}
  }
}
```

2. 布尔组合条件

```json
{
  "where": {
    "and": [
      {"eq": {"fieldName": "status", "value": "active"}},
      {"contains": {"fieldName": "tags", "value": "contract"}}
    ]
  }
}
```

3. 嵌套布尔条件

```json
{
  "where": {
    "and": [
      {
        "or": [
          {"eq": {"fieldName": "status", "value": "active"}},
          {"eq": {"fieldName": "status", "value": "pending"}}
        ]
      },
      {"gte": {"fieldName": "publishedAt", "value": "2026-01-01T00:00:00Z"}}
    ]
  }
}
```

### 表达式长什么样

`where` 采用 JSON AST 风格表达式。每个节点都必须是“恰好一个操作符”的对象。

布尔节点：

- `and`
- `or`
- `not`

叶子操作符：

- `eq`
- `ne`
- `in`
- `contains`
- `exists`
- `gt`
- `gte`
- `lt`
- `lte`
- `prefix`
- `wildcard`

叶子示例：

```json
{
  "eq": {
    "fieldName": "status",
    "value": "active"
  }
}
```

组合示例：

```json
{
  "and": [
    {"eq": {"fieldName": "status", "value": "active"}},
    {"contains": {"fieldName": "tags", "value": "contract"}}
  ]
}
```

布尔节点使用规则：

- `and` 和 `or` 的值必须是非空数组
- `not` 的值必须是单个子表达式对象，不能是数组
- 每个节点只能出现一个操作符；例如同一层不能同时放 `eq` 和 `ne`

### 按类型划分的叶子操作符与示例

以下各表按“字段类型”整理当前实现中可用的叶子操作符。这里描述的是 `fieldName` 对应字段类型与操作符的关系，不展开具体字段清单。近似语义的操作符放在同一行展示。

#### string

| 叶子操作符 | 用例 | 用例含义 |
| --- | --- | --- |
| `eq` / `ne` | `{"eq": {"fieldName": "status", "value": "active"}}` | `status` 精确等于 `active`；`ne` 表示不等于该值。 |
| `in` | `{"in": {"fieldName": "status", "value": ["active", "pending"]}}` | `status` 属于给定字符串集合之一。 |
| `exists` | `{"exists": {"fieldName": "status"}}` | 文件上存在 `status` 字段且值非空。 |
| `prefix` | `{"prefix": {"fieldName": "status", "value": "act"}}` | `status` 以前缀 `act` 开头，可理解为仅支持“末尾隐含 `*`”的简化版 `wildcard`。 |
| `wildcard` | `{"wildcard": {"fieldName": "status", "value": "act*"}}` | `status` 匹配通配模式；`*` 表示零个或多个字符，`?` 表示恰好一个字符。 |

不支持：

- `contains`
- `gt` / `gte` / `lt` / `lte`

#### stringList

| 叶子操作符 | 用例 | 用例含义 |
| --- | --- | --- |
| `contains` | `{"contains": {"fieldName": "tags", "value": "contract"}}` | `tags` 列表中包含元素 `contract`。 |
| `exists` | `{"exists": {"fieldName": "tags"}}` | 文件上存在 `tags` 字段且值非空。 |

不支持：

- `eq` / `ne`
- `in`
- `gt` / `gte` / `lt` / `lte`
- `prefix` / `wildcard`

#### number

| 叶子操作符 | 用例 | 用例含义 |
| --- | --- | --- |
| `eq` / `ne` | `{"eq": {"fieldName": "priority", "value": 5}}` | `priority` 精确等于 `5`；`ne` 表示不等于该值。 |
| `in` | `{"in": {"fieldName": "priority", "value": [1, 3, 5]}}` | `priority` 属于给定数值集合之一。 |
| `exists` | `{"exists": {"fieldName": "priority"}}` | 文件上存在 `priority` 字段且值非空。 |
| `gt` / `gte` / `lt` / `lte` | `{"gt": {"fieldName": "priority", "value": 5}}` | `priority > 5`；其余分别表示 `>=`、`<`、`<=`。 |

不支持：

- `contains`
- `prefix` / `wildcard`

#### boolean

| 叶子操作符 | 用例 | 用例含义 |
| --- | --- | --- |
| `eq` / `ne` | `{"eq": {"fieldName": "archived", "value": true}}` | `archived` 精确等于 `true`；`ne` 表示不等于该值。 |
| `in` | `{"in": {"fieldName": "archived", "value": [true]}}` | `archived` 属于给定布尔集合之一。 |
| `exists` | `{"exists": {"fieldName": "archived"}}` | 文件上存在 `archived` 字段且值非空。 |

不支持：

- `contains`
- `gt` / `gte` / `lt` / `lte`
- `prefix` / `wildcard`

#### datetime

| 叶子操作符 | 用例 | 用例含义 |
| --- | --- | --- |
| `eq` / `ne` | `{"eq": {"fieldName": "publishedAt", "value": "2026-05-15T10:00:00Z"}}` | 时间字段精确等于给定 ISO 8601 时间点；`ne` 表示不等于该值。 |
| `in` | `{"in": {"fieldName": "publishedAt", "value": ["2026-05-01T00:00:00Z", "2026-05-15T10:00:00Z"]}}` | 时间字段属于给定时间点集合之一。 |
| `exists` | `{"exists": {"fieldName": "publishedAt"}}` | 文件上存在该时间字段且值非空。 |
| `gt` / `gte` / `lt` / `lte` | `{"gte": {"fieldName": "publishedAt", "value": "2026-01-01T00:00:00Z"}}` | 时间字段晚于或等于给定时间点；其余分别表示严格大于、严格小于、小于等于。 |

不支持：

- `contains`
- `prefix` / `wildcard`

### `prefix` / `wildcard` 的使用规则

`prefix` 和 `wildcard` 仅适用于 `string` 类型字段。

`prefix` 可以把它理解为 `wildcard` 的简化版：

- `prefix.value = "report"` 的语义，近似等价于 `wildcard.value = "report*"`
- 它只表达“从某个前缀开始”，不支持在中间或开头写通配符

```json
{"prefix": {"fieldName": "fileName", "value": "report"}}
```

也就是说，上面的条件表示“匹配所有以 `report` 开头的值”。

`wildcard` 为通配符匹配，语法参考 ES `wildcard` 查询：

- `*` 匹配零个或多个字符
- `?` 匹配恰好一个字符
- 输入中的特殊字符会按实现规则自动转义

```json
{"wildcard": {"fieldName": "fileName", "value": "report_?.*"}}
```

实现层面，`prefix` 和 `wildcard` 最终都会被编译为 SQL `LIKE` 条件，并使用单字符 `ESCAPE '!'` 做转义；但调用方理解和编写 DSL 时，建议优先按上面的匹配语义来思考，而不是直接按 SQL 语法来思考。

### 叶子值类型校验

每个叶子节点的 `value` 必须与 `fieldName` 声明的类型一致，否则返回 `INVALID_FIELD_VALUE_TYPE`：

- `string`：`value` 必须是字符串
- `number`：`value` 必须是数值，不接受布尔值
- `boolean`：`value` 必须是布尔值
- `datetime`：`value` 必须是 ISO 8601 字符串，如 `2026-05-15T10:00:00Z`
- `stringList`：仅支持 `contains` 和 `exists`；其中 `contains.value` 必须是单个字符串

额外规则：

- `exists` 不应携带 `value`
- `in.value` 必须是非空数组
- `in` 不适用于 `stringList`，请改用 `contains`
- `gt/gte/lt/lte` 仅适用于 `number` 和 `datetime`

### 当前局限性

当前实现是“受控 DSL”，目的是让调用方能稳定地表达常见过滤条件，而不是提供一门无限扩展的查询语言。主要局限如下：

- 仅支持 `and` / `or` / `not` 三种布尔操作
- 仅支持 11 个叶子操作符，不支持 `between`、`regex`、脚本表达式等
- 最大布尔嵌套深度为 `3`
- 最大叶子条件数为 `12`
- `stringList` 只支持 `contains` 和 `exists`

### 使用建议

1. 纯元数据检索
   - 先从简单叶子条件开始
   - 确认单个条件正确后，再组合 `and` / `or` / `not`
2. 通配匹配
   - 只需要“某前缀开头”时优先用 `prefix`
   - 只有确实需要 `*` / `?` 语义时再使用 `wildcard`
3. 条件复杂度
   - 尽量避免过深嵌套
   - 尽量控制叶子条件数量，便于排查错误

### DSL 错误修正

DSL 校验失败时，优先根据以下字段修正请求：

- `errorList[].path`
- `errorList[].code`
- `errorList[].message`

## 接口总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/metadataProperties/create` | 新增元数据属性定义 |
| `POST` | `/api/v1/metadataProperties/batchCreate` | 批量新增元数据属性定义 |
| `POST` | `/api/v1/metadataProperties/delete` | 删除元数据属性定义 |
| `POST` | `/api/v1/metadataProperties/list` | 查看元数据属性定义，支持按属性名过滤 |
| `POST` | `/api/v1/knowledgeItems/metadata/update` | 统一更新文件元数据 |
| `POST` | `/api/v1/knowledgeItems/metadata/get` | 查看文件元数据 |
| `POST` | `/api/v1/knowledgeItems/metadataFields/list` | 查看知识库下实际已使用的元数据属性 |
| `POST` | `/api/v1/knowledgeItems/metadataSearch` | Agent DSL 版纯元数据检索 |
| `POST` | `/api/v1/knowledgeItems/search` | 基于原检索接口升级的 Agent DSL 版 chunk 级语义检索 |
| `POST` | `/api/v1/knowledgeItems/searchFile` | Agent DSL 版文件级语义检索 |

## 元数据属性定义

### `POST /api/v1/metadataProperties/create`

新增全局元数据属性定义。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `propertyName` | string | 是 | 全局唯一字段名 |
| `valueType` | string | 是 | 属性类型 |
| `description` | string | 否 | 描述 |
| `extParams` | object | 否 | 业务系统透传的扩展参数 |

请求示例：

```json
{
  "propertyName": "status",
  "valueType": "string",
  "description": "用于标记文档状态",
  "extParams": {
    "sourceSystem": "oa",
    "displayOrder": 10
  }
}
```

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "propertyName": "status",
    "valueType": "string",
    "description": "用于标记文档状态",
    "extParams": {
      "sourceSystem": "oa",
      "displayOrder": 10
    }
  }
}
```

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "metadata property already exists: status",
  "resultObject": {}
}
```

### `POST /api/v1/metadataProperties/batchCreate`

批量新增全局元数据属性定义。

说明：

- 该接口要求原子执行。
- 当任意一个属性创建失败时，整批请求整体回滚，不保留部分成功结果。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `propertyList` | array[object] | 是 | 待批量创建的属性定义列表 |

`propertyList` 单项字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `propertyName` | string | 是 | 全局唯一字段名 |
| `valueType` | string | 是 | 属性类型 |
| `description` | string | 否 | 描述 |
| `extParams` | object | 否 | 业务系统透传的扩展参数 |

请求示例：

```json
{
  "propertyList": [
    {
      "propertyName": "status",
      "valueType": "string",
      "description": "用于标记文档状态",
      "extParams": {
        "sourceSystem": "oa",
        "displayOrder": 10
      }
    },
    {
      "propertyName": "tags",
      "valueType": "stringList",
      "description": "用于标记文档主题",
      "extParams": {
        "sourceSystem": "oa",
        "displayOrder": 20
      }
    }
  ]
}
```

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {
        "propertyName": "status",
        "valueType": "string",
        "description": "用于标记文档状态",
        "extParams": {
          "sourceSystem": "oa",
          "displayOrder": 10
        }
      },
      {
        "propertyName": "tags",
        "valueType": "stringList",
        "description": "用于标记文档主题",
        "extParams": {
          "sourceSystem": "oa",
          "displayOrder": 20
        }
      }
    ]
  }
}
```

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "metadata property already exists: status",
  "resultObject": {}
}
```

### `POST /api/v1/metadataProperties/delete`

删除全局元数据属性定义。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `propertyName` | string | 是 | 需要删除的属性名 |

请求示例：

```json
{
  "propertyName": "status"
}
```

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {}
}
```

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "metadata property is still referenced: status",
  "resultObject": {}
}
```

### `POST /api/v1/metadataProperties/list`

查看元数据属性定义，支持按属性名过滤。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `propertyNameList` | array[string] | 否 | 按属性名过滤；不传表示返回全部 |

请求示例：

```json
{
  "propertyNameList": ["status", "tags"]
}
```

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {
        "propertyName": "status",
        "valueType": "string",
        "description": "用于标记文档状态",
        "extParams": {
          "sourceSystem": "oa",
          "displayOrder": 10
        }
      },
      {
        "propertyName": "tags",
        "valueType": "stringList",
        "description": "用于标记文档主题",
        "extParams": {
          "sourceSystem": "oa",
          "displayOrder": 20
        }
      }
    ]
  }
}
```

单个属性查询示例：

```json
{
  "propertyNameList": ["status"]
}
```

## 文件元数据管理

### `POST /api/v1/knowledgeItems/metadata/update`

统一更新文件元数据，是唯一的文件元数据写接口。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 文件路径 |
| `operationList` | array[object] | 是 | 元数据更新操作列表 |

`operationList` 单项字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `propertyName` | string | 是 | 属性名 |
| `operation` | string | 是 | `set`、`unset`、`append`、`remove`、`clear` |
| `value` | any | 否 | 操作值；`unset` 和 `clear` 可不传 |

更新规则：

- 标量类型支持：`set`、`unset`
- `stringList` 类型支持：`set`、`append`、`remove`、`clear`、`unset`
- `set` 用于新增属性或整值覆盖
- `unset` 用于删除整个属性
- `append` 追加不存在元素，已存在元素不重复追加
- `remove` 删除命中的元素，不报不存在错误
- `clear` 将列表属性置为空列表 `[]`，不删除属性本身

请求示例：

```json
{
  "knCode": "2",
  "filePath": "/制度/人事/续签流程.md",
  "operationList": [
    {
      "propertyName": "tags",
      "operation": "append",
      "value": ["contract", "renewal"]
    },
    {
      "propertyName": "status",
      "operation": "set",
      "value": "active"
    },
    {
      "propertyName": "owner",
      "operation": "unset"
    }
  ]
}
```

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "knCode": "2",
    "filePath": "/制度/人事/续签流程.md",
    "metadata": {
      "tags": {
        "valueType": "stringList",
        "value": ["hr", "contract", "renewal"]
      },
      "status": {
        "valueType": "string",
        "value": "active"
      }
    }
  }
}
```

说明：

- 成功响应中的 `metadata` 只返回本次被修改属性在操作完成后的完整最新值。
- 每个属性返回 `valueType` 和 `value`，避免调用方额外查询属性定义。
- 对于 `unset` 后已不存在的属性，不出现在返回结果中。
- 对于 `clear` 后的列表属性，会返回空列表值。

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "operation append is not allowed for property type: string",
  "resultObject": {}
}
```

### `POST /api/v1/knowledgeItems/metadata/get`

查看文件元数据。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 文件路径 |
| `metadataFieldList` | array[string] | 否 | 指定返回的属性名列表；不传时默认返回全部未删除元数据 |

请求示例：

```json
{
  "knCode": "2",
  "filePath": "/制度/人事/续签流程.md"
}
```

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "knCode": "2",
    "filePath": "/制度/人事/续签流程.md",
    "metadata": {
      "status": {
        "valueType": "string",
        "value": "active"
      },
      "tags": {
        "valueType": "stringList",
        "value": ["hr", "contract"]
      },
      "priority": {
        "valueType": "number",
        "value": 3
      }
    }
  }
}
```

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "file not found: /制度/人事/续签流程.md",
  "resultObject": {}
}
```

说明：

- `metadata/get` 返回的 `metadata` 使用统一 typed 结构。
- 每个属性返回 `valueType` 和 `value`。

### `POST /api/v1/knowledgeItems/metadataFields/list`

查看指定知识库列表下实际已使用的元数据属性。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCodeList` | array[string] | 是 | 知识库编码列表 |

请求示例：

```json
{
  "knCodeList": ["2", "3"]
}
```

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {
        "propertyName": "status",
        "valueType": "string",
        "description": "用于标记文档状态"
      },
      {
        "propertyName": "tags",
        "valueType": "stringList",
        "description": "用于标记文档主题"
      }
    ]
  }
}
```

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "knCodeList must not be empty",
  "resultObject": {}
}
```

## 纯元数据检索

### `POST /api/v1/knowledgeItems/metadataSearch`

Agent DSL 版纯元数据检索，只返回文件级结果。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCodeList` | array[string] | 否 | 知识库范围 |
| `where` | object | 是 | Agent DSL 过滤 AST |
| `metadataFieldList` | array[string] | 否 | 需要返回的元数据字段 |
| `topK` | integer | 否 | 返回条数，省略时默认 500，最大 10000 |

请求示例：

```json
{
  "knCodeList": ["2"],
  "where": {
    "and": [
      {"eq": {"fieldName": "status", "value": "active"}},
      {"contains": {"fieldName": "tags", "value": "contract"}}
    ]
  },
  "metadataFieldList": ["status", "tags"],
  "topK": 20
}
```

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {
        "knCode": "2",
        "filePath": "/制度/人事/续签流程.md",
        "metadata": {
          "status": {
            "valueType": "string",
            "value": "active"
          },
          "tags": {
            "valueType": "stringList",
            "value": ["hr", "contract"]
          }
        }
      }
    ]
  }
}
```

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "request validation failed",
  "resultObject": {
    "errorCode": "DSL_VALIDATION_ERROR",
    "errorList": [
      {
        "path": "where.and[2]",
        "code": "TOO_MANY_CONDITIONS",
        "message": "leaf condition count exceeds limit 12"
      }
    ]
  }
}
```

## 语义检索

### `POST /api/v1/knowledgeItems/search`

基于 [api.md](docs/modules/knowledge/api.md:1) 中原有 `POST /api/v1/knowledgeItems/search` 升级后的 Agent DSL 版 chunk 级语义检索。

说明：

- 当前方案确定为升级原 `/api/v1/knowledgeItems/search` 接口，不新增 `searchChunk` 接口。
- 在保留原接口能力的基础上，新增 Agent DSL 风格的 `where` 过滤、`knCodeList` 范围控制和 `metadataFieldList` 元数据返回控制。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | string | 是 | 检索文本 |
| `knCodeList` | array[string] | 是 | 知识库范围 |
| `where` | object | 否 | Agent DSL 过滤 AST |
| `searchMode` | string | 是 | 检索模式 |
| `metadataFieldList` | array[string] | 否 | 需要返回的元数据字段 |
| `topK` | integer | 是 | 返回条数，必须大于 0 |
| `fileTypeList` | array[string] | 否 | 按文件类型过滤；向下兼容字段，与 `where` 同时存在时合取 |

> 推荐通过 `where` 中的 `fileType` 系统字段表达文件类型过滤，例如 `{"in": {"fieldName": "fileType", "value": ["md", "pdf"]}}`。`fileTypeList` 仅为兼容老调用方保留，新代码不要依赖。

请求示例：

```json
{
  "query": "续签流程",
  "where": {
    "eq": {
      "fieldName": "status",
      "value": "active"
    }
  },
  "metadataFieldList": ["status"],
  "topK": 10,
  "searchMode": "mixedRecall",
  "knCodeList": ["2"]
}
```

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {
        "knCode": "2",
        "filePath": "/制度/人事/续签流程.md",
        "chunkId": 1024,
        "chunkNo": 3,
        "chunkText": "合同续签需由业务负责人发起审批。",
        "score": 92.5,
        "startLine": 18,
        "endLine": 24,
        "metadata": {
          "status": {
            "valueType": "string",
            "value": "active"
          }
        }
      }
    ]
  }
}
```

### `POST /api/v1/knowledgeItems/searchFile`

Agent DSL 版文件级语义检索。

实现说明：

- 先按 chunk 粒度召回 `topK * 50` 条候选结果
- 再按 `knCode + filePath` 聚合为文件级结果
- 最终最多返回 `topK` 个文件

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | string | 是 | 检索文本 |
| `knCodeList` | array[string] | 否 | 知识库范围 |
| `where` | object | 否 | Agent DSL 过滤 AST |
| `searchMode` | string | 是 | 检索模式 |
| `metadataFieldList` | array[string] | 否 | 需要返回的元数据字段 |
| `topK` | integer | 是 | 返回条数，必须大于 0 |

请求示例：

```json
{
  "query": "续签流程",
  "where": {
    "eq": {
      "fieldName": "status",
      "value": "active"
    }
  },
  "metadataFieldList": ["status", "tags"],
  "topK": 10,
  "searchMode": "mixedRecall",
  "knCodeList": ["2"]
}
```

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {
        "knCode": "2",
        "filePath": "/制度/人事/续签流程.md",
        "score": 94.2,
        "metadata": {
          "status": {
            "valueType": "string",
            "value": "active"
          },
          "tags": {
            "valueType": "stringList",
            "value": ["hr", "contract"]
          }
        }
      }
    ]
  }
}
```

文件级 `score` 为聚合后的最终排序分值，具体融合策略由服务端内部实现决定。

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "request validation failed",
  "resultObject": {
    "errorCode": "DSL_VALIDATION_ERROR",
    "errorList": [
      {
        "path": "where.eq.fieldName",
        "code": "UNKNOWN_FIELD",
        "message": "fieldName 'statuz' is not defined"
      }
    ]
  }
}
```

## 已废弃接口

以下业务 DSL 接口已从当前实现范围中抽离，标记为废弃候选，当前阶段不实现：

- `/api/v1/knowledgeItems/metadataSearch`
- `/api/v1/knowledgeItems/searchFile`

说明：

- `/api/v1/knowledgeItems/metadataSearch` 与 `/api/v1/knowledgeItems/searchFile` 当前已被 Agent DSL 版接口占用
- chunk 级业务 DSL 检索接口历史上曾候选为 `/api/v1/knowledgeItems/searchChunk`，当前方案改为基于 `/api/v1/knowledgeItems/search` 升级实现
- 归档文档中的业务 DSL 契约仅作为历史设计留档，不代表当前生效接口定义

归档文档：

- [metadata_business_api_deprecated.md](/Users/jialangli/code/workspace/by-qa/docs/modules/knowledge/metadata_business_api_deprecated.md:1)

对应的 Business DSL 说明同样仅保留在归档设计范围，不进入当前接口实现范围。
