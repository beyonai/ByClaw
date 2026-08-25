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
- `sourcePath`：移动源路径列表，以 `/` 开头，不包含知识库名称
- `targetDirectoryPath`：移动目标目录路径，以 `/` 开头，不包含知识库名称
- `targetFilePath`：移动目标文件路径，以 `/` 开头，不包含知识库名称
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
| `POST` | `/api/v1/knowledgeItems/move` | 移动文件或目录 |
| `POST` | `/api/v1/knowledgeItems/references` | 查询指定文件的 Markdown 引用关系 |
| `POST` | `/api/v1/listDir` | 获取目录内容 |
| `POST` | `/api/v1/glob` | 按路径模式匹配 |
| `POST` | `/api/v1/readFile` | 读取文件内容 |
| `POST` | `/api/v1/downloadFile` | 下载文件 |
| `POST` | `/api/v1/fileToMarkdown` | 上传文件并同步转换为 Markdown 文件流 |
| `POST` | `/api/v1/fileToMarkdownIndex` | 异步触发知识构建 |
| `POST` | `/api/v1/fileBuildStatus` | 查询文档构建状态 |
| `POST` | `/api/v1/buildResult` | 查询文档最新一次构建结果、Markdown 和切片 |
| `POST` | `/api/v1/knowledgeItems/search` | 知识检索 |
| `GET` | `/health` | 探活 |

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

### `POST /api/v1/knowledgeItems/move`

移动指定知识库下的一个或多个文件、目录。`targetDirectoryPath` 与 `targetFilePath` 必须且只能填写一个。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `sourcePath` | array[string] | 是 | 源路径列表；每项以 `/` 开头，不包含知识库名称 |
| `targetDirectoryPath` | string | 否 | 目标目录；不存在时自动创建，每个源保留原名称 |
| `targetFilePath` | string | 否 | 单个文件的目标路径，可用于移动并重命名；父目录不存在时自动创建 |
| `overwrite` | boolean | 否 | 是否覆盖目标，默认 `false`；当前版本仅支持 `false` |

使用 `targetDirectoryPath` 时支持单源、多源、文件和目录。使用 `targetFilePath` 时，仅允许一个文件源。目录移动会连同所有子目录和文件一起移动；单个源失败不影响同批次其他源，失败原因返回在 `data[].error`。

请求示例：

```json
{
  "knCode": "1",
  "sourcePath": [
    "/制度/人事/考勤制度.pdf",
    "/制度/人事/图片"
  ],
  "targetDirectoryPath": "/归档/人事",
  "overwrite": false
}
```

成功或部分成功响应：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {
        "sourcePath": "/制度/人事/考勤制度.pdf",
        "targetPath": "/归档/人事/考勤制度.pdf",
        "success": true,
        "error": null
      },
      {
        "sourcePath": "/制度/人事/不存在.pdf",
        "targetPath": null,
        "success": false,
        "error": "source path not found: /制度/人事/不存在.pdf"
      }
    ],
    "summary": {
      "total": 2,
      "succeeded": 1,
      "failed": 1
    }
  }
}
```

以下结构性错误会导致整请求失败：空源列表、非法或跨界路径、移动根目录、源路径重复、目标字段同时填写或同时缺失、目录移动到自身或子目录，以及将 `targetFilePath` 用于多源或目录源。目标已存在时对应移动项失败，不执行覆盖。

### `POST /api/v1/knowledgeItems/references`

查询指定文件的 Markdown 引用关系。兼容别名 `/api/v1/knowledge-items/references`。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 查询对象文件路径，以 `/` 开头，不包括知识库名称 |
| `direction` | string | 否 | `inbound`、`outbound`、`all`，默认 `inbound` |

响应中的 `resultObject.inbound` 和 `resultObject.outbound` 固定为数组，元素包含 `sourcePath`、`originalTarget`、`targetSuffix`、`targetPath` 和 `status`；`status` 可能为 `resolved`、`unresolved` 或 `broken`。

### `POST /api/v1/knowledgeItems/import`

将文档上传到指定知识库下面。支持单文件上传与 zip 包批量上传；zip 内文件保留相对目录结构，逐文件返回成功或失败结果。

请求体：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCode` | string | 是 | 知识库编码 |
| `filePath` | string | 是 | 单文件上传时为目标文件全路径；zip 上传时为目标目录路径，以 `/` 开头，不包括知识库名称 |
| `fileDescription` | string | 否 | 文件描述；zip 上传时对所有文件统一使用该描述 |
| `fileContent` | file | 是 | 文件二进制内容；文件名以 `.zip` 结尾且为合法 zip 时触发批量上传 |
| `processFrontMatter` | boolean | 否 | 是否解析 YAML front matter 并自动录入元数据，默认 `true` |

