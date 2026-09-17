from __future__ import annotations

import json
import os
from pathlib import Path

from callcli.errors import CallCliError, EXIT_RESOURCE


class RedisSnapshotProvider:
    """Read exact resource snapshots; production never falls back across types."""

    def __init__(self, file_dir: Path | None = None) -> None:
        configured = os.environ.get("CALLCLI_RESOURCE_SNAPSHOT_DIR", "").strip()
        self.file_dir = file_dir or (Path(configured) if configured else None)

    async def resolve(self, resource_id: str, resource_type: str) -> dict:
        key = f"{resource_type.upper()}_{resource_id}"
        if self.file_dir is not None:
            path = self.file_dir / f"{key}.json"
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except FileNotFoundError as exc:
                raise CallCliError("RESOURCE_DETAILS_NOT_FOUND", f"resource snapshot not found: {key}",
                                   exit_code=EXIT_RESOURCE) from exc
            except (OSError, ValueError) as exc:
                raise CallCliError("RESOURCE_DETAILS_INVALID", f"invalid resource snapshot: {key}",
                                   exit_code=EXIT_RESOURCE) from exc
            if not isinstance(raw, dict):
                raise CallCliError("RESOURCE_DETAILS_INVALID", f"resource snapshot must be an object: {key}",
                                   exit_code=EXIT_RESOURCE)
            return raw

        try:
            from redis.asyncio import Redis, RedisCluster
        except ImportError as exc:
            raise CallCliError("DISCOVERY_DEPENDENCY_MISSING", "redis Python package is unavailable") from exc

        cluster_raw = (os.environ.get("DATACLOUD_GATEWAY_REDIS_CLUSTER_HOST", "").strip()
                       or os.environ.get("REDIS_CLUSTER_HOST", "").strip())
        password = os.environ.get("DATACLOUD_GATEWAY_REDIS_PASSWORD", os.environ.get("REDIS_PASSWORD", ""))
        username = os.environ.get("DATACLOUD_GATEWAY_REDIS_USERNAME", os.environ.get("REDIS_USERNAME")) or None
        if cluster_raw:
            first = cluster_raw.split(",")[0].strip()
            host, sep, port = first.rpartition(":")
            client = RedisCluster(host=host if sep else first, port=int(port if sep else "6379"),
                                  username=username, password=password, decode_responses=True)
        else:
            client = Redis(
                host=os.environ.get("DATACLOUD_GATEWAY_REDIS_HOST", os.environ.get("REDIS_HOST", "localhost")),
                port=int(os.environ.get("DATACLOUD_GATEWAY_REDIS_PORT") or os.environ.get("REDIS_PORT") or "6379"),
                db=int(os.environ.get("DATACLOUD_GATEWAY_REDIS_DB") or os.environ.get("REDIS_DATABASE") or "0"),
                username=username, password=password or None, decode_responses=True,
            )
        try:
            value = await client.get(key)
            if value is None:
                # Some deployments store JSON in a hash-like RedisJSON document.
                try:
                    value = await client.execute_command("JSON.GET", key)
                except Exception:
                    value = None
        except Exception as exc:
            raise CallCliError("RESOURCE_STORE_UNAVAILABLE", "resource snapshot store is unavailable",
                               retryable=True) from exc
        finally:
            await client.aclose()
        if value is None:
            raise CallCliError("RESOURCE_DETAILS_NOT_FOUND", f"resource snapshot not found: {key}",
                               exit_code=EXIT_RESOURCE)
        try:
            payload = json.loads(value) if isinstance(value, str) else value
            if isinstance(payload, dict) and isinstance(payload.get("raw"), dict):
                payload = payload["raw"]
        except ValueError as exc:
            raise CallCliError("RESOURCE_DETAILS_INVALID", f"invalid resource snapshot: {key}",
                               exit_code=EXIT_RESOURCE) from exc
        if not isinstance(payload, dict):
            raise CallCliError("RESOURCE_DETAILS_INVALID", f"resource snapshot must be an object: {key}",
                               exit_code=EXIT_RESOURCE)
        return payload

