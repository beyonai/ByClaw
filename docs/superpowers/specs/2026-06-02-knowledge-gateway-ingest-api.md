# 知识网关 ingest 与管理接口说明

> 状态：草案
> 日期：2026-06-02
> 关联：知识网关 v5.0 设计文档

## 文档范围

本文档定义知识网关的 ingest 数据导入接口和管理端点。

- ingest 接口面向外部知识源 Connector，用于推送数据变更事件
- 管理接口面向运维人员，用于审计查询、冲突管理、文件锁定

Base URL：
- ingest 端点：`/kgw/ingest/v1`
- 管理端点：`/kgw/admin/v1`

协议：`HTTP`，默认返回 `application/json`。身份标识通过 `X-User-Id` header 传入。

## 通用约定

### 成功响应

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {}
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `resultCode` | string | `"0"` 表示成功，`"-1"` 表示失败 |
| `resultMsg` | string | 接口返回说明 |
| `resultObject` | object | 业务返回体；无额外返回时为 `{}` |

### 失败响应

```json
{
  "resultCode": "-1",
  "resultMsg": "validation failed",
  "resultObject": {}
}
```

校验失败（422）时 `resultObject` 携带 `errorList`：

```json
{
  "resultCode": "-1",
  "resultMsg": "validation failed",
  "resultObject": {
    "errorCode": "INVALID_STANDARD_ITEM",
    "errorList": [
      {
        "path": "knCode",
        "code": "REQUIRED",
        "message": "knCode is required"
      }
    ]
  }
}
```

### 字段约定

- `knCode`：目标知识库标识，由门户维护唯一性
- `filePath`：文件路径，以 `/` 开头，不含知识库名称
- `sourceId`：Connector 对源端数据源的标识
- `itemId`：在 `sourceId` 范围内唯一的条目标识
- `version`：源端版本标识，用于幂等和单调性校验

### 幂等处理

基于 `(sourceId, itemId, version)` 组合去重。重复提交相同组合时：

| 已有记录状态 | 返回 | 行为 |
| --- | --- | --- |
| `done` | 200 + `"already-processed"` | 不重复写 KB |
| `received` | 409 + `"in_progress"` | Connector 退避重试 |
| `failed` | 200 + `"failed"` + 错误详情 | Connector 决定是否修正后重试 |

---

## 接口总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/kgw/ingest/v1/events` | 推送单条数据变更事件 |
| `POST` | `/kgw/ingest/v1/events/batch` | 批量推送数据变更事件 |
| `GET` | `/kgw/ingest/v1/events/{eventId}` | 查询单事件处理状态 |
| `GET` | `/kgw/ingest/v1/events` | 按条件查询事件列表 |
| `POST` | `/kgw/ingest/v1/events/{eventId}/replay` | 重放失败事件 |

---

## StandardItem（标准数据条目）

所有事件 payload 必须符合 StandardItem schema。

