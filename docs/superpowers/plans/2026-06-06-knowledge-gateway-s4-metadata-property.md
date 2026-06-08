# 知识网关 S4 metadataProperty 治理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 byclaw-kgw S4 阶段:metadataProperty 全局主目录、引用关系表、lazy 同步状态机、cleanup / reconcile 后台 worker、4 个主目录端点 + 4 个 admin 端点、写路径 binding 维护中间件、读路径字段名双向改写。

**Architecture:** 方案 D — 主目录用 `property_id` 代理键,`backend_name` 派生为 `__byclaw_kgw__{name}__v{property_id}`,新旧版本 schema 隔离。本地 binding 表承担引用计数,delete 校验 O(1) 无远程 IO。三轨状态机(主目录 ACTIVE/DELETED、sync SYNCING/SYNCED/FAILED/PURGING/PURGED/PURGE_FAILED、binding PENDING/SYNCED)互不耦合。三个后台 worker 用 `SELECT ... FOR UPDATE SKIP LOCKED` 多 Pod 安全。Lazy sync 在写路径(serve metadata/update / import、ingest events)前置触发,读路径只做字段名映射。

**Tech Stack:** Python 3.12, FastAPI, psycopg async (dict_row), aioboto3, redis.asyncio, pydantic v2, pytest + pytest-asyncio + respx + fakeredis, OpenGauss/PG, MinIO。沿用 byclaw-kgw 现有约定。

**Spec:** `docs/superpowers/specs/2026-06-06-knowledge-gateway-metadata-property-design.md`

---

## 文件结构

新增:

- `byclaw-kgw/sql/005_kgw_metadata_property.sql`
- `byclaw-kgw/sql/006_kgw_metadata_property_binding.sql`
- `byclaw-kgw/sql/007_kgw_metadata_property_sync.sql`
- `byclaw-kgw/src/kgw/metadata/__init__.py`
- `byclaw-kgw/src/kgw/metadata/registry.py`(主目录 CRUD + backend_name 派生)
- `byclaw-kgw/src/kgw/metadata/binding.py`(binding 操作 + outbox)
- `byclaw-kgw/src/kgw/metadata/sync.py`(sync 表 CRUD + ensure_synced)
- `byclaw-kgw/src/kgw/metadata/translator.py`(propertyName ↔ backend_name 双向改写)
- `byclaw-kgw/src/kgw/api/metadata_properties.py`(4 个主目录端点)
- `byclaw-kgw/src/kgw/api/admin_metadata.py`(4 个 admin 端点)
- `byclaw-kgw/src/kgw/workers/__init__.py`
- `byclaw-kgw/src/kgw/workers/cleanup.py`(cleanup worker)
- `byclaw-kgw/src/kgw/workers/binding_reconcile.py`(binding reconcile worker)
- 测试文件:`tests/test_metadata_registry.py` / `test_metadata_binding.py` / `test_metadata_sync.py` / `test_metadata_translator.py` / `test_api_metadata_properties.py` / `test_api_admin_metadata.py` / `test_workers_cleanup.py` / `test_workers_binding_reconcile.py` / `test_integration_s4.py`

修改:

- `byclaw-kgw/src/kgw/envelope.py`(新增 9 个错误类)
- `byclaw-kgw/src/kgw/api/knowledge_items.py`(`metadata/update` `metadata/get` `metadataFields/list` 端点 + binding 联动 + 字段改写)
- `byclaw-kgw/src/kgw/dispatcher.py` 或新 `dispatcher_metadata.py`(write 路径接入 binding 中间件;search/searchFile/metadataSearch DSL where 字段改写)
- `byclaw-kgw/src/kgw/main.py`(注册 router + lifespan 启动 worker)

## Task 1: SQL 迁移 — 三张新表

按 v5 spec 编号 SQL 风格新增 005-007;启动期 `run_migrations` 自动按字典序 apply,旧迁移已记录在 `kgw_migration` 表中,新文件首次运行才执行,幂等。

**Files:**
- Create: `byclaw-kgw/sql/005_kgw_metadata_property.sql`
- Create: `byclaw-kgw/sql/006_kgw_metadata_property_binding.sql`
- Create: `byclaw-kgw/sql/007_kgw_metadata_property_sync.sql`
- Test: `byclaw-kgw/tests/test_sql_migrations.py:*`(已有,本任务追加 assertion)

- [ ] **Step 1: 写迁移测试,断言三张新表 DDL 应用后存在**

修改 `byclaw-kgw/tests/test_sql_migrations.py`,在文件末尾追加(如已有 `_apply_all_migrations` 类似 helper 直接复用,否则参照同文件已有 003/004 测试模式):

```python
@pytest.mark.integration
async def test_s4_metadata_tables_created(integration_pool):
    async with integration_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_name IN "
                "('kgw_metadata_property',"
                " 'kgw_metadata_property_binding',"
                " 'kgw_metadata_binding_outbox',"
                " 'kgw_metadata_property_sync')"
            )
            rows = await cur.fetchall()
    names = {r["table_name"] for r in rows}
    assert names == {
        "kgw_metadata_property",
        "kgw_metadata_property_binding",
        "kgw_metadata_binding_outbox",
        "kgw_metadata_property_sync",
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd byclaw-kgw && uv run pytest tests/test_sql_migrations.py::test_s4_metadata_tables_created -m integration -v`
Expected: FAIL(table 不存在)。如果环境无 integration 设置,跳过执行,后续 Step 4 一并验证。

- [ ] **Step 3: 写 sql/005_kgw_metadata_property.sql**

```sql
CREATE TABLE IF NOT EXISTS kgw_metadata_property (
    property_id    BIGSERIAL    PRIMARY KEY,
    property_name  VARCHAR(128) NOT NULL,
    backend_name   VARCHAR(160) NOT NULL UNIQUE,
    value_type     VARCHAR(32)  NOT NULL,
    description    TEXT,
    ext_params     JSONB,
    status         VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_metadata_property_name_active
    ON kgw_metadata_property (property_name)
    WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_metadata_property_deleted
    ON kgw_metadata_property (deleted_at)
    WHERE status = 'DELETED';
```

- [ ] **Step 4: 写 sql/006_kgw_metadata_property_binding.sql**

```sql
CREATE TABLE IF NOT EXISTS kgw_metadata_property_binding (
    property_id   BIGINT       NOT NULL REFERENCES kgw_metadata_property(property_id) ON DELETE RESTRICT,
    kn_code       VARCHAR(64)  NOT NULL,
    file_path     VARCHAR(512) NOT NULL,
    status        VARCHAR(16)  NOT NULL,
    attempt_id    BIGINT       NOT NULL,
    bound_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (property_id, kn_code, file_path)
);

CREATE INDEX IF NOT EXISTS idx_binding_pending
    ON kgw_metadata_property_binding (status, bound_at)
    WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS kgw_metadata_binding_outbox (
    id            BIGSERIAL    PRIMARY KEY,
    property_id   BIGINT       NOT NULL,
    kn_code       VARCHAR(64)  NOT NULL,
    file_path     VARCHAR(512) NOT NULL,
    attempt_id    BIGINT       NOT NULL,
    reason        VARCHAR(64)  NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 5: 写 sql/007_kgw_metadata_property_sync.sql**

```sql
CREATE TABLE IF NOT EXISTS kgw_metadata_property_sync (
    property_id     BIGINT      NOT NULL REFERENCES kgw_metadata_property(property_id) ON DELETE CASCADE,
    kn_code         VARCHAR(64) NOT NULL,
    sync_status     VARCHAR(16) NOT NULL,
    last_sync_at    TIMESTAMPTZ,
    last_error      TEXT,
    PRIMARY KEY (property_id, kn_code)
);

CREATE INDEX IF NOT EXISTS idx_sync_status
    ON kgw_metadata_property_sync (sync_status)
    WHERE sync_status IN ('FAILED', 'PURGING', 'PURGE_FAILED');
```

- [ ] **Step 6: 跑迁移 + 测试通过**

Run: `cd byclaw-kgw && uv run pytest tests/test_sql_migrations.py -m integration -v`
Expected: 新增的 `test_s4_metadata_tables_created` PASS。

也可在本地启动 app 验证迁移自动跑:`cd byclaw-kgw && uv run uvicorn kgw.main:app --port 18086`,启动日志中 `db.migration.applied` 应包含 `005_*.sql` / `006_*.sql` / `007_*.sql`。

- [ ] **Step 7: Commit**

```bash
git add byclaw-kgw/sql/005_kgw_metadata_property.sql \
        byclaw-kgw/sql/006_kgw_metadata_property_binding.sql \
        byclaw-kgw/sql/007_kgw_metadata_property_sync.sql \
        byclaw-kgw/tests/test_sql_migrations.py
git commit -m "feat(kgw): add S4 metadataProperty SQL migrations 005-007"
```

## Task 2: envelope 错误类型扩展(9 个 metadataProperty 错误)

按 spec §3.14 表新增 9 个错误类。沿用现有 `KgwError` 基类风格(每个子类只声明 `error_type`)。

**Files:**
- Modify: `byclaw-kgw/src/kgw/envelope.py`(末尾追加)
- Test: `byclaw-kgw/tests/test_envelope.py`

- [ ] **Step 1: 写 envelope 错误类单元测试**

在 `byclaw-kgw/tests/test_envelope.py` 末尾追加:

```python
from kgw.envelope import (
    INVALID_BATCH_DUPLICATE_NAME,
    INVALID_FIELD_VALUE_TYPE,
    INVALID_OPERATION_FOR_TYPE,
    INVALID_VALUE_TYPE,
    MetadataPropertyAlreadyExists,
    MetadataPropertyConflict,
    MetadataPropertyInUse,
    MetadataPropertyNotFound,
    MetadataPropertySyncFailed,
)


def test_metadata_property_not_found_envelope():
    err = MetadataPropertyNotFound("metadata property not found: status",
                                   property_name="status")
    env = err.to_envelope()
    assert env["resultCode"] == "-1"
    assert env["resultObject"]["errorCode"] == "MetadataPropertyNotFound"
    assert env["resultObject"]["propertyName"] == "status"


def test_metadata_property_in_use_envelope():
    err = MetadataPropertyInUse(
        "metadata property is still referenced: status",
        property_name="status",
        in_use_samples=[{"knCode": "2", "filePath": "/a.md"}],
        total_references=1,
    )
    env = err.to_envelope()
    assert env["resultObject"]["errorCode"] == "MetadataPropertyInUse"
    assert env["resultObject"]["totalReferences"] == 1


def test_all_metadata_error_types_have_correct_string():
    cases = [
        (MetadataPropertyNotFound, "MetadataPropertyNotFound"),
        (MetadataPropertyAlreadyExists, "MetadataPropertyAlreadyExists"),
        (MetadataPropertyInUse, "MetadataPropertyInUse"),
        (MetadataPropertySyncFailed, "MetadataPropertySyncFailed"),
        (MetadataPropertyConflict, "MetadataPropertyConflict"),
        (INVALID_VALUE_TYPE, "INVALID_VALUE_TYPE"),
        (INVALID_OPERATION_FOR_TYPE, "INVALID_OPERATION_FOR_TYPE"),
        (INVALID_FIELD_VALUE_TYPE, "INVALID_FIELD_VALUE_TYPE"),
        (INVALID_BATCH_DUPLICATE_NAME, "INVALID_BATCH_DUPLICATE_NAME"),
    ]
    for cls, expected in cases:
        assert cls.error_type == expected
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd byclaw-kgw && uv run pytest tests/test_envelope.py -v`
Expected: ImportError(对应类未定义)。

- [ ] **Step 3: 在 envelope.py 末尾追加 9 个错误类**

```python
class MetadataPropertyNotFound(KgwError):
    error_type = "MetadataPropertyNotFound"


class MetadataPropertyAlreadyExists(KgwError):
    error_type = "MetadataPropertyAlreadyExists"


class MetadataPropertyInUse(KgwError):
    error_type = "MetadataPropertyInUse"


class MetadataPropertySyncFailed(KgwError):
    error_type = "MetadataPropertySyncFailed"


class MetadataPropertyConflict(KgwError):
    error_type = "MetadataPropertyConflict"


# Validation errors keep the metadata_api.md uppercase-snake style for
# easier alignment with portal-side validation messages.
class INVALID_VALUE_TYPE(KgwError):  # noqa: N801 (intentional: matches API spec string)
    error_type = "INVALID_VALUE_TYPE"


class INVALID_OPERATION_FOR_TYPE(KgwError):  # noqa: N801
    error_type = "INVALID_OPERATION_FOR_TYPE"


class INVALID_FIELD_VALUE_TYPE(KgwError):  # noqa: N801
    error_type = "INVALID_FIELD_VALUE_TYPE"


class INVALID_BATCH_DUPLICATE_NAME(KgwError):  # noqa: N801
    error_type = "INVALID_BATCH_DUPLICATE_NAME"
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd byclaw-kgw && uv run pytest tests/test_envelope.py -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add byclaw-kgw/src/kgw/envelope.py byclaw-kgw/tests/test_envelope.py
git commit -m "feat(kgw): add S4 metadataProperty error taxonomy"
```

## Task 3: metadata.registry — 主目录 CRUD 与 backend_name 派生

封装 `kgw_metadata_property` 表的所有读写。这一层不感知 binding / sync;后续 API 层、translator、worker 都依赖这一层。

**Files:**
- Create: `byclaw-kgw/src/kgw/metadata/__init__.py`(空文件)
- Create: `byclaw-kgw/src/kgw/metadata/registry.py`
- Test: `byclaw-kgw/tests/test_metadata_registry.py`

- [ ] **Step 1: 写 registry 单元测试**

新建 `byclaw-kgw/tests/test_metadata_registry.py`(integration 标记,因为依赖真实 PG 验证 partial unique index 行为;沿用现有 `integration_pool` fixture):

```python
import pytest
from kgw.envelope import MetadataPropertyAlreadyExists, MetadataPropertyNotFound
from kgw.metadata.registry import (
    MetadataProperty,
    create_property,
    delete_property_to_deleted,
    derive_backend_name,
    get_active_property,
    list_active_properties,
)

pytestmark = pytest.mark.integration


def test_derive_backend_name_format():
    assert derive_backend_name("status", 7) == "__byclaw_kgw__status__v7"
    assert derive_backend_name("a_b", 12345) == "__byclaw_kgw__a_b__v12345"


async def test_create_then_get_active(integration_pool):
    p = await create_property(integration_pool, property_name="t_status",
                              value_type="string", description="d",
                              ext_params={"k": "v"})
    assert p.property_name == "t_status"
    assert p.backend_name == f"__byclaw_kgw__t_status__v{p.property_id}"
    got = await get_active_property(integration_pool, "t_status")
    assert got.property_id == p.property_id


