# 知识网关 (Knowledge Gateway) 设计文档 — v5.0（简化版）

> 状态：草案 v5.0
> 日期：2026-06-02
> 基于：v4.1 设计文档，根据三项新前置条件大幅简化
>
> v4.1 → v5.0 核心变更：
> - **鉴权模型彻底简化**：门户将鉴权信息保存到 Redis，网关从 headers 取 User ID，到 Redis 下获取鉴权信息。取消 X 模式 header 映射、auth_mapping 表、凭据透传。
> - **配置从门户获取，网关不存配置**：门户已维护 knCode 唯一性。网关不维护 node/KB/operation 注册表，改为从门户获取配置（参考 byclaw-qa 当前做法）。取消 Service Node 注册、健康检查、别名机制。熔断器保留但简化为进程内独立运行（不依赖注册表/Redis 状态共享/探活循环）。
> - **单进程异步架构**：serve 与 ingest 合并为单一 FastAPI 进程，所有接口均为 async。简化部署与运维，共享连接池与配置/鉴权基础设施。
> - **Connector 负责全部权限管理**：Connector 读门户配置管理权限。网关只定义标准数据导入接口（StandardItem schema），用 Connector 提供的 event 写入 KB。取消 Connector 注册表、token 管理、白名单授权。

---

## 1. 定位与边界

### 1.1 网关做什么

知识网关（KGW）是一个轻量级单进程异步服务（Python FastAPI），承担五项职责：

1. **企业知识标准口径**：以 OpenAPI 契约 + 统一信封作为机读规范，覆盖知识库内文件的全生命周期操作（18 个端点）以及网关托管的元数据属性定义接口。
2. **统一入口与透明路由**：调用方用 knCode 寻址 KB，网关从 MinIO 获取 KB 配置、从 Redis 获取鉴权信息，透明路由到目标 KB 服务。
3. **元数据属性注册中心**：metadataProperty 在网关维护全局主目录，业务 KB 后端仅保存带固定前缀的物化副本；网关在实际使用时按目标 KB 懒同步。
4. **知识数据导入标准接口**：为外部知识源定义标准数据导入接口（StandardItem schema + ingest 端点），负责接收标准化事件并写入对应 KB。
5. **企业级运行保障**：高危写操作强制审计、per-endpoint 进程内熔断、流式失败立即关连接不重试、请求级 trace、结构化日志。**所有接口均为 async**。

### 1.2 网关不做什么

- **不存配置**：node 信息、KB 信息、knCode 映射全部从门户获取，网关不维护注册表。
- **不存凭据**：鉴权信息从 Redis 读取（门户写入），网关不做凭据代管。
- **不做权限管理**：Connector 的 KB 写入权限由 Connector 自己读门户配置管理。网关只定义标准接口。
- **不做应用层鉴权于消费者→网关之间**：网关南向部署在内网，靠网络隔离。
- **不做 KB 级 ACL**：不做 dry-run / 二次确认。高危写操作直接透传，靠审计事后追溯。
- **不做 KB 生命周期管理**：KB 创建/修改/注销由业务系统或门户编排处理，网关不代理 `/api/v1/knowledgeBases/*`。
- **不做后端原生 metadataProperty 直连入口**：应用侧只能通过网关声明元数据属性；业务 KB 后端的同名接口仅作为网关内部同步目标，不作为应用入口暴露。
- **不做异步任务管理器**：构建任务状态由 KB 后端持有；ingest 事件状态由 ingest_event 表持有。

### 1.3 与 v4.1 的关键差异

| 维度 | v4.1 | v5.0（本设计） |
|---|---|---|
| 鉴权模型 | X 模式：调用方传 `X-KB-Auth-*` header，网关按映射规则透传 | **User ID → Redis 取鉴权信息** |
| KB 配置来源 | 网关自维护 kgw_kb / kgw_service_node 注册表 | **从门户获取**（参考 byclaw-qa 从 MinIO 读 DIG_EMPLOYEE / KG_DOC 配置） |
| knCode 唯一性 | 网关自增别名 (kgw_kb.kb_code BIGSERIAL) | **门户维护，网关直接使用** |
| 别名改写 | AliasRewriter 中间件双向改写 | **不需要**，knCode 全局唯一由门户保证 |
| 节点管理 | 节点主动注册 + 网关探活 + Redis 动态状态 | **不需要**，节点信息由门户配置 |
| 熔断器 | Service Node 级，依赖注册表 + Redis 状态共享 + leader 选举探活循环 | **per-endpoint 进程内熔断器**，不依赖注册表/Redis/探活循环，每个 Pod 独立运行 |
| Connector 管理 | 网关注册 Connector + token + 白名单授权 | **Connector 自管理**，网关只定义标准接口 |
| 进程数 | 2（serve + ingest） | **1（单进程）**，serve 与 ingest 合并为同一 FastAPI 应用 |
| metadataProperty | 网关 promote/reject，可参与治理流程 | **网关全局主目录 + 后端带前缀物化副本 + 懒同步** |
| 关系库表 | kgw_service_node / kgw_kb / kgw_kb_operation / kgw_node_auth_mapping / kgw_connector | **取消 KB/node 注册表**，仅保留 ingest / 审计 / 写入历史 / metadataProperty 主目录与同步状态 |
| 管理面端点 | node/kb/auth_mapping/connector CRUD | **仅保留 ingest 相关端点、审计查询、文件锁定、metadataProperty 定义接口** |

---

## 2. 顶层架构

### 2.1 总图

```
┌────────────────────────────────────────────────────────────────────────┐
│  Layer 1 · 消费者接入层                                                  │
│                                                                          │
│  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────────────┐  │
│  │ by-qa /          │ │ 业务系统 /       │ │ 管理后台 UI /           │  │
│  │ 智能体平台       │ │ 运维脚本         │ │ 其他 HTTP 客户端        │  │
│  └────────┬─────────┘ └────────┬─────────┘ └───────────┬────────────┘  │
│           │                    │                        │                │
│           │  HTTP+JSON        │                        │                │
│           │  Headers: X-User-Id (用户标识)              │                │
│           │  Body: knCode (KB 标识, 门户维护唯一性)     │                │
└───────────┼────────────────────┼────────────────────────┼────────────────┘
            ▼                    ▼                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Layer 2 · 知识网关 — 单进程异步服务                                     │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  知识网关 (Python · FastAPI · 单进程 · 全 async)                    │ │
│  │  ───────────────────────────────────────────────                    │ │
│  │  · 18 个文件级操作端点 + metadataProperty 定义接口 + ingest 端点       │ │
│  │  · 鉴权解析 (User ID → Redis)                                       │ │
│  │  · 配置获取 (MinIO → KB endpoint)                                   │ │
│  │  · 请求路由 (knCode → KB) + 流式代理                                │ │
│  │  · 事件接收 + StandardItem Schema 校验 + 事务表 + DLQ               │ │
│  │  · per-endpoint 进程内熔断器                                        │ │
│  │  · 审计写入 (serve 写 + ingest 写 共用)                             │ │
│  │  · 可观测 (日志 / Prometheus / OpenTelemetry)                       │ │
│  └──────────────┬──────────────────────────┬───────────────────────────┘ │
│                 │                          │                              │
│                 │ 鉴权来源                  │ 配置来源                     │
│                 ▼                          ▼                              │
│          ┌─────────────┐           ┌─────────────┐                       │
│          │ Redis        │           │ MinIO 门户   │                       │
│          │ user:{code}: │           │ KG_DOC_{kn} │                       │
│          │ login:auth   │           │ .json        │                       │
│          └─────────────┘           └─────────────┘                       │
└────────────────────────────────────────────────────────────────────────┘
                  │                          ▲
                  │ HTTP+JSON /              │ HTTP+JSON
                  │ multipart / octet        │ (StandardItem)
                  ▼                          │
       ┌──────────────────────┐    ┌─────────────────────────┐
       │  Layer 3 · 业务知识库 │    │  Layer 4 · Connector    │
       │  (KB Service)         │    │  (gbrain / obsidian /   │
       │  每个 KB 对外暴露     │    │   notion / ...)         │
       │  HTTP endpoint        │    │  读门户配置 + Mapping   │
       │  (endpoint 由门户维护)│    │  → push StandardItem    │
       └──────────────────────┘    └─────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  Layer 5 · 网关存储 (仅 ingest + 审计)                                   │
│  ┌────────────────────┐  ┌────────────────────┐                        │
│  │ PostgreSQL         │  │ Redis              │                        │
│  │ - ingest_event     │  │ - 鉴权信息          │                        │
│  │ - kgw_audit_log    │  │   (门户写入，       │                        │
│  │ - kgw_kb_write_    │  │    网关只读)        │                        │
│  │   history           │  │                    │                        │
│  │ - kgw_kb_source_lock│  │                    │                        │
│  │ - kgw_kb_conflict_  │  │                    │                        │
│  │   log               │  │                    │                        │
│  └────────────────────┘  └────────────────────┘                        │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键简化说明

#### 2.2.1 鉴权流程简化

**v4.1 方式（已废弃）**：
```
调用方 → 自行登录每个业务KB获取token → 请求时塞 X-KB-Auth-<knCode>-<field> header
       → 网关按 auth_mapping 表渲染成后端 header → 转发到 KB
