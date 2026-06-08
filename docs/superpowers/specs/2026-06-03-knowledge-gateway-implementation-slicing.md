# 知识网关 v5.0 实施切片设计

> 状态：草案
> 日期：2026-06-03
> 关联：[`2026-06-02-knowledge-gateway-design-v5.md`](./2026-06-02-knowledge-gateway-design-v5.md)、[`2026-06-02-knowledge-gateway-ingest-api.md`](./2026-06-02-knowledge-gateway-ingest-api.md)

## 1. 目的与范围

v5.0 设计文档（以下简称 "v5 spec"）已经定义了完整的目标架构。本文档不重新设计架构，只回答一个问题：**如何把阶段 1 MVP 切成可独立验收的实施子项目，按什么顺序推进，每一片包含什么。**

阶段 1 MVP 包含 18 个文件级操作端点 + metadataProperty 主目录 + 懒同步 + ingest + 熔断 + 审计 + 流式代理 + DB schema + 可观测，一次性塞进单一实施计划存在以下风险：

- 计划过长，写计划就需要数千 token，写代码前难以发现设计漏洞
- 检查点稀疏，等到尾声才发现早期假设错误
- 单 PR 体积巨大，code review 难以聚焦
- 任意一片卡住会阻塞所有后续工作

因此把阶段 1 MVP 拆为 5 个子项目（**S1–S5**），每个子项目独立走 spec → plan → 实施循环，独立验收，独立合并。本文档是这 5 个子项目的总览与依赖图。

阶段 2、阶段 3 不在本文档范围内，按 v5 spec §8.1 排期。

## 2. 技术栈选型（与 byclaw-qa 对齐）

为减少跨模块认知负担，KGW 直接采用 byclaw-qa 已落地的栈：

| 维度 | 选型 | 备注 |
|---|---|---|
| Python | 3.12 | 与 byclaw-qa 一致 |
| Web 框架 | FastAPI + uvicorn | 与 byclaw-qa 一致；全 async |
| HTTP 客户端 | httpx (AsyncClient) | 流式上传/下载 + 共享连接池 |
| PostgreSQL（OpenGauss 兼容） | psycopg (async) + `dict_row` + `AsyncConnection` | 复用 by_qa `knowledge_base/infrastructure/database.py` 同款连接工厂 |
| DB 迁移 | 编号 SQL 文件（如 `000_extensions.sql`、`001_ingest_event.sql`），由启动期幂等执行器跑一次 | 与 by_qa `knowledge_base/sql/*.sql` 模式一致；不引入 Alembic |
| MinIO | aioboto3 | 复用 byclaw-qa `MinioResourceClient` 的实现模式 |
| Redis | redis.asyncio | 复用 byclaw-qa `_resolve_header_placeholders()` 的 `user:{user_code}:login:auth` hash 读取模式 |
| 校验 | pydantic v2 | StandardItem / 端点 payload schema |
| 日志 | structlog 或 logging（与 by_qa 对齐） | 结构化字段 `trace_id`, `kn_code`, `operation` |
| 指标 | prometheus_client | 端点暴露 `/metrics` |
| 追踪 | opentelemetry-api（仅注入 trace 头，导出在 P1+） | MVP 仅本地 trace ID 串联 |
| 测试 | pytest + pytest-asyncio + httpx ASGI client + respx + testcontainers | 集成测试用容器起 OpenGauss/Redis/MinIO；KB 后端用 respx mock |
| 包管理 | uv | byclaw-kgw 已有 `uv.lock` |
| 工具链 | ruff + pylint + pyink + pre-commit (husky 触发) | byclaw-kgw 已有 `.pre-commit-config.yaml` |

明确不采用：SQLAlchemy ORM（spec 已用裸 SQL DDL，加 ORM 重复定义）、Alembic（小项目用编号 SQL 更轻）、官方 minio SDK（与 byclaw-qa 不一致）。

## 3. 切片总览

