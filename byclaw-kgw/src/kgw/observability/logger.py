"""Structured logging via structlog.

Call ``configure_logging()`` once at startup. All other modules use
``get_logger(__name__)``.

Console format::

    2026-05-15 13:45:56.194 [INFO] [main.py:479] [trace_id:xxxx] message k=v ...

JSON format::

    {"timestamp":"...", "level":"info", "filename":"main.py", "lineno":479,
     "trace_id":"xxxx", "event":"message", "k":"v", ...}
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone

import structlog


def _console_renderer(unused_logger, unused_name, event_dict: dict) -> str:  # pylint: disable=unused-argument
    """Render a structlog event dict as a single-line console string."""
    ts = event_dict.pop("timestamp", "")
    level = str(event_dict.pop("level", "info")).upper()
    loc = f"{event_dict.pop('filename', '?')}:{event_dict.pop('lineno', 0)}"
    trace_id = event_dict.pop("trace_id", "-")
    event_dict.pop("func_name", None)  # already covered by filename:lineno
    event = event_dict.pop("event", "")

    extras = " ".join(f"{k}={v}" for k, v in event_dict.items())
    return f"{ts} [{level}] [{loc}] [trace_id:{trace_id}] {event} {extras}".strip()


def _local_timestamper(unused_logger, unused_name, event_dict: dict) -> dict:  # pylint: disable=unused-argument
    """Add ``timestamp`` as local time with milliseconds (no timezone)."""
    now = datetime.now(timezone.utc).astimezone()
    event_dict["timestamp"] = (
        now.strftime("%Y-%m-%d %H:%M:%S.") + f"{now.microsecond // 1000:03d}"
    )
    return event_dict


def configure_logging(*, json_logs: bool = True, level: str = "INFO") -> None:
    """Configure structlog. Idempotent — safe to call multiple times."""
    shared_processors: list = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.CallsiteParameterAdder(
            {
                structlog.processors.CallsiteParameter.FILENAME,
                structlog.processors.CallsiteParameter.FUNC_NAME,
                structlog.processors.CallsiteParameter.LINENO,
            },
        ),
        _local_timestamper,
    ]

    if json_logs:
        renderer = structlog.processors.JSONRenderer()
    else:
        renderer = _console_renderer

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper())
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.BoundLogger:
    """Return a structlog logger bound to ``name``."""
    return structlog.get_logger(name)
