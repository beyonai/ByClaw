from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import JSONResponse
from kgw import idempotency
from kgw.envelope import PAYLOAD_TOO_LARGE
from kgw.event_processor import EventResult, process_event
from kgw.observability.metrics import kgw_ingest_semaphore_rejected_total
from kgw.schemas.standard_item import StandardItem
from pydantic import ValidationError

router = APIRouter(prefix="/kgw/ingest/v1")

_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024  # 4 MB


def _result_to_envelope(result: EventResult) -> dict[str, Any] | JSONResponse:
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
    base: dict[str, Any] = {"itemId": item_id, "status": result.status}
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
        raise PAYLOAD_TOO_LARGE(
            f"payload {content_length} bytes exceeds 4MB limit",
        )

    item = StandardItem.model_validate(body)

    state = request.app.state
    sem = state.ingest_semaphore

    trace_id = request.headers.get("X-Trace-Id")
    # sem._value is the internal slot counter; no public non-blocking API exists in asyncio.
    # Reading it before acquire is a best-effort check — a brief over-admission is acceptable.
    if sem._value == 0:  # noqa: SLF001
        kgw_ingest_semaphore_rejected_total.inc()
        return JSONResponse(
            status_code=503,
            headers={"Retry-After": "5"},
            content={
                "resultCode": "-1",
                "resultMsg": "service busy, retry later",
                "resultObject": {},
            },
        )
    async with sem:
        result = await process_event(
            state, item, user_code=x_user_id, trace_id=trace_id
        )

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
            results.append(
                {
                    "itemId": item_id,
                    "status": "validation_failed",
                    "errorType": "INVALID_STANDARD_ITEM",
                    "errorMessage": str(exc.errors()[0].get("msg", ""))[:200],
                }
            )
            continue

        async with state.ingest_semaphore:
            result = await process_event(
                state, item, user_code=x_user_id, trace_id=trace_id
            )
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
            "doneAt": row.done_at.isoformat() if row.done_at else None,
        },
    }


@router.get("/events")
async def list_events(  # pylint: disable=too-many-arguments
    request: Request,
    source_id: Annotated[str | None, Query(alias="sourceId")] = None,
    item_id: Annotated[str | None, Query(alias="itemId")] = None,
    kn_code: Annotated[str | None, Query(alias="knCode")] = None,
    status: str | None = None,
    from_time: Annotated[str | None, Query(alias="fromTime")] = None,
    to_time: Annotated[str | None, Query(alias="toTime")] = None,
    page_size: Annotated[int, Query(alias="pageSize")] = 20,
    page: int = 1,
) -> dict[str, Any]:
    if page_size > 100:
        page_size = 100
    pool = request.app.state.pool
    rows, total = await idempotency.list_events(
        pool,
        source_id=source_id,
        item_id=item_id,
        kn_code=kn_code,
        status=status,
        from_time=from_time,
        to_time=to_time,
        page=page,
        page_size=page_size,
    )
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": {
            "data": [
                {
                    "eventId": r.event_id,
                    "sourceId": r.source_id,
                    "itemId": r.item_id,
                    "version": r.version,
                    "op": r.op,
                    "knCode": r.kn_code,
                    "filePath": r.file_path,
                    "status": r.status,
                    "errorType": r.error_type,
                    "errorMessage": r.error_message,
                    "retryCount": r.retry_count,
                    "doneAt": r.done_at.isoformat() if r.done_at else None,
                }
                for r in rows
            ],
            "total": total,
            "page": page,
            "pageSize": page_size,
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
        return {
            "resultCode": "-1",
            "resultMsg": f"event not found: {event_id}",
            "resultObject": {},
        }
    if row.status != "failed":
        return {
            "resultCode": "-1",
            "resultMsg": f"event {event_id} is not in failed status, current status: {row.status}",
            "resultObject": {},
        }
    if row.op == "upsert":
        return {
            "resultCode": "-1",
            "resultMsg": "upsert events must be re-submitted by the connector",
            "resultObject": {},
        }

    await idempotency.reset_for_replay(pool, event_id)
    item = StandardItem.model_validate(
        {
            "sourceId": row.source_id,
            "itemId": row.item_id,
            "version": row.version,
            "op": row.op,
            "knCode": row.kn_code,
            "filePath": row.file_path,
        }
    )
    trace_id = request.headers.get("X-Trace-Id")
    async with state.ingest_semaphore:
        result = await process_event(
            state, item, user_code=x_user_id, trace_id=trace_id
        )
    return _result_to_envelope(result)