```
S1  骨架 + 配置/鉴权 Provider + httpx + 审计 + 单进程启动
        │
        ▼
S2  serve 写路径 (8 个文件级写操作 + 流式上传/下载 + per-endpoint 熔断器)
        │
        ▼
S3  serve 读/检索路径 (4 个并行检索 + 6 个单 KB 读 + degraded_kbs + 错误归一化)
        │
        ▼
S4  metadataProperty 主目录 + 懒同步 + __kgw__ 前缀双向转换 + 冲突日志
        │
        ▼
S5  ingest 端点 + StandardItem + 幂等 + DLQ + admin 端点 + 验收
```

依赖是线性的：S2 依赖 S1 的配置/鉴权/httpx/审计基础设施；S3 复用 S2 的请求拼装与熔断；S4 在 S2/S3 转发链路上挂一个改写中间件；S5 复用全部 serve 基础设施。每片完成后均可独立 demo 与回归。

## 4. 切片详情

每片定义 4 个要素：**范围（What）、不在范围内的（Won't）、产出物（Deliverables）、验收（Acceptance）**。验收条目对齐 v5 spec §13。

### S1 · 骨架 + 配置鉴权 Provider + 审计

**范围（What）**

- 项目骨架：`src/kgw/` 包结构（按 v5 spec §10）、`pyproject.toml` 完善、Dockerfile 草案
- 单进程 FastAPI app（`src/kgw/main.py`）+ uvicorn 启动 + `/healthz`、`/metrics`
- 配置加载：从环境变量读 MinIO/Redis/PG 连接信息（v5 spec §11.1）
- `KbConfigProvider`：从 MinIO `resource/doc/KG_DOC_{knCode}.json` 实时获取 KB 配置（不缓存）
- `AuthProvider`：从 Redis `user:{user_code}:login:auth` 读 hash，提供 `${KEY}` 占位符替换器（参考 byclaw-qa `_resolve_header_placeholders`）
- 共享 httpx `AsyncClient`：连接池 + 超时 + 仅幂等读重试 + trace ID 注入
- DB 接入：psycopg async 连接工厂 + 启动期跑 `sql/*.sql` 编号迁移（首发：`000_extensions.sql`、`001_kgw_audit_log.sql`、`002_kgw_kb_write_history.sql`、`003_kgw_kb_source_lock.sql`、`004_kgw_kb_conflict_log.sql`；后续片各自追加新文件，不修改既有文件）
- 审计写入器：异步 sink，写 `kgw_audit_log`，失败不阻断业务（v5 spec §7.1）
- 结构化日志 + Prometheus 指标基础（不含端点级指标）
- 一个示例 `/kgw/internal/v1/echo` 端点，验证整个调用链：解析 X-User-Id → 取鉴权 → 取配置 → 走 httpx → 写审计

**不在范围（Won't）**

- 任何业务端点（18 个文件级操作、metadataProperty 接口、ingest 端点都留给后续）
- 熔断器（移到 S2）
- metadataProperty 主目录表与逻辑（移到 S4）
- ingest 表与逻辑（移到 S5）

**产出物**

- `src/kgw/{main,config_provider,auth_provider,http_client,db,audit/writer}.py`
- `sql/000_*.sql` ~ `sql/004_*.sql`
- `tests/test_config_provider.py`、`tests/test_auth_provider.py`、`tests/test_http_client.py`、`tests/test_audit_writer.py`、`tests/test_app_startup.py`
- 部署：能 `uv run uvicorn kgw.main:app` 起服务

**验收**

- [ ] 服务启动后 `/healthz` 返回 200；`/metrics` 暴露默认指标
- [ ] 启动期跑迁移，DB 中可见 4 张审计/lock/history/conflict 表（`kgw_audit_log` / `kgw_kb_write_history` / `kgw_kb_source_lock` / `kgw_kb_conflict_log`）；`ingest_event` 与 metadataProperty 相关 3 张表分别由 S5、S4 创建
- [ ] 调 `/echo` 端点：成功路径写一条 audit_log，payload 已脱敏
- [ ] MinIO 缺 `KG_DOC_{knCode}.json` 时返回 `KBNotFound`
- [ ] Redis 中无 `user:{user_code}:login:auth` 时返回 `AuthInfoNotFound`
- [ ] 鉴权 hash 中缺指定字段时记录 warning，不抛异常
- [ ] httpx 客户端启用 trace ID 透传，下游收到 `X-Trace-Id`

