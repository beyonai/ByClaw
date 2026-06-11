from __future__ import annotations

import os
from collections.abc import Awaitable, Callable, Mapping
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Any

from by_qa.knowledge_base.infrastructure.storage import (
    StorageAuthenticationError,
    StorageConfigurationError,
    StorageConflictError,
    StorageError,
    StorageLocation,
    StorageNotFoundError,
    StorageOperationError,
    StoredObject,
)

_HEADER_CONTEXT: ContextVar[dict[str, str]] = ContextVar(
    "byclaw_userfs_headers",
    default={},
)
_SYSTEM_CODE = "BYCLAW-QA"


def set_byclaw_userfs_headers(headers: Mapping[str, str]) -> Token[dict[str, str]]:
    normalized = {str(key).lower(): str(value) for key, value in headers.items()}
    return _HEADER_CONTEXT.set(normalized)


def reset_byclaw_userfs_headers(token: Token[dict[str, str]]) -> None:
    _HEADER_CONTEXT.reset(token)


def build_byclaw_userfs_headers() -> dict[str, str]:
    from by_qa.knowledge_base.infrastructure.storage import StorageAuthenticationError

    token = (_HEADER_CONTEXT.get().get("beyond-token") or "").strip()
    if not token:
        raise StorageAuthenticationError("missing beyond-token for ByClaw UserFS storage")
    return {
        "system-code": _SYSTEM_CODE,
        "beyond-token": token,
    }

_NAMESPACE = "BYCLAW-USER"
_ROOT = "/.bykc"
_SPACE_TYPE = "USER"
_BASE_PATH = "/byaiService/fs/operation/v1"

Transport = Callable[..., Awaitable[dict[str, Any]]]


def _normalize_kb_code(kb_code: str) -> str:
    value = str(kb_code or "").strip().strip("/")
    if not value or any(part in {"", ".", ".."} for part in value.split("/")):
        raise StorageConfigurationError("invalid kb_code for ByClaw UserFS storage")
    return value


def _normalize_db_path(file_path: str) -> str:
    value = str(file_path or "").strip()
    parts = [part for part in value.strip("/").split("/") if part]
    if not parts or any(part in {".", ".."} for part in parts):
        raise StorageConfigurationError("invalid file_path for ByClaw UserFS storage")
    return "/".join(parts)


def _require_service_name() -> str:
    service_name = os.getenv("BE_DOMAINNAME", "").strip()
    if not service_name:
        raise StorageConfigurationError("BE_DOMAINNAME is required for ByClaw UserFS storage")
    return service_name


def _normalize_location(location: StorageLocation) -> StorageLocation:
    if location.namespace != _NAMESPACE:
        return StorageLocation(namespace=_NAMESPACE, key=location.key)
    return location


def _path_from_location(location: StorageLocation) -> str:
    if location.namespace != _NAMESPACE:
        raise StorageConfigurationError(f"unsupported storage namespace: {location.namespace}")
    if not location.key.startswith("/.bykc/"):
        raise StorageConfigurationError("unsupported ByClaw UserFS storage path")
    return location.key


def _translate_response_error(status_code: int | None, message: str) -> StorageError:
    if status_code in {401, 403}:
        return StorageAuthenticationError(message)
    if status_code == 404:
        return StorageNotFoundError(message)
    if status_code == 409:
        return StorageConflictError(message)
    return StorageOperationError(message)


def _extract_response_message(data: Any) -> str:
    if isinstance(data, dict):
        return str(data.get("msg") or "")
    return ""


def _ensure_json_success(response: dict[str, Any], op: str) -> dict[str, Any]:
    status_code = int(response.get("status_code") or 0)
    data = response.get("data")
    if status_code and not (200 <= status_code < 300):
        msg = _extract_response_message(data) or f"byclaw-userfs.{op}: HTTP {status_code}"
        raise _translate_response_error(status_code, msg)
    if isinstance(data, dict) and data.get("code") not in {None, "00000"}:
        msg = str(data.get("msg") or f"byclaw-userfs.{op}: {data.get('code')}")
        raise _translate_response_error(status_code or None, msg)
    return data if isinstance(data, dict) else {}


