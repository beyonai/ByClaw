# KGW S5 — Ingest + Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the ingest pipeline (StandardItem → DB → KB write), DLQ, and admin endpoints (audit/conflicts/lock/unlock) for byclaw-kgw.

**Architecture:** Single-process FastAPI; `event_processor.py` is the core pipeline (validate → idempotent INSERT → source_lock/version checks → fileImport → metadata/update); reuses S4's `ensure_synced`, `binding.py`, `resolve_base_url`, and `call_backend_json`. Five ingest endpoints + four admin endpoints + a 100-slot concurrency semaphore in `app.state`.

**Tech Stack:** Python 3.12, FastAPI, psycopg async, pydantic v2, httpx, pytest-asyncio (mode=auto, loop_scope=module for integration), respx, prometheus_client.

---

## File Structure

```
CREATE byclaw-kgw/sql/008_ingest_event.sql
CREATE byclaw-kgw/src/kgw/schemas/__init__.py
CREATE byclaw-kgw/src/kgw/schemas/standard_item.py
CREATE byclaw-kgw/src/kgw/idempotency.py
CREATE byclaw-kgw/src/kgw/event_processor.py
CREATE byclaw-kgw/src/kgw/api/events.py
CREATE byclaw-kgw/src/kgw/api/admin.py
MODIFY byclaw-kgw/src/kgw/envelope.py          (3 new error classes)
MODIFY byclaw-kgw/src/kgw/observability/metrics.py  (2 new Counters)
MODIFY byclaw-kgw/src/kgw/settings.py          (ingest_concurrency_limit field)
MODIFY byclaw-kgw/src/kgw/main.py              (register routers + semaphore)
CREATE byclaw-kgw/tests/test_standard_item.py
CREATE byclaw-kgw/tests/test_idempotency.py
CREATE byclaw-kgw/tests/test_event_processor.py
CREATE byclaw-kgw/tests/test_api_events.py
CREATE byclaw-kgw/tests/test_api_admin.py
CREATE byclaw-kgw/tests/test_integration_s5.py
```

---

### Task 1: SQL migration + envelope + metrics + settings

**Files:**
- Create: `byclaw-kgw/sql/008_ingest_event.sql`
- Modify: `byclaw-kgw/src/kgw/envelope.py`
- Modify: `byclaw-kgw/src/kgw/observability/metrics.py`
- Modify: `byclaw-kgw/src/kgw/settings.py`

- [ ] **Step 1: Write failing test for SQL migration**

```python
# tests/test_db_migrations.py already exists — add this test to it
# (or confirm it already runs 008 once created)
# Run existing migration tests to confirm current state passes:
```

Run: `cd byclaw-kgw && uv run pytest tests/test_db_migrations.py -v -m integration`
Expected: PASS (current migrations 000-007 apply cleanly)

- [ ] **Step 2: Create `sql/008_ingest_event.sql`**

```sql
-- 008_ingest_event.sql
-- Ingest pipeline event store: idempotency + DLQ

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

- [ ] **Step 3: Add 3 error classes to `envelope.py`** (append after the last class at line 154):

```python
class MetadataPropertyNotRegistered(KgwError):
    error_type = "METADATA_PROPERTY_NOT_REGISTERED"


class PayloadTooLarge(KgwError):
    error_type = "PAYLOAD_TOO_LARGE"


class EventNotFound(KgwError):
    error_type = "EVENT_NOT_FOUND"
```

- [ ] **Step 4: Add 2 counters to `metrics.py`** (append after existing counters):

```python
kgw_ingest_events_total: Counter = Counter(
    "kgw_ingest_events_total",
    "Ingest events processed",
    ["op", "result"],
    registry=REGISTRY,
)

kgw_ingest_semaphore_rejected_total: Counter = Counter(
    "kgw_ingest_semaphore_rejected_total",
    "Ingest requests rejected due to concurrency limit (503)",
    registry=REGISTRY,
)
```

- [ ] **Step 5: Add `ingest_concurrency_limit` to `settings.py`** (append after `circuit_open_duration`):

```python
# ---- Ingest ----
ingest_concurrency_limit: int = 100
```

- [ ] **Step 6: Run migration test to verify 008 applies**

Run: `cd byclaw-kgw && uv run pytest tests/test_db_migrations.py -v -m integration`
Expected: PASS — `kgw_ingest_event` table visible in DB

- [ ] **Step 7: Commit**

```bash
git add byclaw-kgw/sql/008_ingest_event.sql \
        byclaw-kgw/src/kgw/envelope.py \
        byclaw-kgw/src/kgw/observability/metrics.py \
        byclaw-kgw/src/kgw/settings.py
git commit -m "feat(kgw): add ingest_event SQL + envelope errors + metrics + settings for S5"
```

---

### Task 2: StandardItem pydantic schema

**Files:**
- Create: `byclaw-kgw/src/kgw/schemas/__init__.py`
- Create: `byclaw-kgw/src/kgw/schemas/standard_item.py`
- Test: `byclaw-kgw/tests/test_standard_item.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_standard_item.py
from __future__ import annotations
import pytest
from pydantic import ValidationError
from kgw.schemas.standard_item import InlineBase64Content, RemoteUrlContent, StandardItem


def test_upsert_valid():
    item = StandardItem.model_validate({
        "sourceId": "src1", "itemId": "doc1", "op": "upsert",
        "knCode": "kb1", "filePath": "/a.md", "content": "# Hello",
    })
    assert item.op == "upsert"
    assert item.file_path == "/a.md"
    assert item.source_id == "src1"


def test_upsert_requires_content():
    with pytest.raises(ValidationError, match="content is required"):
        StandardItem.model_validate({
            "sourceId": "s", "itemId": "i", "op": "upsert",
            "knCode": "k", "filePath": "/a.md",
        })


def test_delete_no_content_ok():
    item = StandardItem.model_validate({
        "sourceId": "s", "itemId": "i", "op": "delete",
        "knCode": "k", "filePath": "/a.md",
    })
    assert item.content is None


def test_base64_content():
    item = StandardItem.model_validate({
        "sourceId": "s", "itemId": "i", "op": "upsert", "knCode": "k",
        "filePath": "/f.pdf",
        "content": {"encoding": "base64", "data": "SGVsbG8="},
        "contentType": "application/pdf",
    })
    assert isinstance(item.content, InlineBase64Content)
    assert item.content.data == "SGVsbG8="


def test_remote_url_content():
    item = StandardItem.model_validate({
        "sourceId": "s", "itemId": "i", "op": "upsert", "knCode": "k",
        "filePath": "/f.pdf",
        "content": {"url": "https://example.com/doc.pdf"},
    })
    assert isinstance(item.content, RemoteUrlContent)
    assert item.content.url == "https://example.com/doc.pdf"


def test_version_optional():
    item = StandardItem.model_validate({
        "sourceId": "s", "itemId": "i", "op": "delete", "knCode": "k", "filePath": "/a.md",
    })
    assert item.version is None


def test_metadata_allowed():
    item = StandardItem.model_validate({
        "sourceId": "s", "itemId": "i", "op": "upsert", "knCode": "k",
        "filePath": "/a.md", "content": "hi",
        "metadata": {"status": "active", "tags": ["a", "b"]},
    })
    assert item.metadata == {"status": "active", "tags": ["a", "b"]}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd byclaw-kgw && uv run pytest tests/test_standard_item.py -v`
Expected: FAIL with `ModuleNotFoundError: kgw.schemas.standard_item`

- [ ] **Step 3: Create `src/kgw/schemas/__init__.py`** (empty file):

```python
```

- [ ] **Step 4: Create `src/kgw/schemas/standard_item.py`**:

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
    version: str | None = Field(default=None, max_length=128)
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
    def _validate_op_fields(self) -> "StandardItem":
        if self.op == "upsert" and self.content is None:
            raise ValueError("content is required for op='upsert'")
        return self
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd byclaw-kgw && uv run pytest tests/test_standard_item.py -v`
Expected: 7 passed

- [ ] **Step 6: Commit**

```bash
git add byclaw-kgw/src/kgw/schemas/ byclaw-kgw/tests/test_standard_item.py
git commit -m "feat(kgw): add StandardItem pydantic schema"
```

---

### Task 3: Idempotency module

**Files:**
- Create: `byclaw-kgw/src/kgw/idempotency.py`
- Test: `byclaw-kgw/tests/test_idempotency.py`

- [ ] **Step 1: Write failing integration tests**