### S2 · serve 写路径 + 流式 + 熔断

**范围（What）**

- 调度核心 `dispatcher.py`：路径 → OperationType 映射；从 body 提取 `knCode`；通过 ConfigProvider 拿 endpoint；通过 AuthProvider 渲染 headers；调 KB 后端
- 7 个高危写端点（v5 spec §6.5.1，不含 metadata/update 与 metadataProperty 写——留给 S4）：
  - `/kgw/api/v1/directories/{create,update,delete}`
  - `/kgw/api/v1/knowledgeItems/{import,delete}`
  - `/kgw/api/v1/{fileToMarkdownIndex,fileBuildStatus}`
  - 注：`fileBuildStatus` 是读但和构建强相关，本片一并实现以保持端点闭环；`metadata/update` 必须做 `__kgw__` 前缀转换才能保证应用层接口语义，所以推到 S4 一并实现
- 流式代理 `stream_proxy.py`：multipart 上传 chunk 透传、octet-stream 下载 `aiter_bytes`、流式失败立即关连接不重试（v5 spec §4.3）
- per-endpoint 进程内熔断器 `resilience/circuit_breaker.py`：CLOSED/OPEN/HALF_OPEN，按 `endpoint_url` 维度，`failure_threshold=5` / `open_duration=30s` / `half_open_max_requests=1`（v5 spec §4.4）
- 高危写操作审计：写入 `kgw_audit_log`（source='serve'）+ `kgw_kb_write_history`
- 错误归一化：`KBNotFound`、`OperationNotSupported`、`UpstreamTimeout`、`UpstreamConnectError`、`UploadStreamBroken`、`AuthInfoNotFound`、`BackendAuthFailed`、`CircuitOpen`（v5 spec §6.6 中写路径相关项；其余错误类型由对应 slice 引入）
- 端点级指标：`kgw_dispatch_total`、`kgw_dispatch_latency_seconds`、`kgw_stream_bytes_total`、`kgw_circuit_state`

**不在范围（Won't）**

- 检索类操作（4 个）+ 单 KB 读类（listDir/glob/readFile/downloadFile/dslGuide）→ S3
- metadataProperty 字段名转换 → S4
- ingest → S5
- 多 KB 并行扇出（写路径都是单 KB）

**产出物**

- `src/kgw/dispatcher.py`、`src/kgw/stream_proxy.py`、`src/kgw/resilience/circuit_breaker.py`、`src/kgw/envelope.py`（错误归一化）
- `src/kgw/api/{directories,knowledge_items,files}.py`（仅写端点 + buildStatus）
- 单元测试 + 集成测试（respx mock KB 后端）

**验收**

- [ ] 7 个写端点全部可调；payload 在 `kgw_audit_log` 中有脱敏记录
- [ ] `fileImport` 上传 100MB 文件，Pod 内存峰值 < 100MB（v5 spec §13）
- [ ] 上传中断时返回 `UploadStreamBroken`，连接立刻关闭，无重试
- [ ] 熔断器：连续 5 次失败后进入 OPEN；30s 后 HALF_OPEN 探测；探测成功回到 CLOSED
- [ ] 熔断 OPEN 时调用返回 `CircuitOpen`，不打到后端
- [ ] 多 Pod 下熔断器各自独立（不共享状态）
- [ ] `kgw_circuit_state{kn_code}` 指标随状态变化

### S3 · serve 读/检索路径 + 多 KB 并行

**范围（What）**

- 4 个并行检索端点：
  - `/kgw/api/v1/knowledgeItems/{search,metadataSearch,searchFile}`
  - `/kgw/api/v1/knowledgeItems/metadataFields/list`