表单示例：

```bash
curl -X POST http://localhost:8000/api/v1/knowledgeItems/import \
  -F "knCode=1" \
  -F "filePath=/制度/人事/考勤制度.pdf" \
  -F "fileDescription=考勤制度原文" \
  -F "fileContent=@./考勤制度.pdf"
```

成功响应：单文件上传同样返回单元素批量结果；zip 中单个文件失败不影响其他文件，`resultCode` 仍为 `0`。

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      { "filePath": "/制度/人事/考勤制度.pdf", "success": true, "error": null }
    ],
    "summary": { "total": 1, "succeeded": 1, "failed": 0 },
    "postProcessErrors": []
  }
}
```

`postProcessErrors` 为可选字段，表示文件入库后的批处理错误，不计入 `summary`。

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

根据文件路径下载指定知识库下的文件。非 Markdown 文件返回入库字节；Markdown 文件返回引用路径已解析后的 Markdown 字节流。

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
- 响应体为文件字节流；Markdown 文件为解析后的 Markdown 字节流

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "file not found: /制度/人事/请假制度.pdf",
  "resultObject": {}
}
```

## 知识构建

### `POST /api/v1/fileToMarkdown`

上传一个原始文件，同步执行原始文件转 Markdown，并以 Markdown 文件流返回。该接口不创建知识库文件、构建任务或索引。

请求体：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileContent` | file | 是 | 需转换的原始文件二进制内容 |

成功响应为 `application/octet-stream`，`Content-Disposition` 文件名使用原文件名并替换为 `.md` 扩展名。

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

### `POST /api/v1/buildResult`

查询指定文件最新一次构建的完整结果，包括构建状态、转换后的 Markdown、切片分页、向量化覆盖率和检索索引覆盖率。

注意：

- 接口查询的是文件最新一次构建任务，不返回历史构建任务列表。
- 文件必须至少触发过一次知识构建，否则返回 `build task not found`。
- `includeMarkdown=false` 时不读取 Markdown 正文，适合只查看构建状态和切片统计的场景。

请求体：`application/json`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `knCode` | string | 是 | - | 知识库编码 |
| `filePath` | string | 是 | - | 文件全路径，以 `/` 开头，不包括知识库名称 |
| `chunkPage` | integer | 否 | `1` | 切片页码，从 `1` 开始 |
| `chunkPageSize` | integer | 否 | `20` | 每页切片数量，范围为 `1`～`100` |
| `includeMarkdown` | boolean | 否 | `true` | 是否在响应中返回完整 Markdown 正文 |

请求示例：

```json
{
  "knCode": "1",
  "filePath": "/汇报/年度总结.pptx",
  "chunkPage": 1,
  "chunkPageSize": 20,
  "includeMarkdown": true
}
```

成功响应示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "knCode": "1",
    "filePath": "/汇报/年度总结.pptx",
    "fileName": "年度总结.pptx",
    "fileType": "pptx",
    "fileSize": 859923,
    "mimeType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "build": {
      "status": "complete",
      "currentStep": "complete",
      "errorMessage": null,
      "startedAt": "2026-08-04T09:56:14.989000+00:00",
      "finishedAt": "2026-08-04T09:56:16.239000+00:00",
      "durationMs": 1250,
      "statusDict": [
        {
          "standCode": "complete",
          "standDisplayValue": "已完成",
          "standDisplayValueEn": "complete"
        },
        {
          "standCode": "failed",
          "standDisplayValue": "失败",
          "standDisplayValueEn": "failed"
        },
        {
          "standCode": "running",
          "standDisplayValue": "构建中",
          "standDisplayValueEn": "running"
        },
        {
          "standCode": "unsupported",
          "standDisplayValue": "不支持构建",
          "standDisplayValueEn": "unsupported"
        }
      ],
      "stepDict": [
        {
          "standCode": "markdown",
          "standDisplayValue": "原始文件转 Markdown",
          "standDisplayValueEn": "markdown"
        },
        {
          "standCode": "chunking",
          "standDisplayValue": "文档切片",
          "standDisplayValueEn": "chunking"
        },
        {
          "standCode": "vectorizing",
          "standDisplayValue": "切片向量化",
          "standDisplayValueEn": "vectorizing"
        },
        {
          "standCode": "complete",
          "standDisplayValue": "已完成",
          "standDisplayValueEn": "complete"
        }
      ]
    },
    "markdown": {
      "available": true,
      "data": "# 年度总结\n\n## 第一部分\n...",
      "lineCount": 128,
      "characterCount": 4047,
      "byteCount": 9731
    },
    "chunks": {
      "data": [
        {
          "chunkNo": 1,
          "startLine": 1,
          "endLine": 18,
          "content": "# 年度总结\n\n## 第一部分\n...",
          "characterCount": 526,
          "hasEmbedding": true,
          "retrievalIndexed": true
        }
      ],
      "page": 1,
      "pageSize": 20,
      "total": 8,
      "reachedEof": true
    },
    "embedding": {
      "dimension": 1024,
      "embeddedChunkCount": 8,
      "coverageRate": 100.0
    },
    "retrieval": {
      "indexedChunkCount": 8,
      "coverageRate": 100.0
    }
  }
}
```

