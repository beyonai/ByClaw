# 知识模块接口说明

## 文档范围

本文档定义知识模块对外开放的接口。

- Base URL：`/api/v1`
- 协议：`HTTP`
- 默认返回：`application/json`
- 上传文档接口请求体：`multipart/form-data`
- 下载文件接口成功响应：`application/octet-stream`

## 通用约定

### 成功响应

除下载文件接口外，其余接口统一使用如下响应信封：

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

失败时统一返回：

```json
{
  "resultCode": "-1",
  "resultMsg": "request validation failed",
  "resultObject": {}
}
```

### 路径字段约定

- `knCode`：知识库编码
- `directoryPath`：目录路径，以 `/` 开头，不包含知识库名称
- `filePath`：文件路径，以 `/` 开头，不包含知识库名称
- `name`：目录遍历或模式匹配结果中的完整路径

## 接口总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/knowledgeBases/create` | 创建知识库 |
| `POST` | `/api/v1/knowledgeBases/update` | 修改知识库 |
| `POST` | `/api/v1/knowledgeBases/delete` | 删除知识库 |
| `POST` | `/api/v1/directories/create` | 创建目录 |
| `POST` | `/api/v1/directories/update` | 修改目录 |
| `POST` | `/api/v1/directories/delete` | 删除目录 |
| `POST` | `/api/v1/knowledgeItems/import` | 上传文档 |
| `POST` | `/api/v1/knowledgeItems/delete` | 删除文档 |
| `POST` | `/api/v1/listDir` | 获取目录内容 |
| `POST` | `/api/v1/glob` | 按路径模式匹配 |
| `POST` | `/api/v1/readFile` | 读取文件内容 |
| `POST` | `/api/v1/downloadFile` | 下载原始文件 |
| `POST` | `/api/v1/fileToMarkdownIndex` | 异步触发知识构建 |
| `POST` | `/api/v1/fileBuildStatus` | 查询文档构建状态 |
| `POST` | `/api/v1/knowledgeItems/search` | 知识检索 |
| `POST` | `/api/v1/knowledgeItems/importByResourceId` | 按资源 ID 上传文档（Agent 工具） |
| `POST` | `/api/v1/fileToMarkdownIndexByResourceId` | 按资源 ID 触发知识构建（Agent 工具） |
| `POST` | `/api/v1/knowledgeItems/searchByResourceId` | 按资源 ID 知识检索（Agent 工具） |

## 知识库管理

### `POST /api/v1/knowledgeBases/create`

