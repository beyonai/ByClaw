# byclaw-kgw 接口级集成测试场景方案

本文档从用户旅程出发，整理知识网关（byclaw-kgw）的接口级集成测试场景，覆盖全部 34 个端点、两种路由模式、跨知识库编排、后台 worker 验证。

> **注意：** 所有场景均需真实 OpenGauss + Redis + MinIO，KB 后端使用 byclaw-qa 模拟。
> 测试前通过 byclaw-qa 的 `start.sh api` 启动 1~2 个 KB 后端实例。
> 跨知识库场景需要不同 KB 分别走直连（domainURL）和服务发现（domainName）路由模式。

## 测试架构

### 组件拓扑

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────┐
│  Test Suite │────▶│  byclaw-kgw      │────▶│  byclaw-qa KB │
│  (pytest)   │     │  :8000           │     │  :9001 (直连)  │
└─────────────┘     └──────────────────┘     └───────────────┘
                              │
                    ┌─────────┴──────────┐
                    │                    │
              ┌─────┴─────┐      ┌──────┴──────┐
              │  OpenGauss │      │    Redis     │
              │  :15432    │      │   :6379      │
              └───────────┘      └─────────────┘
                              │
                    ┌─────────┴──────────┐
                    │       MinIO        │
                    │       :9000        │
                    └────────────────────┘
```

### 两种路由模式

| 模式 | 配置方式 | KB portal knCode（resourceId） | 说明 |
| --- | --- | --- | --- |
| 直连（Direct） | KB 配置设 `domainURL` = `http://host:port` | `200001` | 网关拼接 `domainURL + opPath` 后用 httpx 直发 |
| 服务发现（Discovery） | KB 配置设 `domainName` = 服务名 | `300001` | 网关通过 Redis DiscoveryClient 解析到实例再 httpx 发 |

> **knCode 双层映射：** 门户调用网关时传 `knCode`（即 resourceId，如 `"200001"`），网关从 MinIO 读到 KB 配置后，取其中的 `resourceCode`（如 `"2"`）作为**后端 knCode**填入请求体。**两者均为纯数字字符串**，但值不同。MinIO 配置键为 `resource/doc/KG_DOC_{knCode}.json`。

### 测试用 KB 配置样例

**直连 KB（`resource/doc/KG_DOC_200001.json`）：**

```json
{
  "resourceId": "200001",
  "resourceCode": "2",
  "domainURL": "http://localhost:9001",
  "domainName": "",
  "headers": {},
  "resourceService": [
    {"name": "directoryCreate", "path": "/api/v1/directories/create"},
    {"name": "directoryUpdate", "path": "/api/v1/directories/update"},
    {"name": "directoryDelete", "path": "/api/v1/directories/delete"},
    {"name": "fileImport", "path": "/api/v1/knowledgeItems/import"},
    {"name": "fileDelete", "path": "/api/v1/knowledgeItems/delete"},
    {"name": "buildTrigger", "path": "/api/v1/fileToMarkdownIndex"},
    {"name": "buildStatus", "path": "/api/v1/fileBuildStatus"},
    {"name": "knowledgeSearch", "path": "/api/v1/knowledgeItems/search"},
    {"name": "metadataSearch", "path": "/api/v1/knowledgeItems/metadataSearch"},
    {"name": "searchFile", "path": "/api/v1/knowledgeItems/searchFile"},
    {"name": "listDir", "path": "/api/v1/listDir"},
    {"name": "glob", "path": "/api/v1/glob"},
    {"name": "readFile", "path": "/api/v1/readFile"},
    {"name": "downloadFile", "path": "/api/v1/downloadFile"},
    {"name": "metadataPropertiesBatchCreate", "path": "/api/v1/metadataProperties/batchCreate"},
    {"name": "metadataPropertiesDelete", "path": "/api/v1/metadataProperties/delete"},
    {"name": "knowledgeItemsMetadataUpdate", "path": "/api/v1/knowledgeItems/metadata/update"},
    {"name": "knowledgeItemsMetadataGet", "path": "/api/v1/knowledgeItems/metadata/get"},
    {"name": "metadataFieldsList", "path": "/api/v1/knowledgeItems/metadataFields/list"}
  ]
}
```

**服务发现 KB（`resource/doc/KG_DOC_300001.json`）：**

```json
{
  "resourceId": "300001",
  "resourceCode": "3",
  "domainURL": "",
  "domainName": "kb-svc-hr",
  "headers": {},
  "resourceService": [
    … 同上 …
  ]
}
```

