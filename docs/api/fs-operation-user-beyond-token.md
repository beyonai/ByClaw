# UserFS 文件操作接口（beyond-token 鉴权简化版）

本文档仅描述 `USER` 空间文件操作接口。`USER` 空间对应当前登录用户自己的 UserFS，调用方不能通过参数指定或切换其他用户空间。

## 1. 调用约定

### Base URL

```bash
BE_DOMAINNAME="${BE_DOMAINNAME:-ByaiService_dashi}"
BASE_URL="http://${BE_DOMAINNAME}/aiFactoryServer"
BEYOND_TOKEN="<BYCLAW_BEYOND_TOKEN>"
```

说明：

- `BE_DOMAINNAME` 由部署环境注入，例如 `BE_DOMAINNAME=ByaiService_dashi`。
- 文档和调用示例不得写死具体 IP 或本机端口。

### 统一 Header

```http
system-code: BYAI
beyond-token: <BYCLAW_BEYOND_TOKEN>
```

### 接口前缀

```text
/fs/operation/v1
```

### 通用字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `spaceType` | string | 是 | 固定传 `USER` |
| `path` | string | 是 | UserFS 路径，支持省略或携带 `/byclaw-{userCode}/by` 前缀 |

说明：

- `USER` 空间不需要传 `resourceId`。
- `USER` 空间不允许传 `userCode` 切换目标用户。
- 后端以 `beyond-token` 解析出的当前登录用户作为 UserFS 操作主体。
- 如果 `path` 未携带 `/byclaw-{userCode}/by`，后端会按当前登录用户自动补齐底层存储前缀。
- 如果 `path` 已携带当前登录用户的 `/byclaw-{userCode}/by` 或 `/by`，后端会忽略该前缀并归一成 UserFS 语义路径，避免重复写入前缀。
- 如果 `path` 携带其他用户的 `/byclaw-{otherUser}/by` 前缀，后端会拒绝请求。
- 路径禁止包含 `..`，禁止空路径。

## 2. 上传或覆盖文件

```http
POST /fs/operation/v1/files/put
Content-Type: multipart/form-data
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `spaceType` | string | 是 | 固定 `USER` |
| `path` | string | 是 | 目标文件路径，包含文件名 |
| `contentType` | string | 否 | 文件 MIME 类型 |
| `file` | file | 是 | 文件内容 |

### curl

```bash
curl -X POST "${BASE_URL}/fs/operation/v1/files/put" \
  -H "system-code: BYAI" \
  -H "beyond-token: ${BEYOND_TOKEN}" \
  -F "spaceType=USER" \
  -F "path=/.sessions/sess-001/reports/out.md" \
  -F "contentType=text/markdown" \
  -F "file=@/tmp/out.md;type=text/markdown"
```

### 返回示例

```json
{
  "code": "00000",
  "msg": "success",
  "data": {
    "spaceType": "USER",
    "path": "/.sessions/sess-001/reports/out.md",
    "fileName": "out.md",
    "fileSize": 12888,
    "contentType": "text/markdown",
    "checksum": "9d377...",
    "updatedAt": "2026-06-10T18:30:00+08:00",
    "storageType": "MINIO"
  }
}
```

## 3. 下载文件

```http
GET /fs/operation/v1/files/get
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `spaceType` | string | 是 | 固定 `USER` |
| `path` | string | 是 | 文件路径 |

### curl

```bash
curl -L "${BASE_URL}/fs/operation/v1/files/get?spaceType=USER&path=/.sessions/sess-001/reports/out.md" \
  -H "system-code: BYAI" \
  -H "beyond-token: ${BEYOND_TOKEN}" \
  -o /tmp/out.md
```

## 4. 删除文件

```http
POST /fs/operation/v1/files/delete
Content-Type: application/json
```

### curl

```bash
curl -X POST "${BASE_URL}/fs/operation/v1/files/delete" \
  -H "Content-Type: application/json" \
  -H "system-code: BYAI" \
  -H "beyond-token: ${BEYOND_TOKEN}" \
  -d '{
    "spaceType": "USER",
    "path": "/.sessions/sess-001/reports/out.md"
  }'
```

### 返回示例

```json
{
  "code": "00000",
  "msg": "success",
  "data": {
    "spaceType": "USER",
    "path": "/.sessions/sess-001/reports/out.md",
    "deleted": true
  }
}
```

## 5. 创建目录

```http
POST /fs/operation/v1/directories/create
Content-Type: application/json
```

### curl

```bash
curl -X POST "${BASE_URL}/fs/operation/v1/directories/create" \
  -H "Content-Type: application/json" \
  -H "system-code: BYAI" \
  -H "beyond-token: ${BEYOND_TOKEN}" \
  -d '{
    "spaceType": "USER",
    "path": "/.sessions/sess-001/reports/"
  }'
```

## 6. 删除目录

```http
POST /fs/operation/v1/directories/delete
Content-Type: application/json
```

### curl

```bash
curl -X POST "${BASE_URL}/fs/operation/v1/directories/delete" \
  -H "Content-Type: application/json" \
  -H "system-code: BYAI" \
  -H "beyond-token: ${BEYOND_TOKEN}" \
  -d '{
    "spaceType": "USER",
    "path": "/.sessions/sess-001/reports/",
    "recursive": true
  }'
```

## 7. 重命名文件

```http
POST /fs/operation/v1/files/rename
Content-Type: application/json
```

### curl

```bash
curl -X POST "${BASE_URL}/fs/operation/v1/files/rename" \
  -H "Content-Type: application/json" \
  -H "system-code: BYAI" \
  -H "beyond-token: ${BEYOND_TOKEN}" \
  -d '{
    "spaceType": "USER",
    "oldPath": "/.sessions/sess-001/reports/out.md",
    "newPath": "/.sessions/sess-001/reports/final.md",
    "overwrite": false
  }'
```

## 8. 重命名目录

```http
POST /fs/operation/v1/directories/rename
Content-Type: application/json
```

对象存储目录重命名不是原子操作，后端按批量复制 + 删除旧前缀实现，并返回批处理结果。

### curl

```bash
curl -X POST "${BASE_URL}/fs/operation/v1/directories/rename" \
  -H "Content-Type: application/json" \
  -H "system-code: BYAI" \
  -H "beyond-token: ${BEYOND_TOKEN}" \
  -d '{
    "spaceType": "USER",
    "oldPath": "/.sessions/sess-001/reports/",
    "newPath": "/.sessions/sess-001/archive/",
    "overwrite": false
  }'
```

### 返回示例

```json
{
  "code": "00000",
  "msg": "success",
  "data": {
    "spaceType": "USER",
    "oldPath": "/.sessions/sess-001/reports/",
    "newPath": "/.sessions/sess-001/archive/",
    "total": 12,
    "copied": 12,
    "deleted": 12,
    "failed": 0,
    "failedItems": []
  }
}
```

## 9. 常见错误

| 场景 | 建议状态 | 说明 |
|---|---|---|
| token 无效 | 401 | `beyond-token` 缺失、过期或校验失败 |
| 路径非法 | 400 | 空路径、包含 `..`、跨根路径 |
| 文件不存在 | 404 | 下载或重命名源文件不存在 |
| 目标已存在 | 409 | `overwrite=false` 且目标路径已存在 |