@dataclass
class ByClawUserFsKnowledgeStorageProvider:
    provider_name: str = "byclaw-userfs"
    storage_path_bound_to_logical_path: bool = True
    transport: Transport | None = None

    async def ensure_ready(self) -> None:
        _require_service_name()

    def build_original_location(self, *, kb_code: str, knowledge_base_id: int, fs_entry_id: int, file_path: str, mime_type: str) -> StorageLocation:
        _ = knowledge_base_id, fs_entry_id, mime_type
        return StorageLocation(
            namespace=_NAMESPACE,
            key=f"{_ROOT}/{_normalize_kb_code(kb_code)}/raw/origin/{_normalize_db_path(file_path)}",
        )

    def build_markdown_location(self, *, kb_code: str, knowledge_base_id: int, fs_entry_id: int, file_path: str) -> StorageLocation:
        _ = knowledge_base_id, fs_entry_id
        return StorageLocation(
            namespace=_NAMESPACE,
            key=f"{_ROOT}/{_normalize_kb_code(kb_code)}/raw/markdown/{_normalize_db_path(file_path)}.md",
        )

    async def _request(self, *, method: str, path: str, headers: dict[str, str], **kwargs: Any) -> dict[str, Any]:
        if self.transport is not None:
            response = await self.transport(method=method, path=path, headers=headers, **kwargs)
            status_code = int(response.get("status_code") or 0)
            if status_code and not (200 <= status_code < 300):
                data = response.get("data")
                msg = _extract_response_message(data) or f"byclaw-userfs: HTTP {status_code} for {method} {path}"
                raise _translate_response_error(status_code, msg)
            return response

        from by_framework.common.redis_client import init_redis
        from by_framework.core.discovery import DiscoveryClient
        from by_framework.util.discovery_http_client import DiscoveryHttpClient
        from by_framework.util.http_client import RetryConfig
        from by_qa.config import get_settings

        service_name = _require_service_name()
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
        retry_config = RetryConfig(max_attempts=3, retry_on_status_codes=frozenset({502, 503, 504}))
        try:
            async with DiscoveryHttpClient(discovery_client, retry_config=retry_config) as client:
                files = kwargs.pop("files", None)
                if files is not None:
                    # Multipart upload path
                    parts: list[tuple[str, Any]] = []
                    data = kwargs.pop("data", None)
                    if data:
                        for key, value in data.items():
                            parts.append((key, (None, str(value))))
                    for field_name, (filename, content_bytes, content_type) in files.items():
                        parts.append((field_name, (filename, content_bytes, content_type)))
                    response = await client._upload_with_discovery(
                        service_name=service_name,
                        path=path,
                        parts=parts,
                        headers=headers,
                    )
                else:
                    response = await client._request_with_discovery(
                        method=method,
                        service_name=service_name,
                        path=path,
                        headers=headers,
                        **kwargs,
                    )
            if not response.is_success:
                msg = f"byclaw-userfs: HTTP {response.status_code} for {method} {path}"
                raise _translate_response_error(response.status_code, msg)
            result: dict[str, Any] = {
                "status_code": response.status_code,
                "data": response.data if isinstance(response.data, dict) else {},
            }
            if response.content is not None:
                result["content"] = response.content
            return result
        finally:
            await discovery_client.close()

    async def write(
        self,
        location: StorageLocation,
        content: bytes,
        *,
        content_type: str,
    ) -> StoredObject:
        location = _normalize_location(location)
        file_path = _path_from_location(location)
        headers = build_byclaw_userfs_headers()
        response = await self._request(
            method="POST",
            path=f"{_BASE_PATH}/files/put",
            headers=headers,
            data={
                "spaceType": _SPACE_TYPE,
                "path": file_path,
                "contentType": content_type,
            },
            files={"file": ("file", content, content_type)},
        )
        data = _ensure_json_success(response, "write")
        return StoredObject(
            location=location,
            size=data.get("fileSize", len(content)),
            checksum=data.get("checksum"),
            content_type=data.get("contentType", content_type),
        )

    async def read(self, location: StorageLocation) -> bytes:
        location = _normalize_location(location)
        file_path = _path_from_location(location)
        headers = build_byclaw_userfs_headers()
        response = await self._request(
            method="GET",
            path=f"{_BASE_PATH}/files/get",
            headers=headers,
            params={"spaceType": _SPACE_TYPE, "path": file_path},
        )
        content = response.get("content")
        if isinstance(content, bytes):
            return content
        if isinstance(content, str):
            return content.encode("utf-8")
        return b""

    async def delete(self, location: StorageLocation) -> None:
        location = _normalize_location(location)
        file_path = _path_from_location(location)
        headers = build_byclaw_userfs_headers()
        response = await self._request(
            method="POST",
            path=f"{_BASE_PATH}/files/delete",
            headers=headers,
            json={"spaceType": _SPACE_TYPE, "path": file_path},
        )
        _ensure_json_success(response, "delete")

    async def delete_quietly(self, location: StorageLocation) -> None:
        try:
            await self.delete(location)
        except StorageError:
            return

    async def move(
        self,
        source: StorageLocation,
        target: StorageLocation,
        *,
        overwrite: bool = False,
    ) -> None:
        source = _normalize_location(source)
        target = _normalize_location(target)
        source_path = _path_from_location(source)
        target_path = _path_from_location(target)
        headers = build_byclaw_userfs_headers()
        response = await self._request(
            method="POST",
            path=f"{_BASE_PATH}/files/rename",
            headers=headers,
            json={
                "spaceType": _SPACE_TYPE,
                "oldPath": source_path,
                "newPath": target_path,
                "overwrite": overwrite,
            },
        )
        _ensure_json_success(response, "move")


def build_byclaw_userfs_storage_provider() -> ByClawUserFsKnowledgeStorageProvider:
    return ByClawUserFsKnowledgeStorageProvider()


__all__ = [
    "ByClawUserFsKnowledgeStorageProvider",
    "build_byclaw_userfs_headers",
    "build_byclaw_userfs_storage_provider",
    "reset_byclaw_userfs_headers",
    "set_byclaw_userfs_headers",
]