async def test_create_duplicate_active_raises(integration_pool):
    await create_property(integration_pool, property_name="t_dup",
                          value_type="string")
    with pytest.raises(MetadataPropertyAlreadyExists):
        await create_property(integration_pool, property_name="t_dup",
                              value_type="number")


async def test_delete_then_recreate_same_name(integration_pool):
    p1 = await create_property(integration_pool, property_name="t_recreate",
                               value_type="string")
    await delete_property_to_deleted(integration_pool, p1.property_id)
    p2 = await create_property(integration_pool, property_name="t_recreate",
                               value_type="number")
    assert p2.property_id != p1.property_id
    assert p2.backend_name != p1.backend_name


async def test_get_active_missing_raises(integration_pool):
    with pytest.raises(MetadataPropertyNotFound):
        await get_active_property(integration_pool, "t_missing")
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd byclaw-kgw && uv run pytest tests/test_metadata_registry.py -m integration -v`
Expected: ImportError(模块不存在)。

- [ ] **Step 3: 创建 metadata 包初始化文件**

写 `byclaw-kgw/src/kgw/metadata/__init__.py` 内容为空(单个换行)。

- [ ] **Step 4: 实现 registry.py**

写 `byclaw-kgw/src/kgw/metadata/registry.py`(注意:psycopg `dict_row` 工厂返回 dict,捕获 unique 冲突用 `psycopg.errors.UniqueViolation`):

```python
"""metadataProperty 全局主目录 CRUD + backend_name 派生。

主键 ``property_id`` 是代理键。``property_name`` 仅在 ``status='ACTIVE'``
范围内唯一(由 partial unique index 强制),DELETED 行不参与名字唯一性,
支持同名再造。``backend_name`` 由 (property_name, property_id) 派生,
保证新旧版本在后端 schema 层永不撞名。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import psycopg
from kgw.envelope import (
    MetadataPropertyAlreadyExists,
    MetadataPropertyNotFound,
)
from psycopg_pool import AsyncConnectionPool

BACKEND_PREFIX = "__byclaw_kgw__"


def derive_backend_name(property_name: str, property_id: int) -> str:
    return f"{BACKEND_PREFIX}{property_name}__v{property_id}"


@dataclass(frozen=True)
class MetadataProperty:
    property_id: int
    property_name: str
    backend_name: str
    value_type: str
    description: str | None
    ext_params: dict[str, Any] | None
    status: str  # ACTIVE / DELETED
```

- [ ] **Step 5: 在 registry.py 追加 `create_property`**

```python
async def create_property(
    pool: AsyncConnectionPool,
    *,
    property_name: str,
    value_type: str,
    description: str | None = None,
    ext_params: dict[str, Any] | None = None,
) -> MetadataProperty:
    """两步插入:先 INSERT 拿 property_id,再 UPDATE 写 backend_name。

    捕获 partial unique index 冲突 → MetadataPropertyAlreadyExists。
    """
    async with pool.connection() as conn:
        async with conn.transaction():
            try:
                async with conn.cursor() as cur:
                    await cur.execute(
                        """
                        INSERT INTO kgw_metadata_property
                            (property_name, backend_name, value_type,
                             description, ext_params, status)
                        VALUES (%s, '__placeholder__', %s, %s, %s, 'ACTIVE')
                        RETURNING property_id
                        """,
                        (property_name, value_type, description,
                         psycopg.types.json.Jsonb(ext_params)
                         if ext_params is not None else None),
                    )
                    row = await cur.fetchone()
                    property_id = row["property_id"]
                    backend_name = derive_backend_name(property_name, property_id)
                    await cur.execute(
                        "UPDATE kgw_metadata_property SET backend_name=%s "
                        "WHERE property_id=%s",
                        (backend_name, property_id),
                    )
            except psycopg.errors.UniqueViolation as exc:
                raise MetadataPropertyAlreadyExists(
                    f"metadata property already exists: {property_name}",
                    property_name=property_name,
                ) from exc
    return MetadataProperty(
        property_id=property_id,
        property_name=property_name,
        backend_name=backend_name,
        value_type=value_type,
        description=description,
        ext_params=ext_params,
        status="ACTIVE",
    )
```

- [ ] **Step 6: 追加 `get_active_property` / `list_active_properties` / `delete_property_to_deleted` / `get_property_by_id`**

```python
async def get_active_property(
    pool: AsyncConnectionPool, property_name: str
) -> MetadataProperty:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id, property_name, backend_name, value_type, "
                "       description, ext_params, status "
                "FROM kgw_metadata_property "
                "WHERE property_name=%s AND status='ACTIVE'",
                (property_name,),
            )
            row = await cur.fetchone()
    if not row:
        raise MetadataPropertyNotFound(
            f"metadata property not found: {property_name}",
            property_name=property_name,
        )
    return _row_to_property(row)


async def get_property_by_id(
    pool: AsyncConnectionPool, property_id: int
) -> MetadataProperty | None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id, property_name, backend_name, value_type, "
                "       description, ext_params, status "
                "FROM kgw_metadata_property WHERE property_id=%s",
                (property_id,),
            )
            row = await cur.fetchone()
    return _row_to_property(row) if row else None


async def list_active_properties(
    pool: AsyncConnectionPool,
    property_names: list[str] | None = None,
) -> list[MetadataProperty]:
    sql = (
        "SELECT property_id, property_name, backend_name, value_type, "
        "       description, ext_params, status "
        "FROM kgw_metadata_property WHERE status='ACTIVE'"
    )
    params: tuple[Any, ...] = ()
    if property_names:
        sql += " AND property_name = ANY(%s)"
        params = (list(property_names),)
    sql += " ORDER BY property_name"
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params)
            rows = await cur.fetchall()
    return [_row_to_property(r) for r in rows]


def _row_to_property(row: dict[str, Any]) -> MetadataProperty:
    return MetadataProperty(
        property_id=row["property_id"],
        property_name=row["property_name"],
        backend_name=row["backend_name"],
        value_type=row["value_type"],
        description=row.get("description"),
        ext_params=row.get("ext_params"),
        status=row["status"],
    )
```

- [ ] **Step 7: 追加 `delete_property_to_deleted`(状态翻转,不物理删)**

注:这个函数仅做主目录的 `ACTIVE → DELETED` 翻转;binding 占用校验、sync 行批量翻转由 API 层(Task 8)在同事务内处理。Task 11 cleanup worker 检测到 sync 全部 PURGED 时执行物理删。

```python
async def delete_property_to_deleted(
    pool: AsyncConnectionPool, property_id: int
) -> None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_metadata_property "
                "SET status='DELETED', deleted_at=NOW() "
                "WHERE property_id=%s AND status='ACTIVE'",
                (property_id,),
            )


async def hard_delete_property(
    pool: AsyncConnectionPool, property_id: int
) -> None:
    """物理删 DELETED 行;仅供 cleanup worker 在 sync 全部 PURGED 后调用。"""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_metadata_property "
                "WHERE property_id=%s AND status='DELETED'",
                (property_id,),
            )
```

- [ ] **Step 8: 跑测试通过**

Run: `cd byclaw-kgw && uv run pytest tests/test_metadata_registry.py -m integration -v`
Expected: 全部 PASS。

确认 `tests/test_smoke_imports.py` 也包括了新模块导入(若有,自动通过;若没有,跑 `uv run python -c "from kgw.metadata import registry"` 验证可导入)。

- [ ] **Step 9: Commit**

```bash
git add byclaw-kgw/src/kgw/metadata/__init__.py \
        byclaw-kgw/src/kgw/metadata/registry.py \
        byclaw-kgw/tests/test_metadata_registry.py
git commit -m "feat(kgw): add metadata.registry CRUD with backend_name derivation"
```

## Task 4: metadata.sync — sync 表 CRUD + ensure_synced(lazy 同步)

承担状态轨 2:`SYNCING / SYNCED / FAILED / PURGING / PURGED / PURGE_FAILED`。`ensure_synced` 是 lazy sync 的入口,被写路径(metadata/update、import、ingest events)在写 binding 之前调用。

按 spec §4.3 实现注意,**两段事务**:T1 持有 advisory lock + UPSERT SYNCING + commit;T2 在 advisory lock 释放后调后端 + UPDATE SYNCED/FAILED + commit。advisory lock 在 T2 期间不再持有,并发由 SYNCING 状态本身配合短轮询兜住。

**Files:**
- Create: `byclaw-kgw/src/kgw/metadata/sync.py`
- Test: `byclaw-kgw/tests/test_metadata_sync.py`

- [ ] **Step 1: 写 sync 单元测试**

新建 `byclaw-kgw/tests/test_metadata_sync.py`:

```python
import pytest
import respx
from httpx import Response
from kgw.envelope import MetadataPropertySyncFailed
from kgw.metadata.registry import create_property
from kgw.metadata.sync import (
    SyncStatus,
    ensure_synced,
    get_sync_status,
    upsert_purging_for_synced,
    list_synced_property_ids_for_kn,
)

pytestmark = pytest.mark.integration


async def test_first_use_creates_synced_row(integration_pool, http_client,
                                              kb_config_resolver_factory):
    p = await create_property(integration_pool, property_name="t_sync1",
                              value_type="string")
    resolver = kb_config_resolver_factory({"hr": "http://kb-hr.test"})
    with respx.mock(base_url="http://kb-hr.test") as mock:
        mock.post("/api/v1/metadataProperties/batchCreate").mock(
            return_value=Response(200, json={"resultCode": "0",
                                              "resultMsg": "success",
                                              "resultObject": {}})
        )
        await ensure_synced(integration_pool, http_client, resolver,
                            property_id=p.property_id, kn_code="hr")
    status = await get_sync_status(integration_pool, p.property_id, "hr")
    assert status == SyncStatus.SYNCED


async def test_backend_failure_marks_failed(integration_pool, http_client,
                                             kb_config_resolver_factory):
    p = await create_property(integration_pool, property_name="t_sync2",
                              value_type="string")
    resolver = kb_config_resolver_factory({"hr": "http://kb-hr.test"})
    with respx.mock(base_url="http://kb-hr.test") as mock:
        mock.post("/api/v1/metadataProperties/batchCreate").mock(
            return_value=Response(500, json={})
        )
        with pytest.raises(MetadataPropertySyncFailed):
            await ensure_synced(integration_pool, http_client, resolver,
                                property_id=p.property_id, kn_code="hr")
    status = await get_sync_status(integration_pool, p.property_id, "hr")
    assert status == SyncStatus.FAILED
```

- [ ] **Step 2: 跑测试确认失败(模块不存在)**

注:`kb_config_resolver_factory` fixture 需要在 `tests/conftest.py` 增加(见 Step 6),首次跑会因 fixture 未定义失败。先继续写实现。

- [ ] **Step 3: 实现 sync.py 顶层 + 状态枚举**

写 `byclaw-kgw/src/kgw/metadata/sync.py`:

```python
"""metadataProperty per-KB 同步状态 + lazy sync(ensure_synced)。

