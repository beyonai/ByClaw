from __future__ import annotations

import asyncio
import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any, Coroutine, TypeVar

from kbcli.errors import EXIT_POLICY, EXIT_RUNTIME, KbCliError, invalid_argument


T = TypeVar("T")
_SENSITIVE_KEYS = {"authorization", "beyond-token", "cookie", "password", "secret", "token"}


def _run_async(coroutine: Coroutine[Any, Any, T]) -> T:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coroutine)
    result: list[T] = []
    errors: list[BaseException] = []

    def runner() -> None:
        try:
            result.append(asyncio.run(coroutine))
        except BaseException as exc:
            errors.append(exc)

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    thread.join()
    if errors:
        raise errors[0]
    return result[0]


def _init_redis() -> None:
    from by_framework.common.config import RedisConfig  # type: ignore[import-untyped]
    from by_framework.common.redis_client import init_redis  # type: ignore[import-untyped]

    cluster_hosts = (os.environ.get("DATACLOUD_GATEWAY_REDIS_CLUSTER_HOST", "").strip()
                     or os.environ.get("REDIS_CLUSTER_HOST", "").strip())
    cluster_nodes = None
    if cluster_hosts:
        cluster_nodes = []
        for raw_node in cluster_hosts.split(","):
            node = raw_node.strip()
            if not node:
                continue
            host, separator, port = node.rpartition(":")
            cluster_nodes.append((host if separator else node, int(port) if separator else 6379))
    config = RedisConfig(
        cluster_nodes=cluster_nodes,
        mode="cluster" if cluster_nodes else "standalone",
        host=os.environ.get("DATACLOUD_GATEWAY_REDIS_HOST", os.environ.get("REDIS_HOST", "localhost")),
        port=int(os.environ.get("DATACLOUD_GATEWAY_REDIS_PORT") or os.environ.get("REDIS_PORT") or "6379"),
        db=int(os.environ.get("DATACLOUD_GATEWAY_REDIS_DB") or os.environ.get("REDIS_DATABASE") or "0"),
        password=os.environ.get("DATACLOUD_GATEWAY_REDIS_PASSWORD", os.environ.get("REDIS_PASSWORD", "")),
        username=os.environ.get("DATACLOUD_GATEWAY_REDIS_USERNAME", os.environ.get("REDIS_USERNAME")) or None,
    )
    init_redis(config=config)


def _safe_detail(value: Any) -> str:
    def sanitize(item: Any) -> Any:
        if isinstance(item, dict):
            return {str(key): "<redacted>" if str(key).lower() in _SENSITIVE_KEYS else sanitize(child)
                    for key, child in item.items()}
        if isinstance(item, list):
            return [sanitize(child) for child in item[:20]]
        return item
    try:
        return json.dumps(sanitize(value), ensure_ascii=False, separators=(",", ":"))[:2000]
    except (TypeError, ValueError):
        return str(value)[:2000]


