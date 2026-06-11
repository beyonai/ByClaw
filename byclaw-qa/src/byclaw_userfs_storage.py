from __future__ import annotations

import os
from collections.abc import Awaitable, Callable, Mapping
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Any

from by_qa.knowledge_base.infrastructure.storage import (
    StorageConfigurationError,
    StorageError,
    StorageLocation,
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
_BASE_PATH = "/aiFactoryServer/fs/operation/v1"

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


def _path_from_location(location: StorageLocation) -> str:
    if location.namespace != _NAMESPACE:
        raise StorageConfigurationError(f"unsupported storage namespace: {location.namespace}")
    if not location.key.startswith("/.bykc/"):
        raise StorageConfigurationError("unsupported ByClaw UserFS storage path")
    return location.key


@dataclass
class ByClawUserFsKnowledgeStorageProvider:
    provider_name: str = "byclaw-userfs"
    storage_path_bound_to_logical_path: bool = True
    transport: Transport | None = None

    async def ensure_ready(self) -> None:
        return None

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
            return await self.transport(method=method, path=path, headers=headers, **kwargs)
        # Real transport will be implemented in Task 4
        raise StorageConfigurationError("real transport not yet implemented")

    async def write(
        self,
        location: StorageLocation,
        content: bytes,
        *,
        content_type: str,
    ) -> StoredObject:
        from by_qa.knowledge_base.infrastructure.storage import StoredObject

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
        data = response.get("data", {}) if isinstance(response.get("data"), dict) else {}
        return StoredObject(
            location=location,
            size=data.get("fileSize", len(content)),
            checksum=data.get("checksum"),
            content_type=data.get("contentType", content_type),
        )

    async def read(self, location: StorageLocation) -> bytes:
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
        file_path = _path_from_location(location)
        headers = build_byclaw_userfs_headers()
        await self._request(
            method="POST",
            path=f"{_BASE_PATH}/files/delete",
            headers=headers,
            json={"spaceType": _SPACE_TYPE, "path": file_path},
        )

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
        source_path = _path_from_location(source)
        target_path = _path_from_location(target)
        headers = build_byclaw_userfs_headers()
        await self._request(
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
