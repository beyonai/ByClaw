"""ByClaw API application entry point.

Usage in start.sh: ``uvicorn api:app --host ... --port ...``.
"""

from by_qa.main import app

from byclaw_knowledge_entity_runtime import install_byclaw_knowledge_entity_runtime
from byclaw_knowledge_event_publisher import EVENT_PUBLISHER_PROVIDER_PATH
from byclaw_userfs_storage import (
    CHAT_SESSION_ID_HEADER,
    RESOURCE_ID_HEADER,
    USER_CODE_HEADER,
    reset_byclaw_userfs_headers,
    set_byclaw_userfs_headers,
)

install_byclaw_knowledge_entity_runtime()

# Importing the adapter installs the provider path before by-qa lazily builds
# its shared event publisher. Keep the name referenced so linters do not treat
# this intentional import-time registration as unused.
_EVENT_PUBLISHER_PROVIDER_PATH = EVENT_PUBLISHER_PROVIDER_PATH


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
