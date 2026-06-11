from __future__ import annotations

from dataclasses import dataclass

from by_qa.knowledge_base.infrastructure.storage import (
    StorageConfigurationError,
    StorageLocation,
)

_NAMESPACE = "BYCLAW-USER"
_ROOT = "/.bykc"


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


@dataclass
class ByClawUserFsKnowledgeStorageProvider:
    provider_name: str = "byclaw-userfs"
    storage_path_bound_to_logical_path: bool = True

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
