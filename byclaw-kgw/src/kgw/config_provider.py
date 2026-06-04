"""Knowledge-base configuration provider (MinIO).

Configuration for each KB is stored in MinIO as
``{prefix}{kn_code}.json`` (default prefix: ``resource/doc/KG_DOC_``).
Every ``get_kb_config`` call reads MinIO directly — no caching — so the
gateway always reflects the portal's current state. This matches v5
spec §3.3.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import aioboto3
from botocore.exceptions import ClientError
from kgw.observability.logger import get_logger

_log = get_logger(__name__)


@dataclass(frozen=True)
class KbConfig:
    """Parsed KB configuration record."""

    kn_code: str
    domain_url: str
    headers: dict[str, str]
    operations: frozenset[str]
    operation_paths: dict[str, str]
    raw: dict[str, Any] = field(repr=False)

    def operation_path(self, operation: str) -> str | None:
        return self.operation_paths.get(operation)


class KbConfigProvider:
    """Async MinIO reader for KB configuration JSON.

    Modeled after byclaw-qa ``MinioResourceClient.get_kg_doc_config()``
    so the JSON shape stays compatible with existing portal-managed
    objects.
    """

    def __init__(
        self,
        *,
        endpoint_url: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        prefix: str = "resource/doc/KG_DOC_",
        session: aioboto3.Session | None = None,
    ) -> None:
        self._endpoint_url = endpoint_url
        self._access_key = access_key
        self._secret_key = secret_key
        self._bucket = bucket
        self._prefix = prefix
        self._session = session or aioboto3.Session()

    def _client(self):
        return self._session.client(
            "s3",
            endpoint_url=self._endpoint_url,
            aws_access_key_id=self._access_key,
            aws_secret_access_key=self._secret_key,
        )

    async def get_kb_config(self, kn_code: str) -> KbConfig | None:
        """Return parsed KB config or None when the object is absent."""
        key = f"{self._prefix}{kn_code}.json"
        async with self._client() as s3:
            try:
                resp = await s3.get_object(Bucket=self._bucket, Key=key)
            except ClientError as exc:
                code = exc.response.get("Error", {}).get("Code")
                if code in {"NoSuchKey", "404", "NoSuchBucket"}:
                    _log.info("kb_config.not_found", kn_code=kn_code, key=key)
                    return None
                _log.error(
                    "kb_config.fetch_error",
                    kn_code=kn_code,
                    key=key,
                    error_code=code,
                )
                raise
            body = await resp["Body"].read()

        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            _log.error("kb_config.parse_error", kn_code=kn_code, key=key, err=str(exc))
            raise

        return _parse_kb_config(kn_code, payload)


def _parse_kb_config(kn_code: str, payload: dict[str, Any]) -> KbConfig:
    """Translate the portal's KG_DOC JSON shape into a KbConfig record."""
    domain_url = str(payload.get("domainURL") or payload.get("endpointUrl") or "")
    raw_headers = payload.get("headers") or {}
    headers: dict[str, str] = {str(k): str(v) for k, v in raw_headers.items()}

    operation_paths: dict[str, str] = {}
    for entry in payload.get("resourceService") or ():
        if not isinstance(entry, dict):
            continue
        name = entry.get("name") or entry.get("operation")
        path = entry.get("path") or entry.get("url")
        if name and path:
            operation_paths[str(name)] = str(path)

    # The portal sometimes only lists operation names rather than full paths.
    if not operation_paths:
        for op in payload.get("operations") or ():
            if isinstance(op, str):
                operation_paths[op] = ""

    return KbConfig(
        kn_code=kn_code,
        domain_url=domain_url,
        headers=headers,
        operations=frozenset(operation_paths.keys()),
        operation_paths=operation_paths,
        raw=payload,
    )
