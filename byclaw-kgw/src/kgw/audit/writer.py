"""Audit log writer.

A single ``AuditWriter`` instance lives for the app lifetime. Endpoints
call ``record(entry)`` synchronously; the entry is enqueued and a
background drain task writes it to ``kgw_audit_log``. Audit failures
are NEVER raised back to the request path (v5 spec §7.1).

Backpressure: the queue has a bounded size. When full, the entry is
dropped, a counter is incremented, and a warning is logged.
"""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from typing import Any

from kgw.observability.logger import get_logger
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

_log = get_logger(__name__)


@dataclass
class AuditEntry:
    """A single audit row matching v5 spec §5.1 kgw_audit_log columns."""

    source: str
    trace_id: str | None
    actor_user_id: str | None
    actor_kind: str | None
    operation_type: str
    kn_code: str | None
    file_path: str | None
    payload_size_bytes: int | None
    row_count: int | None
    payload_redacted: dict[str, Any] | None
    result_code: str | None
    result_msg: str | None
    latency_ms: int | None
    actor_ip: str | None = None
    source_connector: str | None = None
    source_id: str | None = None
    source_item_id: str | None = None
    source_version: str | None = None


_INSERT_SQL = """
INSERT INTO kgw_audit_log (
    source, trace_id, actor_user_id, actor_ip, actor_kind,
    source_connector, source_id, source_item_id, source_version,
    operation_type, kn_code, file_path,
    payload_size_bytes, row_count, payload_redacted,
    result_code, result_msg, latency_ms
) VALUES (
    %(source)s, %(trace_id)s, %(actor_user_id)s, %(actor_ip)s, %(actor_kind)s,
    %(source_connector)s, %(source_id)s, %(source_item_id)s, %(source_version)s,
    %(operation_type)s, %(kn_code)s, %(file_path)s,
    %(payload_size_bytes)s, %(row_count)s, %(payload_redacted)s,
    %(result_code)s, %(result_msg)s, %(latency_ms)s
)
"""


@dataclass
class _FlushBarrier:
    done: asyncio.Future


_SENTINEL: Any = object()


class AuditWriter:
    """Async fire-and-forget audit writer."""

    def __init__(
        self,
        pool: AsyncConnectionPool,
        *,
        queue_max_size: int = 10_000,
    ) -> None:
        self._pool = pool
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=queue_max_size)
        self._task: asyncio.Task | None = None
        self._closed = False
        self.dropped_count = 0

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._drain(), name="kgw-audit-drain")

    async def stop(self) -> None:
        self._closed = True
        try:
            self._queue.put_nowait(_SENTINEL)
        except asyncio.QueueFull:
            pass
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=5.0)
            except asyncio.TimeoutError:
                self._task.cancel()
            self._task = None

    async def record(self, entry: AuditEntry) -> None:
        """Enqueue an entry. Never blocks; never raises."""
        if self._closed:
            return
        try:
            self._queue.put_nowait(entry)
        except asyncio.QueueFull:
            self.dropped_count += 1
            _log.warning(
                "audit.dropped_queue_full",
                operation_type=entry.operation_type,
                kn_code=entry.kn_code,
                dropped_count=self.dropped_count,
            )

    async def flush(self, *, timeout: float = 5.0) -> None:
        """Wait until all currently-queued entries are processed (for tests)."""
        loop = asyncio.get_running_loop()
        done = loop.create_future()
        await self._queue.put(_FlushBarrier(done))
        try:
            await asyncio.wait_for(done, timeout=timeout)
        except asyncio.TimeoutError:
            _log.warning("audit.flush_timeout", timeout=timeout)

    async def _drain(self) -> None:
        while True:
            item = await self._queue.get()
            if item is _SENTINEL:
                break
            if isinstance(item, _FlushBarrier):
                if not item.done.done():
                    item.done.set_result(None)
                continue
            try:
                await self._write_one(item)
            except Exception as exc:  # noqa: BLE001
                _log.error(
                    "audit.write_failed",
                    operation_type=item.operation_type,
                    kn_code=item.kn_code,
                    error=str(exc),
                )

    async def _write_one(self, entry: AuditEntry) -> None:
        params = asdict(entry)
        payload = params.get("payload_redacted")
        params["payload_redacted"] = Jsonb(payload) if payload is not None else None
        async with self._pool.connection() as conn:
            try:
                await conn.execute(_INSERT_SQL, params)
                await conn.commit()
            except Exception:
                await conn.rollback()
                raise