主要响应字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `build` | object | 最新构建任务的状态、当前步骤、错误信息、开始/完成时间和耗时 |
| `markdown.available` | boolean | 是否存在已生成的 Markdown 文件 |
| `markdown.data` | string/null | Markdown 正文；`includeMarkdown=false` 时为 `null` |
| `markdown.lineCount` | integer | Markdown 行数 |
| `markdown.characterCount` | integer/null | Markdown 字符数；未读取正文时为 `null` |
| `markdown.byteCount` | integer/null | Markdown UTF-8 字节数；未读取正文时为 `null` |
| `chunks.data` | array[object] | 当前页切片，包含行号、正文、向量和索引状态 |
| `chunks.total` | integer | 文件切片总数 |
| `chunks.reachedEof` | boolean | 当前页是否已经到达最后一页 |
| `embedding.coverageRate` | number | 已生成向量的切片占比，单位为百分比 |
| `retrieval.coverageRate` | number | 已进入检索索引的切片占比，单位为百分比 |

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "build task not found: /汇报/年度总结.pptx",
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
| `searchMode` | string | 是 | 检索模式：`fullTextRecall`、`embedding`、`mixedRecall` |
| `where` | object | 否 | Agent DSL 过滤 AST |
| `metadataFieldList` | array[string] | 否 | 需要返回的元数据字段 |
| `fileTypeList` | array[string] | 否 | 按文件类型过滤；与 `where` 同时存在时合取 |

请求示例：

```json
{
  "query": "员工请假流程是什么",
  "knCodeList": ["1"],
  "topK": 5,
  "searchMode": "mixedRecall",
  "where": {"in": {"fieldName": "fileType", "value": ["pdf"]}}
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

## 门户调用 QA 的元数据检索接口

本节定义门户后端对 QA `POST /api/v1/knowledgeItems/metadataSearch` 的两种调用封装。两个门户接口最终调用同一个 QA 接口，区别在于是否执行资源 ID 与知识库编码的映射：

| 门户接口 | 封装方式 | 请求 ID 体系 | 响应 ID 体系 | QA 接口 |
| --- | --- | --- | --- | --- |
| `POST /datasetController/knowledgeItems/metadataSearch` | 资源 ID 映射封装 | `resourceIdList` | `data[].knCode` 回映为 `resourceId` | `POST /api/v1/knowledgeItems/metadataSearch` |
| `POST /datasetController/knowledgeItems/metadataSearchByKnCode` | QA 原始协议透传 | `knCodeList` | 保留 QA 返回的 `knCode` | `POST /api/v1/knowledgeItems/metadataSearch` |

### `POST /datasetController/knowledgeItems/metadataSearch`

按门户知识库资源 ID 执行 Agent DSL 纯元数据检索，只返回文件级结果。门户会查询资源信息、校验当前调用方的知识库读取权限，并将 `resourceIdList` 转换为 QA 所需的 `knCodeList`。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceIdList` | array[integer] | 是 | 门户知识库资源 ID 列表；门户校验读取权限后映射为 QA `knCodeList` |
| `where` | object | 是 | Agent DSL 过滤 AST，原样传给 QA |
| `metadataFieldList` | array[string] | 否 | 需要返回的元数据字段，原样传给 QA |
| `topK` | integer | 否 | 未传 `pageSize` 时作为每页条数，最大 `10000` |
| `pageNum` | integer | 否 | 页码，从 `1` 开始；未传时由 QA 使用默认值 `1` |
| `pageSize` | integer | 否 | 每页条数，最大 `10000`；传入时优先于 `topK` |

