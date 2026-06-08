# 知识网关 S5 ingest + admin 设计

> 状态：草案
> 日期：2026-06-07
> 关联：[`2026-06-03-knowledge-gateway-implementation-slicing.md`](./2026-06-03-knowledge-gateway-implementation-slicing.md)、[`2026-06-02-knowledge-gateway-ingest-api.md`](./2026-06-02-knowledge-gateway-ingest-api.md)、[`2026-06-06-knowledge-gateway-metadata-property-design.md`](./2026-06-06-knowledge-gateway-metadata-property-design.md)

## 0. 背景与范围

S4 已落地 metadataProperty 治理（property_id 主键、backend_name 版本化、lazy sync、binding 三状态、cleanup/reconcile workers）。本设计（S5）在此基础上实现：

- ingest pipeline：5 个 `/kgw/ingest/v1/*` 端点
- StandardItem schema（pydantic v2）
- 幂等 + DLQ
- admin 端点补全：audit/conflicts/lock/unlock

**S4 实际落地与原 slicing 设计的关键偏差（S5 必须对接）**：

- `ensure_synced(state, *, property_id, kn_code, user_code)` — S4 已实现，S5 直接复用
- `metadata/binding.py` — `upsert_pending`、`mark_synced_by_attempt`、`delete_by_attempt`、`write_outbox` 全部可复用
- `_rollback_binding(pool, *, attempt_id, pending_keys)` — 在 `api/knowledge_items.py` 中，S5 提取到 `event_processor.py` 同款逻辑
- `admin_metadata.py` 已有 metadata property 相关 4 个 admin 端点；S5 新增 audit/conflicts/lock/unlock，**放在独立的 `api/admin.py` 文件，不动 admin_metadata.py**
- workers（cleanup + reconcile）已在 main.py 中启动，S5 不新增 worker

## 1. 文件布局

**新增**：

```
src/kgw/schemas/standard_item.py    — pydantic v2 StandardItem + 校验器
src/kgw/event_processor.py          — 单事件处理流水线（upsert/delete）
src/kgw/idempotency.py              — ingest_event 表 CRUD：INSERT/查/UPDATE
src/kgw/api/events.py               — 5 个 ingest 端点（prefix /kgw/ingest/v1）
src/kgw/api/admin.py                — 4 个 admin 端点（audit/conflicts/lock/unlock）
sql/008_ingest_event.sql            — kgw_ingest_event 表
```

**修改**：

```
src/kgw/main.py                     — 注册 events/admin 路由；添加 ingest_semaphore
src/kgw/envelope.py                 — 新增 ingest 错误类型
src/kgw/observability/metrics.py    — 新增 ingest 指标
```

**不改动**：`metadata/`、`workers/`、`dispatcher.py`、`stream_proxy.py`、`admin_metadata.py`

## 2. 数据模型

### 2.1 `kgw_ingest_event`（`sql/008_ingest_event.sql`）

```sql
CREATE TABLE IF NOT EXISTS kgw_ingest_event (
  event_id           BIGSERIAL     PRIMARY KEY,
  source_id          VARCHAR(128)  NOT NULL,
  item_id            VARCHAR(256)  NOT NULL,
  version            VARCHAR(128),
  op                 VARCHAR(16)   NOT NULL,
  kn_code            VARCHAR(64)   NOT NULL,
  file_path          VARCHAR(512)  NOT NULL,
  status             VARCHAR(16)   NOT NULL DEFAULT 'received',
  error_type         VARCHAR(64),
  error_message      TEXT,
  retry_count        INT           NOT NULL DEFAULT 0,
  payload_size_bytes INT,
  received_at        TIMESTAMPTZ   DEFAULT NOW(),
  done_at            TIMESTAMPTZ,
  CONSTRAINT uq_ingest_idempotency UNIQUE (source_id, item_id, version)
);
CREATE INDEX IF NOT EXISTS idx_ingest_event_status
  ON kgw_ingest_event (status) WHERE status != 'done';
CREATE INDEX IF NOT EXISTS idx_ingest_event_query
  ON kgw_ingest_event (kn_code, received_at DESC);
```

**关键设计决策**：

- `UNIQUE (source_id, item_id, version)` 提供幂等：PG 对 NULL 不比较，`version=NULL` 时不做幂等（预期行为）
- `status` 取值：`received` / `done` / `failed`
- replay 通过 UPDATE `status='received'`, `retry_count+1`, 清空 `error_*` 重新入流水线

