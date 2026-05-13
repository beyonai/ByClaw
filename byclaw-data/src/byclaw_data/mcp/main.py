"""CLI entrypoint for the byclaw MCP service."""

from __future__ import annotations

import os

import uvicorn


def main() -> None:
    host = os.environ.get("DATACLOUD_DATA_SERVICE_HOST", "0.0.0.0")
    port = int(os.environ.get("DATACLOUD_DATA_SERVICE_PORT", "8080"))
    log_level = os.environ.get("DATACLOUD_DATA_SERVICE_LOG_LEVEL", "info")
    uvicorn.run(
        "byclaw_data.mcp.routes:create_app",
        factory=True,
        host=host,
        port=port,
        log_level=log_level,
    )


if __name__ == "__main__":
    main()
