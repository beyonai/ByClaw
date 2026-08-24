# 知识实体发现与补全接口

本文档定义门户对 byclaw-qa 知识实体异步处理接口的封装。门户接口以 `resourceId` 定位知识库，服务端校验当前用户对该知识库的管理权限后，将其转换为 QA 所需的 `knCode`。

## 通用约定

| 项目 | 说明 |
| --- | --- |
| 门户路径前缀 | `/byaiService/datasetController` |
| 方法 | `POST` |
| 请求格式 | `application/json` |
| 身份认证 | 当前门户登录态（`Beyond-Token`） |
| 权限 | 知识库资源管理权限 |

两个接口均为异步任务创建接口：成功响应表示 QA 已受理本次批次，实际处理由 QA Worker 后台执行。

## 实体发现

### `POST /datasetController/knowledgeItems/entityDiscovery`

扫描单个原始文档或一个知识库中的全部符合条件原始文档，发现实体并创建或更新 `KnowledgeEntity` 文档任务。

请求字段：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `resourceId` | long | 是 | - | 门户知识库资源 ID |
| `filePath` | string | 否 | - | 原始文档路径；未传时处理整个知识库 |
| `maxEntities` | integer | 否 | `12` | 单个原始文档最大实体数，取值 1–12 |
| `force` | boolean | 否 | `false` | 是否跳过已成功任务的 freshness 复用 |
| `extraParams` | object | 否 | `{}` | 透传给 QA batch/task 的扩展参数 |

```bash
curl --request POST 'https://portal.example.com/byaiService/datasetController/knowledgeItems/entityDiscovery' \
  --header 'Content-Type: application/json' \
  --header 'Beyond-Token: <门户登录Token>' \
  --data-raw '{
    "resourceId": 10001,
    "filePath": "/原始文档/AI时代的组织革命.md",
    "maxEntities": 12,
    "force": false,
    "extraParams": {
      "source": "portal"
    }
  }'
```

## 实体补全

### `POST /datasetController/knowledgeItems/entityEnrich`

处理单个 `KnowledgeEntity` 文档或知识库固定 `/KnowledgeEntity` 目录内全部符合条件实体文档，异步补全实体信息、证据和允许的语义关系。

请求字段：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `resourceId` | long | 是 | - | 门户知识库资源 ID |
| `filePath` | string | 否 | - | `KnowledgeEntity` 文档路径；未传时处理固定目录下全部符合条件文件 |
| `topK` | integer | 否 | `20` | 语义证据候选数，必须大于 0 |
| `force` | boolean | 否 | `false` | 是否跳过 freshness 判断 |
| `extraParams` | object | 否 | `{}` | 透传给 QA batch/task 的扩展参数 |

```bash
curl --request POST 'https://portal.example.com/byaiService/datasetController/knowledgeItems/entityEnrich' \
  --header 'Content-Type: application/json' \
  --header 'Beyond-Token: <门户登录Token>' \
  --data-raw '{
    "resourceId": 10001,
    "filePath": "/KnowledgeEntity/OSOT.md",
    "topK": 20,
    "force": false
  }'
```

## 受理响应

两个接口的门户响应信封为 `ResponseUtil`；`data` 对应 QA 的批次受理结果，并由门户补充 `resourceId`。

```json
{
  "code": 0,
  "msg": "知识实体发现任务已受理",
  "data": {
    "resourceId": 10001,
    "batchId": "ed-20260817-0001",
    "scope": "SINGLE_FILE",
    "taskType": "ENTITY_DISCOVERY",
    "eligibleCount": 1,
    "acceptedCount": 1,
    "reusedCount": 0,
    "skippedCount": 0,
    "tasks": [
      {
        "taskId": "9001",
        "status": "PENDING",
        "fileId": "1024",
        "filePath": "/原始文档/AI时代的组织革命.md",
        "reused": false
      }
    ]
  }
}
```

`filePath` 会由门户统一为以 `/` 开头的知识库内路径；包含 `..` 的越界路径会被拒绝。门户不会接受或暴露客户端传入的 `knCode`。