```

**v5.0 方式**：
```
调用方 → 请求时带 X-User-Id header + knCode
       → 网关从 Redis 读该用户对该 KB 的鉴权信息
       → 组装后端请求，直接调 KB
```

参考实现：byclaw-qa 中 `worker.py` 的 `_resolve_header_placeholders()` 方法，从 Redis key `user:{user_code}:login:auth` 读取鉴权信息。

#### 2.2.2 配置获取简化

**v4.1 方式（已废弃）**：
```
网关维护 kgw_service_node + kgw_kb 表 → 节点启动调注册接口 → 网关定时探活
→ Redis 存节点动态状态 → 熔断器跟踪健康度 → AliasRewriter 中间件改写别名
```

**v5.0 方式**：
```
门户维护 KB 配置（knCode、name、endpoint URL、capabilities）
→ 每次请求时，网关从门户中间件实时获取 KB 配置
→ 请求进来用 knCode 查配置 → 找到 endpoint → 调 KB
→ 保证数据一致性，后续可引入短期缓存作为性能优化
```

参考实现：byclaw-qa 中 `minio_agent_config.py` 从 MinIO 读取 `DIG_EMPLOYEE_{agent_id}.json` 和 `KG_DOC_{resource_id}.json`，解析出 domainURL、headers、resourceService 等 KB 配置信息。

#### 2.2.3 单进程合并

**v4.1 方式（已废弃）**：
```
serve 进程（读路径 + 调度 + 熔断 + 审计） + ingest 进程（写路径 + 事件处理 + DLQ）
→ 双 Deployment 独立部署、独立扩缩容、独立发版
```

**v5.0 方式**：
```
单进程 FastAPI 应用，承载全部端点（18 个文件级操作端点 + metadataProperty 定义接口 + ingest 端点）
→ 共享连接池、配置获取、鉴权获取、审计写入、可观测基础设施
→ 一次部署、统一扩缩容、统一发版
→ 所有接口均为 async def，asyncio 事件循环下并发处理
```

合并理由：
- v5.0 已取消 node 注册表、别名机制、Connector 注册、复杂熔断器，**两个进程各自的大幅简化后，拆分的收益已不抵成本**
- 单进程共享基础设施（httpx 连接池、MinIO 客户端、Redis 连接池、审计写入器），减少资源冗余
- 部署运维简化：一个 Deployment、一个 Service、一份健康检查
- 后续如有独立扩缩容需求，可按 HPA 指标拆分（如 ingest 端点独立为单独的 FastAPI app），但 MVP 不做

#### 2.2.4 Connector 权限管理简化

**v4.1 方式（已废弃）**：
```
网关管理 kgw_connector 表 → 分配 token → 配置 allowed_kb_aliases 白名单
→ grant/revoke 接口 → token 轮换
```

**v5.0 方式**：
```
Connector 从门户读取自己有权写入的 KB 列表和对应鉴权信息
→ Connector 完成 Mapping
→ push StandardItem 到网关 ingest 端点
→ 网关校验 StandardItem schema → 写入 KB
```

---

## 3. 核心流程

### 3.1 业务请求处理流程（18 个文件级操作端点）

```
调用方请求
  │
  │  Headers: X-User-Id, X-Trace-Id(可选)
  │  Body: knCode / knCodeList + 业务参数
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. 提取 X-User-Id                                           │
│    提取 knCode / knCodeList                                 │
├─────────────────────────────────────────────────────────────┤
│ 2. 从门户中间件获取 KB 配置 (按 knCode, 每次请求实时获取)    │
│    - endpoint URL                                            │
│    - 该 KB 需要的鉴权 key 列表                               │
│    - 该 KB 支持的 operation 列表                             │
├─────────────────────────────────────────────────────────────┤
│ 3. 从 Redis 获取鉴权信息                                    │
│    Key: user:{userId}:kb:auth  (或门户定义的其他 key 模式)   │
│    Value: 该用户对该 KB 的 token / api_key 等                │
├─────────────────────────────────────────────────────────────┤
│ 4. 组装后端请求                                             │
│    - URL: {endpoint_url}/{operation_path}                    │
│    - Headers: 从鉴权信息渲染                                 │
│    - Body: 透传请求 payload                                  │
├─────────────────────────────────────────────────────────────┤
│ 5. 调用 KB 服务                                             │
│    - JSON 类: POST → 解析响应 → 标准化信封                   │
│    - multipart 上传: 流式代理 (chunk=64KB)                   │
│    - octet-stream 下载: 流式转发                             │
├─────────────────────────────────────────────────────────────┤
│ 6. 高危写操作写审计日志 (8 个 operation)                     │
│    读操作不写审计                                            │
├─────────────────────────────────────────────────────────────┤
│ 7. 返回统一信封给调用方                                     │
│    {resultCode, resultMsg, resultObject}                     │
└─────────────────────────────────────────────────────────────┘
```

**多 KB 并行检索**（knowledgeSearch / metadataSearch / searchFile / metadataFieldsList）：

```
knCodeList: ["kb_A", "kb_B", "kb_C"]
  → 从门户获取每个 knCode 的 endpoint 配置
  → asyncio.gather 并发调各 KB
  → 聚合结果，失败的 KB 标记 degraded (一个 KB 失败不影响其他)
  → 返回 {data: [...], degraded_kbs: [{knCode, reason}]}
```

### 3.2 事件处理流程（ingest 端点）

```
Connector                    ingest API           ingest Processor      Redis        KB Service
   │                             │                      │                │              │
   │ POST /kgw/ingest/v1/events  │                      │                │              │
   │ Headers: X-User-Id          │                      │                │              │
   │ Body: StandardItem          │                      │                │              │
   │ (knCode + filePath +        │                      │                │              │
   │  content + metadata +       │                      │                │              │
   │  version + op)              │                      │                │              │
   ├─────────────────────────────►                      │                │              │
   │                             │                      │                │              │
   │                             │ 1. StandardItem      │                │              │
   │                             │    Schema 校验        │                │              │
   │                             │ 2. knCode 有效性      │                │              │
   │                             │    (从门户配置确认    │                │              │
   │                             │     KB 存在)          │                │              │
   │                             │ 3. metadataProperty   │                │              │
   │                             │    引用校验           │                │              │
   │                             │ 4. version 单调性     │                │              │
   │                             │ 5. source_lock 检查   │                │              │
   │                             │                      │                │              │
   │                             │ 失败 → 422 +         │                │              │
   │                             │ errorList +          │                │              │
   │                             │ conflict_log         │                │              │
   │                             ◄──────────────────────                   │              │
   │                                                                       │              │
   │                             │ INSERT ingest_event  │                │              │
   │                             │  status='received'   │                │              │
   │                             ├──────────────────────►│                │              │
   │                             │                      │                │              │
   │                             │                      │ 3. 从 Redis     │              │
   │                             │                      │    获取鉴权信息  │              │
   │                             │                      │    (按 X-User-Id │              │
   │                             │                      │     + knCode)    │              │
   │                             │                      ├───────────────►│              │
   │                             │                      │  鉴权信息       │              │
   │                             │                      │◄───────────────│              │
   │                             │                      │                │              │
   │                             │                      │ 4. 调 KB 写接口 │              │
   │                             │                      │    (携带鉴权)   │              │
   │                             │                      │ (fileImport /   │              │
   │                             │                      │  fileDelete /   │              │
   │                             │                      │  metadataUpdate)│              │
   │                             │                      ├────────────────┼─────────────►│
   │                             │                      │                │              │
   │                             │                      │                │ resultCode=0 │
   │                             │                      │◄───────────────┼──────────────│
   │                             │                      │                │              │
   │                             │                      │ 写 write_history │              │
   │                             │                      │ UPDATE event     │              │
   │                             │                      │  status='done'   │              │
   │                             │                      │ 写 audit_log     │              │
   │                             │                      │                │              │
   │                             │ 200 + eventId        │                │              │
   ◄─────────────────────────────                       │                │              │