### 2.2 现有表复用

- `kgw_audit_log`（S1）：ingest 写审计，`source='ingest'`, `actor_kind='connector'`
- `kgw_kb_source_lock`（S1）：source_lock 检查与 lock/unlock admin 端点
- `kgw_kb_conflict_log`（S1）：STALE_VERSION / SOURCE_LOCKED 冲突记录

## 3. StandardItem schema

**`src/kgw/schemas/standard_item.py`**：

```python
from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator

class InlineBase64Content(BaseModel):
    encoding: Literal["base64"]
    data: str

class RemoteUrlContent(BaseModel):
    url: str
    checksum: str | None = None

class StandardItem(BaseModel):
    source_id: str = Field(alias="sourceId", min_length=1, max_length=128)
    item_id: str = Field(alias="itemId", min_length=1, max_length=256)
    version: str | None = Field(default=None, alias="version", max_length=128)
    op: Literal["upsert", "delete"]
    kn_code: str = Field(alias="knCode", min_length=1, max_length=64)
    file_path: str = Field(alias="filePath", min_length=1, max_length=512)
    title: str | None = None
    content: str | InlineBase64Content | RemoteUrlContent | None = None
    content_type: str | None = Field(default=None, alias="contentType")
    metadata: dict[str, Any] | None = None
    source_timestamp: str | None = Field(default=None, alias="sourceTimestamp")
    extra: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def _validate_upsert_fields(self) -> "StandardItem":
        if self.op == "upsert":
            if self.content is None:
                raise ValueError("content is required for op='upsert'")
            if not self.file_path:
                raise ValueError("filePath is required for op='upsert'")
        return self
```

`content` 三种格式对应：内联文本（str）、内联 base64（`InlineBase64Content`）、远程引用（`RemoteUrlContent`）。remote URL 由 event_processor 下载，最大 50MB。

payload 大小限制（4MB）在端点层校验 `request.headers.get("content-length")`，schema 层不做。

## 4. 幂等模块

**`src/kgw/idempotency.py`** — 只操作 `kgw_ingest_event` 表，不含业务逻辑：

```python
@dataclass
class IngestEventRow:
    event_id: int
    status: str
    error_type: str | None
    error_message: str | None
    retry_count: int

async def insert_received(pool, item: StandardItem, *, payload_size_bytes: int) -> int:
    """INSERT status='received'. Returns event_id. Raises DuplicateEvent on UNIQUE conflict."""

async def get_by_id(pool, event_id: int) -> IngestEventRow | None: ...

async def get_by_idempotency_key(pool, *, source_id, item_id, version) -> IngestEventRow | None:
    """Called when INSERT raises DuplicateEvent to read existing row."""

async def mark_done(pool, event_id: int) -> None: ...

async def mark_failed(pool, event_id: int, *, error_type: str, error_message: str) -> None: ...

async def reset_for_replay(pool, event_id: int) -> None:
    """UPDATE status='received', retry_count+1, error_type=NULL, error_message=NULL."""

async def list_events(pool, *, source_id, item_id, kn_code, status,
                      from_time, to_time, page, page_size) -> tuple[list[IngestEventRow], int]: ...
```

`DuplicateEvent` 是本模块内部异常，`event_processor.py` 捕获后走幂等分支。

**OpenGauss 兼容**：INSERT 用 `try/except` 捕获 `psycopg.errors.UniqueViolation` 而非 `ON CONFLICT`（与其他模块一致）。

## 5. 单事件处理流水线

**`src/kgw/event_processor.py`** — `process_event(state, item, *, user_code) -> EventResult`

```python
@dataclass
class EventResult:
    event_id: int
    status: str                        # done / failed / already_processed / in_progress
    error_type: str | None = None
    error_message: str | None = None
    retry_count: int = 0
```

**流水线步骤**（步骤 1-3 失败时抛异常→422，不落库；步骤 4-7 失败时写 DB + 返回 EventResult，不抛）：

### 步骤 1：knCode 校验

```python
config = await state.config_provider.get_kb_config(item.kn_code)
if config is None:
    raise KBNotFound(...)  # → 422
```

### 步骤 2：metadata key 校验（仅 upsert）

```python
if item.metadata:
    active_names = await registry.list_active_properties(pool, list(item.metadata.keys()))
    found = {p.property_name for p in active_names}
    missing = [k for k in item.metadata if k not in found]
    if missing:
        raise MetadataPropertyNotRegistered(missing[0])  # → 422
```

