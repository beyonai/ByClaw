"""Authentication provider (Redis read).

The portal writes per-user auth into Redis under
``user:{user_code}:login:auth`` (a hash). The gateway reads from that
hash to substitute ``${KEY}`` placeholders in the headers field
configured in the KB's MinIO config. Behavior matches byclaw-qa
``worker._resolve_header_placeholders``.
"""

from __future__ import annotations

import re
from typing import Any

import redis.asyncio as redis_async
from kgw.envelope import AuthInfoNotFound
from kgw.observability.logger import get_logger

_log = get_logger(__name__)
_PLACEHOLDER_RE = re.compile(r"\$\{([^}]+)\}")


class AuthProvider:
    """Read user auth from Redis and resolve header placeholders."""

    def __init__(
        self,
        client: redis_async.Redis,
        *,
        key_template: str = "user:{user_code}:login:auth",
    ) -> None:
        self._client = client
        self._key_template = key_template

    async def get_user_auth(self, user_code: str) -> dict[str, str] | None:
        """Return the user's auth hash decoded as ``{str: str}`` or None."""
        key = self._key_template.format(user_code=user_code)
        raw = await self._client.hgetall(key)
        if not raw:
            return None
        return {_decode(k): _decode(v) for k, v in raw.items()}

    async def resolve_headers(
        self,
        headers: dict[str, Any],
        *,
        user_code: str,
    ) -> dict[str, str]:
        """Substitute ``${KEY}`` placeholders in header values.

        Static headers (no placeholders) are passed through unchanged
        without touching Redis. If a header contains placeholders and
        the user has no auth hash, ``AuthInfoNotFound`` is raised.
        Individual missing fields leave their placeholder text intact
        and emit a warning, matching the byclaw-qa reference behavior.
        """
        resolved: dict[str, str] = {}
        cached_auth: dict[str, str] | None = None
        cached_auth_loaded = False

        for header_name, raw_value in headers.items():
            value = str(raw_value)
            matches = _PLACEHOLDER_RE.findall(value)
            if not matches:
                resolved[header_name] = value
                continue

            if not cached_auth_loaded:
                cached_auth = await self.get_user_auth(user_code)
                cached_auth_loaded = True

            if cached_auth is None:
                raise AuthInfoNotFound(
                    f"auth missing for user_code={user_code}",
                    user_code=user_code,
                )

            substituted = value
            for field_name in matches:
                if field_name not in cached_auth:
                    _log.warning(
                        "auth.placeholder_missing",
                        user_code=user_code,
                        field=field_name,
                        header=header_name,
                    )
                    continue
                substituted = substituted.replace(
                    f"${{{field_name}}}", cached_auth[field_name]
                )
            resolved[header_name] = substituted

        return resolved


def _decode(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value)
