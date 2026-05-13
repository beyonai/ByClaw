"""byclaw-specific ResultFileStorage integration."""

from __future__ import annotations

import asyncio
import os
import threading
from typing import Any
from urllib.parse import urlparse

import httpx
from redis.asyncio import Redis

from by_framework.core.discovery import DiscoveryClient
from by_framework.util.discovery_http_client import DiscoveryHttpClient
from by_framework.util.http_client import RetryConfig

try:
    from datacloud_data_sdk.file_storage.base import ResultFileStorage
except ModuleNotFoundError:
    from byclaw_data.mcp.by_datacloud_sources import activate_by_datacloud_sources

    activate_by_datacloud_sources()
    from datacloud_data_sdk.file_storage.base import ResultFileStorage

import logging
def build_result_file_storage(settings: Any) -> Any:
    """Build the configured result-file storage backend for byclaw-data."""

    # from datacloud_data_sdk.file_storage import LocalResultFileStorage

    # storage_type = str(getattr(settings, "result_file_storage_type", "local") or "local").lower().strip()
    # if storage_type not in {"api", "byclaw_api"}:
    #     return LocalResultFileStorage(settings.result_file_base_dir or settings.csv_base_dir)

    return ByclawResultFileStorage(
        base_url=str(getattr(settings, "result_file_api_base_url", "") or "").strip(),
        service_name=os.environ.get("DATACLOUD_RESULT_FILE_SERVICE_NAME", "").strip()
        or os.environ.get("BE_DOMAINNAME", "").strip(),
    )