### 字段定义

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sourceId` | string | 是 | Connector 对源端数据源的标识，如 `"gbrain-vault-default"` |
| `itemId` | string | 是 | 在 `sourceId` 范围内唯一的条目标识，如 `"research/2026-04-15-ai.md"` |
| `version` | string | 否 | 源端版本标识（时间戳/etag/递增序号），用于幂等和单调性校验。不传则不校验版本 |
| `op` | string | 是 | 操作类型：`"upsert"` 或 `"delete"` |
| `knCode` | string | 是 | 目标知识库标识（门户维护唯一性） |
| `filePath` | string | upsert必填 | 文件写入路径，以 `/` 开头 |
| `title` | string | 否 | 文件标题 |
| `content` | string/object | upsert必填 | 文件内容，支持三种格式（见下方） |
| `contentType` | string | 否 | 内容类型，如 `"text/markdown"`、`"application/pdf"` |
| `metadata` | object | 否 | 元数据键值对，键必须在网关 metadataProperty 主目录中声明 |
| `sourceTimestamp` | string | 否 | 源端数据变更时间，ISO 8601 格式 |
| `extra` | object | 否 | 不进入 KB 的附加信息，仅用于调试和审计 |

### content 字段支持的三种格式

**格式一：内联文本**

```json
{
  "content": "# 文档标题\n\n文档正文内容...",
  "contentType": "text/markdown"
}
```

**格式二：内联 Base64（小文件）**

```json
{
  "content": {
    "encoding": "base64",
    "data": "JVBERi0xLjQKJeLjz9MKN..."
  },
  "contentType": "application/pdf"
}
```

**格式三：远程引用**

```json
{
  "content": {
    "url": "https://files.internal.example.com/doc.pdf",
    "checksum": "sha256:abc123..."
  },
  "contentType": "application/pdf"
}
```

> 远程引用由 ingest 下载后写入 KB，最大 50MB。超限需 Connector 自行分片或改用内联方式。

### delete 事件的简化 payload

`op` 为 `"delete"` 时，仅以下字段必填：

```json
{
  "sourceId": "gbrain-vault-default",
  "itemId": "research/obsolete-doc.md",
  "version": "2026-06-02T10:00:00Z",
  "op": "delete",
  "knCode": "hr_policy",
  "filePath": "/research/obsolete-doc.md"
}
```

---

## 事件推送

### `POST /kgw/ingest/v1/events`

推送单条数据变更事件。ingest 同步处理：校验 → 落库 → 调 KB 写接口 → 返回结果。

**请求体**：`application/json`

**Headers**：

| Header | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `X-User-Id` | string | 是 | Connector 身份标识，网关据此从 Redis 获取写鉴权 |
| `X-Trace-Id` | string | 否 | Connector 端 trace ID，用于全链路追踪 |

请求示例（upsert）：

```json
{
  "sourceId": "gbrain-vault-default",
  "itemId": "research/2026-04-15-ai-research",
  "version": "2026-04-15T12:00:00Z",
  "op": "upsert",
  "knCode": "ai_research_library",
  "filePath": "/research/2026-04-15-ai-research.md",
  "title": "AI Research Notes",
  "content": "# AI Research\n\n## 摘要\n...",
  "contentType": "text/markdown",
  "metadata": {
    "status": "active",
    "tags": ["ai", "research"]
  },
  "sourceTimestamp": "2026-04-15T12:00:00Z",
  "extra": {
    "connector": "gbrain-v1.2.3"
  }
}
```

成功响应（首次写入）：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "eventId": 12345,
    "status": "done"
  }
}
```

成功响应（幂等，已处理）：

```json
{
  "resultCode": "0",
  "resultMsg": "already-processed",
  "resultObject": {
    "eventId": 12345,
    "status": "done"
  }
}
```

失败响应（校验失败）：

```http
HTTP 422 Unprocessable Entity
```

```json
{
  "resultCode": "-1",
  "resultMsg": "validation failed",
  "resultObject": {
    "errorCode": "INVALID_STANDARD_ITEM",
    "errorList": [
      {
        "path": "metadata.unknown_field",
        "code": "UNKNOWN_FIELD",
        "message": "metadataProperty 'unknown_field' not declared in gateway master catalog"
      }
    ]
  }
}
```

失败响应（KB 写入失败）：

```json
{
  "resultCode": "-1",
  "resultMsg": "failed to write to KB",
  "resultObject": {
    "eventId": 12345,
    "status": "failed",
    "errorType": "UpstreamTimeout",
    "errorMessage": "KB backend timeout after 30s"
  }
}
```

### `POST /kgw/ingest/v1/events/batch`

批量推送数据变更事件。一次最多 100 条，单条独立校验，部分成功部分失败时返回聚合结果。

**请求体**：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `events` | array[StandardItem] | 是 | 事件列表，最多 100 条 |

请求示例：

```json
{
  "events": [
    {
      "sourceId": "gbrain-vault-default",
      "itemId": "doc-001",
      "version": "2026-06-02T10:00:00Z",
      "op": "upsert",
      "knCode": "hr_policy",
      "filePath": "/policy/salary.md",
      "title": "薪酬制度",
      "content": "# 薪酬制度\n...",
      "contentType": "text/markdown"
    },
    {
      "sourceId": "gbrain-vault-default",
      "itemId": "doc-002",
      "version": "2026-06-02T10:00:01Z",
      "op": "upsert",
      "knCode": "hr_policy",
      "filePath": "/policy/leave.md",
      "title": "请假制度",
      "content": "# 请假制度\n...",
      "contentType": "text/markdown"
    }
  ]
}
```

