"""ByClaw API application entry point.

Usage in start.sh: ``uvicorn api:app --host ... --port ...``.
"""

import json
from functools import wraps
from typing import Any

from by_qa.main import app

from byclaw_knowledge_entity_runtime import install_byclaw_knowledge_entity_runtime
from byclaw_knowledge_event_publisher import EVENT_PUBLISHER_PROVIDER_PATH
from byclaw_userfs_storage import (
    CHAT_SESSION_ID_HEADER,
    RESOURCE_ID_HEADER,
    USER_CODE_HEADER,
    get_byclaw_userfs_header_context,
    reset_byclaw_userfs_headers,
    set_byclaw_userfs_headers,
)

_MULTIPART_METADATA_PATHS = {
    "/api/v1/knowledgeItems/import",
    "/api/v1/knowledgeItems/update",
}
_JSON_METADATA_PATHS = {
    "/api/v1/directories/create",
    "/api/v1/directories/update",
    "/api/v1/knowledgeItems/move",
}
_METADATA_QUERY_PATHS = {
    "/api/v1/listDir",
    "/api/v1/glob",
}
_USER_CODE_METADATA_FIELD = "userCode"

install_byclaw_knowledge_entity_runtime()

# Importing the adapter installs the provider path before by-qa lazily builds
# its shared event publisher. Keep the name referenced so linters do not treat
# this intentional import-time registration as unused.
_EVENT_PUBLISHER_PROVIDER_PATH = EVENT_PUBLISHER_PROVIDER_PATH


def _inject_user_code_into_metadata(
    metadata: Any,
    user_code: str,
    *,
    serialize: bool,
) -> Any:
    if not user_code:
        return metadata

    if serialize:
        if metadata in (None, ""):
            parsed_metadata = {}
        else:
            try:
                parsed_metadata = json.loads(metadata)
            except (TypeError, json.JSONDecodeError):
                # Preserve the upstream endpoint's validation response.
                return metadata
    else:
        parsed_metadata = {} if metadata is None else metadata

    if not isinstance(parsed_metadata, dict):
        # Preserve the upstream endpoint's validation response for invalid types.
        return metadata

    updated_metadata = dict(parsed_metadata)
    updated_metadata[_USER_CODE_METADATA_FIELD] = user_code
    if serialize:
        return json.dumps(updated_metadata, ensure_ascii=False)
    return updated_metadata


def _customize_request_arguments(
    path: str,
    arguments: dict[str, Any],
    user_code: str,
) -> dict[str, Any]:
    customized = dict(arguments)

    if path in _MULTIPART_METADATA_PATHS:
        customized["metadata"] = _inject_user_code_into_metadata(
            customized.get("metadata"),
            user_code,
            serialize=True,
        )
        return customized

    body = customized.get("body")
    if not isinstance(body, dict):
        return customized

    updated_body = dict(body)
    if path in _JSON_METADATA_PATHS and user_code:
        updated_body["metadata"] = _inject_user_code_into_metadata(
            updated_body.get("metadata"),
            user_code,
            serialize=False,
        )
    elif path in _METADATA_QUERY_PATHS:
        metadata_field_list = updated_body.get("metadataFieldList")
        if metadata_field_list is None:
            updated_body["metadataFieldList"] = [_USER_CODE_METADATA_FIELD]
        elif isinstance(metadata_field_list, list):
            updated_body["metadataFieldList"] = list(metadata_field_list)
            if _USER_CODE_METADATA_FIELD not in metadata_field_list:
                updated_body["metadataFieldList"].append(
                    _USER_CODE_METADATA_FIELD
                )

    customized["body"] = updated_body
    return customized


def _install_byclaw_request_customizations() -> None:
    customized_paths = (
        _MULTIPART_METADATA_PATHS | _JSON_METADATA_PATHS | _METADATA_QUERY_PATHS
    )
    for route in app.routes:
        path = getattr(route, "path", None)
        dependant = getattr(route, "dependant", None)
        if path not in customized_paths or dependant is None:
            continue

        original_call = dependant.call

        @wraps(original_call)
        async def customized_call(
            _original_call=original_call,
            _path=path,
            **kwargs,
        ):
            user_code = get_byclaw_userfs_header_context().get(
                USER_CODE_HEADER,
                "",
            )
            customized_arguments = _customize_request_arguments(
                _path,
                kwargs,
                user_code,
            )
            return await _original_call(**customized_arguments)

        dependant.call = customized_call


_install_byclaw_request_customizations()


@app.middleware("http")
async def byclaw_storage_header_context_middleware(request, call_next):
    token = set_byclaw_userfs_headers(
        {
            "beyond-token": request.headers.get("beyond-token", ""),
            RESOURCE_ID_HEADER: request.headers.get(RESOURCE_ID_HEADER, ""),
            USER_CODE_HEADER: request.headers.get(USER_CODE_HEADER, ""),
            CHAT_SESSION_ID_HEADER: request.headers.get(CHAT_SESSION_ID_HEADER, ""),
        }
    )
    try:
        return await call_next(request)
    finally:
        reset_byclaw_userfs_headers(token)
