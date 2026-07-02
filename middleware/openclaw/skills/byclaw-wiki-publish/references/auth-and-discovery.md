# Auth And Discovery

脚本参考平台已有 skill 的服务发现方式：

- 后端服务名来自 `WIKI_REVIEW_BACKEND_SERVICE`，未配置时回退 `BE_DOMAINNAME`。
- Redis 服务发现读取 `REDIS_HOST`、`REDIS_PORT`、`REDIS_DATABASE`/`REDIS_DB`、
  `REDIS_PASSWORD`、`REDIS_USERNAME`。
- 认证 token 来自 `BEYOND_TOKEN`。
- 请求头使用 `Beyond-Token`。
- 如果存在 `USER_CODE`，脚本也会传 `X-User-Code`。

## 必需环境变量

按实际后端接口配置：

| 变量 | 用途 |
| --- | --- |
| `WIKI_REVIEW_UPLOAD_PATH` | Markdown 上传接口 |
| `WIKI_REVIEW_SUBMIT_PATH` | 提交审核接口 |
| `WIKI_REVIEW_STATUS_PATH` | 审核状态查询接口 |
| `WIKI_REVIEW_PUBLISH_PATH` | 发布知识库接口 |
| `WIKI_REVIEW_NOTIFY_PATH` | 通知管理员接口，可选 |

## 上传字段

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `WIKI_REVIEW_UPLOAD_FIELD` | `files` | multipart 文件字段名 |
| `WIKI_REVIEW_UPLOAD_PREFIX` | 空 | 上传前缀，非空时作为 form field `prefix` |

## 常见失败

- `service_not_configured`：配置 `WIKI_REVIEW_BACKEND_SERVICE` 或 `BE_DOMAINNAME`。
- `env_required`：缺少某个接口路径环境变量。
- `request_failed`：后端返回非 2xx 或业务 `code != 0`，看脚本 JSON 输出里的 message。
