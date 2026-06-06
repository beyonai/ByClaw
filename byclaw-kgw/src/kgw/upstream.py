"""Shared upstream HTTP helpers used by both dispatcher and sync.

Extracted from ``dispatcher.py`` so ``sync.py`` can reuse the same
direct-mode / service-discovery logic without cyclic imports.
"""

from __future__ import annotations

from typing import Any

import httpx
from kgw.envelope import UpstreamConnectError


class BackendAuthError(Exception):
    """Sentinel: KB backend returned HTTP 401 or 403."""


async def call_backend_json(
    *,
    config: Any,  # KbConfig
    op_path: str,
    body: dict[str, Any],
    headers: dict[str, str],
    http: httpx.AsyncClient,
) -> dict[str, Any]:
    """Execute the upstream POST in direct or service-discovery mode.

    Direct mode:  config.domain_url is set → POST to domain_url + op_path.
    Discovery mode: config.domain_name is set and domain_url is empty →
                    use by-framework DiscoveryHttpClient.
    """
    if config.domain_url:
        url = config.domain_url.rstrip("/") + "/" + op_path.lstrip("/")
        response = await http.post(url, json=body, headers=headers)
        if response.status_code in (401, 403):
            raise BackendAuthError(
                f"backend auth failed (HTTP {response.status_code}) for {url}"
            )
        return response.json()

    # Service-discovery mode via by-framework
    if not config.domain_name:
        raise UpstreamConnectError(
            "KB config has neither domainURL nor domainName",
            kn_code=config.kn_code,
        )
    return await call_via_discovery(
        domain_name=config.domain_name,
        op_path=op_path,
        body=body,
        headers=headers,
    )


async def call_via_discovery(
    *,
    domain_name: str,
    op_path: str,
    body: dict[str, Any],
    headers: dict[str, str],
) -> dict[str, Any]:
    """POST to a KB backend via by-framework service discovery.

    Uses DiscoveryClient (Redis-backed) to resolve the service name to a
    physical host:port, then POSTs JSON. The discovery client is created
    and closed per-call (no persistent state needed — gateway is stateless
    for service discovery).
    """
    from by_framework.common.redis_client import init_redis
    from by_framework.core.discovery import DiscoveryClient
    from by_framework.util.discovery_http_client import DiscoveryHttpClient
    from kgw.settings import get_settings

    settings = get_settings()
    redis_client = init_redis(
        host=settings.redis_host,
        port=settings.redis_port,
        db=settings.redis_database,
        password=settings.redis_password or None,
        username=settings.redis_username or None,
        decode_responses=True,
    )
    discovery_client = DiscoveryClient(redis_client=redis_client, cache_interval=5)
    try:
        async with DiscoveryHttpClient(discovery_client) as client:
            resp = await client.post(
                domain_name,
                op_path,
                json=body,
                headers=headers or None,
            )
        if not resp.is_success:
            raise BackendAuthError(
                f"backend returned HTTP {resp.status_code} via discovery for {domain_name}{op_path}"
            )
        # HttpResponse.data is a dict when content-type is application/json,
        # or a string otherwise. Normalise to dict in both cases.
        if isinstance(resp.data, dict):
            return resp.data
        if isinstance(resp.data, str):
            import json as _json

            return _json.loads(resp.data)
        raise ValueError(
            f"discovery response body is not JSON-parseable: {type(resp.data)}"
        )
    finally:
        await discovery_client.close()