状态轨 2:SYNCING / SYNCED / FAILED / PURGING / PURGED / PURGE_FAILED。
``ensure_synced`` 是 lazy sync 入口,被写路径在写 binding 之前调用,
保证目标后端已物化对应的 ``__byclaw_kgw__{name}__v{id}`` 列。
"""

from __future__ import annotations

import enum
import hashlib
from typing import Awaitable, Callable

import httpx
from kgw.envelope import MetadataPropertySyncFailed
from kgw.metadata.registry import get_property_by_id
from kgw.observability.logger import get_logger
from psycopg_pool import AsyncConnectionPool

_log = get_logger(__name__)


class SyncStatus(str, enum.Enum):
    SYNCING = "SYNCING"
    SYNCED = "SYNCED"
    FAILED = "FAILED"
    PURGING = "PURGING"
    PURGED = "PURGED"
    PURGE_FAILED = "PURGE_FAILED"


# Resolver: maps kn_code -> backend endpoint URL.
KbEndpointResolver = Callable[[str], Awaitable[str]]


def _advisory_lock_key(property_id: int, kn_code: str) -> int:
    """Pack (property_id, kn_code) into a 63-bit signed bigint for PG advisory lock."""
    digest = hashlib.blake2b(
        f"{property_id}:{kn_code}".encode(), digest_size=8
    ).digest()
    val = int.from_bytes(digest, "big", signed=False) & ((1 << 63) - 1)
    return val
```

- [ ] **Step 4: 追加 sync 表读函数 + 状态批量翻转**

```python
async def get_sync_status(
    pool: AsyncConnectionPool, property_id: int, kn_code: str
) -> SyncStatus | None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT sync_status FROM kgw_metadata_property_sync "
                "WHERE property_id=%s AND kn_code=%s",
                (property_id, kn_code),
            )
            row = await cur.fetchone()
    return SyncStatus(row["sync_status"]) if row else None


async def list_synced_property_ids_for_kn(
    pool: AsyncConnectionPool, kn_code: str
) -> list[int]:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id FROM kgw_metadata_property_sync "
                "WHERE kn_code=%s AND sync_status='SYNCED'",
                (kn_code,),
            )
            rows = await cur.fetchall()
    return [r["property_id"] for r in rows]


async def upsert_purging_for_synced(
    conn, property_id: int
) -> None:
    """delete API 同事务调用:SYNCED → PURGING;FAILED/SYNCING → 直接 DELETE。

    ``conn`` 必须由调用方提供并在外层事务内,保证与主目录 status 翻转
    + binding 校验在同一事务原子提交。
    """
    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE kgw_metadata_property_sync SET sync_status='PURGING' "
            "WHERE property_id=%s AND sync_status='SYNCED'",
            (property_id,),
        )
        await cur.execute(
            "DELETE FROM kgw_metadata_property_sync "
            "WHERE property_id=%s AND sync_status IN ('FAILED','SYNCING')",
            (property_id,),
        )
```

- [ ] **Step 5: 实现 `ensure_synced`(两段事务)**

```python
async def ensure_synced(
    pool: AsyncConnectionPool,
    http: httpx.AsyncClient,
    resolve_endpoint: KbEndpointResolver,
    *,
    property_id: int,
    kn_code: str,
    timeout_seconds: float = 15.0,
) -> None:
    """Lazy-sync 入口。失败抛 ``MetadataPropertySyncFailed``,业务自上层兜底。"""
    # 1. 快路径
    current = await get_sync_status(pool, property_id, kn_code)
    if current == SyncStatus.SYNCED:
        return

    lock_key = _advisory_lock_key(property_id, kn_code)

    # 2. T1:advisory lock + UPSERT SYNCING + commit。lock 在事务结束自动释放。
    async with pool.connection() as conn_t1:
        async with conn_t1.transaction():
            async with conn_t1.cursor() as cur:
                await cur.execute(
                    "SELECT pg_advisory_xact_lock(%s)", (lock_key,)
                )
                await cur.execute(
                    "SELECT sync_status FROM kgw_metadata_property_sync "
                    "WHERE property_id=%s AND kn_code=%s",
                    (property_id, kn_code),
                )
                existing = await cur.fetchone()
                if existing and existing["sync_status"] == SyncStatus.SYNCED.value:
                    return  # 双检:其他 Pod 抢先完成
                await cur.execute(
                    "INSERT INTO kgw_metadata_property_sync "
                    "(property_id, kn_code, sync_status, last_sync_at, last_error) "
                    "VALUES (%s, %s, 'SYNCING', NOW(), NULL) "
                    "ON CONFLICT (property_id, kn_code) DO UPDATE "
                    "SET sync_status='SYNCING', last_sync_at=NOW(), last_error=NULL",
                    (property_id, kn_code),
                )

    # 3. T2:调后端 batchCreate + UPDATE SYNCED/FAILED。
    prop = await get_property_by_id(pool, property_id)
    assert prop is not None, "property must exist when ensure_synced called"
    endpoint = await resolve_endpoint(kn_code)
    try:
        resp = await http.post(
            f"{endpoint}/api/v1/metadataProperties/batchCreate",
            json={"propertyList": [{
                "propertyName": prop.backend_name,
                "valueType": prop.value_type,
            }]},
            timeout=timeout_seconds,
        )
        ok = resp.status_code == 200 and resp.json().get("resultCode") == "0"
    except (httpx.HTTPError, ValueError) as exc:
        await _mark_failed(pool, property_id, kn_code, repr(exc))
        raise MetadataPropertySyncFailed(
            f"backend sync failed: {exc!r}",
            property_name=prop.property_name, kn_code=kn_code,
        ) from exc

    if not ok:
        await _mark_failed(pool, property_id, kn_code,
                           f"upstream resultCode != 0: {resp.text[:200]}")
        raise MetadataPropertySyncFailed(
            "backend batchCreate did not return success",
            property_name=prop.property_name, kn_code=kn_code,
        )
    await _mark_synced(pool, property_id, kn_code)
```

- [ ] **Step 6: 追加 `_mark_synced` / `_mark_failed` 辅助函数 + conftest fixture**

在 sync.py 末尾追加:

```python
async def _mark_synced(
    pool: AsyncConnectionPool, property_id: int, kn_code: str
) -> None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_metadata_property_sync SET sync_status='SYNCED', "
                "last_sync_at=NOW(), last_error=NULL "
                "WHERE property_id=%s AND kn_code=%s",
                (property_id, kn_code),
            )


async def _mark_failed(
    pool: AsyncConnectionPool, property_id: int, kn_code: str, error: str
) -> None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_metadata_property_sync SET sync_status='FAILED', "
                "last_sync_at=NOW(), last_error=%s "
                "WHERE property_id=%s AND kn_code=%s",
                (error, property_id, kn_code),
            )
```

在 `byclaw-kgw/tests/conftest.py` 增加 `kb_config_resolver_factory` fixture(若已有同名 fixture,则跳过):

```python
@pytest.fixture
def kb_config_resolver_factory():
    """Return a factory that builds an async resolver from kn_code -> URL dict."""
    def _factory(mapping):
        async def _resolve(kn_code: str) -> str:
            return mapping[kn_code]
        return _resolve
    return _factory
```

`http_client` fixture 已经存在(用于现有 dispatcher 测试),复用即可。

- [ ] **Step 7: 跑 sync 测试**

Run: `cd byclaw-kgw && uv run pytest tests/test_metadata_sync.py -m integration -v`
Expected: 全部 PASS。

- [ ] **Step 8: Commit**

```bash
git add byclaw-kgw/src/kgw/metadata/sync.py \
        byclaw-kgw/tests/test_metadata_sync.py \
        byclaw-kgw/tests/conftest.py
git commit -m "feat(kgw): add metadata.sync ensure_synced (lazy two-stage txn)"
```

## Task 5: metadata.binding — 引用关系 CRUD + outbox

承担状态轨 3。包含:`upsert_pending` / `mark_synced_by_attempt` / `delete_by_attempt` / `delete_by_file` / `delete_by_directory` / `count_in_use` / `sample_in_use`(给 delete API 占用清单用)/ `write_outbox`。

**Files:**
- Create: `byclaw-kgw/src/kgw/metadata/binding.py`
- Test: `byclaw-kgw/tests/test_metadata_binding.py`

- [ ] **Step 1: 写 binding 单元测试**

```python
import pytest
from kgw.metadata.binding import (
    BindingRow,
    count_in_use,
    delete_by_attempt,
    delete_by_directory,
    delete_by_file,
    mark_synced_by_attempt,
    sample_in_use,
    upsert_pending,
)
from kgw.metadata.registry import create_property

pytestmark = pytest.mark.integration


async def test_upsert_pending_then_synced(integration_pool):
    p = await create_property(integration_pool, property_name="t_b1",
                              value_type="string")
    aid = 12345
    async with integration_pool.connection() as conn:
        async with conn.transaction():
            await upsert_pending(conn, property_id=p.property_id,
                                 kn_code="hr", file_path="/a.md",
                                 attempt_id=aid)
    assert await count_in_use(integration_pool, p.property_id) == 1
    await mark_synced_by_attempt(integration_pool, attempt_id=aid)
    samples = await sample_in_use(integration_pool, p.property_id, limit=5)
    assert any(s["file_path"] == "/a.md" for s in samples)


async def test_delete_by_attempt_rolls_back_pending(integration_pool):
    p = await create_property(integration_pool, property_name="t_b2",
                              value_type="string")
    aid = 22222
    async with integration_pool.connection() as conn:
        async with conn.transaction():
            await upsert_pending(conn, property_id=p.property_id,
                                 kn_code="hr", file_path="/x.md",
                                 attempt_id=aid)
    assert await delete_by_attempt(integration_pool, aid) == 1
    assert await count_in_use(integration_pool, p.property_id) == 0


async def test_delete_by_file_removes_all_bindings(integration_pool):
    p1 = await create_property(integration_pool, property_name="t_b3a",
                               value_type="string")
    p2 = await create_property(integration_pool, property_name="t_b3b",
                               value_type="string")
    async with integration_pool.connection() as conn:
        async with conn.transaction():
            await upsert_pending(conn, property_id=p1.property_id,
                                 kn_code="hr", file_path="/y.md",
                                 attempt_id=1)
            await upsert_pending(conn, property_id=p2.property_id,
                                 kn_code="hr", file_path="/y.md",
                                 attempt_id=2)
    deleted = await delete_by_file(integration_pool, kn_code="hr",
                                   file_path="/y.md")
    assert deleted == 2
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd byclaw-kgw && uv run pytest tests/test_metadata_binding.py -m integration -v`
Expected: ImportError。

- [ ] **Step 3: 实现 binding.py**

写 `byclaw-kgw/src/kgw/metadata/binding.py`(含 attempt_id 生成,使用单调时间 + 随机数):

```python
"""metadataProperty 文件引用关系(状态轨 3)。

``upsert_pending`` 必须在调用方提供的事务中执行,与外层"先 binding 后端"
语义对齐。``mark_synced_by_attempt`` / ``delete_by_attempt`` 等推进函数
独立事务,允许在调用后端响应后单独提交。
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass

from psycopg_pool import AsyncConnectionPool


@dataclass(frozen=True)
class BindingRow:
    property_id: int
    kn_code: str
    file_path: str
    status: str  # PENDING / SYNCED
    attempt_id: int


def new_attempt_id() -> int:
    """单调时间纳秒 + 16-bit 随机后缀,在单 Pod 内强单调,跨 Pod 极低概率冲突。"""
    return (time.monotonic_ns() << 16) | random.getrandbits(16)


async def upsert_pending(
    conn,
    *,
    property_id: int,
    kn_code: str,
    file_path: str,
    attempt_id: int,
) -> None:
    async with conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO kgw_metadata_property_binding "
            "(property_id, kn_code, file_path, status, attempt_id, bound_at) "
            "VALUES (%s, %s, %s, 'PENDING', %s, NOW()) "
            "ON CONFLICT (property_id, kn_code, file_path) DO UPDATE "
            "SET status='PENDING', attempt_id=EXCLUDED.attempt_id, "
            "    bound_at=NOW()",
            (property_id, kn_code, file_path, attempt_id),
        )
```

- [ ] **Step 4: 追加 mark_synced / delete_by_* / count_in_use / sample_in_use**

```python
async def mark_synced_by_attempt(
    pool: AsyncConnectionPool, *, attempt_id: int
) -> int:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_metadata_property_binding SET status='SYNCED' "
                "WHERE attempt_id=%s",
                (attempt_id,),
            )
            return cur.rowcount


async def delete_by_attempt(
    pool: AsyncConnectionPool, attempt_id: int
) -> int:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_metadata_property_binding "
                "WHERE attempt_id=%s",
                (attempt_id,),
            )
            return cur.rowcount


async def delete_by_file(
    pool: AsyncConnectionPool, *, kn_code: str, file_path: str
) -> int:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_metadata_property_binding "
                "WHERE kn_code=%s AND file_path=%s",
                (kn_code, file_path),
            )
            return cur.rowcount


async def delete_by_directory(
    pool: AsyncConnectionPool, *, kn_code: str, directory_path: str
) -> int:
    """按目录前缀删除该目录下所有文件的 binding。``directory_path`` 不含尾斜杠。"""
    prefix = directory_path.rstrip("/") + "/"
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_metadata_property_binding "
                "WHERE kn_code=%s AND file_path LIKE %s",
                (kn_code, prefix + "%"),
            )
            return cur.rowcount


async def delete_by_property_op(
    conn, *, property_id: int, kn_code: str, file_path: str
) -> None:
    """metadata/update unset/clear 后,在同事务里删特定 (property, file) binding。"""
    async with conn.cursor() as cur:
        await cur.execute(
            "DELETE FROM kgw_metadata_property_binding "
            "WHERE property_id=%s AND kn_code=%s AND file_path=%s",
            (property_id, kn_code, file_path),
        )
```

- [ ] **Step 5: 追加 count / sample / outbox 操作**

```python
async def count_in_use(
    pool: AsyncConnectionPool, property_id: int
) -> int:
    """delete API 用:返回该 property_id 在 binding 表中的占用行数(PENDING+SYNCED 都算)。"""
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) AS c FROM kgw_metadata_property_binding "
                "WHERE property_id=%s AND status IN ('PENDING','SYNCED')",
                (property_id,),
            )
            row = await cur.fetchone()
    return row["c"]


async def sample_in_use(
    pool: AsyncConnectionPool, property_id: int, *, limit: int = 5
) -> list[dict]:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT kn_code, file_path FROM kgw_metadata_property_binding "
                "WHERE property_id=%s AND status IN ('PENDING','SYNCED') "
                "ORDER BY bound_at DESC LIMIT %s",
                (property_id, limit),
            )
            rows = await cur.fetchall()
    return [{"knCode": r["kn_code"], "filePath": r["file_path"]} for r in rows]


async def write_outbox(
    pool: AsyncConnectionPool,
    *,
    property_id: int,
    kn_code: str,
    file_path: str,
    attempt_id: int,
    reason: str = "ROLLBACK_FAILED",
) -> None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_binding_outbox "
                "(property_id, kn_code, file_path, attempt_id, reason) "
                "VALUES (%s, %s, %s, %s, %s)",
                (property_id, kn_code, file_path, attempt_id, reason),
            )
```

- [ ] **Step 6: 跑 binding 测试**

Run: `cd byclaw-kgw && uv run pytest tests/test_metadata_binding.py -m integration -v`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add byclaw-kgw/src/kgw/metadata/binding.py \
        byclaw-kgw/tests/test_metadata_binding.py
git commit -m "feat(kgw): add metadata.binding CRUD + outbox helpers"
```

## Task 6: metadata.translator — propertyName ↔ backend_name 双向改写

提供纯函数:

- `translate_request_metadata(payload, name_to_backend)` — 写路径(import / metadata/update operationList / metadata/get metadataFieldList)。
- `translate_request_dsl_where(where, name_to_backend)` — 读路径 search/searchFile/metadataSearch 的 `where` AST 字段名改写。
- `translate_response_metadata(payload, backend_to_name)` — 后端响应 `metadata.{backend_name}` 反向改回 `metadata.{propertyName}`。

不识别的字段名(系统字段如 `fileType`)透传不改;不在主目录 ACTIVE 中的字段名由调用方校验,translator 自身不抛错(只做映射)。

**Files:**
- Create: `byclaw-kgw/src/kgw/metadata/translator.py`
- Test: `byclaw-kgw/tests/test_metadata_translator.py`

- [ ] **Step 1: 写 translator 单元测试**(纯单测,不需要 integration)

```python
from kgw.metadata.translator import (
    translate_request_dsl_where,
    translate_request_metadata,
    translate_response_metadata,
)


N2B = {"status": "__byclaw_kgw__status__v7", "tags": "__byclaw_kgw__tags__v8"}
B2N = {v: k for k, v in N2B.items()}


def test_translate_request_metadata_dict_keys():
    payload = {"metadata": {"status": "active", "fileType": "md"}}
    out = translate_request_metadata(payload, N2B)
    assert out["metadata"] == {
        "__byclaw_kgw__status__v7": "active",
        "fileType": "md",  # 系统字段透传
    }


def test_translate_request_metadata_operation_list():
    payload = {
        "operationList": [
            {"propertyName": "status", "operation": "set", "value": "x"},
            {"propertyName": "tags", "operation": "append", "value": ["a"]},
            {"propertyName": "unknown", "operation": "set", "value": "y"},
        ]
    }
    out = translate_request_metadata(payload, N2B)
    names = [op["propertyName"] for op in out["operationList"]]
    assert names == ["__byclaw_kgw__status__v7",
                     "__byclaw_kgw__tags__v8", "unknown"]


def test_translate_request_metadata_field_list():
    payload = {"metadataFieldList": ["status", "tags", "fileType"]}
    out = translate_request_metadata(payload, N2B)
    assert out["metadataFieldList"] == [
        "__byclaw_kgw__status__v7", "__byclaw_kgw__tags__v8", "fileType",
    ]
```

- [ ] **Step 2: 在 test_metadata_translator.py 末尾追加 DSL where 与响应改写测试**

