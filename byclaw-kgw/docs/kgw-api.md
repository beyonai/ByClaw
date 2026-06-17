# 知识网关接口说明

## 文档范围

本文档定义 byclaw-kgw（知识网关）对外开放的全部接口。

- 业务接口 Base URL：`/kgw/api/v1`
- ingest 接口 Base URL：`/kgw/ingest/v1`
- 管理接口 Base URL：`/kgw/admin/v1`
- 协议：`HTTP`
- 默认返回：`application/json`
- 上传文档接口请求体：`multipart/form-data`
- 下载文件接口成功响应：`application/octet-stream`

## 通用约定

### 成功响应

除下载文件接口外，接口统一使用如下响应信封：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {}
}
```

- `resultCode`：`"0"` 表示成功，`"-1"` 表示失败
- `resultMsg`：接口返回说明
- `resultObject`：业务返回体；无额外返回时为空对象

### 失败响应

```json
{
  "resultCode": "-1",
  "resultMsg": "错误描述",
  "resultObject": {}
}
```

### 公共请求头

| Header | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `X-User-Id` | string | 是 | 调用方用户标识，网关据此从 Redis 获取鉴权信息 |
| `X-Trace-Id` | string | 否 | 链路追踪 ID，贯穿全链路日志 |

### 路径字段约定

- `knCode`：知识库编码（门户维护唯一性）
- `directoryPath`：目录路径，以 `/` 开头，不包含知识库名称
- `filePath`：文件路径，以 `/` 开头，不包含知识库名称
- `propertyName`：全局唯一的元数据属性名

---

## 接口总览

### 目录管理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/kgw/api/v1/directories/create` | 创建目录 |
| `POST` | `/kgw/api/v1/directories/update` | 修改目录（重命名） |
| `POST` | `/kgw/api/v1/directories/delete` | 删除目录 |

### 文档管理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/kgw/api/v1/knowledgeItems/import` | 上传文档（支持 markdown front-matter 元数据写入） |
| `POST` | `/kgw/api/v1/knowledgeItems/delete` | 删除文档 |

### 文件读取与构建

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/kgw/api/v1/listDir` | 获取目录内容 |
| `POST` | `/kgw/api/v1/glob` | 按路径模式匹配文件 |
| `POST` | `/kgw/api/v1/readFile` | 读取文件内容（Markdown 形式） |
| `POST` | `/kgw/api/v1/downloadFile` | 下载原始文件 |
| `POST` | `/kgw/api/v1/fileToMarkdownIndex` | 异步触发知识构建 |
| `POST` | `/kgw/api/v1/fileBuildStatus` | 查询文档构建状态 |
| `GET` | `/kgw/api/v1/dslGuide` | 获取 DSL 构建指引（静态内容） |

### 检索

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/kgw/api/v1/knowledgeItems/search` | 多知识库并行语义检索 |
| `POST` | `/kgw/api/v1/knowledgeItems/metadataSearch` | 多知识库并行元数据检索 |
| `POST` | `/kgw/api/v1/knowledgeItems/searchFile` | 多知识库并行文件级检索 |

### 文件元数据

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/kgw/api/v1/knowledgeItems/metadata/update` | 更新文件元数据（set/unset/append/remove/clear） |
| `POST` | `/kgw/api/v1/knowledgeItems/metadata/get` | 获取文件元数据 |
| `POST` | `/kgw/api/v1/knowledgeItems/metadataFields/list` | 列出指定 KB 已同步的元数据属性 |

### 元数据属性主目录

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/kgw/api/v1/metadataProperties/create` | 声明单个元数据属性 |
| `POST` | `/kgw/api/v1/metadataProperties/batchCreate` | 批量声明元数据属性 |
| `POST` | `/kgw/api/v1/metadataProperties/list` | 列出全部 ACTIVE 属性 |
| `POST` | `/kgw/api/v1/metadataProperties/delete` | 删除元数据属性（binding 非空时拒绝） |