class ServiceClient:
    """Call ByAI through by_framework service discovery; never accepts a raw endpoint."""

    def __init__(self, timeout_seconds: float = 30.0) -> None:
        self.timeout_seconds = timeout_seconds

    def _service_name(self) -> str:
        service = (os.environ.get("KBCLI_KNOWLEDGE_SERVICE", "").strip()
                   or os.environ.get("BE_DOMAINNAME", "").strip())
        if not service:
            raise KbCliError(
                "DISCOVERY_UNAVAILABLE",
                "KBCLI_KNOWLEDGE_SERVICE or BE_DOMAINNAME is not configured",
                exit_code=EXIT_RUNTIME,
                retryable=True,
            )
        return service

    @staticmethod
    def _headers(session_id: str) -> dict[str, str]:
        if not session_id:
            raise invalid_argument("session_id is required")
        headers = {"Accept": "application/json", "x-session-id": session_id}
        token = os.environ.get("BEYOND_TOKEN", "").strip()
        sso_token = os.environ.get("SSO_TOKEN", "").strip()
        system_code = os.environ.get("SYSTEM_CODE", "").strip()
        if token:
            headers["Beyond-Token"] = token
        if sso_token:
            headers["SSO-TOKEN"] = sso_token
        if system_code:
            headers["system-code"] = system_code
        return headers

    def json(self, method: str, path: str, *, session_id: str,
             payload: dict | None = None, query: dict | None = None) -> dict:
        return _run_async(self._request(method, path, session_id=session_id, payload=payload, query=query))

    def multipart(self, path: str, *, session_id: str, fields: dict[str, str],
                  files: list[Path], file_field: str = "files") -> dict:
        for file_path in files:
            try:
                with file_path.open("rb"):
                    pass
            except OSError as exc:
                raise invalid_argument(f"file is unreadable: {file_path}") from exc
        return _run_async(self._request(
            "POST", path, session_id=session_id, form=fields,
            files=[Path(file_path) for file_path in files], file_field=file_field,
        ))

    def multipart_download(self, path: str, *, session_id: str, file: Path,
                           file_field: str, output: Path) -> dict:
        try:
            with file.open("rb"):
                pass
        except OSError as exc:
            raise invalid_argument(f"file is unreadable: {file}") from exc
        content, headers = _run_async(self._multipart_content(
            path, session_id=session_id, file=file, file_field=file_field,
        ))
        self._write_atomic(output, content)
        return {
            "outputPath": str(output.resolve()),
            "size": len(content),
            "contentType": headers.get("content-type") or headers.get("Content-Type"),
        }

    def text(self, method: str, path: str, *, session_id: str,
             query: dict | None = None) -> str:
        return _run_async(self._text_request(method, path, session_id=session_id, query=query))

    def download(self, path: str, *, session_id: str, query: dict, output: Path) -> dict:
        output.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{output.name}.", dir=output.parent)
        os.close(descriptor)
        temporary = Path(temporary_name)
        try:
            headers = _run_async(self._download(
                path, session_id=session_id, query=query, destination=temporary,
            ))
            size = temporary.stat().st_size
            if size == 0:
                raise KbCliError(
                    "EMPTY_DOWNLOAD", "knowledge service returned an empty file",
                    exit_code=EXIT_RUNTIME, retryable=False,
                )
            os.replace(temporary, output)
        except BaseException:
            try:
                temporary.unlink()
            except OSError:
                pass
            raise
        return {
            "outputPath": str(output.resolve()),
            "size": size,
            "contentType": headers.get("content-type") or headers.get("Content-Type"),
        }

    @staticmethod
    def _write_atomic(output: Path, content: bytes) -> None:
        output.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{output.name}.", dir=output.parent)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
            os.replace(temporary_name, output)
        except BaseException:
            try:
                os.unlink(temporary_name)
            except OSError:
                pass
            raise

    async def _context(self):
        raise RuntimeError("context manager factory is implemented inline")

    async def _request(self, method: str, path: str, *, session_id: str,
                       payload: dict | None = None, query: dict | None = None,
                       form: dict | None = None, files: list[Path] | None = None,
                       file_field: str = "files") -> dict:
        try:
            from by_framework.core.discovery import DiscoveryClient  # type: ignore[import-untyped]
            from by_framework.util.discovery_http_client import DiscoveryHttpClient  # type: ignore[import-untyped]
            from by_framework.util.http_client import ByHttpClient, RetryConfig  # type: ignore[import-untyped]
            _init_redis()
            discovery = DiscoveryClient(cache_interval=5)
            retry = RetryConfig(max_attempts=3, retry_on_status_codes={502, 503, 504})
            try:
                async with ByHttpClient("", timeout=self.timeout_seconds,
                                        retry_config=RetryConfig.no_retry()) as http:
                    async with DiscoveryHttpClient(discovery, http_client=http,
                                                   retry_config=retry, health_threshold_ms=-1) as client:
                        headers = self._headers(session_id)
                        if method == "GET":
                            response = await client.get(self._service_name(), path, headers=headers, params=query or {})
                        elif files is not None:
                            response = await client.upload_multiple(
                                self._service_name(), path, files,
                                file_field=file_field, headers=headers, form_fields=form or {},
                            )
                        else:
                            response = await client.post(self._service_name(), path, headers=headers,
                                                         json=payload or {})
            finally:
                await discovery.close()
        except KbCliError:
            raise
        except (ImportError, ModuleNotFoundError) as exc:
            raise KbCliError("DISCOVERY_DEPENDENCY_MISSING",
                             "by_framework service discovery runtime is unavailable",
                             exit_code=EXIT_RUNTIME) from exc
        except (TimeoutError, OSError, ConnectionError) as exc:
            raise KbCliError("SERVICE_UNAVAILABLE", "knowledge service is unavailable",
                             exit_code=EXIT_RUNTIME, retryable=True) from exc
        return self._normalize(response)

    async def _multipart_content(self, path: str, *, session_id: str, file: Path,
                                 file_field: str) -> tuple[bytes, dict]:
        try:
            from by_framework.core.discovery import DiscoveryClient  # type: ignore[import-untyped]
            from by_framework.util.discovery_http_client import DiscoveryHttpClient  # type: ignore[import-untyped]
            from by_framework.util.http_client import ByHttpClient, RetryConfig  # type: ignore[import-untyped]
            _init_redis()
            discovery = DiscoveryClient(cache_interval=5)
            try:
                async with ByHttpClient("", timeout=self.timeout_seconds,
                                        retry_config=RetryConfig.no_retry()) as http:
                    async with DiscoveryHttpClient(
                        discovery, http_client=http,
                        retry_config=RetryConfig(max_attempts=3,
                                                 retry_on_status_codes={502, 503, 504}),
                        health_threshold_ms=-1,
                    ) as client:
                        response = await client.upload_multiple(
                            self._service_name(), path, [file], file_field=file_field,
                            headers=self._headers(session_id), form_fields={},
                        )
            finally:
                await discovery.close()
        except (ImportError, ModuleNotFoundError) as exc:
            raise KbCliError("DISCOVERY_DEPENDENCY_MISSING",
                             "by_framework service discovery runtime is unavailable",
                             exit_code=EXIT_RUNTIME) from exc
        if not response.is_success:
            raise KbCliError("HTTP_ERROR", f"knowledge service HTTP {response.status_code}",
                             exit_code=EXIT_RUNTIME, retryable=response.status_code >= 500)
        raw = getattr(response, "content", None)
        if raw is None:
            raw = response.data.encode("utf-8") if isinstance(response.data, str) else bytes(response.data or b"")
        return bytes(raw), dict(getattr(response, "headers", {}) or {})

    async def _text_request(self, method: str, path: str, *, session_id: str,
                            query: dict | None) -> str:
        try:
            from by_framework.core.discovery import DiscoveryClient  # type: ignore[import-untyped]
            from by_framework.util.discovery_http_client import DiscoveryHttpClient  # type: ignore[import-untyped]
            from by_framework.util.http_client import ByHttpClient, RetryConfig  # type: ignore[import-untyped]
            _init_redis()
            discovery = DiscoveryClient(cache_interval=5)
            try:
                async with ByHttpClient("", timeout=self.timeout_seconds,
                                        retry_config=RetryConfig.no_retry()) as http:
                    async with DiscoveryHttpClient(discovery, http_client=http,
                                                   retry_config=RetryConfig(max_attempts=3),
                                                   health_threshold_ms=-1) as client:
                        if method != "GET":
                            raise invalid_argument("text response currently supports GET only")
                        response = await client.get(self._service_name(), path,
                                                    headers=self._headers(session_id), params=query or {})
            finally:
                await discovery.close()
        except KbCliError:
            raise
        except (ImportError, ModuleNotFoundError) as exc:
            raise KbCliError("DISCOVERY_DEPENDENCY_MISSING",
                             "by_framework service discovery runtime is unavailable",
                             exit_code=EXIT_RUNTIME) from exc
        if not response.is_success:
            raise KbCliError("HTTP_ERROR", f"knowledge service HTTP {response.status_code}: {_safe_detail(response.data)}",
                             exit_code=EXIT_RUNTIME, retryable=response.status_code >= 500)
        if not isinstance(response.data, str):
            raise KbCliError("PROTOCOL_ERROR", "knowledge service returned non-text data")
        return response.data

    async def _download(self, path: str, *, session_id: str, query: dict,
                        destination: Path) -> dict:
        try:
            from by_framework.core.discovery import DiscoveryClient  # type: ignore[import-untyped]
            from by_framework.util.discovery_http_client import DiscoveryHttpClient  # type: ignore[import-untyped]
            from by_framework.util.http_client import ByHttpClient, RetryConfig  # type: ignore[import-untyped]
            _init_redis()
            discovery = DiscoveryClient(cache_interval=5)
            try:
                async with ByHttpClient("", timeout=self.timeout_seconds,
                                        retry_config=RetryConfig.no_retry()) as http:
                    async with DiscoveryHttpClient(discovery, http_client=http,
                                                   retry_config=RetryConfig(max_attempts=3),
                                                   health_threshold_ms=-1) as client:
                        response = await client.download(
                            self._service_name(), path, destination,
                            headers=self._headers(session_id), params=query,
                        )
            finally:
                await discovery.close()
        except (ImportError, ModuleNotFoundError) as exc:
            raise KbCliError("DISCOVERY_DEPENDENCY_MISSING",
                             "by_framework service discovery runtime is unavailable") from exc
        if not response.is_success:
            raise KbCliError("HTTP_ERROR", f"knowledge service HTTP {response.status_code}",
                             retryable=response.status_code >= 500)
        return dict(getattr(response, "headers", {}) or {})

    @staticmethod
    def _normalize(response: Any) -> dict:
        body = response.data if isinstance(response.data, dict) else None
        if not response.is_success:
            backend_message = str(body.get("msg", "")) if body else ""
            validation_markers = ("request validation failed", "不合法", "不能为空")
            if any(marker in backend_message.casefold() for marker in validation_markers):
                raise invalid_argument(backend_message or "knowledge request validation failed")
            raise KbCliError("HTTP_ERROR", f"knowledge service HTTP {response.status_code}: {_safe_detail(body)}",
                             exit_code=EXIT_RUNTIME, retryable=response.status_code >= 500)
        if body is None:
            raise KbCliError("PROTOCOL_ERROR", "knowledge service returned non-JSON data")
        try:
            code = int(body.get("code", 0))
        except (TypeError, ValueError):
            code = -1
        if code != 0:
            raise KbCliError("BACKEND_ERROR", str(body.get("msg") or "knowledge operation failed"),
                             exit_code=EXIT_POLICY, details={"backendCode": body.get("code")})
        return body