```python
def test_translate_dsl_where_leaf():
    where = {"eq": {"fieldName": "status", "value": "active"}}
    out = translate_request_dsl_where(where, N2B)
    assert out == {"eq": {"fieldName": "__byclaw_kgw__status__v7",
                          "value": "active"}}


def test_translate_dsl_where_nested():
    where = {
        "and": [
            {"eq": {"fieldName": "status", "value": "active"}},
            {"or": [
                {"contains": {"fieldName": "tags", "value": "x"}},
                {"not": {"exists": {"fieldName": "fileType"}}},
            ]},
        ]
    }
    out = translate_request_dsl_where(where, N2B)
    assert out["and"][0]["eq"]["fieldName"] == "__byclaw_kgw__status__v7"
    assert out["and"][1]["or"][0]["contains"]["fieldName"] == "__byclaw_kgw__tags__v8"
    # fileType 系统字段透传
    assert out["and"][1]["or"][1]["not"]["exists"]["fieldName"] == "fileType"


def test_translate_response_metadata_typed_form():
    """metadata_api.md 中响应是 {fieldName: {valueType, value}} 形式。"""
    payload = {
        "metadata": {
            "__byclaw_kgw__status__v7": {"valueType": "string", "value": "active"},
            "__byclaw_kgw__tags__v8": {"valueType": "stringList",
                                        "value": ["a"]},
            "native_field": {"valueType": "string", "value": "z"},
        }
    }
    out = translate_response_metadata(payload, B2N)
    assert "status" in out["metadata"]
    assert "tags" in out["metadata"]
    # 不认识的字段透传(可能是后端原生字段或绕过网关写入的)
    assert "native_field" in out["metadata"]
    assert "__byclaw_kgw__status__v7" not in out["metadata"]
```

- [ ] **Step 3: 实现 translator.py**

```python
"""propertyName ↔ backend_name 双向改写。

纯函数,不访问 DB。调用方先从 ``registry`` 拿到所需的映射表
(``name_to_backend`` / ``backend_to_name``),再调本模块。
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

# DSL 操作符集合 — 与 metadata_api.md 一致
_DSL_BOOL_OPS = {"and", "or", "not"}
_DSL_LEAF_OPS = {
    "eq", "ne", "in", "contains", "exists",
    "gt", "gte", "lt", "lte", "prefix", "wildcard",
}


def translate_request_metadata(
    payload: dict[str, Any], name_to_backend: dict[str, str]
) -> dict[str, Any]:
    """改写 import / metadata/update / metadata/get 入参中的字段名。

    支持三种位置:
    - ``metadata`` dict 顶层 key
    - ``operationList[].propertyName``
    - ``metadataFieldList`` 数组元素
    """
    out = deepcopy(payload)

    if isinstance(out.get("metadata"), dict):
        out["metadata"] = {
            name_to_backend.get(k, k): v for k, v in out["metadata"].items()
        }

    if isinstance(out.get("operationList"), list):
        for op in out["operationList"]:
            if isinstance(op, dict) and "propertyName" in op:
                op["propertyName"] = name_to_backend.get(
                    op["propertyName"], op["propertyName"]
                )

    if isinstance(out.get("metadataFieldList"), list):
        out["metadataFieldList"] = [
            name_to_backend.get(name, name)
            for name in out["metadataFieldList"]
        ]

    return out
```

- [ ] **Step 4: 追加 DSL where 改写 + 响应改写**

```python
def translate_request_dsl_where(
    where: Any, name_to_backend: dict[str, str]
) -> Any:
    """递归改写 DSL ``where`` AST 中所有 ``fieldName``。

    - 布尔节点(``and`` / ``or`` / ``not``)递归下钻
    - 叶子节点改写 ``fieldName``
    - 不识别的节点原样返回
    """
    if not isinstance(where, dict) or len(where) != 1:
        return deepcopy(where)
    op, body = next(iter(where.items()))

    if op in _DSL_BOOL_OPS:
        if op == "not":
            return {"not": translate_request_dsl_where(body, name_to_backend)}
        # and / or 是数组
        return {op: [translate_request_dsl_where(item, name_to_backend)
                      for item in body]}

    if op in _DSL_LEAF_OPS and isinstance(body, dict):
        new_body = dict(body)
        if "fieldName" in new_body:
            field = new_body["fieldName"]
            new_body["fieldName"] = name_to_backend.get(field, field)
        return {op: new_body}

    return deepcopy(where)


def translate_response_metadata(
    payload: dict[str, Any], backend_to_name: dict[str, str]
) -> dict[str, Any]:
    """后端响应中 ``metadata`` dict 的 backend_name 反向改回 propertyName。

    metadata_api.md 中响应里 ``metadata`` 是 ``{fieldName: {valueType, value}}``
    形式;``fileName`` 等业务字段已在外层,本函数只动 ``metadata`` 子字典。
    在 ``data`` 数组场景(检索接口)递归处理每个元素的 ``metadata``。
    """
    out = deepcopy(payload)
    _rewrite_metadata_inplace(out, backend_to_name)
    return out


def _rewrite_metadata_inplace(node: Any, b2n: dict[str, str]) -> None:
    if isinstance(node, dict):
        if isinstance(node.get("metadata"), dict):
            node["metadata"] = {
                b2n.get(k, k): v for k, v in node["metadata"].items()
            }
        for v in node.values():
            _rewrite_metadata_inplace(v, b2n)
    elif isinstance(node, list):
        for item in node:
            _rewrite_metadata_inplace(item, b2n)
```

- [ ] **Step 5: 跑测试通过**

Run: `cd byclaw-kgw && uv run pytest tests/test_metadata_translator.py -v`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add byclaw-kgw/src/kgw/metadata/translator.py \
        byclaw-kgw/tests/test_metadata_translator.py
git commit -m "feat(kgw): add metadata.translator for name<->backend rewrites"
```

## Task 7: API — `/kgw/api/v1/metadataProperties/{create,batchCreate,delete,list}`

4 个主目录端点。`delete` 是核心:同事务 `binding 计数 → 主目录翻状态 → sync 批量翻 PURGING / 删 FAILED-SYNCING`。

**Files:**
- Create: `byclaw-kgw/src/kgw/api/metadata_properties.py`
- Test: `byclaw-kgw/tests/test_api_metadata_properties.py`
- Modify: `byclaw-kgw/src/kgw/main.py`(注册 router)

- [ ] **Step 1: 写端点测试**

新建 `byclaw-kgw/tests/test_api_metadata_properties.py`(integration,使用现有 `app_client_factory` / `app` 风格 fixture;若没有,参照 `test_api_write.py` 模式):

```python
import pytest

pytestmark = pytest.mark.integration


async def test_create_then_list(client):
    resp = await client.post(
        "/kgw/api/v1/metadataProperties/create",
        json={"propertyName": "t_e1", "valueType": "string",
              "description": "d"},
    )
    assert resp.status_code == 200
    assert resp.json()["resultCode"] == "0"

    resp = await client.post(
        "/kgw/api/v1/metadataProperties/list",
        json={"propertyNameList": ["t_e1"]},
    )
    data = resp.json()["resultObject"]["data"]
    assert any(p["propertyName"] == "t_e1" for p in data)


async def test_create_duplicate_returns_already_exists(client):
    await client.post("/kgw/api/v1/metadataProperties/create",
                      json={"propertyName": "t_e2", "valueType": "string"})
    resp = await client.post(
        "/kgw/api/v1/metadataProperties/create",
        json={"propertyName": "t_e2", "valueType": "number"},
    )
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["errorCode"] == "MetadataPropertyAlreadyExists"


async def test_delete_when_unused(client):
    await client.post("/kgw/api/v1/metadataProperties/create",
                      json={"propertyName": "t_e3", "valueType": "string"})
    resp = await client.post("/kgw/api/v1/metadataProperties/delete",
                              json={"propertyName": "t_e3"})
    assert resp.json()["resultCode"] == "0"
    # list 不再包含 t_e3
    resp = await client.post("/kgw/api/v1/metadataProperties/list",
                              json={"propertyNameList": ["t_e3"]})
    assert resp.json()["resultObject"]["data"] == []
```

- [ ] **Step 2: 在测试文件追加 in_use 拒绝场景**

```python
async def test_delete_rejected_when_in_use(client, integration_pool):
    # 先 create + 直接在 binding 表插一行模拟"在用"
    resp = await client.post(
        "/kgw/api/v1/metadataProperties/create",
        json={"propertyName": "t_e4", "valueType": "string"},
    )
    pid = await _query_property_id(integration_pool, "t_e4")
    async with integration_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property_binding "
                "(property_id, kn_code, file_path, status, attempt_id) "
                "VALUES (%s, 'hr', '/x.md', 'SYNCED', 1)",
                (pid,),
            )
    resp = await client.post("/kgw/api/v1/metadataProperties/delete",
                              json={"propertyName": "t_e4"})
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["errorCode"] == "MetadataPropertyInUse"
    assert body["resultObject"]["totalReferences"] == 1


async def _query_property_id(pool, name: str) -> int:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id FROM kgw_metadata_property "
                "WHERE property_name=%s AND status='ACTIVE'",
                (name,),
            )
            return (await cur.fetchone())["property_id"]


async def test_batch_create_atomic_rollback(client, integration_pool):
    await client.post("/kgw/api/v1/metadataProperties/create",
                      json={"propertyName": "t_e5", "valueType": "string"})
    resp = await client.post(
        "/kgw/api/v1/metadataProperties/batchCreate",
        json={"propertyList": [
            {"propertyName": "t_e6", "valueType": "string"},
            {"propertyName": "t_e5", "valueType": "string"},  # 冲突
        ]},
    )
    assert resp.json()["resultCode"] == "-1"
    # 原子回滚:t_e6 不应存在
    resp = await client.post("/kgw/api/v1/metadataProperties/list",
                              json={"propertyNameList": ["t_e6"]})
    assert resp.json()["resultObject"]["data"] == []
```

- [ ] **Step 3: 实现 metadata_properties.py 顶层(create / batchCreate)**

```python
"""metadataProperty 主目录 4 个端点(网关全局口径)。"""

from __future__ import annotations

from typing import Any

import psycopg
from fastapi import APIRouter, Request
from kgw.envelope import (
    INVALID_BATCH_DUPLICATE_NAME,
    INVALID_VALUE_TYPE,
    MetadataPropertyAlreadyExists,
    MetadataPropertyInUse,
    MetadataPropertyNotFound,
    success,
)
from kgw.metadata import binding as binding_mod
from kgw.metadata import registry, sync as sync_mod
from kgw.observability.logger import get_logger

_log = get_logger(__name__)
router = APIRouter(prefix="/kgw/api/v1/metadataProperties")

_ALLOWED_VALUE_TYPES = {"string", "stringList", "number", "boolean", "datetime"}


def _ensure_value_type(value_type: str) -> None:
    if value_type not in _ALLOWED_VALUE_TYPES:
        raise INVALID_VALUE_TYPE(
            f"valueType not allowed: {value_type}",
            value_type=value_type,
        )


@router.post("/create")
async def create_endpoint(request: Request, body: dict[str, Any]):
    pool = request.app.state.pool
    name = str(body["propertyName"])
    value_type = str(body["valueType"])
    _ensure_value_type(value_type)
    p = await registry.create_property(
        pool,
        property_name=name,
        value_type=value_type,
        description=body.get("description"),
        ext_params=body.get("extParams"),
    )
    return success({
        "propertyName": p.property_name,
        "valueType": p.value_type,
        "description": p.description,
        "extParams": p.ext_params or {},
    })
```

- [ ] **Step 4: 追加 batchCreate / list / delete 端点**

```python
@router.post("/batchCreate")
async def batch_create_endpoint(request: Request, body: dict[str, Any]):
    pool = request.app.state.pool
    items = list(body.get("propertyList") or ())
    seen: set[str] = set()
    for item in items:
        n = item.get("propertyName")
        if n in seen:
            raise INVALID_BATCH_DUPLICATE_NAME(
                f"duplicate propertyName in batch: {n}", property_name=n,
            )
        seen.add(n)
        _ensure_value_type(item.get("valueType", ""))

    created: list[dict[str, Any]] = []
    async with pool.connection() as conn:
        async with conn.transaction():
            try:
                for item in items:
                    name = item["propertyName"]
                    async with conn.cursor() as cur:
                        await cur.execute(
                            "INSERT INTO kgw_metadata_property "
                            "(property_name, backend_name, value_type, "
                            " description, ext_params, status) "
                            "VALUES (%s, '__placeholder__', %s, %s, %s, 'ACTIVE') "
                            "RETURNING property_id",
                            (name, item["valueType"], item.get("description"),
                             psycopg.types.json.Jsonb(item["extParams"])
                             if item.get("extParams") is not None else None),
                        )
                        pid = (await cur.fetchone())["property_id"]
                        bn = registry.derive_backend_name(name, pid)
                        await cur.execute(
                            "UPDATE kgw_metadata_property SET backend_name=%s "
                            "WHERE property_id=%s",
                            (bn, pid),
                        )
                    created.append({
                        "propertyName": name,
                        "valueType": item["valueType"],
                        "description": item.get("description"),
                        "extParams": item.get("extParams") or {},
                    })
            except psycopg.errors.UniqueViolation as exc:
                raise MetadataPropertyAlreadyExists(
                    "metadata property already exists in batch",
                ) from exc
    return success({"data": created})


@router.post("/list")
async def list_endpoint(request: Request, body: dict[str, Any]):
    pool = request.app.state.pool
    names = body.get("propertyNameList")
    rows = await registry.list_active_properties(pool, names)
    return success({"data": [
        {"propertyName": p.property_name, "valueType": p.value_type,
         "description": p.description, "extParams": p.ext_params or {}}
        for p in rows
    ]})
```

- [ ] **Step 5: 追加 delete 端点(同事务原子操作)**

```python
@router.post("/delete")
async def delete_endpoint(request: Request, body: dict[str, Any]):
    pool = request.app.state.pool
    name = str(body["propertyName"])

    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                # 锁定 ACTIVE 行
                await cur.execute(
                    "SELECT property_id FROM kgw_metadata_property "
                    "WHERE property_name=%s AND status='ACTIVE' FOR UPDATE",
                    (name,),
                )
                row = await cur.fetchone()
            if not row:
                raise MetadataPropertyNotFound(
                    f"metadata property not found: {name}",
                    property_name=name,
                )
            pid = row["property_id"]

            # binding 占用校验:同事务读
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT COUNT(*) AS c FROM kgw_metadata_property_binding "
                    "WHERE property_id=%s AND status IN ('PENDING','SYNCED')",
                    (pid,),
                )
                count = (await cur.fetchone())["c"]
            if count > 0:
                samples = await binding_mod.sample_in_use(pool, pid, limit=5)
                raise MetadataPropertyInUse(
                    f"metadata property is still referenced: {name}",
                    property_name=name,
                    in_use_samples=samples,
                    total_references=count,
                )

            # 翻状态轨 1 + 状态轨 2(SYNCED→PURGING,清 FAILED/SYNCING)
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE kgw_metadata_property "
                    "SET status='DELETED', deleted_at=NOW() "
                    "WHERE property_id=%s",
                    (pid,),
                )
            await sync_mod.upsert_purging_for_synced(conn, pid)
    return success({})
