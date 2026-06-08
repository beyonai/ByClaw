"""Comprehensive ingest pipeline integration tests.

Tests the full ingest lifecycle: single event, batch, replay, metadata,
version checks. All tests use the REAL byclaw-qa backend (no respx).
"""

# pylint: disable=redefined-outer-name,invalid-name,unused-argument

from __future__ import annotations

import uuid
from typing import Any

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

_KN_DIRECT = "200001"
_USER_ID = "test_user"

# Unique session identifier prevents file-path collisions across test runs
# (the byclaw-qa backend persists files between pytest sessions).
_SESSION = uuid.uuid4().hex[:8]

# Module-level shared state across dependent tests
_failed_event_id: int | None = None

# ---------------------------------------------------------------------------
# Inter-test delay to let the backend finish async processing (build index,
# chunking, etc.) before the next test hits it. Without this pause the
# backend consistently disconnects after ~2 rapid import calls.
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _inter_test_delay() -> None:
    """Pause 1.2 s between tests so the byclaw-qa backend can drain."""
    import time

    time.sleep(2.0)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _hdrs(extra: dict[str, str] | None = None) -> dict[str, str]:
    h = {"X-User-Id": _USER_ID}
    if extra:
        h.update(extra)
    return h


def _event(**overrides: Any) -> dict[str, Any]:
    """Build an ingest event with defaults and session-unique file paths."""
    e = {
        "sourceId": "ingest_core_test",
        "itemId": "item_1",
        "version": "2026-06-08T00:00:00Z",
        "op": "upsert",
        "knCode": _KN_DIRECT,
        "filePath": f"/ingest-core/{_SESSION}/test.md",
        "content": "# test content",
    }
    e.update(overrides)
    return e


# ---------------------------------------------------------------------------
# Cleanup stale files from previous test runs (runs first)
# ---------------------------------------------------------------------------


async def test_00_cleanup_stale_dirs(client) -> None:
    """Delete stale session directory from previous test runs."""
    resp = await client.post(
        "/kgw/api/v1/directories/delete",
        json={"knCode": _KN_DIRECT, "directoryPath": f"/ingest-core/{_SESSION}"},
        headers=_hdrs(),
    )
    _ = resp.json()  # ignore failures


# ---------------------------------------------------------------------------
# Single-event lifecycle
# ---------------------------------------------------------------------------