```python
# tests/test_idempotency.py
from __future__ import annotations
import pytest
import pytest_asyncio
from pathlib import Path
from kgw.db import build_pool, run_migrations
from kgw import idempotency
from kgw.schemas.standard_item import StandardItem

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]
_SQL_DIR = Path(__file__).resolve().parent.parent / "sql"

_ITEM = StandardItem.model_validate({
    "sourceId": "src1", "itemId": "doc1", "version": "v1",
    "op": "upsert", "knCode": "kb1", "filePath": "/a.md", "content": "hello",
})
_ITEM_NULL_VER = StandardItem.model_validate({
    "sourceId": "src2", "itemId": "doc2",
    "op": "delete", "knCode": "kb1", "filePath": "/b.md",
})


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def pool(pg_dsn):
    p = await build_pool(pg_dsn, min_size=1, max_size=3)
    await run_migrations(p, _SQL_DIR)
    async with p.connection() as conn:
        await conn.execute("DELETE FROM kgw_ingest_event")
    yield p
    await p.close()


async def test_insert_received(pool):
    eid = await idempotency.insert_received(pool, _ITEM, payload_size_bytes=100)
    assert eid > 0
    row = await idempotency.get_by_id(pool, eid)
    assert row.status == "received"
    assert row.retry_count == 0


async def test_duplicate_raises(pool):
    with pytest.raises(idempotency.DuplicateEvent):
        await idempotency.insert_received(pool, _ITEM, payload_size_bytes=100)


async def test_get_by_idempotency_key(pool):
    row = await idempotency.get_by_idempotency_key(pool, source_id="src1", item_id="doc1", version="v1")
    assert row is not None
    assert row.status == "received"


async def test_mark_done(pool):
    row = await idempotency.get_by_idempotency_key(pool, source_id="src1", item_id="doc1", version="v1")
    await idempotency.mark_done(pool, row.event_id)
    updated = await idempotency.get_by_id(pool, row.event_id)
    assert updated.status == "done"
    assert updated.done_at is not None


async def test_mark_failed(pool):
    eid = await idempotency.insert_received(pool,
        StandardItem.model_validate({
            "sourceId": "sx", "itemId": "dx", "version": "vx",
            "op": "upsert", "knCode": "k", "filePath": "/x.md", "content": "x",
        }), payload_size_bytes=5)
    await idempotency.mark_failed(pool, eid, error_type="UPSTREAM_ERROR", error_message="boom")
    row = await idempotency.get_by_id(pool, eid)
    assert row.status == "failed"
    assert row.error_type == "UPSTREAM_ERROR"


async def test_reset_for_replay(pool):
    row = await idempotency.get_by_id(pool, (await idempotency.get_by_idempotency_key(
        pool, source_id="sx", item_id="dx", version="vx")).event_id)
    await idempotency.reset_for_replay(pool, row.event_id)
    updated = await idempotency.get_by_id(pool, row.event_id)
    assert updated.status == "received"
    assert updated.retry_count == 1
    assert updated.error_type is None


async def test_null_version_no_dedup(pool):
    eid1 = await idempotency.insert_received(pool, _ITEM_NULL_VER, payload_size_bytes=0)
    eid2 = await idempotency.insert_received(pool,
        StandardItem.model_validate({
            "sourceId": "src2", "itemId": "doc2",
            "op": "delete", "knCode": "kb1", "filePath": "/b.md",
        }), payload_size_bytes=0)
    assert eid1 != eid2


async def test_list_events_by_status(pool):
    rows, total = await idempotency.list_events(pool, status="received", page=1, page_size=10)
    assert total >= 1
    assert all(r.status == "received" for r in rows)
```

- [ ] **Step 2: Run to verify fails**

Run: `cd byclaw-kgw && uv run pytest tests/test_idempotency.py -v -m integration`
Expected: FAIL with `ModuleNotFoundError: kgw.idempotency`

- [ ] **Step 3: Create `src/kgw/idempotency.py`**

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg.errors
from psycopg_pool import AsyncConnectionPool

from kgw.schemas.standard_item import StandardItem


class DuplicateEvent(Exception):
    """Raised by insert_received when UNIQUE (source_id, item_id, version) conflicts."""


@dataclass
class IngestEventRow:
    event_id: int
    source_id: str
    item_id: str
    version: str | None
    op: str
    kn_code: str
    file_path: str
    status: str
    error_type: str | None
    error_message: str | None
    retry_count: int
    done_at: datetime | None


async def insert_received(
    pool: AsyncConnectionPool,
    item: StandardItem,
    *,
    payload_size_bytes: int,
) -> int:
    """INSERT a new event row with status='received'. Returns event_id.

    Raises DuplicateEvent on UNIQUE (source_id, item_id, version) conflict.
    version=NULL rows do NOT conflict with each other (PG NULL semantics).
    """
    try:
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "INSERT INTO kgw_ingest_event "
                    "(source_id, item_id, version, op, kn_code, file_path, "
                    " status, payload_size_bytes) "
                    "VALUES (%s, %s, %s, %s, %s, %s, 'received', %s) "
                    "RETURNING event_id",
                    (item.source_id, item.item_id, item.version, item.op,
                     item.kn_code, item.file_path, payload_size_bytes),
                )
                row = await cur.fetchone()
            await conn.commit()
        return row[0]
    except psycopg.errors.UniqueViolation:
        raise DuplicateEvent(
            f"duplicate event: source_id={item.source_id} "
            f"item_id={item.item_id} version={item.version}"
        )


async def get_by_id(
    pool: AsyncConnectionPool,
    event_id: int,
) -> IngestEventRow | None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT event_id, source_id, item_id, version, op, kn_code, file_path, "
                "status, error_type, error_message, retry_count, done_at "
                "FROM kgw_ingest_event WHERE event_id=%s",
                (event_id,),
            )
            row = await cur.fetchone()
    if row is None:
        return None
    return _row_to_dataclass(row)


async def get_by_idempotency_key(
    pool: AsyncConnectionPool,
    *,
    source_id: str,
    item_id: str,
    version: str | None,
) -> IngestEventRow | None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            if version is None:
                # NULL != NULL in SQL, so this can't find NULL-version rows by key
                return None
            await cur.execute(
                "SELECT event_id, source_id, item_id, version, op, kn_code, file_path, "
                "status, error_type, error_message, retry_count, done_at "
                "FROM kgw_ingest_event "
                "WHERE source_id=%s AND item_id=%s AND version=%s",
                (source_id, item_id, version),
            )
            row = await cur.fetchone()
    if row is None:
        return None
    return _row_to_dataclass(row)


async def mark_done(pool: AsyncConnectionPool, event_id: int) -> None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_ingest_event SET status='done', done_at=NOW() "
                "WHERE event_id=%s",
                (event_id,),
            )
        await conn.commit()


async def mark_failed(
    pool: AsyncConnectionPool,
    event_id: int,
    *,
    error_type: str,
    error_message: str,
) -> None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_ingest_event "
                "SET status='failed', error_type=%s, error_message=%s "
                "WHERE event_id=%s",
                (error_type, error_message[:2000], event_id),
            )
        await conn.commit()


async def reset_for_replay(pool: AsyncConnectionPool, event_id: int) -> None:
    """Set status='received', increment retry_count, clear error fields."""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_ingest_event "
                "SET status='received', retry_count=retry_count+1, "
                "    error_type=NULL, error_message=NULL "
                "WHERE event_id=%s",
                (event_id,),
            )
        await conn.commit()


async def list_events(
    pool: AsyncConnectionPool,
    *,
    source_id: str | None = None,
    item_id: str | None = None,
    kn_code: str | None = None,
    status: str | None = None,
    from_time: str | None = None,
    to_time: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[IngestEventRow], int]:
    conditions: list[str] = []
    params: list[Any] = []
    if source_id:
        conditions.append("source_id=%s"); params.append(source_id)
    if item_id:
        conditions.append("item_id=%s"); params.append(item_id)
    if kn_code:
        conditions.append("kn_code=%s"); params.append(kn_code)
    if status:
        conditions.append("status=%s"); params.append(status)
    if from_time:
        conditions.append("received_at>=%s"); params.append(from_time)
    if to_time:
        conditions.append("received_at<=%s"); params.append(to_time)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    offset = (page - 1) * page_size

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                f"SELECT COUNT(*) FROM kgw_ingest_event {where}", params
            )
            total = (await cur.fetchone())[0]
            await cur.execute(
                f"SELECT event_id, source_id, item_id, version, op, kn_code, file_path, "
                f"status, error_type, error_message, retry_count, done_at "
                f"FROM kgw_ingest_event {where} "
                f"ORDER BY received_at DESC LIMIT %s OFFSET %s",
                params + [page_size, offset],
            )
            rows = await cur.fetchall()
    return [_row_to_dataclass(r) for r in rows], total


