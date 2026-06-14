# FS Operation MinIO 操作接口协议（beyond-token 鉴权）

本文档定义面向外部系统的文件存储操作接口，用于通过 ByClaw 后端统一访问 UserFS / ResourceFS 背后的对象存储能力。本次新增 `FsOperationApplicationService` 作为编排层，并给 `ResourceFS` 对齐 `write(InputStream, ...)` 流式写接口，避免内部复制/占位对象写入时重复包装为 `MultipartFile`。

## 1. 基本约定

### 1.1 Base URL

```bash
BE_DOMAINNAME="${BE_DOMAINNAME:-ByaiService_dashi}"
BASE_URL="http://${BE_DOMAINNAME}/aiFactoryServer"
```

说明：

- `BE_DOMAINNAME` 由部署环境注入，例如 `BE_DOMAINNAME=ByaiService_dashi`。
- 文档和调用示例不得写死具体 IP 或本机端口。
- 如果调用方运行环境已经统一注入 `BE_DOMAINNAME`，只需要设置 `BASE_URL="http://${BE_DOMAINNAME}/aiFactoryServer"`。

### 1.2 接口前缀

```text
/fs/operation/v1
```

该前缀不加入免登录白名单，调用方必须携带 ByClaw 现有认证信息。

### 1.3 鉴权方式

统一使用 ByClaw 现有 `beyond-token` 鉴权链路：

```http
system-code: BYAI
beyond-token: <BYCLAW_BEYOND_TOKEN>
```

说明：

- `system-code` 传调用系统编码，示例使用 `BYAI`。
- `beyond-token` 由 ByClaw 现有登录态或系统间调用链路生成。
- 后端通过 `AccessTokenVerifyInterceptor` 校验 token，并写入 `CurrentUserHolder`。
- 业务层不得直接信任请求体中的 `userCode`。

### 1.4 空间类型

| 字段值 | 说明 |
|---|---|
| `USER` | 用户私有文件空间，对应 `UserFS` |
| `RESOURCE` | 资源公共文件空间，对应 `ResourceFS` |

### 1.5 权限规则

| 操作类型 | `USER` 空间 | `RESOURCE` 空间 |
|---|---|---|
| 文件读取 / 下载 / 查询 | 当前 token 对应用户本人 | 需要资源管理或使用权限 |
| 文件上传 / 覆盖 | 当前 token 对应用户本人 | 需要资源管理权限 |
| 文件删除 | 当前 token 对应用户本人 | 需要资源管理权限 |
| 目录创建 | 当前 token 对应用户本人 | 需要资源管理权限 |
| 目录删除 | 当前 token 对应用户本人 | 需要资源管理权限 |
| 文件重命名 | 当前 token 对应用户本人 | 需要资源管理权限 |
| 目录重命名 | 当前 token 对应用户本人 | 需要资源管理权限 |

`RESOURCE` 空间接口必须传 `resourceId`，后端基于 `SsResource` 和 `AuthApplicationService` 做资源级鉴权。

### 1.6 路径规则

- `path` 推荐使用 ByClaw FS 语义路径；USER 空间兼容外部传入当前用户的 `/byclaw-{userCode}/by` 前缀。
- 禁止 `..`、空路径、跨根路径。
- 目录路径建议以 `/` 结尾，后端会做标准化。
- `RESOURCE` 空间路径必须在 `/resource/` 根下，并且路径需归属于当前 `resourceId`，例如 `/resource/doc/KG_DOC_10001/reports/out.md` 或 `/resource/doc/KG_DOC_10001.json`。
- `USER` 空间只能操作当前 token 对应用户自己的 UserFS。
- `USER` 空间允许传 `/.sessions/a.txt`、`/by/.sessions/a.txt`、`/byclaw-{userCode}/by/.sessions/a.txt`；后端会忽略当前用户的 `/byclaw-{userCode}/by` 或 `/by` 前缀，交给 UserFS 统一补真实存储路径。
- `USER` 空间如果传入其他用户的 `/byclaw-{otherUser}/by` 前缀，会被拒绝。

### 1.7 通用响应格式