### Ingest 数据导入

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/kgw/ingest/v1/events` | 推送单条数据变更事件 |
| `POST` | `/kgw/ingest/v1/events/batch` | 批量推送数据变更事件（最多 100 条） |
| `GET` | `/kgw/ingest/v1/events/{eventId}` | 查询单事件处理状态 |
| `GET` | `/kgw/ingest/v1/events` | 按条件查询事件列表 |
| `POST` | `/kgw/ingest/v1/events/{eventId}/replay` | 重放失败事件（仅支持 op=delete） |

### 管理接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/kgw/admin/v1/audit` | 审计日志查询 |
| `GET` | `/kgw/admin/v1/conflicts` | 冲突日志查询 |
| `POST` | `/kgw/admin/v1/kbs/{knCode}/files/{filePath}/lock` | 锁定文件（防 ingest 覆盖） |
| `POST` | `/kgw/admin/v1/kbs/{knCode}/files/{filePath}/unlock` | 解锁文件 |
| `GET` | `/kgw/admin/v1/metadata-properties` | 查看全部元数据属性（含 DELETED 和同步状态） |
| `GET` | `/kgw/admin/v1/metadata-properties/orphans` | 查询指定 KB 的死列（未在 sync 表中的 backend_name） |
| `POST` | `/kgw/admin/v1/metadata-properties/{propertyName}/sync-retry` | 强制重试 FAILED 同步 |
| `POST` | `/kgw/admin/v1/metadata-properties/{propertyName}/purge-retry` | 强制重试 PURGE_FAILED 清理 |

---

## 目录管理

### `POST /kgw/api/v1/directories/create`

在指定知识库下创建目录，支持递归创建。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `directoryPath` | string | 是 | 需创建的目录路径，以 `/` 开头 |
| `directoryDescription` | string | 否 | 目录描述 |

请求示例：

```json
{
  "knCode": "2",
  "directoryPath": "/制度/人事/考勤",
  "directoryDescription": "考勤制度目录"
}
```

成功响应：`resultCode: "0"`, `resultObject: {}`

### `POST /kgw/api/v1/directories/update`

修改目录名称（仅修改 `directoryPath` 最后一层）。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `directoryPath` | string | 是 | 需修改的目录路径 |
| `directoryName` | string | 是 | 新目录名称 |

### `POST /kgw/api/v1/directories/delete`

删除指定知识库的目录及其下全部内容。同时清除该目录下所有文件的元数据 binding 记录。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `directoryPath` | string | 是 | 需删除的目录路径 |

---

## 文档管理

### `POST /kgw/api/v1/knowledgeItems/import`

将文档上传到指定知识库。对于 markdown 文件，若文件包含 YAML front-matter，网关会自动将其中的 `propertyName` 键改写为后端 `backend_name`（如 `__byclaw_kgw__status__v7`）再上传；`propertyName` 必须已在元数据属性主目录中声明。

请求体：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 上传后的文件全路径，以 `/` 开头 |
| `fileContent` | file | 是 | 文件二进制内容 |

成功响应：`resultCode: "0"`, `resultObject: {}`

### `POST /kgw/api/v1/knowledgeItems/delete`

删除指定知识库下的文档。成功后同时清除该文件的元数据 binding 记录。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 需删除的文件全路径 |

---

## 文件读取与构建

### `POST /kgw/api/v1/listDir`