同时 Redis 中注册服务 `kb-svc-hr` → `{"host": "localhost", "port": 9002, "protocol": "http"}`。

### KB 配置初始化

测试前需向 MinIO 写入 KB 配置文件（键 = `resource/doc/KG_DOC_{knCode}.json`），Redis 中写入 Auth 信息和 Discovery 服务注册，保证 `X-User-Id` 可解析出真实鉴权头。

### byclaw-qa 后端模拟

byclaw-qa 启动为 API 服务后，支持以下 KB 操作：
- `POST /api/v1/knowledgeItems/import` — 文件上传入库
- `POST /api/v1/knowledgeItems/delete` — 文件删除
- `POST /api/v1/directories/create|update|delete` — 目录管理
- `POST /api/v1/listDir` / `POST /api/v1/glob` — 文件浏览
- `POST /api/v1/readFile` / `POST /api/v1/downloadFile` — 文件读取
- `POST /api/v1/fileToMarkdownIndex` / `POST /api/v1/fileBuildStatus` — 知识构建
- `POST /api/v1/knowledgeItems/search|metadataSearch|searchFile` — 检索
- `POST /api/v1/metadataProperties/batchCreate|delete` — 元数据属性同步
- `POST /api/v1/knowledgeItems/metadata/update|get` — 文件元数据读写

---

## 环境准备场景（单次 run 共享）

| 编号 | 用户角色 | 用户目标 | 典型步骤 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| E1 | 测试编排 | 启动直连模式 KB 后端 | conftest 用 `subprocess.Popen` 启动 `bash start.sh api` | 健康检查通过 | 已写 |
| E2 | 测试编排 | 启动服务发现模式 KB 后端 | byclaw-qa lifespan 在 Redis 自动注册 `byclaw-qa-manager` 服务 | DiscoveryClient 可发现 | 已写 |
| E3 | 测试编排 | 在 MinIO 中写入 KB 配置文件 | conftest 种子 `KG_DOC_200001.json`（OpenAPI schema 格式 + domainURL）和 `KG_DOC_300001.json`（domainName） | 配置文件格式合法，网关可读取 | 已写 |
| E4 | 测试编排 | 在 Redis 中写入 Auth 信息 | conftest 种子 `user:test_user:login:auth` hash（含 Beyond-Token/Sso-Token） | 网关可解析出后端认证头 | 已写 |
| E5 | 测试编排 | 初始数据库迁移 | conftest 执行 `run_migrations(pool, sql/)` | 所有 kgw_ 表已创建 | 已写 |

---

## 场景总表 — 知识网关完整路径

### 目录管理（Directories）

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| GD1 | 目录管理员 | 在直连 KB 创建单层目录 | `POST /kgw/api/v1/directories/create {knCode=200001, directoryPath=/policies, directoryDescription=...}` → 检查后端目录真实已创建 → `POST listDir(/)` 可见 | 返回 resultCode=0；listDir 根目录可见新目录 | 已写 |
| GD2 | 目录管理员 | 在服务发现 KB 创建多层目录 | `POST directories/create {knCode=300001, directoryPath=/hr/attendance/2024}` | discovery 模式解析成功并调用后端 | 已写 |
| GD3 | 目录管理员 | 创建路径冲突 | 先创建 `/hr`，再创建 `/hr` | 返回 resultCode=-1，含路径冲突错误 | 已写 |
| GD4 | 目录管理员 | 缺少必填字段 | 不传 `directoryPath` 或 `knCode` | 返回 resultCode=-1 的校验信封 | 已写 |
| GD5 | 目录管理员 | 未知 knCode | `POST directories/create {knCode=99999999}` | 返回 KBNotFound | 已写 |
| GD6 | 目录管理员 | 重命名目录（直连） | `create /dept → update directoryName=department → listDir(/)` | 新路径可见，旧路径消失 | 已写 |
| GD7 | 目录管理员 | 重命名目录到已存在名称 | `create /A → create /B → update B to A` | 返回名称冲突错误 | 已写 |
| GD8 | 目录管理员 | 删除空目录 | `create /tmp → delete /tmp → listDir(/)` | 目录消失 | 已写 |
| GD9 | 目录管理员 | 删除含子目录的非空目录（递归删除） | `create /A → import /A/file.md → delete /A` | 目录和文件全部删除；listDir 不可见 | 已写 |
| GD10 | 目录管理员 | 服务发现模式目录删除 | 同上，knCode=300001 | discovery 解析正确，删除成功 | 已写 |