JSON 接口建议沿用 ByClaw `ResponseUtil` 风格：

```json
{
  "code": "00000",
  "msg": "success",
  "data": {}
}
```

二进制下载接口直接返回文件流。

## 2. 上传或覆盖文件

### 2.1 接口

```http
POST /fs/operation/v1/files/put
Content-Type: multipart/form-data
```

### 2.2 请求参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `spaceType` | string | 是 | `USER` / `RESOURCE` |
| `resourceId` | long | `RESOURCE` 必填 | 资源 ID |
| `path` | string | 是 | 文件目标路径，包含文件名 |
| `contentType` | string | 否 | 文件 MIME 类型，不传则从上传文件推断 |
| `file` | file | 是 | 文件内容 |

### 2.3 返回示例

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
    "bucketName": "byclaw",
    "storageType": "MINIO"
  }
}
```

### 2.4 curl

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

## 3. 下载文件

### 3.1 接口

```http
GET /fs/operation/v1/files/get
```

### 3.2 请求参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `spaceType` | string | 是 | `USER` / `RESOURCE` |
| `resourceId` | long | `RESOURCE` 必填 | 资源 ID |
| `path` | string | 是 | 文件路径 |

### 3.3 响应

返回二进制文件流，建议带以下 Header：

```http
Content-Type: <file content type>
Content-Disposition: attachment; filename="<fileName>"
```

### 3.4 curl

```bash
curl -L "${BASE_URL}/fs/operation/v1/files/get?spaceType=RESOURCE&resourceId=10001&path=/resource/doc/KG_DOC_10001/reports/out.md" \
  -H "system-code: BYAI" \
  -H "beyond-token: ${BEYOND_TOKEN}" \
  -o /tmp/out.md
```

## 4. 删除文件

### 4.1 接口

```http
POST /fs/operation/v1/files/delete
Content-Type: application/json
```

### 4.2 请求体

```json
{
  "spaceType": "RESOURCE",
  "resourceId": 10001,
  "path": "/resource/doc/KG_DOC_10001/reports/out.md"
}
```

### 4.3 返回示例

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

### 4.4 curl

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

## 5. 创建目录

### 5.1 接口

```http
POST /fs/operation/v1/directories/create
Content-Type: application/json
```

### 5.2 请求体

```json
{
  "spaceType": "RESOURCE",
  "resourceId": 10001,
  "path": "/resource/doc/KG_DOC_10001/reports/"
}
```

### 5.3 返回示例

```json
{
  "code": "00000",
  "msg": "success",
  "data": {
    "spaceType": "RESOURCE",
    "resourceId": 10001,
    "path": "/resource/doc/KG_DOC_10001/reports/",
    "created": true
  }
}
```

### 5.4 curl

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

## 6. 删除目录

### 6.1 接口

```http
POST /fs/operation/v1/directories/delete
Content-Type: application/json
```

### 6.2 请求体

```json
{
  "spaceType": "RESOURCE",
  "resourceId": 10001,
  "path": "/resource/doc/KG_DOC_10001/reports/",
  "recursive": true
}
```

### 6.3 参数说明

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `recursive` | boolean | 否 | 是否递归删除目录下所有文件，默认 `true` |

### 6.4 返回示例

```json
{
  "code": "00000",
  "msg": "success",
  "data": {
    "spaceType": "RESOURCE",
    "resourceId": 10001,
    "path": "/resource/doc/KG_DOC_10001/reports/",
    "recursive": true,
    "deleted": true,
    "deletedCount": 12
  }
}
```

### 6.5 curl

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

## 7. 重命名文件

### 7.1 接口

```http
POST /fs/operation/v1/files/rename
Content-Type: application/json
```

### 7.2 请求体

```json
{
  "spaceType": "RESOURCE",
  "resourceId": 10001,
  "oldPath": "/resource/doc/KG_DOC_10001/reports/out.md",
  "newPath": "/resource/doc/KG_DOC_10001/reports/final.md",
  "overwrite": false
}
```

### 7.3 参数说明

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `oldPath` | string | 是 | 原文件路径 |
| `newPath` | string | 是 | 新文件路径 |
| `overwrite` | boolean | 否 | 目标存在时是否覆盖，默认 `false` |

### 7.4 返回示例

```json
{
  "code": "00000",
  "msg": "success",
  "data": {
    "spaceType": "RESOURCE",
    "resourceId": 10001,
    "oldPath": "/resource/doc/KG_DOC_10001/reports/out.md",
    "newPath": "/resource/doc/KG_DOC_10001/reports/final.md",
    "moved": true,
    "overwritten": false
  }
}
```

### 7.5 curl

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

## 8. 重命名目录

### 8.1 接口

```http
POST /fs/operation/v1/directories/rename
Content-Type: application/json
```

### 8.2 请求体

```json
{
  "spaceType": "RESOURCE",
  "resourceId": 10001,
  "oldPath": "/resource/doc/KG_DOC_10001/reports/",
  "newPath": "/resource/doc/KG_DOC_10001/archive/",
  "overwrite": false
}
```

### 8.3 处理语义

对象存储目录重命名不是原子操作，后端按批量复制 + 删除旧前缀实现。接口必须返回批处理结果，调用方需要根据 `failed` 和 `failedItems` 判断是否需要补偿。

### 8.4 返回示例

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

失败项示例：

```json
{
  "sourcePath": "/resource/doc/KG_DOC_10001/reports/a.md",
  "targetPath": "/resource/doc/KG_DOC_10001/archive/a.md",
  "stage": "COPY",
  "errorMessage": "target exists"
}
```

### 8.5 curl

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

## 9. USER 空间调用示例

`USER` 空间不需要传 `resourceId`，操作目标固定为当前 `beyond-token` 对应用户的 UserFS。

### 上传会话文件

```bash
curl -X POST "${BASE_URL}/fs/operation/v1/files/put" \
  -H "system-code: BYAI" \
  -H "beyond-token: ${BEYOND_TOKEN}" \
  -F "spaceType=USER" \
  -F "path=/.sessions/sess-001/reports/out.md" \
  -F "contentType=text/markdown" \
  -F "file=@/tmp/out.md;type=text/markdown"
