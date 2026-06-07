"""Unified response envelope and KGW error taxonomy.

Every endpoint returns ``{resultCode, resultMsg, resultObject}``. Known
failure modes are subclasses of ``KgwError`` with a stable ``error_type``
string matching v5 spec §6.6. Endpoints translate raised KgwErrors into
envelopes; unknown exceptions are translated to a generic 500 envelope
by the FastAPI exception handler (wired in main.py).
"""

from __future__ import annotations

from typing import Any


def success(result_object: Any | None = None) -> dict[str, Any]:
    """Build a success envelope.

    Args:
        result_object: Business payload. Defaults to an empty dict.
    """
    return {
        "resultCode": "0",
        "resultMsg": "success",
        "resultObject": result_object if result_object is not None else {},
    }


def failure(
    *,
    error_type: str,
    message: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a failure envelope with a typed error code.

    The ``resultObject.errorCode`` field is the stable machine-readable
    error type. Additional context goes into other ``resultObject`` keys.
    """
    body: dict[str, Any] = {"errorCode": error_type}
    if extra:
        body.update(extra)
    return {
        "resultCode": "-1",
        "resultMsg": message,
        "resultObject": body,
    }


class KgwError(Exception):
    """Base class for all gateway-typed errors.

    Subclasses MUST set ``error_type`` to the v5 spec §6.6 string.
    Constructor accepts free-form keyword args that are camelCased into
    ``extra`` for the envelope.
    """

    error_type: str = "InternalError"

    def __init__(self, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.message = message
        # Convert snake_case kwargs to camelCase keys for the envelope body.
        self.extra: dict[str, Any] = {_camel(k): v for k, v in extra.items()}

    def to_envelope(self) -> dict[str, Any]:
        return failure(
            error_type=self.error_type, message=self.message, extra=self.extra
        )


def _camel(snake: str) -> str:
    parts = snake.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


# v5 spec §6.6 error taxonomy. Each subclass below corresponds to one row.
class KBNotFound(KgwError):
    error_type = "KBNotFound"


class OperationNotSupported(KgwError):
    error_type = "OperationNotSupported"


class UpstreamTimeout(KgwError):
    error_type = "UpstreamTimeout"


class UpstreamConnectError(KgwError):
    error_type = "UpstreamConnectError"


class UploadStreamBroken(KgwError):
    error_type = "UploadStreamBroken"


class DownloadStreamBroken(KgwError):
    error_type = "DownloadStreamBroken"


class AuthInfoNotFound(KgwError):
    error_type = "AuthInfoNotFound"


class BackendAuthFailed(KgwError):
    error_type = "BackendAuthFailed"


class CircuitOpen(KgwError):
    error_type = "CircuitOpen"


class MetadataPropertyNotFound(KgwError):
    error_type = "MetadataPropertyNotFound"


class MetadataPropertyConflict(KgwError):
    error_type = "MetadataPropertyConflict"


class MetadataPropertySyncFailed(KgwError):
    error_type = "MetadataPropertySyncFailed"


class MetadataPropertyAlreadyExists(KgwError):
    error_type = "MetadataPropertyAlreadyExists"


class MetadataPropertyInUse(KgwError):
    error_type = "MetadataPropertyInUse"


# Validation errors keep the metadata_api.md uppercase-snake style for
# easier alignment with portal-side validation messages.
# pylint: disable=invalid-name
class INVALID_VALUE_TYPE(KgwError):  # noqa: N801 (intentional: matches API spec string)
    error_type = "INVALID_VALUE_TYPE"


class INVALID_OPERATION_FOR_TYPE(KgwError):  # noqa: N801
    error_type = "INVALID_OPERATION_FOR_TYPE"


class INVALID_FIELD_VALUE_TYPE(KgwError):  # noqa: N801
    error_type = "INVALID_FIELD_VALUE_TYPE"


class INVALID_BATCH_DUPLICATE_NAME(KgwError):  # noqa: N801
    error_type = "INVALID_BATCH_DUPLICATE_NAME"


class INVALID_PROPERTY_NAME(KgwError):  # noqa: N801
    error_type = "INVALID_PROPERTY_NAME"


class MetadataPropertyNotRegistered(KgwError):
    error_type = "METADATA_PROPERTY_NOT_REGISTERED"


class PayloadTooLarge(KgwError):
    error_type = "PAYLOAD_TOO_LARGE"


class EventNotFound(KgwError):
    error_type = "EVENT_NOT_FOUND"
