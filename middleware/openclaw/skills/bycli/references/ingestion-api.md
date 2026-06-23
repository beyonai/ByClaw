# byCLI Markdown 入库接口速查

来源文档：`docs/api/ecosystem-ingestion-interfaces.md`。

## 推荐调用顺序

Markdown 入库：

1. `POST /spaceDir/listPersonalKb`
2. 用户选择知识库
3. `POST /ecosystemCollection/ingestion/artifacts/store`
4. `POST /ecosystemCollection/ingestion/knowledge/import`

第四步内部继续完成知识库文件上传、Python 知识服务导入、知识库 build、Markdown 切片和向量化索引。

图片/文件地址上传：

1. 下载 byCLI 返回的 HTTP(S) 资源，或读取本地路径
2. `POST /chat/uploadFiles`
3. 上传成功后结束，不调用生态采集入库接口

所有接口都带 `/byaiService` 前缀。

## listPersonalKb 请求

`POST /spaceDir/listPersonalKb`

请求体：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `pageNum` | 否 | 页码，脚本默认 `1` |
| `pageSize` | 否 | 每页大小，脚本默认 `20` |
| `sessionId` | 否 | 会话 ID |
| `createBy` | 否 | 创建人用户 ID |
| `keyword` | 否 | 知识库名称关键字 |

响应 `data` 常见结构：

| 字段 | 说明 |
| --- | --- |
| `selectedKbs[]` | 已选知识库 |
| `pageInfo.list[]` | 可选知识库列表 |
| `dirId` / `dataId` | 知识库资源 ID，脚本归一化为 `resourceId` / `knowledgeBaseResourceId` |
| `name` | 知识库名称 |
| `datasetId` | 数据集 ID |

SQL 过滤条件：`resource_status = 2` 且 `resource_biz_type in ('KG_DOC','KG_QA','KG_TERM')`。

## chat/uploadFiles 请求

`POST /chat/uploadFiles`

`multipart/form-data`：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `files` | 是 | 文件数组；图片和普通文件都走这个字段 |
| `sessionType` | 是 | 固定传 `AGENT` |
| `sessionId` | 否 | 会话 ID；不传时后端可创建会话 |
| `agentId` | 否 | 数字员工 ID |

响应 `data` 继承 `UploadResult`，常见字段：

| 字段 | 说明 |
| --- | --- |
| `sessionId` | 上传关联会话 ID |
| `uploadItems[]` | 上传结果列表 |
| `uploadItems[].fileId` | 文件 ID |
| `uploadItems[].fileName` | 文件名 |
| `uploadItems[].filePath` | 会话文件路径 |
| `uploadItems[].fileUrl` | 预览 URL |

## task

`task` 使用 `EcosystemTaskVo` JSON。常用字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `taskId` | 建议 | 采集任务 ID，用于目录与审计关联 |
| `taskName` | 建议 | 任务名称 |
| `connectorCode` | 是 | 来源连接器，如 `web`、`zhihu` |
| `sourceName` | 建议 | 来源名称 |
| `sourceUrl` | 建议 | 原始来源链接 |
| `importTarget` | 是 | 必须为 `knowledgeBase` |
| `knowledgeBaseResourceId` | 入库建议 | 知识库资源 ID |
| `knowledgeBaseId` | 可选 | 旧链路知识库 ID |
| `knowledgeBaseName` | 可选 | 知识库名称 |

## collectionResult

`collectionResult` 是 byCLI 输出的归一化结果：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `command` | 否 | 实际执行的 byCLI 命令数组 |
| `outputDir` | 否 | byCLI 临时输出目录；如传，后端要求位于系统 temp 且目录名以 `bykc-ec-` 开头 |
| `rawOutput` | 否 | byCLI 原始输出，会归档为 raw payload |
| `assetCount` | 否 | 附件数量 |
| `items` | 是 | Markdown 条目数组 |

`items[]` 字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 建议 | 条目标题 |
| `fileName` | 是 | Markdown 文件名，如 `article.md` |
| `sourceUrl` | 否 | 条目来源链接 |
| `markdown` | 是 | Markdown 正文 |

## artifacts/store 请求

```json
{
  "runId": 20001,
  "task": {
    "taskId": 10001,
    "taskName": "生态采集-网页",
    "connectorCode": "web",
    "sourceName": "网页",
    "sourceUrl": "https://example.com/article",
    "importTarget": "knowledgeBase",
    "knowledgeBaseResourceId": 90001,
    "knowledgeBaseName": "个人默认知识库"
  },
  "collectionResult": {
    "command": ["bycli", "web", "read", "--url", "https://example.com/article", "-f", "json"],
    "items": [
      {
        "title": "Example Article",
        "fileName": "example-article.md",
        "sourceUrl": "https://example.com/article",
        "markdown": "# Example Article\n\n正文内容"
      }
    ]
  }
}
```

响应 `data.markdownFiles[]` 可直接传给 knowledge/import。

## knowledge/import 请求

```json
{
  "task": {
    "taskId": 10001,
    "taskName": "生态采集-网页",
    "connectorCode": "web",
    "sourceName": "网页",
    "sourceUrl": "https://example.com/article",
    "importTarget": "knowledgeBase",
    "knowledgeBaseResourceId": 90001
  },
  "targetConfig": {
    "knowledgeBaseResourceId": 90001,
    "knowledgeBaseName": "个人默认知识库"
  },
  "markdownFiles": [
    {
      "fileName": "example-article.md",
      "markdown": "# Example Article\n\n正文内容"
    }
  ]
}
```

响应 `data` 关键字段：

| 字段 | 说明 |
| --- | --- |
| `resourceId` | 导入目标知识库资源 ID |
| `directoryPath` | 本次导入目录 |
| `uploadedCount` | 上传文件数 |
| `message` | 导入结果说明 |

## 失败处理

- 认证头缺失：确认运行环境已注入系统参数 `BEYOND_TOKEN`；脚本会把它写入 HTTP 请求头 `beyond-token`。
- 图片/文件地址无法下载：确认 byCLI 返回的是可访问 HTTP(S) URL，或传入存在的本地路径。
- `/chat/uploadFiles` 上传失败：报告后端错误，不再转走知识库入库。
- Markdown 缺少知识库目标：先调 `/spaceDir/listPersonalKb`，让用户选择 `knowledgeBaseResourceId` 后再入库。
- `outputDir` 非系统 temp 或目录名不是 `bykc-ec-*`：去掉 `outputDir` 重试，或改用符合规则的 byCLI 产物目录。
- `knowledge.base.required` / targetConfig 为空：补 `knowledgeBaseResourceId` 或 `knowledgeBaseId`。
- HTTP 401/403：当前门户登录态不可用，停止入库并提示用户恢复门户会话，不要要求用户在对话中粘贴 token。
- 后端非 2xx 或业务 `code` 非 `0/200`：报告脚本输出的 `error`、`backend`、`auth`，停止旁路尝试。