class ByclawResultFileStorage(ResultFileStorage):
    """Store exported result files through byclaw backend HTTP/discovery APIs."""

    _WRITE_TXT_PATH = "/writeTxt"
    _APPEND_TXT_PATH = "/appendTxt"
    _READ_PATH = "/read"
    _TIMEOUT = 30.0

    def __init__(
        self,
        *,
        base_url: str = "",
        service_name: str = "",
    ) -> None:
        from datacloud_data_sdk.file_storage.scoped_paths import normalize_logical_file_path

        self._normalize_logical_file_path = normalize_logical_file_path
        self._base_url = base_url.rstrip("/")
        self._service_name = service_name.strip()

    @property
    def storage_type(self) -> str:
        return "byclaw_api"

    def write_text(self, file_path: str, content: str) -> str:
        payload = {
            **self._build_context_payload(),
            "filePath": str(self._normalize_logical_file_path(file_path)),
            "content": content,
        }
        data = self._post_json("/byaiService/open/api/v1/conversation/writeTxt", payload)

        stored_path = self._extract_string(data, "objectKey") or self._extract_string(
            data, "filePath"
        )
        return stored_path or file_path

    def append_text(self, file_path: str, content: str) -> str:
        payload = {
            **self._build_context_payload(),
            "filePath": str(self._normalize_logical_file_path(file_path)),
            "content": content,
        }
        data = self._post_json("/byaiService/open/api/v1/conversation/appendTxt", payload)
        stored_path = self._extract_string(data, "objectKey") or self._extract_string(
            data, "filePath"
        )
        return stored_path or file_path

    def read_text(self, file_path: str, begin_line: int = 0, end_line: int = -1) -> str | None:
        payload = {
            **self._build_context_payload(),
            "filePath": str(self._normalize_logical_file_path(file_path)),
            # "fileType": "txt",
            "begin_line": begin_line,
            "end_line": end_line,
        }
        data = self._post_json("/byaiService/open/api/v1/conversation/read", payload)
        if isinstance(data, str):
            return data
        return self._extract_string(data, "content")

    def _post_json(self, path: str, payload: dict[str, Any]) -> Any:
        headers = self._build_headers()
        if self._is_complete_url(self._base_url):
            with httpx.Client(timeout=self._TIMEOUT) as client:
                response = client.post(f"{self._base_url}{path}", json=payload, headers=headers)
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                if "application/json" in content_type:
                    return response.json()
                return response.text

        service_name = self._service_name or os.environ.get("BE_DOMAINNAME", "").strip()
        if not service_name:
            raise ValueError(
                "ByclawResultFileStorage requires DATACLOUD_RESULT_FILE_API_BASE_URL "
                "or BE_DOMAINNAME / DATACLOUD_RESULT_FILE_SERVICE_NAME"
            )
        return _run_async_in_thread(
            self._post_via_discovery(
                service_name=service_name,
                path=path,
                payload=payload,
                headers=headers,
            )
        )

    async def _post_via_discovery(
        self,
        *,
        service_name: str,
        path: str,
        payload: dict[str, Any],
        headers: dict[str, str],
    ) -> Any:
        redis_client = self._create_discovery_redis()
        discovery_client = DiscoveryClient(redis_client=redis_client, cache_interval=5)
        retry_config = RetryConfig(max_attempts=3, retry_on_status_codes={502, 503, 504})
        try:
            async with DiscoveryHttpClient(discovery_client, retry_config=retry_config) as client:
                response = await client.post(service_name, path, headers=headers, json=payload)
        finally:
            await discovery_client.close()
            await redis_client.aclose()

        if not response.is_success:
            raise ValueError(
                f"HTTP {response.status_code} calling {service_name}{path}: {response.data}"
            )
        logger = logging.getLogger(__name__)
        logger.info(f"byaiService服务调用结果：{response.data}")
        return response.data

    @staticmethod
    def _create_discovery_redis() -> Redis:
        redis_host = os.getenv("DATACLOUD_GATEWAY_REDIS_HOST", "localhost")
        redis_port = int(os.getenv("DATACLOUD_GATEWAY_REDIS_PORT", 6379))
        redis_db = int(os.getenv("DATACLOUD_GATEWAY_REDIS_DB", 0))
        redis_password = os.getenv("DATACLOUD_GATEWAY_REDIS_PASSWORD")
        redis_username = os.getenv("DATACLOUD_GATEWAY_REDIS_USERNAME")

        return Redis(
            host=redis_host,
            port=redis_port,
            db=redis_db,
            password=redis_password or None,
            username=redis_username or None,
            decode_responses=True,
        )

    @staticmethod
    def _is_complete_url(value: str) -> bool:
        parsed = urlparse(value)
        return bool(parsed.scheme and parsed.netloc)

    @staticmethod
    def _extract_string(data: Any, key: str) -> str | None:
        if isinstance(data, dict):
            value = data.get(key)
            if isinstance(value, str):
                return value
            nested = data.get("data")
            if isinstance(nested, dict):
                nested_value = nested.get(key)
                if isinstance(nested_value, str):
                    return nested_value
        return None

    def _build_context_payload(self) -> dict[str, str]:
        from datacloud_data_sdk.context import get_current_context

        try:
            ctx = get_current_context()
        except Exception as exc:
            raise RuntimeError("InvocationContext is required for API result-file storage") from exc

        user_code = str(getattr(ctx, "user_id", "") or "").strip()
        session_id = str(getattr(ctx, "session_id", "") or "").strip()
        if not user_code:
            raise RuntimeError("user_id is required for API result-file storage")
        if not session_id:
            raise RuntimeError("session_id is required for API result-file storage")

        payload = {
            "userCode": user_code,
            "sessionId": session_id,
        }
        tenant_id = str(getattr(ctx, "tenant_id", "") or "").strip()
        if tenant_id:
            payload["tenantId"] = tenant_id
        return payload

    def _build_headers(self) -> dict[str, str]:
        from datacloud_data_sdk.context import get_current_context

        headers: dict[str, str] = {}
        try:
            ctx = get_current_context()
        except Exception:
            return headers

        token = str(getattr(ctx, "token", "") or "").strip()
        system_code = str(getattr(ctx, "system_code", "") or "").strip()
        tenant_id = str(getattr(ctx, "tenant_id", "") or "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if system_code:
            headers["X-System-Code"] = system_code
        if tenant_id:
            headers["X-Tenant-Id"] = tenant_id
        return headers


def install_result_file_storage_binding() -> None:
    """Bind byclaw's ResultFileStorage builder into datacloud_data_service."""

    import datacloud_data_service.file_storage as file_storage_module

    file_storage_module.build_result_file_storage = build_result_file_storage


def _run_async_in_thread(coro: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    result: dict[str, Any] = {}
    error: dict[str, BaseException] = {}

    def runner() -> None:
        try:
            result["value"] = asyncio.run(coro)
        except BaseException as exc:  # pragma: no cover - defensive bridge
            error["exc"] = exc

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    thread.join()
    if "exc" in error:
        raise error["exc"]
    return result.get("value")