创建知识库。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knName` | string | 是 | 知识库名称 |
| `knDescription` | string | 否 | 知识库描述 |

请求示例：

```json
{
  "knName": "人力制度知识库",
  "knDescription": "公司人事制度与流程文档"
}
```

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "knCode": "1",
    "knName": "人力制度知识库",
    "knDescription": "公司人事制度与流程文档"
  }
}
```

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "knowledge base name already exists: 人力制度知识库",
  "resultObject": {}
}
```

### `POST /api/v1/knowledgeBases/update`

修改知识库名称或描述。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `knName` | string | 否 | 新知识库名称 |
| `knDescription` | string | 否 | 新知识库描述 |

请求示例：

```json
{
  "knCode": "1",
  "knName": "人力制度知识库（新版）",
  "knDescription": "更新后的公司人事制度与流程文档"
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
  "resultMsg": "knowledge base not found: 1",
  "resultObject": {}
}
```

### `POST /api/v1/knowledgeBases/delete`

删除指定知识库。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |

请求示例：

```json
{
  "knCode": "1"
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

## 目录管理

### `POST /api/v1/directories/create`

在指定知识库下面创建目录。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `directoryPath` | string | 是 | 需创建的目录路径，以 `/` 开头，不包括知识库名称，支持递归创建 |
| `directoryDescription` | string | 否 | 目录描述 |

请求示例：

```json
{
  "knCode": "1",
  "directoryPath": "/制度/人事/考勤",
  "directoryDescription": "考勤制度目录"
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
  "resultMsg": "directory path already exists: /制度/人事/考勤",
  "resultObject": {}
}
```

### `POST /api/v1/directories/update`

修改指定知识库的目录。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `directoryPath` | string | 是 | 需要修改的目录路径，以 `/` 开头，不包括知识库名称 |
| `directoryName` | string | 是 | 新目录名称，仅修改 `directoryPath` 最后一个层级的名称 |

请求示例：

```json
{
  "knCode": "1",
  "directoryPath": "/制度/人事/考勤",
  "directoryName": "考勤管理"
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
  "resultMsg": "directory name already exists under parent: 考勤管理",
  "resultObject": {}
}
```

### `POST /api/v1/directories/delete`

删除指定知识库的目录。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `directoryPath` | string | 是 | 需删除的目录路径，以 `/` 开头，不包括知识库名称 |

请求示例：

```json
{
  "knCode": "1",
  "directoryPath": "/制度/人事/考勤"
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
  "resultMsg": "directory not found: /制度/人事/考勤",
  "resultObject": {}
}
```

## 文档管理

### `POST /api/v1/knowledgeItems/import`

将文档上传到指定知识库下面。

请求体：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 上传到知识库后的文件全路径，以 `/` 开头，不包括知识库名称 |
| `fileDescription` | string | 否 | 文件描述 |
| `fileContent` | file | 是 | 文件二进制内容 |

表单示例：

```bash
curl -X POST http://localhost:8000/api/v1/knowledgeItems/import \
  -F "knCode=1" \
  -F "filePath=/制度/人事/考勤制度.pdf" \
  -F "fileDescription=考勤制度原文" \
  -F "fileContent=@./考勤制度.pdf"
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
  "resultMsg": "file path already exists: /制度/人事/考勤制度.pdf",
  "resultObject": {}
}
```

### `POST /api/v1/knowledgeItems/delete`

删除指定知识库下面的文档。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 需删除的文档全路径，以 `/` 开头，不包括知识库名称 |

请求示例：

```json
{
  "knCode": "1",
  "filePath": "/制度/人事/考勤制度.pdf"
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

## 目录与文件读取

### `POST /api/v1/listDir`

获取指定知识库目录下的所有文件和文件夹。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `directoryPath` | string | 是 | 目录路径，以 `/` 开头，不包括知识库名称 |

请求示例：

```json
{
  "knCode": "1",
  "directoryPath": "/制度/人事"
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
        "knCode": "1",
        "name": "/制度/人事/考勤",
        "type": "directory",
        "size": 0
      },
      {
        "knCode": "1",
        "name": "/制度/人事/请假制度.pdf",
        "type": "file",
        "size": 245760
      }
    ]
  }
}
```

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "directory not found: /制度/人事",
  "resultObject": {}
}
```

### `POST /api/v1/glob`

基于路径模式匹配查找指定知识库下面的文件或目录。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `pathRule` | string | 是 | 匹配模式规则，以 `/` 开头，不包括知识库名称；`*` 仅匹配单层路径段，不支持 `**` 多层目录匹配 |

匹配规则：

- `*` 只匹配一层目录或文件名中的任意字符，不跨 `/`。
- 不支持 `**` 语法匹配多层目录。
- 如需匹配两层目录，需要显式写成类似 `/制度/*/*.pdf`。

请求示例：

```json
{
  "knCode": "1",
  "pathRule": "/制度/*/*.pdf"
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
        "knCode": "1",
        "name": "/制度/人事/请假制度.pdf",
        "type": "file",
        "size": 245760
      },
      {
        "knCode": "1",
        "name": "/制度/法务/合同规范.pdf",
        "type": "file",
        "size": 327680
      }
    ]
  }
}
```

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "pathRule must not be empty",
  "resultObject": {}
}
```

### `POST /api/v1/readFile`

根据文件路径读取指定知识库下的原始文件内容，并以 Markdown 文本形式返回。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 需读取的文件全路径，以 `/` 开头，不包括知识库名称 |
| `startLine` | integer | 否 | Markdown 起始行，默认不填表示全部读取 |
| `endLine` | integer | 否 | Markdown 结束行，默认不填表示全部读取 |

请求示例：

```json
{
  "knCode": "1",
  "filePath": "/制度/人事/请假制度.pdf",
  "startLine": 1,
  "endLine": 20
}
```

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "knCode": "1",
    "filePath": "/制度/人事/请假制度.pdf",
    "startLine": 1,
    "endLine": 20,
    "data": "# 请假制度\n\n第一条 适用范围\n...",
    "reachedEof": false
  }
}
```

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "file not found: /制度/人事/请假制度.pdf",
  "resultObject": {}
}
```

### `POST /api/v1/downloadFile`

根据文件路径下载指定知识库下的原始文件。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 需下载的文件全路径，以 `/` 开头，不包括知识库名称 |

请求示例：

```json
{
  "knCode": "1",
  "filePath": "/制度/人事/请假制度.pdf"
}
```

成功响应：

- `200 OK`
- `Content-Type: application/octet-stream`
- `Content-Disposition: attachment; filename="..."` 或带 `filename*`
- 响应体为原始文件二进制字节流

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "file not found: /制度/人事/请假制度.pdf",
  "resultObject": {}
}
```

