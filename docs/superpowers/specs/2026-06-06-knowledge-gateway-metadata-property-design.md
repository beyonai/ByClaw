# 知识网关 metadataProperty 治理设计(方案 D)

> 状态:草案
> 日期:2026-06-06
> 关联:[`2026-06-02-knowledge-gateway-design-v5.md`](./2026-06-02-knowledge-gateway-design-v5.md)、[`2026-06-03-knowledge-gateway-implementation-slicing.md`](./2026-06-03-knowledge-gateway-implementation-slicing.md)、[`/docs/api/metadata_api.md`](../../api/metadata_api.md)
>
> 替代关系:本设计取代 v5 spec §4.6 全节(metadataProperty 主目录与懒同步)、§5.1 中 metadataProperty 相关三张表、§6.6 中 metadataProperty 错误归一化、§6.7 控制面端点 metadataProperty 部分。

## 0. 问题背景

S1-S3 已落地。S4 进入 metadataProperty 治理。v5 spec 当前的设计在多业务 KB 后端拓扑下有三个未闭环的核心问题:

1. `kgw_metadata_property` 用 `property_name` 作主键 + 软删除,导致修改同名定义(描述、类型)必然失败。
2. `delete` 时如何精确判定"被使用",v5 spec 未给出可执行机制。
3. 多业务 KB 后端 `create / delete` 部分成功、部分失败时缺乏闭环状态机,容易留中间态。

本设计(方案 D)针对这三个问题给出闭环方案,核心思想:

- **主目录用代理键 `property_id` 作主键,partial unique index 让 `property_name` 仅在 ACTIVE 范围内唯一**,DELETED 行不参与名字唯一性 → 同名再造合法。
- **`backend_name` 由 `property_id` 派生**(`__byclaw_kgw__{name}__v{property_id}`),新旧版本在后端 schema 层永不撞名。
- **网关本地维护 `kgw_metadata_property_binding` 引用关系表**,delete 校验为 O(1) 本地查询,与 MinIO / 后端 IO 解耦。
- **`delete` 不在前台扇出后端**,只翻状态轨;后端死列由 cleanup worker 异步清理。三个 worker 通过 `SELECT ... FOR UPDATE SKIP LOCKED` 多实例安全运行。
- 沿用 v5 spec lazy sync 模型(create 不预先扇出后端),新 KB 加入自动覆盖,无 onboarding 流程。
- 写路径(serve `metadata/update`、`knowledgeItems/import`、ingest `events`、`events/batch`)统一走 lazy sync + binding 维护链路;读路径仅做字段名映射,不触发 lazy sync。

## 1. 数据模型

四张表,所有状态机建立在这之上。SQL 编号 005-007 三个文件分别对应主目录、binding(含 outbox 同表迁移)、sync。详见 §5.3。

### 1.1 主目录:`kgw_metadata_property`

```sql
CREATE TABLE kgw_metadata_property (
  property_id    BIGSERIAL    PRIMARY KEY,
  property_name  VARCHAR(128) NOT NULL,
  backend_name   VARCHAR(160) NOT NULL UNIQUE,
  value_type     VARCHAR(32)  NOT NULL,
  description    TEXT,
  ext_params     JSONB,
  status         VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
  created_at     TIMESTAMPTZ  DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_metadata_property_name_active
  ON kgw_metadata_property (property_name)
  WHERE status = 'ACTIVE';
CREATE INDEX idx_metadata_property_deleted
  ON kgw_metadata_property (deleted_at)
  WHERE status = 'DELETED';
```

派生规则:`backend_name = '__byclaw_kgw__' || property_name || '__v' || property_id`。
`status` 取值:`ACTIVE` / `DELETED`。`DELETED` 行作为 cleanup worker 的工作队列入口,保留 `backend_name` 与 `property_id` 供 worker 精确清理使用,直到所有曾同步过的后端都 PURGED 才物理删除。

### 1.2 引用关系表:`kgw_metadata_property_binding`

```sql
CREATE TABLE kgw_metadata_property_binding (
  property_id   BIGINT       NOT NULL REFERENCES kgw_metadata_property(property_id) ON DELETE RESTRICT,
  kn_code       VARCHAR(64)  NOT NULL,
  file_path     VARCHAR(512) NOT NULL,
  status        VARCHAR(16)  NOT NULL,
  attempt_id    BIGINT       NOT NULL,
  bound_at      TIMESTAMPTZ  DEFAULT NOW(),
  PRIMARY KEY (property_id, kn_code, file_path)
);
CREATE INDEX idx_binding_pending
  ON kgw_metadata_property_binding (status, bound_at)
  WHERE status = 'PENDING';
```

`status` 取值:`PENDING`(网关已写,后端调用未确认)/ `SYNCED`(后端写入成功)。delete 校验把两者都视为"在用",偏保守(允许误拒,不允许误放)。

### 1.3 后端列同步状态:`kgw_metadata_property_sync`

```sql
CREATE TABLE kgw_metadata_property_sync (
  property_id     BIGINT      NOT NULL REFERENCES kgw_metadata_property(property_id) ON DELETE CASCADE,
  kn_code         VARCHAR(64) NOT NULL,
  sync_status     VARCHAR(16) NOT NULL,
  last_sync_at    TIMESTAMPTZ,
  last_error      TEXT,
  PRIMARY KEY (property_id, kn_code)
);
CREATE INDEX idx_sync_status
  ON kgw_metadata_property_sync (sync_status)
  WHERE sync_status IN ('FAILED', 'PURGING', 'PURGE_FAILED');
```

`sync_status` 取值:`SYNCING` / `SYNCED` / `FAILED` / `PURGING` / `PURGED` / `PURGE_FAILED`,详见第 2 节状态机。

### 1.4 binding 异常路径 outbox:`kgw_metadata_binding_outbox`