### 步骤 3：INSERT received（幂等入口）

```python
try:
    event_id = await idempotency.insert_received(pool, item, payload_size_bytes=size)
except DuplicateEvent:
    existing = await idempotency.get_by_idempotency_key(pool, ...)
    if existing.status == 'done':
        return EventResult(event_id=existing.event_id, status='already_processed', ...)
    elif existing.status == 'received':
        return EventResult(event_id=existing.event_id, status='in_progress')
    else:  # failed
        return EventResult(event_id=existing.event_id, status='failed',
                           error_type=existing.error_type, ...)
```

### 步骤 4：source_lock 检查

```python
lock_row = await _get_source_lock(pool, kn_code=item.kn_code, file_path=item.file_path)
if lock_row and not _is_expired(lock_row) and lock_row.lock_owner != user_code:
    await _write_conflict_log(pool, reason='SOURCE_LOCKED', ...)
    await idempotency.mark_failed(pool, event_id, error_type='SOURCE_LOCKED', ...)
    return EventResult(event_id=event_id, status='failed', error_type='SOURCE_LOCKED', ...)
```

### 步骤 5：version 单调性

```python
if item.version is not None:
    last_done = await _get_latest_done_version(pool,
        kn_code=item.kn_code, file_path=item.file_path)
    if last_done and item.version <= last_done:
        await _write_conflict_log(pool, reason='STALE_VERSION', ...)
        await idempotency.mark_failed(pool, event_id, error_type='STALE_VERSION', ...)
        return EventResult(...)
```

### 步骤 6-7：KB 写入（asyncio.wait_for timeout=30s）

整个后端写入套在 `asyncio.wait_for(..., 30)` 内：

```python
try:
    async with asyncio.timeout(30):
        if item.op == 'upsert':
            await _process_upsert(state, item, event_id, config, user_code)
        else:
            await _process_delete(state, item, event_id, config, user_code)
except asyncio.TimeoutError:
    await idempotency.mark_failed(pool, event_id, error_type='PROCESSING_TIMEOUT', ...)
    return EventResult(status='failed', error_type='PROCESSING_TIMEOUT', ...)
```

**`_process_upsert`**：

1. 获取文件内容（内联文本/base64解码/远程下载）
2. 调后端 `fileImport`（multipart）← 复用 `resolve_base_url` + httpx
   - 失败 → `mark_failed(UPSTREAM_ERROR)` + rollback（bindings 此时未写，无需 rollback）
3. fileImport 成功后，若 `item.metadata` 非空：
   - lazy sync（`ensure_synced` × property_ids）
   - `upsert_pending` bindings（attempt_id）
   - 调后端 `metadata/update`（`call_backend_json`）
   - 成功 → `mark_synced_by_attempt`
   - 失败 → `_rollback_binding`；`mark_failed(UPSTREAM_ERROR)`
4. 全部成功 → `mark_done`

**`_process_delete`**：

1. 调后端 `fileDelete`
2. 成功 → `delete_by_file(bindings)` → `mark_done`
3. 失败 → `mark_failed(UPSTREAM_ERROR)`

两路都写 `kgw_audit_log`（`source='ingest'`，`actor_kind='connector'`）。

## 6. API 端点

### 6.1 `src/kgw/api/events.py`（prefix `/kgw/ingest/v1`）

```python
@router.post("/events")
async def ingest_event(request: Request, x_user_id: Header, body: dict) -> dict:
    # payload size check（Content-Length）
    size = int(request.headers.get("content-length", 0))
    if size > 4 * 1024 * 1024:
        raise PayloadTooLarge(...)

    # parse StandardItem (pydantic validation → 422 on failure)
    item = StandardItem.model_validate(body)

    # concurrency semaphore
    if not state.ingest_semaphore._value:  # fast check
        return Response(status_code=503, headers={"Retry-After": "5"}, ...)

    async with state.ingest_semaphore:
        result = await process_event(state, item, user_code=x_user_id)

    return _result_to_envelope(result)
```

```python
@router.post("/events/batch")
async def ingest_events_batch(request: Request, x_user_id: Header, body: dict) -> dict:
    events_raw = body.get("events") or []
    if len(events_raw) > 100:
        raise 422 ...

    results = []
    for raw in events_raw:
        try:
            item = StandardItem.model_validate(raw)
        except ValidationError as e:
            results.append({"itemId": raw.get("itemId"), "status": "validation_failed", ...})
            continue

        async with state.ingest_semaphore:
            r = await process_event(state, item, user_code=x_user_id)
        results.append(_result_to_dict(item, r))

    succeeded = sum(1 for r in results if r["status"] == "done")
    failed = len(results) - succeeded
    return {
        "resultCode": "0" if failed == 0 else "-1",
        "resultMsg": "success" if failed == 0 else "partial success",
        "resultObject": {"total": len(results), "succeeded": succeeded,
                         "failed": failed, "results": results}
    }
```