- 5 个单 KB 读端点：`/kgw/api/v1/{listDir,glob,readFile,downloadFile,dslGuide}`
- 多 KB 扇出器：`asyncio.gather` 并行调用每个 knCode 对应的 endpoint；单 KB 失败标记 `degraded_kbs`，不影响其他（v5 spec §3.1）
- 流式下载：复用 S2 的 `stream_proxy`
- 错误归一化补全：`DownloadStreamBroken`
- 读端点不写审计（v5 spec §7.1）

**不在范围（Won't）**

- metadata 字段名转换（仍透传逻辑名）→ S4
- 检索响应中元数据字段反向转换 → S4

**产出物**

- `src/kgw/api/{knowledge_items_search,files_read,dsl_guide}.py`（按需细分）
- 多 KB 扇出工具函数（可放 `dispatcher.py` 或拆 `fan_out.py`）
- 集成测试覆盖：`knCodeList=[A,B,C]`，B 后端注入 503，验证 A/C 成功 + B 在 `degraded_kbs`

**验收**

- [ ] 多 KB 并行检索，一个 KB 失败不阻塞其他，degraded_kbs 标记正确（v5 spec §13）
- [ ] 熔断 OPEN 的 KB 在多 KB 检索中进入 degraded_kbs（不抛错）
- [ ] downloadFile 流式下载 100MB 文件，调用方 < 1s 收到首字节
- [ ] 下载中断返回部分数据 + 提前 EOF，连接关闭
- [ ] readFile/listDir/glob 全部正常工作

### S4 · metadataProperty 主目录 + 懒同步 + 前缀映射

**范围（What）**

- 4 个 metadataProperty 主目录端点：
  - `/kgw/api/v1/metadataProperties/{create,batchCreate,delete,list}`
- 2 个文件元数据端点（依赖懒同步与字段名双向转换，从 S2/S3 推到本片）：
  - `/kgw/api/v1/knowledgeItems/metadata/{update,get}`
- DB 表迁移：`kgw_metadata_property` + `kgw_metadata_property_sync` + `kgw_metadata_property_conflict`（编号 `005_`、`006_`、`007_`）
- `metadata_registry.py`：CRUD + 逻辑名 `status` ↔ 物化名 `__kgw__status` 转换
- `metadata_sync.py`：按 `(propertyName, targetBackend)` 跟踪同步状态；目标后端类型不一致 → 写 conflict_log + 返回 `MetadataPropertyConflict`
- 懒同步中间件：在 dispatcher 中接入 serve 路径
  - 触发操作：`metadata/update`、`metadata/get`、`metadataSearch`、`search`、`searchFile`、`fileImport`、`metadataFields/list`
  - 流程：校验 key 在主目录存在 → 查 sync 状态 → 未同步则调后端 `batchCreate` 写 `__kgw__*` → 改写 payload 中的 metadata key → 转发
- 响应反向转换：response 中的 `__kgw__*` 字段统一改回逻辑名（v5 spec §4.6.2 末段）
- 错误归一化补全：`MetadataPropertyNotFound`、`MetadataPropertyConflict`、`MetadataPropertySyncFailed`
- 软删除语义（v5 spec §4.6.3）
- metadataProperty 相关指标（v5 spec §7.2）

**不在范围（Won't）**

- ingest 路径的懒同步（待 S5 在 ingest 流水线中复用同一中间件）
- 后端 `__kgw__*` 字段的异步清理（v5 spec §4.6.3 提到"可异步清理"，MVP 留 stub）

**产出物**

- `src/kgw/{metadata_registry,metadata_sync}.py`
- `src/kgw/api/metadata_properties.py`
- `sql/005_*.sql` ~ `sql/007_*.sql`
- 单元测试覆盖前缀映射；集成测试覆盖完整懒同步首次/二次调用差异

**验收**