请求示例：

```json
{
  "resourceIdList": [10000003],
  "where": {
    "and": [
      {"eq": {"fieldName": "status", "value": "active"}},
      {"contains": {"fieldName": "tags", "value": "contract"}}
    ]
  },
  "metadataFieldList": ["status", "tags", "fileSignature"],
  "pageNum": 1,
  "pageSize": 20
}
```

映射关系：

| 门户请求/响应 | QA 请求/响应 | 映射规则 |
| --- | --- | --- |
| `resourceIdList[]` | `knCodeList[]` | 按 `ss_resource.resource_id` 查询 `resource_code`，并校验知识库读取权限 |
| `where` | `where` | 原样透传 |
| `metadataFieldList` | `metadataFieldList` | 原样透传 |
| `topK` | `topK` | 原样透传 |
| `pageNum` | `pageNum` | 原样透传 |
| `pageSize` | `pageSize` | 原样透传 |
| `data[].knCode` | `resultObject.data[].knCode` | QA 返回 `knCode` 后，门户回映为对应的 `resourceId` 字符串 |
| `data[].filePath`、`data[].metadata` | 同名字段 | 原样返回 |
| `total`、`pageNum`、`pageSize` | 同名字段 | 原样返回，不改变 QA 排序和分页顺序 |

门户实际发送给 QA 的请求示例：

```json
{
  "knCodeList": ["2"],
  "where": {
    "and": [
      {"eq": {"fieldName": "status", "value": "active"}},
      {"contains": {"fieldName": "tags", "value": "contract"}}
    ]
  },
  "metadataFieldList": ["status", "tags", "fileSignature"],
  "pageNum": 1,
  "pageSize": 20
}
```

成功响应示例：

```json
{
  "code": 0,
  "msg": "知识库文件语义检索成功",
  "data": {
    "data": [
      {
        "knCode": "10000003",
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
    ],
    "total": 1,
    "pageNum": 1,
    "pageSize": 20
  }
}
```

说明：响应项仍使用兼容 QA 的字段名 `knCode`，但其值已经由门户转换为 `resourceId`。门户不会重新排序结果，QA 按 `knowledge_fs_entry.updated_at`、文件 `kid` 生成的稳定顺序会被保留。

失败场景：

- `resourceIdList` 为空、包含空值或资源不存在时，门户直接返回参数或资源错误。
- 当前调用方没有任一知识库的读取权限时，门户不会调用 QA。
- QA 返回 DSL 校验或检索错误时，门户按统一异常响应格式返回错误信息。

### `POST /datasetController/knowledgeItems/metadataSearchByKnCode`