### 文档导入与删除（KnowledgeItems Import/Delete）

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| GI1 | 内容管理员 | 导入 markdown 文件（直连） | `POST /kgw/api/v1/knowledgeItems/import multipart {knCode=200001, filePath=/policies/leave.md, fileContent=@file}` | 成功导入，listDir 可见 | 已写 |
| GI2 | 内容管理员 | 导入 markdown 文件（发现） | 同上 knCode=300001 | discovery 解析成功并执行 multipart 上传 | 已写 |
| GI3 | 内容管理员 | 导入含 front-matter 的 markdown | 文件 `---\nstatus: active\ntags: [hr,policy]\n---\n# 正文`，需预先声明 status/tags 属性 | front-matter 被翻译为 backend_name 后上传；binding 写入 | 已写 |
| GI4 | 内容管理员 | front-matter 含未注册属性被拒 | import 含 `ghost: 1` 的 md | 返回 resultCode=-1 "not a defined metadata property" | 已写 |
| GI5 | 内容管理员 | front-matter 格式容错 | import 含损坏 YAML 的 md 文件 | 容错导入成功（front-matter 忽略），文件正常入库 | 已写 |
| GI6 | 内容管理员 | 文件路径冲突覆盖 | `import /a.md` → 再次 `import /a.md` | 第二次成功（后端决定是否覆盖） | 已写 |
| GI7 | 内容管理员 | 导入非文本文件（PDF Base64） | multipart 上传 pdf 内容 | Content-Type 正确透传；导入成功 | 已写 |
| GI8 | 内容管理员 | 删除文件（直连） | `POST /kgw/api/v1/knowledgeItems/delete {knCode=200001, filePath=/policies/leave.md}` | 删除成功；metadata binding 级联清除 | 已写 |
| GI9 | 内容管理员 | 删除文件（发现） | 同上 knCode=300001 | 成功 | 已写 |
| GI10 | 内容管理员 | 删除不存在文件 | `delete {filePath=/never.md}` | 后端返回错误，网关透传 | 已写 |
| GI11 | 内容管理员 | 软删除后重新导入同路径 | `import → delete → import same path` | 新文件正常导入，旧 binding 已清除 | 已写 |

### 文件构建（fileToMarkdownIndex / fileBuildStatus）

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| GB1 | 内容管理员 | 触发构建（直连） | `import → POST /kgw/api/v1/fileToMarkdownIndex {knCode=200001, filePath=...}` | 受理成功 resultCode=0 | 已写 |
| GB2 | 内容管理员 | 触发构建（发现） | 同上 knCode=300001 | 受理成功 | 已写 |
| GB3 | 内容管理员 | 查询构建状态 | `fileToMarkdownIndex → POST /kgw/api/v1/fileBuildStatus {knCode, filePath}` | 返回 status + currentStep，构建完成后 status=`success`、currentStep=`complete` | 已写 |
| GB4 | 内容管理员 | 重复提交构建（构建中） | import → 首次 build → 状态 running → 二次 build | 二次返回 resultCode=-1 "已有构建任务" | 已写 |
| GB5 | 内容管理员 | 构建失败后重试 | import → build 失败 → buildStatus 返回 failed → 再次 build | 受理成功，status 更新为 running | 已写 |
| GB6 | 内容管理员 | 未导入文件直接构建 | 不 import 直接 `fileToMarkdownIndex` | 后端返回文件不存在错误 | 已写 |

### 文件读取与浏览（listDir / glob / readFile / downloadFile）

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| GR1 | 普通用户 | 浏览根目录（直连/发现） | `POST listDir {knCode=200001, directoryPath=/}` | 返回根下所有子项，含 type/file/size | 已写 |
| GR2 | 普通用户 | 浏览子目录 | listDir / → 子目录 listDir | 返回该子目录直接内容 | 已写 |
| GR3 | 普通用户 | 浏览不存在目录 | `listDir {directoryPath=/ghost}` | 返回错误 | 已写 |
| GR4 | 普通用户 | glob 模式匹配 | `import /a/1.md, /a/2.md, /a/b/3.md → glob pathRule=/a/*.md` | 返回 /a/1.md 和 /a/2.md，不含子目录 | 已写 |
| GR5 | 普通用户 | glob 空匹配 | `glob pathRule=/x/*.md` | 返回空列表 | 已写 |
| GR6 | 普通用户 | 读取已构建 markdown | `import → build → readFile full` | 返回完整 markdown，reachedEof=true | 已写 |
| GR7 | 普通用户 | 读取 markdown 行窗口 | `readFile startLine=1 endLine=20` | 返回指定行范围，reachedEof 正确 | 已写 |
| GR8 | 普通用户 | 未构建文件 readFile | `import（不构建）→ readFile` | 后端返回 "file not built" 错误 | 已写 |
| GR9 | 普通用户 | downloadFile 原始文件 | `import binary file → downloadFile` | 返回原始字节流，Content-Type 正确 | 已写 |
| GR10 | 普通用户 | downloadFile 中文文件名 | `import 请假制度.md → downloadFile` | Content-Disposition 正确处理非 ASCII | 已写 |
| GR11 | 普通用户 | 服务发现下全路径验证 | `listDir → readFile → downloadFile (knCode=300001)` | 三种操作在 discovery 下均可工作 | 已写 |