- [ ] `metadataProperties/create` 写入网关主目录，不调 KB 后端
- [ ] `metadataProperties/list` 仅返回主目录中 ACTIVE 字段，不需要 knCode
- [ ] `metadata/update` 使用未声明字段返回 `MetadataPropertyNotFound`
- [ ] 首次使用某 (propertyName, knCode) 自动调后端 `batchCreate` 写 `__kgw__*`
- [ ] 后端已存在 `__kgw__status` 但类型不一致 → `MetadataPropertyConflict` + conflict_log 记录
- [ ] `metadata/update`、`metadata/get`、`metadataSearch`、`search`、`searchFile` 中 metadata 字段双向转换正确

### S5 · ingest + admin + MVP 验收

**范围（What）**

- DB 表迁移：`ingest_event`（编号 `008_`）
- StandardItem pydantic schema 与 JSON Schema（v5 spec §4.5.2）
- 5 个 ingest 端点（详见 ingest API 子文档）：
  - `POST /kgw/ingest/v1/events`、`POST /events/batch`、`GET /events/{id}`、`GET /events`、`POST /events/{id}/replay`
- 同步事件处理流水线（v5 spec §4.5.1）：
  - StandardItem schema 校验 → knCode 校验 → metadataProperty 引用校验 → **复用 S4 懒同步中间件** → version 单调性 → source_lock 检查 → INSERT received → 幂等检查 → 取鉴权 → 调 KB 写接口 → DONE/FAILED → 写审计
- 幂等：`(sourceId, itemId, version)` UNIQUE；命中已有记录返回 already-processed/in_progress/failed
- DLQ：failed 事件保留在 `ingest_event` 表（status='failed' + error_*），`/replay` 接口重新入流水线
- 同步处理约束：单事件 ≤ 4MB / 处理超时 30s / 并发槽 100 / Connector 限速 30 RPS（v5 spec §4.5.5）
- 4 个管理端点：
  - `GET /kgw/admin/v1/audit`、`GET /kgw/admin/v1/conflicts`、`POST/DELETE /kgw/admin/v1/kbs/{knCode}/files/{path}/{lock,unlock}`
- 错误归一化补全：v5 spec §6.6 全表
- ingest 指标（v5 spec §7.2）
- by-qa 等价测试：基于 GatewayClient 跑 byclaw-qa 现有 KB 调用的 happy path

**不在范围（Won't）**

- Conformance Suite（阶段 2）
- gbrain-connector 真实 push（阶段 2）
- 队列引入（阶段 8.2 触发条件）

**产出物**

- `src/kgw/{event_processor,idempotency,dlq}.py`
- `src/kgw/schemas/standard_item.py`
- `src/kgw/api/{events,admin}.py`
- `sql/008_ingest_event.sql`
- 完整 OpenAPI 规范 `spec/kgw.openapi.yaml` v0.1
- 端到端测试：Connector → ingest → KB（respx mock）→ audit → admin 查询

**验收**（v5 spec §13 全部 MVP 条目）

- [ ] StandardItem schema 校验器单测通过
- [ ] push 100 条事件全部 done，重复推送同 (sourceId,itemId,version) 返回 already-processed
- [ ] 非法 StandardItem 返回 422 + errorList，不落库
- [ ] KB 后端不可用时事件 failed 入 DLQ；`/replay` 恢复
- [ ] ingest 鉴权方式与 serve 一致（X-User-Id → Redis）
- [ ] admin 端点：审计/冲突可查；lock/unlock 工作
- [ ] OpenAPI v0.1 完整描述所有端点
- [ ] by-qa 等价 happy path 通过

## 5. 公共约束

### 5.1 每片必须满足

- 所有接口 `async def`，事件循环下无阻塞调用（不混用同步 IO）
- 单元测试 + 集成测试覆盖关键路径，整体覆盖率 ≥ 75%
- `ruff check` 与 `pylint` 通过（CLAUDE.md 指定的 pre-commit 流程）
- 提交按 conventional commits 用 `kgw` scope（如 `feat(kgw): add audit writer`）
- 每片合并前用 `superpowers:verification-before-completion` skill 跑一次 verification

### 5.2 端点路径约定