## 知识构建

### `POST /api/v1/fileToMarkdownIndex`

异步触发指定知识库下文件的构建任务。接口会先检查当前文件是否已存在构建中的任务，再决定是否受理新的构建请求。

后台处理规则：

1. 如果对应文件已存在未完成的构建任务，则不再重复触发构建，直接返回失败响应，`resultCode` 为 `"-1"`，`resultMsg` 返回错误提示。
2. 如果对应文件上一次构建失败，则重新触发构建。
3. 如果对应文件不存在未完成的构建任务，则触发构建流程，自动完成原始文件转 Markdown、切片和切片向量化处理。

构建进度和当前处理环节需要通过 `POST /api/v1/fileBuildStatus` 查询。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 需构建的文档全路径，以 `/` 开头，不包括知识库名称 |

请求示例：

```json
{
  "knCode": "1",
  "filePath": "/制度/人事/请假制度.pdf"
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
  "resultMsg": "build task already exists for file: /制度/人事/请假制度.pdf",
  "resultObject": {}
}
```

### `POST /api/v1/fileBuildStatus`

文档构建状态查询。复用 `FileController.fileListByUser` 对应的状态查询链路。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码，对应 `agt_resource.resource_id` |
| `filePath` | string | 是 | 文件全路径，最后一级为文件名 |

请求示例：

```json
{
  "knCode": "1",
  "filePath": "/制度/人事/请假制度.pdf"
}
```

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "status": "processing",
    "currentStep": "vectorizing",
    "currentStepStatus": "running",
    "statusDict": [
      {
        "standDisplayValue": "处理中",
        "standCode": "processing",
        "standDisplayValueEn": "Processing"
      },
      {
        "standDisplayValue": "成功",
        "standCode": "success",
        "standDisplayValueEn": "Success"
      },
      {
        "standDisplayValue": "失败",
        "standCode": "failed",
        "standDisplayValueEn": "Failed"
      }
    ],
    "stepDict": [
      {
        "standDisplayValue": "原始文件转 Markdown",
        "standCode": "markdown",
        "standDisplayValueEn": "Markdown"
      },
      {
        "standDisplayValue": "文档切片",
        "standCode": "chunking",
        "standDisplayValueEn": "Chunking"
      },
      {
        "standDisplayValue": "切片向量化",
        "standCode": "vectorizing",
        "standDisplayValueEn": "Vectorizing"
      }
    ]
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | string | 构建状态 |
| `currentStep` | string | 当前环节 |
| `currentStepStatus` | string | 当前环节状态 |
| `statusDict` | array[object] | 状态字典 |
| `stepDict` | array[object] | 环节字典 |

`statusDict` 当前支持取值：

| `standCode` | `standDisplayValue` | `standDisplayValueEn` |
| --- | --- | --- |
| `processing` | 处理中 | Processing |
| `success` | 成功 | Success |
| `failed` | 失败 | Failed |

`stepDict` 当前支持取值：

| `standCode` | `standDisplayValue` | `standDisplayValueEn` |
| --- | --- | --- |
| `markdown` | 原始文件转 Markdown | Markdown |
| `chunking` | 文档切片 | Chunking |
| `vectorizing` | 切片向量化 | Vectorizing |
| `complete` | 已完成 | complete |

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "file not found: /制度/人事/请假制度.pdf",
  "resultObject": {}
}
```

## 知识检索

### `POST /api/v1/knowledgeItems/search`

根据用户提问召回对应的知识切片。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | string | 是 | 需要检索的内容 |
| `knCodeList` | array[string] | 是 | 知识库编码列表 |
| `topK` | integer | 是 | 最终返回条数，必须大于 0 |
| `fileTypeList` | array[string] | 否 | 按照文件类型过滤 |
| `searchMode` | string | 是 | 检索模式：`fullTextRecall`、`embedding`、`mixedRecall` |

请求示例：

```json
{
  "query": "员工请假流程是什么",
  "knCodeList": ["1"],
  "topK": 5,
  "fileTypeList": ["pdf"],
  "searchMode": "mixedRecall"
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
        "knCode": "1",
        "filePath": "/制度/人事/请假制度.pdf",
        "chunkNo": 3,
        "chunkId": 10023,
        "chunkText": "员工请假需在 OA 系统发起申请，经部门负责人审批后生效。",
        "score": 92,
        "imagePath": "/images/10023.png",
        "startLine": 18,
        "endLine": 26
      },
      {
        "knCode": "1",
        "filePath": "/制度/人事/考勤制度.pdf",
        "chunkNo": 5,
        "chunkId": 10087,
        "chunkText": "病假需提供医院证明材料。",
        "score": 81,
        "imagePath": "",
        "startLine": 42,
        "endLine": 46
      }
    ]
  }
}
```

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "topK must be greater than 0",
  "resultObject": {}
}
```