```

**与 serve 路径一致的鉴权模型**：
- Connector 请求时携带 `X-User-Id` header（或服务账号标识）
- ingest 从 Redis 获取该身份对目标 KB 的写鉴权信息
- 组装后端请求时携带鉴权，调 KB 写接口

**与 v4.1 ingest 的关键差异**：
- 取消了 Connector token 校验步骤（Connector 权限由 Connector 自己读门户管理）
- 取消了 allowed_kb_aliases 白名单校验（同样由 Connector 自管）
- **鉴权方式从"ingest 代管服务凭据"改为"从 Redis 按 User ID 获取"**，与 serve 路径统一
- 保留了 StandardItem schema 校验、幂等、DLQ

### 3.3 配置获取流程

**设计决策**：每次请求时实时从门户（MinIO）获取 KB 配置，保证数据一致性。不引入网关侧缓存层（缓存是优化手段，后续按需添加）。

```
每次请求进入
  │
  │ Headers: X-User-Id
  │ Body: knCode
  │
  ▼
从 MinIO 获取 KB 配置 (按 knCode)
  │
  │  MinIO 对象路径:
  │    resource/doc/KG_DOC_{knCode}.json
  │
  │  对象内容包含:
  │    resourceCode(knCode), domainName, domainURL,
  │    headers, resourceService(OpenAPI paths)
  │
  │  参考: byclaw-qa 中 MinioResourceClient.get_kg_doc_config()
  │
  ▼
获取到的 KB 配置:
  {
    "knCode": "hr_policy",
    "name": "HR 政策制度库",
    "endpointUrl": "http://kb-hr.internal:8080",
    "operations": ["knowledgeSearch", "fileImport", ...],
    "authRequired": ["Authorization", ...],
    "capabilities": {...}
  }
  │
  ▼
配置缺失或 knCode 不存在 → 返回 KBNotFound
配置获取超时 → 返回 UpstreamTimeout (标记为配置中间件不可用)
配置获取成功 → 继续请求处理
```

**后续优化空间**（非 MVP）：
- 如果 MinIO 读取成为性能瓶颈，可引入短期内存缓存（TTL 30-60s）
- 但 MVP 阶段先保证数据一致性，不做缓存

### 3.4 鉴权信息获取流程

参考 byclaw-qa 中 `_resolve_header_placeholders()` 的实现模式：

```
请求进入
  │
  │ Headers: X-User-Id
  │ Body: knCode (调用方指定目标 KB)
  │
  ▼
从 Redis 获取用户的鉴权信息
  │
  │ Key: user:{user_code}:login:auth
  │ Value: 用户鉴权信息 (JSON/Hash)
  │
  │ 参考: byclaw-qa 中 _resolve_header_placeholders() 的实现
  │
  ▼
获取到的鉴权信息包含:
  {
    "Authorization": "Bearer xxx",
    "X-Api-Key": "yyy",
    ...
  }
  │
  ▼
组装后端请求 headers，调 KB 服务
```

> **与 v4.1 的本质区别**：v4.1 中调用方需要自己持有各 KB 的凭据，按 `X-KB-Auth-<knCode>-<field>` 命名空间传 header，网关只做透传。v5.0 中调用方只传 `X-User-Id`，凭据存储和获取由平台层（门户 + Redis）统一管理，网关从 Redis 拿凭据。

---

## 4. 模块设计

所有功能集成在单一 FastAPI 进程中，所有接口均为 `async def`。

### 4.1 模块分层

```
┌──────────────────────────────────────────────────────────────────┐
│  API 层 (FastAPI 路由, 全 async)                                  │
│  ─────────────────────────────                                    │
│  业务端点 (18 个):                                                 │
│  /kgw/api/v1/directories/{create,update,delete}                   │
│  /kgw/api/v1/knowledgeItems/{search,metadataSearch,searchFile,    │
│       import,delete,metadata/{get,update},metadataFields/list}    │
│  /kgw/api/v1/{listDir,glob,readFile,downloadFile,                 │
│       fileToMarkdownIndex,fileBuildStatus,dslGuide}               │
│  /kgw/api/v1/metadataProperties/{create,batchCreate,delete,list}  │
│                                                                   │
│  ingest 端点:                                                      │
│  /kgw/ingest/v1/events          POST   Connector push 事件        │
│  /kgw/ingest/v1/events/batch    POST   批量 push                  │
│  /kgw/ingest/v1/events/{id}     GET    查询事件状态               │
│  /kgw/ingest/v1/events/{id}/replay POST 重放 DLQ                  │
│                                                                   │
│  管理端点:                                                         │
│  /kgw/admin/v1/audit            GET    审计查询                   │
│  /kgw/admin/v1/conflicts        GET    冲突查询                   │
│  /kgw/admin/v1/kbs/{knCode}/files/{path}/lock    POST  锁定文件   │
│  /kgw/admin/v1/kbs/{knCode}/files/{path}/unlock  POST  解锁文件   │
│  /healthz / /metrics                                              │
└─────────────────────────┬────────────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  调度核心                                                        │
│  · 路径 → OperationType 映射                                     │
│  · 提取 knCode / knCodeList → MinIO 查 endpoint                  │
│  · 提取 User ID → Redis 获取鉴权信息                             │
│  · 元数据逻辑名 ↔ 后端物化名转换                                  │
│  · metadataProperty 懒同步到目标 KB 后端                          │
│  · 多 KB 并行扇出 (asyncio.gather) / 单 KB 直发                   │
│  · 流式上传/下载代理                                              │
└─────────────────────────┬────────────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  配置与鉴权 (serve + ingest 共用)                                 │
│  · KbConfigProvider: 从 MinIO 实时获取 KB 配置                   │
│  · AuthProvider: 从 Redis 获取鉴权信息                            │
│    读路径 (serve): key = user:{user_code}:login:auth              │
│    写路径 (ingest): key = user:{user_code}:login:auth (统一)     │
└─────────────────────────┬────────────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  HTTP 客户端层 (共享 httpx 连接池)                                │
│  · 统一 httpx AsyncClient (含 stream 支持)                       │
│  · 超时 / 重试策略 (仅幂等读操作可重试)                           │
│  · 审计写入 (serve 高危写 + ingest 写)                            │
│  · 结构化日志 / Prometheus / OpenTelemetry                       │
└─────────────────────────┬────────────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  韧性层 (进程内, 不依赖外部状态)                                  │
│  · per-endpoint 熔断器 (CLOSED / OPEN / HALF_OPEN)               │
│  · 流式失败立即关连接, 不重试                                     │
└──────────────────────────────────────────────────────────────────┘
```

**与 v4.1 相比移除的模块**：
- ❌ Adapter 层 — knCode 由门户统一，不需要别名改写
- ❌ 注册中心读侧 — KB 配置从 MinIO 获取
- ❌ 编排器 — KB 创建注销由业务系统或门户编排处理，网关不代理
- ❌ AliasRewriter 中间件 — 门户维护 knCode 唯一性
- ❌ Connector 鉴权/注册 — Connector 自管理

**与 v4.1 相比简化的模块**：
- 🔄 韧性层 — 熔断器简化为进程内 per-endpoint（§4.4）
- 🔄 进程模型 — serve + ingest 合并为单进程，共享基础设施
- 🔄 metadataProperty — 从 promote/reject 治理流程简化为全局主目录 + 懒同步

### 4.2 执行模型

```
执行模型 ─┬─ 多 KB 并行 (4 个检索 operation)
          │   按 endpoint 分组 → asyncio.gather → 并发调用
          │   单 KB 失败不阻塞, 写入 degraded_kbs
          │
          ├─ 单 KB 直发 (大多数)
          │   定位 endpoint → 调 KB
          │
          └─ ingest 事件处理 (upsert/delete)
              Schema 校验 → 幂等检查 → 调 KB 写接口 → 审计
```

### 4.3 流式代理

- **multipart 上传**（fileImport）：网关解析非文件字段（knCode / filePath），文件流 chunk-by-chunk 透传给 KB 后端。buffer 默认 64KB，不缓存全量。
- **octet-stream 下载**（downloadFile）：`async for chunk in resp.aiter_bytes()` 转发，透传 `Content-Disposition`。
- **流式失败**：立即关连接，不重试。上传中断返回 `UploadStreamBroken`，下载中断调用方收到提前 EOF。

### 4.4 熔断器（进程内，per-endpoint）

与 v4.1 的关键区别：v4.1 的熔断器依赖 Service Node 注册表、Redis 状态共享、leader 选举的探活循环。v5.0 中这些全部取消，熔断器退化为每个网关 Pod **进程内独立运行**的 per-endpoint 保护机制。

**设计要点**：

- **粒度**：per KB endpoint（即每个 `knCode` 对应的 `endpoint_url` 一个独立的熔断器实例），而非 per Service Node
- **状态存储**：进程内存（Python `dict`），不写 Redis，不跨 Pod 共享
- **探测方式**：不主动探活（无 `/healthz` 轮询）。HALF_OPEN 时放行一个真实业务请求作为探测
- **状态机**：与 v4.1 相同的 CLOSED / OPEN / HALF_OPEN 三态

```
            ┌────────────────────┐
            │       CLOSED       │ ◄────────────────┐
            │   (正常调用)       │                  │
            └─────────┬──────────┘                  │
                      │                             │
        连续失败 ≥ 阈值│                             │ 探测请求成功
                      ▼                             │
            ┌────────────────────┐                  │
            │       OPEN         │                  │
            │ (直接返回失败,     │                  │
            │  不调后端, N 秒)   │                  │
            └─────────┬──────────┘                  │
                      │                             │
              冷却时间到期│                          │
                      ▼                             │
            ┌────────────────────┐                  │
            │     HALF-OPEN      │ ─────────────────┘
            │ (放行一个请求探测) │
            └─────────┬──────────┘
                      │
              探测失败 │
                      ▼
                  回到 OPEN
