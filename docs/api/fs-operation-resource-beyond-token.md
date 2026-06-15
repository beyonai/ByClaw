# ResourceFS 文件操作接口（beyond-token 鉴权简化版）

本文档仅描述 `RESOURCE` 空间文件操作接口。`RESOURCE` 空间对应资源公共文件空间，调用方必须传 `resourceId`，后端根据资源权限判断是否允许读取或修改。

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
| `spaceType` | string | 是 | 固定传 `RESOURCE` |
| `resourceId` | long | 是 | ByClaw 资源 ID |
| `path` | string | 是 | ResourceFS 语义路径 |

说明：

- `RESOURCE` 空间必须传 `resourceId`。
- 后端通过 `resourceId` 查询 `SsResource`，并复用 `AuthApplicationService` 做资源权限判断。
- 读取类操作需要资源管理或使用权限。
- 修改类操作需要资源管理权限。
- `path` 必须在 `/resource/` 根下，并且需归属于当前 `resourceId`，例如 `/resource/doc/KG_DOC_10001/reports/out.md` 或 `/resource/doc/KG_DOC_10001.json`。
- 路径禁止包含 `..`，禁止空路径。

## 2. 权限规则

| 操作 | 权限要求 |
|---|---|
| 下载文件 | `hasResourceAccessPermission`，即管理或使用 |
| 上传或覆盖文件 | `hasResourceManagePermission` |
| 删除文件 | `hasResourceManagePermission` |
| 创建目录 | `hasResourceManagePermission` |
| 删除目录 | `hasResourceManagePermission` |
| 重命名文件 | `hasResourceManagePermission` |
| 重命名目录 | `hasResourceManagePermission` |

## 3. 上传或覆盖文件

```http
POST /fs/operation/v1/files/put
Content-Type: multipart/form-data
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `spaceType` | string | 是 | 固定 `RESOURCE` |
| `resourceId` | long | 是 | 资源 ID |
| `path` | string | 是 | 目标文件路径，包含文件名 |
| `contentType` | string | 否 | 文件 MIME 类型 |
| `file` | file | 是 | 文件内容 |

### curl

```bash
curl -X POST "${BASE_URL}/fs/operation/v1/files/put" \
  -H "system-code: BYAI" \
  -H "beyond-token: ${BEYOND_TOKEN}" \
  -F "spaceType=RESOURCE" \
  -F "resourceId=10001" \
  -F "path=/resource/doc/KG_DOC_10001/reports/out.md" \
  -F "contentType=text/markdown" \
  -F "file=@/tmp/out.md;type=text/markdown"
```

### 返回示例

```json
{
  "code": "00000",
  "msg": "success",
  "data": {
    "spaceType": "RESOURCE",
    "resourceId": 10001,
    "path": "/resource/doc/KG_DOC_10001/reports/out.md",
    "fileName": "out.md",
    "fileSize": 12888,
    "contentType": "text/markdown",
    "checksum": "9d377...",
    "updatedAt": "2026-06-10T18:30:00+08:00",
    "storageType": "MINIO"
  }
}
```

## 4. 下载文件

```http
GET /fs/operation/v1/files/get
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `spaceType` | string | 是 | 固定 `RESOURCE` |
| `resourceId` | long | 是 | 资源 ID |
| `path` | string | 是 | 文件路径 |

### curl

```bash
curl -L "${BASE_URL}/fs/operation/v1/files/get?spaceType=RESOURCE&resourceId=10001&path=/resource/doc/KG_DOC_10001/reports/out.md" \
  -H "system-code: BYAI" \
  -H "beyond-token: ${BEYOND_TOKEN}" \
  -o /tmp/out.md
```

## 5. 删除文件

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
    "spaceType": "RESOURCE",
    "resourceId": 10001,
    "path": "/resource/doc/KG_DOC_10001/reports/out.md"
  }'
```

### 返回示例

```json
{
  "code": "00000",
  "msg": "success",
  "data": {
    "spaceType": "RESOURCE",
    "resourceId": 10001,
    "path": "/resource/doc/KG_DOC_10001/reports/out.md",
    "deleted": true
  }
}
```

## 6. 创建目录

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
    "spaceType": "RESOURCE",
    "resourceId": 10001,
    "path": "/resource/doc/KG_DOC_10001/reports/"
  }'
```

## 7. 删除目录

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
    "spaceType": "RESOURCE",
    "resourceId": 10001,
    "path": "/resource/doc/KG_DOC_10001/reports/",
    "recursive": true
  }'
```

## 8. 重命名文件

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
    "spaceType": "RESOURCE",
    "resourceId": 10001,
    "oldPath": "/resource/doc/KG_DOC_10001/reports/out.md",
    "newPath": "/resource/doc/KG_DOC_10001/reports/final.md",
    "overwrite": false
  }'
```

## 9. 重命名目录

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
    "spaceType": "RESOURCE",
    "resourceId": 10001,
    "oldPath": "/resource/doc/KG_DOC_10001/reports/",
    "newPath": "/resource/doc/KG_DOC_10001/archive/",
    "overwrite": false
  }'
```

### 返回示例

```json
{
  "code": "00000",
  "msg": "success",
  "data": {
    "spaceType": "RESOURCE",
    "resourceId": 10001,
    "oldPath": "/resource/doc/KG_DOC_10001/reports/",
    "newPath": "/resource/doc/KG_DOC_10001/archive/",
    "total": 12,
    "copied": 12,
    "deleted": 12,
    "failed": 0,
    "failedItems": []
  }
}
```

## 10. 常见错误

| 场景 | 建议状态 | 说明 |
|---|---|---|
| token 无效 | 401 | `beyond-token` 缺失、过期或校验失败 |
| 缺少 `resourceId` | 400 | `RESOURCE` 空间必须传资源 ID |
| 无访问权限 | 403 | 下载时没有资源管理或使用权限 |
| 无管理权限 | 403 | 上传、删除、重命名等修改操作没有管理权限 |
| 路径非法 | 400 | 空路径、包含 `..`、跨根路径 |
| 文件不存在 | 404 | 下载或重命名源文件不存在 |
| 目标已存在 | 409 | `overwrite=false` 且目标路径已存在 |
