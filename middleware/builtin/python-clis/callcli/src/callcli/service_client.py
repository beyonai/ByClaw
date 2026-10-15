from __future__ import annotations

import asyncio
import os
import threading
from typing import Any, Coroutine, TypeVar

from callcli.errors import CallCliError, EXIT_AUTH, EXIT_POLICY, EXIT_RUNTIME, invalid_argument
from callcli.credentials import platform_beyond_token


T = TypeVar("T")


def run_async(coro: Coroutine[Any, Any, T]) -> T:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    results: list[T] = []
    errors: list[BaseException] = []

    def runner() -> None:
        try:
            results.append(asyncio.run(coro))
        except BaseException as exc:
            errors.append(exc)

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    thread.join()
    if errors:
        raise errors[0]
    return results[0]


def _redis_config():
    from by_framework.common.config import RedisConfig  # type: ignore[import-untyped]

    cluster_raw = (os.environ.get("DATACLOUD_GATEWAY_REDIS_CLUSTER_HOST", "").strip()
                   or os.environ.get("REDIS_CLUSTER_HOST", "").strip())
    nodes = None
    if cluster_raw:
        nodes = []
        for item in cluster_raw.split(","):
            host, sep, port = item.strip().rpartition(":")
            nodes.append((host if sep else item.strip(), int(port) if sep else 6379))
    return RedisConfig(
        cluster_nodes=nodes, mode="cluster" if nodes else "standalone",
        host=os.environ.get("DATACLOUD_GATEWAY_REDIS_HOST", os.environ.get("REDIS_HOST", "localhost")),
        port=int(os.environ.get("DATACLOUD_GATEWAY_REDIS_PORT") or os.environ.get("REDIS_PORT") or "6379"),
        db=int(os.environ.get("DATACLOUD_GATEWAY_REDIS_DB") or os.environ.get("REDIS_DATABASE") or "0"),
        password=os.environ.get("DATACLOUD_GATEWAY_REDIS_PASSWORD", os.environ.get("REDIS_PASSWORD", "")),
        username=os.environ.get("DATACLOUD_GATEWAY_REDIS_USERNAME", os.environ.get("REDIS_USERNAME")) or None,
    )


class DiscoveryServiceClient:
    """ByAI HTTP client whose endpoint can only come from service discovery."""

    def __init__(self, timeout_seconds: float = 30.0) -> None:
        self.timeout_seconds = timeout_seconds

    @staticmethod
    def service_name() -> str:
        name = (os.environ.get("CALLCLI_RESOURCE_SERVICE", "").strip()
                or os.environ.get("BE_DOMAINNAME", "").strip())
        if not name:
            raise CallCliError("DISCOVERY_UNAVAILABLE",
                               "CALLCLI_RESOURCE_SERVICE or BE_DOMAINNAME is not configured",
                               retryable=True)
        return name

    @staticmethod
    def headers(session_id: str) -> dict[str, str]:
        if not session_id:
            raise invalid_argument("session_id is required")
        headers = {"Accept": "application/json", "Content-Type": "application/json",
                   "x-session-id": session_id, "language": "zh-CN"}
        for env, name in ((None, "Beyond-Token"), ("SSO_TOKEN", "SSO-TOKEN"),
                          ("SYSTEM_CODE", "system-code")):
            value = platform_beyond_token() if env is None else os.environ.get(env, "").strip()
            if value:
                headers[name] = value
        return headers

    async def json(self, method: str, path: str, *, session_id: str, payload: dict) -> dict:
        try:
            from by_framework.common.redis_client import init_redis  # type: ignore[import-untyped]
            from by_framework.core.discovery import DiscoveryClient  # type: ignore[import-untyped]
            from by_framework.util.discovery_http_client import DiscoveryHttpClient  # type: ignore[import-untyped]
            from by_framework.util.http_client import ByHttpClient, RetryConfig  # type: ignore[import-untyped]
            init_redis(config=_redis_config())
            discovery = DiscoveryClient(cache_interval=5)
            try:
                async with ByHttpClient("", timeout=self.timeout_seconds,
                                        retry_config=RetryConfig.no_retry()) as http:
                    retry = RetryConfig(max_attempts=3, retry_on_status_codes={502, 503, 504})
                    async with DiscoveryHttpClient(discovery, http_client=http, retry_config=retry,
                                                   health_threshold_ms=-1) as client:
                        if method != "POST":
                            raise invalid_argument("resource service only supports POST")
                        response = await client.post(self.service_name(), path,
                                                     headers=self.headers(session_id), json=payload)
            finally:
                await discovery.close()
        except CallCliError:
            raise
        except (ImportError, ModuleNotFoundError) as exc:
            raise CallCliError("DISCOVERY_DEPENDENCY_MISSING",
                               "by_framework discovery runtime is unavailable") from exc
        except TimeoutError as exc:
            raise CallCliError("SERVICE_TIMEOUT", "resource service timed out",
                               exit_code=13, retryable=True) from exc
        except (OSError, ConnectionError) as exc:
            raise CallCliError("SERVICE_UNAVAILABLE", "resource service is unavailable",
                               retryable=True) from exc

        body = response.data if isinstance(response.data, dict) else None
        if response.status_code in (401, 403):
            raise CallCliError("SESSION_INVALID", "session is unauthorized", exit_code=EXIT_AUTH)
        if not response.is_success:
            raise CallCliError("SERVICE_UNAVAILABLE", f"resource service HTTP {response.status_code}",
                               retryable=response.status_code >= 500)
        if body is None:
            raise CallCliError("PROTOCOL_ERROR", "resource service returned non-JSON data")
        try:
            code = int(body.get("code", 0))
        except (TypeError, ValueError):
            code = -1
        if code != 0 or body.get("success") is False:
            raise CallCliError("BACKEND_ERROR", str(body.get("msg") or "resource query failed"),
                               exit_code=EXIT_POLICY, details={"backendCode": body.get("code")})
        return body
