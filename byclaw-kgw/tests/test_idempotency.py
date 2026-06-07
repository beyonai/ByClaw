from __future__ import annotations

from pathlib import Path

import pytest
import pytest_asyncio
from kgw import idempotency
from kgw.db import build_pool, run_migrations
from kgw.schemas.standard_item import StandardItem

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]
_SQL_DIR = Path(__file__).resolve().parent.parent / "sql"

_ITEM = StandardItem.model_validate(
    {
        "sourceId": "src1",
        "itemId": "doc1",
        "version": "v1",
        "op": "upsert",
        "knCode": "kb1",
        "filePath": "/a.md",
        "content": "hello",
    }
)
_ITEM_NULL_VER = StandardItem.model_validate(
    {
        "sourceId": "src2",
        "itemId": "doc2",
        "op": "delete",
        "knCode": "kb1",
        "filePath": "/b.md",
    }
)


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def pool(pg_dsn):
    p = await build_pool(pg_dsn, min_size=1, max_size=3)
    await run_migrations(p, _SQL_DIR)
    async with p.connection() as conn:
        await conn.execute("DELETE FROM kgw_ingest_event")
        await conn.commit()
    yield p
    await p.close()


async def test_insert_received(pool):  # pylint: disable=redefined-outer-name
    eid = await idempotency.insert_received(pool, _ITEM, payload_size_bytes=100)
    assert eid > 0
    row = await idempotency.get_by_id(pool, eid)
    assert row.status == "received"
    assert row.retry_count == 0


async def test_duplicate_raises(pool):  # pylint: disable=redefined-outer-name
    with pytest.raises(idempotency.DuplicateEvent):
        await idempotency.insert_received(pool, _ITEM, payload_size_bytes=100)


async def test_get_by_idempotency_key(pool):  # pylint: disable=redefined-outer-name
    row = await idempotency.get_by_idempotency_key(
        pool, source_id="src1", item_id="doc1", version="v1"
    )
    assert row is not None
    assert row.status == "received"


async def test_mark_done(pool):  # pylint: disable=redefined-outer-name
    row = await idempotency.get_by_idempotency_key(
        pool, source_id="src1", item_id="doc1", version="v1"
    )
    await idempotency.mark_done(pool, row.event_id)
    updated = await idempotency.get_by_id(pool, row.event_id)
    assert updated.status == "done"
    assert updated.done_at is not None


async def test_mark_failed(pool):  # pylint: disable=redefined-outer-name
    eid = await idempotency.insert_received(
        pool,
        StandardItem.model_validate(
            {
                "sourceId": "sx",
                "itemId": "dx",
                "version": "vx",
                "op": "upsert",
                "knCode": "k",
                "filePath": "/x.md",
                "content": "x",
            }
        ),
        payload_size_bytes=5,
    )
    await idempotency.mark_failed(
        pool, eid, error_type="UPSTREAM_ERROR", error_message="boom"
    )
    row = await idempotency.get_by_id(pool, eid)
    assert row.status == "failed"
    assert row.error_type == "UPSTREAM_ERROR"


async def test_reset_for_replay(pool):  # pylint: disable=redefined-outer-name
    row = await idempotency.get_by_idempotency_key(
        pool, source_id="sx", item_id="dx", version="vx"
    )
    await idempotency.reset_for_replay(pool, row.event_id)
    updated = await idempotency.get_by_id(pool, row.event_id)
    assert updated.status == "received"
    assert updated.retry_count == 1
    assert updated.error_type is None


async def test_null_version_no_dedup(pool):  # pylint: disable=redefined-outer-name
    eid1 = await idempotency.insert_received(pool, _ITEM_NULL_VER, payload_size_bytes=0)
    eid2 = await idempotency.insert_received(
        pool,
        StandardItem.model_validate(
            {
                "sourceId": "src2",
                "itemId": "doc2",
                "op": "delete",
                "knCode": "kb1",
                "filePath": "/b.md",
            }
        ),
        payload_size_bytes=0,
    )
    assert eid1 != eid2


async def test_list_events_by_status(pool):  # pylint: disable=redefined-outer-name
    rows, total = await idempotency.list_events(
        pool, status="received", page=1, page_size=10
    )
    assert total >= 1
    assert all(r.status == "received" for r in rows)
