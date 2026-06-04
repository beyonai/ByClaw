"""Internal smoke-test endpoint used by S1 to validate the foundation chain.

This endpoint is NOT part of the public KGW API. It will be removed in a
later slice once real business endpoints take over the same plumbing.
"""

from __future__ import annotations

import time
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Header, Request
from kgw.audit import AuditEntry
from kgw.envelope import KBNotFound, UpstreamConnectError, UpstreamTimeout, success
from kgw.observability.logger import get_logger

_log = get_logger(__name__)
router = APIRouter(prefix="/kgw/internal/v1")


@router.post("/echo")
async def echo(
    request: Request,
    x_user_id: Annotated[str, Header(alias="X-User-Id")],
    body: dict[str, Any],
):
    """Walk all S1 foundations end-to-end.

    Body shape: ``{"knCode": "<code>", "payload": {...}}``.

    Steps:
      1. Resolve KB config from MinIO (raises KBNotFound when missing).
      2. Resolve user auth from Redis and substitute header placeholders.
      3. Call the KB's ``/healthz`` via the shared httpx client.
      4. Audit the call.
    """
    started = time.perf_counter()
    kn_code = str(body.get("knCode") or "")
    if not kn_code:
        raise KBNotFound("knCode is required", kn_code="")

    config_provider = request.app.state.config_provider
    auth_provider = request.app.state.auth_provider
    http_client: httpx.AsyncClient = request.app.state.http
    audit = request.app.state.audit

    config = await config_provider.get_kb_config(kn_code)
    if config is None:
        raise KBNotFound(f"unknown knCode: {kn_code}", kn_code=kn_code)

    headers = await auth_provider.resolve_headers(config.headers, user_code=x_user_id)

    target_url = f"{config.domain_url.rstrip('/')}/healthz"
    try:
        upstream = await http_client.get(target_url, headers=headers)
    except httpx.TimeoutException as exc:
        raise UpstreamTimeout(
            f"upstream timeout calling {target_url}", kn_code=kn_code
        ) from exc
    except httpx.ConnectError as exc:
        raise UpstreamConnectError(
            f"upstream connect error calling {target_url}", kn_code=kn_code
        ) from exc

    latency_ms = int((time.perf_counter() - started) * 1000)
    payload_bytes = upstream.content or b""

    await audit.record(
        AuditEntry(
            source="serve",
            trace_id=request.headers.get("X-Trace-Id"),
            actor_user_id=x_user_id,
            actor_kind="user",
            operation_type="echo",
            kn_code=kn_code,
            file_path=None,
            payload_size_bytes=len(payload_bytes),
            row_count=None,
            payload_redacted={"knCode": kn_code, "echo": True},
            result_code="0",
            result_msg="success",
            latency_ms=latency_ms,
        )
    )

    return success(
        {
            "knCode": kn_code,
            "upstreamStatus": upstream.status_code,
            "upstreamBytes": len(payload_bytes),
        }
    )
