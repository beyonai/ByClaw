"""Tests for AuditWriter.

Unit tests use mock pools. Integration tests (marked @pytest.mark.integration)
hit a real database.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest


def _make_entry(**overrides):
    from kgw.audit.writer import AuditEntry

    defaults = {
        "source": "serve",
        "trace_id": "t-1",
        "actor_user_id": "user_0001",
        "actor_kind": "user",
        "operation_type": "echo",
        "kn_code": "hr_policy",
        "file_path": None,
        "payload_size_bytes": 42,
        "row_count": None,
        "payload_redacted": {"q": "hello"},
        "result_code": "0",
        "result_msg": "success",
        "latency_ms": 12,
    }
    defaults.update(overrides)
    return AuditEntry(**defaults)


def _make_mock_pool(execute_side_effect=None):
    """Return a minimal mock pool compatible with AuditWriter._write_one."""
    mock_conn = AsyncMock()
    if execute_side_effect:
        mock_conn.execute = AsyncMock(side_effect=execute_side_effect)
    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_cm.__aexit__ = AsyncMock(return_value=None)

    mock_pool = MagicMock()
    mock_pool.connection = MagicMock(return_value=mock_cm)
    return mock_pool, mock_conn


async def test_audit_writer_records_entry_via_drain():
    from kgw.audit.writer import AuditWriter

    mock_pool, mock_conn = _make_mock_pool()
    writer = AuditWriter(mock_pool, queue_max_size=10)
    await writer.start()
    try:
        await writer.record(_make_entry())
        await writer.flush(timeout=2.0)
        assert mock_conn.execute.called
    finally:
        await writer.stop()


async def test_audit_writer_swallows_db_errors():
    """DB failure must not propagate to caller."""
    from kgw.audit.writer import AuditWriter

    mock_pool, _ = _make_mock_pool(execute_side_effect=RuntimeError("db is down"))
    writer = AuditWriter(mock_pool, queue_max_size=10)
    await writer.start()
    try:
        await writer.record(_make_entry())
        await writer.flush(timeout=2.0)
        # No exception raised
    finally:
        await writer.stop()


async def test_audit_writer_full_queue_drops_entry():
    """When queue is full, record() drops silently and increments dropped_count."""
    from kgw.audit.writer import AuditWriter

    # Queue size 1; don't start the drain so queue fills immediately.
    mock_pool, _ = _make_mock_pool()
    writer = AuditWriter(mock_pool, queue_max_size=1)
    # Fill the queue without starting the drain
    await writer.record(_make_entry())
    # Second record should be dropped
    await writer.record(_make_entry())
    assert writer.dropped_count == 1


async def test_audit_writer_closed_record_noop():
    """After stop(), record() is a no-op."""
    from kgw.audit.writer import AuditWriter

    mock_pool, mock_conn = _make_mock_pool()
    writer = AuditWriter(mock_pool, queue_max_size=10)
    await writer.start()
    await writer.stop()
    await writer.record(_make_entry())
    # No write attempted after stop
    assert not mock_conn.execute.called


@pytest.mark.integration
async def test_audit_writer_persists_entries(pg_dsn: str):
    from kgw.db import build_pool, run_migrations

    sql_dir = Path(__file__).resolve().parent.parent / "sql"
    pool = await build_pool(pg_dsn, min_size=1, max_size=2)
    try:
        await run_migrations(pool, sql_dir)

        from kgw.audit.writer import AuditWriter

        writer = AuditWriter(pool, queue_max_size=10)
        await writer.start()
        try:
            await writer.record(_make_entry())
            await writer.flush(timeout=3.0)
        finally:
            await writer.stop()

        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT source, trace_id, actor_user_id, operation_type, "
                "kn_code, result_code, latency_ms "
                "FROM kgw_audit_log ORDER BY id DESC LIMIT 1"
            )
            row = await cur.fetchone()
        assert row["source"] == "serve"
        assert row["trace_id"] == "t-1"
        assert row["actor_user_id"] == "user_0001"
        assert row["operation_type"] == "echo"
        assert row["kn_code"] == "hr_policy"
        assert row["result_code"] == "0"
        assert row["latency_ms"] == 12
    finally:
        async with pool.connection() as conn:
            await conn.execute("DROP TABLE IF EXISTS kgw_audit_log CASCADE")
            await conn.execute("DROP TABLE IF EXISTS kgw_kb_source_lock CASCADE")
            await conn.execute("DROP TABLE IF EXISTS kgw_kb_conflict_log CASCADE")
            await conn.execute("DROP TABLE IF EXISTS kgw_migration CASCADE")
            await conn.commit()
        await pool.close()