### 跨知识库检索（knowledgeSearch / metadataSearch / searchFile）

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| GS1 | 检索用户 | 跨两 KB 语义检索 | `POST knowledgeSearch {knCodeList: [200001, 300001], query="请假流程", topK=5}` | 返回两 KB 的结果，knCode 区分正确 | 已写 |
| GS2 | 检索用户 | 单 KB 降级（一个 KB 故障） | 关停 300001 后端 → search 两 KB | resultCode=0，degraded_kbs 含 300001，200001 正常返回 | 已写 |
| GS3 | 检索用户 | 检索模式验证 | searchMode=`fullTextRecall` / `embedding` / `mixedRecall` | 三种模式各自返回合理结果 | 已写 |
| GS4 | 检索用户 | fileTypeList 过滤 | `search fileTypeList=["md"]` | 仅 .md 文件命中 | 已写 |
| GS5 | 检索用户 | where DSL 元数据过滤 | `search where={eq:{fieldName:"status",value:"active"}}`（先 metadata/update 设置 status=active） | 仅 status=active 的文件命中 | 已写 |
| GS6 | 检索用户 | metadataSearch 纯元数据检索 | 两个 KB 各导入不同 tag 文件 → `POST metadataSearch where={eq:{fieldName:"priority",value:5}}` | 仅 priority=5 的文件命中 | 已写 |
| GS7 | 检索用户 | metadataSearch 空结果 | `where` 条件无命中 | `data=[]`，不报错 | 已写 |
| GS8 | 检索用户 | metadataSearch DSL 算子矩阵 | 覆盖 eq/ne/in/contains/exists/gt/gte/lt/lte/prefix/wildcard/and/or/not/嵌套 | 每种算子命中和不命中场景正确 | 已写 |
| GS9 | 检索用户 | searchFile 文件级去重 | 两 KB 同一 filePath → searchFile | 每个 filePath 仅出现一次 | 已写 |
| GS10 | 检索用户 | searchFile 与 search 一致性 | search 命中 → searchFile 对应文件存在且 topK 正确 | 一致 | 已写 |
| GS11 | 检索用户 | 检索不需要 Auth 透传仍可工作 | search 两 KB → admin/audit 验证无 BackendAuthFailed 异常 | 无鉴权异常 | 已写 |

### 元数据属性主目录（metadataProperties CRUD）

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| GM1 | 元数据管理员 | 创建 string 属性 | `POST metadataProperties/create {propertyName="status", valueType="string", description="..."}` | 成功入库，返回 property_id | 已写 |
| GM2 | 元数据管理员 | 创建全部五种 valueType | 依次 create string/stringList/number/boolean/datetime | 五种全部成功 | 已写 |
| GM3 | 元数据管理员 | 重复创建冲突 | `create status → create status` | 返回 resultCode=-1 "already exists" | 已写 |
| GM4 | 元数据管理员 | 非法 valueType | `create valueType=int` | 返回校验错误 | 已写 |
| GM5 | 元数据管理员 | 批量创建 | `batchCreate [A,B,C]` | 全成功 | 已写 |
| GM6 | 元数据管理员 | 批量含冲突回滚 | `create A → batchCreate [B,A]` | 全失败，B 不留下 | 已写 |
| GM7 | 元数据管理员 | 列出 ACTIVE 属性 | `create A,B → list` | 仅返回 A,B | 已写 |
| GM8 | 元数据管理员 | 按名称过滤 | `list propertyNameList=[A]` | 仅返回 A | 已写 |
| GM9 | 元数据管理员 | 删除无引用属性 | `create → delete` | 成功；list 不再返回 | 已写 |
| GM10 | 元数据管理员 | 删除被引用属性被拒 | `create → metadata/update set → delete` | 返回 resultCode=-1 "still referenced" + inUseSamples | 已写 |

