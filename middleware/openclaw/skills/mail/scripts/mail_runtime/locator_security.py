from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
from typing import Any

from .models import ErrorCode, MailRuntimeError


def locator_key(value: Any) -> bytes:
    if not isinstance(value, str) or len(value) != 43:
        raise MailRuntimeError(ErrorCode.AUTH_REQUIRED)
    try:
        key = base64.b64decode(value + "=", altchars=b"-_", validate=True)
    except (binascii.Error, ValueError) as exc:
        raise MailRuntimeError(ErrorCode.AUTH_REQUIRED) from exc
    if len(key) != 32:
        raise MailRuntimeError(ErrorCode.AUTH_REQUIRED)
    return key


def sign_locator(prefix: str, payload: dict[str, Any], key: bytes) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    encoded = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    mac = base64.urlsafe_b64encode(hmac.new(key, prefix.encode() + b"." + raw, hashlib.sha256).digest()).rstrip(b"=").decode()
    return f"{prefix}.{encoded}.{mac}"


def verify_locator(value: Any, prefix: str, expected: dict[str, Any], key: bytes) -> dict[str, Any]:
    if not isinstance(value, str) or len(value) > 8192:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    parts = value.split(".")
    if len(parts) != 3 or parts[0] != prefix:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    try:
        raw = base64.b64decode(parts[1] + "=" * (-len(parts[1]) % 4), altchars=b"-_", validate=True)
        payload = json.loads(raw.decode())
    except (binascii.Error, UnicodeError, json.JSONDecodeError) as exc:
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST) from exc
    if not isinstance(payload, dict) or any(payload.get(name) != item for name, item in expected.items()):
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    if not hmac.compare_digest(sign_locator(prefix, payload, key), value):
        raise MailRuntimeError(ErrorCode.INVALID_REQUEST)
    return payload
