from __future__ import annotations

import httpx
from jsonschema import ValidationError, validate

from callcli.credentials import sanitized
from callcli.errors import CallCliError, EXIT_AUTH, EXIT_SCHEMA


def validate_arguments(arguments: dict, schema: object, action: str) -> None:
    if not isinstance(schema, dict) or not schema:
        return
    try:
        validate(arguments, schema)
    except ValidationError as exc:
        path = ".".join(str(item) for item in exc.absolute_path)
        raise CallCliError("INVALID_PARAMETERS", f"invalid parameters for {action}: {exc.message}",
                           exit_code=EXIT_SCHEMA,
                           details={"field": path, "validator": exc.validator}) from exc


def map_http_error(exc: Exception, kind: str) -> CallCliError:
    if isinstance(exc, httpx.TimeoutException):
        return CallCliError(f"{kind}_TIMEOUT", f"{kind.lower()} request timed out",
                            exit_code=13, retryable=True)
    return CallCliError(f"{kind}_REQUEST_FAILED", f"{kind.lower()} request failed",
                        retryable=True, details=sanitized({"cause": str(exc)}))


def ensure_http_success(response: httpx.Response, kind: str) -> None:
    if response.status_code in (401, 403):
        raise CallCliError("AUTH_EXPIRED", "authentication expired or invalid", exit_code=EXIT_AUTH)
    if response.is_error:
        raise CallCliError(f"{kind}_REQUEST_FAILED", f"{kind.lower()} HTTP {response.status_code}",
                           retryable=response.status_code >= 500,
                           details={"status": response.status_code,
                                    "allow": response.headers.get("allow", "")})


def response_data(response: httpx.Response):
    try:
        return response.json()
    except ValueError:
        return response.text