```

- [ ] **Step 6: 在 main.py 注册 router**

修改 `byclaw-kgw/src/kgw/main.py`,在 `_register_routers()`(或现有 router 注册段)加:

```python
from kgw.api import metadata_properties as md_props
app.include_router(md_props.router)
```

并确保 `KgwError → envelope` 异常处理器已挂载(S1 应该已有,无需新增)。

- [ ] **Step 7: 跑端点测试**

Run: `cd byclaw-kgw && uv run pytest tests/test_api_metadata_properties.py -m integration -v`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add byclaw-kgw/src/kgw/api/metadata_properties.py \
        byclaw-kgw/src/kgw/main.py \
        byclaw-kgw/tests/test_api_metadata_properties.py
git commit -m "feat(kgw): add metadataProperties create/batchCreate/delete/list"
```

## Task 8: API — `metadata/update` / `metadata/get` / `metadataFields/list`(写路径核心)

`metadata/update` 是写路径的核心,完整流程:校验 → 取主目录 → ensure_synced → 写 binding PENDING → 调后端 → 后端响应分支(PENDING→SYNCED 或反向 DELETE)→ 响应字段名反向改写。

`metadata/get` 与 `metadataFields/list` 较简单。

**Files:**
- Modify: `byclaw-kgw/src/kgw/api/knowledge_items.py`(追加 3 个端点)
- Test: `byclaw-kgw/tests/test_api_metadata_lifecycle.py`(新建,覆盖端到端)

- [ ] **Step 1: 写端到端测试 — 完整生命周期**

新建 `byclaw-kgw/tests/test_api_metadata_lifecycle.py`(integration,需要 respx mock 后端 + 真实 PG):

```python
import pytest
import respx
from httpx import Response

pytestmark = pytest.mark.integration


async def test_full_lifecycle_create_use_delete_recreate(
    client, integration_pool, mock_kb_resolver, http_client
):
    # 1. create
    await client.post("/kgw/api/v1/metadataProperties/create",
                      json={"propertyName": "lc_status",
                            "valueType": "string"})

    # 2. metadata/update 触发 lazy sync + 写 binding
    with respx.mock(base_url="http://kb-hr.test") as mock:
        mock.post("/api/v1/metadataProperties/batchCreate").mock(
            return_value=Response(200, json={"resultCode": "0",
                                              "resultMsg": "success",
                                              "resultObject": {}})
        )
        mock.post("/api/v1/knowledgeItems/metadata/update").mock(
            return_value=Response(200, json={
                "resultCode": "0", "resultMsg": "success",
                "resultObject": {"knCode": "hr",
                                  "filePath": "/p.md",
                                  "metadata": {}},
            })
        )
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/metadata/update",
            headers={"X-User-Id": "u1"},
            json={"knCode": "hr", "filePath": "/p.md",
                  "operationList": [{"propertyName": "lc_status",
                                      "operation": "set",
                                      "value": "active"}]},
        )
        assert resp.json()["resultCode"] == "0"

    # 3. delete 拒绝(in_use)
    resp = await client.post("/kgw/api/v1/metadataProperties/delete",
                              json={"propertyName": "lc_status"})
    assert resp.json()["resultObject"]["errorCode"] == "MetadataPropertyInUse"
```

- [ ] **Step 2: 在 test_api_metadata_lifecycle.py 追加 unset → delete 通过路径**

```python
async def test_unset_releases_binding_then_delete_passes(
    client, integration_pool
):
    await client.post("/kgw/api/v1/metadataProperties/create",
                      json={"propertyName": "lc_unset",
                            "valueType": "string"})
    with respx.mock(base_url="http://kb-hr.test") as mock:
        mock.post("/api/v1/metadataProperties/batchCreate").mock(
            return_value=Response(200, json={"resultCode": "0",
                                              "resultMsg": "success",
                                              "resultObject": {}})
        )
        mock.post("/api/v1/knowledgeItems/metadata/update").mock(
            return_value=Response(200, json={
                "resultCode": "0", "resultMsg": "success",
                "resultObject": {"knCode": "hr", "filePath": "/u.md",
                                  "metadata": {}}})
        )
        # set
        await client.post(
            "/kgw/api/v1/knowledgeItems/metadata/update",
            headers={"X-User-Id": "u1"},
            json={"knCode": "hr", "filePath": "/u.md",
                  "operationList": [{"propertyName": "lc_unset",
                                      "operation": "set", "value": "x"}]},
        )
        # unset
        await client.post(
            "/kgw/api/v1/knowledgeItems/metadata/update",
            headers={"X-User-Id": "u1"},
            json={"knCode": "hr", "filePath": "/u.md",
                  "operationList": [{"propertyName": "lc_unset",
                                      "operation": "unset"}]},
        )
    resp = await client.post("/kgw/api/v1/metadataProperties/delete",
                              json={"propertyName": "lc_unset"})
    assert resp.json()["resultCode"] == "0"


async def test_metadata_update_unknown_property_returns_not_found(client):
    resp = await client.post(
        "/kgw/api/v1/knowledgeItems/metadata/update",
        headers={"X-User-Id": "u1"},
        json={"knCode": "hr", "filePath": "/x.md",
              "operationList": [{"propertyName": "never_declared",
                                  "operation": "set", "value": "x"}]},
    )
    body = resp.json()
    assert body["resultCode"] == "-1"
    assert body["resultObject"]["errorCode"] == "MetadataPropertyNotFound"
```

`mock_kb_resolver` fixture 见 Step 5 conftest 调整。

- [ ] **Step 3: 在 knowledge_items.py 追加 metadata/update 端点**

打开 `byclaw-kgw/src/kgw/api/knowledge_items.py`,在文件末尾追加。先在文件顶部 import:

```python
from kgw.metadata import binding as binding_mod
from kgw.metadata import registry, sync as sync_mod
from kgw.metadata.translator import (
    translate_request_metadata,
    translate_response_metadata,
)
from kgw.envelope import (
    INVALID_FIELD_VALUE_TYPE,
    INVALID_OPERATION_FOR_TYPE,
    MetadataPropertyNotFound,
)
```

然后追加端点:

```python
_OPS_FOR_TYPE: dict[str, set[str]] = {
    "string": {"set", "unset"},
    "number": {"set", "unset"},
    "boolean": {"set", "unset"},
    "datetime": {"set", "unset"},
    "stringList": {"set", "unset", "append", "remove", "clear"},
}


async def _resolve_property_map(pool, names: list[str]):
    """Return (name_to_backend, backend_to_name, props_by_name)."""
    props = {p.property_name: p for p in
              await registry.list_active_properties(pool, names)}
    missing = [n for n in names if n not in props]
    if missing:
        raise MetadataPropertyNotFound(
            f"metadata property not found: {missing[0]}",
            property_name=missing[0], missing=missing,
        )
    n2b = {n: p.backend_name for n, p in props.items()}
    b2n = {b: n for n, b in n2b.items()}
    return n2b, b2n, props


def _validate_op(op: dict, value_type: str) -> None:
    operation = op.get("operation")
    if operation not in _OPS_FOR_TYPE.get(value_type, set()):
        raise INVALID_OPERATION_FOR_TYPE(
            f"operation {operation} is not allowed for type {value_type}",
            operation=operation, value_type=value_type,
        )
```

- [ ] **Step 4: 追加 metadata/update 主体**

```python
@router.post("/knowledgeItems/metadata/update")
async def metadata_update_endpoint(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
):
    pool = request.app.state.pool
    http = request.app.state.http
    config_provider = request.app.state.config_provider
    auth_provider = request.app.state.auth_provider

    kn_code = str(body["knCode"])
    file_path = str(body["filePath"])
    op_list = list(body.get("operationList") or ())

    # 1. 校验:propertyName 必须 ACTIVE,operation 与 valueType 兼容
    names = [op["propertyName"] for op in op_list]
    n2b, b2n, props = await _resolve_property_map(pool, names)
    for op in op_list:
        _validate_op(op, props[op["propertyName"]].value_type)

    # 2. lazy sync — 每个涉及的 (property_id, kn_code) 都要 SYNCED
    async def resolve_endpoint(code: str) -> str:
        cfg = await config_provider.get(code)
        return cfg.endpoint_url
    for name in names:
        await sync_mod.ensure_synced(
            pool, http, resolve_endpoint,
            property_id=props[name].property_id, kn_code=kn_code,
        )

    # 3. 写 binding PENDING(set/append) — 单事务
    attempt_id = binding_mod.new_attempt_id()
    set_or_append_props = [op["propertyName"] for op in op_list
                            if op["operation"] in {"set", "append"}]
    async with pool.connection() as conn:
        async with conn.transaction():
            for name in set_or_append_props:
                await binding_mod.upsert_pending(
                    conn,
                    property_id=props[name].property_id,
                    kn_code=kn_code, file_path=file_path,
                    attempt_id=attempt_id,
                )

    # 4. 改写 payload + 调后端
    backend_payload = translate_request_metadata(body, n2b)
    cfg = await config_provider.get(kn_code)
    headers = await auth_provider.resolve_headers(
        user_code=x_user_id, header_template=cfg.headers,
    )
    resp = await http.post(
        f"{cfg.endpoint_url}/api/v1/knowledgeItems/metadata/update",
        json=backend_payload, headers=headers, timeout=30.0,
    )

    if resp.status_code != 200 or resp.json().get("resultCode") != "0":
        # 反向回滚 PENDING
        try:
            await binding_mod.delete_by_attempt(pool, attempt_id)
        except Exception:  # noqa: BLE001
            for name in set_or_append_props:
                await binding_mod.write_outbox(
                    pool, property_id=props[name].property_id,
                    kn_code=kn_code, file_path=file_path,
                    attempt_id=attempt_id,
                )
        # 透传后端错误信封
        return resp.json() if resp.headers.get("content-type",
                                                "").startswith("application/json") \
            else success({})

    # 5. 后端成功 → 推 PENDING → SYNCED + 处理 unset/clear
    await binding_mod.mark_synced_by_attempt(pool, attempt_id=attempt_id)
    async with pool.connection() as conn:
        async with conn.transaction():
            for op in op_list:
                if op["operation"] in {"unset", "clear"}:
                    await binding_mod.delete_by_property_op(
                        conn,
                        property_id=props[op["propertyName"]].property_id,
                        kn_code=kn_code, file_path=file_path,
                    )

    # 6. 反向改写响应 metadata 字段名
    return translate_response_metadata(resp.json(), b2n)
```

- [ ] **Step 5: 追加 metadata/get 与 metadataFields/list 端点**

```python
@router.post("/knowledgeItems/metadata/get")
async def metadata_get_endpoint(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
):
    pool = request.app.state.pool
    http = request.app.state.http
    config_provider = request.app.state.config_provider
    auth_provider = request.app.state.auth_provider

    field_list = list(body.get("metadataFieldList") or ())
    n2b: dict[str, str] = {}
    b2n: dict[str, str] = {}
    if field_list:
        n2b, b2n, _ = await _resolve_property_map(pool, field_list)

    backend_payload = translate_request_metadata(body, n2b)
    cfg = await config_provider.get(str(body["knCode"]))
    headers = await auth_provider.resolve_headers(
        user_code=x_user_id, header_template=cfg.headers,
    )
    resp = await http.post(
        f"{cfg.endpoint_url}/api/v1/knowledgeItems/metadata/get",
        json=backend_payload, headers=headers, timeout=30.0,
    )
    if not b2n:
        return resp.json()
    return translate_response_metadata(resp.json(), b2n)


@router.post("/knowledgeItems/metadataFields/list")
async def metadata_fields_list_endpoint(
    request: Request, body: dict[str, Any]
):
    """从网关 sync 表本地查 — 不调后端。"""
    pool = request.app.state.pool
    kn_codes = list(body.get("knCodeList") or ())
    if not kn_codes:
        return success({"data": []})

    pids: set[int] = set()
    for kc in kn_codes:
        ids = await sync_mod.list_synced_property_ids_for_kn(pool, kc)
        pids.update(ids)
    if not pids:
        return success({"data": []})

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_name, value_type, description "
                "FROM kgw_metadata_property "
                "WHERE property_id = ANY(%s) AND status='ACTIVE'",
                (list(pids),),
            )
            rows = await cur.fetchall()
    return success({"data": [
        {"propertyName": r["property_name"], "valueType": r["value_type"],
         "description": r.get("description")}
        for r in rows
    ]})
```

- [ ] **Step 6: 跑端到端测试**

确认 `client` fixture 用真实 ASGI app + 真实 PG;`mock_kb_resolver` fixture 在 conftest 配置 `KbConfigProvider.get` 返回 endpoint=`http://kb-hr.test`(可借助 `monkeypatch` 覆盖 `app.state.config_provider.get`)。

Run: `cd byclaw-kgw && uv run pytest tests/test_api_metadata_lifecycle.py -m integration -v`
Expected: 三个测试全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add byclaw-kgw/src/kgw/api/knowledge_items.py \
        byclaw-kgw/tests/test_api_metadata_lifecycle.py \
        byclaw-kgw/tests/conftest.py
git commit -m "feat(kgw): add metadata/update + metadata/get + metadataFields/list"
```

## Task 9: 读路径 DSL 改写 + 现有写端点的 binding 联动

S3 已实现 `search` / `metadataSearch` / `searchFile` 端点和 S2 的 `import` / `delete` / `directories.delete`。本任务对接 metadata 改写与 binding 联动:

- 读路径(search 类):入参 `where` AST 用 `translate_request_dsl_where` 改写;`metadataFieldList` 用 `translate_request_metadata` 改写;响应用 `translate_response_metadata` 反向。读路径**不**触发 lazy sync。
- `import` 携带 metadata:复用 Task 8 的 lazy sync + binding 链路。
- `knowledgeItems/delete` 后端成功后:`binding.delete_by_file`。
- `directories/delete` 后端成功后:`binding.delete_by_directory`。

**Files:**
- Modify: `byclaw-kgw/src/kgw/api/knowledge_items.py`(search 类 + import)
- Modify: `byclaw-kgw/src/kgw/api/directories.py`
- Test: `byclaw-kgw/tests/test_api_search_field_rewrite.py`(新建)
- Test: `byclaw-kgw/tests/test_api_write_binding_cleanup.py`(新建)

- [ ] **Step 1: 写读路径字段改写测试**

```python
import pytest
import respx
from httpx import Response

