from __future__ import annotations

import asyncio
import json
import os
import re
import threading
import urllib.error
import urllib.request
import uuid
from datetime import UTC, datetime
from typing import Any, Coroutine, TypeVar
from urllib.parse import urlparse

from dbcli.contracts import ResolvedDataSource
from dbcli.errors import DbCliError, EXIT_POLICY, EXIT_RUNTIME, invalid_argument


T = TypeVar("T")
_SENSITIVE_ERROR_KEYS = {
    "accesstoken",
    "authorization",
    "beyond-token",
    "credential",
    "credentials",
    "password",
    "passwordcipher",
    "secret",
    "token",
}
_OPENGAUSS_SSL_MODES = {"disable", "require", "verify-ca", "verify-full"}
_SCHEMA_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")


def _sanitized_error_detail(value: Any) -> str:
    """Return bounded diagnostic context without exposing authentication material."""
    def sanitize(item: Any) -> Any:
        if isinstance(item, dict):
            return {
                str(key): "<redacted>"
                if str(key).lower().replace("_", "") in _SENSITIVE_ERROR_KEYS
                else sanitize(child)
                for key, child in item.items()
            }
        if isinstance(item, list):
            return [sanitize(child) for child in item[:20]]
        return item

    try:
        detail = json.dumps(sanitize(value), ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        detail = str(value)
    return detail[:2000]


def _init_discovery_redis() -> None:
    """Initialize by_framework's Redis client from the platform runtime environment."""
    from by_framework.common.config import RedisConfig  # type: ignore[import-untyped]
    from by_framework.common.redis_client import init_redis  # type: ignore[import-untyped]

    cluster_hosts = (
        os.environ.get("DATACLOUD_GATEWAY_REDIS_CLUSTER_HOST", "").strip()
        or os.environ.get("REDIS_CLUSTER_HOST", "").strip()
    )
    cluster_nodes = None
    if cluster_hosts:
        cluster_nodes = []
        for node in cluster_hosts.split(","):
            node = node.strip()
            if not node:
                continue
            host, separator, port = node.rpartition(":")
            cluster_nodes.append((host if separator else node, int(port) if separator else 6379))
    config = RedisConfig(
        cluster_nodes=cluster_nodes,
        mode="cluster" if cluster_nodes else "standalone",
        host=os.environ.get(
            "DATACLOUD_GATEWAY_REDIS_HOST", os.environ.get("REDIS_HOST", "localhost")
        ),
        port=int(
            os.environ.get("DATACLOUD_GATEWAY_REDIS_PORT")
            or os.environ.get("REDIS_PORT")
            or "6379"
        ),
        db=int(
            os.environ.get("DATACLOUD_GATEWAY_REDIS_DB")
            or os.environ.get("REDIS_DATABASE")
            or "0"
        ),
        password=os.environ.get(
            "DATACLOUD_GATEWAY_REDIS_PASSWORD", os.environ.get("REDIS_PASSWORD", "")
        ),
        username=os.environ.get(
            "DATACLOUD_GATEWAY_REDIS_USERNAME", os.environ.get("REDIS_USERNAME")
        )
        or None,
    )
    init_redis(config=config)


def _run_async_in_thread(coroutine: Coroutine[Any, Any, T]) -> T:
    """Run discovery from synchronous CLI code, including inside an existing event loop."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coroutine)

    result: list[T] = []
    error: list[BaseException] = []

    def runner() -> None:
        try:
            result.append(asyncio.run(coroutine))
        except BaseException as exc:  # propagate the original framework exception
            error.append(exc)

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    thread.join()
    if error:
        raise error[0]
    return result[0]


async def _post_via_discovery(
    service_name: str,
    path: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    timeout_seconds: float,
) -> dict[str, Any]:
    from by_framework.core.discovery import DiscoveryClient as FrameworkDiscoveryClient  # type: ignore[import-untyped]
    from by_framework.util.discovery_http_client import DiscoveryHttpClient  # type: ignore[import-untyped]
    from by_framework.util.http_client import ByHttpClient, RetryConfig  # type: ignore[import-untyped]

    _init_discovery_redis()
    discovery_client = FrameworkDiscoveryClient(cache_interval=5)
    retry_config = RetryConfig(max_attempts=3, retry_on_status_codes={502, 503, 504})
    try:
        async with ByHttpClient(
            "", timeout=timeout_seconds, retry_config=RetryConfig.no_retry()
        ) as http_client:
            async with DiscoveryHttpClient(
                discovery_client,
                http_client=http_client,
                retry_config=retry_config,
                health_threshold_ms=-1,
            ) as client:
                response = await client.post(
                    service_name, path, headers=headers, json=payload
                )
    finally:
        await discovery_client.close()

    body = response.data if isinstance(response.data, dict) else {}
    if not response.is_success or str(body.get("code", "0")) != "0":
        detail = _sanitized_error_detail(
            body if body else {"response": str(response.data)[:2000]}
        )
        raise DbCliError(
            "DATASOURCE_FORBIDDEN" if response.is_success else "DISCOVERY_UNAVAILABLE",
            f"service discovery HTTP {response.status_code}: {detail}",
            exit_code=EXIT_POLICY if response.is_success else EXIT_RUNTIME,
            retryable=not response.is_success,
        )
    data = body.get("data", body)
    if not isinstance(data, dict):
        raise DbCliError(
            "DISCOVERY_PROTOCOL_ERROR",
            "service discovery returned invalid data",
            exit_code=EXIT_RUNTIME,
        )
    return data


class DiscoveryClient:
    def __init__(self, url: str | None = None, timeout_seconds: float = 3.0) -> None:
        self.url = url or os.environ.get("DBCLI_DISCOVERY_URL", "")
        self.timeout_seconds = timeout_seconds

    def resolve(self, session_id: str, datasource_code: str, purpose: str) -> ResolvedDataSource:
        if not session_id:
            raise invalid_argument("session_id is required")
        if not datasource_code:
            raise invalid_argument("datasource_code is required")
        if not self.url:
            resource_payload = {
                "sessionId": session_id,
                "resourceType": "data_source",
                "resourceId": datasource_code,
                "pageNum": 1,
                "pageSize": 1,
                "includeCredentials": True,
            }
            payload = self._resolve_via_framework(resource_payload)
            return self._validate_resolution(
                self._session_resource_to_resolution(payload, datasource_code)
            )

        request_payload = {
            "sessionId": session_id,
            "datasourceCode": datasource_code,
            "purpose": purpose,
            "requestId": f"req_{uuid.uuid4().hex}",
        }

        parsed_url = urlparse(self.url)
        if parsed_url.scheme != "https" and os.environ.get("DBCLI_ALLOW_INSECURE_DISCOVERY") != "1":
            raise DbCliError(
                "DISCOVERY_TLS_REQUIRED",
                "service discovery requires HTTPS",
                exit_code=EXIT_RUNTIME,
            )
        body = json.dumps(request_payload).encode("utf-8")
        request = urllib.request.Request(
            self.url,
            data=body,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                payload = json.loads(exc.read().decode("utf-8"))
                error = payload.get("error") or {}
                code = str(error.get("code") or "DATASOURCE_FORBIDDEN")
                message = str(error.get("message") or "data source access denied")
            except (ValueError, UnicodeDecodeError):
                code, message = "DATASOURCE_FORBIDDEN", "data source access denied"
            raise DbCliError(code, message, exit_code=EXIT_POLICY) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise DbCliError(
                "DISCOVERY_UNAVAILABLE",
                "service discovery is unavailable",
                exit_code=EXIT_RUNTIME,
                retryable=True,
            ) from exc
        except (ValueError, UnicodeDecodeError) as exc:
            raise DbCliError(
                "DISCOVERY_PROTOCOL_ERROR",
                "service discovery returned invalid JSON",
                exit_code=EXIT_RUNTIME,
            ) from exc

        if isinstance(payload, dict) and payload.get("code", 0) == 0 and "data" in payload:
            payload = payload["data"]
        return self._validate_resolution(payload)

    def _resolve_via_framework(self, payload: dict[str, Any]) -> dict[str, Any]:
        service_name = (
            os.environ.get("DBCLI_DATASOURCE_SERVICE", "").strip()
            or os.environ.get("BE_DOMAINNAME", "").strip()
        )
        if not service_name:
            raise DbCliError(
                "DISCOVERY_UNAVAILABLE",
                "DBCLI_DATASOURCE_SERVICE or BE_DOMAINNAME is not configured",
                exit_code=EXIT_RUNTIME,
                retryable=True,
            )
        path = os.environ.get(
            "DBCLI_DATASOURCE_RESOLVE_PATH",
            "/byaiService/open/api/v1/sessionResources/query",
        ).strip()
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        token = os.environ.get("BEYOND_TOKEN", "").strip()
        system_code = os.environ.get("SYSTEM_CODE", "").strip()
        if token:
            headers["Beyond-Token"] = token
        if system_code:
            headers["system-code"] = system_code
        try:
            return _run_async_in_thread(
                _post_via_discovery(
                    service_name, path, payload, headers, self.timeout_seconds
                )
            )
        except DbCliError:
            raise
        except (ImportError, ModuleNotFoundError) as exc:
            raise DbCliError(
                "DISCOVERY_DEPENDENCY_MISSING",
                "by_framework service discovery runtime is unavailable",
                exit_code=EXIT_RUNTIME,
            ) from exc
        except (TimeoutError, OSError, ConnectionError) as exc:
            raise DbCliError(
                "DISCOVERY_UNAVAILABLE",
                "service discovery is unavailable",
                exit_code=EXIT_RUNTIME,
                retryable=True,
            ) from exc
        except Exception as exc:
            raise DbCliError(
                "DISCOVERY_UNAVAILABLE",
                f"service discovery failed: {type(exc).__name__}: {str(exc)[:1000]}",
                exit_code=EXIT_RUNTIME,
                retryable=True,
            ) from exc

    @staticmethod
    def _session_resource_to_resolution(
        payload: dict[str, Any], datasource_code: str
    ) -> dict[str, Any]:
        items = payload.get("items")
        if not isinstance(items, list):
            raise DbCliError(
                "DISCOVERY_PROTOCOL_ERROR",
                "session resource response has no items array",
                exit_code=EXIT_RUNTIME,
            )
        if not items:
            raise DbCliError(
                "DATASOURCE_NOT_FOUND",
                "data source is not available in the session project",
                exit_code=EXIT_POLICY,
            )
        item = items[0]
        if not isinstance(item, dict):
            raise DbCliError(
                "DISCOVERY_PROTOCOL_ERROR",
                "session resource item is invalid",
                exit_code=EXIT_RUNTIME,
            )
        resource_id = str(item.get("resourceId") or item.get("datasourceId") or "")
        if resource_id != datasource_code or item.get("resourceType") != "data_source":
            raise DbCliError(
                "DISCOVERY_PROTOCOL_ERROR",
                "session resource response does not match the requested data source",
                exit_code=EXIT_RUNTIME,
            )
        config = item.get("connectionConfig")
        credentials = item.get("credentials")
        if not isinstance(config, dict) or not isinstance(credentials, dict):
            raise DbCliError(
                "DISCOVERY_PROTOCOL_ERROR",
                "data source connection configuration or credentials are missing",
                exit_code=EXIT_RUNTIME,
            )
        host = str(config.get("host") or "")
        port = str(config.get("port") or "5432")
        schema = str(config.get("schema") or "")
        ssl_mode = str(config.get("sslMode") or "require")
        if ssl_mode not in _OPENGAUSS_SSL_MODES:
            raise DbCliError(
                "DISCOVERY_PROTOCOL_ERROR",
                f"unsupported openGauss SSL mode: {ssl_mode}",
                exit_code=EXIT_RUNTIME,
            )
        if schema and not _SCHEMA_IDENTIFIER.fullmatch(schema):
            raise DbCliError(
                "DISCOVERY_PROTOCOL_ERROR",
                "data source schema is not a safe SQL identifier",
                exit_code=EXIT_RUNTIME,
            )
        driver_options = {"sslmode": ssl_mode}
        if schema:
            driver_options["options"] = f"-c search_path={schema}"
        return {
            "resolutionId": resource_id,
            "driver": str(item.get("datasourceType") or "").lower(),
            "endpoint": f"{host}:{port}",
            "database": str(config.get("database") or ""),
            "credential": {
                "type": "session-resource",
                "username": str(config.get("username") or ""),
                "password": str(credentials.get("password") or ""),
            },
            "policy": {
                "readOnly": False,
                "writesRequireTransaction": True,
                "allowedSchemas": [schema] if schema else [],
                "allowedOperations": ["SELECT", "INSERT", "UPDATE", "DELETE"],
            },
            "schemaVersion": "session-resources/v1",
            "options": driver_options,
        }

    def _validate_resolution(self, payload: dict[str, Any]) -> ResolvedDataSource:
        if not isinstance(payload, dict):
            raise DbCliError(
                "DISCOVERY_PROTOCOL_ERROR",
                "service discovery response is invalid",
                exit_code=EXIT_RUNTIME,
            )
        resolved = ResolvedDataSource.from_dict(payload)
        if not resolved.resolution_id or not resolved.driver or not resolved.database:
            raise DbCliError(
                "DISCOVERY_PROTOCOL_ERROR",
                "service discovery response is incomplete",
                exit_code=EXIT_RUNTIME,
            )
        expires_at = resolved.credential.get("expiresAt")
        if expires_at:
            try:
                expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                if expiry.tzinfo is None:
                    expiry = expiry.replace(tzinfo=UTC)
            except ValueError as exc:
                raise DbCliError(
                    "DISCOVERY_PROTOCOL_ERROR",
                    "credential expiry is invalid",
                    exit_code=EXIT_RUNTIME,
                ) from exc
            if expiry <= datetime.now(UTC):
                raise DbCliError(
                    "CREDENTIAL_EXPIRED",
                    "discovered credential has expired",
                    exit_code=EXIT_POLICY,
                )
        return resolved
