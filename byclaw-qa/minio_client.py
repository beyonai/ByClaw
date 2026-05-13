"""Async S3-compatible client for reading resource config from MinIO.

Modeled after by_qa.knowledge_base.infrastructure.object_storage to keep
a consistent implementation style across the project.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import aioboto3
from botocore.exceptions import ClientError

from by_qa.core import logger

_TRANSIENT_STATUS_CODES = {500, 502, 503, 504}


def _build_endpoint_url() -> str:
    raw = os.getenv("MINIO_ENDPOINT")
    if not raw:
        raise RuntimeError("MINIO_ENDPOINT environment variable is required")
    secure = os.getenv("MINIO_SECURE", "false").lower() in ("true", "1", "yes")
    host = raw.removeprefix("http://").removeprefix("https://")
    scheme = "https" if secure else "http"
    return f"{scheme}://{host}"


class MinioResourceClient:
    """Async S3-compatible client for reading resource config from MinIO."""

    def __init__(
        self,
        *,
        session: Any | None = None,
        endpoint_url: str | None = None,
        access_key: str | None = None,
        secret_key: str | None = None,
        bucket: str | None = None,
        retries: int = 3,
        retry_delay_seconds: float = 0.5,
    ):
        self.session = session or aioboto3.Session()
        self.endpoint_url = endpoint_url or _build_endpoint_url()
        self.access_key = access_key or os.getenv("MINIO_ACCESS_KEY", "")
        self.secret_key = secret_key or os.getenv("MINIO_SECRET_KEY", "")
        self.bucket = bucket or os.getenv("FILE_STORAGE_MINIO_BUCKET_NAME", "")
        self.retries = retries
        self.retry_delay_seconds = retry_delay_seconds
        logger.info(
            "MinioResourceClient initialized: endpoint=%s, bucket=%s",
            self.endpoint_url, self.bucket,
        )

    def _client(self):
        return self.session.client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
        )

    @staticmethod
    def _is_transient_error(exc: ClientError) -> bool:
        status_code = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        return status_code in _TRANSIENT_STATUS_CODES

    async def _get_object_with_retry(self, object_key: str) -> bytes:
        attempts = max(1, self.retries)
        for attempt in range(attempts):
            try:
                async with self._client() as s3:
                    response = await s3.get_object(Bucket=self.bucket, Key=object_key)
                    return await response["Body"].read()
            except ClientError as exc:
                if attempt >= attempts - 1 or not self._is_transient_error(exc):
                    raise
                await asyncio.sleep(self.retry_delay_seconds)
        return b""

    async def download_object(self, object_key: str) -> bytes:
        """Download raw bytes from MinIO."""
        return await self._get_object_with_retry(object_key)

    async def download_object_json(self, object_key: str) -> dict[str, Any]:
        """Download and parse a JSON object from MinIO."""
        raw = await self._get_object_with_retry(object_key)
        return json.loads(raw)

    async def get_kg_doc_config(self, resource_id: str) -> dict[str, Any] | None:
        """Read resource/doc/KG_DOC_{resource_id}.json, return None on failure."""
        object_key = f"resource/doc/KG_DOC_{resource_id}.json"
        try:
            return await self.download_object_json(object_key)
        except Exception as exc:
            logger.warning("Failed to read %s from MinIO: %s", object_key, exc)
            return None

    async def get_dig_employee_config(self, resource_id: str) -> dict[str, Any] | None:
        """Read resource/dig_employee/DIG_EMPLOYEE_{resource_id}.json, return None on failure."""
        object_key = f"resource/dig_employee/DIG_EMPLOYEE_{resource_id}.json"
        try:
            return await self.download_object_json(object_key)
        except Exception as exc:
            logger.warning("Failed to read %s from MinIO: %s", object_key, exc)
            return None