```python
@router.get("/events/{event_id}")
async def get_event(event_id: int, ...) -> dict: ...

@router.get("/events")
async def list_events(sourceId: str | None = None, itemId: str | None = None,
                      knCode: str | None = None, status: str | None = None,
                      fromTime: str | None = None, toTime: str | None = None,
                      pageSize: int = Query(20, le=100), page: int = Query(1, ge=1),
                      ...) -> dict: ...

@router.post("/events/{event_id}/replay")
async def replay_event(event_id: int, ...) -> dict:
    row = await idempotency.get_by_id(pool, event_id)
    if row is None → -1
    if row.status != 'failed' → -1
    await idempotency.reset_for_replay(pool, event_id)
    item = StandardItem(...)  # reconstruct from DB row
    async with state.ingest_semaphore:
        result = await process_event(state, item, user_code=x_user_id)
    return _result_to_envelope(result)
```

**设计限制**：`kgw_ingest_event` 表只存 `source_id/item_id/version/op/kn_code/file_path`，不存 `content`（content 可达 4MB，大量事件会爆磁盘）。因此：

- **`op=delete` replay：可以**，delete 不需要 content，直接从 DB 行重构 StandardItem 重走流水线。
- **`op=upsert` replay：不支持**，replay 端点检查到 `op='upsert'` 直接返回 `-1`，提示 Connector 重新推送完整事件。

这一限制在 replay 端点响应中明确说明（`resultMsg: "upsert events must be re-submitted by the connector"`）。

### 6.2 `src/kgw/api/admin.py`（prefix `/kgw/admin/v1`）

```python
@router.get("/audit")
async def query_audit(source: str | None = None, knCode: str | None = None,
                      operationType: str | None = None, actorUserId: str | None = None,
                      fromTime: str | None = None, toTime: str | None = None,
                      pageSize: int = Query(20, le=100), page: int = Query(1, ge=1)) -> dict:
    # SELECT FROM kgw_audit_log WHERE ... LIMIT ... OFFSET ...

@router.get("/conflicts")
async def query_conflicts(knCode: str | None = None, reason: str | None = None,
                          fromTime: str | None = None, toTime: str | None = None,
                          pageSize: int = Query(20, le=100), page: int = Query(1, ge=1)) -> dict:
    # SELECT FROM kgw_kb_conflict_log WHERE ...

@router.post("/kbs/{kn_code}/files/{file_path:path}/lock")
async def lock_file(kn_code: str, file_path: str, body: dict) -> dict:
    # UPSERT kgw_kb_source_lock; 已有有效锁 → -1

@router.post("/kbs/{kn_code}/files/{file_path:path}/unlock")
async def unlock_file(kn_code: str, file_path: str) -> dict:
    # DELETE kgw_kb_source_lock; 不存在 → -1
```

`file_path` 在 URL 中以 `%2F` 编码（客户端负责编码，FastAPI 的 `{path:path}` 自动解码）。

### 6.3 `main.py` 修改

```python
# lifespan 中新增：
app.state.ingest_semaphore = asyncio.Semaphore(settings.ingest_concurrency_limit)
# settings 新增: ingest_concurrency_limit: int = 100

# build_app 中新增：
from kgw.api.events import router as events_router
from kgw.api.admin import router as admin_router
app.include_router(events_router)
app.include_router(admin_router)
```

## 7. 错误归一化增量

**`envelope.py`** 新增（ingest 422 路径抛、不进 `ingest_event`）：

```python
class MetadataPropertyNotRegistered(KgwError):
    error_type = "METADATA_PROPERTY_NOT_REGISTERED"
    # → 422

class PayloadTooLarge(KgwError):
    error_type = "PAYLOAD_TOO_LARGE"
    # → 413

class EventNotFound(KgwError):
    error_type = "EVENT_NOT_FOUND"
    # → 200 -1
```

`STALE_VERSION` / `SOURCE_LOCKED` / `PROCESSING_TIMEOUT` / `UPSTREAM_ERROR` 不作为 KgwError 抛出，直接写进 `ingest_event.error_type` 字段，通过 EventResult 传递给调用方。