```sql
CREATE TABLE kgw_metadata_binding_outbox (
  id            BIGSERIAL PRIMARY KEY,
  property_id   BIGINT      NOT NULL,
  kn_code       VARCHAR(64) NOT NULL,
  file_path     VARCHAR(512) NOT NULL,
  attempt_id    BIGINT      NOT NULL,
  reason        VARCHAR(64) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

仅在"先写 binding 后调后端,后端失败 + 反向 DELETE binding 也失败"的极端路径写入,reconcile worker 周期处理。

### 1.5 关键不变量

1. 同一时刻 `propertyName` 仅有一行 ACTIVE — partial unique index 强制。`DELETED` 行可与新 ACTIVE 同名共存,不冲突,支持同名再造。
2. `backend_name` 全局唯一且永不复用 — `__byclaw_kgw__{name}__v{property_id}`,新旧版本在后端 schema 层永不撞名。
3. delete 是 `ACTIVE → DELETED` 状态翻转 + sync 行 `SYNCED → PURGING` 批量更新,前台同步终态;物理删主目录行延迟到 sync 表所有行 PURGED 后由 cleanup worker 完成。
4. delete 前置条件由 binding 表 O(1) 查询给出 — `SELECT 1 FROM binding WHERE property_id=? AND status IN ('PENDING','SYNCED') LIMIT 1`,与远程 IO 解耦。
5. `binding.status='PENDING'` 偏保守计入"在用",delete 视同 SYNCED。
6. sync 表 FK `ON DELETE CASCADE`,主目录行物理删时同步清理 sync 表;binding 表 FK `ON DELETE RESTRICT`,作为 belt-and-suspenders(走到物理删时 binding 应已为空)。
7. 后端死列(`__byclaw_kgw__name__v7` 在 v7 被删后未清完)是允许的孤儿,不影响业务正确性,由 cleanup worker 异步处理。

## 2. 状态机

三条独立状态轨,通过 `property_id` 关联。

### 2.1 状态轨 1:property 生命周期(主目录 `status`)

```
                    create
                      │
                      ▼
                ┌───────────┐
                │  ACTIVE   │ ◄── 唯一可被 list / metadata-update 引用
                └─────┬─────┘
                      │ delete (binding 必须空)
                      ▼
                ┌───────────┐
                │  DELETED  │ ◄── 不可见,不可引用,backend_name 不可复用;
                │           │     cleanup 工作队列入口
                └─────┬─────┘
                      │ 该 property_id 在 sync 表中所有行都为 PURGED
                      ▼
                  (物理删除)
                  - DELETE FROM kgw_metadata_property WHERE property_id=?
                  - sync 表通过 FK CASCADE 自动清干净
```

不变量:`ACTIVE` 同名唯一(partial unique index),`DELETED` 行不参与名字唯一性;`ACTIVE → DELETED` 由前台 delete API 同步完成(O(1) binding 查 + 1 行 UPDATE + 批量 UPDATE sync → PURGING);`DELETED → 物理删`由 cleanup worker 异步推进。

### 2.2 状态轨 2:per-(property_id, knCode) 同步状态(`sync_status`)

承担 lazy create 同步与 cleanup purge 两段。

```
        (首次使用) lazy sync 启动
                      │
                      ▼
                ┌───────────┐  调后端 batchCreate 失败
                │  SYNCING  │ ──────────────────────► ┌───────────┐
                │           │                          │  FAILED   │
                └─────┬─────┘                          └─────┬─────┘
                      │ 调后端 batchCreate 成功               │ 下次使用 retry
                      ▼                                       │  或 admin 强制
                ┌───────────┐                                 ▼
                │  SYNCED   │ ◄────────────────────── (回到 SYNCING)
                └─────┬─────┘
                      │ property delete (主目录 ACTIVE→DELETED)
                      ▼
                ┌───────────┐  cleanup worker 调后端 删除 backend_name 失败
                │  PURGING  │ ──────────────────────► ┌──────────────┐
                │           │                          │ PURGE_FAILED │
                └─────┬─────┘                          └──────┬───────┘
                      │ 调后端成功                            │ worker 周期重试
                      ▼                                       │  或 admin 强制
                ┌───────────┐                                 ▼
                │  PURGED   │                          (回到 PURGING)
                └───────────┘
                      │ 该 property_id 所有 sync 行都 PURGED
                      ▼
                (触发主目录物理删 → CASCADE 清空本表)
```

关键转移规则:

- `NOT_SYNCED`(无行) → `SYNCING`:lazy 路径首次使用 (property_id, knCode) 时 INSERT 一行 SYNCING。
- 同一 (property_id, knCode) 的 SYNCING 由 PG advisory lock(事务级)防并发,避免两个并发请求都触发 batchCreate。
- `SYNCED → PURGING`:由 delete API 同步批量 UPDATE 完成。
- `FAILED` / `SYNCING` 行不进入 PURGING:从未真正物化(或同步中途失败)的 (property_id, knCode) 在 delete 时直接 DELETE 该 sync 行(见 §3.3),避免阻塞主目录后续物理删。
- `PURGE_FAILED` 不阻塞前台:property 已 DELETED,binding 已空,业务无感知;只是后端死列没清干净,运维可观察可重试。

### 2.3 状态轨 3:binding 同步状态(`status`)

```
        metadata/update set/append, import, ingest events 进入
                      │
                      ▼
                ┌───────────┐
                │  PENDING  │ ◄── INSERT 时 status='PENDING' + attempt_id
                └─────┬─────┘
                      │ 后端 metadata 调用成功
                      ▼
                ┌───────────┐
                │  SYNCED   │
                └─────┬─────┘
                      │ unset/remove/clear, 或文件删, 或目录删
                      ▼
                  (DELETE row)