QA 原始协议透传接口。门户将请求体直接传给 QA，并原样返回 QA 响应；不查询 `ss_resource`，不执行 `resourceId` 与 `knCode` 转换，也不改写 QA 响应信封。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `knCodeList` | array[string] | 否 | QA 知识库编码范围，直接透传 |
| `where` | object | 是 | Agent DSL 过滤 AST，直接透传 |
| `metadataFieldList` | array[string] | 否 | 需要返回的元数据字段，直接透传 |
| `topK` | integer | 否 | 未传 `pageSize` 时作为每页条数，默认 `500`，最大 `10000` |
| `pageNum` | integer | 否 | 页码，从 `1` 开始，默认 `1` |
| `pageSize` | integer | 否 | 每页条数，最大 `10000`；传入时优先于 `topK` |

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
  "metadataFieldList": ["status", "tags", "fileSignature"],
  "pageNum": 1,
  "pageSize": 20
}
```

映射关系：

| 门户请求/响应 | QA 请求/响应 | 映射规则 |
| --- | --- | --- |
| 完整请求体 | 完整请求体 | 字段和值直接透传，不进行 `knCode` 转换 |
| QA `resultCode` | 门户 `resultCode` | 原样返回 |
| QA `resultMsg` | 门户 `resultMsg` | 原样返回 |
| QA `resultObject` | 门户 `resultObject` | 原样返回，包括成功数据及失败时的 `errorCode/errorList` |
| `resultObject.data[].knCode` | 同名字段 | 保留 QA 原始 `knCode` |

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
    ],
    "total": 1,
    "pageNum": 1,
    "pageSize": 20
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

结果顺序由 QA 决定，固定按 `knowledge_fs_entry.updated_at` 从旧到新排序；更新时间相同时按文件 `kid` 从小到大排序。门户不进行二次排序。

## 已移除的 Agent 工具接口

以下 `*ByResourceId` 包装接口已经移除，保留本节仅用于识别旧调用和迁移。调用方应改用门户接口；可信服务网络内直接调用 QA 原生接口时，应传入 `knCode`，并通过 `X-Byclaw-Resource-Id` 请求头传递资源上下文。

### 接口总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/knowledgeItems/importByResourceId` | 按资源 ID 上传文档 |
| `POST` | `/api/v1/fileToMarkdownIndexByResourceId` | 按资源 ID 触发知识构建 |
| `POST` | `/api/v1/buildResultByResourceId` | 按资源 ID 查询文档构建结果 |
| `POST` | `/api/v1/knowledgeItems/searchByResourceId` | 按资源 ID 知识检索 |
| `POST` | `/api/v1/directories/createByResourceId` | 按资源 ID 创建目录 |
| `POST` | `/api/v1/directories/updateByResourceId` | 按资源 ID 修改目录 |
| `POST` | `/api/v1/directories/deleteByResourceId` | 按资源 ID 删除目录 |
| `POST` | `/api/v1/listDirByResourceId` | 按资源 ID 获取目录内容 |
| `POST` | `/api/v1/readFileByResourceId` | 按资源 ID 读取文件内容 |
| `POST` | `/api/v1/downloadFileByResourceId` | 按资源 ID 下载原始文件 |

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

### `POST /api/v1/buildResultByResourceId`

按资源 ID 查询对应知识库中文件的最新构建结果。系统先将 `resourceId` 映射为内部 `knCode`，再执行构建结果查询。

请求体：`application/json`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `resourceId` | string | 是 | - | 知识库资源 ID，系统自动映射为内部 `knCode` |
| `filePath` | string | 是 | - | 文件全路径，以 `/` 开头，不包括知识库名称 |
| `chunkPage` | integer | 否 | `1` | 切片页码，从 `1` 开始 |
| `chunkPageSize` | integer | 否 | `20` | 每页切片数量，范围为 `1`～`100` |
| `includeMarkdown` | boolean | 否 | `true` | 是否在响应中返回完整 Markdown 正文 |

请求示例：

```json
{
  "resourceId": "10000003",
  "filePath": "/汇报/年度总结.pptx",
  "chunkPage": 1,
  "chunkPageSize": 20,
  "includeMarkdown": true
}
```

成功响应结构与 `POST /api/v1/buildResult` 相同，但 `resultObject.knCode` 返回请求中的 `resourceId`。关键字段示例：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "knCode": "10000003",
    "filePath": "/汇报/年度总结.pptx",
    "build": {
      "status": "complete",
      "currentStep": "complete"
    },
    "markdown": {
      "available": true,
      "data": "# 年度总结\n..."
    },
    "chunks": {
      "page": 1,
      "pageSize": 20,
      "total": 8,
      "reachedEof": true
    }
  }
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

### `POST /api/v1/directories/createByResourceId`

