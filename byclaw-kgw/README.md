# byclaw-kgw

Knowledge Gateway for Byclaw — a unified API gateway that routes knowledge-base operations to heterogeneous KB backends, with metadata property management, ingest pipeline, and observability built in.

## 目录结构

```
byclaw-kgw/
├── start.sh              # 模块启动入口
├── Dockerfile            # 容器构建
├── pyproject.toml        # Python 项目定义与依赖
├── sql/                  # 数据库迁移脚本（启动时自动执行）
├── src/kgw/
│   ├── main.py           # FastAPI 应用工厂 + lifespan 资源管理
│   ├── settings.py       # 环境变量配置（pydantic-settings）
│   ├── api/              # HTTP API 路由层
│   ├── dispatcher.py     # 操作路由：网关操作 → KB 后端分发
│   ├── config_provider.py# KB 配置读取（MinIO KG_DOC）
│   ├── auth_provider.py  # 用户认证头解析（Redis）
│   ├── upstream.py       # 上游 HTTP 调用（直连 / by-framework 服务发现）
│   ├── stream_proxy.py   # 流式上传/下载代理
│   ├── event_processor.py# Ingest 事件处理
│   ├── idempotency.py    # 事件幂等性
│   ├── envelope.py       # 统一响应信封 + 错误类型
│   ├── http_client.py    # 共享 httpx AsyncClient
│   ├── db.py             # 数据库连接池 + 迁移执行
│   ├── metadata/         # 元数据子系统（属性注册、同步、绑定、翻译）
│   ├── resilience/       # 熔断器
│   ├── audit/            # 审计日志写入
│   ├── observability/    # 结构化日志、Prometheus 指标、TraceId
│   ├── schemas/          # Ingest 数据模型（StandardItem）
│   └── workers/          # 后台清理 & 对账 worker
└── tests/
```

## 功能模块

### API 网关

对外暴露统一的 REST API（`/kgw/api/v1`），将请求路由到对应知识库后端：

| 端点 | 说明 |
|------|------|
| `POST /knowledgeItems/import` | 文件导入（支持 Markdown front-matter 元数据解析与翻译） |
| `POST /knowledgeItems/delete` | 删除文件（级联清理 metadata binding） |
| `POST /knowledgeItems/search` | 多 KB 并行语义搜索 |
| `POST /knowledgeItems/metadataSearch` | 多 KB 并行元数据搜索 |
| `POST /knowledgeItems/searchFile` | 文件级搜索 |
| `POST /knowledgeItems/metadata/update` | 更新文件元数据（含 lazy-sync、binding 事务） |
| `POST /knowledgeItems/metadata/get` | 读取文件元数据 |
| `POST /knowledgeItems/metadataFields/list` | 列出当前 KB 下已同步的元数据字段 |
| `POST /fileToMarkdownIndex` | 文件转为 Markdown 索引 |
| `POST /fileBuildStatus` | 查询构建状态 |
| `POST /downloadFile` | 流式下载文件 |
| `POST /listDir` | 列出目录 |
| `POST /glob` | 通配符文件匹配 |
| `POST /readFile` | 读取文件内容 |
| `POST /dslGuide` | Agent DSL 语法参考 |

### Ingest 事件管线

接收外部 Connector 上报的数据变更事件：

| 端点 | 说明 |
|------|------|
| `POST /kgw/ingest/v1/events` | 单个事件提交（4MB 上限，幂等） |
| `POST /kgw/ingest/v1/events/batch` | 批量事件提交（最多 100 条） |
| `GET /kgw/ingest/v1/events/{id}` | 查询事件状态 |
| `GET /kgw/ingest/v1/events` | 事件列表（多条件过滤分页） |
| `POST /kgw/ingest/v1/events/{id}/replay` | 重放失败事件 |

事件支持 `delete` / `upsert` / `reindex` 操作，upsert 内容通过 `inlineBase64` 或 `remoteUrl` 两种方式提供。

### 元数据属性管理

全局定义和管理元数据属性（`/kgw/api/v1/metadataProperties`）：

| 端点 | 说明 |
|------|------|
| `POST /create` | 创建单个属性 |
| `POST /batchCreate` | 批量创建 |
| `POST /list` | 查询属性列表 |
| `POST /delete` | 软删除属性（自动清理由 cleanup worker 完成） |

属性支持类型：`string`、`stringList`、`number`、`boolean`、`datetime`

### 管理端点

| 端点 | 说明 |
|------|------|
| `GET /kgw/admin/v1/audit` | 审计日志查询 |
| `GET /kgw/admin/v1/conflicts` | 冲突日志查询 |
| `POST /kgw/admin/v1/kbs/{knCode}/files/{path}/lock` | 文件锁定 |
| `POST /kgw/admin/v1/kbs/{knCode}/files/{path}/unlock` | 文件解锁 |
| `GET /kgw/admin/v1/metadata-properties` | 管理视图（含 sync 详情） |
| `GET /kgw/admin/v1/metadata-properties/orphans` | 孤儿行巡检 |
| `POST /kgw/admin/v1/metadata-properties/{name}/sync-retry` | 重试失败同步 |
| `POST /kgw/admin/v1/metadata-properties/{name}/purge-retry` | 重试失败清理 |

### 基础设施

| 端点 | 说明 |
|------|------|
| `GET /healthz` | 健康检查 |
| `GET /metrics` | Prometheus 指标导出 |

### 后台 Worker

在 lifespan 中启动的常驻异步任务：