```

异常路径:后端调用失败 → DELETE 该 PENDING 行;DELETE 失败 → 写 `kgw_metadata_binding_outbox`,binding 仍 PENDING,等 reconcile worker 处理。delete API 视 `PENDING` 等同 `SYNCED` 计入"在用",偏保守。

### 2.4 三轨耦合点

| 触发器 | 跨轨影响 |
|---|---|
| `metadata/update` set/append、`import` 携带 metadata、ingest `events` upsert | 创建/激活 binding 行;触发 sync 轨 lazy(若 NOT_SYNCED → SYNCING → SYNCED) |
| `metadataProperties/delete` | 主目录 ACTIVE → DELETED;sync 表批量 SYNCED → PURGING(同事务) |
| cleanup worker 完成最后一行 PURGED | 触发主目录物理删 + CASCADE |
| `knowledgeItems/delete`、`directories/delete`、ingest `events` op=delete | 删除该 (knCode, filePath) 全部 binding;sync 表不动(SYNCED 维持,后端 `__byclaw_kgw__*` 列还在) |

前台 API 只动状态轨 1 + 状态轨 2 的同步部分;cleanup worker 只在状态轨 2 的 PURGING/PURGE_FAILED 与状态轨 1 的物理删之间动;reconcile worker 只动状态轨 3 的孤儿。三方互不阻塞。

## 3. 接口语义清单

每个端点定义入参、出参、与状态机的具体绑定。错误归一化集中在 §3.13。

### 3.1 `POST /kgw/api/v1/metadataProperties/create`

入参与 metadata_api.md `metadataProperties/create` 一致:

```json
{
  "propertyName": "status",
  "valueType": "string",
  "description": "用于标记文档状态",
  "extParams": {"sourceSystem": "oa", "displayOrder": 10}
}
```

处理:

1. 校验 `valueType ∈ {string, stringList, number, boolean, datetime}`;失败 → `INVALID_VALUE_TYPE`。
2. INSERT 主目录(backend_name 暂占位)→ 拿到 `property_id` → 计算 `backend_name = '__byclaw_kgw__' || property_name || '__v' || property_id` → UPDATE 写回。
3. `uq_metadata_property_name_active` 冲突 → `MetadataPropertyAlreadyExists`,与 metadata_api.md 错误信封一致。

返回成功响应与 metadata_api.md 一致;`backend_name` 与 `property_id` 不暴露给应用。

状态机:状态轨 1 入口 `(无)→ ACTIVE`;状态轨 2 不动(lazy)。

### 3.2 `POST /kgw/api/v1/metadataProperties/batchCreate`

入参 `propertyList: array[create_payload]`。原子语义:整批在单 PG 事务内执行,任一项冲突或校验失败 → 整批回滚。批内重名 → `INVALID_BATCH_DUPLICATE_NAME`;批内某项与已有 ACTIVE 同名 → `MetadataPropertyAlreadyExists`,整批回滚。返回成功列表与 metadata_api.md 一致。

### 3.3 `POST /kgw/api/v1/metadataProperties/delete`

入参 `{"propertyName": "status"}`。

处理(单 PG 事务):

1. `SELECT property_id FROM kgw_metadata_property WHERE property_name=? AND status='ACTIVE' FOR UPDATE`;不存在 → `MetadataPropertyNotFound`。
2. `SELECT 1 FROM kgw_metadata_property_binding WHERE property_id=? AND status IN ('PENDING','SYNCED') LIMIT 1`。
3. 有行 → 返回 `MetadataPropertyInUse` + 占用清单(从 binding 聚合 top-N 个 (knCode, filePath) 及总计数,limit 防爆):

   ```json
   {
     "resultCode": "-1",
     "resultMsg": "metadata property is still referenced: status",
     "resultObject": {
       "propertyName": "status",
       "inUseSamples": [
         {"knCode": "2", "filePath": "/制度/续签流程.md"},
         {"knCode": "2", "filePath": "/制度/考勤管理办法.pdf"}
       ],
       "totalReferences": 2
     }
   }
   ```

4. 无行 → 同事务执行三步:
   - `UPDATE kgw_metadata_property SET status='DELETED', deleted_at=NOW() WHERE property_id=?`
   - `UPDATE kgw_metadata_property_sync SET sync_status='PURGING' WHERE property_id=? AND sync_status='SYNCED'`
   - `DELETE FROM kgw_metadata_property_sync WHERE property_id=? AND sync_status IN ('FAILED','SYNCING')`(从未真正物化的 KB 直接清掉,无需后端清理)
5. 提交 → 200 + 空 `resultObject`,与 metadata_api.md 一致。

状态机:状态轨 1 `ACTIVE → DELETED`;状态轨 2 批量 `SYNCED → PURGING`。后端清理由 cleanup worker 后台异步推进,delete API 同步终态返回。

### 3.4 `POST /kgw/api/v1/metadataProperties/list`

入参 `{"propertyNameList": ["status", "tags"]}`(可选,不传返回全部 ACTIVE)。

处理 `SELECT property_name, value_type, description, ext_params FROM kgw_metadata_property WHERE status='ACTIVE' [AND property_name = ANY(?)]`。返回与 metadata_api.md 一致,**只返回 ACTIVE,DELETED 不可见**。无状态机交互。

### 3.5 `POST /kgw/api/v1/knowledgeItems/metadata/update`(写 binding 主入口)

入参与 metadata_api.md `metadata/update` 一致:`knCode + filePath + operationList`。

处理:

1. **逐项校验 operationList**:
   - `propertyName` 必须在主目录 ACTIVE 中 → 否则 `MetadataPropertyNotFound`。
   - `operation` 与 `valueType` 兼容性(标量 vs stringList) → 否则 `INVALID_OPERATION_FOR_TYPE`(与 metadata_api.md 一致)。
   - `value` 类型匹配 `valueType` → 否则 `INVALID_FIELD_VALUE_TYPE`。
2. **聚合涉及的 property_id 集合 P**;对每个 (p ∈ P, knCode) 调用 `ensure_synced` 子流程(详见 §4.3),把状态轨 2 推到 SYNCED,失败 → `MetadataPropertySyncFailed`。
3. **lazy sync 全部 SYNCED 后,在单事务内写 binding**(先 binding 后端,与第四题约定一致):
   - `set / append`:`INSERT INTO binding(...) ON CONFLICT (property_id, kn_code, file_path) DO UPDATE SET attempt_id=EXCLUDED.attempt_id`,status=`PENDING`。
   - `unset / remove / clear`:暂不删 binding,等后端调用成功后处理。
4. **改写 payload**:`operationList[].propertyName → backend_name`。调后端 `/api/v1/knowledgeItems/metadata/update`。
5. **后端响应分支**:
   - 成功 → 单事务 `UPDATE binding SET status='SYNCED' WHERE attempt_id=?`,`unset/clear` 操作 DELETE 对应 binding 行;`remove` 后 stringList 仍非空则 binding 行保留。
   - 失败 → 反向 `DELETE binding WHERE attempt_id=?`(刚 UPSERT 的 PENDING 全部回滚);DELETE 失败 → 写 `kgw_metadata_binding_outbox`。返回后端原始错误信封透传。
6. **响应字段名反向改写**:后端响应 `metadata.{backend_name}` → `metadata.{propertyName}`,与 metadata_api.md 应用层视图一致。

状态机:lazy 触发状态轨 2(SYNCING → SYNCED 或 FAILED);binding 走状态轨 3(PENDING → SYNCED 或 DELETE)。

### 3.6 `POST /kgw/api/v1/knowledgeItems/metadata/get`

入参与 metadata_api.md 一致。处理:

1. 校验 `metadataFieldList` 中每个 propertyName 必须 ACTIVE;不允许 → `MetadataPropertyNotFound`。
2. 入参 `metadataFieldList` 改写为 backend_name 列表。
3. 调后端;响应里 `metadata.{backend_name}` → `metadata.{propertyName}`。
4. 不写 binding,不触发 lazy sync(读路径不写不同步)。后端字段不存在时,响应里该 propertyName 自然缺席,与"该文件没设过该属性"语义一致。

### 3.7 `POST /kgw/api/v1/knowledgeItems/metadataFields/list`

入参 `{"knCodeList": ["2", "3"]}`。

**与 v5 spec 偏离**:从"按 knCode 路由调后端"改为"网关本地查 sync 表"。理由:只有 sync 表知道哪些 backend_name 是网关认识的活字段;后端可能有死列(DELETED 之后未清完),不应暴露给应用。

处理:

1. 对每个 knCode,从 sync 表查 `(property_id, kn_code) WHERE sync_status='SYNCED'`。
2. 关联主目录拿 propertyName / valueType / description(主目录 status 必须 ACTIVE,排除 DELETED 但 cleanup 未完的)。
3. 聚合去重,返回与 metadata_api.md 一致格式。

观察:同一文件的 `metadata/get` 可能返回某 propertyName(因为后端真有列),但 `metadataFields/list` 不返回(已 DELETED,主目录 ACTIVE 过滤掉)。这是预期行为 — list 视角是"平台允许使用什么",get 视角是"文件实际存了什么"。

### 3.8 `POST /kgw/api/v1/knowledgeItems/{search,metadataSearch,searchFile}`(读路径)

处理(只做字段名映射,不触发 lazy sync,不写 binding):

1. 入参 `where` AST 中 `fieldName` → backend_name(改写发生在 DSL 子树遍历时,系统字段如 `fileType` 不改);propertyName 不在 ACTIVE 主目录 → 返回 metadata_api.md 错误格式 `UNKNOWN_FIELD`,在网关层就拒。
2. 入参 `metadataFieldList` → backend_name 列表。
3. 调后端;响应里 `metadata.{backend_name}` → `metadata.{propertyName}`。

多 KB 字段名映射:`knCodeList` 多个 KB 共享同一 propertyName → 共享同一 property_id → 同一 backend_name,改写一次对所有 KB 都正确。这是 backend_name 全局唯一带来的红利。

### 3.9 `POST /kgw/api/v1/knowledgeItems/import`(S2 已实现,本节增量)

`import` 携带 metadata 时:与 §3.5 走同一 binding + lazy sync 链路。lazy sync 全部 SYNCED → 写 binding PENDING → 改写 metadata key → 调后端 import → 成功 PENDING → SYNCED;失败反向 DELETE binding。

### 3.10 `POST /kgw/api/v1/knowledgeItems/delete`(S2 已实现,本节增量)

调后端成功后 → `DELETE FROM binding WHERE kn_code=? AND file_path=?`(删该文件全部 property 的 binding 行)。调后端失败 → 不动 binding。**不影响 sync 状态**:文件删了,但后端 `__byclaw_kgw__*` 列还在,SYNCED 维持。

### 3.11 `POST /kgw/api/v1/directories/delete`(S2 已实现,本节增量)

调后端成功后 → `DELETE FROM binding WHERE kn_code=? AND file_path LIKE ? || '/%'`(目录前缀)。

### 3.12 ingest 端点(S5 范围,本设计强制覆盖)

S5 实现 ingest `POST /kgw/ingest/v1/events` 与 `/events/batch` 时,`StandardItem.metadata` 写入路径必须与 serve `metadata/update` 共用同一 lazy sync + binding 维护中间件,具体行为:

1. **校验阶段**(在 v5 spec §4.5.1 步骤 3 metadataProperty 引用校验之后):每个 metadata key 必须在主目录 ACTIVE 中存在,否则 422 + `errorList[].code='METADATA_PROPERTY_NOT_FOUND'`,事件不入 `ingest_event` 表。
2. **lazy sync**:对每个 (property_id, knCode) 调用 `ensure_synced`,失败 → 事件 status=`failed`,error_type=`MetadataPropertySyncFailed`,进 DLQ。
3. **写 binding**:与 §3.5 一致,先写 PENDING 再调后端写接口(`fileImport` / `metadataUpdate`)。
4. **后端响应分支**:
   - 成功 → 推 binding PENDING → SYNCED;`ingest_event` status=`done`。
   - 失败 → 反向 DELETE binding;rollback 失败写 outbox;`ingest_event` status=`failed`。
5. **`op='delete'`**:调后端 `fileDelete` 成功后,DELETE 该 (knCode, filePath) 的全部 binding,与 §3.10 一致;sync 表不动。
6. **批量端点 `/events/batch`**:逐事件按上面流程处理(可顺序或并发);单事件失败不影响批内其他事件,响应中按 v5 ingest API 约定逐项返回 status。

ingest 路径与 serve 路径在状态机上等价,两者复用同一 `ensure_synced` 实现与 binding 写入实现,不引入第二套逻辑。

### 3.13 admin 端点(新增)

| 端点 | 方法 | 用途 |
|---|---|---|
| `/kgw/admin/v1/metadata-properties` | GET | 列出所有 property(含 DELETED + sync 状态明细),运维可见 |
| `/kgw/admin/v1/metadata-properties/{propertyName}/sync-retry` | POST | 强制 retry FAILED → SYNCING(可指定 `knCode` 或全 KB) |
| `/kgw/admin/v1/metadata-properties/{propertyName}/purge-retry` | POST | 强制 retry PURGE_FAILED → PURGING(可指定 `knCode` 或全 KB) |
| `/kgw/admin/v1/metadata-properties/orphans` | GET | 给定 `knCode`,扫该 KB 的死列(后端 `__byclaw_kgw__*` 但不在 sync 表 SYNCED/PURGING 中) |

orphans 端点 S4 仅提供 GET,不实现 DELETE;运维确认后手动删或后续片实现。

### 3.14 错误归一化(增量于 v5 spec §6.6)

| error_type | 触发场景 | HTTP |
|---|---|---|
| `MetadataPropertyNotFound` | propertyName 不在 ACTIVE 主目录(create 不算) | 200 |
| `MetadataPropertyAlreadyExists` | create 撞上 ACTIVE 同名 | 200 |
| `MetadataPropertyInUse` | delete 时 binding 非空 | 200 |
| `MetadataPropertySyncFailed` | lazy sync 调后端 batchCreate 失败 | 200 |
| `MetadataPropertyConflict` | 后端已存在同名 backend_name 但类型不一致 — 方案 D 下不应发生(version 后缀隔离),保留作运维异常告警类型 | 200 |
| `INVALID_VALUE_TYPE` | create/batchCreate `valueType` 不在允许集合 | 200 |
| `INVALID_OPERATION_FOR_TYPE` | metadata/update operation 与 valueType 不兼容 | 200 |
| `INVALID_FIELD_VALUE_TYPE` | metadata/update `value` 类型不匹配 valueType | 200 |
| `INVALID_BATCH_DUPLICATE_NAME` | batchCreate 内部重名 | 200 |

## 4. 异步 worker 与故障恢复

三个独立后台 worker,各管一轨,互不耦合。所有 worker 用 `SELECT ... FOR UPDATE SKIP LOCKED`,多实例(多 Pod)安全运行,无需 leader 选举。Worker 与前台 API 同进程(单进程 FastAPI)。

### 4.1 Cleanup worker(状态轨 2 PURGING/PURGE_FAILED → PURGED → 主目录物理删)

触发:`metadataProperties/delete` 把 sync 行从 SYNCED 改为 PURGING。Worker 周期扫表,默认 30s。

主循环(伪代码):

```
loop:
  rows = SELECT property_id, kn_code FROM kgw_metadata_property_sync
         WHERE sync_status IN ('PURGING', 'PURGE_FAILED')
           AND (last_sync_at IS NULL OR last_sync_at < NOW() - INTERVAL '5 minutes')
         ORDER BY last_sync_at NULLS FIRST
         LIMIT 50
         FOR UPDATE SKIP LOCKED

  for (property_id, kn_code) in rows:
      backend_name = SELECT backend_name FROM kgw_metadata_property
                     WHERE property_id=?
      try:
          kb_config = config_provider.get(kn_code)
          response = await http.post(
              kb_config.endpoint + '/api/v1/metadataProperties/delete',
              json={'propertyName': backend_name})
          if response.resultCode == '0' OR response 表示后端不存在:
              UPDATE sync SET sync_status='PURGED', last_sync_at=NOW(),
                              last_error=NULL
                       WHERE property_id=? AND kn_code=?
          else:
              UPDATE sync SET sync_status='PURGE_FAILED', last_sync_at=NOW(),
                              last_error=response.resultMsg
                       WHERE property_id=? AND kn_code=?
      except (UpstreamTimeout, UpstreamConnectError, MinIOError, CircuitOpen) as e:
          UPDATE sync SET sync_status='PURGE_FAILED', last_sync_at=NOW(),
                          last_error=str(e)
                   WHERE property_id=? AND kn_code=?

  ready = SELECT property_id FROM kgw_metadata_property
          WHERE status='DELETED'
          AND NOT EXISTS (
              SELECT 1 FROM kgw_metadata_property_sync s
              WHERE s.property_id = kgw_metadata_property.property_id
              AND s.sync_status != 'PURGED'
          )
  for property_id in ready:
      DELETE FROM kgw_metadata_property WHERE property_id=?