pytestmark = pytest.mark.integration


async def test_search_dsl_where_field_rewritten(client, integration_pool):
    await client.post("/kgw/api/v1/metadataProperties/create",
                      json={"propertyName": "sr_status",
                            "valueType": "string"})
    captured = {}
    with respx.mock(base_url="http://kb-hr.test") as mock:
        route = mock.post("/api/v1/knowledgeItems/search").mock(
            return_value=Response(200, json={
                "resultCode": "0", "resultMsg": "success",
                "resultObject": {"data": [{
                    "knCode": "hr", "filePath": "/x.md", "chunkId": 1,
                    "chunkText": "...",
                    "metadata": {"__byclaw_kgw__sr_status__v999":
                                  {"valueType": "string", "value": "active"}},
                }]},
            })
        )
        resp = await client.post(
            "/kgw/api/v1/knowledgeItems/search",
            headers={"X-User-Id": "u1"},
            json={"knCodeList": ["hr"], "query": "续签",
                  "searchMode": "mixedRecall", "topK": 5,
                  "where": {"eq": {"fieldName": "sr_status",
                                    "value": "active"}}},
        )
        sent = route.calls.last.request.read().decode()
    assert '"__byclaw_kgw__sr_status__v' in sent
    body = resp.json()
    md = body["resultObject"]["data"][0]["metadata"]
    assert "sr_status" in md
```

- [ ] **Step 2: 在 knowledge_items.py 修改 search 类端点 — 接入字段改写**

定位现有的 `search` / `metadataSearch` / `searchFile` 端点(S3 已实现,在同一文件中)。在调后端前抽取 `where` 与 `metadataFieldList` 中的字段名,做字段名改写;响应做反向改写。示例改写(`search`):

```python
async def _collect_dsl_field_names(where: Any) -> list[str]:
    """Walk DSL AST, return all leaf fieldName values."""
    out: list[str] = []
    def _walk(node):
        if not isinstance(node, dict) or len(node) != 1:
            return
        op, body = next(iter(node.items()))
        if op in {"and", "or"}:
            for child in body:
                _walk(child)
        elif op == "not":
            _walk(body)
        elif isinstance(body, dict) and "fieldName" in body:
            out.append(body["fieldName"])
    _walk(where)
    return out


# 在现有 search 端点入口:
async def search_endpoint(...):
    pool = request.app.state.pool
    where = body.get("where") or {}
    field_list = list(body.get("metadataFieldList") or ())
    declared_names = set(await _collect_dsl_field_names(where)) | set(field_list)
    declared_names -= _SYSTEM_FIELDS  # fileType 等系统字段
    n2b: dict[str, str] = {}
    b2n: dict[str, str] = {}
    if declared_names:
        n2b, b2n, _ = await _resolve_property_map(pool, list(declared_names))

    backend_body = dict(body)
    if where:
        backend_body["where"] = translate_request_dsl_where(where, n2b)
    if field_list:
        backend_body = translate_request_metadata(backend_body, n2b)

    # ...现有 fan-out 逻辑透传 backend_body...

    # 响应统一过 translate_response_metadata
    final = translate_response_metadata(envelope, b2n)
    return final
```

`_SYSTEM_FIELDS = {"fileType"}` — metadata_api.md 提到的系统字段集合,在改写前剔除。`metadataSearch` 与 `searchFile` 改写逻辑相同,提取为本文件内私有 helper。

- [ ] **Step 3: import 端点接入 lazy sync + binding**

定位 S2 的 `import` 端点(`/kgw/api/v1/knowledgeItems/import`)。它接收 `multipart/form-data`,其中可能携带 metadata 字段(根据 metadata_api.md `fileImport`)。改造点:

1. 解析 multipart form 时,如果包含 `metadata` 字段(JSON 字符串),先按 metadata/update 一致的流程做校验 + lazy sync + 写 binding PENDING + attempt_id;
2. 调后端成功后 mark SYNCED;失败反向 DELETE binding;
3. multipart 转发到后端时把 metadata key 改写为 backend_name(沿用 stream_proxy 的 form 字段重写能力,如不支持则在调用前 buffer 这一段非文件字段)。

由于 S4 在 S2/S3 之上接入,实现细节按现有 `stream_proxy.py` 接口决定;若 stream_proxy 暴露的接口不支持 form 字段重写,在 plan 落地时改造 `stream_proxy` 增加 `transform_non_file_fields` 钩子(本任务允许 inline 一并处理)。

- [ ] **Step 4: 改造 knowledgeItems/delete 与 directories/delete — binding 联动**

`knowledgeItems/delete`(S2 已实现):在调后端成功后追加:

```python
if backend_resp_ok:
    await binding_mod.delete_by_file(pool, kn_code=kn_code, file_path=file_path)
```

`directories/delete`:

```python
if backend_resp_ok:
    await binding_mod.delete_by_directory(pool, kn_code=kn_code,
                                           directory_path=directory_path)
```

- [ ] **Step 5: 写 binding 联动测试**

新建 `byclaw-kgw/tests/test_api_write_binding_cleanup.py`:

```python
import pytest
import respx
from httpx import Response
from kgw.metadata.binding import count_in_use

pytestmark = pytest.mark.integration


async def test_file_delete_clears_bindings(client, integration_pool):
    await client.post("/kgw/api/v1/metadataProperties/create",
                      json={"propertyName": "fc_status",
                            "valueType": "string"})
    pid = await _pid(integration_pool, "fc_status")
    async with integration_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property_binding "
                "(property_id, kn_code, file_path, status, attempt_id) "
                "VALUES (%s, 'hr', '/d.md', 'SYNCED', 1)",
                (pid,),
            )
    with respx.mock(base_url="http://kb-hr.test") as mock:
        mock.post("/api/v1/knowledgeItems/delete").mock(
            return_value=Response(200, json={"resultCode": "0",
                                              "resultMsg": "success",
                                              "resultObject": {}})
        )
        await client.post(
            "/kgw/api/v1/knowledgeItems/delete",
            headers={"X-User-Id": "u1"},
            json={"knCode": "hr", "filePath": "/d.md"},
        )
    assert await count_in_use(integration_pool, pid) == 0


async def _pid(pool, name):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id FROM kgw_metadata_property "
                "WHERE property_name=%s",
                (name,),
            )
            return (await cur.fetchone())["property_id"]
```

- [ ] **Step 6: 跑测试**

Run: `cd byclaw-kgw && uv run pytest tests/test_api_search_field_rewrite.py tests/test_api_write_binding_cleanup.py -m integration -v`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add byclaw-kgw/src/kgw/api/knowledge_items.py \
        byclaw-kgw/src/kgw/api/directories.py \
        byclaw-kgw/tests/test_api_search_field_rewrite.py \
        byclaw-kgw/tests/test_api_write_binding_cleanup.py
git commit -m "feat(kgw): wire metadata DSL rewrite + binding cleanup on delete"
```

## Task 10: cleanup worker(状态轨 2:PURGING/PURGE_FAILED → PURGED → 物理删主目录)

后台 worker,与 FastAPI app 同进程,在 lifespan 启动时 `asyncio.create_task` 拉起。

**Files:**
- Create: `byclaw-kgw/src/kgw/workers/__init__.py`(空)
- Create: `byclaw-kgw/src/kgw/workers/cleanup.py`
- Test: `byclaw-kgw/tests/test_workers_cleanup.py`
- Modify: `byclaw-kgw/src/kgw/main.py`(lifespan 启动 + 注销)

- [ ] **Step 1: 写 cleanup worker 测试**

```python
import asyncio
import pytest
import respx
from httpx import Response
from kgw.metadata.registry import create_property
from kgw.workers.cleanup import cleanup_iteration

pytestmark = pytest.mark.integration


async def test_purging_to_purged(integration_pool, http_client,
                                  kb_config_resolver_factory):
    p = await create_property(integration_pool, property_name="cu1",
                              value_type="string")
    # 先把 sync 行设为 PURGING(模拟 delete 已发生)
    async with integration_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property_sync "
                "(property_id, kn_code, sync_status, last_sync_at) "
                "VALUES (%s, 'hr', 'PURGING', NULL)",
                (p.property_id,),
            )
            await cur.execute(
                "UPDATE kgw_metadata_property SET status='DELETED', "
                "deleted_at=NOW() WHERE property_id=%s",
                (p.property_id,),
            )
    resolver = kb_config_resolver_factory({"hr": "http://kb-hr.test"})
    with respx.mock(base_url="http://kb-hr.test") as mock:
        mock.post("/api/v1/metadataProperties/delete").mock(
            return_value=Response(200, json={"resultCode": "0",
                                              "resultMsg": "success",
                                              "resultObject": {}})
        )
        await cleanup_iteration(integration_pool, http_client, resolver)
    # sync 行应变为 PURGED;主目录被物理删
    async with integration_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT property_id FROM kgw_metadata_property "
                "WHERE property_id=%s",
                (p.property_id,),
            )
            assert await cur.fetchone() is None
```

- [ ] **Step 2: 实现 cleanup.py 顶层 + iteration 主体**

```python
"""metadataProperty cleanup worker — 后端死列异步清理。

每轮扫描 ``kgw_metadata_property_sync`` 中 PURGING / PURGE_FAILED 行,
调后端 ``metadataProperties/delete`` 移除 ``__byclaw_kgw__{name}__v{id}``
列。所有 sync 行 PURGED 后物理删主目录。``SELECT ... FOR UPDATE
SKIP LOCKED`` 让多 Pod 共存。
"""

from __future__ import annotations

import asyncio
from typing import Awaitable, Callable

import httpx
from kgw.metadata.sync import KbEndpointResolver
from kgw.observability.logger import get_logger
from psycopg_pool import AsyncConnectionPool

_log = get_logger(__name__)


async def cleanup_iteration(
    pool: AsyncConnectionPool,
    http: httpx.AsyncClient,
    resolve_endpoint: KbEndpointResolver,
    *,
    batch_size: int = 50,
    backoff_minutes: int = 5,
    timeout_seconds: float = 15.0,
) -> int:
    """运行一轮 cleanup,返回处理的 sync 行数。"""
    processed = 0
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT s.property_id, s.kn_code, p.backend_name "
                    "FROM kgw_metadata_property_sync s "
                    "JOIN kgw_metadata_property p USING (property_id) "
                    "WHERE s.sync_status IN ('PURGING','PURGE_FAILED') "
                    "  AND (s.last_sync_at IS NULL OR "
                    "       s.last_sync_at < NOW() - INTERVAL '%s minutes') "
                    "ORDER BY s.last_sync_at NULLS FIRST "
                    "LIMIT %s "
                    "FOR UPDATE SKIP LOCKED",
                    (backoff_minutes, batch_size),
                )
                rows = await cur.fetchall()
            for row in rows:
                await _purge_one(conn, http, resolve_endpoint,
                                  row["property_id"], row["kn_code"],
                                  row["backend_name"], timeout_seconds)
                processed += 1

    await _physical_delete_when_all_purged(pool)
    return processed
```

- [ ] **Step 3: 实现 _purge_one + _physical_delete_when_all_purged**

```python
async def _purge_one(
    conn,
    http: httpx.AsyncClient,
    resolve_endpoint: KbEndpointResolver,
    property_id: int,
    kn_code: str,
    backend_name: str,
    timeout_seconds: float,
) -> None:
    try:
        endpoint = await resolve_endpoint(kn_code)
        resp = await http.post(
            f"{endpoint}/api/v1/metadataProperties/delete",
            json={"propertyName": backend_name},
            timeout=timeout_seconds,
        )
        body = resp.json() if resp.headers.get("content-type", "").startswith(
            "application/json"
        ) else {}
        ok = resp.status_code == 200 and body.get("resultCode") == "0"
        # 后端"已不存在"也视为成功(幂等)
        not_found = (body.get("resultMsg") or "").lower().find("not found") != -1
        if ok or not_found:
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE kgw_metadata_property_sync "
                    "SET sync_status='PURGED', last_sync_at=NOW(), "
                    "    last_error=NULL "
                    "WHERE property_id=%s AND kn_code=%s",
                    (property_id, kn_code),
                )
            return
        msg = body.get("resultMsg") or resp.text[:200]
    except (httpx.HTTPError, ValueError) as exc:
        msg = repr(exc)
    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE kgw_metadata_property_sync "
            "SET sync_status='PURGE_FAILED', last_sync_at=NOW(), "
            "    last_error=%s "
            "WHERE property_id=%s AND kn_code=%s",
            (msg, property_id, kn_code),
        )


async def _physical_delete_when_all_purged(pool: AsyncConnectionPool) -> None:
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "DELETE FROM kgw_metadata_property "
                "WHERE status='DELETED' AND NOT EXISTS ("
                "  SELECT 1 FROM kgw_metadata_property_sync s "
                "  WHERE s.property_id = kgw_metadata_property.property_id "
                "    AND s.sync_status != 'PURGED'"
                ")",
            )


async def run_cleanup_loop(
    pool: AsyncConnectionPool,
    http: httpx.AsyncClient,
    resolve_endpoint: KbEndpointResolver,
    *,
    interval_seconds: float = 30.0,
    stop_event: asyncio.Event | None = None,
) -> None:
    while True:
        if stop_event is not None and stop_event.is_set():
            return
        try:
            await cleanup_iteration(pool, http, resolve_endpoint)
        except Exception:  # noqa: BLE001
            _log.exception("cleanup.iteration.error")
        try:
            await asyncio.wait_for(
                stop_event.wait() if stop_event else asyncio.sleep(interval_seconds),
                timeout=interval_seconds,
            )
        except asyncio.TimeoutError:
            continue
        else:
            return
```

- [ ] **Step 4: 在 main.py lifespan 启动 worker**

修改 `byclaw-kgw/src/kgw/main.py` 的 `_lifespan`,在 startup 阶段拉起 worker,在 shutdown 阶段优雅关闭:

```python
from kgw.workers.cleanup import run_cleanup_loop

# in _lifespan startup section, after app.state assignments:
async def _resolve_endpoint(kn_code: str) -> str:
    cfg = await app.state.config_provider.get(kn_code)
    return cfg.endpoint_url

stop_event = asyncio.Event()
app.state.worker_stop = stop_event
app.state.cleanup_task = asyncio.create_task(
    run_cleanup_loop(
        app.state.pool, app.state.http, _resolve_endpoint,
        stop_event=stop_event,
    )
)

# in _lifespan shutdown section (after `yield`):
app.state.worker_stop.set()
await asyncio.gather(app.state.cleanup_task, return_exceptions=True)
```