获取指定知识库目录下的文件和子目录列表。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `directoryPath` | string | 是 | 目录路径，以 `/` 开头 |

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {"knCode": "2", "name": "/制度/人事/考勤", "type": "directory", "size": 0},
      {"knCode": "2", "name": "/制度/人事/请假制度.pdf", "type": "file", "size": 245760}
    ]
  }
}
```

### `POST /kgw/api/v1/glob`

按路径模式匹配查找文件或目录。`*` 匹配单层路径段，不支持 `**`。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `pathRule` | string | 是 | 匹配模式，以 `/` 开头，如 `/制度/*/*.pdf` |

### `POST /kgw/api/v1/readFile`

读取文件内容，以 Markdown 文本形式返回。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 文件全路径 |
| `startLine` | integer | 否 | 起始行，不填则从头读取 |
| `endLine` | integer | 否 | 结束行，不填则读到末尾 |

### `POST /kgw/api/v1/downloadFile`

下载指定文件原始二进制内容。

成功响应：`Content-Type: application/octet-stream`，响应体为文件字节流。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 文件全路径 |

### `POST /kgw/api/v1/fileToMarkdownIndex`

异步触发指定文件的知识构建（原始文件转 Markdown → 切片 → 向量化）。接口立即返回，构建在后台进行；通过 `fileBuildStatus` 轮询进度。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 需构建的文件全路径 |

### `POST /kgw/api/v1/fileBuildStatus`

查询文档构建状态。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 文件全路径 |

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "status": "processing",
    "currentStep": "vectorizing",
    "currentStepStatus": "running"
  }
}
```

`status` 取值：`processing` / `success` / `failed`
`currentStep` 取值：`markdown` / `chunking` / `vectorizing` / `complete`

### `GET /kgw/api/v1/dslGuide`

返回当前知识库支持的 DSL 字段定义（静态文档内容，无需请求体）。供前端或 Agent 构建检索条件时参考。

---

## 检索

检索接口支持多知识库并行扇出：`knCodeList` 中每个 KB 独立调用后端，单个 KB 失败会被标记为 `degraded_kbs`，不影响其他 KB 的结果返回。

响应中的元数据字段名由 `backend_name`（如 `__byclaw_kgw__status__v7`）自动反向翻译为 `propertyName`（如 `status`）。

### `POST /kgw/api/v1/knowledgeItems/search`

多知识库并行语义检索，返回知识切片列表。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCodeList` | array[string] | 是 | 知识库编码列表 |
| `query` | string | 是 | 检索内容 |
| `topK` | integer | 是 | 最终返回条数，须大于 0 |
| `searchMode` | string | 是 | `fullTextRecall` / `embedding` / `mixedRecall` |
| `fileTypeList` | array[string] | 否 | 按文件类型过滤 |
| `where` | object | 否 | 元数据过滤 DSL，字段名使用 `propertyName`（网关自动翻译） |
| `metadataFieldList` | array[string] | 否 | 响应中需返回的元数据字段（`propertyName`） |

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {
        "knCode": "2",
        "filePath": "/制度/人事/请假制度.pdf",
        "chunkNo": 3,
        "chunkId": 10023,
        "chunkText": "员工请假需在 OA 系统发起申请……",
        "score": 92,
        "metadata": {"status": "active"}
      }
    ],
    "degraded_kbs": []
  }
}
```

### `POST /kgw/api/v1/knowledgeItems/metadataSearch`

多知识库并行纯元数据检索，不做语义召回，仅按元数据条件过滤文件。参数与 `search` 相同，`query` 和 `topK` 可不传。

### `POST /kgw/api/v1/knowledgeItems/searchFile`

多知识库并行文件级检索，返回文件而非切片。参数与 `search` 相同。

---

## 文件元数据

文件元数据操作依赖**元数据属性主目录**（见下一节）。每个 `propertyName` 必须先在主目录中声明，才能在文件元数据接口中使用。首次对某个 (property, KB) 组合写入时，网关会自动将该属性同步到后端 KB（lazy sync）。

### `POST /kgw/api/v1/knowledgeItems/metadata/update`

更新指定文件的元数据字段，支持 set/unset/append/remove/clear 操作。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 文件全路径 |
| `operationList` | array[object] | 是 | 操作列表，见下方 |

`operationList` 单项结构：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `propertyName` | string | 是 | 元数据属性名（必须在主目录 ACTIVE） |
| `operation` | string | 是 | `set` / `unset` / `append` / `remove` / `clear` |
| `value` | any | set/append/remove 时必填 | 属性值，类型须与 `valueType` 匹配 |

操作与 `valueType` 兼容关系：

| valueType | 支持操作 |
| --- | --- |
| `string` / `number` / `boolean` / `datetime` | `set` / `unset` |
| `stringList` | `set` / `unset` / `append` / `remove` / `clear` |

请求示例：

```json
{
  "knCode": "2",
  "filePath": "/制度/人事/请假制度.pdf",
  "operationList": [
    {"propertyName": "status", "operation": "set", "value": "active"},
    {"propertyName": "tags", "operation": "append", "value": "人事"}
  ]
}
```

失败响应（属性未声明）：

```json
{
  "resultCode": "-1",
  "resultMsg": "metadata property not found: status",
  "resultObject": {"errorCode": "MetadataPropertyNotFound"}
}
```

### `POST /kgw/api/v1/knowledgeItems/metadata/get`

获取指定文件的元数据字段值。读路径，不触发 lazy sync，不写 binding。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 文件全路径 |
| `metadataFieldList` | array[string] | 否 | 需返回的属性名列表（`propertyName`），不传则返回全部 |

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "knCode": "2",
    "filePath": "/制度/人事/请假制度.pdf",
    "metadata": {"status": "active", "tags": ["人事", "制度"]}
  }
}
```

### `POST /kgw/api/v1/knowledgeItems/metadataFields/list`

列出指定 KB 列表中已通过网关同步的元数据属性。仅返回 sync 状态为 `SYNCED` 且主目录状态为 `ACTIVE` 的属性。不调用后端，仅查本地 sync 表。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCodeList` | array[string] | 是 | 知识库编码列表 |

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {"propertyName": "status", "valueType": "string", "description": "文档状态"},
      {"propertyName": "tags", "valueType": "stringList", "description": null}
    ]
  }
}
```

---

## 元数据属性主目录

元数据属性是**全局声明、惰性同步**的：`create` 只写网关本地表，不调后端；首次对某个 KB 使用该属性时（写文件元数据、import、ingest），网关自动调后端 `metadataProperties/batchCreate` 创建对应列（lazy sync）。

后端列命名规则：`__byclaw_kgw__{propertyName}__v{property_id}`，版本后缀确保重名再造不冲突。

### `POST /kgw/api/v1/metadataProperties/create`

声明单个元数据属性。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `propertyName` | string | 是 | 属性名，全局唯一（ACTIVE 范围内） |
| `valueType` | string | 是 | `string` / `stringList` / `number` / `boolean` / `datetime` |
| `description` | string | 否 | 属性描述 |
| `extParams` | object | 否 | 扩展参数 |

请求示例：

```json
{
  "propertyName": "status",
  "valueType": "string",
  "description": "文档状态"
}
```

成功响应：`resultCode: "0"`, `resultObject` 包含新创建的属性信息。

失败响应（属性名已存在）：

```json
{
  "resultCode": "-1",
  "resultMsg": "metadata property already exists: status",
  "resultObject": {"errorCode": "MetadataPropertyAlreadyExists"}
}
```

### `POST /kgw/api/v1/metadataProperties/batchCreate`

原子批量声明多个元数据属性。批内任一项失败则整批回滚。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `propertyList` | array[object] | 是 | 属性列表，每项结构同 `create` |

### `POST /kgw/api/v1/metadataProperties/list`

列出全部 ACTIVE 元数据属性。支持按名称过滤。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `propertyNameList` | array[string] | 否 | 按名称过滤，不传则返回全部 ACTIVE |

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {"propertyName": "status", "valueType": "string", "description": "文档状态"},
      {"propertyName": "tags", "valueType": "stringList", "description": null}
    ]
  }
}
```

### `POST /kgw/api/v1/metadataProperties/delete`

删除元数据属性。若存在 binding（即有文件正在使用该属性），则拒绝删除并返回占用详情。

删除成功后，后端对应列（`__byclaw_kgw__*`）由 cleanup worker 异步清理，不影响前台响应时间。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `propertyName` | string | 是 | 需删除的属性名 |

失败响应（属性被使用中）：

```json
{
  "resultCode": "-1",
  "resultMsg": "metadata property is still referenced: status",
  "resultObject": {
    "errorCode": "MetadataPropertyInUse",
    "propertyName": "status",
    "inUseSamples": [
      {"knCode": "2", "filePath": "/制度/续签流程.md"}
    ],
    "totalReferences": 1
  }
}
```

---

## Ingest 数据导入

Ingest 接口面向外部知识源 Connector，通过推送 StandardItem 事件驱动 KB 写入。支持幂等、版本单调性校验和 DLQ。

### StandardItem（标准数据条目）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sourceId` | string | 是 | Connector 对源端数据源的标识 |
| `itemId` | string | 是 | 在 `sourceId` 范围内唯一的条目标识 |
| `version` | string | 否 | 源端版本标识（时间戳/etag/递增序号）。传入时做幂等和版本单调性校验 |
| `op` | string | 是 | 操作类型：`"upsert"` 或 `"delete"` |
| `knCode` | string | 是 | 目标知识库编码 |
| `filePath` | string | upsert 必填 | 文件写入路径，以 `/` 开头 |
| `title` | string | 否 | 文件标题 |
| `content` | string / object | upsert 必填 | 文件内容，支持三种格式（见下方） |
| `contentType` | string | 否 | 如 `"text/markdown"`、`"application/pdf"` |
| `metadata` | object | 否 | 元数据键值对，键须在网关主目录 ACTIVE 中声明 |
| `sourceTimestamp` | string | 否 | 源端变更时间（ISO 8601） |
| `extra` | object | 否 | 调试/审计用附加信息，不写入 KB |

`content` 支持三种格式：

**内联文本：**
```json
{"content": "# 文档正文...", "contentType": "text/markdown"}
```

**内联 Base64（小文件）：**
```json
{"content": {"encoding": "base64", "data": "JVBERi0xLjQ..."}, "contentType": "application/pdf"}
```

**远程引用（最大 50MB，由网关下载）：**
```json
{"content": {"url": "https://files.example.com/doc.pdf"}}
```

### 幂等处理

基于 `(sourceId, itemId, version)` 组合去重。`version` 为 `null` 时不做幂等。

| 已有记录状态 | 返回 | 行为 |
| --- | --- | --- |
| `done` | 200 + `"already-processed"` | 不重复写 KB |
| `received` | 409 + `"in_progress"` | Connector 退避重试 |
| `failed` | 200 + `"failed"` + 错误详情 | Connector 决定是否修正后 replay |

### 单事件处理流水线（upsert）

1. knCode 校验 → 未知 knCode 返回 422
2. metadata key 校验 → 未声明属性返回 422（不落库）
3. 幂等 INSERT（status=received）
4. source_lock 检查 → 被锁定则 mark_failed(SOURCE_LOCKED)
5. version 单调性 → 旧版本则 mark_failed(STALE_VERSION)
6. fileImport（multipart 上传，不做预删除，重复文件由后端决定行为）
7. metadata/update（若携带 metadata，先 lazy sync + binding 维护）
8. fileToMarkdownIndex（触发知识构建，fire-and-forget，失败仅记 warning）
9. mark_done

整个步骤 6-9 有 30s 超时，超时则 mark_failed(PROCESSING_TIMEOUT)。

---

### `POST /kgw/ingest/v1/events`

推送单条数据变更事件，同步处理。

**限制：**
- 请求体 ≤ 4MB（超限返回 413）
- 单 Pod 并发槽 100（满载时返回 503 + `Retry-After: 5`）

请求示例（upsert）：

```json
{
  "sourceId": "gbrain-vault",
  "itemId": "hr/leave-policy",
  "version": "2026-06-07T10:00:00Z",
  "op": "upsert",
  "knCode": "2",
  "filePath": "/制度/人事/请假制度.md",
  "content": "# 请假制度\n\n...",
  "contentType": "text/markdown",
  "metadata": {"status": "active"},
  "sourceTimestamp": "2026-06-07T10:00:00Z"
}
```

成功响应：

```json
{
  "resultCode": "0",
  "resultMsg": "done",
  "resultObject": {"eventId": 12345, "status": "done"}
}
```

失败响应（事件处理失败，已进 DLQ）：

```json
{
  "resultCode": "-1",
  "resultMsg": "UPSTREAM_ERROR",
  "resultObject": {
    "eventId": 12345,
    "status": "failed",
    "errorType": "UPSTREAM_ERROR",
    "errorMessage": "KB backend timeout after 30s"
  }
}
```

### `POST /kgw/ingest/v1/events/batch`

批量推送，一次最多 100 条。单条独立校验和处理，部分失败不影响其他条目。

请求体：

```json
{
  "events": [
    { "sourceId": "...", "itemId": "doc-1", "op": "upsert", "knCode": "2", "filePath": "/a.md", "content": "..." },
    { "sourceId": "...", "itemId": "doc-2", "op": "upsert", "knCode": "2", "filePath": "/b.md", "content": "..." }
  ]
}
```

成功响应（全部成功，`resultCode: "0"`）：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "total": 2, "succeeded": 2, "failed": 0,
    "results": [
      {"eventId": 1, "status": "done", "itemId": "doc-1"},
      {"eventId": 2, "status": "done", "itemId": "doc-2"}
    ]
  }
}
```

部分失败时 `resultCode: "-1"`，`resultMsg: "partial success"`。

### `GET /kgw/ingest/v1/events/{eventId}`

查询单条事件的处理状态。

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "eventId": 12345,
    "sourceId": "gbrain-vault",
    "itemId": "hr/leave-policy",
    "version": "2026-06-07T10:00:00Z",
    "op": "upsert",
    "knCode": "2",
    "filePath": "/制度/人事/请假制度.md",
    "status": "done",
    "errorType": null,
    "errorMessage": null,
    "retryCount": 0,
    "doneAt": "2026-06-07T10:00:01Z"
  }
}
```

### `GET /kgw/ingest/v1/events`

按条件分页查询事件列表。

查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `sourceId` | string | 源端数据源标识 |
| `itemId` | string | 条目标识 |
| `knCode` | string | 知识库编码 |
| `status` | string | `received` / `done` / `failed` |
| `fromTime` | string | 起始时间（ISO 8601） |
| `toTime` | string | 结束时间（ISO 8601） |
| `pageSize` | integer | 每页条数，默认 20，最大 100 |
| `page` | integer | 页码，从 1 开始 |

### `POST /kgw/ingest/v1/events/{eventId}/replay`

重放失败事件。**仅支持 `status=failed` 且 `op=delete` 的事件**（upsert 事件无法重放，需 Connector 重新推送完整内容）。

失败响应（非 failed 状态）：

```json
{
  "resultCode": "-1",
  "resultMsg": "event 12345 is not in failed status, current status: done",
  "resultObject":
}
```

失败响应（upsert 事件）：

```json
{
  "resultCode": "-1",
  "resultMsg": "upsert events must be re-submitted by the connector",
  "resultObject": {}
}
```

---

## 管理接口

### `GET /kgw/admin/v1/audit`

查询审计日志，覆盖 serve 路径写操作和 ingest 路径全部事件。

查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `source` | string | `serve` / `ingest` |
| `knCode` | string | 知识库编码 |
| `operationType` | string | 如 `fileImport`、`ingest.upsert` |
| `actorUserId` | string | 操作人（X-User-Id） |
| `fromTime` | string | 起始时间（ISO 8601） |
| `toTime` | string | 结束时间（ISO 8601） |
| `pageSize` | integer | 默认 20，最大 100 |
| `page` | integer | 从 1 开始 |

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {
        "id": 88732,
        "source": "ingest",
        "operationType": "ingest.upsert",
        "actorUserId": "connector_gbrain",
        "knCode": "2",
        "filePath": "/制度/人事/请假制度.md",
        "resultCode": "0",
        "resultMsg": "success",
        "payloadSizeBytes": 12480,
        "createdAt": "2026-06-07T10:00:01Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20
  }
}
```

### `GET /kgw/admin/v1/conflicts`

查询写入冲突日志（STALE_VERSION 和 SOURCE_LOCKED 记录）。

查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `knCode` | string | 知识库编码 |
| `reason` | string | `STALE_VERSION` / `SOURCE_LOCKED` |
| `fromTime` | string | 起始时间 |
| `toTime` | string | 结束时间 |
| `pageSize` | integer | 默认 20，最大 100 |
| `page` | integer | 从 1 开始 |

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {
        "id": 541,
        "knCode": "2",
        "filePath": "/制度/人事/请假制度.md",
        "currentWriter": "manual",
        "attemptedWriter": "connector_gbrain",
        "attemptedVersion": "2026-06-06T10:00:00Z",
        "reason": "SOURCE_LOCKED",
        "attemptedAt": "2026-06-07T10:00:00Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20
  }
}
```

### `POST /kgw/admin/v1/kbs/{knCode}/files/{filePath}/lock`

锁定文件，锁定后非 `lockOwner` 的 ingest 写入将被拒绝（SOURCE_LOCKED）。

`filePath` 在 URL 中以 `%2F` 编码斜杠，如 `/policy/salary.md` 编码为 `%2Fpolicy%2Fsalary.md`（首个 `/` 保留）。

请求体：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `lockOwner` | string | 是 | 锁持有者标识，如 `"manual"` |
| `expiresAt` | string | 否 | 过期时间（ISO 8601），不传表示永久有效 |

成功响应：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "knCode": "2",
    "filePath": "/policy/salary.md",
    "lockOwner": "manual",
    "expiresAt": null
  }
}
```

失败响应（已被锁定）：

```json
{
  "resultCode": "-1",
  "resultMsg": "file already locked by connector_gbrain since 2026-06-07T09:00:00Z",
  "resultObject": {}
}
```

### `POST /kgw/admin/v1/kbs/{knCode}/files/{filePath}/unlock`

解除文件锁定。`filePath` 编码规则同 lock 接口。

成功响应：`resultCode: "0"`, `resultObject: {}`

失败响应（未锁定）：

```json
{
  "resultCode": "-1",
  "resultMsg": "file is not locked: /policy/salary.md",
  "resultObject": {}
}
```

### `GET /kgw/admin/v1/metadata-properties`

查看全部元数据属性，包含 ACTIVE 和 DELETED 状态，以及每个属性在各 KB 的同步状态明细。主要用于运维排查。

### `GET /kgw/admin/v1/metadata-properties/orphans`

查询指定 KB 的"死列"：后端存在 `__byclaw_kgw__*` 列，但不在网关 sync 表 SYNCED/PURGING 中。通常由手动操作或历史遗留产生。

查询参数：`knCode`（必填）

### `POST /kgw/admin/v1/metadata-properties/{propertyName}/sync-retry`

强制将指定属性的同步状态从 `FAILED` 重置为 `SYNCING`，触发 ensure_synced 重试。可指定 `knCode`（单个 KB）或不传（全部 KB）。

### `POST /kgw/admin/v1/metadata-properties/{propertyName}/purge-retry`

强制将指定属性的清理状态从 `PURGE_FAILED` 重置为 `PURGING`，触发 cleanup worker 重新尝试删除后端列。可指定 `knCode` 或不传。

---

## 错误码一览

| errorCode | 触发场景 | HTTP 状态码 |
| --- | --- | --- |
| `KBNotFound` | knCode 不存在 | 200 |
| `OperationNotSupported` | 该 KB 不支持此操作 | 200 |
| `UpstreamTimeout` | 调后端超时 | 200 |
| `UpstreamConnectError` | 调后端连接失败 | 200 |
| `UploadStreamBroken` | 上传流中断 | 200 |
| `DownloadStreamBroken` | 下载流中断 | 200 |
| `BackendAuthFailed` | 后端鉴权失败（401/403） | 200 |
| `AuthInfoNotFound` | Redis 中无该用户鉴权信息 | 200 |
| `CircuitOpen` | 熔断器 OPEN | 200 |
| `MetadataPropertyNotFound` | propertyName 不在 ACTIVE 主目录 | 200 |
| `MetadataPropertyAlreadyExists` | create 时同名已存在 | 200 |
| `MetadataPropertyInUse` | delete 时存在 binding | 200 |
| `MetadataPropertySyncFailed` | lazy sync 调后端失败 | 200 |
| `METADATA_PROPERTY_NOT_REGISTERED` | ingest 事件中 metadata 引用了未声明属性 | 422 |
| `INVALID_VALUE_TYPE` | create 时 valueType 不合法 | 200 |
| `INVALID_OPERATION_FOR_TYPE` | metadata/update 操作与类型不兼容 | 200 |
| `PAYLOAD_TOO_LARGE` | ingest 请求体超 4MB | 413 |
| `STALE_VERSION` | ingest 版本早于已有 done 记录 | 200（event failed） |
| `SOURCE_LOCKED` | ingest 文件被人工锁定 | 200（event failed） |
| `PROCESSING_TIMEOUT` | ingest 单事件处理超 30s | 200（event failed） |
| `UPSTREAM_ERROR` | ingest 调后端失败（非超时） | 200（event failed） |