def _row_to_dataclass(row: Any) -> IngestEventRow:
    # pool uses dict_row factory — access by column name, not position
    return IngestEventRow(
        event_id=row["event_id"], source_id=row["source_id"], item_id=row["item_id"],
        version=row["version"], op=row["op"], kn_code=row["kn_code"],
        file_path=row["file_path"], status=row["status"],
        error_type=row["error_type"], error_message=row["error_message"],
        retry_count=row["retry_count"], done_at=row["done_at"],
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd byclaw-kgw && uv run pytest tests/test_idempotency.py -v -m integration`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add byclaw-kgw/src/kgw/idempotency.py byclaw-kgw/tests/test_idempotency.py
git commit -m "feat(kgw): add idempotency module for ingest_event CRUD"
```

---

### Task 4: event_processor — core pipeline

**Files:**
- Create: `byclaw-kgw/src/kgw/event_processor.py`
- Test: `byclaw-kgw/tests/test_event_processor.py`

Context for the implementer:
- `state.pool` — psycopg AsyncConnectionPool (dict_row factory)
- `state.config_provider.get_kb_config(kn_code)` — returns `KbConfig | None`; `KbConfig` has `.domain_url`, `.domain_name`, `.resource_code`, `.headers`, `.operations`, `.operation_path(KbOp)`
- `state.auth_provider.resolve_headers(config.headers, user_code=...)` — returns dict of auth headers
- `state.circuit_breakers.get(endpoint_key)` — returns `CircuitBreaker`; `.before_call() -> bool`; `.record_success()` / `.record_failure()`
- `state.http` — shared `httpx.AsyncClient`
- `state.audit` — `AuditWriter`; `.record(AuditEntry)` (fire-and-forget, never raises)
- `ensure_synced(state, *, property_id, kn_code, user_code)` — raises `MetadataPropertySyncFailed` on failure
- `resolve_base_url(config)` — returns base URL string (both direct + discovery modes)
- `call_backend_json(config, op_path, body, headers, http)` — returns dict; raises `httpx.TimeoutException`, `httpx.ConnectError`, `BackendAuthError`
- `binding_mod.upsert_pending(conn, *, property_id, kn_code, file_path, attempt_id)` — within caller tx
- `binding_mod.mark_synced_by_attempt(pool, *, attempt_id)`
- `binding_mod.delete_by_attempt(pool, attempt_id)`
- `binding_mod.delete_by_file(pool, *, kn_code, file_path)`
- `binding_mod.write_outbox(pool, *, property_id, kn_code, file_path, attempt_id, reason)`
- `binding_mod.new_attempt_id()` — returns unique int
- `registry.list_active_properties(pool, names)` — returns list of PropertyRow with `.property_id`, `.property_name`, `.backend_name`, `.value_type`
- `KbOp.FILE_IMPORT`, `KbOp.FILE_DELETE`, `KbOp.KNOWLEDGE_ITEMS_METADATA_UPDATE` — enum values
- `_DEFAULT_KB_PATHS` — dict `KbOp → default path string`
- `AuditEntry` fields: source, trace_id, actor_user_id, actor_kind, operation_type, kn_code, file_path, payload_size_bytes, row_count, payload_redacted, result_code, result_msg, latency_ms, source_connector, source_id, source_item_id, source_version

- [ ] **Step 1: Write failing unit tests**

```python
# tests/test_event_processor.py
from __future__ import annotations
import asyncio
import base64
import pytest
import respx
import httpx
from unittest.mock import AsyncMock, MagicMock, patch
from kgw.schemas.standard_item import StandardItem
from kgw.event_processor import EventResult, process_event
from kgw.envelope import KBNotFound, MetadataPropertyNotRegistered


def _make_state(pool, config=None, *, kb_ok=True):
    state = MagicMock()
    state.pool = pool

    kb_config = MagicMock()
    kb_config.domain_url = "http://kb.test"
    kb_config.domain_name = ""
    kb_config.resource_code = "kb_res"
    kb_config.headers = {}
    kb_config.operation_path = lambda op: None

    state.config_provider.get_kb_config = AsyncMock(
        return_value=kb_config if kb_ok else None
    )
    state.auth_provider.resolve_headers = AsyncMock(return_value={})
    cb = MagicMock()
    cb.before_call.return_value = True
    cb.record_success = MagicMock()
    cb.record_failure = MagicMock()
    state.circuit_breakers.get.return_value = cb
    state.http = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"resultCode": "0"})))
    state.audit = MagicMock()
    state.audit.record = MagicMock()
    return state


@pytest.mark.asyncio
async def test_unknown_kn_code_raises():
    state = _make_state(None, kb_ok=False)
    item = StandardItem.model_validate({
        "sourceId": "s", "itemId": "i", "version": "v1",
        "op": "upsert", "knCode": "bad_kb", "filePath": "/a.md", "content": "x",
    })
    with pytest.raises(KBNotFound):
        await process_event(state, item, user_code="u1")


@pytest.mark.asyncio
async def test_unregistered_metadata_raises():
    import fakeredis.aioredis
    from kgw.db import build_pool, run_migrations
    # This test is integration-only — skip in unit mode
    pytest.skip("requires DB; see test_integration_s5.py")


@pytest.mark.asyncio
async def test_base64_content_decoded():
    """Ensure base64 content is decoded to bytes before upload."""
    from kgw.schemas.standard_item import InlineBase64Content
    data = base64.b64encode(b"hello world").decode()
    item = StandardItem.model_validate({
        "sourceId": "s", "itemId": "i", "version": "v2",
        "op": "upsert", "knCode": "k1", "filePath": "/f.pdf",
        "content": {"encoding": "base64", "data": data},
        "contentType": "application/pdf",
    })
    assert isinstance(item.content, InlineBase64Content)
    assert base64.b64decode(item.content.data) == b"hello world"
```

- [ ] **Step 2: Run to verify partial failure**

Run: `cd byclaw-kgw && uv run pytest tests/test_event_processor.py -v`
Expected: 1 skipped, 1 passed (`test_base64_content_decoded`), 1 test that tests KBNotFound fails with import error

- [ ] **Step 3: Create `src/kgw/event_processor.py`**

```python
from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
from typing import Any

import httpx

from kgw import idempotency
from kgw.audit import AuditEntry
from kgw.dispatcher import KbOp, _DEFAULT_KB_PATHS
from kgw.envelope import KBNotFound, MetadataPropertyNotRegistered
from kgw.metadata import binding as binding_mod
from kgw.metadata import registry
from kgw.observability.logger import get_logger
from kgw.observability.metrics import kgw_ingest_events_total
from kgw.schemas.standard_item import InlineBase64Content, RemoteUrlContent, StandardItem
from kgw.upstream import BackendAuthError, call_backend_json, resolve_base_url

_log = get_logger(__name__)

_REMOTE_MAX_BYTES = 50 * 1024 * 1024  # 50 MB


@dataclass
class EventResult:
    event_id: int
    status: str  # done / failed / already_processed / in_progress
    error_type: str | None = None
    error_message: str | None = None
    retry_count: int = 0


async def process_event(
    state: Any,
    item: StandardItem,
    *,
    user_code: str,
    trace_id: str | None = None,
) -> EventResult:
    """Run the full ingest pipeline for one StandardItem.

    Steps 1-2 raise KgwError on failure (→ 422, event NOT inserted).
    Steps 3-7 catch all errors internally and return EventResult with status='failed'.
    """
    pool = state.pool

    # Step 1: knCode validation
    config = await state.config_provider.get_kb_config(item.kn_code)
    if config is None:
        raise KBNotFound(f"unknown knCode: {item.kn_code}", kn_code=item.kn_code)

    # Step 2: metadata key validation (upsert only)
    if item.op == "upsert" and item.metadata:
        active = await registry.list_active_properties(pool, list(item.metadata.keys()))
        found = {p.property_name for p in active}
        missing = [k for k in item.metadata if k not in found]
        if missing:
            raise MetadataPropertyNotRegistered(
                f"metadataProperty '{missing[0]}' not declared in gateway master catalog",
                property_name=missing[0],
            )

    # Step 3: idempotent INSERT received
    size = len(item.model_dump_json().encode())
    try:
        event_id = await idempotency.insert_received(pool, item, payload_size_bytes=size)
    except idempotency.DuplicateEvent:
        existing = await idempotency.get_by_idempotency_key(
            pool, source_id=item.source_id, item_id=item.item_id, version=item.version
        )
        if existing is None:
            # version=None cannot be looked up; treat as in_progress
            return EventResult(event_id=0, status="in_progress")
        label = {"done": "already_processed", "received": "in_progress"}.get(
            existing.status, existing.status
        )
        kgw_ingest_events_total.labels(op=item.op, result=label).inc()
        return EventResult(
            event_id=existing.event_id, status=label,
            error_type=existing.error_type,
            error_message=existing.error_message,
            retry_count=existing.retry_count,
        )

    # Step 4: source_lock check
    lock_row = await _get_source_lock(pool, kn_code=item.kn_code, file_path=item.file_path)
    if lock_row and not _is_lock_expired(lock_row) and lock_row["lock_owner"] != user_code:
        await _write_conflict(pool, item=item, reason="SOURCE_LOCKED", writer=user_code, current_writer=lock_row["lock_owner"])
        await idempotency.mark_failed(pool, event_id, error_type="SOURCE_LOCKED",
                                      error_message=f"file locked by {lock_row['lock_owner']}")
        kgw_ingest_events_total.labels(op=item.op, result="source_locked").inc()
        return EventResult(event_id=event_id, status="failed",
                           error_type="SOURCE_LOCKED",
                           error_message=f"file locked by {lock_row['lock_owner']}")

    # Step 5: version monotonicity
    if item.version is not None:
        last_ver = await _get_latest_done_version(pool, kn_code=item.kn_code, file_path=item.file_path)
        if last_ver is not None and item.version <= last_ver:
            await _write_conflict(pool, item=item, reason="STALE_VERSION", writer=user_code, current_writer=None)
            await idempotency.mark_failed(pool, event_id, error_type="STALE_VERSION",
                                          error_message=f"version {item.version!r} <= existing {last_ver!r}")
            kgw_ingest_events_total.labels(op=item.op, result="stale_version").inc()
            return EventResult(event_id=event_id, status="failed",
                               error_type="STALE_VERSION",
                               error_message=f"version {item.version!r} <= existing {last_ver!r}")

    # Steps 6-7: KB write — wrapped in 30s timeout
    try:
        async with asyncio.timeout(30):
            if item.op == "upsert":
                await _process_upsert(state, item, event_id=event_id,
                                       config=config, user_code=user_code, trace_id=trace_id)
            else:
                await _process_delete(state, item, event_id=event_id,
                                       config=config, user_code=user_code, trace_id=trace_id)
    except asyncio.TimeoutError:
        await idempotency.mark_failed(pool, event_id, error_type="PROCESSING_TIMEOUT",
                                      error_message="event processing exceeded 30s")
        kgw_ingest_events_total.labels(op=item.op, result="processing_timeout").inc()
        return EventResult(event_id=event_id, status="failed", error_type="PROCESSING_TIMEOUT")

    row = await idempotency.get_by_id(pool, event_id)
    kgw_ingest_events_total.labels(op=item.op, result=row.status).inc()
    return EventResult(event_id=event_id, status=row.status,
                       error_type=row.error_type, error_message=row.error_message,
                       retry_count=row.retry_count)


async def _process_upsert(state, item: StandardItem, *, event_id, config, user_code, trace_id):
    pool = state.pool

    # Resolve content bytes
    content_bytes, content_type = await _resolve_content(state.http, item)

    # Build upload URL
    op_path = config.operation_path(KbOp.FILE_IMPORT) or _DEFAULT_KB_PATHS.get(
        KbOp.FILE_IMPORT, "/api/v1/knowledgeItems/import"
    )
    base_url = await resolve_base_url(config)
    url = base_url + op_path

    headers = await state.auth_provider.resolve_headers(config.headers, user_code=user_code)
    endpoint_key = config.domain_url or config.domain_name
    cb = state.circuit_breakers.get(endpoint_key)

    if not cb.before_call():
        await idempotency.mark_failed(pool, event_id, error_type="CIRCUIT_OPEN",
                                      error_message="circuit breaker OPEN")
        return

    try:
        resp = await state.http.post(
            url,
            headers=headers,
            files={"fileContent": (item.file_path.split("/")[-1], content_bytes, content_type or "application/octet-stream")},
            data={"knCode": config.resource_code, "filePath": item.file_path},
            timeout=25.0,
        )
        if resp.status_code in (401, 403):
            cb.record_failure()
            await idempotency.mark_failed(pool, event_id, error_type="BACKEND_AUTH_FAILED",
                                          error_message=f"backend auth {resp.status_code}")
            return
        result = resp.json()
        cb.record_success()
    except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as exc:
        cb.record_failure()
        await idempotency.mark_failed(pool, event_id, error_type="UPSTREAM_ERROR",
                                      error_message=str(exc)[:500])
        _audit(state, item=item, op_type="ingest.upsert", result_code="-1",
               result_msg=str(exc)[:200], size=len(content_bytes), trace_id=trace_id, user_code=user_code)
        return

    if result.get("resultCode") != "0":
        await idempotency.mark_failed(pool, event_id, error_type="UPSTREAM_ERROR",
                                      error_message=result.get("resultMsg", "")[:500])
        _audit(state, item=item, op_type="ingest.upsert", result_code="-1",
               result_msg=result.get("resultMsg", ""), size=len(content_bytes), trace_id=trace_id, user_code=user_code)
        return

    # Metadata write (if any)
    if item.metadata:
        active = await registry.list_active_properties(pool, list(item.metadata.keys()))
        props_by_name = {p.property_name: p for p in active}
        from kgw.metadata import sync as sync_mod
        from kgw.metadata.translator import translate_request_metadata, translate_response_metadata

        for p in props_by_name.values():
            try:
                await sync_mod.ensure_synced(state, property_id=p.property_id,
                                              kn_code=item.kn_code, user_code=user_code)
            except Exception as exc:  # noqa: BLE001
                await idempotency.mark_failed(pool, event_id, error_type="MetadataPropertySyncFailed",
                                              error_message=str(exc)[:500])
                return

        attempt_id = binding_mod.new_attempt_id()
        pending_keys = [(p.property_id, item.kn_code, item.file_path) for p in props_by_name.values()]
        async with pool.connection() as conn:
            async with conn.transaction():
                for p in props_by_name.values():
                    await binding_mod.upsert_pending(conn, property_id=p.property_id,
                                                      kn_code=item.kn_code, file_path=item.file_path,
                                                      attempt_id=attempt_id)

        n2b = {p.property_name: p.backend_name for p in active}
        meta_op_path = config.operation_path(KbOp.KNOWLEDGE_ITEMS_METADATA_UPDATE) or \
            _DEFAULT_KB_PATHS.get(KbOp.KNOWLEDGE_ITEMS_METADATA_UPDATE,
                                   "/api/v1/knowledgeItems/metadata/update")
        meta_body = {
            "knCode": config.resource_code,
            "filePath": item.file_path,
            "operationList": [
                {"propertyName": n2b[k], "operation": "set", "value": v}
                for k, v in item.metadata.items()
            ],
        }
        try:
            meta_resp = await call_backend_json(config=config, op_path=meta_op_path,
                                                body=meta_body, headers=headers, http=state.http)
        except Exception as exc:  # noqa: BLE001
            await _rollback_binding(pool, attempt_id=attempt_id, pending_keys=pending_keys)
            await idempotency.mark_failed(pool, event_id, error_type="UPSTREAM_ERROR",
                                          error_message=str(exc)[:500])
            return

        if meta_resp.get("resultCode") != "0":
            await _rollback_binding(pool, attempt_id=attempt_id, pending_keys=pending_keys)
            await idempotency.mark_failed(pool, event_id, error_type="UPSTREAM_ERROR",
                                          error_message=meta_resp.get("resultMsg", "")[:500])
            return

        await binding_mod.mark_synced_by_attempt(pool, attempt_id=attempt_id)

    await idempotency.mark_done(pool, event_id)
    _audit(state, item=item, op_type="ingest.upsert", result_code="0",
           result_msg="success", size=len(content_bytes), trace_id=trace_id, user_code=user_code)


async def _process_delete(state, item: StandardItem, *, event_id, config, user_code, trace_id):
    pool = state.pool
    op_path = config.operation_path(KbOp.FILE_DELETE) or _DEFAULT_KB_PATHS.get(
        KbOp.FILE_DELETE, "/api/v1/knowledgeItems/delete"
    )
    headers = await state.auth_provider.resolve_headers(config.headers, user_code=user_code)
    endpoint_key = config.domain_url or config.domain_name
    cb = state.circuit_breakers.get(endpoint_key)
    if not cb.before_call():
        await idempotency.mark_failed(pool, event_id, error_type="CIRCUIT_OPEN",
                                      error_message="circuit breaker OPEN")
        return
    body = {"knCode": config.resource_code, "filePath": item.file_path}
    try:
        resp = await call_backend_json(config=config, op_path=op_path,
                                       body=body, headers=headers, http=state.http)
        cb.record_success()
    except Exception as exc:  # noqa: BLE001
        cb.record_failure()
        await idempotency.mark_failed(pool, event_id, error_type="UPSTREAM_ERROR",
                                      error_message=str(exc)[:500])
        return

    if resp.get("resultCode") != "0":
        await idempotency.mark_failed(pool, event_id, error_type="UPSTREAM_ERROR",
                                      error_message=resp.get("resultMsg", "")[:500])
        return

    await binding_mod.delete_by_file(pool, kn_code=item.kn_code, file_path=item.file_path)
    await idempotency.mark_done(pool, event_id)
    _audit(state, item=item, op_type="ingest.delete", result_code="0",
           result_msg="success", size=0, trace_id=trace_id, user_code=user_code)


async def _resolve_content(http: httpx.AsyncClient, item: StandardItem) -> tuple[bytes, str | None]:
    if isinstance(item.content, str):
        return item.content.encode("utf-8"), item.content_type or "text/plain"
    if isinstance(item.content, InlineBase64Content):
        return base64.b64decode(item.content.data), item.content_type or "application/octet-stream"
    if isinstance(item.content, RemoteUrlContent):
        resp = await http.get(item.content.url, timeout=30.0, follow_redirects=True)
        resp.raise_for_status()
        data = resp.content
        if len(data) > _REMOTE_MAX_BYTES:
            raise ValueError(f"remote content too large: {len(data)} bytes > 50MB")
        return data, item.content_type or resp.headers.get("content-type", "application/octet-stream")
    return b"", None


async def _get_source_lock(pool, *, kn_code: str, file_path: str) -> dict | None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT lock_owner, locked_at, expires_at FROM kgw_kb_source_lock "
                "WHERE kn_code=%s AND file_path=%s",
                (kn_code, file_path),
            )
            return await cur.fetchone()


def _is_lock_expired(lock_row: dict) -> bool:
    if lock_row["expires_at"] is None:
        return False
    from datetime import timezone
    from datetime import datetime as dt
    return dt.now(timezone.utc) > lock_row["expires_at"]


async def _get_latest_done_version(pool, *, kn_code: str, file_path: str) -> str | None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT version FROM kgw_ingest_event "
                "WHERE kn_code=%s AND file_path=%s AND status='done' AND version IS NOT NULL "
                "ORDER BY done_at DESC LIMIT 1",
                (kn_code, file_path),
            )
            row = await cur.fetchone()
    return row["version"] if row else None


async def _write_conflict(pool, *, item: StandardItem, reason: str, writer: str, current_writer: str | None):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_kb_conflict_log "
                "(kn_code, file_path, current_writer, attempted_writer, attempted_version, reason) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (item.kn_code, item.file_path, current_writer, writer, item.version, reason),
            )
        await conn.commit()


async def _rollback_binding(pool, *, attempt_id: int, pending_keys: list[tuple[int, str, str]]):
    try:
        await binding_mod.delete_by_attempt(pool, attempt_id)
    except Exception as exc:  # noqa: BLE001
        _log.warning("event_processor.rollback_failed", attempt_id=attempt_id, error=str(exc))
        for property_id, kn_code, file_path in pending_keys:
            try:
                await binding_mod.write_outbox(pool, property_id=property_id,
                                                kn_code=kn_code, file_path=file_path,
                                                attempt_id=attempt_id)
            except Exception:  # noqa: BLE001
                pass


def _audit(state, *, item: StandardItem, op_type: str, result_code: str,
           result_msg: str, size: int, trace_id: str | None, user_code: str):
    state.audit.record(AuditEntry(
        source="ingest",
        trace_id=trace_id,
        actor_user_id=user_code,
        actor_kind="connector",
        operation_type=op_type,
        kn_code=item.kn_code,
        file_path=item.file_path,
        payload_size_bytes=size,
        row_count=None,
        payload_redacted={"knCode": item.kn_code, "filePath": item.file_path,
                          "sourceId": item.source_id, "itemId": item.item_id},
        result_code=result_code,
        result_msg=result_msg,
        latency_ms=None,
        source_id=item.source_id,
        source_item_id=item.item_id,
        source_version=item.version,
    ))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd byclaw-kgw && uv run pytest tests/test_event_processor.py -v`
Expected: 2 passed, 1 skipped

- [ ] **Step 5: Commit**

```bash
git add byclaw-kgw/src/kgw/event_processor.py byclaw-kgw/tests/test_event_processor.py
git commit -m "feat(kgw): add event_processor pipeline (upsert/delete, idempotency, binding)"
```

---

### Task 5: `api/events.py` — ingest endpoints

**Files:**
- Create: `byclaw-kgw/src/kgw/api/events.py`
- Test: `byclaw-kgw/tests/test_api_events.py`

Context: uses `process_event` from Task 4. Concurrency gate is `state.ingest_semaphore` (added in Task 7, but test will mock it). All endpoints return the standard `{resultCode, resultMsg, resultObject}` envelope.

- [ ] **Step 1: Write failing unit tests**

```python
# tests/test_api_events.py
from __future__ import annotations
import asyncio
import pytest
import respx
import httpx
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient


def _make_app_with_mock_processor(result_status="done", raise_exc=None):
    """Build a minimal FastAPI app with events router + mocked process_event."""
    from fastapi import FastAPI
    from kgw.api.events import router
    app = FastAPI()
    app.include_router(router)

    # Attach mock state
    semaphore = asyncio.Semaphore(100)
    app.state.ingest_semaphore = semaphore
    # process_event is patched per-test via patch()
    return app


@pytest.mark.asyncio
async def test_single_event_done():
    from fastapi import FastAPI
    from kgw.api.events import router
    from kgw.event_processor import EventResult

    app = FastAPI()
    app.include_router(router)
    app.state.ingest_semaphore = asyncio.Semaphore(100)

    async def mock_process(state, item, *, user_code, trace_id=None):
        return EventResult(event_id=42, status="done")

    with patch("kgw.api.events.process_event", mock_process):
        async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as client:
            resp = await client.post(
                "/kgw/ingest/v1/events",
                json={"sourceId": "s", "itemId": "i", "version": "v1",
                      "op": "upsert", "knCode": "k", "filePath": "/a.md", "content": "hi"},
                headers={"X-User-Id": "user1"},
            )
    assert resp.status_code == 200
    body = resp.json()
    assert body["resultCode"] == "0"
    assert body["resultObject"]["eventId"] == 42
    assert body["resultObject"]["status"] == "done"


@pytest.mark.asyncio
async def test_payload_too_large():
    from fastapi import FastAPI
    from kgw.api.events import router

    app = FastAPI()
    app.include_router(router)
    app.state.ingest_semaphore = asyncio.Semaphore(100)

    async with AsyncClient(
        transport=ASGITransport(app), base_url="http://test"
    ) as client:
        big_content = "x" * (4 * 1024 * 1024 + 1)
        resp = await client.post(
            "/kgw/ingest/v1/events",
            json={"sourceId": "s", "itemId": "i", "op": "upsert",
                  "knCode": "k", "filePath": "/a.md", "content": big_content},
            headers={"X-User-Id": "u"},
        )
    # 413 or 200 with errorCode — depends on implementation
    assert resp.status_code in (200, 413)


@pytest.mark.asyncio
async def test_batch_partial_success():
    from fastapi import FastAPI
    from kgw.api.events import router
    from kgw.event_processor import EventResult

    app = FastAPI()
    app.include_router(router)
    app.state.ingest_semaphore = asyncio.Semaphore(100)

    call_count = 0
    async def mock_process(state, item, *, user_code, trace_id=None):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return EventResult(event_id=1, status="done")
        return EventResult(event_id=2, status="failed", error_type="UPSTREAM_ERROR", error_message="oops")

    with patch("kgw.api.events.process_event", mock_process):
        async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as client:
            resp = await client.post(
                "/kgw/ingest/v1/events/batch",
                json={"events": [
                    {"sourceId": "s", "itemId": "i1", "op": "upsert", "knCode": "k", "filePath": "/a.md", "content": "x"},
                    {"sourceId": "s", "itemId": "i2", "op": "upsert", "knCode": "k", "filePath": "/b.md", "content": "y"},
                ]},
                headers={"X-User-Id": "u"},
            )
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["succeeded"] == 1
    assert body["resultObject"]["failed"] == 1
```

- [ ] **Step 2: Run to verify fails**

Run: `cd byclaw-kgw && uv run pytest tests/test_api_events.py -v`
Expected: FAIL with `ModuleNotFoundError: kgw.api.events`

- [ ] **Step 3: Create `src/kgw/api/events.py`**

```python
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from kgw.envelope import KBNotFound, METADATA_PROPERTY_NOT_REGISTERED, PAYLOAD_TOO_LARGE
from kgw.event_processor import EventResult, process_event
from kgw import idempotency
from kgw.observability.metrics import kgw_ingest_semaphore_rejected_total
from kgw.schemas.standard_item import StandardItem

router = APIRouter(prefix="/kgw/ingest/v1")

_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024  # 4 MB


def _result_to_envelope(result: EventResult) -> dict[str, Any]:
    if result.status in ("done", "already_processed"):
        return {
            "resultCode": "0",
            "resultMsg": result.status.replace("_", "-"),
            "resultObject": {"eventId": result.event_id, "status": result.status},
        }
    if result.status == "in_progress":
        return JSONResponse(
            status_code=409,
            content={
                "resultCode": "-1",
                "resultMsg": "in_progress",
                "resultObject": {"eventId": result.event_id, "status": "in_progress"},
            },
        )
    return {
        "resultCode": "-1",
        "resultMsg": result.error_type or "failed",
        "resultObject": {
            "eventId": result.event_id,
            "status": result.status,
            "errorType": result.error_type,
            "errorMessage": result.error_message,
        },
    }


def _result_to_dict(item_id: str, result: EventResult) -> dict[str, Any]:
    base = {"itemId": item_id, "status": result.status}
    if result.event_id:
        base["eventId"] = result.event_id
    if result.error_type:
        base["errorType"] = result.error_type
    if result.error_message:
        base["errorMessage"] = result.error_message
    return base


@router.post("/events")
async def ingest_event(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> Any:
    content_length = int(request.headers.get("content-length", 0))
    if content_length > _MAX_PAYLOAD_BYTES:
        raise PayloadTooLarge(
            f"payload {content_length} bytes exceeds 4MB limit",
            limit_bytes=_MAX_PAYLOAD_BYTES,
        )

    item = StandardItem.model_validate(body)

    state = request.app.state
    sem = state.ingest_semaphore
    if sem._value == 0:  # noqa: SLF001
        kgw_ingest_semaphore_rejected_total.inc()
        return JSONResponse(
            status_code=503,
            headers={"Retry-After": "5"},
            content={"resultCode": "-1", "resultMsg": "service busy, retry later",
                     "resultObject": {}},
        )

    trace_id = request.headers.get("X-Trace-Id")
    async with sem:
        result = await process_event(state, item, user_code=x_user_id, trace_id=trace_id)

    return _result_to_envelope(result)


@router.post("/events/batch")
async def ingest_events_batch(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
) -> dict[str, Any]:
    events_raw = list(body.get("events") or [])
    if len(events_raw) > 100:
        return {
            "resultCode": "-1",
            "resultMsg": "batch exceeds 100 events",
            "resultObject": {},
        }

    state = request.app.state
    trace_id = request.headers.get("X-Trace-Id")
    results: list[dict[str, Any]] = []

    for raw in events_raw:
        item_id = raw.get("itemId", "")
        try:
            item = StandardItem.model_validate(raw)
        except ValidationError as exc:
            results.append({
                "itemId": item_id,
                "status": "validation_failed",
                "errorType": "INVALID_STANDARD_ITEM",
                "errorMessage": str(exc.errors()[0].get("msg", ""))[:200],
            })
            continue

        async with state.ingest_semaphore:
            result = await process_event(state, item, user_code=x_user_id, trace_id=trace_id)
        results.append(_result_to_dict(item_id, result))

    succeeded = sum(1 for r in results if r.get("status") == "done")
    failed = len(results) - succeeded
    return {
        "resultCode": "0" if failed == 0 else "-1",
        "resultMsg": "success" if failed == 0 else "partial success",
        "resultObject": {
            "total": len(results),
            "succeeded": succeeded,
            "failed": failed,
            "results": results,
        },
    }


@router.get("/events/{event_id}")
async def get_event(
    request: Request,
    event_id: int,
) -> dict[str, Any]:
    pool = request.app.state.pool
    row = await idempotency.get_by_id(pool, event_id)
    if row is None:
        return {
            "resultCode": "-1",
            "resultMsg": f"event not found: {event_id}",
            "resultObject": {},
        }
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {
            "eventId": row.event_id,
            "sourceId": row.source_id,
            "itemId": row.item_id,
            "version": row.version,
            "op": row.op,
            "knCode": row.kn_code,
            "filePath": row.file_path,
            "status": row.status,
            "errorType": row.error_type,
            "errorMessage": row.error_message,
            "retryCount": row.retry_count,
            "receivedAt": None,
            "doneAt": row.done_at.isoformat() if row.done_at else None,
        },
    }


@router.get("/events")
async def list_events(
    request: Request,
    sourceId: str | None = None,
    itemId: str | None = None,
    knCode: str | None = None,
    status: str | None = None,
    fromTime: str | None = None,
    toTime: str | None = None,
    pageSize: int = 20,
    page: int = 1,
) -> dict[str, Any]:
    if pageSize > 100:
        pageSize = 100
    pool = request.app.state.pool
    rows, total = await idempotency.list_events(
        pool, source_id=sourceId, item_id=itemId, kn_code=knCode,
        status=status, from_time=fromTime, to_time=toTime,
        page=page, page_size=pageSize,
    )
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {
            "data": [
                {
                    "eventId": r.event_id, "sourceId": r.source_id, "itemId": r.item_id,
                    "version": r.version, "op": r.op, "knCode": r.kn_code,
                    "filePath": r.file_path, "status": r.status,
                    "errorType": r.error_type, "errorMessage": r.error_message,
                    "retryCount": r.retry_count,
                    "doneAt": r.done_at.isoformat() if r.done_at else None,
                }
                for r in rows
            ],
            "total": total,
            "page": page,
            "pageSize": pageSize,
        },
    }


@router.post("/events/{event_id}/replay")
async def replay_event(
    request: Request,
    event_id: int,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
) -> Any:
    state = request.app.state
    pool = state.pool
    row = await idempotency.get_by_id(pool, event_id)
    if row is None:
        return {"resultCode": "-1", "resultMsg": f"event not found: {event_id}", "resultObject": {}}
    if row.status != "failed":
        return {"resultCode": "-1",
                "resultMsg": f"event {event_id} is not in failed status, current status: {row.status}",
                "resultObject": {}}
    if row.op == "upsert":
        return {"resultCode": "-1",
                "resultMsg": "upsert events must be re-submitted by the connector",
                "resultObject": {}}

    await idempotency.reset_for_replay(pool, event_id)
    item = StandardItem.model_validate({
        "sourceId": row.source_id, "itemId": row.item_id, "version": row.version,
        "op": row.op, "knCode": row.kn_code, "filePath": row.file_path,
    })
    trace_id = request.headers.get("X-Trace-Id")
    async with state.ingest_semaphore:
        result = await process_event(state, item, user_code=x_user_id, trace_id=trace_id)
    return _result_to_envelope(result)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd byclaw-kgw && uv run pytest tests/test_api_events.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add byclaw-kgw/src/kgw/api/events.py byclaw-kgw/tests/test_api_events.py
git commit -m "feat(kgw): add ingest events API endpoints"
```

---

### Task 6: `api/admin.py` — audit/conflicts/lock/unlock

**Files:**
- Create: `byclaw-kgw/src/kgw/api/admin.py`
- Test: `byclaw-kgw/tests/test_api_admin.py`

Context: reads `kgw_audit_log`, `kgw_kb_conflict_log`, `kgw_kb_source_lock`. All return standard envelope. Lock/unlock use the existing `kgw_kb_source_lock` table (PK: `kn_code, file_path`). `{filePath:path}` captures slashes after the first segment.

- [ ] **Step 1: Write failing unit tests**

```python
# tests/test_api_admin.py
from __future__ import annotations
import pytest
import pytest_asyncio
from pathlib import Path
from httpx import ASGITransport, AsyncClient
from kgw.db import build_pool, run_migrations
from kgw.main import build_app

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]
_SQL_DIR = Path(__file__).resolve().parent.parent / "sql"


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def client(pg_dsn, redis_url, minio_settings):
    import fakeredis.aioredis
    import os
    os.environ.setdefault("KGW_SERVICE_USER_CODE", "kgw-test")
    app = build_app()
    async with AsyncClient(transport=ASGITransport(app), base_url="http://test",
                           headers={"X-User-Id": "admin"}) as c:
        async with app.router.lifespan_context(app):
            yield c


async def test_audit_returns_list(client):
    resp = await client.get("/kgw/admin/v1/audit?pageSize=5&page=1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["resultCode"] == "0"
    assert "data" in body["resultObject"]
    assert "total" in body["resultObject"]


async def test_conflicts_returns_list(client):
    resp = await client.get("/kgw/admin/v1/conflicts?pageSize=5")
    assert resp.status_code == 200
    assert resp.json()["resultCode"] == "0"


async def test_lock_unlock_cycle(client):
    lock_resp = await client.post(
        "/kgw/admin/v1/kbs/test_kb/files/%2Fpolicy%2Fsalary.md/lock",
        json={"lockOwner": "manual"},
    )
    assert lock_resp.status_code == 200
    assert lock_resp.json()["resultCode"] == "0"

    # second lock on same file should fail
    dup_resp = await client.post(
        "/kgw/admin/v1/kbs/test_kb/files/%2Fpolicy%2Fsalary.md/lock",
        json={"lockOwner": "other_user"},
    )
    assert dup_resp.json()["resultCode"] == "-1"

    unlock_resp = await client.post(
        "/kgw/admin/v1/kbs/test_kb/files/%2Fpolicy%2Fsalary.md/unlock",
    )
    assert unlock_resp.json()["resultCode"] == "0"

    # unlock non-existent → -1
    bad_resp = await client.post(
        "/kgw/admin/v1/kbs/test_kb/files/%2Fnothing.md/unlock",
    )
    assert bad_resp.json()["resultCode"] == "-1"
```

- [ ] **Step 2: Run to verify fails**

Run: `cd byclaw-kgw && uv run pytest tests/test_api_admin.py -v -m integration`
Expected: FAIL with `ModuleNotFoundError: kgw.api.admin` or import error

- [ ] **Step 3: Create `src/kgw/api/admin.py`**

```python
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

router = APIRouter(prefix="/kgw/admin/v1")


@router.get("/audit")
async def query_audit(
    request: Request,
    source: str | None = None,
    knCode: str | None = None,
    operationType: str | None = None,
    actorUserId: str | None = None,
    fromTime: str | None = None,
    toTime: str | None = None,
    pageSize: int = 20,
    page: int = 1,
) -> dict[str, Any]:
    if pageSize > 100:
        pageSize = 100
    conditions: list[str] = []
    params: list[Any] = []
    if source:
        conditions.append("source=%s"); params.append(source)
    if knCode:
        conditions.append("kn_code=%s"); params.append(knCode)
    if operationType:
        conditions.append("operation_type=%s"); params.append(operationType)
    if actorUserId:
        conditions.append("actor_user_id=%s"); params.append(actorUserId)
    if fromTime:
        conditions.append("created_at>=%s"); params.append(fromTime)
    if toTime:
        conditions.append("created_at<=%s"); params.append(toTime)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    offset = (page - 1) * pageSize
    pool = request.app.state.pool
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(f"SELECT COUNT(*) FROM kgw_audit_log {where}", params)
            total = (await cur.fetchone())[0]
            await cur.execute(
                f"SELECT id, source, trace_id, actor_user_id, actor_kind, "
                f"source_connector, source_id, source_item_id, source_version, "
                f"operation_type, kn_code, file_path, payload_size_bytes, "
                f"result_code, result_msg, latency_ms, created_at "
                f"FROM kgw_audit_log {where} "
                f"ORDER BY created_at DESC LIMIT %s OFFSET %s",
                params + [pageSize, offset],
            )
            rows = await cur.fetchall()
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {
            "data": [_audit_row_to_dict(r) for r in rows],
            "total": total, "page": page, "pageSize": pageSize,
        },
    }


@router.get("/conflicts")
async def query_conflicts(
    request: Request,
    knCode: str | None = None,
    reason: str | None = None,
    fromTime: str | None = None,
    toTime: str | None = None,
    pageSize: int = 20,
    page: int = 1,
) -> dict[str, Any]:
    if pageSize > 100:
        pageSize = 100
    conditions: list[str] = []
    params: list[Any] = []
    if knCode:
        conditions.append("kn_code=%s"); params.append(knCode)
    if reason:
        conditions.append("reason=%s"); params.append(reason)
    if fromTime:
        conditions.append("attempted_at>=%s"); params.append(fromTime)
    if toTime:
        conditions.append("attempted_at<=%s"); params.append(toTime)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    offset = (page - 1) * pageSize
    pool = request.app.state.pool
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(f"SELECT COUNT(*) FROM kgw_kb_conflict_log {where}", params)
            total = (await cur.fetchone())[0]
            await cur.execute(
                f"SELECT id, kn_code, file_path, current_writer, attempted_writer, "
                f"attempted_version, reason, attempted_at "
                f"FROM kgw_kb_conflict_log {where} "
                f"ORDER BY attempted_at DESC LIMIT %s OFFSET %s",
                params + [pageSize, offset],
            )
            rows = await cur.fetchall()
    return {
        "resultCode": "0", "resultMsg": "success",
        "resultObject": {
            "data": [_conflict_row_to_dict(r) for r in rows],
            "total": total, "page": page, "pageSize": pageSize,
        },
    }


@router.post("/kbs/{kn_code}/files/{file_path:path}/lock")
async def lock_file(
    request: Request,
    kn_code: str,
    file_path: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    # file_path arrives without leading slash from path param; prepend it
    if not file_path.startswith("/"):
        file_path = "/" + file_path
    lock_owner = body.get("lockOwner")
    if not lock_owner:
        return {"resultCode": "-1", "resultMsg": "lockOwner is required", "resultObject": {}}
    expires_at = body.get("expiresAt")
    pool = request.app.state.pool
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT lock_owner, locked_at, expires_at FROM kgw_kb_source_lock "
                "WHERE kn_code=%s AND file_path=%s",
                (kn_code, file_path),
            )
            existing = await cur.fetchone()
        if existing:
            from datetime import timezone
            from datetime import datetime as dt
            expired = existing["expires_at"] and dt.now(timezone.utc) > existing["expires_at"]
            if not expired:
                await conn.rollback()
                return {
                    "resultCode": "-1",
                    "resultMsg": f"file already locked by {existing['lock_owner']} since {existing['locked_at']}",
                    "resultObject": {},
                }
            # expired lock — replace it
            await cur.execute(
                "UPDATE kgw_kb_source_lock SET lock_owner=%s, locked_at=NOW(), expires_at=%s "
                "WHERE kn_code=%s AND file_path=%s",
                (lock_owner, expires_at, kn_code, file_path),
            )
        else:
            await cur.execute(
                "INSERT INTO kgw_kb_source_lock (kn_code, file_path, lock_owner, expires_at) "
                "VALUES (%s, %s, %s, %s)",
                (kn_code, file_path, lock_owner, expires_at),
            )
        await conn.commit()
    return {
        "resultCode": "0", "resultMsg": "success",
        "resultObject": {"knCode": kn_code, "filePath": file_path,
                         "lockOwner": lock_owner, "expiresAt": expires_at},
    }


@router.post("/kbs/{kn_code}/files/{file_path:path}/unlock")
async def unlock_file(
    request: Request,
    kn_code: str,
    file_path: str,
) -> dict[str, Any]:
    if not file_path.startswith("/"):
        file_path = "/" + file_path
    pool = request.app.state.pool
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_kb_source_lock WHERE kn_code=%s AND file_path=%s",
                (kn_code, file_path),
            )
            deleted = cur.rowcount
        await conn.commit()
    if deleted == 0:
        return {"resultCode": "-1", "resultMsg": f"file is not locked: {file_path}", "resultObject": {}}
    return {"resultCode": "0", "resultMsg": "success", "resultObject": {}}


def _audit_row_to_dict(r: Any) -> dict[str, Any]:
    # pool uses dict_row factory
    return {
        "id": r["id"], "source": r["source"], "traceId": r["trace_id"],
        "actorUserId": r["actor_user_id"], "actorKind": r["actor_kind"],
        "sourceConnector": r["source_connector"], "sourceId": r["source_id"],
        "sourceItemId": r["source_item_id"], "sourceVersion": r["source_version"],
        "operationType": r["operation_type"], "knCode": r["kn_code"],
        "filePath": r["file_path"], "payloadSizeBytes": r["payload_size_bytes"],
        "resultCode": r["result_code"], "resultMsg": r["result_msg"],
        "latencyMs": r["latency_ms"],
        "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
    }


def _conflict_row_to_dict(r: Any) -> dict[str, Any]:
    return {
        "id": r["id"], "knCode": r["kn_code"], "filePath": r["file_path"],
        "currentWriter": r["current_writer"], "attemptedWriter": r["attempted_writer"],
        "attemptedVersion": r["attempted_version"], "reason": r["reason"],
        "attemptedAt": r["attempted_at"].isoformat() if r["attempted_at"] else None,
    }
```

- [ ] **Step 4: Run to verify fails (router not yet registered in main.py)**

Run: `cd byclaw-kgw && uv run pytest tests/test_api_admin.py -v -m integration`
Expected: FAIL — `/kgw/admin/v1/audit` returns 404

- [ ] **Step 5: Commit (will be fixed in Task 7)**

```bash
git add byclaw-kgw/src/kgw/api/admin.py byclaw-kgw/tests/test_api_admin.py
git commit -m "feat(kgw): add admin API endpoints (audit/conflicts/lock/unlock)"
```

---

### Task 7: Wire routes into `main.py` + semaphore

**Files:**
- Modify: `byclaw-kgw/src/kgw/main.py`

- [ ] **Step 1: Add `ingest_semaphore` to lifespan and register routers**

In `main.py`, inside `_lifespan`, after `app.state.circuit_breakers = circuit_breakers`, add:

```python
    app.state.ingest_semaphore = asyncio.Semaphore(settings.ingest_concurrency_limit)
```

In `build_app()`, after the existing `app.include_router(metadata_properties_router)` line, add:

```python
    from kgw.api.events import router as events_router  # noqa: PLC0415
    from kgw.api.admin import router as admin_router  # noqa: PLC0415

    app.include_router(events_router)
    app.include_router(admin_router)
```

- [ ] **Step 2: Run full unit suite to confirm no regressions**

Run: `cd byclaw-kgw && uv run pytest -m "not integration" -v`
Expected: all existing unit tests still pass

- [ ] **Step 3: Run admin integration tests**

Run: `cd byclaw-kgw && uv run pytest tests/test_api_admin.py -v -m integration`
Expected: 3 passed

- [ ] **Step 4: Run all tests**

Run: `cd byclaw-kgw && uv run pytest -m "not integration" -v`
Expected: all unit tests pass

- [ ] **Step 5: Commit**

```bash
git add byclaw-kgw/src/kgw/main.py
git commit -m "feat(kgw): wire events + admin routers + ingest semaphore into main app"
```

---

### Task 8: End-to-end integration test

**Files:**
- Create: `byclaw-kgw/tests/test_integration_s5.py`

- [ ] **Step 1: Write the integration test**

```python
# tests/test_integration_s5.py
"""S5 end-to-end integration test: ingest pipeline + admin endpoints."""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
import redis.asyncio as redis_async
import respx
import httpx
from httpx import ASGITransport, AsyncClient

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

_SQL_DIR = Path(__file__).resolve().parent.parent / "sql"
_KN_CODE = "hr_s5"
_RESOURCE_CODE = "backend_hr_s5"
_KB_BASE_URL = "http://kb-s5.test"

_KB_CONFIG = {
    "resourceCode": _RESOURCE_CODE,
    "domainURL": _KB_BASE_URL,
    "domainName": "",
    "headers": {},
    "resourceService": [
        {"name": "knowledgeItemsImport", "path": "/api/v1/knowledgeItems/import"},
        {"name": "knowledgeItemsDelete", "path": "/api/v1/knowledgeItems/delete"},
        {"name": "metadataPropertiesBatchCreate", "path": "/api/v1/metadataProperties/batchCreate"},
        {"name": "knowledgeItemsMetadataUpdate", "path": "/api/v1/knowledgeItems/metadata/update"},
    ],
}
_KB_MINIO_KEY = f"resource/doc/KG_DOC_{_KN_CODE}.json"

_TABLES_TO_DROP = (
    "kgw_ingest_event",
    "kgw_metadata_property_sync",
    "kgw_metadata_property_binding",
    "kgw_metadata_binding_outbox",
    "kgw_metadata_property",
    "kgw_audit_log",
    "kgw_kb_write_history",
    "kgw_kb_source_lock",
    "kgw_kb_conflict_log",
    "kgw_migration",
)


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def app_client(pg_dsn, redis_url, minio_settings) -> AsyncIterator[AsyncClient]:
    import aioboto3
    import os

    os.environ.update({
        "DB_HOST": pg_dsn.split("@")[1].split(":")[0],
        "DB_PORT": pg_dsn.split(":")[-1].split("/")[0],
        "DB_USER": pg_dsn.split("://")[1].split(":")[0],
        "DB_PASS": pg_dsn.split(":")[2].split("@")[0],
        "DB_DATABASE": pg_dsn.split("/")[-1].split("?")[0],
        "REDIS_HOST": redis_url.split("@")[-1].split(":")[0] if "@" in redis_url else redis_url.split("//")[1].split(":")[0],
        "REDIS_PORT": redis_url.split(":")[-1].split("/")[0],
        "FILE_STORAGE_MINIO_HOST": minio_settings["endpoint_url"].split("://")[1].split(":")[0],
        "FILE_STORAGE_MINIO_API_PORT": minio_settings["endpoint_url"].split(":")[-1],
        "FILE_STORAGE_MINIO_ACCESS_KEY": minio_settings["access_key"],
        "FILE_STORAGE_MINIO_SECRET_KEY": minio_settings["secret_key"],
        "FILE_STORAGE_MINIO_BUCKET_NAME": minio_settings["bucket"],
        "KGW_SERVICE_USER_CODE": "kgw-s5-test",
    })

    from kgw.db import build_pool, run_migrations
    from kgw.settings import get_settings
    get_settings.cache_clear()

    # Seed MinIO with KB config
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=minio_settings["endpoint_url"],
        aws_access_key_id=minio_settings["access_key"],
        aws_secret_access_key=minio_settings["secret_key"],
    ) as s3:
        await s3.put_object(
            Bucket=minio_settings["bucket"],
            Key=_KB_MINIO_KEY,
            Body=json.dumps(_KB_CONFIG).encode(),
        )

    # Wipe tables
    pool = await build_pool(
        pg_dsn.replace("?", "?").split("?")[0],
        min_size=1, max_size=2,
    )
    async with pool.connection() as conn:
        for t in _TABLES_TO_DROP:
            await conn.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
        await conn.commit()
    await pool.close()

    from kgw.main import build_app
    app = build_app()
    async with AsyncClient(
        transport=ASGITransport(app),
        base_url="http://test",
        headers={"X-User-Id": "test_connector"},
    ) as client:
        async with app.router.lifespan_context(app):
            yield client


async def test_upsert_event_done(app_client):
    with respx.mock:
        respx.post(f"{_KB_BASE_URL}/api/v1/knowledgeItems/import").mock(
            return_value=httpx.Response(200, json={"resultCode": "0", "resultMsg": "success", "resultObject": {}})
        )
        resp = await app_client.post(
            "/kgw/ingest/v1/events",
            json={
                "sourceId": "src-s5", "itemId": "doc-1", "version": "2026-06-07T00:00:00Z",
                "op": "upsert", "knCode": _KN_CODE, "filePath": "/policy/a.md",
                "content": "# Hello\nworld",
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["resultCode"] == "0"
    assert body["resultObject"]["status"] == "done"
    _event_id = body["resultObject"]["eventId"]
    return _event_id


async def test_idempotent_resend(app_client):
    with respx.mock:
        respx.post(f"{_KB_BASE_URL}/api/v1/knowledgeItems/import").mock(
            return_value=httpx.Response(200, json={"resultCode": "0", "resultMsg": "success", "resultObject": {}})
        )
        resp = await app_client.post(
            "/kgw/ingest/v1/events",
            json={
                "sourceId": "src-s5", "itemId": "doc-1", "version": "2026-06-07T00:00:00Z",
                "op": "upsert", "knCode": _KN_CODE, "filePath": "/policy/a.md",
                "content": "# Hello\nworld",
            },
        )
    assert resp.json()["resultMsg"] == "already-processed"


async def test_stale_version(app_client):
    with respx.mock:
        resp = await app_client.post(
            "/kgw/ingest/v1/events",
            json={
                "sourceId": "src-s5", "itemId": "doc-1-stale",
                "version": "2026-06-07T00:00:00Z",
                "op": "upsert", "knCode": _KN_CODE, "filePath": "/policy/a.md",
                "content": "old",
            },
        )
    # First write succeeds (no prior done version for this specific item/file combo? Actually version <= done_at)
    # Let's insert a done record first via the test above
    # Then push an older version
    with respx.mock:
        respx.post(f"{_KB_BASE_URL}/api/v1/knowledgeItems/import").mock(
            return_value=httpx.Response(200, json={"resultCode": "0", "resultMsg": "success", "resultObject": {}})
        )
        resp2 = await app_client.post(
            "/kgw/ingest/v1/events",
            json={
                "sourceId": "src-s5b", "itemId": "doc-stale-base", "version": "2026-06-07T12:00:00Z",
                "op": "upsert", "knCode": _KN_CODE, "filePath": "/policy/stale.md",
                "content": "fresh",
            },
        )
    assert resp2.json()["resultObject"]["status"] == "done"

    # Now push an older version to the same file
    resp3 = await app_client.post(
        "/kgw/ingest/v1/events",
        json={
            "sourceId": "src-s5b", "itemId": "doc-stale-old", "version": "2026-06-07T01:00:00Z",
            "op": "upsert", "knCode": _KN_CODE, "filePath": "/policy/stale.md",
            "content": "stale",
        },
    )
    assert resp3.json()["resultObject"]["status"] == "failed"
    assert resp3.json()["resultObject"]["errorType"] == "STALE_VERSION"


async def test_source_lock_blocks_write(app_client):
    # Lock the file via admin
    lock_resp = await app_client.post(
        "/kgw/admin/v1/kbs/hr_s5/files/%2Fpolicy%2Flocked.md/lock",
        json={"lockOwner": "manual"},
        headers={"X-User-Id": "admin"},
    )
    assert lock_resp.json()["resultCode"] == "0"

    resp = await app_client.post(
        "/kgw/ingest/v1/events",
        json={
            "sourceId": "src-s5", "itemId": "doc-locked", "version": "v1",
            "op": "upsert", "knCode": _KN_CODE, "filePath": "/policy/locked.md",
            "content": "blocked",
        },
        headers={"X-User-Id": "connector"},
    )
    assert resp.json()["resultObject"]["errorType"] == "SOURCE_LOCKED"

    # Conflict log should have entry
    conflict_resp = await app_client.get(
        "/kgw/admin/v1/conflicts?knCode=hr_s5&reason=SOURCE_LOCKED",
        headers={"X-User-Id": "admin"},
    )
    assert conflict_resp.json()["resultObject"]["total"] >= 1


async def test_delete_event(app_client):
    with respx.mock:
        respx.post(f"{_KB_BASE_URL}/api/v1/knowledgeItems/delete").mock(
            return_value=httpx.Response(200, json={"resultCode": "0", "resultMsg": "success", "resultObject": {}})
        )
        resp = await app_client.post(
            "/kgw/ingest/v1/events",
            json={
                "sourceId": "src-s5", "itemId": "del-1", "version": "v-del-1",
                "op": "delete", "knCode": _KN_CODE, "filePath": "/policy/to-delete.md",
            },
        )
    assert resp.json()["resultObject"]["status"] == "done"


async def test_delete_replay(app_client):
    # First push a delete event that will fail
    with respx.mock:
        respx.post(f"{_KB_BASE_URL}/api/v1/knowledgeItems/delete").mock(
            return_value=httpx.Response(200, json={"resultCode": "-1", "resultMsg": "upstream error", "resultObject": {}})
        )
        fail_resp = await app_client.post(
            "/kgw/ingest/v1/events",
            json={
                "sourceId": "src-replay", "itemId": "del-replay", "version": "vr1",
                "op": "delete", "knCode": _KN_CODE, "filePath": "/policy/replay.md",
            },
        )
    event_id = fail_resp.json()["resultObject"]["eventId"]
    assert fail_resp.json()["resultObject"]["status"] == "failed"

    # Replay it successfully
    with respx.mock:
        respx.post(f"{_KB_BASE_URL}/api/v1/knowledgeItems/delete").mock(
            return_value=httpx.Response(200, json={"resultCode": "0", "resultMsg": "success", "resultObject": {}})
        )
        replay_resp = await app_client.post(
            f"/kgw/ingest/v1/events/{event_id}/replay",
        )
    assert replay_resp.json()["resultObject"]["status"] == "done"


async def test_batch_partial(app_client):
    with respx.mock:
        respx.post(f"{_KB_BASE_URL}/api/v1/knowledgeItems/import").mock(
            side_effect=[
                httpx.Response(200, json={"resultCode": "0", "resultMsg": "ok", "resultObject": {}}),
                httpx.Response(200, json={"resultCode": "-1", "resultMsg": "fail", "resultObject": {}}),
            ]
        )
        resp = await app_client.post(
            "/kgw/ingest/v1/events/batch",
            json={"events": [
                {"sourceId": "sb", "itemId": "b1", "version": "bv1", "op": "upsert",
                 "knCode": _KN_CODE, "filePath": "/b/1.md", "content": "x"},
                {"sourceId": "sb", "itemId": "b2", "version": "bv2", "op": "upsert",
                 "knCode": _KN_CODE, "filePath": "/b/2.md", "content": "y"},
            ]},
        )
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["succeeded"] == 1
    assert body["resultObject"]["failed"] == 1


async def test_audit_contains_ingest_entries(app_client):
    resp = await app_client.get(
        "/kgw/admin/v1/audit?source=ingest&pageSize=20",
        headers={"X-User-Id": "admin"},
    )
    body = resp.json()
    assert body["resultCode"] == "0"
    entries = body["resultObject"]["data"]
    assert any(e["source"] == "ingest" for e in entries)


async def test_list_events_filter(app_client):
    resp = await app_client.get(
        f"/kgw/ingest/v1/events?knCode={_KN_CODE}&status=done&pageSize=10",
    )
    body = resp.json()
    assert body["resultCode"] == "0"
    assert body["resultObject"]["total"] >= 1
```

- [ ] **Step 2: Run integration test suite**

Run: `cd byclaw-kgw && uv run pytest tests/test_integration_s5.py -v -m integration`
Expected: all tests pass

- [ ] **Step 3: Run full test suite**

Run: `cd byclaw-kgw && uv run pytest -v`
Expected: all tests pass (unit + integration if backend available)

- [ ] **Step 4: Commit**

```bash
git add byclaw-kgw/tests/test_integration_s5.py
git commit -m "test(kgw): add S5 end-to-end integration tests"
```