### 文件元数据（metadata/update / metadata/get / metadataFields/list）

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| GF1 | 内容管理员 | set + get 回读 string | import → `metadata/update set status=active` → `metadata/get` | 读回 status=active | 已写 |
| GF2 | 内容管理员 | set + get 五种 valueType | string/number/boolean/datetime/stringList 分别 set → get | 值与类型都正确 | 已写 |
| GF3 | 内容管理员 | append 去重 | `set [a] → append [b,c]` | `[a,b,c]` | 已写 |
| GF4 | 内容管理员 | remove 容忍不存在 | `set [a,b] → remove [x,y]` | `[a,b]` 不报错 | 已写 |
| GF5 | 内容管理员 | clear 清空列表 | `set [a,b] → clear → get` | valueType=stringList, value=[] | 已写 |
| GF6 | 内容管理员 | unset 不存在的属性 | 文件无该属性时 `unset` | 成功，幂等 | 已写 |
| GF7 | 内容管理员 | 操作与类型不兼容 | string 字段 `append` 等 | 返回 resultCode=-1 "not allowed" | 已写 |
| GF8 | 内容管理员 | 未注册属性被拒 | `metadata/update set ghost="x"` | 返回 resultCode=-1 "not found" | 已写 |
| GF9 | 内容管理员 | Lazy sync 触发验证 | create 新属性 → `metadata/update set` → 检查 kgw_metadata_property_sync 表 | sync 状态从 SYNCING → SYNCED | 已写 |
| GF10 | 内容管理员 | metadataFields/list 跨 KB | 两个 KB 各自通过 metadata/update set 不同属性集合 → fields/list | 返回各自 KB 的属性列表 | 已写 |
| GF11 | 内容管理员 | metadataFields/list 含系统字段 | fields/list | 始终返回 7 个系统字段定义 | 已写 |
| GF12 | 内容管理员 | 双模式（直连/发现） | metadata/update + get + fields/list 在 200001 和 300001 上均执行 | 两种模式都可工作 | 已写 |

### metadata/update 绑定生命周期验证

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| GF13 | 内容管理员 | metadata/update 创建 BOUND binding | metadata/update set → 检查 kgw_metadata_property_binding | binding 状态为 BOUND | 已写 |
| GF14 | 内容管理员 | binding ROLLBACK 机制验证 | mock 后端 metadata/update 返回 -1 → 网关调用 metadata/update | binding 不留下 BOUND 记录 | 已写 |
| GF15 | 内容管理员 | front-matter import 与 metadata/update 共享 binding | import md 含 front-matter → metadata/get | 两者共享 binding，状态一致 | 已写 |

### Ingest 数据导入（S5）

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| GU1 | Connector | upsert 单事件（直连） | `POST /kgw/ingest/v1/events {sourceId, itemId, version, op=upsert, knCode=200001, filePath, content}` | status=done, eventId>0 | 已写 |
| GU2 | Connector | upsert 事件（发现） | 同上 knCode=300001 | status=done，discovery 下 multipart 上传成功 | 已写 |
| GU3 | Connector | upsert 含 metadata | event 带 `metadata: {status: "active"}`（属性已注册） | 文件导入成功后 metadata/update 执行 → binding BOUND | 已写 |
| GU4 | Connector | upsert 含未注册 metadata 被拒 | metadata={ghost:"x"}（属性未注册） | 返回 422，event 不落库 | 已写 |
| GU5 | Connector | 幂等防重 | 同 sourceId + itemId + version 再发 | resultMsg=already-processed | 已写 |
| GU6 | Connector | version 单调性拒绝旧版本 | done 记录 version=v2 → 发 version=v1 | status=failed, errorType=STALE_VERSION | 已写 |
| GU7 | Connector | source_lock 阻止写入 | admin lock 文件 → Connector 发 upsert 同 filePath | status=failed, errorType=SOURCE_LOCKED, 冲突日志有记录 | 已写 |
| GU8 | Connector | delete 事件 | `op=delete, filePath=已知文件` | status=done, binding 清除 | 已写 |
| GU9 | Connector | delete 事件失败进 DLQ | mock 后端 delete 返回 -1 → 发 delete 事件 | status=failed → GET events/{id} 确认失败 | 已写 |
| GU10 | Connector | delete 事件 replay | 步骤 GU9 → POST replay | replay 成功后 status=done | 已写 |
| GU11 | Connector | upsert 事件 replay 被拒 | upsert failed 事件 → POST replay | 返回 "upsert events must be re-submitted by the connector" | 已写 |
| GU12 | Connector | 非 failed 事件 replay 被拒 | done 事件 → POST replay | 返回 "not in failed status" | 已写 |
| GU13 | Connector | 批量事件全部成功 | `POST /kgw/ingest/v1/events/batch` 2 个有效 upsert | resultCode=0, succeeded=2, failed=0 | 已写 |
| GU14 | Connector | 批量事件部分失败 | 1 个合法 + 1 个 bad knCode | resultCode=-1, succeeded=1, failed=1 | 已写 |
| GU15 | Connector | 批量超过 100 限制 | batch 101 条 | 被拒绝 | 已写 |
| GU16 | Connector | 批量含 ValidationError | pydantic 校验失败（缺失必填字段） | 单条 result=validation_failed，其他正常处理 | 已写 |
| GU17 | Connector | 请求体超 4MB | POST 超大 content | 返回 413 | 已写 |
| GU18 | Connector | 信号量满载 503 | 构造 100 并发事件打满 semaphore → 第 101 个 | 返回 503 + Retry-After: 5 | 已写 |
| GU19 | Connector | 查询事件列表 | `GET /kgw/ingest/v1/events?knCode=200001&status=done` | 返回分页结果 | 已写 |
| GU20 | Connector | 查询不存在事件 | `GET events/99999999` | 返回 resultCode=-1 "event not found" | 已写 |

