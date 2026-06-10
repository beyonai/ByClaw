"""Knowledge-base configuration provider (Redis).

Configuration for each KB is stored in Redis as
``KG_DOC_{kn_code}``.  Every ``get_kb_config`` call reads Redis
directly — no caching — so the gateway always reflects the portal's
current state.  This matches v5 spec §3.3.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import redis.asyncio as redis_async
from kgw.dispatcher import KbOp
from kgw.observability.logger import get_logger

_log = get_logger(__name__)


@dataclass(frozen=True)
class KbConfig:
    """Parsed KB configuration record.

    ``kn_code``      — portal-assigned unique KB identifier (used for routing,
                       audit, and circuit-breaker keying).
    ``resource_code``— backend KB identifier embedded in KG_DOC (the value the
                       KB service itself recognises as its own knCode).  When
                       dispatching requests the body's knCode/knCodeList must
                       use this value, NOT the portal kn_code.
    ``domain_url``   — full HTTP base URL for direct mode (may be empty).
    ``domain_name``  — by-framework service-discovery name for discovery mode.
                       Exactly one of domain_url / domain_name must be set.
    """

    kn_code: str
    resource_code: str
    domain_url: str
    domain_name: str
    headers: dict[str, str]
    operations: frozenset[str]
    operation_paths: dict[str, str]
    raw: dict[str, Any] = field(repr=False)

    def operation_path(self, operation: str) -> str | None:
        return self.operation_paths.get(operation)


class KbConfigProvider:
    """Async Redis reader for KB configuration JSON.

    Modeled after byclaw-qa ``MinioResourceClient.get_kg_doc_config()``
    so the JSON shape stays compatible with existing portal-managed
    objects.
    """

    def __init__(self, *, redis_client: redis_async.Redis) -> None:
        self._redis = redis_client

    async def get_kb_config(self, kn_code: str) -> KbConfig | None:
        """Return parsed KB config or None when the key is absent."""
        key = f"KG_DOC_{kn_code}"
        raw = await self._redis.get(key)
        if raw is None:
            _log.info("kb_config.not_found", kn_code=kn_code, key=key)
            return None

        try:
            payload = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            _log.error("kb_config.parse_error", kn_code=kn_code, key=key, err=str(exc))
            raise

        return _parse_kb_config(kn_code, payload)


# Map portal KG_DOC operationId → gateway KbOp name (from dispatcher.py)
_OPERATION_ID_MAP: dict[str, str] = {
    "createDir": KbOp.DIRECTORY_CREATE.value,
    "editDir": KbOp.DIRECTORY_UPDATE.value,
    "deleteDir": KbOp.DIRECTORY_DELETE.value,
    "uploadFile": KbOp.FILE_IMPORT.value,
    "deleteFile": KbOp.FILE_DELETE.value,
    "knowledgeBuild": KbOp.BUILD_TRIGGER.value,
    "buildStatusQuery": KbOp.BUILD_STATUS.value,
    "knowledgeSearch": KbOp.KNOWLEDGE_SEARCH.value,
    "metadataSearch": KbOp.METADATA_SEARCH.value,
    "searchFile": KbOp.SEARCH_FILE.value,
    "metadataFieldsList": KbOp.METADATA_FIELDS_LIST.value,
    "listDir": KbOp.LIST_DIR.value,
    "glob": KbOp.GLOB.value,
    "readFile": KbOp.READ_FILE.value,
    "downloadFile": KbOp.DOWNLOAD_FILE.value,
    "metadataPropertiesBatchCreate": KbOp.METADATA_PROPERTIES_BATCH_CREATE.value,
    "metadataPropertiesDelete": KbOp.METADATA_PROPERTIES_DELETE.value,
    "knowledgeItemsMetadataUpdate": KbOp.KNOWLEDGE_ITEMS_METADATA_UPDATE.value,
    "knowledgeItemsMetadataGet": KbOp.KNOWLEDGE_ITEMS_METADATA_GET.value,
}


def _map_operation_id(op_id: str) -> str:
    return _OPERATION_ID_MAP.get(op_id, op_id)


def _parse_kb_config(kn_code: str, payload: dict[str, Any]) -> KbConfig:
    """Translate the portal's KG_DOC JSON shape into a KbConfig record.

    The portal stores two different identifiers in KG_DOC:
    - ``resourceId``  (the Redis key suffix, used as kn_code here)
    - ``resourceCode``(the identifier the KB backend recognises — used in
                       the knCode/knCodeList body field when calling the KB)

    Routing mode depends on which URL field is populated:
    - ``domainURL``  set → direct HTTP mode (use domain_url)
    - ``domainName`` set → by-framework service-discovery mode (use domain_name)
    """
    resource_code = str(payload.get("resourceCode") or kn_code)
    domain_url = str(payload.get("domainURL") or payload.get("endpointUrl") or "")
    domain_name = str(payload.get("domainName") or "")
    raw_headers = payload.get("headers") or {}
    headers: dict[str, str] = {str(k): str(v) for k, v in raw_headers.items()}

    operation_paths: dict[str, str] = {}
    for entry in payload.get("resourceService") or ():
        if not isinstance(entry, dict):
            continue
        # Simplified format: {"name": "directoryCreate", "path": "/api/v1/..."}
        name = entry.get("name") or entry.get("operation")
        path = entry.get("path") or entry.get("url")
        if name and path:
            operation_paths[str(name)] = str(path)
            continue
        # OpenAPI schema format (KG_DOC_10000001.json style):
        # {"openapiSchema": {"paths": {"/api/v1/...": {"post": {"operationId": "createDir"}}}}}
        schema = entry.get("openapiSchema")
        if isinstance(schema, dict):
            for api_path, methods in (schema.get("paths") or {}).items():
                if not isinstance(methods, dict):
                    continue
                for _, spec in methods.items():
                    if not isinstance(spec, dict):
                        continue
                    op_id = spec.get("operationId")
                    if op_id:
                        operation_paths[_map_operation_id(str(op_id))] = str(api_path)
                        break  # first method wins

    # The portal sometimes only lists operation names rather than full paths.
    if not operation_paths:
        for op in payload.get("operations") or ():
            if isinstance(op, str):
                operation_paths[op] = ""

    return KbConfig(
        kn_code=kn_code,
        resource_code=resource_code,
        domain_url=domain_url,
        domain_name=domain_name,
        headers=headers,
        operations=frozenset(operation_paths.keys()),
        operation_paths=operation_paths,
        raw=payload,
    )
