from __future__ import annotations

from typing import Any

from byclaw_data.platform.routes import _configure_platform_logging


def test_configure_platform_logging_includes_datacloud_namespaces(
    monkeypatch,
) -> None:
    calls: list[dict[str, Any]] = []

    def fake_setup_logging(**kwargs: Any) -> None:
        calls.append(kwargs)

    monkeypatch.setenv("DATACLOUD_DATA_SERVICE_LOG_LEVEL", "debug")

    _configure_platform_logging(setup_logging_func=fake_setup_logging)

    assert calls == [
        {
            "level": "DEBUG",
            "extra_namespaces": ("byclaw_data", "datacloud_knowledge"),
        }
    ]