- **cleanup worker** — 扫描 `PURGING`/`PURGE_FAILED` 同步行，调用后端 `metadataPropertiesDelete` 清理 `__byclaw_kgw__` 列，完成后物理删除属性主记录
- **reconcile worker** — 复核过期 `DELETING` binding：后端仍有字段则恢复为 `BOUND`，后端已无字段则删除 binding（防僵尸行堆积）

### 核心能力

- **KB 配置动态发现**：每次请求从 MinIO 实时读取 `KG_DOC_{knCode}.json`，无缓存，始终反映门户最新配置
- **双路由模式**：支持直连（`domainURL`）和 by-framework 服务发现（`domainName`）两种后端拓扑
- **knCode 翻译**：将门户侧 `knCode` 自动转换为后端侧 `resourceCode`
- **认证头注入**：从 Redis 解析用户认证信息，替换请求头中的 `{user_code}` 等占位符
- **熔断保护**：按 KB 后端做独立熔断（失败阈值 / 开路持续时间 / 半开探测）
- **元数据翻译**：将前端属性名（`propertyName`）翻译为后端安全名称（`backend_name`），请求/响应双向翻译
- **Lazy Sync**：元数据属性首次使用时自动向后端注册 `__byclaw_kgw__` 列
- **Binding 事务**：文件导入 / 元数据更新成功后记录 `BOUND` binding；删除/解绑使用 `DELETING` 中间态，失败时由 reconcile worker 按后端实际状态恢复或清理
- **幂等事件处理**：基于 `sourceId + itemId + version` 的幂等 key，防止重复处理
- **并发控制**：ingest 信号量限制（默认 100），满时返回 503 + Retry-After

## 启动方式

```bash
cd byclaw-kgw
./start.sh api
```

使用 `uvicorn` 启动 `kgw.main:app`，默认监听 `0.0.0.0:8200`。

## 环境变量

`start.sh` 从模块目录 `.env` 读取环境变量，直接使用仓库级命名（无需 `BYCLAW_KGW_` 前缀）：

**数据库（PostgreSQL / OpenGauss）：**

| 变量 | 说明 | 默认 |
|------|------|------|
| `DB_HOST` | 数据库主机 | 必填 |
| `DB_PORT` | 数据库端口 | 必填 |
| `DB_DATABASE` | 数据库名 | 必填 |
| `DB_SCHEMA` | schema | `""` |
| `DB_USER` | 数据库用户 | 必填 |
| `DB_PASS` | 数据库密码 | 必填 |
| `DB_POOL_MIN_SIZE` | 连接池最小值 | `1` |
| `DB_POOL_MAX_SIZE` | 连接池最大值 | `10` |

**Redis：**

| 变量 | 说明 | 默认 |
|------|------|------|
| `REDIS_HOST` | Redis 主机 | 必填 |
| `REDIS_PORT` | Redis 端口 | 必填 |
| `REDIS_USERNAME` | Redis 用户名 | `""` |
| `REDIS_PASSWORD` | Redis 密码 | `""` |
| `REDIS_DATABASE` | Redis 库号 | `0` |
| `REDIS_AUTH_KEY_TEMPLATE` | 用户认证 key 模板 | `user:{user_code}:login:auth` |

**MinIO：**

| 变量 | 说明 | 默认 |
|------|------|------|
| `FILE_STORAGE_MINIO_HOST` | MinIO 主机 | 必填 |
| `FILE_STORAGE_MINIO_API_PORT` | MinIO API 端口 | 必填 |
| `FILE_STORAGE_MINIO_ACCESS_KEY` | Access Key | 必填 |
| `FILE_STORAGE_MINIO_SECRET_KEY` | Secret Key | 必填 |
| `FILE_STORAGE_MINIO_BUCKET_NAME` | Bucket 名称 | 必填 |
| `FILE_STORAGE_MINIO_SECURE` | 是否 HTTPS | `false` |

**网关调优（可选）：**

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | 监听端口 | `8200` |
| `HOST` | 绑定地址 | `0.0.0.0` |
| `HTTP_DEFAULT_TIMEOUT_SECONDS` | 后端调用超时（秒） | `30` |
| `HTTP_POOL_MAX_CONNECTIONS` | HTTP 连接池上限 | `200` |
| `HTTP_POOL_MAX_KEEPALIVE` | HTTP Keepalive 上限 | `50` |
| `AUDIT_QUEUE_MAX_SIZE` | 审计队列上限 | `10000` |
| `CIRCUIT_FAILURE_THRESHOLD` | 熔断失败阈值 | `5` |
| `CIRCUIT_OPEN_DURATION` | 熔断开路持续（秒） | `30` |
| `INGEST_CONCURRENCY_LIMIT` | Ingest 并发上限 | `100` |
| `MINIO_KG_DOC_PREFIX` | KG_DOC 对象 key 前缀 | `resource/doc/KG_DOC_` |

## Docker

```bash
# 构建
docker build -t byclaw-kgw:latest .

# 运行（使用 .env.docker）
docker run --env-file .env.docker -p 8200:8200 byclaw-kgw:latest
```

## 运行依赖

- Python >= 3.12
- FastAPI + uvicorn
- PostgreSQL / OpenGauss（数据库）
- Redis（用户认证 token 存储）
- MinIO（KB 配置文件存储）

建议使用 `uv` 管理依赖和运行环境：

```bash
uv venv
uv sync
source .venv/bin/activate
```
