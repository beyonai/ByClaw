from __future__ import annotations

import json
from dataclasses import dataclass

from by_qa.core import logger
from by_qa.knowledge_base.infrastructure.storage import (
    StorageConfigurationError,
    StorageLocation,
    StoredObject,
)

from byclaw_userfs_storage import (
    ByClawUserFsKnowledgeStorageProvider,
    _ensure_json_success,
    _normalize_location,
    _path_from_location,
    build_byclaw_userfs_headers,
    get_byclaw_resource_id,
)

_RESOURCE_SPACE_TYPE = "RESOURCE"
_RESOURCE_PATH_PREFIX = "/resource/kg_doc"
_BASE_PATH = "/byaiService/fs/operation/v1"


@dataclass
class ByClawKnowledgeStorageProvider(ByClawUserFsKnowledgeStorageProvider):
    """Store canonical knowledge files by resource, with a temporary UserFS fallback."""

    provider_name: str = "byclaw-knowledge-resource"

    async def read_kg_doc_config(self, resource_id: str | int) -> dict:
        normalized_resource_id = str(resource_id).strip()
        if (
            not normalized_resource_id.isdigit()
            or int(normalized_resource_id) <= 0
        ):
            raise StorageConfigurationError(
                "invalid ByClaw resourceId for knowledge resource config"
            )
        content = await self._download_bytes(
            path=f"{_BASE_PATH}/files/get",
            headers=build_byclaw_userfs_headers(),
            params={
                "spaceType": _RESOURCE_SPACE_TYPE,
                "resourceId": normalized_resource_id,
                "path": (
                    f"/resource/doc/KG_DOC_{normalized_resource_id}.json"
                ),
            },
        )
        try:
            config = json.loads(content)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise StorageConfigurationError(
                "invalid KG_DOC resource config JSON"
            ) from exc
        if not isinstance(config, dict):
            raise StorageConfigurationError(
                "KG_DOC resource config must be a JSON object"
            )
        config_resource_id = str(config.get("resourceId") or "").strip()
        if config_resource_id != normalized_resource_id:
            raise StorageConfigurationError(
                "KG_DOC resource config resourceId mismatch"
            )
        return config

    def _resource_target(self, location: StorageLocation) -> tuple[str, str] | None:
        resource_id = get_byclaw_resource_id()
        if resource_id is None:
            logger.warning(
                "knowledge storage request has no resourceId; falling back to legacy UserFS storage"
            )
            return None
        logical_path = _path_from_location(_normalize_location(location))
        return resource_id, f"{_RESOURCE_PATH_PREFIX}/KG_DOC_{resource_id}{logical_path}"

    async def write(
        self,
        location: StorageLocation,
        content: bytes,
        *,
        content_type: str,
    ) -> StoredObject:
        target = self._resource_target(location)
        if target is None:
            return await super().write(location, content, content_type=content_type)
        resource_id, file_path = target
        normalized_location = _normalize_location(location)
        response = await self._request(
            method="POST",
            path=f"{_BASE_PATH}/files/put",
            headers=build_byclaw_userfs_headers(),
            data={
                "spaceType": _RESOURCE_SPACE_TYPE,
                "resourceId": resource_id,
                "path": file_path,
                "contentType": content_type,
            },
            files={"file": ("file", content, content_type)},
        )
        data = _ensure_json_success(response, "write")
        return StoredObject(
            location=normalized_location,
            size=data.get("fileSize", len(content)),
            checksum=data.get("checksum"),
            content_type=data.get("contentType", content_type),
        )

    async def read(self, location: StorageLocation) -> bytes:
        target = self._resource_target(location)
        if target is None:
            return await super().read(location)
        resource_id, file_path = target
        return await self._download_bytes(
            path=f"{_BASE_PATH}/files/get",
            headers=build_byclaw_userfs_headers(),
            params={
                "spaceType": _RESOURCE_SPACE_TYPE,
                "resourceId": resource_id,
                "path": file_path,
            },
        )

    async def delete(self, location: StorageLocation) -> None:
        target = self._resource_target(location)
        if target is None:
            await super().delete(location)
            return
        resource_id, file_path = target
        response = await self._request(
            method="POST",
            path=f"{_BASE_PATH}/files/delete",
            headers=build_byclaw_userfs_headers(),
            json={
                "spaceType": _RESOURCE_SPACE_TYPE,
                "resourceId": resource_id,
                "path": file_path,
            },
        )
        _ensure_json_success(response, "delete")

    async def move(
        self,
        source: StorageLocation,
        target: StorageLocation,
        *,
        overwrite: bool = False,
    ) -> None:
        source_target = self._resource_target(source)
        target_target = self._resource_target(target)
        if source_target is None or target_target is None:
            await super().move(source, target, overwrite=overwrite)
            return
        resource_id, source_path = source_target
        target_resource_id, target_path = target_target
        if resource_id != target_resource_id:
            raise ValueError("knowledge storage move cannot cross resources")
        response = await self._request(
            method="POST",
            path=f"{_BASE_PATH}/files/rename",
            headers=build_byclaw_userfs_headers(),
            json={
                "spaceType": _RESOURCE_SPACE_TYPE,
                "resourceId": resource_id,
                "oldPath": source_path,
                "newPath": target_path,
                "overwrite": overwrite,
            },
        )
        _ensure_json_success(response, "move")


def build_byclaw_knowledge_storage_provider() -> ByClawKnowledgeStorageProvider:
    return ByClawKnowledgeStorageProvider()


async def get_kg_doc_from_resourcefs(resource_id: str | int) -> dict:
    return await ByClawKnowledgeStorageProvider().read_kg_doc_config(resource_id)


__all__ = [
    "ByClawKnowledgeStorageProvider",
    "build_byclaw_knowledge_storage_provider",
    "get_kg_doc_from_resourcefs",
]