成功响应（全部成功）：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "total": 2,
    "succeeded": 2,
    "failed": 0,
    "results": [
      {"eventId": 12346, "status": "done", "itemId": "doc-001"},
      {"eventId": 12347, "status": "done", "itemId": "doc-002"}
    ]
  }
}
```

部分成功响应（有失败的条目时 `resultCode` 仍为 `"-1"`）：

```json
{
  "resultCode": "-1",
  "resultMsg": "partial success",
  "resultObject": {
    "total": 2,
    "succeeded": 1,
    "failed": 1,
    "results": [
      {"eventId": 12346, "status": "done", "itemId": "doc-001"},
      {
        "itemId": "doc-002",
        "status": "validation_failed",
        "errorType": "STALE_VERSION",
        "errorMessage": "version 2026-06-01T10:00:00Z <= existing 2026-06-02T10:00:00Z"
      }
    ]
  }
}
```

> batch 端点的处理限制：与单条事件共享 `单 ingest Pod 并发槽 = 100` 限制。batch 内每条事件独立处理，不支持事务回滚（已成功的条目不回滚）。

---

## 事件状态查询

### `GET /kgw/ingest/v1/events/{eventId}`

查询单条事件的处理状态。

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `eventId` | integer | 是 | 事件 ID |

成功响应：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "eventId": 12345,
    "sourceId": "gbrain-vault-default",
    "itemId": "research/2026-04-15-ai-research",
    "version": "2026-04-15T12:00:00Z",
    "op": "upsert",
    "knCode": "ai_research_library",
    "filePath": "/research/2026-04-15-ai-research.md",
    "status": "done",
    "retryCount": 0,
    "receivedAt": "2026-06-02T10:30:00Z",
    "doneAt": "2026-06-02T10:30:01Z"
  }
}
```

`status` 枚举：

| 值 | 说明 |
| --- | --- |
| `received` | 已接收，正在处理中 |
| `done` | 处理成功，已写入 KB |
| `failed` | 处理失败，已进入 DLQ |

失败响应：

```json
{
  "resultCode": "-1",
  "resultMsg": "event not found: 99999",
  "resultObject": {}
}
```

### `GET /kgw/ingest/v1/events`

按条件查询事件列表，支持按 `sourceId`、`itemId`、`status`、时间范围过滤。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sourceId` | string | 否 | 源端数据源标识 |
| `itemId` | string | 否 | 条目标识 |
| `knCode` | string | 否 | 知识库标识 |
| `status` | string | 否 | 状态过滤：`received` / `done` / `failed` |
| `fromTime` | string | 否 | 起始时间（ISO 8601） |
| `toTime` | string | 否 | 结束时间（ISO 8601） |
| `pageSize` | integer | 否 | 每页条数，默认 20，最大 100 |
| `page` | integer | 否 | 页码，从 1 开始，默认 1 |

请求示例：

```
GET /kgw/ingest/v1/events?sourceId=gbrain-vault-default&status=failed&pageSize=10&page=1
```

成功响应：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {
        "eventId": 12348,
        "sourceId": "gbrain-vault-default",
        "itemId": "doc-failed",
        "version": "2026-06-01T12:00:00Z",
        "op": "upsert",
        "knCode": "hr_policy",
        "filePath": "/policy/old.md",
        "status": "failed",
        "errorType": "UpstreamTimeout",
        "errorMessage": "KB backend timeout after 30s",
        "retryCount": 2,
        "receivedAt": "2026-06-01T12:00:00Z",
        "doneAt": null
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 10
  }
}
```

---

## 事件重放（DLQ）

### `POST /kgw/ingest/v1/events/{eventId}/replay`

重放失败事件。将事件状态重置为 `received`，重新走完整处理流程。

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `eventId` | integer | 是 | 事件 ID |

> **限制**：只能重放 `status = "failed"` 的事件。`done` 或 `received` 状态的事件调用 replay 直接返回错误。