## Agent 工具接口

以下接口专门提供给数字员工（Agent）作为工具调用，使用外部资源 ID（`resourceId`）代替内部知识库编码（`knCode`）。系统自动从 MinIO 配置文件读取 `resourceId` 与 `knCode` 的映射关系，调用方无需感知内部编码。

### 接口总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/knowledgeItems/importByResourceId` | 按资源 ID 上传文档 |
| `POST` | `/api/v1/fileToMarkdownIndexByResourceId` | 按资源 ID 触发知识构建 |
| `POST` | `/api/v1/knowledgeItems/searchByResourceId` | 按资源 ID 知识检索 |

### `POST /api/v1/knowledgeItems/importByResourceId`

按资源 ID 上传文档到对应知识库。

请求体：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceId` | string | 是 | 知识库资源 ID，系统自动映射为内部 `knCode` |
| `filePath` | string | 是 | 上传到知识库后的文件全路径，以 `/` 开头，不包括知识库名称 |
| `fileDescription` | string | 否 | 文件描述 |
| `fileContent` | file | 是 | 文件二进制内容 |

表单示例：

```bash
curl -X POST http://localhost:8000/api/v1/knowledgeItems/importByResourceId \
  -F "resourceId=10000003" \
  -F "filePath=/制度/人事/考勤制度.pdf" \
  -F "fileDescription=考勤制度原文" \
  -F "fileContent=@./考勤制度.pdf"
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
  "resultMsg": "cannot resolve resourceId: 99999",
  "resultObject": {}
}
```

### `POST /api/v1/fileToMarkdownIndexByResourceId`

按资源 ID 异步触发对应知识库下文件的构建任务。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceId` | string | 是 | 知识库资源 ID，系统自动映射为内部 `knCode` |
| `filePath` | string | 是 | 需构建的文档全路径，以 `/` 开头，不包括知识库名称 |

请求示例：

```json
{
  "resourceId": "10000003",
  "filePath": "/制度/人事/请假制度.pdf"
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
  "resultMsg": "cannot resolve resourceId: 99999",
  "resultObject": {}
}
```

### `POST /api/v1/knowledgeItems/searchByResourceId`

按资源 ID 列表进行知识检索。响应中的 `knCode` 字段会自动回映为对应的 `resourceId`，保持调用方 ID 体系一致。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceIdList` | array[string] | 是 | 知识库资源 ID 列表，系统自动映射为内部 `knCodeList` |
| `query` | string | 是 | 需要检索的内容 |
| `topK` | integer | 是 | 最终返回条数，必须大于 0 |
| `fileTypeList` | array[string] | 否 | 按照文件类型过滤 |
| `searchMode` | string | 是 | 检索模式：`fullTextRecall`、`embedding`、`mixedRecall` |

请求示例：

```json
{
  "resourceIdList": ["10000003"],
  "query": "员工请假流程是什么",
  "topK": 5,
  "fileTypeList": ["pdf"],
  "searchMode": "mixedRecall"
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
        "knCode": "10000003",
        "filePath": "/制度/人事/请假制度.pdf",
        "chunkNo": 3,
        "chunkId": 10023,
        "chunkText": "员工请假需在 OA 系统发起申请，经部门负责人审批后生效。",
        "score": 92,
        "imagePath": "/images/10023.png",
        "startLine": 18,
        "endLine": 26
      }
    ]
  }
}
```

说明：响应中 `knCode` 返回的是请求时传入的 `resourceId`，而非系统内部编码。

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "cannot resolve one or more resourceIds: ['99999']",
  "resultObject": {}
}
```