- [ ] **Step 5: 跑 cleanup 测试**

Run: `cd byclaw-kgw && uv run pytest tests/test_workers_cleanup.py -m integration -v`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add byclaw-kgw/src/kgw/workers/__init__.py \
        byclaw-kgw/src/kgw/workers/cleanup.py \
        byclaw-kgw/src/kgw/main.py \
        byclaw-kgw/tests/test_workers_cleanup.py
git commit -m "feat(kgw): add metadataProperty cleanup worker"
```

## Task 11: binding reconcile worker(状态轨 3 孤儿处理)

两类孤儿:`kgw_metadata_binding_outbox` 中的 ROLLBACK_FAILED 行;`kgw_metadata_property_binding` 中 PENDING 超过 5 分钟仍未推进的行。

**Files:**
- Create: `byclaw-kgw/src/kgw/workers/binding_reconcile.py`
- Test: `byclaw-kgw/tests/test_workers_binding_reconcile.py`
- Modify: `byclaw-kgw/src/kgw/main.py`(lifespan 同步启动)
- Modify: `byclaw-kgw/src/kgw/auth_provider.py`(若 reconcile 需要按 PENDING 行推断鉴权,后续讨论;MVP 用网关服务态身份)

注:reconcile 调后端 `metadata/get` 探测,需要鉴权。MVP 用一个**专用服务身份**(kgw 自身的 user_code,通过环境变量配置),长期可演进为"按 PENDING 行的原始 attempt 携带身份回放",当前不做。

- [ ] **Step 1: 写 reconcile 测试**

```python
import pytest
import respx
from httpx import Response
from kgw.metadata.registry import create_property
from kgw.workers.binding_reconcile import reconcile_iteration

pytestmark = pytest.mark.integration


async def test_outbox_drained_when_binding_deletable(integration_pool):
    p = await create_property(integration_pool, property_name="rb1",
                              value_type="string")
    aid = 999
    async with integration_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property_binding "
                "(property_id, kn_code, file_path, status, attempt_id) "
                "VALUES (%s, 'hr', '/r.md', 'PENDING', %s)",
                (p.property_id, aid),
            )
            await cur.execute(
                "INSERT INTO kgw_metadata_binding_outbox "
                "(property_id, kn_code, file_path, attempt_id, reason) "
                "VALUES (%s, 'hr', '/r.md', %s, 'ROLLBACK_FAILED')",
                (p.property_id, aid),
            )
    await reconcile_iteration(integration_pool, http=None, resolver=None,
                              service_user_code="kgw")
    async with integration_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) AS c FROM kgw_metadata_binding_outbox "
                "WHERE attempt_id=%s",
                (aid,),
            )
            assert (await cur.fetchone())["c"] == 0
```

- [ ] **Step 2: 实现 binding_reconcile.py**

```python
"""metadataProperty binding reconcile worker。

两类孤儿:
- ``kgw_metadata_binding_outbox`` 中的 ROLLBACK_FAILED:重试 DELETE binding
- ``kgw_metadata_property_binding`` 中 PENDING > 5 分钟:问后端探测实际值,
  有值 → SYNCED;无值 → DELETE
"""

from __future__ import annotations

import asyncio
from typing import Awaitable, Callable

import httpx
from kgw.metadata.sync import KbEndpointResolver
from kgw.observability.logger import get_logger
from psycopg_pool import AsyncConnectionPool

_log = get_logger(__name__)


async def reconcile_iteration(
    pool: AsyncConnectionPool,
    *,
    http: httpx.AsyncClient | None,
    resolver: KbEndpointResolver | None,
    service_user_code: str,
    pending_threshold_minutes: int = 5,
    batch_size: int = 50,
) -> None:
    """运行一轮 reconcile。``http`` / ``resolver`` 仅 PENDING 探测时需要。"""
    await _drain_outbox(pool, batch_size)
    if http is None or resolver is None:
        return
    await _resolve_pending_orphans(
        pool, http, resolver, service_user_code,
        pending_threshold_minutes, batch_size,
    )


async def _drain_outbox(pool: AsyncConnectionPool, batch_size: int) -> None:
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id, property_id, kn_code, file_path, attempt_id "
                    "FROM kgw_metadata_binding_outbox "
                    "ORDER BY created_at LIMIT %s "
                    "FOR UPDATE SKIP LOCKED",
                    (batch_size,),
                )
                rows = await cur.fetchall()
            for row in rows:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "DELETE FROM kgw_metadata_property_binding "
                        "WHERE property_id=%s AND kn_code=%s "
                        "  AND file_path=%s AND attempt_id=%s",
                        (row["property_id"], row["kn_code"],
                         row["file_path"], row["attempt_id"]),
                    )
                    await cur.execute(
                        "DELETE FROM kgw_metadata_binding_outbox "
                        "WHERE id=%s",
                        (row["id"],),
                    )
```

- [ ] **Step 3: 追加 _resolve_pending_orphans + run_reconcile_loop**

```python
async def _resolve_pending_orphans(
    pool: AsyncConnectionPool,
    http: httpx.AsyncClient,
    resolve_endpoint: KbEndpointResolver,
    service_user_code: str,
    pending_threshold_minutes: int,
    batch_size: int,
) -> None:
    async with pool.connection() as conn:
        async with conn.transaction():
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT b.property_id, b.kn_code, b.file_path, "
                    "       b.attempt_id, p.backend_name "
                    "FROM kgw_metadata_property_binding b "
                    "JOIN kgw_metadata_property p USING (property_id) "
                    "WHERE b.status='PENDING' "
                    "  AND b.bound_at < NOW() - INTERVAL '%s minutes' "
                    "LIMIT %s "
                    "FOR UPDATE SKIP LOCKED",
                    (pending_threshold_minutes, batch_size),
                )
                rows = await cur.fetchall()
            for row in rows:
                await _probe_one(conn, http, resolve_endpoint,
                                  service_user_code, row)


async def _probe_one(conn, http, resolve_endpoint, service_user_code, row):
    try:
        endpoint = await resolve_endpoint(row["kn_code"])
        resp = await http.post(
            f"{endpoint}/api/v1/knowledgeItems/metadata/get",
            json={"knCode": row["kn_code"],
                  "filePath": row["file_path"],
                  "metadataFieldList": [row["backend_name"]]},
            headers={"X-User-Id": service_user_code},
            timeout=10.0,
        )
        if resp.status_code != 200:
            return  # 后端不可达,留到下一轮
        body = resp.json()
        md = (body.get("resultObject") or {}).get("metadata") or {}
        if row["backend_name"] in md:
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE kgw_metadata_property_binding SET status='SYNCED' "
                    "WHERE attempt_id=%s",
                    (row["attempt_id"],),
                )
        else:
            async with conn.cursor() as cur:
                await cur.execute(
                    "DELETE FROM kgw_metadata_property_binding "
                    "WHERE attempt_id=%s",
                    (row["attempt_id"],),
                )
    except (httpx.HTTPError, ValueError) as exc:
        _log.warning("reconcile.probe.error",
                     attempt_id=row["attempt_id"], error=repr(exc))


async def run_reconcile_loop(
    pool, http, resolve_endpoint, *, service_user_code: str,
    interval_seconds: float = 30.0,
    stop_event: asyncio.Event | None = None,
) -> None:
    while True:
        if stop_event is not None and stop_event.is_set():
            return
        try:
            await reconcile_iteration(
                pool, http=http, resolver=resolve_endpoint,
                service_user_code=service_user_code,
            )
        except Exception:  # noqa: BLE001
            _log.exception("reconcile.iteration.error")
        try:
            await asyncio.wait_for(
                stop_event.wait() if stop_event else asyncio.sleep(interval_seconds),
                timeout=interval_seconds,
            )
        except asyncio.TimeoutError:
            continue
        else:
            return
```

- [ ] **Step 4: 在 main.py lifespan 拉起 reconcile worker**

跟 cleanup worker 平行的拉起方式:

```python
from kgw.workers.binding_reconcile import run_reconcile_loop

app.state.reconcile_task = asyncio.create_task(
    run_reconcile_loop(
        app.state.pool, app.state.http, _resolve_endpoint,
        service_user_code=settings.kgw_service_user_code,
        stop_event=stop_event,
    )
)
```

在 `Settings`(`byclaw-kgw/src/kgw/settings.py`)增加:

```python
kgw_service_user_code: str = "kgw-service"  # reconcile worker 探测后端时使用的服务身份
```

shutdown 段同步等待:

```python
await asyncio.gather(
    app.state.cleanup_task, app.state.reconcile_task,
    return_exceptions=True,
)
```

- [ ] **Step 5: 跑 reconcile 测试**

Run: `cd byclaw-kgw && uv run pytest tests/test_workers_binding_reconcile.py -m integration -v`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add byclaw-kgw/src/kgw/workers/binding_reconcile.py \
        byclaw-kgw/src/kgw/main.py \
        byclaw-kgw/src/kgw/settings.py \
        byclaw-kgw/tests/test_workers_binding_reconcile.py
git commit -m "feat(kgw): add metadataProperty binding reconcile worker"
```

## Task 12: admin 端点 — 4 个运维查询/控制接口

**Files:**
- Create: `byclaw-kgw/src/kgw/api/admin_metadata.py`
- Test: `byclaw-kgw/tests/test_api_admin_metadata.py`
- Modify: `byclaw-kgw/src/kgw/main.py`(注册 router)

端点:
1. `GET /kgw/admin/v1/metadata-properties` — 列所有(含 DELETED)+ sync 明细
2. `POST /kgw/admin/v1/metadata-properties/{propertyName}/sync-retry` — FAILED → SYNCING(可指定 knCode)
3. `POST /kgw/admin/v1/metadata-properties/{propertyName}/purge-retry` — PURGE_FAILED → PURGING
4. `GET /kgw/admin/v1/metadata-properties/orphans?knCode=X` — 死列扫描(GET 列表,不实现 DELETE)

- [ ] **Step 1: 写测试**

```python
import pytest
from kgw.metadata.registry import create_property

pytestmark = pytest.mark.integration


async def test_list_all_returns_active_and_deleted(client, integration_pool):
    p = await create_property(integration_pool, property_name="ad1",
                              value_type="string")
    async with integration_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE kgw_metadata_property SET status='DELETED', "
                "deleted_at=NOW() WHERE property_id=%s",
                (p.property_id,),
            )
    resp = await client.get("/kgw/admin/v1/metadata-properties")
    body = resp.json()
    names = {item["propertyName"]: item["status"]
             for item in body["resultObject"]["data"]}
    assert names.get("ad1") == "DELETED"


async def test_sync_retry_flips_failed_to_syncing(client, integration_pool):
    p = await create_property(integration_pool, property_name="ad2",
                              value_type="string")
    async with integration_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property_sync "
                "(property_id, kn_code, sync_status, last_error) "
                "VALUES (%s, 'hr', 'FAILED', 'oops')",
                (p.property_id,),
            )
    resp = await client.post(
        "/kgw/admin/v1/metadata-properties/ad2/sync-retry",
        json={"knCode": "hr"},
    )
    assert resp.json()["resultCode"] == "0"
    async with integration_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT sync_status FROM kgw_metadata_property_sync "
                "WHERE property_id=%s AND kn_code=%s",
                (p.property_id, "hr"),
            )
            assert (await cur.fetchone())["sync_status"] == "SYNCING"
```

- [ ] **Step 2: 实现 admin_metadata.py**

```python
"""metadataProperty 运维端点(只读 + 状态翻转,不直接调后端)。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Request
from kgw.envelope import success
from kgw.metadata import sync as sync_mod

router = APIRouter(prefix="/kgw/admin/v1/metadata-properties")


@router.get("")
async def list_all(request: Request):
    pool = request.app.state.pool
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT p.property_id, p.property_name, p.backend_name, "
                "       p.value_type, p.status, p.created_at, p.deleted_at "
                "FROM kgw_metadata_property p "
                "ORDER BY p.created_at DESC",
            )
            props = await cur.fetchall()
            await cur.execute(
                "SELECT property_id, kn_code, sync_status, last_error "
                "FROM kgw_metadata_property_sync"
            )
            syncs = await cur.fetchall()
    sync_index: dict[int, list[dict]] = {}
    for s in syncs:
        sync_index.setdefault(s["property_id"], []).append({
            "knCode": s["kn_code"], "syncStatus": s["sync_status"],
            "lastError": s.get("last_error"),
        })
    data = [{
        "propertyName": p["property_name"],
        "backendName": p["backend_name"],
        "valueType": p["value_type"],
        "status": p["status"],
        "syncDetails": sync_index.get(p["property_id"], []),
    } for p in props]
    return success({"data": data})


@router.post("/{property_name}/sync-retry")
async def sync_retry(
    request: Request, property_name: str, body: dict[str, Any]
):
    pool = request.app.state.pool
    kn_code = body.get("knCode")
    sql = (
        "UPDATE kgw_metadata_property_sync SET sync_status='SYNCING', "
        "       last_sync_at=NOW(), last_error=NULL "
        "WHERE property_id IN ("
        "   SELECT property_id FROM kgw_metadata_property "
        "   WHERE property_name=%s AND status='ACTIVE'"
        ") AND sync_status='FAILED'"
    )
    params: tuple[Any, ...] = (property_name,)
    if kn_code:
        sql += " AND kn_code=%s"
        params = (property_name, kn_code)
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params)
            updated = cur.rowcount
    return success({"updated": updated})
```

- [ ] **Step 3: 追加 purge-retry 与 orphans 端点**

