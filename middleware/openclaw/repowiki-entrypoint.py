#!/usr/bin/env python3
"""Run RepoWiki with a caller-provided, isolated data directory."""

from __future__ import annotations

import os
from pathlib import Path


def _runtime_dir() -> Path:
    raw = os.environ.get("BYCLAW_REPOWIKI_DATA_DIR", "").strip()
    if not raw:
        raise SystemExit("BYCLAW_REPOWIKI_DATA_DIR is required")
    runtime_dir = Path(raw).resolve()
    runtime_dir.mkdir(parents=True, exist_ok=True)
    return runtime_dir


def main() -> None:
    runtime_dir = _runtime_dir()

    # RepoWiki 0.3.2 stores config and cache under ~/.repowiki and does not expose
    # a CLI flag for either path. Override the module constants before Click runs
    # so concurrent digital employees never share model output or private-repo data.
    import repowiki.config as config_module
    import repowiki.core.cache as cache_module

    config_module._CONFIG_DIR = runtime_dir
    config_module._CONFIG_FILE = runtime_dir / "config.json"
    cache_module._CACHE_DIR = runtime_dir
    cache_module._CACHE_DB = runtime_dir / "cache.db"

    from repowiki.cli import cli

    cli(prog_name="repowiki")


if __name__ == "__main__":
    main()