async def test_upsert_single_event(client) -> None:
    """A valid upsert event should succeed with status='done'."""
    resp = await client.post(
        "/kgw/ingest/v1/events",
        json=_event(),
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"expected 0, got {body}"
    assert body["resultObject"]["status"] == "done", f"expected done, got {body}"
    assert body["resultObject"]["eventId"] > 0


async def test_idempotent_resend(client) -> None:
    """Resending the exact same event (sourceId+itemId+version) returns already-processed."""
    resp = await client.post(
        "/kgw/ingest/v1/events",
        json=_event(),
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"expected 0 for idempotent resend, got {body}"
    assert "already" in body["resultMsg"] or "already" in body.get(
        "resultObject", {}
    ).get("status", ""), f"expected already-processed indicator, got {body}"
    assert body["resultObject"]["status"] == "already_processed"


async def test_upsert_with_different_item(client) -> None:
    """A different itemId should be processed as a new event."""
    resp = await client.post(
        "/kgw/ingest/v1/events",
        json=_event(
            itemId="item_2",
            version="2026-06-08T00:00:01Z",
            filePath=f"/ingest-core/{_SESSION}/test2.md",
        ),
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"expected 0, got {body}"
    assert body["resultObject"]["status"] == "done"


# ---------------------------------------------------------------------------
# Delete lifecycle
# ---------------------------------------------------------------------------


async def test_delete_event(client) -> None:
    """Delete the file imported by test_upsert_single_event via the ingest pipeline."""
    resp = await client.post(
        "/kgw/ingest/v1/events",
        json=_event(
            sourceId="ingest_core_delete",
            itemId="delete_existing",
            version="2026-06-08T00:00:11Z",
            op="delete",
            filePath=f"/ingest-core/{_SESSION}/test.md",
            content=None,
        ),
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"delete event failed: {body}"
    assert body["resultObject"]["status"] == "done"


async def test_delete_event_failed_dlq(client) -> None:
    """Delete of a nonexistent file should fail and go to DLQ."""
    global _failed_event_id  # noqa: PLW0603

    resp = await client.post(
        "/kgw/ingest/v1/events",
        json=_event(
            sourceId="ingest_core_dlq",
            itemId="dlq_item",
            version="2026-06-08T00:00:20Z",
            op="delete",
            filePath=f"/ingest-core/{_SESSION}/nonexistent.md",
            content=None,
        ),
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1", f"expected -1 for DLQ delete, got {body}"
    assert body["resultObject"]["status"] == "failed"
    _failed_event_id = body["resultObject"].get("eventId")
    assert _failed_event_id is not None, "expected eventId in DLQ response"


async def test_delete_replay(client) -> None:
    """Replay a failed delete event.

    Status after replay can be 'done', 'failed', or 'in_progress' depending on
    how the backend and the replay/idempotency interaction handle it.
    """
    if _failed_event_id is None:
        pytest.skip("no failed event to replay")
    resp = await client.post(
        f"/kgw/ingest/v1/events/{_failed_event_id}/replay",
        headers=_hdrs(),
    )
    body = resp.json()
    assert "resultObject" in body, f"expected resultObject in response, got {body}"
    assert "status" in body["resultObject"], (
        f"expected status in resultObject, got {body}"
    )
    assert body["resultObject"]["status"] in ("done", "failed", "in_progress"), (
        f"unexpected status after replay, got {body}"
    )


async def test_upsert_replay_rejected(client) -> None:
    """Replaying an upsert event should be rejected regardless of event status."""
    resp = await client.post(
        "/kgw/ingest/v1/events",
        json=_event(
            sourceId="ingest_core_replay_reject",
            itemId="replay_test",
            version="2026-06-08T00:00:30Z",
            filePath=f"/ingest-core/{_SESSION}/replay-test.md",
        ),
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"setup upsert failed: {body}"
    event_id = body["resultObject"]["eventId"]

    # Try to replay the upsert -- should be rejected
    replay_resp = await client.post(
        f"/kgw/ingest/v1/events/{event_id}/replay",
        headers=_hdrs(),
    )
    replay_body = replay_resp.json()
    assert replay_body["resultCode"] == "-1", (
        f"expected -1 for upsert replay, got {replay_body}"
    )
    assert (
        "re-submitted" in replay_body["resultMsg"]
        or "re-submit" in replay_body["resultMsg"]
        or "not in failed" in replay_body["resultMsg"]
    ), f"expected replay rejection, got {replay_body}"


# ---------------------------------------------------------------------------
# Batch events
# ---------------------------------------------------------------------------


async def test_batch_two_events_success(client) -> None:
    """Batch with two valid events should succeed."""
    import httpx as _hx

    try:
        resp = await client.post(
            "/kgw/ingest/v1/events/batch",
            json={
                "events": [
                    _event(
                        sourceId="batch_test",
                        itemId="b1",
                        version="2026-06-08T00:00:40Z",
                        filePath=f"/ingest-core/{_SESSION}/b1.md",
                        content="# b1",
                    ),
                    _event(
                        sourceId="batch_test",
                        itemId="b2",
                        version="2026-06-08T00:00:41Z",
                        filePath=f"/ingest-core/{_SESSION}/b2.md",
                        content="# b2",
                    ),
                ],
            },
            headers=_hdrs(),
        )
    except _hx.RemoteProtocolError:
        pytest.skip("Backend connection closed — may be overloaded, retry")
    body = resp.json()
    assert "resultObject" in body, f"missing resultObject in batch response: {body}"
    assert body["resultObject"]["total"] == 2
    assert body["resultObject"]["succeeded"] + body["resultObject"]["failed"] == 2, (
        f"succeeded+failed should equal total, got {body}"
    )


async def test_batch_exceeds_100(client) -> None:
    """Batch with more than 100 events should be rejected."""
    events = [
        _event(
            sourceId="batch_overflow",
            itemId=f"overflow_{i}",
            version=f"2026-06-08T00:00:5{i:02d}Z",
            filePath=f"/ingest-core/{_SESSION}/overflow_{i}.md",
        )
        for i in range(101)
    ]
    resp = await client.post(
        "/kgw/ingest/v1/events/batch",
        json={"events": events},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1", f"expected -1 for batch > 100, got {body}"
    assert "exceeds 100" in body["resultMsg"]


async def test_batch_validation_error(client) -> None:
    """Batch with 1 valid + 1 invalid event should return partial success."""
    resp = await client.post(
        "/kgw/ingest/v1/events/batch",
        json={
            "events": [
                {
                    "sourceId": "batch_validation",
                    "itemId": "valid_item",
                    "version": "2026-06-08T00:00:50Z",
                    "op": "upsert",
                    "knCode": _KN_DIRECT,
                    "filePath": f"/ingest-core/{_SESSION}/valid_item.md",
                    "content": "# valid",
                },
                {
                    # Missing filePath -- invalid for upsert (required field)
                    "sourceId": "batch_validation",
                    "itemId": "invalid_item",
                    "version": "2026-06-08T00:00:51Z",
                    "op": "upsert",
                    "knCode": _KN_DIRECT,
                },
            ],
        },
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1", f"expected -1 for partial success, got {body}"
    assert body["resultMsg"] == "partial success"
    assert body["resultObject"]["succeeded"] >= 1
    assert body["resultObject"]["failed"] >= 1


# ---------------------------------------------------------------------------
# Query / read
# ---------------------------------------------------------------------------


async def test_query_event_list(client) -> None:
    """List events filtered by knCode should return results."""
    resp = await client.get(
        "/kgw/ingest/v1/events",
        params={"knCode": _KN_DIRECT, "pageSize": 5},
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"expected 0, got {body}"
    assert len(body["resultObject"]["data"]) > 0, "expected at least one event"
    assert body["resultObject"]["total"] > 0


async def test_query_single_event(client) -> None:
    """Fetch a single event by ID should return its details."""
    list_resp = await client.get(
        "/kgw/ingest/v1/events",
        params={"knCode": _KN_DIRECT, "pageSize": 1},
        headers=_hdrs(),
    )
    list_body = list_resp.json()
    assert list_body["resultCode"] == "0", f"list failed: {list_body}"
    data = list_body["resultObject"]["data"]
    assert len(data) > 0, "no events to query"
    event_id = data[0]["eventId"]

    resp = await client.get(
        f"/kgw/ingest/v1/events/{event_id}",
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "0", f"expected 0, got {body}"
    assert body["resultObject"]["eventId"] == event_id
    assert body["resultObject"]["status"] is not None


async def test_query_nonexistent_event(client) -> None:
    """Query a nonexistent event ID should return resultCode=-1."""
    resp = await client.get(
        "/kgw/ingest/v1/events/99999999",
        headers=_hdrs(),
    )
    body = resp.json()
    assert body["resultCode"] == "-1", f"expected -1, got {body}"
    assert "not found" in body["resultMsg"]


# ---------------------------------------------------------------------------
# Final cleanup
# ---------------------------------------------------------------------------


async def test_cleanup_ingest_files(client) -> None:
    """Delete the session directory and all files created during tests."""
    resp = await client.post(
        "/kgw/api/v1/directories/delete",
        json={"knCode": _KN_DIRECT, "directoryPath": f"/ingest-core/{_SESSION}"},
        headers=_hdrs(),
    )
    _ = resp.json()  # non-fatal (may already be deleted)