```

**默认参数**：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `failure_threshold` | 5 | 连续失败 N 次进入 OPEN |
| `open_duration_seconds` | 30 | OPEN 状态冷却时间 |
| `half_open_max_requests` | 1 | HALF_OPEN 放行探测请求数 |

**与 v4.1 的行为差异**：

| 维度 | v4.1 | v5.0 |
|---|---|---|
| 粒度 | Service Node（一个 node 挂，所有 KB 都熔断） | per endpoint（一个 KB 后端挂，其他 KB 不受影响） |
| 状态共享 | Redis，所有 Pod 一致 | 进程内存，各 Pod 独立 |
| 探测方式 | leader 选举 + 定时 `/healthz` 轮询 | 真实业务请求（HALF_OPEN 放行一个） |
| KB 恢复感知 | 新 Pod 不知道其他 Pod 的熔断状态 | 新 Pod 启动后从 CLOSED 开始（冷启动无偏见） |

**多 Pod 下的行为**：

- 每个网关 Pod 独立计数失败，独立决定熔断
- 如果 KB 后端真的挂了，所有 Pod 都会各自达到阈值进入 OPEN（收敛时间 ≈ `failure_threshold × avg_request_latency`）
- 如果只是 Pod A 网络抖动，只有 Pod A 熔断，Pod B/C 正常服务——这比共享状态更安全（避免了"一个 Pod 的网络问题把整个集群拖进熔断"）
- HALF_OPEN 探测：Pod A 先到冷却时间，放行一个请求 → 如果后端恢复了，Pod A 回到 CLOSED；Pod B/C 之后各自探测恢复

**对调用方的影响**：

- 熔断 OPEN 时，单 KB 操作返回 `CircuitOpen` 错误信封
- 多 KB 并行操作（knowledgeSearch 等）：熔断的 KB 进入 `degraded_kbs`，不影响其他 KB

### 4.5 ingest 事件处理

ingest 端点与业务端点运行在同一进程中，共享配置获取、鉴权获取、连接池和审计基础设施。所有 ingest 端点均为 `async def`。

#### 4.5.1 校验与处理

```
POST /kgw/ingest/v1/events (async)
  │
  ▼
1. StandardItem JSON Schema 校验
2. knCode 有效性校验 (从 MinIO 实时获取 KB 配置)
3. metadataProperty 引用校验 (查网关 `kgw_metadata_property` 主目录)
4. 懒同步检查 (对目标 knCode，未同步的字段调后端 batchCreate 写入 `__kgw__*`)
5. version 单调性校验
6. source_lock 检查
  │
  ▼ 校验失败 → 422 + errorList + conflict_log
  │
  ▼ 校验通过
  │
7. INSERT ingest_event (status='received')
8. 幂等检查 (UNIQUE 冲突 → already-processed)
9. 从 Redis 获取鉴权 (key: user:{user_code}:login:auth)
10. 改写 metadata key → `__kgw__{key}` 后调 KB 写接口 (fileImport / fileDelete / metadataUpdate)
11. 成功 → status='done'; 失败 → status='failed' + DLQ
12. 写审计 (source='ingest')
13. 返回 200 + eventId
```

#### 4.5.2 StandardItem Schema

Connector push 到网关的标准化事件格式，与 v4.1 基本一致，但移除了 `connectorId` 的鉴权语义（仅保留作为审计字段），移除了 `nodeId`（knCode 由门户维护，KB endpoint 由网关从配置查）：

```yaml
StandardItem:
  type: object
  required: [sourceId, itemId, op, knCode]
  properties:
    sourceId:
      type: string
      description: Connector 对源端的标识
    itemId:
      type: string
      description: 在 sourceId 范围内唯一的 item 标识
    version:
      type: string
      description: 源端版本，用于幂等和单调性校验
    op:
      type: string
      enum: [upsert, delete]
    knCode:
      type: string
      description: 目标 KB 标识（门户维护唯一性）
    filePath:
      type: string
      description: 写入 KB 的 filePath; upsert 必填
      pattern: '^/.*'
    title:
      type: string
    content:
      oneOf:
        - type: string
        - type: object  # InlineBinary
        - type: object  # RemoteRef (url + checksum)
    contentType:
      type: string
    metadata:
      type: object
      description: 元数据键值对; 键必须在网关 metadataProperty 主目录中声明
    sourceTimestamp:
      type: string
      format: date-time
    extra:
      type: object
      description: 不进入 KB 字段, 仅供调试与审计
```

#### 4.5.3 事件状态机

```
     received  ──校验通过──►  done
        │                       │
        │ 校验失败              │ KB 后端失败
        ▼                       ▼
     (不入库, 同步返回 422)  failed  ──/replay──► received