### Ingest 事件处理超时与异常

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| GU21 | Connector | 后端超时（30s） | mock 后端 fileImport sleep 31s → 发 upsert | status=failed, errorType=PROCESSING_TIMEOUT | 已写 |
| GU22 | Connector | 后端鉴权失败 | mock 后端返回 401 → 发 upsert | status=failed, errorType=BACKEND_AUTH_FAILED | 已写 |
| GU23 | Connector | 电路断路器 OPEN | 连续失败达 threshold 次 → 第 threshold+1 次 | status=failed, errorType=CIRCUIT_OPEN | 已写 |

### 管理接口（Admin）

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| GA1 | 运维管理员 | 查询审计日志 | `GET /kgw/admin/v1/audit?source=ingest&pageSize=20` | 返回 ingest 来源的审计条目 | 已写 |
| GA2 | 运维管理员 | 查询审计日志（按操作过滤） | `GET audit?operationType=fileImport` | 仅返回 fileImport 操作 | 已写 |
| GA3 | 运维管理员 | 查询审计日志（时间窗） | `GET audit?fromTime=...&toTime=...` | 仅返回窗口内条目 | 已写 |
| GA4 | 运维管理员 | 查询冲突日志 | `GET /kgw/admin/v1/conflicts?knCode=200001&reason=STALE_VERSION` | 返回 STALE_VERSION 冲突记录 | 已写 |
| GA5 | 运维管理员 | 锁定文件 | `POST lock {lockOwner: "manual"}` | 锁定成功 | 已写 |
| GA6 | 运维管理员 | 已锁文件拒绝重复锁 | 重复 lock 同 filePath | 返回 resultCode=-1 "already locked" | 已写 |
| GA7 | 运维管理员 | 过期锁被替换 | lock expiresAt=过去 → 再次 lock with different owner | 替换成功 | 已写 |
| GA8 | 运维管理员 | 解锁文件 | unlock 已锁文件 | 成功；后续 ingest 不再被阻塞 | 已写 |
| GA9 | 运维管理员 | 解锁未锁文件 | unlock 未锁文件 | 返回 resultCode=-1 "file is not locked" | 已写 |
| GA10 | 运维管理员 | 查看元数据属性管理面板 | `GET /kgw/admin/v1/metadata-properties` | 含 sync 状态、DELETED 属性 | 已写 |
| GA11 | 运维管理员 | 查询 orphan 死列 | `GET orphans?knCode=200001` | 返回数据或空 | 已写 |
| GA12 | 运维管理员 | sync 失败重试 | 构造 sync FAILED → `POST sync-retry` | 状态回到 SYNCING，最终 SYNCED | 已写 |
| GA13 | 运维管理员 | purge 失败重试 | 构造 purge FAILED → `POST purge-retry` | 状态回到 PURGING | 已写 |

