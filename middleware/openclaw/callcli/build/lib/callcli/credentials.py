from __future__ import annotations

import os


SENSITIVE_FRAGMENTS = ("authorization", "cookie", "token", "password", "secret", "signature")


def platform_beyond_token() -> str:
    return (os.environ.get("Beyond-Token", "").strip()
            or os.environ.get("BEYOND_TOKEN", "").strip())


def runtime_headers(session_id: str, capability_headers: dict | None = None) -> dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": "ByClaw-callcli/0.1",
               **{str(key): str(value) for key, value in (capability_headers or {}).items()}}
    protected = ((None, "x-session-id", session_id),
                 (None, "Beyond-Token", platform_beyond_token()), ("SSO_TOKEN", "SSO-TOKEN", ""),
                 ("SYSTEM_CODE", "system-code", ""), ("USER_CODE", "X-User-Id", ""))
    for env, name, direct in protected:
        value = direct if env is None else os.environ.get(env, "").strip()
        if not value:
            continue
        for existing in list(headers):
            if existing.lower() == name.lower():
                del headers[existing]
        headers[name] = value
    return headers


def sanitized(value):
    if isinstance(value, dict):
        return {str(key): "<redacted>" if any(x in str(key).lower() for x in SENSITIVE_FRAGMENTS)
                else sanitized(child) for key, child in value.items()}
    if isinstance(value, list):
        return [sanitized(item) for item in value[:20]]
    return value