```

幂等性:后端 `metadataProperties/delete` 多次调同名(已不存在)应返回 not found,worker 视为成功;若后端不幂等,worker 必须把 `resultCode=-1 && msg 匹配 not found 模式` 视为成功。Worker crash 后重启,`SKIP LOCKED` 保证另一实例继续。单行行级锁 + 状态字段决定下一步,无法并发改坏。

退避:`last_sync_at < NOW() - INTERVAL '5 minutes'` 实现简单 backoff,避免一直撞同一个挂掉的后端。运维强制 retry 通过 admin 端点直接 `UPDATE sync_status='PURGING' WHERE property_id=? AND sync_status='PURGE_FAILED'`,worker 下一轮立即处理。

### 4.2 Binding reconcile worker(状态轨 3 的 PENDING 孤儿 + outbox)

两类孤儿:

- **outbox 有行**:网关本地 DELETE 都失败,极少发生(意味着 PG 都写不动了)。
- **PENDING 时间过长**:网关进程崩溃 / KB 后端卡到超时 / 网络黑洞导致网关侧不知道后端究竟有没有写入。

周期 30s 一轮,两个独立扫描合并到同一 worker 进程。

**主循环 A:outbox**

```
rows = SELECT * FROM kgw_metadata_binding_outbox
       ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED

for row in rows:
    DELETE FROM kgw_metadata_property_binding
           WHERE property_id=? AND kn_code=? AND file_path=?
                 AND attempt_id=?
    if successful:
        DELETE FROM kgw_metadata_binding_outbox WHERE id=?
```

**主循环 B:PENDING 孤儿**

```
rows = SELECT property_id, kn_code, file_path, attempt_id FROM binding
       WHERE status='PENDING' AND bound_at < NOW() - INTERVAL '5 minutes'
       LIMIT 50 FOR UPDATE SKIP LOCKED

for row in rows:
    backend_name = SELECT backend_name FROM kgw_metadata_property
                   WHERE property_id=row.property_id
    kb_config = config_provider.get(row.kn_code)
    response = await http.post(
        kb_config.endpoint + '/api/v1/knowledgeItems/metadata/get',
        json={'knCode': row.kn_code, 'filePath': row.file_path,
              'metadataFieldList': [backend_name]})
    if response 成功 AND backend_name in response.metadata AND value 非空:
        UPDATE binding SET status='SYNCED' WHERE attempt_id=row.attempt_id
    else if response 成功 AND backend_name 不在 metadata:
        DELETE FROM binding WHERE attempt_id=row.attempt_id
    else:
        pass  # 后端不可达,下轮重试,bound_at 不变继续延后