```

### 下载会话文件

```bash
curl -L "${BASE_URL}/fs/operation/v1/files/get?spaceType=USER&path=/.sessions/sess-001/reports/out.md" \
  -H "system-code: BYAI" \
  -H "beyond-token: ${BEYOND_TOKEN}" \
  -o /tmp/out.md
```

## 10. 错误码建议

| 场景 | HTTP 状态 | 业务提示 |
|---|---|---|
| 未携带或 token 无效 | 401 | `beyond-token 无效或已过期` |
| 当前用户无读取权限 | 403 | `无资源访问权限` |
| 当前用户无管理权限 | 403 | `无资源管理权限` |
| `RESOURCE` 空间未传 `resourceId` | 400 | `resourceId 不能为空` |
| 路径非法 | 400 | `文件路径非法` |
| 文件不存在 | 404 | `文件不存在` |
| 目标已存在且不允许覆盖 | 409 | `目标路径已存在` |
| 目录重命名部分失败 | 207 | `目录重命名部分成功` |

如果项目统一使用 `ResponseUtil` 包装错误，也可以保持 HTTP 200，使用业务 `code` 表示失败；但建议下载类接口保留标准 HTTP 状态，便于外部系统处理。

## 11. 后端代码落点

| 类型 | 代码路径                                                                                                           |
|---|----------------------------------------------------------------------------------------------------------------|
| Controller | `byclaw-be/src/main/java/com/iwhalecloud/byai/state/interfaces/controller/fs/FsOperationController.java`       |
| ApplicationService | `byclaw-be/src/main/java/com/iwhalecloud/byai/state/application/service/fs/FsOperationApplicationService.java` |
| DTO | `byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/fs/dto/`                                            |
| VO | `byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/fs/vo/`                                             |

服务内部统一选择 `UserFS` / `ResourceFS`，并通过 `CurrentUserHolder` 与 `AuthApplicationService` 完成身份和权限校验。