## 8. 指标

**`metrics.py`** 新增：

```python
kgw_ingest_events_total: Counter = Counter(
    "kgw_ingest_events_total",
    "Ingest events processed",
    ["op", "result"],
    # op: upsert / delete
    # result: done / failed / already_processed / in_progress / stale_version /
    #         source_locked / payload_too_large / upstream_error / processing_timeout
    registry=REGISTRY,
)

kgw_ingest_semaphore_rejected_total: Counter = Counter(
    "kgw_ingest_semaphore_rejected_total",
    "Ingest requests rejected due to concurrency limit (503)",
    registry=REGISTRY,
)
```

## 9. 与 S4 的接口边界

| S4 模块 | S5 使用方式 |
|---|---|
| `metadata.sync.ensure_synced(state, *, property_id, kn_code, user_code)` | event_processor._process_upsert 直接调用，无改动 |
| `metadata.binding.upsert_pending(conn, ...)` | event_processor._process_upsert 调用 |
| `metadata.binding.mark_synced_by_attempt / delete_by_attempt / write_outbox` | 同上 |
| `metadata.binding.delete_by_file(pool, ...)` | event_processor._process_delete 调用 |
| `metadata.registry.list_active_properties` | event_processor 步骤 2 校验 |
| `upstream.resolve_base_url(config)` | event_processor 构造 fileImport URL |
| `upstream.call_backend_json(...)` | event_processor 调 metadata/update |
| `audit.AuditWriter` / `AuditEntry` | event_processor 写审计 |
| `resilience.circuit_breaker` | event_processor 通过 `state.circuit_breakers.get(...)` 使用 |

## 10. 测试矩阵

| 类别 | 关键场景 |
|---|---|
| StandardItem 单元 | op=upsert 缺 content → ValidationError；op=delete 可无 content；base64 解码；remote URL 格式校验 |
| 幂等单元 | 重复 (sourceId,itemId,version) → DuplicateEvent；version=NULL 不去重 |
| 流水线集成（respx + testcontainers） | upsert happy path：fileImport 成功 + metadata 同步 + binding SYNCED；delete happy path；fileImport 失败 → status=failed；metadata/update 失败 → rollback binding + status=failed；STALE_VERSION；SOURCE_LOCKED；timeout(30s) |
| 幂等集成 | 重复推送 done 事件返回 already-processed；重复推送 received 事件返回 in_progress |
| batch 集成 | 部分成功部分失败；全成功 resultCode=0；有失败 resultCode=-1 |
| replay 集成 | op=delete replay 成功；inline content replay → -1（不支持）；非 failed 状态 → -1 |
| admin 集成 | audit 查询分页；conflicts 查询；lock 重复 → -1；unlock 不存在 → -1 |
| 并发 | semaphore 满时返回 503 + Retry-After |
| 指标 | kgw_ingest_events_total{op=upsert,result=done} +1；semaphore rejected +1 |

## 11. 验收条件

- [ ] StandardItem schema 校验器单元测试全通过（至少覆盖：upsert缺content、delete不检查content、base64格式、remote url格式）
- [ ] 推送 100 条 upsert 事件全部 done；重复推送同 (sourceId,itemId,version) 返回 already-processed
- [ ] 推送 1 条带 metadata 的 upsert：lazy sync + binding + audit log 全部正确落库
- [ ] KB 后端 fileImport 不可用时事件 status=failed 进 DLQ；`/replay` 对 op=delete 可恢复
- [ ] STALE_VERSION 事件进入 kgw_kb_conflict_log；GET /conflicts 可查
- [ ] source_lock 阻断写入，GET /audit 中可见 SOURCE_LOCKED 条目
- [ ] batch：部分失败时 resultCode="-1"，部分成功时 done 条目已落库
- [ ] 并发超过 100 时返回 503 + `Retry-After: 5`
- [ ] `GET /audit` 分页正确；`GET /kgw/ingest/v1/events` 按 status 过滤正确
- [ ] lock/unlock admin 端点正常工作

## 12. 不在范围

- Connector 真实接入（gbrain-connector）
- 消息队列（触发条件见 v5 spec §8.2）
- OpenAPI 规范文件 `spec/kgw.openapi.yaml`（后续补全）
- replay 对内联内容 event 的完整支持（需 Connector 重推）
- admin 端点的鉴权（MVP 阶段无 ACL）