按资源 ID 在对应知识库下创建目录。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceId` | string | 是 | 知识库资源 ID，系统自动映射为内部 `knCode` |
| `directoryPath` | string | 是 | 需创建的目录路径，以 `/` 开头，不包括知识库名称，支持递归创建 |
| `directoryDescription` | string | 否 | 目录描述 |

请求示例：

```json
{
  "resourceId": "10000003",
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
  "resultMsg": "cannot resolve resourceId: 99999",
  "resultObject": {}
}
```

### `POST /api/v1/directories/updateByResourceId`

按资源 ID 修改对应知识库下的目录名称。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceId` | string | 是 | 知识库资源 ID，系统自动映射为内部 `knCode` |
| `directoryPath` | string | 是 | 需要修改的目录路径，以 `/` 开头，不包括知识库名称 |
| `directoryName` | string | 是 | 新目录名称，仅修改 `directoryPath` 最后一个层级的名称 |

请求示例：

```json
{
  "resourceId": "10000003",
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
  "resultMsg": "cannot resolve resourceId: 99999",
  "resultObject": {}
}
```

### `POST /api/v1/directories/deleteByResourceId`

按资源 ID 删除对应知识库下的目录。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceId` | string | 是 | 知识库资源 ID，系统自动映射为内部 `knCode` |
| `directoryPath` | string | 是 | 需删除的目录路径，以 `/` 开头，不包括知识库名称 |

请求示例：

```json
{
  "resourceId": "10000003",
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
  "resultMsg": "cannot resolve resourceId: 99999",
  "resultObject": {}
}
```

### `POST /api/v1/listDirByResourceId`

按资源 ID 获取对应知识库目录下的所有文件和文件夹。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceId` | string | 是 | 知识库资源 ID，系统自动映射为内部 `knCode` |
| `directoryPath` | string | 是 | 目录路径，以 `/` 开头，不包括知识库名称 |

请求示例：

```json
{
  "resourceId": "10000003",
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
        "knCode": "10000003",
        "name": "/制度/人事/考勤",
        "type": "directory",
        "size": 0
      },
      {
        "knCode": "10000003",
        "name": "/制度/人事/请假制度.pdf",
        "type": "file",
        "size": 245760
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
  "resultMsg": "cannot resolve resourceId: 99999",
  "resultObject": {}
}
```

### `POST /api/v1/readFileByResourceId`

按资源 ID 读取对应知识库下文件的 Markdown 内容。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceId` | string | 是 | 知识库资源 ID，系统自动映射为内部 `knCode` |
| `filePath` | string | 是 | 需读取的文件全路径，以 `/` 开头，不包括知识库名称 |
| `startLine` | integer | 否 | Markdown 起始行，默认不填表示全部读取 |
| `endLine` | integer | 否 | Markdown 结束行，默认不填表示全部读取 |

请求示例：

```json
{
  "resourceId": "10000003",
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
    "knCode": "10000003",
    "filePath": "/制度/人事/请假制度.pdf",
    "startLine": 1,
    "endLine": 20,
    "data": "# 请假制度\n\n第一条 适用范围\n...",
    "reachedEof": false
  }
}
```

说明：响应中 `knCode` 返回的是请求时传入的 `resourceId`，而非系统内部编码。

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "cannot resolve resourceId: 99999",
  "resultObject": {}
}
```

### `POST /api/v1/downloadFileByResourceId`

按资源 ID 下载对应知识库下的原始文件。

请求体：`application/json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `resourceId` | string | 是 | 知识库资源 ID，系统自动映射为内部 `knCode` |
| `filePath` | string | 是 | 需下载的文件全路径，以 `/` 开头，不包括知识库名称 |

请求示例：

```json
{
  "resourceId": "10000003",
  "filePath": "/制度/人事/请假制度.pdf"
}
```

成功响应：

- `200 OK`
- `Content-Type: application/octet-stream`
- `Content-Disposition: attachment; filename="..."`
- 响应体为原始文件二进制字节流

失败响应示例：

```json
{
  "resultCode": "-1",
  "resultMsg": "cannot resolve resourceId: 99999",
  "resultObject": {}
}
```