所有端点统一前缀：
- 业务：`/kgw/api/v1/*`
- ingest：`/kgw/ingest/v1/*`
- 管理：`/kgw/admin/v1/*`
- 内部健康：`/healthz`、`/metrics`

### 5.3 测试基础设施

集成测试用 testcontainers 启动：
- OpenGauss（或 PG 13+ 等价镜像，预先做兼容性 spike）
- Redis 7+
- MinIO（latest）

KB 后端用 respx mock。SQL 迁移在每个测试 session 启动时自动执行。

⚠️ **OpenGauss 兼容性 spike 不在 S1 之外做**：S1 第一步用 testcontainers 跑 PG 13 + by_qa 同款 psycopg 连接工厂；如果 OpenGauss 测试镜像可用，本地切换验证一遍后续 S2-S5 全部默认兼容。

### 5.4 仓库布局（最终目标）

按 v5 spec §10：

```
byclaw-kgw/
├── pyproject.toml
├── sql/                              # 编号迁移文件
├── src/kgw/
│   ├── main.py
│   ├── config_provider.py
│   ├── auth_provider.py
│   ├── http_client.py
│   ├── db.py
│   ├── dispatcher.py
│   ├── envelope.py
│   ├── stream_proxy.py
│   ├── metadata_registry.py
│   ├── metadata_sync.py
│   ├── event_processor.py
│   ├── idempotency.py
│   ├── dlq.py
│   ├── api/
│   │   ├── directories.py
│   │   ├── knowledge_items.py
│   │   ├── metadata_properties.py
│   │   ├── files.py
│   │   ├── events.py
│   │   └── admin.py
│   ├── schemas/standard_item.py
│   ├── audit/writer.py
│   ├── resilience/circuit_breaker.py
│   └── observability/{logger,metrics,tracing}.py
├── spec/
│   └── kgw.openapi.yaml              # 阶段尾随增量编辑
├── tests/
└── deploy/                           # Dockerfile / k8s
```

每片只创建/修改本片范围内的文件，不提前 stub 后续片的模块。

## 6. 工作流程

每片走如下流程：

1. **进入 worktree**：`EnterWorktree name=kgw-S{N}-<topic>` 隔离开发分支
2. **写实施计划**：调用 `superpowers:writing-plans` skill，把当前片的范围/产出物/验收作为输入
3. **执行计划**：按 plan 中的 task 顺序实施；TDD 强约束（`superpowers:test-driven-development`）
4. **完成前验证**：`superpowers:verification-before-completion`
5. **代码 review**：`superpowers:requesting-code-review`
6. **结束分支**：`superpowers:finishing-a-development-branch` 决定 PR / merge / cleanup
7. **合并主仓后**：从 worktree 退出，进入下一片

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| OpenGauss 与 PG 协议差异导致 psycopg 行为不一致 | S1 早期做兼容性 spike；如发现差异，记录到本文档 §2 注脚，必要时引入 by_qa 已用的连接 patch |
| testcontainers 起动慢拖测试周期 | session 级 fixture；CI 用 docker layer 缓存；本地开发可指向常驻 docker compose |
| 5 片中有任何一片范围估算偏小 | 每片在 plan 阶段重新估算；超出预期时拆出尾片（如 S2.5）后再实施 |
| spec v5.0 后续若有更新 | 每片 plan 阶段重新核对 v5 spec 对应章节；切片设计文档（本文）作为版本快照 |
| Connector 真实接入未在 MVP 内验证 | S5 验收用 by-qa happy path 替代；阶段 2 引入 gbrain-connector 做真实 push 验证 |

## 8. 不做什么

- 不在阶段 1 引入消息队列（v5 spec §8.2 触发条件未满足）
- 不在阶段 1 引入本地配置缓存（先保证一致性，性能优化按需）
- 不实现 v5 spec §1.2 列出的所有"不做"项（KB 生命周期、KB 级 ACL、应用层鉴权等）
- 不在网关侧暴露后端原生 `/api/v1/metadataProperties/*`；这些只是网关内部同步目标