### Worker 验证（cleanup / reconcile）

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| GW1 | 运维管理员 | cleanup worker 处理 PURGING | metadata/delete 属性（无 binding）→ 等待 cleanup cycle | 后端 `__byclaw_kgw__*` 列被删除；sync 行 PURGED；主表行物理删除 | 已写 |
| GW2 | 运维管理员 | cleanup worker 处理 PURGE_FAILED | mock 后端 metadataProperties/delete 返回 -1 → 等待 cleanup cycle | purge 标记 PURGE_FAILED，不物理删除；可 admin purge-retry | 已写 |
| GW3 | 运维管理员 | reconcile worker 清理 stale DELETING | 构造一个过期 DELETING binding，后端 metadata/get 不返回该字段 → 等待 reconcile cycle | binding 行被删除 | 已写 |
| GW4 | 运维管理员 | reconcile worker 恢复 stale DELETING | 构造一个过期 DELETING binding，后端 metadata/get 仍返回该字段 → 等待 reconcile cycle | binding 恢复为 BOUND | 已写 |
| GW5 | 运维管理员 | reconcile 不会误删近期 DELETING | 近 1 分钟内的 DELETING binding → 等待 reconcile cycle | DELETING 行保留 | 已写 |
| GW6 | 运维管理员 | worker 并发安全 | cleanup 双任务使用 SKIP LOCKED；reconcile 双任务使用 updated_at 行版本保护 | 不重复删除、无锁冲突，最终行数正确 | 已写 |

---

## 跨知识库编排场景（多 KB 联测）

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| CX1 | 内容管理员 | 同文件同步到两个不同模式 KB | import → fileToMarkdownIndex 同时对 200001 和 300001 | 直连和服务发现皆成功 | 已写 |
| CX2 | 检索用户 | 跨 KB 元数据统一检索 | 两 KB 各创建属性 status 并 set 不同值 → metadataSearch where eq status active | 从两 KB 各自召回对应文件 | 已写 |
| CX3 | Connector | Ingest 推送同数据到两 KB | POST events batch 含 200001 + 300001 两个 upsert | 两条都 done，对应 kbCode audit 可查 | 已写 |
| CX4 | 运维管理员 | 跨 KB 锁定不同文件 | lock 200001 的 /a.md → ingest 300001 同路径不受影响 | 200001 被锁、300001 正常写入 | 已写 |
| CX5 | 运维管理员 | 审计日志跨 KB 聚合 | 同一时间段 audit 查询不分 knCode → 验证返回条目含两个 KB 的操作 | 两 KB 操作都出现在 audit 中 | 已写 |

---

## 鉴权异常与安全防护

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| AU1 | 攻击者 | Redis 中无鉴权信息 | 请求头 X-User-Id=unknown → 任意写操作 | 返回 AuthInfoNotFound | 已写 |
| AU2 | 恶意调用方 | 后端返回 401 | mock 后端返回 401 → 网关写操作 | 返回 BackendAuthFailed，不泄露敏感信息 | 已写 |
| AU3 | 恶意调用方 | 后端返回 403 | mock 后端返回 403 → 网关读操作 | 返回 BackendAuthFailed | 已写 |

---

## 错误/故障场景总括

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ER1 | Connector | 后端连接失败 | 关停 KB 后端 → 所有写操作 | 返回 UpstreamConnectError | 已写 |
| ER2 | Connector | 后端超时 | mock 后端 sleep >gateway timeout → 发请求 | 返回 UpstreamTimeout | 已写 |
| ER3 | 运维管理员 | 未知 knCode | 任意接口 knCode=99999999 | 返回 KBNotFound | 已写 |
| ER4 | 运维管理员 | 电路断路器 OPEN 后恢复 | 后端返回连续失败 → OPEN → 后台周期确认 → HALF_OPEN → 成功后 CLOSE | 指标 circuit_state 状态流转正确 | 已写 |
| ER5 | Connector | 请求参数校验失败 | 各类必填字段缺失、类型错误 | 返回 resultCode=-1 信封 | 已写 |

---

## 已覆盖接口清单