成功响应：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "eventId": 12345,
    "status": "done",
    "retryCount": 1
  }
}
```

失败重放（再次失败）：

```json
{
  "resultCode": "-1",
  "resultMsg": "replay failed",
  "resultObject": {
    "eventId": 12345,
    "status": "failed",
    "errorType": "STALE_VERSION",
    "errorMessage": "version still behind after replay, need manual resolution",
    "retryCount": 1
  }
}
```

失败响应（状态不允许）：

```json
{
  "resultCode": "-1",
  "resultMsg": "event 12345 is not in failed status, current status: done",
  "resultObject": {}
}
```

---

## ingest 错误类型

| errorType | 触发场景 | 是否进 conflict_log |
| --- | --- | --- |
| `INVALID_STANDARD_ITEM` | StandardItem schema 不合规（字段缺失、类型错误等） | 否 |
| `KB_NOT_FOUND` | knCode 在门户配置中不存在 | 否 |
| `METADATA_PROPERTY_NOT_REGISTERED` | metadata 中引用了未在网关 metadataProperty 主目录声明的字段 | 否 |
| `STALE_VERSION` | event.version ≤ 历史记录的 version（版本回退） | 是 |
| `SOURCE_LOCKED` | 目标 (knCode, filePath) 被人工锁或其他写入者占用 | 是 |
| `PROCESSING_TIMEOUT` | 单事件处理超过 30s | 否 |
| `PAYLOAD_TOO_LARGE` | 单事件 payload 超过 4 MB | 否 |
| `UPSTREAM_TIMEOUT` | 调 KB 后端超时 | 否 |
| `UPSTREAM_ERROR` | 调 KB 后端其他错误（5xx 等） | 否 |

---

## 处理限制

| 维度 | 阈值 | 超限响应 |
| --- | --- | --- |
| 单事件 payload 大小 | ≤ 4 MB | 413 + `PAYLOAD_TOO_LARGE` |
| 单事件处理超时 | 30 s | `PROCESSING_TIMEOUT`，事件状态 `failed` 入 DLQ |
| 单 Pod 并发处理槽 | 100 | 503 + `Retry-After: 5` |
| batch 最大事件数 | 100 条 | 422 + 错误提示 |

Connector 端退避策略：

- 收到 `429` / `503` → 按 `Retry-After` 退避（指数退避，上限 60s）
- 收到 `5xx` 非 429/503 → 退避后重试
- 收到 `4xx`（除 429）→ 不重试，记录日志（事件不合规）
- 收到 `409 Conflict` → Connector 退避后重试（事件正在处理中，幂等安全）

---

# 管理接口

Base URL：`/kgw/admin/v1`

管理接口面向运维人员，用于审计追踪、冲突排查和文件写入控制。

## 接口总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/kgw/admin/v1/audit` | 审计日志查询 |
| `GET` | `/kgw/admin/v1/conflicts` | 冲突日志查询 |
| `POST` | `/kgw/admin/v1/kbs/{knCode}/files/{filePath}/lock` | 人工锁定文件（防 Connector 覆盖） |
| `POST` | `/kgw/admin/v1/kbs/{knCode}/files/{filePath}/unlock` | 人工解锁文件 |

---

## 审计查询

### `GET /kgw/admin/v1/audit`

查询审计日志。覆盖 serve 路径（8 个高危写 operation）和 ingest 路径（所有事件处理结果）。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `source` | string | 否 | 来源过滤：`serve` / `ingest` |
| `knCode` | string | 否 | 知识库标识 |
| `operationType` | string | 否 | 操作类型，如 `fileImport`、`kbCreate`、`ingest.upsert` |
| `actorUserId` | string | 否 | 操作人 `X-User-Id`（serve 路径） |
| `sourceConnector` | string | 否 | 来源 Connector 标识（ingest 路径） |
| `fromTime` | string | 否 | 起始时间（ISO 8601） |
| `toTime` | string | 否 | 结束时间（ISO 8601） |
| `pageSize` | integer | 否 | 每页条数，默认 20，最大 100 |
| `page` | integer | 否 | 页码，从 1 开始，默认 1 |

请求示例：

```
GET /kgw/admin/v1/audit?knCode=hr_policy&source=ingest&fromTime=2026-06-01T00:00:00Z&pageSize=10
```