```

#### 4.5.4 幂等处理

基于 `(sourceId, itemId, version)` 去重（不再包含 connectorId，因为 Connector 不需要在网关注册）：

- status ∈ {`done`}：返回 200 + `{eventId, status: "already-processed"}`

### 4.6 metadataProperty 主目录与懒同步

metadataProperty 不按 `knCode` 路由。应用调用 metadataProperty 定义接口时并不知道、也不应该知道目标业务 KB 后端。因此 v5.0 将 metadataProperty 作为网关托管的全局主目录处理：

```
应用逻辑字段名: status
网关主目录字段名: status
业务 KB 后端物化字段名: __kgw__status
```

设计规则：

1. **单一权威来源**：网关的 `kgw_metadata_property` 是元数据属性定义的权威来源。业务 KB 后端中带 `__kgw__` 前缀的属性只是网关同步过去的副本。
2. **后端前缀隔离**：网关同步到业务 KB 后端时，对字段名加固定保留前缀 `__kgw__`。后端原生字段 `status` 与网关托管字段 `__kgw__status` 可共存，避免历史字段类型冲突。
3. **应用无感转换**：应用请求和响应始终使用逻辑字段名 `status`。网关在转发 `metadata/update`、`metadata/get`、`metadataSearch`、`search`、`searchFile` 等接口时做双向字段名转换。
4. **懒同步**：`metadataProperties/create` / `batchCreate` 只写网关主目录，不立即同步所有后端。只有某次请求真正使用某个 `knCode` 的元数据字段时，网关才把对应字段同步到该 `knCode` 所在的目标后端。
5. **后端接口内部化**：业务 KB 后端的 `/api/v1/metadataProperties/*` 仅作为网关内部同步接口。应用不能直接调用后端同名接口创建 `__kgw__*` 字段。

#### 4.6.1 创建与查询

`metadataProperties/create`：

```
应用 -> 网关 /kgw/api/v1/metadataProperties/create
  │
  ├─ 校验 propertyName/valueType 合法性
  ├─ 写 kgw_metadata_property(status='ACTIVE')
  └─ 返回逻辑字段名
```

示例：

```json
{
  "propertyName": "status",
  "valueType": "string",
  "description": "文档状态"
}
```

网关只保存逻辑字段名 `status`；后端物化字段名按规则生成 `__kgw__status`。

`metadataProperties/list` 的语义是**查询网关主目录中平台允许使用的元数据属性**，不表示某个业务 KB 后端当前已经物化了哪些属性，因此不需要 `knCode` 或 `targetBackend`：

```json
{
  "propertyNameList": ["status"]
}
```

返回：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [
      {
        "propertyName": "status",
        "valueType": "string",
        "description": "文档状态",
        "extParams": {}
      }
    ]
  }
}
```

如果调用方需要查看某个 KB 实际已使用的元数据字段，应调用带 `knCode` 的 `/kgw/api/v1/knowledgeItems/metadataFields/list`。

#### 4.6.2 懒同步触发时机

懒同步不是独立接口，而是调度核心的**前置中间件**。任何携带 metadata 字段的请求在转发到 KB 后端前，都先经过懒同步检查。两条路径统一：

**serve 路径**（触发操作：`metadata/update`、`fileImport`、`search`、`metadataSearch`、`searchFile`、`metadata/get`）：

```
请求进入 (携带 metadata 字段)
  │
  ▼
1. 提取 knCode + metadata keys
2. 查网关主目录，确认所有 key 存在且类型合法
   → 未声明 → 返回 MetadataPropertyNotFound
3. 从 MinIO 获取目标 KB 的 endpoint
4. 对每个 key，查 kgw_metadata_property_sync(knCode 对应 targetBackend)
   → 已 SYNCED：跳过
   → 未同步/失败：调目标后端 POST /api/v1/metadataProperties/batchCreate
     写入 __kgw__{key}（带固定前缀）
5. 将请求中所有 metadata key 改写为 __kgw__{key}
6. 转发到目标后端
7. 响应返回前，将 __kgw__{key} 反向转换为逻辑字段名
```

**ingest 路径**（触发操作：`fileImport` 和 `metadataUpdate`）：

```
ingest 事件处理 (StandardItem 含 metadata 字段)
  │
  ▼
在 §4.5.1 校验步骤 3（metadataProperty 引用校验）之后，
懒同步中间件对目标 knCode 执行与 serve 相同的同步逻辑：
  → 未同步 → 调目标后端 batchCreate 写入 __kgw__{key}
  → 改写 StandardItem metadata key → __kgw__{key}
  → 继续调 KB 写接口
```

**示例**（serve `metadata/update`）：

```
POST /kgw/api/v1/knowledgeItems/metadata/update
{
  "knCode": "hr_policy",
  "filePath": "/制度/考勤.pdf",
  "metadata": { "status": "active" }
}

→ 懒同步中间件:
  1. 校验 status 在网关主目录存在
  2. 查 kgw_metadata_property_sync: NOT_SYNCED
  3. 调后端 POST .../metadataProperties/batchCreate
     { propertyList: [{ propertyName: "__kgw__status", valueType: "string" }] }
  4. 更新 kgw_metadata_property_sync → SYNCED
  5. 改写 payload: metadata.status → metadata.__kgw__status
  6. 转发到目标后端
```

#### 4.6.3 删除语义

`metadataProperties/delete` 删除的是网关主目录中的逻辑字段声明。为避免破坏历史数据，MVP 采用软删除：

```
1. 校验 propertyName 存在
2. 检查网关侧是否仍有引用关系或待处理事件
3. 无引用时 status='DELETED'
4. list 默认不返回 DELETED
5. 已同步后端的 __kgw__* 字段可异步清理，不阻塞本次请求
```

#### 4.6.4 冲突处理

由于网关使用 `__kgw__` 保留前缀，后端原生同名字段不再构成冲突：

```
后端已有 status=integer
网关托管 status=string
后端实际新增 __kgw__status=string
```

真正需要记录冲突的场景是后端已存在同名 `__kgw__status`，但类型与网关主目录不一致。这表示有人绕过网关写入了保留命名空间。网关应拒绝本次同步，记录 `kgw_metadata_property_conflict`，并返回 `MetadataPropertyConflict`。
- status ∈ {`received`}：返回 409 + `{eventId, status, hint: "in_progress"}`
- status = `failed`：返回 200 + `{eventId, status: "failed", error_type, error_message}`

#### 4.5.5 同步处理约束

与 v4.1 保持一致（MVP 不引入消息队列）：

| 维度 | 阈值 | 超限响应 |
|---|---|---|
| 单事件 payload | ≤ 4 MB | 413 + `PAYLOAD_TOO_LARGE` |
| 单事件处理超时 | 30 s | 504 + `PROCESSING_TIMEOUT` |
| 单 ingest Pod 并发槽 | 100 | 503 + `Retry-After: 5` |
| 单 Connector 限速 | 30 RPS（可配置） | 429 + `Retry-After` |

---

## 5. 存储设计

### 5.1 关系库（仅 ingest + 审计相关）

**取消的表**（v4.1 有，v5.0 删除）：
- ~~`kgw_service_node`~~ — 节点信息从门户获取
- ~~`kgw_kb`~~ — KB 信息从门户获取
- ~~`kgw_kb_operation`~~ — Operation 绑定从门户获取
- ~~`kgw_node_auth_mapping`~~ — 鉴权映射改为从 Redis 获取
- ~~`kgw_connector`~~ — Connector 不需要在网关注册

**保留的表**：

```sql
-- ingest 事件事务表
CREATE TABLE ingest_event (
  event_id        BIGSERIAL PRIMARY KEY,
  source_id       VARCHAR(128) NOT NULL,
  item_id         VARCHAR(256) NOT NULL,
  version         VARCHAR(64),
  op              VARCHAR(16) NOT NULL,
  kn_code         VARCHAR(64) NOT NULL,           -- 目标 KB (门户维护唯一性)
  file_path       VARCHAR(512),
  payload         JSONB NOT NULL,
  status          VARCHAR(16) NOT NULL,            -- received / done / failed
  error_type      VARCHAR(64),
  error_message   TEXT,
  retry_count     INTEGER DEFAULT 0,
  received_at     TIMESTAMPTZ DEFAULT NOW(),
  done_at         TIMESTAMPTZ,
  -- 审计追溯字段
  source_connector VARCHAR(128),                  -- 来源 Connector 标识 (审计用)
  source_trace_id  VARCHAR(64),                   -- Connector 端 trace
  UNIQUE (source_id, item_id, version)
);
CREATE INDEX idx_ingest_event_status ON ingest_event (status, received_at);
CREATE INDEX idx_ingest_event_kb ON ingest_event (kn_code, file_path);

-- KB 写入历史 (version 单调性校验)
CREATE TABLE kgw_kb_write_history (
  kn_code         VARCHAR(64) NOT NULL,
  file_path       VARCHAR(512) NOT NULL,
  version         VARCHAR(64) NOT NULL,
  source_id       VARCHAR(128),
  source_connector VARCHAR(128),
  written_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (kn_code, file_path, written_at)
);
CREATE INDEX idx_kb_write_history_latest ON kgw_kb_write_history (kn_code, file_path, written_at DESC);

-- 人工写入锁 (serve 路径写入默认设置, ingest 写入不可覆盖)
CREATE TABLE kgw_kb_source_lock (
  kn_code         VARCHAR(64) NOT NULL,
  file_path       VARCHAR(512) NOT NULL,
  lock_owner      VARCHAR(64) NOT NULL,           -- 'manual' 或 source_connector
  locked_at       TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  PRIMARY KEY (kn_code, file_path)
);

-- 并行冲突日志
CREATE TABLE kgw_kb_conflict_log (
  id              BIGSERIAL PRIMARY KEY,
  kn_code         VARCHAR(64) NOT NULL,
  file_path       VARCHAR(512) NOT NULL,
  current_writer  VARCHAR(64),
  attempted_writer VARCHAR(64) NOT NULL,
  attempted_version VARCHAR(64),
  reason          VARCHAR(64) NOT NULL,           -- 'STALE_VERSION' / 'SOURCE_LOCKED'
  attempted_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_conflict_kb_time ON kgw_kb_conflict_log (kn_code, attempted_at DESC);

-- metadataProperty 全局主目录 (网关权威来源)
CREATE TABLE kgw_metadata_property (
  property_name   VARCHAR(128) PRIMARY KEY,       -- 应用侧逻辑字段名，如 status
  backend_name    VARCHAR(160) NOT NULL UNIQUE,   -- 后端物化字段名，如 __kgw__status
  value_type      VARCHAR(32) NOT NULL,            -- string / number / boolean / stringList / ...
  description     TEXT,
  ext_params      JSONB,
  status          VARCHAR(16) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE / DELETED
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_metadata_property_status ON kgw_metadata_property (status, updated_at DESC);

-- metadataProperty 后端懒同步状态
CREATE TABLE kgw_metadata_property_sync (
  property_name   VARCHAR(128) NOT NULL REFERENCES kgw_metadata_property(property_name),
  target_backend  VARCHAR(128) NOT NULL,          -- 从门户 KB 配置归一化得到的后端标识
  backend_name    VARCHAR(160) NOT NULL,
  sync_status     VARCHAR(16) NOT NULL,           -- SYNCED / FAILED
  last_sync_at    TIMESTAMPTZ,
  last_error      TEXT,
  PRIMARY KEY (property_name, target_backend)
);
CREATE INDEX idx_metadata_property_sync_backend ON kgw_metadata_property_sync (target_backend, sync_status);

-- metadataProperty 保留前缀冲突日志
CREATE TABLE kgw_metadata_property_conflict (
  id                  BIGSERIAL PRIMARY KEY,
  property_name        VARCHAR(128) NOT NULL,
  backend_name         VARCHAR(160) NOT NULL,
  target_backend       VARCHAR(128) NOT NULL,
  expected_value_type  VARCHAR(32) NOT NULL,
  actual_value_type    VARCHAR(32),
  conflict_status      VARCHAR(16) NOT NULL DEFAULT 'OPEN', -- OPEN / RESOLVED / IGNORED
  detail               JSONB,
  first_seen_at        TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_metadata_property_conflict_status ON kgw_metadata_property_conflict (conflict_status, last_seen_at DESC);
CREATE INDEX idx_metadata_property_conflict_backend ON kgw_metadata_property_conflict (target_backend, last_seen_at DESC);

-- 审计 (serve + ingest 共用)
CREATE TABLE kgw_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  source          VARCHAR(16) NOT NULL,           -- 'serve' / 'ingest'
  trace_id        VARCHAR(64),
  actor_user_id   VARCHAR(128),                   -- serve 路径的 X-User-Id
  actor_ip        INET,
  actor_kind      VARCHAR(32),                    -- 'user' / 'connector'
  source_connector VARCHAR(128),                  -- ingest 路径来源 Connector
  source_id       VARCHAR(128),                   -- Connector 报的源端标识
  source_item_id  VARCHAR(256),                   -- 源端原始 itemId
  source_version  VARCHAR(64),                    -- 源端 version/etag
  operation_type  VARCHAR(64) NOT NULL,
  kn_code         VARCHAR(64),
  file_path       VARCHAR(512),
  payload_size_bytes BIGINT,                      -- 量级字段, 不存全量
  row_count       INTEGER,                        -- batch 类操作的条目数
  payload_redacted JSONB,                         -- 仅 metadata + 关键业务字段, 不全量
  result_code     VARCHAR(8),
  result_msg      TEXT,
  latency_ms      INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_kb_time ON kgw_audit_log (kn_code, created_at DESC);
CREATE INDEX idx_audit_op_time ON kgw_audit_log (operation_type, created_at DESC);
CREATE INDEX idx_audit_source_time ON kgw_audit_log (source, created_at DESC);
CREATE INDEX idx_audit_trace ON kgw_audit_log (trace_id);
CREATE INDEX idx_audit_user ON kgw_audit_log (actor_user_id, created_at DESC);
```

### 5.2 Redis（仅读）

网关不在 Redis 写入业务数据，只读取门户写入的鉴权信息：

| Key 模式 | 内容 | 写入方 | 读取方 |
|---|---|---|---|
| `user:{user_code}:login:auth` | 用户鉴权信息 | 门户 | serve / ingest |

> 参考 byclaw-qa 当前实现：`_resolve_header_placeholders()` 从 `user:{user_code}:login:auth` 读取鉴权信息，解析 header 中的 `${KEY}` 占位符。

---

## 6. 数据契约

### 6.1 统一信封（serve 路径）

```http
POST /kgw/api/v1/knowledgeItems/search
Content-Type: application/json
Headers:
  X-User-Id: user_0001                          # 用户标识
  X-Trace-Id: <可选>

{
  "knCodeList": ["hr_policy", "tech_wiki"],     # KB 标识列表 (门户维护唯一性)
  "query": "续签流程",
  "topK": 10,
  "searchMode": "mixedRecall",
  "where": {"eq": {"fieldName": "status", "value": "active"}}
}
```

成功响应（多 KB 并行）：

```json
{
  "resultCode": "0",
  "resultMsg": "success",
  "resultObject": {
    "data": [ /* ... */ ],
    "degraded_kbs": [
      {"knCode": "tech_wiki", "reason": "upstream_timeout"}
    ]
  }
}
```

### 6.2 上传请求（fileImport）

```http
POST /kgw/api/v1/knowledgeItems/import
Content-Type: multipart/form-data
Headers:
  X-User-Id: user_0001