| 接口 | 覆盖场景 |
| --- | --- |
| `POST directories/create` | GD1-GD5 |
| `POST directories/update` | GD6, GD7 |
| `POST directories/delete` | GD8-GD10 |
| `POST knowledgeItems/import` | GI1-GI7 |
| `POST knowledgeItems/delete` | GI8-GI11 |
| `POST fileToMarkdownIndex` | GB1, GB2, GB4-GB6 |
| `POST fileBuildStatus` | GB3 |
| `POST listDir` | GD1 复用, GR1-GR3 |
| `POST glob` | GR4, GR5 |
| `POST readFile` | GR6-GR8 |
| `POST downloadFile` | GR9-GR11 |
| `POST knowledgeItems/search` | GS1-GS5 |
| `POST knowledgeItems/metadataSearch` | GS6-GS8 |
| `POST knowledgeItems/searchFile` | GS9, GS10 |
| `POST knowledgeItems/metadata/update` | GF1-GF9 |
| `POST knowledgeItems/metadata/get` | GF1, GF2, GF10, GF15 |
| `POST knowledgeItems/metadataFields/list` | GF10, GF11 |
| `POST metadataProperties/create` | GM1-GM4 |
| `POST metadataProperties/batchCreate` | GM5, GM6 |
| `POST metadataProperties/list` | GM7, GM8 |
| `POST metadataProperties/delete` | GM9, GM10 |
| `POST /kgw/ingest/v1/events` | GU1-GU8, GU17, GU18, GU21-GU23 |
| `POST /kgw/ingest/v1/events/batch` | GU13-GU16 |
| `GET /kgw/ingest/v1/events/{id}` | GU9, GU20 |
| `GET /kgw/ingest/v1/events` | GU19 |
| `POST /kgw/ingest/v1/events/{id}/replay` | GU10-GU12 |
| `GET /kgw/admin/v1/audit` | GA1-GA3, CX5 |
| `GET /kgw/admin/v1/conflicts` | GA4, GU7 |
| `POST /kgw/admin/v1/kbs/{kn}/files/{path}/lock` | GA5-GA7 |
| `POST /kgw/admin/v1/kbs/{kn}/files/{path}/unlock` | GA8, GA9 |
| `GET /kgw/admin/v1/metadata-properties` | GA10 |
| `GET /kgw/admin/v1/metadata-properties/orphans` | GA11 |
| `POST /kgw/admin/v1/metadata-properties/{name}/sync-retry` | GA12 |
| `POST /kgw/admin/v1/metadata-properties/{name}/purge-retry` | GA13 |
| `POST /kgw/api/v1/dslGuide` | （静态内容，无需集成测试） |
| Worker cleanup | GW1, GW2 |
| Worker reconcile | GW3-GW6 |

**所有 34 个端点全部覆盖。** 覆盖场景总数：**~95 个**（含跨 KB 编排、服务发现、worker 验证、故障注入）。

---

## 当前已落测试文件

| 文件 | 覆盖重点 | 测试数 |
| --- | --- | --- |
| `tests/integration/conftest.py` | 自动启动 byclaw-qa 子进程、种子 MinIO OpenAPI KB 配置、Redis auth、kgw app 构建/拆解 | — |
| `tests/integration/test_directories.py` | GD1-GD10 目录 CRUD 完整生命周期（创建/改名/删除/冲突/递归/直连+发现） | 12 |
| `tests/integration/test_file_ops.py` | GI1-GI11/GB1-GB6/GR1-GR11：文件导入/删除/构建/读取/glob/downloadFile 全链路 | 14 |
| `tests/integration/test_routing.py` | E3-E5/路由验证/直连+发现双模式 KB 配置解析/listDir/import | 9 |
| `tests/integration/test_search.py` | GS1-GS11 跨 KB 检索 ×3 mode/DSL 算子/metadataSearch/searchFile/降级 | 9 |
| `tests/integration/test_admin.py` | GA1-GA13 审计/冲突/lock+unlock/ingest 锁阻止/元数据管理面板/orphans | 12 |
| `tests/integration/test_ingest_core.py` | GU1-GU20 单事件/幂等/delete/replay/batch/DLQ/信号量/事件查询 | 15 |
| `tests/integration/test_ingest_error.py` | GU17/GU22-GU23/ER4：413/CB OPEN/恢复/基本成功 | 5 |
| `tests/integration/test_error_paths.py` | ER1-ER5/AU1-AU3：未知 knCode×5/auth 缺失/真实列表/参数校验 | 9 |
| `tests/integration/test_cross_kb.py` | CX1-CX5：跨 KB 列表/导入/审计/检索/锁隔离/cleanup | 6 |
| `tests/integration/test_workers.py` | GW1-GW6：cleanup PURGING/PURGE_FAILED + reconcile stale DELETING/并发保护 | 6 |
| `tests/test_integration_s4.py` | S4 元数据属性 CRUD + sync + binding + front-matter import | 3 |
| `tests/test_integration_s5.py` | S5 ingest 基础场景 | 8 |

**总计 116 个集成测试，34/34 端点全覆盖，全部真实 byclaw-qa 后端 + 直连/服务发现双模式。**