成功响应：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {
        "id": 88732,
        "source": "ingest",
        "traceId": "trace-abc123",
        "actorUserId": "connector_gbrain_prod",
        "actorKind": "connector",
        "sourceConnector": "gbrain-v1.2.3",
        "sourceId": "gbrain-vault-default",
        "sourceItemId": "research/2026-04-15-ai.md",
        "sourceVersion": "2026-04-15T12:00:00Z",
        "operationType": "ingest.upsert",
        "knCode": "hr_policy",
        "filePath": "/research/2026-04-15-ai.md",
        "payloadSizeBytes": 12480,
        "resultCode": "0",
        "resultMsg": "success",
        "latencyMs": 422,
        "createdAt": "2026-06-02T10:30:01Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 10
  }
}
```

> 审计 payload 已脱敏入库：所有鉴权 header 与 token 字段在写入前剥除，仅保留业务字段（knCode / filePath / metadata 摘要）。

---

## 冲突查询

### `GET /kgw/admin/v1/conflicts`

查询 ingest 写入时因版本冲突或锁冲突被拒绝的记录。

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 否 | 知识库标识 |
| `reason` | string | 否 | 冲突原因：`STALE_VERSION` / `SOURCE_LOCKED` |
| `fromTime` | string | 否 | 起始时间（ISO 8601） |
| `toTime` | string | 否 | 结束时间（ISO 8601） |
| `pageSize` | integer | 否 | 每页条数，默认 20，最大 100 |
| `page` | integer | 否 | 页码，从 1 开始，默认 1 |

请求示例：

```
GET /kgw/admin/v1/conflicts?knCode=hr_policy&reason=STALE_VERSION&pageSize=10
```

成功响应：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {
        "id": 541,
        "knCode": "hr_policy",
        "filePath": "/policy/salary.md",
        "currentWriter": "connector_gbrain_prod",
        "attemptedWriter": "connector_obsidian_prod",
        "attemptedVersion": "2026-06-01T10:00:00Z",
        "reason": "STALE_VERSION",
        "attemptedAt": "2026-06-02T12:00:05Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 10
  }
}
```

---

## 文件锁定

多个 Connector 或人工操作可能写入同一 KB 的同一文件路径。文件锁提供人工干预手段，防止 Connector 覆盖人工维护的内容。

### `POST /kgw/admin/v1/kbs/{knCode}/files/{filePath}/lock`

人工锁定文件。锁定后，非 `lockOwner` 的 ingest 写入将被拒绝（`SOURCE_LOCKED`）。

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库标识 |
| `filePath` | string | 是 | 文件路径，以 `/` 开头。注意：URL 路径中的 `/` 需编码为 `%2F`，首个 `/` 除外 |

**请求体**：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `lockOwner` | string | 是 | 锁持有者标识，如 `"manual"` 或操作人工号 |
| `expiresAt` | string | 否 | 过期时间（ISO 8601），不传表示永久有效 |

请求示例：

```
POST /kgw/admin/v1/kbs/hr_policy/files/%2Fpolicy%2Fsalary.md
Content-Type: application/json

{
  "lockOwner": "manual",
  "expiresAt": "2026-06-09T00:00:00Z"
}
```

成功响应：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "knCode": "hr_policy",
    "filePath": "/policy/salary.md",
    "lockOwner": "manual",
    "lockedAt": "2026-06-02T15:00:00Z",
    "expiresAt": "2026-06-09T00:00:00Z"
  }
}
```

失败响应（已被锁定）：

```json
{
  "resultCode": "-1",
  "resultMsg": "file already locked by connector_gbrain_prod since 2026-06-01T10:00:00Z",
  "resultObject": {}
}
```

### `POST /kgw/admin/v1/kbs/{knCode}/files/{filePath}/unlock`

解除文件锁定。

**路径参数**：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库标识 |
| `filePath` | string | 是 | 文件路径，以 `/` 开头 |

请求示例：

```
POST /kgw/admin/v1/kbs/hr_policy/files/%2Fpolicy%2Fsalary.md/unlock
```

成功响应：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {}
}
```

失败响应（未被锁定）：

```json
{
  "resultCode": "-1",
  "resultMsg": "file is not locked: /policy/salary.md",
  "resultObject": {}
}
```