Form fields:
  knCode: hr_policy
  filePath: /制度/考勤管理办法.pdf
  fileDescription: 2026版考勤管理办法
  fileContent: <binary stream>
```

### 6.3 下载请求/响应（downloadFile）

```http
POST /kgw/api/v1/downloadFile
Content-Type: application/json
Headers:
  X-User-Id: user_0001

{"knCode": "hr_policy", "filePath": "/制度/考勤管理办法.pdf"}
```

成功响应：
```
200 OK
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="考勤管理办法.pdf"
<binary stream>
```

### 6.4 ingest 端点

完整的 ingest API 接口定义（StandardItem schema、事件推送、状态查询、DLQ 重放、错误类型、处理限制）见独立文档：

→ [`2026-06-02-knowledge-gateway-ingest-api.md`](./2026-06-02-knowledge-gateway-ingest-api.md)

要点摘要：

- **Base URL**：`/kgw/ingest/v1`
- **身份**：通过 `X-User-Id` header 传入，ingest 从 Redis `user:{user_code}:login:auth` 获取写鉴权（与 serve 路径统一）
- **接口**：`POST /events`、`POST /events/batch`、`GET /events/{id}`、`GET /events`、`POST /events/{id}/replay`
- **幂等**：基于 `(sourceId, itemId, version)` 去重
- **与 v4.1 差异**：不再需要 Connector token、`connectorId`、`nodeId` 字段

### 6.5 接口承接边界

#### 6.5.1 网关承接的接口

网关承接三类接口：

1. **KB 数据面接口**：请求体中可提取 `knCode` / `knCodeList`，可按门户 KB 配置路由到目标后端。
2. **metadataProperty 定义接口**：不按 `knCode` 路由，由网关主目录承接，并在实际使用时懒同步到目标后端。
3. **ingest 与治理接口**：StandardItem ingest、审计查询、冲突查询、文件锁定/解锁。

| 方法 | 网关路径 | 说明 | 路由方式 |
|---|---|---|---|
| `POST` | `/kgw/api/v1/metadataProperties/create` | 新增元数据属性声明 | 写网关主目录 |
| `POST` | `/kgw/api/v1/metadataProperties/batchCreate` | 批量新增元数据属性声明 | 写网关主目录 |
| `POST` | `/kgw/api/v1/metadataProperties/delete` | 删除/停用元数据属性声明 | 写网关主目录 |
| `POST` | `/kgw/api/v1/metadataProperties/list` | 查询元数据属性声明 | 查网关主目录 |
| `POST` | `/kgw/api/v1/knowledgeItems/metadata/update` | 更新文件元数据 | `knCode` 路由 + 懒同步 |
| `POST` | `/kgw/api/v1/knowledgeItems/metadata/get` | 查询文件元数据 | `knCode` 路由 + 字段名反向转换 |
| `POST` | `/kgw/api/v1/knowledgeItems/metadataFields/list` | 查询某 KB 实际使用字段 | `knCode` 路由 |
| `POST` | `/kgw/api/v1/knowledgeItems/metadataSearch` | 元数据检索 | `knCodeList` 路由 + 查询字段名转换 |
| `POST` | `/kgw/api/v1/knowledgeItems/search` | 语义检索 | `knCodeList` 路由 + 查询字段名转换 |
| `POST` | `/kgw/api/v1/knowledgeItems/searchFile` | 文件级检索 | `knCodeList` 路由 + 查询字段名转换 |
| `POST` | `/kgw/api/v1/knowledgeItems/import` | 文件导入 | `knCode` 路由 |
| `POST` | `/kgw/api/v1/knowledgeItems/delete` | 文件删除 | `knCode` 路由 |
| `POST` | `/kgw/api/v1/directories/create` | 目录创建 | `knCode` 路由 |
| `POST` | `/kgw/api/v1/directories/update` | 目录更新 | `knCode` 路由 |
| `POST` | `/kgw/api/v1/directories/delete` | 目录删除 | `knCode` 路由 |
| `POST` | `/kgw/api/v1/listDir` | 目录列表 | `knCode` 路由 |
| `POST` | `/kgw/api/v1/glob` | 文件模式匹配 | `knCode` 路由 |
| `POST` | `/kgw/api/v1/readFile` | 读取文件 | `knCode` 路由 |
| `POST` | `/kgw/api/v1/downloadFile` | 下载文件 | `knCode` 路由 |
| `POST` | `/kgw/api/v1/fileToMarkdownIndex` | 触发构建 | `knCode` 路由 |
| `POST` | `/kgw/api/v1/fileBuildStatus` | 构建状态查询 | `knCode` 路由 |
| `POST` | `/kgw/api/v1/dslGuide` | DSL 指南 | 固定服务/本地响应 |

`metadataProperties/list` 的返回来自网关主目录，表示“平台允许使用哪些逻辑字段”；它不扫描所有业务后端，也不返回某个 KB 的已物化字段。某个 KB 的实际字段视图由 `/knowledgeItems/metadataFields/list` 承接。

#### 6.5.2 网关不承接的接口

| 方法 | 后端路径 | 不承接原因 | 推荐处理 |
|---|---|---|---|
| `POST` | `/api/v1/knowledgeBases/create` | 创建前没有 `knCode`，无法按 KB 数据面路由；返回的后端 `knCode` 也不是门户 KB ID | 由门户或业务系统选择目标后端并编排创建，保存 `portalKbId/enterpriseKnCode -> targetBackend/sourceKnCode` 映射 |
| `POST` | `/api/v1/knowledgeBases/update` | KB 生命周期管理属于门户/业务系统控制面 | 门户或业务系统直连目标后端 |
| `POST` | `/api/v1/knowledgeBases/delete` | KB 生命周期管理属于门户/业务系统控制面 | 门户或业务系统直连目标后端 |
| `POST` | 业务后端 `/api/v1/metadataProperties/*` | 后端同名接口是网关内部同步目标，不作为应用入口暴露 | 应用统一调用网关 `/kgw/api/v1/metadataProperties/*` |

#### 6.5.3 KB 创建后的映射要求

虽然网关不承接 KB 创建，但后续数据面路由依赖门户配置中保存完整映射：

```json
{
  "portalKbId": "kb_10086",
  "knCode": "hr_policy",
  "targetBackend": "backend_a",
  "sourceKnCode": "2",
  "endpointUrl": "http://backend-a.internal"
}
```

网关对外使用门户维护的 `knCode`，对内转发时可按配置改写为目标后端的 `sourceKnCode`。

### 6.6 错误归一化

| error_type | 触发场景 | HTTP 状态 |
|---|---|---|
| `OperationNotSupported` | KB 不支持该 operation | 200 (resultCode=-1) |
| `KBNotFound` | knCode 在配置中不存在 | 200 |
| `UpstreamTimeout` | KB 后端超时 | 200 |
| `UpstreamConnectError` | KB 后端连接失败 | 200 |
| `UploadStreamBroken` | 上传流式转发中断 | 200 |
| `DownloadStreamBroken` | 下载流式转发中断 | 部分发送 + 连接关闭 |
| `AuthInfoNotFound` | Redis 中未找到用户鉴权信息 | 200 |
| `BackendAuthFailed` | KB 后端返回 401/403 (透传) | 200 |
| `CircuitOpen` | 目标 KB endpoint 熔断器 OPEN | 200 |
| `MetadataPropertyNotFound` | metadata/update/search 使用了未在网关主目录声明的字段 | 200 |
| `MetadataPropertyConflict` | 目标后端存在同名 `__kgw__*` 字段但类型不一致 | 200 |
| `MetadataPropertySyncFailed` | 懒同步到目标后端失败 | 200 |

与 v4.1 相比移除的错误类型：`NodeNotFound`（无 node 注册表）、`AllInstancesUnhealthy`（无健康检查，由 `CircuitOpen` 替代）、`AdapterError`（无 Adapter 抽象）、`GatewayRegistryWriteFailed`（无注册表写入）。

### 6.7 控制面端点

完整的管理接口定义（审计查询、冲突查询、文件锁定/解锁）见独立文档：

→ [`2026-06-02-knowledge-gateway-ingest-api.md`](./2026-06-02-knowledge-gateway-ingest-api.md)（"管理接口"章节）

要点摘要：

| 端点 | 方法 | 用途 |
|---|---|---|
| `/kgw/admin/v1/audit` | GET | 审计日志查询（serve + ingest 双路径） |
| `/kgw/admin/v1/conflicts` | GET | 冲突日志查询（STALE_VERSION / SOURCE_LOCKED） |
| `/kgw/admin/v1/kbs/{knCode}/files/{filePath}/lock` | POST | 人工锁定文件 |
| `/kgw/admin/v1/kbs/{knCode}/files/{filePath}/unlock` | POST | 人工解锁文件 |

与 v4.1 相比移除的控制面端点：node CRUD、KB 轻量登记、auth_mapping 配置、Connector CRUD + token 轮换、metadataProperty promote/reject、alias grant/revoke。

---

## 7. 审计与可观测

### 7.1 审计范围

- **serve 路径**：高危写 operation（目录管理 3 + 文档管理 2 + 文件元数据 1 + 构建触发 1 + 构建状态 1 + metadataProperty 定义变更）。KB 生命周期管理不在网关代理范围内。
- **ingest 路径**：所有事件处理结果（upsert / delete / failed / replay）
- **payload 脱敏**：写入前剥除所有鉴权相关字段
- **审计写入失败不阻断业务**

### 7.2 核心指标

```
# 业务端点
kgw_dispatch_total{operation, kn_code, result}
kgw_dispatch_latency_seconds{operation, kn_code}
kgw_stream_bytes_total{direction, operation, kn_code}

# metadataProperty
kgw_metadata_property_total{operation, result}
kgw_metadata_property_sync_total{target_backend, result}
kgw_metadata_property_conflict_total{target_backend}

# ingest 端点
kgw_ingest_received_total{op}
kgw_ingest_done_total{kn_code}
kgw_ingest_failed_total{error_type}
kgw_ingest_latency_seconds{op}
kgw_ingest_dlq_size

# 基础设施 (serve + ingest 共用)
kgw_auth_fetch_failures_total                                    # Redis 鉴权获取失败次数
kgw_config_fetch_failures_total                                   # MinIO 配置获取失败次数
kgw_circuit_state{kn_code}                                       # per-endpoint 熔断状态: 0=CLOSED, 1=OPEN, 2=HALF_OPEN
kgw_audit_write_failures_total{source}
```

与 v4.1 相比移除的指标：`kgw_service_node_health`、`kgw_registry_cache_age_seconds`、`kgw_registry_invalidate_total`、`kgw_config_cache_miss_total`（无本地缓存）、`kgw_ingest_*` 中带 `connector_id` 标签的指标。`kgw_circuit_state` 保留但标签从 `node_id` 改为 `kn_code`（per-endpoint 粒度）。新增 `kgw_config_fetch_failures_total`。

---

## 8. 演进路径

### 8.1 阶段规划

```
阶段 1 · 单进程 MVP (3 周)
  ├ 配置获取: 从 MinIO 获取 KB 配置
  ├ 鉴权获取: 从 Redis 获取鉴权信息
  ├ 18 个文件级操作端点 + 流式上传/下载代理
  ├ metadataProperty 主目录 + __kgw__ 前缀映射 + 懒同步
  ├ ingest 端点: 事件接收 + Schema 校验 + 事务表 + DLQ
  ├ StandardItem schema + 幂等 + 审计
  ├ per-endpoint 熔断器
  ├ OpenAPI 规范 v0.1
  └ by-qa 一次性切换 (staging → 生产)

阶段 2 · Connector 契约 + Conformance (2 周)
  ├ 第一个真实 Connector: gbrain-connector (验证 push 模型)
  ├ Conformance Suite (StandardItem 校验)
  └ by-qa 等价测试套件 through GatewayClient

阶段 3 · 多 Connector + 治理 UI (按需排期)
  ├ 第二/第三个 Connector: obsidian-connector, notion-connector
  ├ 管理后台 UI (审计查询 + 冲突管理)
  └ 队列引入 (P1+, 触发条件与 v4.1 §5.8 一致)
```

### 8.2 队列引入 / 进程拆分触发条件（P1+）

满足任一条件时引入 Kafka / Redis Stream：
1. 单 Connector 持续超 30 RPS 或全环境持续超 1000 events/s
2. 出现超大文档（≥ 4MB）需网关侧切片重抽

---

## 9. by-qa 一次性切换

与 v4.1 §12 策略一致：等价测试 + staging 灰度 + git tag 回滚。

**额外简化**：由于 v5.0 网关不再自建注册表、不再维护别名，by-qa 切换到 GatewayClient 时调用方式更加直接：

```python
# 切换前 (by-qa 直连 KB)
result = await ServiceToolDispatcher.search(knCode="hr_policy", query="...")

# 切换后 (走网关)
result = await GatewayClient.search(
    knCode="hr_policy",        # 与切换前相同的 knCode (门户维护)
    query="...",
    user_id="current_user"     # 新增: 鉴权用 User ID
)
```

knCode 在切换前后保持不变（门户维护唯一性），不需要别名映射迁移。

---

## 10. 仓库与目录结构

```
byclaw-kgw/
├── pyproject.toml
├── src/kgw/
│   ├── main.py                     # FastAPI app (单进程, 全 async)
│   ├── envelope.py                 # 统一信封 + 错误归一化
│   ├── config_provider.py          # KB 配置获取 (MinIO 实时获取)
│   ├── auth_provider.py            # 鉴权获取 (Redis 读)
│   ├── http_client.py              # 统一 httpx 客户端 (含 stream)
│   ├── dispatcher.py               # 路由 + 调度核心
│   ├── metadata_registry.py        # 主目录 CRUD + 逻辑名/物化名转换
│   ├── metadata_sync.py            # 后端懒同步 + 冲突记录
│   ├── stream_proxy.py             # 流式上传/下载代理
│   ├── event_processor.py          # ingest 同步处理
│   ├── idempotency.py              # source_id+item_id+version 去重
│   ├── dlq.py                      # 死信处理
│   ├── api/
│   │   ├── directories.py          # 18 个文件级操作端点
│   │   ├── knowledge_items.py
│   │   ├── metadata_properties.py  # metadataProperty 主目录接口
│   │   ├── files.py
│   │   ├── dsl_guide.py
│   │   ├── events.py               # ingest 端点
│   │   └── admin.py                # 控制面 (审计查询 / lock / unlock)
│   ├── schemas/
│   │   └── standard_item.py        # StandardItem JSON Schema
│   ├── audit/
│   │   └── writer.py               # 审计写入
│   ├── resilience/
│   │   └── circuit_breaker.py      # per-endpoint 进程内熔断器
│   └── observability/
│       ├── logger.py               # 结构化日志
│       ├── metrics.py              # Prometheus 指标
│       └── tracing.py              # OpenTelemetry trace
│
├── spec/                           # OpenAPI 规范
│   ├── kgw.openapi.yaml            # 单进程，合并 serve + ingest
│   └── schemas/
│       ├── envelope.yaml
│       └── standard_item.yaml
│
└── deploy/                         # Dockerfile / k8s manifests
```

与 v4.1 目录结构相比：仓库名从 `by-knowledge-gateway` → `byclaw-kgw`。`kgw_serve/` + `kgw_ingest/` + `kgw_common/` 合并为单一 `src/kgw/` 包（单进程，无子进程拆分）。移除 `registry/`、`adapters/`、`orchestrator.py`、`connector_registry.py`、`operations/`。`resilience/` 保留但简化为仅 `circuit_breaker.py`。

---

## 11. 配置模型

### 11.1 网关自身配置

```yaml
# 门户配置来源 (MinIO)
portal:
  minio:
    endpoint: "${MINIO_ENDPOINT}"
    access_key: "${MINIO_ACCESS_KEY}"
    secret_key: "${MINIO_SECRET_KEY}"
    bucket: "byclaw"
    kb_config_prefix: "resource/doc/KG_DOC_"  # KB 配置对象 key 前缀 ({prefix}{knCode}.json)

# 鉴权信息来源 (Redis)
auth:
  redis:
    host: "${REDIS_HOST}"
    port: "${REDIS_PORT}"
    password: "${REDIS_PASSWORD}"
    db: 0
  key_template: "user:{user_code}:login:auth"  # Redis key 模板

```

### 11.2 从门户获取的 KB 配置结构

每个 KB 从门户获取的配置结构（参考 byclaw-qa 当前 KG_DOC 配置）：

```json
{
  "knCode": "hr_policy",
  "name": "HR 政策制度库",
  "description": "公司人力资源相关的政策、制度、流程文档",
  "endpointUrl": "http://kb-hr.internal:8080",
  "operations": [
    "knowledgeSearch",
    "metadataSearch",
    "searchFile",
    "metadataFieldsList",
    "listDir",
    "glob",
    "readFile",
    "downloadFile",
    "directoryCreate",
    "directoryUpdate",
    "directoryDelete",
    "fileImport",
    "fileDelete",
    "fileMetadataUpdate",
    "fileMetadataGet",
    "buildTrigger",
    "buildStatus"
  ],
  "authRequired": ["Authorization"],
  "capabilities": {
    "supportsStreamingUpload": true,
    "supportsStreamingDownload": true,
    "supportsMetadataDsl": true,
    "supportsBuildStatus": true
  }
}
```

---

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 门户配置中间件不可用 | 返回 `UpstreamTimeout`，调用方退避重试；后续可引入短期缓存作为降级 |
| Redis 鉴权信息缺失 | 返回 `AuthInfoNotFound`，调用方自行处理 |
| 熔断阈值过激/过松 | N=5 / 30s 为默认值；可按 endpoint 覆写 |
| ingest 同步处理 Connector 阻塞 | 配额限速 + 503 退避 |
| by-qa 一次性切换事故 | 等价测试 + staging 灰度 + git tag 回滚 |

与 v4.1 相比不再存在的风险：
- ~~注册缓存与关系库一致性窗口~~（无注册表）
- ~~编排第二步失败补偿~~（无编排，KB 创建由门户负责）
- ~~Connector token 泄漏~~（Connector 自管权限）
- ~~多 Connector 写入同一 KB 冲突~~（冲突处理简化为 lock + LWW）

---

## 13. 验收标准

### 阶段 1（单进程 MVP）

- [ ] 所有接口均为 `async def`，asyncio 事件循环下无阻塞调用
- [ ] 每次请求实时从 MinIO 获取 KB 配置
- [ ] 携带 `X-User-Id` + `knCode` 调 knowledgeSearch，从 Redis 取到鉴权信息并成功返回检索结果
- [ ] 鉴权信息缺失时正确返回 `AuthInfoNotFound`
- [ ] knCode 不存在时正确返回 `KBNotFound`
- [ ] 多 KB 并行检索（knCodeList），一个 KB 失败不影响其他，degraded_kbs 标记正确
- [ ] 熔断器：连续 5 次失败后进入 OPEN，30s 冷却后 HALF_OPEN 探测成功恢复 CLOSED
- [ ] 熔断 OPEN 时单 KB 操作返回 `CircuitOpen`，多 KB 操作标记 degraded_kbs
- [ ] fileImport 上传 100MB 文件，Pod 内存峰值 < 100MB
- [ ] downloadFile 流式下载 100MB 文件，调用方 < 1s 收到首字节
- [ ] 高危写 operation 全部在 kgw_audit_log 中有记录，payload 已脱敏
- [ ] metadataProperties/create 写入网关主目录，不调用业务 KB 后端
- [ ] metadataProperties/list 只返回网关主目录中的 ACTIVE 逻辑字段，不需要 knCode / targetBackend
- [ ] knowledgeItems/metadata/update 使用未声明字段时返回 MetadataPropertyNotFound
- [ ] knowledgeItems/metadata/update 首次使用声明字段时，自动同步 `__kgw__*` 物化字段到目标后端
- [ ] 后端存在类型不一致的 `__kgw__*` 字段时返回 MetadataPropertyConflict，并写入 kgw_metadata_property_conflict
- [ ] metadata/update、metadata/get、metadataSearch、search、searchFile 中的元数据字段完成逻辑名与物化名双向转换

**ingest 端点**：

- [ ] StandardItem schema 定义 + 校验器通过单元测试
- [ ] Connector push 100 条 StandardItem，全部 done，KB 中可检索
- [ ] 重复推送同一 (sourceId, itemId, version) 返回 already-processed
- [ ] 推送非法 StandardItem 返回 422 + errorList，不落库
- [ ] KB 后端不可用时，事件状态变为 failed，进入 DLQ；/replay 能恢复
- [ ] ingest 端点的鉴权方式与业务端点一致（`X-User-Id` → Redis）

### 阶段 2（Connector 契约 + 切换）

- [ ] gbrain-connector 通过 Conformance Suite
- [ ] by-qa 等价测试套件 through GatewayClient 通过

---

## 14. 已澄清问题

1. **门户 KB 配置的具体获取方式**：✅ MinIO。参考 byclaw-qa 当前做法，从 `resource/doc/KG_DOC_{knCode}.json` 读取，包含 domainURL、headers、resourceService 等字段。
2. **Redis 鉴权 key 的精确模式**：✅ `user:{user_code}:login:auth`（用户级，不区分 KB）。与 byclaw-qa 当前 `_resolve_header_placeholders()` 保持一致的 key 模式。
3. **KB 创建/注销流程**：✅ 由业务系统或门户编排处理，网关不代理 KB 生命周期管理。创建后门户配置必须保存 `portalKbId/enterpriseKnCode -> targetBackend/sourceKnCode` 映射，供网关后续数据面路由使用。
4. **ingest 写入 KB 的鉴权方式**：✅ 沿用 user 鉴权，与 serve 路径统一。ingest 从请求 header 中提取 `X-User-Id`，从 Redis key `user:{user_code}:login:auth` 获取鉴权信息，调 KB 写接口。
5. **metadataProperty 承接方式**：✅ 由网关承接 `/metadataProperties/create|batchCreate|delete|list`，维护全局主目录。业务 KB 后端同名接口仅作为网关内部懒同步目标，不作为应用入口。
6. **metadataProperty 字段名映射**：✅ 应用使用逻辑字段名（如 `status`），网关同步到后端时使用固定保留前缀物化名（如 `__kgw__status`），并在请求/响应中双向转换。