```

5 分钟阈值:足够覆盖 30s 后端调用超时(v5 spec §4.5.5)+ 几次重试,过了 5 分钟仍 PENDING 基本判定为孤儿,可配置。前台 API 调后端是同步等响应,API 返回前 PENDING 一定已被推进到 SYNCED 或被本地删除;5 分钟仍 PENDING 意味着 API 早已返回失败/超时,属于真孤儿,reconcile 安全。

### 4.3 Lazy sync(前台 API 同步子流程,不是后台 worker)

调用点:§3.5 `metadata/update`、§3.9 `import`、§3.12 ingest `events` 在写 binding 之前。

伪代码:

```python
async def ensure_synced(property_id: int, kn_code: str):
    # 1. 快路径
    row = SELECT sync_status FROM kgw_metadata_property_sync
          WHERE property_id=? AND kn_code=?
    if row and row.sync_status == 'SYNCED':
        return

    # 2. 串行化:advisory lock(int 哈希 property_id ^ hash(kn_code))
    async with pg_advisory_xact_lock(hash(property_id, kn_code)):
        # 双检
        row = SELECT sync_status FROM kgw_metadata_property_sync
              WHERE property_id=? AND kn_code=?
        if row and row.sync_status == 'SYNCED':
            return

        # 3. UPSERT 到 SYNCING
        INSERT INTO kgw_metadata_property_sync(property_id, kn_code,
                                                sync_status='SYNCING')
        ON CONFLICT (property_id, kn_code) DO UPDATE
        SET sync_status='SYNCING', last_sync_at=NOW(), last_error=NULL

        # 4. 调后端 batchCreate
        backend_name, value_type = SELECT backend_name, value_type
                                   FROM kgw_metadata_property
                                   WHERE property_id=?
        kb_config = config_provider.get(kn_code)
        try:
            response = await http.post(
                kb_config.endpoint + '/api/v1/metadataProperties/batchCreate',
                json={'propertyList': [{
                    'propertyName': backend_name,
                    'valueType': value_type,
                }]})
            if response.resultCode == '0' OR 已存在同名同类型:
                UPDATE sync SET sync_status='SYNCED', last_sync_at=NOW()
                       WHERE property_id=? AND kn_code=?
            else:
                UPDATE sync SET sync_status='FAILED', last_error=...
                raise MetadataPropertyConflict(...)
        except UpstreamError as e:
            UPDATE sync SET sync_status='FAILED', last_error=str(e)
            raise MetadataPropertySyncFailed(...)
