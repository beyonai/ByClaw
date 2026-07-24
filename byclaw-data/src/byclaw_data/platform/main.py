"""CLI entrypoint for the byclaw MCP service."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any

import uvicorn


def _build_uvicorn_log_config(log_dir: str, log_level: str) -> dict[str, Any]:
    """构造 uvicorn log_config，在 uvicorn 自己的 dictConfig 里注入文件 handler。

    避免 setup_logging() 先加的 handler 被 uvicorn dictConfig 覆盖的时序问题。
    文件写入与 setup_logging 相同的 app.log，日志统一归档。
    """
    app_log = str(Path(log_dir) / "app.log")
    level = log_level.upper()
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "default": {
                "()": "uvicorn.logging.DefaultFormatter",
                "fmt": "%(levelprefix)s %(message)s",
                "use_colors": None,
            },
            "access": {
                "()": "uvicorn.logging.AccessFormatter",
                "fmt": '%(levelprefix)s %(client_addr)s - "%(request_line)s" %(status_code)s',
            },
            "file": {
                "format": "%(asctime)s [%(levelname)-5s] %(process)d %(name)s: %(message)s",
                "datefmt": "%Y-%m-%d %H:%M:%S",
            },
        },
        "handlers": {
            "default": {
                "formatter": "default",
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stderr",
            },
            "access": {
                "formatter": "access",
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
            },
            "file": {
                "formatter": "file",
                "class": "logging.handlers.TimedRotatingFileHandler",
                "filename": app_log,
                "when": "midnight",
                "interval": 1,
                "backupCount": 30,
                "encoding": "utf-8",
            },
        },
        "loggers": {
            "uvicorn": {
                "handlers": ["default", "file"],
                "level": level,
                "propagate": False,
            },
            "uvicorn.error": {"level": level},
            "uvicorn.access": {
                "handlers": ["access", "file"],
                "level": level,
                "propagate": False,
            },
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="byclaw-data MCP service")
    parser.add_argument("--host", default=None, help="Bind host (env: DATACLOUD_DATA_SERVICE_HOST, default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=None, help="Bind port (env: DATACLOUD_DATA_SERVICE_PORT, default: 8080)")
    parser.add_argument("--log-level", default=None, help="Log level (env: DATACLOUD_DATA_SERVICE_LOG_LEVEL, default: info)")
    parser.add_argument("--log-dir", default=None, help="Log directory (env: DATACLOUD_LOG_DIR, default: logs/service)")
    args = parser.parse_args()

    # 优先级：命令行参数 > 环境变量 > 默认值
    host = args.host or os.environ.get("DATACLOUD_DATA_SERVICE_HOST", "0.0.0.0")
    port = args.port or int(os.environ.get("DATACLOUD_DATA_SERVICE_PORT", "8080"))
    log_level = args.log_level or os.environ.get("DATACLOUD_DATA_SERVICE_LOG_LEVEL", "info")
    log_dir = args.log_dir or os.environ.get("DATACLOUD_LOG_DIR", "logs/service")

    os.environ.setdefault("DATACLOUD_LOG_DIR", log_dir)

    uvicorn.run(
        "byclaw_data.platform:create_app",
        factory=True,
        host=host,
        port=port,
        log_level=log_level,
        log_config=_build_uvicorn_log_config(log_dir, log_level),
    )


if __name__ == "__main__":
    main()