```python
@router.post("/{property_name}/purge-retry")
async def purge_retry(
    request: Request, property_name: str, body: dict[str, Any]
):
    pool = request.app.state.pool
    kn_code = body.get("knCode")
    sql = (
        "UPDATE kgw_metadata_property_sync SET sync_status='PURGING', "
        "       last_sync_at=NOW(), last_error=NULL "
        "WHERE property_id IN ("
        "   SELECT property_id FROM kgw_metadata_property "
        "   WHERE property_name=%s"  # 不限 status,DELETED 也允许 retry
        ") AND sync_status='PURGE_FAILED'"
    )
    params: tuple[Any, ...] = (property_name,)
    if kn_code:
        sql += " AND kn_code=%s"
        params = (property_name, kn_code)
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params)
            updated = cur.rowcount
    return success({"updated": updated})


@router.get("/orphans")
async def orphans(
    request: Request, kn_code: str = Query(alias="knCode")
):
    """扫该 KB 后端 metadataFields/list,找出网关 sync 表里没有但带 prefix 的字段。"""
    http = request.app.state.http
    config_provider = request.app.state.config_provider
    auth_provider = request.app.state.auth_provider
    pool = request.app.state.pool

    cfg = await config_provider.get(kn_code)
    headers = await auth_provider.resolve_headers(
        user_code=request.app.state.kgw_service_user_code,
        header_template=cfg.headers,
    )
    resp = await http.post(
        f"{cfg.endpoint_url}/api/v1/knowledgeItems/metadataFields/list",
        json={"knCodeList": [kn_code]}, headers=headers, timeout=15.0,
    )
    backend_fields = [
        f["propertyName"] for f in
        (resp.json().get("resultObject") or {}).get("data") or []
    ]
    candidates = [n for n in backend_fields if n.startswith("__byclaw_kgw__")]

    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT p.backend_name FROM kgw_metadata_property_sync s "
                "JOIN kgw_metadata_property p USING (property_id) "
                "WHERE s.kn_code=%s "
                "  AND s.sync_status IN ('SYNCED','PURGING','PURGE_FAILED')",
                (kn_code,),
            )
            known = {r["backend_name"] for r in await cur.fetchall()}
    orphan = [n for n in candidates if n not in known]
    return success({"data": orphan})
```

`request.app.state.kgw_service_user_code` 在 lifespan 阶段从 `settings.kgw_service_user_code` 赋值即可。

- [ ] **Step 4: 注册 router**

修改 `byclaw-kgw/src/kgw/main.py`:

```python
from kgw.api import admin_metadata
app.include_router(admin_metadata.router)
```

并在 lifespan 段把 `kgw_service_user_code` 暴露到 `app.state`:

```python
app.state.kgw_service_user_code = settings.kgw_service_user_code
```

- [ ] **Step 5: 跑 admin 测试**

Run: `cd byclaw-kgw && uv run pytest tests/test_api_admin_metadata.py -m integration -v`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add byclaw-kgw/src/kgw/api/admin_metadata.py \
        byclaw-kgw/src/kgw/main.py \
        byclaw-kgw/tests/test_api_admin_metadata.py
git commit -m "feat(kgw): add metadataProperty admin endpoints"
```

## Task 13: 端到端集成测试 + 全量 lint/test 通过

把前 12 个任务的能力联在一起跑一遍 happy path + 同名再造 + 多 KB 字段一致改写,模拟真实使用流程。

**Files:**
- Create: `byclaw-kgw/tests/test_integration_s4.py`

- [ ] **Step 1: 写 S4 端到端测试**

```python
import asyncio
import pytest
import respx
from httpx import Response
from kgw.workers.cleanup import cleanup_iteration

pytestmark = pytest.mark.integration


async def test_e2e_create_use_delete_recreate_with_cleanup(
    client, integration_pool, http_client, kb_config_resolver_factory
):
    # 1. create -> 2. use -> 3. unset -> 4. delete -> 5. recreate same name
    await client.post("/kgw/api/v1/metadataProperties/create",
                      json={"propertyName": "e2e_x", "valueType": "string"})
    with respx.mock(base_url="http://kb-hr.test") as mock:
        mock.post("/api/v1/metadataProperties/batchCreate").mock(
            return_value=Response(200, json={"resultCode": "0",
                                              "resultMsg": "success",
                                              "resultObject": {}})
        )
        mock.post("/api/v1/knowledgeItems/metadata/update").mock(
            return_value=Response(200, json={
                "resultCode": "0", "resultMsg": "success",
                "resultObject": {"knCode": "hr", "filePath": "/e.md",
                                  "metadata": {}}})
        )
        await client.post(
            "/kgw/api/v1/knowledgeItems/metadata/update",
            headers={"X-User-Id": "u1"},
            json={"knCode": "hr", "filePath": "/e.md",
                  "operationList": [{"propertyName": "e2e_x",
                                      "operation": "set", "value": "v"}]},
        )
        await client.post(
            "/kgw/api/v1/knowledgeItems/metadata/update",
            headers={"X-User-Id": "u1"},
            json={"knCode": "hr", "filePath": "/e.md",
                  "operationList": [{"propertyName": "e2e_x",
                                      "operation": "unset"}]},
        )
    # delete 通过
    resp = await client.post("/kgw/api/v1/metadataProperties/delete",
                              json={"propertyName": "e2e_x"})
    assert resp.json()["resultCode"] == "0"

    # cleanup 跑一轮 → 物理删
    resolver = kb_config_resolver_factory({"hr": "http://kb-hr.test"})
    with respx.mock(base_url="http://kb-hr.test") as mock:
        mock.post("/api/v1/metadataProperties/delete").mock(
            return_value=Response(200, json={"resultCode": "0",
                                              "resultMsg": "success",
                                              "resultObject": {}})
        )
        await cleanup_iteration(integration_pool, http_client, resolver,
                                 backoff_minutes=0)

    # 同名再造,新 valueType
    resp = await client.post("/kgw/api/v1/metadataProperties/create",
                              json={"propertyName": "e2e_x",
                                    "valueType": "number"})
    assert resp.json()["resultCode"] == "0"
```

- [ ] **Step 2: 跑完整测试套件 + lint**

```bash
cd byclaw-kgw
uv run ruff check src/ tests/
uv run pylint src/kgw
uv run pytest -m "not integration" -v        # 单测全过
uv run pytest -m integration -v              # 集成测全过
```

Expected: ruff 无 violations;pylint score ≥ 现有水平;两类测试全 PASS。如有 lint 报错,修到通过(以 ruff/pylint 当下规则为准,不放宽规则)。

- [ ] **Step 3: Commit**

```bash
git add byclaw-kgw/tests/test_integration_s4.py
git commit -m "test(kgw): add S4 end-to-end integration test"
```

- [ ] **Step 4: PR 准备**

按 byclaw 仓库 conventional commits + commit-convention 规范,把 S4 全部 commit 整理为一个 PR(或按需拆分)。PR 标题示例:`feat(kgw): S4 metadataProperty governance with backend_name versioning`。Body 列出本计划的 13 个 task 与对应 commit。

---

## 自审

完成 13 个 task 编写后,我做了一轮自审,记录如下:

**Spec 覆盖**

| spec 章节 | 实现任务 |
|---|---|
| §1 数据模型 - 4 张表 | Task 1(SQL 迁移) |
| §2.1 状态轨 1 主目录生命周期 | Task 3(create/delete 状态翻转)+ Task 10(物理删) |
| §2.2 状态轨 2 sync 状态机 | Task 4(SYNCING/SYNCED/FAILED)+ Task 10(PURGING/PURGED/PURGE_FAILED) |
| §2.3 状态轨 3 binding | Task 5 + Task 8 + Task 9 + Task 11 |
| §3.1 / 3.2 / 3.3 / 3.4 主目录 4 端点 | Task 7 |
| §3.5 metadata/update + lazy sync + binding | Task 8 |
| §3.6 metadata/get | Task 8 |
| §3.7 metadataFields/list 网关本地查 | Task 8 |
| §3.8 search/searchFile/metadataSearch DSL 改写 | Task 9 |
| §3.9 / 3.10 / 3.11 import / file-delete / dir-delete binding 联动 | Task 9 |
| §3.12 ingest events binding 复用 | spec 标注 S5 范围,本 plan 不实施;Task 8 提供的 lazy sync + binding 模块在 S5 直接复用 |
| §3.13 4 个 admin 端点 | Task 12 |
| §3.14 错误归一化(9 个 error_type) | Task 2 |
| §4.1 cleanup worker | Task 10 |
| §4.2 binding reconcile worker | Task 11 |
| §4.3 ensure_synced(两段事务) | Task 4 |
| §4.4 故障场景(Pod 崩溃/MinIO 不可达/同名再造) | Task 4 + Task 10 + Task 11 + Task 13 e2e 验证 |
| §4.5 监控指标 | spec 列出但实现细节落地点放到各 Task 中(Task 7/8/10 的端点写 Prom 指标);本 plan 不单列 task 是因为现有 metrics.py 已有 helper,各端点直接调用即可。**plan 自审决策:增加 Task 14 占位以确保不漏指标。** |
| §5.3 SQL 编号 005-007 | Task 1 |
| §5.4 冷启动 SYNCING → FAILED 转换 | Task 4 中的 startup hook(Task 4 Step 6 之外)— **plan 自审发现这一项未明示,需要在 main.py lifespan 中加一句"启动时把残留 SYNCING 转 FAILED",合入 Task 10 Step 4 一并处理。** |

**遗漏修正**

发现两项遗漏,作为 Task 14 补上:监控指标接入 + 启动期 SYNCING → FAILED 清理。

## Task 14: 监控指标接入 + 启动期 SYNCING → FAILED

**Files:**
- Modify: `byclaw-kgw/src/kgw/observability/metrics.py`(注册 9 个新 metric)
- Modify: `byclaw-kgw/src/kgw/api/metadata_properties.py`(create/delete 时打点)
- Modify: `byclaw-kgw/src/kgw/api/knowledge_items.py`(metadata/update / sync 失败/成功打点)
- Modify: `byclaw-kgw/src/kgw/workers/cleanup.py`(purge 成功/失败打点)
- Modify: `byclaw-kgw/src/kgw/main.py`(startup 时清理残留 SYNCING)
- Test: `byclaw-kgw/tests/test_metadata_metrics.py`

- [ ] **Step 1: 在 metrics.py 注册新指标**

```python
from prometheus_client import Counter, Gauge

kgw_metadata_property_total = Gauge(
    "kgw_metadata_property_total",
    "Count of metadata properties by status",
    ["status"], registry=REGISTRY,
)
kgw_metadata_property_sync_total = Counter(
    "kgw_metadata_property_sync_total",
    "Lazy sync attempts",
    ["result"], registry=REGISTRY,
)
kgw_metadata_property_purge_total = Counter(
    "kgw_metadata_property_purge_total",
    "Cleanup worker purge attempts",
    ["result"], registry=REGISTRY,
)
kgw_metadata_binding_pending_gauge = Gauge(
    "kgw_metadata_binding_pending_gauge",
    "Current PENDING binding count",
    registry=REGISTRY,
)
kgw_metadata_binding_outbox_gauge = Gauge(
    "kgw_metadata_binding_outbox_gauge",
    "Current outbox row count",
    registry=REGISTRY,
)
kgw_cleanup_worker_iteration_total = Counter(
    "kgw_cleanup_worker_iteration_total",
    "Cleanup worker iterations",
    registry=REGISTRY,
)
```

`*_failed_gauge` 与 `*_processed_total` 等其他指标按相同模式追加(见 spec §4.5)。

- [ ] **Step 2: 在 ensure_synced / cleanup_iteration 打点**

`ensure_synced` 成功路径 → `kgw_metadata_property_sync_total.labels(result="success").inc()`;失败路径 → `result="failed"`。
`_purge_one` 同理:`kgw_metadata_property_purge_total.labels(result=...)`。

- [ ] **Step 3: startup 期清理残留 SYNCING**

在 `_lifespan` startup 段(`run_migrations` 之后,worker 启动之前)插入:

```python
async with pool.connection() as conn:
    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE kgw_metadata_property_sync "
            "SET sync_status='FAILED', last_error='gateway restart' "
            "WHERE sync_status='SYNCING'"
        )
```

- [ ] **Step 4: 写指标测试**

新建 `byclaw-kgw/tests/test_metadata_metrics.py`:

```python
import pytest
import respx
from httpx import Response
from kgw.observability.metrics import (
    kgw_metadata_property_sync_total,
    kgw_metadata_property_purge_total,
)

pytestmark = pytest.mark.integration


async def test_sync_success_increments_metric(client, integration_pool):
    before = kgw_metadata_property_sync_total.labels(result="success")._value.get()
    await client.post("/kgw/api/v1/metadataProperties/create",
                      json={"propertyName": "m1", "valueType": "string"})
    with respx.mock(base_url="http://kb-hr.test") as mock:
        mock.post("/api/v1/metadataProperties/batchCreate").mock(
            return_value=Response(200, json={"resultCode": "0",
                                              "resultMsg": "success",
                                              "resultObject": {}})
        )
        mock.post("/api/v1/knowledgeItems/metadata/update").mock(
            return_value=Response(200, json={"resultCode": "0",
                                              "resultMsg": "success",
                                              "resultObject": {"metadata": {}}})
        )
        await client.post(
            "/kgw/api/v1/knowledgeItems/metadata/update",
            headers={"X-User-Id": "u1"},
            json={"knCode": "hr", "filePath": "/m.md",
                  "operationList": [{"propertyName": "m1",
                                      "operation": "set", "value": "v"}]},
        )
    after = kgw_metadata_property_sync_total.labels(result="success")._value.get()
    assert after >= before + 1


async def test_startup_clears_lingering_syncing(integration_pool):
    """模拟启动:写一个 SYNCING 行,再次跑 startup hook,应被翻 FAILED。"""
    async with integration_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO kgw_metadata_property "
                "(property_name, backend_name, value_type, status) "
                "VALUES ('mq', '__byclaw_kgw__mq__v9999', 'string', 'ACTIVE') "
                "RETURNING property_id"
            )
            pid = (await cur.fetchone())["property_id"]
            await cur.execute(
                "INSERT INTO kgw_metadata_property_sync "
                "(property_id, kn_code, sync_status, last_sync_at) "
                "VALUES (%s, 'hr', 'SYNCING', NOW())",
                (pid,),
            )
    # 直接调 main 内部 hook:把它抽成可单测的纯函数 _clear_syncing(pool)
    from kgw.main import _clear_lingering_syncing
    await _clear_lingering_syncing(integration_pool)
    async with integration_pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT sync_status FROM kgw_metadata_property_sync "
                "WHERE property_id=%s",
                (pid,),
            )
            assert (await cur.fetchone())["sync_status"] == "FAILED"
```

要求 main.py 把 startup hook 抽成顶层 `async def _clear_lingering_syncing(pool):`,以便单测可直接调用。

- [ ] **Step 5: 跑测试 + lint**

```bash
cd byclaw-kgw
uv run ruff check src/ tests/
uv run pytest -m integration tests/test_metadata_metrics.py -v
```
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add byclaw-kgw/src/kgw/observability/metrics.py \
        byclaw-kgw/src/kgw/api/metadata_properties.py \
        byclaw-kgw/src/kgw/api/knowledge_items.py \
        byclaw-kgw/src/kgw/workers/cleanup.py \
        byclaw-kgw/src/kgw/main.py \
        byclaw-kgw/tests/test_metadata_metrics.py
git commit -m "feat(kgw): add S4 metadata metrics + startup SYNCING cleanup"
```

<!-- end of plan -->





















