```

advisory lock 是事务级(`pg_advisory_xact_lock`),事务结束自动释放;同一 (property_id, knCode) 并发请求自然排队,后到的看到 SYNCED 直接返回。

实现注意:伪代码里 SYNCING UPSERT、调后端、UPDATE SYNCED/FAILED 看似都在 advisory lock 同一事务内,但**真实实现需要两段事务**(或 SAVEPOINT):事务 T1 持有 advisory lock + UPSERT SYNCING + 立即 commit(让其他 Pod 的等待者看见 SYNCING);事务 T2 调后端 → 根据结果 UPDATE SYNCED 或 FAILED + commit。否则若整段在一个事务里,batchCreate 抛异常会同时回滚 SYNCING UPSERT,FAILED 状态写不进去,无可观测性。

T1 commit 后 advisory lock 释放,T2 期间不再持锁;并发由 SYNCING 状态本身兜住:其他请求 ensure_synced 看到 SYNCING 时短暂等待(轮询 SYNCED/FAILED)或直接返回 SyncFailed 等下次重试,具体策略由 plan 阶段决定。

FAILED 恢复路径:下次 metadata/update 命中同一 (property_id, knCode) → ensure_synced 看到 FAILED → advisory lock → 重新 batchCreate;运维 admin retry 端点(§3.13)直接 UPDATE → 立即触发一次 ensure_synced。

为什么 lazy sync 不放后台 worker:lazy sync 必须发生在 binding 写入之前(否则后端没列,binding 写完后调 metadata/update 会失败);等 worker 异步推进会让用户请求阻塞或失败,体验更差;batchCreate 是低频(同一 (property, KB) 一辈子只调一次成功),代价可接受。

### 4.4 故障场景对照表

| 故障 | 影响 | 自愈机制 |
|---|---|---|
| 网关 Pod 在 metadata/update 中崩溃,binding PENDING 写完,后端调用未发出 | binding 多记若干 PENDING 行 | binding reconcile 5 分钟后探测后端,实际无值则删除 |
| 网关 Pod 在 metadata/update 中崩溃,后端调用已发出,响应未收到 | binding 多记 PENDING 或后端真已写入但 PENDING 未推进 | reconcile 探测,有值 → SYNCED;无值 → 删除 |
| 网关 Pod 在反向 DELETE binding 中崩溃 | binding 多记 PENDING | outbox 优先 + reconcile 兜底 |
| KB 后端 batchCreate 调用失败(lazy sync) | sync FAILED;前台 API 返回 MetadataPropertySyncFailed | 下次 metadata/update 自动 retry;运维可强制 retry |
| KB 后端 metadataProperties/delete 失败(cleanup) | sync PURGE_FAILED;主目录 DELETED 不能物理删 | cleanup worker 周期重试;运维可强制 retry |
| MinIO 不可达(cleanup 取 endpoint) | cleanup 这一轮跳过该 KB | 下一轮 worker 重试,不影响前台 |
| MinIO 不可达(lazy sync 取 endpoint) | 前台 API 返回 `MetadataPropertySyncFailed`;sync 行 SYNCING(若 T1 已 commit)被推到 FAILED 由 except 分支处理;若 T1 commit 前失败,sync 表无残留 | 调用方重试,下次 metadata/update 触发 retry |
| 主目录 ACTIVE 行被多事务并发创建同名 | 一个成功一个 conflict | partial unique index 强制,失败方收到 MetadataPropertyAlreadyExists |
| Cleanup 物理删主目录瞬间,迟到的 metadata/update 引用同 propertyName | 不可能 — 主目录 DELETED 期间应用看不到该 propertyName(list/update 都查 ACTIVE),metadata/update 在校验阶段就报 MetadataPropertyNotFound | — |
| 同名再造时,旧 backend_name 还在某 KB 没清完 | 不影响 — 新 property_id 派生新 backend_name(`__byclaw_kgw__status__v12` vs 旧 `__v7`),lazy sync 写新列,旧列归 cleanup worker 处理 | — |

### 4.5 监控指标(增量于 v5 spec §7.2)

```
kgw_metadata_property_total{status}
kgw_metadata_property_sync_total{result}
kgw_metadata_property_purge_total{result}
kgw_metadata_property_sync_failed_gauge
kgw_metadata_property_purge_failed_gauge
kgw_metadata_binding_pending_gauge
kgw_metadata_binding_outbox_gauge
kgw_metadata_binding_reconcile_total{action}
kgw_cleanup_worker_iteration_total
kgw_cleanup_worker_processed_total{result}
kgw_cleanup_worker_lag_seconds
```

## 5. 边界、迁移、与 v5 spec 差异

### 5.1 与 S1-S3 已实现模块的接口边界

| 现有模块 | 方案 D 改动 |
|---|---|
| `KbConfigProvider`(已实现) | 不改;lazy sync 与 cleanup worker 复用现有 `get(kn_code)` 接口 |
| `AuthProvider`(已实现) | 不改;lazy sync / cleanup 调后端、admin 端点均复用同一鉴权链路(Redis `user:{user_code}:login:auth`) |
| `dispatcher`(已实现) | metadata/update、metadata/get、search、metadataSearch、searchFile、metadataFields/list 全部叠一层"字段名映射 + lazy sync 触发"中间件;写路径(import / metadata/update)额外触发 binding 维护;读路径只做字段名映射 |
| `circuit_breaker`(已实现,per-endpoint) | 后端 metadataProperties/batchCreate / metadataProperties/delete 调用都受同一熔断器保护;cleanup worker 撞 OPEN 时 sync 行保持 PURGE_FAILED,worker 下一轮 backoff,不绕过熔断 |
| `audit_writer`(已实现) | metadata/update、metadataProperties/{create,batchCreate,delete} 全部写审计;list/get 不写;cleanup worker 后台调用写一类新审计 source='cleanup' |
| `kgw_audit_log`(已建表) | schema 不改;`source` 值集扩展为 `serve / ingest / cleanup / reconcile` |
| `kgw_kb_source_lock` / `kgw_kb_conflict_log` / `kgw_kb_write_history`(已建表) | 不改 |
| `envelope`(错误归一化) | 增量 9 个 error_type(§3.14) |

### 5.2 v5 spec 修订点(本设计偏离 v5 原文的地方)

1. **§4.6.3 删除语义**:原文"软删除 + 后端异步清理"改为"软删除(DELETED status)+ cleanup worker 异步推进 + 全部 PURGED 后物理删"。
2. **§4.6.4 冲突处理**:原文"后端已存在同名字段类型不一致 → 拒绝同步,记录 conflict"。方案 D 下 backend_name 带 property_id 后缀,冲突理论上不会发生;`MetadataPropertyConflict` 错误降为运维告警类(发生说明有人绕过网关写后端)。
3. **§4.6 全节"前缀"**:从 `__kgw__` 改为 `__byclaw_kgw__`,且追加 `__v{property_id}` 后缀。
4. **§5.1 表结构**:`kgw_metadata_property` 主键从 `property_name` 改为 `property_id BIGSERIAL`;`backend_name` 由派生公式生成而非自由命名;新增 partial unique index;新增 `kgw_metadata_property_binding`、`kgw_metadata_binding_outbox` 表。
5. **§4.6.2 懒同步触发时机**:lazy sync 仅作用于 (property_id, kn_code) 维度,且只在写路径(metadata/update、import、ingest events、ingest events/batch)触发;读路径(search/metadataSearch/searchFile/metadataFields/list/metadata/get)不再触发 lazy sync,仅做字段名映射。
6. **§3.7(metadataFields/list)**:从"按 knCode 路由调后端"改为"网关本地查 sync 表",因为只有 sync 表知道哪些 backend_name 是网关认识的活字段。
7. **§6.5.1 接口承接表**:`metadataFields/list` 从"`knCode` 路由"改为"网关本地"。`metadata/get` 路由方式不变(仍调后端,仅做字段名转换)。
8. **§6.7 控制面端点**:新增 4 个 admin 端点(§3.13)。

### 5.3 新增 SQL 迁移(承接 v5 spec §10 编号 SQL 约定)

```
sql/005_kgw_metadata_property.sql              -- 主目录表 + partial unique index
sql/006_kgw_metadata_property_binding.sql      -- 引用计数表 + outbox 表
sql/007_kgw_metadata_property_sync.sql         -- 同步状态表
```

DDL 见第 1 节。迁移按 v5 spec 启动期幂等执行器跑一次,与现有 `sql/000-004` 风格一致。S5 的 `sql/008_ingest_event.sql` 不受本设计影响。

### 5.4 冷启动 / 部署 / 回滚

冷启动:

- 启动时不做任何"问后端"的预同步(Greenfield 假设)。
- 启动时检查 `kgw_metadata_property_sync` 是否有遗留 `SYNCING`(发生在 lazy sync T1 已 commit、T2 调后端中途 Pod 崩溃,advisory lock 进程退出释放)。处理方式:启动时一次性 `UPDATE sync_status='FAILED', last_error='gateway restart' WHERE sync_status='SYNCING'`,等下次 metadata/update 触发 retry。
- 三个 worker 启动时不需要恢复任何状态:`SKIP LOCKED` 让它们自然抢占可处理的行。

部署顺序:

1. SQL 迁移先跑(005-007)。
2. 网关 Pod 滚动升级。新 Pod 立即支持新接口,旧 Pod 退出前不再接新流量。
3. Worker 与 API 在同一进程(单进程 FastAPI),不需要单独的 worker Deployment。

回滚:

- 主目录、sync、binding、outbox 都是 S4 新增表,旧版本网关不读不写。回滚网关镜像即可,新表数据保留。
- 风险:回滚期间应用不能调任何 metadataProperty 相关接口(旧版本未实现);metadata/update / search 等接口会回退到 v5 spec 原文行为(无 lazy sync,直接透传 propertyName),需要评估是否会撞上已物化的 `__byclaw_kgw__*` 列(理论不会,因为旧版本不知该前缀,会用 propertyName 直发后端,后端同名字段视为另一字段)。
- 实际运维路径:S4 上线前 staging 验证,回滚视为兜底,不作为常规预案。

### 5.5 测试覆盖矩阵(对应 v5 spec §13 + 切片设计 S4 / S5 验收)

| 类别 | 关键场景 |
|---|---|
| 单元 | partial unique index 同名再造;backend_name 派生;binding 状态转移;DSL 字段名改写;响应字段名反向改写 |
| 集成(testcontainers + respx) | metadataProperties create → list → delete 完整流程;create → metadata/update 触发 lazy sync;create → metadata/update → delete 拒绝(in_use)→ unset → delete 通过;同名再造(create → delete → create new valueType);多 KB 并行 search 字段名一致改写 |
| Worker 集成 | cleanup worker:PURGING → PURGED → 物理删;PURGE_FAILED retry;cleanup 与前台 API 并发不互相阻塞;binding reconcile outbox 路径与 PENDING 孤儿路径 |
| 故障注入 | metadata/update 在 PG 写 binding 与调后端之间崩溃;binding reconcile 5 分钟后探测后端;后端 batchCreate 失败 → FAILED → next call retry → SYNCED;后端 metadataProperties/delete 失败 → PURGE_FAILED → admin retry → PURGED |
| ingest(S5) | events upsert 携带 metadata 走 lazy sync + binding;事件失败进 DLQ;events/batch 单事件失败不影响其他事件;op=delete 删 binding;ingest 路径与 serve 路径状态机一致 |
| 性能 | delete API p99 < 50ms(本地查询,无远程 IO,验证设计目标);lazy sync 首次触发 p95 受 KB 后端响应时间主导,符合预期 |

### 5.6 不在本设计范围

- 死列盲扫清理脚本:S4 仅提供 GET `/orphans` 列表端点,不实现 DELETE;运维确认后手动删除或后续片实现。
- 历史数据迁移:Greenfield 假设,不迁。
- 跨 propertyName 重命名 / merge:不支持。
- `metadataProperties/update` 接口:不实现;调用方自行组合 delete + create。
- 业务 DSL 接口:metadata_api.md 已标记为废弃候选,本设计同步不承接。
- Worker leader 选举:不需要,`SELECT ... FOR UPDATE SKIP LOCKED` 多实例安全。

### 5.7 对应原始问题的最终回答

| 原始问题 | 方案 D 的解 |
|---|---|
| 1. property_name 主键 + 软删除导致同名修改必失败 | 主键改为 `property_id BIGSERIAL`;`property_name` 用 partial unique index 仅在 ACTIVE 范围内唯一;DELETED 行不参与名字唯一性。同名再造写新 property_id,新旧 backend_name 在 schema 层永不撞名。 |
| 2. delete 时如何检验"被使用" | 网关本地维护 `kgw_metadata_property_binding` 引用关系表;delete 时 `SELECT 1 FROM binding WHERE property_id=? LIMIT 1` 即可判定,O(1)、无远程 IO、与 MinIO 解耦。"先 binding 后端"语义保证 binding 上限不漏。 |
| 3. 多业务 KB 后端 create/delete 个别成功个别失败 | create 沿用 lazy sync(只在该 (property, knCode) 实际被使用时才落地;新加 KB 自动覆盖,无 onboarding 流程)。delete 不在前台扇出后端,只翻状态轨;后端 `__byclaw_kgw__name__v{id}` 列由 cleanup worker 异步清理,失败进 PURGE_FAILED 重试直到 PURGED;worker 撞熔断 / MinIO 不可达自然 backoff。同名再造无需等待 cleanup 完成,因为新 backend_name 永远不与旧的撞名。 |

